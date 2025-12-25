"use client";

import { useEffect, useState } from 'react';
import { useAuth } from "@/lib/auth-context";
import { getRecentMeetings, deleteMeeting, Meeting } from "@/lib/meeting-service";

interface Props {
    onSelectMeeting?: (meetingId: string, fileName: string) => void;
    currentMeetingId?: string | null;
}

export default function OverviewPanel({ onSelectMeeting, currentMeetingId }: Props) {
    const { user } = useAuth();
    const [meetings, setMeetings] = useState<Meeting[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchHistory = async () => {
        if (!user) return;
        setLoading(true);
        const history = await getRecentMeetings(user.uid);
        setMeetings(history);
        setLoading(false);
    };

    useEffect(() => {
        if (user) {
            fetchHistory();
        }
    }, [user, currentMeetingId]);

    const handleDelete = async (e: React.MouseEvent, meetingId: string) => {
        e.stopPropagation();
        if (confirm("정말로 이 회의 기록을 삭제하시겠습니까?")) {
            await deleteMeeting(meetingId);
            fetchHistory(); // Refresh list
        }
    };

    // Helper to format date
    const formatDate = (timestamp: any) => {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
    };

    return (
        <section className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <style jsx>{`
                /* Custom Scrollbar */
                .custom-scroll::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scroll::-webkit-scrollbar-track {
                    background: rgba(15, 23, 42, 0.3);
                }
                .custom-scroll::-webkit-scrollbar-thumb {
                    background: #475569;
                    border-radius: 4px;
                }
                .custom-scroll::-webkit-scrollbar-thumb:hover {
                    background: #64748b;
                }
                /* Delete Button Styles */
                .meeting-item .delete-btn {
                    opacity: 0.3;
                    transition: opacity 0.2s, background-color 0.2s;
                }
                .meeting-item:hover .delete-btn {
                    opacity: 1;
                }
                .delete-btn:hover {
                    background-color: rgba(239, 68, 68, 0.1) !important;
                    border-radius: 50%;
                }
            `}</style>

            <div style={{ padding: '1.5rem', borderBottom: '1px solid hsla(var(--glass-border) / 0.5)' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 600, color: '#f8fafc' }}>최근 회의</h2>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>History & Sessions</p>
            </div>

            <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto', padding: '1rem' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', color: '#64748b', marginTop: '1rem' }}>불러오는 중...</div>
                ) : (
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                        {meetings.map((meeting) => (
                            <li
                                key={meeting.id}
                                className="meeting-item"
                                onClick={() => onSelectMeeting?.(meeting.id, meeting.fileName)}
                                style={{
                                    padding: '1rem',
                                    marginBottom: '0.8rem',
                                    borderRadius: '0.5rem',
                                    backgroundColor: currentMeetingId === meeting.id ? 'rgba(59, 130, 246, 0.2)' : 'rgba(30, 41, 59, 0.5)',
                                    border: currentMeetingId === meeting.id ? '1px solid #3b82f6' : '1px solid #334155',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    position: 'relative'
                                }}
                            >
                                <div style={{ fontSize: '0.95rem', fontWeight: 500, color: '#e2e8f0', marginBottom: '0.3rem', paddingRight: '20px' }}>
                                    {meeting.fileName}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{formatDate(meeting.createdAt)}</span>
                                    {currentMeetingId === meeting.id && <span style={{ color: '#60a5fa' }}>Running ●</span>}
                                </div>

                                {/* Delete Button */}
                                <button
                                    className="delete-btn"
                                    onClick={(e) => handleDelete(e, meeting.id)}
                                    style={{
                                        position: 'absolute',
                                        top: '10px',
                                        right: '10px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: '#ef4444',
                                        cursor: 'pointer',
                                        padding: '5px',
                                        zIndex: 10
                                    }}
                                    title="이 회의 기록 삭제"
                                >
                                    🗑️
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {!loading && meetings.length === 0 && (
                    <div style={{ textAlign: 'center', color: '#64748b', marginTop: '2rem', fontSize: '0.9rem' }}>
                        기록된 회의가 없습니다.
                    </div>
                )}
            </div>

            <div style={{ marginTop: 'auto', padding: '1.5rem', borderTop: '1px solid hsla(var(--glass-border) / 0.5)' }}>
                {user && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                        <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #60a5fa, #a78bfa)' }}></div>
                        <div>
                            <div style={{ fontSize: '0.9rem', color: '#e2e8f0' }}>{user.displayName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Host</div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
