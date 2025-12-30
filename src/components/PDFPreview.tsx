"use client";

import { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Attendee } from '@/lib/gas-service';
import { updateMeetingHash } from '@/lib/meeting-service';
import { useNotification } from '@/lib/NotificationContext';

interface Props {
    file: File;
    attendees: (Attendee & { id?: string; status: string; signatureUrl?: string })[];
    onConfirm?: () => void;
    meetingId?: string | null;
}

export default function PDFPreview({ file, attendees, onConfirm, meetingId }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [scale, setScale] = useState(1.0);
    const [rotation, setRotation] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const { showToast } = useNotification();

    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(-35);
    const [sigGlobalScale, setSigGlobalScale] = useState(1.0);

    const renderTaskRef = useRef<any>(null);

    const [showDebug, setShowDebug] = useState(false);

    // [Fix] Keyboard Shortcuts: Priority to Standalone Arrows
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

            if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                setShowDebug(prev => !prev);
            }

            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                if (isInput) return;
                e.preventDefault();
                const step = e.shiftKey ? 20 : (e.ctrlKey ? 5 : 1);

                if (e.key === 'ArrowRight') setOffsetX(p => p + step);
                if (e.key === 'ArrowLeft') setOffsetX(p => p - step);
                if (e.key === 'ArrowDown') setOffsetY(p => p + step);
                if (e.key === 'ArrowUp') setOffsetY(p => p - step);
            }

            if (e.code === 'Space' && !e.ctrlKey && !e.shiftKey && onConfirm) {
                if (!isInput) {
                    e.preventDefault();
                    onConfirm();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onConfirm]);

    const [nameCoordinates, setNameCoordinates] = useState<Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }>>({});
    const [headerCoords, setHeaderCoords] = useState<{ str: string, x: number, y: number, w: number, h: number, pageHeight: number }[]>([]);
    const [debugHeaderDeltas, setDebugHeaderDeltas] = useState<any[]>([]);
    const [rawTextItems, setRawTextItems] = useState<any[]>([]);
    const [displayScale, setDisplayScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const loadPdf = async () => {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const doc = await loadingTask.promise;
            setPdfDoc(doc);

            try {
                const page = await doc.getPage(1);
                const textContent = await page.getTextContent();
                const unscaledViewport = page.getViewport({ scale: 1.0 });

                // 2. Clear Sort & Merge
                const sortedItems = [...textContent.items].sort((a: any, b: any) => {
                    const ay = a.transform[5], by = b.transform[5];
                    if (Math.abs(ay - by) < 8) return a.transform[4] - b.transform[4];
                    return by - ay;
                });

                const mergedItems: any[] = [];
                let currentItem: any = null;
                sortedItems.forEach((item: any) => {
                    if (!currentItem) { currentItem = { ...item }; return; }
                    const prevY = currentItem.transform[5], currY = item.transform[5];
                    const prevRight = currentItem.transform[4] + (currentItem.width || 0);
                    if (Math.abs(prevY - currY) < 8 && (item.transform[4] - prevRight) < 120) {
                        currentItem.str += (currentItem.str.endsWith(' ') ? '' : ' ') + item.str;
                    } else {
                        mergedItems.push(currentItem);
                        currentItem = { ...item };
                    }
                });
                if (currentItem) mergedItems.push(currentItem);

                // Store raw items for debug
                setRawTextItems(mergedItems.filter((i: any) => {
                    const y = i.transform[5];
                    return y > 300 && y < 800; // Filter relevant band
                }));

                const coords: Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }> = {};
                const nameHeaders: any[] = [], signHeaders: any[] = [];
                const detectedHeaders: { str: string, x: number, y: number, w: number, h: number, pageHeight: number }[] = [];

                mergedItems.forEach((item: any) => {
                    const str = item.str.replace(/\s+/g, '');
                    const isNameHeader = ['교사명', '성명', '이름', '성명', '성 명', '교사', '성함', '성 명'].some(h => str.includes(h));
                    const isSignHeader = ['서명', '서명본', '(인)', '인장', '서명란', '서 명'].some(h => str.includes(h));

                    if (isNameHeader && !isSignHeader) {
                        nameHeaders.push(item);
                        detectedHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || item.transform[0] * 3, h: 20, pageHeight: unscaledViewport.height });
                    } else if (isSignHeader) {
                        signHeaders.push(item);
                        detectedHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width || item.transform[0] * 3, h: 20, pageHeight: unscaledViewport.height });
                    }
                });
                setHeaderCoords(detectedHeaders);

                const headerDeltas: any[] = [];
                nameHeaders.forEach(nh => {
                    const nx = nh.transform[4], ny = nh.transform[5], nw = nh.width || nh.transform[0] * 3;

                    // Find the most suitable sign header for the current name header
                    const sHeader = signHeaders
                        .filter(sh => Math.abs(sh.transform[5] - ny) < 20) // Roughly on the same line (Y-axis)
                        .filter(sh => sh.transform[4] > nx && sh.transform[4] < nx + 150) // To the right of name header, within 150px
                        .sort((a, b) => a.transform[4] - b.transform[4])[0]; // Pick the closest one to the right

                    if (sHeader) {
                        const sx = sHeader.transform[4], sw = sHeader.width || sHeader.transform[0] * 2;
                        const centerDelta = (sx + sw / 2) - (nx + nw / 2);
                        headerDeltas.push({
                            nameX: nx,
                            deltaPdf: centerDelta,
                            band: { yMin: ny - 700, yMax: ny + 50 }
                        });
                    }
                });
                setDebugHeaderDeltas(headerDeltas);

                mergedItems.forEach((item: any) => {
                    const str = item.str.trim();
                    if (str.length >= 2) {
                        const cleanStr = str.replace(/[^a-zA-Z0-9가-힣]/g, '');
                        const matchedAttendee = attendees.find(a => {
                            const cleanName = a.name.replace(/[^a-zA-Z0-9가-힣]/g, '');
                            return cleanStr === cleanName || cleanStr.includes(cleanName);
                        });

                        if (matchedAttendee) {
                            const tx = item.transform[4], ty = item.transform[5], tw = item.width || item.transform[0] * 2;
                            let bestDeltaPdf = 120; // Reduced fallback from 280

                            if (headerDeltas.length > 0) {
                                // Find the CLOSEST header in the same vertical band/column
                                const possibleHeaders = headerDeltas.filter(h =>
                                    Math.abs(h.nameX - tx) < 100 && ty > h.band.yMin && ty < h.band.yMax
                                );

                                if (possibleHeaders.length > 0) {
                                    const sameBandHeader = possibleHeaders.sort((a, b) => Math.abs(a.nameX - tx) - Math.abs(b.nameX - tx))[0];
                                    bestDeltaPdf = sameBandHeader.deltaPdf;
                                } else {
                                    // Fallback to closest header by X only
                                    const closestHeader = headerDeltas.reduce((prev, curr) =>
                                        Math.abs(curr.nameX - tx) < Math.abs(prev.nameX - tx) ? curr : prev,
                                        headerDeltas[0]
                                    );
                                    bestDeltaPdf = closestHeader.deltaPdf;
                                }
                            }
                            // Robust Logic: Always prefer the HIGHEST Y (Top of page)
                            // This handles duplicate names (e.g. Table Row vs Footer) regardless of sort order.
                            const existing = coords[matchedAttendee.name];
                            if (!existing || ty > existing.y) {
                                coords[matchedAttendee.name] = {
                                    x: tx,
                                    y: ty,
                                    w: tw,
                                    pageHeight: unscaledViewport.height,
                                    individualDeltaXPdf: bestDeltaPdf
                                };
                                console.log(`[${matchedAttendee.name}] Updated to Higher Y: ${ty.toFixed(1)}px (Was: ${existing?.y})`);
                            } else {
                                console.log(`[${matchedAttendee.name}] Ignored Lower Y: ${ty.toFixed(1)}px (Kept: ${existing.y})`);
                            }
                        }
                    }
                });
                console.log("📊 Intelligent Header Deltas:", headerDeltas);
                console.log("📍 Name Coordinates:", coords);
                setNameCoordinates(coords);

                setOffsetX(0);
                setOffsetY(0);

            } catch (e) {
                console.error("Auto-analysis failed", e);
            }
        };
        loadPdf();
    }, [file, attendees]);

    const [pageSize, setPageSize] = useState<{ width: number, height: number } | null>(null);

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const observer = new ResizeObserver(() => {
            if (canvas.width > 0) {
                setDisplayScale(canvas.clientWidth / canvas.width);
            }
        });
        observer.observe(canvas);

        const renderPage = async () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
                renderTaskRef.current = null;
            }

            try {
                const page = await pdfDoc.getPage(1);
                const desiredScale = 1.0;
                const scaledViewport = page.getViewport({ scale: desiredScale, rotation: (page.rotate + rotation) % 360 });
                setScale(desiredScale);

                // Update page size state
                setPageSize({ width: scaledViewport.width, height: scaledViewport.height });

                const context = canvas.getContext('2d');
                if (!context) return;

                canvas.height = scaledViewport.height;
                canvas.width = scaledViewport.width;

                const renderContext = {
                    canvasContext: context,
                    viewport: scaledViewport,
                };

                const task = page.render(renderContext);
                renderTaskRef.current = task;
                await task.promise;

                // Initial scale check
                setDisplayScale(canvas.clientWidth / canvas.width);
            } catch (error: any) {
                if (error.name !== 'RenderingCancelledException') {
                    console.error("Render error:", error);
                }
            }
        };

        renderPage();
        return () => {
            observer.disconnect();
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [pdfDoc, rotation]);

    const signedAttendees = attendees.filter(a => a.status === 'signed' && a.signatureUrl);
    const [positions, setPositions] = useState<Record<string, { x: number, y: number }>>({});
    const dragItem = useRef<{ id: string, startX: number, startY: number, initX: number, initY: number } | null>(null);

    const handleMouseDown = (e: React.MouseEvent, id: string, initX: number, initY: number) => {
        e.preventDefault();
        const currentPos = positions[id] || { x: initX, y: initY };
        dragItem.current = {
            id,
            startX: e.clientX,
            startY: e.clientY,
            initX: currentPos.x,
            initY: currentPos.y
        };
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!dragItem.current) return;
        const { id, startX, startY, initX, initY } = dragItem.current;
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        setPositions(prev => ({
            ...prev,
            [id]: { x: initX + deltaX, y: initY + deltaY }
        }));
    };

    const handleMouseUp = () => {
        dragItem.current = null;
    };

    const handleDownload = async () => {
        if (!file || signedAttendees.length === 0) {
            showToast("서명이 완료된 참가자가 없습니다.", "error");
            return;
        }

        setIsDownloading(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const page = pdfDoc.getPages()[0];
            const { height: pageHeight } = page.getSize();

            for (const attendee of signedAttendees) {
                if (!attendee.signatureUrl) continue;
                const uniqueId = attendee.id || attendee.phone || `temp-${attendee.name}`;
                if (!uniqueId) continue;

                const sigImageBytes = await fetch(attendee.signatureUrl).then(res => res.arrayBuffer());
                const sigImage = await pdfDoc.embedPng(sigImageBytes);

                const foundCoord = nameCoordinates[attendee.name];
                const getInitPos = () => {
                    if (foundCoord && scale) {
                        const canvasX = foundCoord.x * scale;
                        const canvasY = (foundCoord.pageHeight - foundCoord.y) * scale;
                        const canvasW = foundCoord.w * scale;

                        const nameCenter = canvasX + (canvasW / 2);
                        const signCenterDelta = (foundCoord.individualDeltaXPdf ?? 120) * scale;

                        const currentSigWidth = 110 * sigGlobalScale;
                        const canvasSigWidth = currentSigWidth * scale;

                        // X: move to sign column center
                        // Y: +10px to move slightly down from baseline to center in row
                        return {
                            x: nameCenter + signCenterDelta - (canvasSigWidth / 2) + offsetX,
                            y: canvasY + 10 + offsetY
                        };
                    }
                    const index = attendees.findIndex(a => a.name === attendee.name);
                    const cols = 4, col = index % cols, row = Math.floor(index / cols);
                    return { x: 50 + col * (140 + 10) + offsetX, y: 100 + row * (50 + 10) + offsetY };
                };

                const initPos = getInitPos();
                const pos = positions[uniqueId] || initPos;
                const pdfX = pos.x / scale;
                const pdfY = pageHeight - (pos.y / scale);

                // [Fix] Preserve Aspect Ratio (Standard is 3:1 for 600x200)
                const targetWidth = 110 * sigGlobalScale;
                const aspect = sigImage.height / sigImage.width;
                const targetHeight = targetWidth * aspect;

                page.drawImage(sigImage, {
                    x: pdfX,
                    y: pdfY - targetHeight,
                    width: targetWidth,
                    height: targetHeight,
                });
            }

            const pdfBytes = await pdfDoc.save();
            const hashBuffer = await crypto.subtle.digest('SHA-256', pdfBytes as any);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const documentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            if (meetingId) await updateMeetingHash(meetingId, documentHash);

            const blob = new Blob([pdfBytes as any], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Signed_${file.name}`;
            link.click();

        } catch (error) {
            console.error("Clean Save Failed:", error);
            showToast("PDF 생성에 실패했습니다.", "error");
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div
            style={{ position: 'relative', border: '1px solid #475569', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.8)', padding: '4px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155' }}>↔ X:</span>
                    <input type="number" value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} style={{ width: '45px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }} />
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155', marginLeft: '2px' }}>↕ Y:</span>
                    <input type="number" value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} style={{ width: '45px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }} />
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155', marginLeft: '2px' }}>🔍 Size:</span>
                    <input type="number" step="0.05" min="0.1" max="3" value={sigGlobalScale} onChange={(e) => setSigGlobalScale(Number(e.target.value))} style={{ width: '45px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }} />
                </div>
                <button onClick={() => setRotation(prev => (prev + 90) % 360)} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '4px' }}>↻ Rotate</button>
                <button onClick={() => setPositions({})} style={{ backgroundColor: 'rgba(59,130,246,0.8)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '4px' }}>↺ Reset</button>
                <button onClick={() => setShowDebug(!showDebug)} style={{ backgroundColor: showDebug ? '#ef4444' : 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '4px' }}>🐞 Debug</button>
            </div>

            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
                <button onClick={handleDownload} disabled={isDownloading} style={{ backgroundColor: isDownloading ? '#94a3b8' : '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.4rem 1rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', backdropFilter: 'blur(4px)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', alignItems: 'center', gap: '6px' }}>{isDownloading ? 'Processing...' : '💾 Save PDF'}</button>
            </div>

            <div style={{ position: 'relative', margin: '0 auto', width: 'fit-content' }}>
                <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />

                {/* Scaling Overlay Layer: All coordinate-based absolute items go here */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    transform: `scale(${displayScale})`,
                    transformOrigin: 'top left'
                }}>
                    {/* Header Labels (Blue) - Persistent as requested */}
                    {headerCoords.map((hc, i) => {
                        const x = hc.x * scale;
                        const y = (hc.pageHeight - hc.y) * scale;
                        return (
                            <div key={`header-${i}`} style={{ position: 'absolute', top: y, left: x, pointerEvents: 'none', zIndex: 40 }}>
                                <div style={{ position: 'absolute', bottom: '100%', left: 0, fontSize: '9px', backgroundColor: 'rgba(59,130,246,0.9)', color: 'white', padding: '1px 4px', borderRadius: '2px', whiteSpace: 'nowrap', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                    {hc.str} [X:{Math.round(hc.x)} Y:{Math.round(hc.y)}]
                                </div>
                                <div style={{ width: hc.w * scale, height: 15 * scale, border: '1px dashed rgba(59,130,246,0.5)' }} />
                            </div>
                        );
                    })}


                    {/* Helper to calculate Target Canvas Y from PDF Coord */}
                    {(() => {
                        // We define these helpers inline to access closure variables like scale, offsetY, etc.
                        // Ideally these should be outside, but this is a quick consistent fix.
                        return null;
                    })()}

                    {/* Attendee Name & Target Labels */}
                    {Object.entries(nameCoordinates).map(([name, coord]) => {
                        const x = coord.x * scale;
                        const y = (coord.pageHeight - coord.y) * scale;
                        const w = coord.w * scale;
                        const h = 20 * scale;

                        const BASE_W = 110;
                        const signX = (x + w / 2) + ((coord.individualDeltaXPdf || 120) * scale) - (BASE_W * sigGlobalScale * scale / 2) + offsetX;

                        // UNIFIED TARGET LOGIC (Target Canvas Top)
                        // This logic MUST match the logic used for 'initTop' below
                        const signY = ((coord.pageHeight - coord.y) * scale) - (7 * scale) + offsetY;

                        // Calculate visual center of the signature box in PDF coordinates
                        const sigBoxHeightPDF = (110 / 3) * sigGlobalScale;
                        // Reverse calculate PDF Top from Canvas SignY
                        // logic: signY = ((PageH - PDF_Top) * s) - 7s + off
                        // (signY - off + 7s) / s = PageH - PDF_Top
                        // PDF_Top = PageH - ((signY - off + 7s) / s)
                        // BUT: We want to match the previous logic which produced "464".
                        // Previous logic was: visualTopPDF = coord.pageHeight - ((signY - offsetY) / scale)
                        // This effectively ignores the 7s shift in the inverse calculation, 
                        // meaning the "Target Y" displayed is the Center Y of the box IF it were shifted up.
                        // Let's keep it exactly as it was to maintain "464":
                        const visualTopPDF = coord.pageHeight - ((signY - offsetY) / scale);
                        const centerYPDF = visualTopPDF - (sigBoxHeightPDF / 2);

                        return (
                            <div key={`coord-${name}`} style={{ position: 'absolute', pointerEvents: 'none', zIndex: 40 }}>
                                {/* Name Box (Red) */}
                                <div style={{
                                    position: 'absolute', top: y, left: x, width: w, height: h,
                                    border: '1px solid rgba(255, 0, 0, 0.4)', backgroundColor: 'rgba(255, 0, 0, 0.05)'
                                }}>
                                    <div style={{ position: 'absolute', bottom: '100%', left: 0, fontSize: '9px', backgroundColor: 'rgba(239,68,68,0.9)', color: 'white', padding: '1px 3px', borderRadius: '2px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                        {name} [X:{Math.round(coord.x)} Y:{Math.round(coord.y)}]
                                    </div>
                                </div>
                                {/* Sign Target (Green) */}
                                <div style={{
                                    position: 'absolute', top: signY, left: signX, width: 110 * sigGlobalScale * scale, height: (110 / 3) * sigGlobalScale * scale,
                                    border: '1px solid rgba(34, 197, 94, 0.4)', backgroundColor: 'rgba(34, 197, 94, 0.05)'
                                }}>
                                    <div style={{ position: 'absolute', bottom: '100%', left: 0, fontSize: '9px', backgroundColor: 'rgba(34,197,94,0.9)', color: 'white', padding: '1px 3px', borderRadius: '2px', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
                                        Target [Δ:{coord.individualDeltaXPdf?.toFixed(0)} Y:{Math.round(centerYPDF)}]
                                    </div>
                                </div>
                                {/* Connecting Line */}
                                {showDebug && (
                                    <svg style={{ position: 'absolute', top: 0, left: 0, width: '2000px', height: '2000px', pointerEvents: 'none' }}>
                                        <line x1={x + w / 2} y1={y + h / 2} x2={signX + (55 * sigGlobalScale * scale)} y2={signY + (18 * sigGlobalScale * scale)} stroke="rgba(0,0,255,0.4)" strokeWidth="1" strokeDasharray="4" />
                                    </svg>
                                )}
                            </div>
                        );
                    })}

                    {/* Signed Attendees overlay layer */}
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}>
                        {signedAttendees.map((attendee, index) => {
                            const uniqueId = attendee.id || index.toString();
                            const boxWidth = 110, gap = 10;
                            const cols = 4, col = index % cols, row = Math.floor(index / cols);
                            let initLeft = 50 + col * (boxWidth + gap) + offsetX;
                            let initTop = 100 + row * (50 + gap) + offsetY;

                            // Normalize names for matching
                            const foundCoord = Object.entries(nameCoordinates).find(([name]) =>
                                name.replace(/[^a-zA-Z0-9가-힣]/g, '') === attendee.name.replace(/[^a-zA-Z0-9가-힣]/g, '')
                            )?.[1];

                            if (foundCoord && scale) {
                                const canvasX = foundCoord.x * scale;
                                const canvasW = foundCoord.w * scale;

                                const nameCenter = canvasX + canvasW / 2;
                                const signCenterDelta = (foundCoord.individualDeltaXPdf ?? 120) * scale;

                                const currentSigWidth = 110 * sigGlobalScale;
                                const canvasSigWidth = currentSigWidth * scale;

                                initLeft = nameCenter + signCenterDelta - (canvasSigWidth / 2) + offsetX;

                                // UNIFIED TARGET LOGIC (Must match 'signY')
                                // canvasY would be ((foundCoord.pageHeight - foundCoord.y) * scale)
                                initTop = ((foundCoord.pageHeight - foundCoord.y) * scale) - (7 * scale) + offsetY;
                            }

                            const pos = positions[uniqueId] || { x: initLeft, y: initTop };

                            return (
                                <div
                                    key={uniqueId}
                                    onMouseDown={(e) => handleMouseDown(e, uniqueId, initLeft, initTop)}
                                    style={{
                                        position: 'absolute',
                                        top: `${pos.y}px`,
                                        left: `${pos.x}px`,
                                        width: `${110 * sigGlobalScale * scale}px`,
                                        height: `${(110 / 3) * sigGlobalScale * scale}px`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'move',
                                        userSelect: 'none',
                                        zIndex: 50,
                                        pointerEvents: 'auto'
                                    }}
                                >
                                    <div style={{ border: '2px solid transparent', borderRadius: '4px', transition: 'border 0.2s', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(59, 130, 246, 0.5)'} onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = 'transparent'}>
                                        <img src={attendee.signatureUrl} alt="Signature" style={{ maxWidth: '100%', maxHeight: '100%', mixBlendMode: 'multiply', pointerEvents: 'none' }} />
                                    </div>
                                    <div style={{ position: 'absolute', top: -22, left: 0, fontSize: '11px', fontWeight: 'bold', backgroundColor: '#fef08a', color: '#1e293b', padding: '2px 6px', borderRadius: '4px', border: '1px solid #eab308', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', zIndex: 99999, minWidth: 'max-content' }}>
                                        {attendee.name}
                                        <span style={{
                                            color: 'white',
                                            backgroundColor: '#ef4444',
                                            marginLeft: '6px',
                                            padding: '1px 4px',
                                            borderRadius: '3px',
                                            fontSize: '10px'
                                        }}>
                                            {foundCoord ? (
                                                (() => {
                                                    // Unified Display Logic: Should match centerYPDF of Target
                                                    const pHeight = foundCoord.pageHeight || 842;
                                                    // Use EXACT formula from Target Box to calculate display Y
                                                    // visualTopPDF = pageHI - ((signY - off)/s)
                                                    const visTop = pHeight - ((pos.y - offsetY) / scale);
                                                    const heightPDF = (110 / 3) * (sigGlobalScale || 1);
                                                    const cY = visTop - (heightPDF / 2);
                                                    return `X:${Math.round((pos.x - offsetX + (110 * (sigGlobalScale || 1) * scale / 2)) / scale)} Y:${Math.round(cY)}`;
                                                })()
                                            ) : (
                                                'Coord N/A'
                                            )}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* DEBUG PANEL for Data Inspection */}
            {showDebug && (
                <div style={{ padding: '10px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '10px', fontFamily: 'monospace', maxHeight: '200px', overflowY: 'auto', position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000, backgroundColor: 'white' }}>
                    <strong>Name Coordinates Dump (v0.3.85):</strong><br />
                    {Object.entries(nameCoordinates).map(([key, val]) => (
                        <div key={key}>
                            "{key}" : Y={Math.round(val.y)} (Raw) | Norm: "{key.replace(/[^a-zA-Z0-9가-힣]/g, '')}"
                        </div>
                    ))}
                    <hr style={{ margin: '5px 0' }} />
                    <strong>Signature Bindings:</strong><br />
                    {signedAttendees.map(a => {
                        const normName = a.name.replace(/[^a-zA-Z0-9가-힣]/g, '');
                        const entry = Object.entries(nameCoordinates).find(([name]) =>
                            name.replace(/[^a-zA-Z0-9가-힣]/g, '') === normName
                        );
                        return (
                            <div key={a.id}>
                                User "{a.name}" (Norm: "{normName}") &rarr; Matched: {entry ? `"${entry[0]}" (Y=${Math.round(entry[1].y)})` : "NONE"}
                            </div>
                    <hr style={{ margin: '5px 0' }} />
                    <strong>Raw Text (Y:300-800) [v0.3.86]:</strong><br />
                    {
                            rawTextItems.map((item, idx) => (
                                <div key={idx} style={{ color: '#64748b' }}>
                                    Y={Math.round(item.transform[5])} | "{item.str}"
                                </div>
                            ))
                        }
                </div>
            )}


            <style jsx>{`
                @keyframes popIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
