"use client";

import { useState, useEffect } from 'react';
import ActionBar from "@/components/ActionBar";
import OverviewPanel from "@/components/OverviewPanel";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/lib/auth-context";
import UploadZone from "@/components/UploadZone";
import StatusBoard from "@/components/StatusBoard";
import { extractStructuredTextFromPDF, extractNamesFromStructuredData } from '@/lib/pdf-parser';
import { fetchAttendeesFromSheet, Attendee } from '@/lib/gas-service';
import { createSignatureRequest } from '@/lib/signature-service';
import { createMeeting, updateMeetingAttendees, getMeeting, updateMeetingAttachment } from "@/lib/meeting-service";
import { collection, query, onSnapshot, orderBy, getDocs, where } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { subscribeToConfig, AppConfig } from "@/lib/config-service";

import SimulationModal from "@/components/SimulationModal";
// [SSR Fix] Import PDFPreview dynamically to avoid DOMMatrix error during build
import dynamic from 'next/dynamic';
const PDFPreview = dynamic(() => import("@/components/PDFPreview"), { ssr: false });

export default function Home() {
  const { user, signOut } = useAuth();

  // State
  const [attendees, setAttendees] = useState<(Attendee & { id: string; selected: boolean; status: string })[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, { status: string; signatureUrl?: string }>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // Session State
  const [meetingId, setMeetingId] = useState<string | null>(null);

  // Attachment State
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null); // [New]
  const [isDragging, setIsDragging] = useState(false);

  // Simulator State
  const [showModal, setShowModal] = useState(false);
  const [simulationLinks, setSimulationLinks] = useState<string[]>([]);

  // Subscribe to remote config
  useEffect(() => {
    const unsubscribeConfig = subscribeToConfig((remoteConfig) => {
      setConfig(remoteConfig);
    });
    return () => unsubscribeConfig();
  }, []);

  // Firestore Listener with Session Filtering
  useEffect(() => {
    if (!meetingId) {
      setStatusMap({});
      return;
    }

    const q = query(
      collection(db, "requests"),
      where("meetingId", "==", meetingId),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const map: Record<string, { status: string; signatureUrl?: string }> = {};

      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.phone && !map[data.phone]) {
          map[data.phone] = {
            status: data.status,
            signatureUrl: data.signatureUrl
          };
        }
      });
      setStatusMap(map);
    }, (error) => {
      console.error("Firestore Listener Error (Verify Index):", error);
    });

    return () => unsubscribe();
  }, [meetingId]);

  const visibleAttendees = attendees.map(a => {
    const liveData = a.phone ? statusMap[a.phone] : null;
    return {
      ...a,
      status: liveData?.status || a.status,
      signatureUrl: liveData?.signatureUrl
    };
  });

  // Handle Meeting Selection from History
  const handleSelectMeeting = async (selectedMeetingId: string, fileName: string) => {
    if (confirm(`'${fileName}' 회의 기록을 불러오시겠습니까? (현재 작업 중인 내용은 닫힙니다)`)) {
      setMeetingId(selectedMeetingId);
      setPdfFile(null);
      setAttachmentFile(null);
      setIsProcessing(true);

      try {
        // 1. Try to load saved attendee list from Meeting Doc
        const meetingData = await getMeeting(selectedMeetingId);
        let restoredAttendees: any[] = [];

        // [New] Restore PDF if URL exists
        if (meetingData && meetingData.pdfUrl) {
          console.log("Found saved PDF URL, restoring...", meetingData.pdfUrl);
          try {
            // Use proxy to avoid CORS issues
            const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(meetingData.pdfUrl)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) throw new Error("Failed to fetch via proxy");

            const blob = await response.blob();
            const restoredFile = new File([blob], fileName, { type: 'application/pdf' });
            setPdfFile(restoredFile);
          } catch (e) {
            console.error("Error restoring PDF file:", e);
            alert("저장된 PDF 파일을 불러오는 데 실패했습니다.");
          }
        }

        // [New] Restore Attachment if URL exists
        if (meetingData && meetingData.attachmentUrl && meetingData.attachmentName) {
          console.log("Found saved Attachment URL, restoring...", meetingData.attachmentName);
          try {
            // Reuse proxy for attachment (assuming it works for blobs)
            const proxyUrl = `/api/proxy-pdf?url=${encodeURIComponent(meetingData.attachmentUrl)}`;
            const response = await fetch(proxyUrl);

            if (!response.ok) throw new Error("Failed to fetch attachment via proxy");

            const blob = await response.blob();
            // Create File object
            const restoredAttachment = new File([blob], meetingData.attachmentName, { type: blob.type });
            setAttachmentFile(restoredAttachment);
          } catch (e) {
            console.error("Error restoring attachment file:", e);
            // Don't alert blocking error, just log it
          }
        }

        if (meetingData && meetingData.attendees) {
          try {
            restoredAttendees = JSON.parse(meetingData.attendees);
            console.log("Restored attendees from meeting doc:", restoredAttendees.length);
          } catch (e) {
            console.error("Failed to parse attendees JSON", e);
          }
        }

        // 2. If empty (legacy meetings), try to reconstruct from 'requests' (fallback)
        if (restoredAttendees.length === 0) {
          console.log("No attendee list in doc, falling back to requests...");
          const q = query(collection(db, "requests"), where("meetingId", "==", selectedMeetingId));
          const snapshot = await getDocs(q);
          const parsedPhones = new Set();

          snapshot.forEach(doc => {
            const data = doc.data();
            if (!parsedPhones.has(data.phone)) {
              parsedPhones.add(data.phone);
              restoredAttendees.push({
                id: doc.id,
                name: data.name,
                phone: data.phone,
                selected: true,
                status: data.status
              });
            }
          });
        }

        setAttendees(restoredAttendees);

      } catch (error) {
        console.error("Failed to restore meeting:", error);
        alert("회의 기록을 불러오는 데 실패했습니다.");
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // PDF Handling
  const handleFileSelected = async (file: File) => {
    if (!user) {
      alert("로그인이 필요합니다.");
      return;
    }

    setIsProcessing(true);
    setPdfFile(file);

    try {
      // [New] Upload PDF to Storage
      console.log("Uploading original PDF to Storage...");
      const pdfStorageRef = ref(storage, `meetings/${Date.now()}_${file.name}`);
      const pdfSnapshot = await uploadBytes(pdfStorageRef, file);
      const pdfUrl = await getDownloadURL(pdfSnapshot.ref);
      console.log("PDF Uploaded, URL:", pdfUrl);

      // [New] Create Meeting with PDF URL
      const newMeetingId = await createMeeting(user.uid, user.displayName || "담당자", file.name, pdfUrl);
      setMeetingId(newMeetingId);
      console.log("New Meeting Created:", newMeetingId);

      const structuredItems = await extractStructuredTextFromPDF(file);
      const names = extractNamesFromStructuredData(structuredItems);

      if (names.length === 0) {
        alert("문서에서 이름을 찾을 수 없습니다.");
        setIsProcessing(false);
        return;
      }

      const matched = await fetchAttendeesFromSheet(names);
      const formatted = matched.map((m, idx) => ({
        ...m,
        id: idx.toString(),
        selected: true,
        status: 'pending'
      }));

      setAttendees(formatted);

      // Save extracted attendees to Meeting Doc
      await updateMeetingAttendees(newMeetingId, formatted);

    } catch (error: any) {
      console.error(error);
      alert(`분석 실패: ${error.message}`);
      setPdfFile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleAttendee = (id: string) => {
    setAttendees(prev => prev.map(a => a.id === id ? { ...a, selected: !a.selected } : a));
  };

  const handleAddAttendee = async (name: string) => {
    let newAttendee: Attendee & { id: string; selected: boolean; status: string } = {
      id: Date.now().toString(),
      name: name,
      phone: null,
      selected: true,
      status: 'pending',
      confidence: 1.0 // Manual add
    };
    try {
      const matched = await fetchAttendeesFromSheet([name]);
      if (matched && matched.length > 0) {
        newAttendee.phone = matched[0].phone;
      }
    } catch (e) {
      console.warn("Manual lookup failed:", e);
    }
    setAttendees(prev => [newAttendee, ...prev]);
  };

  const handleAttachmentUpload = async (file: File) => {
    setAttachmentFile(file);
    if (!meetingId) return; // Can't save yet if no meeting

    setIsProcessing(true);
    try {
      console.log("Uploading attachment...", file.name);
      const storageRef = ref(storage, `attachments/${Date.now()}_${file.name}`);
      const snapshot = await uploadBytes(storageRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setAttachmentUrl(url);

      await updateMeetingAttachment(meetingId, url, file.name);
      console.log("Attachment saved to meeting:", url);
    } catch (error) {
      console.error("Attachment upload failed:", error);
      alert("첨부파일 업로드 실패");
      setAttachmentFile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveAttachment = async () => {
    if (!confirm("첨부파일을 삭제하시겠습니까?")) return;

    setAttachmentFile(null);
    setAttachmentUrl(null);

    if (meetingId) {
      try {
        setIsProcessing(true);
        await updateMeetingAttachment(meetingId, "", "");
        console.log("Attachment removed from meeting metadata");
      } catch (error) {
        console.error("Failed to remove attachment from Firestore:", error);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Drag & Drop Handlers
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleAttachmentUpload(e.dataTransfer.files[0]);
    }
  };

  const handleCloseFile = () => {
    setPdfFile(null);
    setAttachmentFile(null);
    setAttendees([]);
    setMeetingId(null);
    setStatusMap({});
  };

  const handleSendRequests = async () => {
    const selectedAttendees = visibleAttendees.filter(a => a.selected && a.status === 'pending');
    if (selectedAttendees.length === 0) {
      alert("전송할 대상이 없습니다.");
      return;
    }

    if (!confirm(`${selectedAttendees.length}명에게 서명 요청을 보냅니다 (시뮬레이션).`)) return;

    const currentMeetingId = meetingId || `temp_${Date.now()}`;

    setIsProcessing(true);
    const generatedLinks: string[] = [];
    let uploadedAttachmentUrl = "";

    try {
      if (attachmentFile) {
        console.log("Uploading attachment...", attachmentFile.name);
        const storageRef = ref(storage, `attachments/${Date.now()}_${attachmentFile.name}`);
        const snapshot = await uploadBytes(storageRef, attachmentFile);
        uploadedAttachmentUrl = await getDownloadURL(snapshot.ref);

        // [New] Save Attachment Info to Meeting Doc
        if (currentMeetingId && !currentMeetingId.startsWith('temp_')) {
          await updateMeetingAttachment(currentMeetingId, uploadedAttachmentUrl, attachmentFile.name);
        }
      }

      const promises = selectedAttendees.map(async (attendee) => {
        const link = await createSignatureRequest(attendee, uploadedAttachmentUrl, currentMeetingId, user?.uid || "");
        return `${attendee.name}: ${link}`;
      });

      const results = await Promise.all(promises);
      generatedLinks.push(...results);

      setAttendees(prev => prev.map(a => {
        const wasSelected = selectedAttendees.find(s => s.id === a.id);
        return wasSelected ? { ...a, status: 'sent' } : a;
      }));

      setSimulationLinks(generatedLinks);
      setShowModal(true);
    } catch (error: any) {
      console.error(error);
      alert(`전송 실패: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // [New] Bulk Update
  const handleBulkUpdate = async (text: string) => {
    if (!text.trim()) return;

    const lines = text.split('\n');
    const updates: { name: string, phone: string }[] = [];

    lines.forEach(line => {
      // Robust parsing: Handle tabs (Excel) and multiple spaces
      const cleanLine = line.replace(/,/g, ' ').trim();
      if (!cleanLine) return;

      const parts = cleanLine.split(/\s+/);
      if (parts.length >= 2) {
        const phoneIndex = parts.findIndex(p => /^0\d/.test(p));
        let name = "";
        let phone = "";

        if (phoneIndex !== -1) {
          phone = parts[phoneIndex];
          name = parts.slice(0, phoneIndex).join(' ');
        } else {
          phone = parts.pop()!;
          name = parts.join(' ');
        }

        if (name.trim() && phone.trim()) {
          updates.push({ name: name.trim(), phone: phone.trim() });
        }
      }
    });

    if (updates.length > 0) {
      let matchedCount = 0;
      let matchedNames: string[] = [];

      setAttendees(prev => {
        const updated = prev.map(a => {
          const aName = a.name.replace(/\s+/g, '');
          const match = updates.find(u => {
            const uName = u.name.replace(/\s+/g, '');
            return aName === uName || aName.includes(uName) || uName.includes(aName);
          });

          if (match) {
            matchedCount++;
            matchedNames.push(a.name);
            return { ...a, phone: match.phone };
          }
          return a;
        });

        // Persist to Firestore
        if (meetingId && matchedCount > 0) {
          updateMeetingAttendees(meetingId, updated).catch(err => {
            console.error("Failed to persist bulk updates:", err);
          });
        }
        return updated;
      });

      // Show alert
      setTimeout(() => {
        if (matchedCount > 0) {
          alert(`${matchedCount}명의 정보를 업데이트했습니다.\n(매칭 예시: ${matchedNames.slice(0, 5).join(', ')})`);
        } else {
          alert("일치하는 이름을 찾지 못했습니다.");
        }
      }, 100);
    } else {
      alert("데이터를 인식하지 못했습니다. '이름 전화번호' 형식인지 확인해주세요.");
    }
  };

  if (config?.isMaintenance) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', color: '#fff', textAlign: 'center', padding: '20px' }}>
        <div style={{ fontSize: '4rem', marginBottom: '20px' }}>🚧</div>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '10px' }}>시스템 점검 중입니다</h1>
        <p style={{ color: '#94a3b8', maxWidth: '500px' }}>
          더 나은 서비스를 위해 현재 시스템 점검을 진행하고 있습니다.<br />
          잠시 후 다시 접속해 주세요. 불편을 드려 죄송합니다.
        </p>
        <div style={{ marginTop: '30px', padding: '10px 20px', backgroundColor: '#1e293b', borderRadius: '8px', color: '#3b82f6', fontSize: '0.875rem' }}>
          관리자 문의: support@signscheck.com
        </div>
      </div>
    );
  }

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'hsl(var(--background))', overflow: 'hidden' }}>
      <LoginModal />
      <SimulationModal isOpen={showModal} onClose={() => setShowModal(false)} links={simulationLinks} />

      <header style={{ padding: '0.8rem 2rem', borderBottom: '1px solid hsla(var(--glass-border) / 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(15, 23, 42, 0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="title" style={{ fontSize: '1.2rem', margin: 0, background: 'linear-gradient(to right, #60a5fa, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>SignsCheck</h1>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', border: '1px solid #334155', padding: '0.1rem 0.4rem', borderRadius: '12px' }}>PRO</span>
        </div>
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {user && (
            <>
              <span>Host: <strong style={{ color: '#f1f5f9' }}>{user.displayName}</strong></span>
              <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }}>(Sign Out)</button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '250px 1fr 300px', flex: 1, overflow: 'hidden' }}>

        <aside style={{ borderRight: '1px solid hsla(var(--glass-border) / 0.3)', padding: '1rem', display: 'flex', flexDirection: 'column' }}>
          <OverviewPanel onSelectMeeting={handleSelectMeeting} currentMeetingId={meetingId} />

          {(!config || config.allowAttachments) && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              style={{
                marginTop: '1.5rem',
                border: `2px dashed ${isDragging ? '#60a5fa' : '#334155'}`,
                borderRadius: '0.5rem',
                padding: '1rem',
                textAlign: 'center',
                backgroundColor: isDragging ? 'rgba(59, 130, 246, 0.1)' : 'rgba(15, 23, 42, 0.3)',
                transition: 'all 0.2s',
                cursor: attachmentFile ? 'default' : 'pointer',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {!attachmentFile && (
                <input
                  type="file"
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleAttachmentUpload(e.target.files[0]);
                  }}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 1 }}
                />
              )}
              <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>📎</div>
              {attachmentFile ? (
                <div style={{ position: 'relative', zIndex: 2 }}>
                  <div style={{ fontSize: '0.85rem', color: '#60a5fa', fontWeight: 'bold' }}>파일 선택됨</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', wordBreak: 'break-all', marginTop: '0.2rem' }}>{attachmentFile.name}</div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleRemoveAttachment(); }}
                    style={{ marginTop: '0.7rem', padding: '0.3rem 0.8rem', fontSize: '0.75rem', color: '#fff', backgroundColor: '#ef4444', border: 'none', borderRadius: '0.3rem', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    파일 삭제하기
                  </button>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '0.2rem' }}>상세안내 파일 첨부</div>
                  <div style={{ fontSize: '0.7rem', color: '#64748b' }}>여기로 파일을 드래그하거나<br />클릭하여 업로드하세요</div>
                </div>
              )}
            </div>
          )}
        </aside>

        <section style={{ backgroundColor: '#0f172a', padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '900px' }}>
            {pdfFile ? (
              <div style={{ animation: 'fadeIn 0.5s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1rem', color: '#94a3b8' }}>미리보기 (Live Preview)</h2>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={handleCloseFile} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem' }}>파일 닫기</button>
                  </div>
                </div>
                <PDFPreview
                  file={pdfFile}
                  attendees={visibleAttendees}
                  onConfirm={handleSendRequests}
                  meetingId={meetingId}
                />
              </div>
            ) : (
              meetingId && !pdfFile ? (
                <div style={{ textAlign: 'center', color: '#94a3b8', marginTop: '4rem' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📁</div>
                  <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem', color: '#e2e8f0' }}>회의 기록을 불러왔습니다</h3>
                  <p>참석자 목록 및 서명 상태를 오른쪽에서 확인하세요.<br />PDF 파일은 저장되지 않으므로 미리보기를 할 수 없습니다.</p>
                  <button
                    onClick={handleCloseFile}
                    style={{ marginTop: '1.5rem', padding: '0.5rem 1rem', background: '#334155', color: 'white', border: 'none', borderRadius: '0.3rem', cursor: 'pointer' }}
                  >
                    닫기
                  </button>
                </div>
              ) : (
                <UploadZone onFileSelected={handleFileSelected} />
              )
            )}

            {isProcessing && (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                backgroundColor: 'rgba(15, 23, 42, 0.8)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                zIndex: 50, backdropFilter: 'blur(4px)'
              }}>
                <div className="spinner" style={{
                  width: '40px', height: '40px', border: '4px solid rgba(255, 255, 255, 0.1)',
                  borderLeftColor: '#60a5fa', borderRadius: '50%', animation: 'spin 1s linear infinite'
                }}></div>
                <div style={{ marginTop: '1rem', color: '#e2e8f0', fontSize: '1.1rem', fontWeight: 500 }}>
                  작업 처리 중... 🔄
                </div>
                <style jsx>{` @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } } `}</style>
              </div>
            )}
          </div>
        </section>

        <aside style={{ borderLeft: '1px solid hsla(var(--glass-border) / 0.3)', backgroundColor: 'rgba(15, 23, 42, 0.2)', height: '100%', overflow: 'hidden' }}>
          <StatusBoard
            attendees={visibleAttendees}
            onToggle={handleToggleAttendee}
            onAdd={handleAddAttendee}
            onBulkUpdate={handleBulkUpdate}
          />
        </aside>

      </div>

      <ActionBar onSend={handleSendRequests} count={visibleAttendees.filter(a => a.selected && a.status === 'pending').length} config={config} />
    </main>
  );
}
