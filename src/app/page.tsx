"use client";

import { useState, useEffect, useRef } from 'react';
import ActionBar from "@/components/ActionBar";
import OverviewPanel from "@/components/OverviewPanel";
import LoginModal from "@/components/LoginModal";
import { useAuth } from "@/lib/auth-context";
import UploadZone from "@/components/UploadZone";
import StatusBoard from "@/components/StatusBoard";
import { extractStructuredTextFromPDF, extractNamesFromStructuredData, detectDocumentType, ParseMode, PDFTextItem } from '@/lib/pdf-parser';
import { fetchAttendeesFromSheet, Attendee } from '@/lib/gas-service';
import { createSignatureRequest } from '@/lib/signature-service';
import { createMeeting, updateMeetingAttendees, getMeeting, updateMeetingAttachment, updateMeetingHash, updateMeetingSignatureOffset, Meeting } from "@/lib/meeting-service";
import { useNotification } from '@/lib/NotificationContext';
import { collection, query, onSnapshot, orderBy, getDocs, where, doc } from 'firebase/firestore';
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import { subscribeToConfig, AppConfig } from "@/lib/config-service";
import { canCreateMeeting, incrementMeetingCount } from "@/lib/subscription-service";
import { logMeetingCreated, logBulkAddUsed, logEvent, logUserLogin } from "@/lib/analytics-service";

import SimulationModal from "@/components/SimulationModal";
// [SSR Fix] Import PDFPreview dynamically to avoid DOMMatrix error during build
import dynamic from 'next/dynamic';
const PDFPreview = dynamic(() => import("@/components/PDFPreview"), { ssr: false });

// Helper to normalize phone numbers for comparison
const normalizePhone = (phone: string | null) => {
  if (!phone) return "";
  return phone.replace(/[^0-9]/g, "");
};

export default function Home() {
  const { user, loading: authLoading, signOut } = useAuth();
  const { showToast, confirm: uiConfirm } = useNotification();

  // State
  const [attendees, setAttendees] = useState<(Attendee & { id: string; selected: boolean; status: string })[]>([]);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, { status: string; signatureUrl?: string; ip?: string; deviceInfo?: string; userAgent?: string }>>({});
  const [isProcessing, setIsProcessing] = useState(false);
  // [Curtain] 0–100 progress that drives the "커텐" overlay height while a file
  // is being processed. Advanced stage-by-stage in handleFileSelected, with the
  // slow PDF upload mapped to real byte progress so the curtain speed tracks it.
  const [progress, setProgress] = useState(0);
  // [Copier] Short label shown under the scan lamp so the user knows which
  // phase is running (업로드 / 읽기 / 참석자 찾기 / 이름 대조).
  const [procStage, setProcStage] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  // [Hybrid] Extracted PDF text kept so the user can re-parse with a different
  // document-type mode without re-uploading. detectedMode is what auto-detect
  // chose; parseMode is the user's current selection ('auto' follows detection).
  const [structuredItems, setStructuredItems] = useState<PDFTextItem[]>([]);
  const [parseMode, setParseMode] = useState<ParseMode>('auto');
  const [detectedMode, setDetectedMode] = useState<'signature' | 'roster' | null>(null);

  // [New] Latest signature offset reported by PDFPreview, so 파일 닫기 can persist
  // the current position even if the user never clicked '위치 저장'.
  const latestOffsetRef = useRef<{ x: number; y: number; scale: number } | null>(null);

  // Session State
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [meetingData, setMeetingData] = useState<Meeting | null>(null); // [New] Live Meeting Data

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

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      switch (e.key) {
        case '1':
          document.getElementById('file-upload-input')?.click();
          break;
        case '2':
          document.getElementById('btn-save-location')?.click();
          break;
        case '3':
          document.getElementById('btn-send-requests')?.click();
          break;
        case '4':
          document.getElementById('btn-save-pdf')?.click();
          break;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Firestore Listener with Session Filtering
  useEffect(() => {
    if (!meetingId) {
      setStatusMap({});
      return;
    }

    // 1. Requests Listener
    // NOTE: no orderBy here on purpose — we only build a status map keyed by
    // phone/name (order irrelevant), and adding orderBy would require a Firestore
    // composite index (meetingId + createdAt) that silently breaks the live
    // listener on a fresh project, so signed status/signatures never appear.
    const q = query(
      collection(db, "requests"),
      where("meetingId", "==", meetingId)
    );

    const unsubscribeRequests = onSnapshot(q, (snapshot) => {
      const map: Record<string, { status: string; signatureUrl?: string; ip?: string; deviceInfo?: string; userAgent?: string }> = {};

      snapshot.forEach(doc => {
        const data = doc.data();

        // Use normalized phone as primary key, fallback to name if phone is missing
        const normPhone = data.phone ? normalizePhone(data.phone) : null;
        const key = normPhone || data.name;

        if (key && !map[key]) {
          map[key] = {
            status: data.status,
            signatureUrl: data.signatureUrl,
            ip: data.ip,
            deviceInfo: data.deviceInfo,
            userAgent: data.userAgent
          };
        }
      });
      setStatusMap(map);
    }, (error) => {
      console.error("Firestore Requests Listener Error:", error);
    });

    // 2. [New] Meeting Doc Listener (for Offset Sync)
    const meetingRef = doc(db, "meetings", meetingId);
    const unsubscribeMeeting = onSnapshot(meetingRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMeetingData({ id: docSnap.id, ...data } as Meeting);
        console.log("Meeting data updated:", data.signatureOffsetX, data.signatureOffsetY);
      }
    }, (error) => {
      console.error("Firestore Meeting Listener Error:", error);
    });

    return () => {
      unsubscribeRequests();
      unsubscribeMeeting();
    };
  }, [meetingId]);

  const visibleAttendees = attendees.map(a => {
    // Try to match by normalized phone first, then by exact name
    const normPhone = a.phone ? normalizePhone(a.phone) : null;
    const liveData = (normPhone && statusMap[normPhone]) || statusMap[a.name];

    return {
      ...a,
      status: liveData?.status || a.status,
      signatureUrl: liveData?.signatureUrl,
      ip: liveData?.ip,
      deviceInfo: liveData?.deviceInfo,
      userAgent: liveData?.userAgent
    };
  });

  // Handle Meeting Selection from History
  const handleSelectMeeting = async (selectedMeetingId: string, fileName: string) => {
    const ok = await uiConfirm(`'${fileName}' 회의 기록을 불러오시겠습니까? (현재 작업 중인 내용은 닫힙니다)`);
    if (ok) {
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
            showToast("저장된 PDF 파일을 불러오는 데 실패했습니다.", "error");
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

        // Initial Deselect for Signed Attendees
        console.log("Starting auto-deselect logic for meeting:", selectedMeetingId);
        const qStat = query(collection(db, "requests"), where("meetingId", "==", selectedMeetingId));
        const statSnap = await getDocs(qStat);
        const signedNormalizedPhones = new Set();
        statSnap.forEach(doc => {
          const data = doc.data();
          if (data.status === 'signed') {
            const norm = normalizePhone(data.phone);
            if (norm) signedNormalizedPhones.add(norm);
          }
        });

        const updatedAttendees = restoredAttendees.map(a => {
          const normPhone = normalizePhone(a.phone);
          const isSigned = signedNormalizedPhones.has(normPhone) || a.status === 'signed';
          return {
            ...a,
            selected: isSigned ? false : true
          };
        });

        console.log("Initial selection updated. Signed hidden:", signedNormalizedPhones.size);
        setAttendees(updatedAttendees);

      } catch (error) {
        console.error("Failed to restore meeting:", error);
        showToast("회의 기록을 불러오는 데 실패했습니다.", "error");
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // PDF Handling
  const handleFileSelected = async (file: File) => {
    if (!user) {
      showToast("로그인이 필요합니다.", "error");
      return;
    }

    setIsProcessing(true);
    setProgress(5);
    setProcStage('파일 준비 중...');
    setPdfFile(file);

    try {
      // [New] Check usage limits
      const usageCheck = await canCreateMeeting(user.uid);
      if (!usageCheck.allowed) {
        showToast(usageCheck.reason || "회의 생성 한도를 초과했습니다.", "error");
        const ok = await uiConfirm("Pro로 업그레이드하시겠습니까?");
        if (ok) {
          window.location.href = "/pricing";
        }
        setIsProcessing(false);
        return;
      }
      setProgress(15);
      setProcStage('PDF 업로드 중...');

      // [New] Upload PDF to Storage — resumable so the curtain tracks real
      // byte progress (this is the slowest step). Map upload 0→100% into the
      // 15→65 band of the overall curtain.
      console.log("Uploading original PDF to Storage...");
      const pdfStorageRef = ref(storage, `meetings/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(pdfStorageRef, file);
      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            const pct = snapshot.totalBytes
              ? snapshot.bytesTransferred / snapshot.totalBytes
              : 0;
            setProgress(15 + Math.round(pct * 50));
          },
          (error) => reject(error),
          () => resolve()
        );
      });
      const pdfUrl = await getDownloadURL(uploadTask.snapshot.ref);
      console.log("PDF Uploaded, URL:", pdfUrl);
      setProgress(70);

      // [New] Create Meeting with PDF URL
      const newMeetingId = await createMeeting(user.uid, user.displayName || "담당자", file.name, pdfUrl);
      setMeetingId(newMeetingId);
      // setMeetingData will be handled by the onSnapshot listener triggered by setMeetingId
      console.log("New Meeting Created:", newMeetingId);
      setProgress(80);
      setProcStage('문서 읽는 중...');

      const items = await extractStructuredTextFromPDF(file);
      // [Hybrid] Remember the raw text + auto-detected shape so the user can
      // switch document-type modes later without re-uploading.
      setStructuredItems(items);
      setDetectedMode(detectDocumentType(items));
      setParseMode('auto');
      setProgress(90);
      setProcStage('참석자 이름 찾는 중...');

      const names = extractNamesFromStructuredData(items, 'auto');

      if (names.length === 0) {
        showToast("문서에서 이름을 찾을 수 없습니다.", "error");
        setIsProcessing(false);
        return;
      }

      // [Curtain] The attendee lookup (phone matching) is a network step with no
      // sub-progress, so creep 90→99 while it runs to avoid a "frozen at 90%" look.
      setProcStage('전화번호 대조 중...');
      let creep = 90;
      const creepTimer = setInterval(() => {
        creep = Math.min(creep + 1, 99);
        setProgress(creep);
      }, 150);
      let formatted;
      try {
        formatted = await buildAttendeesFromNames(names, newMeetingId);
      } finally {
        clearInterval(creepTimer);
      }
      setProgress(100); // [Curtain] fully drawn — overlay fades out on isProcessing=false

      // [New] Increment usage count
      await incrementMeetingCount(user.uid);

      // [Analytics] Log meeting creation
      await logMeetingCreated(user.uid, newMeetingId, formatted.length, file.size);

    } catch (error: any) {
      console.error(error);
      showToast(`분석 실패: ${error.message}`, "error");
      setPdfFile(null);
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setProcStage('');
    }
  };

  // Shared: turn a list of extracted names into the attendee list, persist it,
  // and update UI. Returns the formatted list.
  const buildAttendeesFromNames = async (names: string[], mtgId: string | null) => {
    // Phone-number lookup is an optional enrichment. If it fails (GAS endpoint
    // unreachable / CORS → "Failed to fetch"), don't abort the whole analysis —
    // fall back to names with blank phones so the attendee list still loads.
    let matched;
    try {
      matched = await fetchAttendeesFromSheet(names);
    } catch (e) {
      console.warn("Attendee phone lookup failed, proceeding with names only:", e);
      matched = names.map(name => ({ name, phone: null, confidence: 1.0 }));
      showToast("전화번호 자동 조회에 실패해 이름만 불러왔습니다. '일괄 등록'으로 번호를 추가할 수 있어요.", "info");
    }
    const formatted = matched.map((m, idx) => ({
      ...m,
      id: idx.toString(),
      selected: true,
      status: 'pending'
    }));
    setAttendees(formatted);
    if (mtgId) await updateMeetingAttendees(mtgId, formatted);
    return formatted;
  };

  // [Hybrid] Manual override: re-run extraction on the already-loaded PDF text
  // using a user-chosen document type ('auto' | 'signature' | 'roster').
  const handleChangeParseMode = async (mode: ParseMode) => {
    if (structuredItems.length === 0) return;
    setParseMode(mode);
    setIsProcessing(true);
    setProcStage('이름 다시 인식 중...');
    try {
      const names = extractNamesFromStructuredData(structuredItems, mode);
      if (names.length === 0) {
        showToast("이 방식으로는 이름을 찾을 수 없습니다.", "error");
        return;
      }
      await buildAttendeesFromNames(names, meetingId);
      showToast(`${names.length}명을 다시 인식했습니다.`, "success");
    } catch (error: any) {
      console.error(error);
      showToast(`재인식 실패: ${error.message}`, "error");
    } finally {
      setIsProcessing(false);
      setProcStage('');
    }
  };

  const handleToggleAttendee = async (id: string) => {
    const updated = attendees.map(a => a.id === id ? { ...a, selected: !a.selected } : a);
    setAttendees(updated);
    if (meetingId) await updateMeetingAttendees(meetingId, updated);
  };

  const handleSelectAll = async () => {
    const updated = attendees.map(a => ({ ...a, selected: true }));
    setAttendees(updated);
    if (meetingId) await updateMeetingAttendees(meetingId, updated);
  };

  const handleDeselectAll = async () => {
    const updated = attendees.map(a => ({ ...a, selected: false }));
    setAttendees(updated);
    if (meetingId) await updateMeetingAttendees(meetingId, updated);
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
    const nextList = [newAttendee, ...attendees];
    setAttendees(nextList);

    if (meetingId) {
      await updateMeetingAttendees(meetingId, nextList);
    }
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
      showToast("첨부파일 업로드 실패", "error");
      setAttachmentFile(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRemoveAttachment = async () => {
    const ok = await uiConfirm("첨부파일을 삭제하시겠습니까?");
    if (!ok) return;

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

  const handleCloseFile = async () => {
    // [New] Persist the current signature position before closing, so an
    // adjustment made without clicking '위치 저장' is not lost.
    const off = latestOffsetRef.current;
    if (meetingId && off) {
      try {
        await updateMeetingSignatureOffset(meetingId, off.x, off.y, off.scale);
      } catch (error) {
        console.error("Failed to save signature offset on close:", error);
      }
    }
    latestOffsetRef.current = null;
    setPdfFile(null);
    setAttachmentFile(null);
    setAttendees([]);
    setMeetingId(null);
    setMeetingData(null);
    setStatusMap({});
    setStructuredItems([]);
    setDetectedMode(null);
    setParseMode('auto');
  };

  const handleSendRequests = async () => {
    if (!user) {
      showToast("로그인이 필요합니다.", "error");
      return;
    }

    const toSend = attendees.filter(a => a.selected && (a.status === 'pending' || a.status === 'sent'));
    if (toSend.length === 0) {
      showToast("전송할 대상이 없습니다.", "error");
      return;
    }

    if (toSend.some(a => a.status === 'sent')) {
      const ok = await uiConfirm("이미 요청을 보낸 분이 포함되어 있습니다. 다시 보내시겠습니까?");
      if (!ok) {
        return;
      }
    }

    // Removed confirmation dialog - users will copy links to messenger

    setIsProcessing(true);
    console.log(`Resending/Sending to ${toSend.length} members...`);

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

      const promises = toSend.map(async (attendee: any) => {
        const link = await createSignatureRequest(attendee, uploadedAttachmentUrl, currentMeetingId, user?.uid || "");
        return `${attendee.name}: ${link}`;
      });

      const results = await Promise.all(promises);
      generatedLinks.push(...results);

      setAttendees(prev => prev.map(a => {
        const wasSelected = toSend.find((s: any) => s.id === a.id);
        return wasSelected ? { ...a, status: 'sent' } : a;
      }));

      setSimulationLinks(generatedLinks);
      setShowModal(true);
    } catch (error: any) {
      console.error(error);
      showToast(`전송 실패: ${error.message}`, "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // [New] Attendee Template
  const handleLoadTemplate = async (templateAttendees: { name: string; phone: string | null }[]) => {
    let nextAttendees: (Attendee & { id: string; selected: boolean; status: string })[] = [];

    setAttendees(prev => {
      const existingNames = new Set(prev.map(p => p.name.trim()));

      // 1. Identify truly new people (names not in current list)
      const toAdd = templateAttendees
        .filter(t => !existingNames.has(t.name.trim()))
        .map((a, idx) => ({
          ...a,
          id: `tpl_${Date.now()}_${idx}`,
          selected: true,
          status: 'pending',
          confidence: 1.0
        }));

      // 2. Update existing people (matches by name)
      const templateMap = new Map(templateAttendees.map(t => [t.name.trim(), t.phone]));
      const updatedPrev = prev.map(p => {
        const templatePhone = templateMap.get(p.name.trim());
        if (templatePhone) {
          return {
            ...p,
            selected: true,
            phone: p.phone || templatePhone
          };
        }
        return p;
      });

      nextAttendees = [...updatedPrev, ...toAdd];
      return nextAttendees;
    });

    // Persistent Save if in a meeting
    if (meetingId && nextAttendees.length > 0) {
      await updateMeetingAttendees(meetingId, nextAttendees);
      showToast(`${templateAttendees.length}명의 템플릿 정보가 적용 및 저장되었습니다.`, "success");
    } else {
      showToast(`${templateAttendees.length}명의 템플릿 정보가 적용되었습니다.`, "success");
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
          showToast(`${matchedCount}명의 정보를 업데이트했습니다.`, "success");
          // [Analytics] Log bulk add usage
          if (user) logBulkAddUsed(user.uid, matchedCount);
        } else {
          showToast("일치하는 이름을 찾지 못했습니다.", "error");
        }
      }, 100);
    } else {
      showToast("데이터를 인식하지 못했습니다. '이름 전화번호' 형식인지 확인해주세요.", "error");
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

  // Determine current step for UI guidance
  let currentStep = 1; // 1. 파일 업로드 (기본값)
  if (pdfFile) {
    if (!meetingData || meetingData.signatureOffsetY === undefined || (meetingData.signatureOffsetY === -4 && meetingData.signatureOffsetX === 0)) {
      currentStep = 2; // 2. 위치 저장
    } else {
      const hasSigned = visibleAttendees.some(a => a.status === 'signed');
      const hasSent = visibleAttendees.some(a => a.status === 'sent');

      if (hasSigned) {
        currentStep = 4; // 4. PDF 저장
      } else if (hasSent) {
        currentStep = 0; // 전송 완료, 서명 대기중 (깜빡임 중단)
      } else {
        currentStep = 3; // 3. 요청 발송
      }
    }
  }

  // Attachment dropzone — rendered at the bottom of the preview's left control column.
  const attachmentDropzone = (!config || config.allowAttachments) ? (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        border: `2px dashed ${isDragging ? '#60a5fa' : '#334155'}`,
        borderRadius: '0.5rem',
        padding: '0.85rem',
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
      <div style={{ fontSize: '1.3rem', marginBottom: '0.3rem' }}>📎</div>
      {attachmentFile ? (
        <div style={{ position: 'relative', zIndex: 2 }}>
          <div style={{ fontSize: '0.8rem', color: '#60a5fa', fontWeight: 'bold' }}>파일 선택됨</div>
          <div style={{ fontSize: '0.7rem', color: '#94a3b8', wordBreak: 'break-all', marginTop: '0.2rem' }}>{attachmentFile.name}</div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleRemoveAttachment(); }}
            style={{ marginTop: '0.6rem', padding: '0.25rem 0.7rem', fontSize: '0.7rem', color: '#fff', backgroundColor: '#ef4444', border: 'none', borderRadius: '0.3rem', fontWeight: 'bold', cursor: 'pointer' }}
          >
            파일 삭제하기
          </button>
        </div>
      ) : (
        <div>
          <div style={{ fontSize: '0.8rem', color: '#e2e8f0', marginBottom: '0.2rem' }}>상세안내 파일 첨부</div>
          <div style={{ fontSize: '0.68rem', color: '#64748b' }}>여기로 파일을 드래그하거나<br />클릭하여 업로드하세요</div>
        </div>
      )}
    </div>
  ) : null;

  return (
    <main style={{ height: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'hsl(var(--background))', overflow: 'hidden' }}>
      <LoginModal />
      <SimulationModal isOpen={showModal} onClose={() => setShowModal(false)} links={simulationLinks} />

      <header style={{ position: 'relative', padding: '0.8rem 2rem', borderBottom: '1px solid hsla(var(--glass-border) / 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(15, 23, 42, 0.4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="title" style={{ fontSize: '1.2rem', margin: 0, background: 'linear-gradient(to right, #60a5fa, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>SignsCheck</h1>
          <span style={{ fontSize: '0.7rem', color: '#94a3b8', border: '1px solid #334155', padding: '0.1rem 0.4rem', borderRadius: '12px' }}>PRO</span>
          <span style={{ fontSize: '0.65rem', color: '#64748b', marginLeft: '0.5rem' }}>v1.4.3</span>

          {/* [Hybrid] Document-type override, moved into the title bar (compact, no description) */}
          {detectedMode && pdfFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.75rem', paddingLeft: '0.75rem', borderLeft: '1px solid #334155' }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', whiteSpace: 'nowrap' }}>📄 인식</span>
              <div style={{ display: 'flex', gap: '0.25rem' }}>
                {([
                  { key: 'auto', label: '자동' },
                  { key: 'signature', label: '회의록형' },
                  { key: 'roster', label: '명렬표형' },
                ] as { key: ParseMode; label: string }[]).map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => handleChangeParseMode(opt.key)}
                    disabled={isProcessing}
                    title={opt.key === 'auto' ? `자동 감지: ${detectedMode === 'signature' ? '회의록형' : '명렬표형'}` : undefined}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '0.35rem',
                      border: parseMode === opt.key ? '1px solid #3b82f6' : '1px solid #475569',
                      background: parseMode === opt.key ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                      color: parseMode === opt.key ? '#93c5fd' : '#cbd5e1',
                      fontSize: '0.8rem',
                      fontWeight: parseMode === opt.key ? 700 : 400,
                      letterSpacing: '-0.04em',
                      whiteSpace: 'nowrap',
                      cursor: isProcessing ? 'default' : 'pointer',
                      opacity: isProcessing ? 0.6 : 1,
                      transition: 'all 0.15s'
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Center: live preview title (only while a document is open) */}
        {pdfFile && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
            <h2 style={{ fontSize: '0.95rem', color: '#94a3b8', margin: 0 }}>미리보기 (Live Preview)</h2>
            <button onClick={handleCloseFile} style={{ backgroundColor: '#ef4444', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold', padding: '0.35rem 0.9rem', borderRadius: '0.4rem' }}>파일 닫기</button>
          </div>
        )}
        <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {user && (
            <>
              <span><strong style={{ color: '#f1f5f9' }}>{user.displayName}</strong></span>
              <button onClick={signOut} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.75rem' }}>(Sign Out)</button>
            </>
          )}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr 240px', flex: 1, overflow: 'hidden' }}>

        <aside className="custom-sidebar-scroll" style={{
          borderRight: '1px solid hsla(var(--glass-border) / 0.3)',
          padding: '1rem',
          display: 'flex',
          flexDirection: 'column',
          overflowY: 'auto',
          height: '100%',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          position: 'relative'
        }}>
          <style jsx>{`
            .custom-sidebar-scroll::-webkit-scrollbar { width: 8px; }
            .custom-sidebar-scroll::-webkit-scrollbar-track { background: rgba(0,0,0,0.1); }
            .custom-sidebar-scroll::-webkit-scrollbar-thumb { background: #475569; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); }
            .custom-sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #60a5fa; }
          `}</style>
          <div style={{ flexShrink: 0 }}>
            <OverviewPanel onSelectMeeting={handleSelectMeeting} currentMeetingId={meetingId} />
          </div>
        </aside>

        <section style={{ backgroundColor: '#0f172a', padding: '0.75rem 1.5rem 1rem', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', overflow: 'hidden' }}>
          <div style={{ width: '100%', height: '100%', position: 'relative' }}>
            {pdfFile ? (
              <div style={{ animation: 'fadeIn 0.5s' }}>
                <PDFPreview
                  file={pdfFile}
                  attendees={visibleAttendees}
                  onConfirm={handleSendRequests}
                  meetingId={meetingId}
                  initialOffsetX={meetingData?.signatureOffsetX ?? 0}
                  initialOffsetY={meetingData?.signatureOffsetY ?? -4}
                  initialScale={meetingData?.signatureScale ?? 1.0}
                  currentStep={currentStep}
                  leftColumnFooter={attachmentDropzone}
                  onOffsetChange={(x, y, scale) => { latestOffsetRef.current = { x, y, scale }; }}
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
                <UploadZone onFileSelected={handleFileSelected} currentStep={currentStep} />
              )
            )}

            {isProcessing && (
              <div style={{
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                overflow: 'hidden', zIndex: 50, pointerEvents: 'none'
              }}>
                {/* Light dim so the scan reads as "working" while the document
                    stays visible underneath. */}
                <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(15, 23, 42, 0.30)' }} />

                {/* [Copier] Scan window limited to the middle band (2단) of the
                    preview. A photocopier-style lamp bar sweeps top→bottom on a
                    loop while we find attendees and their names. Replaces the
                    old full-height curtain. */}
                <div style={{
                  position: 'absolute', left: 0, width: '100%',
                  top: '26%', height: '48%',
                  overflow: 'hidden',
                  borderTop: '1px solid rgba(96, 165, 250, 0.30)',
                  borderBottom: '1px solid rgba(96, 165, 250, 0.30)',
                  background: 'linear-gradient(180deg, rgba(2, 6, 23, 0) 0%, rgba(30, 41, 59, 0.25) 50%, rgba(2, 6, 23, 0) 100%)'
                }}>
                  {/* lamp: hot core line + soft halo, sweeps via @keyframes copierScan */}
                  <div style={{
                    position: 'absolute', left: 0, width: '100%', height: '38%',
                    animation: 'copierScan 1.9s cubic-bezier(0.45, 0, 0.55, 1) infinite',
                    background: 'linear-gradient(180deg, rgba(96,165,250,0) 0%, rgba(147,197,253,0.14) 38%, rgba(224,242,254,0.5) 50%, rgba(147,197,253,0.14) 62%, rgba(96,165,250,0) 100%)'
                  }}>
                    <div style={{
                      position: 'absolute', top: '50%', left: 0, width: '100%', height: '2px',
                      transform: 'translateY(-50%)',
                      background: 'linear-gradient(90deg, rgba(96,165,250,0.1), #e0f2fe 45%, #ffffff 50%, #e0f2fe 55%, rgba(96,165,250,0.1))',
                      boxShadow: '0 0 18px 3px rgba(191, 219, 254, 0.9), 0 0 44px 10px rgba(96, 165, 250, 0.45)'
                    }} />
                  </div>
                  {/* faint scanner-glass rules */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'repeating-linear-gradient(90deg, rgba(148,163,184,0.05) 0px, rgba(148,163,184,0.05) 1px, transparent 1px, transparent 60px)'
                  }} />
                </div>

                {/* Progress pill, just under the scan band */}
                <div style={{
                  position: 'absolute', top: '80%', left: '50%', transform: 'translate(-50%, -50%)',
                  textAlign: 'center', padding: '0.6rem 1.3rem', borderRadius: '0.75rem',
                  backgroundColor: 'rgba(15, 23, 42, 0.72)', backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(148, 163, 184, 0.25)'
                }}>
                  <div style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600 }}>{procStage || '참석자 이름 스캔 중...'}</div>
                  <div style={{ marginTop: '0.3rem', color: '#93c5fd', fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>{progress}%</div>
                </div>
              </div>
            )}
          </div>
        </section>

        <aside style={{ borderLeft: '1px solid hsla(var(--glass-border) / 0.3)', backgroundColor: 'rgba(15, 23, 42, 0.2)', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <StatusBoard
              attendees={visibleAttendees}
              onToggle={handleToggleAttendee}
              onAdd={handleAddAttendee}
              onBulkUpdate={handleBulkUpdate}
              onSelectAll={handleSelectAll}
              onDeselectAll={handleDeselectAll}
              onSend={handleSendRequests}
              sendCount={visibleAttendees.filter(a => a.selected && (a.status === 'pending' || a.status === 'sent')).length}
              config={config}
              hostUid={user?.uid}
              onLoadTemplate={handleLoadTemplate}
              currentStep={currentStep}
            />
          </div>
        </aside>

      </div>

    </main>
  );
}
