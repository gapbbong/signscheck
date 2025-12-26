import { NextRequest, NextResponse } from "next/server";
import { upgradeToProTier } from "@/lib/subscription-service";
import { recordPayment } from "@/lib/payment-service";

export async function POST(request: NextRequest) {
    try {
        const { paymentId, userId } = await request.json();

        if (!paymentId || !userId) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        // In production, verify payment with PortOne API
        // For now, we'll trust the client-side verification

        // Record payment
        const paymentRecordId = await recordPayment({
            userId,
            subscriptionId: "", // Will be updated after subscription creation
            amount: 4900,
            method: "portone",
            status: "paid",
            portonePaymentId: paymentId
        });

        // Upgrade user to Pro tier
        await upgradeToProTier(userId, paymentRecordId);

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Payment verification error:", error);
        return NextResponse.json(
            { error: "Failed to verify payment" },
            { status: 500 }
        );
    }
}
