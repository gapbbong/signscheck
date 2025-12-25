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
                <h2 style={{ fontSize: '2rem', marginBottom: '1rem' }}>👋 Welcome Back</h2>
                <p style={{ color: '#94a3b8', marginBottom: '2rem' }}>
                    Please sign in to access your secure dashboard.
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
                    Sign in with Google
                </button>

                <p style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '1.5rem' }}>
                    Authorized Personnel Only
                </p>
            </div>
        </div>
    );
}
