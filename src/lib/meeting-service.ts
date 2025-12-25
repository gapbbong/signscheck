import { db } from "./firebase";
import { collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, doc, getDoc, updateDoc, deleteDoc } from "firebase/firestore";

export interface Meeting {
    id: string;
    hostUid: string;
    fileName: string;
    attendees?: string; // JSON string
    pdfUrl?: string; // [New] Storage URL
    attachmentUrl?: string; // [New]
    attachmentName?: string; // [New]
    hostName?: string; // [New]
    documentHash?: string; // [Security] SHA-256 hash of final signed PDF
    createdAt: any;
}

export async function getMeeting(meetingId: string): Promise<Meeting | null> {
    try {
        const docRef = doc(db, "meetings", meetingId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return { id: docSnap.id, ...docSnap.data() } as Meeting;
        }
        return null;
    } catch (error) {
        console.error("Error fetching meeting:", error);
        return null;
    }
}

export async function createMeeting(hostUid: string, hostName: string, fileName: string, pdfUrl: string = ""): Promise<string> {
    try {
        const docRef = await addDoc(collection(db, "meetings"), {
            hostUid,
            hostName,
            fileName,
            attendees: "[]",
            pdfUrl, // [New]
            createdAt: serverTimestamp()
        });
        return docRef.id;
    } catch (error) {
        console.error("Error creating meeting:", error);
        throw error;
    }
}

export async function updateMeetingAttendees(meetingId: string, attendees: any[]) {
    try {
        const docRef = doc(db, "meetings", meetingId);
        // Serialize to JSON string to avoid Firestore map limitations with arrays of objects
        await updateDoc(docRef, {
            attendees: JSON.stringify(attendees)
        });
    } catch (error) {
        console.error("Error updating meeting attendees:", error);
    }
}

export async function updateMeetingAttachment(meetingId: string, attachmentUrl: string, attachmentName: string) {
    try {
        const docRef = doc(db, "meetings", meetingId);
        await updateDoc(docRef, {
            attachmentUrl,
            attachmentName
        });
        console.log("Meeting attachment updated");
    } catch (error) {
        console.error("Error updating meeting attachment:", error);
    }
}

export async function deleteMeeting(meetingId: string) {
    try {
        await deleteDoc(doc(db, "meetings", meetingId));
    } catch (error) {
        console.error("Error deleting meeting:", error);
        throw error;
    }
}

export async function updateMeetingHash(meetingId: string, documentHash: string) {
    try {
        const docRef = doc(db, "meetings", meetingId);
        await updateDoc(docRef, {
            documentHash
        });
        console.log("Document hash saved:", documentHash.substring(0, 16) + "...");
    } catch (error) {
        console.error("Error updating document hash:", error);
    }
}

export async function getRecentMeetings(hostUid: string): Promise<Meeting[]> {
    try {
        // Requires Firestore Index for compound query: hostUid (Asc/Desc) + createdAt (Desc)
        const q = query(
            collection(db, "meetings"),
            where("hostUid", "==", hostUid),
            orderBy("createdAt", "desc"),
            limit(10)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Meeting));
    } catch (error) {
        console.error("Error fetching meetings:", error);
        return [];
    }
}
