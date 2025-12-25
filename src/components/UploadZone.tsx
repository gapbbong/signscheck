"use client";

import { useState } from 'react';

interface Props {
    onFileSelected: (file: File) => void;
}

export default function UploadZone({ onFileSelected }: Props) {
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
                    cursor: 'pointer'
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
                        <label className="btn-primary" style={{ maxWidth: '200px', margin: '0 auto', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            파일 선택
                            <input type="file" accept=".pdf" onChange={handleFileInput} style={{ display: 'none' }} />
                        </label>
                    </div>
                )}
            </div>
        </section>
    );
}
