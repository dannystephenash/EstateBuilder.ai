// sitemap-lot.js — Lot polygon drawing/editing
// ═══════════════════════════════════════════════════════════════════════════════════
// ── Custom lot polygon drawer (replaces Mapbox Draw for reliability) ──
let smLotDrawing=false;
let smLotDrawPts=[];
let smLotDrawMarkers=[];

// ═══════════════════════════════════════════════════════════════════════════════════
// ── Snap-to-vertex system ──
// When drawing lot polygons, vertices snap to nearby existing points so the user
// gets precise alignment without manually lining things up. Snap targets include:
//   1. Other vertices in the polygon currently being drawn
//   2. Existing lot polygon vertices (from a previously drawn/picked lot)
//   3. Picked parcel vertices (from the parcel picker)
// A visual snap indicator (pulsing ring) appears when the cursor is near a snap target.
// ═══════════════════════════════════════════════════════════════════════════════════
const SM_SNAP_THRESHOLD_PX = 15; // snap within 15 screen pixels (zoom-independent)
let smSnapIndicator = null;      // DOM element for snap preview ring
let smSnapTarget = null;         // current snap target [lng, lat] or null
let smSnapParcelCache = [];      // cached parcel vertices (survives smCancelMultiParcel)

/**
 * Collect all candidate snap points from available sources.
 * @returns {Array<[number,number]>} Array of [lng, lat] coordinate pairs
 */
function smGetSnapTargets() {
  var targets = [];

  // 1. Vertices already placed in the current drawing
  if (smLotDrawPts && smLotDrawPts.length > 0) {
    smLotDrawPts.forEach(function(p) { targets.push(p); });
  }

  // 2. Existing lot polygon vertices
  if (smLotData && smLotData.vertices && smLotData.vertices.length > 0) {
    smLotData.vertices.forEach(function(p) { targets.push(p); });
  }

  // 3. Picked parcel vertices (live — when picker is active)
  if (typeof smSelectedParcels !== 'undefined' && smSelectedParcels && smSelectedParcels.length > 0) {
    smSelectedParcels.forEach(function(parcel) {
      if (parcel.ringCoords && parcel.ringCoords.length > 0) {
        parcel.ringCoords.forEach(function(p) { targets.push(p); });
      }
    });
  }

  // 4. Cached parcel vertices (when picker was cleared before drawing)
  if (smSnapParcelCache.length > 0) {
    smSnapParcelCache.forEach(function(p) { targets.push(p); });
  }

  return targets;
}

/**
 * Find the nearest snap target within threshold for a given point.
 * Uses screen-pixel distance so the threshold feels consistent at any zoom.
 * @param {[number,number]} pt - [lng, lat]
 * @returns {{point:[number,number], dist:number}|null}
 */
function smFindSnapPoint(pt) {
  var targets = smGetSnapTargets();
  if (!smMap || targets.length === 0) return null;

  var screenPt = smMap.project(pt);
  var best = null;
  var bestDist = Infinity;

  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    if (Math.abs(t[0] - pt[0]) < 1e-10 && Math.abs(t[1] - pt[1]) < 1e-10) continue;
    var screenT = smMap.project(t);
    var dx = screenPt.x - screenT.x;
    var dy = screenPt.y - screenT.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }

  if (best && bestDist <= SM_SNAP_THRESHOLD_PX) {
    return {point: best, dist: bestDist};
  }
  return null;
}

/**
 * Show/hide/move the snap indicator ring on the map.
 * @param {[number,number]|null} lngLat - position to show, or null to hide
 */
function smUpdateSnapIndicator(lngLat) {
  if (!smMap) return;

  if (!lngLat) {
    // Hide indicator
    if (smSnapIndicator) {
      smSnapIndicator.remove();
      smSnapIndicator = null;
    }
    smSnapTarget = null;
    return;
  }

  smSnapTarget = lngLat;

  if (!smSnapIndicator) {
    var el = document.createElement('div');
    el.style.cssText = 'width:22px;height:22px;border:3px solid #00ffaa;border-radius:50%;' +
      'background:rgba(0,255,170,0.15);pointer-events:none;' +
      'animation:smSnapPulse 0.8s ease-in-out infinite alternate;';
    // Add keyframe animation if not already present
    if (!document.getElementById('sm-snap-style')) {
      var style = document.createElement('style');
      style.id = 'sm-snap-style';
      style.textContent = '@keyframes smSnapPulse{0%{transform:scale(1);opacity:1}100%{transform:scale(1.4);opacity:0.5}}';
      document.head.appendChild(style);
    }
    smSnapIndicator = new mapboxgl.Marker({element: el, anchor: 'center'})
      .setLngLat(lngLat)
      .addTo(smMap);
  } else {
    smSnapIndicator.setLngLat(lngLat);
  }
}

/**
 * Mousemove handler during lot drawing — shows snap preview.
 */
function smLotDrawMouseMove(e) {
  if (!smLotDrawing) return;
  var pt = [e.lngLat.lng, e.lngLat.lat];
  var snap = smFindSnapPoint(pt);
  if (snap) {
    smUpdateSnapIndicator(snap.point);
    smMap.getCanvas().style.cursor = 'pointer';
  } else {
    smUpdateSnapIndicator(null);
    smMap.getCanvas().style.cursor = 'crosshair';
  }
}

/**
 * Enters lot-drawing mode on the site map, allowing the user to click vertices
 * to define a custom lot polygon. Cancels any active parcel picker or building draw.
 */
function sitemapDraw(){
  if(!smMap)return;
  // Cache parcel vertices for snapping BEFORE cancel clears them
  smSnapParcelCache = [];
  if (typeof smSelectedParcels !== 'undefined' && smSelectedParcels && smSelectedParcels.length > 0) {
    smSelectedParcels.forEach(function(parcel) {
      if (parcel.ringCoords && parcel.ringCoords.length > 0) {
        parcel.ringCoords.forEach(function(p) { smSnapParcelCache.push(p.slice()); });
      }
    });
  }
  // Cancel parcel picker if active
  if(smParcelPickerActive){smCancelMultiParcel();}
  // Cancel building drawing if active
  if(smBldgDrawing) smCancelBldgDraw();
  // Cancel lot drawing if already active
  if(smLotDrawing){smCancelLotDraw();return;}
  // Clear old lot
  if(smDraw){try{smDraw.deleteAll();}catch(e){}}
  smClearMarkers();smLotData=null;
  document.getElementById('sitemap-lot-info').style.display='none';
  updateOptimalMassingButton();
  // Clear old lot layers
  try{if(smMap.getLayer('sm-custom-lot-fill'))smMap.removeLayer('sm-custom-lot-fill');}catch(e){}
  try{if(smMap.getLayer('sm-custom-lot-line'))smMap.removeLayer('sm-custom-lot-line');}catch(e){}
  try{if(smMap.getSource('sm-custom-lot'))smMap.removeSource('sm-custom-lot');}catch(e){}

  smLotDrawing=true;
  smLotDrawPts=[];
  smMap.getCanvas().style.cursor='crosshair';
  smMap.on('click',smLotClickHandler);
  smMap.on('mousemove',smLotDrawMouseMove);
  document.getElementById('sitemap-instructions').innerHTML='<b style="color:#AEBC46">Click</b> to place vertices · <b style="color:#AEBC46">Click first vertex</b> or press <b>CLOSE</b> to finish<br><button onclick="smCloseLotPoly()" style="margin-top:4px;background:#AEBC46;color:#111;border:none;border-radius:4px;padding:5px 20px;cursor:pointer;font-weight:700;font-size:12px">CLOSE LOT POLYGON</button> <button onclick="smCancelLotDraw()" style="margin-top:4px;background:#c44;color:#fff;border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-weight:600;font-size:11px;margin-left:4px">CANCEL</button>';
}

function smLotClickHandler(e){
  if(!smLotDrawing||smBldgDrawing)return;
  var pt=[e.lngLat.lng,e.lngLat.lat];

  // Apply snap if cursor is near a snap target
  var snap=smFindSnapPoint(pt);
  if(snap) pt=snap.point.slice(); // use snapped coordinates (clone to avoid mutation)

  // If 3+ points and click near first vertex → close
  if(smLotDrawPts.length>=3){
    const first=smLotDrawPts[0];
    const distM=turf.distance(turf.point(pt),turf.point(first),{units:'meters'});
    if(distM<3){smCloseLotPoly();return;}
  }

  smLotDrawPts.push(pt);

  // Vertex marker — first vertex is larger and clickable
  const isFirst=smLotDrawPts.length===1;
  const el=document.createElement('div');
  el.style.cssText=`width:${isFirst?18:12}px;height:${isFirst?18:12}px;background:${isFirst?'#AEBC46':'#AEBC46'};border:${isFirst?'3px':'2px'} solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.5);${isFirst?'cursor:pointer':''}`;
  if(isFirst) el.title='Click to close polygon';
  const m=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat(pt).addTo(smMap);
  if(isFirst){
    el.addEventListener('click',(ev)=>{ev.stopPropagation();if(smLotDrawPts.length>=3)smCloseLotPoly();});
  }
  smLotDrawMarkers.push(m);

  // Update preview line
  smUpdateLotDrawLine();
}

function smUpdateLotDrawLine(){
  if(smLotDrawPts.length<2)return;
  const data={type:'Feature',geometry:{type:'LineString',coordinates:smLotDrawPts}};
  if(smMap.getSource('sm-lot-draw-line')){
    smMap.getSource('sm-lot-draw-line').setData(data);
  } else {
    smMap.addSource('sm-lot-draw-line',{type:'geojson',data:data});
    smMap.addLayer({id:'sm-lot-draw-line',type:'line',source:'sm-lot-draw-line',paint:{'line-color':'#AEBC46','line-width':2.5,'line-dasharray':[3,2]}});
  }
}

function smCloseLotPoly(){
  if(!smLotDrawing||smLotDrawPts.length<3)return;
  const coords=[...smLotDrawPts,smLotDrawPts[0]];

  // Clean up drawing UI
  smLotDrawing=false;
  smMap.getCanvas().style.cursor='';
  smMap.off('click',smLotClickHandler);
  smMap.off('mousemove',smLotDrawMouseMove);
  if(smSnapIndicator){smSnapIndicator.remove();smSnapIndicator=null;}
  smSnapTarget=null;
  smSnapParcelCache=[];
  smLotDrawMarkers.forEach(m=>m.remove());
  smLotDrawMarkers=[];
  try{if(smMap.getLayer('sm-lot-draw-line'))smMap.removeLayer('sm-lot-draw-line');}catch(e){}
  try{if(smMap.getSource('sm-lot-draw-line'))smMap.removeSource('sm-lot-draw-line');}catch(e){}

  // Draw the final lot polygon
  const poly={type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{}};
  if(smMap.getSource('sm-custom-lot')){
    smMap.getSource('sm-custom-lot').setData(poly);
  } else {
    smMap.addSource('sm-custom-lot',{type:'geojson',data:poly});
    smMap.addLayer({id:'sm-custom-lot-fill',type:'fill',source:'sm-custom-lot',paint:{'fill-color':'#AEBC46','fill-opacity':0.12}});
    smMap.addLayer({id:'sm-custom-lot-line',type:'line',source:'sm-custom-lot',paint:{'line-color':'#AEBC46','line-width':2.5,'line-dasharray':[3,2]}});
  }

  // Process the lot data (same as smOnDraw)
  const verts=coords.slice(0,-1);
  const areaSqM=turf.area(poly);
  const areaSqFt=areaSqM*10.7639;
  const perimM=turf.length(turf.polygonToLine(poly.geometry),{units:'meters'});
  const edges=[];
  for(let i=0;i<verts.length;i++){
    const a=verts[i],b=verts[(i+1)%verts.length];
    const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
    const dFt=dM*3.28084;
    const bearing=turf.bearing(turf.point(a),turf.point(b));
    const dirs=['N','NE','E','SE','S','SW','W','NW'];
    const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];
    edges.push({id:String.fromCharCode(65+i),from:a,to:b,lengthFt:dFt,lengthM:dM,compass:compass});
  }
  smLotData={vertices:verts,geometry:poly.geometry,areaSqFt,areaSqM,perimFt:perimM*3.28084,edges,shape:verts.length+'pt polygon',vertexCount:verts.length};

  // Save GPS coordinates for comparables search and report
  const lotCentroid=turf.centroid(poly);
  P.siteCoords={lat:lotCentroid.geometry.coordinates[1],lng:lotCentroid.geometry.coordinates[0]};
  P.lot.gpsVerts=verts.map(v=>[v[0],v[1]]);

  // Reset road labels to generic names for new lot location
  if(P.roads&&P.roads.length>=2){
    if(P.roads[0].label==='NORTH AVE'||P.roads[0].label==='SOUTH AVE') P.roads[0].label='STREET A (NORTH)';
    if(P.roads[1].label==='NORTH AVE'||P.roads[1].label==='SOUTH AVE') P.roads[1].label='STREET B (SOUTH)';
    // Try to auto-name from nearby streets via geocoding
    try{
      fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+P.siteCoords.lng+','+P.siteCoords.lat+'.json?types=address&access_token='+mapboxgl.accessToken)
        .then(r=>r.json()).then(data=>{
          if(data.features&&data.features.length>0){
            const streetName=(data.features[0].text||'').toUpperCase();
            if(streetName&&P.roads&&P.roads.length>=1){
              P.roads[0].label=streetName;
              try{rebuildAll();}catch(e){}
            }
          }
        }).catch(()=>{});
    }catch(e){}
  }

  // Immediately set a temporary name from coordinates
  P.projectName='Site at '+P.siteCoords.lat.toFixed(4)+', '+P.siteCoords.lng.toFixed(4);
  // Update BOTH the header title and the save input
  const titleEl=document.getElementById('project-title');
  if(titleEl) titleEl.textContent=P.projectName;
  const nameInput=document.getElementById('project-name');
  if(nameInput) nameInput.value=P.projectName;
  document.title='OleaDev — '+P.projectName;

  // Cancellation token: each new lot draw bumps this counter. Async fetches that
  // started before a redraw will see their token mismatch and skip applying stale data.
  if(typeof window._lotFetchToken === 'undefined') window._lotFetchToken = 0;
  window._lotFetchToken++;
  var _myToken = window._lotFetchToken;
  function _isStale(){ return _myToken !== window._lotFetchToken; }

  // Always clear and refresh comparables immediately (don't wait for geocode)
  P.comparables=[];
  try{
    fetchNearbyComparables(P.siteCoords.lat,P.siteCoords.lng,'').then(()=>{
      if(_isStale()){ return; } // user redrew lot — abandon results
      smShowToast('Found '+P.comparables.length+' comparable development'+(P.comparables.length!==1?'s':'')+' within 3km','#AEBC46');
      smUpdateCompCount();
    }).catch(e=>{
      if(_isStale()) return;
      console.warn('Comparables error:',e);
      smShowToast('Comparables search failed: '+(e && e.message || 'unknown'),'#c44');
    });
  }catch(e){console.error('fetchNearbyComparables threw:',e);smShowToast('Comparables error: '+(e && e.message || 'unknown'),'#c44');}

  // Always detect zoning immediately (don't wait for geocode).
  // Use detectZoningAuto if available - dispatches to Toronto OR Mississauga
  // based on lat/lng bounds. Falls back to legacy detectZoning if the auto
  // wrapper hasn't loaded yet.
  try{
  var _zoneFn = (typeof window.detectZoningAuto === 'function') ? window.detectZoningAuto : detectZoning;
  _zoneFn(P.siteCoords.lat,P.siteCoords.lng).then(zoning=>{
    if(_isStale()){ return; } // user redrew lot — discard old zoning
    P.zoning=zoning;
    autoSave();
    if(zoning&&zoning.zone) smShowToast('Zoning detected: '+(zoning.zoneString||zoning.zone),'#4ecdc4');

    // ── Mississauga (or anywhere): auto-capture surrounding 3D buildings as
    //    Site Plan context. Try the city's own LOD 1.75 dataset first; if
    //    that fails (network/dataset URL/CORS), fall back to OpenStreetMap's
    //    Overpass API which has every building tagged with height or storeys.
    //    Toronto sites separately use Mapbox composite buildings via
    //    smCaptureContextBuildings — we only run this for non-Toronto sites
    //    or as a supplement.
    var _isMiss = zoning && zoning.jurisdiction === 'Mississauga';
    if(_isMiss){
      if(typeof window.captureMississaugaContextBuildings === 'function'){
        try {
          var p = window.captureMississaugaContextBuildings(1000);
          if(p && p.catch){
            p.catch(function(e){
              console.warn('[Miss buildings] official source failed, trying OSM fallback:', e && e.message);
              if(typeof window.captureOSMContextBuildings === 'function'){
                window.captureOSMContextBuildings(1000);
              }
            });
          }
        } catch(e){
          console.warn('[Miss buildings] context capture threw, trying OSM:', e);
          if(typeof window.captureOSMContextBuildings === 'function'){
            try { window.captureOSMContextBuildings(1000); } catch(e2){}
          }
        }
      } else if(typeof window.captureOSMContextBuildings === 'function'){
        // Mississauga module not loaded — go straight to OSM
        try { window.captureOSMContextBuildings(1000); } catch(e){}
      }
    }
    const zi=document.getElementById('zoning-info');
    // Verify the DOM node is still attached — tab switch may have recreated it
    if(zi && document.contains(zi) && zoning.zone){
      zi.style.display='block';
      zi.innerHTML=`
        <div style="color:#4ecdc4;font-weight:700;font-size:11px;margin-bottom:6px">📋 ZONING DETECTED — By-law 569-2013</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
          <div><span style="color:#888">Zone:</span> <b style="color:#AEBC46">${zoning.zoneString||zoning.zone}</b></div>
          <div><span style="color:#888">Max FSI:</span> <b style="color:#AEBC46">${zoning.fsiLimit?zoning.fsiLimit+'×':'Site-specific'}</b></div>
          <div><span style="color:#888">Height:</span> <b style="color:#AEBC46">${zoning.heightLimit?zoning.heightLimit+'m':'No overlay'}</b></div>
          <div><span style="color:#888">Coverage:</span> <b style="color:#AEBC46">${zoning.coverage?(zoning.coverage*100).toFixed(0)+'%':'—'}</b></div>
        </div>
        <div style="margin-top:4px"><span style="color:#888">Permitted:</span> <span style="color:#eee">${zoning.permitted.join(', ')}</span></div>
        ${zoning.exception?'<div style="margin-top:4px;color:#e8c87a">⚠ Exception #'+zoning.exceptionNo+' applies</div>':''}
      `;
    }
    try{renderReport();}catch(e){}
  }).catch(e=>{
    if(_isStale()) return;
    console.warn('Zoning detect error:',e);
    smShowToast('Zoning detection failed','#c44');
  });
  }catch(e){console.error('detectZoning threw:',e);}

  // Reverse geocode to get address and show confirmation banner
  try{
    fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+P.siteCoords.lng+','+P.siteCoords.lat+'.json?access_token='+mapboxgl.accessToken)
      .then(r=>{
        if(!r.ok) throw new Error('Geocode HTTP '+r.status);
        return r.json();
      }).then(data=>{
        if(_isStale()) return; // user redrew lot — discard stale address
        if(data.features&&data.features.length>0){
          P.siteAddress=data.features[0].place_name||'';

          // Always update project name to match new lot location
          P.projectName=P.siteAddress.split(',')[0]||'Untitled Project';
          const ti=document.getElementById('project-title');
          if(ti) ti.textContent=P.projectName;
          const ni=document.getElementById('project-name');
          if(ni) ni.value=P.projectName;
          document.title='OleaDev — '+P.projectName;

          // Show address confirmation banner on the map
          smShowAddressBanner(P.siteAddress, P.siteCoords);
          autoSave();
          try{renderReport();}catch(e){}
        }
      }).catch(e=>console.warn('Geocode error:',e));
  }catch(e){}
  autoSave();

  // Update UI
  smUpdateLotInfo(smLotData);

  document.getElementById('sitemap-instructions').innerHTML='Lot captured · <span style="color:#AEBC46;font-weight:600">Draw buildings</span> or <span style="color:#AEBC46;font-weight:600">re-draw</span> lot';
}

function smCancelLotDraw(){
  smLotDrawing=false;
  smLotDrawPts=[];
  if(smMap){smMap.getCanvas().style.cursor='';smMap.off('click',smLotClickHandler);smMap.off('mousemove',smLotDrawMouseMove);}
  if(smSnapIndicator){smSnapIndicator.remove();smSnapIndicator=null;}
  smSnapTarget=null;
  smSnapParcelCache=[];
  smLotDrawMarkers.forEach(m=>m.remove());
  smLotDrawMarkers=[];
  try{if(smMap&&smMap.getLayer('sm-lot-draw-line'))smMap.removeLayer('sm-lot-draw-line');}catch(e){}
  try{if(smMap&&smMap.getSource('sm-lot-draw-line'))smMap.removeSource('sm-lot-draw-line');}catch(e){}
  document.getElementById('sitemap-instructions').innerHTML='Click <b style="color:#AEBC46">DRAW LOT</b> to start';
}

function smUpdateLotInfo(d){
  document.getElementById('sitemap-lot-info').style.display='block';
  updateOptimalMassingButton();
  const clearBtn=document.getElementById('btn-clear-lot');
  if(clearBtn) clearBtn.style.display='block';
  document.getElementById('sitemap-metrics').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:11px">
      <span style="color:#777">Area:</span><span style="color:#AEBC46;font-weight:600">${Math.round(d.areaSqFt).toLocaleString()} sf</span>
      <span style="color:#777">Metric:</span><span style="color:#AEBC46">${Math.round(d.areaSqM).toLocaleString()} m²</span>
      <span style="color:#777">Acres:</span><span style="color:#AEBC46">${(d.areaSqFt/43560).toFixed(2)}</span>
      <span style="color:#777">Perimeter:</span><span style="color:#AEBC46">${Math.round(d.perimFt)}' (${Math.round(d.perimFt*0.3048)}m)</span>
    </div>`;
  document.getElementById('sitemap-edges').innerHTML=d.edges.map(e=>`
    <div style="display:flex;justify-content:space-between;padding:3px 6px;background:#1A1A1A;border-radius:3px;border-left:2px solid #AEBC46;margin-bottom:3px;font-size:11px">
      <span style="color:#777">Edge ${e.id} <span style="color:#445">${e.compass}</span></span>
      <span style="color:#AEBC46;font-weight:600">${e.lengthFt.toFixed(1)}'</span>
    </div>`).join('');
  const a=d.areaSqFt;
  document.getElementById('sitemap-zoning').innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;font-size:10px;text-align:center">
      <div style="background:#1A1A1A;border-radius:3px;padding:4px"><div style="color:#777">FSI 3x</div><div style="color:#AEBC46;font-weight:600">${Math.round(a*3).toLocaleString()} sf</div><div style="color:#445">${Math.round(a*3*0.82/650)} units</div></div>
      <div style="background:#1A1A1A;border-radius:3px;padding:4px"><div style="color:#777">FSI 5x</div><div style="color:#AEBC46;font-weight:600">${Math.round(a*5).toLocaleString()} sf</div><div style="color:#445">${Math.round(a*5*0.82/650)} units</div></div>
      <div style="background:#1A1A1A;border-radius:3px;padding:4px"><div style="color:#777">FSI 9x</div><div style="color:#AEBC46;font-weight:600">${Math.round(a*9).toLocaleString()} sf</div><div style="color:#445">${Math.round(a*9*0.82/650)} units</div></div>
    </div>`;

  // Add measurement labels on map (skip if map not initialized)
  if(smMap){
    smClearMarkers();
    const edgeLabelFeatures=smLotData.edges.map(e=>({
      type:'Feature',geometry:{type:'Point',coordinates:[(e.from[0]+e.to[0])/2,(e.from[1]+e.to[1])/2]},
      properties:{label:e.lengthFt.toFixed(1)+"'"}
    }));
    const c=turf.centroid(turf.polygon([d.vertices.concat([d.vertices[0]])]));
    edgeLabelFeatures.push({type:'Feature',geometry:{type:'Point',coordinates:c.geometry.coordinates},properties:{label:Math.round(d.areaSqFt).toLocaleString()+' sf'}});
    const lotLabelData={type:'FeatureCollection',features:edgeLabelFeatures};
    if(smMap.getSource('sm-lot-labels')){smMap.getSource('sm-lot-labels').setData(lotLabelData);}
    else{
      smMap.addSource('sm-lot-labels',{type:'geojson',data:lotLabelData});
      smMap.addLayer({id:'sm-lot-labels',type:'symbol',source:'sm-lot-labels',
        layout:{'text-field':['get','label'],'text-size':11,'text-font':['Open Sans Bold'],'text-allow-overlap':true,'text-ignore-placement':true},
        paint:{'text-color':'#AEBC46','text-halo-color':'rgba(26,26,26,0.9)','text-halo-width':2}});
    }
  }
}
// ── Edit lot vertices: toggle draggable markers on/off ──
let smEditLotActive=false;
let smEditLotMarkers=[];

function smToggleEditLot(){
  if(!smLotData||!smMap){alert('Draw a lot first');return;}
  if(smEditLotActive){smFinishEditLot();return;}
  // Cancel any active drawing
  if(smLotDrawing) smCancelLotDraw();
  if(smBldgDrawing) smCancelBldgDraw();

  smEditLotActive=true;
  const btn=document.getElementById('btn-edit-lot');
  btn.textContent='✅ DONE EDITING';
  btn.style.background='#AEBC46';
  btn.style.color='#111';

  const verts=smLotData.vertices;
  document.getElementById('sitemap-instructions').innerHTML='<b style="color:#AEBC46">Drag</b> any vertex to reshape the lot · Click <b style="color:#AEBC46">DONE EDITING</b> when finished';

  // Place draggable markers on each vertex
  for(let i=0;i<verts.length;i++){
    const el=document.createElement('div');
    el.style.cssText='width:16px;height:16px;background:#AEBC46;border:3px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,0.6)';
    el.title='Drag to move vertex '+(i+1);
    const marker=new mapboxgl.Marker({element:el,draggable:true,anchor:'center'})
      .setLngLat(verts[i])
      .addTo(smMap);
    const idx=i;
    marker.on('drag',()=>{
      const ll=marker.getLngLat();
      verts[idx]=[ll.lng,ll.lat];
      smRedrawLotPoly();
    });
    marker.on('dragend',()=>{
      smRecalcLotData();
    });
    smEditLotMarkers.push(marker);
  }

  // Also add midpoint markers to insert new vertices
  smAddLotMidpointMarkers();
}

function smFinishEditLot(){
  smEditLotActive=false;
  smEditLotMarkers.forEach(m=>m.remove());
  smEditLotMarkers=[];
  const btn=document.getElementById('btn-edit-lot');
  btn.textContent='📌 EDIT LOT';
  btn.style.background='#444444';
  btn.style.color='#AEBC46';
  document.getElementById('sitemap-instructions').innerHTML='Lot captured · <span style="color:#AEBC46;font-weight:600">Draw buildings</span> or <span style="color:#AEBC46;font-weight:600">edit</span> lot';
  // Final recalc
  smRecalcLotData();
}

function smAddLotMidpointMarkers(){
  // Remove old midpoints (keep vertex markers which are first N)
  const vertCount=smLotData.vertices.length;
  while(smEditLotMarkers.length>vertCount){
    smEditLotMarkers.pop().remove();
  }
  const verts=smLotData.vertices;
  for(let i=0;i<verts.length;i++){
    const j=(i+1)%verts.length;
    const mid=[(verts[i][0]+verts[j][0])/2,(verts[i][1]+verts[j][1])/2];
    const el=document.createElement('div');
    el.style.cssText='width:10px;height:10px;background:#AEBC4666;border:1px solid #AEBC46;border-radius:50%;cursor:pointer';
    el.title='Click to add vertex';
    const marker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat(mid).addTo(smMap);
    const insertIdx=i+1;
    el.addEventListener('click',()=>{
      verts.splice(insertIdx,0,[mid[0],mid[1]]);
      smRecalcLotData();
      // Re-enter edit mode with new vertex
      smFinishEditLot();
      smToggleEditLot();
    });
    smEditLotMarkers.push(marker);
  }
}

function smRedrawLotPoly(){
  const verts=smLotData.vertices;
  const coords=[...verts,verts[0]];
  const poly={type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{}};
  if(smMap.getSource('sm-custom-lot')){
    smMap.getSource('sm-custom-lot').setData(poly);
  }
}

function smRecalcLotData(){
  const verts=smLotData.vertices;
  const coords=[...verts,verts[0]];
  const poly={type:'Feature',geometry:{type:'Polygon',coordinates:[coords]},properties:{}};
  const areaSqM=turf.area(poly);
  const areaSqFt=areaSqM*10.7639;
  const perimM=turf.length(turf.polygonToLine(poly.geometry),{units:'meters'});
  const edges=[];
  for(let i=0;i<verts.length;i++){
    const a=verts[i],b=verts[(i+1)%verts.length];
    const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
    const dFt=dM*3.28084;
    const bearing=turf.bearing(turf.point(a),turf.point(b));
    const dirs=['N','NE','E','SE','S','SW','W','NW'];
    const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];
    edges.push({id:String.fromCharCode(65+i),from:a,to:b,lengthFt:dFt,lengthM:dM,compass:compass});
  }
  smLotData.geometry=poly.geometry;
  smLotData.areaSqFt=areaSqFt;
  smLotData.areaSqM=areaSqM;
  smLotData.perimFt=perimM*3.28084;
  smLotData.edges=edges;
  smLotData.vertexCount=verts.length;
  smLotData.shape=verts.length+'pt polygon';

  smRedrawLotPoly();
  smUpdateLotInfo(smLotData);
  // Auto-sync to massing
  smAutoSync();
}

function sitemapToggleStyle(){
  if(!smMap)return;
  smStyle=smStyle==='satellite'?'dark':'satellite';
  smMap.setStyle(smStyle==='satellite'?'mapbox://styles/mapbox/satellite-streets-v12':'mapbox://styles/mapbox/dark-v11');
  // Re-add 3D buildings after style swap (style change removes all custom layers)
  if(smIs3D){
    smMap.once('styledata', function(){ setTimeout(smEnable3DBuildings, 300); });
  }
}
function sitemapToggle3D(){
  if(!smMap)return;
  smIs3D=!smIs3D;
  smMap.easeTo({pitch:smIs3D?60:0,duration:800});
  // Add/show 3D building extrusions when entering 3D mode
  if(smIs3D) smEnable3DBuildings();
  else smDisable3DBuildings();
}

/** Add Mapbox 3D building extrusion layer using the composite tileset's building data. */
function smEnable3DBuildings(){
  if(!smMap) return;
  // Wait for style to be loaded
  if(!smMap.isStyleLoaded()){ smMap.once('styledata', smEnable3DBuildings); return; }

  // Check if layer already exists
  if(smMap.getLayer('sm-3d-buildings')) {
    smMap.setLayoutProperty('sm-3d-buildings','visibility','visible');
    return;
  }

  // The satellite-streets-v12 style has building data in the composite source.
  // Find the first symbol layer to insert the 3D buildings underneath labels.
  var labelLayerId;
  var layers = smMap.getStyle().layers;
  for(var i = 0; i < layers.length; i++){
    if(layers[i].type === 'symbol' && layers[i].layout && layers[i].layout['text-field']){
      labelLayerId = layers[i].id;
      break;
    }
  }

  smMap.addLayer({
    id: 'sm-3d-buildings',
    source: 'composite',
    'source-layer': 'building',
    filter: ['==', 'extrude', 'true'],
    type: 'fill-extrusion',
    minzoom: 14,
    paint: {
      'fill-extrusion-color': '#aaa',
      // Coalesce falls back to 0 when a tile feature is missing the height/min_height
      // property — without this, Mapbox throws "Cannot read properties of undefined
      // (reading 'get')" inside draw_fill_extrusion.js for any unproperty-tagged feature.
      'fill-extrusion-height': ['interpolate',['linear'],['zoom'],
        14, 0,
        14.5, ['coalesce', ['get','height'], 0]
      ],
      'fill-extrusion-base': ['interpolate',['linear'],['zoom'],
        14, 0,
        14.5, ['coalesce', ['get','min_height'], 0]
      ],
      'fill-extrusion-opacity': 0.5
    }
  }, labelLayerId);
}

function smDisable3DBuildings(){
  if(!smMap) return;
  if(smMap.getLayer('sm-3d-buildings')){
    smMap.setLayoutProperty('sm-3d-buildings','visibility','none');
  }
}

/**
 * Captures neighbouring building footprints from Mapbox tiles and stores them
 * on P._contextBuildingFeatures as simplified GeoJSON-like objects.
 * The satellite-streets style doesn't reference the 'building' source-layer by default,
 * so tiles aren't loaded unless we add a layer that uses them. This function:
 *   1. Ensures the 3D buildings layer exists (triggers tile fetch)
 *   2. Polls with increasing delays until features arrive (max ~8s)
 *   3. On success, stores features and triggers a deferred massing rebuild
 */
function smCaptureContextBuildings(){
  P._contextBuildingFeatures = [];
  if(!smMap) return;

  // Ensure the 3D buildings layer exists so Mapbox fetches building tiles
  var addedLayer = false;
  if(!smMap.getLayer('sm-3d-buildings')){
    smEnable3DBuildings();
    addedLayer = true;
  } else {
    // Make sure it's visible so tiles get fetched
    try { smMap.setLayoutProperty('sm-3d-buildings','visibility','visible'); } catch(e){}
  }

  // Poll for features — tiles take time to load from the CDN
  var attempt = 0;
  var delays = [200, 500, 1000, 1500, 2000, 3000]; // cumulative ~8.2s max wait
  function poll(){
    var features = _smQueryBuildingFeatures();
    if(features.length > 0){
      _smProcessBuildingFeatures(features);
      _smCleanupCaptureLayer(addedLayer);
      // If we're already on the massing tab or a rebuild has run, update context
      if(typeof rebuildContextBuildings === 'function'){
        try { rebuildContextBuildings(); } catch(e){ console.error('Deferred context rebuild:', e); }
      }
      /* Also rebuild the user's building so the per-edge abutment check
         (which reads _ctxBuildingPolysFt populated by rebuildContextBuildings)
         re-runs with the freshly-captured context — otherwise windows on
         abutted edges would stay visible until the next manual rebuild. */
      if(typeof rebuildBuilding === 'function'){
        try { rebuildBuilding(); } catch(e){ console.error('Deferred building rebuild:', e); }
      }
      return;
    }
    attempt++;
    if(attempt < delays.length){
      setTimeout(poll, delays[attempt]);
    } else {
      console.log('Context buildings: no features found after', delays.length, 'attempts');
      _smCleanupCaptureLayer(addedLayer);
    }
  }
  // First attempt after short delay to let Mapbox start fetching tiles
  setTimeout(poll, delays[0]);
}

function _smCleanupCaptureLayer(addedLayer){
  // Hide layer if we added it just for capture and 3D mode isn't active
  if(addedLayer && !smIs3D && smMap && smMap.getLayer('sm-3d-buildings')){
    try { smMap.setLayoutProperty('sm-3d-buildings','visibility','none'); } catch(e){}
  }
}

/** Query building features from Mapbox source tiles or rendered layer. */
function _smQueryBuildingFeatures(){
  if(!smMap) return [];
  var features = [];
  try {
    features = smMap.querySourceFeatures('composite', {sourceLayer: 'building'});
  } catch(e){}
  // Fallback: rendered features from the 3D layer
  if((!features || features.length === 0)){
    try {
      if(smMap.getLayer('sm-3d-buildings')){
        features = smMap.queryRenderedFeatures({layers:['sm-3d-buildings']});
      }
    } catch(e2){}
  }
  return features || [];
}

/** De-duplicate and store building features on P._contextBuildingFeatures. */
function _smProcessBuildingFeatures(features){
  P._contextBuildingFeatures = [];
  if(!features || features.length === 0){
    console.log('Context buildings captured: 0');
    return;
  }
  var seen = {};
  features.forEach(function(feat){
    if(!feat.geometry) return;
    var gt = feat.geometry.type;
    if(gt !== 'Polygon' && gt !== 'MultiPolygon') return;
    var h = (feat.properties && feat.properties.height) ? parseFloat(feat.properties.height) : 8;
    var mh = (feat.properties && feat.properties.min_height) ? parseFloat(feat.properties.min_height) : 0;
    if(!isFinite(h) || h <= 0) h = 8;
    if(!isFinite(mh)) mh = 0;

    var polys = gt === 'MultiPolygon' ? feat.geometry.coordinates : [feat.geometry.coordinates];
    polys.forEach(function(rings){
      if(!rings || !rings[0] || rings[0].length < 4) return;
      var key = rings[0][0][0].toFixed(5) + ',' + rings[0][0][1].toFixed(5) + ',' + h.toFixed(1);
      if(seen[key]) return;
      seen[key] = true;
      P._contextBuildingFeatures.push({
        coords: rings[0],
        height: h,
        minHeight: mh
      });
    });
  });
  console.log('Context buildings captured:', P._contextBuildingFeatures.length);
  // Trigger a Three.js context-group rebuild so newly captured features render
  // immediately. Mirrors the same pattern in OSM / Mississauga / MS-Canadian loaders.
  if(typeof rebuildContextBuildings === 'function'){
    try { rebuildContextBuildings(); } catch(e){ console.warn('[smCapture] rebuildContextBuildings failed:', e); }
  }
}

function smOnDraw(e){
  const f=e.features[0];if(!f||f.geometry.type!=='Polygon')return;
  const coords=f.geometry.coordinates[0];
  const verts=coords.slice(0,-1);
  const areaSqM=turf.area(f);
  const areaSqFt=areaSqM*10.7639;
  const perimM=turf.length(turf.polygonToLine(f.geometry),{units:'meters'});
  const edges=[];
  for(let i=0;i<verts.length;i++){
    const a=verts[i],b=verts[(i+1)%verts.length];
    const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
    const bearing=turf.bearing(turf.point(a),turf.point(b));
    const dirs=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    const compass=dirs[Math.round(((bearing%360+360)%360)/22.5)%16];
    edges.push({id:String.fromCharCode(65+i),from:a,to:b,lengthM:dM,lengthFt:dM*3.28084,bearing,compass});
  }
  let shape='Irregular';
  if(verts.length===4)shape='Rectangular';
  else if(verts.length>=5&&verts.length<=8)shape='L-Shaped';
  else if(verts.length===3)shape='Triangular';

  smLotData={geometry:f.geometry,vertices:verts,areaSqFt,areaSqM,areaAcres:areaSqM/4046.86,
    perimeterFt:perimM*3.28084,edges,shape,vertexCount:verts.length};

  // Save GPS coordinates for comparables and report
  const c2=turf.centroid(turf.polygon([verts.concat([verts[0]])]));
  P.siteCoords={lat:c2.geometry.coordinates[1],lng:c2.geometry.coordinates[0]};
  P.lot.gpsVerts=verts.map(v=>[v[0],v[1]]);
  try{
    fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+P.siteCoords.lng+','+P.siteCoords.lat+'.json?access_token='+mapboxgl.accessToken)
      .then(r=>r.json()).then(data=>{
        if(data.features&&data.features.length>0){P.siteAddress=data.features[0].place_name||'';autoSave();}
      }).catch(()=>{});
  }catch(e){}
  autoSave();

  smUpdatePanel();smAddMarkers();
  document.getElementById('sitemap-lot-info').style.display='block';
  updateOptimalMassingButton();
  document.getElementById('sitemap-instructions').innerHTML='Lot captured · <span style="color:#AEBC46;font-weight:600">Drag</span> vertices to edit · <span style="color:#AEBC46;font-weight:600">Apply</span> to massing';
}

function smUpdatePanel(){
  const d=smLotData;if(!d)return;
  const nf=n=>Math.round(n).toLocaleString();
  document.getElementById('sitemap-metrics').innerHTML=`
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">Area</span><span style="font-size:12px;font-weight:600;color:#AEBC46">${nf(d.areaSqFt)} sf</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">Area (m²)</span><span style="font-size:12px;font-weight:600">${nf(d.areaSqM)} m²</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">Acres</span><span style="font-size:12px;font-weight:600">${d.areaAcres.toFixed(3)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">Perimeter</span><span style="font-size:12px;font-weight:600">${nf(d.perimeterFt)} ft</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">Vertices</span><span style="font-size:12px;font-weight:600">${d.vertexCount}</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="font-size:10px;color:#888">Shape</span><span style="font-size:12px;font-weight:600">${d.shape}</span></div>`;

  document.getElementById('sitemap-edges').innerHTML=d.edges.map(e=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#1A1A1A;border-radius:4px;border-left:3px solid #AEBC46;margin-bottom:4px">
      <div><div style="font-size:10px;color:#777">Edge ${e.id}</div><div style="font-size:9px;color:#445">${e.compass} (${e.bearing.toFixed(1)}°)</div></div>
      <div style="font-size:13px;font-weight:600">${e.lengthFt.toFixed(1)}' <span style="font-size:10px;color:#777">(${e.lengthM.toFixed(1)}m)</span></div>
    </div>`).join('');

  document.getElementById('sitemap-zoning').innerHTML=`
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">GFA @ 3.0x FSI</span><span style="font-size:12px;font-weight:600">${nf(d.areaSqFt*3)} sf</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">GFA @ 5.0x FSI</span><span style="font-size:12px;font-weight:600">${nf(d.areaSqFt*5)} sf</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #1e1e2e"><span style="font-size:10px;color:#888">GFA @ 9.0x FSI</span><span style="font-size:12px;font-weight:600">${nf(d.areaSqFt*9)} sf</span></div>
    <div style="display:flex;justify-content:space-between;padding:4px 0"><span style="font-size:10px;color:#888">Est. Units (650sf avg)</span><span style="font-size:12px;font-weight:600;color:#AEBC46">~${Math.round(d.areaSqFt*9*0.92*0.80/650)}</span></div>`;
}

function smAddMarkers(){
  smClearMarkers();if(!smLotData||!smMap)return;
  smLotData.edges.forEach(e=>{
    // Use Mapbox symbol layer for edge labels instead of DOM markers (won't block clicks)
  });
  // Edge labels as a symbol layer (non-interactive, won't block polygon drawing)
  const edgeLabelFeatures=smLotData.edges.map(e=>({
    type:'Feature',
    geometry:{type:'Point',coordinates:[(e.from[0]+e.to[0])/2,(e.from[1]+e.to[1])/2]},
    properties:{label:e.lengthFt.toFixed(1)+"'"}
  }));
  // Area label at centroid — also as symbol layer
  const c=turf.centroid(turf.polygon([smLotData.vertices.concat([smLotData.vertices[0]])]));
  edgeLabelFeatures.push({
    type:'Feature',
    geometry:{type:'Point',coordinates:c.geometry.coordinates},
    properties:{label:Math.round(smLotData.areaSqFt).toLocaleString()+' sf'}
  });
  const lotLabelData={type:'FeatureCollection',features:edgeLabelFeatures};
  if(smMap.getSource('sm-lot-labels')){
    smMap.getSource('sm-lot-labels').setData(lotLabelData);
  } else {
    smMap.addSource('sm-lot-labels',{type:'geojson',data:lotLabelData});
    smMap.addLayer({id:'sm-lot-labels',type:'symbol',source:'sm-lot-labels',
      layout:{'text-field':['get','label'],'text-size':11,'text-font':['Open Sans Bold'],'text-allow-overlap':true,'text-ignore-placement':true},
      paint:{'text-color':'#AEBC46','text-halo-color':'rgba(26,26,26,0.9)','text-halo-width':2}
    });
  }
}
function smClearMarkers(){
  smMarkers.forEach(m=>m.remove());smMarkers=[];
  try{if(smMap&&smMap.getLayer('sm-lot-labels'))smMap.removeLayer('sm-lot-labels');}catch(e){}
  try{if(smMap&&smMap.getSource('sm-lot-labels'))smMap.removeSource('sm-lot-labels');}catch(e){}
}

/**
 * Converts the drawn lot polygon from GPS coordinates to local XY feet,
 * clears the current 3D massing, and applies the lot as the new project boundary.
 */
function sitemapApplyToMassing(){
  if(!smLotData)return;

  const lotArea=Math.round(smLotData.areaSqFt);
  const edgeSummary=smLotData.edges.map(e=>`  ${e.id}: ${Math.round(e.lengthFt)}' (${e.compass})`).join('\n');
  const msg=`NEW DEVELOPMENT SITE\n\nLot Area: ${lotArea.toLocaleString()} sf\nShape: ${smLotData.shape} (${smLotData.vertexCount} vertices)\n\nEdge dimensions:\n${edgeSummary}\n\n⚠️ This will CLEAR the current massing and start a fresh project.\nThe exact polygon you drew will become the lot boundary.\n\nProceed?`;
  if(!confirm(msg)) return;

  // ── Convert lat/lng polygon to local XY feet coordinates ──
  // Use the northernmost vertex as origin (top of lot)
  // X = east-west distance in feet, Z = north-south distance in feet (Z+ = south)
  const verts=smLotData.vertices;

  // Find the northernmost point (highest latitude) as origin
  let originIdx=0;
  verts.forEach((v,i)=>{ if(v[1]>verts[originIdx][1]) originIdx=i; });
  const originLng=verts[originIdx][0], originLat=verts[originIdx][1];

  // Convert each vertex to feet relative to origin
  const polyVerts=verts.map(v=>{
    // X = east-west distance (positive = east)
    const xM=turf.distance(turf.point([originLng,originLat]),turf.point([v[0],originLat]),{units:'meters'});
    const xFt=xM*3.28084*(v[0]>originLng?1:-1);
    // Z = north-south distance (positive = south)
    const zM=turf.distance(turf.point([originLng,originLat]),turf.point([originLng,v[1]]),{units:'meters'});
    const zFt=zM*3.28084*(v[1]<originLat?1:-1); // south = positive
    return [Math.round(xFt), Math.round(zFt)];
  });

  // Ensure polygon is clockwise (for consistent rendering)
  let crossSum=0;
  for(let i=0;i<polyVerts.length;i++){
    const j=(i+1)%polyVerts.length;
    crossSum+=(polyVerts[j][0]-polyVerts[i][0])*(polyVerts[j][1]+polyVerts[i][1]);
  }
  if(crossSum<0) polyVerts.reverse(); // make clockwise

  // Compute bounding box for lot parameters (used by volume clamping)
  const allX=polyVerts.map(v=>v[0]), allZ=polyVerts.map(v=>v[1]);
  const minX=Math.min(...allX), maxX=Math.max(...allX);
  const minZ=Math.min(...allZ), maxZ=Math.max(...allZ);
  const lotWidth=maxX-minX, lotDepth=maxZ-minZ;

  // Store GPS origin for coordinate transforms (used by context buildings in massing view)
  P._gpsOrigin = {lng: originLng, lat: originLat};

  // Capture neighbouring building footprints while tiles are loaded
  smCaptureContextBuildings();

  // Store the polygon vertices directly — lotVerts() will use these
  P.lot={
    polyVerts: polyVerts,
    gpsVerts: verts.map(function(v){return [v[0],v[1]];}),
    gpsOrigin: {lng: originLng, lat: originLat},
    // Keep parametric values as fallback/display (approximate from bounding box)
    front: lotWidth,
    upperRight: Math.round(lotDepth*0.5),
    stepEast: 0,
    lowerRight: Math.round(lotDepth*0.5),
    upperLeft: Math.round(lotDepth*0.7),
    notchWest: 0,
    lowerLeft: Math.round(lotDepth*0.3),
    rear: lotWidth
  };

  // Reset everything else
  P.set={front:10,stepback:3,sideE:12,sideW:4,rear:10};
  P.flr={gf:15,typ:10};
  P.vols=[];
  P.pf={
    units:[
      {type:'Studio',size:425,count:0,psf:1100},
      {type:'1-Bedroom',size:550,count:0,psf:1075},
      {type:'1-Bed+Den',size:630,count:0,psf:1050},
      {type:'2-Bedroom',size:775,count:0,psf:1025},
      {type:'2-Bed+Den',size:875,count:0,psf:1000},
      {type:'3-Bedroom',size:1050,count:0,psf:975}
    ],
    comm:[
      {label:'Grocery Anchor',pct:0.7,rent:22,cap:0.06},
      {label:'CRU Retail / F&B',pct:0.2,rent:35,cap:0.06},
      {label:'Service / Personal',pct:0.1,rent:28,cap:0.065}
    ],
    parkPrice:60000,lockerPrice:8000,parkRatio:0.3,lockerRatio:0.56,
    landPrice:10000000,lttRate:0.025,ddCost:350000,
    efficiency:0.80,
    hc:{shoring:18,structure:68,envelope:85,mech:38,elec:22,fitResi:55,fitComm:12,commShell:8,elevators:6,siteWorks:5,parking:28,groceryTI:4.5},
    sc:{ae:0.065,pm:0.03,legal:0.015,insurance:0.012,marketing:0.04,permits:0.008,contingency:0.105},
    dcPerUnit:45000,dcCommPerSF:44,s37PerUnit:7300,parkland:2200000,
    ltc:0.65,intRate:0.065,drawMonths:24,loanFeePct:0.01,
    autoScaleUnits:true,baseResiGFA:0
  };
  P.core={elevX:0,elevZ:0,elevDir:'ns',elevAngle:0,numElevators:0,stairs:[]};
  P.roads=[];
  P.landscape=[];

  // Rebuild all panels
  buildLotPanel();
  buildSetbackPanel();
  buildRoadsPanel();
  buildLandscapePanel();
  buildFloorPanel();
  buildVolPanel();
  rebuildAll();
  switchTab('massing');
}

/**
 * Syncs the drawn lot + map-placed volumes to 3D massing without throwing
 * away existing settings. Called from the SYNC TO 3D PREVIEW button.
 */
function smSyncTo3D(){
  if(!smLotData){alert('Draw a lot first');return;}
  if(typeof smVolumes === 'undefined' || !Array.isArray(smVolumes) || smVolumes.length===0){
    alert('Add at least one building volume');return;
  }

  // Apply lot polygon to massing — convert GPS verts to local feet (origin = north-most vertex)
  const verts = smLotData.vertices;
  let originIdx = 0;
  verts.forEach((v,i)=>{ if(v[1] > verts[originIdx][1]) originIdx = i; });
  const originLng = verts[originIdx][0], originLat = verts[originIdx][1];

  const polyVerts = verts.map(v => {
    const xM = turf.distance(turf.point([originLng,originLat]), turf.point([v[0],originLat]), {units:'meters'});
    const xFt = xM * 3.28084 * (v[0] > originLng ? 1 : -1);
    const zM = turf.distance(turf.point([originLng,originLat]), turf.point([originLng,v[1]]), {units:'meters'});
    const zFt = zM * 3.28084 * (v[1] < originLat ? 1 : -1);
    return [Math.round(xFt), Math.round(zFt)];
  });

  // Ensure CCW winding
  let crossSum = 0;
  for(let i=0; i<polyVerts.length; i++){
    const j = (i+1) % polyVerts.length;
    crossSum += (polyVerts[j][0] - polyVerts[i][0]) * (polyVerts[j][1] + polyVerts[i][1]);
  }
  if(crossSum < 0) polyVerts.reverse();

  const allX = polyVerts.map(v=>v[0]), allZ = polyVerts.map(v=>v[1]);
  const minX = Math.min(...allX), maxX = Math.max(...allX);
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ);

  P._gpsOrigin = {lng: originLng, lat: originLat};

  // Capture neighbouring building footprints while tiles are loaded
  smCaptureContextBuildings();

  P.lot = {
    polyVerts: polyVerts,
    gpsOrigin: {lng: originLng, lat: originLat},
    front: maxX - minX,
    upperRight: Math.round((maxZ - minZ) * 0.5),
    stepEast: 0,
    lowerRight: Math.round((maxZ - minZ) * 0.5),
    upperLeft: Math.round((maxZ - minZ) * 0.7),
    notchWest: 0,
    lowerLeft: Math.round((maxZ - minZ) * 0.3),
    rear: maxX - minX
  };

  // Convert each map-placed volume to a 3D massing volume (preserve freeform polygons)
  P.vols = smVolumes.map(sv => {
    const xM = turf.distance(turf.point([originLng,originLat]), turf.point([sv.lngLat[0],originLat]), {units:'meters'});
    const xFt = xM * 3.28084 * (sv.lngLat[0] > originLng ? 1 : -1);
    const zM = turf.distance(turf.point([originLng,originLat]), turf.point([originLng,sv.lngLat[1]]), {units:'meters'});
    const zFt = zM * 3.28084 * (sv.lngLat[1] < originLat ? 1 : -1);
    const startEg = Math.max(0, Math.round(zFt - sv.depthFt/2));
    const rightEdge = Math.round(xFt + sv.widthFt/2);
    const offEast = Math.max(0, Math.round(maxX - rightEdge));

    let localPoly = null;
    if(sv.customPoly && sv.customPoly.length >= 4){
      localPoly = sv.customPoly.map(coord => {
        const pxM = turf.distance(turf.point([originLng,originLat]), turf.point([coord[0],originLat]), {units:'meters'});
        const pxFt = pxM * 3.28084 * (coord[0] > originLng ? 1 : -1);
        const pzM = turf.distance(turf.point([originLng,originLat]), turf.point([originLng,coord[1]]), {units:'meters'});
        const pzFt = pzM * 3.28084 * (coord[1] < originLat ? 1 : -1);
        return [Math.round(pxFt), Math.round(pzFt)];
      });
    }

    return {
      storeys: sv.storeys, startEg: startEg, depth: sv.depthFt, width: sv.widthFt,
      offEast: offEast, commGF: sv.commGF, color: sv.color, name: sv.name, angle: sv.angle,
      windows: sv.windows || 1, winSpacing: sv.winSpacing || 3,
      balconies: (sv.balcFront || sv.balcBack || sv.balcLeft || sv.balcRight) ? 1 : 0,
      balcEvery: sv.balcEvery || 2, balcDepth: sv.balcDepth || 4,
      balcFront: sv.balcFront, balcBack: sv.balcBack, balcLeft: sv.balcLeft, balcRight: sv.balcRight,
      customPolyLocal: localPoly,
      customAreaSF: sv.customAreaSF || 0
    };
  });

  // Refresh panels + 3D, then jump to the Massing tab
  try { if(typeof buildLotPanel === 'function') buildLotPanel(); } catch(e){}
  try { if(typeof buildSetbackPanel === 'function') buildSetbackPanel(); } catch(e){}
  try { if(typeof buildFloorPanel === 'function') buildFloorPanel(); } catch(e){}
  try { if(typeof buildVolPanel === 'function') buildVolPanel(); } catch(e){}
  try { rebuildAll(); } catch(e){ console.warn('rebuildAll err:', e); }
  try { if(typeof switchTab === 'function') switchTab('massing'); } catch(e){}
}


//  MAP-BASED MASSING — place/drag/rotate volumes on satellite
// ══════════════════════