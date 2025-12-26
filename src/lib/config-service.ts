import { db } from "./firebase";
import { doc, onSnapshot, getDoc } from "firebase/firestore";

export interface AppConfig {
    isMaintenance: boolean;
    allowAttachments: boolean;
    allowNewMeetings: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
    isMaintenance: false,
    allowAttachments: true,
    allowNewMeetings: true
};

/**
 * Listen to real-time configuration changes from Firestore
 */
export function subscribeToConfig(callback: (config: AppConfig) => void) {
    const docRef = doc(db, "settings", "global");

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data() as AppConfig);
        } else {
            console.warn("No remote config found at settings/global, using defaults.");
            callback(DEFAULT_CONFIG);
        }
    }, (error) => {
        console.error("Error subscribing to config:", error);
        callback(DEFAULT_CONFIG);
    });
}

/**
 * Get the current configuration once
 */
export async function getConfig(): Promise<AppConfig> {
    try {
        const docRef = doc(db, "settings", "global");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            return docSnap.data() as AppConfig;
        }
    } catch (error) {
        console.error("Error fetching config:", error);
    }
    return DEFAULT_CONFIG;
}
