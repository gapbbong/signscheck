"use client";

import { useEffect, useRef, useState, ReactNode } from 'react';
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
import { updateMeetingHash, updateMeetingSignatureOffset } from '@/lib/meeting-service';

interface Props {
    file: File;
    attendees: (any & { id?: string; status: string; signatureUrl?: string; ip?: string; deviceInfo?: string; userAgent?: string })[];
    onConfirm?: () => void;
    meetingId?: string | null;
    initialOffsetX?: number;
    initialOffsetY?: number;
    initialScale?: number;
    currentStep?: number; // [New]
    leftColumnFooter?: ReactNode; // [New] rendered at the bottom of the left control column (e.g. attachment dropzone)
    onOffsetChange?: (offsetX: number, offsetY: number, scale: number) => void; // [New] report live signature offset upward so the parent can persist it (e.g. on 파일 닫기)
}

export default function PDFPreview({ file, attendees, onConfirm, meetingId, initialOffsetX = 0, initialOffsetY = -4, initialScale = 1.0, currentStep = 0, leftColumnFooter, onOffsetChange }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [scale, setScale] = useState(1.0);
    const [rotation, setRotation] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);
    const [showExportModal, setShowExportModal] = useState(false);
    const [showPositionConfirmModal, setShowPositionConfirmModal] = useState(false);
    const [isSavingOffset, setIsSavingOffset] = useState(false);
    const { showToast } = useNotification();

    const [offsetX, setOffsetX] = useState(initialOffsetX);
    const [offsetY, setOffsetY] = useState(initialOffsetY);
    const [sigGlobalScale, setSigGlobalScale] = useState(initialScale);

    // [New] Oversample the canvas bitmap for crisp text when the document is
    // displayed larger than its native PDF-point size. This ONLY changes the
    // backing-store resolution — the coordinate `scale` stays 1.0, so signature
    // offsets and the final PDF export are completely unaffected. displayScale
    // is computed against the logical (÷RENDER_DPR) width so overlays stay aligned.
    const RENDER_DPR = 2;

    // [New] Multi-page support: render pages 2..N read-only below page 1 so the
    // whole document is visible by scrolling. The signature overlay stays on
    // page 1 (where the attendee list / roster lives). Scroll container wraps all pages.
    const [numPages, setNumPages] = useState(1);
    const extraPageRefs = useRef<(HTMLCanvasElement | null)[]>([]);

    useEffect(() => {
        setOffsetX(initialOffsetX);
        setOffsetY(initialOffsetY);
        setSigGlobalScale(initialScale);
    }, [initialOffsetX, initialOffsetY, initialScale]);

    // [New] Report the live signature offset upward so the parent can persist it
    // when the file is closed without an explicit '위치 저장' click.
    useEffect(() => {
        onOffsetChange?.(offsetX, offsetY, sigGlobalScale);
    }, [offsetX, offsetY, sigGlobalScale, onOffsetChange]);

    const renderTaskRef = useRef<any>(null);

    const [nameCoordinates, setNameCoordinates] = useState<Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number, sigWidthPdf?: number }>>({});
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
            setNumPages(doc.numPages || 1);

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

                const coords: Record<string, { x: number, y: number, w: number, pageHeight: number, individualDeltaXPdf?: number, sigWidthPdf?: number }> = {};

                for (const attendee of attendees) {
                    const foundPos = (findNamePosition(attendee.name, rows, headerDeltas) as unknown) as { x: number, y: number, w: number, delta: number, sigWidth?: number };
                    if (foundPos) {
                        coords[attendee.name] = {
                            x: foundPos.x,
                            y: foundPos.y,
                            w: foundPos.w,
                            pageHeight: unscaledViewport.height,
                            individualDeltaXPdf: foundPos.delta,
                            sigWidthPdf: foundPos.sigWidth
                        };
                    }
                }

                setNameCoordinates(coords);
                setNameCoordinates(coords);
                // DO NOT Reset offsets here - utilize props or kept state
                // setOffsetX(0); 
                // setOffsetY(0);

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
                // Logical width = backing width ÷ DPR, so displayScale matches the
                // scale-1.0 coordinate space used by the overlay.
                setDisplayScale(canvas.clientWidth / (canvas.width / RENDER_DPR));
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
                // Coordinate scale stays 1.0 (used by overlay + export); the bitmap
                // is rendered at desiredScale × RENDER_DPR for sharpness.
                setScale(desiredScale);
                const renderViewport = page.getViewport({ scale: desiredScale * RENDER_DPR, rotation: (page.rotate + rotation) % 360 });

                const context = canvas.getContext('2d');
                if (!context) return;

                canvas.height = renderViewport.height;
                canvas.width = renderViewport.width;

                const renderContext = {
                    canvasContext: context,
                    viewport: renderViewport,
                };

                const task = page.render(renderContext);
                renderTaskRef.current = task;
                await task.promise;

                setDisplayScale(canvas.clientWidth / (canvas.width / RENDER_DPR));
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

    // [New] Render pages 2..N (read-only, no signature overlay) for scroll view.
    useEffect(() => {
        if (!pdfDoc || numPages <= 1) return;
        let cancelled = false;
        const tasks: any[] = [];

        const renderExtras = async () => {
            for (let p = 2; p <= numPages; p++) {
                const canvas = extraPageRefs.current[p - 2];
                if (!canvas) continue;
                try {
                    const page = await pdfDoc.getPage(p);
                    if (cancelled) return;
                    const viewport = page.getViewport({ scale: 1.0 * RENDER_DPR, rotation: (page.rotate + rotation) % 360 });
                    const context = canvas.getContext('2d');
                    if (!context) continue;
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    const task = page.render({ canvasContext: context, viewport });
                    tasks.push(task);
                    await task.promise;
                } catch (error: any) {
                    if (error?.name !== 'RenderingCancelledException') {
                        console.error(`Render error (page ${p}):`, error);
                    }
                }
            }
        };

        renderExtras();
        return () => {
            cancelled = true;
            tasks.forEach(t => { try { t.cancel(); } catch { } });
        };
    }, [pdfDoc, numPages, rotation]);

    const signedAttendees = attendees.filter(a => a.status === 'signed' && a.signatureUrl);

    // Fallback signature-box width for attendees whose name isn't found in the
    // document (e.g. manually added). Use the average of the detected cells so
    // their box matches the rest instead of the oversized default.
    const detectedSigWidths = Object.values(nameCoordinates)
        .map(c => c.sigWidthPdf)
        .filter((w): w is number => typeof w === 'number');
    const fallbackSigWidth = detectedSigWidths.length
        ? Math.round(detectedSigWidths.reduce((a, b) => a + b, 0) / detectedSigWidths.length)
        : 60;

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
                // Match the preview: use the detected signature cell width when available.
                const baseBoxW = foundCoord?.sigWidthPdf ?? fallbackSigWidth;
                const getInitPos = () => {
                    if (foundCoord && scale) {
                        const canvasX = foundCoord.x * scale;
                        const canvasY = (foundCoord.pageHeight - foundCoord.y) * scale;
                        const canvasW = foundCoord.w * scale;

                        const nameCenter = canvasX + (canvasW / 2);
                        const signTargetCenter = nameCenter + (foundCoord.individualDeltaXPdf ?? 140) * scale;

                        const canvasSigWidth = baseBoxW * sigGlobalScale * scale;
                        const sigBoxHeight = (baseBoxW / 2.2) * sigGlobalScale * scale;

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

                const boxWidth = baseBoxW * sigGlobalScale;
                const boxHeight = (baseBoxW / 2.2) * sigGlobalScale;

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

    const handleConfirmPosition = async () => {
        if (!meetingId) {
            showToast("미팅 ID가 없습니다.", "error");
            return;
        }

        setIsSavingOffset(true);
        try {
            await updateMeetingSignatureOffset(meetingId, offsetX, offsetY, sigGlobalScale);
            showToast("서명 위치가 저장되었습니다! 참석자들이 받는 링크에도 동일하게 적용됩니다.", "success");
            setShowPositionConfirmModal(false);
        } catch (error) {
            console.error("Failed to save offset:", error);
            showToast("위치 저장에 실패했습니다.", "error");
        } finally {
            setIsSavingOffset(false);
        }
    };

    return (
        <div
            ref={containerRef}
            style={{ position: 'relative', display: 'flex', gap: '1rem', alignItems: 'stretch', justifyContent: 'center' }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* CONTROL COLUMN (right of the document) */}
            <div style={{ order: 2, width: '140px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ fontSize: '12.5px', color: '#cbd5e1', background: 'rgba(30,41,59,0.6)', border: '1px solid #334155', padding: '9px 11px', borderRadius: '6px', lineHeight: 1.6 }}>
                    ⌨️ <b>화살표 키</b>로 서명 위치를 미세조정한 뒤 <b>"위치 저장"</b>을 누르세요.<br />🖱️ 드래그로도 옮길 수 있습니다.
                </div>

                <button onClick={() => setRotation(prev => (prev + 90) % 360)} style={{ width: '100%', backgroundColor: '#1e293b', color: '#fff', border: '1px solid #334155', borderRadius: '6px', padding: '0.45rem', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>↻ 회전</button>
                <button onClick={() => setPositions({})} style={{ width: '100%', backgroundColor: 'rgba(59,130,246,0.85)', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.45rem', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>↺ 초기화</button>
                <button
                    id="btn-save-location"
                    onClick={() => setShowPositionConfirmModal(true)}
                    disabled={!meetingId}
                    className={currentStep === 2 ? "btn-pulse" : ""}
                    style={{ width: '100%', backgroundColor: meetingId ? (currentStep === 2 ? '#3b82f6' : '#10b981') : '#94a3b8', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: meetingId ? 'pointer' : 'not-allowed', fontSize: '0.85rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                >
                    {currentStep === 2 && <span style={{ marginRight: '4px' }}>②</span>}
                    {isSavingOffset ? "저장됨!" : "위치 저장"}
                </button>
                <button
                    id="btn-save-pdf"
                    onClick={() => setShowExportModal(true)}
                    disabled={isDownloading}
                    className={currentStep === 4 ? "btn-pulse" : ""}
                    style={{ width: '100%', backgroundColor: isDownloading ? '#94a3b8' : '#22c55e', color: '#fff', border: 'none', borderRadius: '6px', padding: '0.5rem', cursor: isDownloading ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                >
                    {currentStep === 4 && <span style={{ marginRight: '4px' }}>④</span>}
                    {isDownloading ? 'Processing...' : '💾 Save PDF'}
                </button>

                {leftColumnFooter && (
                    <div style={{ paddingTop: '0.25rem' }}>
                        {leftColumnFooter}
                    </div>
                )}
            </div>

            {/* DOCUMENT (left) */}
            <div className="custom-scroll" style={{ order: 1, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 120px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', maxWidth: '760px' }}>
              <div style={{ position: 'relative', border: '1px solid #475569', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', width: '100%' }}>
                <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />

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
                        {attendees.map((attendee, index) => {
                            const uniqueId = attendee.id || attendee.phone || `temp-${attendee.name}`;
                            const foundCoord = nameCoordinates[attendee.name];
                            const hasSigned = attendee.status === 'signed' && attendee.signatureUrl;

                            let initLeft = 50 + (index % 4) * 150 + offsetX;
                            let initTop = 100 + Math.floor(index / 4) * 60 + offsetY;

                            // Base box width: the detected signature cell width when available,
                            // otherwise a sensible default. Ensures the box matches the real cell.
                            const baseBoxW = foundCoord?.sigWidthPdf ?? fallbackSigWidth;

                            if (foundCoord && scale) {
                                const canvasX = foundCoord.x * scale;
                                const canvasW = foundCoord.w * scale;
                                const canvasY = (foundCoord.pageHeight - foundCoord.y) * scale;
                                const sigBoxHeight = (baseBoxW / 2.2) * sigGlobalScale * scale;
                                const canvasSigWidth = baseBoxW * sigGlobalScale * scale;

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
                                        width: `${baseBoxW * sigGlobalScale * scale}px`,
                                        height: `${(baseBoxW / 2.2) * sigGlobalScale * scale}px`,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'move',
                                        userSelect: 'none',
                                        zIndex: 50,
                                        pointerEvents: 'auto'
                                    }}
                                >
                                    <div style={{ border: hasSigned ? '2px solid transparent' : '1px dashed rgba(59, 130, 246, 0.7)', borderRadius: '4px', transition: 'border 0.2s', width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.border = '2px solid rgba(59, 130, 246, 0.9)'; }} onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.border = hasSigned ? '2px solid transparent' : '1px dashed rgba(59, 130, 246, 0.7)'; }}>
                                        {hasSigned ? (
                                            <img src={attendee.signatureUrl} alt="Signature" style={{ maxWidth: '100%', maxHeight: '100%', mixBlendMode: 'multiply', pointerEvents: 'none' }} />
                                        ) : (
                                            <div style={{ fontSize: `${12 * sigGlobalScale * scale}px`, fontWeight: 'bold', color: '#94a3b8', fontFamily: 'Arial, sans-serif', whiteSpace: 'nowrap' }}>
                                                {attendee.name}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
              </div>

              {/* [New] Pages 2..N — read-only, scrollable below page 1 */}
              {numPages > 1 && Array.from({ length: numPages - 1 }).map((_, i) => (
                <div key={i} style={{ position: 'relative', border: '1px solid #475569', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)', width: '100%' }}>
                  <div style={{ position: 'absolute', top: 8, left: 8, background: 'rgba(15, 23, 42, 0.75)', color: '#fff', fontSize: '0.7rem', fontWeight: 'bold', padding: '2px 8px', borderRadius: '4px', zIndex: 5 }}>
                    {i + 2} 페이지
                  </div>
                  <canvas
                    ref={(el) => { extraPageRefs.current[i] = el; }}
                    style={{ display: 'block', width: '100%', height: 'auto' }}
                  />
                </div>
              ))}
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

            {showPositionConfirmModal && (
                <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }} onClick={() => setShowPositionConfirmModal(false)}>
                    <div style={{ backgroundColor: '#fff', padding: '2rem', borderRadius: '1.25rem', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', maxWidth: '450px', width: '90%', display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>📍</div>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#1e293b', marginBottom: '0.5rem' }}>서명 위치 확인</h3>
                            <p style={{ color: '#64748b', fontSize: '0.9rem', lineHeight: '1.6' }}>현재 설정된 서명 위치가 정확한가요?<br /><b>이 위치가 참석자들에게도 동일하게 적용됩니다.</b></p>
                            <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#f1f5f9', borderRadius: '0.5rem', fontSize: '0.85rem', color: '#475569' }}>
                                <div>X 오프셋: <b>{offsetX}px</b></div>
                                <div>Y 오프셋: <b>{offsetY}px</b></div>
                                <div>크기: <b>{sigGlobalScale}x</b></div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <button
                                onClick={handleConfirmPosition}
                                disabled={isSavingOffset}
                                style={{ width: '100%', padding: '1rem', backgroundColor: isSavingOffset ? '#94a3b8' : '#10b981', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1rem', fontWeight: 'bold', cursor: isSavingOffset ? 'not-allowed' : 'pointer', boxShadow: '0 4px 6px -1px rgba(16, 185, 129, 0.3)', transition: 'all 0.2s' }}
                            >
                                {isSavingOffset ? '저장 중...' : '✓ 예, 정확합니다 (저장)'}
                            </button>

                            <button
                                onClick={() => setShowPositionConfirmModal(false)}
                                disabled={isSavingOffset}
                                style={{ width: '100%', padding: '0.85rem', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '0.75rem', fontSize: '0.9rem', fontWeight: '600', cursor: isSavingOffset ? 'not-allowed' : 'pointer' }}
                            >
                                아니오, 더 조정하겠습니다
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
                @keyframes pulse-blue {
                    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); transform: scale(1); }
                    50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); transform: scale(1.05); }
                    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); transform: scale(1); }
                }
                .btn-pulse {
                    animation: pulse-blue 2s infinite;
                }
            `}</style>
        </div>
    );
}
