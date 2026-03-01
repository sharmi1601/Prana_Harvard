// ============================================================
// app.js — Application Glue Layer
// ============================================================
// Connects the PRANA frontend (prana-app.html) to all backend
// services. This file must be loaded LAST, after every other
// script.
//
// Required load order (add to prana-app.html before </body>):
//
//   <!-- Firebase CDN (in <head>) -->
//   <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js"></script>
//
//   <!-- Data & Config -->
//   <script src="../config/firebase-config.js"></script>
//   <script src="../data/ens-config.js"></script>
//   <script src="../data/demo-patients.js"></script>
//
//   <!-- Services -->
//   <script src="../services/auth.js"></script>
//   <script src="../services/database.js"></script>
//   <script src="../services/nlp-service.js"></script>
//   <script src="../services/goal-engine.js"></script>
//   <script src="../services/signal-engine.js"></script>
//   <script src="../services/report-generator.js"></script>
//   <script src="../services/calibration.js"></script>
//   <script src="../services/app.js"></script>   ← this file
//
// Responsibilities:
//   - Wire auth buttons (sign up, log in, Google, sign out, forgot)
//   - Save full profile at end of onboarding (screen5 → allset)
//   - Run the full check-in pipeline on "Done" (screen8)
//   - Trigger calibration prompt when appropriate
//   - Wire SymptoReport card to printReport()
//   - Wire Insights & Patterns card to signal-engine
//   - Load profile from Firestore on auth state change
//   - Enable demo mode when Firebase is not configured
// ============================================================


// ─────────────────────────────────────────────────────────────
// APP STATE
// ─────────────────────────────────────────────────────────────

var APP = {
  uid:        null,     // Firebase Auth UID of the signed-in user
  profile:    null,     // Full Firestore patient document
  checkins:   [],       // Last 14 check-ins, newest-first
  isLoading:  false,    // Guard against double-submits
  isMockMode: false     // True when Firebase is not yet configured
};


// ─────────────────────────────────────────────────────────────
// INITIALIZATION — runs after DOM is fully parsed
// ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  // Determine mock mode based on firebase-config.js placeholder check
  APP.isMockMode = (typeof isFirebaseConfigured === 'function')
    ? !isFirebaseConfigured()
    : true;

  console.log('[App] PRANA initializing. Mock mode:', APP.isMockMode);

  _wireAuthButtons();
  _wireOnboardingNext();
  _wireDoneButton();
  _wireReportCard();
  _wireAnalyticsCard();
  _wireSettingsSignOut();

  if (APP.isMockMode) {
    console.log('[App] Firebase not configured — running with demo data (Meera).');
    _enableDemoMode();
  }
});


// ─────────────────────────────────────────────────────────────
// AUTH STATE OBSERVER
// ─────────────────────────────────────────────────────────────

// Fired by firebase-config.js whenever sign-in state changes.
window.addEventListener('authStateChanged', async function(e) {
  var user = e.detail ? e.detail.user : null;

  if (user) {
    APP.uid = user.uid;
    console.log('[App] User signed in:', user.uid);
    await _loadUserProfile(user.uid);
  } else {
    APP.uid     = null;
    APP.profile = null;
    APP.checkins = [];
    _resetFrontendD();
    console.log('[App] User signed out.');
  }
});


// ─────────────────────────────────────────────────────────────
// AUTH BUTTON WIRING
// ─────────────────────────────────────────────────────────────

function _wireAuthButtons() {
  // ── Sign Up (email + password) ──────────────────────────────
  var signupBtn = document.querySelector('#signup .btn-primary');
  if (signupBtn) {
    signupBtn.addEventListener('click', async function() {
      if (APP.isMockMode) { go('screen2'); return; }

      var emailEl = document.querySelector('#signup input[type=email]');
      var passEl  = document.querySelector('#signup input[type=password]');
      if (!emailEl || !passEl) return;

      _setLoading(signupBtn, 'Creating account...');
      var result = await signUp(emailEl.value.trim(), passEl.value);
      _clearLoading(signupBtn, 'Sign Up');

      if (result.success) {
        APP.uid = result.uid;
        _clearError('signup');
        go('screen2');
      } else {
        _showError('signup', result.errorMessage);
      }
    });
  }

  // ── Log In (email + password) ───────────────────────────────
  var loginBtn = document.querySelector('#login .btn-primary');
  if (loginBtn) {
    loginBtn.addEventListener('click', async function() {
      if (APP.isMockMode) {
        // Demo: load demo profile and go home
        _enableDemoMode();
        go('home');
        return;
      }

      var emailEl = document.querySelector('#login input[type=email]');
      var passEl  = document.querySelector('#login input[type=password]');
      if (!emailEl || !passEl) return;

      _setLoading(loginBtn, 'Signing in...');
      var result = await logIn(emailEl.value.trim(), passEl.value);
      _clearLoading(loginBtn, 'Log In');

      if (result.success) {
        APP.uid = result.uid;
        _clearError('login');
        await _loadUserProfile(result.uid);

        // Route based on whether onboarding is complete
        if (APP.profile) {
          go('home');
        } else {
          go('screen2');
        }
      } else {
        _showError('login', result.errorMessage);
      }
    });
  }

  // ── Google Sign-In ──────────────────────────────────────────
  var googleBtn = document.querySelector('#signup .btn-secondary');
  if (googleBtn) {
    googleBtn.addEventListener('click', async function() {
      if (APP.isMockMode) { go('screen2'); return; }

      _setLoading(googleBtn, 'Connecting...');
      var result = await signInWithGoogle();
      _clearLoading(googleBtn, 'Continue with Google');

      if (result.success) {
        APP.uid = result.uid;
        _clearError('signup');
        await _loadUserProfile(result.uid);

        // New Google users go through onboarding; returning users go home
        if (result.isNewUser || !APP.profile) {
          go('screen2');
        } else {
          go('home');
        }
      } else {
        _showError('signup', result.errorMessage);
      }
    });
  }

  // ── Forgot Password ─────────────────────────────────────────
  var forgotLink = document.querySelector('#login p[style*="cursor"]');
  if (forgotLink) {
    forgotLink.addEventListener('click', async function() {
      if (APP.isMockMode) {
        alert('Password reset is not available in demo mode.');
        return;
      }
      var emailEl = document.querySelector('#login input[type=email]');
      var email   = emailEl ? emailEl.value.trim() : '';

      var result  = await sendPasswordReset(email);
      if (result.success) {
        alert('Password reset email sent! Check your inbox.');
      } else {
        _showError('login', result.errorMessage);
      }
    });
  }
}


// ─────────────────────────────────────────────────────────────
// SIGN-OUT (in settings menu)
// ─────────────────────────────────────────────────────────────

function _wireSettingsSignOut() {
  var signoutBtn = document.querySelector('.settings-menu .danger');
  if (!signoutBtn) return;

  signoutBtn.addEventListener('click', async function() {
    document.getElementById('settingsMenu').classList.remove('show');

    if (!APP.isMockMode) {
      await signOut();
    }

    APP.uid     = null;
    APP.profile = null;
    APP.checkins = [];
    _resetFrontendD();
    go('landing');
  });
}


// ─────────────────────────────────────────────────────────────
// ONBOARDING — save full profile after screen5
// ─────────────────────────────────────────────────────────────

function _wireOnboardingNext() {
  var screen5Btn = document.querySelector('#screen5 .btn-next');
  if (!screen5Btn) return;

  screen5Btn.addEventListener('click', async function() {
    // Collect everything from the 4 onboarding screens
    var profileFields  = collectProfileFromUI();
    var baselineFields = collectBaselineFromUI();
    var goals          = collectGoalsFromUI();

    var fullProfile = Object.assign({}, profileFields, baselineFields, {
      goals:          goals,
      baselineStatus: 'provisional'
    });

    // Sync to the frontend's D object (used by setupHome, setupHealthCard)
    Object.assign(D, fullProfile);
    APP.profile = fullProfile;

    // Save to Firestore (unless mock mode)
    if (!APP.isMockMode && APP.uid) {
      _setLoading(screen5Btn, 'Saving...');
      var result = await saveProfile(APP.uid, fullProfile);
      _clearLoading(screen5Btn, 'Next →');

      if (!result.success) {
        console.error('[App] Failed to save profile:', result.errorMessage);
      }
    }

    go('allset');
  });
}


// ─────────────────────────────────────────────────────────────
// DAILY CHECK-IN PIPELINE
// ─────────────────────────────────────────────────────────────

function _wireDoneButton() {
  var doneBtn = document.querySelector('#screen8 .btn-done');
  if (!doneBtn) return;

  doneBtn.addEventListener('click', async function() {
    if (APP.isLoading) return;
    APP.isLoading = true;
    _setLoading(doneBtn, 'Saving...');

    try {
      await _runCheckinPipeline();
    } catch (err) {
      console.error('[App] Check-in pipeline error:', err);
    }

    _clearLoading(doneBtn, 'Done ✓');
    APP.isLoading = false;

    // markLogged() and go('home') are the original inline functions
    markLogged();
    go('home');
  });
}


/**
 * Full daily check-in pipeline:
 *   1. Read UI → assemble checkin object
 *   2. Save raw check-in to Firestore
 *   3. Run NLP on free-text (async, non-blocking UX)
 *   4. Compute goal progress
 *   5. Patch check-in with NLP + goal data
 *   6. Cache locally (APP.checkins)
 *   7. Check if calibration should be triggered
 */
async function _runCheckinPipeline() {
  if (!APP.uid && !APP.isMockMode) {
    console.warn('[App] No UID — data will not be saved to Firestore.');
  }

  // Step 1: Collect from UI
  var checkinData = collectCheckinFromUI();
  console.log('[App] Check-in:', checkinData.date, '| ENS6Q total:', checkinData.ens6qTotal);

  // Step 2: Save raw check-in
  if (!APP.isMockMode && APP.uid) {
    var saveResult = await saveCheckin(APP.uid, checkinData);
    if (!saveResult.success) {
      console.error('[App] saveCheckin failed:', saveResult.errorMessage);
      return;
    }
  }

  // Step 3: NLP analysis (only if there is free-text)
  var nlpOutput = null;
  if (checkinData.freeText) {
    try {
      nlpOutput = await mapSymptomsToTerms(checkinData.freeText, checkinData.ens6q);
      console.log('[App] NLP:', nlpOutput.mappedTerms.length, 'terms |', nlpOutput.overallSentiment, 'sentiment');
    } catch (err) {
      console.error('[App] NLP error:', err);
    }
  }

  // Step 4: Goal progress
  var goalProgress = null;
  if (APP.profile && APP.profile.goals && APP.profile.goals.length && APP.profile.baselineENS6Q) {
    try {
      goalProgress = computeAllGoalProgress(
        APP.profile.goals,
        checkinData.ens6q,
        APP.profile.baselineENS6Q,
        APP.checkins.slice(0, 14)
      );
      console.log('[App] Goal progress computed for', Object.keys(goalProgress).length, 'goals.');
    } catch (err) {
      console.error('[App] Goal engine error:', err);
    }
  }

  // Step 5: Patch check-in document with enriched data
  if (!APP.isMockMode && APP.uid && (nlpOutput || goalProgress)) {
    var patch = {};
    if (nlpOutput)    patch.nlpOutput    = nlpOutput;
    if (goalProgress) patch.goalProgress = goalProgress;
    await updateCheckin(APP.uid, checkinData.date, patch);
  }

  // Step 6: Add to local cache (newest first)
  APP.checkins.unshift(Object.assign({}, checkinData, {
    nlpOutput:    nlpOutput,
    goalProgress: goalProgress
  }));
  // Keep cache bounded
  if (APP.checkins.length > 28) {
    APP.checkins = APP.checkins.slice(0, 28);
  }

  // Step 7: Calibration check
  if (APP.profile && APP.uid) {
    var calibCheck = await checkCalibration(APP.uid, APP.profile);
    if (calibCheck.triggered) {
      // Small delay so the home screen loads first
      setTimeout(function() {
        _showCalibrationPrompt(calibCheck.calibResult);
      }, 800);
    }
  }
}


// ─────────────────────────────────────────────────────────────
// CALIBRATION UI PROMPT
// ─────────────────────────────────────────────────────────────

function _showCalibrationPrompt(calibResult) {
  var message = buildCalibrationMessage(calibResult);

  var doUpdate = window.confirm(
    'Prana Baseline Update\n\n' +
    message +
    '\n\nWould you like to update your baseline to improve accuracy?'
  );

  if (APP.isMockMode) return;

  if (doUpdate) {
    confirmCalibration(APP.uid, calibResult.newBaseline, calibResult.newBaselineTotal)
      .then(function() {
        // Keep the in-memory profile in sync
        if (APP.profile) {
          APP.profile.baselineENS6Q  = calibResult.newBaseline;
          APP.profile.baselineTotal  = calibResult.newBaselineTotal;
          APP.profile.baselineStatus = 'calibrated';
        }
        console.log('[App] Baseline updated in memory and Firestore.');
      });
  } else {
    skipCalibration(APP.uid);
  }
}


// ─────────────────────────────────────────────────────────────
// SYMPTOREPPORT CARD
// ─────────────────────────────────────────────────────────────

function _wireReportCard() {
  // The 4th home card is SymptoReport
  var cards = document.querySelectorAll('#home-cards-area .home-card');
  var reportCard = cards[3];   // 0-indexed: 0=Log, 1=Insights, 2=Health, 3=Report
  if (!reportCard) return;

  reportCard.addEventListener('click', async function() {
    // Need at least one check-in
    if (!APP.checkins.length) {
      alert('Log at least one day before generating a report.');
      return;
    }

    if (APP.isMockMode) {
      _buildAndOpenDemoReport();
      return;
    }

    if (!APP.uid) {
      alert('Please sign in first.');
      return;
    }

    reportCard.querySelector('h4').textContent = 'Generating...';
    await printReport(APP.uid);
    reportCard.querySelector('h4').textContent = 'SymptoReport';
  });
}


// ─────────────────────────────────────────────────────────────
// INSIGHTS & PATTERNS CARD
// ─────────────────────────────────────────────────────────────

function _wireAnalyticsCard() {
  var cards = document.querySelectorAll('#home-cards-area .home-card');
  var analyticsCard = cards[1];   // 2nd card
  if (!analyticsCard) return;

  analyticsCard.addEventListener('click', function() {
    var checkins = APP.checkins;

    if (!checkins.length) {
      alert('Log at least ' + TRACKING.minDaysForSignal + ' check-ins to see patterns.');
      return;
    }

    var correlations = computeTriggerCorrelations(checkins);
    var sleep        = computeSleepCorrelation(checkins);
    var weekly       = computeWeeklyTrend(checkins);

    // Build a readable summary
    var lines = ['INSIGHTS & PATTERNS\n'];

    // Weekly trend
    var trendEmoji = weekly.direction === 'improving' ? '↓' :
                     weekly.direction === 'worsening' ? '↑' : '→';
    lines.push('Week-over-week trend: ' + trendEmoji + ' ' + weekly.direction +
               ' (Δ ' + (weekly.delta > 0 ? '+' : '') + weekly.delta + ' pts)');
    lines.push('');

    // Trigger correlations
    if (!correlations.hasEnoughData) {
      lines.push(correlations.summary);
    } else if (!correlations.insights.length) {
      lines.push('No strong trigger patterns found yet.');
    } else {
      lines.push('Top Triggers:');
      correlations.insights.slice(0, 4).forEach(function(ins) {
        lines.push('  • ' + ins.description);
      });
    }

    // Sleep
    if (sleep.hasPattern) {
      lines.push('');
      lines.push('Sleep: ' + sleep.description);
    }

    alert(lines.join('\n'));
  });
}


// ─────────────────────────────────────────────────────────────
// PROFILE LOADING — syncs Firestore → frontend D object
// ─────────────────────────────────────────────────────────────

async function _loadUserProfile(uid) {
  if (!uid || APP.isMockMode) return;

  var profileResult = await loadProfile(uid);

  if (profileResult.success && profileResult.data) {
    APP.profile = profileResult.data;
    _syncProfileToFrontend(APP.profile);
    console.log('[App] Profile loaded for:', APP.profile.name || uid);

    // Pre-fetch recent check-ins so the pipeline and signal engine have data
    var checkinsResult = await getCheckins(uid, 14);
    if (checkinsResult.success) {
      APP.checkins = checkinsResult.data;
      console.log('[App] Loaded', APP.checkins.length, 'recent check-ins.');
    }
  } else {
    console.log('[App] No profile yet — user needs to complete onboarding.');
  }
}

/**
 * Copies Firestore profile fields into the frontend's in-memory
 * D object so that setupHome() and setupHealthCard() work correctly.
 */
function _syncProfileToFrontend(profile) {
  if (!profile || typeof D === 'undefined') return;
  D.name      = profile.name      || '';
  D.age       = profile.age       || '';
  D.gender    = profile.gender    || '';
  D.phone     = profile.phone     || '';
  D.meds      = profile.meds      || '';
  D.blood     = profile.blood     || '';
  D.allergies = profile.allergies || '';
  D.caretaker = profile.caretaker || '';
  D.subtype   = profile.subtype   || '';
  D.surgery   = profile.surgery   || '';
}

function _resetFrontendD() {
  if (typeof D === 'undefined') return;
  D.name = D.age = D.gender = D.phone = D.meds =
  D.blood = D.allergies = D.caretaker = D.subtype = D.surgery = '';
}


// ─────────────────────────────────────────────────────────────
// DEMO MODE — when Firebase is not yet configured
// ─────────────────────────────────────────────────────────────

function _enableDemoMode() {
  if (typeof DEMO_MEERA === 'undefined') return;

  APP.profile  = DEMO_MEERA.profile;
  // checkins in demo-patients are oldest-first; reverse for newest-first cache
  APP.checkins = DEMO_MEERA.checkins.slice().reverse();

  _syncProfileToFrontend(APP.profile);
  console.log('[App] Demo data loaded for:', APP.profile.name);
}

function _buildAndOpenDemoReport() {
  if (!APP.profile || !APP.checkins.length) {
    alert('No demo data available.');
    return;
  }

  var profile      = APP.profile;
  var checkins     = APP.checkins;
  var latestCheck  = checkins[0];

  var goalProgress = {};
  var goalSummary  = { totalGoals: 0, avgProgress: 0, overallStatus: 'no_goals', bestGoal: null, worstGoal: null };

  if (profile.goals && profile.goals.length && profile.baselineENS6Q) {
    goalProgress = computeAllGoalProgress(
      profile.goals, latestCheck.ens6q, profile.baselineENS6Q, checkins
    );
    goalSummary = getGoalSummary(goalProgress);
  }

  var correlations = computeTriggerCorrelations(checkins);
  var sleepPattern = computeSleepCorrelation(checkins);
  var weeklyTrend  = computeWeeklyTrend(checkins);

  var domainAverages = {};
  ENS_DOMAIN_KEYS.forEach(function(k) { domainAverages[k] = 0; });
  checkins.forEach(function(c) {
    ENS_DOMAIN_KEYS.forEach(function(k) {
      if (c.ens6q) domainAverages[k] += (c.ens6q[k] || 0);
    });
  });
  ENS_DOMAIN_KEYS.forEach(function(k) {
    domainAverages[k] = parseFloat((domainAverages[k] / checkins.length).toFixed(2));
  });

  var reportData = {
    generatedDate:  'Demo Report',
    patient:        profile,
    checkinCount:   checkins.length,
    dateRange:      {
      from: checkins[checkins.length - 1].date,
      to:   checkins[0].date
    },
    latestCheckin:  latestCheck,
    domainAverages: domainAverages,
    goalProgress:   goalProgress,
    goalSummary:    goalSummary,
    correlations:   correlations,
    sleepPattern:   sleepPattern,
    weeklyTrend:    weeklyTrend,
    recentInsights: [],
    recentCheckins: checkins.slice(0, 14)
  };

  var html = buildReportHTML(reportData);
  var win  = window.open('', '_blank');
  if (!win) {
    alert('Allow pop-ups to view the demo report.');
    return;
  }
  win.document.write(html);
  win.document.close();
  setTimeout(function() { win.print(); }, 900);
}


// ─────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────

function _setLoading(btn, text) {
  if (!btn) return;
  btn.disabled = true;
  btn._originalText = btn.textContent;
  btn.textContent   = text;
}

function _clearLoading(btn, text) {
  if (!btn) return;
  btn.disabled    = false;
  btn.textContent = text || btn._originalText || '';
}

function _showError(screenId, message) {
  _clearError(screenId);
  var screen = document.getElementById(screenId);
  if (!screen) return;

  var el = document.createElement('p');
  el.className  = 'app-error';
  el.style.cssText = [
    'color:#c0392b', 'font-size:12px', 'text-align:center',
    'margin-top:10px', 'padding:8px 12px',
    'background:rgba(192,57,43,.08)', 'border-radius:8px'
  ].join(';');
  el.textContent = message;

  // Insert after the primary button
  var btn = screen.querySelector('.btn-primary');
  if (btn) {
    btn.parentNode.insertBefore(el, btn.nextSibling);
  }
}

function _clearError(screenId) {
  var screen = document.getElementById(screenId);
  if (!screen) return;
  var existing = screen.querySelector('.app-error');
  if (existing) existing.remove();
}
