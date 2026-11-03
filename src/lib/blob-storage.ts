import { upload } from "@vercel/blob/client";
import { auth } from "./firebase";

export function isBlobUrl(url: string): boolean {
    try {
        return new URL(url).hostname.endsWith(".blob.vercel-storage.com");
    } catch {
        return false;
    }
}

/** 파일을 Vercel Blob에 올리고 공개 URL을 돌려준다. onProgress는 0~1. */
export async function uploadToBlob(
    folder: "meetings" | "attachments",
    file: File,
    onProgress?: (fraction: number) => void
): Promise<string> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error("로그인이 필요합니다.");
    const safeName = file.name.replace(/[\\/]/g, "_");
    const blob = await upload(`${folder}/${Date.now()}_${safeName}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        clientPayload: idToken,
        contentType: file.type || "application/octet-stream",
        onUploadProgress: ({ percentage }) => onProgress?.(percentage / 100),
    });
    return blob.url;
}

/** Blob 파일 삭제. 실패하면 false. */
export async function deleteFromBlob(url: string): Promise<boolean> {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) return false;
    const res = await fetch("/api/blob/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, url }),
    });
    return res.ok;
}
