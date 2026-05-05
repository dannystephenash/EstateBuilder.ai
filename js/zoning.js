// zoning.js — Zoning dashboard, compliance checks, setback derivation
/** Renders the zoning compliance dashboard — checks P.zoning against current massing and setbacks. */
function renderZoningDashboard(){
  const el=document.getElementById('zoning-dashboard-content');
  if(!el) return;

  const z=P.zoning;
  if(!z||!z.zone){
    el.innerHTML='<div style="text-align:center;padding:30px;color:#666">No zoning detected. Draw a lot on the Site Map tab to auto-detect zoning from the City of Toronto ArcGIS API.</div>';
    return;
  }

  // Compute current project metrics — every numeric field defended against NaN/undefined
  // so downstream .toFixed() and template formatting never throw.
  let gfaData={};
  try{gfaData=pfData();}catch(e){
    console.warn('[zoning] pfData() failed:', e && e.message);
    try{gfaData=computeGFA();}catch(e2){
      console.warn('[zoning] computeGFA() also failed:', e2 && e2.message);
    }
  }
  function _num(v, def){ var n = Number(v); return (isFinite(n) ? n : (def||0)); }
  const totalGFA=_num(gfaData.totalGFA, 0);
  const commGFA=_num(gfaData.commGFA, 0);
  const resiGFA=_num(gfaData.resiGFA, totalGFA-commGFA);
  const siteArea=_num(gfaData.siteArea, 0);
  const fsi=siteArea>0?totalGFA/siteArea:0;
  const maxSt=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
  const maxBuildingHeightM=(P.vols.reduce((m,v)=>{
    const h=v.storeys>1?(P.flr.gf*0.3048)+(v.storeys-1)*(P.flr.typ*0.3048):(P.flr.gf*0.3048);
    return Math.max(m,h);
  },0));

  // Lot coverage calculation
  let lotArea=0;
  try{
    const lb=lotBounds();
    lotArea=lb.width*lb.depth; // sq ft
  }catch(e){}
  const lotAreaM2=lotArea*0.0929;
  let buildingFootprintSF=0;
  P.vols.forEach(v=>{buildingFootprintSF+=(v.customAreaSF||(v.width*v.depth));});
  const actualCoverage=lotArea>0?buildingFootprintSF/lotArea:0;

  // Build compliance checks
  const checks=[];

  // 1. FSI compliance
  if(z.fsiLimit && z.fsiLimit > 0){
    const headroom=z.fsiLimit-fsi;
    const pctUsed=z.fsiLimit > 0 ? (fsi/z.fsiLimit*100) : 0;
    checks.push({
      label:'Floor Space Index (FSI)',
      permitted:z.fsiLimit.toFixed(1)+'×',
      proposed:fsi.toFixed(2)+'×',
      headroom:headroom>=0?'+'+headroom.toFixed(2)+'× remaining':'OVER by '+Math.abs(headroom).toFixed(2)+'×',
      pct:pctUsed,
      pass:fsi<=z.fsiLimit,
      detail:'Total GFA '+Math.round(totalGFA).toLocaleString()+' sf / Site Area '+Math.round(siteArea).toLocaleString()+' sf'
    });
  }

  // 2. Height compliance
  if(z.heightLimit && z.heightLimit > 0){
    const headroomH=z.heightLimit-maxBuildingHeightM;
    const pctH=z.heightLimit > 0 ? (maxBuildingHeightM/z.heightLimit*100) : 0;
    checks.push({
      label:'Building Height',
      permitted:z.heightLimit.toFixed(0)+'m',
      proposed:maxBuildingHeightM.toFixed(1)+'m ('+maxSt+'F)',
      headroom:headroomH>=0?'+'+headroomH.toFixed(1)+'m remaining':'OVER by '+Math.abs(headroomH).toFixed(1)+'m',
      pct:pctH,
      pass:maxBuildingHeightM<=z.heightLimit,
      detail:'GF: '+P.flr.gf+'ft ('+((P.flr.gf*0.3048).toFixed(1))+'m) + Typ: '+P.flr.typ+'ft ('+(P.flr.typ*0.3048).toFixed(1)+'m)'
    });
  }

  // 3. Lot coverage
  if(z.coverage){
    const headroomC=z.coverage-actualCoverage;
    const pctC=z.coverage>0?actualCoverage/z.coverage*100:0;
    checks.push({
      label:'Lot Coverage',
      permitted:(z.coverage*100).toFixed(0)+'%',
      proposed:(actualCoverage*100).toFixed(1)+'%',
      headroom:headroomC>=0?'+'+(headroomC*100).toFixed(1)+'% remaining':'OVER by '+(Math.abs(headroomC)*100).toFixed(1)+'%',
      pct:pctC,
      pass:actualCoverage<=z.coverage,
      detail:'Footprint '+Math.round(buildingFootprintSF).toLocaleString()+' sf / Lot '+Math.round(lotArea).toLocaleString()+' sf'
    });
  }

  // 4. Residential FSI sub-limit
  if(z.fsiResi && z.fsiResi > 0){
    const resiFSI=siteArea>0?resiGFA/siteArea:0;
    const headroomR=z.fsiResi-resiFSI;
    checks.push({
      label:'Residential FSI Sub-Limit',
      permitted:z.fsiResi.toFixed(1)+'×',
      proposed:resiFSI.toFixed(2)+'×',
      headroom:headroomR>=0?'+'+headroomR.toFixed(2)+'× remaining':'OVER by '+Math.abs(headroomR).toFixed(2)+'×',
      pct:z.fsiResi > 0 ? (resiFSI/z.fsiResi*100) : 0,
      pass:resiFSI<=z.fsiResi,
      detail:'Residential GFA '+Math.round(resiGFA).toLocaleString()+' sf'
    });
  }

  // 5. Commercial FSI sub-limit
  if(z.fsiComm && z.fsiComm > 0){
    const commFSI=siteArea>0?commGFA/siteArea:0;
    const headroomComm=z.fsiComm-commFSI;
    checks.push({
      label:'Commercial FSI Sub-Limit',
      permitted:z.fsiComm.toFixed(1)+'×',
      proposed:commFSI.toFixed(2)+'×',
      headroom:headroomComm>=0?'+'+headroomComm.toFixed(2)+'× remaining':'OVER by '+Math.abs(headroomComm).toFixed(2)+'×',
      pct:z.fsiComm > 0 ? (commFSI/z.fsiComm*100) : 0,
      pass:commFSI<=z.fsiComm,
      detail:'Commercial GFA '+Math.round(commGFA).toLocaleString()+' sf'
    });
  }

  // Build the setback compliance (using Toronto By-law 569-2013 minimums for CR zones)
  const zoningMinSetbacks=_getZoningMinSetbacks(z);

  const setbackChecks=[];
  if(zoningMinSetbacks){
    const sb=P.set||{};
    ['front','sideE','sideW','rear'].forEach(side=>{
      const min=zoningMinSetbacks[side];
      if(min!==undefined&&min!==null){
        const actual=(sb[side]||0)*0.3048; // convert ft to m
        const labels={front:'Front Yard',sideE:'East Side Yard',sideW:'West Side Yard',rear:'Rear Yard'};
        setbackChecks.push({
          label:labels[side]||side,
          min:min.toFixed(1)+'m',
          proposed:actual.toFixed(1)+'m ('+(sb[side]||0)+'ft)',
          pass:actual>=min,
          headroom:actual>=min?'+'+(actual-min).toFixed(1)+'m':'SHORT by '+(min-actual).toFixed(1)+'m'
        });
      }
    });
    // Step-back
    if(zoningMinSetbacks.stepback!==undefined){
      const stepM=(sb.stepback||0)*0.3048;
      setbackChecks.push({
        label:'Tower Step-Back',
        min:zoningMinSetbacks.stepback.toFixed(1)+'m',
        proposed:stepM.toFixed(1)+'m ('+(sb.stepback||0)+'ft)',
        pass:stepM>=zoningMinSetbacks.stepback,
        headroom:stepM>=zoningMinSetbacks.stepback?'+'+(stepM-zoningMinSetbacks.stepback).toFixed(1)+'m':'SHORT by '+(zoningMinSetbacks.stepback-stepM).toFixed(1)+'m'
      });
    }
  }

  // Overall compliance score
  const allChecks=[...checks,...setbackChecks];
  const passCount=allChecks.filter(c=>c.pass).length;
  const totalChecks=allChecks.length;
  const score=totalChecks>0?Math.round(passCount/totalChecks*100):0;
  const scoreColor=score>=100?'#4ecdc4':(score>=75?'#e8c87a':'#c44');

  // Render HTML
  let html='';

  // Header card — zone info + score
  html+=`<div style="display:grid;grid-template-columns:1fr auto;gap:16px;margin-bottom:14px;padding:12px;background:#1a1a1a;border:1px solid #333;border-radius:6px">
    <div>
      <div style="font-size:12px;color:#888;letter-spacing:2px;margin-bottom:4px">DETECTED ZONING</div>
      <div style="font-size:18px;font-weight:700;color:#AEBC46">${z.zoneString||z.zone}</div>
      <div style="font-size:13px;color:#888;margin-top:4px">${z.permitted.join(' · ')}</div>
      ${z.exception?'<div style="font-size:13px;color:#e8c87a;margin-top:4px">⚠ Exception #'+z.exceptionNo+' applies — '+z.bylawException+'</div>':''}
      ${z.bylawSection?'<div style="font-size:13px;color:#666;margin-top:2px">By-law Section: '+z.bylawSection+'</div>':''}
    </div>
    <div style="text-align:center;padding:8px 16px;border-left:1px solid #333">
      <div style="font-size:12px;color:#888;letter-spacing:2px;margin-bottom:4px">COMPLIANCE</div>
      <div id="zd-score-pct" style="font-size:32px;font-weight:700;color:${scoreColor}">${score}%</div>
      <div id="zd-score-detail" style="font-size:13px;color:#888">${passCount}/${totalChecks} checks pass</div>
    </div>
  </div>`;

  // Density & massing checks
  if(checks.length>0){
    html+='<div style="font-size:13px;font-weight:700;color:#4ecdc4;letter-spacing:2px;margin-bottom:8px">DENSITY & MASSING</div>';
    checks.forEach(c=>{
      const barColor=c.pass?'#4ecdc4':'#c44';
      const barPct=Math.min(c.pct,120);
      html+=`<div style="background:#1a1a1a;border:1px solid ${c.pass?'#333':'#c44'};border-radius:4px;padding:10px 12px;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:700;color:#eee">${c.label}</span>
          <span style="font-size:13px;font-weight:700;color:${c.pass?'#4ecdc4':'#c44'}">${c.pass?'✓ COMPLIANT':'✗ NON-COMPLIANT'}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:13px;margin-bottom:6px">
          <div><span style="color:#888">Permitted:</span> <span style="color:#AEBC46;font-weight:600">${c.permitted}</span></div>
          <div><span style="color:#888">Proposed:</span> <span style="color:#eee;font-weight:600">${c.proposed}</span></div>
          <div><span style="color:#888">Headroom:</span> <span style="color:${c.pass?'#4ecdc4':'#c44'};font-weight:600">${c.headroom}</span></div>
        </div>
        <div style="background:#333;border-radius:3px;height:6px;overflow:hidden;margin-bottom:3px">
          <div style="background:${barColor};height:100%;width:${Math.min(barPct,100)}%;transition:width 0.3s;border-radius:3px;${barPct>100?'box-shadow:0 0 6px '+barColor:''}"></div>
        </div>
        <div style="font-size:12px;color:#666">${c.detail}</div>
      </div>`;
    });
  }

  // Setback checks
  if(setbackChecks.length>0){
    html+='<div style="font-size:13px;font-weight:700;color:#4ecdc4;letter-spacing:2px;margin:12px 0 8px">SETBACKS & STEP-BACKS</div>';
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';
    setbackChecks.forEach(c=>{
      html+=`<div style="background:#1a1a1a;border:1px solid ${c.pass?'#333':'#c44'};border-radius:4px;padding:8px 10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;color:#eee;font-size:13px">${c.label}</span>
          <span style="font-size:12px;font-weight:700;color:${c.pass?'#4ecdc4':'#c44'}">${c.pass?'✓':'✗'}</span>
        </div>
        <div style="font-size:13px"><span style="color:#888">Min:</span> <span style="color:#AEBC46">${c.min}</span></div>
        <div style="font-size:13px"><span style="color:#888">Set:</span> <span style="color:#eee">${c.proposed}</span></div>
        <div style="font-size:12px;color:${c.pass?'#4ecdc4':'#c44'};margin-top:2px">${c.headroom}</div>
      </div>`;
    });
    html+='</div>';
  }

  // Angular Plane compliance checks (Toronto Mid-Rise Design Guidelines)
  try{ computeAngularPlanes(); }catch(e){}
  const apFront=_angularPlaneResults.front;
  const apRear=_angularPlaneResults.rear;
  if(apFront||apRear){
    html+='<div style="font-size:13px;font-weight:700;color:#c49ade;letter-spacing:2px;margin:12px 0 8px">ANGULAR PLANE ENVELOPES</div>';
    html+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">';

    // Front angular plane
    if(apFront){
      const fPass=apFront.violations.length===0;
      let fDetail='45° from opposite curb (ROW '+apFront.rowWidthM.toFixed(1)+'m)';
      if(!fPass){
        const allSt=apFront.violations.flatMap(v=>v.storeys.map(s=>v.label+' F'+s.storey+' (+'+s.overshoot.toFixed(1)+'m)'));
        fDetail+='. Violations: '+allSt.join(', ');
      }
      // Include in overall compliance score
      allChecks.push({pass:fPass});
      html+=`<div style="background:#1a1a1a;border:1px solid ${fPass?'#333':'#c44'};border-radius:4px;padding:8px 10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;color:#eee;font-size:13px">Angular Plane (Front)</span>
          <span style="font-size:12px;font-weight:700;color:${fPass?'#4ecdc4':'#c44'}">${fPass?'✓':'✗'}</span>
        </div>
        <div style="font-size:13px"><span style="color:#888">Rule:</span> <span style="color:#c49ade">45° from ROW</span></div>
        <div style="font-size:13px"><span style="color:#888">ROW:</span> <span style="color:#eee">${apFront.rowWidthM.toFixed(1)}m</span></div>
        <div style="font-size:12px;color:${fPass?'#4ecdc4':'#c44'};margin-top:2px">${fPass?'All storeys within envelope':apFront.violations.length+' volume(s) exceed plane'}</div>
      </div>`;
    }

    // Rear transition plane
    if(apRear){
      const rPass=apRear.violations.length===0;
      let rDetail='45° from rear lot line at 10.5m';
      if(!rPass){
        const allSt=apRear.violations.flatMap(v=>v.storeys.map(s=>v.label+' F'+s.storey+' (+'+s.overshoot.toFixed(1)+'m)'));
        rDetail+='. Violations: '+allSt.join(', ');
      }
      allChecks.push({pass:rPass});
      html+=`<div style="background:#1a1a1a;border:1px solid ${rPass?'#333':'#c44'};border-radius:4px;padding:8px 10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;color:#eee;font-size:13px">Rear Transition Plane</span>
          <span style="font-size:12px;font-weight:700;color:${rPass?'#4ecdc4':'#c44'}">${rPass?'✓':'✗'}</span>
        </div>
        <div style="font-size:13px"><span style="color:#888">Rule:</span> <span style="color:#e88d7a">45° at 10.5m</span></div>
        <div style="font-size:13px"><span style="color:#888">Origin:</span> <span style="color:#eee">Rear lot line</span></div>
        <div style="font-size:12px;color:${rPass?'#4ecdc4':'#c44'};margin-top:2px">${rPass?'All storeys within envelope':apRear.violations.length+' volume(s) exceed plane'}</div>
      </div>`;
    }
    html+='</div>';

    // Detail table for violations
    const allViolations=[...(apFront?apFront.violations:[]),...(apRear?apRear.violations:[])];
    if(allViolations.length>0){
      html+='<div style="background:#1a1a1a;border:1px solid #c44;border-radius:4px;padding:8px 10px;margin-top:6px">';
      html+='<div style="font-size:12px;font-weight:700;color:#c44;margin-bottom:4px">ANGULAR PLANE VIOLATIONS</div>';
      if(apFront&&apFront.violations.length>0){
        apFront.violations.forEach(v=>{
          v.storeys.forEach(s=>{
            html+=`<div style="font-size:13px;color:#ddd;margin-bottom:2px">
              <span style="color:#4ecdc4">▲ Front</span> ${v.label} — Storey ${s.storey}: building at ${s.floorTop.toFixed(1)}m, plane allows ${s.maxAllowed.toFixed(1)}m <span style="color:#c44">(+${s.overshoot.toFixed(1)}m over)</span>
            </div>`;
          });
        });
      }
      if(apRear&&apRear.violations.length>0){
        apRear.violations.forEach(v=>{
          v.storeys.forEach(s=>{
            html+=`<div style="font-size:13px;color:#ddd;margin-bottom:2px">
              <span style="color:#e88d7a">▲ Rear</span> ${v.label} — Storey ${s.storey}: building at ${s.floorTop.toFixed(1)}m, plane allows ${s.maxAllowed.toFixed(1)}m <span style="color:#c44">(+${s.overshoot.toFixed(1)}m over)</span>
            </div>`;
          });
        });
      }
      html+='</div>';
    }
  }

  // Recalculate score now that angular plane checks are included
  const finalPassCount=allChecks.filter(c=>c.pass).length;
  const finalTotalChecks=allChecks.length;
  const finalScore=finalTotalChecks>0?Math.round(finalPassCount/finalTotalChecks*100):0;

  // Optimization suggestions
  html+='<div style="font-size:13px;font-weight:700;color:#4ecdc4;letter-spacing:2px;margin:14px 0 8px">OPTIMIZATION OPPORTUNITIES</div>';
  html+='<div style="background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:10px 12px">';

  const suggestions=[];
  if(z.fsiLimit&&fsi<z.fsiLimit*0.85){
    const addGFA=Math.round((z.fsiLimit*0.95-fsi)*siteArea);
    if(addGFA>0) suggestions.push({icon:'📈',text:'FSI headroom: you could add ~'+addGFA.toLocaleString()+' sf of GFA (to 95% of permitted FSI) = potential '+Math.round(addGFA/850).toLocaleString()+' additional units.'});
  }
  if(z.fsiLimit&&fsi>z.fsiLimit){
    suggestions.push({icon:'⚠️',text:'FSI exceeds permitted density by '+((fsi-z.fsiLimit)*100/z.fsiLimit).toFixed(0)+'%. Consider reducing massing or applying for a minor variance / rezoning amendment.'});
  }
  if(z.heightLimit&&maxBuildingHeightM<z.heightLimit*0.85){
    const addFloors=Math.floor((z.heightLimit-maxBuildingHeightM)/(P.flr.typ*0.3048));
    if(addFloors>0) suggestions.push({icon:'🏗️',text:'Height headroom: '+addFloors+' additional storeys possible within the '+z.heightLimit+'m height overlay.'});
  }
  if(z.heightLimit&&maxBuildingHeightM>z.heightLimit){
    suggestions.push({icon:'⚠️',text:'Building exceeds height limit by '+(maxBuildingHeightM-z.heightLimit).toFixed(1)+'m. Reduce storeys or floor-to-floor heights, or seek a Section 37/Community Benefits amendment.'});
  }
  if(z.coverage&&actualCoverage<z.coverage*0.9){
    suggestions.push({icon:'📐',text:'Lot coverage is at '+(actualCoverage*100).toFixed(0)+'% of '+(z.coverage*100).toFixed(0)+'% permitted. Consider widening podium footprint to maximize ground-floor commercial.'});
  }
  if(suggestions.length===0){
    suggestions.push({icon:'✅',text:'Current massing is well-optimized against detected zoning parameters.'});
  }

  suggestions.forEach(s=>{
    html+='<div style="margin-bottom:6px;font-size:13px"><span style="margin-right:6px">'+s.icon+'</span><span style="color:#ddd">'+s.text+'</span></div>';
  });
  html+='</div>';

  // Footnote
  html+='<div style="font-size:12px;color:#555;margin-top:12px;text-align:center">Data source: City of Toronto ArcGIS REST API — By-law 569-2013 zoning layers. Compliance checks are indicative; always verify with municipal planning staff.</div>';

  // After all checks (including angular planes), update the header score
  setTimeout(()=>{
    const scoreEl=document.getElementById('zd-score-pct');
    const detailEl=document.getElementById('zd-score-detail');
    if(scoreEl&&detailEl){
      const fp=allChecks.filter(c=>c.pass).length;
      const ft=allChecks.length;
      const fs=ft>0?Math.round(fp/ft*100):0;
      const fc=fs>=100?'#4ecdc4':(fs>=75?'#e8c87a':'#c44');
      scoreEl.textContent=fs+'%';
      scoreEl.style.color=fc;
      detailEl.textContent=fp+'/'+ft+' checks pass';
    }
  },0);

  // ── Set ZBLA flag based on critical non-compliance ──
  // FSI exceedance, height exceedance, or angular plane violations require rezoning
  const fsiOver=checks.some(c=>c.label==='Floor Space Index (FSI)'&&!c.pass);
  const htOver=checks.some(c=>c.label==='Building Height'&&!c.pass);
  const apFrontOver=apFront&&apFront.violations.length>0;
  const apRearOver=apRear&&apRear.violations.length>0;
  P._requiresZBLA=fsiOver||htOver||apFrontOver||apRearOver;

  el.innerHTML=html;
}

/**
 * Get minimum setbacks for a given zoning designation
 * Based on Toronto By-law 569-2013 standards for common zone types
 * Returns {front, sideE, sideW, rear, stepback} in metres
 */
/**
 * Derives minimum setbacks from a zoning object (By-law 569-2013 rules).
 * @param {Object} z - P.zoning object with zone code and overlay data
 * @returns {{front:number, rear:number, sideE:number, sideW:number}} Minimum setbacks in feet
 */
function _getZoningMinSetbacks(z){
  const zc=(z.zone||'').toUpperCase();
  // CR / CRE zones — mixed-use: By-law 569-2013 Chapter 40
  if(zc.startsWith('CR')){
    return {front:0, sideE:0, sideW:0, rear:7.5, stepback:3.0};
  }
  // Commercial zones
  if(zc.startsWith('C')){
    return {front:0, sideE:0, sideW:0, rear:7.5, stepback:3.0};
  }
  // Residential Apartment zones
  if(zc.startsWith('RA')){
    return {front:6.0, sideE:3.0, sideW:3.0, rear:7.5, stepback:3.0};
  }
  // Residential Detached/Semi
  if(zc.startsWith('RD')||zc.startsWith('RS')){
    return {front:6.0, sideE:1.2, sideW:0.9, rear:7.5, stepback:null};
  }
  // Residential Townhouse
  if(zc.startsWith('RT')){
    return {front:4.5, sideE:1.5, sideW:1.5, rear:7.5, stepback:null};
  }
  // Employment zones
  if(zc.startsWith('E')){
    return {front:10, sideE:3.0, sideW:3.0, rear:7.5, stepback:null};
  }
  // Fallback — generic
  return {front:3.0, sideE:1.5, sideW:1.5, rear:7.5, stepback:3.0};
}

// Auto-refresh zoning dashboard when switching to tab
