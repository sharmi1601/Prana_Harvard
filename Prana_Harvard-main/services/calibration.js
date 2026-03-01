// ============================================================
// calibration.js — Baseline Recalibration After Day 5
// ============================================================
// After a patient has logged 5+ check-ins, their real-world
// symptom pattern may differ significantly from the onboarding
// baseline they entered on Screen 4.
//
// This file handles:
//   1. checkCalibration()    — decides when to trigger (after Day 5+)
//   2. runCalibration()      — computes new baseline from first 5 check-ins
//   3. confirmCalibration()  — saves updated baseline to Firestore
//   4. skipCalibration()     — user keeps original; marks as reviewed
//   5. buildCalibrationMessage() — human-readable explanation for patient
//
// The prompt is shown only ONCE per session (via _calibrationState).
// After the user confirms or skips, the baselineStatus field in
// Firestore is updated to "calibrated" or "reviewed" so future
// sessions skip the check automatically.
//
// Depends on:
//   data/ens-config.js   → CALIBRATION, ENS_DOMAIN_KEYS, ENS_DOMAIN_MAP
//   services/database.js → getCheckins, updateBaseline, updateProfile
// ============================================================


// ─────────────────────────────────────────────────────────────
// SESSION STATE — prevents repeated prompts in one session
// ─────────────────────────────────────────────────────────────

var _calibrationState = {
  checked:   false,   // have we run the check this session?
  prompted:  false,   // have we shown the UI prompt?
  confirmed: false    // has the user confirmed or skipped?
};


// ─────────────────────────────────────────────────────────────
// 1. checkCalibration — entry point called after each check-in
// ─────────────────────────────────────────────────────────────

/**
 * Decides whether recalibration should run.
 * Called by app.js after every successful check-in save.
 *
 * Logic:
 *   - Skip if already checked this session
 *   - Skip if baseline already calibrated/reviewed
 *   - Skip if fewer than CALIBRATION.minCheckins (5) check-ins
 *   - Run runCalibration() and return result if significant drift
 *
 * @param {string} uid
 * @param {object} profile — current patient profile from Firestore
 * @returns {object} { triggered: boolean, calibResult: object | null }
 */
async function checkCalibration(uid, profile) {
  // One check per session
  if (_calibrationState.checked) {
    return { triggered: false };
  }

  // Already calibrated or reviewed by the user
  if (profile.baselineStatus === 'calibrated' || profile.baselineStatus === 'reviewed') {
    _calibrationState.checked = true;
    return { triggered: false };
  }

  // Fetch enough check-ins to cover the calibration window
  var checkinsResult = await getCheckins(uid, CALIBRATION.minCheckins + 5);
  if (!checkinsResult.success) {
    return { triggered: false };
  }

  var checkins = checkinsResult.data;

  // Not enough data yet
  if (checkins.length < CALIBRATION.minCheckins) {
    return { triggered: false };
  }

  _calibrationState.checked = true;

  // Run the calibration computation
  var calibResult = runCalibration(checkins, profile.baselineENS6Q);

  if (!calibResult.needsUpdate) {
    console.log('[Calibration] Baseline is accurate — no update needed. Max delta:', calibResult.maxDelta);
    return { triggered: false };
  }

  _calibrationState.prompted = true;
  console.log('[Calibration] Significant drift detected (max delta ' + calibResult.maxDelta + '). Prompting user...');

  return {
    triggered:   true,
    calibResult: calibResult
  };
}


// ─────────────────────────────────────────────────────────────
// 2. runCalibration — compute new baseline from first N check-ins
// ─────────────────────────────────────────────────────────────

/**
 * Computes the domain-averaged baseline from the earliest
 * CALIBRATION.minCheckins check-ins and compares it to the
 * onboarding baseline.
 *
 * @param {array}  checkins           — from getCheckins(), newest-first
 * @param {object} onboardingBaseline — { suffocation, burning, ... }
 * @returns {object}
 *   {
 *     newBaseline:      { suffocation, burning, openness, crusting, dryness, air },
 *     newBaselineTotal: number,
 *     diffs:            { domainKey: { old, new, delta, domainName } },
 *     needsUpdate:      boolean,
 *     maxDelta:         number,
 *     checkinCount:     number
 *   }
 */
function runCalibration(checkins, onboardingBaseline) {
  // checkins comes newest-first, so reverse to get oldest-first,
  // then take the first minCheckins entries
  var calibCheckins = checkins.slice().reverse().slice(0, CALIBRATION.minCheckins);

  // Sum each domain across calibration check-ins
  var sums = {};
  ENS_DOMAIN_KEYS.forEach(function(key) { sums[key] = 0; });

  calibCheckins.forEach(function(c) {
    ENS_DOMAIN_KEYS.forEach(function(key) {
      if (c.ens6q && typeof c.ens6q[key] === 'number') {
        sums[key] += c.ens6q[key];
      }
    });
  });

  // Compute per-domain average
  var newBaseline = {};
  var newTotal    = 0;

  ENS_DOMAIN_KEYS.forEach(function(key) {
    var avg         = parseFloat((sums[key] / calibCheckins.length).toFixed(2));
    newBaseline[key] = avg;
    newTotal        += avg;
  });

  newTotal = parseFloat(newTotal.toFixed(2));

  // Compare each domain to the original onboarding baseline
  var diffs      = {};
  var maxDelta   = 0;
  var needsUpdate = false;

  ENS_DOMAIN_KEYS.forEach(function(key) {
    var oldVal     = (onboardingBaseline && typeof onboardingBaseline[key] === 'number')
                       ? onboardingBaseline[key]
                       : 0;
    var newVal     = newBaseline[key];
    var delta      = parseFloat((newVal - oldVal).toFixed(2));
    var domainInfo = ENS_DOMAIN_MAP[key] || { shortName: key };

    diffs[key] = {
      old:        oldVal,
      new:        newVal,
      delta:      delta,
      domainName: domainInfo.shortName || key
    };

    if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
    if (Math.abs(delta) > CALIBRATION.domainThreshold) needsUpdate = true;
  });

  return {
    newBaseline:      newBaseline,
    newBaselineTotal: newTotal,
    diffs:            diffs,
    needsUpdate:      needsUpdate,
    maxDelta:         parseFloat(maxDelta.toFixed(2)),
    checkinCount:     calibCheckins.length
  };
}


// ─────────────────────────────────────────────────────────────
// 3. confirmCalibration — save new baseline after user approval
// ─────────────────────────────────────────────────────────────

/**
 * Persists the calibrated baseline to Firestore.
 * Called when the patient taps "Yes, update my baseline".
 *
 * @param {string} uid
 * @param {object} newBaseline — { suffocation, burning, ... }
 * @param {number} newTotal
 * @returns {object} { success, errorMessage? }
 */
async function confirmCalibration(uid, newBaseline, newTotal) {
  _calibrationState.confirmed = true;

  var result = await updateBaseline(uid, {
    baselineENS6Q:  newBaseline,
    baselineTotal:  newTotal,
    baselineStatus: 'calibrated'
  });

  if (result.success) {
    console.log('[Calibration] Baseline updated successfully to total:', newTotal);
  } else {
    console.error('[Calibration] Failed to update baseline:', result.errorMessage);
  }

  return result;
}


// ─────────────────────────────────────────────────────────────
// 4. skipCalibration — user keeps their original baseline
// ─────────────────────────────────────────────────────────────

/**
 * Marks the baseline as reviewed without changing values.
 * Future sessions will not re-prompt.
 *
 * @param {string} uid
 * @returns {object} { success, errorMessage? }
 */
async function skipCalibration(uid) {
  _calibrationState.confirmed = true;

  var result = await updateProfile(uid, {
    baselineStatus: 'reviewed'
  });

  console.log('[Calibration] User chose to keep original baseline. Marked as reviewed.');
  return result;
}


// ─────────────────────────────────────────────────────────────
// 5. buildCalibrationMessage — patient-facing explanation
// ─────────────────────────────────────────────────────────────

/**
 * Builds a human-readable string explaining what changed
 * and why an update might help. Shown in the UI prompt.
 *
 * @param {object} calibResult — output from runCalibration()
 * @returns {string}
 */
function buildCalibrationMessage(calibResult) {
  var diffs = calibResult.diffs;

  var changedDomains = Object.keys(diffs).filter(function(key) {
    return Math.abs(diffs[key].delta) > CALIBRATION.domainThreshold;
  });

  if (!changedDomains.length) {
    return 'Your baseline looks accurate based on your recent check-ins.';
  }

  var lines = [
    'Based on your first ' + calibResult.checkinCount + ' check-ins, we noticed:',
    ''
  ];

  changedDomains.forEach(function(key) {
    var d   = diffs[key];
    var dir = d.delta > 0 ? 'higher' : 'lower';
    lines.push(
      '• ' + d.domainName + ': your actual average (' + d.new + ') is ' +
      dir + ' than your initial estimate (' + d.old + ')'
    );
  });

  lines.push('');
  lines.push('Updating your baseline will make goal progress tracking more accurate.');

  return lines.join('\n');
}


// ─────────────────────────────────────────────────────────────
// 6. getCalibrationStatus — for dashboard display
// ─────────────────────────────────────────────────────────────

/**
 * Returns a short, friendly status string for display on the
 * home screen or health card.
 *
 * @param {string} baselineStatus — from patient profile
 * @param {number} checkinCount
 * @returns {string}
 */
function getCalibrationStatus(baselineStatus, checkinCount) {
  if (baselineStatus === 'calibrated') {
    return 'Baseline calibrated';
  }
  if (baselineStatus === 'reviewed') {
    return 'Original baseline confirmed';
  }
  if (checkinCount >= CALIBRATION.minCheckins) {
    return 'Calibration available';
  }
  var remaining = CALIBRATION.minCheckins - checkinCount;
  return remaining + ' more day' + (remaining !== 1 ? 's' : '') + ' until calibration';
}


// ─────────────────────────────────────────────────────────────
// 7. resetCalibrationState — for testing / dev only
// ─────────────────────────────────────────────────────────────

function resetCalibrationState() {
  _calibrationState = { checked: false, prompted: false, confirmed: false };
  console.log('[Calibration] Session state reset.');
}
