"use client";

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { subscribeToConfig, AppConfig } from "@/lib/config-service";
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useNotification } from '@/lib/NotificationContext';
import {
    groupItemsIntoRows,
    detectHeaderDeltas,
    findNamePosition,
    extractColumnRules,
    ColumnRule,
    PDFTextItem
} from '@/lib/pdf-analyzer';

export default function SignPage() {
    const params = useParams();
    const id = params?.id as string;
    const { showToast } = useNotification();

    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [requestData, setRequestData] = useState<any>(null);
    const [submitted, setSubmitted] = useState(false);
    const [hasSigned, setHasSigned] = useState(false);
    const [showSignModal, setShowSignModal] = useState(false);
    const [canvasHeight, setCanvasHeight] = useState(200);
    const [txtContent, setTxtContent] = useState<string | null>(null);

    // Metadata State
    const [ip, setIp] = useState("unknown");
    const [deviceInfo, setDeviceInfo] = useState("");

    // PDF Preview State (Signer Side)
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [numPages, setNumPages] = useState(0);
    const [pageHeight, setPageHeight] = useState(0);
    const [namePos, setNamePos] = useState<{ x: number, y: number, w: number, delta: number } | null>(null);
    const [renderScale, setRenderScale] = useState(1);
    const [pdfLoadingError, setPdfLoadingError] = useState(false);
    const [isCanvasLoading, setIsCanvasLoading] = useState(true);
    const [hasStoredSig, setHasStoredSig] = useState(false);

    // Meeting offset state (loaded from Firestore)
    const [meetingOffsetX, setMeetingOffsetX] = useState(0);
    const [meetingOffsetY, setMeetingOffsetY] = useState(0);
    const [meetingScale, setMeetingScale] = useState(1.0);

    // [Zoom] Pinch/pan/double-tap zoom for the PDF preview. Implemented by hand
    // rather than relying on the browser's native pinch-zoom because in-app
    // browsers (KakaoTalk, etc.) that this link is opened from often disable it.
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const previewScrollRef = useRef<HTMLDivElement>(null);
    const zoomValRef = useRef(1);
    const panValRef = useRef({ x: 0, y: 0 });
    useEffect(() => { zoomValRef.current = zoom; }, [zoom]);
    useEffect(() => { panValRef.current = pan; }, [pan]);
    const resetZoom = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pageCanvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
    const signatureMarkerRef = useRef<HTMLDivElement>(null);
    const thicknessRef = useRef<number>(0); // Store random thickness factor
    const [isDrawing, setIsDrawing] = useState(false);

    // Metadata Fetch (IP/Device)
    useEffect(() => {
        fetch('https://api.ipify.org?format=json')
            .then(res => res.json())
            .then(data => setIp(data.ip))
            .catch(() => setIp("unknown"));

        const ua = navigator.userAgent;
        const info = ua.includes(')') ? ua.split(')')[0] + ')' : ua;
        setDeviceInfo(info);
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

                                // Load signature offset from meeting data
                                setMeetingOffsetX(meetingData.signatureOffsetX || 0);
                                setMeetingOffsetY(meetingData.signatureOffsetY || 0);
                                setMeetingScale(meetingData.signatureScale || 1.0);
                                console.log("Loaded signature offset:", {
                                    offsetX: meetingData.signatureOffsetX || 0,
                                    offsetY: meetingData.signatureOffsetY || 0,
                                    scale: meetingData.signatureScale || 1.0
                                });

                                // Load PDF for preview canvas (Use Proxy to avoid CORS hang)
                                if (data.mainPdfUrl) {
                                    console.log("Starting PDF load for attendee preview...");
                                    const proxyPdfUrl = `/api/proxy-pdf?url=${encodeURIComponent(data.mainPdfUrl)}`;

                                    const loadWithTimeout = async () => {
                                        try {
                                            const pdfjsLib = await import('pdfjs-dist');
                                            // Ensure CDN worker is used for stability
                                            pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

                                            console.log("Worker initialized:", pdfjsLib.GlobalWorkerOptions.workerSrc);

                                            const timeoutPromise = new Promise((_, reject) =>
                                                setTimeout(() => reject(new Error("PDF Load Timeout (5s)")), 5000)
                                            );

                                            const loadingTask = pdfjsLib.getDocument(proxyPdfUrl);
                                            const docObj = await Promise.race([loadingTask.promise, timeoutPromise]) as any;

                                            console.log("PDF loaded successfully via canvas.");
                                            setPdfDoc(docObj);
                                            setNumPages(docObj.numPages || 1);

                                            // Analysis (Mini Row Grouping & Header Detection)
                                            const page = await docObj.getPage(1);
                                            const textContent = await page.getTextContent();
                                            const viewport = page.getViewport({ scale: 1.0 });
                                            setPageHeight(viewport.height);

                                            const items = textContent.items as any[];
                                            // Analysis using centralized pdf-analyzer logic (v0.8.5)
                                            const rows = groupItemsIntoRows(items as PDFTextItem[]);
                                            const headerDeltas = detectHeaderDeltas(items as PDFTextItem[]);
                                            let columnRules: ColumnRule[] = [];
                                            try {
                                                const opList = await page.getOperatorList();
                                                columnRules = extractColumnRules(opList.fnArray as unknown as number[], opList.argsArray, (pdfjsLib as any).OPS, 8, viewport.width);
                                            } catch { /* text-only PDF — heuristic fallback */ }
                                            const foundPos = findNamePosition(data.name, rows, headerDeltas, columnRules);

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

    // [New] Set Canvas dimensions safely (canvas lives inside the sign modal now)
    useEffect(() => {
        if (showSignModal && canvasRef.current) {
            const canvas = canvasRef.current;
            // Standard internal resolution for consistency
            canvas.width = 600;
            canvas.height = 200;
            setCanvasHeight(200);
            setHasSigned(false);
        }
    }, [showSignModal]);

    // [New] Render ALL PDF pages onto their own canvases (scrollable multi-page view)
    useEffect(() => {
        if (!pdfDoc || pdfLoadingError || numPages === 0) return; // Don't render if error
        let cancelled = false;
        const render = async () => {
            for (let p = 1; p <= numPages; p++) {
                const canvas = pageCanvasRefs.current[p - 1];
                if (!canvas) continue;
                const context = canvas.getContext('2d');
                if (!context) continue;

                const page = await pdfDoc.getPage(p);
                const containerWidth = canvas.parentElement?.clientWidth || 300;
                const viewport = page.getViewport({ scale: 1 });
                const scale = containerWidth / viewport.width;
                if (p === 1) setRenderScale(scale); // page 1 scale drives the signature overlay
                const scaledViewport = page.getViewport({ scale });

                // Render at the device pixel ratio so the page is crisp on
                // high-DPI (mobile) screens instead of an upscaled low-res
                // bitmap. Backing store is dpr× bigger in both dims; CSS keeps
                // it at container width (width:100%, height:auto).
                const dpr = Math.min(window.devicePixelRatio || 1, 3);
                canvas.width = Math.floor(scaledViewport.width * dpr);
                canvas.height = Math.floor(scaledViewport.height * dpr);

                await page.render({
                    canvasContext: context,
                    viewport: scaledViewport,
                    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
                }).promise;
                if (cancelled) return;
            }
        };
        render();
        return () => { cancelled = true; };
    }, [pdfDoc, numPages, pdfLoadingError]); // Overlay is a separate div, so no re-render needed on submit

    // Reset zoom whenever a new document loads.
    useEffect(() => { resetZoom(); }, [pdfDoc]);

    // [Zoom] Native touch listeners (registered once — reads/writes go through
    // refs so gesture handling doesn't need to re-subscribe on every frame).
    // Two fingers pinch to scale; one finger pans once zoomed in; a quick
    // double-tap toggles zoom. touchmove must be non-passive to preventDefault
    // the page's own scroll/zoom while a gesture is active.
    useEffect(() => {
        const el = previewScrollRef.current;
        if (!el) return;

        const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
        const clamp = (z: number) => Math.min(4, Math.max(1, z));

        const gesture = {
            mode: 'none' as 'none' | 'pinch' | 'pan',
            startDist: 0, startZoom: 1,
            startX: 0, startY: 0, startPanX: 0, startPanY: 0,
            lastTapTime: 0,
        };

        const onStart = (e: TouchEvent) => {
            if (e.touches.length === 2) {
                gesture.mode = 'pinch';
                gesture.startDist = dist(e.touches);
                gesture.startZoom = zoomValRef.current;
            } else if (e.touches.length === 1) {
                const now = Date.now();
                if (now - gesture.lastTapTime < 300) {
                    gesture.lastTapTime = 0;
                    gesture.mode = 'none';
                    if (zoomValRef.current > 1) resetZoom(); else setZoom(2.2);
                    return;
                }
                gesture.lastTapTime = now;
                if (zoomValRef.current > 1) {
                    gesture.mode = 'pan';
                    gesture.startX = e.touches[0].clientX;
                    gesture.startY = e.touches[0].clientY;
                    gesture.startPanX = panValRef.current.x;
                    gesture.startPanY = panValRef.current.y;
                } else {
                    gesture.mode = 'none'; // not zoomed — let the container scroll normally
                }
            }
        };

        const onMove = (e: TouchEvent) => {
            if (gesture.mode === 'pinch' && e.touches.length === 2) {
                e.preventDefault();
                setZoom(clamp(gesture.startZoom * (dist(e.touches) / gesture.startDist)));
            } else if (gesture.mode === 'pan' && e.touches.length === 1) {
                e.preventDefault();
                setPan({
                    x: gesture.startPanX + (e.touches[0].clientX - gesture.startX),
                    y: gesture.startPanY + (e.touches[0].clientY - gesture.startY),
                });
            }
        };

        const onEnd = (e: TouchEvent) => { if (e.touches.length === 0) gesture.mode = 'none'; };

        el.addEventListener('touchstart', onStart, { passive: true });
        el.addEventListener('touchmove', onMove, { passive: false });
        el.addEventListener('touchend', onEnd, { passive: true });
        el.addEventListener('touchcancel', onEnd, { passive: true });
        return () => {
            el.removeEventListener('touchstart', onStart);
            el.removeEventListener('touchmove', onMove);
            el.removeEventListener('touchend', onEnd);
            el.removeEventListener('touchcancel', onEnd);
        };
    }, []);

    // [New] After submit, scroll the signature location into view so the signer sees where it landed
    useEffect(() => {
        if (!submitted || !namePos) return;
        const doScroll = () => signatureMarkerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Retry a few times so it lands after the success banner appears and layout settles
        const timers = [200, 600, 1100].map((ms) => setTimeout(doScroll, ms));
        return () => timers.forEach(clearTimeout);
    }, [submitted, namePos, renderScale]);

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

        // [Modified] Random thickness 50% ~ 90% (v1.4.2)
        const baseWidth = 12;
        // If thicknessRef is not set, init it. Ideally satisfy React purity by using a ref init effect, 
        // but lazy init in handler is also fine or init in a useEffect.
        // Let's use a ref specifically for this session.
        if (!thicknessRef.current) {
            thicknessRef.current = 0.5 + Math.random() * 0.4; // 0.5 ~ 0.9
        }

        ctx.lineWidth = baseWidth * thicknessRef.current;
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
        if (!hasSigned) {
            showToast("서명을 입력해주세요.", "error");
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
            setShowSignModal(false);
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
                @keyframes sig-pulse {
                    0% { box-shadow: 0 0 0 0 rgba(16,185,129,0.55); }
                    100% { box-shadow: 0 0 0 14px rgba(16,185,129,0); }
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
                {/* Success Banner v0.7.1 */}
                {submitted && (
                    <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #10b981', padding: '1.5rem', borderRadius: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)', position: 'relative' }}>
                        <div style={{ fontSize: '2rem' }}>✅</div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#065f46' }}>서명이 성공적으로 제출되었습니다!</h2>
                        <a href="/" target="_blank" style={{ margin: '0.5rem 0', padding: '0.75rem', backgroundColor: '#3b82f6', color: '#fff', borderRadius: '0.5rem', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.95rem', boxShadow: '0 2px 4px rgba(59,130,246,0.3)', transition: 'transform 0.2s', display: 'inline-block' }}>
                            🚀 나도 받아야 할 서명이 있다면? (무료 시작하기)
                        </a>
                        <p style={{ color: '#047857', fontSize: '0.9rem' }}>아래 미리보기에서 서명 위치를 확인하실 수 있습니다. 확인 후 <b>이 창을 닫아주세요.</b></p>
                        <span style={{ position: 'absolute', bottom: '5px', right: '10px', fontSize: '0.6rem', color: '#10b981', opacity: 0.5 }}>v1.4.2</span>
                    </div>
                )}
                {/* 1. Main PDF Preview */}
                <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '0.8rem', position: 'relative' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#64748b' }}>
                        서명할 문서 확인 (Preview)
                        <span style={{ color: '#ef4444', marginLeft: '8px', fontSize: '0.8rem' }}>
                            {submitted ? "※ 서명 위치가 실제와 약간 차이가 있을 수 있습니다" : "※ 서명란은 페이지 맨 아래에 있습니다"}
                        </span>
                        {pdfDoc && !pdfLoadingError && (
                            <span style={{ display: 'block', color: '#94a3b8', fontSize: '0.75rem', marginTop: '2px', fontWeight: 'normal' }}>
                                손가락 두 개로 확대·축소, 더블탭으로 확대/원복
                            </span>
                        )}
                    </label>
                    <div
                        ref={previewScrollRef}
                        style={{
                            width: '100%',
                            maxHeight: '75vh',
                            overflowY: zoom > 1 ? 'hidden' : 'auto',
                            overflowX: 'hidden',
                            touchAction: zoom > 1 ? 'none' : 'pan-y',
                            backgroundColor: '#f1f5f9',
                            borderRadius: '0.5rem',
                            border: '1px solid #e2e8f0',
                            position: 'relative',
                            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.08)',
                            padding: (pdfDoc && !pdfLoadingError) ? '0.75rem' : 0,
                        }}>
                        {/* [Zoom] Everything scales/pans together inside this wrapper;
                            the scroll container above stays fixed-size. */}
                        <div style={{
                            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                            transformOrigin: 'center top',
                            transition: 'transform 0.12s ease-out',
                            willChange: 'transform',
                        }}>
                        {/* Canvas Layer - Render every page (scrollable) */}
                        {(pdfDoc && !pdfLoadingError) && Array.from({ length: numPages }).map((_, idx) => (
                            <div
                                key={idx}
                                style={{
                                    position: 'relative',
                                    marginBottom: idx < numPages - 1 ? '0.75rem' : 0,
                                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                                    borderRadius: '0.5rem',
                                    overflow: 'visible',
                                    backgroundColor: '#fff',
                                }}
                            >
                                <canvas
                                    ref={(el) => { pageCanvasRefs.current[idx] = el; }}
                                    style={{ width: '100%', height: 'auto', display: 'block', borderRadius: '0.5rem' }}
                                />
                                {numPages > 1 && (
                                    <span style={{ position: 'absolute', top: '6px', right: '8px', fontSize: '0.7rem', color: '#94a3b8', backgroundColor: 'rgba(255,255,255,0.85)', padding: '1px 6px', borderRadius: '999px', pointerEvents: 'none' }}>
                                        {idx + 1} / {numPages}
                                    </span>
                                )}

                                {/* Real-time Signature Overlay on page 1 (Only works if name detection succeeded) */}
                                {idx === 0 && (submitted || hasSigned) && namePos && !pdfLoadingError && (
                                    <div ref={signatureMarkerRef} style={{
                                        position: 'absolute',
                                        // Centering logic with 60x15 slimmer size (v1.0.3) + meeting offset applied
                                        left: `${(namePos.x + namePos.w / 2 + namePos.delta) * renderScale - (30 * meetingScale * renderScale) + meetingOffsetX}px`,
                                        top: `${(pageHeight - namePos.y) * renderScale - (12 * meetingScale * renderScale) + meetingOffsetY}px`,
                                        width: `${60 * meetingScale * renderScale}px`,
                                        height: `${15 * meetingScale * renderScale}px`,
                                        pointerEvents: 'none',
                                        zIndex: 10,
                                        outline: submitted ? '2px solid #10b981' : 'none',
                                        outlineOffset: '3px',
                                        borderRadius: '2px',
                                        animation: submitted ? 'sig-pulse 1.4s ease-out 3' : 'none',
                                    }}>
                                        <img
                                            src={localStorage.getItem('lastSignature') || requestData.signatureUrl || ''}
                                            style={{ width: '100%', height: '100%', mixBlendMode: 'multiply', opacity: 0.9 }}
                                            alt="Sign Preview"
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                        </div>
                        {/* Fallback Layer - If canvas fails or loading */}
                        {(pdfLoadingError || (!pdfDoc && !isCanvasLoading)) && (
                            <iframe
                                src={`https://docs.google.com/viewer?url=${encodeURIComponent(requestData.mainPdfUrl)}&embedded=true`}
                                style={{ width: '100%', height: '75vh', border: 'none', borderRadius: '0.5rem', display: 'block' }}
                                title="Primary PDF Fallback"
                            />
                        )}

                        {!pdfDoc && !pdfLoadingError && isCanvasLoading && (
                            <div style={{ minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', color: '#94a3b8' }}>
                                <div className="spinner"></div>
                                <div>문서를 불러오고 있습니다...</div>
                            </div>
                        )}
                    </div>

                    {/* [Zoom] Floating controls — pinch/double-tap work, but not
                        every viewer discovers a gesture, so give buttons too. */}
                    {pdfDoc && !pdfLoadingError && (
                        <div style={{
                            position: 'absolute', right: '1.5rem', bottom: '1.5rem', zIndex: 20,
                            display: 'flex', flexDirection: 'column', gap: '0.4rem',
                        }}>
                            {zoom > 1 && (
                                <button
                                    type="button"
                                    onClick={resetZoom}
                                    style={{ width: '2.2rem', height: '2.2rem', borderRadius: '999px', border: '1px solid #e2e8f0', backgroundColor: 'rgba(255,255,255,0.95)', color: '#334155', fontSize: '0.65rem', fontWeight: 'bold', boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'pointer' }}
                                >{Math.round(zoom * 100)}%</button>
                            )}
                            <button
                                type="button"
                                onClick={() => setZoom(z => Math.min(4, z + 0.5))}
                                style={{ width: '2.2rem', height: '2.2rem', borderRadius: '999px', border: '1px solid #e2e8f0', backgroundColor: 'rgba(255,255,255,0.95)', color: '#334155', fontSize: '1.2rem', lineHeight: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'pointer' }}
                            >＋</button>
                            <button
                                type="button"
                                onClick={() => setZoom(z => {
                                    const next = Math.max(1, z - 0.5);
                                    if (next === 1) setPan({ x: 0, y: 0 });
                                    return next;
                                })}
                                style={{ width: '2.2rem', height: '2.2rem', borderRadius: '999px', border: '1px solid #e2e8f0', backgroundColor: 'rgba(255,255,255,0.95)', color: '#334155', fontSize: '1.2rem', lineHeight: 1, boxShadow: '0 2px 6px rgba(0,0,0,0.15)', cursor: 'pointer' }}
                            >－</button>
                        </div>
                    )}
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

            </main>

            {/* Confirm button (replaces the old checkbox) - opens the signature popup */}
            {!submitted && (
                <footer style={{ padding: '1.5rem', backgroundColor: '#fff', borderTop: '1px solid #e2e8f0', position: 'sticky', bottom: 0, boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
                    <button
                        onClick={() => setShowSignModal(true)}
                        style={{ display: 'block', width: '100%', maxWidth: '1000px', margin: '0 auto', padding: '1rem', backgroundColor: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1.1rem', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 2px 6px rgba(59,130,246,0.35)' }}
                    >
                        ✔ 위 내용(첨부파일 포함) 모두 확인함 · 서명하기
                    </button>
                </footer>
            )}

            {/* Signature Popup Modal */}
            {showSignModal && !submitted && (
                <div
                    style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                    onClick={() => setShowSignModal(false)}
                >
                    <div
                        style={{ backgroundColor: '#fff', borderRadius: '1rem', padding: '1.5rem', width: 'min(520px, 94vw)', display: 'flex', flexDirection: 'column', gap: '1rem', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', position: 'relative' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <h3 style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#1e40af', margin: 0 }}>{requestData.name}님, 서명해 주세요</h3>
                                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.35rem 0 0' }}>아래 칸에 꽉 차게 서명해 주세요.</p>
                            </div>
                            <button onClick={() => setShowSignModal(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }} aria-label="닫기">×</button>
                        </div>

                        <div style={{ backgroundColor: '#f1f5f9', borderRadius: '0.75rem', border: '2px dashed #cbd5e1', overflow: 'hidden', position: 'relative', height: `${canvasHeight}px` }}>
                            <canvas
                                ref={canvasRef}
                                style={{ touchAction: 'none', width: '100%', height: '100%' }}
                                onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                                onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                            />
                        </div>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                                style={{ flex: 1, padding: '0.9rem 0.4rem', backgroundColor: '#eff6ff', color: '#3b82f6', border: '1px solid #bfdbfe', borderRadius: '0.75rem', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                ↺ 이전 서명 불러오기
                            </button>
                            <button
                                onClick={handleClear}
                                style={{ flex: 1, padding: '0.9rem 0.4rem', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '0.75rem', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}
                            >
                                🧹 깨끗이(다시)
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={!hasSigned}
                                style={{ flex: 1.4, padding: '0.9rem 0.4rem', backgroundColor: hasSigned ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '0.9rem', fontWeight: 'bold', cursor: hasSigned ? 'pointer' : 'not-allowed' }}
                            >
                                서명 제출하기
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
