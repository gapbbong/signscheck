"use client";

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { subscribeToConfig, AppConfig } from "@/lib/config-service";
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useNotification } from '@/lib/NotificationContext';

export default function SignPage() {
    const params = useParams();
    const id = params?.id as string;
    const { showToast } = useNotification();

    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [requestData, setRequestData] = useState<any>(null);
    const [submitted, setSubmitted] = useState(false);
    const [isChecked, setIsChecked] = useState(false);
    const [hasSigned, setHasSigned] = useState(false);
    const [canvasHeight, setCanvasHeight] = useState(200);
    const [txtContent, setTxtContent] = useState<string | null>(null);

    // Metadata State
    const [ip, setIp] = useState("unknown");
    const [deviceInfo, setDeviceInfo] = useState("");

    // PDF Preview State (Signer Side)
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pageHeight, setPageHeight] = useState(0);
    const [namePos, setNamePos] = useState<{ x: number, y: number, w: number, delta: number } | null>(null);
    const [renderScale, setRenderScale] = useState(1);
    const [pdfLoadingError, setPdfLoadingError] = useState(false);
    const [isCanvasLoading, setIsCanvasLoading] = useState(true);
    const [hasStoredSig, setHasStoredSig] = useState(false);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const previewCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);

    // Metadata Fetch (IP/Device)
    useEffect(() => {
        fetch('https://api.ipify.org?format=json')
            .then(res => res.json())
            .then(data => setIp(data.ip))
            .catch(() => setIp("unknown"));
        setDeviceInfo(`${navigator.userAgent}`);
    }, []);

    // Subscribe to remote config
    useEffect(() => {
        const unsubscribeConfig = subscribeToConfig((remoteConfig) => {
            setConfig(remoteConfig);
        });
        return () => unsubscribeConfig();
    }, []);

    // 1. Fetch Request Data
    useEffect(() => {
        if (!id) return;

        const fetchRequest = async () => {
            try {
                console.log("Fetching request:", id);
                const docRef = doc(db, "requests", id);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();

                    if (data.meetingId) {
                        try {
                            const meetingRef = doc(db, "meetings", data.meetingId);
                            const meetingSnap = await getDoc(meetingRef);
                            if (meetingSnap.exists()) {
                                const meetingData = meetingSnap.data();
                                data.hostName = meetingData.hostName || "담당자";
                                data.mainPdfUrl = meetingData.pdfUrl || meetingData.fileUrl;
                                if (!data.attachmentUrl) data.attachmentUrl = meetingData.attachmentUrl;

                                // Load PDF for preview canvas (Use Proxy to avoid CORS hang)
                                if (data.mainPdfUrl) {
                                    console.log("Starting PDF load for attendee preview...");
                                    const proxyPdfUrl = `/api/proxy-pdf?url=${encodeURIComponent(data.mainPdfUrl)}`;

                                    const loadWithTimeout = async () => {
                                        try {
                                            const pdfjsLib = await import('pdfjs-dist');
                                            // Ensure local worker is used
                                            pdfjsLib.GlobalWorkerOptions.workerSrc = window.location.origin + '/pdf.worker.min.mjs';

                                            console.log("Worker initialized:", pdfjsLib.GlobalWorkerOptions.workerSrc);

                                            const timeoutPromise = new Promise((_, reject) =>
                                                setTimeout(() => reject(new Error("PDF Load Timeout (5s)")), 5000)
                                            );

                                            const loadingTask = pdfjsLib.getDocument(proxyPdfUrl);
                                            const docObj = await Promise.race([loadingTask.promise, timeoutPromise]) as any;

                                            console.log("PDF loaded successfully via canvas.");
                                            setPdfDoc(docObj);

                                            // Analysis (Mini Row Grouping)
                                            const page = await docObj.getPage(1);
                                            const textContent = await page.getTextContent();
                                            const viewport = page.getViewport({ scale: 1.0 });
                                            setPageHeight(viewport.height);

                                            const items = textContent.items as any[];
                                            const rows: Record<number, any[]> = {};
                                            items.forEach(item => {
                                                const yKey = Math.round(item.transform[5] / 12) * 12;
                                                if (!rows[yKey]) rows[yKey] = [];
                                                rows[yKey].push(item);
                                            });

                                            const cleanMyName = data.name.replace(/[^a-zA-Z0-9가-힣]/g, '');
                                            // More flexible pattern for name matching (accommodates spaces/chars)
                                            const namePattern = new RegExp(cleanMyName.split('').join('.*'));
                                            let foundPos: any = null;

                                            Object.entries(rows).forEach(([yKey, rowItems]) => {
                                                const rowStr = rowItems.map(i => i.str).join('');
                                                const rowClean = rowStr.replace(/[^a-zA-Z0-9가-힣]/g, '');

                                                if (namePattern.test(rowClean)) {
                                                    // Find specific items in the row that match the name for better X-coordinate
                                                    const matchingItems = rowItems.filter(i => namePattern.test(i.str.replace(/[^a-zA-Z0-9가-힣]/g, '')));
                                                    const targetItems = matchingItems.length > 0 ? matchingItems : rowItems;

                                                    const minX = Math.min(...targetItems.map(i => i.transform[4]));
                                                    const maxX = Math.max(...targetItems.map(i => i.transform[4] + (i.width || 0)));
                                                    const avgY = targetItems.reduce((acc, i) => acc + i.transform[5], 0) / targetItems.length;
                                                    foundPos = { x: minX, y: avgY, w: maxX - minX, delta: 140 };
                                                    console.log("Name position detected:", foundPos);
                                                }
                                            });
                                            setNamePos(foundPos);
                                            setIsCanvasLoading(false);
                                        } catch (e) {
                                            console.error("PDF Canvas Error - Falling back to iframe:", e);
                                            setPdfLoadingError(true);
                                            setIsCanvasLoading(false);
                                        }
                                    };

                                    loadWithTimeout();
                                }
                            }
                        } catch (e) {
                            console.error("Meeting fetch error:", e);
                            setPdfLoadingError(true); // Also set error if meeting fetch fails
                            setIsCanvasLoading(false);
                        }
                    }

                    if (data.status === 'signed') {
                        setSubmitted(true);
                    }

                    setRequestData(data);
                } else {
                    console.error("Request not found:", id);
                    setPdfLoadingError(true); // If request not found, also fallback
                    setIsCanvasLoading(false);
                }
            } catch (error: any) {
                console.error("Fetch error:", error);
                setPdfLoadingError(true); // General fetch error
                setIsCanvasLoading(false);
            } finally {
                setLoading(false);
            }
        };

        fetchRequest();
    }, [id]);

    // Check for stored signature
    useEffect(() => {
        const stored = localStorage.getItem('lastSignature');
        setHasStoredSig(!!stored);
    }, []);

    // [New] Handle .txt attachment content
    useEffect(() => {
        if (requestData?.attachmentUrl && requestData.attachmentUrl.toLowerCase().includes('.txt')) {
            fetch(requestData.attachmentUrl)
                .then(res => res.text())
                .then(text => setTxtContent(text))
                .catch(err => console.error("Txt fetch error:", err));
        }
    }, [requestData?.attachmentUrl]);

    // [New] Set Canvas dimensions safely
    useEffect(() => {
        if (!loading && requestData && canvasRef.current) {
            const canvas = canvasRef.current;
            // Standard internal resolution for consistency
            canvas.width = 600;
            canvas.height = 200;
            setCanvasHeight(200);
        }
    }, [loading, requestData]);

    // [New] Render Preview PDF onto Canvas
    useEffect(() => {
        if (!pdfDoc || !previewCanvasRef.current || pdfLoadingError) return; // Don't render if error
        const render = async () => {
            const page = await pdfDoc.getPage(1);
            const canvas = previewCanvasRef.current!;
            const context = canvas.getContext('2d');
            if (!context) return;

            const containerWidth = canvas.parentElement?.clientWidth || 300;
            const viewport = page.getViewport({ scale: 1 });
            const scale = containerWidth / viewport.width;
            setRenderScale(scale);
            const scaledViewport = page.getViewport({ scale });

            canvas.width = scaledViewport.width;
            canvas.height = scaledViewport.height;

            await page.render({ canvasContext: context, viewport: scaledViewport }).promise;
        };
        render();
    }, [pdfDoc, submitted, pdfLoadingError]); // Re-render on submission to show overlay

    // [New] Auto-close listener (Enter/Space)
    useEffect(() => {
        if (!submitted) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                window.close();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [submitted]);

    // Canvas Logic
    const startDrawing = (e: any) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        setIsDrawing(true);
        setHasSigned(true); // [New] Mark as signed
        const { offsetX, offsetY } = getCoordinates(e, canvas);

        ctx.lineWidth = 12;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(offsetX, offsetY);
    };

    const draw = (e: any) => {
        if (!isDrawing) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { offsetX, offsetY } = getCoordinates(e, canvas);
        ctx.lineTo(offsetX, offsetY);
        ctx.stroke();
    };

    const stopDrawing = () => {
        setIsDrawing(false);
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.closePath();
        }
    };

    const getCoordinates = (e: any, canvas: HTMLCanvasElement) => {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;

        // Map client coordinates to standardized 600x200 resolution
        const x = (clientX - rect.left) * (canvas.width / rect.width);
        const y = (clientY - rect.top) * (canvas.height / rect.height);

        return { offsetX: x, offsetY: y };
    };

    const handleClear = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
            setHasSigned(false); // [New] Reset signature state
        }
    };

    const handleSubmit = async () => {
        if (!canvasRef.current) return;
        if (!isChecked) {
            showToast("안내사항을 확인하고 체크해주세요.", "error");
            return;
        }

        const signatureDataUrl = canvasRef.current.toDataURL('image/png'); // Ensure PNG for transparency

        localStorage.setItem('lastSignature', signatureDataUrl);

        try {
            await updateDoc(doc(db, "requests", id), {
                status: 'signed',
                signedAt: serverTimestamp(),
                signatureUrl: signatureDataUrl,
                ip: ip,
                deviceInfo: deviceInfo,
                userAgent: navigator.userAgent
            });

            // Update local state for immediate overlay update v0.6.7
            setRequestData((prev: any) => prev ? { ...prev, signatureUrl: signatureDataUrl, status: 'signed' } : null);
            setSubmitted(true);
        } catch (error) {
            console.error(error);
            showToast("서명 제출 실패", "error");
        }
    };

    if (config?.isMaintenance) {
        return (
            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', color: '#fff', textAlign: 'center', padding: '20px' }}>
                <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🚧</div>
                <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '10px' }}>시스템 점검 중입니다</h1>
                <p style={{ color: '#94a3b8', maxWidth: '500px' }}>
                    더 나은 서명 품질을 위해 잠시 점검을 진행하고 있습니다.<br />
                    잠시 후 다시 접속해 주세요.
                </p>
            </div>
        );
    }

    if (loading) return <div style={{ padding: '2rem', color: '#fff', backgroundColor: '#0f172a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>데이터를 불러오고 있습니다...</div>;
    if (!requestData) return <div style={{ padding: '2rem', color: '#fff', backgroundColor: '#0f172a', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>요청을 찾을 수 없습니다.</div>;

    // Submitted full-page view removed for persistent layout v0.6.6

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a' }}>
            <header style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>
                    {requestData.name}님에게 서명 요청 왔습니다.
                </h1>
            </header>
            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
                .spinner {
                    width: 24px;
                    height: 24px;
                    border: 3px solid #e2e8f0;
                    border-top-color: #3b82f6;
                    border-radius: 50%;
                    animation: spin 0.8s linear infinite;
                }
            `}</style>

            <main style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                {/* Success Banner v0.6.8 */}
                {submitted && (
                    <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #10b981', padding: '1.5rem', borderRadius: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', position: 'relative' }}>
                        <div style={{ fontSize: '2rem' }}>✅</div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#065f46' }}>서명이 성공적으로 제출되었습니다!</h2>
                        <p style={{ color: '#047857', fontSize: '0.9rem' }}>아래 미리보기에서 서명 위치를 확인하실 수 있습니다. 확인 후 <b>이 창을 닫아주세요.</b></p>
                        <span style={{ position: 'absolute', bottom: '5px', right: '10px', fontSize: '0.6rem', color: '#10b981', opacity: 0.5 }}>v0.6.8</span>
                    </div>
                )}
                {/* 1. Main PDF Preview */}
                <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#64748b' }}>
                        서명할 문서 확인 (Preview) <span style={{ color: '#ef4444', marginLeft: '8px' }}>※ 서명란은 페이지 맨 아래에 있습니다</span>
                    </label>
                    <div style={{
                        width: '100%',
                        aspectRatio: '210 / 297',
                        height: 'auto',
                        backgroundColor: '#fff',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                        position: 'relative',
                        boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                        // Remove overflow: hidden to allow bottom parts to be visible if they overflow slightly
                    }}>
                        {/* Canvas Layer - Attempted approach */}
                        <canvas
                            ref={previewCanvasRef}
                            style={{ width: '100%', height: 'auto', display: (pdfDoc && !pdfLoadingError) ? 'block' : 'none', borderRadius: '0.5rem' }}
                        />

                        {/* Fallback Layer - If canvas fails or loading */}
                        {(pdfLoadingError || (!pdfDoc && !isCanvasLoading)) && (
                            <iframe
                                src={`https://docs.google.com/viewer?url=${encodeURIComponent(requestData.mainPdfUrl)}&embedded=true`}
                                style={{ width: '100%', height: '100%', border: 'none', borderRadius: '0.5rem' }}
                                title="Primary PDF Fallback"
                            />
                        )}

                        {/* Real-time Signature Overlay (Only works if name detection succeeded) */}
                        {(submitted || hasSigned) && namePos && !pdfLoadingError && (
                            <div style={{
                                position: 'absolute',
                                left: `${(namePos.x + namePos.w / 2 + namePos.delta) * renderScale - (40 * renderScale)}px`,
                                top: `${(pageHeight - namePos.y) * renderScale - (13 * renderScale)}px`,
                                width: `${80 * renderScale}px`,
                                height: `${27 * renderScale}px`,
                                pointerEvents: 'none',
                                zIndex: 10
                            }}>
                                <img
                                    src={localStorage.getItem('lastSignature') || requestData.signatureUrl || ''}
                                    style={{ width: '100%', height: '100%', mixBlendMode: 'multiply', opacity: 0.9 }}
                                    alt="Sign Preview"
                                />
                            </div>
                        )}

                        {!pdfDoc && !pdfLoadingError && isCanvasLoading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#94a3b8', backgroundColor: 'rgba(255,255,255,0.8)', zIndex: 20 }}>
                                <div className="spinner"></div>
                                <div>문서를 불러오고 있습니다...</div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 2. Attachment (Embedded) - Hide after submission */}
                {requestData.attachmentUrl && !submitted && (
                    <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#64748b' }}>첨부파일 (안내문)</label>
                        <div style={{ width: '100%', minHeight: '100px', height: 'auto', maxHeight: '400px', backgroundColor: '#f8fafc', borderRadius: '0.5rem', border: '1px solid #e2e8f0', overflow: 'auto', padding: '1rem' }}>
                            {txtContent ? (
                                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: '0.9rem', color: '#334155', fontFamily: 'inherit' }}>{txtContent}</pre>
                            ) : requestData.attachmentUrl.toLowerCase().includes('.txt') ? (
                                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                                    <div style={{ color: '#94a3b8' }}>텍스트를 불러오고 있습니다...</div>
                                    <a
                                        href={requestData.attachmentUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ padding: '0.5rem 1rem', backgroundColor: '#3b82f6', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none', fontSize: '0.8rem' }}
                                    >
                                        내용이 보이지 않으면 여기를 클릭 (새창)
                                    </a>
                                </div>
                            ) : (
                                <iframe
                                    src={`https://docs.google.com/viewer?url=${encodeURIComponent(requestData.attachmentUrl)}&embedded=true`}
                                    style={{ width: '100%', height: '100%', border: 'none' }}
                                    title="Attachment Preview"
                                />
                            )}
                        </div>
                        <div style={{ textAlign: 'center', padding: '0.5rem' }}>
                            <a href={requestData.attachmentUrl} download target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                💾 원본 다운로드
                            </a>
                        </div>
                    </div>
                )}

                {/* 3. Signature Area - Hide after submission */}
                {!submitted && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <div style={{ marginBottom: '1rem', padding: '1.5rem', backgroundColor: '#eff6ff', borderRadius: '1rem', border: '2px solid #3b82f6', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input type="checkbox" id="confirmCheck" checked={isChecked} onChange={(e) => setIsChecked(e.target.checked)} style={{ width: '24px', height: '24px', accentColor: '#3b82f6', cursor: 'pointer' }} />
                            <label htmlFor="confirmCheck" style={{ fontSize: '1rem', fontWeight: 'bold', color: '#1e40af', cursor: 'pointer', flex: 1 }}>
                                위 내용(첨부파일 포함)을 모두 확인하였으며, 이에 서명합니다.
                            </label>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>아래 입력칸에 꽉 차게 서명해 주세요</label>
                            {hasStoredSig && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        const saved = localStorage.getItem('lastSignature');
                                        if (saved && canvasRef.current) {
                                            const img = new Image();
                                            img.onload = () => {
                                                const ctx = canvasRef.current?.getContext('2d');
                                                if (ctx) {
                                                    ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
                                                    ctx.drawImage(img, 0, 0);
                                                    setHasSigned(true);
                                                }
                                            };
                                            img.src = saved;
                                        } else { showToast("저장된 서명이 없습니다.", "error"); }
                                    }}
                                    style={{ fontSize: '0.8rem', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
                                >
                                    ↺ 이전 서명 불러오기
                                </button>
                            )}
                        </div>

                        <div style={{ flex: 1, backgroundColor: '#fff', borderRadius: '1rem', border: '1px solid #cbd5e1', overflow: 'hidden', position: 'relative', minHeight: `${canvasHeight}px` }}>
                            <canvas
                                ref={canvasRef}
                                style={{ touchAction: 'none', width: '100%', height: '100%' }}
                                onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                            />
                        </div>
                        <button onClick={handleClear} style={{ marginTop: '0.5rem', alignSelf: 'flex-end', fontSize: '0.9rem', color: '#64748b', background: 'none', border: 'none', textDecoration: 'underline' }}>Clear</button>
                    </div>
                )}
            </main>

            {!submitted && (
                <footer style={{ padding: '1.5rem', backgroundColor: '#fff', borderTop: '1px solid #e2e8f0' }}>
                    <button
                        onClick={handleSubmit}
                        disabled={!isChecked || !hasSigned}
                        style={{ width: '100%', padding: '1rem', backgroundColor: (isChecked && hasSigned) ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1.1rem', fontWeight: 'bold', cursor: (isChecked && hasSigned) ? 'pointer' : 'not-allowed' }}
                    >
                        서명 제출하기
                    </button>
                </footer>
            )}

        </div>
    );
}
