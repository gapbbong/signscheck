"use client";

import { useEffect, useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import {
    groupItemsIntoRows,
    detectHeaderDeltas,
    findNamePosition,
    PDFTextItem
} from '@/lib/pdf-analyzer';
import { useNotification } from '@/lib/NotificationContext';
import { updateMeetingHash } from '@/lib/meeting-service';

interface Props {
    file: File;
    attendees: (any & { id?: string; status: string; signatureUrl?: string; ip?: string; deviceInfo?: string; userAgent?: string })[];
    onConfirm?: () => void;
    meetingId?: string | null;
}

export default function PDFPreview({ file, attendees, onConfirm, meetingId }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [scale, setScale] = useState(1.0);
    const [rotation, setRotation] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const { showToast } = useNotification();

    const [offsetX, setOffsetX] = useState(0);
    const [offsetY, setOffsetY] = useState(-40);
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

            if (showExportModal && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                handleDownload(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onConfirm, showExportModal, isDownloading]);

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

                // Analysis using centralized pdf-analyzer logic (v0.8.5)
                const items = sortedItems as any as PDFTextItem[];
                const rows = groupItemsIntoRows(items);
                const headerDeltas = detectHeaderDeltas(items);

                const coords: Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number }> = {};

                for (const attendee of attendees) {
                    const foundPos = (findNamePosition(attendee.name, rows, headerDeltas) as unknown) as { x: number, y: number, w: number, delta: number };
                    if (foundPos) {
                        coords[attendee.name] = {
                            x: foundPos.x,
                            y: foundPos.y,
                            w: foundPos.w,
                            pageHeight: unscaledViewport.height,
                            individualDeltaXPdf: foundPos.delta
                        };
                    }
                }

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

    const handleDownload = async (includeMetadata: boolean) => {
        if (!file || signedAttendees.length === 0) {
            showToast("서명이 완료된 참가자가 없습니다.", "error");
            return;
        }

        setIsDownloading(true);
        setShowExportModal(false);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const page = pdfDoc.getPages()[0];
            const { height: pageHeight } = page.getSize();

            const font = await pdfDoc.embedFont('Helvetica');

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
                        const sigBoxHeight = (80 / 4) * sigGlobalScale * scale;

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
                const boxHeight = (80 / 4) * sigGlobalScale;

                const imgW = sigImage.width;
                const imgH = sigImage.height;
                const scaleFactor = Math.min(boxWidth / imgW, boxHeight / imgH);

                const targetWidth = imgW * scaleFactor;
                const targetHeight = imgH * scaleFactor;

                const centeredX = pdfX + (boxWidth - targetWidth) / 2;
                const centeredY = (pdfY - boxHeight) + (boxHeight - targetHeight) / 2;

                page.drawImage(sigImage, {
                    x: centeredX,
                    y: centeredY,
                    width: targetWidth,
                    height: targetHeight,
                });

                if (includeMetadata) {
                    const ipPart = attendee.ip || "unknown IP";
                    const rawDeviceInfo = attendee.deviceInfo || attendee.userAgent || "unknown Device";
                    const devicePart = rawDeviceInfo.includes(')') ? rawDeviceInfo.split(')')[0] + ')' : rawDeviceInfo.substring(0, 30);

                    const now = new Date();
                    const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

                    const metadataStr = `[CERT] IP: ${ipPart} | Device: ${devicePart} | At: ${datePart}`;

                    page.drawText(metadataStr, {
                        x: centeredX,
                        y: centeredY - 4,
                        size: 5,
                        font: font,
                    });
                }
            }

            const pdfBytes = await pdfDoc.save();
            // Fix: double cast to bypass Uint8Array -> ArrayBuffer mismatch
            const hashBuffer = await crypto.subtle.digest('SHA-256', (pdfBytes as unknown) as ArrayBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const documentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            if (meetingId) await updateMeetingHash(meetingId, documentHash);

            const blob = new Blob([(pdfBytes as unknown) as ArrayBuffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = includeMetadata ? `Certified_${file.name}` : `Signed_${file.name}`;
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
            ref={containerRef}
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
                <button onClick={() => setShowExportModal(true)} disabled={isDownloading} style={{ backgroundColor: isDownloading ? '#94a3b8' : '#22c55e', color: '#fff', border: 'none', borderRadius: '4px', padding: '0.4rem 1rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', backdropFilter: 'blur(4px)', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', alignItems: 'center', gap: '6px' }}>{isDownloading ? 'Processing...' : '💾 Save PDF'}</button>
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
                                const sigBoxHeight = (80 / 4) * sigGlobalScale * scale;
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
                    <strong>Name Coordinates Dump (v0.8.5):</strong><br />
                    {Object.entries(nameCoordinates).map(([key, val]) => (
                        <div key={key}>
                            "{key}" : X={Math.round(val.x)}, Y={Math.round(val.y)}, Delta={Math.round(val.individualDeltaXPdf || 0)}
                        </div>
                    ))}
                    <hr style={{ margin: '5px 0' }} />
                    <strong>Raw Text:</strong><br />
                    {rawTextItems.map((item, idx) => (
                        <div key={idx} style={{ color: '#64748b' }}>
                            Y={Math.round(item.transform[5])} X={Math.round(item.transform[4])} | "{item.str}"
                        </div>
                    ))}
                </div>
            )}

            {showExportModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setShowExportModal(false)}>
                    <div style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '1.25rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', maxWidth: '450px', width: '90%', display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📄</div>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '0.5rem' }}>PDF 저장 옵션 선택</h3>
                            <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.6' }}>서명 부가정보(IP, 기기 정보 등) 없이<br /><b>서명 이미지만 깔끔하게</b> 저장하시겠습니까?</p>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button
                                onClick={() => handleDownload(false)}
                                style={{ width: '100%', padding: '1rem', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)', transition: 'all 0.2s' }}
                            >
                                깔끔하게 저장 (서명만)
                                <div style={{ fontSize: '0.7rem', fontWeight: 'normal', opacity: 0.8, marginTop: '2px' }}>[Enter / Space] 키로 즉시 다운로드</div>
                            </button>

                            <button
                                onClick={() => handleDownload(true)}
                                style={{ width: '100%', padding: '0.85rem', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '0.75rem', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer' }}
                            >
                                인증 정보 포함 저장
                            </button>

                            <button
                                onClick={() => setShowExportModal(false)}
                                style={{ width: '100%', padding: '0.5rem', backgroundColor: 'transparent', color: '#94a3b8', border: 'none', borderRadius: '0.75rem', fontSize: '0.85rem', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                취소
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx>{`
                @keyframes popIn {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
