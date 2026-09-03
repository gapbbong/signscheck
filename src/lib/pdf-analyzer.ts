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

// 2D affine matrix helpers ([a,b,c,d,e,f], same layout as PDF/pdf.js).
const matMul = (m: number[], n: number[]): number[] => [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
];
const matApply = (m: number[], x: number, y: number): [number, number] =>
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export interface OpsConst {
    save: number; restore: number; transform: number;
    constructPath: number; moveTo: number; lineTo: number;
    curveTo: number; rectangle: number; closePath: number;
}

/**
 * Pull the X positions of vertical ruling lines (table column borders) out of a
 * page's operator list. Coordinates come back in the same user space as
 * getTextContent item transforms, so a name's X can be bracketed by two borders
 * to get its exact cell. Returns sorted, de-duplicated X values.
 *
 * Best-effort: any parsing hiccup yields [] and callers fall back to spacing
 * heuristics.
 */
export interface ColumnRule { x: number; y0: number; y1: number; }

export function extractColumnRules(
    fnArray: number[],
    argsArray: any[],
    OPS: OpsConst,
    minSpan = 8,
    pageWidth = 700,
): ColumnRule[] {
    try {
        const rules: ColumnRule[] = [];
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack: number[][] = [];

        const edge = (x: number, y0: number, y1: number) => {
            const [ax, ay0] = matApply(ctm, x, y0);
            const [, ay1] = matApply(ctm, x, y1);
            if (Math.abs(ay0 - ay1) >= minSpan) rules.push({ x: ax, y0: Math.min(ay0, ay1), y1: Math.max(ay0, ay1) });
        };
        const seg = (x1: number, y1: number, x2: number, y2: number) => {
            const [ax, ay] = matApply(ctm, x1, y1);
            const [bx, by] = matApply(ctm, x2, y2);
            if (Math.abs(ax - bx) <= 1.5 && Math.abs(ay - by) >= minSpan) {
                rules.push({ x: (ax + bx) / 2, y0: Math.min(ay, by), y1: Math.max(ay, by) });
            }
        };

        for (let i = 0; i < fnArray.length; i++) {
            const fn = fnArray[i];
            const args = argsArray[i];
            if (fn === OPS.save) stack.push(ctm.slice());
            else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop()!; }
            else if (fn === OPS.transform) ctm = matMul(ctm, args as number[]);
            else if (fn === OPS.constructPath) {
                // pdf.js ≥ v4: args = [flags, [packedCoords], bbox(len 4)].
                // The bbox already bounds the sub-path — for the axis-aligned
                // cell rectangles these table PDFs draw, its left/right edges
                // are exactly the column borders.
                const bbox = args?.[2];
                if (bbox && bbox.length === 4) {
                    const [x0, y0, x1, y1] = bbox;
                    const wide = Math.abs(x1 - x0) > pageWidth * 0.7;
                    if (!wide && Math.abs(y1 - y0) >= minSpan) {
                        edge(x0, y0, y1);
                        edge(x1, y0, y1);
                    }
                } else if (Array.isArray(args?.[0])) {
                    // Older shape: [opsArray, coordsArray].
                    const subOps: number[] = args[0];
                    const coords: number[] = Array.from(args[1] ?? []);
                    let ci = 0, cx = 0, cy = 0, sx = 0, sy = 0;
                    for (const op of subOps) {
                        if (op === OPS.moveTo) { cx = coords[ci++]; cy = coords[ci++]; sx = cx; sy = cy; }
                        else if (op === OPS.lineTo) { const nx = coords[ci++], ny = coords[ci++]; seg(cx, cy, nx, ny); cx = nx; cy = ny; }
                        else if (op === OPS.curveTo) { ci += 4; cx = coords[ci++]; cy = coords[ci++]; }
                        else if (op === OPS.rectangle) {
                            const x = coords[ci++], y = coords[ci++], rw = coords[ci++], rh = coords[ci++];
                            seg(x, y, x, y + rh); seg(x + rw, y, x + rw, y + rh);
                            cx = x; cy = y; sx = x; sy = y;
                        } else if (op === OPS.closePath) { seg(cx, cy, sx, sy); cx = sx; cy = sy; }
                    }
                }
            }
        }

        return rules;
    } catch {
        return [];
    }
}

/** Column border X positions crossing row `y`, sorted & de-duplicated. */
export function bordersAtY(rules: ColumnRule[], y: number, slack = 4): number[] {
    const xs = rules
        .filter(r => r.y0 - slack <= y && r.y1 + slack >= y)
        .map(r => r.x)
        .sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of xs) if (!out.length || x - out[out.length - 1] > 3) out.push(x);
    return out;
}

/**
 * Given a name's X extent and the row's column borders, return the signing
 * cell (the cell immediately right of the name's cell) as centre + width.
 * Returns null when the borders don't sensibly bracket the name.
 */
export function signingCellFromBorders(
    nameMinX: number,
    nameMaxX: number,
    borders: number[],
): { center: number; width: number } | null {
    if (borders.length < 3) return null;
    const slack = 6;
    // name cell: last border at/left of the name start, first border at/right of the name end
    const left = [...borders].reverse().find(b => b <= nameMinX + slack);
    const rightIdx = borders.findIndex(b => b >= nameMaxX - slack);
    if (left === undefined || rightIdx === -1) return null;
    const right = borders[rightIdx];
    if (right - left < 8 || right - left > 400) return null; // not a real cell
    const nextRight = borders[rightIdx + 1];
    if (nextRight === undefined) return null; // name is in the last column — no cell to its right
    const w = nextRight - right;
    if (w < 8 || w > 400) return null;
    return { center: (right + nextRight) / 2, width: w };
}

/**
 * Finds the position of a specific name within grouped rows
 */
export function findNamePosition(
    targetName: string,
    rows: Record<number, PDFTextItem[]>,
    headerDeltas: HeaderDelta[],
    columnRules: ColumnRule[] = [],
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

            let finalDelta: number;

            // Best: the real table borders on this row. Bracket the name
            // between two column rules and put the signature in the exact next
            // cell.
            const cellFromBorders = signingCellFromBorders(minX, maxX, bordersAtY(columnRules, avgY));

            if (cellFromBorders) {
                finalDelta = cellFromBorders.center - nameCenter;
                sigWidth = cellFromBorders.width * 0.94;
            } else {
                // No borders — estimate one cell width from the LOCAL spacing of
                // this name to its row neighbours (handles non-uniform columns
                // better than a single row-wide average). Layout assumed:
                // "name | blank | name | blank …", blank = signing cell.
                const ROW_LABELS = new Set(['참석자', '참석', '참여자', '출석자', '참석위원', '성명', '서명', '장소', '일시']);
                const nameXs = Array.from(new Set(
                    rowSorted
                        .filter(i => {
                            const s = normalizeText(i.str);
                            return s.length >= 2 && s.length <= 4 && /[가-힣]/.test(s) && !ROW_LABELS.has(s);
                        })
                        .map(i => Math.round(i.transform[4]))
                )).sort((a, b) => a - b);

                const selfIdx = nameXs.findIndex(x => Math.abs(x - minX) <= 3);
                const rightGap = selfIdx >= 0 && nameXs[selfIdx + 1] !== undefined ? nameXs[selfIdx + 1] - nameXs[selfIdx] : 0;
                const leftGap = selfIdx > 0 ? nameXs[selfIdx] - nameXs[selfIdx - 1] : 0;
                const pairGap = rightGap || leftGap; // distance between adjacent names ≈ 2 cells
                const cellW = pairGap ? pairGap / 2 : 0;

                if (cellW > 10) {
                    finalDelta = (minX + cellW * 1.5) - nameCenter; // centre of the cell after the name
                    sigWidth = cellW * 0.9;
                } else {
                    const nextCell = rowSorted.find(i => i.transform[4] > maxX + 2 && !targetItems.includes(i as any));
                    if (nextCell) {
                        const gapEnd = Math.min(nextCell.transform[4] - 3, maxX + 95);
                        finalDelta = (maxX + gapEnd) / 2 - nameCenter;
                        sigWidth = Math.max(gapEnd - maxX, 28);
                    } else {
                        finalDelta = Math.max(w, 20) + 34;
                    }
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
