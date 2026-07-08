"use client";

import { useAuth } from "@/lib/auth-context";

export default function LoginModal() {
    const { user, loading, signInWithGoogle } = useAuth();

    if (loading) return null; // Don't show anything while checking auth status
    if (user) return null; // Don't show if already logged in

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(15, 23, 42, 0.8)', // Darkened background
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
        }}>
            <div className="glass-panel" style={{
                padding: '3rem',
                maxWidth: '400px',
                width: '90%',
                textAlign: 'center',
                border: '1px solid hsla(var(--primary) / 0.3)',
                boxShadow: '0 0 50px rgba(59, 130, 246, 0.2)'
            }}>
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>👋 환영합니다</h2>
                <p style={{ color: '#cbd5e1', marginBottom: '1rem', lineHeight: 1.6 }}>
                    <b>서명 요청을 만들려면 로그인이 필요합니다.</b>
                </p>
                <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '2rem', lineHeight: 1.7, textAlign: 'left' }}>
                    회의록·참석자 명단 등 <b style={{ color: '#cbd5e1' }}>민감한 정보를 안전하게 보호</b>하기 위해 로그인이 필요합니다.<br />
                    로그인하면 내가 만든 회의·서명 기록이 <b style={{ color: '#cbd5e1' }}>내 계정에만 연결</b>되어, 다른 사람은 볼 수 없습니다.
                </p>

                <button
                    onClick={signInWithGoogle}
                    className="btn-primary"
                    style={{
                        backgroundColor: '#fff',
                        color: '#000',
                        position: 'relative',
                        overflow: 'hidden'
                    }}
                >
                    <span style={{ fontSize: '1.2rem', marginRight: '0.5rem' }}>G</span>
                    구글 계정으로 로그인
                </button>

                <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1.5rem' }}>
                    회의 주최자(교직원) 전용 · 참석자는 로그인 없이 서명 가능합니다
                </p>
            </div>
        </div>
    );
}
