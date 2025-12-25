"use client";

interface Props {
    onSend?: () => void;
    count?: number;
}

export default function ActionBar({ onSend, count = 0 }: Props) {
    return (
        <footer style={{
            height: '80px',
            borderTop: '1px solid hsla(var(--glass-border) / 0.3)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '0 2rem',
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(10px)'
        }}>
            <button
                onClick={onSend}
                disabled={count === 0}
                className="btn-primary"
                style={{ width: '100%', maxWidth: '600px', fontSize: '1.2rem', padding: '1rem', opacity: count === 0 ? 0.5 : 1, cursor: count === 0 ? 'not-allowed' : 'pointer' }}
            >
                🚀 {count > 0 ? `${count}명에게 요청 보내기` : '요청 보내기'} (Click)
            </button>
        </footer>
    );
}
