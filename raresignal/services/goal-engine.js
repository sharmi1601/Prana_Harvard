// ============================================================
// goal-engine.js — Goal Progress, Trend & Barrier Engine
// ============================================================
// Computes how close a patient is to each of their personal
// goals, identifies the biggest barrier domain, and calculates
// trend direction from recent check-ins.
//
// Depends on:
//   data/ens-config.js → GOAL_MAP, ENS_DOMAIN_MAP, goalSliderToTarget, TRACKING
// ============================================================


// ─────────────────────────────────────────────────────────────
// 1. MAIN: computeAllGoalProgress
// ─────────────────────────────────────────────────────────────

/**
 * Computes progress for ALL active goals at once.
 *
 * @param {array}  patientGoals  — from profile: [ { key, name, target } ]
 * @param {object} todayENS6Q    — today's scores: { suffocation:3, ... }
 * @param {object} baselineENS6Q — baseline scores: { suffocation:4, ... }
 * @param {array}  checkins      — recent check-ins (newest first), for trend
 * @returns {object} goalProgress — keyed by goalKey:
 *   {
 *     goalA: { progress, currentScore, targetScore, baselineScore, trend, barrier, status },
 *     goalC: { ... },
 *     ...
 *   }
 */
function computeAllGoalProgress(patientGoals, todayENS6Q, baselineENS6Q, checkins) {
  if (!patientGoals || !patientGoals.length) {
    console.warn('[GoalEngine] No goals provided.');
    return {};
  }

  var result = {};

  patientGoals.forEach(function(goal) {
    var goalDef = GOAL_MAP[goal.key];
    if (!goalDef) {
      console.warn('[GoalEngine] Unknown goal key:', goal.key);
      return;
    }

    result[goal.key] = computeSingleGoalProgress(
      goal, goalDef, todayENS6Q, baselineENS6Q, checkins
    );
  });

  return result;
}


// ─────────────────────────────────────────────────────────────
// 2. SINGLE GOAL: computeSingleGoalProgress
// ─────────────────────────────────────────────────────────────

/**
 * @param {object} goal    — { key, name, target } from patient profile
 * @param {object} goalDef — from GOAL_MAP: { key, name, desc, domains }
 * @param {object} todayENS6Q
 * @param {object} baselineENS6Q
 * @param {array}  checkins — recent check-ins for trend calc
 */
function computeSingleGoalProgress(goal, goalDef, todayENS6Q, baselineENS6Q, checkins) {
  var domains = goalDef.domains;

  // ── Special case: Goal E (Understand triggers) ──
  // Progress = data collection completeness, not symptom reduction
  if (goal.key === 'goalE') {
    return _computeGoalEProgress(checkins);
  }

  // ── Compute domain averages ──
  var baselineScore = _avgDomains(baselineENS6Q, domains);
  var currentScore  = _avgDomains(todayENS6Q, domains);

  // Convert the slider target (0–5) to an actual ENS6Q score target
  var targetScore = goalSliderToTarget(baselineScore, goal.target);

  // ── Compute progress percentage ──
  // progress = how far from baseline toward target
  // 0% = still at baseline, 100% = reached target, >100% = exceeded
  var progress;
  var denominator = baselineScore - targetScore;

  if (denominator === 0) {
    // Target equals baseline (slider was 0) — no movement expected
    progress = (currentScore <= baselineScore) ? 100 : 0;
  } else {
    progress = ((baselineScore - currentScore) / denominator) * 100;
  }

  // Clamp to -100 to 200 for display sanity
  progress = Math.max(-100, Math.min(200, Math.round(progress)));

  // ── Trend ──
  var trend = computeTrend(checkins, domains);

  // ── Barrier ──
  var barrier = identifyBarrier(todayENS6Q, domains);

  // ── Status label ──
  var status = _progressToStatus(progress);

  return {
    goalKey:       goal.key,
    goalName:      goal.name,
    progress:      progress,
    currentScore:  parseFloat(currentScore.toFixed(2)),
    targetScore:   parseFloat(targetScore.toFixed(2)),
    baselineScore: parseFloat(baselineScore.toFixed(2)),
    trend:         trend,
    barrier:       barrier,
    status:        status
  };
}


// ─────────────────────────────────────────────────────────────
// 3. TREND: computeTrend
// ─────────────────────────────────────────────────────────────

/**
 * Compares the average of the last 3 check-ins vs the 3 before
 * that, for the given domains.
 *
 * @param {array}  checkins — ordered newest first
 * @param {array}  domains  — ENS6Q domain keys to average
 * @returns {object} { direction, delta, description }
 *   direction: "improving" | "stable" | "worsening"
 */
function computeTrend(checkins, domains) {
  if (!checkins || checkins.length < TRACKING.minDaysForTrend) {
    return {
      direction:   'insufficient_data',
      delta:       0,
      description: 'Need at least ' + TRACKING.minDaysForTrend + ' days of data'
    };
  }

  // Recent 3 days (indices 0, 1, 2 — newest first)
  var recentCount = Math.min(3, checkins.length);
  var recentSum = 0;
  for (var i = 0; i < recentCount; i++) {
    recentSum += _avgDomains(checkins[i].ens6q, domains);
  }
  var recentAvg = recentSum / recentCount;

  // Previous 3 days (indices 3, 4, 5)
  var prevStart = recentCount;
  var prevCount = Math.min(3, checkins.length - prevStart);
  if (prevCount === 0) {
    return {
      direction:   'insufficient_data',
      delta:       0,
      description: 'Not enough previous data for comparison'
    };
  }

  var prevSum = 0;
  for (var j = prevStart; j < prevStart + prevCount; j++) {
    prevSum += _avgDomains(checkins[j].ens6q, domains);
  }
  var prevAvg = prevSum / prevCount;

  // Delta: positive means scores went up (worsening), negative means improvement
  var delta = parseFloat((recentAvg - prevAvg).toFixed(2));
  var threshold = 0.3;

  var direction, description;

  if (delta < -threshold) {
    direction = 'improving';
    description = 'Scores dropped by ' + Math.abs(delta).toFixed(1) + ' on average (improving)';
  } else if (delta > threshold) {
    direction = 'worsening';
    description = 'Scores rose by ' + delta.toFixed(1) + ' on average (worsening)';
  } else {
    direction = 'stable';
    description = 'Scores are holding steady (change: ' + delta.toFixed(1) + ')';
  }

  return {
    direction:   direction,
    delta:       delta,
    recentAvg:   parseFloat(recentAvg.toFixed(2)),
    previousAvg: parseFloat(prevAvg.toFixed(2)),
    description: description
  };
}


// ─────────────────────────────────────────────────────────────
// 4. BARRIER: identifyBarrier
// ─────────────────────────────────────────────────────────────

/**
 * Among the goal's linked domains, find the one with the
 * highest score today. That's the biggest barrier.
 *
 * @param {object} todayENS6Q — { suffocation:3, burning:1, ... }
 * @param {array}  domains    — subset of domain keys linked to this goal
 * @returns {object} { domain, domainName, score, description }
 */
function identifyBarrier(todayENS6Q, domains) {
  var maxDomain = '';
  var maxScore  = -1;

  domains.forEach(function(domKey) {
    var score = todayENS6Q[domKey] || 0;
    if (score > maxScore) {
      maxScore  = score;
      maxDomain = domKey;
    }
  });

  if (maxScore <= 0) {
    return {
      domain:      'none',
      domainName:  'None',
      score:       0,
      description: 'All linked domains are at zero — goal achieved!'
    };
  }

  var domainInfo = ENS_DOMAIN_MAP[maxDomain] || { name: maxDomain, shortName: maxDomain };

  return {
    domain:      maxDomain,
    domainName:  domainInfo.shortName || domainInfo.name,
    score:       maxScore,
    description: domainInfo.shortName + ' (score: ' + maxScore + '/5) is the primary barrier'
  };
}


// ─────────────────────────────────────────────────────────────
// 5. GOAL E: Special data-collection goal
// ─────────────────────────────────────────────────────────────

/**
 * Goal E = "Understand my symptom triggers"
 * Progress is based on data collection completeness, not symptom scores.
 * After 14 days, signal-engine has enough data for correlations.
 */
function _computeGoalEProgress(checkins) {
  var count = checkins ? checkins.length : 0;
  var target = TRACKING.initialWindowDays;  // 14 days

  var progress = Math.min(100, Math.round((count / target) * 100));

  var status, description, barrier;

  if (count < TRACKING.minDaysForSignal) {
    status = 'collecting';
    description = count + ' of ' + target + ' days logged. Keep going!';
    barrier = {
      domain: 'data',
      domainName: 'More Data Needed',
      score: 0,
      description: 'Need ' + (TRACKING.minDaysForSignal - count) + ' more days for initial insights'
    };
  } else if (count < target) {
    status = 'partial_insights';
    description = count + ' of ' + target + ' days logged. Early insights available.';
    barrier = {
      domain: 'data',
      domainName: 'More Data Helpful',
      score: 0,
      description: (target - count) + ' more days will improve correlation accuracy'
    };
  } else {
    status = 'complete';
    description = 'Data collection complete! Full trigger analysis available.';
    barrier = {
      domain: 'none',
      domainName: 'None',
      score: 0,
      description: 'Sufficient data collected for trigger correlations'
    };
  }

  return {
    goalKey:       'goalE',
    goalName:      'Understand my symptom triggers',
    progress:      progress,
    currentScore:  count,
    targetScore:   target,
    baselineScore: 0,
    trend:         { direction: 'improving', delta: 0, description: 'Data collection ongoing' },
    barrier:       barrier,
    status:        status
  };
}


// ─────────────────────────────────────────────────────────────
// 6. SUMMARY: getGoalSummary
// ─────────────────────────────────────────────────────────────

/**
 * Produces a high-level summary across all goals.
 * Used by the dashboard and report generator.
 *
 * @param {object} goalProgress — output from computeAllGoalProgress
 * @returns {object} summary
 */
function getGoalSummary(goalProgress) {
  var keys = Object.keys(goalProgress);
  if (!keys.length) {
    return { totalGoals: 0, avgProgress: 0, bestGoal: null, worstGoal: null, overallStatus: 'no_goals' };
  }

  var totalProgress = 0;
  var best  = { key: '', progress: -Infinity };
  var worst = { key: '', progress: Infinity };

  keys.forEach(function(k) {
    var g = goalProgress[k];
    totalProgress += g.progress;

    if (g.progress > best.progress) {
      best = { key: k, name: g.goalName, progress: g.progress, status: g.status };
    }
    if (g.progress < worst.progress) {
      worst = { key: k, name: g.goalName, progress: g.progress, status: g.status, barrier: g.barrier };
    }
  });

  var avgProgress = Math.round(totalProgress / keys.length);

  var overallStatus;
  if (avgProgress >= 80)      overallStatus = 'on_track';
  else if (avgProgress >= 40) overallStatus = 'progressing';
  else if (avgProgress >= 0)  overallStatus = 'early_stage';
  else                        overallStatus = 'regression';

  return {
    totalGoals:    keys.length,
    avgProgress:   avgProgress,
    bestGoal:      best,
    worstGoal:     worst,
    overallStatus: overallStatus
  };
}


// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Average ENS6Q scores across a subset of domains.
 */
function _avgDomains(ens6q, domains) {
  if (!ens6q || !domains || !domains.length) return 0;

  var sum = 0;
  var count = 0;
  domains.forEach(function(key) {
    if (typeof ens6q[key] === 'number') {
      sum += ens6q[key];
      count++;
    }
  });

  return count > 0 ? (sum / count) : 0;
}

/**
 * Map progress percentage to a human-readable status label.
 */
function _progressToStatus(progress) {
  if (progress >= 100) return 'achieved';
  if (progress >= 75)  return 'almost_there';
  if (progress >= 50)  return 'good_progress';
  if (progress >= 25)  return 'early_progress';
  if (progress >= 0)   return 'just_starting';
  return 'regression';
}
