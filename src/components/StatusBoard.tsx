"use client";

import { useState } from "react";
import { Attendee } from "@/lib/gas-service";
import { AppConfig } from "@/lib/config-service";
import { AttendeeTemplate, saveTemplate, getTemplates, deleteTemplate } from "@/lib/template-service";
import { useEffect } from "react";

interface ExtendedAttendee extends Attendee {
    id: string;
    selected: boolean;
    status: string;
}

interface Props {
    attendees: ExtendedAttendee[];
    onToggle: (id: string) => void;
    onAdd: (name: string) => void;
    onBulkUpdate: (text: string) => void;
    onSelectAll: () => void;
    onDeselectAll: () => void;
    onSend?: () => void;
    sendCount?: number;
    config?: AppConfig | null;
    hostUid?: string;
    onLoadTemplate?: (attendees: { name: string; phone: string | null }[]) => void;
}

export default function StatusBoard({ attendees, onToggle, onAdd, onBulkUpdate, onSelectAll, onDeselectAll, onSend, sendCount = 0, config, hostUid, onLoadTemplate }: Props) {
    const isNewMeetingDisabled = config?.allowNewMeetings === false;
    const [showBulk, setShowBulk] = useState(false);
    const [bulkText, setBulkText] = useState("");
    const [showTemplateModal, setShowTemplateModal] = useState(false);
    const [templates, setTemplates] = useState<AttendeeTemplate[]>([]);
    const [templateName, setTemplateName] = useState("");
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);

    useEffect(() => {
        if (showTemplateModal && hostUid) {
            fetchTemplates();
        }
    }, [showTemplateModal, hostUid]);

    const fetchTemplates = async () => {
        if (!hostUid) return;
        try {
            const data = await getTemplates(hostUid);
            setTemplates(data);
        } catch (error: any) {
            console.error("Fetch templates failed:", error);
            alert(`템플릿을 불러오지 못했습니다: ${error.message}`);
        }
    };

    const handleSaveCurrentAsTemplate = async () => {
        if (!hostUid) {
            alert("로그인이 필요합니다.");
            return;
        }
        if (attendees.length === 0) {
            alert("저장할 인원이 없습니다.");
            return;
        }

        const name = prompt("템플릿 이름을 입력하세요 (예: 1학년 교직원):");
        if (!name || !name.trim()) return;

        setIsSavingTemplate(true);
        try {
            const list = attendees.map(a => ({ name: a.name, phone: a.phone }));
            await saveTemplate(hostUid, name.trim(), list);
            alert("템플릿이 저장되었습니다.");
            if (showTemplateModal) fetchTemplates();
        } catch (error: any) {
            console.error(error);
            alert(`저장 실패: ${error.message || "알 수 없는 오류"}`);
        } finally {
            setIsSavingTemplate(false);
        }
    };

    const handleApplyTemplate = (template: AttendeeTemplate) => {
        if (onLoadTemplate) {
            onLoadTemplate(template.attendees);
            setShowTemplateModal(false);
        }
    };

    const handleDeleteTemplate = async (id: string) => {
        if (confirm("이 템플릿을 삭제하시겠습니까?")) {
            await deleteTemplate(id);
            fetchTemplates();
        }
    };

    return (
        <section className="glass-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            <style jsx>{`
                /* Custom Scrollbar */
                .custom-scroll::-webkit-scrollbar {
                    width: 8px;
                }
                .custom-scroll::-webkit-scrollbar-track {
                    background: rgba(15, 23, 42, 0.5);
                    border-radius: 4px;
                }
                .custom-scroll::-webkit-scrollbar-thumb {
                    background: #475569;
                    border-radius: 4px;
                    border: 2px solid rgba(15, 23, 42, 0.5);
                }
                .custom-scroll::-webkit-scrollbar-thumb:hover {
                    background: #64748b;
                }
                /* Firefox */
                .custom-scroll {
                    scrollbar-width: thin;
                    scrollbar-color: #475569 rgba(15, 23, 42, 0.5);
                }
            `}</style>

            {/* Bulk Modal Overlay - Fixed Full Screen */}
            {showBulk && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        width: '90%', maxWidth: '500px', backgroundColor: '#1e293b',
                        padding: '1.5rem', borderRadius: '0.75rem',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        display: 'flex', flexDirection: 'column', color: '#f8fafc',
                        border: '1px solid #475569'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>전화번호 일괄 등록</h3>
                            <button
                                onClick={() => {
                                    const template = "이름 전화번호\n홍길동 010-1234-5678\n김철수 010-9876-5432";
                                    const blob = new Blob([template], { type: 'text/plain' });
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = "참석자_일괄등록_양식.txt";
                                    a.click();
                                    URL.revokeObjectURL(url);
                                }}
                                style={{ fontSize: '0.8rem', color: '#60a5fa', background: 'none', border: '1px solid #60a5fa', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                            >
                                📥 양식 다운로드
                            </button>
                        </div>
                        <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginBottom: '1rem', lineHeight: '1.4' }}>
                            이름과 전화번호를 복사해서 붙여넣으세요.<br />
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>(엑셀에서 복사 가능: A열 이름, B열 전화번호)</span>
                        </p>
                        <textarea
                            value={bulkText}
                            onChange={(e) => setBulkText(e.target.value)}
                            placeholder="이름  전화번호&#13;&#10;홍길동 010-1111-2222&#13;&#10;김철수 010-3333-4444"
                            style={{
                                width: '100%', height: '200px',
                                backgroundColor: '#0f172a', border: '1px solid #334155',
                                borderRadius: '0.5rem', padding: '0.75rem',
                                color: '#f1f5f9', fontSize: '0.9rem',
                                resize: 'none', marginBottom: '1.5rem',
                                fontFamily: 'monospace'
                            }}
                        />
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button
                                onClick={() => setShowBulk(false)}
                                style={{
                                    flex: 1, padding: '0.75rem',
                                    background: 'transparent', color: '#cbd5e1',
                                    border: '1px solid #475569', borderRadius: '0.5rem',
                                    cursor: 'pointer', fontWeight: 600
                                }}
                            >
                                취소
                            </button>
                            <button
                                onClick={() => {
                                    onBulkUpdate(bulkText);
                                    setShowBulk(false);
                                    setBulkText("");
                                }}
                                style={{
                                    flex: 1, padding: '0.75rem',
                                    background: '#3b82f6', color: 'white',
                                    border: 'none', borderRadius: '0.5rem',
                                    cursor: 'pointer', fontWeight: 600,
                                    boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.5)'
                                }}
                            >
                                적용하기
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* [Hold] 템플릿 모달 일시 중단
            {showTemplateModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
                    backgroundColor: 'rgba(0, 0, 0, 0.7)', zIndex: 9999,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)'
                }}>
                    <div style={{
                        width: '90%', maxWidth: '450px', backgroundColor: '#1e293b',
                        padding: '1.5rem', borderRadius: '0.75rem',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                        display: 'flex', flexDirection: 'column', color: '#f8fafc',
                        border: '1px solid #475569'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.2rem', fontWeight: 'bold', margin: 0 }}>📋 내 명단 템플릿</h3>
                            <button onClick={() => setShowTemplateModal(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
                        </div>

                        <div style={{ maxHeight: '300px', overflowY: 'auto', marginBottom: '1.5rem' }} className="custom-scroll">
                            {templates.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>저장된 템플릿이 없습니다.</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {templates.map(t => (
                                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <button
                                                onClick={() => handleApplyTemplate(t)}
                                                style={{
                                                    flex: 1, textAlign: 'left', padding: '0.75rem 1rem',
                                                    backgroundColor: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.3)',
                                                    borderRadius: '0.5rem', color: '#e2e8f0', cursor: 'pointer'
                                                }}
                                            >
                                                <div style={{ fontWeight: 600 }}>{t.name}</div>
                                                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t.attendees.length}명 저장됨</div>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteTemplate(t.id)}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleSaveCurrentAsTemplate}
                            disabled={isSavingTemplate || attendees.length === 0}
                            style={{
                                width: '100%', padding: '0.75rem',
                                background: 'linear-gradient(to right, #3b82f6, #8b5cf6)', color: 'white',
                                border: 'none', borderRadius: '0.5rem',
                                cursor: 'pointer', fontWeight: 600, opacity: (isSavingTemplate || attendees.length === 0) ? 0.5 : 1
                            }}
                        >
                            {isSavingTemplate ? "저장 중..." : "💾 현재 명단을 새 템플릿으로 저장"}
                        </button>
                    </div>
                </div>
            )}
            */}

            <div style={{ padding: '1.2rem 1.5rem', borderBottom: '1px solid hsla(var(--glass-border) / 0.5)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>참석자 목록 <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 400 }}>({attendees.length}명)</span></h3>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                        {/* [Hold] 템플릿 기능 일시 중단
                        <button
                            onClick={() => setShowTemplateModal(true)}
                            title="템플릿 불러오기/저장"
                            style={{ fontSize: '0.8rem', color: '#8b5cf6', background: 'none', border: '1px solid #8b5cf6', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                        >
                            📋 템플릿
                        </button>
                        */}
                        <button
                            onClick={() => setShowBulk(true)}
                            style={{ fontSize: '0.8rem', color: '#60a5fa', background: 'none', border: '1px solid #60a5fa', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer' }}
                        >
                            일괄 등록
                        </button>
                    </div>
                </div>
                {attendees.length > 0 && (
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={onSelectAll}
                            style={{ flex: 1, fontSize: '0.75rem', padding: '0.4rem', background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            전체 선택
                        </button>
                        <button
                            onClick={onDeselectAll}
                            style={{ flex: 1, fontSize: '0.75rem', padding: '0.4rem', background: 'rgba(100, 116, 139, 0.1)', color: '#94a3b8', border: '1px solid rgba(148, 163, 184, 0.3)', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            전체 해제
                        </button>
                    </div>
                )}
            </div>

            <div className="custom-scroll" style={{ flex: 1, overflowY: 'auto' }}>
                {attendees.map((attendee) => (
                    <div key={attendee.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '0.6rem 1.5rem',
                        borderBottom: '1px solid hsla(var(--glass-border) / 0.3)',
                        backgroundColor: attendee.selected ? 'rgba(59, 130, 246, 0.05)' : 'transparent',
                        transition: 'background 0.2s'
                    }}>
                        <div style={{ marginRight: '1rem' }}>
                            <input
                                type="checkbox"
                                checked={attendee.selected}
                                onChange={() => onToggle(attendee.id)}
                                style={{ width: '18px', height: '18px', accentColor: '#3b82f6', cursor: 'pointer' }}
                            />
                        </div>

                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 500, color: '#f8fafc' }}>{attendee.name}</div>
                            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                {attendee.phone || ''}
                            </div>
                        </div>

                        <div>
                            {attendee.status === 'signed' && (
                                <span style={{ color: '#10b981', fontSize: '0.8rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>서명 완료</span>
                            )}
                            {attendee.status === 'sent' && (
                                <span style={{ color: '#f59e0b', fontSize: '0.8rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>전송됨</span>
                            )}
                            {attendee.status === 'pending' && (
                                <span style={{ color: '#64748b', fontSize: '0.8rem' }}>대기중</span>
                            )}
                        </div>
                    </div>
                ))}

                {attendees.length === 0 && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                        PDF 파일을 업로드해주세요...
                    </div>
                )}
            </div>


            {/* Manual Add Section */}
            <div style={{ padding: '1rem', borderTop: '1px solid hsla(var(--glass-border) / 0.5)' }}>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        const input = e.currentTarget.elements.namedItem('newName') as HTMLInputElement;
                        if (input.value.trim()) {
                            onAdd(input.value.trim());
                            input.value = '';
                        }
                    }}
                    style={{ display: 'flex', gap: '0.5rem' }}
                >
                    <input
                        name="newName"
                        type="text"
                        placeholder="이름 직접 추가"
                        style={{
                            flex: 1,
                            backgroundColor: 'rgba(0,0,0,0.2)',
                            border: '1px solid #475569',
                            borderRadius: '0.3rem',
                            padding: '0.5rem',
                            color: 'white',
                            fontSize: '0.9rem'
                        }}
                    />
                    <button
                        type="submit"
                        style={{
                            backgroundColor: '#3b82f6',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.3rem',
                            padding: '0 1rem',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        +
                    </button>
                </form>
            </div>

            {/* SEND BUTTON Moved Here */}
            {onSend && (
                <div style={{ padding: '1rem', borderTop: '1px solid hsla(var(--glass-border) / 0.5)' }}>
                    <button
                        onClick={onSend}
                        disabled={sendCount === 0 || isNewMeetingDisabled}
                        className="btn-primary"
                        style={{
                            width: '100%',
                            fontSize: '1rem',
                            padding: '0.8rem',
                            opacity: (sendCount === 0 || isNewMeetingDisabled) ? 0.5 : 1,
                            cursor: (sendCount === 0 || isNewMeetingDisabled) ? 'not-allowed' : 'pointer'
                        }}
                    >
                        🚀 {isNewMeetingDisabled ? "제한됨" : (sendCount > 0 ? `${sendCount}명에게 요청 보내기` : '요청 보내기')}
                    </button>
                    {sendCount > 0 && (
                        <div style={{ fontSize: '0.7rem', color: '#64748b', textAlign: 'center', marginTop: '0.5rem' }}>
                            이미 전송된 멤버에게는 재전송됩니다.
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
