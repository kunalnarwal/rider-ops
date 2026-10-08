import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

// ⚠️ PASTE YOUR FIREBASE CONFIG HERE ⚠️
// Get this from: Firebase Console → Project Settings → General → "Your apps" → Web app
const firebaseConfig = {
  apiKey: "AIzaSyAGSDDZ9IClxN-3qMnbHStXkHhhyJIMOF8",
  authDomain: "ops-tracker-43e1a.firebaseapp.com",
  projectId: "ops-tracker-43e1a",
  storageBucket: "ops-tracker-43e1a.firebasestorage.app",
  messagingSenderId: "578375979859",
  appId: "1:578375979859:web:f17b5a854ee9079ebb87a6",
  measurementId: "G-5P9SEFNHDY",
};

// ⚠️ PASTE YOUR VAPID KEY HERE ⚠️
// Get this from: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
export const VAPID_KEY = "YOUR_VAPID_KEY";

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// ---------- Push notification helpers ----------
export async function setupNotifications(riderId) {
  try {
    const supported = await isSupported();
    if (!supported) return { ok: false, reason: "not-supported" };

    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "denied" };

    const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const messaging = getMessaging(app);
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    if (!token) return { ok: false, reason: "no-token" };

    const { setDoc, doc } = await import("firebase/firestore");
    await setDoc(doc(db, "tokens", riderId), { riderId, token, updatedAt: Date.now() });

    onMessage(messaging, (payload) => {
      console.log("Foreground notification:", payload);
    });

    return { ok: true };
  } catch (e) {
    console.error("Notification setup failed:", e);
    return { ok: false, reason: "error" };
  }
}
