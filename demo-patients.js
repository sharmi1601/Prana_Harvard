// ============================================================
// demo-patients.js — Pre-loaded Demo Data (3 personas × 28 days)
// ============================================================
// Realistic synthetic data for hackathon demos. Each persona
// has a distinct clinical arc so the goal-engine, signal-engine,
// and report-generator produce meaningful output.
//
// Persona A: "Meera" — Gradual improver (ENS-IT, post-surgery)
// Persona B: "James" — Plateau with flares (ENS-MT, chronic)
// Persona C: "Anika" — Newly diagnosed, high variability (ENS-Both)
//
// Depends on: data/ens-config.js (ENS_DOMAIN_KEYS, TRIGGER_LABELS)
// ============================================================


// ─────────────────────────────────────────────────────────────
// Helper: generate date strings going back N days from today
// ─────────────────────────────────────────────────────────────

function _demoDates(numDays) {
  var dates = [];
  var now = new Date();
  for (var i = numDays - 1; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    var yyyy = d.getFullYear();
    var mm   = String(d.getMonth() + 1).padStart(2, '0');
    var dd   = String(d.getDate()).padStart(2, '0');
    dates.push(yyyy + '-' + mm + '-' + dd);
  }
  return dates;
}

// Clamp value between min and max
function _clamp(val, min, max) {
  return Math.max(min, Math.min(max, Math.round(val)));
}


// ─────────────────────────────────────────────────────────────
// PERSONA A: Meera — Gradual Improver
// ─────────────────────────────────────────────────────────────
// Profile: 32F, ENS-IT, surgery 3 months ago
// Arc: Starts moderate (total ~18), steadily improves to mild (~8)
//      by Day 28. Sleep and dryness improve most. Has A/C and
//      Dry Air as consistent triggers. Stress causes flares on
//      Days 10, 19.

var DEMO_MEERA = {
  profile: {
    name:      'Meera Sharma',
    age:       '32',
    gender:    'Female',
    phone:     '+1 (555) 234-5678',
    meds:      'Saline spray, Humidifier, Sesame oil',
    blood:     'B+',
    allergies: 'Dust, Pollen',
    caretaker: 'raj.sharma@email.com',
    subtype:   'ENS-IT',
    surgery:   '2025-12-01',
    baselineENS6Q: { suffocation: 3, burning: 3, openness: 4, crusting: 2, dryness: 4, air: 3 },
    baselineTotal: 19,
    baselineStatus: 'confirmed',
    goals: [
      { key: 'goalA', name: 'Sleep without breathing distress', target: 4 },
      { key: 'goalC', name: 'Reduce daily nasal discomfort',    target: 3 },
      { key: 'goalE', name: 'Understand my symptom triggers',   target: 3 },
    ]
  },
  checkins: (function() {
    var dates = _demoDates(28);
    var data = [];

    // Day-by-day progression: gradual improvement with flares on day 10, 19
    var arcs = {
      // [day0, ..., day27] — hand-tuned for realistic progression
      suffocation: [3,3,3,3,2,2,2,3,2,2, 4,3,2,2,2,2,1,1,1,3, 2,1,1,1,1,1,1,0],
      burning:     [3,3,2,3,2,2,2,2,2,2, 3,2,2,2,1,1,1,1,1,2, 1,1,1,1,1,0,1,0],
      openness:    [4,4,3,3,3,3,3,3,3,2, 4,3,3,2,2,2,2,2,2,3, 2,2,2,1,1,1,1,1],
      crusting:    [2,2,2,2,2,1,1,2,1,1, 3,2,1,1,1,1,1,1,1,2, 1,1,1,1,0,0,0,0],
      dryness:     [4,4,3,3,3,3,3,2,2,2, 4,3,3,2,2,2,2,1,1,3, 2,1,1,1,1,1,1,1],
      air:         [3,3,3,2,2,2,2,2,2,2, 3,2,2,2,2,1,1,1,1,2, 1,1,1,1,1,1,0,0],
    };

    var triggers = [
      ['A/C','Dry Air'],['Dry Air'],['A/C'],['Dry Air','Stress'],[],['A/C'],['Dry Air'],[],['A/C','Dry Air'],['Dry Air'],
      ['Stress','Poor Sleep','A/C'],['A/C','Dry Air'],['Dry Air'],[],['A/C'],[],['Dry Air'],[],['A/C'],['Stress','Weather Change'],
      ['A/C'],[],['Dry Air'],[],[],['A/C'],[],[],
    ];

    var sleepHours = [5.5,6,6,6.5,6.5,7,7,6.5,7,7, 4.5,6,6.5,7,7,7.5,7.5,7.5,7,5, 7,7.5,7.5,8,7.5,8,7.5,8];
    var goalProx   = [2,2,3,3,3,4,4,3,4,4, 2,3,4,4,5,5,5,6,6,3, 5,6,6,7,7,7,8,8];

    var freeTexts = [
      "Woke up feeling like I couldn't breathe through my nose at all. Very dry.",
      "Slightly better today but the dryness is still intense.",
      "Used the humidifier all night, felt a small difference.",
      "Nose felt more open after saline rinse this morning.",
      "Good day overall, managed to sleep through most of the night.",
      "A/C at work makes everything worse. Nose burns by afternoon.",
      "Dry air outside today. Crusting got bad in the evening.",
      "Pretty stable day. The saline spray is helping.",
      "Felt like I was breathing through a straw in the morning.",
      "Better afternoon. The burning calmed down after oil application.",
      "Terrible night. Stressed about work, couldn't sleep. Everything flared up.",
      "Still recovering from yesterday's bad night.",
      "Getting back on track. Used humidifier and extra saline.",
      "Smooth day. Barely noticed the openness issue.",
      "Best day in a while. Slept almost 7 hours straight.",
      "Consistent improvement. The crusting is almost gone.",
      "Nose feels more normal today. Less hyper-aware of breathing.",
      "Really good day. Forgot about my nose for a few hours.",
      "A/C in the restaurant triggered some dryness but recovered fast.",
      "Stress from family visit brought back suffocation feeling at night.",
      "Bounced back quickly. One bad day doesn't reset everything.",
      "Very mild symptoms today. The pattern is clearly improving.",
      "Gentle day. Used oil in the morning, felt great all day.",
      "Almost no discomfort. Sleep was fantastic.",
      "Tiny bit of dryness but nothing like the first week.",
      "Nose felt almost normal. Forgot to do my evening rinse and still ok.",
      "Minimal symptoms. This is becoming my new baseline.",
      "Best day yet. Feel hopeful about the trajectory.",
    ];

    for (var i = 0; i < 28; i++) {
      var ens6q = {
        suffocation: arcs.suffocation[i],
        burning:     arcs.burning[i],
        openness:    arcs.openness[i],
        crusting:    arcs.crusting[i],
        dryness:     arcs.dryness[i],
        air:         arcs.air[i],
      };
      var total = 0;
      for (var k in ens6q) total += ens6q[k];

      data.push({
        date:          dates[i],
        ens6q:         ens6q,
        ens6qTotal:    total,
        freeText:      freeTexts[i],
        triggers:      triggers[i],
        sleepHours:    sleepHours[i],
        goalProximity: goalProx[i],
        nlpOutput:     null,
        goalProgress:  null,
      });
    }
    return data;
  })()
};


// ─────────────────────────────────────────────────────────────
// PERSONA B: James — Plateau with Flares
// ─────────────────────────────────────────────────────────────
// Profile: 45M, ENS-MT, no recent surgery (chronic)
// Arc: Moderate symptoms (~14–16) that plateau. Occasional
//      weather-related flares on Days 6, 14, 22. Poor sleep
//      strongly correlates with next-day worsening. Skipped
//      meds trigger visible spikes.

var DEMO_JAMES = {
  profile: {
    name:      'James Cooper',
    age:       '45',
    gender:    'Male',
    phone:     '+1 (555) 876-4321',
    meds:      'NeilMed rinse, Ponaris oil, Nasal gel',
    blood:     'O+',
    allergies: 'None known',
    caretaker: 'linda.cooper@email.com',
    subtype:   'ENS-MT',
    surgery:   '2024-06-15',
    baselineENS6Q: { suffocation: 2, burning: 2, openness: 3, crusting: 3, dryness: 3, air: 2 },
    baselineTotal: 15,
    baselineStatus: 'confirmed',
    goals: [
      { key: 'goalB', name: 'Focus through work or study',        target: 3 },
      { key: 'goalD', name: 'Breathe without thinking about it',  target: 4 },
      { key: 'goalE', name: 'Understand my symptom triggers',     target: 3 },
    ]
  },
  checkins: (function() {
    var dates = _demoDates(28);
    var data = [];

    var arcs = {
      suffocation: [2,2,2,2,3,2, 4,3,2,2,2,2,2,2, 4,3,2,2,2,2,2,2, 4,3,2,2,2,2],
      burning:     [2,2,2,1,2,2, 3,2,2,2,1,2,2,2, 3,2,2,1,2,2,1,2, 3,2,2,1,2,1],
      openness:    [3,3,3,3,3,2, 4,3,3,3,3,2,3,3, 4,3,3,3,2,3,3,2, 4,3,3,2,3,2],
      crusting:    [3,3,2,3,3,3, 4,3,3,2,3,3,2,3, 3,3,3,2,3,2,3,2, 4,3,2,3,2,2],
      dryness:     [3,3,3,2,3,3, 4,3,3,3,2,3,3,2, 4,3,3,2,3,2,3,2, 3,3,2,2,2,2],
      air:         [2,2,2,2,2,2, 3,2,2,2,2,2,2,1, 3,2,2,2,2,1,2,1, 3,2,2,1,2,1],
    };

    var triggers = [
      ['Dry Air'],['Dry Air'],[],['Exercise'],[],['Poor Sleep'],
      ['Weather Change','Poor Sleep','Skipped Meds'],['Weather Change'],[],['Exercise'],[],[],['Dry Air'],[],
      ['Weather Change','Skipped Meds','Stress'],['Weather Change'],[],[],['Exercise'],['Dry Air'],[],[],
      ['Weather Change','Poor Sleep','Skipped Meds'],['Weather Change'],['Dry Air'],[],[],[],
    ];

    var sleepHours = [6.5,6,6.5,7,6,5, 4.5,6,6.5,7,7,6.5,6,6.5, 5,6,6.5,7,7,6.5,7,7, 4.5,6,6.5,7,7,7];
    var goalProx   = [4,4,4,5,4,3, 2,3,4,4,5,4,4,5, 2,3,4,5,5,4,5,5, 2,3,4,5,5,5];

    var freeTexts = [
      "Usual morning routine. Nose feels about the same as always.",
      "Dry air at work is annoying but manageable with rinses.",
      "Decent day. Did my exercises, felt a bit better.",
      "Went for a run. Breathing felt weird during but ok after.",
      "Crusting is persistent. Feels like it never fully goes away.",
      "Slept poorly. Could feel every breath all night.",
      "Bad flare today. Weather dropped 20 degrees and I skipped my meds. Terrible combo.",
      "Still feeling yesterday's flare. Extra rinses helped some.",
      "Back to baseline. This is my normal now I guess.",
      "Good workout day. Exercise doesn't seem to make things worse.",
      "Barely noticed symptoms during a busy work day.",
      "Steady. Not better, not worse. Just... there.",
      "Dry air in the office building is relentless.",
      "Tried a new nasal gel. Might be helping the crusting.",
      "Another weather flare. Forgot meds again. Need to set a reminder.",
      "Recovering from yesterday. The pattern is obvious now — weather + no meds = bad.",
      "Good day. Stuck to routine, symptoms stayed low.",
      "Minimal discomfort. Best day in this stretch.",
      "Light exercise. No negative effect on symptoms.",
      "Some dryness from the office A/C but nothing terrible.",
      "Really good day. Barely thought about my nose.",
      "Consistent. Maybe the gel is actually working.",
      "Big weather shift again. Bracing for a flare.",
      "Yep, flare hit. Not as bad as last time though.",
      "Recovery day. Stayed home, humidity helped.",
      "Almost back to normal. These rebounds are getting faster.",
      "Stable day. Work was fine, symptoms were background noise.",
      "Good end to the cycle. Feeling more in control.",
    ];

    for (var i = 0; i < 28; i++) {
      var ens6q = {
        suffocation: arcs.suffocation[i],
        burning:     arcs.burning[i],
        openness:    arcs.openness[i],
        crusting:    arcs.crusting[i],
        dryness:     arcs.dryness[i],
        air:         arcs.air[i],
      };
      var total = 0;
      for (var k in ens6q) total += ens6q[k];

      data.push({
        date:          dates[i],
        ens6q:         ens6q,
        ens6qTotal:    total,
        freeText:      freeTexts[i],
        triggers:      triggers[i],
        sleepHours:    sleepHours[i],
        goalProximity: goalProx[i],
        nlpOutput:     null,
        goalProgress:  null,
      });
    }
    return data;
  })()
};


// ─────────────────────────────────────────────────────────────
// PERSONA C: Anika — Newly Diagnosed, High Variability
// ─────────────────────────────────────────────────────────────
// Profile: 27F, ENS-Both, recent surgery (6 weeks ago)
// Arc: High symptoms initially (~22–25), very volatile day to day.
//      Shows slow improvement trend but with big swings.
//      Stress is the strongest trigger. Exercise sometimes helps.
//      Sleep quality is very erratic.

var DEMO_ANIKA = {
  profile: {
    name:      'Anika Patel',
    age:       '27',
    gender:    'Female',
    phone:     '+1 (555) 111-9999',
    meds:      'Saline rinse, Nasal gel, Vitamin E oil',
    blood:     'A+',
    allergies: 'Pollen, Perfume',
    caretaker: 'priya.patel@email.com',
    subtype:   'ENS-Both',
    surgery:   '2026-01-15',
    baselineENS6Q: { suffocation: 4, burning: 4, openness: 5, crusting: 3, dryness: 5, air: 4 },
    baselineTotal: 25,
    baselineStatus: 'confirmed',
    goals: [
      { key: 'goalA', name: 'Sleep without breathing distress', target: 5 },
      { key: 'goalC', name: 'Reduce daily nasal discomfort',    target: 4 },
      { key: 'goalD', name: 'Breathe without thinking about it', target: 4 },
      { key: 'goalE', name: 'Understand my symptom triggers',   target: 3 },
    ]
  },
  checkins: (function() {
    var dates = _demoDates(28);
    var data = [];

    var arcs = {
      suffocation: [4,5,4,3,4,5,3,4,3,4, 5,3,3,4,3,2,3,4,2,3, 4,2,3,2,2,3,2,2],
      burning:     [4,4,3,4,3,4,4,3,3,3, 4,3,4,3,2,3,2,3,3,2, 3,2,2,3,2,2,2,1],
      openness:    [5,5,4,4,5,4,4,5,4,3, 5,4,3,4,3,3,4,3,3,3, 4,3,2,3,3,2,2,2],
      crusting:    [3,3,4,3,3,4,3,2,3,3, 4,3,2,3,2,2,3,2,2,3, 3,2,2,2,2,2,1,1],
      dryness:     [5,5,4,4,5,4,5,4,3,4, 5,4,3,3,3,3,4,3,2,3, 4,3,2,2,3,2,2,2],
      air:         [4,4,4,3,4,5,3,4,3,3, 4,3,3,3,3,2,3,3,2,2, 3,2,3,2,2,2,2,1],
    };

    var triggers = [
      ['Stress','Dry Air'],['Stress','Poor Sleep','A/C'],['Dry Air'],['Exercise'],['A/C','Dry Air'],['Stress','Weather Change','Poor Sleep'],['Exercise'],[],['Dry Air'],['Stress'],
      ['Stress','Poor Sleep','Skipped Meds'],['Exercise'],['Dry Air'],[],['Exercise'],['Dry Air'],['Stress','A/C'],['Weather Change'],['Exercise'],[],
      ['Stress','Poor Sleep'],['Exercise'],[],['Stress'],['Exercise','Dry Air'],[],[],[],
    ];

    var sleepHours = [4,3.5,5,6,4.5,3,6,5.5,6,5, 3.5,6,6.5,5,6.5,6,5,5.5,7,6.5, 4,6.5,7,5.5,7,7,7.5,7];
    var goalProx   = [1,1,2,2,1,1,3,2,3,2, 1,3,3,2,4,3,2,3,4,4, 2,4,4,4,5,5,5,6];

    var freeTexts = [
      "Everything is terrible. Can't breathe, can't sleep. The dryness is unbearable.",
      "Worst night yet. Woke up gasping. Feels like I'm breathing through sandpaper.",
      "Slightly better after using humidifier all night. Still awful though.",
      "Went for a walk. Surprisingly, the fresh air helped a little.",
      "Back to miserable. The office A/C is my enemy.",
      "Stress from work presentation + weather change = nightmare day.",
      "Exercised this morning. Actually felt somewhat human for a few hours.",
      "Calm day at home. Nose is still bad but mentally I'm coping better.",
      "The dryness wakes me up. I'm so tired of being tired.",
      "Stressed about upcoming appointment. Symptoms always worse when anxious.",
      "Absolute worst day. Skipped meds, stressed, barely slept. Everything at max.",
      "Exercise helped reset things. Why does movement help but rest doesn't?",
      "Dry air outside but managed with constant saline sprays.",
      "First somewhat normal day. Only noticed symptoms a few times.",
      "Exercise is becoming my go-to relief. 30 min walk = 2 hours of peace.",
      "Dryness still there but burning is fading. Progress?",
      "Stress day at work. Symptoms crept back up. The mind-body connection is real.",
      "Weather shifted. Felt it immediately in my nose.",
      "Best day so far! Exercised, slept ok, low stress. The trifecta.",
      "Calm day. Starting to see what makes things better vs worse.",
      "Bad night — stress dreams, poor sleep, everything flared.",
      "Exercise recovery day. Walk helped again. This is a pattern.",
      "Two good days in a row! Nose feels... manageable? Is this hope?",
      "Some stress but symptoms didn't spike as bad as they used to.",
      "Exercise + good sleep = my magic combo. Nose is almost tolerable.",
      "Steady improvement. Still not great but trajectory is right.",
      "Really good day. Almost forgot I have ENS for a few hours.",
      "Best day in the whole month. Symptoms are there but I'm in control, not them.",
    ];

    for (var i = 0; i < 28; i++) {
      var ens6q = {
        suffocation: arcs.suffocation[i],
        burning:     arcs.burning[i],
        openness:    arcs.openness[i],
        crusting:    arcs.crusting[i],
        dryness:     arcs.dryness[i],
        air:         arcs.air[i],
      };
      var total = 0;
      for (var k in ens6q) total += ens6q[k];

      data.push({
        date:          dates[i],
        ens6q:         ens6q,
        ens6qTotal:    total,
        freeText:      freeTexts[i],
        triggers:      triggers[i],
        sleepHours:    sleepHours[i],
        goalProximity: goalProx[i],
        nlpOutput:     null,
        goalProgress:  null,
      });
    }
    return data;
  })()
};


// ─────────────────────────────────────────────────────────────
// ALL DEMO PATIENTS — combined for easy access
// ─────────────────────────────────────────────────────────────

var DEMO_PATIENTS = {
  meera: DEMO_MEERA,
  james: DEMO_JAMES,
  anika: DEMO_ANIKA,
};

// Array form for iteration
var DEMO_PATIENTS_LIST = [DEMO_MEERA, DEMO_JAMES, DEMO_ANIKA];


// ─────────────────────────────────────────────────────────────
// LOADER: populate Firestore with demo data
// ─────────────────────────────────────────────────────────────
// Call this from the browser console or a debug button to
// seed the database for a demo presentation.

async function loadDemoPatient(demoKey) {
  if (!DEMO_PATIENTS[demoKey]) {
    console.error('[Demo] Unknown patient key:', demoKey);
    return { success: false, errorMessage: 'Unknown demo patient: ' + demoKey };
  }

  var uid = getCurrentUserId();
  if (!uid) {
    return { success: false, errorMessage: 'Must be signed in to load demo data.' };
  }

  var demo = DEMO_PATIENTS[demoKey];
  console.log('[Demo] Loading', demo.profile.name, '— 28 days of data...');

  // 1. Save profile
  var profileResult = await saveProfile(uid, demo.profile);
  if (!profileResult.success) return profileResult;

  // 2. Save all check-ins (sequentially to avoid rate limits)
  var saved = 0;
  for (var i = 0; i < demo.checkins.length; i++) {
    var result = await saveCheckin(uid, demo.checkins[i]);
    if (result.success) saved++;
  }

  console.log('[Demo] Loaded', demo.profile.name, ':', saved, '/', demo.checkins.length, 'check-ins saved.');
  return { success: true, profile: demo.profile.name, checkinsSaved: saved };
}

// Load all three at once (for testing engines with multiple patients)
async function loadAllDemoPatients() {
  console.log('[Demo] This loads ONE demo patient into the current account.');
  console.log('[Demo] Use loadDemoPatient("meera"), loadDemoPatient("james"), or loadDemoPatient("anika").');
  console.log('[Demo] To test all three, sign in with 3 different accounts.');
}
