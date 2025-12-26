"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { getAllEvents, AnalyticsEvent } from "@/lib/analytics-service";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface UserStats {
    userId: string;
    email: string;
    totalMeetings: number;
    totalEvents: number;
    lastActivity: Date;
}

export default function AdminPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [events, setEvents] = useState<AnalyticsEvent[]>([]);
    const [userStats, setUserStats] = useState<UserStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("all");

    useEffect(() => {
        if (!user) {
            router.push("/");
            return;
        }

        loadAnalytics();
    }, [user]);

    const loadAnalytics = async () => {
        setLoading(true);
        try {
            // Load all events
            const allEvents = await getAllEvents(500);
            setEvents(allEvents);

            // Calculate user stats
            const statsMap = new Map<string, UserStats>();

            allEvents.forEach(event => {
                const existing = statsMap.get(event.userId) || {
                    userId: event.userId,
                    email: "",
                    totalMeetings: 0,
                    totalEvents: 0,
                    lastActivity: new Date(0)
                };

                existing.totalEvents++;
                if (event.eventType === 'meeting_created') {
                    existing.totalMeetings++;
                }

                const eventDate = event.timestamp.toDate();
                if (eventDate > existing.lastActivity) {
                    existing.lastActivity = eventDate;
                }

                statsMap.set(event.userId, existing);
            });

            setUserStats(Array.from(statsMap.values()).sort((a, b) =>
                b.lastActivity.getTime() - a.lastActivity.getTime()
            ));

        } catch (error) {
            console.error("Failed to load analytics:", error);
        } finally {
            setLoading(false);
        }
    };

    const filteredEvents = filter === "all"
        ? events
        : events.filter(e => e.eventType === filter);

    const totalUsers = userStats.length;
    const totalMeetings = userStats.reduce((sum, u) => sum + u.totalMeetings, 0);
    const totalSignatures = events.filter(e => e.eventType === 'signature_completed').length;
    const avgAttendeesPerMeeting = events
        .filter(e => e.eventType === 'meeting_created' && e.metadata.attendeeCount)
        .reduce((sum, e) => sum + (e.metadata.attendeeCount || 0), 0) /
        (events.filter(e => e.eventType === 'meeting_created').length || 1);

    if (loading) {
        return (
            <div style={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: 'white'
            }}>
                <div>로딩 중...</div>
            </div>
        );
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            padding: '2rem',
            color: 'white'
        }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                {/* Header */}
                <div style={{ marginBottom: '2rem' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                        📊 SignsUp Analytics
                    </h1>
                    <p style={{ color: '#94a3b8' }}>사용량 통계 및 사용자 활동 분석</p>
                </div>

                {/* Key Metrics */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                    gap: '1rem',
                    marginBottom: '2rem'
                }}>
                    <MetricCard title="총 사용자" value={totalUsers} icon="👥" />
                    <MetricCard title="총 회의" value={totalMeetings} icon="📝" />
                    <MetricCard title="총 서명" value={totalSignatures} icon="✍️" />
                    <MetricCard
                        title="평균 참석자/회의"
                        value={Math.round(avgAttendeesPerMeeting)}
                        icon="📊"
                    />
                </div>

                {/* User Stats Table */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '1rem',
                    padding: '1.5rem',
                    marginBottom: '2rem'
                }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>
                        사용자 활동 통계
                    </h2>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>사용자 ID</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>총 회의</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>총 이벤트</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left' }}>마지막 활동</th>
                                </tr>
                            </thead>
                            <tbody>
                                {userStats.map(stat => (
                                    <tr key={stat.userId} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
                                        <td style={{ padding: '0.75rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                                            {stat.userId.slice(0, 8)}...
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>{stat.totalMeetings}</td>
                                        <td style={{ padding: '0.75rem' }}>{stat.totalEvents}</td>
                                        <td style={{ padding: '0.75rem', fontSize: '0.85rem' }}>
                                            {stat.lastActivity.toLocaleDateString('ko-KR')} {stat.lastActivity.toLocaleTimeString('ko-KR')}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Event Log */}
                <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '1rem',
                    padding: '1.5rem'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
                            이벤트 로그 ({filteredEvents.length})
                        </h2>
                        <select
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            style={{
                                padding: '0.5rem',
                                borderRadius: '0.5rem',
                                background: 'rgba(0, 0, 0, 0.3)',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                color: 'white'
                            }}
                        >
                            <option value="all">모든 이벤트</option>
                            <option value="meeting_created">회의 생성</option>
                            <option value="signature_completed">서명 완료</option>
                            <option value="bulk_add_used">일괄 등록</option>
                            <option value="user_login">로그인</option>
                        </select>
                    </div>

                    <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                        {filteredEvents.map((event, idx) => (
                            <div
                                key={event.id || idx}
                                style={{
                                    padding: '0.75rem',
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                                    fontSize: '0.85rem'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                                    <span style={{ fontWeight: 600 }}>
                                        {getEventIcon(event.eventType)} {getEventLabel(event.eventType)}
                                    </span>
                                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                        {event.timestamp.toDate().toLocaleString('ko-KR')}
                                    </span>
                                </div>
                                <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                                    User: {event.userId.slice(0, 8)}...
                                    {event.metadata.attendeeCount && ` | ${event.metadata.attendeeCount}명`}
                                    {event.metadata.meetingId && ` | Meeting: ${event.metadata.meetingId.slice(0, 8)}...`}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function MetricCard({ title, value, icon }: { title: string; value: number; icon: string }) {
    return (
        <div style={{
            background: 'rgba(255, 255, 255, 0.05)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '1rem',
            padding: '1.5rem'
        }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{icon}</div>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.25rem' }}>{title}</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{value.toLocaleString()}</div>
        </div>
    );
}

function getEventIcon(eventType: string): string {
    const icons: Record<string, string> = {
        'meeting_created': '📝',
        'signature_completed': '✍️',
        'bulk_add_used': '📋',
        'user_login': '🔐',
        'pdf_uploaded': '📄',
        'template_saved': '💾',
        'template_loaded': '📂'
    };
    return icons[eventType] || '📊';
}

function getEventLabel(eventType: string): string {
    const labels: Record<string, string> = {
        'meeting_created': '회의 생성',
        'signature_completed': '서명 완료',
        'bulk_add_used': '일괄 등록 사용',
        'user_login': '로그인',
        'pdf_uploaded': 'PDF 업로드',
        'template_saved': '템플릿 저장',
        'template_loaded': '템플릿 불러오기'
    };
    return labels[eventType] || eventType;
}
