// Firebase ID 토큰이 유효한지 REST로 확인한다 (firebase-admin 없이).
const API_KEY =
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyDk9rTMHPPQeKH0Pg8aie_HKx8pPS-cnnk";

export async function verifyFirebaseIdToken(
    idToken: string | null | undefined
): Promise<string | null> {
    if (!idToken) return null;
    try {
        const res = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ idToken }),
            }
        );
        if (!res.ok) return null;
        const data = await res.json();
        return data?.users?.[0]?.localId ?? null;
    } catch {
        return null;
    }
}
