import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyC9svtNm_FqEetfqT7OLLP9Ge1zLbpVa0k",
  authDomain: "signsup-e4432.firebaseapp.com",
  projectId: "signsup-e4432",
  storageBucket: "signsup-e4432.firebasestorage.app",
  messagingSenderId: "762277760915",
  appId: "1:762277760915:web:03e9fb289c2aa694186266",
};

// Initialize Firebase (Singleton pattern)
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };
