// ============================================================
// firebase-config.js — Firebase Initialization
// ============================================================
// This file initializes Firebase App, Auth, and Firestore.
// All other backend files import `auth` and `db` from here.
//
// SETUP INSTRUCTIONS:
// 1. Go to https://console.firebase.google.com
// 2. Create project → "raresignal"
// 3. Enable Authentication → Email/Password provider
// 4. Enable Firestore → Start in test mode
// 5. Project Settings → Your Apps → Add Web App → Copy config
// 6. Replace the placeholder values below with your real config
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyCAMPCftg-xCBvwmSdixcPyfFaDg4ef5rc",
  authDomain: "prana-57962.firebaseapp.com",
  projectId: "prana-57962",
  storageBucket: "prana-57962.firebasestorage.app",
  messagingSenderId: "1059743801197",
  appId: "1:1059743801197:web:568890e46c9aafe76fc464",
  measurementId: "G-WG8L9K1S6E"
};

// ---------- Initialize Firebase ----------
firebase.initializeApp(firebaseConfig);

// ---------- Export core services ----------
// These two objects are used by every other backend file.
const auth = firebase.auth();
const db   = firebase.firestore();

// ---------- Firestore settings ----------
// Enable offline persistence so the app works without internet.
// Useful during hackathon demos with spotty Wi-Fi.
db.enablePersistence({ synchronizeTabs: true })
  .catch(function(err) {
    if (err.code === 'failed-precondition') {
      // Multiple tabs open — persistence can only be enabled in one tab.
      console.warn('[Firebase] Persistence failed: multiple tabs open.');
    } else if (err.code === 'unimplemented') {
      // Browser doesn't support persistence.
      console.warn('[Firebase] Persistence not supported in this browser.');
    }
  });

// ---------- Auth state listener ----------
// Fires whenever the user signs in or out.
// Other files can override `window.onAuthStateChanged` to react.
auth.onAuthStateChanged(function(user) {
  if (user) {
    console.log('[Auth] Signed in:', user.uid);
  } else {
    console.log('[Auth] Signed out');
  }

  // Dispatch custom event so other files can listen
  window.dispatchEvent(new CustomEvent('authStateChanged', {
    detail: { user: user }
  }));
});

// ---------- Helper: check if Firebase is configured ----------
function isFirebaseConfigured() {
  return firebaseConfig.apiKey !== "YOUR_API_KEY";
}

// ---------- Console confirmation ----------
if (isFirebaseConfigured()) {
  console.log('[Firebase] Initialized successfully for project:', firebaseConfig.projectId);
} else {
  console.warn(
    '[Firebase] Using placeholder config. Replace values in config/firebase-config.js with your real Firebase project credentials.'
  );
}
