import { db } from "./firebase";
import { collection, addDoc, Timestamp } from "firebase/firestore";

export interface PaymentRecord {
    id: string;
    userId: string;
    subscriptionId: string;
    amount: number;
    method: string;
    status: 'paid' | 'failed' | 'cancelled';
    portonePaymentId: string;
    createdAt: Timestamp;
}

const PAYMENTS_COLLECTION = "payments";

/**
 * Record a payment transaction
 */
export async function recordPayment(data: {
    userId: string;
    subscriptionId: string;
    amount: number;
    method: string;
    status: 'paid' | 'failed' | 'cancelled';
    portonePaymentId: string;
}): Promise<string> {
    const paymentData = {
        ...data,
        createdAt: Timestamp.now()
    };

    const docRef = await addDoc(collection(db, PAYMENTS_COLLECTION), paymentData);
    return docRef.id;
}

/**
 * Initiate payment with PortOne
 */
export async function initiatePayment(userId: string, userEmail: string, userName: string) {
    // This will be called from the client side with PortOne SDK
    // Return payment configuration
    return {
        storeId: process.env.NEXT_PUBLIC_PORTONE_STORE_ID,
        channelKey: process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY,
        paymentId: `payment_${Date.now()}_${userId}`,
        orderName: "SignsUp Pro 구독 (1개월)",
        totalAmount: 4900,
        currency: "CURRENCY_KRW" as const,
        payMethod: "EASY_PAY" as const,
        customer: {
            customerId: userId,
            email: userEmail,
            fullName: userName
        }
    };
}
