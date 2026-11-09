"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { uploadToBlob } from '@/lib/blob-storage';
import { useAuth } from '@/lib/auth-context';
import { useNotification } from '@/lib/NotificationContext';
import FormStatusPanel from '@/components/FormStatusPanel';
import { parseRoster, WaiverStudent } from '@/lib/waiver-form';
import {
    adaptPdfJsItems, applyNudges, detectFormLayout, extractIdentity, FormLayout, FormField,
} from '@/lib/pdf-form-detect';
import { composePage, renderFirstPage, studentNoText } from '@/lib/pdf-form-compose';
import { createPdfFormBatch, getPdfForm, PdfFormStudent } from '@/lib/pdf-form-service';
import { getWaiverRows, WaiverStudentRow } from '@/lib/waiver-service';

const card: React.CSSProperties = { background: 'rgba(30,41,59,0.7)', border: '1px solid #334155', borderRadius: '0.9rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' };
const input: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.9rem', width: '100%', boxSizing: 'border-box' };
const btnPrimary: React.CSSProperties = { background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.6rem', padding: '0.8rem 1.2rem', fontWeight: 700, fontSize: '1rem', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#cbd5e1', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.35rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' };

interface Analyzed {
    file: File;
    layout: FormLayout;
    identity: { name: string; grade: number; classNo: number; number: number } | null;
    manual: string; // 인식 실패 시 교사가 입력하는 "3 4 9 홍길동"
}

const FIELD_NAME: Record<string, string> = {
    'sign-student': '학생 서명', 'sign-guardian': '보호자 서명', choice: '참여/불참 표시',
    'text-studentNo': '학번·성명', 'text-month': '월·일',
};
// 같이 움직이는 자동 기입 칸
const GROUP: Record<string, string[]> = {
    'text-studentNo': ['text-studentNo', 'text-name'],
    'text-month': ['text-month', 'text-day'],
};
const STEP = 2; // 포인트

function PdfFormHost() {
    const { user, loading: authLoading, signInWithGoogle } = useAuth();
    const { showToast } = useNotification();
    const mode: 'common' | 'each' = useSearchParams().get('mode') === 'each' ? 'each' : 'common';

    const [analyzed, setAnalyzed] = useState<Analyzed[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [rosterText, setRosterText] = useState('');
    const [nudges, setNudges] = useState<Record<string, { dx: number; dy: number }>>({});
    const requireOrder = false; // 서명 순서 제한 없음
    const [creating, setCreating] = useState(false);
    const [progress, setProgress] = useState('');

    const [formId, setFormId] = useState<string | null>(null);
    const [formMeta, setFormMeta] = useState<{ fileName: string; hasChoice: boolean; requireOrder: boolean } | null>(null);
    const [rows, setRows] = useState<WaiverStudentRow[]>([]);

    const baseCanvas = useRef<HTMLCanvasElement | null>(null);
    const previewRef = useRef<HTMLCanvasElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    const roster = useMemo(() => parseRoster(rosterText), [rosterText]);
    const baseLayout = analyzed[0]?.layout ?? null;
    const layout = useMemo(() => (baseLayout ? applyNudges(baseLayout, nudges) : null), [baseLayout, nudges]);

    // 업로드한 PDF 분석 (브라우저에서만: 파일은 아직 서버로 올라가지 않음)
    const analyze = async (files: File[]) => {
        setAnalyzing(true);
        try {
            const out: Analyzed[] = [];
            let first = true;
            for (const file of files) {
                const r = await renderFirstPage(await file.arrayBuffer(), 900);
                const items = adaptPdfJsItems(r.items, r.pageHeight);
                if (first) { baseCanvas.current = r.canvas; first = false; }
                out.push({ file, layout: detectFormLayout(items, r.pageWidth, r.pageHeight), identity: extractIdentity(items), manual: '' });
            }
            setAnalyzed(out);
            setNudges({});
            if (out[0] && !out[0].layout.fields.some(f => f.kind === 'sign')) {
                showToast('서명 칸("학생 … (인)", "보호자 … (인)")을 찾지 못했습니다. 서식을 확인해 주세요.', 'error');
            }
        } catch (e) {
            console.error(e);
            showToast('PDF를 읽지 못했습니다.', 'error');
        } finally { setAnalyzing(false); }
    };

    const onPick = (list: FileList | null) => {
        if (!list || list.length === 0) return;
        const files = Array.from(list).filter(f => f.name.toLowerCase().endsWith('.pdf'));
        if (files.length === 0) { showToast('PDF 파일만 올릴 수 있습니다. 한글에서 "PDF로 저장"해 주세요.', 'error'); return; }
        analyze(mode === 'common' ? files.slice(0, 1) : files);
    };

    // 위치 확인 미리보기: 서명 칸·표시·자동 기입 글자를 예시 값으로 그려서 보여 준다
    useEffect(() => {
        if (!layout || !baseCanvas.current || !previewRef.current) return;
        const s = roster.students[0] ?? analyzed[0]?.identity ?? { grade: 3, classNo: 4, number: 9, name: '홍길동' };
        composePage(previewRef.current, baseCanvas.current, layout, {
            highlight: 'student',
            studentSig: null,
            choice: '참여',
            texts: { studentNo: studentNoText(s.grade, s.classNo, s.number), name: s.name, month: '11', day: '3' },
        });
    }, [layout, roster.students, analyzed]);

    const nudge = (id: string, dx: number, dy: number) =>
        setNudges(n => {
            const next = { ...n };
            for (const k of GROUP[id] ?? [id]) next[k] = { dx: (n[k]?.dx ?? 0) + dx, dy: (n[k]?.dy ?? 0) + dy };
            return next;
        });

    // 학생별(each) 모드: 인식 결과 + 수동 입력으로 최종 학생 목록 만들기
    const eachStudents = useMemo(() => analyzed.map(a => {
        if (a.identity) return { ok: true as const, s: a.identity as WaiverStudent };
        const p = parseRoster(a.manual);
        return p.students.length === 1 ? { ok: true as const, s: p.students[0] } : { ok: false as const, s: null };
    }), [analyzed]);
    const dupKeys = useMemo(() => {
        const seen = new Set<string>(), dup = new Set<string>();
        for (const e of eachStudents) if (e.ok) { const k = `${e.s.grade}-${e.s.classNo}-${e.s.number}`; if (seen.has(k)) dup.add(k); seen.add(k); }
        return dup;
    }, [eachStudents]);

    const refresh = useCallback(async (id: string) => { try { setRows(await getWaiverRows(id)); } catch (e) { console.error(e); } }, []);

    const openForm = useCallback(async (id: string) => {
        const f = await getPdfForm(id);
        if (!f) { showToast('서식을 찾을 수 없습니다.', 'error'); return; }
        setFormId(id);
        setFormMeta({ fileName: f.fileName, hasChoice: !!f.layout?.fields.some(x => x.kind === 'choice'), requireOrder: f.requireOrder });
        refresh(id);
    }, [refresh, showToast]);

    useEffect(() => {
        if (!user) return;
        const id = new URLSearchParams(window.location.search).get('id');
        if (id) openForm(id);
    }, [user, openForm]);

    useEffect(() => {
        if (!formId) return;
        const t = setInterval(() => refresh(formId), 8000);
        return () => clearInterval(t);
    }, [formId, refresh]);

    const upload = async (file: File, tag: string): Promise<string> => {
        return uploadToBlob('meetings', new File([file], `${tag}_${file.name}`, { type: file.type }));
    };

    const canCreate = analyzed.length > 0 && !!layout?.fields.some(f => f.kind === 'sign') &&
        (mode === 'common' ? roster.students.length > 0 && roster.errors.length === 0 : eachStudents.every(e => e.ok) && dupKeys.size === 0);

    const handleCreate = async () => {
        if (!user || !layout || !canCreate) return;
        setCreating(true);
        try {
            let students: PdfFormStudent[];
            let pdfUrl: string | undefined;
            if (mode === 'common') {
                setProgress('PDF 올리는 중...');
                pdfUrl = await upload(analyzed[0].file, 'common');
                students = roster.students;
            } else {
                students = [];
                for (let i = 0; i < analyzed.length; i++) {
                    setProgress(`PDF 올리는 중... ${i + 1} / ${analyzed.length}`);
                    const e = eachStudents[i];
                    if (!e.ok) throw new Error('인식되지 않은 파일이 있습니다.');
                    students.push({ ...e.s, pdfUrl: await upload(analyzed[i].file, String(i)), layout: applyNudges(analyzed[i].layout, nudges) });
                }
            }
            setProgress('링크 만드는 중...');
            const name = mode === 'common' ? analyzed[0].file.name.replace(/\.pdf$/i, '') : '학생별 서식';
            const id = await createPdfFormBatch({
                hostUid: user.uid, hostName: user.displayName || '담당자', fileName: name, mode,
                pdfUrl, layout: mode === 'common' ? layout : undefined, requireOrder, students,
            });
            window.history.replaceState(null, '', `?mode=${mode}&id=${id}`);
            await openForm(id);
            showToast(`${students.length}명 서명 링크를 만들었습니다.`, 'success');
        } catch (e) {
            console.error(e);
            const msg = String((e as { code?: string })?.code ?? '').includes('quota')
                ? 'PDF를 올리지 못했습니다. 로그인 상태와 파일 크기(20MB 이하)를 확인해 주세요.'
                : '생성에 실패했습니다. 다시 시도해 주세요.';
            showToast(msg, 'error');
        } finally { setCreating(false); setProgress(''); }
    };

    const title = mode === 'common' ? '한 장 PDF에 서명 받기 (가정통신문형)' : '학생별 PDF에 서명 받기 (결과보고서형)';
    if (authLoading) return <div style={{ padding: '2rem', color: '#cbd5e1' }}>불러오는 중...</div>;

    return (
        <div style={{ minHeight: '100vh', color: '#e2e8f0', background: '#0f172a' }}>
            <header style={{ padding: '0.8rem 1.5rem', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Link href="/forms" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: '0.9rem' }}>← 서식 선택</Link>
                <h1 style={{ fontSize: '1.1rem', margin: 0 }}>{title}</h1>
            </header>

            {!user ? (
                <div style={{ maxWidth: 480, margin: '4rem auto', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <p>서명 링크를 만들려면 로그인이 필요합니다.</p>
                    <button style={btnPrimary} onClick={signInWithGoogle}>Google로 로그인</button>
                </div>
            ) : (
                <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1.25rem' }}>
                    {formId && formMeta ? (
                        <FormStatusPanel
                            formId={formId} title={formMeta.fileName} rows={rows} requireOrder={formMeta.requireOrder} showChoice={formMeta.hasChoice}
                            onRefresh={() => refresh(formId)}
                            onNew={() => { setFormId(null); setRows([]); setAnalyzed([]); setRosterText(''); window.history.replaceState(null, '', `?mode=${mode}`); }}
                        />
                    ) : (
                        <>
                            <section style={card}>
                                <b>1. PDF 올리기</b>
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                    {mode === 'common'
                                        ? '전체 학생에게 같은 문서를 보낼 때. PDF 1장을 올립니다.'
                                        : '학생마다 내용이 다른 문서일 때. 학생 수만큼의 PDF를 한꺼번에 올립니다. (문서 안의 성명과 학년·반·번호로 학생을 자동으로 찾습니다)'}
                                    {' '}한글(HWP)은 <b>파일 → 다른 이름으로 저장 → PDF</b>로 저장해서 올려 주세요.
                                </div>
                                <input ref={fileRef} type="file" accept=".pdf,application/pdf" multiple={mode === 'each'} style={{ display: 'none' }} onChange={e => onPick(e.target.files)} />
                                <div><button style={btnPrimary} onClick={() => fileRef.current?.click()}>{analyzing ? '분석 중...' : analyzed.length ? 'PDF 다시 선택' : 'PDF 선택'}</button>
                                    {analyzed.length > 0 && <span style={{ marginLeft: '0.8rem', fontSize: '0.85rem', color: '#94a3b8' }}>{analyzed.length}개 파일</span>}</div>
                            </section>

                            {layout && (
                                <section style={card}>
                                    <b>2. 서명 칸 위치 확인</b>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                        자동으로 찾은 위치입니다. 어긋나 있으면 아래 화살표로 {STEP}pt씩 옮겨 주세요. (예시 글자·표시는 실제로는 학생이 서명할 때 들어갑니다)
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: '1rem', alignItems: 'start' }}>
                                        <canvas ref={previewRef} style={{ width: '100%', height: 'auto', background: '#fff', borderRadius: '0.4rem' }} />
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {layout.fields.filter((f: FormField) => f.kind !== 'text' || f.key === 'studentNo' || f.key === 'month').map(f => {
                                                const id = f.id;
                                                return (
                                                    <div key={id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem', fontSize: '0.82rem' }}>
                                                        <span>{FIELD_NAME[id] ?? id}</span>
                                                        <span style={{ display: 'flex', gap: '0.2rem' }}>
                                                            <button style={btnGhost} onClick={() => nudge(id, -STEP, 0)} aria-label="왼쪽">←</button>
                                                            <button style={btnGhost} onClick={() => nudge(id, 0, -STEP)} aria-label="위">↑</button>
                                                            <button style={btnGhost} onClick={() => nudge(id, 0, STEP)} aria-label="아래">↓</button>
                                                            <button style={btnGhost} onClick={() => nudge(id, STEP, 0)} aria-label="오른쪽">→</button>
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                            {!layout.fields.some(f => f.kind === 'choice') && (
                                                <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>이 서식에는 참여/불참 표가 없어 서명만 받습니다.</div>
                                            )}
                                        </div>
                                    </div>
                                </section>
                            )}

                            {analyzed.length > 0 && mode === 'common' && (
                                <section style={card}>
                                    <b>3. 학생 명단</b>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                        한 줄에 한 명. 엑셀에서 <b>학년·반·번호·이름</b>을 복사해 붙여넣으세요. 학번·성명 빈칸에 자동으로 들어갑니다.
                                    </div>
                                    <textarea style={{ ...input, minHeight: 140, fontFamily: 'monospace' }} value={rosterText} onChange={e => setRosterText(e.target.value)} placeholder={'3\t4\t8\t박민혁\n3\t4\t9\t김하늘'} />
                                    <span style={{ fontSize: '0.85rem', color: roster.errors.length ? '#f87171' : '#34d399' }}>
                                        인식 {roster.students.length}명{roster.errors.length ? ` · 오류 ${roster.errors.length}줄` : ''}
                                    </span>
                                    {roster.errors.length > 0 && (
                                        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: '#fca5a5' }}>
                                            {roster.errors.slice(0, 8).map(er => <li key={er.line}>{er.line}번째 줄 “{er.text}” — {er.reason}</li>)}
                                        </ul>
                                    )}
                                </section>
                            )}

                            {analyzed.length > 0 && mode === 'each' && (
                                <section style={card}>
                                    <b>3. 학생 확인 ({analyzed.length}개 파일)</b>
                                    <div style={{ overflowX: 'auto' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                            <thead><tr style={{ color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #334155' }}><th style={{ padding: '0.4rem' }}>파일</th><th>인식한 학생</th><th>서명 칸</th></tr></thead>
                                            <tbody>
                                                {analyzed.map((a, i) => {
                                                    const e = eachStudents[i];
                                                    const key = e.ok ? `${e.s.grade}-${e.s.classNo}-${e.s.number}` : '';
                                                    const signs = a.layout.fields.filter(f => f.kind === 'sign').length;
                                                    return (
                                                        <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                                                            <td style={{ padding: '0.4rem', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.file.name}</td>
                                                            <td>
                                                                {e.ok
                                                                    ? <span style={{ color: dupKeys.has(key) ? '#f87171' : '#34d399' }}>{e.s.grade}-{e.s.classNo}-{e.s.number} {e.s.name}{dupKeys.has(key) ? ' (중복)' : ''}</span>
                                                                    : <input style={{ ...input, width: 220 }} placeholder="인식 실패 — 예: 3 4 9 홍길동" value={a.manual}
                                                                        onChange={ev => setAnalyzed(list => list.map((x, j) => j === i ? { ...x, manual: ev.target.value } : x))} />}
                                                            </td>
                                                            <td style={{ color: signs === 2 ? '#34d399' : '#f87171' }}>{signs === 2 ? '✓ 학생·보호자' : `${signs}곳만 인식`}</td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            )}

                            {analyzed.length > 0 && (
                                <>
                                    <button style={{ ...btnPrimary, opacity: creating || !canCreate ? 0.6 : 1 }} disabled={creating || !canCreate} onClick={handleCreate}>
                                        {creating ? progress || '만드는 중...' : `🚀 ${mode === 'common' ? roster.students.length : analyzed.length}명 서명 링크 만들기`}
                                    </button>
                                </>
                            )}
                        </>
                    )}
                </main>
            )}
        </div>
    );
}

export default function Page() {
    return <Suspense fallback={<div style={{ padding: '2rem', color: '#cbd5e1' }}>불러오는 중...</div>}><PdfFormHost /></Suspense>;
}
