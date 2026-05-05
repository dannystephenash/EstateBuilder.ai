// lot-normalize.js — lot/volume coordinate-system alignment helpers
// =============================================================================
// Two functions:
//   normalizeLotPolygon()   — re-bases lot polygon so northernmost vertex = (0,0)
//   realignBuildingToLot()  — re-derives every volume's customPolyLocal from
//                             its customPoly (lat/lng) using current _gpsOrigin.
//                             Use when a saved building appears offset on the
//                             3D scene relative to the satellite ground texture.
//                             Callable from DevTools console.
//
// CRITICAL: `P` is declared with `const` in data-model.js so `window.P` is
// undefined. `smVolumes` is `let` in sitemap-lot.js — also not on `window`.
// Both must be resolved via bare-identifier reference (with typeof guard to
// avoid ReferenceError if loading order is wrong). Earlier versions of this
// file used `window.P` and `window.smVolumes` — both checks always failed,
// which made BOTH functions silently no-op. This was the recurring root cause
// of the "building renders north of the lot" bug.
// =============================================================================

function _ln_getP(){
  try { if(typeof P !== 'undefined' && P) return P; } catch(e){}
  return null;
}
function _ln_getSmVolumes(){
  try { if(typeof smVolumes !== 'undefined' && Array.isArray(smVolumes)) return smVolumes; } catch(e){}
  return null;
}

function normalizeLotPolygon(){
  var p = _ln_getP();
  if(!p || !p.lot || !Array.isArray(p.lot.polyVerts) || p.lot.polyVerts.length < 3) return false;
  var v = p.lot.polyVerts;
  var gv = (p.lot.gpsVerts && p.lot.gpsVerts.length === v.length) ? p.lot.gpsVerts : null;
  // Northernmost vertex = smallest Z (Z+ = South in this project).
  var minZ = Infinity, iN = 0;
  for(var i = 0; i < v.length; i++){ if(v[i][1] < minZ){ minZ = v[i][1]; iN = i; } }
  var dx = v[iN][0], dz = v[iN][1];
  if(Math.abs(dx) < 0.5 && Math.abs(dz) < 0.5) return false;

  // CRITICAL: Before shifting anything, deep-copy any volume's customPolyLocal
  // that shares inner-array refs with the lot's polyVerts. Without this,
  // mutating lot vertices in-place would also mutate the volume's polygon
  // (shared refs), and then the explicit volume-shift below would shift those
  // SAME inner arrays AGAIN — drifting the building northwest each rebuild.
  function _independize(arr){
    if(!Array.isArray(arr)) return arr;
    return arr.map(function(pt){ return [pt[0], pt[1]]; });
  }
  if(Array.isArray(p.vols)){
    p.vols.forEach(function(vv){
      if(Array.isArray(vv.customPolyLocal)) vv.customPolyLocal = _independize(vv.customPolyLocal);
    });
  }
  var sv = _ln_getSmVolumes();
  if(sv){
    sv.forEach(function(vv){
      if(Array.isArray(vv.customPolyLocal)) vv.customPolyLocal = _independize(vv.customPolyLocal);
    });
  }

  for(var j = 0; j < v.length; j++){ v[j][0] -= dx; v[j][1] -= dz; }
  if(gv && gv[iN]){
    var nLng = gv[iN][0], nLat = gv[iN][1];
    p._gpsOrigin = {lng: nLng, lat: nLat};
    p.lot.gpsOrigin = {lng: nLng, lat: nLat};
  }
  function _shift(arr){ if(Array.isArray(arr)) arr.forEach(function(pt){ pt[0] -= dx; pt[1] -= dz; }); }
  if(Array.isArray(p.vols)) p.vols.forEach(function(vv){ _shift(vv.customPolyLocal); });
  if(sv) sv.forEach(function(vv){ _shift(vv.customPolyLocal); });
  console.log('[normalizeLotPolygon] shifted (' + dx.toFixed(1) + ', ' + dz.toFixed(1) + ') ft, origin idx ' + iN + ' -> ' + (p._gpsOrigin ? p._gpsOrigin.lat.toFixed(6) + ',' + p._gpsOrigin.lng.toFixed(6) : '?'));
  return true;
}

function realignBuildingToLot(){
  var p = _ln_getP();
  if(!p || !p._gpsOrigin || typeof turf === 'undefined'){
    console.warn('[realign] need P._gpsOrigin and turf.js');
    return false;
  }
  var oLng = p._gpsOrigin.lng, oLat = p._gpsOrigin.lat;
  function _gpsToFt(lng, lat){
    var xM = turf.distance(turf.point([oLng, oLat]), turf.point([lng, oLat]), {units:'meters'});
    var xFt = xM * 3.28084 * (lng > oLng ? 1 : -1);
    var zM = turf.distance(turf.point([oLng, oLat]), turf.point([oLng, lat]), {units:'meters'});
    var zFt = zM * 3.28084 * (lat < oLat ? 1 : -1);
    return [xFt, zFt];
  }
  var rebuilt = 0;
  function _rebuildVol(v){
    if(!v || !Array.isArray(v.customPoly) || v.customPoly.length < 3) return;
    v.customPolyLocal = v.customPoly.map(function(pt){ return _gpsToFt(pt[0], pt[1]); });
    rebuilt++;
  }
  if(Array.isArray(p.vols)) p.vols.forEach(_rebuildVol);
  var sv = _ln_getSmVolumes();
  if(sv) sv.forEach(_rebuildVol);
  if(p.lot && Array.isArray(p.lot.gpsVerts) && p.lot.gpsVerts.length >= 3){
    p.lot.polyVerts = p.lot.gpsVerts.map(function(pt){ return _gpsToFt(pt[0], pt[1]); });
  }
  console.log('[realign] rebuilt customPolyLocal for ' + rebuilt + ' volume(s) using origin lat=' + oLat.toFixed(6) + ' lng=' + oLng.toFixed(6));
  if(typeof rebuildAll === 'function'){
    try { rebuildAll(); } catch(e){ console.warn('[realign] rebuildAll failed:', e); }
  }
  return true;
}

window.normalizeLotPolygon = normalizeLotPolygon;
window.realignBuildingToLot = realignBuildingToLot;
