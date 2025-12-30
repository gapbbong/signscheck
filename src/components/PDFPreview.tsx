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

    const [nameCoordinates, setNameCoordinates] = useState<Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }>>({});
    const [headerCoords, setHeaderCoords] = useState<{ str: string, x: number, y: number, w: number, h: number, pageHeight: number }[]>([]);
    const [displayScale, setDisplayScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    // Keyboard Shortcuts: Space to Confirm, Arrows to Adjust
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

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

                const sortedItems = [...textContent.items].sort((a: any, b: any) => {
                    const ay = a.transform[5], by = b.transform[5];
                    if (Math.abs(ay - by) < 8) return a.transform[4] - b.transform[4];
                    return by - ay;
                });

                const getImgWidth = (item: any) => {
                    if (item.width && item.width > 0) return item.width;
                    const fontSize = Math.abs(item.transform[0]);
                    const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(item.str);
                    // Korean characters are wider (square). Use 1.1x factor for safer centering.
                    return fontSize * (item.str.trim().length || 1) * (hasKorean ? 1.1 : 0.6);
                };

                const mergedItems: any[] = [];
                let currentItem: any = null;
                sortedItems.forEach((item: any) => {
                    if (!currentItem) { currentItem = { ...item }; return; }
                    const prevY = currentItem.transform[5], currY = item.transform[5];
                    const prevRight = currentItem.transform[4] + getImgWidth(currentItem);
                    if (Math.abs(prevY - currY) < 8 && (item.transform[4] - prevRight) < 120) {
                        const oldX = currentItem.transform[4];
                        currentItem.str += (currentItem.str.endsWith(' ') ? '' : ' ') + item.str;
                        const newRight = item.transform[4] + getImgWidth(item);
                        currentItem.width = newRight - oldX;
                    } else {
                        mergedItems.push(currentItem);
                        currentItem = { ...item };
                    }
                });
                if (currentItem) mergedItems.push(currentItem);

                const coords: Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }> = {};
                const nameHeaders: any[] = [], signHeaders: any[] = [];
                const detectedHeaders: { str: string, x: number, y: number, w: number, h: number, pageHeight: number }[] = [];

                mergedItems.forEach((item: any) => {
                    const str = item.str.replace(/\s+/g, '');
                    const isNameHeader = ['교사명', '성명', '이름', '교사', '성함', '성 명'].some(h => str.includes(h));
                    const isSignHeader = ['서명', '서명본', '(인)', '인장', '서명란', '서 명'].some(h => str.includes(h));

                    if (isNameHeader && !isSignHeader) {
                        nameHeaders.push(item);
                        detectedHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: getImgWidth(item), h: 20, pageHeight: unscaledViewport.height });
                    } else if (isSignHeader) {
                        signHeaders.push(item);
                        detectedHeaders.push({ str: item.str, x: item.transform[4], y: item.transform[5], w: getImgWidth(item), h: 20, pageHeight: unscaledViewport.height });
                    }
                });
                setHeaderCoords(detectedHeaders);

                const headerDeltas: any[] = [];
                nameHeaders.forEach(nh => {
                    const nx = nh.transform[4], ny = nh.transform[5];
                    const sHeader = signHeaders
                        .filter(sh => Math.abs(sh.transform[5] - ny) < 20)
                        .filter(sh => sh.transform[4] > nx && sh.transform[4] < nx + 300)
                        .sort((a, b) => a.transform[4] - b.transform[4])[0];

                    if (sHeader) {
                        const nw = getImgWidth(nh);
                        const sx = sHeader.transform[4], sw = getImgWidth(sHeader);

                        // Center-to-Center delta
                        const nameCenter = nx + (nw / 2);
                        const signCenter = sx + (sw / 2);
                        const centerDelta = signCenter - nameCenter;

                        headerDeltas.push({
                            nameX: nx,
                            deltaPdf: centerDelta,
                            band: { yMin: ny - 700, yMax: ny + 50 }
                        });
                    }
                });

                mergedItems.forEach((item: any) => {
                    const str = item.str.trim();
                    if (str.length >= 2) {
                        const cleanStr = str.replace(/[^a-zA-Z0-9가-힣]/g, '');
                        const matchedAttendee = attendees.find(a => {
                            const cleanName = a.name.replace(/[^a-zA-Z0-9가-힣]/g, '');
                            return cleanStr === cleanName || cleanStr.includes(cleanName);
                        });

                        if (matchedAttendee) {
                            const tx = item.transform[4], ty = item.transform[5], tw = getImgWidth(item);
                            let bestDeltaPdf = 140; // Unified fallback to 140 for v0.4.2
                            if (headerDeltas.length > 0) {
                                const possibleHeaders = headerDeltas.filter(h =>
                                    Math.abs(h.nameX - tx) < 100 && ty > h.band.yMin && ty < h.band.yMax
                                );
                                if (possibleHeaders.length > 0) {
                                    bestDeltaPdf = possibleHeaders.sort((a, b) => Math.abs(a.nameX - tx) - Math.abs(b.nameX - tx))[0].deltaPdf;
                                } else {
                                    bestDeltaPdf = headerDeltas.reduce((prev, curr) =>
                                        Math.abs(curr.nameX - tx) < Math.abs(prev.nameX - tx) ? curr : prev,
                                        headerDeltas[0]
                                    ).deltaPdf;
                                }
                            }
                            coords[matchedAttendee.name] = { x: tx, y: ty, w: tw, pageHeight: unscaledViewport.height, individualDeltaXPdf: bestDeltaPdf };
                        }
                    }
                });

                // --- ROW GROUPING SEARCH ---
                const rows: Record<number, any[]> = {};
                sortedItems.forEach((item: any) => {
                    const y = item.transform[5];
                    const yKey = Math.round(y / 12) * 12;
                    if (!rows[yKey]) rows[yKey] = [];
                    rows[yKey].push(item);
                });

                attendees.forEach(att => {
                    const cleanName = att.name.replace(/[^a-zA-Z0-9가-힣]/g, '');
                    if (cleanName.length < 2) return;
                    Object.entries(rows).forEach(([yKeyStr, rowItems]) => {
                        const rowStrRaw = rowItems.sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join('');
                        const rowStrClean = rowStrRaw.replace(/[^a-zA-Z0-9가-힣]/g, '');
                        if (rowStrClean.includes(cleanName)) {
                            const avgY = rowItems.reduce((acc, i) => acc + i.transform[5], 0) / rowItems.length;
                            const nameChars = cleanName.split('');
                            const relevantItems = rowItems.filter(i => nameChars.some(c => i.str.includes(c)));
                            if (relevantItems.length > 0) {
                                const minX = Math.min(...relevantItems.map(i => i.transform[4]));
<<<<<<< HEAD
                                const maxX = Math.max(...relevantItems.map(i => i.transform[4] + (i.width || 0)));
                                const w = maxX - minX;

                                // Header Delta Logic
                                // Find closest header column by X-coordinate
                                let phDeltaPdf = 120;
                                if (headerDeltas.length > 0) {
                                    let bestHeader = headerDeltas[0];
                                    let minDist = Math.abs(headerDeltas[0].nameX - minX);

                                    for (let i = 1; i < headerDeltas.length; i++) {
                                        const dist = Math.abs(headerDeltas[i].nameX - minX);
                                        if (dist < minDist) {
                                            minDist = dist;
                                            bestHeader = headerDeltas[i];
                                        }
                                    }
                                    phDeltaPdf = bestHeader.deltaPdf;
=======
                                const maxX = Math.max(...relevantItems.map(i => i.transform[4] + getImgWidth(i)));
                                let phDeltaPdf = 140; // Unified fallback
                                if (headerDeltas.length > 0) {
                                    const headers = headerDeltas.filter(h => Math.abs(h.nameX - minX) < 100 && avgY > h.band.yMin && avgY < h.band.yMax);
                                    phDeltaPdf = headers.length > 0 ? headers[0].deltaPdf : headerDeltas[0].deltaPdf;
>>>>>>> bc0b6ae7d3c89d2a1e2f7b0fa3cfa6f349984dde
                                }
                                if (!coords[att.name] || avgY > coords[att.name].y) {
                                    coords[att.name] = { x: minX, y: avgY, w: maxX - minX, pageHeight: unscaledViewport.height, individualDeltaXPdf: phDeltaPdf };
                                }
                            }
                        }
                    });
                });

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
                        const signTargetCenter = nameCenter + (foundCoord.individualDeltaXPdf ?? 140) * scale;

                        const canvasSigWidth = 110 * sigGlobalScale * scale;
                        const sigBoxHeight = (110 / 3) * sigGlobalScale * scale;

                        // Horizontal Center alignment: align signature center with signTargetCenter
                        return {
                            x: signTargetCenter - (canvasSigWidth / 2) + offsetX,
                            y: canvasY - (sigBoxHeight / 2) + offsetY
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
            </div>

            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
                <button onClick={handleDownload} disabled={isDownloading} style={{ backgroundColor: isDownloading ? '#94a3b8' : '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.4rem 1rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', backdropFilter: 'blur(4px)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', alignItems: 'center', gap: '6px' }}>{isDownloading ? 'Processing...' : '💾 Save PDF'}</button>
            </div>

            <div style={{ position: 'relative', margin: '0 auto', width: 'fit-content' }}>
                <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />

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
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'auto' }}>
                        {signedAttendees.map((attendee, index) => {
                            const uniqueId = attendee.id || index.toString();
                            const boxWidth = 110, gap = 10;
                            const cols = 4, col = index % cols, row = Math.floor(index / cols);
                            let initLeft = 50 + col * (boxWidth + gap) + offsetX;
                            let initTop = 100 + row * (50 + gap) + offsetY;

                            const foundCoord = Object.entries(nameCoordinates).find(([name]) =>
                                name.replace(/[^a-zA-Z0-9가-힣]/g, '') === attendee.name.replace(/[^a-zA-Z0-9가-힣]/g, '')
                            )?.[1];

                            if (foundCoord && scale) {
                                const canvasX = foundCoord.x * scale;
                                const canvasW = foundCoord.w * scale;
                                const sigBoxHeight = (110 / 3) * sigGlobalScale * scale;
                                const canvasSigWidth = 110 * sigGlobalScale * scale;

                                const nameCenter = canvasX + (canvasW / 2);
                                const signTargetCenter = nameCenter + (foundCoord.individualDeltaXPdf ?? 140) * scale;

                                // UI Overlay: Horizontal Center Alignment
                                initLeft = signTargetCenter - (canvasSigWidth / 2) + offsetX;
                                initTop = ((foundCoord.pageHeight - foundCoord.y) * scale) - (sigBoxHeight / 2) + offsetY;
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
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

<<<<<<< HEAD
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
                        );
                    })}
                    <hr style={{ margin: '5px 0' }} />
                    <strong>Raw Text (Y:300-800) [v0.3.92 Row]:</strong><br />
                    {
                        rawTextItems.map((item, idx) => (
                            <div key={idx} style={{ color: '#64748b' }}>
                                Y={Math.round(item.transform[5])} | "{item.str}"
                            </div>
                        ))
                    }
                </div>
            )}


=======
>>>>>>> bc0b6ae7d3c89d2a1e2f7b0fa3cfa6f349984dde
            <style jsx>{`
                @keyframes popIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
