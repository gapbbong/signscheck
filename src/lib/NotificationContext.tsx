"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface Toast {
    id: string;
    message: string;
    type: 'info' | 'success' | 'error';
}

interface ConfirmRequest {
    message: string;
    resolve: (value: boolean) => void;
}

interface PromptRequest {
    message: string;
    defaultValue?: string;
    resolve: (value: string | null) => void;
}

interface NotificationContextType {
    showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
    confirm: (message: string) => Promise<boolean>;
    prompt: (message: string, defaultValue?: string) => Promise<string | null>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
    const [promptReq, setPromptReq] = useState<PromptRequest | null>(null);
    const [promptValue, setPromptValue] = useState('');

    const showToast = useCallback((message: string, type: 'info' | 'success' | 'error' = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        setToasts((prev: Toast[]) => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts((prev: Toast[]) => prev.filter(t => t.id !== id));
        }, 3000);
    }, []);

    const confirm = useCallback((message: string): Promise<boolean> => {
        return new Promise((resolve) => {
            setConfirmReq({ message, resolve });
        });
    }, []);

    const prompt = useCallback((message: string, defaultValue: string = ''): Promise<string | null> => {
        return new Promise((resolve) => {
            setPromptValue(defaultValue);
            setPromptReq({ message, defaultValue, resolve });
        });
    }, []);

    const handleConfirmResponse = (value: boolean) => {
        if (confirmReq) {
            confirmReq.resolve(value);
            setConfirmReq(null);
        }
    };

    const handlePromptResponse = (value: string | null) => {
        if (promptReq) {
            promptReq.resolve(value);
            setPromptReq(null);
        }
    };

    return (
        <NotificationContext.Provider value={{ showToast, confirm, prompt }}>
            {children}

            {/* Toast Container */}
            <div style={{ position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, display: 'flex', flexDirection: 'column', gap: '8px', pointerEvents: 'none' }}>
                {toasts.map((t: Toast) => (
                    <div key={t.id} style={{
                        background: t.type === 'error' ? '#ef4444' : (t.type === 'success' ? '#22c55e' : '#1e293b'),
                        color: '#fff',
                        padding: '12px 24px',
                        borderRadius: '8px',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
                        fontSize: '14px',
                        fontWeight: 500,
                        animation: 'pop-up 0.3s ease-out',
                        pointerEvents: 'auto',
                        minWidth: '200px',
                        textAlign: 'center'
                    }}>
                        {t.message}
                    </div>
                ))}
            </div>

            {/* Confirm Dialog */}
            {confirmReq && (
                <ConfirmDialog
                    message={confirmReq.message}
                    onResponse={handleConfirmResponse}
                />
            )}

            {/* Prompt Dialog */}
            {promptReq && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                    <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '90%', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', animation: 'pop-in 0.2s ease-out' }}>
                        <p style={{ color: '#f1f5f9', fontSize: '16px', marginBottom: '16px', textAlign: 'center' }}>{promptReq.message}</p>
                        <input
                            autoFocus
                            value={promptValue}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPromptValue(e.target.value)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === 'Enter') handlePromptResponse(promptValue);
                                if (e.key === 'Escape') handlePromptResponse(null);
                            }}
                            style={{
                                width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #334155', background: '#0f172a', color: '#fff', marginBottom: '24px', outline: 'none'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={() => handlePromptResponse(null)}
                                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
                            >
                                취소
                            </button>
                            <button
                                onClick={() => handlePromptResponse(promptValue)}
                                style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'linear-gradient(to right, #60a5fa, #a855f7)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                            >
                                확인
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <style jsx global>{`
        @keyframes pop-up {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes pop-in {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
        </NotificationContext.Provider>
    );
}

function ConfirmDialog({ message, onResponse }: { message: string, onResponse: (v: boolean) => void }) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onResponse(true);
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                onResponse(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onResponse]);

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '90%', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', animation: 'pop-in 0.2s ease-out' }}>
                <p style={{ color: '#f1f5f9', fontSize: '16px', marginBottom: '24px', textAlign: 'center', whiteSpace: 'pre-wrap' }}>{message}</p>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button
                        onClick={() => onResponse(false)}
                        style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #334155', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontWeight: 600 }}
                    >
                        취소
                    </button>
                    <button
                        onClick={() => onResponse(true)}
                        style={{ flex: 1, padding: '10px', borderRadius: '8px', border: 'none', background: 'linear-gradient(to right, #60a5fa, #a855f7)', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
                    >
                        확인
                    </button>
                </div>
            </div>
        </div>
    );
}

export const useNotification = () => {
    const context = useContext(NotificationContext);
    if (!context) throw new Error('useNotification must be used within NotificationProvider');
    return context;
}
