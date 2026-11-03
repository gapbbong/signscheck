import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { verifyFirebaseIdToken } from "@/lib/blob-auth";

// Blob 파일 삭제. 로그인한 사용자만, Vercel Blob 주소만 허용한다.
export async function POST(request: Request) {
    const { idToken, url } = await request.json();
    const uid = await verifyFirebaseIdToken(idToken);
    if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    try {
        const host = new URL(url).hostname;
        if (!host.endsWith(".blob.vercel-storage.com")) {
            return NextResponse.json({ error: "not a blob url" }, { status: 400 });
        }
        await del(url);
        return NextResponse.json({ ok: true });
    } catch (error: any) {
        return NextResponse.json({ error: error?.message ?? "delete error" }, { status: 500 });
    }
}
