import { db } from "./firebase";
import { collection, doc, getDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { FormLayout } from "./pdf-form-detect";

/**
 * PDF 서식형 저장 구조 (waiver-service와 같은 컬렉션/보안 규칙):
 *  - meetings/{formId}: formType='pdfform', formMode='common'|'each', pdfUrl(공통), formLayout(JSON)
 *  - requests/{id}: 학생 1명당 2건(role='student'|'guardian'), pairId, 학년/반/번호/이름
 *                   'each' 모드는 요청마다 pdfUrl, layout(JSON)을 따로 가진다.
 */
export interface PdfFormStudent {
    grade: number;
    classNo: number;
    number: number;
    name: string;
    pdfUrl?: string;
    layout?: FormLayout;
}

export async function createPdfFormBatch(opts: {
    hostUid: string;
    hostName: string;
    fileName: string;
    mode: 'common' | 'each';
    pdfUrl?: string;
    layout?: FormLayout;
    requireOrder: boolean;
    students: PdfFormStudent[];
}): Promise<string> {
    const { hostUid, hostName, fileName, mode, pdfUrl, layout, requireOrder, students } = opts;
    const meetingRef = doc(collection(db, "meetings"));
    const first = writeBatch(db);
    first.set(meetingRef, {
        hostUid,
        hostName,
        fileName: `${fileName} (${students.length}명)`,
        formType: 'pdfform',
        formMode: mode,
        pdfUrl: pdfUrl ?? "",
        formLayout: layout ? JSON.stringify(layout) : "",
        requireOrder,
        studentCount: students.length,
        attendees: "[]",
        createdAt: serverTimestamp(),
    });
    await first.commit();

    // 'each'는 요청마다 레이아웃 JSON이 붙으므로 50명(=100문서)씩 나눠 저장
    for (let i = 0; i < students.length; i += 50) {
        const batch = writeBatch(db);
        for (const s of students.slice(i, i + 50)) {
            const studentRef = doc(collection(db, "requests"));
            const guardianRef = doc(collection(db, "requests"));
            const base = {
                meetingId: meetingRef.id,
                hostUid,
                formType: 'pdfform',
                phone: "",
                status: 'pending',
                grade: s.grade,
                classNo: s.classNo,
                number: s.number,
                studentName: s.name,
                ...(s.pdfUrl ? { pdfUrl: s.pdfUrl } : {}),
                ...(s.layout ? { layout: JSON.stringify(s.layout) } : {}),
                createdAt: serverTimestamp(),
            };
            batch.set(studentRef, { ...base, role: 'student', name: s.name, pairId: guardianRef.id });
            batch.set(guardianRef, { ...base, role: 'guardian', name: `${s.name} 보호자`, pairId: studentRef.id });
        }
        await batch.commit();
    }
    return meetingRef.id;
}

export async function getPdfForm(formId: string): Promise<{ fileName: string; mode: 'common' | 'each'; requireOrder: boolean; layout: FormLayout | null } | null> {
    const snap = await getDoc(doc(db, "meetings", formId));
    if (!snap.exists() || snap.data().formType !== 'pdfform') return null;
    const d = snap.data();
    return {
        fileName: d.fileName,
        mode: d.formMode === 'each' ? 'each' : 'common',
        requireOrder: d.requireOrder !== false,
        layout: d.formLayout ? JSON.parse(d.formLayout) : null,
    };
}
