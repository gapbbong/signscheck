"use client";

import React, { useEffect, useRef, useState } from 'react';

interface Props {
    onChange: (dataUrl: string | null) => void;
    height?: number;
}

/** 터치/마우스/펜 모두 지원하는 서명판 (pointer events). 비어 있으면 null을 돌려준다. */
export default function SignaturePad({ onChange, height = 200 }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const dirty = useRef(false);
    // 서명판은 모달이 열릴 때만 렌더되므로(클라이언트 전용) 초기값에서 바로 읽어도 안전하다
    const [hasStored] = useState(() => {
        try { return !!localStorage.getItem('lastSignature'); } catch { return false; }
    });

    useEffect(() => {
        const c = canvasRef.current;
        if (c) { c.width = 600; c.height = 200; }
    }, []);

    const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const c = canvasRef.current!;
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
    };

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const c = canvasRef.current; const ctx = c?.getContext('2d');
        if (!c || !ctx) return;
        c.setPointerCapture(e.pointerId);
        drawing.current = true;
        const { x, y } = pos(e);
        ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0f172a';
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01); ctx.stroke();
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current) return;
        const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
        const { x, y } = pos(e);
        ctx.lineTo(x, y); ctx.stroke();
    };
    const up = () => {
        if (!drawing.current) return;
        drawing.current = false;
        dirty.current = true;
        onChange(canvasRef.current!.toDataURL('image/png'));
    };

    const clear = () => {
        const c = canvasRef.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
        dirty.current = false; onChange(null);
    };

    const loadStored = () => {
        let saved: string | null = null;
        try { saved = localStorage.getItem('lastSignature'); } catch { /* ignore */ }
        if (!saved) return;
        const img = new Image();
        img.onload = () => {
            const c = canvasRef.current; const ctx = c?.getContext('2d'); if (!c || !ctx) return;
            ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
            dirty.current = true; onChange(c.toDataURL('image/png'));
        };
        img.src = saved;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ background: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: '0.75rem', overflow: 'hidden', height }}>
                <canvas
                    ref={canvasRef}
                    style={{ touchAction: 'none', width: '100%', height: '100%', display: 'block' }}
                    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {hasStored && (
                    <button type="button" onClick={loadStored} style={btn('#eff6ff', '#3b82f6', '#bfdbfe')}>↺ 이전 서명 불러오기</button>
                )}
                <button type="button" onClick={clear} style={btn('#f1f5f9', '#475569', '#cbd5e1')}>🧹 다시 쓰기</button>
            </div>
        </div>
    );
}

const btn = (bg: string, color: string, border: string): React.CSSProperties => ({
    flex: 1, padding: '0.8rem 0.4rem', background: bg, color, border: `1px solid ${border}`,
    borderRadius: '0.75rem', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer',
});
