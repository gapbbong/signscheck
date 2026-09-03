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

// Tight set of markers that denote an actual signature cell (normalized form,
// so "(인)" -> "인" and "서 명" -> "서명"). Used to anchor the signature box to
// the real cell to the right of a name, rather than guessing a horizontal delta.
const SIGN_CELL_MARKERS = new Set(['서명', '서명란', '서명본', '인', '인장', '사인', '싸인']);

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

    let foundPos: { x: number, y: number, w: number, delta: number, sigWidth?: number } | null = null;

    // Rows top → bottom, so the first match is the attendee row, not a later
    // body line that happens to contain the same characters in order.
    const rowEntries = Object.entries(rows).sort((a, b) => b[1][0].transform[5] - a[1][0].transform[5]);
    for (const [, rowItems] of rowEntries) {
        if (foundPos) break;
        const rowStr = rowItems.map(i => i.str).join('');
        const rowClean = normalizeText(rowStr);

        if (namePattern.test(rowClean)) {
            // Localize the name to its own cell(s). A single item may contain
            // the whole name; PDF.js also often splits it ("이갑" + "종"), so
            // fall back to the shortest run of adjacent items whose text spans
            // the name. If neither works, skip this row rather than using the
            // whole-row bounding box (which throws the signature far off).
            const rowByX = [...rowItems].sort((a, b) => a.transform[4] - b.transform[4]);
            let targetItems: PDFTextItem[] = rowByX.filter(i => normalizeText(i.str).includes(cleanTarget));
            if (targetItems.length === 0) {
                for (let i = 0; i < rowByX.length && targetItems.length === 0; i++) {
                    let acc = '';
                    for (let j = i; j < rowByX.length && j < i + 4; j++) {
                        acc += normalizeText(rowByX[j].str);
                        if (acc.includes(cleanTarget)) {
                            const span = rowByX.slice(i, j + 1);
                            const spanW = Math.max(...span.map(s => s.transform[4] + (s.width || 0)))
                                - Math.min(...span.map(s => s.transform[4]));
                            if (spanW < 90) targetItems = span; // reject scattered false matches
                            break;
                        }
                    }
                }
            }
            if (targetItems.length === 0) continue;

            const minX = Math.min(...targetItems.map(i => i.transform[4]));
            const maxX = Math.max(...targetItems.map(i => i.transform[4] + (i.width || 0)));
            const w = maxX - minX;
            const nameCenter = (minX + maxX) / 2;
            const avgY = targetItems.reduce((acc, i) => acc + i.transform[5], 0) / targetItems.length;

            let sigWidth: number | undefined;
            const rowSorted = rowByX;

            // Fallback estimate when there is neither a signature cell nor a
            // header delta to anchor to (e.g. 회의록형: a row of "name | blank |
            // name | blank" where the blank is the signing cell). Estimate one
            // cell width from the spacing of the other names on the row and put
            // the signature one cell to the right of this name — consistent for
            // every name including the last one.
            let finalDelta: number;
            const ROW_LABELS = new Set(['참석자', '참석', '참여자', '출석자', '참석위원', '성명', '서명', '장소', '일시']);
            const nameStarts = Array.from(new Set(
                rowSorted
                    .filter(i => {
                        const s = normalizeText(i.str);
                        return s.length >= 2 && s.length <= 4 && /[가-힣]/.test(s) && !ROW_LABELS.has(s);
                    })
                    .map(i => Math.round(i.transform[4]))
            )).sort((a, b) => a - b);

            let cellW = 0;
            if (nameStarts.length >= 2) {
                const gaps = nameStarts.slice(1).map((x, k) => x - nameStarts[k]).filter(g => g > 8).sort((a, b) => a - b);
                if (gaps.length) cellW = gaps[Math.floor(gaps.length / 2)] / 2; // name+blank alternate
            }

            if (cellW > 10) {
                const signCenter = minX + cellW * 1.5; // centre of the cell after the name
                finalDelta = signCenter - nameCenter;
                sigWidth = cellW * 0.9;
            } else {
                // Couldn't read the row structure — modest push to the right.
                const nextCell = rowSorted.find(i => i.transform[4] > maxX + 2 && !targetItems.includes(i as any));
                if (nextCell) {
                    const gapEnd = Math.min(nextCell.transform[4] - 3, maxX + 95);
                    finalDelta = (maxX + gapEnd) / 2 - nameCenter;
                    sigWidth = Math.max(gapEnd - maxX, 28);
                } else {
                    finalDelta = Math.max(w, 20) + 34;
                }
            }

            if (headerDeltas.length > 0) {
                const bestH = headerDeltas.reduce((prev, curr) =>
                    Math.abs(curr.nameX - minX) < Math.abs(prev.nameX - minX) ? curr : prev
                );
                finalDelta = bestH.deltaX;
                sigWidth = undefined;
            }

            // Preferred: anchor to the actual signature cell immediately to the
            // right of the name on this row. This gives an exact horizontal
            // offset and a cell width, so the signature box lands inside the
            // real box instead of an oversized guessed area.
            const signItem = rowSorted.find(i =>
                SIGN_CELL_MARKERS.has(normalizeText(i.str)) && i.transform[4] > maxX - 5
            );
            if (signItem) {
                const signStart = signItem.transform[4];
                const signEnd = signStart + (signItem.width || 24);
                const rightNeighbor = rowSorted.find(i => i.transform[4] > signEnd + 1);
                // Signing area spans the whole empty region from the end of the
                // name to the cell's right border (not just the "서명" label half),
                // which matches the visible box a person signs in.
                const leftBorder = maxX;
                const rightBorder = rightNeighbor
                    ? (signEnd + rightNeighbor.transform[4]) / 2
                    : signEnd + 8; // last column: small pad, don't overshoot into empty space
                const cellCenter = (leftBorder + rightBorder) / 2;
                finalDelta = cellCenter - nameCenter;
                sigWidth = rightBorder - leftBorder;
            }

            foundPos = { x: minX, y: avgY, w: w, delta: finalDelta, sigWidth };
        }
    }

    return foundPos;
}
