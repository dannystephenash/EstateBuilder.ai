// save-load.js — localStorage persistence, import/export, project management
// ═══════════════════════════════════════════════════════════
//  SAVE / LOAD / EXPORT / IMPORT
// ═══════════════════════════════════════════════════════════
const STORAGE_KEY = 'oleadev-massing-projects';
const AUTOSAVE_KEY = 'oleadev-massing-autosave';
// Rolling backup: previous N autosaves, newest first. Protects against a corrupt
// primary autosave (quota overflow mid-write, manual tampering, bad JSON, etc.)
// and gives the user a way to recover recent work if the latest state is bad.
const AUTOSAVE_HISTORY_KEY = 'oleadev-massing-autosave-history';
const AUTOSAVE_HISTORY_MAX = 25;

function getProjects(){
  try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch(e){ return {}; }
}
function setProjects(obj){ localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); }

/** Deep-clones the entire P object into a plain serializable state for saving/export.
 *  Every nested object/array is deep-cloned via JSON round-trip so there's no risk
 *  of live references leaking into the saved state — critical for customPolyLocal
 *  (the building polygon coordinates) which is an array of arrays. Without deep
 *  clone, a shallow copy of a volume would share its polygon array with the live
 *  P.vols, and any later edit would retroactively mutate the "saved" data.
 */
function getState(){
  if(!P.comparables) P.comparables=[];
  const deep = obj => (obj == null ? obj : JSON.parse(JSON.stringify(obj)));
  // Sanitize polygons: strip consecutive duplicate vertices that the site-map
  // tool / GPS import / parcel picker can produce. Without this, a degenerate
  // [0,0]→[0,0] edge in the lot polygon propagates into every volume that uses
  // customPolyLocal (Optimal Massing in particular) and breaks the 3D renderer
  // (missing curtain wall panels, broken balconies). Cleaning at save time
  // means existing corrupt projects self-heal on the next autosave.
  const cleanState = {
    projectName:P.projectName,
    projectType:P.projectType||'midrise',
    lot:deep(P.lot),
    set:deep(P.set),
    flr:deep(P.flr),
    vols:deep(P.vols),              // was P.vols.map(v=>({...v})) — shallow copy risk
    pf:deep(P.pf),
    core:deep(P.core),
    roads:deep(P.roads),
    landscape:deep(P.landscape),
    unitPlan:deep(P.unitPlan),
    comparables:deep(P.comparables),
    siteCoords:deep(P.siteCoords),
    siteAddress:P.siteAddress||'',
    gpsOrigin:P._gpsOrigin ? {lng:P._gpsOrigin.lng, lat:P._gpsOrigin.lat} : null,
    zoning:deep(P.zoning),
    smVolumesGPS:deep(P.smVolumesGPS),
    // ── Industrial-specific persistence ─────────────────────────────────
    // Without these, refreshing the page after generating an industrial
    // building would lose the asset-class label, surface zones (parking,
    // truck court, dock doors, driveway, landscape), the longest-edge
    // rotation, and the detected front-street edge — forcing the user
    // to clear the parcel and regenerate from scratch every refresh.
    assetClass:P.assetClass||null,
    industrialSurfaces:deep(P.industrialSurfaces),
    industrialRotation:deep(P._industrialRotation),
    frontStreetEdge:(typeof P._frontStreetEdge === 'number') ? P._frontStreetEdge : null
  };
  // De-dupe the lot polygon and every volume's customPolyLocal
  if(typeof _dedupePolyVerts === 'function'){
    if(cleanState.lot && Array.isArray(cleanState.lot.polyVerts) && cleanState.lot.polyVerts.length >= 3){
      cleanState.lot.polyVerts = _dedupePolyVerts(cleanState.lot.polyVerts);
    }
    if(Array.isArray(cleanState.vols)){
      cleanState.vols.forEach(v => {
        if(v && Array.isArray(v.customPolyLocal) && v.customPolyLocal.length >= 3){
          v.customPolyLocal = _dedupePolyVerts(v.customPolyLocal);
        }
      });
    }
  }
  return cleanState;
}

/**
 * Merges a saved state object into the live P object, with migration for legacy formats.
 * @param {Object} state - Saved project state (from getState() or imported JSON)
 */
function applyState(state){
  // Sanitize incoming polygons FIRST — strips consecutive duplicate vertices.
  // Same defensive pass as getState() does on save. Required for older saved
  // projects that were stored before the de-dupe was added (their bad lot
  // polygon would otherwise still produce broken renderings).
  if(typeof _dedupePolyVerts === 'function'){
    if(state.lot && Array.isArray(state.lot.polyVerts) && state.lot.polyVerts.length >= 3){
      state.lot.polyVerts = _dedupePolyVerts(state.lot.polyVerts);
    }
    if(Array.isArray(state.vols)){
      state.vols.forEach(v => {
        if(v && Array.isArray(v.customPolyLocal) && v.customPolyLocal.length >= 3){
          v.customPolyLocal = _dedupePolyVerts(v.customPolyLocal);
        }
      });
    }
  }
  // Merge lot/set/flr — keeps defaults for any missing keys
  if(state.lot) Object.keys(state.lot).forEach(k=>{ if(state.lot[k]!==undefined) P.lot[k]=state.lot[k]; });
  if(state.set) Object.keys(state.set).forEach(k=>{ if(state.set[k]!==undefined) P.set[k]=state.set[k]; });
  if(state.flr) Object.keys(state.flr).forEach(k=>{ if(state.flr[k]!==undefined) P.flr[k]=state.flr[k]; });
  // Clamp floor heights to valid residential ranges (prevent div-by-zero and nonsense)
  if(P.flr.gf>25||P.flr.gf<8) P.flr.gf=15;
  if(P.flr.typ>15||P.flr.typ<7) P.flr.typ=10;
  // Volumes — ensure every volume has all expected keys with defaults
  if(state.vols) P.vols = state.vols.map(v=>{
    const def={storeys:4,startEg:0,depth:50,width:65,offEast:0,offWest:0,angle:0,
      podiumStoreys:0,stepbackAmt:5,gfHeight:0,commGF:0,color:'#88aabb',name:'A',
      windows:1,winSpacing:3,balconies:1,balcEvery:2,balcDepth:4,
      cladding:'brick',storefrontN:0,storefrontS:0,storefrontE:0,storefrontW:0,
      balcN:1,balcS:1,balcE:0,balcW:0};
    return {...def,...v};
  });
  // Pro-forma — deep merge keeping defaults for missing keys
  if(state.pf){
    const saved=JSON.parse(JSON.stringify(state.pf));
    // ── One-time migration: correct legacy parking defaults from old code ──
    // Old defaults were parkRatio:0.7 and parkPrice:100000 (or 85000 for high-rise).
    // Correct values: parkRatio:0.3, parkPrice:60000.
    // We only migrate ONCE per project. After migration we set saved._parkMigrated=true
    // so users who manually set parkRatio=0.7 won't have their value overwritten on every load.
    if(!saved._parkMigrated){
      if(saved.parkRatio >= 0.65 && saved.parkRatio <= 0.75) saved.parkRatio = 0.30;
      if(saved.parkPrice >= 95000 && saved.parkPrice <= 105000) saved.parkPrice = 60000;
      if(saved.parkPrice >= 80000 && saved.parkPrice <= 90000) saved.parkPrice = 60000;
      saved._parkMigrated = true;
    }
    Object.keys(saved).forEach(k=>{ P.pf[k]=saved[k]; });
  }
  // Core positions — migrate old stair1X/stair2X/stair3X format to stairs array
  if(state.core){
    // Migrate old flat keys to new stairs array format
    if(!state.core.stairs && state.core.stair1X!==undefined){
      state.core.stairs=[
        {x:state.core.stair1X, z:state.core.stair1Z, angle:state.core.stair1Angle||0, label:'NW'},
        {x:state.core.stair2X, z:state.core.stair2Z, angle:state.core.stair2Angle||0, label:'SE'},
        {x:state.core.stair3X, z:state.core.stair3Z, angle:state.core.stair3Angle||0, label:'SW'}
      ];
      delete state.core.stair1X;delete state.core.stair1Z;delete state.core.stair1Angle;
      delete state.core.stair2X;delete state.core.stair2Z;delete state.core.stair2Angle;
      delete state.core.stair3X;delete state.core.stair3Z;delete state.core.stair3Angle;
    }
    if(state.core.numElevators===undefined) state.core.numElevators=0;
    // Migration: reset old default cores to 0 — user must explicitly add elevators/stairs
    if(!state.core._coreUserSet){
      state.core.numElevators=0;
      state.core.stairs=[];
      state.core.elevX=0;
      state.core.elevZ=0;
      state.core._coreUserSet=true;
    }
    if(state.core.stairs) P.core.stairs=state.core.stairs.map(s=>({x:s.x||0,z:s.z||0,angle:s.angle||0,label:s.label||''}));
    P.core.elevX=state.core.elevX??P.core.elevX;
    P.core.elevZ=state.core.elevZ??P.core.elevZ;
    P.core.elevDir=state.core.elevDir??P.core.elevDir;
    P.core.elevAngle=state.core.elevAngle??P.core.elevAngle;
    P.core.numElevators=state.core.numElevators??P.core.numElevators;
  }
  // Roads — migrate old object format to array
  if(state.roads){
    if(Array.isArray(state.roads)) P.roads=state.roads;
    else {
      // Old format: {egOffZ,egAngle,egWidth,egLabel,lkOffZ,lkAngle,lkWidth,lkLabel}
      P.roads=[
        {label:state.roads.egLabel||'STREET A (NORTH)',offZ:state.roads.egOffZ||0,angle:state.roads.egAngle||0,width:state.roads.egWidth||66,fontSize:14,side:'north'},
        {label:state.roads.lkLabel||'STREET B (SOUTH)',offZ:state.roads.lkOffZ||0,angle:state.roads.lkAngle||0,width:state.roads.lkWidth||50,fontSize:14,side:'south'}
      ]; // preserved from old save format
    }
  }
  // Landscape
  if(state.landscape && Array.isArray(state.landscape)) P.landscape=state.landscape;
  // Unit plan
  if(state.unitPlan){
    P.unitPlan=state.unitPlan;
    if(!P.unitPlan.unitTypes) P.unitPlan.unitTypes=[
      {type:'Studio',defaultSize:425,color:'#e8c87a'},{type:'1-Bedroom',defaultSize:550,color:'#c49ade'},
      {type:'1-Bed+Den',defaultSize:650,color:'#88bbdd'},{type:'2-Bedroom',defaultSize:750,color:'#8db4e8'},
      {type:'2-Bed+Den',defaultSize:875,color:'#a0d4a0'},{type:'3-Bedroom',defaultSize:1050,color:'#e8a08d'}
    ];
    if(!P.unitPlan.floors) P.unitPlan.floors=[];
    if(!P.unitPlan.mode) P.unitPlan.mode='auto';
  }
  // Project type
  if(state.projectType) P.projectType=state.projectType;
  // Asset class — used by industrial rendering pipeline. Mirrors projectType.
  // Restore from saved state OR fall back to projectType so older saves still work.
  if(state.assetClass) P.assetClass=state.assetClass;
  else if(P.projectType==='industrial') P.assetClass='industrial';
  const ptSel=document.getElementById('project-type-select');
  if(ptSel){
    // The dropdown's value is the source of truth for "current class". When we
    // restore a saved industrial project the dropdown was previously set to
    // 'midrise' by the renderer's default — push the saved value back.
    var pv = P.assetClass || P.projectType || 'midrise';
    ptSel.value = pv;
    // Keep both fields in lockstep
    P.projectType = pv;
    if(pv === 'industrial') P.assetClass = 'industrial';
  }
  // ── Industrial site-plan persistence ───────────────────────────────────
  // Surface zones (parking, truck court, dock doors, driveway, landscape),
  // building rotation pivot/angle, and detected front-street edge. Without
  // these the user has to clear the parcel and regenerate every refresh.
  if(Array.isArray(state.industrialSurfaces)) P.industrialSurfaces = state.industrialSurfaces;
  if(state.industrialRotation && typeof state.industrialRotation === 'object'){
    P._industrialRotation = state.industrialRotation;
  }
  if(typeof state.frontStreetEdge === 'number') P._frontStreetEdge = state.frontStreetEdge;
  // Project name
  if(state.projectName) P.projectName=state.projectName;
  if(state.comparables) P.comparables=state.comparables;
  if(state.siteCoords) P.siteCoords=state.siteCoords;
  if(state.siteAddress) P.siteAddress=state.siteAddress;
  // Restore GPS origin for satellite ground texture & context buildings
  if(state.gpsOrigin) P._gpsOrigin=state.gpsOrigin;
  // Fallback: derive GPS origin from saved lot GPS vertices (northernmost vertex)
  if(!P._gpsOrigin && P.lot && P.lot.gpsVerts && P.lot.gpsVerts.length >= 3){
    var _verts = P.lot.gpsVerts;
    var _northIdx = 0;
    for(var _i=1;_i<_verts.length;_i++){ if(_verts[_i][1]>_verts[_northIdx][1]) _northIdx=_i; }
    P._gpsOrigin = {lng: _verts[_northIdx][0], lat: _verts[_northIdx][1]};
  }
  if(state.zoning) P.zoning=state.zoning;
  if(state.smVolumesGPS) P.smVolumesGPS=state.smVolumesGPS;

  /* Auto-normalise the lot polygon so the project convention "origin =
     northernmost vertex, all polyVerts.z >= 0" is enforced for any project
     loaded from save data. Older saves and parcel-picker outputs sometimes
     violate this convention, which causes downstream alignment issues
     (context buildings, infra rendering) for irregular lots. The function
     also shifts every volume's customPolyLocal by the same delta so the
     building stays anchored to the same lat/lng. */
  if(typeof normalizeLotPolygon === 'function'){
    try { normalizeLotPolygon(); }
    catch(e){ console.warn('[save-load] normalizeLotPolygon failed:', e); }
  }

  const titleEl=document.getElementById('project-title');
  if(titleEl){
    titleEl.textContent=P.projectName||'Untitled Project';
    document.title='OleaDev — '+(P.projectName||'Untitled Project');
  }
}

/** Auto-saves current P state to localStorage. Throttled + debounced for performance.
 *  Called on every user change (input, slider drag, click). Without throttling, dragging
 *  a slider would serialize the entire P object 60-100 times per second, causing UI jank
 *  and excessive localStorage writes.
 *
 *  Strategy: collapse rapid calls into one save 400ms after the LAST call (debounce).
 *  If autoSave is called continuously for >2 seconds, force a save at the 2-second mark
 *  so we still capture work-in-progress state.
 */
var _autoSaveTimer = null;
var _autoSaveLastFlush = 0;
var _autoSaveQuotaWarned = false;
function _pushAutoSaveHistory(serialized){
  // Roll the previous primary autosave into the history ring. History is
  // capped at AUTOSAVE_HISTORY_MAX entries, newest first.
  try{
    const prev = localStorage.getItem(AUTOSAVE_KEY);
    if(!prev) return;
    // Don't duplicate history entries if nothing has changed
    let history = [];
    try { history = JSON.parse(localStorage.getItem(AUTOSAVE_HISTORY_KEY) || '[]') || []; } catch(e){ history = []; }
    if(history.length > 0 && history[0].json === prev) return;       // no change
    if(serialized && serialized === prev) return;                     // no change (early exit)
    history.unshift({ json: prev, savedAt: Date.now() });
    if(history.length > AUTOSAVE_HISTORY_MAX) history = history.slice(0, AUTOSAVE_HISTORY_MAX);
    localStorage.setItem(AUTOSAVE_HISTORY_KEY, JSON.stringify(history));
  } catch(e){
    // Quota may be exceeded for the history ring — fail silently, primary
    // save still works (this is just the safety-net backup).
  }
}

function _autoSaveNow(){
  _autoSaveTimer = null;
  // Honour Clear Lot's kill switch — once the user clicks Clear Lot we do
  // NOT want any autosave to fire (debounced timer, beforeunload flush, etc.)
  // and re-write the data we just deleted.
  if(typeof window !== 'undefined' && window.__suppressAutoSave) return;
  _autoSaveLastFlush = Date.now();
  try{
    const serialized = JSON.stringify(getState());
    // Push the previous primary into history BEFORE overwriting it, so the
    // user always has N recent saves to roll back to if the newest corrupts.
    _pushAutoSaveHistory(serialized);
    localStorage.setItem(AUTOSAVE_KEY, serialized);
    _autoSaveQuotaWarned = false;
    try { _updateUndoBtnState(); } catch(e){}
  } catch(e){
    // localStorage quota exceeded or storage disabled — warn user once
    if(!_autoSaveQuotaWarned){
      _autoSaveQuotaWarned = true;
      console.warn('[autoSave] Storage failed:', e && e.message);
      try {
        var statusEl = document.getElementById('save-status');
        if(statusEl){
          statusEl.textContent = '⚠ Auto-save failed — localStorage may be full. Use SAVE PROJECT to export.';
          statusEl.style.color = '#e8c87a';
          statusEl.style.opacity = '1';
        }
      } catch(uiErr){}
    }
  }
}
function autoSave(){
  // Skip entirely if Clear Lot has set the kill switch
  if(typeof window !== 'undefined' && window.__suppressAutoSave) return;
  // If 2+ seconds have passed since last actual save, force a save NOW for safety
  if(Date.now() - _autoSaveLastFlush > 2000 && !_autoSaveTimer){
    _autoSaveNow();
    return;
  }
  // Debounce: cancel pending save and schedule a new one in 400ms
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(_autoSaveNow, 400);
}
// Make sure pending save flushes when the user closes the tab
try {
  window.addEventListener('beforeunload', function(){
    if(_autoSaveTimer){ clearTimeout(_autoSaveTimer); _autoSaveNow(); }
  });
} catch(e) {}

/**
 * Loads last auto-saved state from localStorage on startup. Restores P and UI.
 * Tries the primary autosave first; if it's missing/corrupt, walks the rolling
 * backup history (newest first) and restores from the first one that parses.
 * Sets window._autoLoadResult for the caller (sitemap-core.js) to display a
 * toast so the user knows their work was restored (and from which source).
 * @returns {boolean} True if a saved state was found and applied
 */
function autoLoad(){
  // Try primary first
  try{
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if(raw){
      const state = JSON.parse(raw);
      applyState(state);
      window._autoLoadResult = { source: 'primary', savedAt: null };
      return true;
    }
  }catch(e){
    console.warn('[autoLoad] Primary autosave unreadable:', e && e.message);
  }
  // Primary missing or corrupt — try rolling backup history
  try{
    const histRaw = localStorage.getItem(AUTOSAVE_HISTORY_KEY);
    if(histRaw){
      const history = JSON.parse(histRaw) || [];
      for(let i = 0; i < history.length; i++){
        const entry = history[i];
        if(!entry || !entry.json) continue;
        try{
          const state = JSON.parse(entry.json);
          applyState(state);
          window._autoLoadResult = { source: 'backup', savedAt: entry.savedAt, index: i };
          console.warn('[autoLoad] Recovered from backup #'+(i+1)+' saved at '+new Date(entry.savedAt).toLocaleString());
          return true;
        } catch(parseErr){
          // This history entry is corrupt too, try the next one
        }
      }
    }
  } catch(e){}
  window._autoLoadResult = { source: 'none' };
  return false;
}

/**
 * User-facing: list available autosave backups for recovery. Each entry shows
 * the timestamp. Used by a future recovery UI / manual rollback.
 * @returns {Array<{index:number, savedAt:number, label:string}>}
 */
function listAutoSaveBackups(){
  try{
    const histRaw = localStorage.getItem(AUTOSAVE_HISTORY_KEY);
    const history = histRaw ? JSON.parse(histRaw) : [];
    return history.map((e, i) => ({
      index: i,
      savedAt: e.savedAt,
      label: new Date(e.savedAt).toLocaleString()
    }));
  } catch(e){ return []; }
}

/**
 * Undo the last change. Pops the most recent entry from the autosave history,
 * writes it as the new primary autosave, and reloads the page so autoLoad
 * picks up the restored state. The reload guarantees a clean redraw of the
 * 3D scene, sitemap markers, panels, and pro-forma — all in sync. Up to
 * AUTOSAVE_HISTORY_MAX undo steps available (one per autosave checkpoint).
 */
function siteUndo(){
  let history = [];
  try { history = JSON.parse(localStorage.getItem(AUTOSAVE_HISTORY_KEY) || '[]') || []; } catch(e){}
  if(history.length === 0){
    showSaveStatus('Nothing to undo', '#888');
    var btn = document.getElementById('btn-site-undo');
    if(btn){ btn.style.opacity = '0.4'; btn.style.pointerEvents = 'none'; }
    return;
  }
  // Pop the most recent backup (newest first).
  const entry = history.shift();
  if(!entry || !entry.json){ showSaveStatus('Nothing to undo', '#888'); return; }
  // Suppress autosave during reload so an in-flight beforeunload save can't
  // overwrite the restored state with the current (about-to-be-undone) state.
  if(typeof window !== 'undefined') window.__suppressAutoSave = true;
  try {
    localStorage.setItem(AUTOSAVE_HISTORY_KEY, JSON.stringify(history));
    localStorage.setItem(AUTOSAVE_KEY, entry.json);
  } catch(e){
    if(typeof window !== 'undefined') window.__suppressAutoSave = false;
    showSaveStatus('Undo failed: storage error', '#c44');
    return;
  }
  // Reload — autoLoad reads from AUTOSAVE_KEY, which now holds the previous state.
  setTimeout(function(){
    try { window.location.reload(); }
    catch(e){ window.location.href = window.location.pathname + '?undo=' + Date.now(); }
  }, 30);
}

/**
 * Update the UNDO button's enabled/disabled visual state based on whether
 * there's anything in the autosave history. Called on init + after autosaves.
 */
function _updateUndoBtnState(){
  var btn = document.getElementById('btn-site-undo');
  if(!btn) return;
  var count = 0;
  try { count = (JSON.parse(localStorage.getItem(AUTOSAVE_HISTORY_KEY) || '[]') || []).length; } catch(e){}
  if(count > 0){
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
    btn.title = 'Undo last change (' + count + ' available)';
  } else {
    btn.style.opacity = '0.4';
    btn.style.pointerEvents = 'none';
    btn.title = 'Nothing to undo';
  }
}

/**
 * Manually restore a backup by its history index (0 = most recent backup).
 * @param {number} index
 */
function restoreAutoSaveBackup(index){
  try{
    const histRaw = localStorage.getItem(AUTOSAVE_HISTORY_KEY);
    const history = histRaw ? JSON.parse(histRaw) : [];
    const entry = history[index];
    if(!entry || !entry.json){ showSaveStatus('⚠ Backup not found', '#c44'); return false; }
    const state = JSON.parse(entry.json);
    applyState(state);
    if(typeof buildLotPanel==='function') buildLotPanel();
    if(typeof buildSetbackPanel==='function') buildSetbackPanel();
    if(typeof buildRoadsPanel==='function') buildRoadsPanel();
    if(typeof buildLandscapePanel==='function') buildLandscapePanel();
    if(typeof buildFloorPanel==='function') buildFloorPanel();
    if(typeof buildVolPanel==='function') buildVolPanel();
    if(typeof rebuildAll==='function') rebuildAll();
    showSaveStatus('↶ Restored backup from '+new Date(entry.savedAt).toLocaleString(), '#6a6');
    return true;
  } catch(e){ showSaveStatus('⚠ Restore failed: '+(e&&e.message), '#c44'); return false; }
}

function showSaveStatus(msg, color){
  const el = document.getElementById('save-status');
  if(!el) return;
  el.textContent = msg;
  el.style.color = color || '#6a6';
  el.style.opacity = '1';
  setTimeout(()=>{ el.style.opacity = '0'; }, 3000);
}

function refreshProjectList(){
  const sel = document.getElementById('project-select');
  if(!sel) return;
  const projects = getProjects();
  const names = Object.keys(projects).sort();
  sel.innerHTML = '<option value="">— Select saved project —</option>';
  names.forEach(name=>{
    const opt = document.createElement('option');
    opt.value = name;
    const ts = projects[name].savedAt ? ' ('+new Date(projects[name].savedAt).toLocaleDateString()+')' : '';
    opt.textContent = name + ts;
    sel.appendChild(opt);
  });
}

function saveProject(){
  const nameInput = document.getElementById('project-name');
  const name = (nameInput.value || '').trim();
  if(!name){
    showSaveStatus('⚠ Enter a project name first', '#c44');
    nameInput.focus();
    return;
  }
  const projects = getProjects();
  const existing = !!projects[name];
  projects[name] = { state: getState(), savedAt: Date.now() };
  setProjects(projects);
  refreshProjectList();
  document.getElementById('project-select').value = name;
  showSaveStatus(existing ? '✓ Project "'+name+'" updated!' : '✓ Project "'+name+'" saved!', '#6a6');
}

function loadProject(){
  const sel = document.getElementById('project-select');
  const name = sel.value;
  if(!name){
    showSaveStatus('⚠ Select a project to load', '#c44');
    return;
  }
  const projects = getProjects();
  if(!projects[name]){
    showSaveStatus('⚠ Project not found', '#c44');
    return;
  }
  applyState(projects[name].state);
  document.getElementById('project-name').value = name;
  buildLotPanel();
  buildSetbackPanel();
  buildRoadsPanel();
  buildLandscapePanel();
  buildFloorPanel();
  buildVolPanel();
  rebuildAll();
  showSaveStatus('✓ Loaded "'+name+'"', '#6a6');
}

function onProjectSelect(){
  const sel = document.getElementById('project-select');
  const nameInput = document.getElementById('project-name');
  if(sel.value) nameInput.value = sel.value;
}

function deleteProject(){
  const sel = document.getElementById('project-select');
  const name = sel.value || document.getElementById('project-name').value.trim();
  if(!name){
    showSaveStatus('⚠ Select or name a project to delete', '#c44');
    return;
  }
  if(!confirm('Delete project "'+name+'"?')) return;
  const projects = getProjects();
  delete projects[name];
  setProjects(projects);
  refreshProjectList();
  document.getElementById('project-name').value = '';
  showSaveStatus('🗑 Deleted "'+name+'"', '#c44');
}

function exportProject(){
  const state = getState();
  const name = document.getElementById('project-name').value.trim() || 'oleadev-project';
  const blob = new Blob([JSON.stringify({name, state, exportedAt:new Date().toISOString()}, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name.replace(/[^a-zA-Z0-9-_]/g,'_') + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showSaveStatus('✓ Exported '+a.download, '#6a6');
}

function importProject(){
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (ev)=>{
      try{
        const data = JSON.parse(ev.target.result);
        if(!data.state){ showSaveStatus('⚠ Invalid project file', '#c44'); return; }
        applyState(data.state);
        if(data.name) document.getElementById('project-name').value = data.name;
        buildLotPanel();
        buildSetbackPanel();
        buildRoadsPanel();
        buildLandscapePanel();
        buildFloorPanel();
        buildVolPanel();
        rebuildAll();
        showSaveStatus('✓ Imported "'+( data.name||'project')+'"', '#6a6');
      }catch(err){
        showSaveStatus('⚠ Failed to parse: '+err.message, '#c44');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function resetToDefaults(){
  if(!confirm('Reset all settings to defaults? Your current work will be lost unless saved.')) return;
  localStorage.removeItem(AUTOSAVE_KEY);
  P.lot = {front:60, upperRight:80, stepEast:0, lowerRight:80, upperLeft:80, notchWest:0, lowerLeft:80, rear:60, polyVerts:null, gpsVerts:null};
  P.set = {front:0, stepback:5, sideE:5, sideW:5, rear:8};
  P.flr = {gf:15, typ:10};
  P.vols = [];
  P.siteCoords = null;
  P.siteAddress = '';
  P.smVolumesGPS = null;
  P.comparables = [];
  buildLotPanel();
  buildSetbackPanel();
  buildRoadsPanel();
  buildLandscapePanel();
  buildFloorPanel();
  buildVolPanel();
  rebuildAll();
  showSaveStatus('↩ Reset to defaults', '#aab');
}
