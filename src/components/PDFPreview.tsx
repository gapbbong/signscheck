"use client";

import { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { Attendee } from '@/lib/gas-service';
import { updateMeetingHash } from '@/lib/meeting-service';

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

    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(-35);

    const renderTaskRef = useRef<any>(null);

    // [Fix] Keyboard Shortcuts: Priority to Standalone Arrows
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

    const [nameCoordinates, setNameCoordinates] = useState<Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }>>({});

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
                    if (Math.abs(prevY - currY) < 8 && (item.transform[4] - prevRight) < 40) {
                        currentItem.str += (currentItem.str.endsWith(' ') ? '' : ' ') + item.str;
                    } else {
                        mergedItems.push(currentItem);
                        currentItem = { ...item };
                    }
                });
                if (currentItem) mergedItems.push(currentItem);

                const coords: Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }> = {};
                const nameHeaders: any[] = [], signHeaders: any[] = [];

                mergedItems.forEach((item: any) => {
                    const str = item.str.replace(/\s+/g, '');
                    if (['교사명', '성명', '이름', '성명', '성 명', '교 사 명'].includes(str)) nameHeaders.push(item);
                    if (['서명', '서명본', '(인)', '서 명', '서  명', '서 명 본'].includes(str)) signHeaders.push(item);
                });

                const headerDeltas: { nameX: number, deltaPdf: number }[] = [];
                nameHeaders.forEach(nh => {
                    const nx = nh.transform[4], ny = nh.transform[5], nw = nh.width || nh.transform[0] * 3; // Estimated width if missing
                    // Find sign header on same line
                    const sh = signHeaders.find(sh => Math.abs(sh.transform[5] - ny) < 20 && sh.transform[4] > nx);
                    if (sh) {
                        const sx = sh.transform[4], sw = sh.width || sh.transform[0] * 2;
                        // Distance from name-start to sign-center
                        const centerDelta = (sx + sw / 2) - (nx + nw / 2);
                        headerDeltas.push({ nameX: nx, deltaPdf: centerDelta });
                    }
                });

                mergedItems.forEach((item: any) => {
                    const str = item.str.trim();
                    if (str.length >= 2) {
                        const matchedAttendee = attendees.find(a => {
                            const cleanStr = str.replace(/[0-9\s\(\)\[\]\.]/g, '');
                            const cleanName = a.name.replace(/\s/g, '');
                            return cleanStr === cleanName || cleanStr.includes(cleanName);
                        });

                        if (matchedAttendee) {
                            const tx = item.transform[4], ty = item.transform[5], tw = item.width || item.transform[0] * 2;
                            let bestDeltaPdf = 280; // Default delta if auto-analysis fails
                            if (headerDeltas.length > 0) {
                                const closestHeader = headerDeltas.reduce((prev, curr) =>
                                    Math.abs(curr.nameX - tx) < Math.abs(prev.nameX - tx) ? curr : prev
                                );
                                // Use detected delta, but enforce minimum of 200 to ensure separation
                                bestDeltaPdf = Math.max(closestHeader.deltaPdf, 200);
                            }
                            coords[matchedAttendee.name] = {
                                x: tx,
                                y: ty,
                                w: tw,
                                pageHeight: unscaledViewport.height,
                                individualDeltaXPdf: bestDeltaPdf
                            };
                            console.log(`[${matchedAttendee.name}] Delta: ${bestDeltaPdf.toFixed(1)}px, Name X: ${tx.toFixed(1)}px`);
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

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;

        const renderPage = async () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
                renderTaskRef.current = null;
            }

            try {
                const page = await pdfDoc.getPage(1);
                const desiredScale = 1.2;
                const scaledViewport = page.getViewport({ scale: desiredScale, rotation: (page.rotate + rotation) % 360 });
                setScale(desiredScale);

                const canvas = canvasRef.current!;
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
            } catch (error: any) {
                if (error.name !== 'RenderingCancelledException') {
                    console.error("Render error:", error);
                }
            }
        };

        renderPage();
        return () => {
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
            alert("서명이 완료된 참가자가 없습니다.");
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
                        const signCenterDelta = (foundCoord.individualDeltaXPdf ?? 280) * scale;
                        const sigBoxWidth = 140;

                        // X: move to sign column center (all in scaled canvas pixels)
                        // Y: +10px to move slightly down from baseline to center in row
                        return {
                            x: nameCenter + signCenterDelta - (sigBoxWidth * scale / 2) + offsetX,
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
                const targetWidth = 140; // Standard PDF units
                const targetHeight = 50; // Standard PDF units

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
            alert("PDF 생성에 실패했습니다.");
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
                    <input type="number" value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} style={{ width: '50px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }} />
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155', marginLeft: '5px' }}>↕ Y:</span>
                    <input type="number" value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} style={{ width: '50px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }} />
                </div>
                <button onClick={() => setRotation(prev => (prev + 90) % 360)} style={{ backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', gap: '4px' }}>↻ Rotate</button>
            </div>

            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
                <button onClick={handleDownload} disabled={isDownloading} style={{ backgroundColor: isDownloading ? '#94a3b8' : '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.4rem 1rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', backdropFilter: 'blur(4px)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', alignItems: 'center', gap: '6px' }}>{isDownloading ? 'Processing...' : '💾 Save PDF'}</button>
            </div>

            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />

            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                {signedAttendees.map((attendee, index) => {
                    const uniqueId = attendee.id || index.toString();
                    const boxWidth = 140, boxHeight = 50, gap = 10;
                    const cols = 4, col = index % cols, row = Math.floor(index / cols);
                    let initLeft = 50 + col * (boxWidth + gap) + offsetX;
                    let initTop = 100 + row * (boxHeight + gap) + offsetY;

                    const foundCoord = nameCoordinates[attendee.name];
                    if (foundCoord && scale) {
                        const canvasX = foundCoord.x * scale;
                        const canvasY = (foundCoord.pageHeight - foundCoord.y) * scale;
                        const canvasW = foundCoord.w * scale;

                        const nameCenter = canvasX + canvasW / 2;
                        const signCenterDelta = (foundCoord.individualDeltaXPdf ?? 280) * scale;

                        // Apply scale to boxWidth for correct positioning
                        initLeft = nameCenter + signCenterDelta - (boxWidth * scale / 2) + offsetX;
                        // Center vertically: canvasY is baseline, +10px to sit lower in the row
                        initTop = canvasY + 10 + offsetY;
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
                                width: `${boxWidth * scale}px`,
                                height: `${boxHeight * scale}px`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'move',
                                userSelect: 'none',
                                zIndex: 50
                            }}
                        >
                            <div style={{ border: '2px solid transparent', borderRadius: '4px', transition: 'border 0.2s', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)'} onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}>
                                <img src={attendee.signatureUrl} alt="Signature" style={{ maxWidth: '100%', maxHeight: '100%', mixBlendMode: 'multiply', pointerEvents: 'none' }} />
                            </div>
                            <div style={{ position: 'absolute', top: -22, left: 0, fontSize: '11px', fontWeight: 'bold', backgroundColor: '#fef08a', color: '#1e293b', padding: '2px 6px', borderRadius: '4px', border: '1px solid #eab308', pointerEvents: 'none', whiteSpace: 'nowrap', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', zIndex: 100 }}>
                                {attendee.name}
                                <span style={{ color: '#ef4444', marginLeft: '6px', fontSize: '11px' }}>[X:{Math.round(pos.x)} Y:{Math.round(pos.y)}]</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            <style jsx>{`
                @keyframes popIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
