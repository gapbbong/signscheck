import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { verifyFirebaseIdToken } from "@/lib/blob-auth";

// 브라우저가 Vercel Blob으로 직접 올릴 수 있게 토큰을 발급한다. (로그인한 사용자만)
export async function POST(request: Request) {
    const body = (await request.json()) as HandleUploadBody;
    try {
        const json = await handleUpload({
            body,
            request,
            onBeforeGenerateToken: async (_pathname, clientPayload) => {
                const uid = await verifyFirebaseIdToken(clientPayload);
                if (!uid) throw new Error("로그인이 필요합니다.");
                return {
                    allowedContentTypes: [
                        "application/pdf",
                        "image/png",
                        "image/jpeg",
                        "image/webp",
                        "image/gif",
                        "application/octet-stream",
                    ],
                    maximumSizeInBytes: 20 * 1024 * 1024,
                    addRandomSuffix: true,
                };
            },
            onUploadCompleted: async () => {},
        });
        return NextResponse.json(json);
    } catch (error: any) {
        return NextResponse.json({ error: error?.message ?? "upload error" }, { status: 400 });
    }
}
