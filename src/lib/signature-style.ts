/**
 * 저장용 PDF에 넣을 때만 서명을 "실제 펜으로 쓴 것처럼" 바꾼다.
 * 서명하는 화면과 제출 후 화면은 잘 보이는 기본 색을 쓰고, 이 변환은 PDF 저장 시점에만 적용한다.
 * 펜 종류(색·굵기·진하기)와 약간의 기울기를 서명마다 무작위로 정한다.
 */

export interface InkStyle {
    color: string;
    /** 1 = 원본 굵기, <1 얇게, >1 굵게 */
    thickness: number;
    alpha: number;
    /** 라디안 */
    tilt: number;
    label: string;
}

// 굵기·진하기는 펜마다 정해진 한 값 (펜 종류 = 굵기 종류)
const PENS: { label: string; color: string; thickness: number; alpha: number }[] = [
    { label: '얇은 검정', color: '#111827', thickness: 0.6, alpha: 0.95 },
    { label: '가는 볼펜', color: '#1f2937', thickness: 0.78, alpha: 0.92 },
    { label: '볼펜', color: '#1f2937', thickness: 0.9, alpha: 0.88 },
];

export function randomInkStyle(rnd: () => number = Math.random): InkStyle {
    const p = PENS[Math.floor(rnd() * PENS.length)];
    return {
        color: p.color,
        thickness: p.thickness,
        alpha: p.alpha,
        tilt: (rnd() - 0.5) * (Math.PI / 180) * 5, // ±2.5°
        label: p.label,
    };
}

const imgCache = new Map<string, Promise<HTMLImageElement>>();
function load(src: string): Promise<HTMLImageElement> {
    let p = imgCache.get(src);
    if (!p) {
        p = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
        imgCache.set(src, p);
    }
    return p;
}

function offsets(radius: number): [number, number][] {
    const out: [number, number][] = [[0, 0]];
    const n = Math.max(8, Math.ceil(radius * 6));
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
        if (radius > 3) out.push([Math.cos(a) * radius * 0.5, Math.sin(a) * radius * 0.5]);
    }
    return out;
}

/** 서명 PNG(dataURL)를 주어진 펜 스타일로 다시 칠한 PNG(dataURL)로 돌려준다. 회전 때문에 크기가 약간 커질 수 있다. */
export async function stylizeSignature(src: string, style: InkStyle = randomInkStyle()): Promise<string> {
    const img = await load(src);
    const pad = 12;
    const W = img.width + pad * 2, H = img.height + pad * 2;

    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

    // 1) 굵기: 두껍게 = 번지게(팽창), 얇게 = 깎기(침식)
    let work = mk();
    work.getContext('2d')!.drawImage(img, pad, pad);
    // 원본 펜 굵기 기준 (서명판 선 두께 ≈ 7px)
    const delta = (style.thickness - 1) * 3.5;
    if (Math.abs(delta) > 0.3) {
        const r = Math.abs(delta);
        const out = mk();
        const octx = out.getContext('2d')!;
        if (delta > 0) {
            for (const [dx, dy] of offsets(r)) octx.drawImage(work, dx, dy);
        } else {
            octx.drawImage(work, 0, 0);
            octx.globalCompositeOperation = 'destination-in';
            for (const [dx, dy] of offsets(r)) octx.drawImage(work, dx, dy);
        }
        work = out;
    }

    // 2) 색: 알파 모양은 그대로, 색만 펜 색으로
    const wctx = work.getContext('2d')!;
    wctx.globalCompositeOperation = 'source-in';
    wctx.fillStyle = style.color;
    wctx.fillRect(0, 0, W, H);

    // 3) 진하기 + 기울기
    const final = mk();
    const fctx = final.getContext('2d')!;
    fctx.translate(W / 2, H / 2);
    fctx.rotate(style.tilt);
    fctx.globalAlpha = style.alpha;
    fctx.drawImage(work, -W / 2, -H / 2);
    return final.toDataURL('image/png');
}
