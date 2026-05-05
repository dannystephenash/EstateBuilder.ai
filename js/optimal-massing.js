// cache-buster: 20260504l
// optimal-massing.js — AI-driven massing generator, midrise/highrise builders
// ═══════════════════════════════════════════════════════════
//  OPTIMAL MASSING GENERATOR
// ═══════════════════════════════════════════════════════════

function updateOptimalMassingButton(){
  var btn=document.getElementById('btn-optimal-massing');
  if(!btn) return;
  var hasLot=P.lot&&P.lot.polyVerts&&P.lot.polyVerts.length>=3;
  if(!hasLot){
    var b=lotBounds();
    hasLot=(b.width>1&&b.depth>1);
  }
  btn.style.display=hasLot?'block':'none';
  if(!hasLot){
    var info=document.getElementById('optimal-massing-info');
    if(info) info.style.display='none';
  }
}

/**
 * Entry point for optimal massing generation. Reads lot geometry and zoning, then dispatches to midrise or highrise builder.
 * @returns {void}
 */
function generateOptimalMassing(){
  var assetClass=(document.getElementById('project-type-select')||{}).value||'midrise';
  var vts=lotVerts();
  if(!vts||vts.length<3) return;

  // ── INDUSTRIAL: bypass the zoning check entirely. Industrial generator uses
  //    industry-standard defaults (40% coverage, 25/15/20 ft setbacks, 40 ft
  //    clear). Some Toronto/Mississauga lots have no published zoning data and
  //    we don't want to block industrial development feasibility on that.
  if(assetClass === 'industrial'){
    if(typeof window._omGenerateIndustrial === 'function'){
      window._omGenerateIndustrial(P.zoning || null, vts);
    } else {
      console.error('[OM] industrial generator not loaded — check optimal-massing-industrial.js');
    }
    return;
  }

  // ── REQUIRE ZONING DATA — probe lot polygon if not already set ──
  var zoning=P.zoning||null;
  if(!zoning||!zoning.zone){
    // No zoning on project yet — try to find it by sampling GPS points within the lot
    var gpsVerts=P.lot.gpsVerts;
    if(!gpsVerts||gpsVerts.length<3){
      _omShowNoZoning();
      return;
    }
    // Show searching message
    var infoEl=document.getElementById('optimal-massing-info');
    if(infoEl){
      infoEl.style.display='block';
      infoEl.innerHTML='<div style="padding:8px;font-size:11px;color:#4ecdc4;border:1px solid #2a3a3a;border-radius:4px;background:#1a2a2a">'+
        '<div style="font-weight:700;margin-bottom:4px">\uD83D\uDD0D SEARCHING FOR ZONING...</div>'+
        '<div style="color:#aaa;font-size:13px">No zoning detected at site center. Probing lot polygon vertices for zoning data...</div></div>';
    }
    // Build sample points: every other vertex + centroid (keep it fast)
    var samplePts=[];
    for(var i=0;i<gpsVerts.length;i+=2){
      samplePts.push({lng:gpsVerts[i][0],lat:gpsVerts[i][1]});
    }
    // Centroid
    var cLng=0,cLat=0;
    gpsVerts.forEach(function(v){cLng+=v[0];cLat+=v[1];});
    samplePts.push({lng:cLng/gpsVerts.length, lat:cLat/gpsVerts.length});

    // Async probe — try each point until we find zoning
    _omProbeZoning(samplePts,assetClass);
    return;
  }

  // Zoning exists — try AI-powered generation first, fall back to algorithmic
  var apiKey = typeof getClaudeKey === 'function' ? getClaudeKey() : '';
  if (apiKey && apiKey.length > 80) {
    _omGenerateWithAI(zoning, assetClass);
  } else {
    _omGenerate(zoning, assetClass);
  }
}

function _omShowNoZoning(){
  var infoEl=document.getElementById('optimal-massing-info');
  if(infoEl){
    infoEl.style.display='block';
    infoEl.innerHTML='<div style="padding:8px;font-size:11px;color:#e07b6a;border:1px solid #3a2a2a;border-radius:4px;background:#2a1a1a">'+
      '<div style="font-weight:700;margin-bottom:4px">\u26A0 ZONING DATA REQUIRED</div>'+
      '<div style="color:#aaa;font-size:13px">Cannot generate optimal massing without zoning information.<br>'+
      'No zoning was found at any point within the lot polygon.<br><br>'+
      '\u2022 Ensure the lot is within a municipality with ArcGIS zoning data<br>'+
      '\u2022 Try clicking the zoning overlay to manually apply zoning<br>'+
      '\u2022 The generator needs zone designation, FSI limits, and height overlays</div></div>';
  }
}

// ═══════════════════════════════════════════════════════════
//  AI-POWERED MASSING GENERATOR
//  Uses Claude to reason like a developer: analyzes zoning,
//  comparables, and market context to design optimal massing.
// ═══════════════════════════════════════════════════════════

/**
 * Inset a polygon by moving each vertex toward the centroid by `stepFt` feet.
 * Same centroid-shrink algorithm used by the renderer (renderer-components.js:924-944).
 * Works on ANY shape: rectangle, L, T, irregular.
 * @param {Array<[number,number]>} poly - Polygon vertices in feet [x,z]
 * @param {number} stepFt - Inset distance in feet
 * @returns {Array<[number,number]>} Inset polygon
 */
function _insetPolygon(poly, stepFt) {
  if (!poly || poly.length < 3 || stepFt <= 0) return poly;

  // Strip duplicate closing vertex so we can iterate edges modulo n.
  var pts = poly.slice();
  while (pts.length > 1
    && pts[0][0] === pts[pts.length - 1][0]
    && pts[0][1] === pts[pts.length - 1][1]) {
    pts.pop();
  }
  var n = pts.length;
  if (n < 3) return poly;

  // Original signed-area magnitude — for fallback sanity check.
  var origArea2 = 0;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    origArea2 += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  origArea2 = Math.abs(origArea2);

  // Point-in-polygon test (planar, ray-cast) — used to disambiguate which
  // perpendicular is "inward". The centroid-direction shortcut FAILS on
  // concave shapes (L, T, +) because the centroid sits in the notch OUTSIDE
  // the polygon, which inverts inward/outward for every edge near the
  // concave corner. Symptom: concave-side tower edges got offset to
  // OUTSIDE the lot, then turf.intersect clipped them back to the lot
  // boundary — visible as zero stepback on the inner L frontage.
  function _pip(px, pz){
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // For each edge i, build its inward-offset line: a base point and unit
  // direction vector. The line is shifted perpendicular to the edge by stepFt
  // toward the polygon interior. Preserving each edge's direction keeps the
  // tower faces parallel to the podium faces.
  var lines = new Array(n);
  for (var i = 0; i < n; i++) {
    var p = pts[i], q = pts[(i + 1) % n];
    var ex = q[0] - p[0], ez = q[1] - p[1];
    var len = Math.sqrt(ex * ex + ez * ez);
    if (len < 0.001) { lines[i] = null; continue; }
    var dxN = ex / len, dzN = ez / len;

    // Two perpendicular candidates — pick the one whose small probe lands
    // INSIDE the polygon. Robust for both convex and concave shapes.
    var n1x = -dzN, n1z = dxN;
    var n2x =  dzN, n2z = -dxN;
    var mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    var probeFt = Math.min(0.5, len * 0.25); // small probe — stays in this edge's region
    var n1Inside = _pip(mx + n1x * probeFt, mz + n1z * probeFt);
    var nx = n1Inside ? n1x : n2x;
    var nz = n1Inside ? n1z : n2z;

    lines[i] = {
      x: p[0] + nx * stepFt,
      z: p[1] + nz * stepFt,
      dx: dxN,
      dz: dzN
    };
  }

  // For each vertex i of the inset polygon, intersect line[i-1] with line[i].
  var insetOpen = [];
  for (var i = 0; i < n; i++) {
    var L1 = lines[(i - 1 + n) % n];
    var L2 = lines[i];
    if (!L1 || !L2) { insetOpen.push([pts[i][0], pts[i][1]]); continue; }
    var det = L2.dx * L1.dz - L1.dx * L2.dz;
    var bx = L2.x - L1.x, bz = L2.z - L1.z;
    if (Math.abs(det) < 1e-6) {
      // Adjacent edges parallel — use L2's start point.
      insetOpen.push([Math.round(L2.x * 100) / 100, Math.round(L2.z * 100) / 100]);
      continue;
    }
    var t1 = (L2.dx * bz - L2.dz * bx) / det;
    var ix = L1.x + t1 * L1.dx;
    var iz = L1.z + t1 * L1.dz;
    insetOpen.push([Math.round(ix * 100) / 100, Math.round(iz * 100) / 100]);
  }

  // ── Collapse detection ──
  // If an arm of the polygon is narrower than 2 * stepFt, the offsets of the
  // two parallel arm walls cross over each other — the resulting "inset edge"
  // points in the OPPOSITE direction of the original edge. This is the
  // "tower walls folding into each other" case the user reported.
  // Detect by checking the dot product of inset edge vs original edge: any
  // negative value means that edge has been eaten by adjacent offsets.
  var badEdge = new Array(n);
  var anyBad = false;
  for (var i = 0; i < n; i++) {
    var oDx = pts[(i + 1) % n][0] - pts[i][0];
    var oDz = pts[(i + 1) % n][1] - pts[i][1];
    var iDx = insetOpen[(i + 1) % n][0] - insetOpen[i][0];
    var iDz = insetOpen[(i + 1) % n][1] - insetOpen[i][1];
    badEdge[i] = (oDx * iDx + oDz * iDz) < 0;
    if (badEdge[i]) anyBad = true;
  }

  var resultOpen;
  if (!anyBad) {
    resultOpen = insetOpen;
  } else {
    // Some edges collapsed (thin arm where parallel walls cross when offset).
    // Strategy: take the bounding box of the SURVIVING good vertices
    // (vertices whose adjacent edges are both non-collapsed). For L/T/+
    // shapes this produces a clean rectangle over the main body, which
    // matches what the user wants — no kinks, no folded walls, tower
    // floorplate aligned with the lot's primary axes.
    var goodVerts = [];
    for (var i = 0; i < n; i++) {
      if (!badEdge[(i - 1 + n) % n] && !badEdge[i]) {
        goodVerts.push(insetOpen[i]);
      }
    }
    var sourceVerts = goodVerts.length >= 3 ? goodVerts : pts;
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (var i = 0; i < sourceVerts.length; i++) {
      if (sourceVerts[i][0] < minX) minX = sourceVerts[i][0];
      if (sourceVerts[i][0] > maxX) maxX = sourceVerts[i][0];
      if (sourceVerts[i][1] < minZ) minZ = sourceVerts[i][1];
      if (sourceVerts[i][1] > maxZ) maxZ = sourceVerts[i][1];
    }
    // If we used the original lot vertices as the source (extreme fallback),
    // still apply the stepback inset so the tower respects setback rules.
    if (goodVerts.length < 3) {
      minX += stepFt; maxX -= stepFt;
      minZ += stepFt; maxZ -= stepFt;
    }
    if (maxX - minX < 30 || maxZ - minZ < 30) return poly;
    resultOpen = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
  }

  // Close the ring (consumers expect first==last like the original lot poly).
  var inset = resultOpen.slice();
  inset.push([inset[0][0], inset[0][1]]);

  // Sanity fallback — collapsed area or impossibly large area.
  if (inset.length < 4) return poly;
  var newArea2 = 0;
  for (var i = 0; i < inset.length - 1; i++) {
    newArea2 += inset[i][0] * inset[i + 1][1] - inset[i + 1][0] * inset[i][1];
  }
  newArea2 = Math.abs(newArea2);
  if (newArea2 < 100 || newArea2 > origArea2 * 1.05) return poly;

  return inset;
}

/** Shoelace formula — polygon area in square feet. */
function _polyAreaSF(poly) {
  var area = 0, n = poly.length;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    area += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(area / 2);
}

async function _omGenerateWithAI(zoning, assetClass) {
  var infoEl = document.getElementById('optimal-massing-info');
  var btn = document.getElementById('btn-optimal-massing');

  // Show loading state
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; btn.textContent = '\u23F3 AI DESIGNING BUILDING...'; }
  if (infoEl) {
    infoEl.style.display = 'block';
    infoEl.innerHTML = '<div style="padding:12px;font-size:11px;color:#AEBC46;border:1px solid #3a3a2a;border-radius:4px;background:#1a1a1a">' +
      '<div style="font-weight:700;margin-bottom:4px;font-size:12px">\uD83E\uDDE0 AI DEVELOPER IS ANALYZING YOUR SITE...</div>' +
      '<div style="color:#aaa;font-size:13px">Claude is studying zoning, comparables, and market context to design the most profitable massing for your lot. This takes 10-20 seconds.</div></div>';
  }

  // Gather all context for Claude
  var vts = lotVerts();
  var areaFt = lotArea();
  var bounds = lotBounds();
  var lotW = bounds.width;
  var lotD = bounds.depth;
  var areaM2 = Math.round(areaFt * 0.0929);
  var zoneStr = zoning.zoneString || zoning.zone || 'Unknown';
  var asOfRightFSI = zoning.fsiLimit || 3.0;
  var heightLimitM = zoning.heightLimit || 36;
  var coverage = zoning.coverage || 0.80;
  var site = P.siteAddress || 'Not specified';
  var coords = P.siteCoords ? P.siteCoords.lat + ', ' + P.siteCoords.lng : 'N/A';

  // Comparables context
  var compsSummary = 'No comparables loaded.';
  if (P.comparables && P.comparables.length > 0) {
    compsSummary = P.comparables.map(function(c) {
      return (c.name || c.address || 'Unknown') + ': ' + (c.storeys || '?') + 'st, ' +
        (c.units || '?') + ' units, ' + (c.status || '?') + ', FSI ' + (c.fsi || '?') + 'x';
    }).join('\n');
  }

  // Nearby dev database
  var devDbSummary = '';
  if (typeof TORONTO_DEV_DB !== 'undefined' && TORONTO_DEV_DB.length > 0 && P.siteCoords) {
    var nearby = TORONTO_DEV_DB.filter(function(d) {
      if (!d.lat || !d.lng) return false;
      var dist = Math.sqrt(Math.pow((d.lat - P.siteCoords.lat) * 111000, 2) + Math.pow((d.lng - P.siteCoords.lng) * 85000, 2));
      return dist < 3000; // within 3km
    }).slice(0, 10);
    if (nearby.length > 0) {
      devDbSummary = '\nNEARBY DEVELOPMENTS (within 3km):\n' + nearby.map(function(d) {
        return d.name + ': ' + (d.storeys || '?') + 'st, ' + (d.units || '?') + ' units, ' +
          (d.status || '?') + ', ' + (d.address || '');
      }).join('\n');
    }
  }

  var jur = typeof resolveJurisdiction === 'function' ? resolveJurisdiction() : {};
  var bench = typeof ASSET_BENCHMARKS !== 'undefined' ? (ASSET_BENCHMARKS[assetClass] || ASSET_BENCHMARKS.midrise) : {};

  // Gather parking ratio
  var parkRatio = (P.pf && P.pf.parkRatio) || 0.30;

  // ── AI PROMPT — AI reasons like a developer-planner, CODE handles geometry ──
  var systemPrompt = (jur.name || 'Ontario') + ' real estate developer and urban planner. You are designing the OPTIMAL building massing.\n' +
    (jur.zoningBylaw || '') + '\n' + (bench.zoningContext || '') + '\n\n' +
    'YOU ARE THE DEVELOPER. Maximize financial return. Design an APPROVABLE building.\n\n' +
    'DEVELOPER-PLANNER STRATEGY:\n' +
    '- As-of-right zoning is the FLOOR, not the ceiling. Every serious developer applies for a ZBLA.\n' +
    '- Use COMPARABLE DEVELOPMENTS as PRECEDENT to justify higher density.\n' +
    '- MTSA/PMTSA (800m of higher-order transit): target 3-5x as-of-right FSI.\n' +
    '- CR zones on Avenues: target 2-3x as-of-right FSI.\n' +
    '- Podium height = 80% of ROW width. Mid-rise max = ROW width (1:1 rule).\n' +
    '- Tower floorplate cap: 750m\u00B2 (8,073sf) per Tall Building Guidelines.\n' +
    '- Shadow impact, angular planes (45\u00B0 from opposite curb), rear transition (45\u00B0 from 10.5m).\n' +
    '- Parking: ' + parkRatio + ' stalls/unit \u00D7 ~350sf/stall below grade.\n\n' +
    'MINOR VARIANCE STRATEGY:\n' +
    '- Developers ROUTINELY apply for minor variances to reduce setbacks.\n' +
    '- Tower stepbacks of 3m (10ft) from podium face can be reduced to 1.5m (5ft) via minor variance if:\n' +
    '  \u2022 No shadow impact on neighbouring residential\n' +
    '  \u2022 Comparable buildings nearby received similar variances\n' +
    '  \u2022 The site is on an Avenue or transit corridor\n' +
    '- Side setbacks of 5.5m (18ft) can be reduced to 3m (10ft) via minor variance on commercial zones.\n' +
    '- A skilled developer pushes setbacks as tight as precedent allows to maximize GFA.\n' +
    '- If you recommend a minor variance for setback relief, explain WHY it would be granted.\n\n' +
    'WHAT YOU DECIDE:\n' +
    '- podium_storeys: total podium height including GF (e.g., 6 = ground + 5 upper). Podium fills ENTIRE lot polygon.\n' +
    '- tower_storeys: floors ABOVE the podium. Tower footprint = lot polygon inset by tower_stepback.\n' +
    '- tower_stepback: feet the tower steps back from the podium edge on all sides.\n' +
    '  This is measured from the PODIUM FACE (which is at the lot line). Min 5ft with variance, typical 10ft.\n' +
    '- commGF: 1=commercial ground floor, 0=residential.\n' +
    '- setbacks: zoning setback visual guides.\n' +
    '- variance_strategy: explain if/how minor variances reduce setbacks or increase density.\n\n' +
    'GEOMETRY: The engine builds TWO volumes from your decisions:\n' +
    '  Volume A (Podium) = exact lot polygon, podium_storeys tall, brick, retail at grade.\n' +
    '  Volume B (Tower) = lot polygon INSET by tower_stepback on all sides, curtain wall, balconies.\n' +
    '  If the lot is L-shaped, BOTH volumes are L-shaped. Tower always fits inside podium.\n\n' +
    'Respond ONLY with JSON:\n' +
    '{"reasoning":"2-3 sentences of developer strategy",' +
    '"approval_path":"as-of-right|minor_variance|zbla|opa_zbla",' +
    '"target_fsi":0,' +
    '"podium_storeys":6,"tower_storeys":8,"tower_stepback":10,' +
    '"commGF":1,' +
    '"setbacks":{"front":0,"sideE":18,"sideW":18,"rear":25},' +
    '"floor_heights":{"gf":15,"typ":10},' +
    '"variance_strategy":"explain minor variance approach if applicable",' +
    '"precedent_justification":"which nearby projects support this density",' +
    '"confidence":0.0}';

  var userMessage = 'SITE: ' + site + '\nCOORDS: ' + coords +
    '\nLOT: ' + Math.round(lotW) + 'ft wide x ' + Math.round(lotD) + 'ft deep = ' + Math.round(areaFt) + 'sf (' + areaM2 + 'm\u00B2)' +
    '\nZONING: ' + zoneStr + ', As-of-right FSI: ' + asOfRightFSI + 'x, Height limit: ' + heightLimitM + 'm, Coverage: ' + Math.round(coverage * 100) + '%' +
    '\nASSET CLASS: ' + assetClass +
    '\nPARKING: ' + parkRatio + ' stalls/unit' +
    '\n\nCOMPARABLES:\n' + compsSummary +
    devDbSummary +
    '\n\nDesign optimal massing. The podium fills the full lot polygon (to lot lines). The tower is an inset version of the same polygon.' +
    ' Decide podium_storeys, tower_storeys, tower_stepback (from podium face). Consider minor variances to reduce stepbacks if precedent supports it.';

  try {
    var text = await callClaudeAPI(systemPrompt, userMessage);
    var analysis;
    try {
      var jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
      var jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
      analysis = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[AI Massing] Failed to parse response:', text.slice(0, 500));
      if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '\u26A1 GENERATE OPTIMAL MASSING'; }
      _omGenerate(zoning, assetClass);
      return;
    }

    console.log('[AI Massing] Claude response:', analysis);

    // Build lot polygon for customPolyLocal (closed ring).
    // CRITICAL: deep-copy each vertex (not vts.slice() which is shallow) so the
    // volume's customPolyLocal does NOT share inner array references with the
    // lot's polyVerts. Shared refs cause normalizeLotPolygon to double-shift
    // the volume vertices each rebuild, drifting the building northwest of the
    // lot by (dx, dz) every time.
    var lotPoly = vts.map(function(v){ return [v[0], v[1]]; });
    if (lotPoly.length >= 3 && (lotPoly[0][0] !== lotPoly[lotPoly.length - 1][0] || lotPoly[0][1] !== lotPoly[lotPoly.length - 1][1])) {
      lotPoly.push([lotPoly[0][0], lotPoly[0][1]]);
    }

    // CRITICAL: also build a lat/lng customPoly so realignBuildingToLot can
    // re-derive customPolyLocal whenever _gpsOrigin shifts (e.g. user redraws
    // lot at a new location, switches city, or coordinate-origin
    // normalization runs). Without this, the building visually drifts
    // relative to the lot — the recurring "building renders north of lot" bug.
    function _ftToGps(xFt, zFt){
      if(!P || !P._gpsOrigin) return null;
      var oLat = P._gpsOrigin.lat, oLng = P._gpsOrigin.lng;
      var mPerDegLat = 110540;
      var mPerDegLng = 111320 * Math.cos(oLat * Math.PI / 180);
      var lng = oLng + (xFt * 0.3048) / mPerDegLng;
      var lat = oLat - (zFt * 0.3048) / mPerDegLat;   // Z+ = South so subtract
      return [lng, lat];
    }
    var lotPolyGps = null;
    if(P && P._gpsOrigin){
      lotPolyGps = lotPoly.map(function(pt){ return _ftToGps(pt[0], pt[1]); });
    }

    // ── EXTRACT AI DECISIONS ──
    var podSt = Math.max(2, Math.min(analysis.podium_storeys || 6, 20));
    var twrSt = Math.max(0, Math.min(analysis.tower_storeys || 8, 70));
    var twrStep = Math.max(3, analysis.tower_stepback || 5);   // min 3ft, default 5ft (Toronto MV floor)
    var hasCommGF = analysis.commGF ? 1 : 0;

    // ── TWO VOLUMES — podium + tower as separate buildings ──
    //
    // Volume A (Podium): exact lot polygon → fills to lot lines, brick, retail GF.
    // Volume B (Tower): lot polygon INSET by tower_stepback feet, curtain wall.
    //   Tower uses baseElevFt to START at the podium roofline (not at ground).
    //   No overlapping meshes — tower renders only its own floors above the podium.

    // Compute the inset tower polygon
    var towerPoly = _insetPolygon(lotPoly, twrStep);
    var towerAreaSF = Math.round(_polyAreaSF(towerPoly));

    // Compute tower bounding box for width/depth fields
    var tMinX = Infinity, tMaxX = -Infinity, tMinZ = Infinity, tMaxZ = -Infinity;
    for (var ti = 0; ti < towerPoly.length; ti++) {
      if (towerPoly[ti][0] < tMinX) tMinX = towerPoly[ti][0];
      if (towerPoly[ti][0] > tMaxX) tMaxX = towerPoly[ti][0];
      if (towerPoly[ti][1] < tMinZ) tMinZ = towerPoly[ti][1];
      if (towerPoly[ti][1] > tMaxZ) tMaxZ = towerPoly[ti][1];
    }
    var towerBoundsW = Math.round(tMaxX - tMinX);
    var towerBoundsD = Math.round(tMaxZ - tMinZ);

    // Podium height in feet: GF + upper podium floors
    var gfHeightFt = (analysis.floor_heights && analysis.floor_heights.gf) || 15;
    var typHeightFt = (analysis.floor_heights && analysis.floor_heights.typ) || 10;
    var podiumHeightFt = gfHeightFt + (podSt - 1) * typHeightFt; // total podium height in feet

    console.log('[AI Massing] Podium: lot polygon, ' + podSt + ' storeys, height ' + podiumHeightFt + 'ft');
    console.log('[AI Massing] Tower: inset ' + twrStep + 'ft, ' + twrSt + ' storeys, starts at ' + podiumHeightFt + 'ft, plate ' + towerAreaSF + 'sf');

    var aiVols = [];

    // VOLUME A: PODIUM — exact lot polygon, fills to lot lines
    // podiumStoreys = all upper floors (storeys - 1, excluding GF) → entire volume is brick
    aiVols.push({
      name: 'Podium',
      storeys: podSt,
      startEg: 0,
      depth: Math.round(lotD),
      width: Math.round(lotW),
      offEast: 0,
      offWest: 0,
      angle: 0,
      podiumStoreys: podSt - 1,
      stepbackAmt: 0,
      gfHeight: 0,
      baseElevFt: 0,
      color: '#b8c4d0',
      commGF: hasCommGF,
      cladding: 'brick',
      windows: 1,
      winSpacing: 3,
      balconies: 0,
      balcEvery: 2,
      balcDepth: 4,
      balcN: 0, balcS: 0, balcE: 0, balcW: 0,
      storefrontN: hasCommGF,
      storefrontS: hasCommGF,
      storefrontE: 0, storefrontW: 0,
      customPolyLocal: lotPoly,
      customPoly: lotPolyGps,        // lat/lng equivalent for realign-on-origin-shift
      customAreaSF: Math.round(areaFt)
    });

    // VOLUME B: TOWER — inset polygon, starts at podium roofline
    if (twrSt > 0) {
      aiVols.push({
        name: 'Tower',
        storeys: twrSt,
        startEg: 0,
        depth: towerBoundsD,
        width: towerBoundsW,
        offEast: 0,
        offWest: 0,
        angle: 0,
        podiumStoreys: 0,
        stepbackAmt: 0,
        gfHeight: 0,
        baseElevFt: podiumHeightFt, // START at podium top — no ground-level overlap
        color: '#c4b8a8',
        commGF: 0,
        cladding: 'curtainWall',
        windows: 1,
        winSpacing: 3,
        balconies: 1,
        balcEvery: 2,
        balcDepth: 4,
        balcN: 1, balcS: 1, balcE: 0, balcW: 0,
        storefrontN: 0,
        storefrontS: 0, storefrontE: 0, storefrontW: 0,
        customPolyLocal: towerPoly,
        customPoly: (lotPolyGps ? towerPoly.map(function(pt){ return _ftToGps(pt[0], pt[1]); }) : null),
        customAreaSF: towerAreaSF
      });
    }

    // Apply setbacks
    var aiSet = analysis.setbacks || {};
    P.set.front = aiSet.front != null ? aiSet.front : 0;
    P.set.sideE = aiSet.sideE != null ? aiSet.sideE : 18;
    P.set.sideW = aiSet.sideW != null ? aiSet.sideW : 18;
    P.set.rear  = aiSet.rear  != null ? aiSet.rear  : 25;

    // Apply volumes
    P.vols = aiVols;

    // ── Multi-tower override for large lots on tall-building zones ──
    // For lots >= ~1 acre (50k sf) on D / CC1-CC4 / RA3+ zoning, replace the
    // single AI-generated podium+tower with a realistic master plan: continuous
    // podium + 2-4 separate towers on a grid with 25 m separations. Single-
    // building blocks at this scale are not how real developments get built.
    try {
      if(typeof window.shouldFireMultiTower === 'function' &&
         typeof window.generateMultiTowerMassing === 'function'){
        var mt = window.shouldFireMultiTower(lotPoly, zoning);
        if(mt.fire){
          console.log('[Multi-tower] Triggered - ' + mt.reason);
          window.generateMultiTowerMassing(lotPoly, zoning, {
            towerCount: mt.towerCount,
            podiumStoreys: Math.max(podSt, 6),
            towerStoreys: twrSt,
            hasCommGF: hasCommGF
          });
        }
      }
    } catch(e){ console.warn('[Multi-tower] dispatch failed:', e); }

    var afh = analysis.floor_heights || {};
    P.flr.gf = afh.gf != null ? afh.gf : 15;
    P.flr.typ = afh.typ != null ? afh.typ : 10;

    // Rebuild everything
    if (typeof buildLotPanel === 'function') buildLotPanel();
    if (typeof buildSetbackPanel === 'function') buildSetbackPanel();
    if (typeof buildFloorPanel === 'function') buildFloorPanel();
    if (typeof buildVolPanel === 'function') buildVolPanel();
    rebuildAll();

    // Run pfCalc for the result
    var realPF = null;
    try { realPF = pfCalc(); } catch (e) {}

    // Store result
    P._optimalMassing = { volumes: aiVols, aiAnalysis: analysis, realProforma: realPF };

    // Show result info
    var approvalLabel = { 'as-of-right': 'As-of-Right (SPA Only)', 'minor_variance': 'Minor Variance', 'zbla': 'ZBLA (s.34)', 'opa_zbla': 'OPA + ZBLA' };
    var routeColor = analysis.approval_path === 'as-of-right' ? '#4a8' : analysis.approval_path === 'minor_variance' ? '#cc8' : '#AEBC46';

    function $f(n){return n<0?'-$'+Math.abs(Math.round(n)).toLocaleString():'$'+Math.round(n).toLocaleString()}
    function $m(n){return (n<0?'-':'')+'$'+(Math.abs(n)/1e6).toFixed(1)+'M'}

    // ── Build the full result HTML (shared between sidebar + overlay) ──
    var resultHTML = '<div style="padding:12px;border:1px solid #3a3a2a;border-radius:6px;background:#1a1a1a">' +
      '<div style="font-weight:700;color:#AEBC46;font-size:13px;margin-bottom:8px;letter-spacing:0.5px">\uD83E\uDDE0 AI-DESIGNED MASSING</div>';

    // Developer reasoning
    resultHTML += '<div style="font-size:11px;color:#ccc;line-height:1.6;margin-bottom:10px;padding:8px;background:#1a2a1a;border:1px solid #2a3a2a;border-radius:4px">' +
      '<div style="color:#AEBC46;font-weight:700;margin-bottom:4px;font-size:13px">\uD83D\uDCA1 DEVELOPER STRATEGY</div>' +
      (typeof escapeHtml === 'function' ? escapeHtml(analysis.reasoning || '') : (analysis.reasoning || '')) + '</div>';

    // Volume summary — two volumes: podium + tower
    resultHTML += '<div style="margin-bottom:10px">' +
      '<div style="color:#AEBC46;font-weight:700;font-size:13px;margin-bottom:4px;letter-spacing:0.5px">\uD83C\uDFD7 BUILDING FORM — ' + (podSt + twrSt) + ' STOREYS</div>' +
      '<div style="font-size:13px;color:#ccc;padding:6px 8px;background:#2D2D2D;border-radius:3px;margin-bottom:3px;line-height:1.8">' +
        '<span style="color:#e8c87a;font-weight:700">\u25A0 Vol A — Podium</span> (' + podSt + ' storeys)<br>' +
        'Fills <b>full lot polygon</b> to lot lines \u2022 ' + Math.round(areaFt).toLocaleString() + ' sf plate<br>' +
        (hasCommGF ? 'Retail at grade \u2022 ' : '') + 'Brick + punched windows' +
      '</div>' +
      (twrSt > 0 ? '<div style="font-size:13px;color:#ccc;padding:6px 8px;background:#2D2D2D;border-radius:3px;margin-bottom:3px;line-height:1.8">' +
        '<span style="color:#4ecdc4;font-weight:700">\u25A0 Vol B — Tower</span> (' + twrSt + ' floors above podium)<br>' +
        'Lot polygon <b>inset ' + twrStep + '\'</b> from podium face \u2022 ' + towerAreaSF.toLocaleString() + ' sf plate<br>' +
        'Curtain wall + balconies \u2022 Starts at podium roofline' +
      '</div>' : '') +
      '<div style="font-size:12px;color:#888;padding:2px 8px">\u2139 L-shaped lot \u2192 L-shaped podium + L-shaped tower</div>' +
      '</div>';

    // Variance strategy (if AI provided one)
    if (analysis.variance_strategy) {
      resultHTML += '<div style="margin-bottom:10px;font-size:13px;color:#ccc;border-left:3px solid #cc8;padding:8px;background:#2a2a1a;border-radius:0 4px 4px 0">' +
        '<strong style="color:#cc8">\u2696 Minor Variance Strategy:</strong><br>' +
        (typeof escapeHtml === 'function' ? escapeHtml(analysis.variance_strategy) : analysis.variance_strategy) + '</div>';
    }

    // Setbacks applied
    var aiSet = analysis.setbacks || {};
    resultHTML += '<div style="margin-bottom:10px">' +
      '<div style="color:#AEBC46;font-weight:700;font-size:13px;margin-bottom:4px;letter-spacing:0.5px">\uD83D\uDCCF SETBACKS APPLIED</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:4px;font-size:13px">' +
        '<div style="background:#2D2D2D;padding:4px;border-radius:3px;text-align:center"><div style="color:#888;font-size:11px">FRONT</div><div style="color:#ccc;font-weight:700">' + (aiSet.front || 0) + '\'</div></div>' +
        '<div style="background:#2D2D2D;padding:4px;border-radius:3px;text-align:center"><div style="color:#888;font-size:11px">SIDE E</div><div style="color:#ccc;font-weight:700">' + (aiSet.sideE || 18) + '\'</div></div>' +
        '<div style="background:#2D2D2D;padding:4px;border-radius:3px;text-align:center"><div style="color:#888;font-size:11px">SIDE W</div><div style="color:#ccc;font-weight:700">' + (aiSet.sideW || 18) + '\'</div></div>' +
        '<div style="background:#2D2D2D;padding:4px;border-radius:3px;text-align:center"><div style="color:#888;font-size:11px">REAR</div><div style="color:#ccc;font-weight:700">' + (aiSet.rear || 25) + '\'</div></div>' +
      '</div></div>';

    // Metrics
    if (realPF) {
      var achievedFSI = realPF.fsi ? realPF.fsi.toFixed(2) : '?';
      resultHTML += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin:10px 0">' +
        '<div style="background:#2D2D2D;padding:8px;border-radius:4px;text-align:center"><div style="font-size:12px;color:#888">GFA</div><div style="font-size:14px;font-weight:700;color:#AEBC46">' + Math.round(realPF.totalGFA).toLocaleString() + ' sf</div></div>' +
        '<div style="background:#2D2D2D;padding:8px;border-radius:4px;text-align:center"><div style="font-size:12px;color:#888">UNITS</div><div style="font-size:14px;font-weight:700;color:#AEBC46">' + realPF.totalUnits + '</div></div>' +
        '<div style="background:#2D2D2D;padding:8px;border-radius:4px;text-align:center"><div style="font-size:12px;color:#888">FSI</div><div style="font-size:14px;font-weight:700;color:#AEBC46">' + achievedFSI + 'x</div></div>' +
        '</div>';

      var profitColor = realPF.margin >= 0 ? '#AEBC46' : '#e07b6a';
      resultHTML += '<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a1a;border:1px solid #333;border-radius:4px;font-size:11px">' +
        '<div style="color:#AEBC46;font-weight:700;margin-bottom:6px;font-size:13px">\uD83D\uDCB0 PRO-FORMA SUMMARY</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">' +
          '<span style="color:#888">Revenue</span><span style="color:#8f8;font-weight:700;text-align:right">' + $m(realPF.totalGrossRev) + '</span>' +
          '<span style="color:#888">Total Cost</span><span style="color:#e8c87a;text-align:right">' + $m(realPF.totalCost) + '</span>' +
          '<span style="color:#888">Hard Cost / SF</span><span style="text-align:right;color:#ccc">' + $f(realPF.totalGFA > 0 ? realPF.totalHard / realPF.totalGFA : 0) + '</span>' +
          '<span style="color:#ddd;font-weight:700;font-size:12px">Developer Profit</span><span style="color:' + profitColor + ';font-weight:700;text-align:right;font-size:12px">' + $m(realPF.margin) + '</span>' +
          '<span style="color:#888">Profit Margin</span><span style="color:' + profitColor + ';font-weight:700;text-align:right">' + (realPF.marginOnCost * 100).toFixed(1) + '%</span>' +
          '<span style="color:#888">Parking (' + parkRatio + '/unit)</span><span style="text-align:right;color:#ccc">' + realPF.parkSpaces + ' spaces</span>' +
          '<span style="color:#888">Below-Grade Levels</span><span style="text-align:right;color:#ccc">' + Math.max(1, Math.ceil((realPF.parkSpaces || 0) * 350 / Math.max(1, areaFt))) + '</span>' +
        '</div></div>';
    }

    // Approval path
    resultHTML += '<div style="border-top:1px solid #333;padding-top:8px;margin-top:4px">' +
      '<div style="font-size:11px;margin-bottom:4px"><span style="color:#888">Approval Path:</span> <span style="color:' + routeColor + ';font-weight:700">' + (approvalLabel[analysis.approval_path] || analysis.approval_path) + '</span></div>' +
      '<div style="font-size:11px;margin-bottom:4px"><span style="color:#888">Target FSI:</span> <span style="color:#AEBC46;font-weight:700">' + (analysis.target_fsi || '?') + 'x</span> <span style="color:#666">(as-of-right: ' + asOfRightFSI + 'x)</span></div>' +
      '<div style="font-size:11px"><span style="color:#888">Confidence:</span> <span style="color:#ccc">' + Math.round((analysis.confidence || 0) * 100) + '%</span></div>' +
      '</div>';

    // Precedent justification
    if (analysis.precedent_justification) {
      resultHTML += '<div style="margin-top:10px;font-size:13px;color:#ccc;border-left:3px solid #AEBC46;padding:8px;background:#1a2a1a;border-radius:0 4px 4px 0">' +
        '<strong style="color:#AEBC46">Precedent Justification:</strong><br>' + (typeof escapeHtml === 'function' ? escapeHtml(analysis.precedent_justification) : analysis.precedent_justification) + '</div>';
    }

    // Action buttons
    resultHTML += '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button onclick="if(typeof switchTab===\'function\')switchTab(\'massing\')" style="flex:1;padding:8px;font-size:11px;font-weight:700;background:#AEBC46;color:#111;border:none;border-radius:4px;cursor:pointer;letter-spacing:0.5px">\uD83C\uDFD7 VIEW 3D MASSING</button>' +
      '<button onclick="if(typeof switchTab===\'function\')switchTab(\'proforma\')" style="flex:1;padding:8px;font-size:11px;font-weight:700;background:#2D2D2D;color:#AEBC46;border:1px solid #AEBC46;border-radius:4px;cursor:pointer;letter-spacing:0.5px">\uD83D\uDCB0 VIEW PRO-FORMA</button>' +
      '</div>';

    resultHTML += '</div>';

    // ── Populate sidebar info panel ──
    if (infoEl) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = resultHTML;
    }

    // ── Also populate the overlay panel (compact floating display, expandable) ──
    var overlay = document.getElementById('optimal-massing-overlay');
    var overlayContent = document.getElementById('optimal-massing-overlay-content');
    var overlayToggleBtn = document.getElementById('optimal-massing-toggle-btn');
    if (overlay && overlayContent) {
      overlay.style.display = 'flex';
      overlayContent.innerHTML = resultHTML;
      // Reset to collapsed state so the building stays in clear view by default;
      // user clicks the header to expand and inspect details
      overlayContent.style.display = 'none';
      overlay.style.maxHeight = 'auto';
      if (overlayToggleBtn) overlayToggleBtn.innerHTML = '\u25B6\u00A0OPTIMAL\u00A0MASSING';
    }

    // Do NOT auto-switch tabs — let user see the results first, click VIEW 3D when ready

  } catch (err) {
    console.error('[AI Massing] Error:', err.message);
    // Fall back to algorithmic on any error
    if (infoEl) {
      infoEl.style.display = 'block';
      infoEl.innerHTML = '<div style="padding:8px;font-size:13px;color:#cc8;border:1px solid #3a3a2a;border-radius:4px;background:#1a1a1a">' +
        '\u26A0 AI massing failed (' + (typeof escapeHtml === 'function' ? escapeHtml(err.message) : err.message) + '). Using algorithmic generator...</div>';
    }
    _omGenerate(zoning, assetClass);
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '\u26A1 GENERATE OPTIMAL MASSING'; }
  }
}

/**
 * Probes multiple GPS sample points in parallel to detect the most permissive zoning on the lot polygon.
 * @param {Array<{lng:number,lat:number}>} samplePts - GPS coordinates to query for zoning data.
 * @param {string} assetClass - Development type ('midrise' or 'highrise').
 * @returns {Promise<void>}
 */
async function _omProbeZoning(samplePts,assetClass){
  // Fire ALL probes in parallel for speed — pick the most permissive result
  var promises=samplePts.map(function(pt,i){
    return detectZoning(pt.lat,pt.lng).then(function(z){
      return {z:z,i:i,pt:pt};
    }).catch(function(){ return {z:null,i:i,pt:pt}; });
  });

  var results=await Promise.all(promises);

  // Find the most permissive zoning (highest FSI)
  var bestZoning=null;
  var bestFSI=0;
  results.forEach(function(r){
    if(r.z&&r.z.zone){
      var fsi=r.z.fsiLimit||0;
      if(fsi>bestFSI||(fsi===bestFSI&&!bestZoning)){
        bestZoning=r.z;
        bestFSI=fsi;
      }
    }
  });

  var zonesFound=results.filter(function(r){return r.z&&r.z.zone;}).length;
  console.log('Zoning probe: '+zonesFound+'/'+samplePts.length+' hits. Best: '+(bestZoning?bestZoning.zoneString+' FSI='+bestFSI:'none'));

  if(bestZoning){
    P.zoning=bestZoning;
    autoSave();
    // Update zoning info panel
    var zi=document.getElementById('zoning-info');
    if(zi){
      zi.style.display='block';
      zi.innerHTML='<div style="color:#4ecdc4;font-weight:700;font-size:11px;margin-bottom:6px">\uD83D\uDCCB ZONING DETECTED VIA LOT PROBE</div>'+
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">'+
          '<div><span style="color:#888">Zone:</span> <b style="color:#AEBC46">'+(bestZoning.zoneString||bestZoning.zone)+'</b></div>'+
          '<div><span style="color:#888">Max FSI:</span> <b style="color:#AEBC46">'+(bestZoning.fsiLimit?bestZoning.fsiLimit+'\u00D7':'Site-specific')+'</b></div>'+
          '<div><span style="color:#888">Height:</span> <b style="color:#AEBC46">'+(bestZoning.heightLimit?bestZoning.heightLimit+'m':'No overlay')+'</b></div>'+
          '<div><span style="color:#888">Coverage:</span> <b style="color:#AEBC46">'+(bestZoning.coverage?(bestZoning.coverage*100).toFixed(0)+'%':'\u2014')+'</b></div>'+
        '</div>'+
        '<div style="margin-top:4px;font-size:12px;color:#888;font-style:italic">Detected at lot polygon vertex. Assuming ZBLA will rezone entire assembly to match.</div>';
    }
    _omGenerate(bestZoning,assetClass);
  } else {
    _omShowNoZoning();
  }
}

/**
 * Core massing generator. Derives setbacks, streetwall, and tower parameters from zoning, then delegates to midrise or highrise builder.
 * @param {Object} zoning - Zoning data including zone, fsiLimit, heightLimit, and coverage.
 * @param {string} assetClass - Development type ('midrise' or 'highrise').
 * @returns {void}
 */
function _omGenerate(zoning,assetClass){
  var vts=lotVerts();
  if(!vts||vts.length<3) return;

  // ── EARLY DISPATCH: industrial generator handles its own setbacks/coverage ──
  // Industrial bulk warehouse has fundamentally different geometry rules
  // (40% coverage target, single-storey 40 ft clear, dock court layout) so it
  // bypasses the midrise/highrise pipeline entirely. See optimal-massing-industrial.js.
  if(assetClass === 'industrial'){
    if(typeof window._omGenerateIndustrial === 'function'){
      window._omGenerateIndustrial(zoning, vts);
    } else {
      console.error('[OM] industrial generator not loaded — check optimal-massing-industrial.js script tag');
    }
    return;
  }

  // ── STEP 1: Read the real lot ──
  var areaFt=lotArea();
  var bounds=lotBounds();
  var lotW=bounds.width;
  var lotD=bounds.depth;

  // Build closed polygon for customPolyLocal.
  // Deep-copy each vertex so the volume's customPolyLocal does NOT share
  // inner array refs with the lot's polyVerts — prevents normalizeLotPolygon
  // from double-shifting and drifting the building northwest.
  var lotPoly=vts.map(function(v){ return [v[0], v[1]]; });
  if(lotPoly[0][0]!==lotPoly[lotPoly.length-1][0]||lotPoly[0][1]!==lotPoly[lotPoly.length-1][1]){
    lotPoly.push([lotPoly[0][0], lotPoly[0][1]]);
  }

  // ── STEP 2: Analyze zoning ──
  var zoneStr=(zoning.zone||'').toUpperCase();
  var asOfRightFSI=zoning.fsiLimit||3.0;
  var asOfRightHeightM=zoning.heightLimit||36;
  var maxCoverage=zoning.coverage||0.80;

  // Setback derivation from Toronto By-law 569-2013
  var isCR=zoneStr.startsWith('CR');
  var isRA=zoneStr.startsWith('RA');
  var isResidential=zoneStr.startsWith('R')&&!isCR;

  var setF,setSE,setSW,setR;
  if(P.set.front>0||P.set.sideE>0||P.set.sideW>0||P.set.rear>0){
    setF=P.set.front||0; setSE=P.set.sideE||0; setSW=P.set.sideW||0; setR=P.set.rear||0;
  } else if(isCR){
    setF=0; setSE=Math.round(5.5/0.3048); setSW=Math.round(5.5/0.3048); setR=Math.round(7.5/0.3048);
  } else if(isResidential||isRA){
    setF=Math.round(3.0/0.3048); setSE=Math.round(5.5/0.3048); setSW=Math.round(5.5/0.3048); setR=Math.round(7.5/0.3048);
  } else {
    setF=0; setSE=Math.round(5.5/0.3048); setSW=Math.round(5.5/0.3048); setR=Math.round(7.5/0.3048);
  }

  // Tower step-back: 3.0m (10ft) on ALL sides above streetwall (Toronto Tall Building Guidelines)
  // Default reduced from 10ft → 5ft (the Toronto minor-variance minimum). 10ft
  // is the baseline Tall Building Guidelines stepback but produces visually
  // aggressive setbacks on narrow lots. Users can dial up via the MASSING tab
  // BUILDING STEPBACK slider when a project warrants the larger buffer.
  var towerStepbackFt=5;

  // Streetwall: podium height = 80% of ROW width
  // For CR zones on Avenues, typical ROW is 20-27m → streetwall 16-22m → 5-7 storeys
  // For residential, lower streetwall 3-4 storeys
  var streetwallStoreys;
  if(isCR){
    var rowEstM=asOfRightHeightM>=40?27:20; // wider ROW for taller zones
    streetwallStoreys=Math.max(3,Math.min(Math.floor(rowEstM*0.8/3.0),6));
  } else if(isResidential||isRA){
    streetwallStoreys=3;
  } else {
    streetwallStoreys=Math.max(3,Math.min(Math.floor(16/3.0),6));
  }

  // Tower plate cap: 750m² per Toronto Tall Building Guidelines (hard cap)
  var maxTowerPlateSF=Math.round(750/0.0929); // 8073 sf

  var buildableW=lotW-setSE-setSW;
  var buildableD=lotD-setF-setR;
  if(buildableW<30||buildableD<30){ console.error('Lot too small for massing'); return; }

  // ── Point-in-polygon & inscribed rectangle finder ──
  function _pip(px,pz,poly){
    var inside=false;
    for(var i=0,j=poly.length-1;i<poly.length;j=i++){
      var xi=poly[i][0],zi=poly[i][1],xj=poly[j][0],zj=poly[j][1];
      if((zi>pz)!==(zj>pz)&&(px<(xj-xi)*(pz-zi)/(zj-zi)+xi)) inside=!inside;
    }
    return inside;
  }

  // Distance from point to nearest polygon edge (approximate minimum inset)
  function _minDistToEdge(px,pz,poly){
    var minD=Infinity;
    for(var i=0;i<poly.length-1;i++){
      var ax=poly[i][0],az=poly[i][1],bx=poly[i+1][0],bz=poly[i+1][1];
      var dx=bx-ax,dz=bz-az,len2=dx*dx+dz*dz;
      if(len2<0.01) continue;
      var t=Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/len2));
      var cx=ax+t*dx,cz=az+t*dz;
      var d=Math.sqrt((px-cx)*(px-cx)+(pz-cz)*(pz-cz));
      if(d<minD) minD=d;
    }
    return minD;
  }

  // ── Compute lot principal axis — direction of longest edge ──
  var lotAngle=0;
  (function(){
    var bestLen=0;
    for(var i=0;i<vts.length;i++){
      var j=(i+1)%vts.length;
      var dx=vts[j][0]-vts[i][0],dz=vts[j][1]-vts[i][1];
      var len=Math.sqrt(dx*dx+dz*dz);
      if(len>bestLen){ bestLen=len; lotAngle=Math.atan2(dz,dx); }
    }
  })();
  var laCos=Math.cos(lotAngle),laSin=Math.sin(lotAngle);

  /**
   * Finds the largest rectangle inscribed within the lot polygon, aligned to the lot's principal axis, respecting area and inset constraints.
   * @param {Array<Array<number>>} poly - Closed polygon vertices [[x,z], ...].
   * @param {number} maxAreaSF - Maximum allowable tower plate area in square feet.
   * @param {number} minInsetFt - Minimum inset distance from polygon edges in feet.
   * @returns {{w:number, d:number, cx:number, cz:number, area:number, poly:Array|null}} Best-fit rectangle dimensions, center, and polygon vertices.
   */
  function _findTowerRect(poly,maxAreaSF,minInsetFt){
    var bds=bounds;

    function _rayDist(ox,oz,dx,dz){
      var best=9999;
      for(var i=0;i<vts.length;i++){
        var j=(i+1)%vts.length;
        var ax=vts[i][0],az=vts[i][1],bx=vts[j][0],bz=vts[j][1];
        var ex=bx-ax,ez=bz-az;
        var denom=dx*ez-dz*ex;
        if(Math.abs(denom)<0.001) continue;
        var t=((ax-ox)*ez-(az-oz)*ex)/denom;
        var u=((ax-ox)*dz-(az-oz)*dx)/denom;
        if(t>0&&u>=0&&u<=1&&t<best) best=t;
      }
      return best;
    }

    // Try candidate centers: centroid, bbox center, and a 4×4 interior grid
    var candidates=[];
    // Polygon centroid
    var pcx=0,pcz=0;
    for(var i=0;i<vts.length;i++){pcx+=vts[i][0];pcz+=vts[i][1];}
    pcx/=vts.length; pcz/=vts.length;
    candidates.push({x:pcx,z:pcz});
    // Bounding box center
    candidates.push({x:(bds.minX+bds.maxX)/2, z:(bds.minZ+bds.maxZ)/2});
    // 4×4 grid inside bounding box (16 points)
    for(var gx=1;gx<=4;gx++){
      for(var gz=1;gz<=4;gz++){
        candidates.push({x:bds.minX+bds.width*(gx/5), z:bds.minZ+bds.depth*(gz/5)});
      }
    }

    var bestW=0,bestD=0,bestCx=0,bestCz=0,bestArea=0;

    for(var ci=0;ci<candidates.length;ci++){
      var cx=candidates[ci].x, cz=candidates[ci].z;
      if(!_pip(cx,cz,vts)) continue;

      // Cast rays along lot's principal axis and its perpendicular
      var distE=_rayDist(cx,cz,laCos,laSin);
      var distW=_rayDist(cx,cz,-laCos,-laSin);
      var distN=_rayDist(cx,cz,-laSin,laCos);
      var distS=_rayDist(cx,cz,laSin,-laCos);

      // Use FULL available span (not min of opposite sides)
      var tw=Math.floor(distE+distW-minInsetFt*2);
      var td=Math.floor(distN+distS-minInsetFt*2);
      // Re-center the rectangle within the available space (in rotated frame)
      var shA=(distE-distW)/2, shP=(distS-distN)/2;
      var rcx=cx+shA*laCos+shP*laSin;
      var rcz=cz+shA*laSin-shP*laCos;

      if(tw<40||td<40) continue;

      // Enforce minimum aspect ratio — no thinner than 1:2
      if(tw>td*2){ tw=td*2; }
      if(td>tw*2){ td=tw*2; }

      // Clamp to maxAreaSF
      if(tw*td>maxAreaSF){
        var aspect=Math.min(Math.max(tw/td,0.5),2.0);
        td=Math.floor(Math.sqrt(maxAreaSF/aspect));
        tw=Math.floor(td*aspect);
        if(tw*td>maxAreaSF) td=Math.floor(maxAreaSF/tw);
      }

      // Verify all corners inside polygon AND at least minInsetFt from edges
      // Corners are rotated to align with the lot's principal axis
      function _rotCorners(rx,rz,rw,rd){
        var hw=rw/2,hd=rd/2;
        return [
          [rx+hw*laCos-hd*laSin, rz+hw*laSin+hd*laCos],
          [rx-hw*laCos-hd*laSin, rz-hw*laSin+hd*laCos],
          [rx-hw*laCos+hd*laSin, rz-hw*laSin-hd*laCos],
          [rx+hw*laCos+hd*laSin, rz+hw*laSin-hd*laCos]
        ];
      }
      function _cornersOk(rx,rz,rw,rd){
        var pts=_rotCorners(rx,rz,rw,rd);
        for(var p=0;p<4;p++){
          if(!_pip(pts[p][0],pts[p][1],vts)) return false;
          if(_minDistToEdge(pts[p][0],pts[p][1],vts)<minInsetFt) return false;
        }
        return true;
      }
      var ok=_cornersOk(rcx,rcz,tw,td);
      if(!ok){
        for(var s=0;s<12;s++){
          tw=Math.floor(tw*0.92); td=Math.floor(td*0.92);
          if(_cornersOk(rcx,rcz,tw,td)){ok=true;break;}
        }
      }
      if(ok&&tw*td>bestArea){
        bestW=tw;bestD=td;bestCx=rcx;bestCz=rcz;bestArea=tw*td;
      }
    }
    // Build polygon from the best rectangle (rotated to lot axis)
    var bestPoly=null;
    if(bestW>0&&bestD>0){
      var hw=bestW/2,hd=bestD/2;
      bestPoly=[
        [bestCx+hw*laCos-hd*laSin, bestCz+hw*laSin+hd*laCos],
        [bestCx-hw*laCos-hd*laSin, bestCz-hw*laSin+hd*laCos],
        [bestCx-hw*laCos+hd*laSin, bestCz-hw*laSin-hd*laCos],
        [bestCx+hw*laCos+hd*laSin, bestCz+hw*laSin-hd*laCos]
      ];
      bestPoly.push(bestPoly[0].slice()); // close polygon
    }
    return {w:bestW,d:bestD,cx:bestCx,cz:bestCz,area:bestArea,poly:bestPoly};
  }

  // ── DEVELOPER INTELLIGENCE: Maximize leasable area via ZBLA precedent ──
  // The as-of-right zoning is the FLOOR, not the ceiling.
  // Real Toronto precedents: 321 King W = 49st, 337 King W = 47+35st, 300 King W = 74+84st
  // Every CR site on a major avenue should target 25-45+ storeys via ZBLA.
  // Strategy: target storeys FIRST from corridor precedent, then derive FSI.

  var lotAreaM2=areaFt*0.0929;
  var estROW_M=asOfRightHeightM>=40?30:(asOfRightHeightM>=30?27:(asOfRightHeightM>=20?20:16));

  // Corridor context — determines how aggressive the ZBLA push should be
  var corridorContext='avenue';
  var targetFSI, targetHeightM, maxPrecedentStoreys;

  if(asOfRightFSI>=6.0){
    // Downtown core (King-Bay-Yonge): 300 King W = 74+84st, 1 Yonge = 95st
    corridorContext='downtown_core';
    targetFSI=Math.max(asOfRightFSI*8.0,25);
    targetHeightM=250; maxPrecedentStoreys=75;
  } else if(asOfRightFSI>=4.0){
    // Major transit node: Yonge-Eglinton, Bloor-Yonge
    corridorContext='major_transit';
    targetFSI=Math.max(asOfRightFSI*7.0,22);
    targetHeightM=180; maxPrecedentStoreys=60;
  } else if(isCR){
    // ALL CR zones are commercial-residential on avenues — ZBLA territory
    // King West: 321 King W = 49st, 629 King W = 15st, 337 King W = 47st
    // Queen West: routinely 15-30 storeys approved
    // Dundas, College: 20-35 storeys approved
    corridorContext='avenue_transit';
    targetFSI=Math.max(asOfRightFSI*7.0,18);
    targetHeightM=140; maxPrecedentStoreys=45;
  } else if(isResidential||isRA){
    corridorContext='neighbourhood_edge';
    targetFSI=asOfRightFSI*1.5;
    targetHeightM=asOfRightHeightM*1.3; maxPrecedentStoreys=12;
  } else {
    // Other commercial, employment, etc.
    corridorContext='avenue';
    targetFSI=Math.max(asOfRightFSI*4.0,10);
    targetHeightM=100; maxPrecedentStoreys=35;
  }

  // Large lots can support more density (tower separation, amenity space)
  if(lotAreaM2>3000) targetFSI*=1.2;
  else if(lotAreaM2>1500) targetFSI*=1.1;

  // Both midrise and highrise are run and compared by profit — no auto-detect needed
  console.log('=== DEVELOPER OPTIMIZER ===');
  console.log('Site:',Math.round(lotAreaM2)+'m² lot, Zone:',zoneStr,'As-of-right: FSI',asOfRightFSI+'x, Ht',asOfRightHeightM+'m');
  console.log('Corridor:',corridorContext,'→ Auto-selected:',assetClass);
  console.log('ZBLA Target: FSI',targetFSI.toFixed(1)+'x, Height',targetHeightM+'m, Max',maxPrecedentStoreys,'storeys');

  // ── Zoning analysis summary ──
  var zoningAnalysis={
    zone:zoning.zoneString||zoning.zone,
    asOfRightFSI:asOfRightFSI,
    asOfRightHeightM:asOfRightHeightM,
    maxCoverage:maxCoverage,
    derivedSetbacks:{front:setF,sideE:setSE,sideW:setSW,rear:setR},
    streetwallStoreys:streetwallStoreys,
    stepbackM:3.0,
    hasException:!!zoning.exception,
    exceptionNo:zoning.exceptionNo||null,
    corridorContext:corridorContext,
    targetFSI:targetFSI,
    targetHeightM:targetHeightM,
    maxPrecedentStoreys:maxPrecedentStoreys,
    estROW_M:estROW_M
  };

  console.log('=== ZONING ANALYSIS ===');
  console.log('Zone:',zoningAnalysis.zone,'('+zoneStr+')');
  console.log('FSI:',asOfRightFSI+'x','Height:',asOfRightHeightM+'m','Coverage:',Math.round(maxCoverage*100)+'%');
  console.log('Derived setbacks (ft): F='+setF+' SE='+setSE+' SW='+setSW+' R='+setR);
  console.log('Streetwall:',streetwallStoreys,'storeys, tower step-back:',towerStepbackFt+'ft on all sides');
  if(zoningAnalysis.hasException) console.log('Exception #'+zoningAnalysis.exceptionNo+' — site-specific rules may override');

  // ── RUN BOTH BUILDERS — compare profit to pick the winner ──
  var builderArgs=[areaFt,lotW,lotD,buildableW,buildableD,asOfRightFSI,asOfRightHeightM,zoning,lotPoly,_findTowerRect,vts,bounds,streetwallStoreys,towerStepbackFt,maxTowerPlateSF,zoningAnalysis,lotAngle];

  var midriseConfig=null,highriseConfig=null;
  try{ midriseConfig=_omMidrise.apply(null,builderArgs); console.log('Midrise OK:',midriseConfig.meta.totalStoreys+'st, FSI',midriseConfig.meta.achievedFSI); }
  catch(e){ console.error('*** MIDRISE CRASHED:',e.message,'\n',e.stack); }
  try{ highriseConfig=_omHighrise.apply(null,builderArgs); console.log('Highrise OK:',highriseConfig.meta.totalStoreys+'st, FSI',highriseConfig.meta.achievedFSI); }
  catch(e){ console.error('*** HIGHRISE CRASHED:',e.message,'\n',e.stack); }

  if(!midriseConfig&&!highriseConfig){ console.error('Both builders failed'); return; }

  // ── RUN REAL pfCalc() FOR BOTH OPTIONS ──
  // pfCalc() reads P.vols + P.flr to compute GFA, units, costs, revenue.
  // We swap P.vols temporarily to get real numbers for each option WITHOUT
  // triggering any 3D rebuild (which is debounced and would break).
  // Only ONE rebuild happens at the end for the selected config.

  // Helper: temporarily set P state, run pfCalc, return result (NO rebuild)
  function _runPfCalcOnly(cfg){
    P.vols=cfg.volumes;
    P.flr.gf=cfg.gfH;
    P.flr.typ=cfg.typH;
    // pfCalc() is called directly (not pfData()), so no cache to invalidate
    var pf=null;
    try{
      if(typeof pfCalc==='function') pf=pfCalc();
    }catch(e){ console.error('pfCalc error for '+cfg.meta.totalStoreys+'st:',e.message); }
    return pf;
  }

  // Run pfCalc for midrise (if viable)
  var midriseRealPF=null;
  if(midriseConfig){
    midriseRealPF=_runPfCalcOnly(midriseConfig);
    if(midriseRealPF){
      console.log('Midrise pfCalc: GFA',midriseRealPF.totalGFA,'Units',midriseRealPF.totalUnits,
        'Revenue $'+(midriseRealPF.totalGrossRev/1e6).toFixed(1)+'M, Cost $'+(midriseRealPF.totalCost/1e6).toFixed(1)+'M, Profit $'+(midriseRealPF.margin/1e6).toFixed(1)+'M');
    }
  }

  // Run pfCalc for highrise (if viable)
  var highriseRealPF=null;
  if(highriseConfig){
    highriseRealPF=_runPfCalcOnly(highriseConfig);
    if(highriseRealPF){
      console.log('Highrise pfCalc: GFA',highriseRealPF.totalGFA,'Units',highriseRealPF.totalUnits,
        'Revenue $'+(highriseRealPF.totalGrossRev/1e6).toFixed(1)+'M, Cost $'+(highriseRealPF.totalCost/1e6).toFixed(1)+'M, Profit $'+(highriseRealPF.margin/1e6).toFixed(1)+'M');
    }
  }

  // Pick winner by REAL developer profit
  var midriseProfit=midriseRealPF?midriseRealPF.margin:-Infinity;
  var highriseProfit=highriseRealPF?highriseRealPF.margin:-Infinity;

  var config,comparison={midrise:null,highrise:null,winner:null};
  if(midriseConfig&&midriseRealPF){
    comparison.midrise={meta:midriseConfig.meta,proforma:midriseRealPF};
  }
  if(highriseConfig&&highriseRealPF){
    comparison.highrise={meta:highriseConfig.meta,proforma:highriseRealPF};
  }

  if(midriseConfig&&highriseConfig){
    comparison.winner=highriseProfit>midriseProfit?'highrise':'midrise';
    if(assetClass==='highrise'){
      config=highriseConfig;
      config.realProforma=highriseRealPF;
      comparison.rendered='highrise';
    } else {
      config=midriseConfig;
      config.realProforma=midriseRealPF;
      comparison.rendered='midrise';
    }
    console.log('=== PROFIT COMPARISON (pfCalc) ===');
    console.log('Midrise ('+midriseConfig.meta.totalStoreys+'st): Profit $'+Math.round(midriseProfit/1e6)+'M');
    console.log('Highrise ('+highriseConfig.meta.totalStoreys+'st): Profit $'+Math.round(highriseProfit/1e6)+'M');
    console.log('Rendering: '+assetClass.toUpperCase()+'. Winner: '+comparison.winner);
  } else if(highriseConfig){
    config=highriseConfig;
    config.realProforma=highriseRealPF;
    comparison.winner='highrise';
    comparison.rendered='highrise';
  } else {
    config=midriseConfig;
    config.realProforma=midriseRealPF;
    comparison.winner='midrise';
    comparison.rendered='midrise';
  }

  config.zoningAnalysis=zoningAnalysis;
  config.comparison=comparison;

  // ── Sanity checks ──
  console.log('=== RENDERING '+comparison.rendered.toUpperCase()+' ===');
  config.volumes.forEach(function(v){
    console.log('Vol '+v.name+': '+v.width+'x'+v.depth+' storeys='+v.storeys+(v.customPolyLocal?' [POLYGON]':' [RECT]'));
  });

  // ── SINGLE rebuild with selected config ──
  P.vols=config.volumes;
  P.flr.gf=config.gfH;
  P.flr.typ=config.typH;
  P.set.front=setF;
  P.set.sideE=setSE;
  P.set.sideW=setSW;
  P.set.rear=setR;

  // ── Multi-tower override for large lots on tall-building zones ──
  // Auto-replaces the single block with realistic 2-4 tower master plan when:
  //   lot >= 50k sf AND zoning supports >=12 storeys or FSI >=2.5
  try {
    if(typeof window.shouldFireMultiTower === 'function' &&
       typeof window.generateMultiTowerMassing === 'function'){
      var mt = window.shouldFireMultiTower(lotPoly, zoning);
      if(mt.fire){
        console.log('[Multi-tower] Triggered (sync path) - ' + mt.reason);
        window.generateMultiTowerMassing(lotPoly, zoning, {
          towerCount: mt.towerCount,
          podiumStoreys: 6,
          towerStoreys: Math.min(zoning && zoning.maxStoreys ? zoning.maxStoreys - 6 : 25, 50),
          hasCommGF: 1
        });
      }
    }
  } catch(e){ console.warn('[Multi-tower] dispatch failed (sync):', e); }

  // Turn off angular planes if visible
  if(typeof _angularPlanesVisible!=='undefined'&&_angularPlanesVisible){
    if(typeof toggleAngularPlanes==='function') toggleAngularPlanes();
  }

  buildLotPanel();
  buildSetbackPanel();
  buildFloorPanel();
  buildVolPanel();
  rebuildAll();

  var realProforma=config.realProforma;
  P._optimalMassing=config;

  // Compute planning costs
  if(realProforma){
    var realFsiRatio=realProforma.fsi/(parseFloat(config.meta.asOfRightFSI)||1);
    var realRoute='zba';
    if(realFsiRatio<=1.05) realRoute='as-of-right';
    else if(realFsiRatio<=1.3) realRoute='mv';
    config.planningCosts=_planningCosts(
      config.meta.totalStoreys,
      realProforma.totalUnits,
      realProforma.commGFA,
      realFsiRatio,
      realRoute
    );
  }

  showOptimalInfo(config);
  if(typeof switchTab==='function') switchTab('massing');
}

/**
 * Builds a ZBLA-optimized mid-rise massing (podium + upper storeys, max 14 storeys).
 * Uses Toronto Mid-Rise Performance Standards (2024 update) and corridor precedents
 * to maximize developer profit while staying within ZBLA-approvable bounds.
 *
 * Strategy: Work BACKWARD from target FSI → required GFA → required storeys.
 * The target FSI is derived from corridor precedent multipliers, not just as-of-right.
 */
/**
 * Estimates planning application fees and required studies based on the zoning-navigator skill.
 * Uses Toronto 2024 fee schedules and study triggers from By-law 569-2013 framework.
 * @param {number} storeys - Proposed building height in storeys
 * @param {number} units - Estimated residential units
 * @param {number} commGFA_SF - Commercial GFA in square feet
 * @param {number} fsiRatio - Achieved FSI / as-of-right FSI
 * @param {string} approvalPath - 'as-of-right', 'mv', or 'zba'
 * @returns {{appFees:number, studyCosts:number, totalPlanningCost:number, studies:Array, timeline:{min:number,max:number}, applications:Array}}
 */
function _planningCosts(storeys,units,commGFA_SF,fsiRatio,approvalPath){
  var apps=[],studies=[],appFees=0,studyCosts=0;
  var commGFA_M2=commGFA_SF*0.0929;
  var route=approvalPath||'zba';

  // ── Application fees (Toronto 2024 schedule) ──
  if(route==='zba'||route==='opa_zba'){
    apps.push({type:'ZBA',fee:units>80?45000:28000,section:'s.34'});
    appFees+=units>80?45000:28000;
    if(route==='opa_zba'){
      apps.push({type:'OPA',fee:48000,section:'s.22'});
      appFees+=48000;
    }
  } else if(route==='mv'){
    apps.push({type:'Minor Variance',fee:3500,section:'s.45(1)'});
    appFees+=3500;
  }
  // SPA always required for new construction in Toronto
  apps.push({type:'Site Plan Approval',fee:Math.min(25000,Math.max(5000,units*120)),section:'s.41'});
  appFees+=Math.min(25000,Math.max(5000,units*120));

  // ── Required studies (Toronto triggers from zoning-navigator) ──
  // Always required
  studies.push({name:'Planning Justification Report',cost:25000,weeks:6});
  studyCosts+=25000;
  studies.push({name:'Survey Plan (OLS)',cost:8000,weeks:3});
  studyCosts+=8000;
  studies.push({name:'Functional Servicing & SWM',cost:18000,weeks:5});
  studyCosts+=18000;
  studies.push({name:'Geotechnical Study',cost:12000,weeks:4});
  studyCosts+=12000;
  studies.push({name:'Toronto Green Standard (TGS)',cost:3000,weeks:2});
  studyCosts+=3000;

  // Height-triggered
  if(storeys>4){
    studies.push({name:'Sun/Shadow Study',cost:8000,weeks:3});
    studyCosts+=8000;
    studies.push({name:'Urban Design Report',cost:15000,weeks:5});
    studyCosts+=15000;
  }
  if(storeys>6){ // >20m height
    studies.push({name:'Pedestrian Wind Study',cost:35000,weeks:8});
    studyCosts+=35000;
  }

  // Unit-count triggered
  if(units>100){
    studies.push({name:'Community Services & Facilities',cost:18000,weeks:6});
    studyCosts+=18000;
    studies.push({name:'Housing Issues Report',cost:12000,weeks:4});
    studyCosts+=12000;
  }
  if(units>80||commGFA_M2>5000){
    studies.push({name:'Traffic Impact Study',cost:25000,weeks:8});
    studyCosts+=25000;
  }

  // Common for any development
  studies.push({name:'Noise & Vibration Feasibility',cost:10000,weeks:4});
  studyCosts+=10000;
  studies.push({name:'Phase 1 ESA',cost:6000,weeks:3});
  studyCosts+=6000;
  studies.push({name:'Arborist Report & Tree Protection',cost:5000,weeks:3});
  studyCosts+=5000;

  // Timeline (months) — from zoning-navigator
  var timeline;
  if(route==='opa_zba') timeline={min:12,max:24};
  else if(route==='zba') timeline={min:8,max:18};
  else if(route==='mv') timeline={min:3,max:6};
  else timeline={min:6,max:12}; // as-of-right SPA only

  return {
    appFees:appFees,
    studyCosts:studyCosts,
    totalPlanningCost:appFees+studyCosts,
    studies:studies,
    timeline:timeline,
    applications:apps
  };
}

/**
 * Quick proforma estimate for comparing midrise vs highrise profitability.
 * Uses height-based construction cost multipliers (Toronto 2024 benchmarks):
 *   Wood-frame midrise (5-8st): ~$345/sf
 *   Concrete midrise (9-14st): ~$397/sf
 *   Highrise (15-25st): ~$466/sf
 *   Tall highrise (26-40st): ~$518/sf
 *   Supertall (40+st): ~$570/sf
 */
function _quickProforma(meta,lotAreaFt){
  var pf=P.pf||{};
  var totalGFA=meta.totalGFA||0;
  var storeys=meta.totalStoreys||1;
  var units=meta.estUnits||0;
  var commGFA=meta.commercialGFA||0;
  var netResi=meta.netResidential||0;

  // ── Revenue ──
  // Residential: use actual PSF from unit mix if available, else $1000/sf
  var avgPSF=1000;
  if(pf.units&&pf.units.length>0){
    var tPSF=0,cnt=0;
    pf.units.forEach(function(u){ if(u.psf>0){tPSF+=u.psf;cnt++;} });
    if(cnt>0) avgPSF=tPSF/cnt;
  }
  var resiRev=netResi*avgPSF;

  // Commercial: capitalize NOI (avg $25/sf NNN rent, 5.5% cap rate)
  var commRent=25,commCap=0.055;
  if(pf.comm&&pf.comm.length>0){
    var tr=0,tc=0,cn=0;
    pf.comm.forEach(function(c){ if(c.rent>0){tr+=c.rent;tc+=c.cap||0.055;cn++;} });
    if(cn>0){commRent=tr/cn;commCap=tc/cn;}
  }
  var commRev=commCap>0?commGFA*commRent/commCap:0;

  // Parking + lockers
  var parkSpaces=Math.round(units*(pf.parkRatio||0.30));
  var lockers=Math.round(units*(pf.lockerRatio||0.56));
  var parkRev=parkSpaces*(pf.parkPrice||60000);
  var lockerRev=lockers*(pf.lockerPrice||8000);

  var totalRev=resiRev+commRev+parkRev+lockerRev;

  // ── Construction cost — height-based multiplier ──
  // Base: sum of P.pf.hc rates (default ~$345.50/sf) — calibrated for wood-frame midrise
  var baseCostPSF=0;
  if(pf.hc){
    for(var k in pf.hc){ if(pf.hc.hasOwnProperty(k)) baseCostPSF+=pf.hc[k]; }
  }
  if(baseCostPSF<200) baseCostPSF=345.5; // fallback

  var costMultiplier=1.0;
  if(storeys>40) costMultiplier=1.65;
  else if(storeys>25) costMultiplier=1.50;
  else if(storeys>14) costMultiplier=1.35;
  else if(storeys>8) costMultiplier=1.15;

  var hardCostPSF=Math.round(baseCostPSF*costMultiplier);
  var totalHard=totalGFA*hardCostPSF;

  // Soft costs (~27.5% of hard — sum of default sc percentages)
  var scPct=0;
  if(pf.sc){ for(var sk in pf.sc){ if(pf.sc.hasOwnProperty(sk)) scPct+=pf.sc[sk]; } }
  if(scPct<0.1) scPct=0.275;
  var totalSoft=totalHard*scPct;

  // Development charges + CBC
  var dc=units*(pf.dcPerUnit||45000)+commGFA*(pf.dcCommPerSF||44);
  var cbc=units*(pf.s37PerUnit||7300);
  var parkland=pf.parkland||2200000;
  totalSoft+=dc+cbc+parkland;

  // Land
  var landCost=pf.landPrice||10000000;

  // Financing (~6.5% of hard+soft over 24mo draw)
  var financingCost=(totalHard+totalSoft)*(pf.intRate||0.065)*(pf.drawMonths||24)/12*((pf.ltc||0.65)/2);

  // ── Planning application costs (zoning-navigator skill) ──
  var fsiRatio=meta.achievedFSI?(parseFloat(meta.achievedFSI)/(parseFloat(meta.asOfRightFSI)||1)):1;
  var approvalRoute='zba';
  if(fsiRatio<=1.05) approvalRoute='as-of-right';
  else if(fsiRatio<=1.3) approvalRoute='mv';
  else approvalRoute='zba';
  var planCosts=_planningCosts(storeys,units,commGFA,fsiRatio,approvalRoute);
  totalSoft+=planCosts.totalPlanningCost;

  var totalCost=landCost+totalHard+totalSoft+financingCost;
  var profit=totalRev-totalCost;
  var marginOnCost=totalCost>0?profit/totalCost:0;
  var marginOnRev=totalRev>0?profit/totalRev:0;

  return {
    totalRev:Math.round(totalRev),
    totalCost:Math.round(totalCost),
    totalHard:Math.round(totalHard),
    hardCostPSF:hardCostPSF,
    costMultiplier:costMultiplier,
    landCost:landCost,
    profit:Math.round(profit),
    marginOnCost:marginOnCost,
    marginOnRev:marginOnRev,
    planningCosts:planCosts,
    approvalRoute:approvalRoute
  };
}

function _omMidrise(areaFt,lotW,lotD,buildableW,buildableD,asOfRightFSI,asOfRightHeightM,zoning,lotPoly,findTowerRect,vts,bounds,swStoreys,stepbackFt,maxTowerPlateSF,zoningAnalysis,lotAngle){
  var lotWidthM=lotW*0.3048;
  var lotDepthM=lotD*0.3048;

  // ── TARGET FSI: corridor precedent, NOT just as-of-right ──
  var targetFSI=zoningAnalysis.targetFSI||asOfRightFSI*2.0;
  var estROW=zoningAnalysis.estROW_M||20;

  // Mid-Rise 1:1 Rule: max height = ROW width (2024 standards)
  // Angular planes REMOVED in 2024 update — no more wedding-cake stepping
  var maxHeightFromROW=Math.min(estROW,45); // 45m = 14 storeys absolute cap (2024)
  var maxStoreyFromROW=Math.min(Math.floor(maxHeightFromROW/3.0),14);

  // Work backward: target storeys from target FSI
  var targetGFA=targetFSI*areaFt;
  // Podium = full lot coverage, tower = inscribed rect (smaller)
  // Estimate tower plate area as ~60-70% of lot for midrise
  var estTowerPlateFraction=0.65;
  var estTowerPlate=areaFt*estTowerPlateFraction;
  // GFA = podiumStoreys*lotArea + towerStoreys*towerPlate
  // Solve for totalStoreys: targetGFA = swStoreys*areaFt + (total-swStoreys)*estTowerPlate
  var idealTotalFromFSI=Math.round((targetGFA-swStoreys*areaFt)/estTowerPlate+swStoreys);
  idealTotalFromFSI=Math.max(idealTotalFromFSI,swStoreys+2); // at least 2 above podium

  // Take the HIGHER of FSI-derived height and ROW-based height (push for max)
  var targetStoreys=Math.min(Math.max(idealTotalFromFSI,maxStoreyFromROW),14);
  // But don't go below as-of-right
  var asOfRightStoreys=Math.floor(asOfRightHeightM/3.0);
  targetStoreys=Math.max(targetStoreys,asOfRightStoreys,6);
  targetStoreys=Math.min(targetStoreys,14); // Mid-rise hard cap (2024 standards)

  var gfH=15; // 4.5m retail-ready ground floor (Tall Building Guidelines)
  var typH=10; // 3.0m typical
  // podiumStoreys = number of UPPER floors at full lot footprint (renderer convention)
  // GF is always at full lot, so total floors at full width = podiumStoreys + 1 (GF)
  var podiumStoreys=Math.min(swStoreys,targetStoreys-2);
  var towerStoreys=Math.max(targetStoreys-podiumStoreys-1,1); // subtract GF + podium

  console.log('=== MIDRISE STRATEGY ===');
  console.log('Target FSI:',targetFSI.toFixed(1)+'x (corridor:',zoningAnalysis.corridorContext+')');
  console.log('ROW est:',estROW+'m → max',maxStoreyFromROW,'storeys (1:1 rule)');
  console.log('FSI-derived storeys:',idealTotalFromFSI,'→ target:',targetStoreys);

  // ── USE LOT POLYGON AS-IS ──
  // The building MUST stay strictly inside the property line. We use the lot
  // polygon EXACTLY as drawn — no simplification, no convex hull, no inset.
  // Any vertex-merging/simplification at concave corners can produce edges
  // that bow outward beyond the lot, which is not legal. The renderer
  // artifacts (the white "wall fin") on irregular polygons are addressed by
  // disabling balconies in the volume config below — they're the actual
  // source of the visible artifact, not the polygon shape.
  //
  // Note: a tiny dedupe (consecutive duplicate vertices) is still applied by
  // _dedupePolyVerts inside lotVerts() and on save/load — that's pure cleanup
  // (zero-area edges only) and never changes the polygon's outline.
  var simplifiedPoly = lotPoly;
  var simplifiedAreaSF = areaFt;
  if(simplifiedPoly && simplifiedPoly.length >= 4){
    var sn = simplifiedPoly[0][0]===simplifiedPoly[simplifiedPoly.length-1][0] && simplifiedPoly[0][1]===simplifiedPoly[simplifiedPoly.length-1][1] ? simplifiedPoly.length-1 : simplifiedPoly.length;
    var sa = 0;
    for(var sii = 0; sii < sn; sii++){
      var sj = (sii+1) % sn;
      sa += simplifiedPoly[sii][0]*simplifiedPoly[sj][1] - simplifiedPoly[sj][0]*simplifiedPoly[sii][1];
    }
    simplifiedAreaSF = Math.abs(sa/2);
  }

  // ── SINGLE VOLUME: Podium + Tower in one ──
  // The renderer handles podium/tower stacking internally via podiumStoreys + stepbackAmt.
  // BALCONIES DISABLED for optimal massing — on irregular polygons (concave
  // corners, off-axis walls) the N/S/E/W edge classifier can misalign balconies
  // and produce visible "wall fins" where balconies protrude inward at concave
  // corners. User can manually enable balconies later in the volume editor
  // once they've reviewed the polygon shape.
  var volA={
    name:'A',
    storeys:targetStoreys,
    startEg:0, depth:Math.round(lotD), width:Math.round(lotW), offEast:0,
    offWest:0, angle:0,
    podiumStoreys:podiumStoreys,
    stepbackAmt:stepbackFt,
    gfHeight:0,
    color:'#b8c4d0', commGF:1, windows:1, winSpacing:3,
    balconies:0, balcEvery:2, balcDepth:4,
    balcN:0,balcS:0,balcE:0,balcW:0,
    cladding:'brick',
    storefrontN:1,storefrontS:0,storefrontE:0,storefrontW:0,
    customPolyLocal:simplifiedPoly,
    customPoly: (function(){
      // lat/lng equivalent so realignBuildingToLot can re-derive customPolyLocal
      // when _gpsOrigin shifts (fixes "building renders north of lot" bug).
      if(!P || !P._gpsOrigin || !simplifiedPoly) return null;
      var oLat=P._gpsOrigin.lat, oLng=P._gpsOrigin.lng;
      var mPerDegLat=110540, mPerDegLng=111320*Math.cos(oLat*Math.PI/180);
      return simplifiedPoly.map(function(pt){
        return [oLng + (pt[0]*0.3048)/mPerDegLng, oLat - (pt[1]*0.3048)/mPerDegLat];
      });
    })(),
    customAreaSF:Math.round(simplifiedAreaSF)
  };

  console.log('Midrise: single volume, '+targetStoreys+' storeys (podium:'+podiumStoreys+' + tower:'+towerStoreys+'), stepback:'+stepbackFt+'ft');

  // ── GFA Calculation (podium at full lot, tower at stepped-back area) ──
  // Estimate tower plate after step-back using centroid-shrink (matches renderer + computeGFA)
  var towerPlateSF=areaFt; // default: same as lot
  if(stepbackFt>0 && lotPoly && lotPoly.length>=4){
    var n2=lotPoly[0][0]===lotPoly[lotPoly.length-1][0]&&lotPoly[0][1]===lotPoly[lotPoly.length-1][1]?lotPoly.length-1:lotPoly.length;
    var cx2=0,cz2=0;
    for(var si=0;si<n2;si++){cx2+=lotPoly[si][0];cz2+=lotPoly[si][1];}
    cx2/=n2;cz2/=n2;
    var shrunk2=[];
    for(var si2=0;si2<n2;si2++){
      var dxs=lotPoly[si2][0]-cx2, dzs=lotPoly[si2][1]-cz2;
      var dists=Math.sqrt(dxs*dxs+dzs*dzs);
      var sc2=dists>0.01?Math.max(0.3,(dists-stepbackFt)/dists):1;
      shrunk2.push([cx2+dxs*sc2, cz2+dzs*sc2]);
    }
    var tpArea=0;
    for(var si3=0;si3<shrunk2.length;si3++){
      var sj=(si3+1)%shrunk2.length;
      tpArea+=shrunk2[si3][0]*shrunk2[sj][1]-shrunk2[sj][0]*shrunk2[si3][1];
    }
    towerPlateSF=Math.round(Math.abs(tpArea)/2);
  } else {
    var towerW=Math.max(Math.round(lotW-stepbackFt*2),40);
    var towerD=Math.max(Math.round(lotD-stepbackFt*2),30);
    towerPlateSF=towerW*towerD;
  }
  // GFA: GF (full lot) + podium upper floors (full lot) + tower floors (stepped-back plate)
  var gfGFA=areaFt; // ground floor at full lot
  var podGFA=areaFt*podiumStoreys; // upper podium floors at full lot
  var twrGFA=towerPlateSF*towerStoreys; // tower floors at stepped-back plate
  var totalGFA=gfGFA+podGFA+twrGFA;
  var achievedFSI=totalGFA/areaFt;

  var commGFA=areaFt; // GF retail
  var residentialGFA=totalGFA-commGFA;
  var netRes=residentialGFA*0.85; // 85% efficiency
  var estUnits=Math.round(netRes/850);

  // ── APPROVAL RISK ASSESSMENT (Zoning Navigator — s.45/s.34 decision tree) ──
  var approvalPath,approvalNotes='',approvalRisk='green';
  var issues=[];
  var nonCompliances=[];

  // Check tower plate vs 750m² guideline
  var towerPlateM2=Math.round(towerPlateSF*0.0929);
  if(towerPlateM2>750) issues.push('Tower plate '+towerPlateM2+'m\u00B2 exceeds 750m\u00B2 guideline');

  // Rear setback compliance (2024 Mid-Rise Standards)
  var rearSetbackReqM=targetStoreys>6?10.0:7.5;
  var rearSetbackActualM=Math.round((P.set.rear||zoningAnalysis.derivedSetbacks.rear||25)*0.3048*10)/10;
  if(rearSetbackActualM<rearSetbackReqM){
    issues.push('Rear setback '+rearSetbackActualM+'m < required '+rearSetbackReqM+'m');
    nonCompliances.push({standard:'Rear Setback',permitted:rearSetbackReqM+'m',proposed:rearSetbackActualM+'m',deviation:Math.round((1-rearSetbackActualM/rearSetbackReqM)*100)+'%',severity:'minor'});
  }

  // Height vs ROW (1:1 rule)
  var buildingHeightM=(gfH+(targetStoreys-1)*typH)*0.3048;
  var estROW=zoningAnalysis.estROW_M||20;
  if(buildingHeightM>estROW*1.1){
    issues.push('Height '+buildingHeightM.toFixed(0)+'m exceeds ROW width '+estROW+'m by '+(((buildingHeightM/estROW)-1)*100).toFixed(0)+'%');
    nonCompliances.push({standard:'Height (1:1 ROW)',permitted:estROW+'m',proposed:buildingHeightM.toFixed(0)+'m',deviation:'+'+(((buildingHeightM/estROW)-1)*100).toFixed(0)+'%',severity:'moderate'});
  }

  // FSI non-compliance (severity per zoning-navigator)
  var fsiExceedance=achievedFSI/asOfRightFSI;
  var fsiDeviation=((fsiExceedance-1)*100);
  var fsiSeverity='trivial';
  if(fsiDeviation>25) fsiSeverity='major';
  else if(fsiDeviation>15) fsiSeverity='moderate';
  else if(fsiDeviation>5) fsiSeverity='minor';
  if(fsiDeviation>5) nonCompliances.push({standard:'Max FSI',permitted:asOfRightFSI.toFixed(1)+'x',proposed:achievedFSI.toFixed(1)+'x',deviation:'+'+fsiDeviation.toFixed(0)+'%',severity:fsiSeverity});

  // Height non-compliance
  var htDeviation=((buildingHeightM/asOfRightHeightM)-1)*100;
  if(htDeviation>5){
    var htSev=htDeviation>25?'major':(htDeviation>15?'moderate':'minor');
    nonCompliances.push({standard:'Max Height',permitted:asOfRightHeightM+'m',proposed:buildingHeightM.toFixed(0)+'m',deviation:'+'+htDeviation.toFixed(0)+'%',severity:htSev});
  }

  // ── Application routing (zoning-navigator s.45 four-tests vs s.34 ZBA) ──
  var hasMajor=nonCompliances.some(function(nc){return nc.severity==='major';});
  var ncCount=nonCompliances.length;

  if(achievedFSI<=asOfRightFSI*1.05&&buildingHeightM<=asOfRightHeightM*1.05){
    approvalPath='As-of-Right (Site Plan Approval only)';
    approvalNotes='Within zoning envelope. Standard SPA ~6-12 months. Planning Act s.41.';
    approvalRisk='green';
  } else if(!hasMajor&&ncCount<=4&&fsiDeviation<=25){
    // Minor Variance viable — four tests likely satisfied (s.45(1))
    approvalPath='Minor Variance (Committee of Adjustment)';
    approvalNotes=ncCount+' variance(s) needed. '+fsiDeviation.toFixed(0)+'% FSI increase is '+(fsiDeviation<=15?'within':'at limit of')+' CoA comfort zone. Planning Act s.45(1). Timeline: ~3-6 months.';
    approvalRisk=fsiDeviation>20?'yellow':'green';
  } else {
    approvalPath='Zoning By-law Amendment (City Council)';
    var zblaTimeline=issues.length>2?'18-30':'12-24';
    approvalNotes='ZBLA required (Planning Act s.34, ~'+zblaTimeline+' months). FSI '+achievedFSI.toFixed(1)+'x vs as-of-right '+asOfRightFSI.toFixed(1)+'x (+'+fsiDeviation.toFixed(0)+'%). '+ncCount+' non-compliance(s) exceed MV threshold.';
    approvalRisk=issues.length>2?'yellow':(fsiExceedance>4.0?'yellow':'green');
  }

  // CBC estimate (4% of land value — use proforma land cost if available)
  var landPSF=P.pf&&P.pf.landCostPSF?P.pf.landCostPSF:150; // default $150/sf
  var estLandValue=landPSF*areaFt;
  var estCBC=Math.round(estLandValue*0.04);

  // ── Parking (Toronto standards, reduced near transit) ──
  var resP=Math.round(estUnits*0.6),visP=Math.round(estUnits*0.1);
  var comP=Math.round(commGFA*0.0929/100);
  var totP=resP+visP+comP;

  return {
    volumes:[volA],
    gfH:gfH, typH:typH,
    meta:{
      totalStoreys:targetStoreys,
      totalGFA:Math.round(totalGFA),
      achievedFSI:achievedFSI.toFixed(2),
      asOfRightFSI:asOfRightFSI.toFixed(2),
      targetFSI:(zoningAnalysis.targetFSI||0).toFixed(2),
      fsiExceedance:((fsiExceedance-1)*100).toFixed(0)+'%',
      estUnits:estUnits,
      podiumStoreys:podiumStoreys,
      mainTowerStoreys:towerStoreys,
      stepbackM:'3.0',
      approvalPath:approvalPath,
      approvalNotes:approvalNotes,
      approvalRisk:approvalRisk,
      approvalIssues:issues,
      corridorContext:zoningAnalysis.corridorContext,
      estCBC:estCBC,
      totalParking:totP, parkingLevels:Math.ceil(totP/30),
      resParking:resP, visitorParking:visP, commParking:comP,
      commercialGFA:Math.round(commGFA),
      residentialGFA:Math.round(residentialGFA),
      netResidential:Math.round(netRes),
      buildingHeightM:buildingHeightM.toFixed(1),
      buildingHeightFt:gfH+(targetStoreys-1)*typH,
      lotCoverage:'100.0',
      towerFloorPlateM2:towerPlateM2,
      rearSetbackM:rearSetbackActualM,
      estROW_M:estROW
    }
  };
}

/**
 * Builds a ZBLA-optimized high-rise massing (podium + tower, 15-65 storeys).
 * Uses Toronto Tall Building Design Guidelines and corridor precedents to
 * maximize developer profit while staying within ZBLA-approvable bounds.
 *
 * Strategy: Work BACKWARD from target FSI → required GFA → required tower storeys.
 * Tower plate hard-capped at 750m² per Tall Building Guidelines.
 * Height derived from target density and tower plate capacity.
 */
function _omHighrise(areaFt,lotW,lotD,buildableW,buildableD,asOfRightFSI,asOfRightHeightM,zoning,lotPoly,findTowerRect,vts,bounds,swStoreys,stepbackFt,maxTowerPlateSF,zoningAnalysis,lotAngle){
  var asOfRightStoreys=Math.floor(asOfRightHeightM/3.0);
  var lotAreaM2=areaFt*0.0929;

  // ── TARGET: Maximize leasable area via ZBLA-approvable density ──
  var targetFSI=zoningAnalysis.targetFSI||Math.max(asOfRightFSI*7,18);
  var maxPrecedentStoreys=zoningAnalysis.maxPrecedentStoreys||45;
  var towerPlateSF=maxTowerPlateSF; // 8073sf = 750m²

  var gfH=16; // 4.8m retail-ready (Tall Building Guidelines: 4.5m min)
  var typH=10; // 3.0m typical
  var podiumStoreys=Math.min(swStoreys,6); // podium = streetwall context

  // GFA math: work backward from target FSI to required tower storeys
  // GF + podium upper floors are at full lot coverage, tower above is at reduced plate
  var targetGFA=targetFSI*areaFt;
  var podiumGFA=areaFt*(podiumStoreys+1); // +1 for GF at full lot
  var towerGFANeeded=Math.max(0,targetGFA-podiumGFA);
  var towerStoreys=Math.max(Math.ceil(towerGFANeeded/towerPlateSF),10);
  var targetStoreys=podiumStoreys+1+towerStoreys; // GF + podium + tower

  // Cap at corridor precedent max but ensure minimum 25 storeys for any highrise
  // (a "highrise" under 25 storeys isn't maximizing the site)
  targetStoreys=Math.min(targetStoreys,maxPrecedentStoreys);
  targetStoreys=Math.max(targetStoreys,25);
  towerStoreys=Math.max(targetStoreys-podiumStoreys-1,10); // subtract GF + podium

  // Recalculate achieved FSI after capping
  var actualTowerGFA=towerPlateSF*towerStoreys;
  var actualTotalGFA=podiumGFA+actualTowerGFA; // podiumGFA already includes GF
  var previewFSI=actualTotalGFA/areaFt;

  console.log('=== HIGHRISE STRATEGY ===');
  console.log('As-of-right: FSI',asOfRightFSI+'x, Height',asOfRightHeightM+'m ('+asOfRightStoreys+' storeys)');
  console.log('ZBLA Target: FSI',targetFSI.toFixed(1)+'x → need',Math.ceil(towerGFANeeded/towerPlateSF),'tower storeys');
  console.log('Precedent cap:',maxPrecedentStoreys,'storeys → building:',targetStoreys,'(podium:',podiumStoreys+', tower:',towerStoreys+')');
  console.log('Achieved FSI:',previewFSI.toFixed(1)+'x ('+((previewFSI/asOfRightFSI-1)*100).toFixed(0)+'% above as-of-right)');

  // ── SINGLE VOLUME: Podium + Tower in one ──
  // The renderer handles podium/tower stacking internally via podiumStoreys + stepbackAmt.
  // Use lot polygon AS-IS (same architectural rule as midrise: building
  // stays INSIDE the lot, no shape transformations of any kind).
  var simplifiedPolyHi = lotPoly;
  var simplifiedAreaHi = areaFt;
  if(simplifiedPolyHi && simplifiedPolyHi.length >= 4){
    var snHi = simplifiedPolyHi[0][0]===simplifiedPolyHi[simplifiedPolyHi.length-1][0] && simplifiedPolyHi[0][1]===simplifiedPolyHi[simplifiedPolyHi.length-1][1] ? simplifiedPolyHi.length-1 : simplifiedPolyHi.length;
    var saHi = 0;
    for(var siiHi = 0; siiHi < snHi; siiHi++){
      var sjHi = (siiHi+1) % snHi;
      saHi += simplifiedPolyHi[siiHi][0]*simplifiedPolyHi[sjHi][1] - simplifiedPolyHi[sjHi][0]*simplifiedPolyHi[siiHi][1];
    }
    simplifiedAreaHi = Math.abs(saHi/2);
  }

  var volA={
    name:'A',
    storeys:targetStoreys,
    startEg:0, depth:Math.round(lotD), width:Math.round(lotW), offEast:0,
    offWest:0, angle:0,
    podiumStoreys:podiumStoreys,
    stepbackAmt:stepbackFt,
    gfHeight:0,
    color:'#b8c4d0', commGF:1, windows:1, winSpacing:3,
    balconies:0, balcEvery:2, balcDepth:5,
    balcN:0,balcS:0,balcE:0,balcW:0,
    cladding:'brick',
    storefrontN:1,storefrontS:0,storefrontE:0,storefrontW:0,
    customPolyLocal:simplifiedPolyHi,
    customPoly: (function(){
      // lat/lng equivalent so realignBuildingToLot can re-derive customPolyLocal
      // when _gpsOrigin shifts (fixes "building renders north of lot" bug).
      if(!P || !P._gpsOrigin || !simplifiedPolyHi) return null;
      var oLat=P._gpsOrigin.lat, oLng=P._gpsOrigin.lng;
      var mPerDegLat=110540, mPerDegLng=111320*Math.cos(oLat*Math.PI/180);
      return simplifiedPolyHi.map(function(pt){
        return [oLng + (pt[0]*0.3048)/mPerDegLng, oLat - (pt[1]*0.3048)/mPerDegLat];
      });
    })(),
    customAreaSF:Math.round(simplifiedAreaHi)
  };

  console.log('Highrise: single volume, '+targetStoreys+' storeys (podium:'+podiumStoreys+' + tower:'+towerStoreys+'), stepback:'+stepbackFt+'ft');

  // ── GFA Calculation (tower plate estimated after step-back) ──
  // Use centroid-shrink for polygon lots (matches renderer + computeGFA)
  var towerPlateSF=areaFt;
  if(stepbackFt>0 && lotPoly && lotPoly.length>=4){
    var hn=lotPoly[0][0]===lotPoly[lotPoly.length-1][0]&&lotPoly[0][1]===lotPoly[lotPoly.length-1][1]?lotPoly.length-1:lotPoly.length;
    var hcx=0,hcz=0;
    for(var hi=0;hi<hn;hi++){hcx+=lotPoly[hi][0];hcz+=lotPoly[hi][1];}
    hcx/=hn;hcz/=hn;
    var hshrunk=[];
    for(var hi2=0;hi2<hn;hi2++){
      var hdx=lotPoly[hi2][0]-hcx, hdz=lotPoly[hi2][1]-hcz;
      var hdist=Math.sqrt(hdx*hdx+hdz*hdz);
      var hsc=hdist>0.01?Math.max(0.3,(hdist-stepbackFt)/hdist):1;
      hshrunk.push([hcx+hdx*hsc, hcz+hdz*hsc]);
    }
    var htpArea=0;
    for(var hi3=0;hi3<hshrunk.length;hi3++){
      var hj=(hi3+1)%hshrunk.length;
      htpArea+=hshrunk[hi3][0]*hshrunk[hj][1]-hshrunk[hj][0]*hshrunk[hi3][1];
    }
    towerPlateSF=Math.round(Math.abs(htpArea)/2);
  } else {
    var towerW=Math.max(Math.round(lotW-stepbackFt*2),40);
    var towerD=Math.max(Math.round(lotD-stepbackFt*2),30);
    towerPlateSF=towerW*towerD;
  }
  // Clamp tower plate to 750m² for highrise
  if(towerPlateSF*0.0929>750){
    towerPlateSF=Math.round(750/0.0929);
  }
  var commGFA=areaFt; // GF retail/commercial
  var podGFA=areaFt*podiumStoreys; // upper podium floors at full lot
  var twrGFA=towerPlateSF*towerStoreys; // tower floors at stepped-back plate
  var totalGFA=commGFA+podGFA+twrGFA; // GF + podium + tower
  var achievedFSI=totalGFA/areaFt;

  var residentialGFA=totalGFA-commGFA;
  var netRes=residentialGFA*0.82; // 82% efficiency (highrise)
  var estUnits=Math.round(netRes/820);

  // ── TOWER SEPARATION CHECK (Tall Building Guidelines 3.2.3) ──
  // 12.5m from side/rear lot line → 25m between towers
  var towerWidthM=Math.sqrt(towerPlateSF*0.0929); // approx square side for separation check
  var towerSepE_M=(lotW*0.3048-towerWidthM)/2;
  var towerSepWarnings=[];
  if(towerSepE_M<12.5) towerSepWarnings.push('Tower '+towerSepE_M.toFixed(1)+'m from lot line (min 12.5m for 25m tower separation)');

  // ── APPROVAL RISK ASSESSMENT (Zoning Navigator — s.34 ZBA framework) ──
  var approvalPath,approvalNotes='',approvalRisk='green';
  var issues=[];
  var nonCompliances=[];
  var fsiExceedance=achievedFSI/asOfRightFSI;
  var buildingHeightM=(gfH+(targetStoreys-1)*typH)*0.3048;

  // Check tower plate vs 750m² guideline
  var towerPlateM2=Math.round(towerPlateSF*0.0929);
  if(towerPlateM2>750){ issues.push('Tower plate '+towerPlateM2+'m\u00B2 exceeds 750m\u00B2 cap'); nonCompliances.push({standard:'Tower Plate',permitted:'750m\u00B2',proposed:towerPlateM2+'m\u00B2',deviation:'+'+Math.round((towerPlateM2/750-1)*100)+'%',severity:towerPlateM2>850?'major':'moderate'}); }
  if(towerPlateM2>850) approvalRisk='red';

  // Tower separation
  if(towerSepE_M<12.5){ issues.push('Tower setback '+towerSepE_M.toFixed(1)+'m < 12.5m from lot line'); nonCompliances.push({standard:'Tower Separation',permitted:'12.5m to lot line',proposed:towerSepE_M.toFixed(1)+'m',deviation:'-'+Math.round((1-towerSepE_M/12.5)*100)+'%',severity:towerSepE_M<10?'major':'moderate'}); }
  if(towerSepE_M<10) approvalRisk='red';

  // FSI non-compliance
  var fsiDeviation=((fsiExceedance-1)*100);
  nonCompliances.push({standard:'Max FSI',permitted:asOfRightFSI.toFixed(1)+'x',proposed:achievedFSI.toFixed(1)+'x',deviation:'+'+fsiDeviation.toFixed(0)+'%',severity:fsiDeviation>100?'fundamental':'major'});

  // Height non-compliance
  var htDeviation=((buildingHeightM/asOfRightHeightM)-1)*100;
  if(htDeviation>5) nonCompliances.push({standard:'Max Height',permitted:asOfRightHeightM+'m',proposed:buildingHeightM.toFixed(0)+'m',deviation:'+'+htDeviation.toFixed(0)+'%',severity:htDeviation>100?'fundamental':'major'});

  // FSI vs corridor precedent
  var corridorMax=Math.round(zoningAnalysis.targetFSI||asOfRightFSI*3.5);
  if(achievedFSI>corridorMax*1.2) issues.push('FSI '+achievedFSI.toFixed(1)+'x exceeds corridor precedent ~'+corridorMax+'x by '+((achievedFSI/corridorMax-1)*100).toFixed(0)+'%');

  // ── Application routing — highrise almost always ZBA (s.34) ──
  var hasFundamental=nonCompliances.some(function(nc){return nc.severity==='fundamental';});

  if(achievedFSI<=asOfRightFSI*1.05&&targetStoreys<=asOfRightStoreys){
    approvalPath='As-of-Right (Site Plan Approval only)';
    approvalNotes='Within zoning envelope. Standard SPA ~6-12 months. Planning Act s.41.';
    approvalRisk='green';
  } else if(hasFundamental){
    approvalPath='OPA + ZBA (Council — concurrent filing)';
    approvalNotes='Fundamental departure from OP/zoning requires Official Plan Amendment (s.22) + ZBA (s.34). Timeline: ~12-24 months. '+nonCompliances.length+' non-compliance(s).';
    approvalRisk='yellow';
  } else {
    approvalPath='Zoning By-law Amendment (City Council)';
    var zblaTimeline=issues.length>2?'18-30':'12-24';
    approvalNotes='ZBLA required (Planning Act s.34, ~'+zblaTimeline+' months). FSI '+achievedFSI.toFixed(1)+'x vs as-of-right '+asOfRightFSI.toFixed(1)+'x (+'+fsiDeviation.toFixed(0)+'%). '+nonCompliances.length+' non-compliance(s).';
    if(approvalRisk==='green') approvalRisk=issues.length>2?'yellow':'green';
  }

  // CBC estimate (replaces old Section 37)
  var landPSF=P.pf&&P.pf.landCostPSF?P.pf.landCostPSF:150;
  var estLandValue=landPSF*areaFt;
  var estCBC=Math.round(estLandValue*0.04);

  // ── Parking (reduced for highrise near transit) ──
  var resP=Math.round(estUnits*0.5),visP=Math.round(estUnits*0.08);
  var comP=Math.round(commGFA*0.0929/100);
  var totP=resP+visP+comP;

  return {
    volumes:[volA],
    gfH:gfH, typH:typH,
    meta:{
      totalStoreys:targetStoreys,
      totalGFA:Math.round(totalGFA),
      achievedFSI:achievedFSI.toFixed(2),
      asOfRightFSI:asOfRightFSI.toFixed(2),
      targetFSI:(zoningAnalysis.targetFSI||0).toFixed(2),
      fsiExceedance:((fsiExceedance-1)*100).toFixed(0)+'%',
      estUnits:estUnits,
      podiumStoreys:podiumStoreys,
      mainTowerStoreys:towerStoreys,
      stepbackM:'3.0',
      approvalPath:approvalPath,
      approvalNotes:approvalNotes,
      approvalRisk:approvalRisk,
      approvalIssues:issues,
      corridorContext:zoningAnalysis.corridorContext,
      estCBC:estCBC,
      totalParking:totP, parkingLevels:Math.ceil(totP/35),
      resParking:resP, visitorParking:visP, commParking:comP,
      commercialGFA:Math.round(commGFA),
      residentialGFA:Math.round(residentialGFA),
      netResidential:Math.round(netRes),
      buildingHeightM:buildingHeightM.toFixed(1),
      buildingHeightFt:gfH+(targetStoreys-1)*typH,
      lotCoverage:'100.0',
      towerFloorPlateM2:towerPlateM2,
      towerSepWarnings:towerSepWarnings
    }
  };
}

function showOptimalInfo(config){
  var m=config.meta;
  var za=config.zoningAnalysis;
  var rp=config.realProforma; // REAL proforma from pfCalc() — same engine as Pro-Forma tab

  // Use real proforma numbers when available (single source of truth)
  var displayGFA=rp?Math.round(rp.totalGFA):m.totalGFA;
  var displayFSI=rp?rp.fsi.toFixed(2):m.achievedFSI;
  var displayUnits=rp?rp.totalUnits:m.estUnits;
  var displayRevenue=rp?rp.totalGrossRev:0;
  var displayCost=rp?rp.totalCost:0;
  var displayProfit=rp?rp.margin:0;
  var displayROI=rp?rp.marginOnCost:0;
  var displayCommGFA=rp?Math.round(rp.commGFA):m.commercialGFA;
  var displayResiGFA=rp?Math.round(rp.resiGFA):m.residentialGFA;
  var displaySellable=rp?Math.round(rp.sellableResiSF):m.netResidential;
  var displayParking=rp?rp.parkSpaces:m.totalParking;

  var el=document.getElementById('optimal-massing-info');
  var overlay=document.getElementById('optimal-massing-overlay');
  var overlayContent=document.getElementById('optimal-massing-overlay-content');

  if(el) el.style.display='block';
  if(overlay) overlay.style.display='flex';

  function $f(n){return n<0?'-$'+Math.abs(Math.round(n)).toLocaleString():'$'+Math.round(n).toLocaleString()}
  function $m(n){return (n<0?'-':'')+'$'+(Math.abs(n)/1e6).toFixed(1)+'M'}

  var html=
    '<div style="font-size:12px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #333">'+
    '\u26A1 OPTIMAL MASSING — '+m.totalStoreys+' STOREYS</div>';

  // ── HOW THE OPTIMIZER DECIDED (transparency) ──
  var ctxL={downtown_core:'Downtown Core',major_transit:'Major Transit Corridor',avenue_transit:'Avenue + Transit',avenue:'Avenue',neighbourhood_edge:'Neighbourhood Edge'};
  html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a2a1a;border:1px solid #2a3a2a;border-radius:4px;font-size:11px;line-height:1.6">'+
    '<div style="color:#AEBC46;font-weight:700;margin-bottom:6px;font-size:13px;letter-spacing:0.5px">\uD83E\uDDE0 HOW THIS WAS DETERMINED</div>'+
    '<div style="color:#ddd">'+
      '<b style="color:#4ecdc4">1. Zoning:</b> '+za.zone+' \u2192 as-of-right FSI '+za.asOfRightFSI+'\u00D7, height '+za.asOfRightHeightM+'m<br>'+
      '<b style="color:#4ecdc4">2. Corridor:</b> '+(ctxL[za.corridorContext]||za.corridorContext)+' \u2192 ZBLA precedents support up to '+za.maxPrecedentStoreys+' storeys<br>'+
      '<b style="color:#4ecdc4">3. Target:</b> FSI '+(za.targetFSI||0).toFixed(1)+'\u00D7 based on '+Math.round((za.targetFSI||0)/za.asOfRightFSI)+'\u00D7 corridor multiplier<br>'+
      '<b style="color:#4ecdc4">4. Tower plate:</b> Capped at 750m\u00B2 (Tall Building Guidelines)<br>'+
      '<b style="color:#4ecdc4">5. Result:</b> '+m.podiumStoreys+'-storey podium + '+m.mainTowerStoreys+'-storey tower = <b style="color:#AEBC46">'+m.totalStoreys+' storeys</b>'+
    '</div>'+
  '</div>';

  // ── REAL PROFORMA SUMMARY (from pfCalc — matches Pro-Forma tab exactly) ──
  if(rp){
    var profitColor=displayProfit>0?'#AEBC46':'#e07b6a';
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a1a;border:1px solid #333;border-radius:4px;font-size:11px">'+
      '<div style="color:#AEBC46;font-weight:700;margin-bottom:8px;font-size:13px;letter-spacing:0.5px">\uD83D\uDCB0 PRO-FORMA SUMMARY <span style="color:#666;font-weight:400;font-size:12px">(matches Pro-Forma tab)</span></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">'+
        '<span style="color:#888">Total GFA</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayGFA.toLocaleString()+' sf</span>'+
        '<span style="color:#888">FSI</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayFSI+'\u00D7</span>'+
        '<span style="color:#888">Units</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayUnits+'</span>'+
        '<span style="color:#888">Commercial GFA</span><span style="text-align:right">'+displayCommGFA.toLocaleString()+' sf</span>'+
        '<span style="color:#888">Sellable Residential</span><span style="text-align:right">'+displaySellable.toLocaleString()+' sf</span>'+
        '<span style="color:#888">Parking</span><span style="text-align:right">'+displayParking+' spaces</span>'+
      '</div>'+
      '<div style="margin-top:8px;border-top:1px solid #333;padding-top:6px;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px">'+
        '<span style="color:#888">Revenue</span><span style="color:#8f8;font-weight:700;text-align:right">'+$m(displayRevenue)+'</span>'+
        '<span style="color:#888">Total Cost</span><span style="color:#e8c87a;text-align:right">'+$m(displayCost)+'</span>'+
        '<span style="color:#ddd;font-weight:700;font-size:12px">Developer Profit</span><span style="color:'+profitColor+';font-weight:700;text-align:right;font-size:12px">'+$m(displayProfit)+'</span>'+
        '<span style="color:#888">Profit Margin</span><span style="color:'+profitColor+';font-weight:700;text-align:right">'+Math.round(displayROI*100)+'%</span>'+
      '</div>'+
    '</div>';
  }

  // ── MIDRISE vs HIGHRISE COMPARISON (real pfCalc for both) ──
  var cmp=config.comparison;
  if(cmp&&cmp.midrise&&cmp.highrise){
    var mr=cmp.midrise,hr=cmp.highrise;
    var mrP=mr.proforma,hrP=hr.proforma; // Both are real pfCalc() results
    var mrHardPSF=mrP.totalGFA>0?Math.round(mrP.totalHard/mrP.totalGFA):0;
    var hrHardPSF=hrP.totalGFA>0?Math.round(hrP.totalHard/hrP.totalGFA):0;
    var winColor=cmp.winner==='highrise'?'#AEBC46':'#4ecdc4';
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a1a;border:1px solid #333;border-radius:4px;font-size:11px">'+
      '<div style="color:#AEBC46;font-weight:700;margin-bottom:6px;font-size:13px;letter-spacing:0.5px">\u2696 MIDRISE vs HIGHRISE <span style="color:#666;font-weight:400;font-size:12px">(same pfCalc engine as Pro-Forma tab)</span></div>'+
      '<table style="width:100%;border-collapse:collapse;font-size:11px">'+
        '<tr style="color:#888;border-bottom:1px solid #333">'+
          '<th style="text-align:left;padding:3px 0;font-weight:400"></th>'+
          '<th style="text-align:right;padding:3px 6px;font-weight:700;color:'+(cmp.rendered==='midrise'?'#AEBC46':'#888')+'">MIDRISE'+(cmp.rendered==='midrise'?' \u2713':'')+'</th>'+
          '<th style="text-align:right;padding:3px 0;font-weight:700;color:'+(cmp.rendered==='highrise'?'#AEBC46':'#888')+'">HIGHRISE'+(cmp.rendered==='highrise'?' \u2713':'')+'</th>'+
        '</tr>'+
        '<tr><td style="color:#888;padding:3px 0">Storeys</td>'+
          '<td style="text-align:right;padding:3px 6px">'+mr.meta.totalStoreys+'</td>'+
          '<td style="text-align:right">'+hr.meta.totalStoreys+'</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">GFA</td>'+
          '<td style="text-align:right;padding:3px 6px">'+Math.round(mrP.totalGFA).toLocaleString()+' sf</td>'+
          '<td style="text-align:right">'+Math.round(hrP.totalGFA).toLocaleString()+' sf</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">Units</td>'+
          '<td style="text-align:right;padding:3px 6px">'+mrP.totalUnits+'</td>'+
          '<td style="text-align:right">'+hrP.totalUnits+'</td></tr>'+
        '<tr style="border-top:1px solid #333"><td style="color:#888;padding:3px 0">Build $/sf</td>'+
          '<td style="text-align:right;padding:3px 6px">$'+mrHardPSF+'</td>'+
          '<td style="text-align:right">$'+hrHardPSF+'</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">Revenue</td>'+
          '<td style="text-align:right;padding:3px 6px">'+$m(mrP.totalGrossRev)+'</td>'+
          '<td style="text-align:right">'+$m(hrP.totalGrossRev)+'</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">Total Cost</td>'+
          '<td style="text-align:right;padding:3px 6px">'+$m(mrP.totalCost)+'</td>'+
          '<td style="text-align:right">'+$m(hrP.totalCost)+'</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">Profit</td>'+
          '<td style="text-align:right;padding:3px 6px;font-weight:700;color:'+(mrP.margin>0?'#8f8':'#e07b6a')+'">'+$m(mrP.margin)+'</td>'+
          '<td style="text-align:right;font-weight:700;color:'+(hrP.margin>0?'#8f8':'#e07b6a')+'">'+$m(hrP.margin)+'</td></tr>'+
        '<tr><td style="color:#888;padding:3px 0">ROI</td>'+
          '<td style="text-align:right;padding:3px 6px;font-weight:700;color:'+(mrP.marginOnCost>=0.15?'#8f8':'#e07b6a')+'">'+Math.round(mrP.marginOnCost*100)+'%</td>'+
          '<td style="text-align:right;font-weight:700;color:'+(hrP.marginOnCost>=0.15?'#8f8':'#e07b6a')+'">'+Math.round(hrP.marginOnCost*100)+'%</td></tr>'+
      '</table>'+
      '<div style="margin-top:6px;padding:4px 8px;background:'+(cmp.rendered==='highrise'?'#1a2a1a':'#1a2a2a')+';border-radius:3px;font-size:13px;color:'+winColor+';font-weight:700;text-align:center">'+
        '\u2713 Rendering '+cmp.rendered.toUpperCase()+' (your selected asset class)'+
      '</div>'+
    '</div>';
  }

  // ── ZONING + APPROVAL ──
  if(za){
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a2a;border:1px solid #2a2a3a;border-radius:4px;font-size:11px">'+
      '<div style="color:#4ecdc4;font-weight:700;margin-bottom:6px;font-size:13px;letter-spacing:0.5px">\uD83D\uDCCB ZONING</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px">'+
        '<span style="color:#888">Zone</span><span style="color:#4ecdc4;font-weight:700;text-align:right">'+za.zone+'</span>'+
        '<span style="color:#888">As-of-Right FSI</span><span style="text-align:right">'+za.asOfRightFSI+'\u00D7</span>'+
        '<span style="color:#888">Height Limit</span><span style="text-align:right">'+za.asOfRightHeightM+'m</span>'+
        '<span style="color:#888">Setbacks (ft)</span><span style="text-align:right">F:'+za.derivedSetbacks.front+' S:'+za.derivedSetbacks.sideE+'/'+za.derivedSetbacks.sideW+' R:'+za.derivedSetbacks.rear+'</span>'+
      '</div>'+
      (za.hasException?'<div style="margin-top:4px;color:#e8c87a;font-size:13px">\u26A0 Exception #'+za.exceptionNo+' applies</div>':'')+
    '</div>';
  }

  // Approval pathway
  var riskColor=m.approvalRisk==='red'?'#e07b6a':(m.approvalRisk==='yellow'?'#e8c87a':'#AEBC46');
  var riskBg=m.approvalRisk==='red'?'#2a1a1a':(m.approvalRisk==='yellow'?'#2a2a1a':'#1a2a1a');
  html+='<div style="margin-bottom:10px;padding:8px 10px;background:'+riskBg+';border:1px solid #333;border-radius:4px;font-size:11px">'+
      '<div style="color:'+riskColor+';font-weight:700;margin-bottom:4px;font-size:13px">\uD83D\uDCCA APPROVAL PATHWAY</div>'+
      '<div style="color:#ddd;font-size:11px">'+m.approvalPath+'</div>'+
      (m.approvalNotes?'<div style="color:#999;font-size:13px;margin-top:4px">'+m.approvalNotes+'</div>':'')+
    '</div>';

  // Approval issues
  if(m.approvalIssues&&m.approvalIssues.length>0){
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#2a1a1a;border:1px solid #3a2a2a;border-radius:4px;font-size:11px">'+
        '<div style="color:#e8c87a;font-weight:700;margin-bottom:4px;font-size:13px">\u26A0 GUIDELINE ISSUES ('+m.approvalIssues.length+')</div>';
    m.approvalIssues.forEach(function(issue){
      html+='<div style="color:#aaa;font-size:13px;margin-top:3px">\u2022 '+issue+'</div>';
    });
    html+='</div>';
  }

  // ── PLANNING APPLICATIONS (from zoning-navigator) ──
  var pc=config.planningCosts;
  if(pc){
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a2a;border:1px solid #2a2a3a;border-radius:4px;font-size:11px">'+
      '<div style="color:#4ecdc4;font-weight:700;margin-bottom:6px;font-size:13px;letter-spacing:0.5px">\uD83D\uDCCB REQUIRED APPLICATIONS (Planning Act)</div>';
    pc.applications.forEach(function(app){
      html+='<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px">'+
        '<span style="color:#ddd">'+app.type+' <span style="color:#666">('+app.section+')</span></span>'+
        '<span style="color:#e8c87a;font-weight:700">'+$f(app.fee)+'</span></div>';
    });
    html+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #333;margin-top:4px;font-size:11px">'+
      '<span style="color:#888">Application Fees</span>'+
      '<span style="color:#e8c87a;font-weight:700">'+$f(pc.appFees)+'</span></div>';
    html+='</div>';

    // Required studies
    html+='<div style="margin-bottom:10px;padding:8px 10px;background:#1a1a2a;border:1px solid #2a2a3a;border-radius:4px;font-size:11px">'+
      '<div style="color:#4ecdc4;font-weight:700;margin-bottom:6px;font-size:13px;letter-spacing:0.5px">\uD83D\uDCD1 REQUIRED STUDIES ('+pc.studies.length+')</div>';
    pc.studies.forEach(function(s){
      html+='<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px">'+
        '<span style="color:#aaa">'+s.name+'</span>'+
        '<span style="color:#ddd">'+$f(s.cost)+'</span></div>';
    });
    html+='<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #333;margin-top:4px;font-size:11px">'+
      '<span style="color:#888">Studies Total</span>'+
      '<span style="color:#e8c87a;font-weight:700">'+$f(pc.studyCosts)+'</span></div>'+
      '<div style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid #555;margin-top:3px;font-size:12px">'+
      '<span style="color:#ddd;font-weight:700">Total Planning Cost</span>'+
      '<span style="color:#AEBC46;font-weight:700">'+$f(pc.totalPlanningCost)+'</span></div>';

    html+='<div style="margin-top:6px;padding:4px 8px;background:#1a2a2a;border-radius:3px;font-size:13px;color:#4ecdc4;text-align:center">'+
      'Est. approval timeline: <b>'+pc.timeline.min+'\u2013'+pc.timeline.max+' months</b></div>';
    html+='</div>';
  }

  // Tower separation warnings
  if(m.towerSepWarnings&&m.towerSepWarnings.length>0){
    m.towerSepWarnings.forEach(function(w){
      html+='<div style="margin-top:4px;padding:4px 8px;background:#2a1a1a;border:1px solid #3a2a2a;border-radius:4px;font-size:13px;color:#e07b6a">\u26A0 '+w+'</div>';
    });
  }

  if(overlayContent) overlayContent.innerHTML=html;

  if(el){
    var profitColor=displayProfit>0?'#AEBC46':'#e07b6a';
    var compact=
      '<div style="font-size:13px;font-weight:700;color:#AEBC46;letter-spacing:1px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #333">'+
      '\u26A1 OPTIMAL MASSING GENERATED</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:13px;margin-bottom:8px">'+
        '<span style="color:#888">Storeys</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+m.totalStoreys+'</span>'+
        '<span style="color:#888">GFA</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayGFA.toLocaleString()+' sf</span>'+
        '<span style="color:#888">FSI</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayFSI+'\u00D7</span>'+
        '<span style="color:#888">Units</span><span style="color:#AEBC46;font-weight:700;text-align:right">'+displayUnits+'</span>'+
        '<span style="color:#888">Profit</span><span style="font-weight:700;text-align:right;color:'+profitColor+'">'+$m(displayProfit)+'</span>'+
        '<span style="color:#888">ROI</span><span style="font-weight:700;text-align:right;color:'+profitColor+'">'+Math.round(displayROI*100)+'%</span>'+
      '</div>'+
      '<button onclick="var o=document.getElementById(\'optimal-massing-overlay\');if(o)o.style.display=\'flex\';if(typeof switchTab===\'function\')switchTab(\'massing\')" '+
        'style="width:100%;background:linear-gradient(135deg,#AEBC46,#8a9a30);color:#111;font-size:11px;padding:8px;font-weight:700;letter-spacing:0.5px;border:none;border-radius:4px;cursor:pointer">'+
        '\uD83D\uDCCA VIEW FULL ANALYSIS ON 3D CANVAS</button>';
    el.innerHTML=compact;
  }
}
