import { db } from "./firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { Attendee } from "./gas-service";

export interface SignatureRequest {
    id?: string;
    meetingId: string; // [New] Session ID
    name: string;
    phone: string;
    status: 'pending' | 'signed' | 'rejected';
    createdAt: any;
    signatureUrl?: string;
    signedAt?: any;
    attachmentUrl?: string; // [New] Attachment Link
    hostUid: string; // [Security] Ownership
}

/**
 * Creates a signature request in Firestore and returns the signing link.
 */
export async function createSignatureRequest(attendee: Attendee, attachmentUrl?: string, meetingId?: string, hostUid: string = ""): Promise<string> {
    try {
        const docRef = await addDoc(collection(db, "requests"), {
            meetingId: meetingId || "default",
            hostUid,
            name: attendee.name,
            phone: attendee.phone,
            status: 'pending',
            createdAt: serverTimestamp(),
            attachmentUrl: attachmentUrl || null
        });

        // Generate the signing URL
        // In production, this would be the public domain. For now, localhost.
        const baseUrl = window.location.origin;
        return `${baseUrl}/sign/${docRef.id}`;
    } catch (error) {
        console.error("Error creating signature request:", error);
        throw error;
    }
}
