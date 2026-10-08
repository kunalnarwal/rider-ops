importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// ⚠️ PASTE THE SAME FIREBASE CONFIG HERE AS IN src/firebase.js ⚠️
firebase.initializeApp({
  apiKey: "AIzaSyAGSDDZ9IClxN-3qMnbHStXkHhhyJIMOF8",
  authDomain: "ops-tracker-43e1a.firebaseapp.com",
  projectId: "ops-tracker-43e1a",
  storageBucket: "ops-tracker-43e1a.firebasestorage.app",
  messagingSenderId: "578375979859",
  appId: "1:578375979859:web:f17b5a854ee9079ebb87a6",
});

const messaging = firebase.messaging();

// Shows the notification even when the app/tab is closed
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Rider Ops";
  const options = {
    body: payload.notification?.body || "",
    icon: "/icon.png",
  };
  self.registration.showNotification(title, options);
});
