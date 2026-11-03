"use client";

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { getRecentWaiverForms, RecentForm } from '@/lib/waiver-service';

const cards = [
    { href: '/forms/waiver', icon: '📝', title: '성적 이의신청 포기원', desc: '내장 서식. 명단만 붙여넣으면 학생마다 이름·학년·반·번호가 들어간 문서가 만들어집니다.' },
    { href: '/forms/pdf?mode=common', icon: '📄', title: '한 장 PDF에 서명 받기', desc: '가정통신문 회신처럼 전체가 같은 문서. 학생·보호자 서명 칸과 참여/불참 칸을 자동으로 찾고, 학번·성명·날짜를 채워 줍니다.' },
    { href: '/forms/pdf?mode=each', icon: '📚', title: '학생별 PDF에 서명 받기', desc: '교외체험학습 결과보고서처럼 학생마다 다른 문서. 여러 PDF를 한꺼번에 올리면 문서 속 성명·학년반번호로 학생을 찾습니다.' },
];

export default function FormsHome() {
    const { user, loading } = useAuth();
    const [recent, setRecent] = useState<RecentForm[]>([]);

    useEffect(() => {
        if (!user) return;
        getRecentWaiverForms(user.uid).then(setRecent).catch(console.error);
    }, [user]);

    if (loading) return <div style={{ padding: '2rem', color: '#cbd5e1' }}>불러오는 중...</div>;
    return (
        <div style={{ minHeight: '100vh', color: '#e2e8f0', background: '#0f172a' }}>
            <header style={{ padding: '0.8rem 1.5rem', borderBottom: '1px solid #334155', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <Link href="/" style={{ color: '#93c5fd', textDecoration: 'none', fontSize: '0.9rem' }}>← SignsCheck</Link>
                <h1 style={{ fontSize: '1.1rem', margin: 0 }}>학생·보호자 서명</h1>
            </header>
            <main style={{ maxWidth: 1000, margin: '0 auto', padding: '1.25rem', display: 'grid', gap: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '1rem' }}>
                    {cards.map(c => (
                        <Link key={c.href} href={c.href} style={{ textDecoration: 'none', color: 'inherit', background: 'rgba(30,41,59,0.7)', border: '1px solid #334155', borderRadius: '0.9rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <span style={{ fontSize: '1.8rem' }}>{c.icon}</span>
                            <b>{c.title}</b>
                            <span style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.6 }}>{c.desc}</span>
                        </Link>
                    ))}
                </div>
                {user && recent.length > 0 && (
                    <section style={{ background: 'rgba(30,41,59,0.7)', border: '1px solid #334155', borderRadius: '0.9rem', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                        <b style={{ fontSize: '0.9rem' }}>이전에 만든 서식</b>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {recent.map(r => (
                                <Link key={r.id} href={r.formType === 'waiver' ? `/forms/waiver?id=${r.id}` : `/forms/pdf?id=${r.id}`}
                                    style={{ color: '#cbd5e1', border: '1px solid #475569', borderRadius: '0.5rem', padding: '0.4rem 0.7rem', fontSize: '0.8rem', textDecoration: 'none' }}>
                                    {r.fileName} · {r.createdAt ? new Date(r.createdAt).toLocaleDateString('ko-KR') : ''}
                                </Link>
                            ))}
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}
