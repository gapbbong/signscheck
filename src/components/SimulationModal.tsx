"use client";

import React, { useEffect } from 'react';

interface SimulationModalProps {
    isOpen: boolean;
    onClose: () => void;
    links: string[];
}

export default function SimulationModal({ isOpen, onClose, links }: SimulationModalProps) {
    // Add effect to handle ESC key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            window.addEventListener('keydown', handleKeyDown);
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            onClick={onClose} // [New] Close on clicking backdrop
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                backdropFilter: 'blur(5px)'
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()} // [New] Prevent close when clicking modal content
                style={{
                    backgroundColor: '#1e293b',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '1rem',
                    padding: '2rem',
                    width: '90%',
                    maxWidth: '600px',
                    color: '#fff',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}
            >
                <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    🚀 전송 완료! (Simulation)
                </h2>
                <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>
                    아래 링크를 생성했습니다.<br />
                    전체를 복사해서 메신저로 전달해 보세요.
                </p>

                <div style={{
                    backgroundColor: '#0f172a',
                    padding: '1rem',
                    borderRadius: '0.5rem',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    border: '1px solid #334155',
                    fontFamily: 'monospace',
                    fontSize: '0.9rem'
                }}>
                    {links.map((link, index) => (
                        <div key={index} style={{ marginBottom: '0.8rem', paddingBottom: '0.8rem', borderBottom: '1px solid #1e293b' }}>
                            <div style={{ color: '#60a5fa', marginBottom: '0.2rem' }}>{link.split(':')[0]}</div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    readOnly
                                    value={link.split(': ')[1] || link.split(':')[1]}
                                    style={{
                                        flex: 1,
                                        backgroundColor: '#1e293b',
                                        border: 'none',
                                        color: '#cbd5e1',
                                        padding: '0.3rem',
                                        borderRadius: '0.3rem',
                                        outline: 'none'
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        const url = link.split(': ')[1] || link.split(':')[1];
                                        navigator.clipboard.writeText(url);
                                        alert("복사되었습니다!");
                                    }}
                                    style={{
                                        backgroundColor: '#3b82f6',
                                        color: '#fff',
                                        border: 'none',
                                        padding: '0.3rem 0.8rem',
                                        borderRadius: '0.3rem',
                                        cursor: 'pointer',
                                        fontSize: '0.8rem'
                                    }}
                                >
                                    Copy
                                </button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer Buttons */}
                <div style={{
                    marginTop: '2rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                }}>
                    {/* Copy All Button */}
                    <button
                        onClick={() => {
                            // Sort links alphabetically by name (part before ':')
                            const sortedLinks = [...links].sort((a, b) => {
                                const nameA = a.split(':')[0].trim();
                                const nameB = b.split(':')[0].trim();
                                return nameA.localeCompare(nameB, 'ko');
                            });

                            const allText = sortedLinks.map(l => {
                                const parts = l.split(': ');
                                const name = parts[0];
                                const url = parts[1] || "";
                                return `${name}\n${url}`;
                            }).join('\n\n') + '\n';

                            navigator.clipboard.writeText(allText);
                            alert("메신저 최적화 가나다순 복사가 완료되었습니다! 📋");
                        }}
                        style={{
                            backgroundColor: '#0f172a',
                            color: '#cbd5e1',
                            border: '1px solid #334155',
                            padding: '0.8rem 1.5rem',
                            borderRadius: '0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        📋 전체 복사
                    </button>

                    <button
                        onClick={onClose}
                        style={{
                            backgroundColor: '#fff',
                            color: '#0f172a',
                            border: 'none',
                            padding: '0.8rem 2rem',
                            borderRadius: '0.5rem',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        닫기
                    </button>
                </div>
            </div>
        </div>
    );
}
