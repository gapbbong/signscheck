"use client";

import { useState } from 'react';
import { useNotification } from '@/lib/NotificationContext';
import { WaiverStudentRow } from '@/lib/waiver-service';
import { ROLE_LABEL, WaiverRole } from '@/lib/waiver-form';

const btnGhost: React.CSSProperties = { background: 'transparent', color: '#cbd5e1', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' };

interface Props {
    formId: string;
    title: string;
    rows: WaiverStudentRow[];
    requireOrder: boolean;
    showChoice: boolean;
    onRefresh: () => void;
    onNew: () => void;
}

/** 학생·보호자 서명 현황 표 + 링크 복사/CSV (PDF 서식형 공용) */
export default function FormStatusPanel({ title, rows, requireOrder, showChoice, onRefresh, onNew }: Props) {
    const { showToast } = useNotification();
    const [onlyPending, setOnlyPending] = useState(false);
    const origin = typeof window !== 'undefined' ? window.location.origin : '';

    const copy = async (text: string, msg = '복사했습니다.') => {
        try { await navigator.clipboard.writeText(text); showToast(msg, 'success'); }
        catch { showToast('복사에 실패했습니다.', 'error'); }
    };
    const shown = onlyPending ? rows.filter(r => r.student?.status !== 'signed' || r.guardian?.status !== 'signed') : rows;
    const done = rows.filter(r => r.student?.status === 'signed' && r.guardian?.status === 'signed').length;
    const link = (id: string) => `${origin}/pdf-sign/${id}`;
    const lines = (role: WaiverRole) =>
        shown.map(r => { const q = r[role]; return q ? `${r.grade}-${r.classNo}-${r.number} ${r.name}\t${link(q.id)}` : ''; }).filter(Boolean).join('\n');
    const badge = (s?: string) => <span style={{ fontSize: '0.75rem', fontWeight: 700, color: s === 'signed' ? '#34d399' : '#fbbf24' }}>{s === 'signed' ? '✓ 완료' : '· 대기'}</span>;

    const downloadCsv = () => {
        const head = '학년,반,번호,이름,학생서명,참여여부,학생링크,보호자서명,보호자링크';
        const body = rows.map(r => [r.grade, r.classNo, r.number, r.name,
            r.student?.status === 'signed' ? '완료' : '대기', r.student?.choice ?? '', r.student ? link(r.student.id) : '',
            r.guardian?.status === 'signed' ? '완료' : '대기', r.guardian ? link(r.guardian.id) : ''].join(','));
        const blob = new Blob(['﻿' + [head, ...body].join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${title}_링크_현황.csv`; a.click();
        URL.revokeObjectURL(a.href);
    };

    return (
        <section style={{ background: 'rgba(30,41,59,0.7)', border: '1px solid #334155', borderRadius: '0.9rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
                <b>서명 현황 — 완료 {done} / {rows.length}명</b>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button style={btnGhost} onClick={onRefresh}>↻ 새로고침</button>
                    <label style={{ ...btnGhost, display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                        <input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} />미완료만
                    </label>
                    <button style={btnGhost} onClick={() => copy(lines('student'), '학생 링크를 복사했습니다.')}>학생 링크 전체 복사</button>
                    <button style={btnGhost} onClick={() => copy(lines('guardian'), '보호자 링크를 복사했습니다.')}>보호자 링크 전체 복사</button>
                    <button style={btnGhost} onClick={downloadCsv}>CSV 저장</button>
                    <button style={btnGhost} onClick={onNew}>새 서식 만들기</button>
                </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                    <thead>
                        <tr style={{ color: '#94a3b8', textAlign: 'left', borderBottom: '1px solid #334155' }}>
                            <th style={{ padding: '0.4rem' }}>학년-반-번호</th><th>이름</th>
                            <th>{ROLE_LABEL.student}</th>{showChoice && <th>참여</th>}<th></th><th>{ROLE_LABEL.guardian}</th><th></th><th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {shown.map(r => (
                            <tr key={r.key} style={{ borderBottom: '1px solid #1e293b' }}>
                                <td style={{ padding: '0.4rem' }}>{r.grade}-{r.classNo}-{r.number}</td>
                                <td>{r.name}</td>
                                <td>{badge(r.student?.status)}</td>
                                {showChoice && <td style={{ color: r.student?.choice === '불참' ? '#f87171' : '#cbd5e1' }}>{r.student?.choice ?? ''}</td>}
                                <td>{r.student && <button style={btnGhost} onClick={() => copy(link(r.student!.id))}>링크</button>}</td>
                                <td>{badge(r.guardian?.status)}</td>
                                <td>{r.guardian && <button style={btnGhost} onClick={() => copy(link(r.guardian!.id))}>링크</button>}</td>
                                <td>{r.student && <a href={link(r.student.id)} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd', fontSize: '0.8rem' }}>문서 보기</a>}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
