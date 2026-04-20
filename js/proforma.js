// proforma.js — Pro-forma calculations, DCF, Monte Carlo, benchmarks, DC rates
// ═══════════════════════════════════════════════════════════
//  PRO-FORMA ENGINE — live-linked to massing model
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════
// ALTUS 2025 CANADIAN COST GUIDE — City-Specific Construction Costs
// Source: Altus Group, 2025 Canadian Cost Guide ($/sf, hard cost only)
// All values CAD $/sf, exclude parking below grade, exclude GST/HST/QST
// ══════════════════════════════════════════════════════════════════════
const ALTUS_CITIES = [
  {id:'vancouver', label:'Vancouver',  lat:49.2827, lng:-123.1207},
  {id:'calgary',   label:'Calgary',    lat:51.0447, lng:-114.0719},
  {id:'edmonton',  label:'Edmonton',   lat:53.5461, lng:-113.4938},
  {id:'winnipeg',  label:'Winnipeg',   lat:49.8951, lng:-97.1384},
  {id:'gta',       label:'GTA',        lat:43.6532, lng:-79.3832},
  {id:'ottawa',    label:'Ottawa',     lat:45.4215, lng:-75.6972},
  {id:'montreal',  label:'Montreal',   lat:45.5017, lng:-73.5673},
  {id:'halifax',   label:'Halifax',    lat:44.6488, lng:-63.5752},
  {id:'stjohns',   label:"St. John's", lat:47.5615, lng:-52.7126},
];

// Residential Condominiums/Apartments — $/sf ranges by height tier and city
// Keys: low12, high12 = up to 12 storeys; low39, high39 = 13-39 storeys;
//       low60, high60 = 40-60 storeys; low60p, high60p = 60+ storeys;
//       hiQualPremium = premium for high-quality finishes (additive)
const ALTUS_RESI_COSTS = {
  vancouver: {low12:330,high12:405, low39:360,high39:455, low60:360,high60:480, low60p:370,high60p:485, hiQualPremium:275},
  calgary:   {low12:295,high12:350, low39:305,high39:360, low60:310,high60:365, low60p:null,high60p:null, hiQualPremium:265},
  edmonton:  {low12:295,high12:350, low39:305,high39:360, low60:310,high60:365, low60p:null,high60p:null, hiQualPremium:265},
  winnipeg:  {low12:295,high12:350, low39:305,high39:355, low60:310,high60:360, low60p:null,high60p:null, hiQualPremium:260},
  gta:       {low12:290,high12:390, low39:295,high39:385, low60:330,high60:410, low60p:365,high60p:480, hiQualPremium:245},
  ottawa:    {low12:270,high12:345, low39:310,high39:340, low60:315,high60:365, low60p:null,high60p:null, hiQualPremium:195},
  montreal:  {low12:260,high12:320, low39:300,high39:315, low60:310,high60:355, low60p:null,high60p:null, hiQualPremium:200},
  halifax:   {low12:240,high12:340, low39:295,high39:370, low60:null,high60:null, low60p:null,high60p:null, hiQualPremium:195},
  stjohns:   {low12:250,high12:350, low39:null,high39:null, low60:null,high60:null, low60p:null,high60p:null, hiQualPremium:200},
};

// Wood-framed residential — $/sf ranges by city (Up to 6 storey wood-framed condo)
const ALTUS_WOOD_FRAME = {
  vancouver:{low:275,high:365}, calgary:{low:235,high:345}, edmonton:{low:230,high:345},
  winnipeg:{low:225,high:340}, gta:{low:245,high:330}, ottawa:{low:215,high:280},
  montreal:{low:210,high:275}, halifax:{low:175,high:220}, stjohns:{low:240,high:310},
};

// Underground parking — $/sf by city
const ALTUS_PARKING = {
  vancouver:{low:170,high:290}, calgary:{low:160,high:220}, edmonton:{low:160,high:220},
  winnipeg:{low:155,high:215}, gta:{low:175,high:285}, ottawa:{low:200,high:290},
  montreal:{low:145,high:195}, halifax:{low:145,high:200}, stjohns:{low:150,high:200},
};

// Retail — $/sf by city (Strip Plaza as proxy for ground-floor retail)
const ALTUS_RETAIL = {
  vancouver:{low:210,high:300}, calgary:{low:220,high:300}, edmonton:{low:220,high:300},
  winnipeg:{low:215,high:295}, gta:{low:235,high:295}, ottawa:{low:170,high:245},
  montreal:{low:155,high:225}, halifax:{low:140,high:190}, stjohns:{low:145,high:190},
};

/**
 * Find the nearest Altus Cost Guide city for given GPS coordinates.
 * Uses Haversine distance. Returns the city object from ALTUS_CITIES.
 * If no coords provided, defaults to 'gta'.
 * @param {number|null} lat - Latitude
 * @param {number|null} lng - Longitude
 * @returns {{id:string, label:string, lat:number, lng:number, distKm:number}}
 */
function getAltusCityForCoords(lat, lng) {
  if (lat == null || lng == null) {
    const gta = ALTUS_CITIES.find(c => c.id === 'gta');
    return { ...gta, distKm: 0 };
  }
  const toRad = d => d * Math.PI / 180;
  let best = null, bestDist = Infinity;
  ALTUS_CITIES.forEach(c => {
    const dLat = toRad(c.lat - lat), dLng = toRad(c.lng - lng);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat)) * Math.cos(toRad(c.lat)) * Math.sin(dLng/2)**2;
    const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    if (dist < bestDist) { bestDist = dist; best = c; }
  });
  return { ...best, distKm: Math.round(bestDist) };
}

/**
 * Get Altus cost range for a given city and storey count.
 * Returns {low, high, tier, source} — the appropriate $/sf range.
 * Falls back to next-lower tier if the city doesn't have data for that height.
 * @param {string} cityId - Altus city id (e.g. 'gta', 'vancouver')
 * @param {number} storeys - Max building storeys
 * @returns {{low:number, high:number, tier:string, source:string}}
 */
function getAltusCostRange(cityId, storeys) {
  const c = ALTUS_RESI_COSTS[cityId] || ALTUS_RESI_COSTS.gta;
  const city = ALTUS_CITIES.find(x => x.id === cityId) || ALTUS_CITIES.find(x => x.id === 'gta');
  const src = 'Altus 2025 — ' + city.label;

  // Wood-frame (1-6 storeys)
  if (storeys <= 6) {
    const wf = ALTUS_WOOD_FRAME[cityId] || ALTUS_WOOD_FRAME.gta;
    return { low: wf.low, high: wf.high, tier: 'Wood-frame (up to 6 st)', source: src };
  }
  // Up to 12 storeys
  if (storeys <= 12) {
    return { low: c.low12, high: c.high12, tier: 'Concrete (up to 12 st)', source: src };
  }
  // 13-39 storeys
  if (storeys <= 39) {
    if (c.low39 != null) return { low: c.low39, high: c.high39, tier: 'Concrete (13-39 st)', source: src };
    return { low: c.low12, high: c.high12, tier: 'Concrete (up to 12 st, max available)', source: src };
  }
  // 40-60 storeys
  if (storeys <= 60) {
    if (c.low60 != null) return { low: c.low60, high: c.high60, tier: 'Concrete (40-60 st)', source: src };
    if (c.low39 != null) return { low: c.low39, high: c.high39, tier: 'Concrete (13-39 st, max available)', source: src };
    return { low: c.low12, high: c.high12, tier: 'Concrete (up to 12 st, max available)', source: src };
  }
  // 60+ storeys
  if (c.low60p != null) return { low: c.low60p, high: c.high60p, tier: 'Concrete (60+ st)', source: src };
  if (c.low60 != null) return { low: c.low60, high: c.high60, tier: 'Concrete (40-60 st, max available)', source: src };
  if (c.low39 != null) return { low: c.low39, high: c.high39, tier: 'Concrete (13-39 st, max available)', source: src };
  return { low: c.low12, high: c.high12, tier: 'Concrete (up to 12 st, max available)', source: src };
}

/**
 * Compute a city-aware height multiplier by comparing the Altus cost range midpoint
 * for the actual building height to the base cost midpoint for the same city.
 * This replaces the old hardcoded height multiplier.
 * @param {string} cityId - Altus city id
 * @param {number} storeys - Max building storeys
 * @returns {number} Multiplier (1.0 = base cost level for that city's low-rise)
 */
function getAltusHeightMultiplier(cityId, storeys) {
  const baseRange = getAltusCostRange(cityId, 6);   // wood-frame baseline
  const actualRange = getAltusCostRange(cityId, storeys);
  const baseMid = (baseRange.low + baseRange.high) / 2;
  const actualMid = (actualRange.low + actualRange.high) / 2;
  return baseMid > 0 ? actualMid / baseMid : 1.0;
}

// Cached city detection result — refreshed when siteCoords change
let _altusCityCache = null;
let _altusCityCacheLat = null;
let _altusCityCacheLng = null;

/**
 * Get the current Altus city for the project. Caches result until coords change.
 * Reads from P.siteCoords or P.lot.gpsVerts.
 * @returns {{id:string, label:string, lat:number, lng:number, distKm:number}}
 */
function getCurrentAltusCity() {
  const lat = P.siteCoords ? P.siteCoords.lat : (P.lot && P.lot.gpsVerts && P.lot.gpsVerts.length > 0 ? P.lot.gpsVerts[0][1] : null);
  const lng = P.siteCoords ? P.siteCoords.lng : (P.lot && P.lot.gpsVerts && P.lot.gpsVerts.length > 0 ? P.lot.gpsVerts[0][0] : null);
  if (lat === _altusCityCacheLat && lng === _altusCityCacheLng && _altusCityCache) return _altusCityCache;
  _altusCityCache = getAltusCityForCoords(lat, lng);
  _altusCityCacheLat = lat;
  _altusCityCacheLng = lng;
  return _altusCityCache;
}

// ── Editable pro-forma assumptions (saved with project) ──
if(!P.pf) P.pf={
  units:[
    {type:'Studio',size:425,count:21,psf:1100},
    {type:'1-Bedroom',size:550,count:82,psf:1075},
    {type:'1-Bed+Den',size:630,count:41,psf:1050},
    {type:'2-Bedroom',size:775,count:41,psf:1025},
    {type:'2-Bed+Den',size:875,count:11,psf:1000},
    {type:'3-Bedroom',size:1050,count:10,psf:975}
  ],
  comm:[
    {label:'Grocery Anchor',pct:0.70,rent:22,cap:0.060},
    {label:'CRU Retail / F&B',pct:0.20,rent:35,cap:0.060},
    {label:'Service / Personal',pct:0.10,rent:28,cap:0.065}
  ],
  parkPrice:60000, lockerPrice:8000, parkRatio:0.30, lockerRatio:0.56,
  landPrice:10000000, lttRate:0.025, ddCost:350000,
  hc:{shoring:18,structure:68,envelope:85,mech:38,elec:22,fitResi:55,fitComm:12,commShell:8,elevators:6,siteWorks:5,parking:28,groceryTI:4.5},
  sc:{ae:0.065,pm:0.03,legal:0.015,insurance:0.012,marketing:0.04,permits:0.008,contingency:0.105},
  totalSoftPct:0.275,  // master soft cost % of hard (sum of sc defaults)
  scMode:'pct',        // 'pct' = individual % of hard, 'dollar' = fixed $ amounts
  scDollar:{ae:0,pm:0,legal:0,insurance:0,marketing:0,permits:0,contingency:0},
  dcPerUnit:45000, dcCommPerSF:44, s37PerUnit:7300, parkland:2200000,
  ltc:0.65, intRate:0.065, drawMonths:24, loanFeePct:0.01,
  autoScaleUnits:true, baseResiGFA:169600,
  // Construction schedule parameters
  slabType:'flat',           // 'flat' (5.5-day cycle) or 'beam' (8-day cycle)
  startSeason:'spring',      // 'spring','summer','fall','winter' — affects shoring/excavation
  podiumFloors:0,            // 0 = auto-detect from volumes, otherwise override
  contingencyPct:0.15,       // 15% schedule contingency for Toronto regulatory/weather risk
  // DCF model parameters
  dcf:{
    discountRate:0.08,     // 8% discount rate for NPV
    phases:[
      {id:'approvals',  label:'Approvals & Entitlements', months:15, costPct:0.03}, // % of total project cost
      {id:'shoring',    label:'Shoring & Excavation',     months:6,  costPct:0.08},
      {id:'belowGrade', label:'Below-Grade Structure',    months:6,  costPct:0.12},
      {id:'aboveGrade', label:'Above-Grade Structure',    months:12, costPct:0.30},
      {id:'envelope',   label:'Building Envelope',        months:8,  costPct:0.15},
      {id:'fitout',     label:'Interior Fit-Out',         months:10, costPct:0.22},
      {id:'commission', label:'Commissioning & Occupancy',months:4,  costPct:0.08},
      {id:'deficiency', label:'Deficiency Holdback',      months:6,  costPct:0.02}
    ],
    preSalesPct:0.70,       // 70% of units pre-sold before construction
    preSalesDeposit:0.20,   // 20% deposit on pre-sales
    absorptionMonths:18,    // months to sell remaining 30% post-occupancy
    constructionRate:0.065, // construction financing rate (prime + 150-250bps)
    equityPct:0.35,         // 35% equity (1 - LTC)
  }
};

// ── Toronto Mid-Rise Market Benchmarks (2025-2026) ──
const PF_BENCHMARKS = {
  hardCostPerSF:   { low: 300, high: 400, label: 'Hard cost $/sf' },
  resiPSF_midtown: { low: 950, high: 1250, label: 'Resi $/sf (midtown)' },
  resiPSF_suburb:  { low: 800, high: 1050, label: 'Resi $/sf (inner suburb)' },
  parkPrice:       { low: 60000, high: 85000, label: 'Parking $/stall' },
  lockerPrice:     { low: 6000, high: 10000, label: 'Locker $/unit' },
  commRentNNN:     { low: 25, high: 45, label: 'Retail rent $/sf NNN' },
  commCapRate:     { low: 0.055, high: 0.070, label: 'Retail cap rate' },
  softCostPct:     { low: 0.25, high: 0.35, label: 'Soft costs % of hard' },
  marginOnCost:    { low: 0.15, high: 0.25, label: 'Target profit margin' },
};




/**
 * Evaluate a value against a benchmark range.
 * Returns {status:'in'|'below'|'above', dot:HTML, val, low, high}
 */
function benchCheck(val, benchKey){
  const b=PF_BENCHMARKS[benchKey];
  if(!b) return {status:'in',dot:''};
  let status='in';
  if(val<b.low) status='below';
  else if(val>b.high) status='above';
  const colors={in:'#4ecdc4',below:'#e8c87a',above:'#c44'};
  // Format range values — use % for ratio benchmarks, $ for dollar benchmarks
  const isPct=benchKey.includes('Pct')||benchKey.includes('CapRate')||benchKey.includes('Cap')||benchKey==='commCapRate'||benchKey==='marginOnCost'||benchKey==='softCostPct'||benchKey==='aePct'||benchKey==='pmPct';
  const fmtBV=v=>isPct?((v*100).toFixed(1)+'%'):('$'+v.toLocaleString());
  const rangeStr=fmtBV(b.low)+' \u2013 '+fmtBV(b.high);
  const mktLabel=(getCurrentAltusCity()||{}).label||'market';
  const tips={
    in: b.label+' is within the '+mktLabel+' market range ('+rangeStr+')',
    below: b.label+' is below the typical '+mktLabel+' market range. Low end: '+fmtBV(b.low),
    above: b.label+' is above the typical '+mktLabel+' market range. High end: '+fmtBV(b.high)
  };
  const icons={in:'✓',below:'▼',above:'▲'};
  const dot=`<span style="display:inline-block;width:14px;text-align:center;vertical-align:middle"><span title="${tips[status]}" style="font-size:9px;color:${colors[status]};cursor:default;font-weight:700;line-height:1">${icons[status]}</span></span>`;
  return {status,dot,val,low:b.low,high:b.high,label:b.label};
}

/**
 * Compute all benchmark checks against current pfCalc() data.
 * Returns {checks:[], inCount, totalCount}
 */
function computeBenchmarks(d){
  const pf=P.pf;
  const checks=[];

  // Hard cost benchmark — fixed at $350/sf
  PF_BENCHMARKS.hardCostPerSF={low:300,high:400,label:'Hard cost $/sf (benchmark $350)'};

  // Benchmarks
  {
    if(d.totalGFA>0) checks.push({...benchCheck(d.hardCostPSF,'hardCostPerSF'),key:'hardCostPerSF',actual:d.hardCostPSF});
    const avgPSF=d.totalUnits>0?pf.units.reduce((s,u)=>s+u.psf*u.count,0)/d.totalUnits:0;
    if(avgPSF>0) checks.push({...benchCheck(avgPSF,'resiPSF_midtown'),key:'resiPSF_midtown',actual:avgPSF});
    checks.push({...benchCheck(pf.parkPrice,'parkPrice'),key:'parkPrice',actual:pf.parkPrice});
    checks.push({...benchCheck(pf.lockerPrice,'lockerPrice'),key:'lockerPrice',actual:pf.lockerPrice});
    const avgRent=pf.comm.reduce((s,t)=>s+t.rent*t.pct,0);
    if(avgRent>0) checks.push({...benchCheck(avgRent,'commRentNNN'),key:'commRentNNN',actual:avgRent});
    const avgCap=pf.comm.reduce((s,t)=>s+t.cap*t.pct,0);
    if(avgCap>0) checks.push({...benchCheck(avgCap,'commCapRate'),key:'commCapRate',actual:avgCap});
    if(d.totalHard>0) checks.push({...benchCheck(d.softCostPct,'softCostPct'),key:'softCostPct',actual:d.softCostPct});
    checks.push({...benchCheck(d.marginOnCost,'marginOnCost'),key:'marginOnCost',actual:d.marginOnCost});
  }

  const inCount=checks.filter(c=>c.status==='in').length;
  return {checks,inCount,totalCount:checks.length};
}

/**
 * Render the benchmark summary banner HTML.
 * Shows a clear legend, per-metric cards with actual vs range, and overall score.
 */
function renderBenchmarkBanner(bm){
  const pctIn=bm.totalCount>0?Math.round(bm.inCount/bm.totalCount*100):100;
  const barColor=pctIn>=80?'#4ecdc4':(pctIn>=50?'#e8c87a':'#c44');
  const belowCount=bm.checks.filter(c=>c.status==='below').length;
  const aboveCount=bm.checks.filter(c=>c.status==='above').length;

  // Format value for display based on magnitude
  function fmtBenchVal(v,key){
    if(key==='commCapRate') return (v*100).toFixed(1)+'%';
    if(key==='softCostPct'||key==='marginOnCost'||key==='aePct'||key==='pmPct') return (v*100).toFixed(1)+'%';
    if(v>=10000) return '$'+Math.round(v).toLocaleString();
    if(v>=100) return '$'+Math.round(v);
    return '$'+v.toFixed(1);
  }
  function fmtRange(c){
    return fmtBenchVal(c.low,c.key)+' – '+fmtBenchVal(c.high,c.key);
  }

  let html=`<div style="background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:12px;margin-bottom:12px">
    <!-- Header row: title + score -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <div style="font-size:10px;font-weight:700;color:#c49ade;letter-spacing:1px">MARKET BENCHMARK VALIDATION</div>
        <div style="font-size:9px;color:#777;margin-top:2px">Benchmarked against Altus 2025 Canadian Cost Guide</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:${barColor}">${pctIn}%</div>
        <div style="font-size:9px;color:#888">${bm.inCount}/${bm.totalCount} in range</div>
      </div>
    </div>

    <!-- Progress bar -->
    <div style="background:#333;border-radius:3px;height:6px;overflow:hidden;margin-bottom:10px">
      <div style="background:${barColor};height:100%;width:${pctIn}%;transition:width 0.3s;border-radius:3px"></div>
    </div>

    <!-- Legend -->
    <div style="display:flex;gap:16px;margin-bottom:10px;padding:6px 8px;background:#222;border-radius:4px">
      <span style="font-size:9px;color:#4ecdc4;font-weight:600">● Within Range <span style="color:#666">(${bm.inCount})</span></span>
      <span style="font-size:9px;color:#e8c87a;font-weight:600">● Below Range <span style="color:#666">(${belowCount})</span></span>
      <span style="font-size:9px;color:#c44;font-weight:600">● Above Range <span style="color:#666">(${aboveCount})</span></span>
    </div>

    <!-- Per-metric cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px">`;

  bm.checks.forEach(c=>{
    const colors={in:'#4ecdc4',below:'#e8c87a',above:'#c44'};
    const bgColors={in:'rgba(78,205,196,0.06)',below:'rgba(232,200,122,0.08)',above:'rgba(204,68,68,0.08)'};
    const borderColors={in:'#333',below:'#5a4a20',above:'#5a2020'};
    const statusLabels={in:'In Range',below:'Below',above:'Above'};
    const col=colors[c.status];
    const actualStr=fmtBenchVal(c.actual,c.key);
    const rangeStr=fmtRange(c);

    html+=`<div style="background:${bgColors[c.status]};border:1px solid ${borderColors[c.status]};border-radius:4px;padding:6px 8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
        <span style="font-size:9px;color:#aaa;font-weight:600">${c.label}</span>
        <span style="font-size:8px;font-weight:700;color:${col};background:${bgColors[c.status]};padding:1px 5px;border-radius:3px;border:1px solid ${col}33">${statusLabels[c.status]}</span>
      </div>
      <div style="font-size:12px;font-weight:700;color:${col}">${actualStr}</div>
      <div style="font-size:8px;color:#666;margin-top:1px">Range: ${rangeStr}</div>
    </div>`;
  });

  html+=`</div></div>`;
  return html;
}

// ── Approvals Timeline Presets (Toronto) ──
// Each phase has startMonth (explicit position) + months (duration) + costPct (% of construction cost)
const TIMELINE_ASOFRIGHT = [
  {id:'preapp',      label:'Pre-application',          startMonth:0,  months:2,  costPct:0.01},
  {id:'spa',         label:'Site Plan Approval',       startMonth:2,  months:9,  costPct:0.02},
  {id:'permit',      label:'Building Permit',          startMonth:11, months:4,  costPct:0.01},
  {id:'shoring',     label:'Shoring & Excavation',     startMonth:15, months:4,  costPct:0.08},
  {id:'belowGrade',  label:'Below-Grade Structure',    startMonth:19, months:6,  costPct:0.12},
  {id:'aboveGrade',  label:'Above-Grade Structure',    startMonth:25, months:12, costPct:0.30},
  {id:'envelope',    label:'Building Envelope',        startMonth:27, months:8,  costPct:0.15},
  {id:'fitout',      label:'Interior Fit-Out',         startMonth:28, months:10, costPct:0.22},
  {id:'commission',  label:'Commissioning & Occupancy',startMonth:37, months:2,  costPct:0.07},
  {id:'deficiency',  label:'Deficiency Holdback',      startMonth:39, months:6,  costPct:0.02},
];

const TIMELINE_ZBLA = [
  {id:'preapp',      label:'Pre-application',          startMonth:0,  months:2,  costPct:0.01},
  {id:'zbla',        label:'OPA / ZBLA',               startMonth:2,  months:14, costPct:0.02},
  {id:'spa',         label:'Site Plan Approval',       startMonth:16, months:9,  costPct:0.02},
  {id:'permit',      label:'Building Permit',          startMonth:25, months:5,  costPct:0.01},
  {id:'shoring',     label:'Shoring & Excavation',     startMonth:30, months:4,  costPct:0.07},
  {id:'belowGrade',  label:'Below-Grade Structure',    startMonth:34, months:6,  costPct:0.10},
  {id:'aboveGrade',  label:'Above-Grade Structure',    startMonth:40, months:12, costPct:0.28},
  {id:'envelope',    label:'Building Envelope',        startMonth:42, months:8,  costPct:0.14},
  {id:'fitout',      label:'Interior Fit-Out',         startMonth:43, months:10, costPct:0.20},
  {id:'commission',  label:'Commissioning & Occupancy',startMonth:52, months:2,  costPct:0.07},
  {id:'deficiency',  label:'Deficiency Holdback',      startMonth:54, months:6,  costPct:0.02},
];


// Track whether user has manually edited DCF phases
let _dcfPhasesManuallyEdited=false;
// Track last auto-applied timeline type so we don't re-apply on every render
let _lastAutoTimeline=null;
// Drag state for interactive Gantt bars
let _ganttDragState=null;
// Cleanup function for Gantt event listeners
let _ganttCleanup=null;

// ══════════════════════════════════════════════════════════════════════
// CONSTRUCTION SCHEDULING ENGINE — Residential Developments (Ontario)
// Typology-aware, Altus 2025 Canadian Cost Guide-aligned.
// Sources: Planning Planet, Canadian Consulting Engineer (Yolles, Toronto),
//          Altus 2025 Canadian Cost Guide, Toronto shoring contractor benchmarks.
// ══════════════════════════════════════════════════════════════════════

// Seasonal factors for shoring/excavation (start_month → multiplier)
const SEASONAL_MONTH_FACTORS={1:1.30,2:1.30,3:1.15,4:1.15,5:1.05,6:1.00,7:1.00,8:1.00,9:1.05,10:1.05,11:1.15,12:1.30};
// Named seasons map to a representative month for backward compat
const SEASONAL_FACTORS={spring:1.10, summer:1.00, fall:1.05, winter:1.30};

// Structural cycle rates (days per floor, single shift, 5-day week)
// 1 week per floor = 5 working days is the standard concrete cycle (flying form)
const CYCLE_RATES={wood_frame:3.0, concrete_flat_slab:5.0, concrete_slab_beam:7.0};
// Legacy slab type mapping
const SLAB_TO_CONSTRUCTION={flat:'concrete_flat_slab', beam:'concrete_slab_beam', wood:'wood_frame'};

// Typology thresholds (aligned to Altus 2025 storey bands)
const TYPOLOGY_RANGES={
  LOW_RISE_WOOD:{min:1,max:6},
  MID_RISE:{min:7,max:12},
  HIGH_RISE_12:{min:13,max:39},
  HIGH_RISE_40:{min:40,max:60},
  SUPERTALL:{min:61,max:999}
};

// Per-typology rates
const TYPO_RATES={
  LOW_RISE_WOOD:  {W_env:0.4, envLagFloors:2,  W_fit:1.2, fitTail:6,  fitLagFloors:3,  commBase:4, commPerFloor:0.15},
  MID_RISE:       {W_env:0.5, envLagFloors:4,  W_fit:1.0, fitTail:8,  fitLagFloors:6,  commBase:6, commPerFloor:0.15},
  HIGH_RISE_12:   {W_env:0.6, envLagFloors:8,  W_fit:0.8, fitTail:10, fitLagFloors:12, commBase:8, commPerFloor:0.15},
  HIGH_RISE_40:   {W_env:0.55,envLagFloors:10, W_fit:0.7, fitTail:12, fitLagFloors:15, commBase:10,commPerFloor:0.15},
  SUPERTALL:      {W_env:0.5, envLagFloors:12, W_fit:0.65,fitTail:14, fitLagFloors:18, commBase:12,commPerFloor:0.15}
};

// Benchmark duration ranges (months) for validation
const DURATION_BENCHMARKS={
  LOW_RISE_WOOD: [8,20],
  MID_RISE:      [18,28],
  HIGH_RISE_12:  [24,36],
  HIGH_RISE_40:  [30,44],
  SUPERTALL:     [36,54]
};

/**
 * Auto-detect typology from storey count.
 * @param {number} N_above — storeys above grade
 * @returns {string} typology key
 */
function detectTypology(N_above){
  if(N_above<=6)  return 'LOW_RISE_WOOD';
  if(N_above<=12) return 'MID_RISE';
  if(N_above<=39) return 'HIGH_RISE_12';
  if(N_above<=60) return 'HIGH_RISE_40';
  return 'SUPERTALL';
}

/**
 * Auto-detect construction type from typology (unless user overrides).
 * @param {string} typology
 * @returns {string} construction_type
 */
function detectConstructionType(typology){
  if(typology==='LOW_RISE_WOOD') return 'wood_frame';
  return 'concrete_flat_slab'; // default for all concrete typologies
}

/**
 * Compute empirically-derived construction phase durations.
 * Full scheduling engine aligned with Altus 2025 typology bands.
 *
 * @param {Object} params
 * @param {number} params.floorsAbove       — Total storeys above grade (N_above)
 * @param {number} params.floorsBelow       — Parking levels below grade (N_below)
 * @param {number} params.footprintSF       — Typical above-grade floor plate in sq ft
 * @param {number} [params.footprintBelowSF] — Below-grade floor plate (defaults to footprintSF × 1.3)
 * @param {number} params.podiumFloors      — Number of podium levels (0 if none)
 * @param {number} [params.nTowers]         — Number of towers sharing podium (default 1)
 * @param {string} [params.slabType]        — Legacy: 'flat' or 'beam' (mapped to construction_type)
 * @param {string} [params.constructionType] — 'wood_frame','concrete_flat_slab','concrete_slab_beam','hybrid_wood_concrete'
 * @param {string} [params.startSeason]     — 'spring','summer','fall','winter' (legacy)
 * @param {number} [params.startMonth]      — 1-12 (overrides startSeason if provided)
 * @param {number} [params.contingencyPct]  — Schedule contingency (0.10-0.30, default 0.20)
 * @param {number} [params.GFA_sqft]        — Total GFA in sq ft (for cost estimate)
 * @param {string} [params.typology]        — Override typology (auto-detected from floorsAbove if omitted)
 * @param {string} [params.shoringMethod]   — 'soldier_pile' (3.5w), 'secant_wall' (4.5w), 'open_cut' (2.0w)
 * @returns {Object} Phase durations in months, lag offsets, critical path, cost estimates, and flags
 */
function calcConstructionSchedule(params){
  const {floorsAbove, floorsBelow, footprintSF, podiumFloors, slabType, startSeason, contingencyPct}=params;
  const footprintBelowSF=params.footprintBelowSF||(footprintSF*1.3);
  const nTowers=params.nTowers||1;
  const GFA_sqft=params.GFA_sqft||0;
  const WK=4.33; // weeks per month

  // ── Typology detection ──
  const typology=params.typology||detectTypology(floorsAbove);
  const typoRates=TYPO_RATES[typology]||TYPO_RATES.MID_RISE;

  // Cross-check typology vs floorsAbove
  let typologyMismatch=null;
  const expectedTypo=detectTypology(floorsAbove);
  if(typology!==expectedTypo){
    typologyMismatch='Provided typology '+typology+' conflicts with N_above='+floorsAbove+' (expected '+expectedTypo+'). Using provided typology.';
  }

  // ── Construction type & cycle rate ──
  let constructionType=params.constructionType||(slabType?SLAB_TO_CONSTRUCTION[slabType]:null)||detectConstructionType(typology);
  const isHybrid=constructionType==='hybrid_wood_concrete';
  const cycleDays_concrete=CYCLE_RATES[isHybrid?'concrete_slab_beam':'concrete_flat_slab']||5.5;
  const cycleDays_wood=CYCLE_RATES.wood_frame;
  const cycleDays=constructionType==='wood_frame'?cycleDays_wood:
                  constructionType==='concrete_slab_beam'?CYCLE_RATES.concrete_slab_beam:
                  CYCLE_RATES.concrete_flat_slab;

  // ── Seasonal factor ──
  let sFactor;
  if(params.startMonth){
    sFactor=SEASONAL_MONTH_FACTORS[params.startMonth]||1.05;
  } else {
    sFactor=SEASONAL_FACTORS[startSeason]||1.05;
  }

  // ── Shoring method ──
  const shoringMethods={soldier_pile:'soldier_pile', secant_wall:'secant_wall', open_cut:'open_cut'};
  const shoringMethod=shoringMethods[params.shoringMethod]||'soldier_pile';

  // ══════════════════════════════════════════════════════════════════
  // PHASE 1: SHORING & EXCAVATION
  // ══════════════════════════════════════════════════════════════════
  // Flat 3 months for shoring & excavation on typical urban sites.
  let T_shoring_mo=0;
  if(floorsBelow>0){
    T_shoring_mo=3;
  }
  const T_shoring_wk=T_shoring_mo*WK;
  const T_shoring=T_shoring_mo;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 2: BELOW-GRADE STRUCTURE
  // ══════════════════════════════════════════════════════════════════
  // Foundation walls, parking slabs, waterproofing, backfill.
  // Typically 3–5 months depending on depth.
  let T_below_wk;
  if(floorsBelow>0){
    // T_below = (A_below_sqft / R_production) / 5 + N_below × C_cure
    // All sqft — no metric conversion. 1,615 sqft/day = 150 sqm/day equivalent.
    const A_below_sqft=footprintBelowSF*floorsBelow;
    const R_production=1615; // sqft per working day
    const C_cure=2.5;        // weeks per level (forming, pouring, curing, stripping)
    T_below_wk=(A_below_sqft/R_production)/5+floorsBelow*C_cure;
  } else {
    // Slab-on-grade foundation: 3-6 weeks
    T_below_wk=Math.max(3, Math.min(6, footprintSF/5000));
  }
  const T_below=T_below_wk/WK;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 3: ABOVE-GRADE STRUCTURE
  // ══════════════════════════════════════════════════════════════════
  const P_podium=1.35; // podium penalty factor
  const nPodium=Math.min(podiumFloors, floorsAbove);
  const nTowerFloors=Math.max(0, floorsAbove-nPodium);
  let T_above_wk;

  if(constructionType==='wood_frame'){
    // Wood frame — no podium penalty, simpler cycle
    T_above_wk=floorsAbove*cycleDays_wood/5;
  } else if(isHybrid){
    // Hybrid: concrete podium + wood tower
    T_above_wk=(nPodium*cycleDays_concrete*P_podium+nTowerFloors*cycleDays_wood)/5;
  } else {
    // Full concrete — podium + tower(s)
    if(nTowers>1){
      // Multi-tower: towers assumed in parallel once podium complete
      T_above_wk=(nPodium*cycleDays*P_podium+nTowerFloors*cycleDays)/5;
    } else {
      T_above_wk=(nPodium*cycleDays*P_podium+nTowerFloors*cycleDays)/5;
    }
  }
  const T_above=T_above_wk/WK;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 4: BUILDING ENVELOPE (overlaps structure)
  // ══════════════════════════════════════════════════════════════════
  const T_envelope_wk=floorsAbove*typoRates.W_env;
  const T_envelope=T_envelope_wk/WK;
  const envLagFloors=typoRates.envLagFloors;
  const lag_envelope_wk=envLagFloors*cycleDays/5;
  const lag_envelope=lag_envelope_wk/WK;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 5: INTERIOR FIT-OUT (overlaps structure)
  // ══════════════════════════════════════════════════════════════════
  const T_fitout_wk=floorsAbove*typoRates.W_fit+typoRates.fitTail;
  const T_fitout=T_fitout_wk/WK;
  const fitLagFloors=typoRates.fitLagFloors;
  const lag_fitout_wk=fitLagFloors*cycleDays/5;
  const lag_fitout=lag_fitout_wk/WK;

  // ══════════════════════════════════════════════════════════════════
  // PHASE 6: COMMISSIONING & OCCUPANCY
  // ══════════════════════════════════════════════════════════════════
  const T_commission_wk=typoRates.commBase+floorsAbove*typoRates.commPerFloor;
  const T_commission=T_commission_wk/WK;

  // Deficiency holdback (fixed)
  const T_deficiency=6; // months (Tarion enrollment + deficiency walkthroughs)

  // ══════════════════════════════════════════════════════════════════
  // CRITICAL PATH CALCULATION
  // ══════════════════════════════════════════════════════════════════
  // Sequential: Shoring → Below-Grade → Above-Grade start
  // Parallel: Envelope and Fit-Out trail structure with lag offsets
  const structure_end=T_shoring+T_below+T_above;
  const envelope_end=T_shoring+T_below+lag_envelope+T_envelope;
  const fitout_end=T_shoring+T_below+lag_fitout+T_fitout;
  // Commissioning trails fit-out (or structure, whichever is later)
  const preCommission=Math.max(structure_end, envelope_end, fitout_end);
  const T_critical_path_months=preCommission;

  // Apply contingency
  const contingency=contingencyPct!=null?contingencyPct:0.20;
  const T_total_with_contingency=T_critical_path_months*(1+contingency);

  // ══════════════════════════════════════════════════════════════════
  // COST ESTIMATE (Altus 2025, city-aware)
  // ══════════════════════════════════════════════════════════════════
  let costEstimate=null;
  if(GFA_sqft>0){
    const city=getCurrentAltusCity();
    const costRange=getAltusCostRange(city.id, floorsAbove);
    const parkingRange=ALTUS_PARKING[city.id]||ALTUS_PARKING.gta;
    const aboveLow=GFA_sqft*costRange.low;
    const aboveHigh=GFA_sqft*costRange.high;
    const belowArea=footprintBelowSF*floorsBelow;
    const belowLow=belowArea*parkingRange.low;
    const belowHigh=belowArea*parkingRange.high;
    costEstimate={
      above_grade_low:aboveLow, above_grade_high:aboveHigh,
      below_grade_low:belowLow, below_grade_high:belowHigh,
      total_low:aboveLow+belowLow, total_high:aboveHigh+belowHigh,
      city:city.label, costRange:costRange,
      note:'Hard costs only (Altus 2025 — '+city.label+'). Excludes soft costs, land, HST, permits, DCs.'
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // BENCHMARK VALIDATION
  // ══════════════════════════════════════════════════════════════════
  // Benchmarks are total construction duration including commissioning + deficiency
  const fullScheduleMonths=T_total_with_contingency+T_commission+T_deficiency;
  const benchRange=DURATION_BENCHMARKS[typology]||[18,36];
  const critMonths=Math.round(fullScheduleMonths);
  const flags=[];
  if(typologyMismatch) flags.push(typologyMismatch);
  if(critMonths<benchRange[0]*0.7) flags.push('Duration '+critMonths+'mo is >30% below benchmark '+benchRange[0]+'-'+benchRange[1]+'mo for '+typology);
  if(critMonths>benchRange[1]*1.3) flags.push('Duration '+critMonths+'mo is >30% above benchmark '+benchRange[0]+'-'+benchRange[1]+'mo for '+typology);

  // ══════════════════════════════════════════════════════════════════
  // RETURN
  // ══════════════════════════════════════════════════════════════════
  const rnd1=v=>Math.round(v*10)/10;
  return {
    // Phase durations (months)
    shoring:    rnd1(T_shoring),
    belowGrade: rnd1(T_below),
    aboveGrade: rnd1(T_above),
    envelope:   rnd1(T_envelope),
    fitout:     rnd1(T_fitout),
    commission: rnd1(T_commission),
    deficiency: T_deficiency,
    // Lag offsets (months from above-grade start)
    envelopeLag: rnd1(lag_envelope),
    fitoutLag:   rnd1(lag_fitout),
    // Summaries
    criticalPath:  rnd1(T_critical_path_months),
    withContingency: rnd1(T_total_with_contingency),
    contingencyMonths: rnd1(T_total_with_contingency-T_critical_path_months),
    // Raw weeks for display
    shoringWk:   rnd1(T_shoring_wk),
    belowGradeWk:rnd1(T_below_wk),
    aboveGradeWk:rnd1(T_above_wk),
    envelopeWk:  rnd1(T_envelope_wk),
    fitoutWk:    rnd1(T_fitout_wk),
    commissionWk:rnd1(T_commission_wk),
    // Phase start/end (weeks, for Gantt)
    phases_wk:{
      shoring_excavation:   {start:0,                                          dur:rnd1(T_shoring_wk)},
      below_grade_structure:{start:rnd1(T_shoring_wk),                          dur:rnd1(T_below_wk)},
      above_grade_structure:{start:rnd1(T_shoring_wk+T_below_wk),               dur:rnd1(T_above_wk)},
      building_envelope:    {start:rnd1(T_shoring_wk+T_below_wk+lag_envelope_wk),dur:rnd1(T_envelope_wk)},
      interior_fitout:      {start:rnd1(T_shoring_wk+T_below_wk+lag_fitout_wk), dur:rnd1(T_fitout_wk)},
      commissioning:        {start:rnd1(preCommission*WK),                       dur:rnd1(T_commission_wk)}
    },
    // Typology & construction info
    typology, constructionType, typologyMismatch,
    // Input echo
    cycleDays, sFactor, nPodium, nTower:nTowerFloors, nTowers, floorsAbove, floorsBelow, footprintSF,
    footprintBelowSF, shoringMethod:params.shoringMethod||'soldier_pile',
    envLagFloors, fitLagFloors, P_podium,
    // Cost estimate
    costEstimate,
    // Benchmark
    benchmarkRange:benchRange,
    flags
  };
}

// ══════════════════════════════════════════════════════════════════════
// TORONTO DEVELOPMENT CHARGES — DEEP CALCULATOR
// Source: City of Toronto DC By-law, Rates Effective June 6 2024
// https://www.toronto.ca/city-government/budget-finances/city-finance/development-charges/
// ══════════════════════════════════════════════════════════════════════
const TO_DC_RATES={
  effectiveDate:'2024-06-06',
  // Residential NON-RENTAL apartment rates per unit by service category
  // Unit types: 'bachelor_1bed' (bachelor & 1-bedroom), 'two_plus_bed' (2+ bedroom)
  residential:{
    services:[
      {id:'spadina',    label:'Spadina Subway Extension',       bachelor_1bed:1675,  two_plus_bed:2368},
      {id:'transit',    label:'Transit (Balance)',              bachelor_1bed:20322, two_plus_bed:28711},
      {id:'parks',      label:'Parks & Recreation',            bachelor_1bed:7738,  two_plus_bed:10933},
      {id:'library',    label:'Library',                       bachelor_1bed:1064,  two_plus_bed:1503},
      {id:'shelter',    label:'Housing Services — Shelter',    bachelor_1bed:0,     two_plus_bed:0},
      {id:'affordable', label:'Housing Services — Affordable', bachelor_1bed:0,     two_plus_bed:0},
      {id:'police',     label:'Police',                        bachelor_1bed:295,   two_plus_bed:417},
      {id:'fire',       label:'Fire',                          bachelor_1bed:112,   two_plus_bed:158},
      {id:'paramedic',  label:'Paramedic',                     bachelor_1bed:91,    two_plus_bed:129},
      {id:'devRelated', label:'Development-Related Studies',   bachelor_1bed:47,    two_plus_bed:66}
    ],
    // Totals: bachelor_1bed = 31,344  two_plus_bed = 44,285
  },
  // Education DC rates (per unit) — TDSB + TCDSB combined
  education:{
    label:'Education Development Charges',
    tdsb:{label:'TDSB (Public)',  bachelor_1bed:2798, two_plus_bed:5177},
    tcdsb:{label:'TCDSB (Catholic)', bachelor_1bed:1421, two_plus_bed:2629},
    // Totals: bachelor_1bed = 4,219  two_plus_bed = 7,806
  },
  // Non-residential (commercial/retail/office) rates per sq ft of GFA
  commercial:{
    services:[
      {id:'spadina',    label:'Spadina Subway Extension',       perSF:1.83},
      {id:'transit',    label:'Transit (Balance)',              perSF:22.19},
      {id:'parks',      label:'Parks & Recreation',            perSF:0.00},
      {id:'library',    label:'Library',                       perSF:0.79},
      {id:'police',     label:'Police',                        perSF:0.32},
      {id:'fire',       label:'Fire',                          perSF:0.12},
      {id:'paramedic',  label:'Paramedic',                     perSF:0.10},
      {id:'devRelated', label:'Development-Related Studies',   perSF:0.05}
    ],
    // Total: ~25.40 /sf
    education:{label:'Education DC (Commercial)', perSF:1.64}
  }
};

/**
 * Calculate a detailed Development Charge schedule per Toronto DC By-law rates.
 * @param {Array<Object>} unitMix - Array of unit objects with type and count.
 * @param {number} commGFA - Commercial gross floor area in square feet.
 * @returns {Object} Breakdown of residential/commercial DCs by service category with grandTotal.
 */
function calcDCSchedule(unitMix, commGFA){
  const result={resiServices:[], eduResi:[], commServices:[], eduComm:null,
    totalResi:0, totalEduResi:0, totalComm:0, totalEduComm:0, grandTotal:0};

  // Count units by DC category
  let bachelor1bed=0, twoPlus=0;
  unitMix.forEach(u=>{
    // Studio and 1-Bedroom → bachelor_1bed rate; 1-Bed+Den and above → two_plus_bed rate
    if(u.type==='Studio'||u.type==='1-Bedroom'){
      bachelor1bed+=u.count;
    } else {
      twoPlus+=u.count;
    }
  });

  // Residential DC by service category
  TO_DC_RATES.residential.services.forEach(svc=>{
    const amt=bachelor1bed*svc.bachelor_1bed + twoPlus*svc.two_plus_bed;
    result.resiServices.push({
      id:svc.id, label:svc.label,
      bachelor1bedUnits:bachelor1bed, twoPlus:twoPlus,
      bachelor1bedRate:svc.bachelor_1bed, twoPlusRate:svc.two_plus_bed,
      amount:amt
    });
    result.totalResi+=amt;
  });

  // Education DC — residential
  const edu=TO_DC_RATES.education;
  const tdsbAmt=bachelor1bed*edu.tdsb.bachelor_1bed + twoPlus*edu.tdsb.two_plus_bed;
  const tcdsbAmt=bachelor1bed*edu.tcdsb.bachelor_1bed + twoPlus*edu.tcdsb.two_plus_bed;
  result.eduResi.push({label:edu.tdsb.label, amount:tdsbAmt});
  result.eduResi.push({label:edu.tcdsb.label, amount:tcdsbAmt});
  result.totalEduResi=tdsbAmt+tcdsbAmt;

  // Commercial DC by service category
  TO_DC_RATES.commercial.services.forEach(svc=>{
    const amt=commGFA*svc.perSF;
    result.commServices.push({id:svc.id, label:svc.label, perSF:svc.perSF, gfa:commGFA, amount:amt});
    result.totalComm+=amt;
  });
  // Commercial education DC
  const commEduAmt=commGFA*TO_DC_RATES.commercial.education.perSF;
  result.eduComm={label:TO_DC_RATES.commercial.education.label, perSF:TO_DC_RATES.commercial.education.perSF, amount:commEduAmt};
  result.totalEduComm=commEduAmt;

  result.grandTotal=result.totalResi+result.totalEduResi+result.totalComm+result.totalEduComm;

  // Summary by unit type
  const perUnit1bed=TO_DC_RATES.residential.services.reduce((s,svc)=>s+svc.bachelor_1bed,0)+edu.tdsb.bachelor_1bed+edu.tcdsb.bachelor_1bed;
  const perUnit2plus=TO_DC_RATES.residential.services.reduce((s,svc)=>s+svc.two_plus_bed,0)+edu.tdsb.two_plus_bed+edu.tcdsb.two_plus_bed;
  result.summary={
    bachelor1bedCount:bachelor1bed, twoPlusCount:twoPlus,
    perUnitBachelor1bed:perUnit1bed, perUnitTwoPlus:perUnit2plus,
    avgPerUnit:(bachelor1bed+twoPlus)>0?
      (bachelor1bed*perUnit1bed+twoPlus*perUnit2plus)/(bachelor1bed+twoPlus):0,
    commPerSF:TO_DC_RATES.commercial.services.reduce((s,svc)=>s+svc.perSF,0)+TO_DC_RATES.commercial.education.perSF
  };

  return result;
}

let _pfCache=null; // cached pfCalc result — cleared on every rebuild, read by all tabs
/**
 * Return the cached pro-forma result, computing it if the cache has been invalidated.
 * @returns {Object} The current pfCalc() result.
 */
function pfData(){
  if(!_pfCache){
    _pfCache=pfCalc();
  }
  return _pfCache;
}


/**
 * Run the full pro-forma calculation for the current project.
 * Derives revenue, costs, financing, and margins from massing model GFA and P.pf assumptions.
 * @returns {Object} Complete pro-forma result with totalGFA, unitMix, revenues, costs, financing, margin, and marginOnCost.
 */
function pfCalc(){
  const gfaData=computeGFA();
  const totalGFA=gfaData.totalGFA||0;
  const commGFA=gfaData.commGFA||0;
  const resiGFA=totalGFA-commGFA;
  const siteArea=lotArea();
  const fsi=siteArea>0?totalGFA/siteArea:0;
  const pf=P.pf;

  // ── Deductions from residential GFA to get sellable area ──
  const maxSt=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
  const resiFloors=Math.max(1,maxSt-(P.vols.some(v=>v.commGF)?1:0));
  // Per-floor deductions (estimated)
  const corridorPct=0.15;    // 15% of each floor for corridors/hallways
  const elevatorSF=(P.core.numElevators||0)*75;   // elevator shafts × 75 sf each
  const stairSF=(P.core.stairs?P.core.stairs.length:0)*150; // stairwells × 150 sf each
  const lobbyDeduct=resiGFA>0?Math.min(2500,resiGFA*0.02):0; // ~2% or max 2500sf for lobby
  const amenityDeduct=resiGFA>0?Math.min(5000,resiGFA*0.04):0; // ~4% or max 5000sf for amenity
  const corridorTotal=resiGFA*corridorPct;
  const coreTotal=(elevatorSF+stairSF)*resiFloors;
  const totalDeductions=corridorTotal+coreTotal+lobbyDeduct+amenityDeduct;
  const sellableResiSF=Math.max(0,resiGFA-totalDeductions);

  // ── Unit mix — auto-fill to sellable area ──
  // Default unit sizes (used only if user hasn't set a custom size)
  const defaultSizes={Studio:450,'1-Bedroom':550,'1-Bed+Den':650,'2-Bedroom':750,'2-Bed+Den':875,'3-Bedroom':900};
  // Only apply default if the unit doesn't already have a valid size set by the user
  pf.units.forEach(u=>{if(!u.size||u.size<=0) u.size=defaultSizes[u.type]||550;});

  // Default mix percentages (by unit count) — used when no manual locks
  const defaultPcts={Studio:0.10,'1-Bedroom':0.35,'1-Bed+Den':0.20,'2-Bedroom':0.25,'3-Bedroom':0.10};

  // Check which units have manual (locked) counts
  if(!pf._locked) pf._locked={};
  const locked=pf._locked;

  // Calculate: locked units consume SF first, remaining SF distributed to unlocked types
  let lockedSF=0, lockedCount=0;
  const lockedTypes=[];
  const unlockedTypes=[];
  pf.units.forEach(u=>{
    if(locked[u.type]){
      lockedSF+=u.count*u.size;
      lockedCount+=u.count;
      lockedTypes.push(u);
    } else {
      unlockedTypes.push(u);
    }
  });

  const remainingSF=Math.max(0,sellableResiSF-lockedSF);

  // Distribute remaining SF to unlocked types by their default proportions
  const unlockedTotalPct=unlockedTypes.reduce((s,u)=>s+(defaultPcts[u.type]||0.1),0);
  unlockedTypes.forEach(u=>{
    const pctShare=(defaultPcts[u.type]||0.1)/unlockedTotalPct;
    const sfShare=remainingSF*pctShare;
    u.count=Math.max(0,Math.floor(sfShare/u.size));
  });

  // Verify total doesn't exceed sellable — trim last unlocked type if needed
  let totalUsedSF=pf.units.reduce((s,u)=>s+u.count*u.size,0);
  if(totalUsedSF>sellableResiSF && unlockedTypes.length>0){
    const excess=totalUsedSF-sellableResiSF;
    const last=unlockedTypes[unlockedTypes.length-1];
    const reduceBy=Math.ceil(excess/last.size);
    last.count=Math.max(0,last.count-reduceBy);
  }

  // Override unit counts from floor-by-floor editor if in manual mode
  if(P.unitPlan&&P.unitPlan.mode==='manual'&&P.unitPlan.floors.length>0){
    const manualCounts={};
    P.unitPlan.floors.forEach(f=>f.units.forEach(u=>{manualCounts[u.type]=(manualCounts[u.type]||0)+1;}));
    pf.units.forEach(u=>{if(manualCounts[u.type]!==undefined)u.count=manualCounts[u.type];});
  }

  const unitMix=pf.units.map(u=>{
    return {...u,revenue:u.count*u.size*u.psf,isLocked:!!locked[u.type]};
  });
  const totalUnits=unitMix.reduce((s,u)=>s+u.count,0);
  const netResiSF=unitMix.reduce((s,u)=>s+u.count*u.size,0);
  const resiRevenue=unitMix.reduce((s,u)=>s+u.revenue,0);

  // Commercial revenue — deduct GF building services from gross commercial area
  // Ground floor must accommodate: lobby/mailroom, elevator landings, stairs, mechanical, garbage, bike room
  const gfLobby=650;        // lobby & mailroom
  const gfElevLanding=(P.core.numElevators||0)*50; // elevator landings × 50sf each
  const gfStairs=(P.core.stairs?P.core.stairs.length:0)*110; // stairwells × 110sf each
  const gfMech=500;         // main mechanical/electrical
  const gfGarbage=250;      // garbage/recycling room
  const gfBikeRoom=400;     // bicycle parking room
  const gfLoading=350;      // loading area (Type G)
  const gfTotalDeduct=gfLobby+gfElevLanding+gfStairs+gfMech+gfGarbage+gfBikeRoom+gfLoading;
  const netLeasableComm=Math.max(0,commGFA-gfTotalDeduct);
  const commTenants=pf.comm.map(t=>{
    const area=netLeasableComm*t.pct;
    const noi=area*t.rent;
    const value=t.cap>0?noi/t.cap:0;
    return {...t,area,noi,value};
  });
  const totalCommNOI=commTenants.reduce((s,t)=>s+t.noi,0);
  const totalCommValue=commTenants.reduce((s,t)=>s+t.value,0);

  // Ancillary
  const parkSpaces=Math.round(totalUnits*pf.parkRatio);
  const lockers=Math.round(totalUnits*pf.lockerRatio);
  const parkRev=parkSpaces*pf.parkPrice;
  const lockerRev=lockers*pf.lockerPrice;
  const totalGrossRev=resiRevenue+totalCommValue+parkRev+lockerRev;

  // Land
  const ltt=pf.landPrice*pf.lttRate;
  const totalLand=pf.landPrice+ltt+pf.ddCost;

  // ── Hard Costs — simple $/sf × GFA ──
  // User sets a single $/sf rate (default $350). Benchmark is always $350/sf.
  // All itemized breakdowns removed — user controls one number.
  if(!pf.hardCostPSF) pf.hardCostPSF=350; // default $350/sf
  const altusCity = getCurrentAltusCity();
  const altusCostRange = getAltusCostRange(altusCity.id, maxSt);
  const hardCostPSF=pf.hardCostPSF;
  const totalHard=hardCostPSF*totalGFA;
  const heightMultiplier=1.0; // no longer used — kept for compatibility

  // ── Soft Costs — % of hard + explicit development charges ──
  // Defaults aligned with project-init values at line 175 (formerly inconsistent — bug fix).
  if(pf.softCostPct == null) pf.softCostPct=0.275; // 27.5% of hard (matches default model — was incorrectly 0.20)
  if(pf.dcPerUnit   == null) pf.dcPerUnit=45000;   // $45K/unit
  if(pf.dcCommPerSF == null) pf.dcCommPerSF=44;    // $44/sf commercial
  if(pf.s37PerUnit  == null) pf.s37PerUnit=7300;   // CBC / S37 per unit
  if(pf.parkland    == null) pf.parkland=2200000;  // parkland dedication ($2.2M default — was incorrectly 0)
  const softCostPct=pf.softCostPct;
  const softCostBase=totalHard*softCostPct; // A&E, PM, legal, insurance, permits, contingency
  const dcResi=totalUnits*(pf.dcPerUnit||0);
  const dcComm=commGFA*(pf.dcCommPerSF||0);
  const dcTotal=dcResi+dcComm;
  const s37Total=totalUnits*(pf.s37PerUnit||0);
  const parklandCost=pf.parkland||0;
  const totalSoft=softCostBase+dcTotal+s37Total+parklandCost;

  // ── Construction Schedule — empirical equations ──
  // Derive building parameters from massing model
  const _footprintSF=P.vols.reduce((m,v)=>Math.max(m,(v.customAreaSF||(v.width*v.depth))),0);
  // Use real lot area; fall back to 10,000sf only when lot polygon is genuinely missing.
  // Bug fix: previously checked P.lot.length but P.lot is an object — always fell back to 10k.
  const _lotAreaSF=(P.lot && P.lot.gpsVerts && P.lot.gpsVerts.length>=3) || (typeof lotArea==='function' && lotArea()>0)
    ? Math.max(1, lotArea())
    : 10000;
  const _belowGradeLevels=Math.max(1,Math.ceil((parkSpaces||0)*350/_lotAreaSF)); // ~350sf/stall, all in sqft
  // Auto-detect podium: count volumes with ground-floor commercial or > 1 storey difference from tallest
  const _autoPodiumFloors=P.vols.reduce((m,v)=>{
    if(v.podiumStoreys>0) return Math.max(m,v.podiumStoreys);
    if(v.groundFloor==='commercial'||v.type==='podium') return Math.max(m,3);
    return m;
  },0);
  const _podiumFloors=pf.podiumFloors>0?pf.podiumFloors:_autoPodiumFloors;

  // Compute empirical schedule (full scheduling engine)
  const _conSched=calcConstructionSchedule({
    floorsAbove:maxSt, floorsBelow:_belowGradeLevels, footprintSF:_footprintSF,
    footprintBelowSF:_footprintSF*1.3,
    podiumFloors:_podiumFloors,
    nTowers:P.vols.length||1,
    slabType:pf.slabType||'flat',
    constructionType:pf.constructionType||null,
    startSeason:pf.startSeason||'spring',
    startMonth:pf.startMonth||null,
    contingencyPct:pf.contingencyPct!=null?pf.contingencyPct:0.20,
    GFA_sqft:totalGFA,
    typology:pf.typology||null,
    shoringMethod:pf.shoringMethod||'soldier_pile'
  });

  // Apply computed durations + positions to DCF phases (unless user manually edited)
  ensureDCFDefaults();
  const dcfPhases=pf.dcf.phases;
  if(!_dcfPhasesManuallyEdited){
    const _phMap={shoring:_conSched.shoring,belowGrade:_conSched.belowGrade,
      aboveGrade:_conSched.aboveGrade,envelope:_conSched.envelope,
      fitout:_conSched.fitout,commission:_conSched.commission,deficiency:_conSched.deficiency};
    dcfPhases.forEach(ph=>{if(_phMap[ph.id]!==undefined) ph.months=Math.max(1,Math.round(_phMap[ph.id]));});
    // Recompute sequential startMonth positions from the preset
    let cursor=0;
    const envLag=_conSched.envelopeLag||2;
    const fitLag=_conSched.fitoutLag||3;
    let agStart=0;
    dcfPhases.forEach(ph=>{
      if(ph.id==='envelope'){ph.startMonth=Math.round(agStart+envLag);return;}
      if(ph.id==='fitout'){ph.startMonth=Math.round(agStart+fitLag);return;}
      ph.startMonth=cursor;
      if(ph.id==='aboveGrade') agStart=cursor;
      cursor+=ph.months;
    });
  }

  // Store schedule on phases for Gantt rendering (overlap offsets)
  dcfPhases._conSched=_conSched;
  dcfPhases._belowGradeLevels=_belowGradeLevels;
  dcfPhases._podiumFloors=_podiumFloors;

  const heightTimeAdj=0; // timeline is fully embedded in phase durations

  // Derive total construction months from explicit phase positions
  const _latestPhaseEnd=Math.max(1,...dcfPhases.map(ph=>(ph.startMonth||0)+(ph.months||0)));
  const preDevelopmentMonths=dcfPhases.filter(ph=>['preapp','spa','permit','zbla','approvals'].includes(ph.id)).reduce((s,ph)=>s+(ph.months||0),0);
  const totalConstructionMonths=_latestPhaseEnd;
  const activeConstructionMonths=Math.max(1,totalConstructionMonths-preDevelopmentMonths);
  const absorptionMonths=Math.round((pf.dcf.absorptionMonths||18)+(maxSt>20?(maxSt-20)*0.3:0));
  const totalProjectMonths=totalConstructionMonths+absorptionMonths;

  // Interest: weighted average draw during construction (S-curve ≈ 60% avg utilization)
  const loanBase=(totalHard+totalSoft)*pf.ltc;
  const avgDrawPct=0.60; // S-curve average utilization factor
  const constructionInterest=loanBase*pf.intRate*(activeConstructionMonths/12)*avgDrawPct;
  // Carrying costs during pre-development (land holding, insurance, property tax)
  const preDevCarrying=totalLand*0.03*(preDevelopmentMonths/12); // ~3% annual carrying on land
  // Post-completion carrying during absorption (condo fees, marketing, unsold inventory)
  const postCompCarrying=(totalHard+totalSoft)*0.005*(absorptionMonths/12); // ~0.5% annual
  const loanFee=loanBase*pf.loanFeePct;

  const interest=constructionInterest+preDevCarrying+postCompCarrying;
  const totalFinancing=interest+loanFee;
  const timeAdjSoft=0; // no longer used — soft costs are a flat % of hard

  const totalCost=totalLand+totalHard+totalSoft+totalFinancing;
  const margin=totalGrossRev-totalCost;
  const marginOnCost=totalCost>0?margin/totalCost:0;
  const marginOnRev=totalGrossRev>0?margin/totalGrossRev:0;

  // ── Investment metrics ──
  const costPerUnit=totalUnits>0?totalCost/totalUnits:0;
  const costPerSF=totalGFA>0?totalCost/totalGFA:0;
  const revPerUnit=totalUnits>0?totalGrossRev/totalUnits:0;
  const revPerSF=totalGFA>0?totalGrossRev/totalGFA:0;
  const hardCostPerSF=totalGFA>0?totalHard/totalGFA:0;
  const landPctOfCost=totalCost>0?totalLand/totalCost:0;
  const hardPctOfCost=totalCost>0?totalHard/totalCost:0;
  const softPctOfCost=totalCost>0?totalSoft/totalCost:0;
  const finPctOfCost=totalCost>0?totalFinancing/totalCost:0;
  // Yield on cost (commercial NOI / total cost — institutional metric)
  const yieldOnCost=totalCost>0?totalCommNOI/totalCost:0;
  // Equity required (assumes LTC for debt)
  const debtAmount=totalCost*pf.ltc;
  const equityRequired=totalCost-debtAmount;
  const returnOnEquity=equityRequired>0?margin/equityRequired:0;
  // Land residual (max land price for target 15% margin)
  const nonLandCost=totalHard+totalSoft+timeAdjSoft+totalFinancing;
  const landResidual15=totalGrossRev/1.15-nonLandCost; // at 15% margin on cost
  // Breakeven PSF (residential $/sf needed to break even)
  const nonResiRev=totalCommValue+parkRev+lockerRev;
  const breakevenPSF=netResiSF>0?(totalCost-nonResiRev)/netResiSF:0;

  return {totalGFA,commGFA,netLeasableComm,resiGFA,sellableResiSF,siteArea,fsi,unitMix,totalUnits,netResiSF,resiRevenue,
    deductions:{corridorTotal,coreTotal,lobbyDeduct,amenityDeduct,totalDeductions},
    gfDeductions:{gfLobby,gfElevLanding,gfStairs,gfMech,gfGarbage,gfBikeRoom,gfLoading,gfTotalDeduct},
    commTenants,totalCommNOI,totalCommValue,
    parkSpaces,lockers,parkRev,lockerRev,totalGrossRev,
    landPrice:pf.landPrice,ltt,ddCost:pf.ddCost,totalLand,
    hardCostPSF,totalHard,
    heightMultiplier,maxStoreys:maxSt,heightTimeAdj,
    altusCity:altusCity.label,altusCityId:altusCity.id,altusCityDist:altusCity.distKm,
    altusCostRange,
    softCostPct,softCostBase,dcResi,dcComm,dcTotal,s37Total,parklandCost,totalSoft,timeAdjSoft,
    constructionInterest,preDevCarrying,postCompCarrying,interest,loanFee,totalFinancing,
    totalConstructionMonths,preDevelopmentMonths,activeConstructionMonths,absorptionMonths,totalProjectMonths,
    totalCost,margin,marginOnCost,marginOnRev,
    costPerUnit,costPerSF,revPerUnit,revPerSF,hardCostPerSF,softCostPct,
    landPctOfCost,hardPctOfCost,softPctOfCost,finPctOfCost,
    yieldOnCost,debtAmount,equityRequired,returnOnEquity,
    landResidual15,breakevenPSF};
}

function fmt$(n){return n<0?'-$'+Math.abs(Math.round(n)).toLocaleString():'$'+Math.round(n).toLocaleString()}
function fmtM(n){return (n<0?'-':'')+'$'+Math.abs(n/1e6).toFixed(1)+'M'}
function pct(n){return (n*100).toFixed(1)+'%'}

// Helper: editable cell that writes back to P.pf and refreshes
function pfInput(val, onChange, opts={}){
  const w=opts.w||70, pre=opts.pre||'', suf=opts.suf||'', step=opts.step||1;
  return `<input type="number" value="${val}" step="${step}" style="width:${w}px;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;font-size:11px;font-weight:600;text-align:right;padding:2px 6px;border-radius:3px;-moz-appearance:textfield;appearance:textfield" onfocus="this.select()" onchange="(${onChange})(parseFloat(this.value)||0);pfChanged()"> ${suf}`;
}

/**
 * Sets the master total soft cost % and redistributes individual line items proportionally.
 * Preserves the relative weight of each item (e.g., if contingency was 38% of total soft, it stays 38%).
 * @param {number} newTotalPct - New total soft cost % of hard (e.g., 0.30 for 30%)
 */
function pfSetTotalSoftPct(newTotalPct){
  var pf=P.pf;
  var oldTotal=0;
  for(var k in pf.sc) oldTotal+=pf.sc[k];
  pf.totalSoftPct=newTotalPct;
  if(oldTotal>0){
    var scale=newTotalPct/oldTotal;
    for(var k in pf.sc) pf.sc[k]=pf.sc[k]*scale;
  } else {
    // Equal distribution fallback
    var keys=Object.keys(pf.sc);
    var each=newTotalPct/keys.length;
    keys.forEach(function(k){pf.sc[k]=each;});
  }
  pfChanged();
}

// pfSyncTotalSoftPct and pfToggleScMode removed — soft costs now a single % of hard

// Set a commercial tenant's area and redistribute remaining space to other tenants
function pfSetCommArea(idx,newArea){
  const pf=P.pf;
  const totalLeasable=pfData().netLeasableComm;
  newArea=Math.max(0,Math.min(newArea,totalLeasable));
  // Set this tenant's percentage
  pf.comm[idx].pct=totalLeasable>0?newArea/totalLeasable:0;
  // Redistribute remaining percentage among other tenants proportionally
  const remainPct=Math.max(0,1-pf.comm[idx].pct);
  const otherTotal=pf.comm.reduce((s,t,i)=>i===idx?s:s+t.pct,0);
  pf.comm.forEach((t,i)=>{
    if(i===idx)return;
    t.pct=otherTotal>0?(t.pct/otherTotal)*remainPct:remainPct/(pf.comm.length-1);
  });
  pfChanged();
}

/**
 * Called whenever pro-forma inputs change. Invalidates the cache and refreshes all dependent UI tabs.
 */
function pfChanged(){
  _pfCache=null;
  updateProForma();
  updateStats();
  updateUnitSummary();
  buildFloorSchedule();
  renderReport();
  autoSave();
}

/**
 * Rebuild the entire pro-forma panel: KPIs, revenue/cost tables, benchmark banner, DCF, and Monte Carlo sections.
 */
function updateProForma(){
  _pfCache=null; // ensure fresh calc
  const d=pfData();
  const pf=P.pf;

  // Benchmark validation
  const _bm=computeBenchmarks(d);
  const bannerEl=document.getElementById('pf-benchmark-banner');
  if(bannerEl) bannerEl.innerHTML=renderBenchmarkBanner(_bm);
  // Helper: get dot HTML for a benchmark key
  const _emptyDot='<span style="display:inline-block;width:14px"></span>';
  const bd=key=>{const c=_bm.checks.find(x=>x.key===key);return c?c.dot:_emptyDot;};

  // KPIs — investment-grade metrics at a glance
  const _marginColor=d.marginOnCost>=0.15?'#33FF88':d.marginOnCost>=0.05?'#FFCC33':'#FF4444';
  const _roeColor=d.returnOnEquity>=0.25?'#33FF88':d.returnOnEquity>=0.10?'#FFCC33':'#FF4444';
  document.getElementById('pf-kpis').innerHTML=`
    <div class="pf-kpi-card"><div class="pf-kpi-label">TOTAL COST</div><div class="pf-kpi-val">${fmtM(d.totalCost)}</div></div>
    <div class="pf-kpi-card"><div class="pf-kpi-label">GROSS REVENUE</div><div class="pf-kpi-val">${fmtM(d.totalGrossRev)}</div></div>
    <div class="pf-kpi-card"><div class="pf-kpi-label">PROFIT MARGIN</div><div class="pf-kpi-val" style="color:${_marginColor}">${pct(d.marginOnCost)}</div></div>
    <div class="pf-kpi-card"><div class="pf-kpi-label">RETURN ON EQUITY</div><div class="pf-kpi-val" style="color:${_roeColor}">${pct(d.returnOnEquity)}</div></div>
    <div class="pf-kpi-card"><div class="pf-kpi-label">UNITS / GFA</div><div class="pf-kpi-val">${d.totalUnits} <span style="font-size:10px;color:#888899">/ ${Math.round(d.totalGFA).toLocaleString()} sf</span></div></div>
    <div class="pf-kpi-card"><div class="pf-kpi-label">COST / UNIT</div><div class="pf-kpi-val">${fmt$(d.costPerUnit)}</div></div>
  `;

  // ── SOURCES & USES ──
  const _suEl=document.getElementById('pf-sources-uses');
  if(_suEl){
    const _debtAmt=d.debtAmount;
    const _equityAmt=d.equityRequired;
    _suEl.innerHTML=`<div class="pf-section">
      <div class="pf-title">SOURCES & USES</div>
      <div style="display:flex;gap:16px">
        <div style="flex:1">
          <table class="pf-table">
            <tr><th colspan="3" style="color:#FF9933;letter-spacing:1px">USES</th></tr>
            <tr><td>Land Acquisition</td><td class="num">${fmt$(d.totalLand)}</td><td class="num" style="color:#888899">${pct(d.landPctOfCost)}</td></tr>
            <tr><td>Hard Construction</td><td class="num">${fmt$(d.totalHard)}</td><td class="num" style="color:#888899">${pct(d.hardPctOfCost)}</td></tr>
            <tr><td>Soft Costs</td><td class="num">${fmt$(d.totalSoft)}</td><td class="num" style="color:#888899">${pct(d.softPctOfCost)}</td></tr>
            <tr><td>Financing</td><td class="num">${fmt$(d.totalFinancing+(d.timeAdjSoft||0))}</td><td class="num" style="color:#888899">${pct(d.finPctOfCost)}</td></tr>
            <tr class="total"><td>Total Uses</td><td class="num">${fmt$(d.totalCost)}</td><td class="num">100%</td></tr>
          </table>
        </div>
        <div style="flex:1">
          <table class="pf-table">
            <tr><th colspan="3" style="color:#33FF88;letter-spacing:1px">SOURCES</th></tr>
            <tr><td>Senior Debt (${pct(P.pf.ltc)} LTC)</td><td class="num">${fmt$(_debtAmt)}</td><td class="num" style="color:#888899">${d.totalCost>0?pct(_debtAmt/d.totalCost):'-'}</td></tr>
            <tr><td>Equity Required</td><td class="num">${fmt$(_equityAmt)}</td><td class="num" style="color:#888899">${d.totalCost>0?pct(_equityAmt/d.totalCost):'-'}</td></tr>
            <tr class="total"><td>Total Sources</td><td class="num">${fmt$(d.totalCost)}</td><td class="num">100%</td></tr>
          </table>
        </div>
      </div>
    </div>`;
  }

  // Revenue — with editable inputs
  const ei=(val,cb,o)=>pfInput(val,cb,o); // shorthand
  const commRows=d.commTenants.map((t,i)=>`<tr><td>${t.label}</td><td class="num">${ei(Math.round(t.area),`v=>{pfSetCommArea(${i},v)}`,{w:65,suf:'sf'})}</td>
    <td class="num">${ei(pf.comm[i].rent,`v=>{P.pf.comm[${i}].rent=v}`,{w:50,suf:'$/sf'})}${benchCheck(pf.comm[i].rent,'commRentNNN').dot}</td>
    <td class="num">${fmt$(t.noi)}</td>
    <td class="num">${ei((pf.comm[i].cap*100).toFixed(1),`v=>{P.pf.comm[${i}].cap=v/100}`,{w:52,suf:'%',step:0.1})}${benchCheck(pf.comm[i].cap,'commCapRate').dot}</td>
    <td class="num">${fmt$(t.value)}</td></tr>`).join('');
  const umRows=d.unitMix.map((u,i)=>`<tr><td>${u.type}</td>
    <td class="num">${ei(pf.units[i].size,`v=>{P.pf.units[${i}].size=v}`,{w:50,suf:'sf'})}</td>
    <td class="num">${ei(pf.units[i].count,`v=>{P.pf.units[${i}].count=v}`,{w:50})}</td>
    <td class="num">${ei(pf.units[i].psf,`v=>{P.pf.units[${i}].psf=v}`,{w:55,suf:'$/sf'})}${benchCheck(pf.units[i].psf,'resiPSF_midtown').dot}</td>
    <td class="num">${fmt$(u.revenue)}</td></tr>`).join('');
  document.getElementById('pf-revenue').innerHTML=`
    <div class="pf-section">
      <div class="pf-title">REVENUE SCHEDULE <span style="font-size:9px;color:#777;font-weight:400">— click any highlighted value to edit</span></div>

      <div class="pf-subtitle">Residential Sales</div>
      <table class="pf-table" style="table-layout:fixed">
        <colgroup><col style="width:17%"><col style="width:12%"><col style="width:10%"><col style="width:12%"><col style="width:8%"><col style="width:14%"><col style="width:16%"></colgroup>
        <tr><th>Unit Type</th><th style="text-align:right">Size</th><th style="text-align:right">Count</th><th style="text-align:right">Total SF</th><th style="text-align:center">Lock</th><th style="text-align:right">$/sf</th><th style="text-align:right">Revenue</th></tr>
        ${d.unitMix.map((u,i)=>{
          const isLocked=!!P.pf._locked[u.type];
          const totalSF=u.count*u.size;
          return `<tr><td>${u.type}</td>
            <td class="num">${ei(pf.units[i].size,`v=>{P.pf.units[${i}].size=Math.max(100,v)}`,{w:55,suf:'sf'})}</td>
            <td class="num">${isLocked?ei(pf.units[i].count,`v=>{P.pf.units[${i}].count=Math.max(0,v)}`,{w:50}):u.count}</td>
            <td class="num">${totalSF.toLocaleString()} sf</td>
            <td class="num"><input type="checkbox" ${isLocked?'checked':''} style="accent-color:#ff8844;width:14px;height:14px;cursor:pointer" onchange="if(!P.pf._locked)P.pf._locked={};if(this.checked){P.pf._locked['${u.type}']=true;}else{delete P.pf._locked['${u.type}'];}pfChanged()"></td>
            <td class="num">${ei(pf.units[i].psf,`v=>{P.pf.units[${i}].psf=v}`,{w:55,suf:'$/sf'})}</td>
            <td class="num">${fmt$(u.revenue)}</td></tr>`;
        }).join('')}
        <tr class="total"><td>Total Residential</td><td></td><td class="num">${d.totalUnits}</td><td class="num">${d.netResiSF.toLocaleString()} sf</td><td></td><td></td><td class="num">${fmt$(d.resiRevenue)}</td></tr>
      </table>
      <div style="font-size:10px;margin-top:4px;display:flex;justify-content:space-between">
        <span style="color:#777">Sellable: <b style="color:#AEBC46">${d.netResiSF.toLocaleString()} sf</b> of ${Math.round(d.sellableResiSF).toLocaleString()} sf</span>
        <span style="color:${d.netResiSF>d.sellableResiSF?'#ff6644':'#4a8'}">${d.netResiSF>d.sellableResiSF?'\u26A0 OVER by '+Math.round(d.netResiSF-d.sellableResiSF).toLocaleString()+' sf':'\u2713 '+(Math.round(d.sellableResiSF-d.netResiSF)).toLocaleString()+' sf remaining'}</span>
      </div>
      <div style="font-size:10px;color:#888899;margin-top:2px">Breakeven resi $/sf: <b style="color:#FF9933">${fmt$(d.breakevenPSF)}/sf</b></div>

      <div class="pf-subtitle">Commercial Income (Cap Rate Valuation)</div>
      <table class="pf-table" style="table-layout:fixed">
        <colgroup><col style="width:22%"><col style="width:16%"><col style="width:14%"><col style="width:16%"><col style="width:14%"><col style="width:18%"></colgroup>
        <tr><th>Tenant</th><th style="text-align:right">Area</th><th style="text-align:right">$/sf NNN</th><th style="text-align:right">NOI</th><th style="text-align:right">Cap Rate</th><th style="text-align:right">Value</th></tr>
        ${commRows}
        <tr class="total"><td>Total Commercial</td><td class="num">${Math.round(d.netLeasableComm).toLocaleString()}</td><td></td><td class="num">${fmt$(d.totalCommNOI)}</td><td></td><td class="num">${fmt$(d.totalCommValue)}</td></tr>
      </table>
      ${d.yieldOnCost>0?`<div style="font-size:10px;color:#888899;margin-top:2px">Yield on cost: <b style="color:#FF9933">${(d.yieldOnCost*100).toFixed(2)}%</b></div>`:''}

      <div class="pf-subtitle">Ancillary Revenue</div>
      <table class="pf-table">
        <tr><td>Parking Stalls (${d.parkSpaces})</td><td class="num">${ei(pf.parkPrice,`v=>{P.pf.parkPrice=v}`,{w:65,suf:'/ea'})}${bd('parkPrice')}</td><td class="num">${fmt$(d.parkRev)}</td></tr>
        <tr><td>Storage Lockers (${d.lockers})</td><td class="num">${ei(pf.lockerPrice,`v=>{P.pf.lockerPrice=v}`,{w:65,suf:'/ea'})}${bd('lockerPrice')}</td><td class="num">${fmt$(d.lockerRev)}</td></tr>
        <tr><td>Parking Ratio</td><td class="num">${ei(pf.parkRatio,`v=>{P.pf.parkRatio=v}`,{w:50,suf:'/unit',step:0.05})}${_emptyDot}</td><td></td></tr>
        <tr class="total"><td>Total Ancillary</td><td></td><td class="num">${fmt$(d.parkRev+d.lockerRev)}</td></tr>
      </table>
      <table class="pf-table"><tr class="total"><td>TOTAL GROSS REVENUE</td><td class="num">${fmt$(d.totalGrossRev)}</td><td class="num">${fmt$(d.revPerSF)}/sf</td></tr></table>

      <div style="cursor:pointer;margin-top:8px;display:flex;align-items:center;justify-content:space-between;padding:4px 0" onclick="var el=document.getElementById('area-detail');el.style.display=el.style.display==='none'?'block':'none';this.querySelector('.area-arrow').textContent=el.style.display==='none'?'\u25B8':'\u25BE'">
        <span style="font-size:9px;color:#888899;letter-spacing:1px;font-weight:600">AREA SCHEDULE DETAIL</span>
        <span class="area-arrow" style="font-size:10px;color:#FF9933">\u25B8</span>
      </div>
      <div id="area-detail" style="display:none">
        <div class="pf-subtitle" style="font-size:10px">Ground Floor Area Breakdown</div>
        <table class="pf-table" style="font-size:10px">
          <tr><td>Gross Ground Floor Area</td><td class="num">${Math.round(d.commGFA).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Lobby & Mailroom</td><td class="num">-${d.gfDeductions.gfLobby.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Elevator Landings (3\u00D7)</td><td class="num">-${d.gfDeductions.gfElevLanding.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Stairwells (2\u00D7)</td><td class="num">-${d.gfDeductions.gfStairs.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Mechanical/Electrical</td><td class="num">-${d.gfDeductions.gfMech.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Garbage/Recycling</td><td class="num">-${d.gfDeductions.gfGarbage.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Bicycle Parking</td><td class="num">-${d.gfDeductions.gfBikeRoom.toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Loading (Type G)</td><td class="num">-${d.gfDeductions.gfLoading.toLocaleString()} sf</td></tr>
          <tr class="total"><td><b>Net Leasable Commercial</b></td><td class="num" style="color:#AEBC46"><b>${Math.round(d.netLeasableComm).toLocaleString()} sf</b></td></tr>
        </table>
        <div class="pf-subtitle" style="font-size:10px">Residential Area Breakdown</div>
        <table class="pf-table" style="font-size:10px">
          <tr><td>Gross Residential GFA</td><td class="num">${Math.round(d.resiGFA).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Corridors/Hallways (15%)</td><td class="num">-${Math.round(d.deductions.corridorTotal).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Elevator Shafts (3\u00D7)</td><td class="num">-${Math.round(d.deductions.coreTotal*0.43).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Stairwells (2\u00D7)</td><td class="num">-${Math.round(d.deductions.coreTotal*0.57).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Lobby</td><td class="num">-${Math.round(d.deductions.lobbyDeduct).toLocaleString()} sf</td></tr>
          <tr style="color:#888"><td>&nbsp;&nbsp;Less: Amenity Space</td><td class="num">-${Math.round(d.deductions.amenityDeduct).toLocaleString()} sf</td></tr>
          <tr class="total"><td><b>Sellable Residential Area</b></td><td class="num" style="color:#AEBC46"><b>${Math.round(d.sellableResiSF).toLocaleString()} sf</b></td></tr>
        </table>
      </div>
    </div>`;

  // Costs — single unified table for perfect column alignment
  document.getElementById('pf-costs').innerHTML=`
    <div class="pf-section">
      <div class="pf-title">DEVELOPMENT BUDGET <span style="font-size:9px;color:#777;font-weight:400">— click any highlighted value to edit</span></div>
      <table class="pf-table">
        <colgroup><col style="width:auto"><col style="width:140px"><col style="width:130px"></colgroup>
        <tr><td colspan="3" class="pf-section-hdr">1. Land Acquisition</td></tr>
        <tr><td>Land Purchase</td><td class="num">${ei(pf.landPrice,`v=>{P.pf.landPrice=v}`,{w:90,step:100000})}</td><td class="num">${fmt$(d.landPrice/d.totalGFA)}/sf</td></tr>
        <tr><td>LTT Rate</td><td class="num">${ei((pf.lttRate*100).toFixed(1),`v=>{P.pf.lttRate=v/100}`,{w:50,suf:'%',step:0.1})}</td><td class="num">= ${fmt$(d.ltt)}</td></tr>
        <tr><td>Due Diligence</td><td class="num">${ei(pf.ddCost,`v=>{P.pf.ddCost=v}`,{w:80,step:10000})}</td><td></td></tr>
        <tr class="total"><td>Total Land</td><td class="num">${fmt$(d.totalLand)}</td><td class="num">${fmt$(d.totalLand/d.totalGFA)}/sf</td></tr>

        <tr><td colspan="3" class="pf-section-hdr">2. Hard Construction <span style="color:#888;font-size:9px">(${Math.round(d.totalGFA).toLocaleString()} sf GFA)</span></td></tr>
        <tr><td>Hard Cost Rate</td><td class="num">${ei(pf.hardCostPSF,`v=>{P.pf.hardCostPSF=Math.max(1,v)}`,{w:65,suf:'$/sf',step:5})}${d.totalGFA>0?bd('hardCostPerSF'):''}</td><td class="num">${fmt$(d.totalHard)}</td></tr>
        <tr class="total"><td>Total Hard</td><td class="num">$${Math.round(d.hardCostPSF)}/sf</td><td class="num">${fmt$(d.totalHard)}</td></tr>
        <tr><td colspan="3" style="padding:2px 6px;font-size:9px;color:#666;border-bottom:none">Benchmark: $350/sf \u00B7 Altus 2025 ${d.altusCity}: $${d.altusCostRange.low}\u2013$${d.altusCostRange.high}/sf (${d.altusCostRange.tier})</td></tr>

        <tr><td colspan="3" class="pf-section-hdr">3. Soft Costs & Development Charges</td></tr>
        <tr><td>Soft Cost % <span style="color:#666;font-size:9px">(A&E, PM, permits, contingency)</span></td><td class="num">${ei((pf.softCostPct*100).toFixed(1),`v=>{P.pf.softCostPct=Math.max(0,v/100)}`,{w:55,suf:'%',step:0.5})}${bd('softCostPct')}</td><td class="num">${fmt$(d.softCostBase)}</td></tr>
        <tr><td>DC — Residential</td><td class="num">${ei(pf.dcPerUnit,`v=>{P.pf.dcPerUnit=Math.max(0,v)}`,{w:75,step:1000})} <span style="color:#666;font-size:9px">/unit</span></td><td class="num">${fmt$(d.dcResi)}</td></tr>
        ${d.commGFA>0?`<tr><td>DC — Commercial</td><td class="num">${ei(pf.dcCommPerSF,`v=>{P.pf.dcCommPerSF=Math.max(0,v)}`,{w:55,step:1})} <span style="color:#666;font-size:9px">$/sf</span></td><td class="num">${fmt$(d.dcComm)}</td></tr>`:''}
        <tr><td>CBC / S37</td><td class="num">${ei(pf.s37PerUnit,`v=>{P.pf.s37PerUnit=Math.max(0,v)}`,{w:65,step:500})} <span style="color:#666;font-size:9px">/unit</span></td><td class="num">${fmt$(d.s37Total)}</td></tr>
        <tr><td>Parkland Dedication</td><td class="num">${ei(pf.parkland,`v=>{P.pf.parkland=Math.max(0,v)}`,{w:80,step:50000})}</td><td></td></tr>
        <tr class="total"><td>Total Soft & DCs</td><td class="num">${fmt$(d.dcTotal)} DCs · ${(d.softCostPct*100).toFixed(0)}% soft</td><td class="num">${fmt$(d.totalSoft)}</td></tr>

        <tr><td colspan="3" class="pf-section-hdr">4. Financing & Carrying Costs <span style="font-size:9px;color:#888">(${d.totalConstructionMonths}mo build + ${d.absorptionMonths}mo absorption = ${d.totalProjectMonths}mo total)</span></td></tr>
        <tr><td>Loan-to-Cost</td><td class="num">${ei((pf.ltc*100).toFixed(0),`v=>{P.pf.ltc=v/100}`,{w:52,suf:'%'})}</td><td></td></tr>
        <tr><td>Interest Rate</td><td class="num">${ei((pf.intRate*100).toFixed(1),`v=>{P.pf.intRate=v/100}`,{w:52,suf:'%',step:0.1})}</td><td></td></tr>
        <tr><td style="padding-left:16px;color:#aaa">Construction Interest (${d.activeConstructionMonths}mo \u00D7 60% avg draw)</td><td></td><td class="num">${fmt$(d.constructionInterest)}</td></tr>
        <tr><td style="padding-left:16px;color:#aaa">Pre-Dev Carrying (${d.preDevelopmentMonths}mo land hold)</td><td></td><td class="num">${fmt$(d.preDevCarrying)}</td></tr>
        <tr><td style="padding-left:16px;color:#aaa">Post-Completion Carrying (${d.absorptionMonths}mo absorption)</td><td></td><td class="num">${fmt$(d.postCompCarrying)}</td></tr>
        <tr><td>Loan Fee</td><td class="num">${ei((pf.loanFeePct*100).toFixed(1),`v=>{P.pf.loanFeePct=v/100}`,{w:52,suf:'%',step:0.1})}</td><td class="num">${fmt$(d.loanFee)}</td></tr>
        ${d.timeAdjSoft>0?`<tr><td style="color:#e07b6a">Timeline Adj. (PM + Insurance for ${d.totalConstructionMonths}mo vs 24mo base)</td><td></td><td class="num" style="color:#e07b6a">+${fmt$(d.timeAdjSoft)}</td></tr>`:''}
        <tr class="total"><td>Total Financing & Time Costs</td><td></td><td class="num">${fmt$(d.totalFinancing+(d.timeAdjSoft||0))}</td></tr>

        <tr class="grand-total"><td>TOTAL DEVELOPMENT COST</td><td class="num">${fmt$(d.totalCost)}</td><td class="num">${fmt$(d.totalCost/d.totalGFA)}/sf</td></tr>
      </table>
    </div>`;

  // Returns & Investment Analysis
  const _landResColor=d.landResidual15>=d.totalLand?'#33FF88':'#FF4444';
  document.getElementById('pf-returns').innerHTML=`
    <div class="pf-section">
      <div class="pf-title">INVESTMENT RETURNS</div>
      <table class="pf-table">
        <tr><td>Gross Revenue</td><td class="num">${fmt$(d.totalGrossRev)}</td><td class="num" style="color:#888899">${fmt$(d.revPerSF)}/sf</td></tr>
        <tr><td>Total Development Cost</td><td class="num">${fmt$(d.totalCost)}</td><td class="num" style="color:#888899">${fmt$(d.costPerSF)}/sf</td></tr>
        <tr class="total"><td>Developer Margin</td><td class="num" style="color:${d.margin>=0?'#33FF88':'#FF4444'}">${fmt$(d.margin)}</td><td></td></tr>
      </table>
      <table class="pf-table" style="margin-top:8px">
        <tr><th colspan="3" style="color:#FF9933;letter-spacing:1px">KEY METRICS</th></tr>
        <tr><td>Profit Margin</td><td class="num" style="color:${_marginColor}">${pct(d.marginOnCost)}${bd('marginOnCost')}</td><td style="font-size:9px;color:#666">target \u2265 15%</td></tr>
        <tr><td>Margin on Revenue</td><td class="num">${pct(d.marginOnRev)}</td><td></td></tr>
        <tr><td>Return on Equity</td><td class="num" style="color:${_roeColor}">${pct(d.returnOnEquity)}</td><td style="font-size:9px;color:#666">target \u2265 25%</td></tr>
        <tr><td>Yield on Cost (commercial NOI)</td><td class="num">${(d.yieldOnCost*100).toFixed(2)}%</td><td style="font-size:9px;color:#666">institutional \u2265 5%</td></tr>
        <tr><td>Cost per Unit</td><td class="num">${fmt$(d.costPerUnit)}</td><td></td></tr>
        <tr><td>Revenue per Unit</td><td class="num">${fmt$(d.revPerUnit)}</td><td></td></tr>
        <tr><td>Breakeven Resi $/sf</td><td class="num">${fmt$(d.breakevenPSF)}/sf</td><td style="font-size:9px;color:#666">must be below sale PSF</td></tr>
      </table>
      <table class="pf-table" style="margin-top:8px">
        <tr><th colspan="3" style="color:#FF9933;letter-spacing:1px">LAND RESIDUAL ANALYSIS</th></tr>
        <tr><td>Current Land Cost</td><td class="num">${fmt$(d.totalLand)}</td><td class="num" style="color:#888899">${fmt$(d.totalLand/d.totalGFA)}/sf GFA</td></tr>
        <tr><td>Land Residual @ 15% MOC</td><td class="num" style="color:${_landResColor}">${fmt$(d.landResidual15)}</td><td class="num" style="color:${_landResColor}">${d.totalGFA>0?fmt$(d.landResidual15/d.totalGFA)+'/sf GFA':'-'}</td></tr>
        <tr><td>Headroom</td><td class="num" style="color:${_landResColor}">${fmt$(d.landResidual15-d.totalLand)}</td><td style="font-size:9px;color:#666">${d.landResidual15>=d.totalLand?'land price supportable':'land too expensive at 15% target'}</td></tr>
      </table>
      <div class="pf-note">${d.marginOnCost>=0.15?'\u2713 Above 15% threshold \u2014 project is viable':'\u26A0 Below 15% threshold \u2014 review cost/revenue assumptions'}</div>
    </div>`;

  // Sensitivity
  const psfVals=[900,950,1000,1050,1100,1150];
  const hcVals=[280,310,340,370,400];
  let sensHTML='<div class="pf-section"><div class="pf-title">SENSITIVITY — PROFIT MARGIN</div>';
  sensHTML+='<table class="sens-table"><tr><th>$/sf ↓ HC→</th>';
  hcVals.forEach(hc=>sensHTML+=`<th>$${hc}/sf</th>`);
  sensHTML+='</tr>';
  psfVals.forEach(psf=>{
    sensHTML+=`<tr><td style="font-weight:600;color:#aaa">$${psf}/sf</td>`;
    hcVals.forEach(hc=>{
      const rev=psf*d.netResiSF+d.totalCommValue+d.parkRev+d.lockerRev;
      const cost=d.totalLand+hc*d.totalGFA*1.35;
      const m=(rev-cost)/cost;
      const cls=m>=0.15?'sens-green':m>=0.05?'sens-yellow':'sens-red';
      sensHTML+=`<td class="${cls}">${pct(m)}</td>`;
    });
    sensHTML+='</tr>';
  });
  sensHTML+='</table><div class="pf-note">Green = viable (>15%), Yellow = marginal (5-15%), Red = below threshold (<5%)</div></div>';
  document.getElementById('pf-sensitivity').innerHTML=sensHTML;

  // Waterfall
  const wf=[
    ['Land Acquisition',d.totalLand],
    ['Hard Costs',d.totalHard],
    ['Soft Costs & DCs',d.totalSoft],
    ['Financing',d.totalFinancing]
  ];
  const wfMax=Math.max(...wf.map(w=>w[1]));
  let wfHTML='<div class="pf-section"><div class="pf-title">COST WATERFALL</div><table class="pf-table">';
  wf.forEach(([label,val])=>{
    const barW=wfMax>0?Math.round(val/wfMax*100):0;
    wfHTML+=`<tr><td style="width:140px">${label}</td><td class="num" style="width:90px">${fmtM(val)}</td>
      <td><div style="background:#AEBC46;height:12px;width:${barW}%;border-radius:2px;opacity:.7"></div></td>
      <td class="num" style="width:40px;font-size:10px">${pct(val/d.totalCost)}</td></tr>`;
  });
  wfHTML+=`<tr class="total"><td>TOTAL</td><td class="num">${fmtM(d.totalCost)}</td><td></td><td class="num">100%</td></tr></table></div>`;
  document.getElementById('pf-waterfall').innerHTML=wfHTML;

  // ── Render DCF section ──
  renderDCF(d);
  // ── Render Monte Carlo ──
  renderMonteCarlo(d);
  autoSave(); // persist pro-forma edits
}


// ══════════════════════════════════════════════════════════════════════
// DCF / CASH FLOW MODEL + GANTT TIMELINE
// ══════════════════════════════════════════════════════════════════════

function ensureDCFDefaults(){
  if(!P.pf.dcf){
    P.pf.dcf={discountRate:0.08,preSalesPct:0.70,preSalesDeposit:0.20,absorptionMonths:18,
      constructionRate:0.065,equityPct:0.35,phases:TIMELINE_ASOFRIGHT.map(p=>({...p}))};
    _lastAutoTimeline='asofright';
  }
  // Auto-apply timeline preset (unless user has manually edited)
  if(!_dcfPhasesManuallyEdited){
    const needed=P._requiresZBLA?'zbla':'asofright';
    if(_lastAutoTimeline!==needed){
      const preset=needed==='zbla'?TIMELINE_ZBLA:TIMELINE_ASOFRIGHT;
      P.pf.dcf.phases=preset.map(p=>({...p}));
      _lastAutoTimeline=needed;
    }
  }
}

/**
 * Build a monthly discounted cash-flow model from the pro-forma result.
 * Distributes costs via S-curve across construction phases, models pre-sale deposits and absorption,
 * computes construction financing interest, and solves for IRR, NPV, and equity multiple.
 * @param {Object} pfResult - Output of pfCalc().
 * @returns {Object} DCF result with timeline, monthly cash flows, irr, npv, equityMultiple, and peakEquity.
 */
function calcDCF(pfResult){
  ensureDCFDefaults();
  const d=pfResult;
  const dcf=P.pf.dcf;
  const phases=dcf.phases;

  // ── Timeline: use explicit startMonth from each phase (user-draggable) ──
  const timeline=[];
  phases.forEach((ph,idx)=>{
    const start=ph.startMonth||0;
    const end=start+(ph.months||0);
    // Detect overlap: any phase whose span intersects a prior phase
    let isOverlap=false;
    timeline.forEach(prev=>{
      if(start<prev.endMonth && end>prev.startMonth) isOverlap=true;
    });
    timeline.push({...ph, startMonth:start, endMonth:end, overlap:isOverlap, _idx:idx});
  });
  // Sort timeline by startMonth for display
  timeline.sort((a,b)=>a.startMonth-b.startMonth||a.endMonth-b.endMonth);
  // Total months = latest endMonth across all phases (min 1 to avoid division by zero)
  const totalMonths=Math.max(1,...timeline.map(t=>t.endMonth));
  const constructionEnd=totalMonths;

  // ── Project span depends on revenue model ──
  const absMonths=dcf.absorptionMonths||18;
  // Ensure array covers both construction end + absorption wherever it's positioned
  const _absEndMonth=((dcf.absorptionStart!=null&&dcf.absorptionStart>=0)?dcf.absorptionStart:totalMonths)+absMonths;
  const totalSpan=Math.max(totalMonths+absMonths+12,_absEndMonth+12,24);

  // ── Monthly cash flows ──
  const monthly=[];
  for(let m=0;m<totalSpan;m++){
    monthly.push({month:m, costs:0, revenue:0, draws:0, interest:0, cumCost:0, cumRev:0, cumNet:0});
  }

  // ── Cost distribution: S-curve within each construction phase ──
  // Auto-redistribute costPct proportional to duration (longer phases = more cost)
  const landCost=d.totalLand;
  const constructionCost=d.totalHard+d.totalSoft-landCost;
  monthly[0].costs+=landCost;

  const totalDurationMo=phases.reduce((s,ph)=>s+(ph.months||0),0);
  phases.forEach(ph=>{
    if(!ph.months||ph.months<=0) return;
    // Cost share proportional to this phase's duration vs total
    const autoCostPct=totalDurationMo>0?ph.months/totalDurationMo:0;
    const phaseCost=constructionCost*autoCostPct;
    const phaseStart=ph.startMonth||0;
    for(let m=0;m<ph.months;m++){
      const t=(m+0.5)/ph.months;
      const sCurve=1/(1+Math.exp(-10*(t-0.5)));
      const prevS=m>0?1/(1+Math.exp(-10*((m-0.5)/ph.months-0.5))):0;
      const monthPct=sCurve-prevS;
      const globalM=phaseStart+m;
      if(globalM<monthly.length) monthly[globalM].costs+=phaseCost*monthPct;
    }
  });

  // ── Revenue model — Residential ──
  // Absorption start can be manually positioned or defaults to construction end
  const absStart=(dcf.absorptionStart!=null&&dcf.absorptionStart>=0)?dcf.absorptionStart:constructionEnd;
  let preSalesUnits=0,postSalesUnits=0,totalDeposits=0;

  const totalRev=d.totalGrossRev;
  preSalesUnits=Math.round((d.totalUnits||0)*(dcf.preSalesPct||0.7));
  postSalesUnits=(d.totalUnits||0)-preSalesUnits;
  const preSalesRev=totalRev*(dcf.preSalesPct||0.7);
  const postSalesRev=totalRev*(1-(dcf.preSalesPct||0.7));
  const depositStart=6;
  const depositMonths=Math.max(1,constructionEnd-depositStart);
  totalDeposits=preSalesRev*(dcf.preSalesDeposit||0.20);
  if(depositMonths>0){
    for(let m=depositStart;m<constructionEnd;m++){
      if(m<monthly.length) monthly[m].revenue+=totalDeposits/depositMonths;
    }
  }
  const preSaleBalance=preSalesRev-totalDeposits;
  if(constructionEnd<monthly.length) monthly[constructionEnd].revenue+=preSaleBalance;
  for(let m=0;m<absMonths;m++){
    const gm=absStart+m;
    if(gm<monthly.length) monthly[gm].revenue+=postSalesRev/absMonths;
  }

  // ── Construction financing: interest during construction + lease-up only ──
  const monthlyRate=dcf.constructionRate/12;
  const interestCutoff=absStart+absMonths;
  let cumDrawn=0;
  monthly.forEach(m=>{
    if(m.month<=constructionEnd) cumDrawn+=m.costs;
    m.draws=cumDrawn;
    if(m.month<interestCutoff){
      m.interest=cumDrawn*monthlyRate;
      m.costs+=m.interest;
    }
  });

  // ── Cumulative cash flows ──
  let cumCost=0, cumRev=0;
  monthly.forEach(m=>{
    cumCost+=m.costs;
    cumRev+=m.revenue;
    m.cumCost=cumCost;
    m.cumRev=cumRev;
    m.cumNet=cumRev-cumCost;
  });

  // ── IRR (bisection on monthly NPV) ──
  const cashFlows=monthly.map(m=>m.revenue-m.costs);
  function npvAtRate(r){
    let npv=0;
    for(let i=0;i<cashFlows.length;i++){npv+=cashFlows[i]/Math.pow(1+r,i/12);}
    return npv;
  }
  let lo=-0.5, hi=2.0;
  for(let iter=0;iter<100;iter++){
    const mid=(lo+hi)/2;
    if(npvAtRate(mid)>0) lo=mid; else hi=mid;
  }
  const irr=(lo+hi)/2;
  const npv=npvAtRate(dcf.discountRate);

  // ── Equity metrics ──
  const totalProjectCost=d.totalCost;
  const totalEquity=totalProjectCost*dcf.equityPct;
  let peakEquity=0, cumEquity=0;
  monthly.forEach(m=>{
    cumEquity+=(m.costs-m.revenue)*dcf.equityPct;
    peakEquity=Math.max(peakEquity,cumEquity);
  });
  const totalRevAll=monthly.reduce((s,m)=>s+m.revenue,0);
  const equityMultiple=totalEquity>0?(totalRevAll-totalProjectCost+totalEquity)/totalEquity:0;

  return {timeline, monthly, totalMonths, constructionEnd, irr, npv, equityMultiple, peakEquity, totalEquity,
    preSalesUnits, postSalesUnits, totalDeposits, absStart, absMonths,
    holdMonths:0, holdYears:0, leaseUpMonths:0};
}

/**
 * Initialize drag interactions on Gantt bar SVG elements.
 * Supports: drag body to move, drag left/right edges to resize, drag zero-line to create.
 * Uses pointer events for unified mouse+touch support.
 */
function _initGanttDrag(ganttEl){
  if(_ganttCleanup) _ganttCleanup();

  const svg=ganttEl.querySelector('.gantt-svg');
  if(!svg) return;

  // Prevent browser scroll/zoom during drag
  svg.style.touchAction='none';

  const mScale=parseFloat(svg.dataset.mscale);
  const labelW=parseFloat(svg.dataset.labelw);
  if(!mScale||mScale<=0) return;

  // Cache element refs during drag to avoid repeated DOM queries
  let _cachedEls=null;

  function getSvgX(e){
    const rect=svg.getBoundingClientRect();
    return e.clientX-rect.left;
  }

  function onDown(e){
    if(e.button&&e.button!==0) return; // left click only
    const barG=e.target.closest('.gantt-bar');
    if(!barG) return;
    const idxStr=barG.dataset.idx;
    const isAbs=(idxStr==='abs');
    const idx=isAbs?-1:parseInt(idxStr);

    let origStart, origMonths;
    if(isAbs){
      const dcf=P.pf.dcf;
      const _phEnd=Math.max(1,...(dcf.phases||[]).map(p=>(p.startMonth||0)+(p.months||0)));
      origStart=(dcf.absorptionStart!=null&&dcf.absorptionStart>=0)?dcf.absorptionStart:_phEnd;
      origMonths=dcf.absorptionMonths||18;
    } else {
      const ph=P.pf.dcf.phases[idx];
      if(!ph) return;
      origStart=ph.startMonth||0;
      origMonths=ph.months||0;
    }

    const svgX=getSvgX(e);
    const target=e.target;
    let dragType='move';

    if(target.classList.contains('bar-handle-left')){ dragType='resize-left'; }
    else if(target.classList.contains('bar-handle-right')){ dragType='resize-right'; }
    else if(target.classList.contains('bar-zero')){ dragType='create'; }
    else if(target.classList.contains('bar-body')){ dragType='move'; }
    else return;

    // Capture pointer for smooth drag even if cursor leaves SVG
    svg.setPointerCapture(e.pointerId);

    _ganttDragState={
      type:dragType, idx:idx, isAbs:isAbs,
      startX:svgX,
      origStart:origStart,
      origMonths:origMonths,
      barG:barG,
      pointerId:e.pointerId
    };

    // Cache child elements once
    _cachedEls={
      body:barG.querySelector('.bar-body'),
      handleL:barG.querySelector('.bar-handle-left'),
      handleR:barG.querySelector('.bar-handle-right'),
      label:barG.querySelector('.bar-label'),
      zeroLine:barG.querySelector('.bar-zero'),
      preview:null
    };

    if(_cachedEls.body) _cachedEls.body.style.cursor='grabbing';
    svg.style.cursor=dragType==='move'?'grabbing':'ew-resize';

    e.preventDefault();
    e.stopPropagation();
  }

  function onMove(e){
    if(!_ganttDragState) return;
    const ds=_ganttDragState;
    const svgX=getSvgX(e);
    const deltaMonths=Math.round((svgX-ds.startX)/mScale);

    let newStart=ds.origStart;
    let newMonths=ds.origMonths;

    if(ds.type==='move'){
      newStart=Math.max(0,ds.origStart+deltaMonths);
    } else if(ds.type==='resize-left'){
      newStart=Math.max(0,Math.min(ds.origStart+deltaMonths,ds.origStart+ds.origMonths-1));
      newMonths=ds.origMonths-(newStart-ds.origStart);
    } else if(ds.type==='resize-right'){
      newMonths=Math.max(1,ds.origMonths+deltaMonths);
    } else if(ds.type==='create'){
      newStart=ds.origStart;
      newMonths=Math.max(1,deltaMonths);
      if(deltaMonths<0){
        newStart=Math.max(0,ds.origStart+deltaMonths);
        newMonths=Math.abs(deltaMonths);
      }
    }

    // Live preview — directly update cached SVG elements (no DOM queries)
    const el=_cachedEls;
    const x=labelW+newStart*mScale;
    const w=Math.max(newMonths*mScale,4);

    if(el.body){
      el.body.setAttribute('x',x);
      el.body.setAttribute('width',w);
    } else if(el.zeroLine && newMonths>0){
      el.zeroLine.style.display='none';
      if(!el.preview){
        el.preview=document.createElementNS('http://www.w3.org/2000/svg','rect');
        el.preview.classList.add('bar-preview');
        const rowY=parseFloat(ds.barG.dataset.rowY);
        el.preview.setAttribute('y',rowY+4);
        el.preview.setAttribute('height',18);
        el.preview.setAttribute('rx','3');
        el.preview.setAttribute('opacity','0.5');
        el.preview.setAttribute('fill','#888');
        ds.barG.appendChild(el.preview);
      }
      el.preview.setAttribute('x',x);
      el.preview.setAttribute('width',w);
    }
    if(el.handleL) el.handleL.setAttribute('x',x-2);
    if(el.handleR) el.handleR.setAttribute('x',x+w-6);
    if(el.label){
      el.label.textContent=newMonths+'mo';
      if(w>36){
        el.label.setAttribute('x',x+w/2);
        el.label.setAttribute('text-anchor','middle');
        el.label.setAttribute('fill','#111');
      } else {
        el.label.setAttribute('x',x+w+4);
        el.label.setAttribute('text-anchor','start');
      }
    }

    ds._newStart=newStart;
    ds._newMonths=newMonths;
    e.preventDefault();
  }

  function onUp(e){
    if(!_ganttDragState) return;
    const ds=_ganttDragState;

    // Release pointer capture
    try{ svg.releasePointerCapture(ds.pointerId); }catch(ex){}

    // Apply final values
    if(ds.isAbs){
      if(ds._newStart!=null) P.pf.dcf.absorptionStart=ds._newStart;
      if(ds._newMonths!=null) P.pf.dcf.absorptionMonths=ds._newMonths;
    } else {
      const ph=P.pf.dcf.phases[ds.idx];
      if(ph && (ds._newStart!==undefined || ds._newMonths!==undefined)){
        ph.startMonth=ds._newStart!=null?ds._newStart:ph.startMonth;
        ph.months=ds._newMonths!=null?ds._newMonths:ph.months;
        _dcfPhasesManuallyEdited=true;
      }
    }

    if(_cachedEls&&_cachedEls.body) _cachedEls.body.style.cursor='grab';
    svg.style.cursor='';
    _ganttDragState=null;
    _cachedEls=null;

    pfChanged();
  }

  // All pointer events on the SVG itself (captured via setPointerCapture)
  svg.addEventListener('pointerdown',onDown);
  svg.addEventListener('pointermove',onMove);
  svg.addEventListener('pointerup',onUp);

  // Hover handles — only when NOT dragging
  svg.addEventListener('pointerenter',function(e){
    if(_ganttDragState) return;
    const barG=e.target.closest('.gantt-bar');
    if(barG) barG.querySelectorAll('.bar-handle').forEach(h=>h.setAttribute('opacity','0.4'));
  },true);
  svg.addEventListener('pointerleave',function(e){
    if(_ganttDragState) return;
    const barG=e.target.closest('.gantt-bar');
    if(barG) barG.querySelectorAll('.bar-handle').forEach(h=>h.setAttribute('opacity','0'));
  },true);

  _ganttCleanup=function(){
    svg.removeEventListener('pointerdown',onDown);
    svg.removeEventListener('pointermove',onMove);
    svg.removeEventListener('pointerup',onUp);
  };
}

/**
 * Render the DCF analysis UI: editable inputs, Gantt timeline, cash-flow chart, and KPI cards.
 * @param {Object} pfResult - Output of pfCalc().
 */
function renderDCF(pfResult){
  ensureDCFDefaults();
  const dcf=P.pf.dcf;
  let dcfResult;
  try{ dcfResult=calcDCF(pfResult); }catch(e){ console.error('DCF calc error:',e); return; }
  const {timeline, monthly, totalMonths, constructionEnd, irr, npv, equityMultiple, peakEquity}=dcfResult;
  const ei=pfInput; // alias

  // ── DCF Inputs ──
  const inputsEl=document.getElementById('pf-dcf-inputs');
  if(inputsEl){
    inputsEl.innerHTML=`
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px">
        <div style="background:#1a1a1a;padding:8px;border-radius:4px;border:1px solid #333">
          <div style="color:#888;font-size:9px">Discount Rate</div>
          <div>${ei((dcf.discountRate*100).toFixed(1),`v=>{P.pf.dcf.discountRate=v/100}`,{w:52,suf:'%',step:0.5})}</div>
        </div>
        <div style="background:#1a1a1a;padding:8px;border-radius:4px;border:1px solid #333">
          <div style="color:#888;font-size:9px">Pre-Sales %</div>
          <div>${ei(((dcf.preSalesPct||0.7)*100).toFixed(0),`v=>{P.pf.dcf.preSalesPct=v/100}`,{w:52,suf:'%'})}</div>
        </div>
        <div style="background:#1a1a1a;padding:8px;border-radius:4px;border:1px solid #333">
          <div style="color:#888;font-size:9px">Deposit %</div>
          <div>${ei(((dcf.preSalesDeposit||0.2)*100).toFixed(0),`v=>{P.pf.dcf.preSalesDeposit=v/100}`,{w:52,suf:'%'})}</div>
        </div>
        <div style="background:#1a1a1a;padding:8px;border-radius:4px;border:1px solid #333">
          <div style="color:#888;font-size:9px">Construction Rate</div>
          <div>${ei((dcf.constructionRate*100).toFixed(1),`v=>{P.pf.dcf.constructionRate=v/100}`,{w:52,suf:'%',step:0.25})}</div>
        </div>
      </div>`;
  }

  // ── Development Plan — Interactive Gantt Timeline ──
  const ganttEl=document.getElementById('pf-gantt');
  if(ganttEl){
    const gW=ganttEl.clientWidth||600;

    // ── Phase grouping ──
    const preDevIds=new Set(['preapp','zbla','spa','permit']);
    const constructionIds=new Set(['shoring','belowGrade','aboveGrade','envelope','fitout']);
    const closeoutIds=new Set(['commission','deficiency']);

    const rows=[];
    const preDevPhases=timeline.filter(t=>preDevIds.has(t.id));
    const conPhases=timeline.filter(t=>constructionIds.has(t.id));
    const closePhases=timeline.filter(t=>closeoutIds.has(t.id));

    if(preDevPhases.length>0){ rows.push({type:'group',label:'PRE-DEVELOPMENT',color:'#AEBC46'}); preDevPhases.forEach(p=>rows.push({type:'bar',phase:p})); }
    if(conPhases.length>0){ rows.push({type:'group',label:'CONSTRUCTION',color:'#4ecdc4'}); conPhases.forEach(p=>rows.push({type:'bar',phase:p})); }
    if(closePhases.length>0){ rows.push({type:'group',label:'CLOSEOUT',color:'#e8c87a'}); closePhases.forEach(p=>rows.push({type:'bar',phase:p})); }
    rows.push({type:'group',label:'POST-COMPLETION',color:'#6aaa6a'});
    rows.push({type:'abs'});

    // ── Milestones ──
    const milestones=[];
    const bgEnd=timeline.find(t=>t.id==='belowGrade');
    const agEnd=timeline.find(t=>t.id==='aboveGrade');
    const commEnd=timeline.find(t=>t.id==='commission');
    if(bgEnd&&bgEnd.months>0) milestones.push({month:bgEnd.endMonth, label:'Foundation', color:'#6a8090'});
    if(agEnd&&agEnd.months>0) milestones.push({month:agEnd.endMonth, label:'Topping Off', color:'#88aabb'});
    if(commEnd&&commEnd.months>0) milestones.push({month:commEnd.endMonth, label:'Completion', color:'#e8c87a'});
    milestones.push({month:constructionEnd, label:'Occupancy', color:'#AEBC46'});

    // ── Colors ──
    const phColors={preapp:'#AEBC46',zbla:'#e8c87a',spa:'#a0d4a0',permit:'#88bbdd',
      shoring:'#8B7355',belowGrade:'#6a8090',aboveGrade:'#88aabb',
      envelope:'#4ecdc4',fitout:'#c49ade',commission:'#e8c87a',deficiency:'#e07b6a'};

    // ── Layout ──
    const barH=26, groupH=18, pad=4, labelW=190, handleW=8;
    const chartW=gW-labelW-16;
    const totalM=Math.max(totalMonths+dcfResult.absMonths+4,dcfResult.absStart+dcfResult.absMonths+4,24);
    const mScale=chartW/totalM;
    const headerH=28, msH=28;
    let svgH=headerH;
    rows.forEach(r=>{ svgH+=(r.type==='group'?groupH:barH); });
    svgH+=msH+8;

    // ── Calendar dates ──
    const _startDate=P.pf.startMonth?new Date(P.pf.startMonth):new Date();
    const _monthNames=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function calLabel(mo){
      const dd=new Date(_startDate);
      dd.setMonth(dd.getMonth()+mo);
      return _monthNames[dd.getMonth()]+' '+(dd.getFullYear()%100).toString().padStart(2,'0');
    }

    // ── Build SVG ──
    let gSvg=`<svg class="gantt-svg" width="${gW}" height="${svgH}" data-mscale="${mScale}" data-labelw="${labelW}" data-totalm="${totalM}" style="display:block;font-family:'Outfit','DM Sans',sans-serif;user-select:none">`;
    gSvg+=`<rect width="${gW}" height="${svgH}" fill="#111114" rx="4"/>`;

    // Quarter grid
    for(let m=0;m<=totalM;m+=3){
      const x=labelW+m*mScale;
      const isYear=((_startDate.getMonth()+m)%12===0 && m>0);
      gSvg+=`<line x1="${x}" y1="${headerH}" x2="${x}" y2="${svgH-msH}" stroke="${isYear?'#444':'#252528'}" stroke-width="${isYear?1:0.5}"/>`;
      gSvg+=`<text x="${x}" y="${headerH-6}" fill="${isYear?'#aaa':'#555'}" font-size="${isYear?'9':'8'}" font-weight="${isYear?'600':'400'}" text-anchor="middle">${calLabel(m)}</text>`;
    }

    // ── Phase rows ──
    let curY=headerH;
    rows.forEach(row=>{
      if(row.type==='group'){
        gSvg+=`<rect x="0" y="${curY}" width="${gW}" height="${groupH}" fill="#18181c"/>`;
        gSvg+=`<line x1="6" y1="${curY+groupH/2}" x2="14" y2="${curY+groupH/2}" stroke="${row.color}" stroke-width="2"/>`;
        gSvg+=`<text x="18" y="${curY+groupH/2+3}" fill="${row.color}" font-size="9" font-weight="700" letter-spacing="1">${row.label}</text>`;
        curY+=groupH;
      } else if(row.type==='bar'){
        const ph=row.phase;
        const phIdx=ph._idx; // index into P.pf.dcf.phases
        const col=phColors[ph.id]||'#888';
        const x=labelW+ph.startMonth*mScale;
        const w=Math.max((ph.months||0)*mScale,4);
        const barY=curY+pad;
        const bH=barH-pad*2;

        // Row background
        gSvg+=`<rect x="0" y="${curY}" width="${labelW}" height="${barH}" fill="#131316"/>`;
        // Label
        gSvg+=`<text x="${labelW-8}" y="${curY+barH/2+4}" fill="#999" font-size="10" text-anchor="end">${ph.label}</text>`;

        // Interactive bar group
        gSvg+=`<g class="gantt-bar" data-idx="${phIdx}" data-id="${ph.id}" data-row-y="${curY}">`;

        // Invisible full-row hit area for context
        gSvg+=`<rect x="${labelW}" y="${curY}" width="${chartW}" height="${barH}" fill="transparent"/>`;

        if(ph.months>0){
          // Main bar body (drag to move)
          gSvg+=`<rect class="bar-body" x="${x}" y="${barY}" width="${w}" height="${bH}" fill="${col}" rx="3" opacity="0.75" style="cursor:grab"/>`;
          gSvg+=`<rect x="${x}" y="${barY}" width="${w}" height="1" fill="rgba(255,255,255,0.15)" rx="1" pointer-events="none"/>`;

          // Left resize handle
          gSvg+=`<rect class="bar-handle bar-handle-left" x="${x-2}" y="${barY}" width="${handleW}" height="${bH}" fill="${col}" rx="2" opacity="0" style="cursor:ew-resize"/>`;
          // Right resize handle
          gSvg+=`<rect class="bar-handle bar-handle-right" x="${x+w-handleW+2}" y="${barY}" width="${handleW}" height="${bH}" fill="${col}" rx="2" opacity="0" style="cursor:ew-resize"/>`;

          // Duration label
          const txt=ph.months+'mo';
          if(w>36) gSvg+=`<text class="bar-label" x="${x+w/2}" y="${curY+barH/2+4}" fill="#111" font-size="9" font-weight="600" text-anchor="middle" pointer-events="none">${txt}</text>`;
          else gSvg+=`<text class="bar-label" x="${x+w+4}" y="${curY+barH/2+4}" fill="${col}" font-size="8" font-weight="600" pointer-events="none">${txt}</text>`;
        } else {
          // Zero-duration: show thin placeholder line the user can drag out
          const zx=labelW+ph.startMonth*mScale;
          gSvg+=`<line class="bar-zero" x1="${zx}" y1="${barY+2}" x2="${zx}" y2="${barY+bH-2}" stroke="${col}" stroke-width="2" stroke-dasharray="3,2" opacity="0.5" style="cursor:ew-resize"/>`;
          gSvg+=`<text x="${zx+6}" y="${curY+barH/2+4}" fill="#555" font-size="8" pointer-events="none">drag to set</text>`;
        }

        gSvg+=`</g>`;
        curY+=barH;
      } else if(row.type==='abs'){
        const absX=labelW+dcfResult.absStart*mScale;
        const absW=Math.max(dcfResult.absMonths*mScale,4);
        const barY=curY+pad;
        const bH=barH-pad*2;
        gSvg+=`<rect x="0" y="${curY}" width="${labelW}" height="${barH}" fill="#131316"/>`;
        gSvg+=`<text x="${labelW-8}" y="${curY+barH/2+4}" fill="#999" font-size="10" text-anchor="end">Sales & Absorption</text>`;
        // Draggable absorption bar
        gSvg+=`<g class="gantt-bar" data-idx="abs" data-id="absorption" data-row-y="${curY}">`;
        gSvg+=`<rect x="${labelW}" y="${curY}" width="${chartW}" height="${barH}" fill="transparent"/>`;
        gSvg+=`<rect class="bar-body" x="${absX}" y="${barY}" width="${absW}" height="${bH}" fill="#6aaa6a" rx="3" opacity="0.5" style="cursor:grab"/>`;
        gSvg+=`<rect class="bar-handle bar-handle-left" x="${absX-2}" y="${barY}" width="${handleW}" height="${bH}" fill="#6aaa6a" rx="2" opacity="0" style="cursor:ew-resize"/>`;
        gSvg+=`<rect class="bar-handle bar-handle-right" x="${absX+absW-handleW+2}" y="${barY}" width="${handleW}" height="${bH}" fill="#6aaa6a" rx="2" opacity="0" style="cursor:ew-resize"/>`;
        if(absW>36) gSvg+=`<text class="bar-label" x="${absX+absW/2}" y="${curY+barH/2+4}" fill="#111" font-size="9" font-weight="600" text-anchor="middle" pointer-events="none">${dcfResult.absMonths}mo</text>`;
        else gSvg+=`<text class="bar-label" x="${absX+absW+4}" y="${curY+barH/2+4}" fill="#6aaa6a" font-size="8" font-weight="600" pointer-events="none">${dcfResult.absMonths}mo</text>`;
        gSvg+=`</g>`;
        curY+=barH;
      }
    });

    // ── Milestones ──
    const msY=curY+msH/2;
    gSvg+=`<rect x="0" y="${curY}" width="${gW}" height="${msH}" fill="#111114"/>`;
    gSvg+=`<line x1="${labelW}" y1="${curY}" x2="${gW}" y2="${curY}" stroke="#333" stroke-width="0.5"/>`;
    gSvg+=`<text x="18" y="${msY+3}" fill="#555" font-size="8" font-weight="600" letter-spacing="1">MILESTONES</text>`;
    milestones.forEach(ms=>{
      if(ms.month<=0) return;
      const mx=labelW+ms.month*mScale;
      const ds=5;
      gSvg+=`<polygon points="${mx},${msY-ds} ${mx+ds},${msY} ${mx},${msY+ds} ${mx-ds},${msY}" fill="${ms.color}" opacity="0.9"/>`;
      gSvg+=`<line x1="${mx}" y1="${headerH}" x2="${mx}" y2="${curY}" stroke="${ms.color}" stroke-width="1" stroke-dasharray="3,4" opacity="0.35"/>`;
      gSvg+=`<text x="${mx}" y="${msY+ds+10}" fill="${ms.color}" font-size="7" font-weight="600" text-anchor="middle">${ms.label}</text>`;
    });
    gSvg+=`</svg>`;

    // ── Phase editor — compact table ──
    const _absStartVal=dcf.absorptionStart!=null?dcf.absorptionStart:Math.max(...dcf.phases.map(p=>(p.startMonth||0)+(p.months||0)));
    const _inBase='width:26px;background:#111;border:1px solid #333;font-size:10px;text-align:center;padding:2px 1px;border-radius:3px;font-family:inherit;-moz-appearance:textfield;appearance:textfield';
    let phaseInputs=`<div style="overflow-x:auto;margin-top:8px"><table style="border-collapse:collapse;font-family:inherit;white-space:nowrap"><tr>`;
    dcf.phases.forEach((ph,i)=>{
      const sn=ph.label.split(/\s*[&/]\s*/)[0].replace('Below-Grade','Below').replace('Above-Grade','Above').replace('Pre-application','Pre-app').replace('Commissioning','Commission').trim();
      phaseInputs+=`<td style="padding:0 4px;text-align:center;vertical-align:middle">
        <div style="font-size:8px;color:#666;margin-bottom:2px;letter-spacing:0.3px">${sn}</div>
        <div style="display:flex;align-items:center;gap:2px;justify-content:center">
          <input type="number" value="${ph.startMonth||0}" min="0" max="120" step="1" style="color:#88bbdd;${_inBase}"
            onchange="_dcfPhasesManuallyEdited=true;P.pf.dcf.phases[${i}].startMonth=Math.max(0,parseInt(this.value)||0);pfChanged()">
          <span style="color:#333;font-size:8px">+</span>
          <input type="number" value="${ph.months||0}" min="0" max="60" step="1" style="color:#AEBC46;${_inBase}"
            onchange="_dcfPhasesManuallyEdited=true;P.pf.dcf.phases[${i}].months=Math.max(0,parseInt(this.value)||0);pfChanged()">
        </div>
      </td>`;
    });
    phaseInputs+=`<td style="padding:0 4px 0 10px;text-align:center;vertical-align:middle;border-left:1px solid #2a2a2e">
      <div style="font-size:8px;color:#6aaa6a;margin-bottom:2px;letter-spacing:0.3px">Absorption</div>
      <div style="display:flex;align-items:center;gap:2px;justify-content:center">
        <input type="number" value="${_absStartVal}" min="0" max="120" step="1" style="color:#88bbdd;${_inBase}"
          onchange="P.pf.dcf.absorptionStart=Math.max(0,parseInt(this.value)||0);pfChanged()">
        <span style="color:#333;font-size:8px">+</span>
        <input type="number" value="${dcf.absorptionMonths||18}" min="1" max="60" step="1" style="color:#AEBC46;${_inBase}"
          onchange="P.pf.dcf.absorptionMonths=Math.max(1,parseInt(this.value)||1);pfChanged()">
      </div>
    </td>`;
    phaseInputs+=`</tr></table></div>`;

    // ── Timeline banner ──
    const totalPhaseMo=dcf.phases.reduce((s,p)=>s+(p.months||0),0);
    let timelineBanner='';
    {
      const isZBLA=P._requiresZBLA;
      const timelineType=isZBLA?'ZBLA Required':'As-of-Right';
      const timelineColor=isZBLA?'#e8c87a':'#4ecdc4';
      const timelineBorder=isZBLA?'#5a4a20':'#1a3a2a';
      const timelineBg=isZBLA?'rgba(232,200,122,0.06)':'rgba(78,205,196,0.04)';
      const totalWithAbs=Math.max(...dcf.phases.map(p=>(p.startMonth||0)+(p.months||0)))+(dcf.absorptionMonths||18);
      const reasons=[];
      if(isZBLA){
        try{
          computeAngularPlanes();
          if(_angularPlaneResults.front&&_angularPlaneResults.front.violations.length>0) reasons.push('front angular plane');
          if(_angularPlaneResults.rear&&_angularPlaneResults.rear.violations.length>0) reasons.push('rear transition plane');
        }catch(e){}
        const z=P.zoning;
        if(z){
          const sA=pfResult.siteArea||0;
          const fsi=sA>0?pfResult.totalGFA/sA:0;
          if(z.fsiLimit&&fsi>z.fsiLimit) reasons.push('FSI exceedance');
          const maxH=P.vols.reduce((m,v)=>{const h=v.storeys>1?(P.flr.gf*0.3048)+(v.storeys-1)*(P.flr.typ*0.3048):(P.flr.gf*0.3048);return Math.max(m,h);},0);
          if(z.heightLimit&&maxH>z.heightLimit) reasons.push('height exceedance');
        }
      }
      const reasonText=reasons.length>0?' \u2014 '+reasons.join(', '):'';
      timelineBanner=`<div style="background:${timelineBg};border:1px solid ${timelineBorder};border-radius:4px;padding:8px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:10px;font-weight:700;color:${timelineColor}">${isZBLA?'\u26A0':'\u2713'} ${timelineType}</span>
          <span style="font-size:9px;color:#666">Total: <b style="color:#aaa">${totalWithAbs}mo</b> (construction + ${dcf.absorptionMonths||18}mo absorption)${reasonText}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center">`;
      if(_dcfPhasesManuallyEdited) timelineBanner+=`<span style="font-size:8px;color:#555;font-style:italic">manually edited</span>`;
      timelineBanner+=`<button onclick="_dcfPhasesManuallyEdited=false;_lastAutoTimeline=null;pfChanged()" style="background:#1a1a1e;border:1px solid #333;color:#888;padding:3px 10px;border-radius:4px;font-size:9px;cursor:pointer;font-family:inherit" title="Reset to auto-calculated schedule">\u21BB Auto</button>
        </div></div>`;
    }

    ganttEl.innerHTML=`<div style="background:#111114;border:1px solid #2a2a2e;border-radius:6px;padding:10px 10px 6px;overflow-x:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;font-weight:700;color:#AEBC46;letter-spacing:1.5px">DEVELOPMENT PLAN</div>
        <div style="font-size:9px;color:#555">Start: ${calLabel(0)} \u2014 Completion: ${calLabel(totalMonths)} \u2014 Stabilized: ${calLabel(totalMonths+dcfResult.absMonths)}</div>
      </div>
      ${timelineBanner}${gSvg}${phaseInputs}</div>`;

    // ── Drag interaction system ──
    _initGanttDrag(ganttEl);
  }

  // ── Cash Flow Chart ──
  const chartEl=document.getElementById('pf-cashflow-chart');
  if(chartEl){
    const cW=chartEl.clientWidth||600;
    const cH=200;
    const trimmed=monthly.filter(m=>m.cumCost>0||m.cumRev>0);
    const maxVal=Math.max(...trimmed.map(m=>Math.max(m.cumCost,m.cumRev)),1);
    const minVal=Math.min(...trimmed.map(m=>m.cumNet),0);
    const range=maxVal-minVal;
    const padL=60, padR=10, padT=20, padB=30;
    const plotW=cW-padL-padR, plotH=cH-padT-padB;

    function toX(i){return padL+(i/Math.max(1,trimmed.length-1))*plotW;}
    function toY(v){return padT+plotH-(v-minVal)/range*plotH;}

    let cSvg=`<svg width="${cW}" height="${cH}" style="display:block;font-family:Outfit,DM Sans,sans-serif">`;
    cSvg+=`<rect width="${cW}" height="${cH}" fill="#1a1a1a" rx="4"/>`;

    // Zero line
    const zeroY=toY(0);
    cSvg+=`<line x1="${padL}" y1="${zeroY}" x2="${cW-padR}" y2="${zeroY}" stroke="#555" stroke-width="0.5"/>`;

    // Y-axis labels
    for(let v=0;v<=maxVal;v+=maxVal/4){
      const y=toY(v);
      cSvg+=`<text x="${padL-4}" y="${y+3}" fill="#777" font-size="8" text-anchor="end">${fmtM(v)}</text>`;
    }

    // Cost curve (red)
    let costPath=trimmed.map((m,i)=>`${i===0?'M':'L'}${toX(i)},${toY(m.cumCost)}`).join(' ');
    cSvg+=`<path d="${costPath}" fill="none" stroke="#e07b6a" stroke-width="1.5"/>`;

    // Revenue curve (green)
    let revPath=trimmed.map((m,i)=>`${i===0?'M':'L'}${toX(i)},${toY(m.cumRev)}`).join(' ');
    cSvg+=`<path d="${revPath}" fill="none" stroke="#6aaa6a" stroke-width="1.5"/>`;

    // Net curve (yellow)
    let netPath=trimmed.map((m,i)=>`${i===0?'M':'L'}${toX(i)},${toY(m.cumNet)}`).join(' ');
    cSvg+=`<path d="${netPath}" fill="none" stroke="#AEBC46" stroke-width="2"/>`;

    // Occupancy marker
    if(constructionEnd<trimmed.length){
      const ox=toX(constructionEnd);
      cSvg+=`<line x1="${ox}" y1="${padT}" x2="${ox}" y2="${cH-padB}" stroke="#AEBC46" stroke-width="1" stroke-dasharray="3,3"/>`;
    }

    // Legend
    cSvg+=`<circle cx="${padL+10}" cy="${cH-10}" r="3" fill="#e07b6a"/><text x="${padL+16}" y="${cH-7}" fill="#aaa" font-size="8">Cum. Cost</text>`;
    cSvg+=`<circle cx="${padL+80}" cy="${cH-10}" r="3" fill="#6aaa6a"/><text x="${padL+86}" y="${cH-7}" fill="#aaa" font-size="8">Cum. Revenue</text>`;
    cSvg+=`<circle cx="${padL+160}" cy="${cH-10}" r="3" fill="#AEBC46"/><text x="${padL+166}" y="${cH-7}" fill="#aaa" font-size="8">Net CF</text>`;

    // X-axis months
    for(let m=0;m<trimmed.length;m+=12){
      cSvg+=`<text x="${toX(m)}" y="${cH-padB+12}" fill="#777" font-size="8" text-anchor="middle">Yr${Math.round(m/12)}</text>`;
    }

    cSvg+=`</svg>`;
    chartEl.innerHTML=`<div style="background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:8px">
      <div style="font-size:11px;font-weight:700;color:#AEBC46;margin-bottom:6px;letter-spacing:1px">CUMULATIVE CASH FLOWS</div>
      ${cSvg}</div>`;
  }

  // ── DCF Summary KPIs ──
  const sumEl=document.getElementById('pf-dcf-summary');
  if(sumEl){
    const irrColor=irr>0.15?'#6aaa6a':irr>0.08?'#AEBC46':'#e07b6a';
    sumEl.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
      <div style="background:#1a1a1a;padding:10px;border-radius:4px;border:1px solid #333;border-left:3px solid ${irrColor}">
        <div style="color:#888;font-size:9px">Project IRR (Unlevered)</div>
        <div style="color:${irrColor};font-weight:700;font-size:16px">${(irr*100).toFixed(1)}%</div>
      </div>
      <div style="background:#1a1a1a;padding:10px;border-radius:4px;border:1px solid #333;border-left:3px solid #c49ade">
        <div style="color:#888;font-size:9px">NPV @ ${(dcf.discountRate*100).toFixed(0)}%</div>
        <div style="color:#c49ade;font-weight:700;font-size:16px">${fmtM(npv)}</div>
      </div>
      <div style="background:#1a1a1a;padding:10px;border-radius:4px;border:1px solid #333;border-left:3px solid #4ecdc4">
        <div style="color:#888;font-size:9px">Equity Multiple</div>
        <div style="color:#4ecdc4;font-weight:700;font-size:16px">${equityMultiple.toFixed(2)}x</div>
      </div>
      <div style="background:#1a1a1a;padding:10px;border-radius:4px;border:1px solid #333;border-left:3px solid #e8c87a">
        <div style="color:#888;font-size:9px">Peak Equity Req.</div>
        <div style="color:#e8c87a;font-weight:700;font-size:16px">${fmtM(peakEquity)}</div>
      </div>
      <div style="background:#1a1a1a;padding:10px;border-radius:4px;border:1px solid #333;border-left:3px solid #88aabb">
        <div style="color:#888;font-size:9px">Project Duration</div>
        <div style="color:#88aabb;font-weight:700;font-size:16px">${(totalMonths+dcfResult.absMonths)+' mo'}</div>
        <div style="color:#666;font-size:9px">${(totalMonths/12).toFixed(1)+' yr build + '+(dcfResult.absMonths/12).toFixed(1)+' yr abs.'}</div>
      </div>
    </div>`;
  }
}

// ═══════════════════════════════════════════════════════════
//  MONTE CARLO SENSITIVITY ANALYSIS
// ═══════════════════════════════════════════════════════════

/**
 * Run a Monte Carlo simulation over key pro-forma variables to assess risk.
 * Samples residential PSF, hard-cost escalation, absorption rate, interest rate, DC escalation,
 * cap rate, timeline delay, and pre-sale velocity across specified distributions.
 * @param {Object} pfResult - Output of pfCalc().
 * @param {number} [iterations=5000] - Number of simulation runs.
 * @returns {Object} Stats (mean/median/percentiles for IRR and margin), tornado sensitivity data, and IRR histogram.
 */
function runMonteCarlo(pfResult, iterations=5000){
  const d=pfResult;
  const dcf=P.pf.dcf;
  const pf=P.pf;
  // ── Input variable distributions (residential) ──
  let vars;
  {
    const totalResiSF=(d.unitMix||[]).reduce((s,u)=>s+u.count*u.size,0);
    const weightedPSF=totalResiSF>0?(d.resiRevenue||0)/totalResiSF:1050;
    vars=[
      {id:'psf',     name:'Residential $/sf',       base:Math.round(weightedPSF),  std:75,    dist:'normal',   unit:'$/sf'},
      {id:'hardCost',name:'Hard Cost Escalation',    base:1.0,              std:0.08,  dist:'lognormal',unit:'×'},
      {id:'absRate', name:'Absorption Rate (months)', base:dcf.absorptionMonths||18, min:12, max:36, dist:'triangular', unit:'mo'},
      {id:'intRate', name:'Interest Rate',           base:pf.intRate,       min:0.04,  max:0.09, dist:'uniform', unit:'%'},
      {id:'dcEscal', name:'DC Escalation',           base:1.0,              min:0.95,  max:1.15, dist:'uniform', unit:'×'},
      {id:'capRate', name:'Commercial Cap Rate',     base:(pf.comm&&pf.comm[0]&&pf.comm[0].cap)||0.06, std:0.008, dist:'normal', unit:'%'},
      {id:'timeline',name:'Timeline Delay Factor',   base:1.0,              min:0.9,   max:1.4,  dist:'triangular', unit:'×'},
      {id:'vacancy', name:'Pre-Sale Velocity',       base:dcf.preSalesPct||0.70,  min:0.50,  max:0.90, dist:'triangular', unit:'%'}
    ];
  }

  // ── Random samplers ──
  function randNormal(mean,std){ // Box-Muller
    const u1=Math.random(), u2=Math.random();
    return mean+std*Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  }
  function randLogNormal(mean,std){
    const mu=Math.log(mean)-0.5*std*std;
    return Math.exp(randNormal(mu,std));
  }
  function randTriangular(min,max,mode){
    mode=mode||(min+max)/2;
    const u=Math.random();
    const fc=(mode-min)/(max-min);
    if(u<fc) return min+Math.sqrt(u*(max-min)*(mode-min));
    return max-Math.sqrt((1-u)*(max-min)*(max-mode));
  }
  function randUniform(min,max){ return min+Math.random()*(max-min); }

  function sample(v){
    if(v.dist==='normal')     return randNormal(v.base, v.std);
    if(v.dist==='lognormal')  return randLogNormal(v.base, v.std);
    if(v.dist==='triangular') return randTriangular(v.min, v.max, v.base);
    if(v.dist==='uniform')    return randUniform(v.min, v.max);
    return v.base;
  }

  // ── Run simulations ──
  const results=[];
  const varSensitivity=vars.map(()=>({lo:[],hi:[]})); // for tornado

  for(let i=0;i<iterations;i++){
    const draws=vars.map(v=>sample(v));
    let totalRev,totalCost,margin,marginOnCost,irrEst;

    {
      const sPSF=draws[0];
      const sHardMult=draws[1];
      const sAbsMonths=Math.round(draws[2]);
      const sIntRate=draws[3];
      // draws[4] was DC escalation — no longer used (soft costs are flat % of hard)
      const sCapRate=Math.max(0.03,draws[5]);
      const sTimeline=draws[6];
      const sPreSale=Math.max(0.3,Math.min(0.95,draws[7]));

      const resiRev=sPSF*(d.netResiSF||0);
      const commNOI=d.totalCommNOI||0;
      const commVal=sCapRate>0?commNOI/sCapRate:0;
      const parkRev=d.parkRev||0, lockerRev=d.lockerRev||0;
      totalRev=resiRev+commVal+parkRev+lockerRev;

      const simHard=d.totalHard*sHardMult;
      const simSoft=d.totalSoft*sHardMult; // soft scales with hard since it's a % of hard
      const totalConst=dcf.phases.reduce((s,ph)=>s+ph.months,0)*sTimeline;
      const loanBase=(simHard+simSoft)*pf.ltc;
      const simInt=loanBase*sIntRate*(totalConst/12)*0.60;
      const simLoanFee=loanBase*pf.loanFeePct;
      const carrying=d.totalLand*0.03*(totalConst/12*0.25)+(simHard+simSoft)*0.005*(sAbsMonths/12);
      totalCost=d.totalLand+simHard+simSoft+simInt+simLoanFee+carrying;
      margin=totalRev-totalCost;
      marginOnCost=totalCost>0?margin/totalCost:0;
      const projYears=(totalConst+sAbsMonths)/12;
      const avgCap=totalCost*0.55;
      irrEst=avgCap>0&&projYears>0?margin/(avgCap*projYears):0;
    }

    results.push({margin, marginOnCost, irr:irrEst, totalRev, totalCost, draws});

    // Track sensitivity contributions
    vars.forEach((v,vi)=>{
      const median=v.base;
      const dr=draws[vi];
      if(v.dist==='normal'||v.dist==='lognormal'){
        if(dr<median-v.std*0.25) varSensitivity[vi].lo.push(marginOnCost);
        else if(dr>median+v.std*0.25) varSensitivity[vi].hi.push(marginOnCost);
      } else {
        const mid=(v.min+v.max)/2;
        const range=(v.max-v.min);
        if(dr<mid-range*0.15) varSensitivity[vi].lo.push(marginOnCost);
        else if(dr>mid+range*0.15) varSensitivity[vi].hi.push(marginOnCost);
      }
    });
  }

  // ── Compute statistics ──
  results.sort((a,b)=>a.irr-b.irr);
  const margins=results.map(r=>r.marginOnCost).sort((a,b)=>a-b);
  const irrs=results.map(r=>r.irr).sort((a,b)=>a-b);

  const mean=arr=>arr.reduce((s,v)=>s+v,0)/arr.length;
  const percentile=(arr,p)=>arr[Math.floor(arr.length*p)];

  const stats={
    iterations,
    irrMean:mean(irrs), irrMedian:percentile(irrs,0.5),
    irrP10:percentile(irrs,0.10), irrP25:percentile(irrs,0.25),
    irrP75:percentile(irrs,0.75), irrP90:percentile(irrs,0.90),
    marginMean:mean(margins), marginMedian:percentile(margins,0.5),
    marginP10:percentile(margins,0.10), marginP90:percentile(margins,0.90),
    probViable:margins.filter(m=>m>=0.15).length/iterations,
    probPositive:margins.filter(m=>m>0).length/iterations,
    varAt10:percentile(margins,0.10),
  };

  // Tornado data: for each variable, measure the swing in margin
  const tornado=vars.map((v,vi)=>{
    const lo=varSensitivity[vi].lo.length>5?mean(varSensitivity[vi].lo):stats.marginMean;
    const hi=varSensitivity[vi].hi.length>5?mean(varSensitivity[vi].hi):stats.marginMean;
    return {name:v.name, lo, hi, swing:Math.abs(hi-lo)};
  }).sort((a,b)=>b.swing-a.swing);

  // Histogram bins for IRR
  const histMin=Math.floor(irrs[0]*100)/100;
  const histMax=Math.ceil(irrs[irrs.length-1]*100)/100;
  const numBins=30;
  const binWidth=(histMax-histMin)/numBins;
  const histogram=[];
  for(let b=0;b<numBins;b++){
    const lo=histMin+b*binWidth, hi=lo+binWidth;
    const count=irrs.filter(v=>v>=lo&&v<hi).length;
    histogram.push({lo,hi,count,pct:count/iterations});
  }

  return {stats, tornado, histogram, vars, results};
}

/**
 * Render the Monte Carlo risk analysis UI: summary cards, IRR histogram, and tornado chart.
 * @param {Object} pfResult - Output of pfCalc().
 */
function renderMonteCarlo(pfResult){
  const el=document.getElementById('pf-montecarlo');
  if(!el)return;

  const mc=runMonteCarlo(pfResult);
  const s=mc.stats;
  const pct=v=>(v*100).toFixed(1)+'%';
  const fmt$=v=>'$'+Math.round(v).toLocaleString();
  const viableThreshold=0.15;
  const viableLabel='>15%';

  let html=`<div class="pf-section"><div class="pf-title" style="color:#e07b6a">MONTE CARLO RISK ANALYSIS <span style="font-size:10px;color:#888">(${s.iterations.toLocaleString()} simulations)</span></div>`;

  // ── Summary Cards ──
  html+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0">
    <div style="background:#1a1a1a;padding:10px;border-radius:4px;border-left:3px solid ${s.probViable>=0.6?'#4a8':'#e07b6a'}">
      <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px">Prob. Viable (${viableLabel})</div>
      <div style="font-size:22px;font-weight:700;color:${s.probViable>=0.6?'#AEBC46':'#e07b6a'}">${pct(s.probViable)}</div>
    </div>
    <div style="background:#1a1a1a;padding:10px;border-radius:4px;border-left:3px solid #c49ade">
      <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px">Median IRR</div>
      <div style="font-size:22px;font-weight:700;color:#c49ade">${pct(s.irrMedian)}</div>
    </div>
    <div style="background:#1a1a1a;padding:10px;border-radius:4px;border-left:3px solid #4ecdc4">
      <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px">Median Margin</div>
      <div style="font-size:22px;font-weight:700;color:#4ecdc4">${pct(s.marginMedian)}</div>
    </div>
    <div style="background:#1a1a1a;padding:10px;border-radius:4px;border-left:3px solid #e8c87a">
      <div style="font-size:9px;color:#888;text-transform:uppercase;letter-spacing:1px">Value at Risk (P10)</div>
      <div style="font-size:22px;font-weight:700;color:#e8c87a">${pct(s.varAt10)}</div>
    </div>
  </div>`;

  // ── IRR Distribution Histogram ──
  const histMax=Math.max(...mc.histogram.map(b=>b.count),1);
  const hW=600, hH=140, hPadL=45, hPadR=10, hPadT=10, hPadB=25;
  const hPlotW=hW-hPadL-hPadR, hPlotH=hH-hPadT-hPadB;
  const bW=hPlotW/mc.histogram.length;

  html+=`<div style="display:flex;gap:12px;margin:10px 0">`;
  html+=`<div style="flex:1.5;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px">
    <div style="font-size:10px;font-weight:700;color:#c49ade;letter-spacing:1px;margin-bottom:6px">IRR DISTRIBUTION</div>
    <svg width="${hW}" height="${hH}" style="display:block;font-family:Outfit,DM Sans,sans-serif">
      <rect width="${hW}" height="${hH}" fill="#1a1a1a" rx="4"/>`;

  mc.histogram.forEach((bin,i)=>{
    const barH=histMax>0?bin.count/histMax*hPlotH:0;
    const x=hPadL+i*bW;
    const y=hPadT+hPlotH-barH;
    const isViable=bin.lo>=viableThreshold;
    const col=isViable?'#4ecdc4':'#e07b6a';
    html+=`<rect x="${x}" y="${y}" width="${Math.max(bW-1,1)}" height="${barH}" fill="${col}" opacity="0.7"/>`;
  });

  // X-axis labels
  for(let i=0;i<mc.histogram.length;i+=5){
    const bin=mc.histogram[i];
    html+=`<text x="${hPadL+i*bW+bW/2}" y="${hH-5}" fill="#777" font-size="7" text-anchor="middle">${(bin.lo*100).toFixed(0)}%</text>`;
  }
  // Y-axis
  html+=`<text x="${hPadL-4}" y="${hPadT+6}" fill="#777" font-size="7" text-anchor="end">${histMax}</text>`;
  html+=`<text x="${hPadL-4}" y="${hPadT+hPlotH}" fill="#777" font-size="7" text-anchor="end">0</text>`;

  html+=`</svg>
    <div style="font-size:8px;color:#666;margin-top:4px">P10: ${pct(s.irrP10)} · P25: ${pct(s.irrP25)} · Median: ${pct(s.irrMedian)} · P75: ${pct(s.irrP75)} · P90: ${pct(s.irrP90)}</div>
  </div>`;

  // ── Tornado Chart ──
  const tornadoTop=mc.tornado.slice(0,6);
  const tW=300, tH=140, tPadL=110, tPadR=10, tPadT=10, tPadB=10;
  const tPlotW=tW-tPadL-tPadR;
  const tRowH=(tH-tPadT-tPadB)/Math.max(tornadoTop.length,1);
  const tMaxSwing=Math.max(...tornadoTop.map(t=>t.swing),0.01);

  html+=`<div style="flex:1;background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px">
    <div style="font-size:10px;font-weight:700;color:#e8c87a;letter-spacing:1px;margin-bottom:6px">SENSITIVITY TORNADO</div>
    <svg width="${tW}" height="${tH}" style="display:block;font-family:Outfit,DM Sans,sans-serif">
      <rect width="${tW}" height="${tH}" fill="#1a1a1a" rx="4"/>`;

  const tMid=tPadL+tPlotW/2;
  html+=`<line x1="${tMid}" y1="${tPadT}" x2="${tMid}" y2="${tH-tPadB}" stroke="#555" stroke-width="0.5"/>`;

  tornadoTop.forEach((t,i)=>{
    const y=tPadT+i*tRowH;
    const baseMOC=s.marginMean;
    const loW=Math.abs(t.lo-baseMOC)/tMaxSwing*tPlotW/2;
    const hiW=Math.abs(t.hi-baseMOC)/tMaxSwing*tPlotW/2;
    html+=`<text x="${tPadL-4}" y="${y+tRowH/2+3}" fill="#aaa" font-size="8" text-anchor="end">${t.name}</text>`;
    html+=`<rect x="${tMid-loW}" y="${y+2}" width="${loW}" height="${tRowH-4}" fill="#e07b6a" opacity="0.7" rx="2"/>`;
    html+=`<rect x="${tMid}" y="${y+2}" width="${hiW}" height="${tRowH-4}" fill="#4ecdc4" opacity="0.7" rx="2"/>`;
  });

  html+=`</svg>
    <div style="display:flex;justify-content:center;gap:12px;margin-top:4px">
      <span style="font-size:8px;color:#e07b6a">◼ Downside</span>
      <span style="font-size:8px;color:#4ecdc4">◼ Upside</span>
    </div>
  </div>`;

  html+=`</div>`; // close flex row
  html+=`<div class="pf-note">Monte Carlo simulates ${s.iterations.toLocaleString()} scenarios varying residential PSF, hard costs, absorption, interest rates, cap rates, and timeline. Probability of viability = % of scenarios achieving ≥15% profit margin.</div>`;
  html+=`</div>`; // close pf-section

  el.innerHTML=html;
}