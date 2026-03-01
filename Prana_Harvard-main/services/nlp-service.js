// ============================================================
// nlp-service.js — Symptom NLP via Groq (LLaMA 3.3 70B)
// ============================================================
// Takes the patient's free-text from daily check-ins and maps
// it to clinical SNOMED-CT terms using Groq's LLaMA 3.3 70B.
//
// Currently MOCKED — returns realistic fake output so the rest
// of the pipeline (goal-engine, report-generator) can be built
// and tested without a live API key.
//
// When you're ready to go live:
//   1. Set GROQ_API_KEY below
//   2. Set USE_MOCK = false
//
// Depends on:
//   data/ens-config.js → ENS_DOMAIN_KEYS
// ============================================================


// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

var GROQ_API_KEY = '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';   // Replace with real key
var GROQ_MODEL   = 'llama-3.3-70b-versatile';
var GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
var USE_MOCK     = false;  // Set to false when API key is ready


// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Clinical NLP extraction
// ─────────────────────────────────────────────────────────────
// This is the core prompt that teaches the LLM to extract
// symptom mappings from patient free-text.

var NLP_SYSTEM_PROMPT = [
  'You are a clinical NLP assistant for rare disease symptom management,',
  'specifically Empty Nose Syndrome (ENS).',
  '',
  'The patient uses a 6-domain symptom tracker called ENS6Q:',
  '  1. suffocation — Nasal Suffocation (feeling of not getting enough air)',
  '  2. burning — Nasal Burning (irritation, stinging, heat in nasal passages)',
  '  3. openness — Nasal Openness (paradoxical feeling of too-open nasal cavity)',
  '  4. crusting — Nasal Crusting (dried mucus, scabs forming in nose)',
  '  5. dryness — Nasal Dryness (lack of moisture in nasal passages)',
  '  6. air — Impaired Air Sensation (reduced or absent sense of airflow)',
  '',
  'Your task: analyze the patient\'s free-text journal entry and extract',
  'symptom mentions. For each mention, provide:',
  '',
  '1. patientPhrase — the exact words the patient used',
  '2. snomedDesc — the closest SNOMED-CT clinical description',
  '3. snomedCode — the SNOMED-CT code if known (or "N/A")',
  '4. ens6qDomain — which of the 6 ENS6Q domains this maps to',
  '5. confidence — your confidence in the mapping (0.0 to 1.0)',
  '6. severity — inferred severity from context: "mild", "moderate", or "severe"',
  '',
  'Also provide:',
  '- overallSentiment: "positive", "negative", "mixed", or "neutral"',
  '- keyInsight: a one-sentence clinical observation from the text',
  '',
  'Return ONLY valid JSON in this exact format:',
  '{',
  '  "mappedTerms": [',
  '    {',
  '      "patientPhrase": "...",',
  '      "snomedDesc": "...",',
  '      "snomedCode": "...",',
  '      "ens6qDomain": "...",',
  '      "confidence": 0.0,',
  '      "severity": "..."',
  '    }',
  '  ],',
  '  "overallSentiment": "...",',
  '  "keyInsight": "..."',
  '}',
  '',
  'Rules:',
  '- Only extract symptoms actually mentioned. Do not infer symptoms not described.',
  '- A single phrase can map to multiple domains if appropriate.',
  '- Flag terms with confidence below 0.7 — these need clinician review.',
  '- If the text contains no symptom mentions, return an empty mappedTerms array.',
  '- Always return valid JSON. No markdown, no code fences.',
].join('\n');


// ─────────────────────────────────────────────────────────────
// MAIN FUNCTION: mapSymptomsToTerms
// ─────────────────────────────────────────────────────────────

/**
 * mapSymptomsToTerms — Extracts clinical symptom mappings
 * from patient free-text.
 *
 * @param {string} freeText — the patient's journal entry
 * @param {object} ens6qScores — today's ENS6Q scores (for context)
 * @returns {object} nlpOutput:
 *   {
 *     mappedTerms: [ { patientPhrase, snomedDesc, snomedCode, ens6qDomain, confidence, severity } ],
 *     overallSentiment: string,
 *     keyInsight: string,
 *     uncertainTerms: [ ... terms with confidence < 0.7 ],
 *     source: "groq" | "mock",
 *     model: string,
 *     timestamp: string,
 *   }
 */
async function mapSymptomsToTerms(freeText, ens6qScores) {
  // Skip if no text provided
  if (!freeText || !freeText.trim()) {
    return _emptyNlpOutput('No free-text provided.');
  }

  // Use mock or live API
  if (USE_MOCK) {
    return _mockNlpResponse(freeText, ens6qScores);
  }

  return await _callGroqAPI(freeText, ens6qScores);
}


// ─────────────────────────────────────────────────────────────
// LIVE API CALL (Groq)
// ─────────────────────────────────────────────────────────────

async function _callGroqAPI(freeText, ens6qScores) {
  // Build user message with context
  var userMessage = [
    'Patient\'s daily journal entry:',
    '"' + freeText + '"',
    '',
    'Today\'s ENS6Q scores (0-5 scale): ' + JSON.stringify(ens6qScores),
  ].join('\n');

  try {
    var response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: NLP_SYSTEM_PROMPT },
          { role: 'user',   content: userMessage }
        ],
        temperature: 0.2,       // Low temp for consistent clinical output
        max_tokens: 1024,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('[NLP] Groq API error:', response.status, errText);
      return _emptyNlpOutput('Groq API error: ' + response.status);
    }

    var result = await response.json();
    var content = result.choices[0].message.content;

    // Parse LLM JSON response
    var parsed = JSON.parse(content);

    // Flag uncertain terms
    var uncertainTerms = (parsed.mappedTerms || []).filter(function(t) {
      return t.confidence < 0.7;
    });

    console.log('[NLP] Groq response:', parsed.mappedTerms.length, 'terms extracted');

    return {
      mappedTerms:      parsed.mappedTerms || [],
      overallSentiment: parsed.overallSentiment || 'neutral',
      keyInsight:       parsed.keyInsight || '',
      uncertainTerms:   uncertainTerms,
      source:           'groq',
      model:            GROQ_MODEL,
      timestamp:        new Date().toISOString()
    };

  } catch (error) {
    console.error('[NLP] Error calling Groq:', error);
    return _emptyNlpOutput('API call failed: ' + error.message);
  }
}


// ─────────────────────────────────────────────────────────────
// MOCK RESPONSE — realistic fake output for testing
// ─────────────────────────────────────────────────────────────

function _mockNlpResponse(freeText, ens6qScores) {
  var text = freeText.toLowerCase();
  var terms = [];

  // Keyword → mapping rules (simulates what the LLM would extract)
  var rules = [
    {
      keywords: ["can't breathe", "couldn't breathe", "breathing through a straw", "gasping", "suffocat"],
      term: {
        snomedDesc: 'Nasal airway obstruction sensation',
        snomedCode: '267101005',
        ens6qDomain: 'suffocation',
        severity: 'severe'
      }
    },
    {
      keywords: ["burns", "burning", "stinging", "irritat", "sandpaper"],
      term: {
        snomedDesc: 'Burning sensation of nasal mucosa',
        snomedCode: '249366005',
        ens6qDomain: 'burning',
        severity: 'moderate'
      }
    },
    {
      keywords: ["too open", "empty", "cavernous", "hollow", "wide open"],
      term: {
        snomedDesc: 'Paradoxical nasal patency',
        snomedCode: 'N/A',
        ens6qDomain: 'openness',
        severity: 'moderate'
      }
    },
    {
      keywords: ["crust", "scab", "dried", "mucus"],
      term: {
        snomedDesc: 'Nasal mucosal crusting',
        snomedCode: '95319005',
        ens6qDomain: 'crusting',
        severity: 'mild'
      }
    },
    {
      keywords: ["dry", "dryness", "no moisture", "parched", "desert"],
      term: {
        snomedDesc: 'Dryness of nasal mucosa',
        snomedCode: '11420004',
        ens6qDomain: 'dryness',
        severity: 'moderate'
      }
    },
    {
      keywords: ["no airflow", "can't feel air", "air sensation", "feel every breath", "hyper-aware"],
      term: {
        snomedDesc: 'Impaired nasal airflow sensation',
        snomedCode: 'N/A',
        ens6qDomain: 'air',
        severity: 'moderate'
      }
    },
    {
      keywords: ["couldn't sleep", "can't sleep", "woke up", "poor sleep", "insomnia", "tired", "sleep"],
      term: {
        snomedDesc: 'Sleep disturbance due to nasal symptoms',
        snomedCode: '193462001',
        ens6qDomain: 'suffocation',
        severity: 'moderate'
      }
    },
    {
      keywords: ["stress", "anxious", "anxiety", "worried", "panic"],
      term: {
        snomedDesc: 'Anxiety-related symptom exacerbation',
        snomedCode: '48694002',
        ens6qDomain: 'suffocation',
        severity: 'moderate'
      }
    },
    {
      keywords: ["humidifier", "saline", "rinse", "spray", "oil"],
      term: {
        snomedDesc: 'Therapeutic nasal moisture management',
        snomedCode: 'N/A',
        ens6qDomain: 'dryness',
        severity: 'mild'
      }
    },
    {
      keywords: ["better", "improved", "progress", "relief", "helped"],
      term: {
        snomedDesc: 'Symptomatic improvement noted',
        snomedCode: 'N/A',
        ens6qDomain: 'dryness',
        severity: 'mild'
      }
    },
  ];

  // Scan text for keyword matches
  rules.forEach(function(rule) {
    for (var i = 0; i < rule.keywords.length; i++) {
      if (text.indexOf(rule.keywords[i]) !== -1) {
        // Extract the phrase around the keyword (rough window)
        var idx = text.indexOf(rule.keywords[i]);
        var start = Math.max(0, idx - 15);
        var end = Math.min(text.length, idx + rule.keywords[i].length + 20);
        var phrase = freeText.substring(start, end).trim();
        // Clean up partial words at edges
        if (start > 0) phrase = '...' + phrase;
        if (end < text.length) phrase = phrase + '...';

        terms.push({
          patientPhrase: phrase,
          snomedDesc:    rule.term.snomedDesc,
          snomedCode:    rule.term.snomedCode,
          ens6qDomain:   rule.term.ens6qDomain,
          confidence:    0.75 + Math.random() * 0.2,  // 0.75–0.95
          severity:      rule.term.severity
        });
        break;  // one match per rule
      }
    }
  });

  // Round confidence to 2 decimal places
  terms.forEach(function(t) {
    t.confidence = parseFloat(t.confidence.toFixed(2));
  });

  // Determine sentiment from text cues
  var sentiment = 'neutral';
  var posWords = ['better', 'improved', 'good', 'great', 'hope', 'progress', 'best', 'fantastic', 'forgot about'];
  var negWords = ['terrible', 'worst', 'awful', 'miserable', 'unbearable', 'nightmare', 'bad', 'flare'];
  var posCount = 0, negCount = 0;
  posWords.forEach(function(w) { if (text.indexOf(w) !== -1) posCount++; });
  negWords.forEach(function(w) { if (text.indexOf(w) !== -1) negCount++; });
  if (posCount > negCount) sentiment = 'positive';
  else if (negCount > posCount) sentiment = 'negative';
  else if (posCount > 0 && negCount > 0) sentiment = 'mixed';

  // Generate a mock key insight
  var insight = _generateMockInsight(terms, sentiment, ens6qScores);

  // Flag uncertain terms
  var uncertainTerms = terms.filter(function(t) {
    return t.confidence < 0.7;
  });

  console.log('[NLP] Mock response:', terms.length, 'terms extracted (sentiment:', sentiment + ')');

  return {
    mappedTerms:      terms,
    overallSentiment: sentiment,
    keyInsight:       insight,
    uncertainTerms:   uncertainTerms,
    source:           'mock',
    model:            'keyword-matching-v1',
    timestamp:        new Date().toISOString()
  };
}


// ─────────────────────────────────────────────────────────────
// Mock insight generator
// ─────────────────────────────────────────────────────────────

function _generateMockInsight(terms, sentiment, ens6qScores) {
  if (!terms.length) {
    return 'No specific symptom mentions detected in this entry.';
  }

  // Find the most affected domain from scores
  var maxDomain = '';
  var maxScore = -1;
  if (ens6qScores) {
    for (var k in ens6qScores) {
      if (ens6qScores[k] > maxScore) {
        maxScore = ens6qScores[k];
        maxDomain = k;
      }
    }
  }

  var insights = {
    positive: [
      'Patient reports symptomatic improvement; ' + maxDomain + ' remains the primary domain of concern.',
      'Positive trajectory noted. Self-management strategies appear effective.',
      'Patient expresses improved coping. Clinical scores support subjective improvement.'
    ],
    negative: [
      'Patient describes significant distress; ' + maxDomain + ' is the dominant complaint.',
      'Symptom exacerbation reported, possibly linked to environmental or stress triggers.',
      'High symptom burden noted. Consider reviewing current management plan.'
    ],
    mixed: [
      'Mixed presentation: some improvement alongside persistent ' + maxDomain + ' concerns.',
      'Patient reports both relief and ongoing difficulty. Trend monitoring recommended.'
    ],
    neutral: [
      'Stable symptom presentation. ' + maxDomain + ' is the highest-scoring domain.',
      'Routine entry with no significant change from prior assessment.'
    ]
  };

  var pool = insights[sentiment] || insights.neutral;
  return pool[Math.floor(Math.random() * pool.length)];
}


// ─────────────────────────────────────────────────────────────
// Empty output (for errors or empty text)
// ─────────────────────────────────────────────────────────────

function _emptyNlpOutput(reason) {
  return {
    mappedTerms:      [],
    overallSentiment: 'neutral',
    keyInsight:       reason || 'No analysis available.',
    uncertainTerms:   [],
    source:           'none',
    model:            'N/A',
    timestamp:        new Date().toISOString()
  };
}


// ─────────────────────────────────────────────────────────────
// UTILITY: Check if Groq is configured
// ─────────────────────────────────────────────────────────────

function isGroqConfigured() {
  return GROQ_API_KEY !== 'YOUR_GROQ_API_KEY' && !USE_MOCK;
}
