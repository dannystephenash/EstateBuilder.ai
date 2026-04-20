// unit-mix.js — Unit mix editor, floor plan visualization, unit palette
// ═══════════════════════════════════════════════════════════
//  BUILDING SECTION DIAGRAM (2D Canvas)
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
//  UNIT MIX EDITOR — Floor Schedule + Auto-Distribution
// ═══════════════════════════════════════════════════════════

/** Generates the floor-by-floor unit schedule from P.unitPlan and current massing volumes. */
function buildFloorSchedule(){
  const up=P.unitPlan;
  if(!up)return;
  if(!P.vols||P.vols.length===0){up.floors=[];return;}
  const maxSt=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
  if(maxSt===0){up.floors=[];return;}

  let gfa;
  try{ gfa=computeGFA(); }catch(e){ console.warn('buildFloorSchedule: computeGFA error',e); up.floors=[]; return; }
  const totalGFA=gfa.totalGFA;
  if(totalGFA<=0){up.floors=[];return;}

  // ── Compute per-floor PHYSICAL footprint areas ──
  // Each floor's gross area = the actual building footprint at that level.
  // For multi-volume floors (podium+tower): use the LARGEST active volume's footprint
  // since the podium typically encompasses the tower. This gives the real floor plate size.
  const vts=lotVerts();
  const lotMaxX=Math.max(...vts.map(v=>v[0]));

  const volFPs=P.vols.map((vol,vi)=>{
    const isCustom=vol.customPolyLocal&&vol.customPolyLocal.length>=4;
    const fp=isCustom?(vol.customAreaSF||0):(vol.width*vol.depth);
    return {idx:vi, name:vol.name||('V'+vi), storeys:vol.storeys, fp, commGF:!!vol.commGF};
  }).filter(v=>v.fp>0&&v.storeys>0);

  // Core deductions per floor (in SF) — use dynamic elevator/stair counts
  const numElev=P.core.numElevators||0;
  const numStairs=P.core.stairs?P.core.stairs.length:0;
  const elevSF=numElev*70;
  const stairSF=numStairs*110;
  const coreSF=elevSF+stairSF;
  const corridorW=up.corridorWidthFt||5.5;
  const mechPerFloor=80;
  const garbagePerFloor=80;
  const hasAnyCommGF=P.vols.some(v=>v.commGF);

  const newFloors=[];
  for(let s=1;s<=maxSt;s++){
    const active=volFPs.filter(v=>s<=v.storeys);
    if(active.length===0)continue;
    // Physical floor plate = largest active volume footprint (podium encompasses tower)
    const grossSF=Math.round(Math.max(...active.map(v=>v.fp)));
    if(grossSF<=0)continue;

    const f=s-1;
    const isGF=(f===0);
    const isCommGF=isGF && hasAnyCommGF;
    const isAmenity=(f===1 && maxSt>3);
    let floorType='residential';
    if(isCommGF) floorType='commercial';
    else if(isAmenity) floorType='amenity';

    const avgWidth=grossSF>0?Math.sqrt(grossSF)*0.7:40;
    const corridorSF=Math.round(avgWidth*corridorW*1.15);

    let netSF=0;
    if(floorType==='residential'){
      netSF=Math.max(0,grossSF-coreSF-corridorSF-mechPerFloor-garbagePerFloor);
    } else if(floorType==='amenity'){
      netSF=Math.max(0,Math.round(grossSF*0.5-coreSF-corridorSF));
    }

    const efficiency=grossSF>0?Math.round(netSF/grossSF*100):0;
    const existingFloor=up.floors.find(ef=>ef.floor===s);
    const units=(existingFloor&&up.mode==='manual')?existingFloor.units:[];

    newFloors.push({
      floor:s,
      floorType,
      volumes:active.map(v=>v.name).join('+'),
      grossSF,
      coreSF,
      corridorSF,
      mechSF:floorType==='residential'?mechPerFloor+garbagePerFloor:0,
      netSF,
      efficiency,
      units
    });
  }

  up.floors=newFloors;
  if(up.mode==='auto') autoDistributeUnits();
}

function autoDistributeUnits(){
  const up=P.unitPlan;
  if(!up||!up.floors.length)return;
  const pf=P.pf;

  // Mix percentages from existing P.pf defaults
  const defaultPcts={'Studio':0.10,'1-Bedroom':0.35,'1-Bed+Den':0.20,'2-Bedroom':0.25,'2-Bed+Den':0.00,'3-Bedroom':0.10};
  // Include 2-Bed+Den if user has set a non-zero psf for it
  const ut=up.unitTypes;

  // Collect all residential floors
  const resiFloors=up.floors.filter(f=>f.floorType==='residential'||f.floorType==='amenity');

  resiFloors.forEach(fl=>{
    const available=fl.floorType==='amenity'?Math.round(fl.netSF):fl.netSF;
    if(available<=0){fl.units=[];return;}

    const units=[];
    let remaining=available;

    ut.forEach(uType=>{
      const pct=defaultPcts[uType.type]||0;
      if(pct<=0)return;
      const sfBudget=available*pct;
      const count=Math.floor(sfBudget/uType.defaultSize);
      for(let i=0;i<count&&remaining>=uType.defaultSize;i++){
        units.push({type:uType.type,size:uType.defaultSize});
        remaining-=uType.defaultSize;
      }
    });

    fl.units=units;
  });

  // Clear units on non-residential floors
  up.floors.forEach(fl=>{
    if(fl.floorType==='commercial') fl.units=[];
  });
}

var _unitEditorSelectedFloor=-1;
var _unitEditorSelectedType=null;

/** Renders the Unit Mix Editor tab — palette, floor table, totals, and SVG floor plan viewer. */
function renderUnitEditor(){
  const el=document.getElementById('unit-editor-content');
  if(!el)return;
  try{ _renderUnitEditorInner(el); }catch(e){
    // XSS-safe: escape error fields before injecting as HTML.
    var _esc = function(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
    el.innerHTML=`<div style="color:#ff6644;padding:12px;font-size:11px">Unit editor error: ${_esc(e&&e.message)}<br><pre style="font-size:9px;color:#888;margin-top:6px">${_esc(e&&e.stack)}</pre></div>`;
    console.error('renderUnitEditor:',e);
  }
}
function _renderUnitEditorInner(el){
  const up=P.unitPlan;
  if(!up){el.innerHTML='<div style="color:#888;padding:12px">Unit plan not initialized</div>';return;}
  if(!up.floors||!up.floors.length) buildFloorSchedule();
  if(!up.floors||!up.floors.length){el.innerHTML='<div style="color:#888;padding:12px">No building volumes defined — add volumes in the Massing tab</div>';return;}

  // ── Single source of truth: pfCalc() for unit counts ──
  const d=pfData();
  const unitMix=d.unitMix||[];
  const grandTotal=d.totalUnits||0;
  const grandSF=d.netResiSF||0;
  const totalGrossSF=d.resiGFA||0;
  const totalNetSF=d.sellableResiSF||0;

  // Build totals from pfCalc unit mix (not floor schedule)
  const totals={};
  up.unitTypes.forEach(ut=>{totals[ut.type]={count:0,totalSF:0,color:ut.color}});
  unitMix.forEach(u=>{
    if(totals[u.type]){totals[u.type].count=u.count;totals[u.type].totalSF=u.count*u.size;}
  });

  let html='';

  // ── Mode toggle ──
  html+=`<div class="unit-mode-toggle">
    <button class="unit-mode-btn ${up.mode==='auto'?'active':''}" onclick="P.unitPlan.mode='auto';buildFloorSchedule();renderUnitEditor();autoSave()">AUTO</button>
    <button class="unit-mode-btn ${up.mode==='manual'?'active':''}" onclick="P.unitPlan.mode='manual';renderUnitEditor();autoSave()">MANUAL</button>
  </div>`;

  // ── Summary cards ──
  html+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px;font-size:10px">
    <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #AEBC46">
      <div style="color:#888">Total Units</div>
      <div style="color:#AEBC46;font-weight:700;font-size:16px">${grandTotal}</div>
    </div>
    <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #88bbdd">
      <div style="color:#888">Net Sellable</div>
      <div style="color:#88bbdd;font-weight:700;font-size:14px">${grandSF.toLocaleString()} sf</div>
    </div>
    <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #c49ade">
      <div style="color:#888">Gross Resi</div>
      <div style="color:#c49ade;font-weight:700;font-size:14px">${totalGrossSF.toLocaleString()} sf</div>
    </div>
    <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #e8c87a">
      <div style="color:#888">Avg Efficiency</div>
      <div style="color:#e8c87a;font-weight:700;font-size:14px">${totalGrossSF>0?Math.round(totalNetSF/totalGrossSF*100):0}%</div>
    </div>
  </div>`;

  // ── Unit type palette (clickable in manual mode) ──
  html+=`<div class="unit-palette">`;
  up.unitTypes.forEach(ut=>{
    const t=totals[ut.type];
    const isSel=(up.mode==='manual'&&_unitEditorSelectedType===ut.type);
    html+=`<div class="unit-chip${isSel?' selected':''}" style="background:${ut.color}${isSel?'44':'22'};color:${ut.color};${up.mode==='manual'?'cursor:pointer':''}" ${up.mode==='manual'?`onclick="_unitEditorSelectedType=_unitEditorSelectedType==='${ut.type}'?null:'${ut.type}';renderUnitEditor();renderFloorPlateSVG(_unitEditorSelectedFloor)"`:''}>
      <span style="font-size:12px;font-weight:700">${t.count}</span> ${ut.type} <span style="color:#888;font-size:9px">(${ut.defaultSize}sf)</span>
    </div>`;
  });
  html+=`</div>`;
  if(up.mode==='manual') html+=`<div style="font-size:9px;color:#777;margin:-6px 0 8px 0">${_unitEditorSelectedType?`<span style="color:#AEBC46">✦ ${_unitEditorSelectedType}</span> selected — click SVG to place, click unit to remove`:'Click a unit type above to start placing'}</div>`;

  // ── Floor schedule table ──
  html+=`<div style="background:#1A1A1A;border:1px solid #333333;border-radius:6px;padding:8px;margin-bottom:12px">
    <div style="font-size:10px;font-weight:700;color:#888;margin-bottom:6px;letter-spacing:1px">FLOOR SCHEDULE</div>
    <div style="max-height:350px;overflow-y:auto">
    <table class="floor-table">
      <thead><tr>
        <th>Floor</th><th>Type</th><th>Volume</th><th style="text-align:right">Gross SF</th>
        <th style="text-align:right">Net SF</th><th style="text-align:right">Eff.</th><th>Unit Composition</th>
      </tr></thead><tbody>`;

  // Reverse order (top floor first)
  const sorted=[...up.floors].reverse();
  sorted.forEach(fl=>{
    const typeColor=fl.floorType==='commercial'?'#e8c87a':fl.floorType==='amenity'?'#4ecdc4':'#88aabb';
    const typeLabel=fl.floorType==='commercial'?'COMM':fl.floorType==='amenity'?'AMEN':'RESI';

    // Composition summary
    const comp={};
    fl.units.forEach(u=>{comp[u.type]=(comp[u.type]||0)+1;});
    const compStr=Object.entries(comp).map(([type,count])=>{
      const ut=up.unitTypes.find(t=>t.type===type);
      const abbr=type.replace('-Bedroom','B').replace('-Bed+Den','B+D').replace('Studio','ST');
      return `<span style="color:${ut?ut.color:'#aaa'}">${count}×${abbr}</span>`;
    }).join(' ');

    const realIdx=up.floors.indexOf(fl);
    const isSelected=(_unitEditorSelectedFloor===realIdx);
    const usedSF=fl.units.reduce((s,u)=>s+u.size,0);
    const overCap=fl.netSF>0&&usedSF>fl.netSF*1.05;

    html+=`<tr class="${isSelected?'selected-row':''}" style="cursor:pointer${overCap?';background:#ff444418':''}" onclick="_unitEditorSelectedFloor=${realIdx};renderUnitEditor();renderFloorPlateSVG(${realIdx})">
      <td style="font-weight:600;color:#ccc">F${fl.floor}</td>
      <td><span style="color:${typeColor};font-weight:600;font-size:9px">${typeLabel}</span></td>
      <td style="color:#777;font-size:9px">${fl.volumes}</td>
      <td style="text-align:right;color:#aaa;font-variant-numeric:tabular-nums">${fl.grossSF.toLocaleString()}</td>
      <td style="text-align:right;color:#ccc;font-weight:600;font-variant-numeric:tabular-nums">${fl.netSF.toLocaleString()}</td>
      <td style="text-align:right;color:${fl.efficiency>70?'#AEBC46':fl.efficiency>60?'#e8c87a':'#ff6644'}">${fl.efficiency}%</td>
      <td>${compStr||'<span style="color:#555">—</span>'}${overCap?'<span style="color:#ff4444;font-size:9px"> ⚠</span>':''}</td>
    </tr>`;
  });

  html+=`</tbody></table></div></div>`;

  // ── SVG Floor Plate Viewer ──
  html+=`<div style="position:relative">
    <div class="floor-svg-wrap" id="unit-floor-svg" style="min-height:180px"></div>
    <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px">
      <button onclick="openFloorPlanFullscreen(${_unitEditorSelectedFloor})" title="Full Screen" style="background:rgba(26,26,26,.85);border:1px solid #444;color:#AEBC46;padding:3px 8px;border-radius:3px;font-size:9px;cursor:pointer;font-family:Outfit;font-weight:600">⤢ FULL</button>
      <button onclick="exportAllFloorPlans()" title="Export All Floors" style="background:rgba(26,26,26,.85);border:1px solid #444;color:#4ecdc4;padding:3px 8px;border-radius:3px;font-size:9px;cursor:pointer;font-family:Outfit;font-weight:600">↓ EXPORT ALL</button>
    </div>
  </div>`;

  // ── Copy floor / Apply typical buttons (manual mode) ──
  if(up.mode==='manual'&&_unitEditorSelectedFloor>=0){
    const selFl=up.floors[_unitEditorSelectedFloor];
    html+=`<div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <button style="padding:4px 10px;border-radius:3px;border:1px solid #444;background:#2D2D2D;color:#AEBC46;font-size:10px;font-weight:600;cursor:pointer;font-family:Outfit" onclick="applyTypicalFloor(${_unitEditorSelectedFloor})">Apply F${selFl.floor} as Typical</button>
      <span style="font-size:9px;color:#666;line-height:28px">Copies this floor's units to all floors with similar plate size (±20%)</span>
    </div>`;
  }

  // ── Unit mix totals table ──
  html+=`<div style="background:#1A1A1A;border:1px solid #333333;border-radius:6px;padding:8px">
    <div style="font-size:10px;font-weight:700;color:#888;margin-bottom:6px;letter-spacing:1px">UNIT MIX SUMMARY</div>
    <table class="unit-totals-table">
      <thead><tr><th>Unit Type</th><th style="text-align:right">Size</th><th style="text-align:right">Count</th>
      <th style="text-align:right">Mix %</th><th style="text-align:right">Total SF</th><th style="text-align:right">Avg Size</th></tr></thead>
      <tbody>`;

  up.unitTypes.forEach(ut=>{
    const t=totals[ut.type];
    const pct=grandTotal>0?Math.round(t.count/grandTotal*100):0;
    const avg=t.count>0?Math.round(t.totalSF/t.count):ut.defaultSize;
    html+=`<tr>
      <td><span style="display:inline-block;width:8px;height:8px;background:${ut.color};border-radius:2px;margin-right:6px;vertical-align:middle"></span>${ut.type}</td>
      <td class="num">${ut.defaultSize} sf</td>
      <td class="num" style="font-weight:600">${t.count}</td>
      <td class="num">${pct}%</td>
      <td class="num">${t.totalSF.toLocaleString()} sf</td>
      <td class="num">${avg} sf</td>
    </tr>`;
  });

  html+=`<tr class="total-row">
    <td>TOTAL</td><td class="num">—</td><td class="num">${grandTotal}</td>
    <td class="num">100%</td><td class="num">${grandSF.toLocaleString()} sf</td>
    <td class="num">${grandTotal>0?Math.round(grandSF/grandTotal):0} sf</td>
  </tr></tbody></table></div>`;

  el.innerHTML=html;
  // Render the SVG after DOM is set
  if(_unitEditorSelectedFloor>=0) renderFloorPlateSVG(_unitEditorSelectedFloor);
}

function renderFloorPlateSVG(floorIdx){
  const wrap=document.getElementById('unit-floor-svg');
  if(!wrap)return;
  const up=P.unitPlan;
  if(floorIdx<0||floorIdx>=up.floors.length){wrap.innerHTML='<div style="color:#555;padding:20px;text-align:center;font-size:11px">Select a floor above to view its plate</div>';return;}

  const fl=up.floors[floorIdx];
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMaxX=Math.max(...allX);

  // ── Collect active volume polygons at this floor ──
  const fIdx=fl.floor-1;
  const polyPts=[];
  P.vols.forEach(vol=>{
    if(fIdx>=vol.storeys)return;
    if(vol.customPolyLocal&&vol.customPolyLocal.length>=4){
      polyPts.push(vol.customPolyLocal.slice(0,-1));
    } else {
      const oE=vol.offEast||0;
      const x1=lotMaxX-oE, x0=x1-vol.width;
      const z0=vol.startEg, z1=z0+vol.depth;
      polyPts.push([[x0,z0],[x1,z0],[x1,z1],[x0,z1]]);
    }
  });
  if(polyPts.length===0){wrap.innerHTML='<div style="color:#555;padding:20px;text-align:center;font-size:11px">No volumes at this floor</div>';return;}
  // Merge overlapping polygon point arrays for combined floor plate
  const allPolyPts=[].concat(...polyPts);

  // Bounding box
  let bx0=Infinity,bz0=Infinity,bx1=-Infinity,bz1=-Infinity;
  polyPts.forEach(pts=>pts.forEach(p=>{bx0=Math.min(bx0,p[0]);bz0=Math.min(bz0,p[1]);bx1=Math.max(bx1,p[0]);bz1=Math.max(bz1,p[1]);}));
  const bw=bx1-bx0, bh=bz1-bz0;
  if(bw<1||bh<1)return;

  // Point-in-any-polygon (ray casting)
  function pip(px,pz){
    for(const pts of polyPts){
      let inside=false;
      for(let i=0,j=pts.length-1;i<pts.length;j=i++){
        const xi=pts[i][0],zi=pts[i][1],xj=pts[j][0],zj=pts[j][1];
        if((zi>pz)!==(zj>pz)&&(px<(xj-xi)*(pz-zi)/(zj-zi)+xi)) inside=!inside;
      }
      if(inside)return true;
    }
    return false;
  }

  // ── STEP 1: Sample cross-sections for corridor centerline ──
  // For each X, find the Z extent of building → corridor Z = center of extent
  const xSamples=[];
  for(let x=bx0+0.5;x<bx1;x+=1){
    let zMin=Infinity,zMax=-Infinity;
    for(let z=bz0;z<=bz1;z+=0.5){
      if(pip(x,z)){zMin=Math.min(zMin,z);zMax=Math.max(zMax,z);}
    }
    if(zMin<Infinity && (zMax-zMin)>10){
      xSamples.push({x,zMin,zMax,zMid:(zMin+zMax)/2,depth:zMax-zMin});
    }
  }
  if(xSamples.length<3){wrap.innerHTML='<div style="color:#555;padding:20px;font-size:11px">Floor plate too narrow</div>';return;}

  // Smooth centerline (5-point moving average)
  const smth=xSamples.map((s,i)=>{
    let sum=0,cnt=0;
    for(let j=Math.max(0,i-5);j<=Math.min(xSamples.length-1,i+5);j++){sum+=xSamples[j].zMid;cnt++;}
    return {...s,zMid:sum/cnt};
  });

  // SVG setup
  const pad=8;
  const vbX=bx0-pad, vbY=bz0-pad, vbW=bw+pad*2, vbH=bh+pad*2;
  const svgW=wrap.clientWidth||500;
  const svgH=Math.max(220,Math.round(svgW*vbH/Math.max(1,vbW)));
  const wallThk=0.8;
  const CORR_W=6;
  const corrHalf=CORR_W/2;
  const wallIn=1;

  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${svgW}" height="${svgH}" style="display:block">`;
  svg+=`<defs><clipPath id="fp-clip-${floorIdx}">`;
  polyPts.forEach(pts=>{ svg+=`<polygon points="${pts.map(p=>`${p[0]},${p[1]}`).join(' ')}"/>`; });
  svg+=`</clipPath></defs>`;
  svg+=`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#08080a"/>`;

  // Building fill
  polyPts.forEach(pts=>{
    svg+=`<polygon points="${pts.map(p=>`${p[0]},${p[1]}`).join(' ')}" fill="#131820" stroke="none"/>`;
  });

  // ── STEP 2: Draw corridor strip following centerline ──
  svg+=`<g clip-path="url(#fp-clip-${floorIdx})">`;

  // Corridor as filled polygon: top edge + reversed bottom edge
  const cTopPts=smth.map(s=>`${s.x},${s.zMid-corrHalf}`).join(' ');
  const cBotPts=[...smth].reverse().map(s=>`${s.x},${s.zMid+corrHalf}`).join(' ');
  svg+=`<polygon points="${cTopPts} ${cBotPts}" fill="#333" stroke="#444" stroke-width="0.3"/>`;
  // Dashed center line
  svg+=`<polyline points="${smth.filter((_,i)=>i%3===0).map(s=>`${s.x},${s.zMid}`).join(' ')}" fill="none" stroke="#555" stroke-width="0.3" stroke-dasharray="2,2"/>`;

  // ── Core elements ──
  const C=P.core;
  const numElev=C.numElevators||0;
  const isEW=(C.elevDir==='ew');
  const elevW=7, elevD=8, stairW=10, stairD=22, elevSpc=elevW+1.5;

  // Core bounding box
  let cx0=Infinity,cz0=Infinity,cx1=-Infinity,cz1=-Infinity;
  for(let e=0;e<numElev;e++){
    const ex=isEW?C.elevX+e*elevSpc:C.elevX;
    const ez=isEW?C.elevZ:C.elevZ+e*elevSpc;
    cx0=Math.min(cx0,ex);cz0=Math.min(cz0,ez);cx1=Math.max(cx1,ex+elevW);cz1=Math.max(cz1,ez+elevD);
  }
  (C.stairs||[]).forEach(st=>{
    cx0=Math.min(cx0,st.x);cz0=Math.min(cz0,st.z);cx1=Math.max(cx1,st.x+stairW);cz1=Math.max(cz1,st.z+stairD);
  });
  // Core background
  svg+=`<rect x="${cx0-2}" y="${cz0-2}" width="${cx1-cx0+4}" height="${cz1-cz0+4}" fill="#1a1e22" stroke="#555" stroke-width="0.4"/>`;
  // Elevators
  for(let e=0;e<numElev;e++){
    const ex=isEW?C.elevX+e*elevSpc:C.elevX;
    const ez=isEW?C.elevZ:C.elevZ+e*elevSpc;
    svg+=`<rect x="${ex}" y="${ez}" width="${elevW}" height="${elevD}" fill="#c49ade22" stroke="#c49ade" stroke-width="0.4"/>`;
    svg+=`<line x1="${ex+1}" y1="${ez+1}" x2="${ex+elevW-1}" y2="${ez+elevD-1}" stroke="#c49ade" stroke-width="0.2" opacity="0.5"/>`;
    svg+=`<line x1="${ex+elevW-1}" y1="${ez+1}" x2="${ex+1}" y2="${ez+elevD-1}" stroke="#c49ade" stroke-width="0.2" opacity="0.5"/>`;
  }
  (C.stairs||[]).forEach((st,si)=>{
    svg+=`<rect x="${st.x}" y="${st.z}" width="${stairW}" height="${stairD}" fill="#b0605022" stroke="#b06050" stroke-width="0.4"/>`;
    for(let t=0;t<8;t++){
      const ty=st.z+2+t*(stairD-4)/8;
      svg+=`<line x1="${st.x+1}" y1="${ty}" x2="${st.x+stairW-1}" y2="${ty}" stroke="#b06050" stroke-width="0.2" opacity="0.4"/>`;
    }
    svg+=`<text x="${st.x+stairW/2}" y="${st.z+stairD/2+1}" fill="#b06050" font-size="3" text-anchor="middle" font-family="Outfit" font-weight="700">ST${si+1}</text>`;
  });

  const typeLabel=fl.floorType==='commercial'?'COMMERCIAL GF':fl.floorType==='amenity'?'AMENITY / RESI':'RESIDENTIAL';
  const typeColor=fl.floorType==='commercial'?'#e8c87a':fl.floorType==='amenity'?'#4ecdc4':'#88aabb';

  // ── STEP 3: Double-loaded units on both sides of corridor ──
  if(fl.units&&fl.units.length>0&&fl.floorType!=='commercial'){
    const units=[...fl.units.map((u,i)=>({...u,origIdx:i}))];
    const abbrs={'Studio':'ST','1-Bedroom':'1B','1-Bed+Den':'1BD','2-Bedroom':'2B','2-Bed+Den':'2BD','3-Bedroom':'3B'};
    const unitColors={'Studio':'#e8c87a','1-Bedroom':'#88aabb','1-Bed+Den':'#4ecdc4','2-Bedroom':'#c49ade','2-Bed+Den':'#e07b6a','3-Bedroom':'#6aaa6a'};

    // Sort: larger units at ends (corners), smaller in middle
    const sorted=[...units].sort((a,b)=>b.size-a.size);
    const northUnits=[], southUnits=[];
    sorted.forEach((u,i)=>{ if(i%2===0) northUnits.push(u); else southUnits.push(u); });
    southUnits.reverse(); // large units at opposite ends for corner coverage

    // Place units on one side of the corridor
    function placeSide(sideUnits, side){
      if(sideUnits.length===0||smth.length<3)return;
      const totalSF=sideUnits.reduce((s,u)=>s+u.size,0);
      const startX=smth[0].x+wallIn;
      const endX=smth[smth.length-1].x-wallIn;
      const usable=endX-startX;
      if(usable<10)return;

      let posX=startX;
      sideUnits.forEach(u=>{
        const col=unitColors[u.type]||'#888';
        const abbr=abbrs[u.type]||u.type.substring(0,2);
        const frontage=Math.max(8,(u.size/totalSF)*usable);
        const uStartX=posX;
        const uEndX=Math.min(posX+frontage,endX);

        // Find corridor center Z at unit start and end
        const sSamp=smth.reduce((b,s)=>Math.abs(s.x-uStartX)<Math.abs(b.x-uStartX)?s:b);
        const eSamp=smth.reduce((b,s)=>Math.abs(s.x-uEndX)<Math.abs(b.x-uEndX)?s:b);

        // Unit polygon: 4 corners from corridor edge to building wall
        let ce_s, ce_e, w_s, w_e; // corridor edge Z and wall Z at start/end
        if(side==='north'){
          ce_s=sSamp.zMid-corrHalf; ce_e=eSamp.zMid-corrHalf;
          w_s=sSamp.zMin+wallIn;    w_e=eSamp.zMin+wallIn;
        } else {
          ce_s=sSamp.zMid+corrHalf; ce_e=eSamp.zMid+corrHalf;
          w_s=sSamp.zMax-wallIn;    w_e=eSamp.zMax-wallIn;
        }

        // Check bay depth is reasonable (skip if core is here)
        const bayDepth=Math.abs(ce_s-w_s);
        if(bayDepth<5){posX+=frontage;return;} // too shallow, skip (core area)

        const g=0.4; // gap between units
        const p1=`${uStartX+g},${ce_s}`;
        const p2=`${uEndX-g},${ce_e}`;
        const p3=`${uEndX-g},${w_e}`;
        const p4=`${uStartX+g},${w_s}`;

        svg+=`<polygon points="${p1} ${p2} ${p3} ${p4}" fill="${col}20" stroke="${col}" stroke-width="0.35"`;
        if(up.mode==='manual') svg+=` style="cursor:pointer" onclick="removeFloorUnit(${floorIdx},${u.origIdx})"`;
        svg+=`/>`;
        // Partition wall
        svg+=`<line x1="${uEndX-g}" y1="${ce_e}" x2="${uEndX-g}" y2="${w_e}" stroke="#333" stroke-width="0.25"/>`;

        // Labels
        const lcx=(uStartX+uEndX)/2;
        const lcz=(ce_s+w_s)/2;
        const fs=bayDepth>15&&frontage>12?3:2.2;
        svg+=`<text x="${lcx}" y="${lcz-1}" fill="${col}" font-size="${fs}" text-anchor="middle" font-family="Outfit" font-weight="700">${abbr}</text>`;
        svg+=`<text x="${lcx}" y="${lcz+1.8}" fill="#666" font-size="${fs*0.65}" text-anchor="middle" font-family="Outfit">${u.size}sf</text>`;
        svg+=`<text x="${lcx}" y="${lcz+3.8}" fill="#444" font-size="${fs*0.5}" text-anchor="middle" font-family="Outfit">${Math.round(uEndX-uStartX)}'×${Math.round(bayDepth)}'</text>`;

        posX+=frontage;
      });
    }

    placeSide(northUnits,'north');
    placeSide(southUnits,'south');
  }

  svg+=`</g>`; // end clip

  // Exterior walls on top
  polyPts.forEach(pts=>{
    svg+=`<polygon points="${pts.map(p=>`${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#5a6a7a" stroke-width="${wallThk}" stroke-linejoin="round"/>`;
  });
  // Edge dimensions
  polyPts.forEach(pts=>{
    for(let i=0;i<pts.length;i++){
      const p0=pts[i], p1=pts[(i+1)%pts.length];
      const len=Math.round(Math.sqrt((p1[0]-p0[0])**2+(p1[1]-p0[1])**2));
      if(len<10)continue;
      const mx=(p0[0]+p1[0])/2, mz=(p0[1]+p1[1])/2;
      const dx=p1[0]-p0[0], dz=p1[1]-p0[1];
      const el=Math.sqrt(dx*dx+dz*dz);
      svg+=`<text x="${mx-dz/el*3}" y="${mz+dx/el*3}" fill="#555" font-size="2.5" text-anchor="middle" font-family="Outfit" font-weight="600">${len}'</text>`;
    }
  });
  // Floor info
  svg+=`<text x="${vbX+2}" y="${vbY+4}" fill="${typeColor}" font-size="3.5" font-family="Outfit" font-weight="700">F${fl.floor} — ${typeLabel}</text>`;
  svg+=`<text x="${vbX+2}" y="${vbY+8}" fill="#555" font-size="2.3" font-family="Outfit">Gross ${fl.grossSF.toLocaleString()}sf · Net ${fl.netSF.toLocaleString()}sf · ${fl.units.length} units · ${fl.efficiency}%</text>`;

  if(up.mode==='manual'&&_unitEditorSelectedType&&fl.floorType!=='commercial'){
    svg+=`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="transparent" style="cursor:crosshair" onclick="addFloorUnit(${floorIdx})"/>`;
  }
  svg+=`</svg>`;
  wrap.innerHTML=svg;
}

function addFloorUnit(floorIdx){
  const up=P.unitPlan;
  if(!_unitEditorSelectedType||floorIdx<0)return;
  const fl=up.floors[floorIdx];
  if(!fl||fl.floorType==='commercial')return;
  const ut=up.unitTypes.find(t=>t.type===_unitEditorSelectedType);
  if(!ut)return;
  // Check capacity
  const usedSF=fl.units.reduce((s,u)=>s+u.size,0);
  if(usedSF+ut.defaultSize>fl.netSF*1.05){return;} // allow 5% over
  fl.units.push({type:ut.type,size:ut.defaultSize});
  pfChanged();
  renderFloorPlateSVG(floorIdx);
  renderUnitEditor();
}

function removeFloorUnit(floorIdx,unitIdx){
  const up=P.unitPlan;
  if(up.mode!=='manual')return;
  const fl=up.floors[floorIdx];
  if(!fl)return;
  fl.units.splice(unitIdx,1);
  pfChanged();
  renderFloorPlateSVG(floorIdx);
  renderUnitEditor();
}

function copyFloorUnits(fromIdx,toIdx){
  const up=P.unitPlan;
  const from=up.floors[fromIdx], to=up.floors[toIdx];
  if(!from||!to||to.floorType==='commercial')return;
  to.units=from.units.map(u=>({...u}));
  pfChanged();
  renderUnitEditor();
  renderFloorPlateSVG(toIdx);
}

function applyTypicalFloor(fromIdx){
  const up=P.unitPlan;
  const from=up.floors[fromIdx];
  if(!from)return;
  up.floors.forEach((fl,i)=>{
    if(i===fromIdx||fl.floorType==='commercial')return;
    // Only apply to floors with similar gross SF (within 20%)
    if(Math.abs(fl.grossSF-from.grossSF)/from.grossSF<0.2){
      fl.units=from.units.map(u=>({...u}));
    }
  });
  pfChanged();
  renderUnitEditor();
}

function drawSection(){
  const cv=document.getElementById('section-canvas');
  // Resize canvas to panel width
  const panelW=document.getElementById('panel-inner').clientWidth-32;
  cv.width=Math.max(300,panelW);
  cv.height=320;
  const ctx=cv.getContext('2d');
  ctx.clearRect(0,0,cv.width,cv.height);

  const W=cv.width, H=cv.height;
  const margin={l:50,r:20,t:30,b:40};
  const plotW=W-margin.l-margin.r;
  const plotH=H-margin.t-margin.b;

  // Find max height and max depth for scaling
  let maxH=0,maxD=0;
  P.vols.forEach(v=>{
    const h=P.flr.gf+(v.storeys-1)*P.flr.typ;
    if(h>maxH)maxH=h;
    const d=v.startEg+v.depth;
    if(d>maxD)maxD=d;
  });
  if(maxH<10)maxH=50;
  if(maxD<10)maxD=100;
  maxH*=1.15; maxD*=1.1;

  const scX=plotW/maxD;
  const scY=plotH/maxH;

  // Title
  ctx.fillStyle='#889';
  ctx.font='bold 11px Outfit';
  ctx.textAlign='center';
  ctx.fillText('BUILDING SECTION (FRONT-FACING)',W/2,16);

  // Ground line
  const gy=margin.t+plotH;
  ctx.strokeStyle='#556';
  ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(margin.l,gy);ctx.lineTo(margin.l+plotW,gy);ctx.stroke();

  // Draw volumes as rectangles
  const volColors=['#e8c87a','#c49ade','#8db4e8','#a0d4a0','#e8a08d','#88ccbb'];

  // Sort by start position
  const sorted=[...P.vols].sort((a,b)=>a.startEg-b.startEg);

  sorted.forEach((vol,i)=>{
    const gfH=P.flr.gf;
    const totalH=gfH+(vol.storeys-1)*P.flr.typ;

    const x=margin.l+vol.startEg*scX;
    const w=vol.depth*scX;
    const h=totalH*scY;
    const y=gy-h;

    // Ground floor
    ctx.fillStyle='#e8c87a44';
    ctx.strokeStyle='#e8c87a';
    ctx.lineWidth=1;
    const gfPx=gfH*scY;
    ctx.fillRect(x,gy-gfPx,w,gfPx);
    ctx.strokeRect(x,gy-gfPx,w,gfPx);

    // Upper floors
    if(vol.storeys>1){
      const upH=(vol.storeys-1)*P.flr.typ*scY;
      const col=volColors[i%volColors.length];
      ctx.fillStyle=col+'44';
      ctx.strokeStyle=col;
      ctx.fillRect(x,gy-gfPx-upH,w,upH);
      ctx.strokeRect(x,gy-gfPx-upH,w,upH);

      // Floor lines
      ctx.strokeStyle=col+'66';
      ctx.lineWidth=0.5;
      for(let f=1;f<vol.storeys;f++){
        const fy=gy-gfPx-f*P.flr.typ*scY;
        ctx.beginPath();ctx.moveTo(x,fy);ctx.lineTo(x+w,fy);ctx.stroke();
      }
    }

    // Label
    ctx.fillStyle='#fff';
    ctx.font='bold 10px Outfit';
    ctx.textAlign='center';
    ctx.fillText(vol.name,x+w/2,y+14);
    ctx.fillText(vol.storeys+'F',x+w/2,y+26);

    // Height label on right
    ctx.fillStyle='#AEBC46';
    ctx.font='10px Outfit';
    ctx.textAlign='left';
    ctx.fillText(totalH.toFixed(0)+"'",x+w+3,y+10);
  });

  // Y axis (height)
  ctx.fillStyle='#889';
  ctx.font='9px Outfit';
  ctx.textAlign='right';
  for(let h=0;h<=maxH;h+=20){
    const y=gy-h*scY;
    ctx.fillText(h+"'",margin.l-5,y+3);
    ctx.strokeStyle='#333';
    ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(margin.l,y);ctx.lineTo(margin.l+plotW,y);ctx.stroke();
  }

  // X axis label
  ctx.fillStyle='#889';
  ctx.font='10px Outfit';
  ctx.textAlign='center';
  ctx.fillText('← FRONT                    DEPTH →                    REAR →',W/2,H-8);

  // GF Commercial label
  ctx.fillStyle='#e8c87a';
  ctx.font='bold 9px Outfit';
  ctx.fillText('GF COMMERCIAL',margin.l+30*scX,gy-5);
}

function updateUnitSummary(){
  const bd=document.getElementById('sec-units-bd');
  const d=pfData();
  const fmt=n=>n.toLocaleString(undefined,{maximumFractionDigits:0});
  const row=(label,val,color)=>`<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px">
    <span style="color:#aaa">${label}</span><span style="color:${color||'#AEBC46'};font-weight:600">${val}</span></div>`;

    // ── Residential unit summary ──
    const totalGFA=d.totalGFA;
    const resGrossGFA=d.resiGFA;
    const commGFA=d.commGFA;
    const netSellable=d.sellableResiSF;
    const totalDeductions=resGrossGFA-netSellable;
    const efficiency=resGrossGFA>0?(netSellable/resGrossGFA*100):0;

    const maxStoreys=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
    const resFloors=Math.max(1,maxStoreys-(P.vols.some(v=>v.commGF)?1:0));
    const elevShafts=P.core.numElevators||0;
    const stairwells=P.core.stairs?P.core.stairs.length:0;
    const elevPerFloor=elevShafts*75;
    const stairPerFloor=stairwells*150;
    const corridorTotal=resGrossGFA*0.15;
    const lobbyDeduct=Math.min(2500,resGrossGFA*0.02);
    const amenityDeduct=Math.min(5000,resGrossGFA*0.04);

    const unitMix=d.unitMix||[];
    const total=d.totalUnits||0;

    bd.innerHTML=`
      <div style="font-size:11px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:6px">GFA BREAKDOWN</div>
      ${row('Total GFA',fmt(totalGFA)+' sf')}
      ${row('Commercial GFA (GF)',fmt(commGFA)+' sf')}
      ${row('Residential Gross GFA',fmt(resGrossGFA)+' sf')}
      <div style="border-top:1px solid #333333;margin:6px 0"></div>
      <div style="font-size:10px;font-weight:700;color:#ff8866;letter-spacing:1px;margin-bottom:4px">CIRCULATION & BUILDING SYSTEMS</div>
      ${row(`Elevator shafts (${elevShafts} × 75sf × ${resFloors}fl)`,fmt(elevPerFloor*resFloors)+' sf','#ff8866')}
      ${row(`Exit stairs (${stairwells} × 150sf × ${resFloors}fl)`,fmt(stairPerFloor*resFloors)+' sf','#ff8866')}
      ${row(`Corridors (15% of resi GFA)`,fmt(corridorTotal)+' sf','#ff8866')}
      ${row(`Lobby/amenity deductions`,fmt(lobbyDeduct+amenityDeduct)+' sf','#cc88dd')}
      <div style="border-top:1px solid #333333;margin:6px 0"></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0">
        <span style="color:#ff8866;font-size:12px;font-weight:700">Total Deductions</span>
        <span style="color:#ff8866;font-size:13px;font-weight:700">-${fmt(totalDeductions)} sf</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0">
        <span style="color:#AEBC46;font-size:13px;font-weight:700">Net Sellable Area</span>
        <span style="color:#AEBC46;font-size:15px;font-weight:700">${fmt(netSellable)} sf</span>
      </div>
      <div style="font-size:10px;color:#888;margin-bottom:10px">Efficiency: ${efficiency.toFixed(1)}% net-to-gross</div>

      <div style="border-top:1px solid #333333;margin:8px 0"></div>
      <div style="font-size:11px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:8px">UNIT MIX</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${unitMix.map(u=>{
          const upct=total>0?Math.round(u.count/total*100):0;
          const colors={'Studio':'#e8c87a','1-Bedroom':'#c49ade','1-Bed+Den':'#88bbdd','2-Bedroom':'#8db4e8','2-Bed+Den':'#a0d4a0','3-Bedroom':'#e8a08d'};
          return `<div>
            <div style="color:${colors[u.type]||'#aaa'};font-weight:700;font-size:12px">${u.type}</div>
            <div style="color:#AEBC46;font-size:16px;font-weight:700">${u.count} units</div>
            <div style="font-size:10px;color:#888">~${u.size} sf avg · ${upct}% mix</div>
          </div>`;
        }).join('')}
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #333333;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:#888">TOTAL UNITS</span>
        <span style="font-size:22px;font-weight:700;color:#AEBC46">${total}</span>
      </div>
    `;
}

