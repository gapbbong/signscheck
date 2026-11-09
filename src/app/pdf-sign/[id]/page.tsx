"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useNotification } from '@/lib/NotificationContext';
import SignaturePad from '@/components/SignaturePad';
import { FormLayout } from '@/lib/pdf-form-detect';
import { canvasToPdfBlob, composePage, monthDayKST, renderFirstPage, studentNoText } from '@/lib/pdf-form-compose';
import { ROLE_LABEL, WaiverRole, isRole } from '@/lib/waiver-form';

interface Side { status: string; signatureUrl: string | null; choice: string | null; signedAt: Date | null; }
interface Loaded {
    role: WaiverRole;
    studentName: string;
    grade: number; classNo: number; number: number;
    title: string;
    pdfUrl: string;
    layout: FormLayout;
    requireOrder: boolean;
    own: Side;
    pair: Side | null;
}

const page: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column' };
const side = (d: Record<string, unknown> | undefined): Side => ({
    status: (d?.status as string) ?? 'pending',
    signatureUrl: (d?.signatureUrl as string) ?? null,
    choice: (d?.choice as string) ?? null,
    signedAt: (d?.signedAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null,
});

export default function PdfSignPage() {
    const id = (useParams()?.id as string) || '';
    const { showToast } = useNotification();

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [baseReady, setBaseReady] = useState(false);
    const [renderError, setRenderError] = useState(false);

    const [showPad, setShowPad] = useState(false);
    const [sig, setSig] = useState<string | null>(null);
    const [choice, setChoice] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const baseRef = useRef<HTMLCanvasElement | null>(null);
    const viewRef = useRef<HTMLCanvasElement>(null);

    const load = useCallback(async () => {
        try {
            const reqSnap = await getDoc(doc(db, 'requests', id));
            const r = reqSnap.data();
            if (!r || r.formType !== 'pdfform' || !isRole(r.role)) { setError('요청을 찾을 수 없습니다. 링크를 다시 확인해 주세요.'); return; }
            const mSnap = await getDoc(doc(db, 'meetings', r.meetingId));
            const m = mSnap.data();
            if (!m) { setError('서식 정보를 찾을 수 없습니다.'); return; }
            const pdfUrl: string = r.pdfUrl || m.pdfUrl;
            const layoutJson: string = r.layout || m.formLayout;
            if (!pdfUrl || !layoutJson) { setError('문서 정보가 올바르지 않습니다.'); return; }
            const pair = r.pairId ? (await getDoc(doc(db, 'requests', r.pairId))).data() : undefined;
            setData({
                role: r.role, studentName: r.studentName, grade: r.grade, classNo: r.classNo, number: r.number,
                title: String(m.fileName ?? '서식').replace(/\s*\(\d+명\)$/, ''),
                pdfUrl, layout: JSON.parse(layoutJson), requireOrder: m.requireOrder !== false,
                own: side(r), pair: pair ? side(pair) : null,
            });
        } catch (e) {
            console.error(e);
            setError('문서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally { setLoading(false); }
    }, [id]);

    useEffect(() => { if (id) load(); }, [id, load]);

    // 문서 첫 페이지 그리기 (프록시 경유: 기존 서명 화면과 같은 방식)
    const pdfUrl = data?.pdfUrl;
    useEffect(() => {
        if (!pdfUrl) return;
        let cancelled = false;
        renderFirstPage(`/api/proxy-pdf?url=${encodeURIComponent(pdfUrl)}`, 1200)
            .then(r => { if (cancelled) return; baseRef.current = r.canvas; setBaseReady(true); })
            .catch(e => { console.error(e); if (!cancelled) setRenderError(true); });
        return () => { cancelled = true; };
    }, [pdfUrl]);

    // 화면에 보이는 값 계산
    const view = (() => {
        if (!data) return null;
        const { role, own, pair } = data;
        const student = role === 'student' ? own : pair;
        const guardian = role === 'guardian' ? own : pair;
        const signed = own.status === 'signed';
        const waiting = false; // 서명 순서 제한 없음 (학생/보호자 누구든 먼저 가능)
        const studentSig = role === 'student' ? (sig ?? own.signatureUrl) : student?.signatureUrl ?? null;
        const guardianSig = role === 'guardian' ? (sig ?? own.signatureUrl) : guardian?.signatureUrl ?? null;
        const shownChoice = role === 'student' ? (choice ?? own.choice) : student?.choice ?? null;
        const when = student?.signedAt ?? new Date();
        const { month, day } = monthDayKST(when);
        return {
            signed, waiting, studentSig, guardianSig, shownChoice,
            texts: { studentNo: studentNoText(data.grade, data.classNo, data.number), name: data.studentName, month, day },
        };
    })();

    useEffect(() => {
        if (!data || !view || !baseReady || !baseRef.current || !viewRef.current) return;
        composePage(viewRef.current, baseRef.current, data.layout, {
            studentSig: view.studentSig, guardianSig: view.guardianSig, choice: view.shownChoice, texts: view.texts,
            highlight: view.signed || view.waiting ? null : data.role,
        }).catch(console.error);
    });

    if (loading) return <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>불러오는 중...</div>;
    if (error || !data || !view) return <div style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>{error ?? '요청을 찾을 수 없습니다.'}</div>;

    const { role, layout } = data;
    const hasChoice = role === 'student' && layout.fields.some(f => f.kind === 'choice');
    const canSubmit = !!sig && (!hasChoice || !!choice) && !submitting;

    const submit = async () => {
        if (!sig || !canSubmit) return;
        setSubmitting(true);
        try {
            try { localStorage.setItem('lastSignature', sig); } catch { /* 저장소 사용 불가 */ }
            await updateDoc(doc(db, 'requests', id), {
                status: 'signed',
                signedAt: serverTimestamp(),
                signatureUrl: sig,
                ...(hasChoice ? { choice } : {}),
                deviceInfo: navigator.userAgent,
                userAgent: navigator.userAgent,
            });
            setShowPad(false);
            await load();
        } catch (e) {
            console.error(e);
            showToast('서명 제출에 실패했습니다. 다시 시도해 주세요.', 'error');
        } finally { setSubmitting(false); }
    };

    const download = async () => {
        if (!viewRef.current || !baseRef.current || !view) return;
        // 화면에는 잘 보이는 색으로 보여주고, 저장하는 PDF에만 펜 종류가 무작위인 서명을 넣는다
        const out = document.createElement('canvas');
        await composePage(out, baseRef.current, layout, {
            studentSig: view.studentSig, guardianSig: view.guardianSig, choice: view.shownChoice, texts: view.texts,
            highlight: null, naturalInk: true,
        });
        const blob = await canvasToPdfBlob(out, layout.pageWidth, layout.pageHeight);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${data.title}_${data.studentName}.pdf`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <div style={page}>
            <header style={{ padding: '1.1rem', background: '#fff', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.05rem', margin: 0, color: '#2563eb' }}>
                    {data.studentName} 학생 · {data.title} · {ROLE_LABEL[role]} 서명
                </h1>
            </header>

            <main style={{ flex: 1, padding: '1rem', maxWidth: 820, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {view.signed && (
                    <div style={{ background: '#ecfdf5', border: '1px solid #10b981', borderRadius: '0.9rem', padding: '1.1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.8rem' }}>✅</div>
                        <b style={{ color: '#065f46' }}>{ROLE_LABEL[role]} 서명이 제출되었습니다.</b>
                        <div style={{ fontSize: '0.88rem', color: '#047857', marginTop: '0.3rem' }}>
                            {role === 'student' ? '이제 보호자님께 보호자용 링크를 전달해 주세요.' : '아래에서 서명 위치를 확인하고 창을 닫아 주세요.'}
                        </div>
                        <button onClick={download} style={{ marginTop: '0.6rem', padding: '0.5rem 0.9rem', borderRadius: '0.5rem', border: '1px solid #10b981', background: '#fff', color: '#065f46', fontWeight: 700, cursor: 'pointer' }}>
                            ⬇ 서명된 PDF 저장
                        </button>
                    </div>
                )}
                {view.waiting && (
                    <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '0.9rem', padding: '1rem', color: '#92400e', textAlign: 'center' }}>
                        학생이 아직 서명하지 않았습니다. 학생 서명이 끝나면 보호자 서명을 할 수 있습니다.
                        <div><button onClick={load} style={{ marginTop: '0.5rem', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #f59e0b', background: '#fff', cursor: 'pointer' }}>↻ 다시 확인</button></div>
                    </div>
                )}
                {!view.signed && !view.waiting && (
                    <div style={{ fontSize: '0.88rem', color: '#64748b', textAlign: 'center' }}>
                        내용을 읽고, 초록 점선 칸({ROLE_LABEL[role]} 서명란)에 서명이 들어갑니다.{hasChoice ? ' 참여 여부도 선택해 주세요.' : ''}
                    </div>
                )}

                <div style={{ background: '#fff', borderRadius: '0.5rem', boxShadow: '0 1px 4px rgba(0,0,0,0.15)', minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {renderError ? <div style={{ padding: '2rem', color: '#b91c1c' }}>문서를 불러오지 못했습니다. 새로고침해 주세요.</div>
                        : !baseReady ? <div style={{ padding: '2rem', color: '#94a3b8' }}>문서를 불러오고 있습니다...</div> : null}
                    <canvas ref={viewRef} style={{ width: '100%', height: 'auto', display: baseReady ? 'block' : 'none', borderRadius: '0.5rem' }} />
                </div>
            </main>

            {!view.signed && !view.waiting && (
                <footer style={{ position: 'sticky', bottom: 0, padding: '1rem', background: '#fff', borderTop: '1px solid #e2e8f0' }}>
                    <button onClick={() => setShowPad(true)} disabled={!baseReady} style={{ display: 'block', width: '100%', maxWidth: 820, margin: '0 auto', padding: '1rem', background: baseReady ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1.05rem', fontWeight: 700, cursor: baseReady ? 'pointer' : 'not-allowed' }}>
                        ✔ 내용을 확인했습니다 · 서명하기
                    </button>
                </footer>
            )}

            {showPad && !view.signed && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowPad(false)}>
                    <div style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: 'min(520px, 94vw)', display: 'flex', flexDirection: 'column', gap: '0.9rem' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0, color: '#1e40af' }}>{ROLE_LABEL[role]} 서명</h3>
                            <button onClick={() => setShowPad(false)} aria-label="닫기" style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#94a3b8', cursor: 'pointer' }}>×</button>
                        </div>
                        {hasChoice && (
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {['참여', '불참'].map(o => (
                                    <button key={o} onClick={() => setChoice(o)} style={{ flex: 1, padding: '0.8rem', borderRadius: '0.6rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer',
                                        border: choice === o ? '2px solid #2563eb' : '1px solid #cbd5e1', background: choice === o ? '#eff6ff' : '#fff', color: choice === o ? '#1d4ed8' : '#334155' }}>
                                        {o}
                                    </button>
                                ))}
                            </div>
                        )}
                        {/* 서명판 비율 = PDF의 서명 칸 비율 */}
                        <SignaturePad onChange={setSig} aspect={(() => {
                            const f = layout.fields.find(x => x.kind === 'sign' && x.role === role);
                            return f && f.kind === 'sign' && f.h > 0 ? f.w / f.h : 2.2;
                        })()} />
                        <button onClick={submit} disabled={!canSubmit} style={{ padding: '0.95rem', background: canSubmit ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1rem', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
                            {submitting ? '제출 중...' : hasChoice && !choice ? '참여 여부를 선택해 주세요' : '서명 제출하기'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
