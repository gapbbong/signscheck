// [SSR Fix] Remove top-level pdfjsLib import to avoid DOMMatrix error during build

export interface PDFTextItem {
    str: string;
    x: number;
    y: number;
    width: number;
    height: number;
    page: number;
}

/**
 * Extract structured text with coordinates from PDF
 */
export async function extractStructuredTextFromPDF(file: File): Promise<PDFTextItem[]> {
    // [SSR Fix] Lazy load pdfjsLib
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;

    const allItems: PDFTextItem[] = [];
    const maxPages = Math.min(pdf.numPages, 3);

    for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();

        textContent.items.forEach((item: any) => {
            const transform = item.transform;
            const tx = (transform && Array.isArray(transform)) ? transform[4] : 0;
            const ty = (transform && Array.isArray(transform)) ? transform[5] : 0;

            if (item.str && item.str.trim().length > 0) {
                allItems.push({
                    str: item.str.trim(),
                    x: tx,
                    y: ty,
                    width: item.width || 0,
                    height: item.height || 0,
                    page: i
                });
            }
        });
    }

    return allItems;
}

/**
 * Spatial Name Extractor (Grid Search)
 */
export function extractNamesFromStructuredData(items: PDFTextItem[]): string[] {
    const potentialNames = new Set<string>();

    // 1. Find Anchors (참석자, 명단, 성명 등 키워드 기반)
    const anchors = items.filter(item =>
        item.str.includes("참석자") ||
        item.str.includes("명단") ||
        item.str.includes("성명") ||
        item.str.includes("참가자") ||
        item.str.includes("인원") ||
        item.str.includes("attendee") ||
        item.str.includes("participant")
    );

    // Detect vertical "참석자" (split into single chars) if normal anchor fails
    // This is hard without complex logic, so we rely on Fallback if strictly vertical.

    if (anchors.length > 0) {
        anchors.forEach(anchor => {
            const verticalRange = 300;

            const gridItems = items.filter(item =>
                item.page === anchor.page &&
                item.x > anchor.x && // Right of anchor
                Math.abs(item.y - anchor.y) < verticalRange
            );

            gridItems.forEach(item => {
                const names = extractNamesFromRawString(item.str);
                names.forEach(n => potentialNames.add(n));
            });

            const colItems = items.filter(item =>
                item.page === anchor.page &&
                item.y < anchor.y &&
                (anchor.y - item.y) < 300 &&
                Math.abs(item.x - anchor.x) < 50
            );

            colItems.forEach(item => {
                const names = extractNamesFromRawString(item.str);
                names.forEach(n => potentialNames.add(n));
            });
        });
    }

    // Fallback: If no anchor or few names, use global regex
    if (potentialNames.size === 0) {
        const fullText = items.map(i => i.str).join(" ");
        const fallbackNames = extractNamesFromRawString(fullText);
        fallbackNames.forEach(n => potentialNames.add(n));
    }

    // Comprehensive Stopwords Filter
    return Array.from(potentialNames).filter(name => {
        const stopWords = new Set([
            "참석자", "참석", "회의록", "위원회", "페이지", "입니다", "합니다", "결재", "담당",
            "회의실", "위원장", "발언자", "불참자", "진행자", "기록자", "서기",
            "회장", "총무", "감사", "교장", "교감", "부장", "선생님", "교사",
            "학교", "학년", "번호", "날짜", "일시", "장소", "안건", "내용", "결과",
            "없음", "이상", "개회", "폐회", "동의", "재청", "가결", "부결",
            "전원", "찬성", "반대", "기권", "서명", "날인", "확인", "작성", "작성자",
            "법정위", "학운위", "교권보호", "선도위", "학폭위", "내용이", "기록되", "개조식", "서명본",
            // New additions from user screenshot
            "학년도", "교직원", "경성전", "자고등", "교사명", "학교장", "담당자", "비고", "연번", "행정실", "명렬", "고등학"
        ]);
        if (stopWords.has(name)) return false;
        if (name.endsWith('실') || name.endsWith('팀') || name.endsWith('과')) return false;
        if (name.endsWith('고') || name.endsWith('중') || name.endsWith('초')) return false; // School names usually
        return true;
    });
}

function extractNamesFromRawString(text: string): string[] {
    const found = [];
    const nameRegex = /[가-힣]{3}/g;
    let match;
    while ((match = nameRegex.exec(text)) !== null) {
        found.push(match[0]);
    }
    return found;
}
