import { db } from "./firebase";
import {
    collection,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    query,
    where,
    getDocs,
    Timestamp,
    serverTimestamp
} from "firebase/firestore";

export type SubscriptionTier = 'free' | 'pro';
export type SubscriptionStatus = 'active' | 'cancelled' | 'expired';

export interface Subscription {
    id: string;
    userId: string;
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    startDate: Timestamp;
    endDate: Timestamp;
    paymentId?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}

export interface Usage {
    id: string;
    userId: string;
    month: string; // 'YYYY-MM'
    meetingCount: number;
    lastReset: Timestamp;
}

const SUBSCRIPTIONS_COLLECTION = "subscriptions";
const USAGE_COLLECTION = "usage";

/**
 * Get user's current subscription
 */
export async function getUserSubscription(userId: string): Promise<Subscription | null> {
    try {
        const q = query(
            collection(db, SUBSCRIPTIONS_COLLECTION),
            where("userId", "==", userId),
            where("status", "==", "active")
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            // Create default free subscription
            return await createDefaultSubscription(userId);
        }

        const doc = snapshot.docs[0];
        return {
            id: doc.id,
            ...doc.data()
        } as Subscription;
    } catch (error) {
        console.error("Error getting subscription:", error);
        return null;
    }
}

/**
 * Create default free subscription for new users
 */
async function createDefaultSubscription(userId: string): Promise<Subscription> {
    const now = Timestamp.now();
    const endDate = Timestamp.fromDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)); // 1 year

    const subscriptionData = {
        userId,
        tier: 'free' as SubscriptionTier,
        status: 'active' as SubscriptionStatus,
        startDate: now,
        endDate: endDate,
        createdAt: now,
        updatedAt: now
    };

    const docRef = doc(collection(db, SUBSCRIPTIONS_COLLECTION));
    await setDoc(docRef, subscriptionData);

    return {
        id: docRef.id,
        ...subscriptionData
    };
}

/**
 * Upgrade user to Pro tier
 */
export async function upgradeToProTier(userId: string, paymentId: string): Promise<void> {
    const subscription = await getUserSubscription(userId);

    if (!subscription) {
        throw new Error("No subscription found");
    }

    const now = Timestamp.now();
    const endDate = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days

    await updateDoc(doc(db, SUBSCRIPTIONS_COLLECTION, subscription.id), {
        tier: 'pro',
        paymentId,
        endDate,
        updatedAt: now
    });
}

/**
 * Cancel subscription (revert to free tier)
 */
export async function cancelSubscription(userId: string): Promise<void> {
    const subscription = await getUserSubscription(userId);

    if (!subscription) {
        throw new Error("No subscription found");
    }

    await updateDoc(doc(db, SUBSCRIPTIONS_COLLECTION, subscription.id), {
        tier: 'free',
        status: 'active',
        updatedAt: Timestamp.now()
    });
}

/**
 * Get current month's usage
 */
export async function getMonthlyUsage(userId: string): Promise<Usage> {
    const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM'

    const q = query(
        collection(db, USAGE_COLLECTION),
        where("userId", "==", userId),
        where("month", "==", currentMonth)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
        // Create new usage record
        const usageData = {
            userId,
            month: currentMonth,
            meetingCount: 0,
            lastReset: Timestamp.now()
        };

        const docRef = doc(collection(db, USAGE_COLLECTION));
        await setDoc(docRef, usageData);

        return {
            id: docRef.id,
            ...usageData
        };
    }

    const usageDoc = snapshot.docs[0];
    return {
        id: usageDoc.id,
        ...usageDoc.data()
    } as Usage;
}

/**
 * Increment meeting count
 */
export async function incrementMeetingCount(userId: string): Promise<void> {
    const usage = await getMonthlyUsage(userId);

    await updateDoc(doc(db, USAGE_COLLECTION, usage.id), {
        meetingCount: usage.meetingCount + 1
    });
}

/**
 * Check if user can create a new meeting
 */
export async function canCreateMeeting(userId: string): Promise<{ allowed: boolean; reason?: string }> {
    // [Temporary] Unlimited meetings for all users as requested
    return { allowed: true };
}
