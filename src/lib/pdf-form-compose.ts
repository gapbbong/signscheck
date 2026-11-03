/**
 * PDF 서식형: 한 장의 캔버스에 문서 + 서명 + 참여/불참 표시 + 자동 기입 글자를 그린다.
 * 서명 화면 미리보기, 교사 위치 확인, 서명 완료 PDF 저장이 모두 같은 그림을 쓰므로
 * 화면에서 본 위치와 저장된 PDF의 위치가 어긋나지 않는다.
 */
import { FormLayout, FormRole, TextKey } from './pdf-form-detect';

export interface ComposeValues {
    studentSig?: string | null;
    guardianSig?: string | null;
    choice?: string | null;
    texts?: Partial<Record<TextKey, string>>;
    /** 지금 서명/선택해야 하는 쪽을 초록 점선으로 안내 */
    highlight?: FormRole | null;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string): Promise<HTMLImageElement> {
    let p = imageCache.get(src);
    if (!p) {
        p = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
        imageCache.set(src, p);
    }
    return p;
}

/** base: 문서 첫 페이지를 그린 캔버스. scale = 캔버스 픽셀 / PDF 포인트 */
export async function composePage(
    target: HTMLCanvasElement,
    base: HTMLCanvasElement,
    layout: FormLayout,
    values: ComposeValues
): Promise<void> {
    const scale = base.width / layout.pageWidth;
    target.width = base.width;
    target.height = base.height;
    const ctx = target.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(base, 0, 0);

    for (const f of layout.fields) {
        if (f.kind === 'sign') {
            const src = f.role === 'student' ? values.studentSig : values.guardianSig;
            const x = f.x * scale, y = f.y * scale, w = f.w * scale, h = f.h * scale;
            if (src) {
                const img = await loadImage(src);
                // 서명판(3:1)을 칸 안에 비율을 지켜 가운데로 맞춘다. 글자와 겹쳐도 비치도록 multiply.
                const r = Math.min(w / img.width, h / img.height);
                const dw = img.width * r, dh = img.height * r;
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
                ctx.restore();
            } else if (values.highlight === f.role) {
                ctx.save();
                ctx.fillStyle = 'rgba(16,185,129,0.10)';
                ctx.strokeStyle = '#10b981';
                ctx.lineWidth = 1.5 * scale;
                ctx.setLineDash([4 * scale, 3 * scale]);
                ctx.fillRect(x, y, w, h);
                ctx.strokeRect(x, y, w, h);
                ctx.restore();
            }
        } else if (f.kind === 'choice') {
            for (const o of f.options) {
                const selected = values.choice === o.label;
                const hint = !values.choice && values.highlight === f.role;
                if (!selected && !hint) continue;
                ctx.save();
                ctx.beginPath();
                ctx.arc(o.cx * scale, o.cy * scale, f.r * scale, 0, Math.PI * 2);
                ctx.lineWidth = (selected ? 1.8 : 1.2) * scale;
                ctx.strokeStyle = selected ? '#111827' : '#10b981';
                if (!selected) ctx.setLineDash([3 * scale, 3 * scale]);
                ctx.stroke();
                ctx.restore();
            }
        } else {
            const text = values.texts?.[f.key];
            if (!text) continue;
            ctx.save();
            ctx.fillStyle = '#111827';
            ctx.font = `${f.size * scale}px "Malgun Gothic","Noto Sans KR","Apple SD Gothic Neo",sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = f.align === 'center' ? 'center' : 'left';
            ctx.fillText(text, f.x * scale, f.cy * scale);
            ctx.restore();
        }
    }
}

/** 학번 5자리: 학년(1) + 반(2) + 번호(2) */
export function studentNoText(grade: number, classNo: number, number: number): string {
    return `${grade}${String(classNo).padStart(2, '0')}${String(number).padStart(2, '0')}`;
}

/** 서명한 날짜의 월/일 (한국 시간 기준) */
export function monthDayKST(d: Date): { month: string; day: string } {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).formatToParts(d);
    return {
        month: parts.find(p => p.type === 'month')?.value ?? '',
        day: parts.find(p => p.type === 'day')?.value ?? '',
    };
}

/** 캔버스를 PDF 한 장(원래 페이지 크기)으로 저장 */
export async function canvasToPdfBlob(canvas: HTMLCanvasElement, pageWidth: number, pageHeight: number): Promise<Blob> {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([pageWidth, pageHeight]);
    const jpg = await pdf.embedJpg(canvas.toDataURL('image/jpeg', 0.92));
    page.drawImage(jpg, { x: 0, y: 0, width: pageWidth, height: pageHeight });
    const bytes = await pdf.save();
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}

/** pdf.js로 첫 페이지를 캔버스에 그린다. url은 프록시 경로 또는 ArrayBuffer */
export async function renderFirstPage(
    source: string | ArrayBuffer,
    targetWidthPx: number
): Promise<{ canvas: HTMLCanvasElement; pageWidth: number; pageHeight: number; items: { str: string; transform: number[]; width: number; height: number }[] }> {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const doc = await pdfjsLib.getDocument(typeof source === 'string' ? source : { data: source }).promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = targetWidthPx / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport } as Parameters<typeof page.render>[0]).promise;
    const content = await page.getTextContent();
    const items = (content.items as { str?: string; transform: number[]; width: number; height: number }[])
        .filter(i => typeof i.str === 'string')
        .map(i => ({ str: i.str as string, transform: i.transform, width: i.width, height: i.height }));
    return { canvas, pageWidth: base.width, pageHeight: base.height, items };
}
