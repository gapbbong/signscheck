"use client";

import { useState } from 'react';

interface Props {
    onFileSelected: (file: File) => void;
    currentStep?: number;
}

export default function UploadZone({ onFileSelected, currentStep = 1 }: Props) {
    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            const selected = e.dataTransfer.files[0];
            setFile(selected);
            onFileSelected(selected);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selected = e.target.files[0];
            setFile(selected);
            onFileSelected(selected);
        }
    };

    return (
        <section className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
            <div
                onDragOver={handleDragOver}
                onDragLeave={handleLeave}
                onDrop={handleDrop}
                style={{
                    border: '2px dashed ' + (isDragging ? '#3b82f6' : '#475569'),
                    borderRadius: '1rem',
                    padding: '3rem 1rem',
                    textAlign: 'center',
                    backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    transition: 'all 0.2s',
                    cursor: 'pointer',
                    marginBottom: '2.5rem'
                }}
            >
                {file ? (
                    <div>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#10b981' }}>파일 준비 완료!</h3>
                        <p style={{ color: '#ffffff' }}>{file.name}</p>
                        <p style={{ fontSize: '0.8rem', color: '#64748b' }}>{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </div>
                ) : (
                    <div>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#fff' }}>회의록 PDF를 이곳에 드래그하세요</h3>
                        <p style={{ color: '#94a3b8', marginBottom: '1.5rem' }}>또는 클릭해서 파일을 선택하세요</p>
                        <label className="btn-primary" style={{ maxWidth: '200px', margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', animation: currentStep === 1 ? 'pulse-blue 2s infinite' : 'none' }}>
                            <style>{`
                                @keyframes pulse-blue {
                                    0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); transform: scale(1); }
                                    50% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); transform: scale(1.02); }
                                    100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); transform: scale(1); }
                                }
                            `}</style>
                            {currentStep === 1 && <span style={{ fontWeight: 'bold' }}>①</span>}
                            파일 선택
                            <input id="file-upload-input" type="file" accept=".pdf" onChange={handleFileInput} style={{ display: 'none' }} />
                        </label>
                    </div>
                )}
            </div>

            {/* [New] Usage Guide Section */}
            <div style={{ backgroundColor: 'rgba(255, 255, 255, 0.03)', borderRadius: '1rem', padding: '1.5rem', border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                <h4 style={{ color: '#60a5fa', fontSize: '1rem', marginBottom: '1.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontSize: '1.2rem' }}>📝</span> SignsCheck 사용법 안내
                </h4>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', textAlign: 'left' }}>
                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>1</div>
                        <div>
                            <div style={stepTitleStyle}>PDF/이미지 업로드</div>
                            <div style={stepDescStyle}>서명 받을 문서(명렬표 등)를 선택하거나 여기로 끌어다 놓기</div>
                        </div>
                    </div>

                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>2</div>
                        <div>
                            <div style={stepTitleStyle}>참석자 확인 및 추가</div>
                            <div style={stepDescStyle}>추출된 '참석자 목록'을 확인하고, 빠진 분이 있다면 이름을 직접 추가하기</div>
                        </div>
                    </div>

                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>3</div>
                        <div>
                            <div style={stepTitleStyle}>미리보기 위치 조정 (중요!)</div>
                            <div style={stepDescStyle}>화면 중앙 미리보기에서 <b>기본 서명(참석자 이름) 위치</b>를 확인하세요.<br />화살표 키로 위치를 미세조정한 후 <b>'위치 저장'</b>을 꼭 눌러주세요.</div>
                        </div>
                    </div>

                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>4</div>
                        <div>
                            <div style={stepTitleStyle}>요청 발송</div>
                            <div style={stepDescStyle}>'X명에게 요청 보내기' 버튼을 누르면 참석자들에게 보낼 서명 요청 링크가 생성됩니다.</div>
                        </div>
                    </div>

                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>5</div>
                        <div>
                            <div style={stepTitleStyle}>링크 복사 및 전달</div>
                            <div style={stepDescStyle}>생성된 링크를 복사하여 카카오톡, 문자 등으로 참석자에게 전달하세요.</div>
                        </div>
                    </div>

                    <div style={stepCardStyle}>
                        <div style={stepBadgeStyle}>6</div>
                        <div>
                            <div style={stepTitleStyle}>최종 PDF 저장</div>
                            <div style={stepDescStyle}>모든 서명이 완료되면 'SAVE PDF'를 눌러 서명된 문서를 저장하세요.</div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}

const stepCardStyle: React.CSSProperties = {
    display: 'flex',
    gap: '1rem',
    alignItems: 'flex-start'
};

const stepBadgeStyle: React.CSSProperties = {
    backgroundColor: '#3b82f6',
    color: 'white',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 'bold',
    flexShrink: 0,
    marginTop: '2px'
};

const stepTitleStyle: React.CSSProperties = {
    color: '#e2e8f0',
    fontSize: '0.9rem',
    fontWeight: 'bold',
    marginBottom: '0.3rem'
};

const stepDescStyle: React.CSSProperties = {
    color: '#94a3b8',
    fontSize: '0.8rem',
    lineHeight: '1.4'
};
