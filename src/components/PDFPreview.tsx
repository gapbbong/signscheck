"use client";

import { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Attendee } from '@/lib/gas-service';
import { updateMeetingHash } from '@/lib/meeting-service';
import { useNotification } from '@/lib/NotificationContext';

interface Props {
    file: File;
    attendees: (Attendee & { id?: string; status: string; signatureUrl?: string; ip?: string; deviceInfo?: string; userAgent?: string })[];
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
    const [headerCoords, setHeaderCoords] = useState<{ str: string, x: number, y: number, w: number, h: number, pageHeight: number, type: 'name' | 'sign' }[]>([]);
    const [displayScale, setDisplayScale] = useState(1);
    const containerRef = useRef<HTMLDivElement>(null);

    const [showDebug, setShowDebug] = useState(false);
    const [rawTextItems, setRawTextItems] = useState<any[]>([]);

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

            if (e.key.toLowerCase() === 'd' && !isInput) {
                setShowDebug(prev => !prev);
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

                const rawItems = textContent.items as any[];
                setRawTextItems(rawItems.filter(i => i.transform[5] > 300 && i.transform[5] < 800));

                const sortedItems = [...rawItems].sort((a: any, b: any) => {
                    const ay = a.transform[5], by = b.transform[5];
                    if (Math.abs(ay - by) < 8) return a.transform[4] - b.transform[4];
                    return by - ay;
                });

                const getImgWidth = (item: any) => {
                    if (item.width && item.width > 0) return item.width;
                    const fontSize = Math.abs(item.transform[0]);
                    const hasKorean = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(item.str);
                    return fontSize * (item.str.trim().length || 1) * (hasKorean ? 1.1 : 0.6);
                };

                const mergedItems: any[] = [];
                let currentItem: any = null;
                sortedItems.forEach((item: any) => {
                    if (!currentItem) { currentItem = { ...item }; return; }
                    const prevY = currentItem.transform[5], currY = item.transform[5];
                    const prevRight = currentItem.transform[4] + getImgWidth(currentItem);
                    if (Math.abs(prevY - currY) < 5 && (item.transform[4] - prevRight) < 15) {
                        const oldX = currentItem.transform[4];
                        currentItem.str += item.str;
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
                const allScannerHeaders: { str: string, x: number, y: number, w: number, h: number, pageHeight: number, type: 'name' | 'sign' }[] = [];

                const nameKeywords = ['교사명', '성명', '이름', '교사', '성함', '성 명'];
                const signKeywords = ['서명', '서명본', '(인)', '인장', '서명란', '서 명'];

                mergedItems.forEach((item: any) => {
                    const str = item.str;
                    const itemW = getImgWidth(item);

                    // Scanner: find all sub-positions
                    nameKeywords.forEach(kw => {
                        let pos = str.indexOf(kw);
                        while (pos !== -1) {
                            const charFactor = pos / (str.length || 1);
                            const nx = item.transform[4] + (itemW * charFactor);
                            const nw = (itemW / (str.length || 1)) * kw.length;
                            const hObj = { str: kw, x: nx, y: item.transform[5], w: nw, h: 20, pageHeight: unscaledViewport.height, type: 'name' as const };
                            allScannerHeaders.push(hObj);
                            nameHeaders.push({ ...hObj, transform: [0, 0, 0, 0, nx, item.transform[5]] });
                            pos = str.indexOf(kw, pos + 1);
                        }
                    });

                    signKeywords.forEach(kw => {
                        let pos = str.indexOf(kw);
                        while (pos !== -1) {
                            const charFactor = pos / (str.length || 1);
                            const sx = item.transform[4] + (itemW * charFactor);
                            const sw = (itemW / (str.length || 1)) * kw.length;
                            const hObj = { str: kw, x: sx, y: item.transform[5], w: sw, h: 20, pageHeight: unscaledViewport.height, type: 'sign' as const };
                            allScannerHeaders.push(hObj);
                            signHeaders.push({ ...hObj, transform: [0, 0, 0, 0, sx, item.transform[5]], width: sw });
                            pos = str.indexOf(kw, pos + 1);
                        }
                    });
                });
                setHeaderCoords(allScannerHeaders);

                const headerDeltas: any[] = [];
                nameHeaders.forEach(nh => {
                    const nx = nh.x, ny = nh.y;
                    const sHeader = signHeaders
                        .filter(sh => Math.abs(sh.y - ny) < 20)
                        .filter(sh => sh.x > nx && sh.x < nx + 400)
                        .sort((a, b) => a.x - b.x)[0];

                    if (sHeader) {
                        const signCenter = sHeader.x + (sHeader.w / 2);
                        headerDeltas.push({
                            nameX: nx,
                            signCenterX: signCenter,
                            band: { yMin: ny - 700, yMax: ny + 50 }
                        });
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
                        rowItems.sort((a, b) => a.transform[4] - b.transform[4]);
                        const rowStrFull = rowItems.map(i => i.str).join('');
                        const rowStrClean = rowStrFull.replace(/[^a-zA-Z0-9가-힣]/g, '');

                        if (rowStrClean.includes(cleanName)) {
                            const avgY = rowItems.reduce((acc, i) => acc + i.transform[5], 0) / rowItems.length;
                            let bestRange: any[] = [];
                            let minRangeWidth = Infinity;

                            for (let start = 0; start < rowItems.length; start++) {
                                let currentStr = "";
                                for (let end = start; end < rowItems.length; end++) {
                                    currentStr += rowItems[end].str.replace(/[^a-zA-Z0-9가-힣]/g, '');
                                    if (currentStr.includes(cleanName)) {
                                        const range = rowItems.slice(start, end + 1);
                                        const rMinX = Math.min(...range.map(r => r.transform[4]));
                                        const rMaxX = Math.max(...range.map(r => r.transform[4] + getImgWidth(r)));
                                        const rWidth = rMaxX - rMinX;
                                        if (rWidth < minRangeWidth) {
                                            minRangeWidth = rWidth;
                                            bestRange = range;
                                        }
                                        break;
                                    }
                                }
                            }

                            if (bestRange.length > 0) {
                                const minX = Math.min(...bestRange.map(i => i.transform[4]));
                                const maxX = Math.max(...bestRange.map(i => i.transform[4] + getImgWidth(i)));
                                const w = maxX - minX;

                                let phDeltaPdf = 140;
                                if (headerDeltas.length > 0) {
                                    // Robust Column Matching: Find header closest to name's X
                                    let bestHeader = headerDeltas.reduce((prev, curr) =>
                                        Math.abs(curr.nameX - minX) < Math.abs(prev.nameX - minX) ? curr : prev,
                                        headerDeltas[0]
                                    );
                                    // phDeltaPdf is how much to add to the name's center to get signature center
                                    phDeltaPdf = bestHeader.signCenterX - (minX + w / 2);
                                }

                                if (!coords[att.name] || avgY > coords[att.name].y) {
                                    coords[att.name] = { x: minX, y: avgY, w: w, pageHeight: unscaledViewport.height, individualDeltaXPdf: phDeltaPdf };
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
            const includeMetadata = window.confirm("서명 부가정보(장치, IP, 일시)를 서명 아래에 함께 출력하시겠습니까?");

            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const page = pdfDoc.getPages()[0];
            const { height: pageHeight } = page.getSize();

            const pdfjsLib = await import('pdfjs-dist');
            const font = await pdfDoc.embedFont('Helvetica'); // Metadata font

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

                        const canvasSigWidth = 80 * sigGlobalScale * scale;
                        const sigBoxHeight = (80 / 3) * sigGlobalScale * scale;

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

                const boxWidth = 80 * sigGlobalScale;
                const boxHeight = (80 / 3) * sigGlobalScale;

                const imgW = sigImage.width;
                const imgH = sigImage.height;
                const scaleFactor = Math.min(boxWidth / imgW, boxHeight / imgH);

                const targetWidth = imgW * scaleFactor;
                const targetHeight = imgH * scaleFactor;

                // Center the image within the virtual box (boxWidth x boxHeight)
                const centeredX = pdfX + (boxWidth - targetWidth) / 2;
                const centeredY = (pdfY - boxHeight) + (boxHeight - targetHeight) / 2;

                page.drawImage(sigImage, {
                    x: centeredX,
                    y: centeredY,
                    width: targetWidth,
                    height: targetHeight,
                });

                // Optional Metadata Drawing
                if (includeMetadata) {
                    const ipPart = attendee.ip || "unknown IP";
                    const devicePart = attendee.deviceInfo ? attendee.deviceInfo.split(')')[0] + ')' : "unknown Device";
                    const datePart = new Date().toLocaleString('ko-KR', { hour12: false });
                    const metadataStr = `[CERT] IP: ${ipPart} | Device: ${devicePart} | At: ${datePart}`;

                    page.drawText(metadataStr, {
                        x: centeredX,
                        y: centeredY - 8,
                        size: 5,
                        font: font,
                    });
                }
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
                            const uniqueId = attendee.id || attendee.phone || `temp-${attendee.name}`;
                            const foundCoord = nameCoordinates[attendee.name];

                            let initLeft = 50 + (index % 4) * 150 + offsetX;
                            let initTop = 100 + Math.floor(index / 4) * 60 + offsetY;

                            if (foundCoord && scale) {
                                const canvasX = foundCoord.x * scale;
                                const canvasW = foundCoord.w * scale;
                                const canvasY = (foundCoord.pageHeight - foundCoord.y) * scale;
                                const sigBoxHeight = (80 / 3) * sigGlobalScale * scale;
                                const canvasSigWidth = 80 * sigGlobalScale * scale;

                                const nameCenter = canvasX + (canvasW / 2);
                                const signTargetCenter = nameCenter + (foundCoord.individualDeltaXPdf ?? 140) * scale;

                                initLeft = signTargetCenter - (canvasSigWidth / 2) + offsetX;
                                initTop = canvasY - (sigBoxHeight / 2) + offsetY;
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
                                        width: `${80 * sigGlobalScale * scale}px`,
                                        height: `${(80 / 3) * sigGlobalScale * scale}px`,
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
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {showDebug && (
                <div style={{ padding: '10px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', fontSize: '10px', fontFamily: 'monospace', maxHeight: '200px', overflowY: 'auto', position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000, backgroundColor: 'white' }}>
                    <strong>Name Coordinates Dump (v0.6.0 Row):</strong><br />
                    {Object.entries(nameCoordinates).map(([key, val]) => (
                        <div key={key}>
                            "{key}" : X={Math.round(val.x)}, Y={Math.round(val.y)}, Delta={Math.round(val.individualDeltaXPdf || 0)}
                        </div>
                    ))}
                    <hr style={{ margin: '5px 0' }} />
                    <strong>Raw Text (Y:300-800):</strong><br />
                    {rawTextItems.map((item, idx) => (
                        <div key={idx} style={{ color: '#64748b' }}>
                            Y={Math.round(item.transform[5])} X={Math.round(item.transform[4])} | "{item.str}"
                        </div>
                    ))}
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
