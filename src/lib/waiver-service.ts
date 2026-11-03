import { db } from "./firebase";
import { collection, doc, getDoc, getDocs, query, where, writeBatch, serverTimestamp } from "firebase/firestore";
import { WaiverParams, WaiverRole, WaiverStudent, isRole } from "./waiver-form";

/**
 * 저장 구조 (기존 컬렉션/보안 규칙을 그대로 사용):
 *  - meetings/{formId}  : formType='waiver', formParams(JSON), requireOrder, studentCount
 *  - requests/{id}      : 학생 1명당 2건 (role='student' | 'guardian'), meetingId=formId,
 *                         pairId=상대 역할 문서 ID. 각 문서가 독립 서명 링크가 된다.
 */

export interface WaiverRequestRow {
    id: string;
    role: WaiverRole;
    pairId: string;
    grade: number;
    classNo: number;
    number: number;
    studentName: string;
    status: 'pending' | 'signed' | 'rejected';
    signerName?: string;
    signedAt?: { toMillis?: () => number } | null;
}

export interface WaiverStudentRow {
    key: string;
    grade: number;
    classNo: number;
    number: number;
    name: string;
    student?: WaiverRequestRow;
    guardian?: WaiverRequestRow;
}

export async function createWaiverBatch(opts: {
    hostUid: string;
    hostName: string;
    params: WaiverParams;
    students: WaiverStudent[];
    requireOrder: boolean;
}): Promise<string> {
    const { hostUid, hostName, params, students, requireOrder } = opts;
    const meetingRef = doc(collection(db, "meetings"));
    const first = writeBatch(db);
    first.set(meetingRef, {
        hostUid,
        hostName,
        fileName: `성적 이의신청 포기원 (${students.length}명)`,
        formType: 'waiver',
        formParams: JSON.stringify(params),
        requireOrder,
        studentCount: students.length,
        attendees: "[]",
        pdfUrl: "",
        createdAt: serverTimestamp(),
    });
    await first.commit();

    // Firestore 배치 한도(500)를 넘지 않도록 100명(=200문서)씩 나눠 저장
    for (let i = 0; i < students.length; i += 100) {
        const batch = writeBatch(db);
        for (const s of students.slice(i, i + 100)) {
            const studentRef = doc(collection(db, "requests"));
            const guardianRef = doc(collection(db, "requests"));
            const base = {
                meetingId: meetingRef.id,
                hostUid,
                formType: 'waiver',
                phone: "",
                status: 'pending',
                grade: s.grade,
                classNo: s.classNo,
                number: s.number,
                studentName: s.name,
                createdAt: serverTimestamp(),
            };
            batch.set(studentRef, { ...base, role: 'student', name: s.name, pairId: guardianRef.id });
            batch.set(guardianRef, { ...base, role: 'guardian', name: `${s.name} 보호자`, pairId: studentRef.id });
        }
        await batch.commit();
    }
    return meetingRef.id;
}

export async function getWaiverForm(formId: string): Promise<{ params: WaiverParams; requireOrder: boolean; hostUid: string } | null> {
    const snap = await getDoc(doc(db, "meetings", formId));
    if (!snap.exists()) return null;
    const d = snap.data();
    if (d.formType !== 'waiver') return null;
    return { params: JSON.parse(d.formParams), requireOrder: d.requireOrder !== false, hostUid: d.hostUid };
}

export async function getWaiverRows(formId: string): Promise<WaiverStudentRow[]> {
    const snap = await getDocs(query(collection(db, "requests"), where("meetingId", "==", formId)));
    const map = new Map<string, WaiverStudentRow>();
    snap.forEach(d => {
        const r = d.data();
        if (!isRole(r.role)) return;
        const key = `${r.grade}-${r.classNo}-${r.number}`;
        const row: WaiverStudentRow = map.get(key) ?? { key, grade: r.grade, classNo: r.classNo, number: r.number, name: r.studentName };
        const req: WaiverRequestRow = {
            id: d.id, role: r.role, pairId: r.pairId, grade: r.grade, classNo: r.classNo, number: r.number,
            studentName: r.studentName, status: r.status, signerName: r.signerName, signedAt: r.signedAt ?? null,
        };
        if (r.role === 'student') row.student = req; else row.guardian = req;
        map.set(key, row);
    });
    return [...map.values()].sort((a, b) => a.grade - b.grade || a.classNo - b.classNo || a.number - b.number);
}

export async function getRecentWaiverForms(hostUid: string): Promise<{ id: string; fileName: string; studentCount: number; createdAt: number }[]> {
    // 복합 색인이 필요 없도록 hostUid로만 조회하고 클라이언트에서 거른다 (meeting-service와 동일한 이유)
    const snap = await getDocs(query(collection(db, "meetings"), where("hostUid", "==", hostUid)));
    return snap.docs
        .filter(d => d.data().formType === 'waiver')
        .map(d => ({
            id: d.id,
            fileName: d.data().fileName as string,
            studentCount: (d.data().studentCount as number) ?? 0,
            createdAt: d.data().createdAt?.toMillis ? d.data().createdAt.toMillis() : 0,
        }))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10);
}
