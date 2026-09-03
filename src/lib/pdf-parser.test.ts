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

    it('회의록형: takes only the attendee block to the right of "참석자", not the body', () => {
        // Mirrors 게임콘텐츠과 교과협의록: no 서명 column, names in two rows next
        // to the "참석자" label at the very top, prose filling the rest of the page.
        const items: PDFTextItem[] = [
            // header row above the label — must be skipped, not scanned as names
            item('2026년 8월20일(목) 13:10~13:30', 110, 710), item('장 소', 340, 710),
            // the label + attendee block
            item('참석자', 70, 695),
            item('이상수', 110, 697), item('정필구', 180, 697), item('김민경', 250, 697),
            item('이갑종', 340, 697), item('김웅환', 430, 697),
            item('최지은', 110, 679), item('황철현', 180, 679), item('이효상', 250, 679),
            item('장효윤', 340, 679),
            // body below — the scan must stop here
            item('<협의 내용>', 110, 655),
            item('교과별 성취율이 골고루 분포되도록 출제한다', 110, 637),
            item('평가', 110, 619), item('문항', 300, 619),
            item('없음', 110, 400),
        ];

        const names = extractNamesFromStructuredData(items);
        expect(names.sort()).toEqual(
            ['이상수', '정필구', '김민경', '이갑종', '김웅환', '최지은', '황철현', '이효상', '장효윤'].sort()
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
