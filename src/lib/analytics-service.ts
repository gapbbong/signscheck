import { db } from "./firebase";
import { collection, addDoc, Timestamp, query, where, getDocs, orderBy, limit } from "firebase/firestore";

// Event types
export type AnalyticsEventType =
    | 'meeting_created'
    | 'pdf_uploaded'
    | 'attendee_added'
    | 'request_sent'
    | 'signature_completed'
    | 'bulk_add_used'
    | 'template_saved'
    | 'template_loaded'
    | 'meeting_loaded'
    | 'user_login';

export interface AnalyticsEvent {
    id?: string;
    userId: string;
    eventType: AnalyticsEventType;
    timestamp: Timestamp;
    metadata: {
        meetingId?: string;
        attendeeCount?: number;
        fileSize?: number;
        templateId?: string;
        [key: string]: any;
    };
}

const ANALYTICS_COLLECTION = "analytics_events";

/**
 * Log an analytics event
 */
export async function logEvent(
    userId: string,
    eventType: AnalyticsEventType,
    metadata: Record<string, any> = {}
): Promise<void> {
    try {
        const event: AnalyticsEvent = {
            userId,
            eventType,
            timestamp: Timestamp.now(),
            metadata
        };

        await addDoc(collection(db, ANALYTICS_COLLECTION), event);
        console.log(`📊 Analytics: ${eventType}`, metadata);
    } catch (error) {
        console.error("Failed to log analytics event:", error);
        // Don't throw - analytics should never break the app
    }
}

/**
 * Log meeting creation
 */
export async function logMeetingCreated(
    userId: string,
    meetingId: string,
    attendeeCount: number,
    fileSize?: number
): Promise<void> {
    await logEvent(userId, 'meeting_created', {
        meetingId,
        attendeeCount,
        fileSize
    });
}

/**
 * Log signature completion
 */
export async function logSignatureCompleted(
    userId: string,
    meetingId: string,
    attendeeName: string
): Promise<void> {
    await logEvent(userId, 'signature_completed', {
        meetingId,
        attendeeName
    });
}

/**
 * Log bulk add usage
 */
export async function logBulkAddUsed(
    userId: string,
    count: number
): Promise<void> {
    await logEvent(userId, 'bulk_add_used', {
        count
    });
}

/**
 * Log template operations
 */
export async function logTemplateSaved(
    userId: string,
    templateId: string,
    attendeeCount: number
): Promise<void> {
    await logEvent(userId, 'template_saved', {
        templateId,
        attendeeCount
    });
}

export async function logTemplateLoaded(
    userId: string,
    templateId: string
): Promise<void> {
    await logEvent(userId, 'template_loaded', {
        templateId
    });
}

/**
 * Log user login
 */
export async function logUserLogin(userId: string): Promise<void> {
    await logEvent(userId, 'user_login', {});
}

/**
 * Get user's event history
 */
export async function getUserEvents(
    userId: string,
    eventType?: AnalyticsEventType,
    limitCount: number = 100
): Promise<AnalyticsEvent[]> {
    try {
        let q = query(
            collection(db, ANALYTICS_COLLECTION),
            where("userId", "==", userId),
            orderBy("timestamp", "desc"),
            limit(limitCount)
        );

        if (eventType) {
            q = query(
                collection(db, ANALYTICS_COLLECTION),
                where("userId", "==", userId),
                where("eventType", "==", eventType),
                orderBy("timestamp", "desc"),
                limit(limitCount)
            );
        }

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as AnalyticsEvent));
    } catch (error) {
        console.error("Failed to get user events:", error);
        return [];
    }
}

/**
 * Get all events (admin only)
 */
export async function getAllEvents(
    limitCount: number = 1000
): Promise<AnalyticsEvent[]> {
    try {
        const q = query(
            collection(db, ANALYTICS_COLLECTION),
            orderBy("timestamp", "desc"),
            limit(limitCount)
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as AnalyticsEvent));
    } catch (error) {
        console.error("Failed to get all events:", error);
        return [];
    }
}
