// ============================================================
// report-generator.js — Clinician Report Generator
// ============================================================
// Produces a structured, print-ready clinical summary for ENS
// patients to share with their care team.
//
// Output: a full HTML string opened in a new window.
// The user prints it (Cmd+P → Save as PDF) from the browser.
//
// Pipeline:
//   1. Load patient profile + all check-ins from Firestore
//   2. Compute domain averages, goal progress, trigger correlations
//   3. Collect NLP insights from recent check-ins
//   4. Build printable HTML report
//   5. Save report metadata to Firestore
//   6. Open new window → trigger print dialog
//
// Depends on:
//   services/database.js     → loadProfile, getAllCheckins, saveReport
//   services/goal-engine.js  → computeAllGoalProgress, getGoalSummary
//   services/signal-engine.js→ computeTriggerCorrelations,
//                              computeSleepCorrelation, computeWeeklyTrend
//   data/ens-config.js       → ENS_DOMAINS, ENS_DOMAIN_KEYS
// ============================================================


// ─────────────────────────────────────────────────────────────
// 1. MAIN: generateReport
// ─────────────────────────────────────────────────────────────

/**
 * Full pipeline: fetch data → compute metrics → build HTML → save metadata.
 *
 * @param {string} uid
 * @returns {object} { success, reportId, reportData, htmlContent }
 */
async function generateReport(uid) {
  if (!uid) {
    console.error('[Report] generateReport requires a uid.');
    return { success: false, errorMessage: 'Not signed in.' };
  }

  console.log('[Report] Generating report for:', uid);

  // 1. Load profile
  var profileResult = await loadProfile(uid);
  if (!profileResult.success || !profileResult.data) {
    return { success: false, errorMessage: 'Could not load patient profile.' };
  }
  var profile = profileResult.data;

  // 2. Load all check-ins
  var checkinsResult = await getAllCheckins(uid);
  if (!checkinsResult.success) {
    return { success: false, errorMessage: 'Could not load check-in data.' };
  }
  var checkins = checkinsResult.data;

  if (!checkins.length) {
    return { success: false, errorMessage: 'No check-in data found. Log at least one day first.' };
  }

  // 3. Sort newest-first for display; oldest-first already from getAllCheckins
  var sortedDesc = checkins.slice().sort(function(a, b) {
    return b.date.localeCompare(a.date);
  });
  var latestCheckin = sortedDesc[0];

  // 4. Goal progress (using most recent check-in vs baseline)
  var goalProgress = {};
  var goalSummary  = { totalGoals: 0, avgProgress: 0, overallStatus: 'no_goals', bestGoal: null, worstGoal: null };

  if (profile.goals && profile.goals.length && profile.baselineENS6Q) {
    goalProgress = computeAllGoalProgress(
      profile.goals,
      latestCheckin.ens6q,
      profile.baselineENS6Q,
      sortedDesc
    );
    goalSummary = getGoalSummary(goalProgress);
  }

  // 5. Signal analysis
  var correlations = computeTriggerCorrelations(checkins);
  var sleepPattern = computeSleepCorrelation(checkins);
  var weeklyTrend  = computeWeeklyTrend(sortedDesc);

  // 6. NLP insights from most recent 7 check-ins
  var recentNlpInsights = sortedDesc
    .slice(0, 7)
    .filter(function(c) { return c.nlpOutput && c.nlpOutput.keyInsight; })
    .map(function(c) {
      return {
        date:      c.date,
        insight:   c.nlpOutput.keyInsight,
        sentiment: c.nlpOutput.overallSentiment || 'neutral'
      };
    });

  // 7. Domain averages across all check-ins
  var domainAverages = _computeDomainAverages(checkins);

  // 8. Assemble report data object
  var reportData = {
    generatedAt:     new Date().toISOString(),
    generatedDate:   _formatDate(new Date()),
    patient:         profile,
    checkinCount:    checkins.length,
    dateRange:       { from: checkins[0].date, to: latestCheckin.date },
    latestCheckin:   latestCheckin,
    domainAverages:  domainAverages,
    goalProgress:    goalProgress,
    goalSummary:     goalSummary,
    correlations:    correlations,
    sleepPattern:    sleepPattern,
    weeklyTrend:     weeklyTrend,
    recentInsights:  recentNlpInsights,
    recentCheckins:  sortedDesc.slice(0, 14)
  };

  // 9. Build HTML
  var htmlContent = buildReportHTML(reportData);

  // 10. Save metadata to Firestore (not the full HTML — too large)
  var saveResult = await saveReport(uid, {
    generatedAt:  reportData.generatedAt,
    checkinCount: reportData.checkinCount,
    dateRange:    reportData.dateRange,
    goalSummary:  goalSummary,
    topTrigger:   correlations.topTrigger ? correlations.topTrigger.label : null,
    avgProgress:  goalSummary.avgProgress,
    weeklyTrend:  weeklyTrend.direction
  });

  console.log('[Report] Report generated and saved:', saveResult.reportId);

  return {
    success:     true,
    reportId:    saveResult.reportId || null,
    reportData:  reportData,
    htmlContent: htmlContent
  };
}


// ─────────────────────────────────────────────────────────────
// 2. printReport — generate + open print dialog
// ─────────────────────────────────────────────────────────────

/**
 * Generates the report and opens a new window with the PDF-ready HTML.
 * User uses browser print (Cmd+P → Save as PDF) from there.
 *
 * @param {string} uid
 */
async function printReport(uid) {
  var result = await generateReport(uid);
  if (!result.success) {
    alert('Could not generate report: ' + result.errorMessage);
    return;
  }
  _openReportWindow(result.htmlContent);
}


// ─────────────────────────────────────────────────────────────
// 3. buildReportHTML — core HTML generator
// ─────────────────────────────────────────────────────────────

/**
 * Takes the assembled reportData and returns a complete HTML string
 * ready to be written into a new browser window.
 *
 * @param {object} reportData
 * @returns {string}
 */
function buildReportHTML(reportData) {
  var p   = reportData.patient;
  var now = reportData.generatedDate;

  var sections = [
    _headerSection(p, now),
    _patientInfoSection(p),
    _dataSummarySection(reportData),
    _domainAveragesSection(reportData),
    Object.keys(reportData.goalProgress).length ? _goalProgressSection(reportData.goalProgress) : '',
    _triggerCorrelationsSection(reportData.correlations, reportData.sleepPattern),
    reportData.recentInsights.length ? _nlpInsightsSection(reportData.recentInsights) : '',
    _recentCheckinsSection(reportData.recentCheckins),
    _clinicianNotesSection(),
    _footerSection()
  ];

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1.0"/>',
    '<title>PRANA SymptoReport — ' + _esc(p.name || 'Patient') + '</title>',
    '<style>' + _reportStyles() + '</style>',
    '</head>',
    '<body>',
    sections.join('\n'),
    '</body>',
    '</html>'
  ].join('\n');
}


// ─────────────────────────────────────────────────────────────
// SECTION BUILDERS
// ─────────────────────────────────────────────────────────────

function _headerSection(p, now) {
  return [
    '<div class="header">',
    '  <div class="logo-block">',
    '    <div class="logo-icon">&#127807;</div>',
    '    <div class="logo-text">PRANA</div>',
    '  </div>',
    '  <div class="title-block">',
    '    <h1>ENS SymptoReport</h1>',
    '    <p class="subtitle">Empty Nose Syndrome &mdash; Clinical Symptom Summary</p>',
    '  </div>',
    '  <div class="date-block">Generated: ' + _esc(now) + '</div>',
    '</div>'
  ].join('\n');
}

function _patientInfoSection(p) {
  var rows = [
    ['Name',            p.name      || '&mdash;'],
    ['Age',             p.age       || '&mdash;'],
    ['Gender',          p.gender    || '&mdash;'],
    ['ENS Subtype',     p.subtype   || '&mdash;'],
    ['Last Surgery',    p.surgery   || 'Not specified'],
    ['Medications',     p.meds      || '&mdash;'],
    ['Allergies',       p.allergies || '&mdash;'],
    ['Blood Group',     p.blood     || '&mdash;']
  ];

  var cells = rows.map(function(r) {
    return '<div class="info-item"><span class="label">' + r[0] + '</span><span class="value">' + _esc(r[1]) + '</span></div>';
  }).join('\n');

  return '<section class="section"><h2>Patient Information</h2><div class="info-grid">' + cells + '</div></section>';
}

function _dataSummarySection(data) {
  var trend = data.weeklyTrend;
  var trendIcon = trend.direction === 'improving' ? '&#8595; Improving' :
                  trend.direction === 'worsening' ? '&#8593; Worsening' : '&#8594; Stable';
  var trendColor = trend.direction === 'improving' ? '#27ae60' :
                   trend.direction === 'worsening' ? '#c0392b' : '#666';

  var rows = [
    ['Tracking Period',     data.dateRange.from + ' &mdash; ' + data.dateRange.to],
    ['Check-ins Logged',    data.checkinCount + ' days'],
    ['Overall Goal Progress', data.goalSummary.avgProgress + '% average'],
    ['Overall Status',      _formatStatus(data.goalSummary.overallStatus)],
    ['Week-over-Week Trend','<span style="color:' + trendColor + '">' + trendIcon + ' (' + (trend.delta > 0 ? '+' : '') + trend.delta + ' pts)</span>'],
    ['Latest ENS6Q Total',  (data.latestCheckin.ens6qTotal || 0) + ' / 30'],
  ];

  var cells = rows.map(function(r) {
    return '<div class="info-item"><span class="label">' + r[0] + '</span><span class="value">' + r[1] + '</span></div>';
  }).join('\n');

  return '<section class="section"><h2>Tracking Summary</h2><div class="info-grid">' + cells + '</div></section>';
}

function _domainAveragesSection(data) {
  var baseline = data.patient.baselineENS6Q || {};

  var rows = ENS_DOMAINS.map(function(d) {
    var avg   = data.domainAverages[d.key] || 0;
    var base  = baseline[d.key] || 0;
    var delta = avg - base;
    var trend, color;
    if (delta < -0.3)      { trend = '&#8595; Improving'; color = '#27ae60'; }
    else if (delta > 0.3)  { trend = '&#8593; Worsening'; color = '#c0392b'; }
    else                   { trend = '&#8594; Stable';    color = '#666'; }

    return '<tr><td>' + _esc(d.name) + '</td><td class="center">' + base +
           '</td><td class="center">' + avg.toFixed(2) +
           '</td><td style="color:' + color + '">' + trend + '</td></tr>';
  }).join('\n');

  return [
    '<section class="section">',
    '<h2>ENS6Q Domain Averages (0&ndash;5 scale)</h2>',
    '<p class="note">Averaged across all ' + data.checkinCount + ' check-ins. Lower scores indicate improvement.</p>',
    '<table>',
    '<thead><tr><th>Domain</th><th>Baseline</th><th>Current Avg</th><th>Trend</th></tr></thead>',
    '<tbody>' + rows + '</tbody>',
    '</table>',
    '</section>'
  ].join('\n');
}

function _goalProgressSection(goalProgress) {
  var rows = Object.keys(goalProgress).map(function(key) {
    var g        = goalProgress[key];
    var barWidth = Math.max(0, Math.min(100, g.progress));
    var barColor = g.progress >= 75 ? '#27ae60' : g.progress >= 40 ? '#e67e22' : '#2D6A4F';

    return [
      '<div class="goal-row">',
      '  <div class="goal-name">' + _esc(g.goalName) + '</div>',
      '  <div class="goal-bar-wrap">',
      '    <div class="goal-bar" style="width:' + barWidth + '%;background:' + barColor + ';"></div>',
      '  </div>',
      '  <div class="goal-stats">',
      '    <span>' + g.progress + '% &mdash; ' + _formatStatus(g.status) + '</span>',
      '    <span>Trend: ' + (g.trend ? g.trend.direction : '&mdash;') + '</span>',
      '    <span>Key barrier: ' + (g.barrier ? _esc(g.barrier.domainName) : '&mdash;') + '</span>',
      '  </div>',
      '</div>'
    ].join('\n');
  }).join('\n');

  return '<section class="section"><h2>Goal Progress</h2>' + rows + '</section>';
}

function _triggerCorrelationsSection(correlations, sleepPattern) {
  var content;

  if (!correlations.hasEnoughData) {
    content = '<p class="note">' + _esc(correlations.summary) + '</p>';
  } else if (!correlations.insights.length) {
    content = '<p class="note">No strong trigger–symptom patterns detected in ' + correlations.checkinCount + ' days of data.</p>';
  } else {
    var rows = correlations.insights.map(function(ins) {
      var color = ins.delta > 0 ? '#c0392b' : '#27ae60';
      var sign  = ins.delta > 0 ? '+' : '';
      return '<tr><td>' + _esc(ins.label) + '</td>' +
             '<td class="center">' + ins.dayCount + '</td>' +
             '<td class="center">' + ins.avgWith + '</td>' +
             '<td class="center">' + ins.avgWithout + '</td>' +
             '<td class="center" style="color:' + color + '">' + sign + ins.delta + '</td>' +
             '<td>' + _capitalize(ins.strength.replace('_', ' ')) + '</td></tr>';
    }).join('\n');

    content = [
      '<p class="note">' + _esc(correlations.summary) + '</p>',
      '<table>',
      '<thead><tr><th>Trigger</th><th>Days Logged</th><th>Avg Score With</th><th>Avg Score Without</th><th>Delta</th><th>Strength</th></tr></thead>',
      '<tbody>' + rows + '</tbody>',
      '</table>'
    ].join('\n');
  }

  if (sleepPattern.hasPattern) {
    content += '<p class="note sleep-note"><strong>Sleep pattern:</strong> ' + _esc(sleepPattern.description) + '</p>';
  }

  return '<section class="section"><h2>Trigger Correlations</h2>' + content + '</section>';
}

function _nlpInsightsSection(insights) {
  var rows = insights.map(function(ins) {
    return '<tr><td>' + _esc(ins.date) + '</td><td>' + _capitalize(ins.sentiment) +
           '</td><td>' + _esc(ins.insight) + '</td></tr>';
  }).join('\n');

  return [
    '<section class="section">',
    '<h2>Recent Journal Insights (Last 7 Days)</h2>',
    '<p class="note">Key clinical observations extracted from patient free-text entries.</p>',
    '<table>',
    '<thead><tr><th>Date</th><th>Sentiment</th><th>Key Insight</th></tr></thead>',
    '<tbody>' + rows + '</tbody>',
    '</table>',
    '</section>'
  ].join('\n');
}

function _recentCheckinsSection(recentCheckins) {
  var rows = recentCheckins.map(function(c) {
    var e = c.ens6q || {};
    return '<tr>' +
      '<td>' + _esc(c.date) + '</td>' +
      '<td class="center">' + (e.suffocation || 0) + '</td>' +
      '<td class="center">' + (e.burning     || 0) + '</td>' +
      '<td class="center">' + (e.openness    || 0) + '</td>' +
      '<td class="center">' + (e.crusting    || 0) + '</td>' +
      '<td class="center">' + (e.dryness     || 0) + '</td>' +
      '<td class="center">' + (e.air         || 0) + '</td>' +
      '<td class="center"><strong>' + (c.ens6qTotal || 0) + '</strong></td>' +
      '<td class="center">' + (c.sleepHours ? c.sleepHours + 'h' : '&mdash;') + '</td>' +
      '<td class="center">' + (c.goalProximity ? c.goalProximity + '/10' : '&mdash;') + '</td>' +
    '</tr>';
  }).join('\n');

  return [
    '<section class="section">',
    '<h2>Recent Check-in Data (Last 14 Days)</h2>',
    '<table class="small-table">',
    '<thead><tr>',
    '  <th>Date</th><th>Suf</th><th>Burn</th><th>Open</th>',
    '  <th>Crust</th><th>Dry</th><th>Air</th><th>Total</th>',
    '  <th>Sleep</th><th>Goal Prox</th>',
    '</tr></thead>',
    '<tbody>' + rows + '</tbody>',
    '</table>',
    '</section>'
  ].join('\n');
}

function _clinicianNotesSection() {
  return [
    '<section class="section clinician-notes">',
    '<h2>Clinician Notes</h2>',
    '<div class="notes-area">',
    '<p style="color:#bbb;font-size:12px;">[Space for clinician observations during appointment]</p>',
    '<div style="height:80px;"></div>',
    '</div>',
    '</section>'
  ].join('\n');
}

function _footerSection() {
  return [
    '<div class="footer">',
    '<p>Generated by <strong>PRANA</strong> &mdash; Patient-Reported Adaptive Nasal Analytics</p>',
    '<p>Confidential Medical Record &mdash; For clinical use only &mdash; Not a diagnostic tool</p>',
    '</div>'
  ].join('\n');
}


// ─────────────────────────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────────────────────────

function _computeDomainAverages(checkins) {
  var sums   = {};
  var counts = {};
  ENS_DOMAIN_KEYS.forEach(function(k) { sums[k] = 0; counts[k] = 0; });

  checkins.forEach(function(c) {
    if (!c.ens6q) return;
    ENS_DOMAIN_KEYS.forEach(function(k) {
      if (typeof c.ens6q[k] === 'number') {
        sums[k]   += c.ens6q[k];
        counts[k] += 1;
      }
    });
  });

  var averages = {};
  ENS_DOMAIN_KEYS.forEach(function(k) {
    averages[k] = counts[k] > 0 ? parseFloat((sums[k] / counts[k]).toFixed(2)) : 0;
  });
  return averages;
}

function _openReportWindow(htmlContent) {
  var win = window.open('', '_blank');
  if (!win) {
    alert('Could not open the report window. Please allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(htmlContent);
  win.document.close();
  // Small delay lets the browser render before triggering print
  setTimeout(function() { win.print(); }, 900);
}

function _formatStatus(status) {
  var map = {
    achieved:         'Achieved ✓',
    almost_there:     'Almost There',
    good_progress:    'Good Progress',
    early_progress:   'Early Progress',
    just_starting:    'Just Starting',
    regression:       'Regression',
    on_track:         'On Track',
    progressing:      'Progressing',
    early_stage:      'Early Stage',
    no_goals:         'No Goals Set',
    collecting:       'Collecting Data',
    partial_insights: 'Partial Insights',
    complete:         'Complete',
    reviewed:         'Reviewed'
  };
  return map[status] || status;
}

function _formatDate(d) {
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function _capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Escapes HTML special characters to prevent XSS in the report. */
function _esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _reportStyles() {
  return [
    '* { margin:0; padding:0; box-sizing:border-box; }',
    'body { font-family:"Helvetica Neue",Arial,sans-serif; font-size:13px; color:#222; background:#fff; padding:36px 40px; line-height:1.5; }',

    /* Header */
    '.header { display:flex; align-items:center; gap:20px; padding-bottom:18px; border-bottom:2.5px solid #2D6A4F; margin-bottom:28px; }',
    '.logo-block { display:flex; align-items:center; gap:8px; }',
    '.logo-icon { font-size:26px; }',
    '.logo-text { font-size:22px; font-weight:700; color:#2D6A4F; letter-spacing:4px; }',
    '.title-block h1 { font-size:20px; color:#1B4332; font-weight:700; }',
    '.title-block .subtitle { font-size:11px; color:#6B7C6E; margin-top:2px; }',
    '.date-block { margin-left:auto; font-size:11px; color:#6B7C6E; white-space:nowrap; }',

    /* Sections */
    '.section { margin-bottom:26px; page-break-inside:avoid; }',
    '.section h2 { font-size:14px; font-weight:700; color:#2D6A4F; border-left:4px solid #52B788; padding-left:10px; margin-bottom:10px; }',
    '.note { font-size:11.5px; color:#6B7C6E; margin-bottom:8px; line-height:1.5; }',
    '.sleep-note { margin-top:8px; }',

    /* Info grid */
    '.info-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }',
    '.info-item { background:#f8f9f8; border-radius:8px; padding:10px 12px; }',
    '.info-item .label { font-size:9.5px; color:#6B7C6E; text-transform:uppercase; letter-spacing:0.5px; display:block; margin-bottom:3px; }',
    '.info-item .value { font-size:12.5px; color:#1B4332; font-weight:600; }',

    /* Tables */
    'table { width:100%; border-collapse:collapse; font-size:11.5px; margin-top:6px; }',
    'table.small-table { font-size:10.5px; }',
    'th { background:#2D6A4F; color:#fff; padding:7px 10px; text-align:left; font-size:10.5px; font-weight:600; }',
    'td { padding:6px 10px; border-bottom:1px solid #f0ebe4; vertical-align:top; }',
    'td.center { text-align:center; }',
    'tr:nth-child(even) td { background:#f9f9f7; }',

    /* Goal bars */
    '.goal-row { margin-bottom:14px; }',
    '.goal-name { font-weight:600; font-size:13px; color:#1B4332; margin-bottom:4px; }',
    '.goal-bar-wrap { background:#E8DFD0; border-radius:6px; height:9px; margin-bottom:4px; overflow:hidden; }',
    '.goal-bar { height:100%; border-radius:6px; }',
    '.goal-stats { display:flex; gap:20px; font-size:11px; color:#6B7C6E; }',

    /* Clinician notes */
    '.clinician-notes .notes-area { border:1.5px dashed #ccc; border-radius:8px; min-height:110px; padding:14px; }',

    /* Footer */
    '.footer { margin-top:36px; padding-top:14px; border-top:1px solid #eee; font-size:10px; color:#aaa; text-align:center; line-height:1.8; }',

    /* Print */
    '@media print {',
    '  body { padding:16px 20px; }',
    '  .section { page-break-inside:avoid; }',
    '  .header { page-break-after:avoid; }',
    '  .footer { position:running(footer); }',
    '}'
  ].join('\n');
}
