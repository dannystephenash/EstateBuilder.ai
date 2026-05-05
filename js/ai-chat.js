// ai-chat.js — Claude (Anthropic) API integration, AI analysis renderers, jurisdiction config
const AI_STORAGE_KEY = 'estatebuilder_claude_key';

/** In-memory fallback for when localStorage is blocked (file:// protocol) */
let _claudeKeyMemory = '';

/** Sanitize API key — strip ALL whitespace and non-printable/non-ASCII chars */
function sanitizeAPIKey(raw) {
  // 1. Strip everything outside printable ASCII (0x21-0x7E) — NO spaces kept
  //    This removes zero-width spaces, BOM, bullets, curly quotes, tabs,
  //    newlines, carriage returns, and regular spaces (API keys never have spaces)
  return raw.replace(/[^\x21-\x7E]/g, '');
}

/** Save API key — stores in memory + localStorage */
function saveClaudeKey() {
  const inp = document.getElementById('claude-key');
  const el = document.getElementById('ai-key-status');
  let rawVal = inp.value.trim();
  console.log('[AI] saveClaudeKey called, raw input length:', rawVal.length);

  // If the input still shows the masked placeholder, ignore it
  if (!rawVal || rawVal.length < 10 || /^[•*]+/.test(rawVal)) {
    console.log('[AI] Key empty, too short, or still masked — ignoring');
    if (el) el.innerHTML = '<span style="color:#c66">Paste your full API key first, then click SAVE</span>';
    return;
  }

  // Sanitize: strip non-printable/non-ASCII chars (bullets, zero-width, etc.)
  let key = sanitizeAPIKey(rawVal);
  if (key.length < 10) {
    if (el) el.innerHTML = '<span style="color:#c66">Key is too short after cleaning (' + key.length + ' chars)</span>';
    return;
  }

  // Validate: Anthropic keys start with sk-ant- and are 90+ chars
  if (!key.startsWith('sk-ant-')) {
    if (el) el.innerHTML = '<span style="color:#c66">&#10007; Key must start with "sk-ant-" — get yours from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#AEBC46">console.anthropic.com/settings/keys</a></span>';
    return;
  }

  if (key.length < 80) {
    if (el) el.innerHTML = '<span style="color:#c66">&#10007; Key is only ' + key.length + ' characters — full Anthropic keys are 90+ characters long.' +
      '<br>You may be copying a <b>masked/truncated</b> key.' +
      '<br>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#AEBC46">console.anthropic.com/settings/keys</a>, click <b>"Create Key"</b> to generate a new one, and copy the FULL key immediately (it is only shown once).</span>';
    inp.value = rawVal; // Keep value visible so user can see what they pasted
    inp.style.color = '#c66';
    return;
  }

  // Store in memory only — for security we no longer persist API keys to localStorage.
  // User re-pastes key on each session. This prevents key exposure to XSS / shared devices.
  _claudeKeyMemory = key;

  // Mask the input for display
  inp.value = '••••••••' + key.slice(-4);
  inp.type = 'text';
  inp.style.color = '#4a8';

  updateAIKeyStatus(true);

  // Auto-test the key
  testClaudeKey();
}

/** Clear API key from memory and localStorage */
function clearClaudeKey() {
  _claudeKeyMemory = '';
  try { localStorage.removeItem(AI_STORAGE_KEY); } catch(e) {}
  const inp = document.getElementById('claude-key');
  if (inp) { inp.value = ''; inp.style.color = '#AEBC46'; inp.placeholder = 'Paste your FULL API key here (sk-ant-api03-... ~108 chars)'; }
  const el = document.getElementById('ai-key-status');
  if (el) el.innerHTML = '<span style="color:#888">Key cleared. Paste a new key from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#AEBC46">console.anthropic.com/settings/keys</a> — you may need to create a new one.</span>';
}

/** Get API key from memory only — keys are no longer persisted to localStorage. */
function getClaudeKey() {
  return _claudeKeyMemory || '';
}

/** One-time cleanup: remove any legacy keys still in localStorage from older versions. */
(function _purgeLegacyApiKeys(){
  try { if (localStorage.getItem(AI_STORAGE_KEY)) localStorage.removeItem(AI_STORAGE_KEY); } catch(e) {}
})();

function updateAIKeyStatus(justSaved) {
  const el = document.getElementById('ai-key-status');
  if (!el) return;
  const key = getClaudeKey();
  if (key && key.length > 10) {
    el.style.color = '#4a8';
    // Don't show key prefix/suffix — even partial keys are a credential leak risk
    el.innerHTML = (justSaved ? '&#10003; Key saved' : '&#10003; Key loaded') +
      ' &mdash; <span style="font-family:monospace;font-size:13px;color:#8a8">' + key.length + ' chars stored in memory</span>' +
      ' <a href="#" onclick="testClaudeKey();return false" style="color:#AEBC46;font-size:13px;margin-left:6px">[TEST KEY]</a>';
  } else {
    el.style.color = '#888';
    el.textContent = 'No key saved yet. Get one at console.anthropic.com/settings/keys';
  }
}

/** Quick test — sends a tiny request to verify the key works */
async function testClaudeKey() {
  const el = document.getElementById('ai-key-status');
  const key = getClaudeKey();
  if (!key) { el.textContent = 'No key to test'; return; }

  const cleanKey = sanitizeAPIKey(key);
  // Sanitization check (no key material logged)
  if (key !== cleanKey) {
    console.warn('[AI] Key was modified by sanitization (invisible chars removed).');
  }

  // Warn if key doesn't look like an Anthropic key
  if (!cleanKey.startsWith('sk-ant-')) {
    el.innerHTML = '<span style="color:#c66">&#10007; Key doesn\'t start with "sk-ant-" — make sure you\'re using an Anthropic API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#AEBC46">console.anthropic.com</a></span>';
    return;
  }

  el.innerHTML = '<span style="color:#cc8">Testing key...</span>';

  const testPayload = JSON.stringify({
    model: 'claude-haiku-4-5',
    max_tokens: 16,
    messages: [{ role: 'user', content: 'Say OK' }],
  });

  let resp = null;
  let method = '';

  // Try direct first
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: testPayload,
    });
    method = 'direct';
  } catch (directErr) {
    console.warn('[AI] Direct call failed, trying proxy...');
    // Fallback to local proxy
    try {
      resp = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: cleanKey, model: 'claude-haiku-4-5', max_tokens: 16, messages: [{ role: 'user', content: 'Say OK' }] }),
      });
      method = 'proxy';
    } catch (proxyErr) {
      console.error('[AI] Test: both methods failed');
      el.innerHTML = '<span style="color:#c66">&#10007; Cannot reach API — check internet connection</span>' +
        '<br><span style="color:#888;font-size:12px">Direct: ' + escapeHtml(directErr.message) + '</span>' +
        '<br><span style="color:#888;font-size:12px">Proxy: ' + escapeHtml(proxyErr.message) + '</span>';
      return;
    }
  }

  if (resp.ok) {
    el.innerHTML = '<span style="color:#4a8">&#10003; Key is valid and working! (via ' + method + ')</span>';
  } else {
    const respText = await resp.text();
    let msg = 'Unknown error';
    try { const err = JSON.parse(respText); msg = (err.error && err.error.message) || msg; } catch(e) {}
    // Don't expose any portion of the key in the UI
    el.innerHTML = '<span style="color:#c66">&#10007; HTTP ' + resp.status + ': ' + escapeHtml(msg) + ' (via ' + method + ')</span>' +
      '<br><span style="color:#888;font-size:12px">Click CLEAR, re-paste key from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color:#AEBC46">console.anthropic.com</a></span>';
  }
}

// API keys are no longer persisted to localStorage for security reasons.
// User must paste their key once per browser session.
setTimeout(function(){ updateAIKeyStatus(); }, 500);

/** Toggle collapsible AI section cards */
function toggleAiSection(hd) {
  hd.classList.toggle('collapsed');
  const bd = hd.nextElementSibling;
  bd.classList.toggle('hidden');
}

/** Jurisdiction selector */
function getAIJurisdiction() {
  const sel = document.getElementById('ai-jurisdiction');
  return sel ? sel.value || null : null;
}

function aiJurisdictionChanged() {
  const sel = document.getElementById('ai-jurisdiction');
  const info = document.getElementById('ai-jurisdiction-info');
  if (sel.value) {
    info.textContent = 'Jurisdiction locked to ' + sel.options[sel.selectedIndex].text;
    info.style.color = '#AEBC46';
  } else {
    info.textContent = 'Will auto-detect from site address';
    info.style.color = '#666';
  }
}

// ─── Jurisdiction Registry (same data as server-side) ─────

const JURISDICTIONS = {
  toronto: {
    name: 'City of Toronto', province: 'Ontario',
    zoningBylaw: 'Zoning By-law 569-2013',
    planningAuthority: 'City of Toronto — City Planning Division',
    zoningContext: `Toronto zoning operates under By-law 569-2013. Key zone categories for mixed-use:
- CR (Commercial Residential): Format "CR X.0 (cY.Y; rZ.Z)" where X=total FSI, c=commercial cap, r=residential cap.
- CRE: Similar to CR with employment component.
- Chapter 900 Site-Specific Exceptions may modify permissions.
TYPICAL SETBACKS (By-law 569-2013):
- Front: 0.0m on Avenues (commercial at-grade), 3.0m on residential streets, 4.5m on arterials without Avenue overlay.
- Side (interior): 5.5m or half building height (whichever is greater) for residential portions; 0.0m for commercial below podium.
- Side (flanking street): 3.0m minimum.
- Rear: 7.5m minimum. Rear angular plane: 45° measured from 10.5m height at rear lot line.
- Tower stepback: 3.0m above streetwall (podium height = 80% of ROW width, typically 4-6 storeys).
- Tower separation: 25m between towers (Tall Building Guidelines).
MID-RISE DESIGN GUIDELINES: Max height = ROW width (1:1 ratio). Angular plane 45° from opposite curb. Step-back 3m above podium.`,
    dcContext: `Toronto DC rates (2024 By-law): Residential ~$55,012/unit (apartments 2+ BR), ~$33,517/unit (bachelor/1BR). Non-residential ~$43.95/sq.ft. Education DC ~$2,845/unit. Rates indexed annually.`
  },
  mississauga: {
    name: 'City of Mississauga', province: 'Ontario',
    zoningBylaw: 'Zoning By-law 0225-2007',
    planningAuthority: 'City of Mississauga — Planning & Building Department',
    zoningContext: `Mississauga zoning under By-law 0225-2007. Key zones: C4 (Mainstreet Commercial), D (Development), H (City Centre). Height/density set by Secondary Plans and MTSAs.`,
    dcContext: `Mississauga DC: Residential apartments ~$30,000-$50,000/unit. Non-residential ~$30-$45/sq.ft. Regional (Peel) DC in addition.`
  },
  ottawa: {
    name: 'City of Ottawa', province: 'Ontario',
    zoningBylaw: 'Comprehensive Zoning By-law 2008-250',
    planningAuthority: 'City of Ottawa — Planning, Real Estate & Economic Development',
    zoningContext: `Ottawa zoning under By-law 2008-250 (amended by new Official Plan 2022). Key zones: TD (Transit-Oriented Development), AM (Arterial Mainstreet), TM (Traditional Mainstreet), Hub zones.`,
    dcContext: `Ottawa DC: Residential (2+ BR) ~$28,000-$35,000/unit. Non-residential ~$15-$25/sq.ft. Transit levy in designated areas.`
  },
  hamilton: {
    name: 'City of Hamilton', province: 'Ontario',
    zoningBylaw: 'Zoning By-law 05-200',
    planningAuthority: 'City of Hamilton — Planning & Economic Development',
    zoningContext: `Hamilton zoning under By-law 05-200. Key zones: C5 (Downtown Mixed-Use), C3 (Community Commercial), D1-D6 downtown designations. LRT corridor intensification along King Street.`,
    dcContext: `Hamilton DC: Residential apartments ~$20,000-$30,000/unit. Non-residential ~$15-$25/sq.ft. DC exemptions may apply in CIP areas.`
  }
};

function resolveJurisdiction() {
  const explicit = getAIJurisdiction();
  if (explicit && JURISDICTIONS[explicit]) return JURISDICTIONS[explicit];
  const addr = (P.siteAddress || '').toLowerCase();
  if (addr.includes('mississauga') || addr.includes('peel')) return JURISDICTIONS.mississauga;
  if (addr.includes('ottawa')) return JURISDICTIONS.ottawa;
  if (addr.includes('hamilton') || addr.includes('dundas') || addr.includes('stoney creek')) return JURISDICTIONS.hamilton;
  return JURISDICTIONS.toronto;
}

// ─── Asset Class Benchmark Registry ──────────────────────

const ASSET_BENCHMARKS = {

  midrise: {
    label: 'Mixed-Use Mid-Rise',
    zoningContext: `Toronto CR/CRE zone standards (By-law 569-2013):
SETBACKS: Front 0.0m on Avenues (build-to line), 3.0m on residential streets. Sides: 5.5m or half building height (whichever greater) for residential; 0.0m for commercial podium on interior lot. Rear: 7.5m minimum. In feet: Front 0-10ft, Sides 18ft (5.5m), Rear 25ft (7.5m).
MASSING: Lot coverage max 80%. Main wall height = 80% of ROW width. Step-back 3.0m (10ft) above streetwall. Angular plane 45° from opposite curb. Rear angular plane 45° from 10.5m at rear lot line.
DENSITY: FSI split per zone label CR X.0 (cY.Y; rZ.Z). Mid-Rise Guidelines: max height = ROW width (1:1).
ZBLA STRATEGY: Developers routinely seek 1.5-2.5x as-of-right FSI on Avenue sites. MTSA sites within 800m of transit can achieve 3-5x. OLT/OMB precedent supports density where transit, infrastructure, and Official Plan growth targets align. Most successful ZBLAs on Avenues achieve 6-10 storeys with FSI 3.0-5.0x.`,
    costBenchmarks: `Hard costs $300-400/sf GFA (5-8st: $300-350, 9-12st: $350-400). Soft costs 18-25% of hard (EXCLUDING DCs). DCs separate: $30-60K/unit residential, $44/sf commercial. A&E 5-8%, PM 2-4%, contingency 5-10%.`,
    revBenchmarks: `Resi PSF: $950-1250 midtown, $800-1050 suburb. Parking $60-85K/stall. Lockers $6-10K. Retail $25-45/sf NNN, cap 5.5-7.0%. Target profit margin 15-25%.`,
    structureType: 'Reinforced concrete, 5-12 storeys, podium + upper floors',
  },

  highrise: {
    label: 'Mixed-Use High-Rise',
    zoningContext: `Toronto CR/CRE or site-specific ZBLA. Tall Building Design Guidelines:
SETBACKS: Front: 0.0m podium (build-to), tower 3m stepback from podium face. Sides: podium 0.0m on commercial, 5.5m residential; tower 12.5m from side lot line (25m tower separation / 2). Rear: podium 7.5m, tower 12.5m. In feet: sides ~18ft podium/41ft tower, rear 25ft podium/41ft tower.
MASSING: Tower floorplate max 750 sq.m (8,070sf). Tower separation 25m (82ft). Podium height = 80% ROW, step-back 3m (10ft). Shadow: no net new shadow on parks/open spaces 9:18am-5:18pm March 21 & Sept 21.
ZBLA STRATEGY: Highrise ALWAYS requires site-specific ZBLA. Developers push for maximum height that shadow studies, wind studies, and neighbourhood context allow. Typical ZBLA achieves 5-15x FSI on MTSA sites. CBC/S37 contribution negotiated — typically $2,000-5,000/unit. OLT precedent strongly supports density near higher-order transit (subway, LRT). Most successful downtown/midtown ZBLAs: 25-45 storeys.`,
    costBenchmarks: `Hard costs $350-500/sf GFA (13-20st: $350-420, 21-40st: $400-475, 40+st: $450-500+). Soft costs 20-30% of hard (EXCLUDING DCs). DCs: $55-65K/unit residential. S37/CBC $2,000-5,000/unit. A&E 6-10%, PM 3-5%, contingency 7-12%.`,
    revBenchmarks: `Resi PSF: $1100-1600 downtown/midtown, $900-1200 suburb. Floor premium 1-3%/floor. Penthouse +20-40%. Parking $70-100K/stall. Lockers $8-12K. Retail $30-60/sf NNN, cap 5.0-6.5%. Target margin 15-22%.`,
    structureType: 'Reinforced concrete or hybrid steel, 13-60+ storeys, podium + tower',
  },
};

// ─── Asset Class Financial Profiles ──────────────────────

const ASSET_PROFILES = {
  midrise: {
    label: 'Mixed-Use Mid-Rise',
    revenueModel: 'unit-sale',
    defaults: {
      units: [
        {type:'Studio',size:425,count:21,psf:1100},
        {type:'1-Bedroom',size:550,count:82,psf:1075},
        {type:'1-Bed+Den',size:630,count:41,psf:1050},
        {type:'2-Bedroom',size:775,count:41,psf:1025},
        {type:'2-Bed+Den',size:875,count:11,psf:1000},
        {type:'3-Bedroom',size:1050,count:10,psf:975}
      ],
      comm: [
        {label:'Grocery Anchor',pct:0.70,rent:22,cap:0.060},
        {label:'CRU Retail / F&B',pct:0.20,rent:35,cap:0.060},
        {label:'Service / Personal',pct:0.10,rent:28,cap:0.065}
      ],
      parkPrice:60000, lockerPrice:8000, parkRatio:0.30, lockerRatio:0.56,
      landPrice:10000000, lttRate:0.025, ddCost:350000,
      hc:{shoring:18,structure:68,envelope:85,mech:38,elec:22,fitResi:55,fitComm:12,commShell:8,elevators:6,siteWorks:5,parking:28,groceryTI:4.5},
      sc:{ae:0.065,pm:0.03,legal:0.015,insurance:0.012,marketing:0.04,permits:0.008,contingency:0.105},
      dcPerUnit:45000, dcCommPerSF:44, s37PerUnit:7300, parkland:2200000,
      ltc:0.65, intRate:0.065, drawMonths:24, loanFeePct:0.01,
      dcf:{
        discountRate:0.08, preSalesPct:0.70, preSalesDeposit:0.20,
        absorptionMonths:18, constructionRate:0.065, equityPct:0.35,
        phases:[
          {id:'approvals',label:'Approvals & Entitlements',months:15,costPct:0.03},
          {id:'shoring',label:'Shoring & Excavation',months:6,costPct:0.08},
          {id:'belowGrade',label:'Below-Grade Structure',months:6,costPct:0.12},
          {id:'aboveGrade',label:'Above-Grade Structure',months:12,costPct:0.30},
          {id:'envelope',label:'Building Envelope',months:8,costPct:0.15},
          {id:'fitout',label:'Interior Fit-Out',months:10,costPct:0.22},
          {id:'commission',label:'Commissioning & Occupancy',months:4,costPct:0.08},
          {id:'deficiency',label:'Deficiency Holdback',months:6,costPct:0.02}
        ]
      }
    }
  },

  highrise: {
    label: 'Mixed-Use High-Rise',
    revenueModel: 'unit-sale',
    defaults: {
      units: [
        {type:'Studio',size:400,count:60,psf:1250},
        {type:'1-Bedroom',size:520,count:180,psf:1200},
        {type:'1-Bed+Den',size:600,count:100,psf:1175},
        {type:'2-Bedroom',size:750,count:80,psf:1150},
        {type:'2-Bed+Den',size:850,count:30,psf:1100},
        {type:'3-Bedroom',size:1000,count:20,psf:1050},
        {type:'Penthouse',size:1800,count:4,psf:1500}
      ],
      comm: [
        {label:'Lobby Retail',pct:0.50,rent:40,cap:0.055},
        {label:'Restaurant / F&B',pct:0.30,rent:50,cap:0.055},
        {label:'Service Commercial',pct:0.20,rent:30,cap:0.060}
      ],
      parkPrice:60000, lockerPrice:10000, parkRatio:0.30, lockerRatio:0.50,
      landPrice:35000000, lttRate:0.025, ddCost:750000,
      hc:{shoring:22,structure:95,envelope:70,mech:50,elec:30,fitResi:60,fitComm:15,commShell:10,elevators:12,siteWorks:8,parking:35,curtainWall:25},
      sc:{ae:0.075,pm:0.04,legal:0.018,insurance:0.014,marketing:0.045,permits:0.010,contingency:0.12},
      dcPerUnit:60000, dcCommPerSF:50, s37PerUnit:5000, parkland:3500000,
      ltc:0.60, intRate:0.070, drawMonths:36, loanFeePct:0.01,
      dcf:{
        discountRate:0.08, preSalesPct:0.75, preSalesDeposit:0.20,
        absorptionMonths:24, constructionRate:0.070, equityPct:0.40,
        phases:[
          {id:'approvals',label:'Approvals & Entitlements',months:24,costPct:0.02},
          {id:'shoring',label:'Shoring & Excavation',months:8,costPct:0.06},
          {id:'belowGrade',label:'Below-Grade Structure',months:10,costPct:0.10},
          {id:'aboveGrade',label:'Above-Grade Structure',months:18,costPct:0.35},
          {id:'envelope',label:'Curtain Wall & Envelope',months:12,costPct:0.18},
          {id:'fitout',label:'Interior Fit-Out',months:14,costPct:0.20},
          {id:'commission',label:'Commissioning & Occupancy',months:5,costPct:0.07},
          {id:'deficiency',label:'Deficiency Holdback',months:6,costPct:0.02}
        ]
      }
    }
  },
};

// ─── Asset Profile Helpers ──────────────────────────────

function loadAssetDefaults(assetType) {
  const profile = ASSET_PROFILES[assetType];
  if (!profile) return;

  // Deep-clone defaults so we don't mutate the registry
  const defs = JSON.parse(JSON.stringify(profile.defaults));

  // Merge into P.pf — full reset to asset defaults
  P.pf = defs;
  P.projectType = assetType;

  // Sync UI select
  const sel = document.getElementById('project-type-select');
  if (sel) sel.value = assetType;

  // Clear caches and rebuild
  _pfCache = null;
  _dcfPhasesManuallyEdited = false;
  _lastAutoTimeline = null;
  buildVolPanel();
  rebuildAll();
}

function isLeaseModel() {
  const profile = ASSET_PROFILES[P.projectType];
  return profile && profile.revenueModel === 'lease-noi';
}

function getAssetProfile() {
  return ASSET_PROFILES[P.projectType] || ASSET_PROFILES.midrise;
}

// ─── System Prompt Builders ───────────────────────────────

// JSON response schemas (shared across all asset types)
const _AI_SCHEMAS = {
  zoning: `{"compliance_status":"compliant|minor_variance_needed|rezoning_needed","confidence":0.0-1.0,"summary":"string","permitted_envelope":{"max_fsi":null,"max_height_m":null,"max_storeys":null,"notes":"string"},"issues":[{"severity":"critical|moderate|minor","parameter":"string","proposed_value":"string","permitted_value":"string","bylaw_reference":"string","resolution_path":"string"}],"actionable_suggestions":[{"field":"vol.LETTER.storeys|vol.LETTER.width|vol.LETTER.depth|vol.LETTER.podiumStoreys|vol.LETTER.stepbackAmt|set.front|set.rear|set.sideE|set.sideW","current_value":0,"suggested_value":0,"label":"short label","rationale":"why this change achieves compliance","impact":"zoning impact"}],"opportunities":["string"],"recommendations":["string"],"data_sources_used":["string"]}`,
  proforma: `{"confidence":0.0-1.0,"assessment":{"overall":"strong|viable|marginal|not_viable","summary":"string","margin_assessment":"string","risk_level":"low|moderate|high"},"unit_mix_recommendations":[{"current":"string","recommended":"string","rationale":"string","revenue_impact_estimate":"string"}],"cost_flags":[{"line_item":"string","current_value":"string","market_range":"string","risk":"string"}],"benchmarks":{"cost_per_sf":{"project":0,"market_low":0,"market_high":0},"revenue_per_sf":{"project":0,"market_low":0,"market_high":0},"margin_pct":{"project":0,"market_low":0,"market_high":0}},"top_sensitivities":[{"input":"string","current_value":"string","impact":"string"}],"actionable_suggestions":[{"field":"hardCostPSF|softCostPct|dcPerUnit|dcCommPerSF|s37PerUnit|parkland|parkPrice|lockerPrice|parkRatio|lockerRatio|landPrice|ltc|intRate|loanFeePct|dcf.preSalesPct|dcf.preSalesDeposit|dcf.absorptionMonths|dcf.constructionRate|dcf.equityPct|units.TYPE.count|units.TYPE.psf|units.TYPE.size|comm.INDEX.rent|comm.INDEX.cap|vol.LETTER.storeys|vol.LETTER.width|vol.LETTER.depth|vol.LETTER.podiumStoreys|vol.LETTER.stepbackAmt|vol.LETTER.commGF|set.front|set.rear|set.sideE|set.sideW","current_value":0,"suggested_value":0,"label":"short human-readable label","rationale":"why this change helps","impact":"estimated $ or % impact"}],"recommendations":["string"],"data_sources_used":["string"]}`,
  risk: `{"confidence":0.0-1.0,"summary":"string","risk_rating":"low|moderate|elevated|high","scenario_analysis":{"best_case":{"description":"string","margin":"string","probability":"string"},"base_case":{"description":"string","margin":"string","probability":"string"},"worst_case":{"description":"string","margin":"string","probability":"string"}},"break_even_thresholds":[{"input":"string","current":"string","break_even":"string","headroom":"string"}],"stress_tests":[{"scenario":"string","assumptions":"string","outcome":"string","severity":"manageable|concerning|critical"}],"mitigation_strategies":[{"strategy":"string","impact":"string","implementation":"string"}],"data_sources_used":["string"]}`,
  comps: `{"confidence":0.0-1.0,"summary":"string","competitive_position":"under-supplied|balanced|competitive|over-supplied","pricing_assessment":{"subject_psf":0,"comp_range_psf":{"low":0,"high":0,"median":0},"assessment":"aggressive|market|conservative","recommendation":"string"},"absorption_analysis":{"pipeline_units_1km":null,"estimated_annual_absorption":null,"months_of_inventory":null,"risk":"low|moderate|high","commentary":"string"},"differentiation_opportunities":[{"strategy":"string","rationale":"string","comparable_gap":"string"}],"timing_recommendation":{"optimal_launch":"string","rationale":"string"},"data_sources_used":["string"]}`,
  report: `{"executive_summary":"string (HTML using <p>,<strong>,<em>)","market_context":"string (HTML)","development_rationale":"string (HTML)","risk_factors":"string (HTML numbered list)","recommendations":"string (HTML numbered list)","confidence":0.0-1.0,"data_sources_used":["string"]}`,
};

/**
 * Constructs the system prompt for a given AI endpoint, including jurisdiction context and role.
 * @param {string} endpoint - Analysis type
 * @returns {string} System prompt for the Claude API
 */
function buildSystemPrompt(endpoint) {
  const jur = resolveJurisdiction();
  const bench = ASSET_BENCHMARKS[P.projectType] || ASSET_BENCHMARKS.midrise;

  const prompts = {
    'zoning-analysis': `${jur.name} zoning & land use strategist advising a private developer. Asset: ${bench.label} (${bench.structureType}). ${jur.zoningBylaw}. ${bench.zoningContext}

YOU THINK LIKE A DEVELOPER, NOT A PLANNER. Your analysis must include TWO scenarios:
1. AS-OF-RIGHT: What the by-law currently permits. Use REAL setbacks from the by-law for this zone (front 0-4.5m, sides 5.5m or half height, rear 7.5m, etc.). Don't invent generic setbacks — cite the actual by-law standard for the zone.
2. ZBLA/REZONING: What a developer should PUSH FOR through a Zoning By-law Amendment and Site Plan Application. In Ontario, ZBLA applications almost ALWAYS seek greater FSI than as-of-right (typically 1.5-3x the permitted FSI). Developers test the political ceiling — what the neighbourhood, councillor, and OMB/OLT precedent will support. Consider: nearby approvals, Official Plan density targets, MTSA/PMTSA designations, transit proximity, and planning policy direction.

Your "actionable_suggestions" should reflect the DEVELOPER-OPTIMAL scenario — maximize GFA/units within what is politically achievable through a ZBLA, not just as-of-right. Include realistic setback values from the by-law (not made-up numbers). If the current massing EXCEEDS what's achievable even through ZBLA, suggest reductions. If it's UNDER what a ZBLA could achieve, suggest INCREASING density.

Use field paths: "vol.LETTER.storeys|width|depth|podiumStoreys|stepbackAmt|commGF" for building changes, "set.front|rear|sideE|sideW" for setbacks (in feet, convert from metres: 1m = 3.28ft). Respond ONLY with JSON:
${_AI_SCHEMAS.zoning}`,

    'proforma-optimize': `${jur.name} development finance analyst advising a private developer. Asset: ${bench.label}. ${jur.dcContext}
Costs: ${bench.costBenchmarks}
Revenue: ${bench.revBenchmarks}

YOU THINK LIKE A DEVELOPER. Your goal is to maximize project viability while being market-realistic.
Key developer reasoning:
- DCs are a MAJOR cost driver ($30-65K/unit). If the project margin is thin, consider whether reducing 3-bedroom units (higher DC rate) and increasing studios/1-beds improves viability.
- Unit mix should reflect MARKET DEMAND, not equal distribution. Toronto midrise: ~40% 1-bed, ~25% 1-bed+den, ~20% 2-bed, ~10% studio, ~5% 3-bed. Adjust for neighbourhood demographics.
- ZBLA projects can push FSI 1.5-3x above as-of-right. If the building is small relative to the lot/zone, suggest INCREASING storeys/width to maximize revenue against fixed land cost.
- Land cost per buildable SF is the key efficiency metric. More GFA on same land = better margin.
- Hard costs vary by height: $300-350/sf for 5-8 storeys, $350-400 for 9-12, $400-500+ for 13+. Suggest realistic rates for the building height.
- Soft cost % should EXCLUDE DCs (DCs are separate line items in this model). Typical soft cost is 18-25% of hard (A&E, PM, legal, insurance, permits, contingency).
- Construction financing: 60-70% LTC is standard. Higher leverage = higher return on equity but more risk.

ACTIONABLE SUGGESTIONS: Provide 3-10 specific numeric changes ranked by margin impact.
Field paths: "units.TYPE.PROP" for unit mix, "comm.INDEX.rent/cap" for commercial, "dcf.PROP" for DCF, direct fields for costs.
BUILDING SHAPE: Use "vol.LETTER.PROP" (storeys|width|depth|podiumStoreys|stepbackAmt|commGF) to reshape the 3D building. Changing storeys/width/depth automatically recalculates GFA → units → revenue. Use "set.front|rear|sideE|sideW" for setbacks (in feet).
If the building is UNDERSIZED for the zone, suggest increasing density. If OVERSIZED, suggest scaling back to what's approvable.
CRITICAL: Use ONLY exact numbers from the provided data — never invent figures. Respond ONLY with JSON:
${_AI_SCHEMAS.proforma}`,

    'risk-assessment': `${jur.province} dev risk analyst. Asset: ${bench.label}. Structure: ${bench.structureType}.
${bench.costBenchmarks}
Interpret Monte Carlo/DCF results. Consider asset-specific risks. CRITICAL: Use ONLY exact numbers from data — never invent figures. Respond ONLY with JSON:
${_AI_SCHEMAS.risk}`,

    'comparable-insights': `${jur.name} market analyst. Asset: ${bench.label}.
${bench.revBenchmarks}
Analyze competitive positioning for this ${bench.label} project. Consider asset-specific factors. Respond ONLY with JSON:
${_AI_SCHEMAS.comps}`,

    'report-narrative': `Senior dev consultant, ${jur.name}. Asset: ${bench.label}. Structure: ${bench.structureType}.
${bench.costBenchmarks} ${bench.revBenchmarks}
Write professional feasibility report. Data-driven, Canadian English. CRITICAL: Use ONLY exact numbers from data — never invent or estimate. If a number is not in data, say "not available". Respond ONLY with JSON:
${_AI_SCHEMAS.report}`
  };

  return prompts[endpoint] || 'You are a helpful real estate development analyst. Respond in JSON.';
}

/** Truncate a JSON string to stay within token budgets */
function compactJSON(obj, maxChars) {
  const full = JSON.stringify(obj || {});
  if (full.length <= maxChars) return full;
  return full.slice(0, maxChars) + '...(truncated)';
}

// ─── User Message Builders ────────────────────────────────

/**
 * Build a curated financial summary from pfCalc() results.
 * This avoids compactJSON truncation by selecting only the key numbers the AI needs.
 */
function buildFinancialSummary(calc) {
  if (!calc) return 'No financial data available.';
  const c = calc;
  const pf = P.pf;
  const unitLines = (c.unitMix||[]).map(u => `  ${u.type}: ${u.count} units × ${u.size}sf @ $${u.psf}/sf = $${Math.round(u.revenue).toLocaleString()}`).join('\n');
  const commLines = (c.commTenants||[]).map(t => `  ${t.label}: ${Math.round(t.area).toLocaleString()}sf @ $${t.rent}/sf NNN, cap ${((t.cap||0)*100).toFixed(1)}%, value $${Math.round(t.value).toLocaleString()}`).join('\n');

  return `AREA & DENSITY:
  Total GFA: ${Math.round(c.totalGFA).toLocaleString()} sf
  Commercial GFA: ${Math.round(c.commGFA).toLocaleString()} sf
  Net Leasable Commercial: ${Math.round(c.netLeasableComm).toLocaleString()} sf
  Residential GFA: ${Math.round(c.resiGFA).toLocaleString()} sf
  Net Sellable Residential: ${Math.round(c.sellableResiSF||c.netResiSF||0).toLocaleString()} sf
  Site Area: ${Math.round(c.siteArea).toLocaleString()} sf
  FSI: ${c.fsi.toFixed(2)}x
  Total Units: ${c.totalUnits}

UNIT MIX:
${unitLines}
  Residential Revenue: $${Math.round(c.resiRevenue).toLocaleString()}

COMMERCIAL:
${commLines}
  Total Commercial Value: $${Math.round(c.totalCommValue).toLocaleString()}

ANCILLARY:
  Parking: ${c.parkSpaces} stalls @ $${(pf.parkPrice||0).toLocaleString()}/ea = $${Math.round(c.parkRev).toLocaleString()}
  Lockers: ${c.lockers} @ $${(pf.lockerPrice||0).toLocaleString()}/ea = $${Math.round(c.lockerRev).toLocaleString()}

TOTAL GROSS REVENUE: $${Math.round(c.totalGrossRev).toLocaleString()}

COSTS:
  Land (incl LTT + DD): $${Math.round(c.totalLand).toLocaleString()}
  Hard Construction: $${Math.round(c.totalHard).toLocaleString()} ($${Math.round(c.totalHard/(c.totalGFA||1))}/sf)
  Soft Costs (${((c.softCostPct||0)*100).toFixed(1)}% of hard): $${Math.round(c.softCostBase||c.totalSoft).toLocaleString()}
  DC — Residential: $${(pf.dcPerUnit||0).toLocaleString()}/unit × ${c.totalUnits} = $${Math.round(c.dcResi||0).toLocaleString()}
  DC — Commercial: $${(pf.dcCommPerSF||0)}/sf × ${Math.round(c.commGFA||0).toLocaleString()}sf = $${Math.round(c.dcComm||0).toLocaleString()}
  Total DCs: $${Math.round(c.dcTotal||0).toLocaleString()}
  CBC / S37: $${(pf.s37PerUnit||0).toLocaleString()}/unit = $${Math.round(c.s37Total||0).toLocaleString()}
  Parkland Dedication: $${Math.round(c.parklandCost||pf.parkland||0).toLocaleString()}
  Total Soft & DCs: $${Math.round(c.totalSoft).toLocaleString()}
  Financing: $${Math.round(c.totalFinancing).toLocaleString()}
  TOTAL COST: $${Math.round(c.totalCost).toLocaleString()}

RETURNS:
  Developer Margin: $${Math.round(c.margin).toLocaleString()}
  Profit Margin: ${(c.marginOnCost*100).toFixed(1)}%
  Margin on Revenue: ${(c.marginOnRev*100).toFixed(1)}%

TIMELINE:
  Construction: ${c.totalConstructionMonths||'?'} months
  Absorption: ${c.absorptionMonths||'?'} months
  Total Project: ${c.totalProjectMonths||'?'} months`;
}

/**
 * Build a curated DCF summary from calcDCF() results.
 */
function buildDCFSummary(dcfResult) {
  if (!dcfResult) return 'No DCF data.';
  const d = dcfResult;
  const phaseLines = (d.timeline||[]).map(p => `  ${p.label}: ${p.months}mo (M${p.startMonth}-M${p.endMonth})`).join('\n');
  return `DCF SUMMARY:
  IRR: ${d.irr!=null?(d.irr*100).toFixed(1)+'%':'N/A'}
  NPV @ ${((P.pf.dcf?.discountRate||0.08)*100).toFixed(0)}%: $${d.npv!=null?Math.round(d.npv).toLocaleString():'N/A'}
  Equity Multiple: ${d.equityMultiple!=null?d.equityMultiple.toFixed(2)+'x':'N/A'}
  Peak Equity: $${d.peakEquity!=null?Math.round(Math.abs(d.peakEquity)).toLocaleString():'N/A'}
  Total Duration: ${d.totalMonths||'?'} months
  Requires ZBLA: ${P._requiresZBLA?'Yes':'No'}
PHASES:
${phaseLines}`;
}

function buildUserMessage(endpoint) {
  let calc = null;
  try { calc = pfData(); } catch(e) {}
  let dcf = null;
  try { dcf = calcDCF(calc); } catch(e) {}
  let mc = null;
  try { if (calc) mc = runMonteCarlo(calc, 1000); } catch(e) {}

  const assetType = ASSET_BENCHMARKS[P.projectType] || ASSET_BENCHMARKS.midrise;
  const assetHeader = `ASSET_TYPE:${assetType.label}\n`;
  const site = P.siteAddress || 'Not specified';
  const coords = P.siteCoords ? `${P.siteCoords.lat}, ${P.siteCoords.lng}` : 'N/A';
  const volSummary = P.vols.map((v,i) => `Vol ${v.name||i}: ${v.storeys}st, ${v.width||0}'W×${v.depth||0}'D, podium=${v.podiumStoreys||0}fl, stepback=${v.stepbackAmt||0}ft, commGF=${v.commGF?1:0}, offE=${v.offEast||0}ft, startEg=${v.startEg||0}ft`).join('\n');
  const setbackSummary = `Setbacks: front=${P.set?.front||0}ft, rear=${P.set?.rear||0}ft, sideE=${P.set?.sideE||0}ft, sideW=${P.set?.sideW||0}ft`;
  const lotSummary = `Lot: front=${P.lot?.front||0}ft, rear=${P.lot?.rear||0}ft, depth~${P.lot?.upperRight||0}ft`;
  const finSummary = buildFinancialSummary(calc);
  const dcfSummary = buildDCFSummary(dcf);

  switch(endpoint) {
    case 'zoning-analysis': {
      const gfa = calc ? Math.round(calc.totalGFA).toLocaleString() : '?';
      const fsi = calc ? calc.fsi.toFixed(2) : '?';
      const units = calc ? calc.totalUnits : '?';
      return `${assetHeader}SITE:${site}\nCOORDS:${coords}\nZONING:${compactJSON(P.zoning,400)}\n${lotSummary}\n${setbackSummary}\nFLOORS:GF=${P.flr?.gf||'?'}ft,Typ=${P.flr?.typ||'?'}ft\nCURRENT MASSING:\n${volSummary}\nGFA:${gfa}sf, FSI:${fsi}x, Units:${units}`;
    }

    case 'proforma-optimize':
      return `${assetHeader}SITE:${site}\nZONE:${P.zoning?.zone||'N/A'} FSI limit:${P.zoning?.fsiLimit||'N/A'} Height limit:${P.zoning?.heightLimit||'N/A'}m\n${lotSummary}\n${setbackSummary}\nVOLS:\n${volSummary}\n\n${finSummary}`;

    case 'risk-assessment': {
      let msg = `${assetHeader}SITE:${site}\n\n${finSummary}\n\n${dcfSummary}`;
      if (mc && mc.stats) msg += `\nMONTE CARLO (1000 runs):\n  P10 margin: ${(mc.stats.marginP10*100).toFixed(1)}%\n  P50 margin: ${(mc.stats.marginMedian*100).toFixed(1)}%\n  P90 margin: ${(mc.stats.marginP90*100).toFixed(1)}%\n  Mean: ${(mc.stats.marginMean*100).toFixed(1)}%\n  Prob viable (>15%): ${(mc.stats.probViable*100).toFixed(0)}%`;
      if (mc && mc.tornado) msg += `\nTORNADO:${compactJSON(mc.tornado,400)}`;
      return msg;
    }

    case 'comparable-insights': {
      const avgPSF = P.pf?.units ? Math.round(P.pf.units.reduce((s,u)=>s+u.psf*u.count,0)/Math.max(1,P.pf.units.reduce((s,u)=>s+u.count,0))) : 0;
      return `${assetHeader}SUBJECT:${site}\nUnits:${calc?.totalUnits||'?'}, AvgPSF:$${avgPSF}, TotalGFA:${Math.round(calc?.totalGFA||0).toLocaleString()}sf\nMIX:${compactJSON(P.pf?.units,400)}\nVOLS:\n${volSummary}\nCOMPS(${(P.comparables||[]).length}):${compactJSON(P.comparables,800)}`;
    }

    case 'report-narrative':
      return `${assetHeader}PROJECT:${P.projectName||'Untitled'}\nSITE:${site}\nZONING: ${P.zoning?.zoneString||P.zoning?.zone||'N/A'}, Height limit: ${P.zoning?.heightLimit||'N/A'}m, FSI limit: ${P.zoning?.fsiLimit||'N/A'}x\nVOLS:\n${volSummary}\n\n${finSummary}\n\n${dcfSummary}\nCOMPS:${compactJSON(P.comparables,400)}`;

    default:
      return 'Analyze this project: ' + JSON.stringify(P);
  }
}

// ─── Claude API Call ─────────────────────────────────────
// Strategy: try direct Anthropic API first, fall back to local proxy (/api/claude)

async function callClaudeAPI(systemPrompt, userMessage) {
  var apiKey = getClaudeKey();
  console.log('[AI] callClaudeAPI — key length:', (apiKey||'').length, ', starts:', (apiKey||'').slice(0,6));
  if (!apiKey || apiKey.length < 10) {
    throw new Error('No API key found. Go to the AI tab, paste your key, and click SAVE.');
  }

  var cleanKey = sanitizeAPIKey(apiKey);
  console.log('[AI] Sanitized key — length:', cleanKey.length, ', starts:', cleanKey.slice(0,10), ', ends:', cleanKey.slice(-4));
  if (cleanKey.length < 10) {
    clearClaudeKey();
    throw new Error('API key appears corrupted (only ' + cleanKey.length + ' chars after cleaning). Click CLEAR, then re-paste a fresh key from console.anthropic.com/settings/keys');
  }

  var payload = {
    model: 'claude-haiku-4-5',
    // Detailed pro-forma + zoning analyses can produce 4-6k token responses with all
    // suggestions, benchmarks, and rationale. 2048 was truncating responses mid-JSON,
    // breaking parsing. 8192 gives plenty of headroom for full structured analyses.
    max_tokens: 8192,
    temperature: 0.2,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userMessage },
    ],
  };

  var resp;
  var usedDirect = false;

  // --- Attempt 1: Direct Anthropic API (works without serve.js) ---
  try {
    console.log('[AI] Trying direct Anthropic API...');
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
    });
    usedDirect = true;
    console.log('[AI] Direct API responded:', resp.status);
  } catch (directErr) {
    console.warn('[AI] Direct API failed:', directErr.message, '— trying local proxy...');

    // --- Attempt 2: Local proxy (serve.js on localhost:3000) ---
    try {
      var proxyPayload = Object.assign({ apiKey: cleanKey }, payload);
      resp = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyPayload),
      });
      console.log('[AI] Proxy API responded:', resp.status);
    } catch (proxyErr) {
      console.error('[AI] Both direct and proxy failed.');
      throw new Error('Cannot reach Anthropic API.\n\n• Direct call: ' + directErr.message + '\n• Local proxy: ' + proxyErr.message + '\n\nCheck your internet connection.');
    }
  }

  if (!resp.ok) {
    var err = await resp.json().catch(function() { return {}; });
    var msg = (err.error && err.error.message) || ('API error ' + resp.status);
    console.error('[AI] API error — status:', resp.status, ', message:', msg, ', via:', usedDirect ? 'direct' : 'proxy');

    if (resp.status === 401) {
      throw new Error('Invalid API key (HTTP 401): ' + msg + '\n\nClick CLEAR, then re-paste your key from console.anthropic.com/settings/keys');
    }
    if (resp.status === 429) {
      throw new Error('Rate limited (HTTP 429): ' + msg + '\n\nPlease wait a moment and try again.');
    }
    if (resp.status === 529) {
      throw new Error('Anthropic API is temporarily overloaded. Please wait a moment and try again.');
    }
    throw new Error('API error ' + resp.status + ': ' + msg);
  }

  var data = await resp.json();
  var text = data.content && data.content[0] && data.content[0].text;
  if (!text) {
    console.error('[AI] Unexpected response structure:', JSON.stringify(data).slice(0, 500));
    throw new Error('No text in API response. The model may have refused or returned an empty result.');
  }
  console.log('[AI] Success via', usedDirect ? 'direct API' : 'proxy', '— response length:', text.length);
  return text;
}

// ─── Main Entry Point ─────────────────────────────────────

/**
 * Sends an AI analysis request to Claude API and renders the result.
 * @param {string} endpoint - Analysis type: 'zoning-analysis'|'proforma-optimize'|'risk-assessment'|'comparable-insights'|'report-narrative'
 */
function requestAI(endpoint) {
  var btn = document.getElementById('ai-btn-' + endpoint.split('-')[0]);
  var resultDiv = document.getElementById('ai-result-' + endpointToKey(endpoint));
  var inlineMap = {
    'zoning-analysis': 'ai-inline-zoning-result',
    'proforma-optimize': 'ai-inline-pf-result',
    'risk-assessment': 'ai-inline-pf-result',
  };
  var inlineDiv = document.getElementById(inlineMap[endpoint] || '');

  // Check for API key first
  var _apiKey = getClaudeKey();
  console.log('[AI] requestAI check — key exists:', !!_apiKey, ', length:', (_apiKey||'').length);
  if (!_apiKey || _apiKey.length < 10) {
    if (resultDiv) renderAIError('No API key set. Enter your Anthropic API key in the AI tab, then click SAVE.', resultDiv);
    if (inlineDiv) renderAIError('No API key set. Go to the AI tab to enter your key.', inlineDiv);
    return;
  }

  // Show loading state
  if (btn) {
    btn.disabled = true;
    btn._origText = btn.textContent;
    btn.textContent = '⏳ ANALYZING...';
    btn.style.opacity = '0.6';
  }
  const loadingHTML = '<div style="color:var(--accent,#AEBC46);font-size:14px;padding:20px;text-align:center;font-family:var(--font-body,\'DM Sans\',sans-serif)"><span style="animation:pulse 1.5s infinite;display:inline-block;font-size:16px">● </span> AI is analyzing your project data...</div>';
  if (resultDiv) resultDiv.innerHTML = loadingHTML;
  if (inlineDiv) inlineDiv.innerHTML = loadingHTML;

  // Build prompts and call API directly
  const systemPrompt = buildSystemPrompt(endpoint);
  const userMessage = buildUserMessage(endpoint);

  // Auto-retry with delay if rate limited
  var callWithRetry = function(attempt) { return callClaudeAPI(systemPrompt, userMessage).catch(function(err) {
    if (attempt < 2 && err.message && err.message.includes('429')) {
      var waitSec = 30 + attempt * 15;
      var retryHTML = '<div style="color:#e8c87a;font-size:14px;padding:20px;text-align:center;font-family:var(--font-body,\'DM Sans\',sans-serif)"><span style="animation:pulse 1.5s infinite;display:inline-block;font-size:16px">● </span> Rate limited — auto-retrying in ' + waitSec + 's...</div>';
      if (resultDiv) resultDiv.innerHTML = retryHTML;
      if (inlineDiv) inlineDiv.innerHTML = retryHTML;
      return new Promise(function(resolve) { setTimeout(resolve, waitSec * 1000); }).then(function() { return callWithRetry(attempt + 1); });
    }
    throw err;
  }); };

  callWithRetry(0).then(function(text) {
    let analysis;
    // Multi-pass JSON extraction — be aggressive so we almost never fall to raw
    function _tryParseJSON(str){
      try { return JSON.parse(str); } catch(e) { return null; }
    }
    var attempts = [
      // Pass 1: as-is
      function(){ return _tryParseJSON(text); },
      // Pass 2: strip surrounding markdown fences (```json ... ```)
      function(){
        var cleaned = text.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        return _tryParseJSON(cleaned);
      },
      // Pass 3: extract content between first ```json and last ```
      function(){
        var m = text.match(/```(?:json|JSON)?\s*([\s\S]*?)\s*```/);
        return m ? _tryParseJSON(m[1]) : null;
      },
      // Pass 4: extract from first { to last } (greedy)
      function(){
        var m = text.match(/\{[\s\S]*\}/);
        return m ? _tryParseJSON(m[0]) : null;
      },
      // Pass 5: Strip trailing commas (common LLM mistake) and try again
      function(){
        var m = text.match(/\{[\s\S]*\}/);
        if(!m) return null;
        var fixed = m[0].replace(/,(\s*[}\]])/g, '$1');
        return _tryParseJSON(fixed);
      }
    ];
    for(var i = 0; i < attempts.length; i++){
      analysis = attempts[i]();
      if(analysis) break;
    }
    // Pass 6: Salvage truncated JSON (response cut off by token limit)
    // Routes through the proper renderer (with APPLY buttons) instead of raw fallback.
    if(!analysis && typeof _salvageTruncatedJson === 'function'){
      var cleaned = text.trim().replace(/^```(?:json|JSON)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
      var salvaged = _salvageTruncatedJson(cleaned);
      if(salvaged){
        analysis = salvaged;
        analysis._truncated = true; // proper renderer will show a warning banner
      }
    }
    if(!analysis) analysis = { raw: text };

    renderAIResult(endpoint, analysis, resultDiv);
    if (inlineDiv && inlineDiv !== resultDiv) renderAIResult(endpoint, analysis, inlineDiv);

    // Store AI results AND auto-refresh the report so AI findings are immediately
    // available there. Each AI tool gets its own logical section in the report
    // (zoning → zoning section, proforma → financials, etc).
    if (analysis && !analysis.raw) {
      if (endpoint === 'zoning-analysis')      P._aiZoning     = analysis;
      if (endpoint === 'proforma-optimize')    P._aiProforma   = analysis;
      if (endpoint === 'risk-assessment')      P._aiRisk       = analysis;
      if (endpoint === 'comparable-insights')  P._aiComps      = analysis;
      if (endpoint === 'report-narrative')     P._aiNarratives = analysis;
      // Auto-refresh report to pick up the new AI findings
      try { if(typeof renderReport === 'function') renderReport(); } catch(e) {}
    }
  }).catch(err => {
    renderAIError(err.message, resultDiv);
    if (inlineDiv) renderAIError(err.message, inlineDiv);
  }).finally(() => {
    resetAIButton(btn);
  });
}

function endpointToKey(endpoint) {
  return {'zoning-analysis':'zoning','proforma-optimize':'proforma','risk-assessment':'risk','comparable-insights':'comps','report-narrative':'report'}[endpoint] || endpoint;
}

function resetAIButton(btn) {
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = btn._origText || 'ANALYZE';
  btn.style.opacity = '1';
}

// ─── AI Result Rendering ──────────────────────────────────

function renderAIError(message, container) {
  if (!container) return;
  // Format message: replace \n with <br> for multi-line error messages
  const formatted = escapeHtml(message).replace(/\n/g, '<br>');
  container.innerHTML = `
    <div style="background:rgba(224,85,85,0.08);border:1px solid rgba(224,85,85,0.3);border-radius:8px;padding:16px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">
      <div style="color:#e05555;font-size:13px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:6px"><span style="font-size:16px">⚠</span> AI ERROR</div>
      <div style="color:#e07b6a;font-size:13px;line-height:1.7">${formatted}</div>
    </div>`;
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Format a raw AI response string (typically JSON-with-markdown-fences) into a readable
 * structured display. Strips markdown fences, attempts JSON pretty-print with key/value
 * coloring, falls back to clean prose display if JSON can't be salvaged.
 */
function _renderRawFallback(raw){
  // Strip markdown code fences and surrounding whitespace
  var cleaned = String(raw).trim()
    .replace(/^```(?:json|JSON)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();

  // Attempt one more JSON parse on the cleaned text so we can render it nicely
  var parsed = null;
  try { parsed = JSON.parse(cleaned); } catch(e) {}
  if(!parsed){
    try {
      var m = cleaned.match(/\{[\s\S]*\}/);
      if(m) parsed = JSON.parse(m[0].replace(/,(\s*[}\]])/g, '$1'));
    } catch(e) {}
  }
  // Try to salvage TRUNCATED JSON by closing unbalanced braces/brackets/quotes
  if(!parsed){
    parsed = _salvageTruncatedJson(cleaned);
  }

  var inner;
  var truncationWarning = '';
  if(parsed && typeof parsed === 'object'){
    if(parsed._truncated){
      delete parsed._truncated;
      truncationWarning = '<div style="background:rgba(232,200,122,0.1);border:1px solid rgba(232,200,122,0.3);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#e8c87a"><strong>⚠ Response was truncated</strong> — showing partial analysis. The AI hit its output limit; some recommendations may be cut off. Try the analysis again if the report looks incomplete.</div>';
    }
    // We salvaged the JSON — render it as a labeled key/value tree
    inner = _renderJsonTree(parsed, 0);
  } else {
    // Pure prose / unstructured response — present as readable text with paragraph breaks
    // Split on double newlines OR sentence boundaries followed by capital letters for readability
    var prose = cleaned;
    if(prose.indexOf('\n\n') === -1){
      // No paragraph breaks — synthesize them every 2-3 sentences
      prose = prose.replace(/(\.\s+)([A-Z])/g, function(m, p1, p2, idx){
        // Insert paragraph break every ~250 chars
        return idx > 0 && idx % 280 < 50 ? '.\n\n' + p2 : p1 + p2;
      });
    }
    var paragraphs = prose.split(/\n{2,}/).map(function(p){
      return '<p style="margin:0 0 14px 0;line-height:1.8;color:var(--text-secondary,#A0A0AA)">' + escapeHtml(p) + '</p>';
    }).join('');
    inner = paragraphs;
  }

  return '<div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;font-size:14px;color:var(--text-secondary,#A0A0AA);font-family:var(--font-body,\'DM Sans\',sans-serif)">' +
         '<div style="font-size:11px;color:var(--text-tertiary,#6B6B78);letter-spacing:1.5px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border-subtle,#2A2A30)">AI ANALYSIS</div>' +
         truncationWarning +
         inner +
         '</div>';
}

/**
 * Best-effort recovery of truncated JSON from an LLM that hit token limit mid-response.
 * Walks through the string, tracks open/close braces, brackets, quotes, and closes them
 * to produce parseable JSON. Marks the result with _truncated:true so the caller can warn.
 */
function _salvageTruncatedJson(str){
  var s = str.trim();
  // Find the first { to start parsing
  var start = s.indexOf('{');
  if(start < 0) return null;
  s = s.slice(start);
  // Walk character by character tracking state
  var inString = false, escape = false;
  var stack = []; // stack of open delimiters: { or [
  var lastValidEnd = -1; // index of last position where JSON was syntactically complete
  for(var i = 0; i < s.length; i++){
    var ch = s[i];
    if(escape){ escape = false; continue; }
    if(inString){
      if(ch === '\\') escape = true;
      else if(ch === '"') inString = false;
      continue;
    }
    if(ch === '"'){ inString = true; continue; }
    if(ch === '{' || ch === '['){ stack.push(ch); continue; }
    if(ch === '}' || ch === ']'){
      stack.pop();
      if(stack.length === 0) lastValidEnd = i;
    }
  }
  // Try the last syntactically-balanced position first
  if(lastValidEnd > 0){
    try {
      var balanced = s.slice(0, lastValidEnd + 1);
      var p = JSON.parse(balanced);
      return p;
    } catch(e) {}
  }
  // Otherwise, attempt to repair: close any open string, then close stack in reverse
  var repaired = s;
  if(inString) repaired += '"';
  // Trim any trailing partial token (e.g. ', "key": "value mid-string)
  // Remove trailing commas, partial keys
  repaired = repaired.replace(/,\s*"[^"]*$/, '').replace(/,\s*$/, '');
  // Close stack: reverse and convert { → }, [ → ]
  for(var j = stack.length - 1; j >= 0; j--){
    repaired += stack[j] === '{' ? '}' : ']';
  }
  try {
    var parsed = JSON.parse(repaired);
    parsed._truncated = true;
    return parsed;
  } catch(e) {
    return null;
  }
}

/**
 * Recursively render a parsed JSON object as a labeled hierarchy.
 * Top-level keys become section headers; primitive values shown inline; arrays/objects nested.
 */
function _renderJsonTree(obj, depth){
  if(obj === null || obj === undefined) return '<span style="color:var(--text-muted,#50505A)">—</span>';
  if(typeof obj === 'string'){
    return '<span style="color:var(--text-primary,#E8E8EC)">' + escapeHtml(obj) + '</span>';
  }
  if(typeof obj === 'number' || typeof obj === 'boolean'){
    return '<span style="color:#4aae8a;font-weight:600">' + escapeHtml(String(obj)) + '</span>';
  }
  if(Array.isArray(obj)){
    if(obj.length === 0) return '<span style="color:var(--text-muted,#50505A)">[empty]</span>';
    return '<div style="margin:6px 0">' + obj.map(function(item, i){
      return '<div style="padding:8px 12px;margin-bottom:6px;background:var(--bg-elevated,#222228);border-radius:6px;border-left:3px solid var(--border-strong,#444450)">' +
             '<div style="font-size:11px;color:var(--text-tertiary,#6B6B78);margin-bottom:4px">#' + (i + 1) + '</div>' +
             _renderJsonTree(item, depth + 1) +
             '</div>';
    }).join('') + '</div>';
  }
  // Object: render keys as labeled rows
  var keys = Object.keys(obj);
  if(keys.length === 0) return '<span style="color:var(--text-muted,#50505A)">{empty}</span>';
  return keys.map(function(k){
    var label = String(k).replace(/_/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); });
    var v = obj[k];
    var isPrimitive = (v === null || typeof v !== 'object');
    if(depth === 0){
      // Top-level keys → section headers
      return '<div style="margin-bottom:18px">' +
             '<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid var(--border-subtle,#2A2A30)">' + escapeHtml(label.toUpperCase()) + '</div>' +
             '<div style="font-size:14px;line-height:1.8">' + _renderJsonTree(v, depth + 1) + '</div>' +
             '</div>';
    }
    if(isPrimitive){
      return '<div style="display:flex;gap:10px;padding:4px 0;font-size:13px;line-height:1.6"><span style="color:var(--text-tertiary,#6B6B78);min-width:140px">' + escapeHtml(label) + ':</span><span style="flex:1">' + _renderJsonTree(v, depth + 1) + '</span></div>';
    }
    return '<div style="margin:8px 0">' +
           '<div style="font-size:12px;color:var(--text-tertiary,#6B6B78);font-weight:600;margin-bottom:4px">' + escapeHtml(label) + '</div>' +
           '<div style="padding-left:12px;border-left:2px solid var(--border-subtle,#2A2A30)">' + _renderJsonTree(v, depth + 1) + '</div>' +
           '</div>';
  }).join('');
}

/**
 * Render AI analysis result — dispatches to type-specific renderers.
 */
/**
 * Routes an AI response to the appropriate renderer based on endpoint type.
 * @param {string} endpoint - Analysis type
 * @param {Object} data - Parsed JSON response from Claude
 * @param {HTMLElement} container - DOM element to render into
 */
function renderAIResult(endpoint, data, container) {
  if (!container || !data) return;

  // Store for later use (e.g., applying report narratives)
  container._aiData = data;

  // If raw text (JSON parse failed completely), present it as readable formatted prose
  // rather than dumping the JSON-like text. Strip markdown fences, format key/value pairs
  // as labeled rows, indent nested structures for clarity.
  if (data.raw) {
    container.innerHTML = _renderRawFallback(data.raw);
    return;
  }

  switch(endpoint) {
    case 'zoning-analysis': renderZoningResult(data, container); break;
    case 'proforma-optimize': renderProformaResult(data, container); break;
    case 'risk-assessment': renderRiskResult(data, container); break;
    case 'comparable-insights': renderCompsResult(data, container); break;
    case 'report-narrative': renderReportResult(data, container); break;
    default: container.innerHTML = `<pre style="font-size:13px;color:#aaa;overflow:auto">${escapeHtml(JSON.stringify(data,null,2))}</pre>`;
  }
}

/** ── Zoning Analysis Renderer ── */
function renderZoningResult(d, el) {
  const statusColor = d.compliance_status === 'compliant' ? '#4aae8a' :
                      d.compliance_status === 'minor_variance_needed' ? '#e8c87a' : '#e05555';
  const statusBg = d.compliance_status === 'compliant' ? 'rgba(74,174,138,0.1)' :
                   d.compliance_status === 'minor_variance_needed' ? 'rgba(232,200,122,0.1)' : 'rgba(224,85,85,0.1)';
  const statusLabel = (d.compliance_status || 'unknown').replace(/_/g, ' ').toUpperCase();

  let html = `
    <div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border-subtle,#2A2A30)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:${statusColor}"></div>
          <div style="font-size:16px;font-weight:700;color:${statusColor};letter-spacing:0.5px">${statusLabel}</div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);background:var(--bg-elevated,#222228);padding:4px 10px;border-radius:20px">Confidence: ${Math.round((d.confidence||0)*100)}%</div>
      </div>
      <div style="font-size:14px;color:var(--text-secondary,#A0A0AA);line-height:1.8;margin-bottom:18px">${escapeHtml(d.summary||'')}</div>`;

  // Issues
  if (d.issues && d.issues.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px;margin-top:16px">COMPLIANCE ISSUES</div>`;
    d.issues.forEach(issue => {
      const ic = issue.severity === 'critical' ? '#e05555' : issue.severity === 'moderate' ? '#e8c87a' : '#6B6B78';
      const ibg = issue.severity === 'critical' ? 'rgba(224,85,85,0.06)' : issue.severity === 'moderate' ? 'rgba(232,200,122,0.06)' : 'rgba(107,107,120,0.06)';
      html += `<div style="border-left:3px solid ${ic};padding:12px 16px;margin-bottom:10px;background:${ibg};border-radius:0 8px 8px 0">
        <div style="font-size:14px;font-weight:600;color:${ic};margin-bottom:6px">${escapeHtml(issue.parameter)} — ${escapeHtml(issue.severity).toUpperCase()}</div>
        <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:4px">Proposed: <strong style="color:var(--text-primary,#E8E8EC)">${escapeHtml(issue.proposed_value||'N/A')}</strong> · Permitted: <strong style="color:var(--text-primary,#E8E8EC)">${escapeHtml(issue.permitted_value||'N/A')}</strong></div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);margin-top:4px">By-law: ${escapeHtml(issue.bylaw_reference||'N/A')}</div>
        <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.05)">→ ${escapeHtml(issue.resolution_path||'')}</div>
      </div>`;
    });
  }

  // ── ACTIONABLE SUGGESTIONS (reshape building for compliance) ──
  if (d.actionable_suggestions && d.actionable_suggestions.length) {
    _aiSuggestions = d.actionable_suggestions.map(s => Object.assign({}, s, {_applied: false}));
    html += `<div style="border-top:2px solid var(--accent,#AEBC46);margin:20px 0 12px;padding-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px">⚡ FIX COMPLIANCE</div>
        <button id="ai-apply-all" onclick="applyAllAISuggestions()" style="background:var(--accent,#AEBC46);color:#111;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.5px;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">⚡ APPLY ALL (${_aiSuggestions.length})</button>
      </div>`;
    _aiSuggestions.forEach((s, i) => {
      const fieldLabel = _friendlyFieldName(s.field);
      const curFmt = _formatSuggestionValue(s.field, s.current_value);
      const newFmt = _formatSuggestionValue(s.field, s.suggested_value);
      html += `<div style="display:flex;align-items:stretch;gap:0;margin-bottom:8px;background:var(--bg-elevated,#222228);border-radius:8px;border-left:3px solid var(--accent,#AEBC46);overflow:hidden">
        <div style="flex:1;padding:14px 16px">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary,#E8E8EC);margin-bottom:4px">${escapeHtml(s.label || fieldLabel)}</div>
          <div style="font-size:13px;color:var(--text-tertiary,#6B6B78)">${escapeHtml(fieldLabel)}: <span style="color:#e05555;text-decoration:line-through">${escapeHtml(curFmt)}</span> → <span style="color:#4aae8a;font-weight:700">${escapeHtml(newFmt)}</span></div>
          <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px;line-height:1.6">${escapeHtml(s.rationale || '')}</div>
          ${s.impact ? '<div style="font-size:12px;color:#4aae8a;margin-top:4px">' + escapeHtml(s.impact) + '</div>' : ''}
        </div>
        <button id="ai-apply-${i}" onclick="applyAISuggestion(${i})" style="background:var(--accent,#AEBC46);color:#111;border:none;padding:0 20px;font-size:12px;font-weight:700;cursor:pointer;min-width:80px;letter-spacing:0.5px;flex-shrink:0;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">APPLY</button>
      </div>`;
    });
    html += `</div>`;
  }

  // Opportunities
  if (d.opportunities && d.opportunities.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin:18px 0 10px">OPPORTUNITIES</div>`;
    d.opportunities.forEach(o => {
      html += `<div style="font-size:13px;color:#4aae8a;padding:6px 0;line-height:1.6">✓ ${escapeHtml(o)}</div>`;
    });
  }

  // Recommendations
  if (d.recommendations && d.recommendations.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin:18px 0 10px">RECOMMENDATIONS</div>`;
    d.recommendations.forEach((r,i) => {
      html += `<div style="font-size:13px;color:var(--text-secondary,#A0A0AA);padding:6px 0;line-height:1.6">${i+1}. ${escapeHtml(r)}</div>`;
    });
  }

  html += `<div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:16px;border-top:1px solid var(--border-subtle,#2A2A30);padding-top:10px">Sources: ${(d.data_sources_used||[]).join(', ')}</div>`;
  html += `</div>`;
  el.innerHTML = html;
}

// ─── AI Suggestion Application Engine ────────────────────

/** Store the latest suggestions so buttons can reference them by index */
let _aiSuggestions = [];

/** Apply a single AI suggestion to the pro-forma model */
function applyAISuggestion(index) {
  const s = _aiSuggestions[index];
  if (!s || s._applied) return;

  const field = s.field;
  const val = parseFloat(s.suggested_value);
  if (isNaN(val)) { console.warn('[AI] Invalid suggested_value:', s.suggested_value); return; }

  console.log('[AI] Applying suggestion:', field, '=', val);

  // ── Direct P.pf fields ──
  const directFields = ['hardCostPSF','softCostPct','dcPerUnit','dcCommPerSF','s37PerUnit','parkland','parkPrice','lockerPrice','parkRatio','lockerRatio','landPrice','ltc','intRate','loanFeePct','lttRate','ddCost'];
  if (directFields.includes(field)) {
    P.pf[field] = val;
    s._applied = true;
    _onSuggestionApplied(index);
    return;
  }

  // ── DCF fields (dcf.discountRate, dcf.preSalesPct, etc.) ──
  if (field.startsWith('dcf.')) {
    const dcfProp = field.split('.')[1];
    if (!P.pf.dcf) P.pf.dcf = {};
    P.pf.dcf[dcfProp] = val;
    s._applied = true;
    _onSuggestionApplied(index);
    return;
  }

  // ── Unit fields (units.2-Bedroom.count, units.Studio.psf, etc.) ──
  if (field.startsWith('units.')) {
    const parts = field.match(/^units\.(.+)\.(count|psf|size)$/);
    if (parts) {
      const unitType = parts[1];
      const prop = parts[2];
      const unit = (P.pf.units || []).find(u => u.type === unitType);
      if (unit) {
        unit[prop] = prop === 'count' ? Math.round(val) : val;
        // Lock the unit count so auto-fill doesn't overwrite it
        if (prop === 'count') {
          if (!P.pf._locked) P.pf._locked = {};
          P.pf._locked[unitType] = true;
        }
        s._applied = true;
        _onSuggestionApplied(index);
      } else {
        console.warn('[AI] Unit type not found:', unitType);
      }
    }
    return;
  }

  // ── Commercial fields (comm.0.rent, comm.1.cap, etc.) ──
  if (field.startsWith('comm.')) {
    const parts = field.match(/^comm\.(\d+)\.(rent|cap|pct)$/);
    if (parts) {
      const idx = parseInt(parts[1]);
      const prop = parts[2];
      if (P.pf.comm && P.pf.comm[idx]) {
        P.pf.comm[idx][prop] = val;
        s._applied = true;
        _onSuggestionApplied(index);
      }
    }
    return;
  }

  // ── Volume fields (vol.A.storeys, vol.B.width, etc.) ──
  if (field.startsWith('vol.')) {
    const parts = field.match(/^vol\.([A-Z])\.(storeys|width|depth|podiumStoreys|stepbackAmt|commGF|offEast|offWest|startEg)$/);
    if (parts) {
      const letter = parts[1];
      const prop = parts[2];
      const vol = P.vols.find(v => v.name === letter);
      if (vol) {
        const intProps = ['storeys','podiumStoreys','commGF'];
        vol[prop] = intProps.includes(prop) ? Math.round(val) : val;
        // Ensure podiumStoreys < storeys
        if (prop === 'storeys' && vol.podiumStoreys >= vol.storeys) {
          vol.podiumStoreys = Math.max(0, vol.storeys - 2);
        }
        s._applied = true;
        s._rebuildsVolume = true; // flag for full 3D rebuild
        _onSuggestionApplied(index);
      } else {
        console.warn('[AI] Volume not found:', letter);
      }
    }
    return;
  }

  // ── Setback fields (set.front, set.rear, set.sideE, set.sideW) ──
  if (field.startsWith('set.')) {
    const prop = field.split('.')[1];
    if (['front','rear','sideE','sideW','stepback'].includes(prop)) {
      P.set[prop] = Math.max(0, val);
      s._applied = true;
      s._rebuildsVolume = true;
      _onSuggestionApplied(index);
    }
    return;
  }

  console.warn('[AI] Unknown suggestion field:', field);
}

/** Apply all unapplied suggestions at once */
function applyAllAISuggestions() {
  _aiSuggestions.forEach((s, i) => {
    if (!s._applied) applyAISuggestion(i);
  });
}

/** Post-apply: update the button UI and refresh pro-forma */
function _onSuggestionApplied(index) {
  // Update the button for this suggestion
  const btn = document.getElementById('ai-apply-' + index);
  if (btn) {
    btn.textContent = '✓ APPLIED';
    btn.style.background = '#2a4a2a';
    btn.style.color = '#4a8';
    btn.style.cursor = 'default';
    btn.disabled = true;
  }
  // Update the "Apply All" count
  const remaining = _aiSuggestions.filter(s => !s._applied).length;
  const allBtn = document.getElementById('ai-apply-all');
  if (allBtn) {
    if (remaining === 0) {
      allBtn.textContent = '✓ ALL APPLIED';
      allBtn.style.background = '#2a4a2a';
      allBtn.style.color = '#4a8';
      allBtn.disabled = true;
    } else {
      allBtn.textContent = '⚡ APPLY ALL (' + remaining + ')';
    }
  }
  // Refresh — full 3D rebuild if volume/setback changed, otherwise just proforma
  const needsRebuild = _aiSuggestions.some(s => s._applied && s._rebuildsVolume);
  if (needsRebuild) {
    // Volume or setback changed — rebuild 3D scene, vol panel, setback panel, everything
    try { buildVolPanel(); } catch(e) {}
    try { buildSetbackPanel(); } catch(e) {}
    rebuildAll();
  } else {
    pfChanged();
  }
}

/** Convert a field path to a human-readable label */
function _friendlyFieldName(field) {
  const map = {
    hardCostPSF: 'Hard Cost ($/sf)', softCostPct: 'Soft Cost (%)',
    dcPerUnit: 'DC — Residential ($/unit)', dcCommPerSF: 'DC — Commercial ($/sf)',
    s37PerUnit: 'CBC / S37 ($/unit)', parkland: 'Parkland Dedication',
    parkPrice: 'Parking ($/stall)', lockerPrice: 'Locker ($/unit)',
    parkRatio: 'Parking Ratio', lockerRatio: 'Locker Ratio',
    landPrice: 'Land Price', ltc: 'Loan-to-Cost', intRate: 'Interest Rate', loanFeePct: 'Loan Fee %',
    lttRate: 'Land Transfer Tax', ddCost: 'Due Diligence',
    'dcf.discountRate': 'Discount Rate', 'dcf.preSalesPct': 'Pre-Sales %',
    'dcf.preSalesDeposit': 'Pre-Sales Deposit %', 'dcf.absorptionMonths': 'Absorption (months)',
    'dcf.constructionRate': 'Construction Loan Rate', 'dcf.equityPct': 'Equity %',
    'set.front': 'Front Setback (ft)', 'set.rear': 'Rear Setback (ft)',
    'set.sideE': 'East Side Setback (ft)', 'set.sideW': 'West Side Setback (ft)',
  };
  if (map[field]) return map[field];
  // vol.A.storeys → "Building A — Storeys"
  const vMatch = field.match(/^vol\.([A-Z])\.(storeys|width|depth|podiumStoreys|stepbackAmt|commGF|offEast|startEg)$/);
  if (vMatch) {
    const propLabels = {storeys:'Storeys',width:'Width (ft)',depth:'Depth (ft)',podiumStoreys:'Podium Floors',stepbackAmt:'Tower Stepback (ft)',commGF:'Commercial GF',offEast:'East Offset (ft)',startEg:'Position (ft)'};
    return 'Building ' + vMatch[1] + ' — ' + (propLabels[vMatch[2]] || vMatch[2]);
  }
  // units.2-Bedroom.count → "2-Bedroom Count"
  const uMatch = field.match(/^units\.(.+)\.(count|psf|size)$/);
  if (uMatch) return uMatch[1] + ' ' + (uMatch[2] === 'psf' ? '$/sf' : uMatch[2] === 'count' ? 'Units' : 'Size (sf)');
  // comm.0.rent → "Commercial #1 Rent"
  const cMatch = field.match(/^comm\.(\d+)\.(rent|cap)$/);
  if (cMatch) {
    const tenant = P.pf?.comm?.[parseInt(cMatch[1])]?.label || ('Tenant #' + (parseInt(cMatch[1])+1));
    return tenant + ' ' + (cMatch[2] === 'rent' ? 'Rent ($/sf)' : 'Cap Rate');
  }
  return field;
}

/** Format a suggestion value for display based on field type */
function _formatSuggestionValue(field, val) {
  const v = parseFloat(val);
  if (isNaN(v)) return String(val);
  // Percentages
  if (['softCostPct','ltc','intRate','loanFeePct','lttRate','dcf.discountRate','dcf.preSalesPct','dcf.preSalesDeposit','dcf.constructionRate','dcf.equityPct'].includes(field)
      || (field.match && field.match(/\.cap$/))) {
    return (v < 1 ? (v * 100).toFixed(1) : v.toFixed(1)) + '%';
  }
  // Dollars
  if (['hardCostPSF','parkPrice','lockerPrice','landPrice','ddCost','dcPerUnit','dcCommPerSF','s37PerUnit','parkland'].includes(field)
      || (field.match && field.match(/\.(psf|rent)$/))) {
    return v >= 10000 ? '$' + Math.round(v).toLocaleString() : '$' + v.toLocaleString();
  }
  // Counts / months / ratios
  if (field.match && field.match(/\.count$/) || field === 'dcf.absorptionMonths') return Math.round(v).toString();
  if (field.match && field.match(/\.size$/)) return v.toLocaleString() + ' sf';
  if (['parkRatio','lockerRatio'].includes(field)) return v.toFixed(2);
  // Volume properties
  if (field.match && field.match(/\.storeys$/)) return Math.round(v) + ' storeys';
  if (field.match && field.match(/\.(width|depth|stepbackAmt|offEast|startEg)$/)) return Math.round(v) + ' ft';
  if (field.match && field.match(/\.podiumStoreys$/)) return Math.round(v) + ' floors';
  if (field.match && field.match(/\.commGF$/)) return v ? 'Yes' : 'No';
  // Setbacks
  if (field.startsWith('set.')) return Math.round(v) + ' ft';
  return v.toLocaleString();
}

/** ── Pro-Forma Optimization Renderer ── */
function renderProformaResult(d, el) {
  const aColor = d.assessment?.overall === 'strong' ? '#4aae8a' :
                 d.assessment?.overall === 'viable' ? '#AEBC46' :
                 d.assessment?.overall === 'marginal' ? '#e8c87a' : '#e05555';
  const truncWarn = d._truncated ?
    `<div style="background:rgba(232,200,122,0.1);border:1px solid rgba(232,200,122,0.3);border-radius:6px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#e8c87a"><strong>⚠ Response was truncated</strong> — showing partial analysis. Some suggestions may be cut off; re-run for the full report.</div>` : '';

  let html = `
    <div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">
      ${truncWarn}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border-subtle,#2A2A30)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:${aColor}"></div>
          <div style="font-size:16px;font-weight:700;color:${aColor}">${(d.assessment?.overall||'UNKNOWN').toUpperCase()}</div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);background:var(--bg-elevated,#222228);padding:4px 10px;border-radius:20px">Risk: ${d.assessment?.risk_level || 'N/A'} · Confidence: ${Math.round((d.confidence||0)*100)}%</div>
      </div>
      <div style="font-size:14px;color:var(--text-secondary,#A0A0AA);line-height:1.8;margin-bottom:18px">${escapeHtml(d.assessment?.summary||'')}</div>`;

  // Benchmarks
  if (d.benchmarks) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px">MARKET BENCHMARKS</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px">`;
    ['cost_per_sf','revenue_per_sf','margin_pct'].forEach(k => {
      const b = d.benchmarks[k];
      if (!b) return;
      const label = k.replace(/_/g,' ').toUpperCase();
      const inRange = b.project >= b.market_low && b.project <= b.market_high;
      html += `<div style="background:var(--bg-elevated,#222228);padding:14px;border-radius:8px;text-align:center">
        <div style="font-size:11px;color:var(--text-tertiary,#6B6B78);letter-spacing:0.5px;margin-bottom:6px">${label}</div>
        <div style="font-size:20px;font-weight:700;color:${inRange ? '#AEBC46' : '#e8c87a'}">${k.includes('pct') ? b.project+'%' : '$'+b.project}</div>
        <div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:4px">Mkt: ${k.includes('pct') ? b.market_low+'–'+b.market_high+'%' : '$'+b.market_low+'–$'+b.market_high}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // ── ACTIONABLE SUGGESTIONS (one-click apply) ──
  if (d.actionable_suggestions && d.actionable_suggestions.length) {
    _aiSuggestions = d.actionable_suggestions.map(s => Object.assign({}, s, {_applied: false}));

    html += `<div style="border-top:2px solid var(--accent,#AEBC46);margin:20px 0 12px;padding-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px">⚡ ACTIONABLE SUGGESTIONS</div>
        <button id="ai-apply-all" onclick="applyAllAISuggestions()" style="background:var(--accent,#AEBC46);color:#111;border:none;border-radius:6px;padding:8px 18px;font-size:12px;font-weight:700;cursor:pointer;letter-spacing:0.5px;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">⚡ APPLY ALL (${_aiSuggestions.length})</button>
      </div>`;

    _aiSuggestions.forEach((s, i) => {
      const fieldLabel = _friendlyFieldName(s.field);
      const curFmt = _formatSuggestionValue(s.field, s.current_value);
      const newFmt = _formatSuggestionValue(s.field, s.suggested_value);
      html += `<div style="display:flex;align-items:stretch;gap:0;margin-bottom:8px;background:var(--bg-elevated,#222228);border-radius:8px;border-left:3px solid var(--accent,#AEBC46);overflow:hidden">
        <div style="flex:1;padding:14px 16px">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary,#E8E8EC);margin-bottom:4px">${escapeHtml(s.label || fieldLabel)}</div>
          <div style="font-size:13px;color:var(--text-tertiary,#6B6B78)">${escapeHtml(fieldLabel)}: <span style="color:#e05555;text-decoration:line-through">${escapeHtml(curFmt)}</span> → <span style="color:#4aae8a;font-weight:700">${escapeHtml(newFmt)}</span></div>
          <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px;line-height:1.6">${escapeHtml(s.rationale || '')}</div>
          ${s.impact ? '<div style="font-size:12px;color:#4aae8a;margin-top:4px">Impact: ' + escapeHtml(s.impact) + '</div>' : ''}
        </div>
        <button id="ai-apply-${i}" onclick="applyAISuggestion(${i})" style="background:var(--accent,#AEBC46);color:#111;border:none;padding:0 20px;font-size:12px;font-weight:700;cursor:pointer;min-width:80px;letter-spacing:0.5px;flex-shrink:0;transition:opacity 0.2s" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">APPLY</button>
      </div>`;
    });
    html += `</div>`;
  }

  // Unit mix recommendations
  if (d.unit_mix_recommendations && d.unit_mix_recommendations.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin:18px 0 10px">UNIT MIX ANALYSIS</div>`;
    d.unit_mix_recommendations.forEach(r => {
      html += `<div style="border-left:3px solid var(--border-strong,#444450);padding:12px 16px;margin-bottom:8px;background:var(--bg-elevated,#222228);border-radius:0 8px 8px 0">
        <div style="font-size:13px;color:var(--text-tertiary,#6B6B78)">Current: ${escapeHtml(r.current)}</div>
        <div style="font-size:14px;color:var(--accent,#AEBC46);font-weight:600;margin-top:4px">→ ${escapeHtml(r.recommended)}</div>
        <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px;line-height:1.6">${escapeHtml(r.rationale)}</div>
        <div style="font-size:12px;color:#4aae8a;margin-top:4px">Impact: ${escapeHtml(r.revenue_impact_estimate||'')}</div>
      </div>`;
    });
  }

  // Cost flags
  if (d.cost_flags && d.cost_flags.length) {
    html += `<div style="font-size:12px;font-weight:700;color:#e8c87a;letter-spacing:1.5px;margin:18px 0 10px">COST FLAGS</div>`;
    d.cost_flags.forEach(f => {
      html += `<div style="font-size:13px;color:var(--text-secondary,#A0A0AA);padding:8px 0;line-height:1.6;border-bottom:1px solid var(--border-subtle,#2A2A30)">⚠ <strong style="color:var(--text-primary,#E8E8EC)">${escapeHtml(f.line_item)}</strong>: ${escapeHtml(f.current_value)} (market: ${escapeHtml(f.market_range)}) — ${escapeHtml(f.risk)}</div>`;
    });
  }

  // Top sensitivities
  if (d.top_sensitivities && d.top_sensitivities.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin:18px 0 10px">KEY SENSITIVITIES</div>`;
    d.top_sensitivities.forEach((s,i) => {
      html += `<div style="font-size:13px;color:var(--text-secondary,#A0A0AA);padding:6px 0;line-height:1.6">${i+1}. <strong style="color:var(--text-primary,#E8E8EC)">${escapeHtml(s.input)}</strong> (${escapeHtml(s.current_value)}) → ${escapeHtml(s.impact)}</div>`;
    });
  }

  html += `<div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:16px;border-top:1px solid var(--border-subtle,#2A2A30);padding-top:10px">Sources: ${(d.data_sources_used||[]).join(', ')}</div>`;
  html += `</div>`;
  el.innerHTML = html;
}

/** ── Risk Assessment Renderer ── */
function renderRiskResult(d, el) {
  const rColor = d.risk_rating === 'low' ? '#4aae8a' : d.risk_rating === 'moderate' ? '#e8c87a' :
                 d.risk_rating === 'elevated' ? '#e07b6a' : '#e05555';

  let html = `
    <div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border-subtle,#2A2A30)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:${rColor}"></div>
          <div style="font-size:16px;font-weight:700;color:${rColor}">RISK: ${(d.risk_rating||'unknown').toUpperCase()}</div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);background:var(--bg-elevated,#222228);padding:4px 10px;border-radius:20px">Confidence: ${Math.round((d.confidence||0)*100)}%</div>
      </div>
      <div style="font-size:14px;color:var(--text-secondary,#A0A0AA);line-height:1.8;margin-bottom:18px">${escapeHtml(d.summary||'')}</div>`;

  // Scenario analysis
  if (d.scenario_analysis) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px">SCENARIO ANALYSIS</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:18px">`;
    ['best_case','base_case','worst_case'].forEach(k => {
      const s = d.scenario_analysis[k];
      if (!s) return;
      const c = k === 'best_case' ? '#4aae8a' : k === 'base_case' ? '#AEBC46' : '#e05555';
      html += `<div style="background:var(--bg-elevated,#222228);padding:14px;border-radius:8px;border-top:3px solid ${c}">
        <div style="font-size:11px;color:${c};font-weight:700;margin-bottom:6px;letter-spacing:0.5px">${k.replace(/_/g,' ').toUpperCase()}</div>
        <div style="font-size:18px;font-weight:700;color:${c}">${escapeHtml(s.margin||'')}</div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);margin-top:4px">${escapeHtml(s.probability||'')}</div>
        <div style="font-size:12px;color:var(--text-secondary,#A0A0AA);margin-top:6px;line-height:1.6">${escapeHtml(s.description||'')}</div>
      </div>`;
    });
    html += `</div>`;
  }

  // Stress tests
  if (d.stress_tests && d.stress_tests.length) {
    html += `<div style="font-size:12px;font-weight:700;color:#e8c87a;letter-spacing:1.5px;margin:18px 0 10px">STRESS TESTS</div>`;
    d.stress_tests.forEach(t => {
      const tc = t.severity === 'critical' ? '#e05555' : t.severity === 'concerning' ? '#e8c87a' : '#4aae8a';
      html += `<div style="border-left:3px solid ${tc};padding:12px 16px;margin-bottom:8px;background:var(--bg-elevated,#222228);border-radius:0 8px 8px 0">
        <div style="font-size:14px;font-weight:600;color:${tc};margin-bottom:4px">${escapeHtml(t.scenario)}</div>
        <div style="font-size:13px;color:var(--text-tertiary,#6B6B78);margin-top:4px">${escapeHtml(t.assumptions)}</div>
        <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px">→ ${escapeHtml(t.outcome)}</div>
      </div>`;
    });
  }

  // Mitigation
  if (d.mitigation_strategies && d.mitigation_strategies.length) {
    html += `<div style="font-size:12px;font-weight:700;color:#4aae8a;letter-spacing:1.5px;margin:18px 0 10px">MITIGATION STRATEGIES</div>`;
    d.mitigation_strategies.forEach((m,i) => {
      html += `<div style="font-size:13px;color:var(--text-secondary,#A0A0AA);padding:8px 0;line-height:1.6;border-bottom:1px solid var(--border-subtle,#2A2A30)">${i+1}. <strong style="color:var(--text-primary,#E8E8EC)">${escapeHtml(m.strategy)}</strong> — ${escapeHtml(m.impact)} <span style="color:var(--text-tertiary,#6B6B78)">(${escapeHtml(m.implementation)})</span></div>`;
    });
  }

  html += `<div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:16px;border-top:1px solid var(--border-subtle,#2A2A30);padding-top:10px">Sources: ${(d.data_sources_used||[]).join(', ')}</div>`;
  html += `</div>`;
  el.innerHTML = html;
}

/** ── Comparable Insights Renderer ── */
function renderCompsResult(d, el) {
  const pColor = d.competitive_position === 'under-supplied' ? '#4aae8a' :
                 d.competitive_position === 'balanced' ? '#AEBC46' :
                 d.competitive_position === 'competitive' ? '#e8c87a' : '#e05555';

  let html = `
    <div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--border-subtle,#2A2A30)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:10px;height:10px;border-radius:50%;background:${pColor}"></div>
          <div style="font-size:16px;font-weight:700;color:${pColor}">MARKET: ${(d.competitive_position||'unknown').replace(/_/g,' ').toUpperCase()}</div>
        </div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);background:var(--bg-elevated,#222228);padding:4px 10px;border-radius:20px">Confidence: ${Math.round((d.confidence||0)*100)}%</div>
      </div>
      <div style="font-size:14px;color:var(--text-secondary,#A0A0AA);line-height:1.8;margin-bottom:18px">${escapeHtml(d.summary||'')}</div>`;

  // Pricing
  if (d.pricing_assessment) {
    const pa = d.pricing_assessment;
    const paColor = pa.assessment === 'conservative' ? '#4aae8a' : pa.assessment === 'market' ? '#AEBC46' : '#e05555';
    html += `<div style="background:var(--bg-elevated,#222228);padding:16px;border-radius:8px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px">PRICING</div>
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div style="font-size:24px;font-weight:700;color:${paColor}">$${pa.subject_psf||'?'}/SF</div>
        <div style="font-size:13px;color:var(--text-tertiary,#6B6B78)">Comp range: $${pa.comp_range_psf?.low||'?'} – $${pa.comp_range_psf?.high||'?'}/SF</div>
        <div style="font-size:12px;font-weight:600;color:${paColor};background:rgba(255,255,255,0.05);padding:4px 10px;border-radius:4px">${(pa.assessment||'').toUpperCase()}</div>
      </div>
      <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:8px;line-height:1.6">${escapeHtml(pa.recommendation||'')}</div>
    </div>`;
  }

  // Differentiation
  if (d.differentiation_opportunities && d.differentiation_opportunities.length) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin:18px 0 10px">DIFFERENTIATION OPPORTUNITIES</div>`;
    d.differentiation_opportunities.forEach(o => {
      html += `<div style="border-left:3px solid var(--accent,#AEBC46);padding:12px 16px;margin-bottom:8px;background:var(--bg-elevated,#222228);border-radius:0 8px 8px 0">
        <div style="font-size:14px;font-weight:600;color:var(--accent,#AEBC46);margin-bottom:4px">${escapeHtml(o.strategy)}</div>
        <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:4px;line-height:1.6">${escapeHtml(o.rationale)}</div>
        <div style="font-size:12px;color:var(--text-tertiary,#6B6B78);margin-top:4px">Gap: ${escapeHtml(o.comparable_gap)}</div>
      </div>`;
    });
  }

  // Timing
  if (d.timing_recommendation) {
    html += `<div style="background:var(--bg-elevated,#222228);padding:16px;border-radius:8px;margin-top:16px">
      <div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:8px">TIMING</div>
      <div style="font-size:16px;font-weight:700;color:var(--accent,#AEBC46)">${escapeHtml(d.timing_recommendation.optimal_launch||'')}</div>
      <div style="font-size:13px;color:var(--text-secondary,#A0A0AA);margin-top:6px;line-height:1.6">${escapeHtml(d.timing_recommendation.rationale||'')}</div>
    </div>`;
  }

  html += `<div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:16px;border-top:1px solid var(--border-subtle,#2A2A30);padding-top:10px">Sources: ${(d.data_sources_used||[]).join(', ')}</div>`;
  html += `</div>`;
  el.innerHTML = html;
}

/** ── Report Narratives Renderer ── */
function renderReportResult(d, el) {
  let html = `<div style="background:var(--bg-surface,#1B1B1F);border:1px solid var(--border-subtle,#2A2A30);border-radius:10px;padding:20px;margin-top:8px;font-family:var(--font-body,'DM Sans',sans-serif)">`;

  const sections = [
    { key: 'executive_summary', label: 'EXECUTIVE SUMMARY' },
    { key: 'market_context', label: 'MARKET CONTEXT' },
    { key: 'development_rationale', label: 'DEVELOPMENT RATIONALE' },
    { key: 'risk_factors', label: 'RISK FACTORS' },
    { key: 'recommendations', label: 'RECOMMENDATIONS' },
  ];

  sections.forEach(s => {
    if (!d[s.key]) return;
    html += `<div style="margin-bottom:20px">
      <div style="font-size:12px;font-weight:700;color:var(--accent,#AEBC46);letter-spacing:1.5px;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--border-subtle,#2A2A30)">${s.label}</div>
      <div style="font-size:14px;color:var(--text-secondary,#A0A0AA);line-height:1.9">${d[s.key]}</div>
    </div>`;
  });

  html += `<div style="font-size:11px;color:var(--text-muted,#50505A);margin-top:16px;border-top:1px solid var(--border-subtle,#2A2A30);padding-top:10px">Confidence: ${Math.round((d.confidence||0)*100)}% · Sources: ${(d.data_sources_used||[]).join(', ')}</div>`;
  html += `</div>`;
  el.innerHTML = html;

  // Show "Apply to Report" button
  const applyBtn = document.getElementById('ai-btn-apply-report');
  if (applyBtn) applyBtn.style.display = 'block';
}

/**
 * Apply AI-generated narratives into the Report tab.
 */
function applyAIToReport() {
  const resultDiv = document.getElementById('ai-result-report');
  const data = resultDiv?._aiData;
  if (!data) return;

  // Store AI narratives on the project state so renderReport() can use them
  P._aiNarratives = data;

  // If renderReport exists, re-render with AI content
  try {
    if (typeof renderReport === 'function') renderReport();
  } catch(e) {
    console.warn('Could not re-render report:', e);
  }

  // Visual feedback
  const applyBtn = document.getElementById('ai-btn-apply-report');
  if (applyBtn) {
    applyBtn.textContent = '✓ APPLIED TO REPORT';
    applyBtn.style.background = '#1a3a1a';
    applyBtn.style.color = '#4a8';
    applyBtn.style.borderColor = '#4a8';
    setTimeout(() => {
      applyBtn.textContent = '⬇️ APPLY TO REPORT TAB';
      applyBtn.style.background = '#444444';
      applyBtn.style.color = '#AEBC46';
      applyBtn.style.borderColor = '';
    }, 2000);
  }
}

// ═══════════════════════════════════════════════════════════
//  FINANCIAL SCENARIO MODELLING ENGINE
//  Best / Base / Stress scenario comparison with sensitivity
// ═══════════════════════════════════════════════════════════

/**
 * Scenario definitions — multipliers applied to base-case P.pf inputs
 * Best: optimistic market, lower costs, faster absorption
 * Base: current inputs (unchanged)
 * Stress: adverse market, higher costs, slower absorption, rate increases
 */
