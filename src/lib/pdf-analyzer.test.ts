import { describe, it, expect } from 'vitest';
import { extractColumnRules, bordersAtY, signingCellFromBorders } from './pdf-analyzer';

const OPS = {
    save: 10, restore: 11, transform: 12,
    constructPath: 91, moveTo: 13, lineTo: 14, curveTo: 15, rectangle: 19, closePath: 18,
};
// pdf.js ≥ v4 constructPath: [flags, [packedCoords], bbox]. Only the bbox matters here.
const cp = (x0: number, y0: number, x1: number, y1: number) => [28, [{}], [x0, y0, x1, y1]];
import { normalizeText, groupItemsIntoRows, detectHeaderDeltas, findNamePosition } from './pdf-analyzer';

describe('column borders', () => {
    it('extractColumnRules reads cell rectangles into vertical borders, skipping the page box', () => {
        const fn = [OPS.constructPath, OPS.constructPath, OPS.constructPath];
        const args = [
            cp(0, 0, 595, 841),        // full-page clip — ignored
            cp(99, 717, 141, 739),     // name cell
            cp(141, 717, 183, 739),    // signing cell
        ];
        const rules = extractColumnRules(fn, args, OPS, 8, 595);
        expect(bordersAtY(rules, 728)).toEqual([99, 141, 183]);
        expect(bordersAtY(rules, 400)).toEqual([]); // nothing crosses that row
    });

    it('extractColumnRules honours the CTM', () => {
        const fn = [OPS.save, OPS.transform, OPS.constructPath, OPS.restore];
        const args = [null, [1, 0, 0, 1, 50, 0], cp(100, 0, 100, 40), null];
        expect(extractColumnRules(fn, args, OPS).map(r => r.x)).toEqual([150, 150]);
    });

    it('signingCellFromBorders returns the cell right of the name cell', () => {
        const borders = [90, 150, 210, 270, 330];
        const cell = signingCellFromBorders(155, 185, borders)!;
        expect(cell.center).toBe(240);
        expect(cell.width).toBe(60);
    });

    it('signingCellFromBorders bails when the name is in the last column', () => {
        expect(signingCellFromBorders(155, 185, [90, 150, 210])).toBeNull();
    });

    it('findNamePosition uses exact borders when present (non-uniform columns)', () => {
        // mirrors the real 협의록: 이갑종 column is wider than 이상수 column
        const mk = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y] as number[], width: 31 });
        const rows = { 724: [mk('이상수', 104, 724), mk('이갑종', 363, 724)] };
        const rules = [
            { x: 99, y0: 718, y1: 739 }, { x: 141, y0: 718, y1: 739 }, { x: 183, y0: 718, y1: 739 },
            { x: 358, y0: 718, y1: 739 }, { x: 406, y0: 718, y1: 739 }, { x: 448, y0: 718, y1: 739 },
        ];
        const a = findNamePosition('이상수', rows as any, [], rules) as any;
        const b = findNamePosition('이갑종', rows as any, [], rules) as any;
        expect(a.x + a.w / 2 + a.delta).toBeCloseTo(162, 0);  // (141+183)/2
        expect(b.x + b.w / 2 + b.delta).toBeCloseTo(427, 0);  // (406+448)/2
    });
});

describe('PDF Analyzer Logic', () => {
    describe('normalizeText', () => {
        it('should remove special characters and spaces', () => {
            expect(normalizeText('이 갑 종 (인)')).toBe('이갑종인');
            expect(normalizeText('Hong Gil-Dong!')).toBe('HongGilDong');
        });
    });

    describe('detectHeaderDeltas', () => {
        it('should calculate correct delta between name and sign headers', () => {
            const items = [
                { str: '교사명', transform: [1, 0, 0, 1, 100, 500], width: 40 },
                { str: '서명', transform: [1, 0, 0, 1, 240, 500], width: 40 },
            ];
            const deltas = detectHeaderDeltas(items as any);
            expect(deltas).toHaveLength(1);
            // center of name: 100 + 20 = 120
            // center of sign: 240 + 20 = 260
            // delta: 260 - 120 = 140
            expect(deltas[0].deltaX).toBe(140);
        });

        it('should handle multiple columns correctly', () => {
            const items = [
                { str: '교사명', transform: [1, 0, 0, 1, 100, 500], width: 40 },
                { str: '서명', transform: [1, 0, 0, 1, 240, 500], width: 40 },
                { str: '교사명', transform: [1, 0, 0, 1, 400, 500], width: 40 },
                { str: '서명', transform: [1, 0, 0, 1, 550, 500], width: 40 },
            ];
            const deltas = detectHeaderDeltas(items as any);
            expect(deltas).toHaveLength(2);
            expect(deltas[1].deltaX).toBe(150); // (550+20) - (400+20) = 150
        });

        it('should detect "(인)" and "비고" as sign headers', () => {
            const items = [
                { str: '교사명', transform: [1, 0, 0, 1, 100, 500], width: 40 },
                { str: '(인)', transform: [1, 0, 0, 1, 300, 500], width: 40 },
                { str: '비고', transform: [1, 0, 0, 1, 500, 500], width: 40 },
            ];
            const deltas = detectHeaderDeltas(items as any);
            expect(deltas).toHaveLength(1); // '교사명' matched with the closest right-side sign header '(인)'
            expect(deltas[0].deltaX).toBe(200);
        });

        it('should handle complex 3-column grid', () => {
            const items = [
                // Column 1
                { str: '교사명', transform: [1, 0, 0, 1, 50, 500], width: 40 },
                { str: '서명', transform: [1, 0, 0, 1, 150, 500], width: 40 },
                // Column 2
                { str: '교사명', transform: [1, 0, 0, 1, 250, 500], width: 40 },
                { str: '서명', transform: [1, 0, 0, 1, 350, 500], width: 40 },
                // Column 3
                { str: '교사명', transform: [1, 0, 0, 1, 450, 500], width: 40 },
                { str: '(인)', transform: [1, 0, 0, 1, 550, 500], width: 40 },
            ];
            const deltas = detectHeaderDeltas(items as any);
            expect(deltas).toHaveLength(3);
            expect(deltas[0].deltaX).toBe(100);
            expect(deltas[1].deltaX).toBe(100);
            expect(deltas[2].deltaX).toBe(100);
        });
    });

    describe('findNamePosition', () => {
        it('should find the correct position for a name in a multi-column row', () => {
            const rows = {
                500: [
                    { str: '이갑종', transform: [1, 0, 0, 1, 50, 500], width: 50 }, // Col 1
                    { str: '김철수', transform: [1, 0, 0, 1, 250, 500], width: 50 }, // Col 2
                    { str: '박영희', transform: [1, 0, 0, 1, 450, 500], width: 50 }, // Col 3
                ]
            };
            const headerDeltas = [
                { nameX: 40, deltaX: 100 }, // Header for Col 1
                { nameX: 240, deltaX: 110 }, // Header for Col 2
                { nameX: 440, deltaX: 120 }, // Header for Col 3
            ];

            const pos3 = (findNamePosition('박영희', rows as any, headerDeltas) as unknown) as { x: number, delta: number };
            expect(pos3.x).toBe(450);
            expect(pos3.delta).toBe(120); // Should pick the closest header delta (440 is closest to 450)
        });
        it('should anchor to the actual signature cell (exact delta + cell width) when present', () => {
            // Real-grid geometry: name then "서명" cell then next column's name.
            const rows = {
                619: [
                    { str: '류기현', transform: [1, 0, 0, 1, 216, 619], width: 36 },
                    { str: '서명', transform: [1, 0, 0, 1, 275, 619], width: 24 },
                    { str: '최지은', transform: [1, 0, 0, 1, 322, 619], width: 36 },
                    { str: '서명', transform: [1, 0, 0, 1, 382, 619], width: 24 },
                ]
            };
            const pos = (findNamePosition('류기현', rows as any, []) as unknown) as { x: number, delta: number, w: number, sigWidth: number };
            // name center = (216 + 252)/2 = 234; signing area centered ~281,
            // so delta ~= 47 (NOT the 140 default)
            expect(pos.delta).toBeGreaterThan(40);
            expect(pos.delta).toBeLessThan(55);
            // signing area spans name-end..cell-border: narrower than old fixed 80
            // but wider than just the "서명" label half
            expect(pos.sigWidth).toBeGreaterThan(50);
            expect(pos.sigWidth).toBeLessThan(75);
            // box center = nameCenter + delta should land on the signing area (~281)
            const nameCenter = pos.x + pos.w / 2;
            expect(nameCenter + pos.delta).toBeGreaterThan(272);
            expect(nameCenter + pos.delta).toBeLessThan(292);
        });
        it('회의록형 row (name | blank | name …): signature lands one cell right, same for every name', () => {
            const mk = (str: string, x: number) => ({ str, transform: [1, 0, 0, 1, x, 640] as number[], width: str.length * 11 });
            const rows = {
                640: [
                    mk('참', 70), mk('석', 82), mk('자', 94),
                    mk('이상수', 140), mk('정필구', 240), mk('김민경', 340),
                    mk('이갑종', 440), mk('김웅환', 540), // last name, no next cell
                ],
            };
            const first = findNamePosition('이상수', rows as any, []) as any;
            const last = findNamePosition('김웅환', rows as any, []) as any;
            // cellW = gap(100)/2 = 50; signCenter = minX + 75
            const firstBoxCenter = first.x + first.w / 2 + first.delta;
            const lastBoxCenter = last.x + last.w / 2 + last.delta;
            expect(firstBoxCenter).toBeGreaterThan(200);   // ~215, into the blank after 이상수
            expect(firstBoxCenter).toBeLessThan(235);
            expect(lastBoxCenter).toBeGreaterThan(600);     // ~615, blank after 김웅환 — not off at the edge
            expect(lastBoxCenter).toBeLessThan(640);
        });
        it('should find the correct position for a name using fuzzy matching', () => {
            const rows = {
                500: [
                    { str: '1', transform: [1, 0, 0, 1, 50, 500], width: 10 },
                    { str: '이갑종', transform: [1, 0, 0, 1, 100, 500], width: 60 },
                    { str: '31', transform: [1, 0, 0, 1, 300, 500], width: 20 },
                ]
            };
            const headerDeltas = [{ nameX: 80, deltaX: 140 }];
            const pos = (findNamePosition('이갑종', rows as any, headerDeltas) as unknown) as { x: number, delta: number };
            expect(pos).not.toBeNull();
            expect(pos.x).toBe(100);
            expect(pos.delta).toBe(140);
        });
    });
});
