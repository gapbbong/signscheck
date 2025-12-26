import { NextRequest, NextResponse } from "next/server";
import { initiatePayment } from "@/lib/payment-service";

export async function POST(request: NextRequest) {
    try {
        const { userId, userEmail, userName } = await request.json();

        if (!userId || !userEmail) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const paymentConfig = await initiatePayment(userId, userEmail, userName);

        return NextResponse.json(paymentConfig);
    } catch (error) {
        console.error("Payment preparation error:", error);
        return NextResponse.json(
            { error: "Failed to prepare payment" },
            { status: 500 }
        );
    }
}
