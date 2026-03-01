// ============================================================
// auth.js — Firebase Authentication Service
// ============================================================
// Handles signup, login, signout, and auth state management.
// Depends on: config/firebase-config.js (provides `auth` and `db`)
//
// The frontend has these screens:
//   #signup  → email + password inputs → "Sign Up" button
//   #login   → email + password inputs → "Log In" button
//   #home    → settings menu → "Sign Out" button
//
// This file provides the functions that app.js will wire
// to those buttons. It does NOT touch the DOM directly —
// all DOM wiring happens in app.js.
// ============================================================


// ---------- Sign Up ----------
// Creates a new Firebase Auth user, then returns the UID.
// The caller (app.js) is responsible for navigating screens
// and calling saveProfile() afterward.

async function signUp(email, password) {
  _validateAuthInputs(email, password);

  try {
    const credential = await auth.createUserWithEmailAndPassword(email, password);
    const user = credential.user;
    console.log('[Auth] Signup success:', user.uid);
    return { success: true, uid: user.uid, user: user };

  } catch (error) {
    console.error('[Auth] Signup error:', error.code, error.message);
    return {
      success: false,
      errorCode: error.code,
      errorMessage: _friendlyAuthError(error.code)
    };
  }
}


// ---------- Log In ----------
// Signs in an existing user. Returns the UID so app.js can
// call loadProfile() to populate the frontend's D object.

async function logIn(email, password) {
  _validateAuthInputs(email, password);

  try {
    const credential = await auth.signInWithEmailAndPassword(email, password);
    const user = credential.user;
    console.log('[Auth] Login success:', user.uid);
    return { success: true, uid: user.uid, user: user };

  } catch (error) {
    console.error('[Auth] Login error:', error.code, error.message);
    return {
      success: false,
      errorCode: error.code,
      errorMessage: _friendlyAuthError(error.code)
    };
  }
}


// ---------- Sign Out ----------
// Clears Firebase session. The caller (app.js) should also
// reset the frontend's D object and navigate to landing.

async function signOut() {
  try {
    await auth.signOut();
    console.log('[Auth] Signed out');
    return { success: true };

  } catch (error) {
    console.error('[Auth] Signout error:', error.message);
    return { success: false, errorCode: error.code || 'unknown', errorMessage: error.message };
  }
}


// ---------- Google Sign-In ----------
// The frontend has a "Continue with Google" button on the
// signup screen. This uses Firebase's Google Auth provider.

async function signInWithGoogle() {
  try {
    var provider = new firebase.auth.GoogleAuthProvider();
    var result = await auth.signInWithPopup(provider);
    var user = result.user;
    var isNewUser = result.additionalUserInfo && result.additionalUserInfo.isNewUser;

    console.log('[Auth] Google sign-in success:', user.uid, 'New user:', isNewUser);
    return {
      success: true,
      uid: user.uid,
      user: user,
      isNewUser: isNewUser
    };

  } catch (error) {
    console.error('[Auth] Google sign-in error:', error.code, error.message);
    return {
      success: false,
      errorCode: error.code,
      errorMessage: _friendlyAuthError(error.code)
    };
  }
}


// ---------- Password Reset ----------
// The frontend has a "Forgot password?" link on the login screen.

async function sendPasswordReset(email) {
  if (!email || !email.trim()) {
    return { success: false, errorCode: 'auth/missing-email', errorMessage: 'Please enter your email address first.' };
  }

  try {
    await auth.sendPasswordResetEmail(email.trim());
    console.log('[Auth] Password reset email sent to:', email);
    return { success: true };

  } catch (error) {
    console.error('[Auth] Password reset error:', error.code);
    return {
      success: false,
      errorCode: error.code,
      errorMessage: _friendlyAuthError(error.code)
    };
  }
}


// ---------- Get Current User ----------
// Quick helpers used by database.js and other services.

function getCurrentUserId() {
  var user = auth.currentUser;
  if (!user) {
    console.warn('[Auth] No user currently signed in.');
    return null;
  }
  return user.uid;
}

function getCurrentUser() {
  return auth.currentUser;
}

function isLoggedIn() {
  return auth.currentUser !== null;
}


// ---------- Auth State Observer ----------
// Other files can register callbacks that fire on auth changes.
// This supplements the custom event in firebase-config.js.

var _authCallbacks = [];

function onAuthChange(callback) {
  _authCallbacks.push(callback);
}

// Listen to the custom event from firebase-config.js
window.addEventListener('authStateChanged', function(e) {
  var user = e.detail.user;
  _authCallbacks.forEach(function(cb) {
    try { cb(user); } catch (err) {
      console.error('[Auth] Callback error:', err);
    }
  });
});


// ============================================================
// Private helpers
// ============================================================

function _validateAuthInputs(email, password) {
  if (!email || !email.trim()) {
    throw new Error('Please enter your email address.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }
}

// Maps Firebase error codes to user-friendly messages.
function _friendlyAuthError(code) {
  var messages = {
    'auth/email-already-in-use':   'An account with this email already exists. Try logging in.',
    'auth/invalid-email':          'Please enter a valid email address.',
    'auth/weak-password':          'Password should be at least 6 characters.',
    'auth/user-not-found':         'No account found with this email. Try signing up.',
    'auth/wrong-password':         'Incorrect password. Please try again.',
    'auth/too-many-requests':      'Too many attempts. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'auth/popup-closed-by-user':   'Google sign-in was cancelled.',
    'auth/user-disabled':          'This account has been disabled. Contact support.',
    'auth/invalid-credential':     'Invalid email or password. Please try again.'
  };
  return messages[code] || 'Something went wrong. Please try again.';
}
