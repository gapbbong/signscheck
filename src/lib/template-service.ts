import { db } from "./firebase";
import {
    collection,
    addDoc,
    getDocs,
    query,
    where,
    orderBy,
    Timestamp,
    deleteDoc,
    doc
} from "firebase/firestore";

export interface AttendeeTemplate {
    id: string;
    name: string;
    attendees: { name: string; phone: string | null }[];
    hostUid: string;
    createdAt: any;
}

const COLLECTION_NAME = "templates";

/**
 * Save current list as a template
 */
export async function saveTemplate(hostUid: string, name: string, attendees: { name: string; phone: string | null }[]) {
    const docRef = await addDoc(collection(db, COLLECTION_NAME), {
        hostUid,
        name,
        attendees,
        createdAt: Timestamp.now()
    });
    return docRef.id;
}

/**
 * Fetch all templates for a host
 */
export async function getTemplates(hostUid: string): Promise<AttendeeTemplate[]> {
    const q = query(
        collection(db, COLLECTION_NAME),
        where("hostUid", "==", hostUid),
        orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    } as AttendeeTemplate));
}

/**
 * Delete a template
 */
export async function deleteTemplate(templateId: string) {
    await deleteDoc(doc(db, COLLECTION_NAME, templateId));
}
