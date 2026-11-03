"use client";

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useNotification } from '@/lib/NotificationContext';
import WaiverDocument from '@/components/WaiverDocument';
import SignaturePad from '@/components/SignaturePad';
import { WaiverParams, WaiverRole, WaiverStudent, ROLE_LABEL, isRole } from '@/lib/waiver-form';

interface Loaded {
    role: WaiverRole;
    status: 'pending' | 'signed' | 'rejected';
    student: WaiverStudent;
    params: WaiverParams;
    requireOrder: boolean;
    ownSignature: string | null;
    ownSignerName: string | null;
    pairId: string | null;
    pairStatus: string | null;
    pairSignature: string | null;
    pairSignerName: string | null;
}

const page: React.CSSProperties = { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', display: 'flex', flexDirection: 'column' };

export default function FormSignPage() {
    const id = (useParams()?.id as string) || '';
    const { showToast } = useNotification();

    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<Loaded | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [showPad, setShowPad] = useState(false);
    const [sig, setSig] = useState<string | null>(null);
    const [guardianName, setGuardianName] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback(async () => {
        try {
            const reqSnap = await getDoc(doc(db, 'requests', id));
            if (!reqSnap.exists() || reqSnap.data().formType !== 'waiver' || !isRole(reqSnap.data().role)) {
                setError('요청을 찾을 수 없습니다. 링크를 다시 확인해 주세요.'); return;
            }
            const r = reqSnap.data();
            const meetingSnap = await getDoc(doc(db, 'meetings', r.meetingId));
            if (!meetingSnap.exists()) { setError('서식 정보를 찾을 수 없습니다.'); return; }
            const m = meetingSnap.data();

            let pairStatus: string | null = null, pairSignature: string | null = null, pairSignerName: string | null = null;
            if (r.pairId) {
                const p = await getDoc(doc(db, 'requests', r.pairId));
                if (p.exists()) {
                    pairStatus = p.data().status ?? null;
                    pairSignature = p.data().signatureUrl ?? null;
                    pairSignerName = p.data().signerName ?? null;
                }
            }
            setData({
                role: r.role,
                status: r.status,
                student: { grade: r.grade, classNo: r.classNo, number: r.number, name: r.studentName },
                params: JSON.parse(m.formParams),
                requireOrder: m.requireOrder !== false,
                ownSignature: r.signatureUrl ?? null,
                ownSignerName: r.signerName ?? null,
                pairId: r.pairId ?? null,
                pairStatus, pairSignature, pairSignerName,
            });
        } catch (e) {
            console.error(e);
            setError('문서를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        } finally { setLoading(false); }
    }, [id]);

    useEffect(() => { if (id) load(); }, [id, load]);

    if (loading) return <div style={{ ...page, alignItems: 'center', justifyContent: 'center' }}>불러오는 중...</div>;
    if (error || !data) return <div style={{ ...page, alignItems: 'center', justifyContent: 'center', padding: '2rem', textAlign: 'center' }}>{error ?? '요청을 찾을 수 없습니다.'}</div>;

    const { role, student, params } = data;
    const signed = data.status === 'signed';
    const waitingForStudent = role === 'guardian' && data.requireOrder && data.pairStatus !== 'signed' && !signed;
    const studentSig = role === 'student' ? (sig ?? data.ownSignature) : data.pairSignature;
    const guardianSig = role === 'guardian' ? (sig ?? data.ownSignature) : data.pairSignature;
    const guardianShownName = role === 'guardian' ? (data.ownSignerName || guardianName.trim() || null) : data.pairSignerName;
    const needsName = role === 'guardian';
    const canSubmit = !!sig && (!needsName || guardianName.trim().length >= 2) && !submitting;

    const submit = async () => {
        if (!sig || !canSubmit) return;
        setSubmitting(true);
        try {
            try { localStorage.setItem('lastSignature', sig); } catch { /* 저장소 사용 불가 */ }
            await updateDoc(doc(db, 'requests', id), {
                status: 'signed',
                signedAt: serverTimestamp(),
                signatureUrl: sig,
                signerName: role === 'guardian' ? guardianName.trim() : student.name,
                deviceInfo: navigator.userAgent,
                userAgent: navigator.userAgent,
            });
            setData(d => d ? { ...d, status: 'signed', ownSignature: sig, ownSignerName: role === 'guardian' ? guardianName.trim() : student.name } : d);
            setShowPad(false);
        } catch (e) {
            console.error(e);
            showToast('서명 제출에 실패했습니다. 다시 시도해 주세요.', 'error');
        } finally { setSubmitting(false); }
    };

    return (
        <div style={page}>
            <style>{`@media print { .no-print { display: none !important; } body { background: #fff !important; } }`}</style>
            <header className="no-print" style={{ padding: '1.1rem', background: '#fff', borderBottom: '1px solid #e2e8f0', textAlign: 'center' }}>
                <h1 style={{ fontSize: '1.1rem', margin: 0, color: '#2563eb' }}>
                    {student.name} 학생의 성적 이의신청 포기원 · {ROLE_LABEL[role]} 서명
                </h1>
            </header>

            <main style={{ flex: 1, padding: '1rem', maxWidth: 820, margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {signed && (
                    <div className="no-print" style={{ background: '#ecfdf5', border: '1px solid #10b981', borderRadius: '0.9rem', padding: '1.1rem', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.8rem' }}>✅</div>
                        <b style={{ color: '#065f46' }}>{ROLE_LABEL[role]} 서명이 제출되었습니다.</b>
                        <div style={{ fontSize: '0.88rem', color: '#047857', marginTop: '0.3rem' }}>
                            {role === 'student' ? '이제 보호자님께 보호자용 링크를 전달해 주세요.' : '아래에서 서명 위치를 확인하고 창을 닫아 주세요.'}
                        </div>
                        <button onClick={() => window.print()} style={{ marginTop: '0.6rem', padding: '0.5rem 0.9rem', borderRadius: '0.5rem', border: '1px solid #10b981', background: '#fff', color: '#065f46', fontWeight: 700, cursor: 'pointer' }}>
                            🖨 인쇄 / PDF로 저장
                        </button>
                    </div>
                )}

                {waitingForStudent && (
                    <div className="no-print" style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '0.9rem', padding: '1rem', color: '#92400e', textAlign: 'center' }}>
                        학생이 아직 서명하지 않았습니다. 학생 서명이 끝나면 보호자 서명을 할 수 있습니다.
                        <div><button onClick={load} style={{ marginTop: '0.5rem', padding: '0.4rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #f59e0b', background: '#fff', cursor: 'pointer' }}>↻ 다시 확인</button></div>
                    </div>
                )}

                {!signed && !waitingForStudent && (
                    <div className="no-print" style={{ fontSize: '0.88rem', color: '#64748b', textAlign: 'center' }}>
                        내용을 읽고, 초록 점선 칸({ROLE_LABEL[role]} 서명란)에 서명이 들어갑니다.
                    </div>
                )}

                <WaiverDocument
                    params={params}
                    student={student}
                    studentSignature={studentSig}
                    guardianSignature={guardianSig}
                    guardianName={guardianShownName}
                    highlight={signed || waitingForStudent ? null : role}
                />
            </main>

            {!signed && !waitingForStudent && (
                <footer className="no-print" style={{ position: 'sticky', bottom: 0, padding: '1rem', background: '#fff', borderTop: '1px solid #e2e8f0' }}>
                    <button onClick={() => setShowPad(true)} style={{ display: 'block', width: '100%', maxWidth: 820, margin: '0 auto', padding: '1rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer' }}>
                        ✔ 내용을 확인했습니다 · 서명하기
                    </button>
                </footer>
            )}

            {showPad && !signed && (
                <div className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={() => setShowPad(false)}>
                    <div style={{ background: '#fff', borderRadius: '1rem', padding: '1.25rem', width: 'min(520px, 94vw)', display: 'flex', flexDirection: 'column', gap: '0.9rem' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <h3 style={{ margin: 0, color: '#1e40af' }}>{ROLE_LABEL[role]} 서명</h3>
                            <button onClick={() => setShowPad(false)} aria-label="닫기" style={{ background: 'none', border: 'none', fontSize: '1.4rem', color: '#94a3b8', cursor: 'pointer' }}>×</button>
                        </div>
                        {needsName && (
                            <label style={{ fontSize: '0.85rem', color: '#475569', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                보호자 성명
                                <input value={guardianName} onChange={e => setGuardianName(e.target.value)} placeholder="예: 박OO" style={{ padding: '0.7rem', border: '1px solid #cbd5e1', borderRadius: '0.5rem', fontSize: '1rem' }} />
                            </label>
                        )}
                        <SignaturePad onChange={setSig} />
                        <button onClick={submit} disabled={!canSubmit} style={{ padding: '0.95rem', background: canSubmit ? '#3b82f6' : '#94a3b8', color: '#fff', border: 'none', borderRadius: '0.75rem', fontSize: '1rem', fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed' }}>
                            {submitting ? '제출 중...' : '서명 제출하기'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
