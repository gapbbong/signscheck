export interface PDFTextItem {
    str: string;
    transform: number[]; // [1, 0, 0, 1, x, y]
    width: number;
}

export interface HeaderCoord {
    str: string;
    x: number;
    y: number;
    w: number;
}

export interface HeaderDelta {
    nameX: number;
    deltaX: number;
}

export const NAME_KEYWORDS = ['교사명', '성명', '이름', '교사', '성함', '성 명', '참석자명', '참석자', '이 름'];
export const SIGN_KEYWORDS = ['서명', '서명본', '(인)', '인장', '서명란', '서 명', '비고', '사인', '확인'];

/**
 * Normalizes a string for matching (removes special chars)
 */
export function normalizeText(text: string): string {
    return text.replace(/[^a-zA-Z0-9가-힣]/g, '');
}

/**
 * Groups PDF text items into rows based on Y-coordinate proximity
 */
export function groupItemsIntoRows(items: PDFTextItem[], threshold = 12): Record<number, PDFTextItem[]> {
    const rows: Record<number, PDFTextItem[]> = {};
    items.forEach(item => {
        const yKey = Math.round(item.transform[5] / threshold) * threshold;
        if (!rows[yKey]) rows[yKey] = [];
        rows[yKey].push(item);
    });
    return rows;
}

/**
 * Detects headers (Name, Sign) and calculates X-deltas between them.
 * Improved for v0.9.0: Multi-column and vertical band awareness.
 */
export function detectHeaderDeltas(items: PDFTextItem[]): HeaderDelta[] {
    const nameHeaders: HeaderCoord[] = [];
    const signHeaders: HeaderCoord[] = [];

    items.forEach(item => {
        // Keyword matching (normalized)
        const clean = normalizeText(item.str);
        if (NAME_KEYWORDS.some(kw => normalizeText(kw) === clean || item.str.includes(kw))) {
            nameHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || 40 });
        }
        if (SIGN_KEYWORDS.some(kw => normalizeText(kw) === clean || item.str.includes(kw))) {
            signHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || 40 });
        }
    });

    const deltas: HeaderDelta[] = [];
    nameHeaders.forEach(nh => {
        // Find the closest sign header on the same row or slightly above/below (Y tolerance 30)
        // Shift search to the right (x > nh.x)
        const closestSign = signHeaders
            .filter(sh => Math.abs(sh.y - nh.y) < 30)
            .filter(sh => sh.x > nh.x)
            .sort((a, b) => a.x - b.x)[0];

        if (closestSign) {
            const nameCenter = nh.x + (nh.w / 2);
            const signCenter = closestSign.x + (closestSign.w / 2);
            deltas.push({ nameX: nh.x, deltaX: signCenter - nameCenter });
        }
    });

    return deltas;
}

/**
 * Finds the position of a specific name within grouped rows
 */
export function findNamePosition(
    targetName: string,
    rows: Record<number, PDFTextItem[]>,
    headerDeltas: HeaderDelta[]
) {
    const cleanTarget = normalizeText(targetName);
    const namePattern = new RegExp(cleanTarget.split('').join('.*'));

    let foundPos: { x: number, y: number, w: number, delta: number } | null = null;

    Object.entries(rows).forEach(([_, rowItems]) => {
        const rowStr = rowItems.map(i => i.str).join('');
        const rowClean = normalizeText(rowStr);

        if (namePattern.test(rowClean)) {
            // Find the specific items that match the name
            const matchingItems = rowItems.filter(i => namePattern.test(normalizeText(i.str)));
            const targetItems = matchingItems.length > 0 ? matchingItems : rowItems;

            const minX = Math.min(...targetItems.map(i => i.transform[4]));
            const maxX = Math.max(...targetItems.map(i => i.transform[4] + (i.width || 0)));
            const w = maxX - minX;
            const avgY = targetItems.reduce((acc, i) => acc + i.transform[5], 0) / targetItems.length;

            // Use closest header delta
            let finalDelta = 140;
            if (headerDeltas.length > 0) {
                const bestH = headerDeltas.reduce((prev, curr) =>
                    Math.abs(curr.nameX - minX) < Math.abs(prev.nameX - minX) ? curr : prev
                );
                finalDelta = bestH.deltaX;
            }

            foundPos = { x: minX, y: avgY, w: w, delta: finalDelta };
        }
    });

    return foundPos;
}
