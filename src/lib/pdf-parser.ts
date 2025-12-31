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

    // 1. Find ALL Anchors (headers like 교사명, 성명, etc.)
    const anchors = items.filter(item =>
        item.str === "교사명" ||
        item.str === "성명" ||
        item.str === "성 명" ||
        item.str === "참석자" ||
        item.str === "명단" ||
        item.str === "교직원"
    );

    // [New] Sort anchors by page then by X coordinate (Left to Right)
    anchors.sort((a, b) => {
        if (a.page !== b.page) return a.page - b.page;
        return a.x - b.x;
    });

    if (anchors.length > 0) {
        anchors.forEach(anchor => {
            // Find items below this specific anchor (same column)
            // Look for items with similar X coordinate (+/- 60px) and below it (Y increases upward in some systems, but pdf.js usually has Y increasing UP)
            // In extractStructuredTextFromPDF, we use ty as y. Standard PDF coordinate: 0,0 is bottom-left. 
            // So "below" means item.y < anchor.y
            const columnItems = items.filter(item =>
                item.page === anchor.page &&
                item.y < anchor.y && // Below anchor
                (anchor.y - item.y) < 600 && // Within reasonable vertical distance
                Math.abs(item.x - anchor.x) < 60 // Same column alignment
            );

            // [New] Sort items within the column by Y coordinate descending (Top to Bottom)
            columnItems.sort((a, b) => b.y - a.y);

            // [New] Use for...of to allow breaking (Stop scanning when table ends)
            for (const item of columnItems) {
                const s = item.str.replace(/\s+/g, '');
                // Stop triggers: Section headers or long sentences indicating body text
                if (s.includes("상정") || s.includes("안건") || s.includes("결정") || s.includes("202") || s.length > 8) {
                    break;
                }

                // Only extract if the string is short (likely a name, not a sentence)
                if (item.str.length >= 2 && item.str.length <= 4) {
                    const names = extractNamesFromRawString(item.str);
                    names.forEach(n => potentialNames.add(n));
                }
            }
        });
    }

    // 2. Fallback: If still too few, try to look for name-like patterns globally but with stricter filtering
    if (potentialNames.size < 5) {
        // [New] Sort items globally for fallback (Top-down, then Left-right)
        const sortedItems = [...items].sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            if (Math.abs(a.y - b.y) > 10) return b.y - a.y;
            return a.x - b.x;
        });

        sortedItems.forEach(item => {
            if (item.str.length >= 2 && item.str.length <= 4) {
                const names = extractNamesFromRawString(item.str);
                names.forEach(n => potentialNames.add(n));
            }
        });
    }

    // Comprehensive Stopwords Filter for School/Official Documents
    const exactStopWords = new Set([
        "참석자", "참석", "회의록", "위원회", "페이지", "입니다", "합니다", "결재", "담당",
        "회의실", "위원장", "발언자", "불참자", "진행자", "기록자", "서기",
        "회장", "총무", "감사", "교장", "교감", "부장", "선생님", "교사",
        "학교", "학년", "번호", "날짜", "일시", "장소", "안건", "내용", "결과",
        "없음", "이상", "개회", "폐회", "동의", "재청", "가결", "부결",
        "전원", "찬성", "반대", "기권", "서명", "날인", "확인", "작성", "작성자",
        "법정위", "학운위", "교권보호", "선도위", "학폭위", "내용이", "기록되", "개조식", "서명본",
        "학년도", "교직원", "교사명", "학교장", "담당자", "비고", "연번", "행정실", "명렬", "고등학",
        "디지털", "선도학", "동의서", "법령", "학교명", "교육부", "교육청", "본인은", "해당사",
        "관련", "정보가", "법령", "동의서", "서명", "성명", "소속", "직위", "연락처",
        // User Reported Garbage
        "상정", "대기중", "대기", "하도록", "획이", "없는", "기자재를", "지난", "기자재는",
        "기자재", "진행하게", "혹시", "추가로", "모두", "없습니다", "참조해", "주시기",
        "결정사항", "모니터", "점검때", "지적", "바랍니다", "기존", "받은", "노후", "하는",
        "기자재가", "있는", "실습실에", "점이", "폐기를", "사용하지", "사용하던", "재구조화",
        "실습실이", "있나요", "폐기", "자세한", "같이", "결정함", "프로젝터", "케이블",
        "폐기에", "관한", "협의", "회의를", "않거나", "추후", "사용계", "내용연수",
        "인해", "이제", "내용은", "첨부된", "거치대"
    ]);

    const forbiddenSubstrings = [
        "취지와", "운용내", "이해하", "교원으", "자발적", "참여할",
        "동의합", "사업운", "필요한", "범위내", "소속부", "학번학", "연락처", "기본인", "사항사",
        "수업연", "활동내", "결과물", "정보가", "관련법", "개인정", "처리지", "따라수", "집이용",
        "학기말", "방학중", "학기중", "상정안", "결정사"
    ];

    return Array.from(potentialNames).filter(name => {
        const cleanName = name.replace(/\s+/g, '');
        if (exactStopWords.has(cleanName)) return false;
        if (cleanName.length < 2 || cleanName.length > 4) return false;

        // Use exact match for common words like "이상" to avoid filtering "이상수"
        // Only use substring check for very specific preamble noise bits
        for (const forbidden of forbiddenSubstrings) {
            if (cleanName.includes(forbidden)) return false;
        }
        if (cleanName.endsWith('실') || cleanName.endsWith('팀') || cleanName.endsWith('과')) return false;
        if (cleanName.endsWith('고') || cleanName.endsWith('중') || cleanName.endsWith('초')) return false;
        return true;
    });
}

function extractNamesFromRawString(text: string): string[] {
    const found = [];
    const nameRegex = /[가-힣]{2,4}/g;
    let match;
    while ((match = nameRegex.exec(text)) !== null) {
        const name = match[0];
        // Basic filtering to avoid common particles if needed
        found.push(name);
    }
    return found;
}
