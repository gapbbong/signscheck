import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDk9rTMHPPQeKH0Pg8aie_HKx8pPS-cnnk",
  authDomain: "signsup-675cb.firebaseapp.com",
  projectId: "signsup-675cb",
  storageBucket: "signsup-675cb.firebasestorage.app",
  messagingSenderId: "509998538247",
  appId: "1:509998538247:web:16d944372e55b84a5914a2",
  measurementId: "G-240PF3QCV1",
};

// Initialize Firebase (Singleton pattern)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };
