"use client";

import { AppConfig } from "@/lib/config-service";

interface Props {
    onSend?: () => void;
    count?: number;
    config?: AppConfig | null;
}

export default function ActionBar({ onSend, count = 0, config }: Props) {
    const isNewMeetingDisabled = config?.allowNewMeetings === false;

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
                disabled={count === 0 || isNewMeetingDisabled}
                className="btn-primary"
                style={{
                    width: '100%',
                    maxWidth: '600px',
                    fontSize: '1.2rem',
                    padding: '1rem',
                    opacity: (count === 0 || isNewMeetingDisabled) ? 0.5 : 1,
                    cursor: (count === 0 || isNewMeetingDisabled) ? 'not-allowed' : 'pointer'
                }}
            >
                🚀 {isNewMeetingDisabled ? "신규 회의 생성 제한됨" : (count > 0 ? `${count}명에게 요청 보내기` : '요청 보내기')} (Click)
            </button>
        </footer>
    );
}
