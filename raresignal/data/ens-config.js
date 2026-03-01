// ============================================================
// ens-config.js — Static Configuration & Domain Knowledge
// ============================================================
// Central source of truth for ENS6Q domains, goal definitions,
// trigger list, slider anchors, and goal-to-domain mappings.
//
// Every other file that needs ENS domain names, goal keys,
// or trigger labels imports from here instead of hardcoding.
//
// Depends on: nothing (pure data, no imports)
// ============================================================


// ─────────────────────────────────────────────────────────────
// 1. ENS6Q DOMAINS
// ─────────────────────────────────────────────────────────────
// The ENS6Q is a validated 6-item questionnaire for Empty Nose
// Syndrome. Each domain is scored 0–5.

var ENS_DOMAINS = [
  { key: 'suffocation', name: 'Nasal Suffocation',      shortName: 'Suffocation' },
  { key: 'burning',     name: 'Nasal Burning',          shortName: 'Burning'     },
  { key: 'openness',    name: 'Nasal Openness',         shortName: 'Openness'    },
  { key: 'crusting',    name: 'Nasal Crusting',         shortName: 'Crusting'    },
  { key: 'dryness',     name: 'Nasal Dryness',          shortName: 'Dryness'     },
  { key: 'air',         name: 'Impaired Air Sensation',  shortName: 'Air'         },
];

// Quick lookup: key → full domain object
var ENS_DOMAIN_MAP = {};
ENS_DOMAINS.forEach(function(d) { ENS_DOMAIN_MAP[d.key] = d; });

// Just the keys as an array (used by database.js, goal-engine, etc.)
var ENS_DOMAIN_KEYS = ENS_DOMAINS.map(function(d) { return d.key; });


// ─────────────────────────────────────────────────────────────
// 2. SLIDER ANCHORS (0–5 scale)
// ─────────────────────────────────────────────────────────────
// Displayed in tooltips on the ENS6Q slider screens.

var SLIDER_ANCHORS = [
  { value: 0, label: 'No problem at all'             },
  { value: 1, label: 'Occasional, barely noticeable'  },
  { value: 2, label: 'Noticeable, manageable'          },
  { value: 3, label: 'Frequent, needs relief'          },
  { value: 4, label: 'Constant, interferes with life'  },
  { value: 5, label: 'Severe, unbearable'              },
];

// Max possible ENS6Q total (6 domains × 5 max each)
var ENS6Q_MAX_TOTAL = 30;

// Severity classification thresholds
var ENS6Q_SEVERITY = [
  { min: 0,  max: 6,  label: 'Mild',     color: '#52B788' },
  { min: 7,  max: 14, label: 'Moderate',  color: '#E9C46A' },
  { min: 15, max: 22, label: 'Severe',    color: '#F4845F' },
  { min: 23, max: 30, label: 'Very Severe', color: '#E76F51' },
];

function getENS6QSeverity(total) {
  for (var i = 0; i < ENS6Q_SEVERITY.length; i++) {
    if (total >= ENS6Q_SEVERITY[i].min && total <= ENS6Q_SEVERITY[i].max) {
      return ENS6Q_SEVERITY[i];
    }
  }
  return ENS6Q_SEVERITY[ENS6Q_SEVERITY.length - 1];
}


// ─────────────────────────────────────────────────────────────
// 3. GOAL DEFINITIONS
// ─────────────────────────────────────────────────────────────
// These match the 5 goals on Screen 5 of the frontend.
// Each goal links to specific ENS6Q domains for progress calc.

var GOALS = [
  {
    key:      'goalA',
    name:     'Sleep without breathing distress',
    desc:     'Rest through the night peacefully',
    icon:     '🌙',
    domains:  ['suffocation', 'dryness']
  },
  {
    key:      'goalB',
    name:     'Focus through work or study',
    desc:     'Get through your day undistracted',
    icon:     '💡',
    domains:  ['suffocation', 'dryness', 'crusting']
  },
  {
    key:      'goalC',
    name:     'Reduce daily nasal discomfort',
    desc:     'Ease dryness, burning & crusting',
    icon:     '🌿',
    domains:  ['burning', 'crusting', 'dryness']
  },
  {
    key:      'goalD',
    name:     'Breathe without thinking about it',
    desc:     'Stop hyper-awareness of every breath',
    icon:     '🌬️',
    domains:  ['suffocation', 'air', 'openness']
  },
  {
    key:      'goalE',
    name:     'Understand my symptom triggers',
    desc:     "Discover patterns you can't see alone",
    icon:     '🔍',
    domains:  ['suffocation', 'burning', 'openness', 'crusting', 'dryness', 'air']  // all 6
  },
];

// Quick lookup: goalKey → goal object
var GOAL_MAP = {};
GOALS.forEach(function(g) { GOAL_MAP[g.key] = g; });


// ─────────────────────────────────────────────────────────────
// 4. GOAL TARGET MAPPING
// ─────────────────────────────────────────────────────────────
// The frontend's goal slider goes 0–5. We need to convert that
// to an actual ENS6Q target score for progress calculation.
//
// Slider 0 = "no change" (target = current baseline)
// Slider 5 = "completely resolved" (target = 0)
//
// Formula: targetScore = baseline × (1 - sliderValue / 5)
// Example: baseline=4, slider=3 → target = 4 × (1 - 0.6) = 1.6

function goalSliderToTarget(baselineAvg, sliderValue) {
  if (sliderValue <= 0) return baselineAvg;   // no change
  if (sliderValue >= 5) return 0;             // fully resolved
  return baselineAvg * (1 - (sliderValue / 5));
}


// ─────────────────────────────────────────────────────────────
// 5. TRIGGERS LIST
// ─────────────────────────────────────────────────────────────
// Must match the chip labels in the frontend's Screen 8.

var TRIGGERS = [
  { key: 'ac',             label: 'A/C'             },
  { key: 'dry_air',       label: 'Dry Air'         },
  { key: 'stress',        label: 'Stress'          },
  { key: 'poor_sleep',    label: 'Poor Sleep'      },
  { key: 'exercise',      label: 'Exercise'        },
  { key: 'weather_change', label: 'Weather Change'  },
  { key: 'skipped_meds',  label: 'Skipped Meds'    },
];

// Quick lookup: label → key (for matching chip text to trigger key)
var TRIGGER_LABEL_TO_KEY = {};
TRIGGERS.forEach(function(t) { TRIGGER_LABEL_TO_KEY[t.label] = t.key; });

// Just the labels as an array
var TRIGGER_LABELS = TRIGGERS.map(function(t) { return t.label; });


// ─────────────────────────────────────────────────────────────
// 6. ENS SUBTYPES
// ─────────────────────────────────────────────────────────────
// The three ENS subtypes from Screen 3.

var ENS_SUBTYPES = [
  {
    key:   'ENS-IT',
    name:  'ENS-IT',
    desc:  'Inferior Turbinate — most common subtype',
    affected: 'Inferior turbinate tissue removed'
  },
  {
    key:   'ENS-MT',
    name:  'ENS-MT',
    desc:  'Middle Turbinate — less common variant',
    affected: 'Middle turbinate tissue removed'
  },
  {
    key:   'ENS-Both',
    name:  'ENS-Both',
    desc:  'Inferior + Middle — most severe presentation',
    affected: 'Both inferior and middle turbinate tissue removed'
  },
];


// ─────────────────────────────────────────────────────────────
// 7. CALIBRATION CONFIG
// ─────────────────────────────────────────────────────────────
// Used by calibration.js to decide when and how to prompt.

var CALIBRATION = {
  minCheckins:     5,     // minimum check-ins before calibration triggers
  domainThreshold: 0.5,   // if baseline differs by more than this, prompt user
};


// ─────────────────────────────────────────────────────────────
// 8. TRACKING WINDOW
// ─────────────────────────────────────────────────────────────
// The initial data collection period before full insights.

var TRACKING = {
  initialWindowDays: 14,    // days before signal-engine has enough data
  minDaysForTrend:   6,     // minimum check-ins for trend calculation
  minDaysForSignal:  7,     // minimum check-ins for trigger correlations
  minTriggerDays:    3,     // minimum days a trigger appears to be reportable
};


// ─────────────────────────────────────────────────────────────
// 9. CORRELATION STRENGTH THRESHOLDS
// ─────────────────────────────────────────────────────────────
// Used by signal-engine.js to classify trigger–symptom deltas.

var CORRELATION_THRESHOLDS = {
  strong:   1.0,   // delta > 1.0 = strong correlation
  moderate: 0.5,   // delta > 0.5 = moderate correlation
  // anything ≤ 0.5 is "weak" and not displayed
};
