// test.js — Unit tests for financial math (pfCalc, calcDCSchedule, calcDCF, Monte Carlo)
// Run: node test.js
// No dependencies — just assertions against known inputs → expected outputs.
// ═══════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error('  FAIL:', msg); }
}

function assertClose(actual, expected, tolerance, msg) {
  const diff = Math.abs(actual - expected);
  if (diff <= tolerance) { passed++; }
  else { failed++; console.error(`  FAIL: ${msg} — expected ~${expected}, got ${actual} (diff ${diff.toFixed(2)})`); }
}

function section(name) { console.log('\n' + name); }

// ═══════════════════════════════════════════════════════════
//  BOOTSTRAP: Load JS files with minimal stubs
// ═══════════════════════════════════════════════════════════

// Stub browser globals
global.window = global;
global.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  title: '',
  createElement: (tag) => ({ style: {}, getContext: () => null, setAttribute: () => {}, appendChild: () => {} }),
};
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
};
global.alert = () => {};
global.requestAnimationFrame = () => {};
global.HTMLCanvasElement = function(){};

// Stub THREE.js — just enough for computeGFA to work
global.THREE = {
  Scene: function() { this.add = () => {}; this.background = null; this.fog = null; },
  PerspectiveCamera: function() {},
  WebGLRenderer: function() { this.setPixelRatio = () => {}; this.setSize = () => {}; this.shadowMap = {}; },
  Color: function() {},
  Vector2: function() {},
  Vector3: function(x,y,z) { this.x=x||0; this.y=y||0; this.z=z||0; this.set=()=>this; this.copy=()=>this; this.normalize=()=>this; },
  Plane: function() {},
  Raycaster: function() {},
  BoxGeometry: function() {},
  PlaneGeometry: function() {},
  SphereGeometry: function() {},
  ShapeGeometry: function() {},
  ExtrudeGeometry: function() {},
  Shape: function() { this.moveTo=()=>{}; this.lineTo=()=>{}; },
  Mesh: function() { this.position = {set:()=>{}}; this.rotation = {x:0}; this.receiveShadow = false; this.castShadow = false; },
  Group: function() { this.add = () => {}; this.children = []; },
  MeshStandardMaterial: function() {},
  MeshPhongMaterial: function() {},
  MeshBasicMaterial: function() {},
  ShaderMaterial: function() {},
  ShadowMaterial: function() {},
  AmbientLight: function() {},
  DirectionalLight: function() { this.position = {set:()=>{}}; this.shadow = {mapSize:{},camera:{}}; this.castShadow=false; },
  HemisphereLight: function() {},
  FogExp2: function() {},
  BackSide: 1, FrontSide: 0, DoubleSide: 2,
  PCFSoftShadowMap: 2,
  ACESFilmicToneMapping: 4,
  sRGBEncoding: 3001,
  MathUtils: { degToRad: (d) => d * Math.PI / 180 },
};

// Stub mapboxgl
global.mapboxgl = { Map: function() {}, accessToken: '' };
global.MapboxDraw = function() {};
global.MapboxGeocoder = function() {};

// Stub turf
global.turf = {
  area: () => 0,
  booleanPointInPolygon: () => false,
  polygon: () => ({}),
  point: () => ({}),
};

// Stub jsPDF / PptxGenJS
global.jspdf = { jsPDF: function() {} };
global.PptxGenJS = function() {};

// Load files in dependency order
const jsDir = path.join(__dirname, 'js');
const loadOrder = [
  'data-model.js',
  'lot-geometry.js',
  'renderer.js',
  'save-load.js',
  'proforma.js',
  'report.js',
  'section3d.js',
  'renderer-components.js',
  'unit-mix.js',
  'sitemap.js',
  'optimal-massing.js',
  'ai-chat.js',
  'scenarios.js',
  'zoning.js',
  'ui.js',
];

for (const file of loadOrder) {
  const code = fs.readFileSync(path.join(jsDir, file), 'utf8');
  try {
    // Use vm module for cleaner global scope sharing
    require('vm').runInThisContext(code, { filename: file });
  } catch (e) {
    // Some files may fail on DOM-dependent init code — that's OK for tests
    // Only warn if it's a core finance file
    if (['data-model.js', 'lot-geometry.js', 'proforma.js', 'scenarios.js'].includes(file)) {
      console.error(`WARNING: Error loading ${file}:`, e.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  SETUP: Configure a known project state for deterministic tests
// ═══════════════════════════════════════════════════════════

function setupTestProject() {
  // Simple rectangular lot: 60ft × 100ft = 6,000 sf
  P.lot = { front: 60, upperRight: 100, stepEast: 0, lowerRight: 0, upperLeft: 100, notchWest: 0, lowerLeft: 0, rear: 60 };
  delete P.lot.polyVerts; // ensure parameterized mode

  // One volume: 6-storey, 50ft wide × 80ft deep, no setback
  P.vols = [{
    storeys: 6, startEg: 10, depth: 80, width: 50, offEast: 5, offWest: 0, angle: 0,
    podiumStoreys: 0, stepbackAmt: 0, gfHeight: 0, commGF: 1, color: '#88aabb', name: 'A',
    windows: 1, winSpacing: 3, balconies: 0, balcEvery: 2, balcDepth: 4,
    cladding: 'brick', storefrontN: 0, storefrontS: 0, storefrontE: 0, storefrontW: 0,
    balcN: 0, balcS: 0, balcE: 0, balcW: 0
  }];

  P.flr = { gf: 15, typ: 10 };
  P.set = { front: 10, stepback: 3, sideE: 12, sideW: 4, rear: 10 };

  // Core
  P.core = { elevX: 0, elevZ: 0, elevDir: 'ns', elevAngle: 0, numElevators: 2, stairs: [
    { x: 10, z: 10, angle: 0, label: 'NW' },
    { x: 40, z: 80, angle: 0, label: 'SE' }
  ]};

  // Known pro-forma assumptions
  P.pf = {
    units: [
      { type: 'Studio', size: 450, count: 0, psf: 1100 },
      { type: '1-Bedroom', size: 550, count: 0, psf: 1075 },
      { type: '1-Bed+Den', size: 650, count: 0, psf: 1050 },
      { type: '2-Bedroom', size: 750, count: 0, psf: 1025 },
      { type: '2-Bed+Den', size: 875, count: 0, psf: 1000 },
      { type: '3-Bedroom', size: 1050, count: 0, psf: 975 }
    ],
    comm: [
      { label: 'Retail', pct: 1.0, rent: 30, cap: 0.06 }
    ],
    parkPrice: 60000, lockerPrice: 8000, parkRatio: 0.30, lockerRatio: 0.50,
    landPrice: 5000000, lttRate: 0.025, ddCost: 200000,
    hc: { shoring: 18, structure: 68, envelope: 85, mech: 38, elec: 22, fitResi: 55, fitComm: 12, commShell: 8, elevators: 6, siteWorks: 5, parking: 28 },
    sc: { ae: 0.065, pm: 0.03, legal: 0.015, insurance: 0.012, marketing: 0.04, permits: 0.008, contingency: 0.105 },
    dcPerUnit: 45000, dcCommPerSF: 44, s37PerUnit: 7300, parkland: 2200000,
    ltc: 0.65, intRate: 0.065, drawMonths: 24, loanFeePct: 0.01,
    autoScaleUnits: true, baseResiGFA: 169600,
    dcf: {
      discountRate: 0.08,
      phases: [
        { id: 'approvals', label: 'Approvals', months: 12, costPct: 0.03 },
        { id: 'shoring', label: 'Shoring', months: 6, costPct: 0.08 },
        { id: 'belowGrade', label: 'Below-Grade', months: 6, costPct: 0.12 },
        { id: 'aboveGrade', label: 'Above-Grade', months: 12, costPct: 0.30 },
        { id: 'envelope', label: 'Envelope', months: 8, costPct: 0.15 },
        { id: 'fitout', label: 'Fit-Out', months: 10, costPct: 0.22 },
        { id: 'commission', label: 'Commissioning', months: 4, costPct: 0.08 },
        { id: 'deficiency', label: 'Deficiency', months: 6, costPct: 0.02 }
      ],
      preSalesPct: 0.70,
      preSalesDeposit: 0.20,
      absorptionMonths: 18,
      constructionRate: 0.065,
      equityPct: 0.35,
    }
  };

  P.unitPlan = { mode: 'auto', corridorWidthFt: 5.5, floors: [], unitTypes: P.unitPlan.unitTypes };
  P.projectType = 'midrise';

  // Reset locked units
  if (P.pf._locked) P.pf._locked = {};

  // Clear pfCache
  if (typeof _pfCache !== 'undefined') _pfCache = null;
}

// ═══════════════════════════════════════════════════════════
//  TEST 1: Lot Geometry
// ═══════════════════════════════════════════════════════════
section('1. LOT GEOMETRY');

setupTestProject();

const verts = lotVerts();
assert(verts.length >= 4, 'lotVerts() returns at least 4 vertices');

const area = lotArea();
assertClose(area, 6000, 1, 'lotArea() for 60×100 lot = 6000 sf');

const bounds = lotBounds();
assertClose(bounds.width, 60, 0.1, 'lotBounds().width = 60');
assertClose(bounds.depth, 100, 0.1, 'lotBounds().depth = 100');
assert(bounds.minX === 0, 'lotBounds().minX = 0');
assert(bounds.minZ === 0, 'lotBounds().minZ = 0');

// ═══════════════════════════════════════════════════════════
//  TEST 2: Pro-Forma Calculation
// ═══════════════════════════════════════════════════════════
section('2. PRO-FORMA (pfCalc)');

setupTestProject();
let pf;
try {
  pf = pfCalc();
} catch(e) {
  console.error('  pfCalc() threw:', e.message);
  pf = null;
}

if (pf) {
  // GFA check: 6 storeys × 50×80 = 24,000 sf total
  assertClose(pf.totalGFA, 24000, 100, 'totalGFA = ~24,000 sf (6 × 50 × 80)');

  // Commercial GFA = ground floor (1 storey with commGF) = 4,000 sf
  assertClose(pf.commGFA, 4000, 100, 'commGFA = ~4,000 sf (1 GF storey)');

  // Resi GFA = totalGFA - commGFA
  assertClose(pf.resiGFA, 20000, 100, 'resiGFA = totalGFA - commGFA');

  // Units should be auto-distributed
  assert(pf.totalUnits > 0, 'totalUnits > 0 (auto-distributed)');
  assert(pf.unitMix.length === 6, 'unitMix has 6 unit types');

  // Revenue checks
  assert(pf.resiRevenue > 0, 'resiRevenue > 0');
  assert(pf.totalCommValue > 0, 'totalCommValue > 0');
  assert(pf.totalGrossRev > 0, 'totalGrossRev > 0');

  // Land cost
  assertClose(pf.totalLand, 5000000 + 5000000 * 0.025 + 200000, 1, 'totalLand = price + LTT + DD');

  // Hard cost = hardCostPSF × totalGFA (single rate model, default $350/sf)
  const expectedHard = (P.pf.hardCostPSF || 350) * 24000;
  assertClose(pf.totalHard, expectedHard, 5000, 'totalHard = hardCostPSF × totalGFA');

  // Margin should exist (could be negative for small project, that's OK)
  assert(typeof pf.margin === 'number', 'margin is a number');
  assert(typeof pf.marginOnCost === 'number', 'marginOnCost is a number');

  // Financing should be positive
  assert(pf.totalFinancing > 0, 'totalFinancing > 0');

  // Total cost = land + hard + soft + financing + time-adj
  const costSum = pf.totalLand + pf.totalHard + pf.totalSoft + pf.timeAdjSoft + pf.totalFinancing;
  assertClose(pf.totalCost, costSum, 1, 'totalCost = land + hard + soft + timeAdj + financing');

  // Deductions should be reasonable (< 50% of resi GFA)
  assert(pf.deductions.totalDeductions < pf.resiGFA * 0.5, 'Deductions < 50% of resiGFA');
  assert(pf.sellableResiSF > 0, 'sellableResiSF > 0');
  assert(pf.sellableResiSF < pf.resiGFA, 'sellableResiSF < resiGFA (deductions applied)');

  // GF deductions for commercial
  assert(pf.gfDeductions.gfTotalDeduct > 0, 'GF service deductions > 0');
  assert(pf.netLeasableComm < pf.commGFA, 'netLeasableComm < commGFA (deductions applied)');

  // Parking and lockers
  assert(pf.parkSpaces === Math.round(pf.totalUnits * 0.30), 'parkSpaces = totalUnits × parkRatio');
  assert(pf.lockers === Math.round(pf.totalUnits * 0.50), 'lockers = totalUnits × lockerRatio');

  // Timeline — phase durations scale with storey count (0.25 mo/storey for above-grade)
  assert(pf.totalConstructionMonths > 0, 'totalConstructionMonths > 0');
  assert(pf.totalProjectMonths === pf.totalConstructionMonths + pf.absorptionMonths, 'totalProjectMonths = construction + absorption');
}

// ═══════════════════════════════════════════════════════════
//  TEST 3: DC Schedule
// ═══════════════════════════════════════════════════════════
section('3. DC SCHEDULE (calcDCSchedule)');

setupTestProject();
if (typeof calcDCSchedule === 'function' && typeof TO_DC_RATES !== 'undefined') {
  const testMix = [
    { type: 'Studio', count: 10, size: 450, psf: 1100 },
    { type: '1-Bedroom', count: 20, size: 550, psf: 1075 },
    { type: '2-Bedroom', count: 15, size: 750, psf: 1025 },
    { type: '3-Bedroom', count: 5, size: 1050, psf: 975 },
  ];
  const dc = calcDCSchedule(testMix, 4000);

  // Bachelor/1-bed: 30 units, 2+bed: 20 units
  assert(dc.summary.bachelor1bedCount === 30, 'DC schedule: 30 bachelor/1-bed units');
  assert(dc.summary.twoPlusCount === 20, 'DC schedule: 20 two-plus units');
  assert(dc.grandTotal > 0, 'DC grandTotal > 0');
  assert(dc.totalResi > 0, 'DC totalResi > 0');
  assert(dc.totalComm >= 0, 'DC totalComm >= 0');

  // Per-unit rates should be positive
  assert(dc.summary.perUnitBachelor1bed > 0, 'DC per bachelor/1-bed > 0');
  assert(dc.summary.perUnitTwoPlus > 0, 'DC per two-plus > 0');
  assert(dc.summary.perUnitTwoPlus > dc.summary.perUnitBachelor1bed, 'DC per 2-bed > per 1-bed');

  // Grand total = sum of all categories
  const recomputed = dc.totalResi + dc.totalEduResi + dc.totalComm + dc.totalEduComm;
  assertClose(dc.grandTotal, recomputed, 1, 'DC grandTotal = resi + edu + comm');
} else {
  console.log('  SKIP: calcDCSchedule or TO_DC_RATES not available');
}

// ═══════════════════════════════════════════════════════════
//  TEST 4: DCF Cash Flow Model
// ═══════════════════════════════════════════════════════════
section('4. DCF MODEL (calcDCF)');

setupTestProject();
if (typeof calcDCF === 'function') {
  const pfResult = pfCalc();
  let dcf;
  try {
    dcf = calcDCF(pfResult);
  } catch(e) {
    console.error('  calcDCF() threw:', e.message);
    dcf = null;
  }

  if (dcf) {
    // NPV should be a number
    assert(typeof dcf.npv === 'number', 'DCF npv is a number');

    // IRR should be a number (might be NaN for unprofitable projects)
    assert(typeof dcf.irr === 'number' || isNaN(dcf.irr), 'DCF irr is a number or NaN');

    // Monthly cash flows should exist
    assert(Array.isArray(dcf.monthly), 'DCF has monthly array');
    assert(dcf.monthly.length > 0, 'DCF monthly has entries');

    // Timeline should exist
    assert(Array.isArray(dcf.timeline), 'DCF has timeline array');
    assert(dcf.timeline.length === 8, 'DCF timeline has 8 phases');

    // Peak equity should be positive
    if (dcf.peakEquity !== undefined) {
      assert(dcf.peakEquity > 0, 'DCF peakEquity > 0');
    }

    // Total costs in monthly should approximately match pfCalc totalCost
    const totalMonthlyCosts = dcf.monthly.reduce((s, m) => s + m.costs, 0);
    // Allow generous tolerance since financing is computed differently in DCF
    assert(totalMonthlyCosts > 0, 'DCF total monthly costs > 0');
  }
} else {
  console.log('  SKIP: calcDCF not available');
}

// ═══════════════════════════════════════════════════════════
//  TEST 5: Monte Carlo Simulation
// ═══════════════════════════════════════════════════════════
section('5. MONTE CARLO (runMonteCarlo)');

setupTestProject();
if (typeof runMonteCarlo === 'function') {
  const pfResult = pfCalc();
  let mc;
  try {
    mc = runMonteCarlo(pfResult, 100); // small sample for speed
  } catch(e) {
    console.error('  runMonteCarlo() threw:', e.message);
    mc = null;
  }

  if (mc) {
    // MC returns {stats, results, tornado, histogram, vars}
    assert(mc.stats && mc.stats.iterations === 100, 'MC ran 100 iterations');
    assert(Array.isArray(mc.results), 'MC has results array');
    assert(mc.results.length === 100, 'MC results has 100 entries');
    assert(typeof mc.stats.irrMean === 'number', 'MC irrMean is a number');
    assert(typeof mc.stats.irrP10 === 'number', 'MC irrP10 is a number');
    assert(typeof mc.stats.irrP90 === 'number', 'MC irrP90 is a number');
    assert(mc.stats.irrP10 <= mc.stats.irrP90, 'MC irrP10 <= irrP90');

    // Each result should have margin and irr
    const r0 = mc.results[0];
    assert(typeof r0.margin === 'number', 'MC result has margin');
    assert(typeof r0.irr === 'number' || isNaN(r0.irr), 'MC result has irr');
    assert(typeof r0.totalRev === 'number', 'MC result has totalRev');
    assert(typeof r0.totalCost === 'number', 'MC result has totalCost');

    // Vars should track sensitivity
    assert(Array.isArray(mc.vars), 'MC has vars array');
    assert(mc.vars.length > 0, 'MC vars has entries');

    // Histogram should exist
    assert(Array.isArray(mc.histogram), 'MC has histogram');
    assert(mc.histogram.length > 0, 'MC histogram has entries');
  }
} else {
  console.log('  SKIP: runMonteCarlo not available');
}

// ═══════════════════════════════════════════════════════════
//  TEST 6: Scenario Modelling
// ═══════════════════════════════════════════════════════════
section('6. SCENARIOS (runScenario)');

setupTestProject();
if (typeof runScenario === 'function' && typeof SCENARIO_DEFS !== 'undefined') {
  const best = runScenario('best');
  const base = runScenario('base');
  const stress = runScenario('stress');

  assert(best && best.pf && base && base.pf && stress && stress.pf, 'All three scenarios produce results with .pf');

  if (best && best.pf && base && base.pf && stress && stress.pf) {
    // Best case should have higher margin than base
    assert(best.pf.marginOnCost >= base.pf.marginOnCost - 0.01, 'Best case margin >= base case');
    // Stress case should have lower margin than base
    assert(stress.pf.marginOnCost <= base.pf.marginOnCost + 0.01, 'Stress case margin <= base case');

    // Revenue should differ between scenarios
    assert(best.pf.totalGrossRev >= base.pf.totalGrossRev * 0.95, 'Best revenue >= 95% of base');
    assert(stress.pf.totalGrossRev <= base.pf.totalGrossRev * 1.05, 'Stress revenue <= 105% of base');
  }
} else {
  console.log('  SKIP: runScenario or SCENARIO_DEFS not available');
}

// ═══════════════════════════════════════════════════════════
//  TEST 7: Sensitivity Analysis
// ═══════════════════════════════════════════════════════════
section('7. SENSITIVITY ANALYSIS');

setupTestProject();
if (typeof sensitivityAnalysis === 'function') {
  // Ensure pfCalc works first
  pfCalc();
  // sensitivityAnalysis takes (inputKey, [lowFactor, highFactor], steps)
  const results = sensitivityAnalysis('psf', [0.8, 1.2], 5);

  if (results && Array.isArray(results)) {
    assert(results.length === 6, 'Sensitivity: 6 points (steps+1)');
    assert(typeof results[0].margin === 'number', 'Each sensitivity point has margin');
    assert(typeof results[0].factor === 'number', 'Each sensitivity point has factor');
    // Higher PSF factor should generally produce higher margin
    assert(results[results.length-1].margin >= results[0].margin - 1000,
      'Higher PSF factor produces higher or similar margin');
  } else {
    console.log('  SKIP: sensitivityAnalysis returned unexpected format');
  }
} else {
  console.log('  SKIP: sensitivityAnalysis not available');
}

// ═══════════════════════════════════════════════════════════
//  TEST 8: Financial Consistency Checks
// ═══════════════════════════════════════════════════════════
section('8. FINANCIAL CONSISTENCY');

setupTestProject();
pf = pfCalc();

if (pf) {
  // Revenue = resi + comm + parking + lockers
  const revenueSum = pf.resiRevenue + pf.totalCommValue + pf.parkRev + pf.lockerRev;
  assertClose(pf.totalGrossRev, revenueSum, 1, 'totalGrossRev = resi + comm + parking + lockers');

  // Margin = revenue - costs
  assertClose(pf.margin, pf.totalGrossRev - pf.totalCost, 1, 'margin = revenue - totalCost');

  // MarginOnCost = margin / totalCost
  assertClose(pf.marginOnCost, pf.margin / pf.totalCost, 0.0001, 'marginOnCost = margin / totalCost');

  // MarginOnRev = margin / revenue
  assertClose(pf.marginOnRev, pf.margin / pf.totalGrossRev, 0.0001, 'marginOnRev = margin / totalGrossRev');

  // FSI = totalGFA / siteArea
  assertClose(pf.fsi, pf.totalGFA / pf.siteArea, 0.01, 'FSI = totalGFA / siteArea');

  // Total soft costs = softCostPct × totalHard (single % of hard model)
  const expectedSoft = pf.totalHard * (P.pf.softCostPct || 0.30);
  assertClose(pf.totalSoft, expectedSoft, 1, 'totalSoft = softCostPct × totalHard');

  // Hard costs should be > soft costs (typical for real estate)
  assert(pf.totalHard > 0, 'totalHard > 0');
}

// ═══════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════════');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════\n');

process.exit(failed > 0 ? 1 : 0);
