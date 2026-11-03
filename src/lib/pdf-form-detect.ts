/**
 * PDF 서식형: 글자 좌표만으로 서명 칸 · 참여/불참 칸 · 학번/성명/날짜 빈칸을 찾는다.
 * 좌표는 모두 "PDF 포인트, 원점은 페이지 왼쪽 위"로 통일한다 (pdf.js 항목은 adaptPdfJsItems로 변환).
 * 브라우저/Next에 의존하지 않는 순수 함수라서 테스트할 수 있다.
 */

export interface TextItem { str: string; x: number; y: number; w: number; h: number; }

export type FormRole = 'student' | 'guardian';

export interface SignField { id: string; kind: 'sign'; role: FormRole; x: number; y: number; w: number; h: number; }
export interface ChoiceOption { label: string; cx: number; cy: number; }
export interface ChoiceField { id: 'choice'; kind: 'choice'; role: 'student'; options: ChoiceOption[]; r: number; }
export type TextKey = 'studentNo' | 'name' | 'month' | 'day';
/** x는 글자 시작(left) 또는 칸 가운데(center), cy는 줄 세로 중앙 */
export interface TextField { id: string; kind: 'text'; key: TextKey; x: number; cy: number; align: 'left' | 'center'; size: number; }
export type FormField = SignField | ChoiceField | TextField;

export interface FormLayout { pageWidth: number; pageHeight: number; fields: FormField[]; }

export interface Glyph { ch: string; x0: number; x1: number; }
export interface Line { yc: number; glyphs: Glyph[]; compact: string; map: number[]; }

/** pdf.js getTextContent() 항목 → TextItem (좌표 원점을 왼쪽 위로) */
export function adaptPdfJsItems(
    items: { str: string; transform: number[]; width: number; height: number }[],
    pageHeight: number
): TextItem[] {
    return items
        .filter(i => i.str && i.str.trim().length > 0)
        .map(i => {
            const h = i.height || 10;
            return { str: i.str, x: i.transform[4], y: pageHeight - i.transform[5] - h * 0.85, w: i.width || 0, h };
        });
}

/** 같은 줄(세로 중앙 ±4pt)끼리 묶고, 글자를 한 글자씩 x 구간으로 펼친다. */
export function buildLines(items: TextItem[]): Line[] {
    const sorted = [...items].filter(i => i.str.trim()).sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
    const groups: { yc: number; items: TextItem[] }[] = [];
    for (const it of sorted) {
        const yc = it.y + it.h / 2;
        const g = groups[groups.length - 1];
        if (g && Math.abs(yc - g.yc) <= 4) {
            g.items.push(it);
            g.yc = g.items.reduce((s, i) => s + i.y + i.h / 2, 0) / g.items.length;
        } else groups.push({ yc, items: [it] });
    }
    return groups.map(g => {
        const glyphs: Glyph[] = [];
        for (const it of [...g.items].sort((a, b) => a.x - b.x)) {
            const chars = [...it.str];
            const step = it.w / Math.max(chars.length, 1);
            chars.forEach((ch, k) => glyphs.push({ ch, x0: it.x + step * k, x1: it.x + step * (k + 1) }));
        }
        const map: number[] = [];
        let compact = '';
        glyphs.forEach((g2, i) => { if (!/\s/.test(g2.ch)) { compact += g2.ch; map.push(i); } });
        return { yc: g.yc, glyphs, compact, map };
    });
}

const span = (line: Line, start: number, end: number) => ({
    x0: line.glyphs[line.map[start]].x0,
    x1: line.glyphs[line.map[end - 1]].x1,
});

function detectSignFields(lines: Line[]): SignField[] {
    const out: SignField[] = [];
    const used = new Set<string>();
    for (const line of lines) {
        let prevEnd = 0;
        for (const m of line.compact.matchAll(/\((?:인|서명)\)/g)) {
            const start = m.index!;
            const label = line.compact.slice(prevEnd, start);
            prevEnd = start + m[0].length;
            const g = label.lastIndexOf('보호자') >= 0 || label.lastIndexOf('학부모') >= 0
                ? Math.max(label.lastIndexOf('보호자'), label.lastIndexOf('학부모')) : -1;
            const s = label.lastIndexOf('학생');
            const role: FormRole | null = g >= 0 && g >= s ? 'guardian' : s >= 0 ? 'student' : null;
            if (!role || used.has(role)) continue;
            used.add(role);

            const marker = span(line, start, start + m[0].length);
            const before = start > 0 ? span(line, start - 1, start) : { x0: marker.x0, x1: marker.x0 };
            const gap = marker.x0 - before.x1;
            const h = 20;
            let x: number, w: number;
            if (gap >= 40) {
                // 이름이 비어 있는 칸: 칸 안에 가운데 정렬
                w = Math.min(gap - 6, 84);
                x = before.x1 + (gap - w) / 2;
            } else {
                // 이름이 이미 찍혀 있는 칸: 도장처럼 "(인)" 오른쪽 끝에 맞춰 이름 위에 겹친다
                w = 60;
                x = marker.x1 + 2 - w;
            }
            out.push({ id: `sign-${role}`, kind: 'sign', role, x, y: line.yc - h / 2, w, h });
        }
    }
    return out;
}

function detectChoice(lines: Line[]): ChoiceField | null {
    const idx = lines.findIndex(l => {
        const a = l.compact.indexOf('참여'), b = l.compact.indexOf('불참');
        return a >= 0 && b > a;
    });
    if (idx < 0) return null;
    const head = lines[idx];
    const yes = span(head, head.compact.indexOf('참여'), head.compact.indexOf('참여') + 2);
    const no = span(head, head.compact.indexOf('불참'), head.compact.indexOf('불참') + 2);

    // 머리글 바로 아래 줄들(왼쪽 칸 안에서 이어지는 줄)의 세로 중앙을 칸 중앙으로 본다
    const below = lines.slice(idx + 1).filter(l => l.yc > head.yc + 6);
    let cy = head.yc + 25;
    if (below.length) {
        const first = below[0];
        const fx0 = first.glyphs[0].x0, fx1 = first.glyphs[first.glyphs.length - 1].x1;
        let last = first;
        for (const l of below.slice(1)) {
            const overlaps = l.glyphs[0].x0 < fx1 && l.glyphs[l.glyphs.length - 1].x1 > fx0;
            if (overlaps && l.yc - last.yc <= 20) last = l; else break;
        }
        cy = (first.yc + last.yc) / 2;
    }
    return {
        id: 'choice', kind: 'choice', role: 'student', r: 9,
        options: [
            { label: '참여', cx: (yes.x0 + yes.x1) / 2, cy },
            { label: '불참', cx: (no.x0 + no.x1) / 2, cy },
        ],
    };
}

function detectTextFields(lines: Line[]): TextField[] {
    const out: TextField[] = [];
    for (const line of lines) {
        const labels: { key: TextKey; word: string }[] = [{ key: 'studentNo', word: '학번' }, { key: 'name', word: '성명' }];
        for (const { key, word } of labels) {
            const m = new RegExp(word + '[:：]').exec(line.compact);
            // 서식의 빈칸 줄만 대상: 같은 줄에 이름이 이미 찍혀 있는 표(결과보고서)는 제외
            if (!m || out.some(f => f.key === key)) continue;
            if (key === 'name' && /성명.*학년반/.test(line.compact)) continue;
            const e = span(line, m.index, m.index + m[0].length);
            out.push({ id: `text-${key}`, kind: 'text', key, x: e.x1 + 4, cy: line.yc, align: 'left', size: 11 });
        }
        // "2026. . ." 처럼 월·일이 비어 있는 날짜
        const d = /(\d{4})\.\.\./.exec(line.compact);
        if (d && !out.some(f => f.key === 'month')) {
            const dots = [0, 1, 2].map(k => span(line, d.index + 4 + k, d.index + 5 + k));
            out.push({ id: 'text-month', kind: 'text', key: 'month', x: (dots[0].x1 + dots[1].x0) / 2, cy: line.yc, align: 'center', size: 11 });
            out.push({ id: 'text-day', kind: 'text', key: 'day', x: (dots[1].x1 + dots[2].x0) / 2, cy: line.yc, align: 'center', size: 11 });
        }
    }
    return out;
}

export function detectFormLayout(items: TextItem[], pageWidth: number, pageHeight: number): FormLayout {
    const lines = buildLines(items);
    const choice = detectChoice(lines);
    return {
        pageWidth, pageHeight,
        fields: [...detectSignFields(lines), ...(choice ? [choice] : []), ...detectTextFields(lines)],
    };
}

export interface Identity { name: string; grade: number; classNo: number; number: number; }

/** 학생별 PDF(결과보고서형)에서 "성명 … 제3학년 4반 9번"을 읽어 학생을 식별한다. */
export function extractIdentity(items: TextItem[]): Identity | null {
    for (const line of buildLines(items)) {
        const c = line.compact;
        const num = /제?(\d)학년(\d{1,2})반(\d{1,2})번/.exec(c);
        const nm = /성명(.+?)학년반/.exec(c) ?? /성명([가-힣A-Za-z○OXx*]{2,6})/.exec(c);
        if (num && nm) return { name: nm[1], grade: Number(num[1]), classNo: Number(num[2]), number: Number(num[3]) };
    }
    return null;
}

/** 교사가 화살표로 보정한 값(포인트)을 레이아웃에 반영 */
export function applyNudges(layout: FormLayout, nudges: Record<string, { dx: number; dy: number }>): FormLayout {
    return {
        ...layout,
        fields: layout.fields.map(f => {
            const n = nudges[f.id];
            if (!n) return f;
            if (f.kind === 'sign') return { ...f, x: f.x + n.dx, y: f.y + n.dy };
            if (f.kind === 'choice') return { ...f, options: f.options.map(o => ({ ...o, cx: o.cx + n.dx, cy: o.cy + n.dy })) };
            return { ...f, x: f.x + n.dx, cy: f.cy + n.dy };
        }),
    };
}
