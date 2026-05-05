// scenarios.js — Financial scenario modelling, sensitivity analysis
const SCENARIO_DEFS={
  best:{
    label:'BEST CASE', color:'#33FF88', icon:'▲',
    desc:'Strong market conditions — higher revenue, lower costs, faster timeline',
    adjustments:{
      psfMult:1.10,        // +10% price per sf
      commRentMult:1.08,   // +8% commercial rents
      hardCostMult:0.95,   // -5% hard costs (competitive bidding)
      softCostMult:0.95,   // -5% soft costs
      landPriceMult:1.0,   // land price fixed (already purchased)
      intRateDelta:-0.005, // -50bps on construction financing
      absorptionMult:0.75, // 25% faster absorption
      constructionMult:0.90,// 10% faster construction
      parkPriceMult:1.10,  // +10% parking revenue
      capRateDelta:-0.005, // -50bps cap rate (higher commercial value)
    }
  },
  base:{
    label:'BASE CASE', color:'#FF9933', icon:'●',
    desc:'Current inputs — your pro-forma as configured',
    adjustments:{
      psfMult:1.0, commRentMult:1.0, hardCostMult:1.0, softCostMult:1.0,
      landPriceMult:1.0, intRateDelta:0, absorptionMult:1.0, constructionMult:1.0,
      parkPriceMult:1.0, capRateDelta:0
    }
  },
  stress:{
    label:'STRESS CASE', color:'#FF4444', icon:'▼',
    desc:'Adverse conditions — lower revenue, higher costs, extended timeline',
    adjustments:{
      psfMult:0.88,        // -12% price per sf
      commRentMult:0.90,   // -10% commercial rents
      hardCostMult:1.10,   // +10% hard costs (supply chain)
      softCostMult:1.08,   // +8% soft costs
      landPriceMult:1.0,   // land price fixed
      intRateDelta:0.015,  // +150bps rate increase
      absorptionMult:1.50, // 50% slower absorption
      constructionMult:1.15,// 15% longer construction
      parkPriceMult:0.92,  // -8% parking revenue
      capRateDelta:0.010,  // +100bps cap rate (lower commercial value)
    }
  }
};

/**
 * Run a scenario by cloning P.pf, applying adjustments, and computing pfCalc()
 * Returns the full pfCalc result plus DCF and summary metrics
 */
/**
 * Runs a pro-forma calculation under a scenario's adjusted assumptions (best/base/stress).
 * @param {string} scenarioKey - Key from SCENARIO_DEFS: 'best'|'base'|'stress'
 * @returns {Object} Pro-forma result from pfCalc() with scenario adjustments applied
 */
function runScenario(scenarioKey){
  const adj=SCENARIO_DEFS[scenarioKey].adjustments;
  if(scenarioKey==='base'){
    // Just use current inputs
    const d=pfData();
    let dcf=null;
    try{dcf=calcDCF(d);}catch(e){}
    return {pf:d, dcf, key:scenarioKey};
  }

  // Deep clone P.pf
  const origPf=JSON.parse(JSON.stringify(P.pf));

  // Apply adjustments
  if(P.pf.units) P.pf.units.forEach(u=>{u.psf=Math.round(u.psf*adj.psfMult);});
  if(P.pf.tenants) P.pf.tenants.forEach(t=>{
    t.cap=+(t.cap+adj.capRateDelta).toFixed(4);
  });
  if(P.pf.comm) P.pf.comm.forEach(c=>{c.rent=+(c.rent*adj.commRentMult).toFixed(1); c.cap=+(c.cap+adj.capRateDelta).toFixed(4);});
  Object.keys(P.pf.hc).forEach(k=>{P.pf.hc[k]=+(P.pf.hc[k]*adj.hardCostMult).toFixed(2);});
  Object.keys(P.pf.sc).forEach(k=>{P.pf.sc[k]=+(P.pf.sc[k]*adj.softCostMult).toFixed(4);});
  P.pf.landPrice=Math.round(P.pf.landPrice*adj.landPriceMult);
  P.pf.intRate=+(P.pf.intRate+adj.intRateDelta).toFixed(4);
  if(P.pf.parkPrice) P.pf.parkPrice=Math.round(P.pf.parkPrice*adj.parkPriceMult);
  if(P.pf.dcf&&P.pf.dcf.absorptionMonths) P.pf.dcf.absorptionMonths=Math.round(P.pf.dcf.absorptionMonths*adj.absorptionMult);
  if(P.pf.dcf&&P.pf.dcf.phases) P.pf.dcf.phases.forEach(ph=>{ph.months=Math.round(ph.months*adj.constructionMult);});

  // Clear cache and recalculate
  _pfCache=null;
  const d=pfData();
  let dcf=null;
  try{dcf=calcDCF(d);}catch(e){}

  // Restore original pf
  P.pf=origPf;
  _pfCache=null; // clear stale cache

  return {pf:d, dcf, key:scenarioKey};
}

/**
 * Runs sensitivity analysis by varying one input and measuring profit impact.
 * @param {string} inputKey - Input to vary: 'psf'|'hardCost'|'intRate'|'landPrice'
 * @param {number[]} range - [lowFactor, highFactor] multiplier range (e.g. [0.8, 1.2])
 * @param {number} steps - Number of intervals (produces steps+1 data points)
 * @returns {Object[]} Array of {factor, margin, marginOnCost, totalRev, totalCost}
 */
function sensitivityAnalysis(inputKey, range, steps){
  const results=[];
  const origPf=JSON.parse(JSON.stringify(P.pf));

  for(let i=0;i<=steps;i++){
    const factor=range[0]+(range[1]-range[0])*i/steps;
    // Apply factor based on input key
    switch(inputKey){
      case 'psf': P.pf.units.forEach(u=>{u.psf=Math.round(origPf.units[P.pf.units.indexOf(u)]?.psf*factor||u.psf*factor);}); break;
      case 'hardCost': Object.keys(P.pf.hc).forEach(k=>{P.pf.hc[k]=+(origPf.hc[k]*factor).toFixed(2);}); break;
      case 'intRate': P.pf.intRate=origPf.intRate*factor; break;
      case 'landPrice': P.pf.landPrice=Math.round(origPf.landPrice*factor); break;
    }
    // Recalc
    _pfCache=null;
    try{
      const d=pfData();
      results.push({factor, margin:d.margin, marginOnCost:d.marginOnCost, totalRev:d.totalGrossRev, totalCost:d.totalCost});
    }catch(e){results.push({factor,margin:0,marginOnCost:0,totalRev:0,totalCost:0});}
  }

  // Restore
  P.pf=origPf;
  _pfCache=null;
  return results;
}

/**
 * Render the full scenario comparison dashboard
 */
/** Renders the full scenario comparison dashboard with best/base/stress KPIs and sensitivity heatmaps. */
function renderScenarioDashboard(){
  const el=document.getElementById('scenario-dashboard-content');
  if(!el) return;

  let siteArea=0;
  try{siteArea=lotArea();}catch(e){}
  if(siteArea<1){
    el.innerHTML='<div style="text-align:center;padding:30px;color:#666">Draw a lot and configure volumes to enable scenario analysis.</div>';
    return;
  }

  el.innerHTML='<div style="text-align:center;padding:20px;color:#FF9933">Calculating scenarios...</div>';

  // Run all three scenarios
  const scenarios={};
  ['best','base','stress'].forEach(k=>{
    try{scenarios[k]=runScenario(k);}catch(e){scenarios[k]={pf:{margin:0,marginOnCost:0,totalGrossRev:0,totalCost:0,totalGFA:0,fsi:0},dcf:null,key:k};}
  });

  // Run sensitivity analysis on 4 key inputs
  const sensInputs=[
    {key:'psf', label:'Revenue ($/sf)', range:[0.80,1.20], steps:20, baseLabel:'Residential PSF'},
    {key:'hardCost', label:'Hard Costs', range:[0.85,1.15], steps:20, baseLabel:'Construction $/sf'},
    {key:'intRate', label:'Interest Rate', range:[0.70,1.30], steps:20, baseLabel:'Construction Financing'},
    {key:'landPrice', label:'Land Price', range:[0.80,1.20], steps:20, baseLabel:'Land Acquisition'}
  ];
  const sensResults={};
  sensInputs.forEach(si=>{
    sensResults[si.key]=sensitivityAnalysis(si.key, si.range, si.steps);
  });

  // Build HTML
  let html='';

  // ── Scenario comparison cards ──
  html+='<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">';
  ['best','base','stress'].forEach(k=>{
    const def=SCENARIO_DEFS[k];
    const s=scenarios[k];
    const d=s.pf;
    const dcf=s.dcf;
    const irr=dcf?dcf.irr:null;
    const npv=dcf?dcf.npv:null;
    const eqMult=dcf?dcf.equityMultiple:null;
    const marginColor=d.marginOnCost>0.15?'#33FF88':(d.marginOnCost>0.05?'#FF9933':'#FF4444');

    html+=`<div style="background:#0D0D12;border:1px solid ${def.color}55;border-top:3px solid ${def.color};border-radius:2px;padding:12px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span style="font-size:14px;color:${def.color}">${def.icon}</span>
        <span style="font-size:11px;font-weight:700;color:${def.color};letter-spacing:1.5px">${def.label}</span>
      </div>
      <div style="font-size:12px;color:#666680;margin-bottom:10px">${def.desc}</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;font-size:13px">
        <span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Total Revenue</span><span style="color:#CCCCDD;text-align:right;font-weight:600">${fmtM(d.totalGrossRev)}</span>
        <span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Total Cost</span><span style="color:#CCCCDD;text-align:right;font-weight:600">${fmtM(d.totalCost)}</span>
        <span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Margin</span><span style="color:${marginColor};text-align:right;font-weight:700">${fmtM(d.margin)}</span>
        <span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Profit Margin</span><span style="color:${marginColor};text-align:right;font-weight:700">${(d.marginOnCost*100).toFixed(1)}%</span>
        ${irr!==null?`<span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Levered IRR</span><span style="color:${irr>0.15?'#33FF88':irr>0.08?'#FF9933':'#FF4444'};text-align:right;font-weight:700">${(irr*100).toFixed(1)}%</span>`:''}
        ${npv!==null?`<span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">NPV @ ${(P.pf.dcf.discountRate*100).toFixed(0)}%</span><span style="color:#CCCCDD;text-align:right;font-weight:600">${fmtM(npv)}</span>`:''}
        ${eqMult!==null?`<span style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Equity Multiple</span><span style="color:#CCCCDD;text-align:right;font-weight:600">${eqMult.toFixed(2)}×</span>`:''}
      </div>
    </div>`;
  });
  html+='</div>';

  // ── Scenario delta table ──
  html+='<div style="font-size:13px;font-weight:700;color:#FF9933;letter-spacing:2px;margin-bottom:8px">SCENARIO DELTA ANALYSIS</div>';
  const base=scenarios.base.pf;
  const metrics=[
    {label:'Total Revenue',     get:d=>d.totalGrossRev,   fmt:fmtM},
    {label:'Total Cost',        get:d=>d.totalCost,       fmt:fmtM},
    {label:'Development Margin', get:d=>d.margin,         fmt:fmtM},
    {label:'Profit Margin',     get:d=>d.marginOnCost,    fmt:v=>(v*100).toFixed(1)+'%'},
    {label:'Hard Construction', get:d=>d.totalHard,       fmt:fmtM},
    {label:'Soft Costs',        get:d=>d.totalSoft,       fmt:fmtM},
    {label:'Financing Costs',   get:d=>d.totalFinancing,  fmt:fmtM},
    {label:'Project Duration',  get:d=>d.totalProjectMonths, fmt:v=>Math.round(v)+' mo'}
  ];

  html+=`<div style="background:#0D0D12;border:1px solid #2A2A35;border-radius:2px;padding:8px;margin-bottom:14px;overflow-x:auto">
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="border-bottom:1px solid #FF993340">
        <th style="text-align:left;padding:4px 8px;color:#888899;font-weight:600;font-size:12px;letter-spacing:1px">METRIC</th>
        <th style="text-align:right;padding:4px 8px;color:${SCENARIO_DEFS.best.color};font-weight:700;font-size:12px;letter-spacing:1px">BEST</th>
        <th style="text-align:right;padding:4px 8px;color:#666680;font-size:12px">Δ</th>
        <th style="text-align:right;padding:4px 8px;color:${SCENARIO_DEFS.base.color};font-weight:700;font-size:12px;letter-spacing:1px">BASE</th>
        <th style="text-align:right;padding:4px 8px;color:${SCENARIO_DEFS.stress.color};font-weight:700;font-size:12px;letter-spacing:1px">STRESS</th>
        <th style="text-align:right;padding:4px 8px;color:#666680;font-size:12px">Δ</th>
      </tr></thead><tbody>`;

  metrics.forEach(m=>{
    const bv=m.get(scenarios.best.pf);
    const basev=m.get(base);
    const sv=m.get(scenarios.stress.pf);
    const dBest=basev!==0?((bv-basev)/Math.abs(basev)*100).toFixed(1)+'%':'—';
    const dStress=basev!==0?((sv-basev)/Math.abs(basev)*100).toFixed(1)+'%':'—';
    const dBestColor=bv>=basev?'#33FF88':'#FF4444';
    const dStressColor=sv<=basev?'#FF4444':'#33FF88';
    // For cost metrics, invert the color logic
    const isCost=m.label.includes('Cost')||m.label.includes('Hard')||m.label.includes('Soft')||m.label.includes('Financing')||m.label.includes('Duration');
    const bCol=isCost?(bv<=basev?'#33FF88':'#FF4444'):dBestColor;
    const sCol=isCost?(sv>=basev?'#FF4444':'#33FF88'):dStressColor;

    html+=`<tr style="border-bottom:1px solid #1E1E24">
      <td style="padding:4px 8px;color:#CCCCDD">${m.label}</td>
      <td style="text-align:right;padding:4px 8px;color:#CCCCDD;font-weight:600">${m.fmt(bv)}</td>
      <td style="text-align:right;padding:4px 8px;color:${bCol};font-size:12px">${dBest}</td>
      <td style="text-align:right;padding:4px 8px;color:#FF9933;font-weight:600">${m.fmt(basev)}</td>
      <td style="text-align:right;padding:4px 8px;color:#CCCCDD;font-weight:600">${m.fmt(sv)}</td>
      <td style="text-align:right;padding:4px 8px;color:${sCol};font-size:12px">${dStress}</td>
    </tr>`;
  });
  html+=`</tbody></table></div>`;

  // ── Sensitivity analysis charts (SVG sparklines) ──
  html+='<div style="font-size:13px;font-weight:700;color:#FF9933;letter-spacing:2px;margin-bottom:8px">SENSITIVITY ANALYSIS</div>';
  html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">';

  sensInputs.forEach(si=>{
    const data=sensResults[si.key];
    if(!data||data.length===0) return;

    // SVG sparkline chart
    const w=300, h=100, pad=25;
    const margins=data.map(d=>d.marginOnCost);
    const factors=data.map(d=>d.factor);
    const minM=Math.min(...margins), maxM=Math.max(...margins);
    const minF=Math.min(...factors), maxF=Math.max(...factors);
    const rangeM=maxM-minM||0.01;
    const rangeF=maxF-minF||0.01;

    const scaleX=f=>(f-minF)/rangeF*(w-2*pad)+pad;
    const scaleY=m=>h-pad-(m-minM)/rangeM*(h-2*pad);

    const pts=data.map(d=>`${scaleX(d.factor).toFixed(1)},${scaleY(d.marginOnCost).toFixed(1)}`).join(' ');

    // Find where margin crosses zero
    const zeroY=scaleY(0);
    const baseX=scaleX(1.0);

    // Break-even factor
    let breakEvenFactor=null;
    for(let i=1;i<data.length;i++){
      if((data[i-1].margin>=0&&data[i].margin<0)||(data[i-1].margin<0&&data[i].margin>=0)){
        // Linear interpolation
        const t=-data[i-1].margin/(data[i].margin-data[i-1].margin);
        breakEvenFactor=data[i-1].factor+t*(data[i].factor-data[i-1].factor);
        break;
      }
    }

    let svg=`<svg viewBox="0 0 ${w} ${h}" width="100%" style="display:block">`;
    // Grid
    svg+=`<rect x="0" y="0" width="${w}" height="${h}" fill="#0A0A0F" rx="2"/>`;
    // Zero line
    if(minM<0&&maxM>0){
      svg+=`<line x1="${pad}" y1="${zeroY}" x2="${w-pad}" y2="${zeroY}" stroke="#FF444466" stroke-width="0.5" stroke-dasharray="3,2"/>`;
      svg+=`<text x="${pad-2}" y="${zeroY+3}" fill="#FF4444" font-size="7" text-anchor="end" font-family="IBM Plex Mono,monospace">0%</text>`;
    }
    // Base line (factor=1.0)
    svg+=`<line x1="${baseX}" y1="${pad}" x2="${baseX}" y2="${h-pad}" stroke="#FF993366" stroke-width="0.5" stroke-dasharray="3,2"/>`;
    // Data line
    svg+=`<polyline points="${pts}" fill="none" stroke="#FF4444" stroke-width="1.5"/>`;
    // Fill area
    svg+=`<polygon points="${scaleX(minF).toFixed(1)},${scaleY(0>minM?0:minM).toFixed(1)} ${pts} ${scaleX(maxF).toFixed(1)},${scaleY(0>minM?0:minM).toFixed(1)}" fill="#FF444411"/>`;
    // Axes labels
    svg+=`<text x="${pad}" y="${h-6}" fill="#666680" font-size="7" font-family="IBM Plex Mono,monospace">${(minF*100-100).toFixed(0)}%</text>`;
    svg+=`<text x="${w-pad}" y="${h-6}" fill="#666680" font-size="7" text-anchor="end" font-family="IBM Plex Mono,monospace">+${(maxF*100-100).toFixed(0)}%</text>`;
    svg+=`<text x="${w/2}" y="${h-6}" fill="#50506A" font-size="7" text-anchor="middle" font-family="IBM Plex Mono,monospace">${si.baseLabel}</text>`;
    // Y axis
    svg+=`<text x="${pad-2}" y="${pad+3}" fill="#666680" font-size="7" text-anchor="end" font-family="IBM Plex Mono,monospace">${(maxM*100).toFixed(0)}%</text>`;
    svg+=`<text x="${pad-2}" y="${h-pad+3}" fill="#666680" font-size="7" text-anchor="end" font-family="IBM Plex Mono,monospace">${(minM*100).toFixed(0)}%</text>`;
    // Base dot
    const baseIdx=data.reduce((bi,d,i)=>Math.abs(d.factor-1.0)<Math.abs(data[bi].factor-1.0)?i:bi,0);
    svg+=`<circle cx="${baseX}" cy="${scaleY(data[baseIdx].marginOnCost)}" r="3" fill="#FF9933" stroke="#0A0A0F" stroke-width="1"/>`;
    // Break-even marker
    if(breakEvenFactor!==null){
      svg+=`<circle cx="${scaleX(breakEvenFactor)}" cy="${zeroY}" r="2.5" fill="#FF4444" stroke="#0A0A0F" stroke-width="0.8"/>`;
      svg+=`<text x="${scaleX(breakEvenFactor)}" y="${zeroY-5}" fill="#FF4444" font-size="6" text-anchor="middle" font-family="IBM Plex Mono,monospace">BE: ${((breakEvenFactor-1)*100).toFixed(0)}%</text>`;
    }
    svg+=`</svg>`;

    html+=`<div style="background:#0D0D12;border:1px solid #2A2A35;border-radius:2px;padding:8px">
      <div style="font-size:13px;font-weight:700;color:#CCCCDD;margin-bottom:4px;letter-spacing:0.5px">${si.label}</div>
      ${svg}
      <div style="font-size:12px;color:#666680;margin-top:4px;display:flex;justify-content:space-between">
        <span>Range: ${((minF-1)*100).toFixed(0)}% to +${((maxF-1)*100).toFixed(0)}%</span>
        <span>Margin: ${(minM*100).toFixed(1)}% → ${(maxM*100).toFixed(1)}%</span>
        ${breakEvenFactor!==null?`<span style="color:#FF4444">Break-even: ${((breakEvenFactor-1)*100).toFixed(0)}%</span>`:''}
      </div>
    </div>`;
  });
  html+='</div>';

  // ── Key risk metrics ──
  html+='<div style="font-size:13px;font-weight:700;color:#FF9933;letter-spacing:2px;margin-bottom:8px">RISK METRICS</div>';
  html+='<div style="background:#0D0D12;border:1px solid #2A2A35;border-radius:2px;padding:10px 12px">';

  // Calculate spread
  const bestMargin=scenarios.best.pf.marginOnCost;
  const stressMargin=scenarios.stress.pf.marginOnCost;
  const baseMargin=scenarios.base.pf.marginOnCost;
  const spread=bestMargin-stressMargin;

  // Weighted expected margin (40% base, 30% best, 30% stress — slightly pessimistic)
  const expectedMargin=baseMargin*0.40+bestMargin*0.30+stressMargin*0.30;

  // Downside risk ratio (how much worse stress is vs base, relative to best-case upside)
  const downside=baseMargin-stressMargin;
  const upside=bestMargin-baseMargin;
  const downsideRatio=upside>0?downside/upside:99;

  html+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:13px;margin-bottom:8px">
    <div style="text-align:center">
      <div style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Scenario Spread</div>
      <div style="color:#CCCCDD;font-weight:700;font-size:14px;letter-spacing:-0.03em">${(spread*100).toFixed(1)}%</div>
      <div style="color:#50506A;font-size:11px">Best − Stress</div>
    </div>
    <div style="text-align:center">
      <div style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Prob-Weighted Margin</div>
      <div style="color:${expectedMargin>0.10?'#33FF88':'#FF4444'};font-weight:700;font-size:14px;letter-spacing:-0.03em">${(expectedMargin*100).toFixed(1)}%</div>
      <div style="color:#50506A;font-size:11px">40/30/30 weighted</div>
    </div>
    <div style="text-align:center">
      <div style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Downside Ratio</div>
      <div style="color:${downsideRatio<1.5?'#33FF88':'#FF4444'};font-weight:700;font-size:14px;letter-spacing:-0.03em">${downsideRatio.toFixed(2)}×</div>
      <div style="color:#50506A;font-size:11px">${downsideRatio<1?'Upside-skewed':'Downside-skewed'}</div>
    </div>
    <div style="text-align:center">
      <div style="color:#888899;font-size:12px;letter-spacing:0.5px;text-transform:uppercase">Stress Profitable?</div>
      <div style="color:${stressMargin>0?'#33FF88':'#FF4444'};font-weight:700;font-size:14px;letter-spacing:-0.03em">${stressMargin>0?'YES':'NO'}</div>
      <div style="color:#50506A;font-size:11px">${stressMargin>0?'Margin: '+(stressMargin*100).toFixed(1)+'%':'Loss: '+fmtM(scenarios.stress.pf.margin)}</div>
    </div>
  </div>`;

  // Risk assessment text
  let riskLevel, riskColor, riskText;
  if(stressMargin>0.10&&downsideRatio<1.2){
    riskLevel='LOW';riskColor='#33FF88';
    riskText='Strong project fundamentals. Even under stress conditions, the development maintains healthy margins. Recommended for proceeding with standard risk management.';
  } else if(stressMargin>0&&downsideRatio<2.0){
    riskLevel='MODERATE';riskColor='#FFCC33';
    riskText='Acceptable risk profile. Stress case remains profitable but with compressed margins. Consider locking in construction costs early and accelerating pre-sales to reduce exposure.';
  } else if(stressMargin>-0.05){
    riskLevel='ELEVATED';riskColor='#FF9933';
    riskText='Stress scenario approaches break-even or slight loss. Significant sensitivity to market conditions. Recommend securing fixed-price GMP contracts and achieving 80%+ pre-sales before construction start.';
  } else {
    riskLevel='HIGH';riskColor='#FF4444';
    riskText='Stress scenario produces material losses. Project is highly sensitive to market assumptions. Consider restructuring: reduce land basis, secure cost certainty, or explore phased delivery to limit downside exposure.';
  }

  html+=`<div style="border-top:1px solid #2A2A35;padding-top:8px;margin-top:4px">
    <span style="font-size:12px;font-weight:700;color:${riskColor};letter-spacing:1.5px">RISK LEVEL: ${riskLevel}</span>
    <div style="font-size:13px;color:#888899;margin-top:4px;line-height:1.5">${riskText}</div>
  </div>`;
  html+='</div>';

  // Footnote
  html+='<div style="font-size:12px;color:#50506A;margin-top:12px;text-align:center">Scenario adjustments: Best (+10% PSF, -5% costs, -50bps rate, faster timeline) · Stress (-12% PSF, +10% costs, +150bps rate, slower timeline). Sensitivity ranges ±20% of base inputs.</div>';

  el.innerHTML=html;
}

// Auto-refresh scenarios when switching to tab
