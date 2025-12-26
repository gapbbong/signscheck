"use client";

import { useEffect, useRef, useState } from 'react';
// [SSR Fix] Remove top-level pdfjsLib import to avoid DOMMatrix error during build
import { PDFDocument } from 'pdf-lib';
import { Attendee } from '@/lib/gas-service';
import { updateMeetingHash } from '@/lib/meeting-service';

interface Props {
    file: File;
    attendees: (Attendee & { id?: string; status: string; signatureUrl?: string })[];
    onConfirm?: () => void; // [New] Callback for Spacebar action
    meetingId?: string | null; // [New] To save document hash
}

export default function PDFPreview({ file, attendees, onConfirm, meetingId }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [scale, setScale] = useState(1.0);
    const [rotation, setRotation] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);

    // [New] Dynamic Offset Configuration
    const [offsetX, setOffsetX] = useState(100);
    const [offsetY, setOffsetY] = useState(-35);

    // Track render task to cancel if needed
    const renderTaskRef = useRef<any>(null);

    // [New] Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Priority: Ctrl + Arrows for Fine Tuning
            if (e.ctrlKey) {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                    e.preventDefault(); // Key fix: Prevent page scrolling
                    const step = e.shiftKey ? 20 : 5; // Increased sensitivity: 1->5, 10->20

                    if (e.key === 'ArrowRight') setOffsetX(p => p + step);
                    if (e.key === 'ArrowLeft') setOffsetX(p => p - step);
                    if (e.key === 'ArrowDown') setOffsetY(p => p + step); // Screen Y goes down
                    if (e.key === 'ArrowUp') setOffsetY(p => p - step);

                    // console.log("Adjusting Offset:", e.key); 
                }
            }

            // Spacebar for "Next/Confirm"
            if (e.code === 'Space' && !e.ctrlKey && !e.shiftKey && onConfirm) {
                // Check if focused element is NOT an input/textarea to avoid conflict
                const tag = (e.target as HTMLElement).tagName;
                if (tag !== 'INPUT' && tag !== 'TEXTAREA') {
                    e.preventDefault(); // Prevent scroll
                    onConfirm();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onConfirm]);

    // [New] Text Coordinate Map (stores PDF point coords)
    const [nameCoordinates, setNameCoordinates] = useState<Record<string, { x: number, y: number, pageHeight: number }>>({});

    // 1. Load PDF & Auto-Detect Orientation & Map Types
    useEffect(() => {
        const loadPdf = async () => {
            // [SSR Fix] Lazy load pdfjsLib
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const doc = await loadingTask.promise;
            setPdfDoc(doc);

            // [Smart Auto-Rotate] & [Smart Auto-Position]
            try {
                const page = await doc.getPage(1);
                const textContent = await page.getTextContent();
                const unscaledViewport = page.getViewport({ scale: 1.0 }); // Use base scale for coords

                // 2. Name Mapping & Grid Analysis
                const coords: Record<string, { x: number, y: number, pageHeight: number }> = {};
                const rows: Record<number, number[]> = {}; // y -> [x, x, x]

                // Naive Match: Look for exact name string in items
                textContent.items.forEach((item: any) => {
                    const str = item.str.trim();
                    if (str.length >= 2) {
                        // Check if this string is one of our attendees
                        const matchedAttendee = attendees.find(a => str.includes(a.name));
                        if (matchedAttendee) {
                            const tx = item.transform[4];
                            const ty = item.transform[5];

                            // Let's use the raw PDF coords for now, we will scale them during render
                            coords[matchedAttendee.name] = {
                                x: tx,
                                y: ty,
                                pageHeight: unscaledViewport.height
                            };

                            // Group by Row (Tolerance 5px)
                            const rowKey = Object.keys(rows).find(k => Math.abs(Number(k) - ty) < 5);
                            if (rowKey) {
                                rows[Number(rowKey)].push(tx);
                            } else {
                                rows[ty] = [tx];
                            }
                        }
                    }
                });
                console.log("Auto-Detected Name Positions:", coords);
                setNameCoordinates(coords);

                // 3. Smart Gap Calculation
                // Find average distance between items in the same row
                let totalGap = 0;
                let gapCount = 0;

                Object.values(rows).forEach(rowXs => {
                    if (rowXs.length > 1) {
                        rowXs.sort((a, b) => a - b);
                        for (let i = 0; i < rowXs.length - 1; i++) {
                            const gap = rowXs[i + 1] - rowXs[i];
                            // Filter huge gaps (e.g. across separate tables)
                            if (gap > 50 && gap < 500) {
                                totalGap += gap;
                                gapCount++;
                            }
                        }
                    }
                });

                if (gapCount > 0) {
                    const avgGap = totalGap / gapCount;
                    // Heuristic: Signature box usually starts at ~40-50% of the column width 
                    // if the structure is [Name][Sign][Name][Sign]
                    // Previous logic placed Left Edge at center (biased right).
                    // New logic Centers the box (120px wide) in the gap.

                    const boxWidth = 120;
                    const scaleFactor = 1.2; // Estimated scale

                    // Gap is in PDF units. Convert to Pixels (approx)
                    const gapPixels = avgGap * scaleFactor;

                    // We want Center of Box to be at Center of Gap
                    // Offset = (Gap / 2) - (BoxWidth / 2)
                    const centerOffset = (gapPixels / 2) - (boxWidth / 2);

                    console.log(`Smart Grid Analysis: Avg Gap=${avgGap} (PDF), Gap=${gapPixels}px, CenterOffset=${centerOffset}px`);

                    setOffsetX(centerOffset);
                }

            } catch (e) {
                console.error("Auto-analysis failed", e);
            }
        };
        loadPdf();
    }, [file, attendees]); // Re-run if attendees change (to map new names)

    // 2. Render Page 1
    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;

        const renderPage = async () => {
            // Cancel previous render if exists
            if (renderTaskRef.current) {
                // Fix: cancel() returns void, do not unnecessary await or catch
                renderTaskRef.current.cancel();
                renderTaskRef.current = null;
            }

            try {
                const page = await pdfDoc.getPage(1);
                const desiredScale = 1.2; // Fixed scale for MVP Demo clarity

                // Pass rotation to getViewport
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
            } finally {
                // Don't null here to allow cancellation of ongoing task
            }
        };

        renderPage();

        // Cleanup function
        return () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [pdfDoc, rotation]); // Re-render on rotation change

    // Filter signed attendees
    const signedAttendees = attendees.filter(a => a.status === 'signed' && a.signatureUrl);

    // [New] Drag Logic
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

    // [New] Clean Save - Download Signed PDF
    const handleDownload = async () => {
        if (!file || signedAttendees.length === 0) {
            alert("서명이 완료된 참가자가 없습니다.");
            return;
        }

        setIsDownloading(true);
        try {
            // 1. Load Original PDF
            const arrayBuffer = await file.arrayBuffer();
            const pdfDoc = await PDFDocument.load(arrayBuffer);
            const page = pdfDoc.getPages()[0]; // MVP: Page 1 only
            const { height: pageHeight } = page.getSize();

            // 2. Embed Signatures
            for (const attendee of signedAttendees) {
                if (!attendee.signatureUrl) continue;

                // Load signature image
                // Load signature image
                const uniqueId = attendee.id || attendee.phone || `temp-${attendee.name}`;
                if (!uniqueId) continue; // Safety

                const sigImageBytes = await fetch(attendee.signatureUrl).then(res => res.arrayBuffer());
                const sigImage = await pdfDoc.embedPng(sigImageBytes);

                // Recalculate Initial Position for reference
                const foundCoord = nameCoordinates[attendee.name];
                let currentCanvasX = 0;
                let currentCanvasY = 0;

                // Helper to get initial canvas pos
                const getInitPos = () => {
                    if (foundCoord && scale) {
                        const pdfX = foundCoord.x;
                        const pdfY = foundCoord.y;

                        const canvasX = pdfX * scale;
                        const canvasY = (foundCoord.pageHeight - pdfY) * scale;

                        return {
                            x: canvasX + offsetX,
                            y: canvasY + offsetY
                        };
                    }
                    // Fallback grid
                    const index = attendees.indexOf(attendee);
                    const cols = 4;
                    const col = index % cols;
                    const row = Math.floor(index / cols);
                    return {
                        x: 50 + col * (140 + 10),
                        y: 100 + row * (50 + 10)
                    };
                };

                const initPos = getInitPos();
                const pos = positions[uniqueId] || initPos;
                currentCanvasX = pos.x;
                currentCanvasY = pos.y;

                // Project Back to PDF Coordinates
                const pdfX = currentCanvasX / scale;
                const pdfY = pageHeight - (currentCanvasY / scale);

                // Draw Image
                const targetWidth = 140 / scale;
                const targetHeight = 50 / scale;

                page.drawImage(sigImage, {
                    x: pdfX,
                    y: pdfY - targetHeight, // Draw from bottom-left corner of image. pos.y is Top of box.
                    width: targetWidth,
                    height: targetHeight,
                });
            }

            // 3. Save PDF to bytes
            const pdfBytes = await pdfDoc.save();

            // 4. Generate SHA-256 Hash (Digital Fingerprint)
            const hashBuffer = await crypto.subtle.digest('SHA-256', pdfBytes as any);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const documentHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            console.log('📌 Document Hash (SHA-256):', documentHash);

            // 5. Save Hash to Firestore (if meetingId available)
            if (meetingId) {
                await updateMeetingHash(meetingId, documentHash);
            }

            // 6. Download PDF
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
            {/* Toolbar: Left Side (Controls) */}
            <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 10, display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {/* Offset Controls */}
                <div style={{ display: 'flex', gap: '5px', background: 'rgba(255,255,255,0.8)', padding: '4px', borderRadius: '4px', backdropFilter: 'blur(4px)' }}>
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155' }}>↔ X:</span>
                    <input
                        type="number"
                        value={offsetX}
                        onChange={(e) => setOffsetX(Number(e.target.value))}
                        style={{ width: '50px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }}
                    />
                    <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155', marginLeft: '5px' }}>↕ Y:</span>
                    <input
                        type="number"
                        value={offsetY}
                        onChange={(e) => setOffsetY(Number(e.target.value))}
                        style={{ width: '50px', fontSize: '12px', border: '1px solid #cbd5e1', borderRadius: '2px' }}
                    />
                </div>

                <button
                    onClick={() => setRotation(prev => (prev + 90) % 360)}
                    style={{
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.3rem 0.6rem',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                    }}
                >
                    ↻ Rotate
                </button>
            </div>

            {/* Toolbar: Right Side (Actions) */}
            <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 10 }}>
                <button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    style={{
                        backgroundColor: isDownloading ? '#94a3b8' : '#22c55e',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '0.4rem 1rem',
                        cursor: isDownloading ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        backdropFilter: 'blur(4px)',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                >
                    {isDownloading ? 'Processing...' : '💾 Save PDF'}
                </button>
            </div>

            <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 'auto' }} />

            {/* Signature Overlay Layer */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
                {signedAttendees.map((attendee, index) => {
                    const uniqueId = attendee.id || index.toString();

                    // Grid Fallback
                    const boxWidth = 140; // [Update] Optimized size
                    const boxHeight = 50; // [Update] Optimized size
                    const gap = 10;
                    const cols = 4;
                    const col = index % cols;
                    const row = Math.floor(index / cols);
                    let initLeft = 50 + col * (boxWidth + gap);
                    let initTop = 100 + row * (boxHeight + gap);

                    // Auto-Position Logic
                    const foundCoord = nameCoordinates[attendee.name];
                    if (foundCoord && scale) {
                        const pdfX = foundCoord.x;
                        const pdfY = foundCoord.y;

                        const canvasX = pdfX * scale;
                        const canvasY = (foundCoord.pageHeight - pdfY) * scale;

                        // [Updated] Use Dynamic Offsets
                        initLeft = canvasX + offsetX;
                        initTop = canvasY + offsetY;
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
                                width: `${boxWidth}px`,
                                height: `${boxHeight}px`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'move', // Changed from grab to move
                                userSelect: 'none',
                                zIndex: 50
                            }}
                        >
                            <div style={{
                                border: '2px solid transparent',
                                borderRadius: '4px',
                                transition: 'border 0.2s',
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(59, 130, 246, 0.5)'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                            >
                                <img
                                    src={attendee.signatureUrl}
                                    alt="Signature"
                                    style={{
                                        maxWidth: '100%',
                                        maxHeight: '100%',
                                        mixBlendMode: 'multiply', // [Fix] Makes white background transparent
                                        pointerEvents: 'none'
                                    }}
                                />
                            </div>

                            {/* Name Tag */}
                            <div style={{
                                position: 'absolute',
                                top: -18,
                                left: 0,
                                fontSize: '11px',
                                color: '#64748b',
                                fontWeight: 'bold',
                                backgroundColor: 'rgba(255,255,255,0.9)',
                                padding: '1px 4px',
                                borderRadius: '2px',
                                border: '1px solid #cbd5e1',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap'
                            }}>
                                {attendee.name} (서명본)
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Animation Styles */}
            <style jsx>{`
                @keyframes popIn {
                    from { transform: scale(0); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
}
