"use client";

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { subscribeToConfig, AppConfig } from "@/lib/config-service";
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { PDFDocument } from 'pdf-lib';

export default function SignPage() {
    const params = useParams();
    const id = params?.id as string;

    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<AppConfig | null>(null);
    const [requestData, setRequestData] = useState<any>(null);
    const [submitted, setSubmitted] = useState(false);
    const [isChecked, setIsChecked] = useState(false);
    const [txtContent, setTxtContent] = useState<string | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasSignature, setHasSignature] = useState(false);

    // [New] Dynamic aspect ratio for PDF preview
    const [pdfAspectRatio, setPdfAspectRatio] = useState<number | null>(null);

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
                            }
                        } catch (e) {
                            console.error("Meeting fetch error:", e);
                        }
                    }

                    if (data.status === 'signed') {
                        setSubmitted(true);
                    }

                    setRequestData(data);
                } else {
                    console.error("Request not found:", id);
                }
            } catch (error: any) {
                console.error("Fetch error:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchRequest();
    }, [id]);

    // [New] Fetch PDF and calculate aspect ratio
    useEffect(() => {
        if (!requestData?.mainPdfUrl) return;

        const fetchPdfMetadata = async () => {
            try {
                const response = await fetch(requestData.mainPdfUrl);
                const arrayBuffer = await response.arrayBuffer();
                const pdfDoc = await PDFDocument.load(arrayBuffer);
                const page = pdfDoc.getPages()[0];
                const { width, height } = page.getSize();
                // Google Viewer Toolbar 높이(약 60px) 및 여백을 고려하여 높이를 줄임 (비율 값 증가)
                // 1.15배는 실험적 수치 (높이 약 13% 감소 효과)
                setPdfAspectRatio((width / height) * 1.15);
            } catch (e) {
                console.error("Failed to load PDF metadata", e);
                // Fallback to A4ish if failed
                setPdfAspectRatio((1 / 1.414) * 1.15);
            }

        };
        fetchPdfMetadata();
    }, [requestData?.mainPdfUrl]);

    // [New] Handle .txt attachment content
    useEffect(() => {
        if (requestData?.attachmentUrl && requestData.attachmentUrl.toLowerCase().includes('.txt')) {
            fetch(requestData.attachmentUrl)
                .then(res => res.text())
                .then(text => setTxtContent(text))
                .catch(err => console.error("Txt fetch error:", err));
        }
    }, [requestData?.attachmentUrl]);

    // [New] Set Canvas dimensions safely (3:1 ratio)
    useEffect(() => {
        if (!loading && requestData && canvasRef.current) {
            const canvas = canvasRef.current;
            const width = canvas.offsetWidth || window.innerWidth - 48;
            canvas.width = width;
            canvas.height = Math.floor(width / 3); // 3:1 비율
            setHasSignature(false); // 초기화
        }
    }, [loading, requestData]);

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
        const { offsetX, offsetY } = getCoordinates(e, canvas);

        ctx.lineWidth = 4; // 얇게 조정
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
            checkSignature();
        }
    };

    const getCoordinates = (e: any, canvas: HTMLCanvasElement) => {
        if (e.touches && e.touches[0]) {
            const rect = canvas.getBoundingClientRect();
            return {
                offsetX: e.touches[0].clientX - rect.left,
                offsetY: e.touches[0].clientY - rect.top
            };
        }
        return { offsetX: e.nativeEvent.offsetX, offsetY: e.nativeEvent.offsetY };
    };

    const handleClear = () => {
        const canvas = canvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            ctx?.clearRect(0, 0, canvas.width, canvas.height);
            setHasSignature(false);
        }
    };

    const checkSignature = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const pixels = imageData.data;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] > 0) {
                setHasSignature(true);
                return;
            }
        }
        setHasSignature(false);
    };

    const getAuditData = async () => {
        let ip = "Unknown";
        try {
            const res = await fetch('https://api.ipify.org?format=json');
            const data = await res.json();
            ip = data.ip;
        } catch (e) { console.error("IP fetch failed", e); }

        let location = null;
        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
            });
            location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        } catch (e) {
            console.warn("Location permission denied or failed", e);
        }

        const nav = (navigator as any);
        const connection = nav.connection || nav.mozConnection || nav.webkitConnection;

        return {
            ip,
            userAgent: navigator.userAgent,
            screen: {
                width: window.screen.width,
                height: window.screen.height,
                dpr: window.devicePixelRatio
            },
            network: connection ? {
                effectiveType: connection.effectiveType,
                downlink: connection.downlink,
                rtt: connection.rtt
            } : null,
            location,
            os: (navigator as any).platform || "Unknown"
        };
    };

    const handleSubmit = async () => {
        if (!canvasRef.current) return;
        if (!isChecked) {
            alert("안내사항을 확인하고 체크해주세요.");
            return;
        }

        const signatureDataUrl = canvasRef.current.toDataURL('image/png');

        localStorage.setItem('lastSignature', signatureDataUrl);

        try {
            const auditData = await getAuditData();

            await updateDoc(doc(db, "requests", id), {
                status: 'signed',
                signedAt: serverTimestamp(),
                signatureUrl: signatureDataUrl,
                auditData: auditData
            });
            setSubmitted(true);
        } catch (error) {
            console.error(error);
            alert("서명 제출 실패");
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

    if (submitted) return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', color: '#fff', textAlign: 'center', padding: '1.2rem' }}>
            <h1 style={{ fontSize: '4rem', marginBottom: '1.5rem' }}>✅</h1>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem' }}>서명이 성공적으로 제출되었습니다!</h2>
            <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginBottom: '1rem', lineHeight: '1.6' }}>
                문서 처리가 완료되었습니다.<br />
                보안을 위해 <b>브라우저 탭(창)을 직접 닫아주세요.</b>
            </p>
        </div>
    );

    return (
        <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc', display: 'flex', flexDirection: 'column', color: '#0f172a' }}>
            <header style={{ padding: '1.5rem', borderBottom: '1px solid #e2e8f0', backgroundColor: '#fff', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#3b82f6' }}>
                    {requestData.name}님에게 서명 요청 왔습니다.
                </h1>
            </header>

            <main style={{ flex: 1, padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
                {/* 1. Main PDF Preview */}
                <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '1rem', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                    <label style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#64748b' }}>서명할 문서 확인 (Preview)</label>
                    <div style={{
                        width: '100%',
                        minHeight: '300px',
                        // Auto-adjust height based on aspect ratio, maxing out at 80vh to prevent too long scrolling
                        aspectRatio: pdfAspectRatio ? `${pdfAspectRatio}` : '1 / 1.4',
                        backgroundColor: '#f8fafc',
                        borderRadius: '0.5rem',
                        border: '1px solid #e2e8f0',
                        overflow: 'hidden'
                    }}>
                        {requestData.mainPdfUrl ? (
                            <iframe
                                src={`https://docs.google.com/viewer?url=${encodeURIComponent(requestData.mainPdfUrl)}&embedded=true`}
                                style={{ width: '100%', height: '100%', border: 'none' }}
                                title="Main PDF Preview"
                            />
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>문서를 불러올 수 없습니다. 원본을 다운로드하여 확인해 주세요.</div>
                        )}
                    </div>
                </div>

                {/* 2. Attachment (Embedded) */}
                {requestData.attachmentUrl && (
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

                {/* 3. Signature Area */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ marginBottom: '1rem', padding: '1.5rem', backgroundColor: '#eff6ff', borderRadius: '1rem', border: '2px solid #3b82f6', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <input type="checkbox" id="confirmCheck" checked={isChecked} onChange={(e) => setIsChecked(e.target.checked)} style={{ width: '24px', height: '24px', accentColor: '#3b82f6', cursor: 'pointer' }} />
                        <label htmlFor="confirmCheck" style={{ fontSize: '1rem', fontWeight: 'bold', color: '#1e40af', cursor: 'pointer', flex: 1 }}>
                            위 내용(첨부파일 포함)을 모두 확인하였으며, 이에 서명합니다.
                        </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>아래 입력칸에 꽉 차게 서명해 주세요</label>
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
                                            checkSignature();
                                        }
                                    };
                                    img.src = saved;
                                } else { alert("저장된 서명이 없습니다."); }
                            }}
                            style={{ fontSize: '0.8rem', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer' }}
                        >
                            ↺ 이전 서명 불러오기
                        </button>
                    </div>

                    <div style={{ backgroundColor: '#fff', borderRadius: '1rem', border: '2px solid #cbd5e1', overflow: 'hidden', position: 'relative', maxWidth: '600px', margin: '0 auto', width: '100%' }}>
                        <canvas
                            ref={canvasRef}
                            style={{ touchAction: 'none', width: '100%', height: '100%' }}
                            onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing}
                            onTouchStart={startDrawing} onTouchMove={draw} onTouchEnd={stopDrawing}
                        />
                    </div>
                    <button onClick={handleClear} style={{ marginTop: '0.5rem', alignSelf: 'flex-end', fontSize: '0.8rem', color: '#64748b', background: 'none', border: 'none', textDecoration: 'underline' }}>Clear</button>
                </div>
            </main>

            <footer style={{ padding: '1.5rem', backgroundColor: '#fff', borderTop: '1px solid #e2e8f0' }}>
                <button
                    onClick={handleSubmit}
                    disabled={!isChecked || !hasSignature}
                    style={{ width: '100%', padding: '1rem', backgroundColor: (isChecked && hasSignature) ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1.1rem', fontWeight: 'bold', cursor: (isChecked && hasSignature) ? 'pointer' : 'not-allowed' }}
                >
                    서명 제출하기
                </button>
                <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.7rem', color: '#cbd5e1' }}>v0.1.1 (Rev.3)</div>
            </footer>

        </div>
    );
}

