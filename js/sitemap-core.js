// sitemap-core.js — Map init, global state, lifecycle, utilities
// ═══════════════════════════════════════════════════════════════════════════════════
// sitemap.js — Mapbox map, parcel picker, lot drawing, zoning overlay, geocoder
// ═══════════════════════════════════════════════════════════
//  PANEL RESIZE
// ═══════════════════════════════════════════════════════════
(function(){
  const handle=document.getElementById('panel-resize');
  const panel=document.getElementById('panel');
  let dragging=false,startX=0,startW=0;
  // Notify all viewport renderers (3D canvas, Mapbox map, section3D) that their
  // container size changed. Without this, the Mapbox map leaves a dark gap on
  // the side where the panel used to be, because its internal canvas keeps the
  // old size until told to resize.
  function _resizeAll(){
    try { onResize(); } catch(e) {}
    try { if(typeof smMap !== 'undefined' && smMap && smMap.resize) smMap.resize(); } catch(e) {}
    try {
      if(typeof sec3d !== 'undefined' && sec3d && sec3d.renderer && sec3d.camera){
        var sw = document.getElementById('section3d-wrap');
        if(sw && sw.clientWidth > 0 && sw.clientHeight > 0){
          sec3d.camera.aspect = sw.clientWidth / sw.clientHeight;
          sec3d.camera.updateProjectionMatrix();
          sec3d.renderer.setSize(sw.clientWidth, sw.clientHeight);
        }
      }
    } catch(e) {}
  }
  handle.addEventListener('mousedown',e=>{
    dragging=true;startX=e.clientX;startW=panel.offsetWidth;
    document.body.style.cursor='ew-resize';
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging)return;
    const newW=startW+(e.clientX-startX);
    panel.style.width=Math.max(280,Math.min(window.innerWidth*0.75,newW))+'px';
    _resizeAll();
  });
  document.addEventListener('mouseup',()=>{
    if(dragging){
      dragging=false;
      document.body.style.cursor='';
      // Final settle: resize again on mouseup in case any handler missed
      // the last mousemove, then redraw the section.
      _resizeAll();
      try { drawSection(); } catch(e) {}
    }
  });
})();

// ═══════════════════════════════════════════════════════════
//  SECTION TOGGLE
// ═══════════════════════════════════════════════════════════
function toggleSec(id){
  const sec=document.getElementById(id);
  const hd=sec.querySelector('.sec-hd');
  const bd=sec.querySelector('.sec-bd');
  hd.classList.toggle('collapsed');
  bd.classList.toggle('hidden');
  // Auto-run analysis calculators when the section opens so users see
  // results immediately without clicking "calculate" — keeps tools live
  // and tied to the rendered model.
  if(!bd.classList.contains('hidden')){
    const autoCalc={
      'sec-applications':'calcApplications',
      'sec-tripgen':'calcTripParking',
      'sec-shadow':'calcShadow',
      'sec-iz':'calcInclusionaryZoning',
      'sec-walkability':'calcWalkability',
      'sec-watercap':'calcWaterCapacity',
      'sec-stormwater':'calcStormwater',
      'sec-servicing':'calcServicing',
      'sec-geotech':'calcGeotech',
      'sec-dc-breakdown':'calcDCBreakdown',
      'sec-cbc':'calcCBC',
      'sec-ltt':'calcLTT'
    };
    const fnName=autoCalc[id];
    if(fnName && typeof window[fnName]==='function'){
      try { window[fnName](); } catch(e){ console.warn('[toggleSec] auto-calc failed for '+id+':',e); }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════
initThree();
console.log('%c[EstateBuilder v4.0-ENGINE] Loaded — MAT palette + mk() + addCurtainWall(opts) + addBalconyUnit','color:#AEBC46;font-weight:bold;font-size:12px');

// Auto-load last session (before building panels). Records result on
// window._autoLoadResult so we can tell the user after panels render.
autoLoad();

// Sync efficiency sliders to the loaded P.pf.efficiency value (no recalc needed —
// pfCalc reads P.pf.efficiency directly when the pro-forma renders).
try {
  const _eff = (P.pf && P.pf.efficiency != null) ? P.pf.efficiency : 0.80;
  const _pct = Math.round(Math.min(1, Math.max(0, _eff)) * 100);
  ['eff-slider-massing','eff-slider-pf'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.value = _pct;
  });
  ['eff-val-massing','eff-val-pf'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.textContent = _pct + '%';
  });
} catch(e){}

// Initialize the SITE MAP undo button's enabled/disabled state from the
// autosave history. Updates again automatically on every subsequent autosave.
try { if(typeof _updateUndoBtnState === 'function') _updateUndoBtnState(); } catch(e){}

// Sync the stepback slider to whatever the first podium-bearing volume has.
// New projects start at 5ft (the new default) until OPTIMAL MASSING runs.
try {
  let _stepFt = 5;
  if(P.vols && P.vols.length > 0){
    const _v = P.vols.find(v => (v.podiumStoreys || 0) > 0 && (v.stepbackAmt || 0) > 0);
    if(_v) _stepFt = Math.max(0, Math.min(15, Math.round(_v.stepbackAmt)));
  }
  const _slEl = document.getElementById('stepback-slider');
  if(_slEl) _slEl.value = _stepFt;
  const _lblEl = document.getElementById('stepback-val');
  if(_lblEl) _lblEl.textContent = _stepFt + ' ft';
} catch(e){}
// Defer the toast until UI is rendered so the save-status element exists
setTimeout(function(){
  try {
    const r = window._autoLoadResult;
    if(!r) return;
    if(r.source === 'primary' && (P.vols && P.vols.length > 0)){
      showSaveStatus('↶ Restored last session — '+P.vols.length+' volume'+(P.vols.length===1?'':'s'), '#6a6');
    } else if(r.source === 'backup'){
      const when = r.savedAt ? new Date(r.savedAt).toLocaleString() : 'earlier';
      showSaveStatus('↶ Primary save was unreadable — recovered from backup ('+when+')', '#e8c87a');
    }
  } catch(e){}
}, 300);

// Build all panels from (possibly restored) state
buildLotPanel();
buildSetbackPanel();
buildRoadsPanel();
buildLandscapePanel();
buildFloorPanel();
buildVolPanel();
refreshProjectList();
rebuildAll();

// Wire project type selector with confirm dialog
document.getElementById('project-type-select').addEventListener('change', function() {
  const newType = this.value;
  if (newType !== P.projectType) {
    if (confirm('Switching asset class will reset all pro-forma defaults. Continue?')) {
      loadAssetDefaults(newType);
    } else {
      this.value = P.projectType;
    }
  }
});

// Main 3D render loop — pauses when its canvas is hidden (other tabs active)
// or when the browser tab is in the background. Saves significant GPU/battery.
function animate(){
  requestAnimationFrame(animate);
  // Skip render when tab is hidden by browser (background tab)
  if(typeof document !== 'undefined' && document.hidden) return;
  // Skip render when our canvas is not visible (user is on AI/Pro-Forma/etc.)
  var cw = (typeof document !== 'undefined') ? document.getElementById('canvas-wrap') : null;
  if(cw && cw.style.display === 'none') return;
  // Defensive: skip if canvas has zero dimensions (mid-layout)
  if(cw && (cw.clientWidth < 1 || cw.clientHeight < 1)) return;
  if(typeof renderer !== 'undefined' && typeof scene !== 'undefined' && typeof camera !== 'undefined'){
    renderer.render(scene, camera);
  }
}
animate();

// ═══════════════════════════════════════════════════════════
//  SITE MAP — Mapbox satellite lot drawing tool
// ═══════════════════════════════════════════════════════════
let smMap=null, smDraw=null, smStyle='satellite', smIs3D=false, smLotData=null, smMarkers=[];

/**
 * Initializes the Mapbox satellite map, geocoder, and drawing controls.
 * Reads the Mapbox token from the input field and stores it in localStorage.
 */
function initSiteMap(){
  const token=document.getElementById('mapbox-token').value.trim();
  if(!token||!token.startsWith('pk.')){document.getElementById('mapbox-token').style.borderColor='#c44';return;}
  localStorage.setItem('oleadev_mapbox_token',token);
  mapboxgl.accessToken=token;
  document.getElementById('sitemap-token').style.display='none';
  document.getElementById('sitemap-controls').style.display='block';

  smMap=new mapboxgl.Map({
    container:'sitemap-map',
    style:'mapbox://styles/mapbox/satellite-streets-v12',
    center:P.siteCoords?[P.siteCoords.lng,P.siteCoords.lat]:[-79.38,43.70],zoom:P.siteCoords?16:12,pitch:0,bearing:0,attributionControl:false
  });
  smMap.addControl(new mapboxgl.AttributionControl({compact:true}),'bottom-right');
  smMap.addControl(new mapboxgl.NavigationControl({showCompass:true,showZoom:true}),'bottom-left');
  smMap.addControl(new mapboxgl.ScaleControl({maxWidth:200,unit:'metric'}),'bottom-left');

  // Geocoder in the map itself
  const gc=new MapboxGeocoder({accessToken:token,mapboxgl,placeholder:'Search address...',countries:'ca',
    proximity:{longitude:-79.38,latitude:43.70},bbox:[-79.65,43.58,-79.10,43.85],zoom:18});
  smMap.addControl(gc,'top-left');

  // Drawing
  smDraw=new MapboxDraw({displayControlsDefault:false,controls:{polygon:false,trash:false},defaultMode:'simple_select',
    styles:[
      {id:'gl-draw-polygon-fill',type:'fill',filter:['all',['==','$type','Polygon']],paint:{'fill-color':'#AEBC46','fill-opacity':0.15}},
      {id:'gl-draw-polygon-stroke',type:'line',filter:['all',['==','$type','Polygon']],paint:{'line-color':'#AEBC46','line-width':2.5,'line-dasharray':[2,1]}},
      {id:'gl-draw-point',type:'circle',filter:['all',['==','$type','Point'],['==','meta','vertex']],paint:{'circle-radius':6,'circle-color':'#AEBC46','circle-stroke-color':'#1A1A1A','circle-stroke-width':2}},
      {id:'gl-draw-point-mid',type:'circle',filter:['all',['==','$type','Point'],['==','meta','midpoint']],paint:{'circle-radius':4,'circle-color':'#888888','circle-stroke-color':'#1A1A1A','circle-stroke-width':1}},
      {id:'gl-draw-line',type:'line',filter:['all',['==','$type','LineString']],paint:{'line-color':'#AEBC46','line-width':2,'line-dasharray':[3,2]}}
    ]
  });
  smMap.addControl(smDraw);
  smMap.on('draw.create',smOnDraw);
  smMap.on('draw.update',smOnDraw);
  smMap.on('draw.delete',()=>{document.getElementById('sitemap-lot-info').style.display='none';updateOptimalMassingButton();smClearMarkers();smLotData=null;});
  smMap.once('load',()=>{
    smMap.resize();
    // ── Restore saved lot polygon and building volumes on map ──
    smRestoreSavedPolygons();
  });
}


function smRestoreSavedPolygons(){
  if(!smMap)return;
  // Restore lot polygon from saved GPS vertices
  if(P.lot.gpsVerts&&P.lot.gpsVerts.length>=3){
    const verts=P.lot.gpsVerts;
    const coords=[...verts,verts[0]]; // close the ring
    const poly=turf.polygon([coords]);
    const areaSqM=turf.area(poly);
    const areaSqFt=areaSqM*10.7639;
    const perimM=turf.length(turf.polygonToLine(poly),{units:'meters'});
    const edges=[];
    for(let i=0;i<verts.length;i++){
      const a=verts[i],b=verts[(i+1)%verts.length];
      const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
      const dFt=dM*3.28084;
      const bearing=turf.bearing(turf.point(a),turf.point(b));
      const dirs=['N','NE','E','SE','S','SW','W','NW'];
      const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];
      edges.push({id:String.fromCharCode(65+i),from:a,to:b,lengthFt:dFt,lengthM:dM,compass});
    }
    smLotData={vertices:verts,geometry:poly.geometry,areaSqFt,areaSqM,perimFt:perimM*3.28084,edges,shape:verts.length+'pt polygon',vertexCount:verts.length};

    // Draw the lot polygon on the map
    try{
      if(smMap.getLayer('saved-lot-fill'))smMap.removeLayer('saved-lot-fill');
      if(smMap.getLayer('saved-lot-line'))smMap.removeLayer('saved-lot-line');
      if(smMap.getSource('saved-lot'))smMap.removeSource('saved-lot');
    }catch(e){}
    smMap.addSource('saved-lot',{type:'geojson',data:poly});
    smMap.addLayer({id:'saved-lot-fill',type:'fill',source:'saved-lot',paint:{'fill-color':'#AEBC46','fill-opacity':0.15}});
    smMap.addLayer({id:'saved-lot-line',type:'line',source:'saved-lot',paint:{'line-color':'#AEBC46','line-width':2.5,'line-dasharray':[2,1]}});

    // Add vertex markers
    verts.forEach((v,i)=>{
      const el=document.createElement('div');
      el.style.cssText='width:10px;height:10px;background:#AEBC46;border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.5)';
      const m=new mapboxgl.Marker({element:el}).setLngLat(v).addTo(smMap);
      smMarkers.push(m);
    });

    // Fit map to lot bounds
    const lngs=verts.map(v=>v[0]),lats=verts.map(v=>v[1]);
    smMap.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:60,duration:0});

    // Restore building volumes from saved GPS data
    if(P.smVolumesGPS&&P.smVolumesGPS.length>0){
      smVolumes=P.smVolumesGPS.map(sv=>({...sv}));
      smVolNextId=Math.max(...smVolumes.map(v=>v.id||0))+1;
      smVolumes.forEach(vol=>{
        if(vol.customPoly&&vol.customPoly.length>=3) smDrawVolume(vol);
      });
      if(smVolumes.length>0) smSelectedVolId=smVolumes[0].id;
      smRenderVolPanel();
    }

    // Update UI
    smUpdateLotInfo(smLotData);
    document.getElementById('sitemap-lot-info').style.display='block';
    updateOptimalMassingButton();
    document.getElementById('sitemap-instructions').innerHTML='Lot restored from save · <span style="color:#AEBC46;font-weight:600">Draw buildings</span> or <span style="color:#AEBC46;font-weight:600">re-draw</span> lot';
  } else if(P.siteCoords){
    // No polygon saved but have coordinates — center the map
    smMap.setCenter([P.siteCoords.lng,P.siteCoords.lat]);
    smMap.setZoom(17);
  }
}

// Auto-load saved token AND auto-connect if token exists
(function(){
  const t=localStorage.getItem('oleadev_mapbox_token');
  if(t){
    document.getElementById('mapbox-token').value=t;
    // Auto-connect to Mapbox on page load if we have a saved token
    setTimeout(()=>{try{initSiteMap();}catch(e){console.warn('Auto-connect failed:',e);}},500);
  }
})();
