// ============================================================
// database.js — Firestore CRUD Operations
// ============================================================
// All read/write operations for patient data, check-ins,
// and reports. This is the data layer every other service
// talks to.
//
// Depends on:
//   config/firebase-config.js  → provides `db` (Firestore)
//   services/auth.js           → provides getCurrentUserId()
//
// Firestore Collections:
//   patients/{uid}                      → Patient profile
//   patients/{uid}/checkins/{YYYY-MM-DD} → Daily check-in
//   patients/{uid}/reports/{autoId}      → Generated reports
// ============================================================


// ─────────────────────────────────────────────────────────────
// HELPER: today's date as YYYY-MM-DD string
// ─────────────────────────────────────────────────────────────

function _todayString() {
  var d = new Date();
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}


// ─────────────────────────────────────────────────────────────
// 1. PATIENT PROFILE
// ─────────────────────────────────────────────────────────────

/**
 * saveProfile — writes the full patient profile after onboarding.
 *
 * Called once, when the user finishes screen5 → allset transition.
 * Uses set() with merge so it can also be used for partial updates.
 *
 * @param {string} uid - Firebase Auth UID
 * @param {object} profileData - shape:
 *   {
 *     name, age, gender, phone, meds, blood, allergies, caretaker,
 *     subtype,        // "ENS-IT" | "ENS-MT" | "ENS-Both"
 *     surgery,        // "YYYY-MM-DD" or ""
 *     baselineENS6Q:  { suffocation, burning, openness, crusting, dryness, air },
 *     baselineTotal:  number (sum of 6 domains),
 *     baselineStatus: "provisional",
 *     goals:          [ { key, name, target } ],
 *   }
 */
async function saveProfile(uid, profileData) {
  if (!uid) throw new Error('[DB] saveProfile requires a uid.');

  var doc = Object.assign({}, profileData, {
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  try {
    await db.collection('patients').doc(uid).set(doc, { merge: true });
    console.log('[DB] Profile saved for:', uid);
    return { success: true };
  } catch (error) {
    console.error('[DB] saveProfile error:', error);
    return { success: false, errorMessage: error.message };
  }
}


/**
 * loadProfile — reads the full patient document.
 *
 * Called on login to populate the frontend's D object.
 * Returns null if no profile exists yet (new Google sign-in user
 * who hasn't completed onboarding).
 */
async function loadProfile(uid) {
  if (!uid) throw new Error('[DB] loadProfile requires a uid.');

  try {
    var snap = await db.collection('patients').doc(uid).get();
    if (!snap.exists) {
      console.log('[DB] No profile found for:', uid);
      return { success: true, data: null };
    }
    console.log('[DB] Profile loaded for:', uid);
    return { success: true, data: snap.data() };
  } catch (error) {
    console.error('[DB] loadProfile error:', error);
    return { success: false, errorMessage: error.message };
  }
}


/**
 * updateProfile — partial update to an existing profile.
 *
 * Used by calibration.js to update baseline, or if the user
 * edits their health card later.
 */
async function updateProfile(uid, fields) {
  if (!uid) throw new Error('[DB] updateProfile requires a uid.');

  var doc = Object.assign({}, fields, {
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  try {
    await db.collection('patients').doc(uid).update(doc);
    console.log('[DB] Profile updated for:', uid);
    return { success: true };
  } catch (error) {
    console.error('[DB] updateProfile error:', error);
    return { success: false, errorMessage: error.message };
  }
}


// ─────────────────────────────────────────────────────────────
// 2. DAILY CHECK-INS
// ─────────────────────────────────────────────────────────────

/**
 * saveCheckin — writes one daily check-in document.
 *
 * Document ID = date string (YYYY-MM-DD) so there's exactly
 * one check-in per day. If the user somehow submits twice,
 * it overwrites (merge) rather than duplicating.
 *
 * @param {string} uid
 * @param {object} checkinData - shape:
 *   {
 *     date:          "YYYY-MM-DD",
 *     ens6q:         { suffocation, burning, openness, crusting, dryness, air },
 *     ens6qTotal:    number,
 *     freeText:      string,
 *     triggers:      ["A/C", "Stress", ...],
 *     sleepHours:    number (e.g. 7.5),
 *     goalProximity: number (1–10),
 *     nlpOutput:     object | null  (filled later by nlp-service),
 *     goalProgress:  object | null  (filled later by goal-engine),
 *   }
 */
async function saveCheckin(uid, checkinData) {
  if (!uid) throw new Error('[DB] saveCheckin requires a uid.');
  if (!checkinData.date) throw new Error('[DB] saveCheckin requires a date.');

  var doc = Object.assign({}, checkinData, {
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  try {
    await db.collection('patients').doc(uid)
      .collection('checkins').doc(checkinData.date)
      .set(doc, { merge: true });
    console.log('[DB] Check-in saved:', checkinData.date);
    return { success: true };
  } catch (error) {
    console.error('[DB] saveCheckin error:', error);
    return { success: false, errorMessage: error.message };
  }
}


/**
 * updateCheckin — partial update to an existing check-in.
 *
 * Used to patch in nlpOutput or goalProgress after the
 * initial save.
 */
async function updateCheckin(uid, date, fields) {
  if (!uid || !date) throw new Error('[DB] updateCheckin requires uid and date.');

  try {
    await db.collection('patients').doc(uid)
      .collection('checkins').doc(date)
      .update(fields);
    console.log('[DB] Check-in updated:', date, Object.keys(fields));
    return { success: true };
  } catch (error) {
    console.error('[DB] updateCheckin error:', error);
    return { success: false, errorMessage: error.message };
  }
}


/**
 * getCheckins — fetch the last N check-ins, ordered by date desc.
 *
 * Used by goal-engine, signal-engine, report-generator.
 * Default is 14 days (the full initial tracking window).
 */
async function getCheckins(uid, days) {
  if (!uid) throw new Error('[DB] getCheckins requires a uid.');
  days = days || 14;

  try {
    var snap = await db.collection('patients').doc(uid)
      .collection('checkins')
      .orderBy('date', 'desc')
      .limit(days)
      .get();

    var checkins = [];
    snap.forEach(function(doc) {
      checkins.push(doc.data());
    });

    console.log('[DB] Fetched', checkins.length, 'check-ins for:', uid);
    return { success: true, data: checkins };
  } catch (error) {
    console.error('[DB] getCheckins error:', error);
    return { success: false, data: [], errorMessage: error.message };
  }
}


/**
 * getAllCheckins — fetch every check-in (no limit).
 *
 * Used by signal-engine when computing trigger correlations
 * across the full history, and by report-generator.
 */
async function getAllCheckins(uid) {
  if (!uid) throw new Error('[DB] getAllCheckins requires a uid.');

  try {
    var snap = await db.collection('patients').doc(uid)
      .collection('checkins')
      .orderBy('date', 'asc')
      .get();

    var checkins = [];
    snap.forEach(function(doc) {
      checkins.push(doc.data());
    });

    console.log('[DB] Fetched all', checkins.length, 'check-ins for:', uid);
    return { success: true, data: checkins };
  } catch (error) {
    console.error('[DB] getAllCheckins error:', error);
    return { success: false, data: [], errorMessage: error.message };
  }
}


/**
 * getCheckinCount — returns total number of check-ins.
 *
 * Used by calibration.js to know when Day 5 is reached.
 * Note: Firestore doesn't have a native count, so we fetch
 * just the doc IDs (lightweight) and count locally.
 */
async function getCheckinCount(uid) {
  if (!uid) throw new Error('[DB] getCheckinCount requires a uid.');

  try {
    var snap = await db.collection('patients').doc(uid)
      .collection('checkins')
      .get();
    console.log('[DB] Check-in count for', uid, ':', snap.size);
    return { success: true, count: snap.size };
  } catch (error) {
    console.error('[DB] getCheckinCount error:', error);
    return { success: false, count: 0, errorMessage: error.message };
  }
}


/**
 * hasCheckedInToday — checks if today's check-in exists.
 *
 * Called when home screen loads to set the daily log card
 * state ("Ready to reflect" vs "Logged and reflected").
 */
async function hasCheckedInToday(uid) {
  if (!uid) throw new Error('[DB] hasCheckedInToday requires a uid.');

  var today = _todayString();

  try {
    var snap = await db.collection('patients').doc(uid)
      .collection('checkins').doc(today)
      .get();
    var exists = snap.exists;
    console.log('[DB] Checked in today?', exists);
    return { success: true, hasCheckedIn: exists };
  } catch (error) {
    console.error('[DB] hasCheckedInToday error:', error);
    return { success: false, hasCheckedIn: false, errorMessage: error.message };
  }
}


// ─────────────────────────────────────────────────────────────
// 3. BASELINE (used by calibration.js)
// ─────────────────────────────────────────────────────────────

/**
 * updateBaseline — overwrites the baseline fields in the
 * patient document after Day 5 calibration.
 *
 * @param {string} uid
 * @param {object} newBaseline - shape:
 *   {
 *     baselineENS6Q:  { suffocation, burning, openness, crusting, dryness, air },
 *     baselineTotal:  number,
 *     baselineStatus: "confirmed"
 *   }
 */
async function updateBaseline(uid, newBaseline) {
  if (!uid) throw new Error('[DB] updateBaseline requires a uid.');

  return await updateProfile(uid, newBaseline);
}


// ─────────────────────────────────────────────────────────────
// 4. CLINICIAN REPORTS
// ─────────────────────────────────────────────────────────────

/**
 * saveReport — writes a generated clinician report document.
 *
 * Uses auto-generated document ID so each report is unique.
 */
async function saveReport(uid, reportData) {
  if (!uid) throw new Error('[DB] saveReport requires a uid.');

  var doc = Object.assign({}, reportData, {
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  try {
    var ref = await db.collection('patients').doc(uid)
      .collection('reports').add(doc);
    console.log('[DB] Report saved:', ref.id);
    return { success: true, reportId: ref.id };
  } catch (error) {
    console.error('[DB] saveReport error:', error);
    return { success: false, errorMessage: error.message };
  }
}


/**
 * getReports — fetch all reports, newest first.
 */
async function getReports(uid) {
  if (!uid) throw new Error('[DB] getReports requires a uid.');

  try {
    var snap = await db.collection('patients').doc(uid)
      .collection('reports')
      .orderBy('createdAt', 'desc')
      .get();

    var reports = [];
    snap.forEach(function(doc) {
      var data = doc.data();
      data.id = doc.id;
      reports.push(data);
    });

    console.log('[DB] Fetched', reports.length, 'reports for:', uid);
    return { success: true, data: reports };
  } catch (error) {
    console.error('[DB] getReports error:', error);
    return { success: false, data: [], errorMessage: error.message };
  }
}


// ─────────────────────────────────────────────────────────────
// 5. DATA COLLECTION HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * collectCheckinFromUI — reads the frontend's form elements
 * and assembles a complete check-in data object.
 *
 * This bridges the gap between the frontend's DOM and the
 * database's expected data shape. Called by app.js when the
 * "Done" button is pressed on Screen 8.
 *
 * Reads from:
 *   #daily-sliders  → ENS6Q scores (6 sliders)
 *   textarea        → free-text
 *   .chip.active    → selected triggers
 *   #sleep-hrs      → sleep hours selector
 *   #sleep-min      → sleep minutes selector
 *   #prox-slider    → goal proximity (1–10)
 */
function collectCheckinFromUI() {
  // ENS6Q scores from daily sliders
  var ens6qKeys = ['suffocation', 'burning', 'openness', 'crusting', 'dryness', 'air'];
  var ens6q = {};
  var ens6qTotal = 0;

  var sliderContainer = document.getElementById('daily-sliders');
  var sliderRows = sliderContainer ? sliderContainer.querySelectorAll('.slider-row') : [];

  sliderRows.forEach(function(row, i) {
    var slider = row.querySelector('input[type=range]');
    var val = slider ? parseInt(slider.value) : 0;
    ens6q[ens6qKeys[i]] = val;
    ens6qTotal += val;
  });

  // Free-text from textarea
  var textarea = document.querySelector('#screen7 textarea, #screen8 textarea');
  var freeText = textarea ? textarea.value.trim() : '';

  // Selected triggers
  var triggers = [];
  document.querySelectorAll('#trigger-chips .chip.active').forEach(function(chip) {
    triggers.push(chip.textContent.trim());
  });

  // Sleep duration
  var sleepHrsEl = document.getElementById('sleep-hrs');
  var sleepMinEl = document.getElementById('sleep-min');
  var sleepHrs = sleepHrsEl ? parseInt(sleepHrsEl.value) : 7;
  var sleepMin = sleepMinEl ? parseInt(sleepMinEl.value) : 0;
  var sleepHours = sleepHrs + (sleepMin / 60);

  // Goal proximity
  var proxSlider = document.getElementById('prox-slider');
  var goalProximity = proxSlider ? parseInt(proxSlider.value) : 1;

  return {
    date:          _todayString(),
    ens6q:         ens6q,
    ens6qTotal:    ens6qTotal,
    freeText:      freeText,
    triggers:      triggers,
    sleepHours:    parseFloat(sleepHours.toFixed(2)),
    goalProximity: goalProximity,
    nlpOutput:     null,   // filled later by nlp-service
    goalProgress:  null    // filled later by goal-engine
  };
}


/**
 * collectBaselineFromUI — reads baseline ENS6Q sliders
 * from Screen 4 during onboarding.
 *
 * Returns { baselineENS6Q, baselineTotal }.
 */
function collectBaselineFromUI() {
  var ens6qKeys = ['suffocation', 'burning', 'openness', 'crusting', 'dryness', 'air'];
  var baseline = {};
  var total = 0;

  var sliderContainer = document.getElementById('baseline-sliders');
  var sliderRows = sliderContainer ? sliderContainer.querySelectorAll('.slider-row') : [];

  sliderRows.forEach(function(row, i) {
    var slider = row.querySelector('input[type=range]');
    var val = slider ? parseInt(slider.value) : 0;
    baseline[ens6qKeys[i]] = val;
    total += val;
  });

  return {
    baselineENS6Q: baseline,
    baselineTotal: total
  };
}


/**
 * collectGoalsFromUI — reads goal target sliders from
 * Screen 5 during onboarding.
 *
 * Returns array of { key, name, target } objects.
 */
function collectGoalsFromUI() {
  var goalDefs = [
    { key: 'goalA', name: 'Sleep without breathing distress' },
    { key: 'goalB', name: 'Focus through work or study' },
    { key: 'goalC', name: 'Reduce daily nasal discomfort' },
    { key: 'goalD', name: 'Breathe without thinking about it' },
    { key: 'goalE', name: 'Understand my symptom triggers' },
  ];

  var goals = [];
  var sliderContainer = document.getElementById('goal-sliders');
  var goalCards = sliderContainer ? sliderContainer.querySelectorAll('.goal-card') : [];

  goalCards.forEach(function(card, i) {
    var slider = card.querySelector('input[type=range]');
    var target = slider ? parseInt(slider.value) : 0;

    // Only include goals where the user set a target > 0
    // (target 0 means "no change" / not interested in this goal)
    if (target > 0 && goalDefs[i]) {
      goals.push({
        key:    goalDefs[i].key,
        name:   goalDefs[i].name,
        target: target
      });
    }
  });

  return goals;
}


/**
 * collectProfileFromUI — reads all profile fields from
 * Screen 2 and Screen 3 during onboarding.
 *
 * Combines with baseline + goals data to form the full
 * profile document.
 */
function collectProfileFromUI() {
  return {
    name:      (document.getElementById('f-name') || {}).value || 'Friend',
    age:       (document.getElementById('f-age') || {}).value || '',
    gender:    (document.getElementById('f-gender') || {}).value || '',
    phone:     (document.getElementById('f-phone') || {}).value || '',
    meds:      (document.getElementById('f-meds') || {}).value || '',
    blood:     (document.getElementById('f-blood') || {}).value || '',
    allergies: (document.getElementById('f-allergies') || {}).value || '',
    caretaker: (document.getElementById('f-caretaker') || {}).value || '',
    subtype:   D.subtype || '',
    surgery:   (document.getElementById('f-surgery') || {}).value || ''
  };
}
