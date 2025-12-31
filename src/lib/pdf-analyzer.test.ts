import { describe, it, expect } from 'vitest';
import { normalizeText, groupItemsIntoRows, detectHeaderDeltas, findNamePosition } from './pdf-analyzer';

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
