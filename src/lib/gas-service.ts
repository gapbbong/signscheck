/**
 * Service to communicate with Google Apps Script (GAS) Backend
 */

// TODO: Replace with your deployed Web App URL
const GAS_WEB_APP_URL = process.env.NEXT_PUBLIC_GAS_URL || "";

export interface Attendee {
    name: string;
    phone: string | null;
    confidence: number;
}

export async function fetchAttendeesFromSheet(names: string[]): Promise<Attendee[]> {
    // Mock Mode if no URL is provided (Mental Model preserve)
    if (!GAS_WEB_APP_URL) {
        console.warn("GAS_WEB_APP_URL not set. Using Mock Data.");
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve(names.map(name => ({
                    name,
                    phone: "010-XXXX-XXXX", // Masked for mock
                    confidence: 0.9
                })));
            }, 1000);
        });
    }

    try {
        const response = await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            body: JSON.stringify({
                action: 'find_attendees',
                names: names
            }),
            // 'no-cors' mode is often needed for simple GAS calls but restricts response reading.
            // Ideally, GAS should return correct CORS headers. 
            // For this robust architecture, we assume GAS handles CORS or we use a Cloud Function proxy.
            // Here we assume standard fetch for now.
        });

        const result = await response.json();
        if (result.status === 'success') {
            return result.data;
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("Failed to fetch from GAS", error);
        throw error;
    }
}
