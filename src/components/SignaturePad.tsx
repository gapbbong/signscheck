"use client";

import React, { useEffect, useRef, useState } from 'react';

interface Props {
    onChange: (dataUrl: string | null) => void;
    /** 서명판 가로:세로 비율. 서명이 들어갈 칸의 비율과 같게 맞춘다 (기본 2.2:1) */
    aspect?: number;
}

/** 터치/마우스/펜 모두 지원하는 서명판 (pointer events). 비어 있으면 null을 돌려준다. */
export default function SignaturePad({ onChange, aspect = 2.2 }: Props) {
    const ratio = Math.min(5, Math.max(1.2, aspect));
    const CW = 660, CH = Math.round(CW / ratio);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const dirty = useRef(false);
    // 서명판은 모달이 열릴 때만 렌더되므로(클라이언트 전용) 초기값에서 바로 읽어도 안전하다
    const [hasStored] = useState(() => {
        try { return !!localStorage.getItem('lastSignature'); } catch { return false; }
    });

    useEffect(() => {
        const c = canvasRef.current;
        if (c) { c.width = CW; c.height = CH; }
    }, [CW, CH]);

    const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const c = canvasRef.current!;
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
    };

    const last = useRef<{ x: number; y: number; w: number } | null>(null);
    // 서명 화면·제출 후 화면에서는 항상 잘 보이는 진한 색을 쓴다.
    // 실제 펜 느낌(색·굵기·진하기 무작위)은 PDF 저장 때만 적용된다 (signature-style.ts)
    const getPen = () => VISIBLE_PEN;

    const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const c = canvasRef.current; const ctx = c?.getContext('2d');
        if (!c || !ctx) return;
        const pen = getPen();
        c.setPointerCapture(e.pointerId);
        drawing.current = true;
        const { x, y } = pos(e);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = pen.color; ctx.globalAlpha = pen.alpha;
        ctx.lineWidth = pen.width * 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.01, y + 0.01); ctx.stroke();
        last.current = { x, y, w: pen.width * 0.8 };
    };
    const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawing.current || !last.current) return;
        const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return;
        const pen = getPen();
        const { x, y } = pos(e);
        const dist = Math.hypot(x - last.current.x, y - last.current.y);
        // 펜 필압이 있으면 필압으로, 없으면(마우스/손가락) 속도로 굵기를 정한다: 빠르면 가늘고 연하게
        const hasPressure = e.pointerType === 'pen' && e.pressure > 0;
        const k = hasPressure ? 0.7 + e.pressure * 0.6 : Math.max(0.7, Math.min(1.1, 1.15 - dist * 0.02));
        const w = last.current.w * 0.7 + pen.width * k * 0.3;
        ctx.lineWidth = w;
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(x, y); ctx.stroke();
        last.current = { x, y, w };
    };
    const up = () => {
        if (!drawing.current) return;
        drawing.current = false;
        last.current = null;
        dirty.current = true;
        onChange(exportTrimmed(canvasRef.current!));
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
            // 저장된 서명은 여백이 잘려 있으므로 비율을 지켜 가운데에 맞춘다
            const r = Math.min((c.width * 0.9) / img.width, (c.height * 0.9) / img.height);
            const dw = img.width * r, dh = img.height * r;
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.globalAlpha = 1;
            ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
            dirty.current = true; onChange(exportTrimmed(c));
        };
        img.src = saved;
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ background: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: '0.75rem', overflow: 'hidden', aspectRatio: `${ratio}` }}>
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

/** 실제 펜처럼 굵기·진하기·색이 다른 종류 */
const VISIBLE_PEN = { width: 7, color: '#0f172a', alpha: 1 };

/** 서명 획이 있는 부분만 잘라 PNG로 내보낸다. 여백이 없어야 서명란에 크게 들어간다. */
export function exportTrimmed(c: HTMLCanvasElement): string {
    const ctx = c.getContext('2d');
    if (!ctx) return c.toDataURL('image/png');
    const { width, height } = c;
    const data = ctx.getImageData(0, 0, width, height).data;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (data[(y * width + x) * 4 + 3] > 8) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) return c.toDataURL('image/png');
    const pad = 6;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1; out.height = maxY - minY + 1;
    out.getContext('2d')!.drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
}

const btn = (bg: string, color: string, border: string): React.CSSProperties => ({
    flex: 1, padding: '0.8rem 0.4rem', background: bg, color, border: `1px solid ${border}`,
    borderRadius: '0.75rem', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer',
});
