import { describe, it, expect } from 'vitest';
import { extractNamesFromStructuredData, PDFTextItem } from './pdf-parser';

// Helper to build a PDF text item quickly.
const item = (str: string, x: number, y: number, page = 1): PDFTextItem =>
    ({ str, x, y, width: str.length * 12, height: 12, page });

describe('extractNamesFromStructuredData', () => {
    it('extracts names sitting immediately left of a signature cell', () => {
        // Mirrors a real 참석자명단 grid: name cell then "서명" cell on the same row.
        const items: PDFTextItem[] = [
            item('류기현', 216, 619), item('서명', 275, 619),
            item('최지은', 322, 619), item('서명', 382, 619),
            item('이갑종', 429, 619), item('서명', 489, 619),
            item('위원', 167, 605),
            item('황철현', 216, 591), item('서명', 275, 591),
            item('외부위원', 155, 562), item('배영화', 217, 562), item('서명', 275, 562),
            item('간사', 167, 533), item('정민주', 217, 533), item('서명', 275, 533),
        ];

        const names = extractNamesFromStructuredData(items);
        expect(names.sort()).toEqual(
            ['류기현', '최지은', '이갑종', '황철현', '배영화', '정민주'].sort()
        );
    });

    it('does not pick up body text or role labels as names', () => {
        const items: PDFTextItem[] = [
            item('배영화', 217, 562), item('서명', 275, 562),
            // Body text below the table — must be ignored entirely.
            item('국민의례', 85, 475),
            item('회의안건', 85, 459),
            item('활용계획', 398, 383),
            item('위원', 167, 605),
            item('외부위원', 155, 400),
        ];

        const names = extractNamesFromStructuredData(items);
        expect(names).toEqual(['배영화']);
    });
});
