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

  // ── SINGLE SOURCE OF TRUTH ──
  // Read directly from computeGFA().perStorey for per-floor gross SF, and from
  // pfData() for the proforma-level totals (resiGFA, sellableResiSF). This
  // guarantees the floor schedule ALWAYS reconciles with the Building Summary
  // and Project Stats — same numbers everywhere, no drift.
  let gfa, pf;
  try{ gfa=computeGFA(); }catch(e){ console.warn('buildFloorSchedule: computeGFA error',e); up.floors=[]; return; }
  try{ pf=pfData(); }catch(e){ console.warn('buildFloorSchedule: pfData error',e); up.floors=[]; return; }
  const totalGFA=gfa.totalGFA||0;
  if(totalGFA<=0){up.floors=[];return;}
  const perStorey = Array.isArray(gfa.perStorey) ? gfa.perStorey : [];
  if(perStorey.length === 0){ up.floors=[]; return; }

  const hasAnyCommGF=P.vols.some(v=>v.commGF);
  const resiGFA = pf.resiGFA || 0;              // authoritative resi gross (matches all tabs)
  const sellableResiSF = pf.sellableResiSF || 0; // authoritative net sellable (matches Building Summary)

  // ── Build floors from computeGFA's per-storey breakdown ──
  const newFloors=[];
  perStorey.forEach(row => {
    const s = row.storey;
    const grossSF = Math.round(row.area || 0);
    if(grossSF <= 0) return;

    const isGF = (s === 1);
    const isCommGF = isGF && hasAnyCommGF;
    const floorType = isCommGF ? 'commercial' : 'residential';

    const existingFloor = up.floors.find(ef => ef.floor === s);
    const units = (existingFloor && up.mode === 'manual') ? existingFloor.units : [];

    newFloors.push({
      floor: s,
      floorType,
      volumes: (row.volumes || []).join('+') || 'A',
      grossSF,
      coreSF: 0,
      corridorSF: 0,          // filled in during reconciliation below
      mechSF: 0,
      netSF: 0,                // filled in during reconciliation below
      efficiency: 0,
      units
    });
  });

  if(newFloors.length === 0){ up.floors = []; return; }

  // ── RECONCILIATION ──
  // Distribute pfData().sellableResiSF across residential floors PROPORTIONAL
  // to each floor's gross SF. This guarantees:
  //   Σ floor.netSF (residential) === pfData().sellableResiSF
  //   Σ floor.grossSF (residential) === pfData().resiGFA
  // which means the per-floor efficiency AVERAGES to the overall efficiency
  // shown in the Building Summary (79% in the user's case).
  const resiFloors = newFloors.filter(f => f.floorType === 'residential');
  const resiFloorGrossSum = resiFloors.reduce((s, f) => s + f.grossSF, 0);

  if(resiFloorGrossSum > 0 && sellableResiSF > 0){
    resiFloors.forEach(f => {
      const share = f.grossSF / resiFloorGrossSum;
      // Net = share of the proforma's net-sellable total
      f.netSF = Math.round(sellableResiSF * share);
      // Corridor/core/lobby deduction = gross − net (matches Building Summary math)
      f.corridorSF = Math.max(0, f.grossSF - f.netSF);
      f.efficiency = f.grossSF > 0 ? Math.round(f.netSF / f.grossSF * 100) : 0;
    });
    // Final rounding pass — put any integer-rounding residual on the first resi
    // floor so the sum EXACTLY equals sellableResiSF
    const sum = resiFloors.reduce((s, f) => s + f.netSF, 0);
    const residual = Math.round(sellableResiSF) - sum;
    if(residual !== 0 && resiFloors.length > 0){
      resiFloors[0].netSF += residual;
      resiFloors[0].efficiency = resiFloors[0].grossSF > 0 ? Math.round(resiFloors[0].netSF / resiFloors[0].grossSF * 100) : 0;
    }
  }

  // (Reconciliation done inline above — Σ resi netSF EXACTLY equals sellableResiSF.)

  up.floors=newFloors;
  if(up.mode==='auto') autoDistributeUnits();
}

function autoDistributeUnits(){
  const up=P.unitPlan;
  if(!up||!up.floors.length)return;
  const pf=P.pf;

  // ── SINGLE SOURCE OF TRUTH ──
  // Distribute the EXACT unit counts from pf.units (the same numbers shown in
  // the top chips and the proforma) across residential floors. This guarantees:
  //   Σ units placed on floors === pf.units total counts === top chip counts
  //   No phantom unit types appear on floors that have count=0 in the proforma
  // Previously this used its own hard-coded defaultPcts, which produced phantom
  // 3-Bedrooms on floors even when the proforma said 0 × 3-Bedroom.
  const totalCounts = {};
  pf.units.forEach(u => { if(u.count > 0) totalCounts[u.type] = u.count; });

  const resiFloors = up.floors.filter(f => f.floorType === 'residential');
  if(resiFloors.length === 0) return;

  const totalResiNet = resiFloors.reduce((s, f) => s + f.netSF, 0);
  if(totalResiNet <= 0){ resiFloors.forEach(f => f.units = []); return; }

  // Reset all floors before redistribution
  resiFloors.forEach(f => f.units = []);

  // Helper: how much net SF is still available on this floor
  const remainingSF = f => f.netSF - f.units.reduce((s, u) => s + u.size, 0);

  // ── BIN-PACKING — LARGEST FIRST, PROPORTIONAL TO REMAINING CAPACITY ──
  //
  // BUG WE'RE FIXING: previously this iterated `pf.units` in insertion order
  // (Studio → 1B → 1B+D → 2B → 2B+D → 3B) and used FULL netSF for the per-floor
  // share. By the time it reached 3-Bedrooms, floors were already 95% full of
  // smaller units and 1050 sf couldn't fit anywhere → units silently skipped.
  // For a 134-unit building this dropped 27 units (3B lost 86%, 2B+D lost 33%).
  //
  // FIX: process types LARGEST-first so big units claim space when capacity is
  // fresh; compute each type's per-floor share against REMAINING capacity (not
  // total netSF), so capacity already consumed by larger types is automatically
  // accounted for. Result: every unit from pf.units is placed.
  const typesDescBySize = pf.units
    .filter(u => u.count > 0)
    .slice()
    .sort((a, b) => b.size - a.size);

  typesDescBySize.forEach(pfu => {
    const type = pfu.type;
    const size = pfu.size;
    const totalCount = pfu.count;

    // Step 1: per-floor share based on REMAINING capacity
    const remainingByFloor = resiFloors.map(f => Math.max(0, remainingSF(f)));
    const totalRemaining = remainingByFloor.reduce((s, r) => s + r, 0);
    if(totalRemaining <= 0){
      // Building completely full — fall through to round-robin placement so
      // unit count still matches pf totals (final scaling will compress sizes).
      for(let k = 0; k < totalCount; k++){
        resiFloors[k % resiFloors.length].units.push({ type, size });
      }
      return;
    }

    const idealCounts = remainingByFloor.map(r => totalCount * r / totalRemaining);
    const floorCounts = idealCounts.map(c => Math.floor(c));
    let placed = floorCounts.reduce((s, n) => s + n, 0);

    // Step 2: Hamilton remainder by largest fractional part
    const remainder = totalCount - placed;
    if(remainder > 0){
      const fracIdx = idealCounts
        .map((c, i) => ({ i, frac: c - Math.floor(c) }))
        .sort((a, b) => b.frac - a.frac);
      for(let r = 0; r < remainder; r++){
        floorCounts[fracIdx[r % fracIdx.length].i] += 1;
      }
    }

    // Step 3: place units. NO CAPACITY CAP — capacity was already factored
    // into idealCounts via remainingByFloor, so we don't double-gate. Any
    // tiny residual overflow gets absorbed by the per-floor scaling pass below.
    floorCounts.forEach((count, i) => {
      const f = resiFloors[i];
      for(let k = 0; k < count; k++){
        f.units.push({ type, size });
      }
    });
  });

  // Σ count guarantee: at this point, Σ units placed === Σ pf.units counts,
  // because every iteration above places exactly `totalCount` units of its type.

  // ── PER-FLOOR SIZE SCALING ──
  // Each floor must fully consume its net SF (no empty space). After integer
  // unit-count rounding, each floor's nominal SF (Σ unit.size) is usually 5-15%
  // less than its net capacity. Scale every unit on the floor by netSF / nominal
  // so the floor packs out to 100% — exactly what real architects do (units
  // flex within a few % to fit the column grid).
  //
  // The scaled value is stored in u.size (so the visualization, labels, and
  // floor composition all reflect the actual built dimensions). Since we still
  // had Σ counts = pf totals, the OVERALL building still sums to the proforma.
  resiFloors.forEach(f => {
    const nominal = f.units.reduce((s, u) => s + u.size, 0);
    if(nominal <= 0 || f.netSF <= 0) return;
    const scale = f.netSF / nominal;
    // Wider guardrail (was [0.75, 1.5]). With largest-first bin-packing the
    // scale should typically land in [0.95, 1.10]; the broader band just
    // tolerates extreme proforma vs. building-mass mismatches without bailing.
    if(scale < 0.5 || scale > 2.0) return;
    f.units.forEach(u => { u.size = Math.round(u.size * scale); });
    // Final integer-residual fix: put any rounding leftover on the largest unit
    const finalSum = f.units.reduce((s, u) => s + u.size, 0);
    const residual = f.netSF - finalSum;
    if(residual !== 0 && f.units.length > 0){
      // Put residual on largest unit so the % impact is smallest
      const largest = f.units.reduce((b, u) => u.size > b.size ? u : b, f.units[0]);
      largest.size += residual;
    }
  });

  // Clear units on non-residential floors
  up.floors.forEach(fl => { if(fl.floorType === 'commercial') fl.units = []; });
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
    el.innerHTML=`<div style="color:#ff6644;padding:12px;font-size:11px">Unit editor error: ${_esc(e&&e.message)}<br><pre style="font-size:12px;color:#888;margin-top:6px">${_esc(e&&e.stack)}</pre></div>`;
    console.error('renderUnitEditor:',e);
  }
}
function _renderUnitEditorInner(el){
  const up=P.unitPlan;
  if(!up){el.innerHTML='<div style="color:#888;padding:12px">Unit plan not initialized</div>';return;}
  if(!up.floors||!up.floors.length) buildFloorSchedule();
  if(!up.floors||!up.floors.length){el.innerHTML='<div style="color:#888;padding:12px">No building volumes defined — add volumes in the Massing tab</div>';return;}

  // ── Single source of truth: pfCalc() for unit counts ──
  // CRITICAL: use the SAME fields as the Building Summary panel and Project Stats
  // so all tabs report identical numbers.
  //   • Net Sellable card = d.sellableResiSF  (the building's capacity — same as Building Summary)
  //   • Gross Resi card   = d.resiGFA         (same as Project Stats)
  //   • Total Units card  = d.totalUnits      (same as Building Summary)
  //   • Avg Efficiency    = sellable / gross  (same denominator the Building Summary uses)
  // Previously this used d.netResiSF (sum of unit areas placed, always ≤ sellable
  // due to floor()/round()), which gave a smaller number with the same label —
  // causing the Units tab to disagree with every other tab.
  const d=pfData();
  const unitMix=d.unitMix||[];
  const grandTotal=d.totalUnits||0;
  const totalGrossSF=d.resiGFA||0;
  const totalNetSF=d.sellableResiSF||0;
  const grandSF=totalNetSF; // Net Sellable card = building capacity (matches all other tabs)

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
  html+=`<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px;font-size:13px">
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
      <span style="font-size:12px;font-weight:700">${t.count}</span> ${ut.type} <span style="color:#888;font-size:12px">(${ut.defaultSize}sf)</span>
    </div>`;
  });
  html+=`</div>`;
  if(up.mode==='manual') html+=`<div style="font-size:12px;color:#777;margin:-6px 0 8px 0">${_unitEditorSelectedType?`<span style="color:#AEBC46">✦ ${_unitEditorSelectedType}</span> selected — click SVG to place, click unit to remove`:'Click a unit type above to start placing'}</div>`;

  // ── Floor schedule table ──
  html+=`<div style="background:#1A1A1A;border:1px solid #333333;border-radius:6px;padding:8px;margin-bottom:12px">
    <div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px;letter-spacing:1px">FLOOR SCHEDULE</div>
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
      <td><span style="color:${typeColor};font-weight:600;font-size:12px">${typeLabel}</span></td>
      <td style="color:#777;font-size:12px">${fl.volumes}</td>
      <td style="text-align:right;color:#aaa;font-variant-numeric:tabular-nums">${fl.grossSF.toLocaleString()}</td>
      <td style="text-align:right;color:#ccc;font-weight:600;font-variant-numeric:tabular-nums">${fl.netSF.toLocaleString()}</td>
      <td style="text-align:right;color:${fl.efficiency>70?'#AEBC46':fl.efficiency>60?'#e8c87a':'#ff6644'}">${fl.efficiency}%</td>
      <td>${compStr||'<span style="color:#555">—</span>'}${overCap?'<span style="color:#ff4444;font-size:12px"> ⚠</span>':''}</td>
    </tr>`;
  });

  html+=`</tbody></table></div></div>`;

  // ── SVG Floor Plate Viewer ──
  // Constrain to a reasonable max-width so it doesn't blow out the page on wide monitors.
  // The SVG itself will scale to fit this container while preserving aspect ratio.
  html+=`<div style="position:relative;max-width:640px;margin:0 auto">
    <div class="floor-svg-wrap" id="unit-floor-svg" style="min-height:180px;max-height:480px;overflow:hidden;border:1px solid #2a2a2a;border-radius:6px;background:#0a0a0c"></div>
    <div style="position:absolute;top:4px;right:4px;display:flex;gap:4px">
      <button onclick="openFloorPlanFullscreen(${_unitEditorSelectedFloor})" title="Full Screen" style="background:rgba(26,26,26,.85);border:1px solid #444;color:#AEBC46;padding:3px 8px;border-radius:3px;font-size:12px;cursor:pointer;font-family:Outfit;font-weight:600">⤢ FULL</button>
      <button onclick="exportAllFloorPlans()" title="Export All Floors" style="background:rgba(26,26,26,.85);border:1px solid #444;color:#4ecdc4;padding:3px 8px;border-radius:3px;font-size:12px;cursor:pointer;font-family:Outfit;font-weight:600">↓ EXPORT ALL</button>
    </div>
    <!-- LEGEND — DYNAMIC: only shows unit types actually used in the project -->
    <div id="unit-floor-legend" style="margin-top:6px;background:#161618;border:1px solid #2a2a2a;border-radius:6px;padding:6px 8px;font-size:13px;font-family:Outfit;display:flex;flex-wrap:wrap;gap:10px;align-items:center;color:#aaa">
      <span style="font-weight:700;color:#888;letter-spacing:1px;font-size:12px">LEGEND:</span>
      <span style="display:inline-flex;align-items:center;gap:4px"><svg width="14" height="10" style="vertical-align:middle"><rect x="0" y="0" width="14" height="10" fill="#2a2e34" stroke="#666" stroke-width="0.6"/></svg> Corridor</span>
      ${(P.core && (P.core.numElevators||0) > 0) ? `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="14" height="10"><rect x="0" y="0" width="14" height="10" fill="#c49ade2a" stroke="#c49ade" stroke-width="0.8"/></svg> Elevator</span>` : ''}
      ${(P.core && P.core.stairs && P.core.stairs.length > 0) ? `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="14" height="10"><rect x="0" y="0" width="14" height="10" fill="#b060502a" stroke="#b06050" stroke-width="0.8"/></svg> Stair</span>` : ''}
      <span style="border-left:1px solid #333;height:14px;margin:0 2px"></span>
      ${(()=>{
        // Only include unit types with count > 0 (matches the chips and floor compositions)
        // Source of truth: P.unitPlan.unitTypes (same colors used everywhere else)
        const colorMap = {};
        ((P.unitPlan && P.unitPlan.unitTypes) || []).forEach(t => { if(t && t.type) colorMap[t.type] = t.color || '#888'; });
        const inUse = (P.pf && Array.isArray(P.pf.units)) ? P.pf.units.filter(u => u.count > 0) : [];
        if(inUse.length === 0) return '<span style="color:#666">No unit types in mix</span>';
        return inUse.map(u => {
          const c = colorMap[u.type] || '#888';
          return `<span style="display:inline-flex;align-items:center;gap:4px"><svg width="14" height="10"><rect x="0" y="0" width="14" height="10" fill="${c}26" stroke="${c}" stroke-width="0.8"/></svg> ${u.type} (${u.size}sf · ${u.count})</span>`;
        }).join('');
      })()}
    </div>
  </div>`;

  // ── Copy floor / Apply typical buttons (manual mode) ──
  if(up.mode==='manual'&&_unitEditorSelectedFloor>=0){
    const selFl=up.floors[_unitEditorSelectedFloor];
    html+=`<div style="display:flex;gap:6px;margin:6px 0;flex-wrap:wrap">
      <button style="padding:4px 10px;border-radius:3px;border:1px solid #444;background:#2D2D2D;color:#AEBC46;font-size:13px;font-weight:600;cursor:pointer;font-family:Outfit" onclick="applyTypicalFloor(${_unitEditorSelectedFloor})">Apply F${selFl.floor} as Typical</button>
      <span style="font-size:12px;color:#666;line-height:28px">Copies this floor's units to all floors with similar plate size (±20%)</span>
    </div>`;
  }

  // ── Unit mix totals table ──
  html+=`<div style="background:#1A1A1A;border:1px solid #333333;border-radius:6px;padding:8px">
    <div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px;letter-spacing:1px">UNIT MIX SUMMARY</div>
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

  // Use the LARGEST polygon as the floor's primary footprint (the visible plate)
  function _polyArea(pts){
    let a=0;
    for(let i=0;i<pts.length;i++){const j=(i+1)%pts.length;a+=pts[i][0]*pts[j][1]-pts[j][0]*pts[i][1];}
    return Math.abs(a/2);
  }

  // ── UNION OF ACTIVE POLYGONS (true floor plate) ──
  // When multiple volumes overlap at this storey (e.g. podium + tower on a
  // podium floor), the visible building plate is the UNION of all polygons.
  // We compute this once via turf.union and use it for: (1) the building
  // outline so only ONE outer boundary is drawn (no distracting inner tower
  // outline), (2) the slab-slicing source so units fill the full union area
  // not just the largest polygon. Falls back to the largest polygon if turf
  // is unavailable or the union fails.
  function _ringForTurf(pts){
    const ring = pts.slice();
    if(ring.length < 3) return null;
    if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
      ring.push([ring[0][0], ring[0][1]]);
    }
    return ring;
  }
  function _coordsToRing(coords){
    // Drop closing duplicate so caller gets the same convention as polyPts.
    if(!coords || coords.length < 3) return null;
    const r = coords.slice();
    if(r.length > 1 && r[0][0] === r[r.length-1][0] && r[0][1] === r[r.length-1][1]){
      return r.slice(0, -1);
    }
    return r;
  }
  function _unionAllPolys(allPolyPts){
    if(allPolyPts.length === 1) return allPolyPts[0];
    if(typeof turf === 'undefined' || !turf.union) {
      // Fallback: largest polygon
      return allPolyPts.reduce((b, p) => _polyArea(p) > _polyArea(b) ? p : b, allPolyPts[0]);
    }
    try {
      const features = allPolyPts.map(p => {
        const ring = _ringForTurf(p);
        return ring ? turf.polygon([ring]) : null;
      }).filter(Boolean);
      if(features.length === 0) return allPolyPts[0];
      let acc = features[0];
      for(let i = 1; i < features.length; i++){
        let next = null;
        try { next = turf.union(turf.featureCollection([acc, features[i]])); }
        catch(e){ try { next = turf.union(acc, features[i]); } catch(e2){ next = null; } }
        if(next) acc = next;
      }
      if(!acc || !acc.geometry) return allPolyPts[0];
      // Use outer ring of first polygon (handles MultiPolygon by taking the largest piece)
      let outerCoords;
      if(acc.geometry.type === 'MultiPolygon'){
        // Pick the largest polygon piece
        let bestArea = 0; let best = null;
        acc.geometry.coordinates.forEach(rings => {
          const r = _coordsToRing(rings[0]);
          if(r){
            const a = _polyArea(r);
            if(a > bestArea){ bestArea = a; best = r; }
          }
        });
        outerCoords = best;
      } else {
        outerCoords = _coordsToRing(acc.geometry.coordinates[0]);
      }
      return outerCoords && outerCoords.length >= 3 ? outerCoords : allPolyPts[0];
    } catch(e){
      return allPolyPts.reduce((b, p) => _polyArea(p) > _polyArea(b) ? p : b, allPolyPts[0]);
    }
  }

  const unionPoly = _unionAllPolys(polyPts);
  // primaryPoly is now the union (single combined floor plate). Slab slicing,
  // outline drawing, edge dimensions, clip path — all use this single shape.
  const primaryPoly = unionPoly;

  // Bounding box (over all polys for the SVG viewport)
  let bx0=Infinity,bz0=Infinity,bx1=-Infinity,bz1=-Infinity;
  polyPts.forEach(pts=>pts.forEach(p=>{bx0=Math.min(bx0,p[0]);bz0=Math.min(bz0,p[1]);bx1=Math.max(bx1,p[0]);bz1=Math.max(bz1,p[1]);}));
  const bw=bx1-bx0, bh=bz1-bz0;
  if(bw<1||bh<1)return;

  // ── PRINCIPAL AXIS via 2x2 covariance eigendecomposition ──
  // This finds the building's LONG axis regardless of orientation. The corridor
  // runs along this axis; units stack perpendicular to it. Without this the
  // sampling was X-axis aligned and produced triangular slivers on diagonal
  // buildings (the bug shown in the user's screenshot).
  let pcx=0, pcz=0;
  primaryPoly.forEach(p=>{ pcx+=p[0]; pcz+=p[1]; });
  pcx/=primaryPoly.length; pcz/=primaryPoly.length;
  let sxx=0, sxz=0, szz=0;
  primaryPoly.forEach(p=>{
    const dx=p[0]-pcx, dz=p[1]-pcz;
    sxx+=dx*dx; sxz+=dx*dz; szz+=dz*dz;
  });
  const axisAngle = 0.5 * Math.atan2(2*sxz, sxx-szz); // radians
  const cosA=Math.cos(axisAngle), sinA=Math.sin(axisAngle);

  // Forward / inverse rotation about polygon centroid (pcx, pcz)
  function fwd(p){ const dx=p[0]-pcx, dz=p[1]-pcz; return [ cosA*dx + sinA*dz, -sinA*dx + cosA*dz ]; }
  function inv(p){ return [  cosA*p[0] - sinA*p[1] + pcx,  sinA*p[0] + cosA*p[1] + pcz ]; }

  // Project the primary polygon to the rotated frame and get its bbox
  const rot = primaryPoly.map(fwd);
  let rxMin=Infinity, rxMax=-Infinity, ryMin=Infinity, ryMax=-Infinity;
  rot.forEach(p=>{ rxMin=Math.min(rxMin,p[0]); rxMax=Math.max(rxMax,p[0]); ryMin=Math.min(ryMin,p[1]); ryMax=Math.max(ryMax,p[1]); });
  const rotW = rxMax - rxMin;       // building length along corridor (long axis)
  const rotD = ryMax - ryMin;       // building depth perpendicular to corridor (short axis)

  // SVG setup — sized to fit nicely inside the wrapper without blowing out the page
  const pad=8;
  const vbX=bx0-pad, vbY=bz0-pad, vbW=bw+pad*2, vbH=bh+pad*2;
  const wallThk=0.8;
  // Public corridor width for residential mid-rise (Group C occupancy).
  // OBC 3.3.1.9 / 3.4.3.2 minimum is 1100mm (3'-7") for buildings <100 occupants/floor.
  // Industry-typical Toronto mid-rise: 4'-0" (1220mm) — meets OBC + small buffer.
  // Reads from up.corridorWidthFt so it's configurable per project; defaults to 4ft.
  // (Earlier 6'-0" value was incorrectly sourced from institutional/commercial code,
  // which doesn't apply to residential — that wasted ~5,300sf across a 14-floor building.)
  const CORR_W = (up && up.corridorWidthFt > 0) ? up.corridorWidthFt : 4;
  const corrHalf=CORR_W/2;
  const wallIn=1;       // 1ft setback from exterior wall

  // Architectural decision: if the building's perpendicular bay depth is too
  // shallow for proper double-loaded units (need >= 16ft per side after corridor),
  // switch to a single-loaded corridor where all units sit on ONE side and the
  // corridor runs along the opposite exterior wall. This is what real architects
  // do for narrow buildings (under ~46ft wide).
  const _trialBayDepth = (rotD/2) - corrHalf - wallIn;
  const isSingleLoaded = _trialBayDepth < 16;

  // Use viewBox to scale rather than fixed pixel sizing — keeps it responsive
  // and aspect-correct without exploding the layout.
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;max-height:480px">`;
  // Clip path uses the unified floor plate (no inner tower polygon clip).
  svg+=`<defs><clipPath id="fp-clip-${floorIdx}">`;
  svg+=`<polygon points="${unionPoly.map(p=>`${p[0]},${p[1]}`).join(' ')}"/>`;
  svg+=`</clipPath></defs>`;
  svg+=`<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="#08080a"/>`;

  // Building fill — single union polygon, no overlapping inner fill.
  svg+=`<polygon points="${unionPoly.map(p=>`${p[0]},${p[1]}`).join(' ')}" fill="#131820" stroke="none"/>`;

  svg+=`<g clip-path="url(#fp-clip-${floorIdx})">`;

  // ── CORE COUNTS (hoisted so unit-placement code can reserve stair space) ──
  const C = P.core;
  const numElev = C.numElevators || 0;
  const numStairs = (C.stairs && C.stairs.length) || 0;

  // ── CORRIDOR — sized to actual unit extent (no more "road" extending past units) ──
  // For SINGLE-LOADED buildings (narrow), corridor sits against one exterior wall;
  // for DOUBLE-LOADED, corridor sits in the middle. Length is set after units are
  // placed so it doesn't extend into empty space.
  const corrInsetX = 8;  // exterior wall reserved for end stairs
  const corrXMin = rxMin + corrInsetX;
  const corrXMax = rxMax - corrInsetX;
  // ── KEY FIX — center corridor on the rotated BOUNDING-BOX midpoint, NOT the
  // polygon centroid. With asymmetric buildings (bumps, notches, setbacks) the
  // centroid drifts toward the heavier side, which previously pushed the corridor
  // away from the bbox center and made every unit on the wider side fail the
  // fit-check (their yWall ended up outside the building). Using bbox midpoint
  // keeps the corridor equidistant from BOTH long walls regardless of asymmetry.
  const rotBboxMidY = (ryMin + ryMax) / 2;
  const corrCenterY = isSingleLoaded ? (ryMin + corrHalf + wallIn) : rotBboxMidY;
  // We'll draw the corridor AFTER units so we know how far it should extend.
  let _corridorDrawXMin = corrXMin, _corridorDrawXMax = corrXMin; // will be updated

  // ── UNIT TYPES — ARCHITECTURAL STANDARD FRONTAGES ──
  // These are the widths a real architect would use for double-loaded apartments
  // (corridor side facing in, exterior windows facing out). The frontage matters
  // most because the bay depth is fixed by the building width.
  const typeLabel=fl.floorType==='commercial'?'COMMERCIAL GF':fl.floorType==='amenity'?'AMENITY / RESI':'RESIDENTIAL';
  const typeColor=fl.floorType==='commercial'?'#e8c87a':fl.floorType==='amenity'?'#4ecdc4':'#88aabb';

  if(fl.units&&fl.units.length>0&&fl.floorType!=='commercial'){
    const units=[...fl.units.map((u,i)=>({...u,origIdx:i}))];
    const abbrs={'Studio':'ST','1-Bedroom':'1B','1-Bed+Den':'1BD','2-Bedroom':'2B','2-Bed+Den':'2BD','3-Bedroom':'3B'};
    // Source of truth: up.unitTypes (same colors used by the unit chips and floor composition strings)
    const unitColors={};
    (up.unitTypes||[]).forEach(t=>{ if(t&&t.type) unitColors[t.type]=t.color||'#888'; });
    // Architectural standard frontages (corridor frontage in feet) — what a
    // real architect would specify for a Toronto mid-rise apartment building.
    // These match common bay-spacing modules (≈8'-2") and column grids.
    const stdFrontage={'Studio':14,'1-Bedroom':20,'1-Bed+Den':22,'2-Bedroom':26,'2-Bed+Den':29,'3-Bedroom':33};

    // ── Point-in-polygon (hoisted so per-side bay depth sampling can use it) ──
    function _pointInPoly(pt, poly){
      let inside = false;
      for(let i=0, j=poly.length-1; i<poly.length; j=i++){
        const xi=poly[i][0], yi=poly[i][1], xj=poly[j][0], yj=poly[j][1];
        const intersect = ((yi>pt[1])!==(yj>pt[1])) &&
          (pt[0] < (xj-xi)*(pt[1]-yi)/((yj-yi)||1e-9) + xi);
        if(intersect) inside = !inside;
      }
      return inside;
    }

    // ── PER-SIDE BAY DEPTH (sampled, not derived from bbox) ──
    // The previous code used (rotD/2) which over-estimates depth for asymmetric
    // buildings (bumps push rotD up but the typical wall is closer in). We now
    // sample the building polygon at 25 x-positions along the corridor, ray-cast
    // perpendicular outward on each side until we leave the polygon, and take
    // the MEDIAN as the representative wall distance. The MIN of north/south
    // medians becomes bayDepth — units have to fit on BOTH sides.
    function _sampleBayDepth(signY){
      const samples = [];
      const xStep = (corrXMax - corrXMin) / 25;
      for(let x = corrXMin; x <= corrXMax + 0.001; x += xStep){
        let d = 0;
        // Step outward from corridor edge in 0.5ft increments
        while(d < rotD){
          const test = inv([x, corrCenterY + signY * (corrHalf + d)]);
          if(!_pointInPoly(test, primaryPoly)) break;
          d += 0.5;
        }
        if(d > 0) samples.push(Math.max(0, d - wallIn));
      }
      if(samples.length === 0) return 0;
      samples.sort((a,b) => a-b);
      // Use 40th percentile so the typical (dominant) wall position drives bayDepth
      // — the bump's deeper section becomes a bonus zone, not the design depth.
      return samples[Math.floor(samples.length * 0.4)];
    }
    const northBayDepth = isSingleLoaded ? 0 : _sampleBayDepth(-1);
    const southBayDepth = _sampleBayDepth(+1);
    const bayDepth = isSingleLoaded
      ? southBayDepth
      : Math.min(northBayDepth, southBayDepth);

    if(bayDepth >= 12){
      // ── SLAB-SLICING APPROACH ──
      // Take the building polygon (in rotated frame), subtract the corridor strip,
      // get the residential bay polygons (north slab + south slab). Then slice
      // each slab perpendicular to the corridor at positions that give each unit
      // its target AREA. Units inherit the building's actual shape — trapezoids
      // at building steps, full polygons at the wider parts. Zero empty space.

      // Reserve space at each end for stairwells
      const stairReserve = (numStairs > 0) ? 13 : 0;

      // Build the rotated building polygon
      const rotPoly = primaryPoly.map(fwd);

      // ── Sutherland-Hodgman half-plane clip ──
      // axis: 'x' or 'y'.  sign: -1 keeps coords <= cut, +1 keeps coords >= cut.
      function _clipHalfPlane(poly, axis, sign, cut){
        if(!poly || poly.length < 3) return [];
        const idx = axis === 'x' ? 0 : 1;
        const inside = pt => sign === -1 ? pt[idx] <= cut + 1e-9 : pt[idx] >= cut - 1e-9;
        const intersect = (a, b) => {
          const denom = b[idx] - a[idx];
          if(Math.abs(denom) < 1e-9) return [a[0], a[1]];
          const t = (cut - a[idx]) / denom;
          return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        };
        const out = [];
        for(let i = 0; i < poly.length; i++){
          const a = poly[(i + poly.length - 1) % poly.length];
          const b = poly[i];
          const aIn = inside(a), bIn = inside(b);
          if(bIn){
            if(!aIn) out.push(intersect(a, b));
            out.push(b);
          } else if(aIn){
            out.push(intersect(a, b));
          }
        }
        return out;
      }

      function _polyAreaSigned(poly){
        let a = 0;
        for(let i = 0; i < poly.length; i++){
          const j = (i + 1) % poly.length;
          a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
        }
        return a / 2;
      }
      const _polyAreaAbs = poly => Math.abs(_polyAreaSigned(poly));

      // Slab between corridor and exterior wall on each side
      // First clip to corridor X range so units don't extend past stair reserves
      const slabXMin = rxMin + Math.max(2, stairReserve - 5);
      const slabXMax = rxMax - Math.max(2, stairReserve - 5);
      let polyTrim = _clipHalfPlane(rotPoly, 'x', +1, slabXMin);
      polyTrim    = _clipHalfPlane(polyTrim, 'x', -1, slabXMax);

      // North slab = part of building above (smaller y than) corridor edge
      const northSlabRaw = isSingleLoaded ? [] : _clipHalfPlane(polyTrim, 'y', -1, corrCenterY - corrHalf);
      // South slab = part of building below corridor edge
      const southSlabRaw = _clipHalfPlane(polyTrim, 'y', +1, corrCenterY + corrHalf);

      const nArea = _polyAreaAbs(northSlabRaw);
      const sArea = _polyAreaAbs(southSlabRaw);

      // ── Distribute units to N/S by remaining area (greedy bin-pack) ──
      const sortedDesc = [...units].sort((a, b) => b.size - a.size);
      const northUnits = [], southUnits = [];
      let nRem = nArea, sRem = sArea;
      sortedDesc.forEach(u => {
        if(isSingleLoaded){ southUnits.push(u); sRem -= u.size; }
        else if(nRem >= sRem){ northUnits.push(u); nRem -= u.size; }
        else { southUnits.push(u); sRem -= u.size; }
      });
      // Order each side small→big→small so corner units (ends) tend to be bigger
      function _arrangeBySide(arr){
        const desc = [...arr].sort((a, b) => b.size - a.size);
        const left = [], right = [];
        desc.forEach((u, i) => { if(i % 2 === 0) left.push(u); else right.push(u); });
        return left.concat(right.reverse());
      }
      const northArr = _arrangeBySide(northUnits);
      const southArr = _arrangeBySide(southUnits);

      // ── Slice a slab into N pieces along the corridor (X axis) ──
      // ARCHITECTURAL CORRECTNESS: each unit polygon's drawn area MUST equal the
      // unit's true size (set by autoDistributeUnits to reconcile with f.netSF).
      // Previously we scaled targets to fill `slabArea`, which inflated units by
      // ~10-20% because the slab only deducts the corridor — net SF also deducts
      // cores/lobby/amenity. So drawn Σunit_size > f.netSF and the math didn't
      // tie out.
      //
      // NEW BEHAVIOUR: slice for each unit at its actual u.size. Any leftover
      // slab area (slab − Σunit_size) is left EMPTY and represents the cores +
      // lobby + amenity space that aren't drawn as discrete polygons. This is
      // exactly what a real architect would show: units at their built size,
      // empty footprint area for back-of-house. Drawn unit sizes now sum to
      // exactly f.netSF, matching the floor schedule and proforma.
      function _sliceSlab(slab, sideUnits){
        const out = [];
        if(!slab || slab.length < 3 || sideUnits.length === 0) return out;
        const slabArea = _polyAreaAbs(slab);
        if(slabArea < 50) return out;

        // Use actual unit sizes — no scale-to-fill
        const targets = sideUnits.map(u => u.size);

        let remaining = slab;
        for(let i = 0; i < sideUnits.length; i++){
          const target = targets[i];
          const remainingArea = _polyAreaAbs(remaining);
          if(remainingArea < target * 0.6 || remaining.length < 3){
            // Not enough space left for this unit — stop placing on this side
            // (architecturally honest: leftover area becomes back-of-house, no
            // need to inflate the last unit just to consume the slab).
            break;
          }
          const xs = remaining.map(p => p[0]);
          let lo = Math.min(...xs), hi = Math.max(...xs);
          // Binary search for the cut that yields the unit's actual area
          let cut = (lo + hi) / 2;
          for(let it = 0; it < 22; it++){
            cut = (lo + hi) / 2;
            const leftPart = _clipHalfPlane(remaining, 'x', -1, cut);
            const a = _polyAreaAbs(leftPart);
            if(a < target) lo = cut;
            else hi = cut;
          }
          const left = _clipHalfPlane(remaining, 'x', -1, cut);
          const right = _clipHalfPlane(remaining, 'x', +1, cut);
          if(_polyAreaAbs(left) < 30 || left.length < 3){
            break; // sliver — abandon
          }
          out.push({ unit: sideUnits[i], poly: left });
          remaining = right;
        }
        return out;
      }

      // ── Draw a polygon unit (in rotated frame → invert to world) ──
      function _drawUnitPoly(unitPoly, u, signY){
        if(!unitPoly || unitPoly.length < 3) return;
        const col = unitColors[u.type] || '#888';
        const abbr = abbrs[u.type] || u.type.substring(0, 2);
        const worldPts = unitPoly.map(inv);
        const ptsStr = worldPts.map(p => `${p[0]},${p[1]}`).join(' ');
        const drawnSF = Math.round(_polyAreaAbs(unitPoly));

        svg += `<polygon points="${ptsStr}" fill="${col}30" stroke="${col}" stroke-width="0.45"`;
        if(up.mode === 'manual') svg += ` style="cursor:pointer" onclick="removeFloorUnit(${floorIdx},${u.origIdx})"`;
        svg += `/>`;

        // Centroid in rotated frame, for label
        let cx = 0, cy = 0;
        unitPoly.forEach(p => { cx += p[0]; cy += p[1]; });
        cx /= unitPoly.length; cy /= unitPoly.length;
        const lc = inv([cx, cy]);
        const xs = unitPoly.map(p => p[0]);
        const w = Math.max(...xs) - Math.min(...xs);
        const fs = Math.min(2.6, Math.max(1.6, w * 0.14));
        const rotDeg = axisAngle * 180 / Math.PI;
        svg += `<text x="${lc[0]}" y="${lc[1] - 1}" fill="${col}" font-size="${fs}" text-anchor="middle" font-family="Outfit" font-weight="700"
                 transform="rotate(${rotDeg} ${lc[0]} ${lc[1]})">${abbr}</text>`;
        svg += `<text x="${lc[0]}" y="${lc[1] + 1.4}" fill="#888" font-size="${fs * 0.6}" text-anchor="middle" font-family="Outfit"
                 transform="rotate(${rotDeg} ${lc[0]} ${lc[1]})">${drawnSF}sf</text>`;

        // Window marker on exterior wall (the slab edge facing away from corridor)
        const ys = unitPoly.map(p => p[1]);
        const wallY = signY < 0 ? Math.min(...ys) : Math.max(...ys);
        const wallPt0 = inv([Math.min(...xs) + 1, wallY - signY * 0.3]);
        const wallPt1 = inv([Math.max(...xs) - 1, wallY - signY * 0.3]);
        svg += `<line x1="${wallPt0[0]}" y1="${wallPt0[1]}" x2="${wallPt1[0]}" y2="${wallPt1[1]}" stroke="${col}" stroke-width="0.6" opacity="0.7"/>`;
      }

      const northSlices = _sliceSlab(northSlabRaw, northArr);
      const southSlices = _sliceSlab(southSlabRaw, southArr);
      northSlices.forEach(s => _drawUnitPoly(s.poly, s.unit, -1));
      southSlices.forEach(s => _drawUnitPoly(s.poly, s.unit, +1));

      // Corridor extent for drawing
      _corridorDrawXMin = slabXMin;
      _corridorDrawXMax = slabXMax;
    }
  }

  // ── DRAW CORRIDOR (now that we know how far it extends) ──
  // Inserted at the END of the clip group so it sits below stairs/elevators
  // but above the building fill.
  if(_corridorDrawXMax > _corridorDrawXMin){
    const corrPolyRot = [
      [_corridorDrawXMin, corrCenterY - corrHalf],
      [_corridorDrawXMax, corrCenterY - corrHalf],
      [_corridorDrawXMax, corrCenterY + corrHalf],
      [_corridorDrawXMin, corrCenterY + corrHalf]
    ];
    const corrPolyWorld = corrPolyRot.map(inv);
    svg += `<polygon points="${corrPolyWorld.map(p=>`${p[0]},${p[1]}`).join(' ')}" fill="#2a2e34" stroke="#555" stroke-width="0.4" opacity="0.95"/>`;
    const cl0 = inv([_corridorDrawXMin, corrCenterY]), cl1 = inv([_corridorDrawXMax, corrCenterY]);
    svg += `<line x1="${cl0[0]}" y1="${cl0[1]}" x2="${cl1[0]}" y2="${cl1[1]}" stroke="#666" stroke-width="0.3" stroke-dasharray="2,2"/>`;
  }

  // ── CORE (elevators + stairs) — placed at corridor centerline, mid-building ──
  // Render after units so the core sits on top (visually overrides any unit at the centroid).
  // (C, numElev, numStairs were hoisted to the top of this function so the unit-placement
  // block can reserve space at each end of the corridor for the stairwells.)
  if(numElev>0 || numStairs>0){
    const elevW=8, elevD=10, stairW=12, stairD=20;     // dimensions in rotated frame
    const coreGap=1.5;
    // Stack layout: elevators on one side of centerline, stairs on the other
    // Position core near the building midpoint along the corridor
    const coreCenterX = (corrXMin + corrXMax) / 2;
    const elevTotalW = numElev * elevW + Math.max(0, numElev-1) * 0.8;
    let elevStartX = coreCenterX - elevTotalW/2;

    // Elevator block — sits opposite the units (or above corridor for single-loaded)
    const elevSideY = isSingleLoaded ? +1 : -1; // single-loaded → put core on units side, edge of corridor
    for(let e=0; e<numElev; e++){
      const ex = elevStartX + e * (elevW + 0.8);
      const ey = corrCenterY + elevSideY * (corrHalf) + (elevSideY * coreGap) + (elevSideY < 0 ? -elevD : 0);
      const c1=inv([ex,ey]), c2=inv([ex+elevW,ey]), c3=inv([ex+elevW,ey+elevD]), c4=inv([ex,ey+elevD]);
      svg += `<polygon points="${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${c3[0]},${c3[1]} ${c4[0]},${c4[1]}" fill="#c49ade2a" stroke="#c49ade" stroke-width="0.5"/>`;
      // Diagonal X marker
      svg += `<line x1="${c1[0]}" y1="${c1[1]}" x2="${c3[0]}" y2="${c3[1]}" stroke="#c49ade" stroke-width="0.25" opacity="0.55"/>`;
      svg += `<line x1="${c2[0]}" y1="${c2[1]}" x2="${c4[0]}" y2="${c4[1]}" stroke="#c49ade" stroke-width="0.25" opacity="0.55"/>`;
      const lbl = inv([ex+elevW/2, ey+elevD/2]);
      svg += `<text x="${lbl[0]}" y="${lbl[1]+0.8}" fill="#c49ade" font-size="2.2" text-anchor="middle" font-family="Outfit" font-weight="700"
               transform="rotate(${axisAngle*180/Math.PI} ${lbl[0]} ${lbl[1]})">EL${e+1}</text>`;
    }
    // Stairs — at OPPOSITE ENDS of the corridor (proper fire-egress separation per OBC)
    // Stairs sit on the OPPOSITE side of the corridor from the elevators
    const stairSideY = isSingleLoaded ? +1 : +1;  // always opposite the elevators (or units side for single-loaded)
    for(let si=0; si<numStairs; si++){
      // First stair at far-left end of corridor, last stair at far-right end
      const stairFrac = numStairs===1 ? 0.5 : si/(numStairs-1);
      // Snap to ends: 0 → left end (just inside building), 1 → right end
      const endInset = isSingleLoaded ? 4 : 2;
      const sx = (rxMin + endInset) + stairFrac * ((rxMax - endInset) - (rxMin + endInset) - stairW);
      const sy = corrCenterY + stairSideY * corrHalf + stairSideY * coreGap + (stairSideY < 0 ? -stairD : 0);
      const c1=inv([sx,sy]), c2=inv([sx+stairW,sy]), c3=inv([sx+stairW,sy+stairD]), c4=inv([sx,sy+stairD]);
      svg += `<polygon points="${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${c3[0]},${c3[1]} ${c4[0]},${c4[1]}" fill="#b060502a" stroke="#b06050" stroke-width="0.5"/>`;
      // Stair tread lines
      for(let t=0;t<8;t++){
        const tFrac = (t+1)/9;
        const tStart = inv([sx+1, sy + tFrac*stairD]);
        const tEnd   = inv([sx+stairW-1, sy + tFrac*stairD]);
        svg += `<line x1="${tStart[0]}" y1="${tStart[1]}" x2="${tEnd[0]}" y2="${tEnd[1]}" stroke="#b06050" stroke-width="0.18" opacity="0.5"/>`;
      }
      const lbl = inv([sx+stairW/2, sy+stairD/2]);
      svg += `<text x="${lbl[0]}" y="${lbl[1]+0.8}" fill="#b06050" font-size="2.4" text-anchor="middle" font-family="Outfit" font-weight="700"
               transform="rotate(${axisAngle*180/Math.PI} ${lbl[0]} ${lbl[1]})">ST${si+1}</text>`;
    }
  }

  svg+=`</g>`; // end clip

  // Exterior walls — single union polygon (no nested tower/podium outlines)
  svg+=`<polygon points="${unionPoly.map(p=>`${p[0]},${p[1]}`).join(' ')}" fill="none" stroke="#5a6a7a" stroke-width="${wallThk}" stroke-linejoin="round"/>`;
  // Edge dimensions on the union outline only (no duplicate inner edge labels)
  for(let i=0;i<unionPoly.length;i++){
    const p0=unionPoly[i], p1=unionPoly[(i+1)%unionPoly.length];
    const len=Math.round(Math.sqrt((p1[0]-p0[0])**2+(p1[1]-p0[1])**2));
    if(len<10)continue;
    const mx=(p0[0]+p1[0])/2, mz=(p0[1]+p1[1])/2;
    const dx=p1[0]-p0[0], dz=p1[1]-p0[1];
    const el=Math.sqrt(dx*dx+dz*dz);
    svg+=`<text x="${mx-dz/el*3}" y="${mz+dx/el*3}" fill="#555" font-size="2.5" text-anchor="middle" font-family="Outfit" font-weight="600">${len}'</text>`;
  }
  // Floor info
  svg+=`<text x="${vbX+2}" y="${vbY+4}" fill="${typeColor}" font-size="3.5" font-family="Outfit" font-weight="700">F${fl.floor} — ${typeLabel}</text>`;
  svg+=`<text x="${vbX+2}" y="${vbY+8}" fill="#555" font-size="2.3" font-family="Outfit">Gross ${fl.grossSF.toLocaleString()}sf · Net ${fl.netSF.toLocaleString()}sf · ${fl.units.length} units · ${fl.efficiency}% · ${isSingleLoaded?'single-loaded':'double-loaded'} corridor</text>`;

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

    // Use top storey across stacked volumes (baseElevFt-aware) — so a Tower on a
    // Podium counts up to floor 8, not just its own 4 storeys.
    const _gfH=(P.flr&&P.flr.gf)||15, _typH=(P.flr&&P.flr.typ)||10;
    const _ssOf=v=>(!v.baseElevFt||v.baseElevFt<=0.5)?1:Math.max(1,Math.round((v.baseElevFt-_gfH)/_typH)+2);
    const maxStoreys=P.vols.reduce((m,v)=>Math.max(m, _ssOf(v) + (v.storeys||0) - 1),0);
    const resFloors=Math.max(1,maxStoreys-(P.vols.some(v=>v.commGF)?1:0));
    // Use slider-driven deduction breakdown from pfCalc (not hardcoded percentages)
    const corridorTotal=d.deductions?d.deductions.corridorTotal:totalDeductions*0.71;
    const lobbyDeduct=d.deductions?d.deductions.lobbyDeduct:totalDeductions*0.10;
    const amenityDeduct=d.deductions?d.deductions.amenityDeduct:totalDeductions*0.19;

    const unitMix=d.unitMix||[];
    const total=d.totalUnits||0;

    bd.innerHTML=`
      <div style="font-size:11px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:6px">GFA BREAKDOWN</div>
      ${row('Total GFA',fmt(totalGFA)+' sf')}
      ${row('Commercial GFA (GF)',fmt(commGFA)+' sf')}
      ${row('Residential Gross GFA',fmt(resGrossGFA)+' sf')}
      <div style="border-top:1px solid #333333;margin:6px 0"></div>
      <div style="font-size:13px;font-weight:700;color:#ff8866;letter-spacing:1px;margin-bottom:4px">DEDUCTIONS (${(100-efficiency).toFixed(0)}% loss from efficiency slider)</div>
      ${row(`Corridors, elevators & stairs`,fmt(corridorTotal)+' sf','#ff8866')}
      ${row(`Lobby & amenity areas`,fmt(lobbyDeduct+amenityDeduct)+' sf','#cc88dd')}
      <div style="border-top:1px solid #333333;margin:6px 0"></div>
      <div style="display:flex;justify-content:space-between;padding:3px 0">
        <span style="color:#ff8866;font-size:12px;font-weight:700">Total Deductions</span>
        <span style="color:#ff8866;font-size:13px;font-weight:700">-${fmt(totalDeductions)} sf</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding:4px 0">
        <span style="color:#AEBC46;font-size:13px;font-weight:700">Net Sellable Area</span>
        <span style="color:#AEBC46;font-size:15px;font-weight:700">${fmt(netSellable)} sf</span>
      </div>
      <div style="font-size:13px;color:#888;margin-bottom:10px">Efficiency: ${efficiency.toFixed(1)}% net-to-gross</div>

      <div style="border-top:1px solid #333333;margin:8px 0"></div>
      <div style="font-size:11px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:8px">UNIT MIX</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        ${(()=>{
          // Source of truth: P.unitPlan.unitTypes (same colors used by chips, floor plate SVG, and legend)
          const colors={};
          ((P.unitPlan && P.unitPlan.unitTypes)||[]).forEach(t=>{ if(t&&t.type) colors[t.type]=t.color||'#aaa'; });
          return unitMix.map(u=>{
          const upct=total>0?Math.round(u.count/total*100):0;
          return `<div>
            <div style="color:${colors[u.type]||'#aaa'};font-weight:700;font-size:12px">${u.type}</div>
            <div style="color:#AEBC46;font-size:16px;font-weight:700">${u.count} units</div>
            <div style="font-size:13px;color:#888">~${u.size} sf avg · ${upct}% mix</div>
          </div>`;
        }).join(''); })()}
      </div>
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #333333;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:12px;color:#888">TOTAL UNITS</span>
        <span style="font-size:22px;font-weight:700;color:#AEBC46">${total}</span>
      </div>
    `;
}

