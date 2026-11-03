"use client";

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useNotification } from '@/lib/NotificationContext';
import WaiverDocument from '@/components/WaiverDocument';
import {
    WaiverParams, defaultParams, parseRoster, signLink, ROLE_LABEL, WaiverRole,
} from '@/lib/waiver-form';
import {
    createWaiverBatch, getWaiverForm, getWaiverRows, getRecentWaiverForms, WaiverStudentRow, RecentForm,
} from '@/lib/waiver-service';

const card: React.CSSProperties = { background: 'rgba(30,41,59,0.7)', border: '1px solid #334155', borderRadius: '0.9rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' };
const input: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
const label: React.CSSProperties = { fontSize: '0.78rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: '0.25rem' };
const btnPrimary: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.6rem', padding: '0.8rem 1.2rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#cbd5e1', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' };

export default function WaiverHostPage() {
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    const { showToast } = useNotification();

    const [params, setParams] = useState<WaiverParams>(defaultParams());
    const [rosterText, setRosterText] = useState('');
    const [requireOrder, setRequireOrder] = useState(true);
    const [creating, setCreating] = useState(false);

    const [formId, setFormId] = useState<string | null>(null);
    const [rows, setRows] = useState<WaiverStudentRow[]>([]);
    const [onlyPending, setOnlyPending] = useState(false);
    const [recent, setRecent] = useState<RecentForm[]>([]);
    const fileRef = useRef<HTMLInputElement>(null);

    const roster = useMemo(() => parseRoster(rosterText), [rosterText]);
    const set = (k: keyof WaiverParams) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setParams(p => ({ ...p, [k]: e.target.value }));

    const refresh = useCallback(async (id: string) => {
        try { setRows(await getWaiverRows(id)); } catch (e) { console.error(e); }
    }, []);

    const openForm = useCallback(async (id: string) => {
        const f = await getWaiverForm(id);
        if (!f) { showToast('서식을 찾을 수 없습니다.', 'error'); return; }
        setParams(f.params); setRequireOrder(f.requireOrder); setFormId(id);
        window.history.replaceState(null, '', `?id=${id}`);
        refresh(id);
    }, [refresh, showToast]);

    // 최근 목록 + ?id= 복원
    useEffect(() => {
        if (!user) return;
        getRecentWaiverForms(user.uid).then(setRecent).catch(console.error);
        const id = new URLSearchParams(window.location.search).get('id');
        if (id) openForm(id);
    }, [user, openForm]);

    // 8초마다 서명 현황 갱신
    useEffect(() => {
        if (!formId) return;
        const t = setInterval(() => refresh(formId), 8000);
        return () => clearInterval(t);
    }, [formId, refresh]);

    const handleFile = async (f: File | undefined) => {
        if (!f) return;
        setRosterText(await f.text());
    };

    const handleCreate = async () => {
        if (!user) return;
        if (roster.students.length === 0) { showToast('학생 명단을 입력해 주세요.', 'error'); return; }
        if (roster.errors.length > 0) { showToast('명단의 오류 줄을 먼저 고쳐 주세요.', 'error'); return; }
        setCreating(true);
        try {
            const id = await createWaiverBatch({
                hostUid: user.uid, hostName: user.displayName || '담당자', params, students: roster.students, requireOrder,
            });
            setFormId(id);
            window.history.replaceState(null, '', `?id=${id}`);
            await refresh(id);
            getRecentWaiverForms(user.uid).then(setRecent).catch(console.error);
            showToast(`${roster.students.length}명 서명 링크를 만들었습니다.`, 'success');
        } catch (e) {
            console.error(e);
            showToast('생성에 실패했습니다. 다시 시도해 주세요.', 'error');
        } finally { setCreating(false); }
    };

    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const copy = async (text: string, msg = '복사했습니다.') => {
        try { await navigator.clipboard.writeText(text); showToast(msg, 'success'); }
        catch { showToast('복사에 실패했습니다.', 'error'); }
    };

    const shown = onlyPending ? rows.filter(r => r.student?.status !== 'signed' || r.guardian?.status !== 'signed') : rows;
    const doneCount = rows.filter(r => r.student?.status === 'signed' && r.guardian?.status === 'signed').length;
    const linkLines = (role: WaiverRole, list: WaiverStudentRow[]) =>
        list.map(r => { const q = r[role]; return q ? `${r.grade}-${r.classNo}-${r.number} ${r.name}\t${signLink(origin, q.id)}` : ''; }).filter(Boolean).join('\n');

    const downloadCsv = () => {
        const head = '학년,반,번호,이름,학생서명,학생링크,보호자서명,보호자서명자,보호자링크';
        const lines = rows.map(r => [
            r.grade, r.classNo, r.number, r.name,
            r.student?.status === 'signed' ? '완료' : '대기', r.student ? signLink(origin, r.student.id) : '',
            r.guardian?.status === 'signed' ? '완료' : '대기', r.guardian?.signerName ?? '', r.guardian ? signLink(origin, r.guardian.id) : '',
        ].join(','));
        const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '성적이의신청포기원_링크_현황.csv'; a.click();
        URL.revokeObjectURL(a.href);
    };

    const badge = (s?: string) => (
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: s === 'signed' ? '#34d399' : '#fbbf24' }}>{s === 'signed' ? '✓ 완료' : '· 대기'}</span>
    );

    const previewStudent = roster.students[0] ?? { grade: 3, classNo: 4, number: 8, name: '박민혁' };

    if (authLoading) return <div style={{ padding: '2rem', color: '#cbd5e1' }}>불러오는 중...</div>;

    return (
        <div style={{ minHeight: '100vh', color: '#e2e8f0', background: '#0f172a' }}>
            <header style={{ padding: '0.8rem 1.5rem', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Link href="/forms" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: '0.9rem' }}>← 서식 선택</Link>
                <h1 style={{ fontSize: '1.1rem', margin: 0 }}>성적 이의신청 포기원 · 개인 서식형</h1>
            </header>

            {!user ? (
                <div style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p>서명 링크를 만들려면 로그인이 필요합니다.</p>
                    <button style={btnPrimary} onClick={signInWithGoogle}>Google로 로그인</button>
                </div>
            ) : (
                <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1.25rem' }}>
                    {recent.length > 0 && (
                        <section style={card}>
                            <b style={{ fontSize: '0.9rem' }}>이전에 만든 서식</b>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                {recent.map(r => (
                                    <button key={r.id} style={{ ...btnGhost, borderColor: r.id === formId ? '#3b82f6' : '#475569' }} onClick={() => (r.formType === 'pdfform' ? (window.location.href = `/forms/pdf?id=${r.id}`) : openForm(r.id))}>
                                        {r.fileName} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString('ko-KR') : ''}
                                    </button>
                                ))}
                            </div>
                        </section>
                    )}

                    {!formId && (
                        <>
                            <section style={card}>
                                <b>1. 서식 내용</b>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '0.8rem' }}>
                                    <label style={label}>학교명<input style={input} value={params.schoolName} onChange={set('schoolName')} /></label>
                                    <label style={label}>정기시험 차수<input style={input} value={params.round} onChange={set('round')} /></label>
                                    <label style={label}>문서 날짜<input style={input} value={params.docDate} onChange={set('docDate')} /></label>
                                    <label style={label}>교외체험학습 시작<input style={input} value={params.expStart} onChange={set('expStart')} /></label>
                                    <label style={label}>교외체험학습 끝<input style={input} value={params.expEnd} onChange={set('expEnd')} /></label>
                                    <label style={label}>일수<input style={input} value={params.expDays} onChange={set('expDays')} /></label>
                                </div>
                                <label style={label}>관련 규정<textarea style={{ ...input, minHeight: 90, resize: 'vertical' }} value={params.regulation} onChange={set('regulation')} /></label>
                            </section>

                            <section style={card}>
                                <b>2. 학생 명단</b>
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    한 줄에 한 명. 엑셀에서 <b>학년·반·번호·이름</b> 열을 복사해 붙여넣거나 CSV/TXT 파일을 불러오세요. (예: <code>3 4 8 박민혁</code>, <code>30408 박민혁</code>)
                                </div>
                                <textarea style={{ ...input, minHeight: 140, fontFamily: 'monospace' }} value={rosterText} onChange={e => setRosterText(e.target.value)} placeholder={'3\t4\t8\t박민혁\n3\t4\t9\t김하늘'} />
                                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <input ref={fileRef} type="file" accept=".csv,.txt,.tsv,text/plain" style={{ display: 'none' }} onChange={e => handleFile(e.target.files?.[0])} />
                                    <button style={btnGhost} onClick={() => fileRef.current?.click()}>파일 불러오기</button>
                                    <span style={{ fontSize: '0.85rem', color: roster.errors.length ? '#f87171' : '#34d399' }}>
                                        인식 {roster.students.length}명{roster.errors.length ? ` · 오류 ${roster.errors.length}줄` : ''}
                                    </span>
                                </div>
                                {roster.errors.length > 0 && (
                                    <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: '#fca5a5' }}>
                                        {roster.errors.slice(0, 8).map(er => <li key={er.line}>{er.line}번째 줄 “{er.text}” — {er.reason}</li>)}
                                        {roster.errors.length > 8 && <li>… 외 {roster.errors.length - 8}건</li>}
                                    </ul>
                                )}
                            </section>

                            <section style={card}>
                                <b>3. 서명 순서</b>
                                <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.9rem' }}>
                                    <input type="checkbox" checked={requireOrder} onChange={e => setRequireOrder(e.target.checked)} />
                                    학생이 먼저 서명한 뒤에 보호자 서명 링크가 열리게 하기 (권장)
                                </label>
                            </section>

                            <section style={card}>
                                <b>미리보기 (서명 칸 위치)</b>
                                <div style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
                                    <WaiverDocument params={params} student={previewStudent} highlight="student" />
                                </div>
                            </section>

                            <button style={{ ...btnPrimary, opacity: creating || roster.students.length === 0 ? 0.6 : 1 }} disabled={creating || roster.students.length === 0} onClick={handleCreate}>
                                {creating ? '만드는 중...' : `🚀 ${roster.students.length}명 서명 링크 만들기`}
                            </button>
                        </>
                    )}

                    {formId && (
                        <section style={card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                                <b>서명 현황 — 완료 {doneCount} / {rows.length}명 {requireOrder && <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: '0.8rem' }}>(학생 → 보호자 순서)</span>}</b>
                                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                                    <button style={btnGhost} onClick={() => refresh(formId)}>↻ 새로고침</button>
                                    <label style={{ ...btnGhost, display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                                        <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />미완료만
                                    </label>
                                    <button style={btnGhost} onClick={() => copy(linkLines('student', shown), '학생 링크를 복사했습니다.')}>학생 링크 전체 복사</button>
                                    <button style={btnGhost} onClick={() => copy(linkLines('guardian', shown), '보호자 링크를 복사했습니다.')}>보호자 링크 전체 복사</button>
                                    <button style={btnGhost} onClick={downloadCsv}>CSV 저장</button>
                                    <button style={btnGhost} onClick={() => { setFormId(null); setRows([]); window.history.replaceState(null, '', window.location.pathname); }}>새 서식 만들기</button>
                                </div>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                                    <thead>
                                        <tr style={{ color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #334155' }}>
                                            <th style={{ padding: '0.4rem' }}>학년-반-번호</th><th>이름</th>
                                            <th>{ROLE_LABEL.student}</th><th></th><th>{ROLE_LABEL.guardian}</th><th>보호자 서명자</th><th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {shown.map(r => (
                                            <tr key={r.key} style={{ borderBottom: '1px solid #1e293b' }}>
                                                <td style={{ padding: '0.4rem' }}>{r.grade}-{r.classNo}-{r.number}</td>
                                                <td>{r.name}</td>
                                                <td>{badge(r.student?.status)}</td>
                                                <td>{r.student && <button style={btnGhost} onClick={() => copy(signLink(origin, r.student!.id))}>링크</button>}</td>
                                                <td>{badge(r.guardian?.status)}</td>
                                                <td style={{ color: '#cbd5e1' }}>{r.guardian?.signerName ?? ''}</td>
                                                <td>{r.guardian && <button style={btnGhost} onClick={() => copy(signLink(origin, r.guardian!.id))}>링크</button>}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}
                </main>
            )}
        </div>
    );
}
