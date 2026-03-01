// ============================================================
// signal-engine.js — Trigger Correlation Engine
// ============================================================
// Analyzes historical check-in data to find correlations
// between reported triggers and ENS6Q symptom severity.
//
// Algorithm:
//   For each trigger T, compare the average ENS6Q total on
//   days when T was logged vs days when T was NOT logged.
//   Delta = avgWithTrigger - avgWithoutTrigger
//   Positive delta = trigger is associated with worse symptoms.
//   Negative delta = trigger may be protective (e.g. Exercise).
//
// Depends on:
//   data/ens-config.js → TRIGGERS, TRACKING, CORRELATION_THRESHOLDS,
//                        ENS_DOMAIN_KEYS, ENS_DOMAIN_MAP
// ============================================================


// ─────────────────────────────────────────────────────────────
// 1. MAIN: computeTriggerCorrelations
// ─────────────────────────────────────────────────────────────

/**
 * Computes trigger–symptom correlations from all check-ins.
 *
 * @param {array} checkins — all check-ins (any order), each with
 *   { date, ens6q, ens6qTotal, triggers: [ "A/C", "Stress", ... ] }
 * @returns {object}
 *   {
 *     hasEnoughData: boolean,
 *     checkinCount:  number,
 *     insights:      [ { trigger, label, avgWith, avgWithout, delta, strength, dayCount, description } ],
 *     topTrigger:    object | null,
 *     summary:       string,
 *   }
 */
function computeTriggerCorrelations(checkins) {
  if (!checkins || checkins.length < TRACKING.minDaysForSignal) {
    return {
      hasEnoughData: false,
      checkinCount:  checkins ? checkins.length : 0,
      insights:      [],
      topTrigger:    null,
      summary:       'Need at least ' + TRACKING.minDaysForSignal + ' days of data to compute correlations.'
    };
  }

  var insights = [];

  TRIGGERS.forEach(function(triggerDef) {
    var correlation = _correlateOneTrigger(checkins, triggerDef.label);

    // Only report triggers that appear on at least minTriggerDays
    if (correlation.dayCount < TRACKING.minTriggerDays) {
      return;
    }

    // Only report moderate or strong correlations (positive or negative)
    if (Math.abs(correlation.delta) < CORRELATION_THRESHOLDS.moderate) {
      return;
    }

    insights.push({
      trigger:     triggerDef.key,
      label:       triggerDef.label,
      avgWith:     correlation.avgWith,
      avgWithout:  correlation.avgWithout,
      delta:       correlation.delta,
      strength:    _classifyStrength(correlation.delta),
      dayCount:    correlation.dayCount,
      description: _buildDescription(triggerDef.label, correlation)
    });
  });

  // Sort by absolute delta descending — strongest correlations first
  insights.sort(function(a, b) {
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  var topTrigger = insights.length > 0 ? insights[0] : null;
  var summary    = _buildSummary(insights, checkins.length);

  return {
    hasEnoughData: true,
    checkinCount:  checkins.length,
    insights:      insights,
    topTrigger:    topTrigger,
    summary:       summary
  };
}


// ─────────────────────────────────────────────────────────────
// 2. computeDomainCorrelations — per-domain breakdown for one trigger
// ─────────────────────────────────────────────────────────────

/**
 * For a single trigger, shows which ENS6Q domains it affects most.
 * Used in the detailed clinician report.
 *
 * @param {array}  checkins     — all check-ins
 * @param {string} triggerLabel — e.g. "Stress"
 * @returns {array} domain insights sorted by impact, or []
 */
function computeDomainCorrelations(checkins, triggerLabel) {
  var triggerDays   = checkins.filter(function(c) { return _hasTrigger(c, triggerLabel); });
  var noTriggerDays = checkins.filter(function(c) { return !_hasTrigger(c, triggerLabel); });

  if (triggerDays.length < 2 || noTriggerDays.length < 2) {
    return [];
  }

  var domainResults = [];

  ENS_DOMAIN_KEYS.forEach(function(domain) {
    var avgWith    = _avgDomain(triggerDays, domain);
    var avgWithout = _avgDomain(noTriggerDays, domain);
    var delta      = parseFloat((avgWith - avgWithout).toFixed(2));

    // Only include domains with meaningful effect
    if (Math.abs(delta) >= 0.3) {
      var domainInfo = ENS_DOMAIN_MAP[domain] || { shortName: domain };
      domainResults.push({
        domain:     domain,
        domainName: domainInfo.shortName || domain,
        avgWith:    parseFloat(avgWith.toFixed(2)),
        avgWithout: parseFloat(avgWithout.toFixed(2)),
        delta:      delta
      });
    }
  });

  // Sort by absolute delta
  domainResults.sort(function(a, b) {
    return Math.abs(b.delta) - Math.abs(a.delta);
  });

  return domainResults;
}


// ─────────────────────────────────────────────────────────────
// 3. computeSleepCorrelation
// ─────────────────────────────────────────────────────────────

/**
 * Checks if poor sleep (< 6 hours) correlates with worse symptoms.
 * Sleep is a continuous variable, so handled separately from
 * binary trigger chips.
 *
 * @param {array} checkins
 * @returns {object} { poorSleepAvg, goodSleepAvg, delta, hasPattern, description }
 */
function computeSleepCorrelation(checkins) {
  var poorSleep = checkins.filter(function(c) { return typeof c.sleepHours === 'number' && c.sleepHours < 6; });
  var goodSleep = checkins.filter(function(c) { return typeof c.sleepHours === 'number' && c.sleepHours >= 6; });

  if (poorSleep.length < 2 || goodSleep.length < 2) {
    return { hasPattern: false, description: 'Not enough data for sleep correlation.' };
  }

  var poorAvg = _avgTotal(poorSleep);
  var goodAvg = _avgTotal(goodSleep);
  var delta   = parseFloat((poorAvg - goodAvg).toFixed(2));

  return {
    poorSleepAvg: parseFloat(poorAvg.toFixed(2)),
    goodSleepAvg: parseFloat(goodAvg.toFixed(2)),
    delta:        delta,
    hasPattern:   Math.abs(delta) >= 1.0,
    description:  delta > 1.0
      ? 'Poor sleep (< 6 hrs) is associated with ' + delta.toFixed(1) + ' higher ENS6Q score on average.'
      : delta < -1.0
      ? 'Less sleep appears to correlate with lower scores — possibly a reporting artifact worth reviewing.'
      : 'Sleep duration does not show a strong pattern with symptom severity.'
  };
}


// ─────────────────────────────────────────────────────────────
// 4. getSignalSummary — short patient-facing string
// ─────────────────────────────────────────────────────────────

/**
 * Returns a brief, patient-friendly summary of the strongest
 * signals found. Suitable for the Insights card on the home screen.
 *
 * @param {object} correlationResult — output from computeTriggerCorrelations
 * @returns {string}
 */
function getSignalSummary(correlationResult) {
  if (!correlationResult.hasEnoughData) {
    return correlationResult.summary;
  }

  if (!correlationResult.insights.length) {
    return 'No strong trigger patterns detected yet. Keep logging daily!';
  }

  var top    = correlationResult.topTrigger;
  var count  = correlationResult.insights.length;
  var others = count > 1
    ? ' and ' + (count - 1) + ' other trigger' + (count > 2 ? 's' : '')
    : '';

  var direction = top.delta > 0 ? 'worsens' : 'may ease';
  return top.label + others + ' ' + direction + ' your symptoms. See details in Insights.';
}


// ─────────────────────────────────────────────────────────────
// 5. computeWeeklyTrend — rolling 7-day average trend
// ─────────────────────────────────────────────────────────────

/**
 * Computes a week-over-week ENS6Q total trend.
 * Used in the clinician report's data summary section.
 *
 * @param {array} checkins — ordered newest-first
 * @returns {object} { thisWeekAvg, lastWeekAvg, delta, direction }
 */
function computeWeeklyTrend(checkins) {
  if (!checkins || checkins.length < 7) {
    return { direction: 'insufficient_data', delta: 0, thisWeekAvg: 0, lastWeekAvg: 0 };
  }

  var thisWeek = checkins.slice(0, 7);
  var lastWeek = checkins.slice(7, 14);

  if (lastWeek.length < 3) {
    return { direction: 'insufficient_data', delta: 0, thisWeekAvg: 0, lastWeekAvg: 0 };
  }

  var thisAvg = parseFloat(_avgTotal(thisWeek).toFixed(2));
  var lastAvg = parseFloat(_avgTotal(lastWeek).toFixed(2));
  var delta   = parseFloat((thisAvg - lastAvg).toFixed(2));

  var direction;
  if (delta < -1.0)      direction = 'improving';
  else if (delta > 1.0)  direction = 'worsening';
  else                   direction = 'stable';

  return {
    thisWeekAvg: thisAvg,
    lastWeekAvg: lastAvg,
    delta:       delta,
    direction:   direction
  };
}


// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * For a single trigger label, computes avgWith, avgWithout, delta.
 */
function _correlateOneTrigger(checkins, triggerLabel) {
  var triggerDays   = checkins.filter(function(c) { return _hasTrigger(c, triggerLabel); });
  var noTriggerDays = checkins.filter(function(c) { return !_hasTrigger(c, triggerLabel); });

  var avgWith    = triggerDays.length > 0   ? _avgTotal(triggerDays)   : 0;
  var avgWithout = noTriggerDays.length > 0 ? _avgTotal(noTriggerDays) : 0;
  var delta      = parseFloat((avgWith - avgWithout).toFixed(2));

  return {
    dayCount:   triggerDays.length,
    avgWith:    parseFloat(avgWith.toFixed(2)),
    avgWithout: parseFloat(avgWithout.toFixed(2)),
    delta:      delta
  };
}

/**
 * Returns true if the check-in's triggers array includes triggerLabel.
 * Handles partial matches because chip text includes emoji prefixes.
 */
function _hasTrigger(checkin, triggerLabel) {
  if (!checkin.triggers || !checkin.triggers.length) return false;
  var clean = triggerLabel.toLowerCase();
  return checkin.triggers.some(function(t) {
    var tc = t.toLowerCase();
    return tc.indexOf(clean) !== -1 || clean.indexOf(tc) !== -1;
  });
}

/** Average ENS6Q total across an array of check-ins. */
function _avgTotal(checkins) {
  if (!checkins.length) return 0;
  var sum = 0;
  checkins.forEach(function(c) {
    sum += (typeof c.ens6qTotal === 'number') ? c.ens6qTotal : 0;
  });
  return sum / checkins.length;
}

/** Average score for a single ENS6Q domain. */
function _avgDomain(checkins, domain) {
  if (!checkins.length) return 0;
  var sum = 0;
  checkins.forEach(function(c) {
    sum += (c.ens6q && typeof c.ens6q[domain] === 'number') ? c.ens6q[domain] : 0;
  });
  return sum / checkins.length;
}

/**
 * Classify correlation strength based on delta.
 * Positive delta = worsens symptoms, negative = protective.
 */
function _classifyStrength(delta) {
  if (delta >= CORRELATION_THRESHOLDS.strong)    return 'strong';
  if (delta >= CORRELATION_THRESHOLDS.moderate)  return 'moderate';
  if (delta <= -CORRELATION_THRESHOLDS.strong)   return 'strong_protective';
  if (delta <= -CORRELATION_THRESHOLDS.moderate) return 'moderate_protective';
  return 'weak';
}

function _buildDescription(label, correlation) {
  var direction = correlation.delta > 0 ? 'worsens' : 'may ease';
  var magnitude = Math.abs(correlation.delta).toFixed(1);
  return (
    label + ' ' + direction + ' symptoms by ~' + magnitude +
    ' pts on average (' + correlation.avgWith.toFixed(1) +
    ' with vs ' + correlation.avgWithout.toFixed(1) + ' without).'
  );
}

function _buildSummary(insights, totalDays) {
  if (!insights.length) {
    return 'No strong trigger patterns found across ' + totalDays + ' days of data.';
  }

  var strong   = insights.filter(function(i) { return i.strength === 'strong' || i.strength === 'strong_protective'; });
  var moderate = insights.filter(function(i) { return i.strength === 'moderate' || i.strength === 'moderate_protective'; });

  var parts = [];
  if (strong.length)   parts.push(strong.length   + ' strong trigger'   + (strong.length   > 1 ? 's' : ''));
  if (moderate.length) parts.push(moderate.length + ' moderate trigger' + (moderate.length > 1 ? 's' : ''));

  return 'Identified ' + parts.join(' and ') + ' from ' + totalDays + ' days of data.';
}
