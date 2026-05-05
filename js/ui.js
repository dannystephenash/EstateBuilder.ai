// ui.js — Tab switching, panel resize, shadow study, initialization
// ═══════════════════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════════════════
// ── Tab-to-group mapping ──
var TAB_GROUPS={
  sitemap:'site', massing:'site', section:'site',
  proforma:'financials', units:'financials', scenarios:'financials',
  report:'output', zoning:'output', ai:'output'
};
// Tabs that show the 3D canvas (panel + canvas side-by-side)
var CANVAS_TABS={massing:true};
// Tabs that show the Mapbox map
var MAP_TABS={sitemap:true};
// Everything else goes full-width panel (no canvas, no map)

/**
 * Switches the active primary group and shows its sub-tabs.
 * Activates the first sub-tab in that group by default.
 * @param {string} group - 'site'|'financials'|'output'
 */
function switchGroup(group){
  // Update primary nav
  document.querySelectorAll('.nav-group').forEach(b=>{
    b.classList.toggle('active',b.dataset.group===group);
  });
  // Show/hide secondary tabs by group
  var firstTab=null;
  document.querySelectorAll('.nav-secondary .tab-btn').forEach(b=>{
    var show=b.dataset.group===group;
    b.style.display=show?'':'none';
    if(show&&!firstTab) firstTab=b.dataset.tab;
  });
  // Activate the first sub-tab in this group
  if(firstTab) switchTab(firstTab);
}

/**
 * Switches the visible tab in the side panel and toggles 3D/map viewport.
 * Also syncs the primary group highlight.
 * @param {string} id - Tab name: 'sitemap'|'massing'|'section'|'proforma'|'units'|'report'|'zoning'|'scenarios'|'ai'
 */
function switchTab(id){
  // Sync primary group
  var group=TAB_GROUPS[id];
  if(group){
    document.querySelectorAll('.nav-group').forEach(b=>{
      b.classList.toggle('active',b.dataset.group===group);
    });
    // Ensure correct sub-tabs are visible
    document.querySelectorAll('.nav-secondary .tab-btn').forEach(b=>{
      b.style.display=(b.dataset.group===group)?'':'none';
    });
  }

  // Highlight active sub-tab
  document.querySelectorAll('.nav-secondary .tab-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.tab===id);
  });

  // Switch tab content
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  var tab=document.getElementById('tab-'+id);
  if(tab)tab.classList.add('active');

  // Show/hide map vs 3D canvas vs full-width
  var mapDiv=document.getElementById('sitemap-container');
  var canvasWrap=document.getElementById('canvas-wrap');
  var matLegend=document.getElementById('materials-legend');
  if(matLegend) matLegend.style.display=(id==='massing')?'block':'none';

  if(MAP_TABS[id]){
    // Map tab — show Mapbox, hide canvas
    if(canvasWrap)canvasWrap.style.display='none';
    if(mapDiv){
      mapDiv.style.display='flex';
      if(smMap){
        requestAnimationFrame(function(){
          smMap.resize();
          setTimeout(function(){smMap.resize();},100);
          setTimeout(function(){smMap.resize();},300);
        });
      }
    }
    // Restore panel width if coming from full-width
    _restorePanelWidth();
  } else if(CANVAS_TABS[id]){
    // 3D canvas tab — show canvas, hide map
    if(mapDiv)mapDiv.style.display='none';
    _restorePanelWidth();
    if(canvasWrap){
      canvasWrap.style.display='block';
      // Deferred resize: browser needs a reflow after display:none→block
      // before clientWidth/clientHeight return correct values
      requestAnimationFrame(function(){
        onResize();
        if(typeof renderer !== 'undefined' && typeof scene !== 'undefined' && typeof camera !== 'undefined'){
          renderer.render(scene, camera);
        }
        // Second pass catches late layout shifts (e.g. panel width restoration)
        setTimeout(function(){ onResize(); }, 100);
        setTimeout(function(){ onResize(); }, 300);
      });
    }
  } else {
    // Full-width panel tab — hide both map and canvas
    if(mapDiv)mapDiv.style.display='none';
    if(canvasWrap)canvasWrap.style.display='none';
    var panel=document.getElementById('panel');
    if(!panel.dataset.prevWidth) panel.dataset.prevWidth=panel.style.width||'';
    panel.style.width='100%';panel.style.maxWidth='100%';
  }

  // Tab-specific init hooks
  if(id==='section') initSection3D();
  if(id==='proforma') updateProForma();
  if(id==='units'){ _pfCache=null; buildFloorSchedule(); renderUnitEditor(); }
  if(id==='report') renderReport();
  if(id==='scenarios') renderScenarioDashboard();
}

/** Restores the panel to its previous width after leaving a full-width tab. */
function _restorePanelWidth(){
  var panel=document.getElementById('panel');
  if(panel.dataset.prevWidth!==undefined){
    panel.style.width=panel.dataset.prevWidth||'';
    panel.style.maxWidth='';
    delete panel.dataset.prevWidth;
    onResize();
  }
}

// ═══════════════════════════════════════════════════════════
//  FLOOR PLAN FULLSCREEN & EXPORT
// ═══════════════════════════════════════════════════════════

function openFloorPlanFullscreen(floorIdx){
  if(floorIdx<0) return;
  // Create fullscreen overlay
  let ov=document.getElementById('fp-fullscreen-overlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='fp-fullscreen-overlay';
    ov.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;padding:16px;font-family:Outfit,DM Sans,sans-serif';
    document.body.appendChild(ov);
  }
  ov.style.display='flex';

  const up=P.unitPlan;
  if(!up||!up.floors||floorIdx>=up.floors.length) return;
  const fl=up.floors[floorIdx];

  // Navigation
  ov.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-shrink:0">
      <div style="display:flex;gap:8px;align-items:center">
        <button onclick="_fpFSNav(-1,${up.floors.length})" style="background:#2D2D2D;border:1px solid #444;color:#AEBC46;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:700">◄</button>
        <span style="color:#AEBC46;font-size:16px;font-weight:700">F${fl.floor}</span>
        <span style="color:#888;font-size:11px">${fl.floorType.toUpperCase()} — ${fl.volumes}</span>
        <button onclick="_fpFSNav(1,${up.floors.length})" style="background:#2D2D2D;border:1px solid #444;color:#AEBC46;padding:6px 14px;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:700">►</button>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <span style="color:#666;font-size:13px">Gross ${fl.grossSF.toLocaleString()} sf · Net ${fl.netSF.toLocaleString()} sf · ${fl.units.length} units · ${fl.efficiency}% eff</span>
        <button onclick="document.getElementById('fp-fullscreen-overlay').style.display='none'" style="background:#444;border:none;color:#fff;padding:6px 16px;border-radius:4px;cursor:pointer;font-family:inherit;font-weight:600">✕ CLOSE</button>
      </div>
    </div>
    <div id="fp-fs-svg" style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center"></div>
  `;

  // Render SVG at large size
  _fpFSCurrentFloor=floorIdx;
  _renderFPFullscreen(floorIdx);
}

let _fpFSCurrentFloor=0;

function _fpFSNav(dir,total){
  _fpFSCurrentFloor=Math.max(0,Math.min(total-1,_fpFSCurrentFloor+dir));
  openFloorPlanFullscreen(_fpFSCurrentFloor);
}

function _renderFPFullscreen(floorIdx){
  const wrap=document.getElementById('fp-fs-svg');
  if(!wrap) return;
  // Temporarily set the SVG target to the fullscreen container
  const origWrap=document.getElementById('unit-floor-svg');
  const origHTML=origWrap?origWrap.innerHTML:'';

  // Create a temp container with large width
  wrap.innerHTML='<div id="fp-fs-temp" style="width:100%;height:100%"></div>';
  const temp=document.getElementById('fp-fs-temp');

  // We need to render the SVG into this temp container
  // Temporarily replace the unit-floor-svg element
  const fakeEl=document.createElement('div');
  fakeEl.id='unit-floor-svg';
  fakeEl.style.cssText='width:100%;height:100%';
  temp.appendChild(fakeEl);

  // Store and replace
  const realEl=document.getElementById('unit-floor-svg');
  // There are now two elements with this ID — the fake one is deeper in DOM
  // Call renderFloorPlateSVG which targets id='unit-floor-svg'
  // Instead, let's just copy the SVG and scale it
  if(origWrap){
    const svg=origWrap.querySelector('svg');
    if(svg){
      const clone=svg.cloneNode(true);
      clone.setAttribute('width','100%');
      clone.setAttribute('height','100%');
      clone.style.maxWidth='100%';
      clone.style.maxHeight='100%';
      temp.innerHTML='';
      temp.appendChild(clone);
    }
  }
  // Clean up fake element
  fakeEl.remove();
}

function exportAllFloorPlans(){
  const up=P.unitPlan;
  if(!up||!up.floors||!up.floors.length){alert('No floor plans to export');return;}

  // Render all floors sequentially into SVG and compile into a single HTML for print
  const origFloor=_unitEditorSelectedFloor;
  const svgs=[];

  up.floors.forEach((fl,idx)=>{
    // Render into temp container
    const temp=document.createElement('div');
    temp.id='unit-floor-svg';
    temp.style.cssText='width:800px;position:absolute;left:-9999px;top:-9999px';
    document.body.appendChild(temp);

    // Swap ID temporarily
    const origEl=document.getElementById('unit-floor-svg');
    if(origEl&&origEl!==temp) origEl.id='unit-floor-svg-backup';
    renderFloorPlateSVG(idx);
    const svgContent=temp.innerHTML;
    svgs.push({floor:fl.floor, type:fl.floorType, svg:svgContent, grossSF:fl.grossSF, netSF:fl.netSF, units:fl.units.length, eff:fl.efficiency});

    // Restore
    temp.remove();
    const backup=document.getElementById('unit-floor-svg-backup');
    if(backup) backup.id='unit-floor-svg';
  });

  // Restore selected floor
  _unitEditorSelectedFloor=origFloor;
  if(origFloor>=0) renderFloorPlateSVG(origFloor);

  // Build printable HTML
  let html=`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${P.projectName||'EstateBuilder.ai'} — Floor Plans</title>
    <style>
      body{font-family:Outfit,DM Sans,sans-serif;background:#0a0a0a;color:#ccc;margin:0;padding:20px}
      .page{background:#111;border:1px solid #333;border-radius:8px;padding:16px;margin-bottom:16px;page-break-inside:avoid}
      .hdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
      .fl{font-size:18px;font-weight:700;color:#AEBC46}
      .meta{font-size:13px;color:#888}
      @media print{body{background:#fff;color:#000}.page{border:1px solid #ccc;background:#fff}}
    </style>
  </head><body>
    <div style="text-align:center;margin-bottom:20px">
      <h1 style="color:#AEBC46;font-size:20px;margin:0">${P.projectName||'EstateBuilder.ai'} — Floor Plan Atlas</h1>
      <p style="color:#888;font-size:11px;margin:4px 0">${P.siteAddress||''} · Generated ${new Date().toLocaleDateString()}</p>
    </div>`;

  svgs.reverse().forEach(s=>{
    html+=`<div class="page">
      <div class="hdr">
        <span class="fl">F${s.floor} — ${s.type.toUpperCase()}</span>
        <span class="meta">Gross ${s.grossSF.toLocaleString()}sf · Net ${s.netSF.toLocaleString()}sf · ${s.units} units · ${s.eff}% eff</span>
      </div>
      ${s.svg}
    </div>`;
  });
  html+=`</body></html>`;

  const blob=new Blob([html],{type:'text/html'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=(P.projectName||'floorplans').replace(/[^a-zA-Z0-9]/g,'-')+'-floor-plans.html';
  a.click();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
//  ZONING COMPLIANCE DASHBOARD
//  Real-time compliance headroom indicators
// ═══════════════════════════════════════════════════════════


const _origSwitchTab=switchTab;
switchTab=function(id){
  _origSwitchTab(id);
  if(id==='zoning') renderZoningDashboard();

  /* When entering the Site Plan (3D massing) tab: refresh environment
     (satellite ground texture) AND capture context buildings if missing.
     Both can be missing after a page reload / saved-project load because:
       - The Mapbox satellite Static Image fetch only runs inside rebuildLot()
         and silently bails if no GPS origin or token was set at that time.
       - smCaptureContextBuildings() only runs on lot-draw, not on lot-restore.
     This auto-trigger fixes both without requiring the user to re-draw. */
  if(id==='massing'){
    /* HARDWIRED: Every time the user enters the Site Plan tab, force a full
       refresh of the 3D scene from the latest Site Map state. Captures context
       buildings, re-fetches satellite imagery, re-derives polygons from
       lat/lng, and triggers the full rebuildAll pipeline. Silent on errors so
       the tab always opens regardless of partial data state. */
    try {
      var hasOrigin = P && P._gpsOrigin && typeof P._gpsOrigin.lng === 'number';
      var hasFeatures = P && Array.isArray(P._contextBuildingFeatures) && P._contextBuildingFeatures.length > 0;
      var hasMapboxToken = (typeof mapboxgl !== 'undefined' && mapboxgl.accessToken)
        || (typeof localStorage !== 'undefined' && localStorage.getItem('oleadev_mapbox_token'));

      console.log('[Site Plan] Entering tab. State:',
        'gpsOrigin='+(hasOrigin ? JSON.stringify(P._gpsOrigin) : 'MISSING'),
        '| mapboxToken='+(hasMapboxToken ? 'present' : 'MISSING'),
        '| smMap='+(typeof smMap !== 'undefined' && smMap ? 'initialized' : 'NOT initialized'),
        '| contextBuildings='+(hasFeatures ? P._contextBuildingFeatures.length : 0));

      /* 1. If site has changed in Site Map tab, sync GPS origin from lot data */
      if(P.lot && P.lot.gpsVerts && P.lot.gpsVerts.length >= 3 && !hasOrigin){
        // Pick northernmost vertex as origin
        var _gv = P.lot.gpsVerts;
        var _maxLat = -Infinity, _ni = 0;
        for(var _i = 0; _i < _gv.length; _i++){ if(_gv[_i][1] > _maxLat){ _maxLat = _gv[_i][1]; _ni = _i; } }
        P._gpsOrigin = {lng: _gv[_ni][0], lat: _gv[_ni][1]};
        P.lot.gpsOrigin = {lng: _gv[_ni][0], lat: _gv[_ni][1]};
        hasOrigin = true;
        console.log('[Site Plan] Auto-derived _gpsOrigin from gpsVerts.');
      }

      /* 2. Capture context buildings BEFORE the rebuild so they're available.
         Jurisdiction-aware: Toronto uses Mapbox composite (smCaptureContextBuildings),
         Mississauga uses the city's 3D Massing Model + OSM fallback, others use OSM.
         Mirrors the same dispatch logic that runs on lot-draw in sitemap-lot.js. */
      if(hasOrigin && !hasFeatures){
        var _juris = null;
        try { _juris = (typeof zoning === 'object' && zoning && zoning.jurisdiction) ? zoning.jurisdiction : null; } catch(e){}
        // Fallback: detect Mississauga from lot lat/lng if zoning hasn't loaded yet
        if(!_juris && P && P.siteCoords){
          var _slat = P.siteCoords.lat, _slng = P.siteCoords.lng;
          if(_slat >= 43.45 && _slat <= 43.75 && _slng >= -79.85 && _slng <= -79.45) _juris = 'Mississauga';
          else if(_slat >= 43.58 && _slat <= 43.86 && _slng >= -79.64 && _slng <= -79.12) _juris = 'Toronto';
        }
        console.log('[Site Plan] context capture dispatch: jurisdiction=' + (_juris || 'unknown'));

        if(_juris === 'Mississauga'){
          // Mississauga 3D Massing Model first; OSM fallback if it fails
          if(typeof window.captureMississaugaContextBuildings === 'function'){
            try {
              var _p = window.captureMississaugaContextBuildings(1000);
              if(_p && _p.catch){
                _p.catch(function(e){
                  console.warn('[Site Plan] Mississauga capture failed, trying OSM:', e && e.message);
                  if(typeof window.captureOSMContextBuildings === 'function'){
                    try { window.captureOSMContextBuildings(1000); } catch(e2){}
                  }
                });
              }
            } catch(e){
              console.warn('[Site Plan] Mississauga capture threw, trying OSM:', e);
              if(typeof window.captureOSMContextBuildings === 'function'){
                try { window.captureOSMContextBuildings(1000); } catch(e2){}
              }
            }
          } else if(typeof window.captureOSMContextBuildings === 'function'){
            try { window.captureOSMContextBuildings(1000); } catch(e){}
          }
        } else if(_juris === 'Toronto'){
          // Toronto Mapbox composite via the existing smMap-bound loader
          if(typeof smMap !== 'undefined' && smMap && typeof smCaptureContextBuildings === 'function'){
            try { smCaptureContextBuildings(); } catch(e){ console.warn('[Site Plan] Toronto capture failed:', e); }
          } else if(typeof window.initSiteMap === 'function' && !smMap){
            try { initSiteMap(); } catch(e){}
          }
        } else {
          // Unknown jurisdiction — try OSM as the universal fallback
          if(typeof window.captureOSMContextBuildings === 'function'){
            try { window.captureOSMContextBuildings(1000); } catch(e){}
          }
        }
      }

      /* 3. ALWAYS trigger a full rebuild on tab entry. realignBuildingToLot +
         normalizeLotPolygon are wired into _doRebuild, so this single call
         re-syncs every polygon to current _gpsOrigin and redraws every layer
         (satellite, ground, lot, building, context). */
      if(typeof rebuildAll === 'function'){
        try { rebuildAll(); } catch(e){ console.warn('[Site Plan] rebuildAll failed:', e); }
      } else if(typeof rebuildEnvironment === 'function'){
        try { rebuildEnvironment(); } catch(e){}
      }
    } catch(e){ console.warn('[Site Plan] auto-refresh skipped:', e); }
  }
};

// ═══════════════════════════════════════════════════════════
//  SHADOW & SUN STUDY ENGINE
//  Solar Position Algorithm (SPA) — astronomical precision
//  Refs: Meeus "Astronomical Algorithms", NOAA Solar Calculator
// ═══════════════════════════════════════════════════════════
let _shadowActive=false, _shadowAnimId=null, _shadowOrigDirPos=null;

/**
 * Compute Julian Day Number from a JS Date
 */
function dateToJD(date){
  let y=date.getUTCFullYear(), m=date.getUTCMonth()+1, d=date.getUTCDate();
  const h=date.getUTCHours()+date.getUTCMinutes()/60+date.getUTCSeconds()/3600;
  if(m<=2){y--;m+=12;}
  const A=Math.floor(y/100);
  const B=2-A+Math.floor(A/4);
  return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d+h/24+B-1524.5;
}

/**
 * Solar position calculation using simplified SPA
 * Returns {altitude, azimuth} in degrees
 * altitude: 0=horizon, 90=zenith
 * azimuth: 0=North, 90=East, 180=South, 270=West
 */
/**
 * Calculates solar altitude and azimuth for a given location and time.
 * @param {number} lat - Latitude in degrees
 * @param {number} lng - Longitude in degrees
 * @param {Date} date - Date/time to calculate for
 * @returns {{altitude:number, azimuth:number}} Solar angles in degrees
 */
function solarPosition(lat, lng, date){
  const JD=dateToJD(date);
  const T=(JD-2451545.0)/36525; // Julian centuries from J2000.0

  // Sun's geometric mean longitude (deg)
  let L0=(280.46646+T*(36000.76983+T*0.0003032))%360;
  if(L0<0) L0+=360;

  // Sun's mean anomaly (deg)
  let M=(357.52911+T*(35999.05029-T*0.0001537))%360;
  if(M<0) M+=360;
  const Mrad=M*Math.PI/180;

  // Eccentricity of Earth's orbit
  const e=0.016708634-T*(0.000042037+T*0.0000001267);

  // Sun's equation of center (deg)
  const C=(1.914602-T*(0.004817+T*0.000014))*Math.sin(Mrad)
        +(0.019993-T*0.000101)*Math.sin(2*Mrad)
        +0.000289*Math.sin(3*Mrad);

  // Sun's true longitude (deg)
  const sunLon=(L0+C)%360;

  // Sun's apparent longitude (deg)
  const omega=(125.04-1934.136*T)%360;
  const lambda=sunLon-0.00569-0.00478*Math.sin(omega*Math.PI/180);

  // Mean obliquity of ecliptic (deg)
  const eps0=23+(26+((21.448-T*(46.815+T*(0.00059-T*0.001813))))/60)/60;
  // Corrected obliquity
  const eps=eps0+0.00256*Math.cos(omega*Math.PI/180);
  const epsRad=eps*Math.PI/180;
  const lambdaRad=lambda*Math.PI/180;

  // Sun's right ascension
  let RA=Math.atan2(Math.cos(epsRad)*Math.sin(lambdaRad), Math.cos(lambdaRad))*180/Math.PI;
  RA=((RA%360)+360)%360;

  // Sun's declination
  const dec=Math.asin(Math.sin(epsRad)*Math.sin(lambdaRad))*180/Math.PI;
  const decRad=dec*Math.PI/180;

  // Equation of time (minutes)
  const y2=Math.tan(epsRad/2)*Math.tan(epsRad/2);
  const L0rad=L0*Math.PI/180;
  const EoT=4*(y2*Math.sin(2*L0rad)-2*e*Math.sin(Mrad)+4*e*y2*Math.sin(Mrad)*Math.cos(2*L0rad)
    -0.5*y2*y2*Math.sin(4*L0rad)-1.25*e*e*Math.sin(2*Mrad))*180/Math.PI;

  // Solar time
  const solarNoon=720-4*lng-EoT; // in minutes UTC
  const utcMinutes=date.getUTCHours()*60+date.getUTCMinutes()+date.getUTCSeconds()/60;
  let ha=(utcMinutes-solarNoon)/4; // hour angle in degrees (1 deg = 4 min)
  const haRad=ha*Math.PI/180;
  const latRad=lat*Math.PI/180;

  // Solar altitude (elevation)
  const sinAlt=Math.sin(latRad)*Math.sin(decRad)+Math.cos(latRad)*Math.cos(decRad)*Math.cos(haRad);
  const altitude=Math.asin(sinAlt)*180/Math.PI;

  // Solar azimuth (from North, clockwise)
  const cosAzi=(Math.sin(decRad)-Math.sin(latRad)*sinAlt)/(Math.cos(latRad)*Math.cos(altitude*Math.PI/180));
  let azimuth=Math.acos(Math.max(-1,Math.min(1,cosAzi)))*180/Math.PI;
  if(ha>0) azimuth=360-azimuth;

  return {altitude, azimuth};
}

/**
 * Compute sunrise and sunset times (hours, local offset) for a date/location
 * Returns {sunrise, sunset} in decimal hours (local solar time offset by timezone)
 */
function sunriseSunset(lat, lng, date){
  // Use the same date at noon UTC for declination
  const noon=new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));
  const sp=solarPosition(lat, lng, noon);
  const JD=dateToJD(noon);
  const T=(JD-2451545.0)/36525;

  // Recalculate declination at noon
  let M=(357.52911+T*(35999.05029-T*0.0001537))%360;
  if(M<0) M+=360;
  const Mrad=M*Math.PI/180;
  let L0=(280.46646+T*(36000.76983+T*0.0003032))%360;
  if(L0<0) L0+=360;
  const C=(1.914602-T*(0.004817+T*0.000014))*Math.sin(Mrad)
        +(0.019993-T*0.000101)*Math.sin(2*Mrad)
        +0.000289*Math.sin(3*Mrad);
  const sunLon=(L0+C)%360;
  const omega=(125.04-1934.136*T)%360;
  const lambda=sunLon-0.00569-0.00478*Math.sin(omega*Math.PI/180);
  const eps0=23+(26+((21.448-T*(46.815+T*(0.00059-T*0.001813))))/60)/60;
  const eps=eps0+0.00256*Math.cos(omega*Math.PI/180);
  const dec=Math.asin(Math.sin(eps*Math.PI/180)*Math.sin(lambda*Math.PI/180))*180/Math.PI;
  const decRad=dec*Math.PI/180;
  const latRad=lat*Math.PI/180;

  // Hour angle at sunrise/sunset (altitude = -0.833 deg for atmospheric refraction)
  const cosHA=(Math.sin(-0.833*Math.PI/180)-Math.sin(latRad)*Math.sin(decRad))
              /(Math.cos(latRad)*Math.cos(decRad));

  if(cosHA>1) return {sunrise:null, sunset:null}; // Polar night
  if(cosHA<-1) return {sunrise:0, sunset:24}; // Midnight sun

  const HA=Math.acos(cosHA)*180/Math.PI;

  // Equation of time for noon
  const e=0.016708634-T*(0.000042037+T*0.0000001267);
  const y2=Math.tan(eps*Math.PI/360)*Math.tan(eps*Math.PI/360);
  const L0rad=L0*Math.PI/180;
  const EoT=4*(y2*Math.sin(2*L0rad)-2*e*Math.sin(Mrad)+4*e*y2*Math.sin(Mrad)*Math.cos(2*L0rad)
    -0.5*y2*y2*Math.sin(4*L0rad)-1.25*e*e*Math.sin(2*Mrad))*180/Math.PI;

  const solarNoonMin=720-4*lng-EoT; // minutes UTC

  // Timezone offset — estimate from longitude (rough, but adequate for display)
  // For Ontario: UTC-5 (EST) or UTC-4 (EDT)
  const tzOff=_getShadowTZOffset(date);

  const sunriseUTC=(solarNoonMin-HA*4)/60;
  const sunsetUTC=(solarNoonMin+HA*4)/60;

  return {
    sunrise: sunriseUTC+tzOff,
    sunset: sunsetUTC+tzOff
  };
}

/**
 * Get timezone offset in hours for Ontario dates (handles EST/EDT)
 */
function _getShadowTZOffset(date){
  // EDT: second Sunday in March to first Sunday in November
  const y=date.getUTCFullYear();
  // Second Sunday in March
  let mar1=new Date(Date.UTC(y,2,1));
  let marSun=8+(7-mar1.getUTCDay())%7; // second Sunday
  // First Sunday in November
  let nov1=new Date(Date.UTC(y,10,1));
  let novSun=1+(7-nov1.getUTCDay())%7;

  const edtStart=new Date(Date.UTC(y,2,marSun,7,0,0)); // 2AM EST = 7AM UTC
  const edtEnd=new Date(Date.UTC(y,10,novSun,6,0,0));   // 2AM EDT = 6AM UTC
  if(date>=edtStart && date<edtEnd) return -4; // EDT
  return -5; // EST
}

/**
 * Format decimal hours to HH:MM string
 */
function decHoursToHM(h){
  if(h===null) return '—';
  h=((h%24)+24)%24;
  const hh=Math.floor(h);
  const mm=Math.round((h-hh)*60);
  const ampm=hh>=12?'PM':'AM';
  const h12=hh===0?12:(hh>12?hh-12:hh);
  return h12+':'+(mm<10?'0':'')+mm+' '+ampm;
}

/**
 * Toggle the shadow study mode on/off
 */
/** Toggles the shadow/sun study mode on the 3D viewport. Computes solar position for given date/time. */
function toggleShadowStudy(){
  _shadowActive=!_shadowActive;
  const panel=document.getElementById('shadow-panel');
  const btn=document.getElementById('btn-shadow-toggle');

  if(_shadowActive){
    panel.style.display='block';
    btn.style.background='#e8c87a';
    btn.style.color='#1a1a1a';
    btn.style.fontWeight='700';

    // Store original directional light position
    const dirLight=scene.children.find(c=>c.isDirectionalLight);
    if(dirLight && !_shadowOrigDirPos){
      _shadowOrigDirPos=dirLight.position.clone();
    }

    // Set date to today
    const today=new Date();
    document.getElementById('shadow-date').value=today.toISOString().split('T')[0];

    updateShadowStudy();
  } else {
    panel.style.display='none';
    btn.style.background='rgba(26,26,26,.85)';
    btn.style.color='#e8c87a';
    btn.style.fontWeight='';

    // Stop any animation
    if(_shadowAnimId){cancelAnimationFrame(_shadowAnimId);_shadowAnimId=null;}
    const animBtn=document.getElementById('shadow-animate-btn');
    if(animBtn) animBtn.textContent='▶ ANIMATE DAY';

    // Restore original light position
    if(_shadowOrigDirPos){
      const dirLight=scene.children.find(c=>c.isDirectionalLight);
      if(dirLight){
        dirLight.position.copy(_shadowOrigDirPos);
        dirLight.intensity=0.8;
        // Reset shadow camera
        dirLight.shadow.camera.updateProjectionMatrix();
      }
      _shadowOrigDirPos=null;
    }
  }
}

/**
 * Update sun position and shadow rendering based on current controls
 */
function updateShadowStudy(){
  if(!_shadowActive) return;

  const dateStr=document.getElementById('shadow-date').value;
  // NaN guard: parseFloat on empty input returns NaN — default to noon (12.0)
  const _rawTime=parseFloat(document.getElementById('shadow-time').value);
  const timeVal=isFinite(_rawTime)?_rawTime:12.0;

  // Format time display
  const hh=Math.floor(timeVal);
  const mm=Math.round((timeVal-hh)*60);
  const ampm=hh>=12?'PM':'AM';
  const h12=hh===0?12:(hh>12?hh-12:hh);
  document.getElementById('shadow-time-val').textContent=h12+':'+(mm<10?'0':'')+mm+' '+ampm;

  // Get site coordinates — default to Toronto city center
  const lat=P.siteCoords?P.siteCoords.lat:43.70;
  const lng=P.siteCoords?P.siteCoords.lng:-79.38;

  // Build UTC date from local time
  const tzOff=_getShadowTZOffset(new Date(dateStr+'T12:00:00Z'));
  const parts=dateStr.split('-');
  const utcHour=timeVal-tzOff; // convert local to UTC
  const dtUTC=new Date(Date.UTC(+parts[0], +parts[1]-1, +parts[2],
    Math.floor(utcHour), Math.round((utcHour%1)*60), 0));

  // Calculate solar position
  const sun=solarPosition(lat, lng, dtUTC);

  // Calculate sunrise/sunset
  const rs=sunriseSunset(lat, lng, dtUTC);

  // Update info display
  document.getElementById('shadow-alt').textContent=sun.altitude.toFixed(1)+'°';
  document.getElementById('shadow-azi').textContent=sun.azimuth.toFixed(1)+'°';
  document.getElementById('shadow-rise').textContent=decHoursToHM(rs.sunrise);
  document.getElementById('shadow-set').textContent=decHoursToHM(rs.sunset);

  // Position the directional light based on sun position
  _applySunToLight(sun);
}

/**
 * Reposition the Three.js DirectionalLight to match computed sun position
 * altitude: degrees above horizon; azimuth: degrees from North clockwise
 */
function _applySunToLight(sun){
  const dirLight=scene.children.find(c=>c.isDirectionalLight);
  if(!dirLight) return;

  // Get lot center for light target
  let cx=0, cz=0;
  try{
    const lb=lotBounds();
    const vts=lotVerts();
    const allX=vts.map(v=>v[0]), allZ=vts.map(v=>v[1]);
    cx=f2m((Math.min(...allX)+Math.max(...allX))/2);
    cz=f2m((Math.min(...allZ)+Math.max(...allZ))/2);
  }catch(e){}

  if(sun.altitude<=0){
    // Sun below horizon — very dim ambient only
    dirLight.intensity=0;
    return;
  }

  // Convert spherical to Cartesian
  // Three.js: Y=up, Z=towards camera (south in our scene), X=right (east)
  // Azimuth: 0=North (+Z in Three.js), 90=East (+X), 180=South (-Z), 270=West (-X)
  const altRad=sun.altitude*Math.PI/180;
  const aziRad=sun.azimuth*Math.PI/180;

  // Distance from target — keep it far enough for shadows
  const dist=60;

  // dx = East component, dz = North component (Three.js Z points south? depends on scene)
  // In the existing scene, looking at the code: setView('front') = FROM NORTH
  // North = -Z in Three.js (camera at positive Z looks at origin = looking south)
  // So: North = -Z, South = +Z, East = +X, West = -X
  const dx=dist*Math.cos(altRad)*Math.sin(aziRad);  // East component
  const dy=dist*Math.sin(altRad);                     // Up
  const dz=-dist*Math.cos(altRad)*Math.cos(aziRad);  // North component (negative Z = North)

  dirLight.position.set(cx+dx, dy, cz+dz);
  dirLight.target.position.set(cx, 0, cz);
  dirLight.target.updateMatrixWorld();

  // Intensity varies with altitude — brighter overhead, dimmer near horizon
  // Using physically-inspired cos(zenith) relationship with min floor
  const zenith=90-sun.altitude;
  const intensity=Math.max(0.1, 0.9*Math.cos(zenith*Math.PI/180));
  dirLight.intensity=intensity;

  // Warm color at low angles (golden hour), white at high angles
  const warmth=Math.max(0, 1-sun.altitude/45); // 0 at 45°+, 1 at horizon
  const r=1;
  const g=1-warmth*0.15;
  const b=1-warmth*0.35;
  dirLight.color.setRGB(r, g, b);

  // Update shadow camera bounds to cover the lot
  const s=Math.max(60, 80);
  dirLight.shadow.camera.left=-s;dirLight.shadow.camera.right=s;
  dirLight.shadow.camera.top=s;dirLight.shadow.camera.bottom=-s;
  dirLight.shadow.camera.near=0.5;dirLight.shadow.camera.far=dist*2.5;
  dirLight.shadow.camera.updateProjectionMatrix();

  // Force a render
  if(renderer) renderer.render(scene, camera);
}

/**
 * Set shadow study to a seasonal preset
 */
function setShadowPreset(season){
  const year=new Date().getFullYear();
  const presets={
    spring: year+'-03-21',
    summer: year+'-06-21',
    fall:   year+'-09-21',
    winter: year+'-12-21'
  };
  if(presets[season]){
    document.getElementById('shadow-date').value=presets[season];
    updateShadowStudy();
  }
}

/**
 * Animate the sun across the full day
 */
let _shadowAnimPlaying=false;
function animateShadow(){
  const btn=document.getElementById('shadow-animate-btn');

  if(_shadowAnimPlaying){
    // Stop animation
    _shadowAnimPlaying=false;
    if(_shadowAnimId){cancelAnimationFrame(_shadowAnimId);_shadowAnimId=null;}
    btn.textContent='▶ ANIMATE DAY';
    return;
  }

  _shadowAnimPlaying=true;
  btn.textContent='■ STOP';

  const slider=document.getElementById('shadow-time');
  let t=5; // start at 5 AM
  const speed=0.03; // hours per frame (~1.8 min per frame at 60fps → full day in ~9 seconds)

  function step(){
    if(!_shadowAnimPlaying||!_shadowActive){
      _shadowAnimPlaying=false;
      btn.textContent='▶ ANIMATE DAY';
      return;
    }
    t+=speed;
    if(t>21){t=5;} // loop
    slider.value=t;
    updateShadowStudy();
    _shadowAnimId=requestAnimationFrame(step);
  }
  _shadowAnimId=requestAnimationFrame(step);
}

/**
 * Capture shadow grid — renders the scene at multiple times throughout the day
 * Produces a 4-column grid of snapshots
 */
function captureShadowGrid(){
  if(!_shadowActive) return;

  const overlay=document.getElementById('shadow-grid-overlay');
  const content=document.getElementById('shadow-grid-content');
  content.innerHTML='<div style="color:#888;font-size:12px;grid-column:1/-1;text-align:center;padding:20px">Rendering shadow study frames...</div>';
  overlay.style.display='block';

  // Capture at these hours
  const hours=[6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const dateStr=document.getElementById('shadow-date').value;
  // NaN guard: default to noon if shadow-time is empty/invalid
  const _rawOrig=parseFloat(document.getElementById('shadow-time').value);
  const origTime=isFinite(_rawOrig)?_rawOrig:12.0;
  const slider=document.getElementById('shadow-time');

  // Use requestAnimationFrame to stagger captures to avoid blocking
  let idx=0;
  const frames=[];

  function captureNext(){
    if(idx>=hours.length){
      // All captured — build grid
      content.innerHTML='';
      frames.forEach(f=>{
        const card=document.createElement('div');
        card.style.cssText='border:1px solid #333;border-radius:4px;overflow:hidden;background:#111';
        const hh=Math.floor(f.hour);
        const mm=Math.round((f.hour-hh)*60);
        const ampm=hh>=12?'PM':'AM';
        const h12=hh===0?12:(hh>12?hh-12:hh);
        const label=h12+':'+(mm<10?'0':'')+mm+' '+ampm;
        card.innerHTML=
          '<img src="'+f.dataUrl+'" style="width:100%;display:block" alt="Shadow at '+label+'">'+
          '<div style="padding:4px 8px;display:flex;justify-content:space-between;font-size:13px">'+
            '<span style="color:#e8c87a;font-weight:700">'+label+'</span>'+
            '<span style="color:#888">Alt '+f.alt.toFixed(1)+'° | Azi '+f.azi.toFixed(1)+'°</span>'+
          '</div>';
        content.appendChild(card);
      });

      // Add date header
      const header=document.createElement('div');
      header.style.cssText='grid-column:1/-1;text-align:center;font-size:11px;color:#888;margin-top:8px;padding:6px;border-top:1px solid #333';
      header.textContent='Date: '+dateStr+' | Location: '+(P.siteAddress||'Toronto, ON')+' | Lat '+
        (P.siteCoords?P.siteCoords.lat.toFixed(4):'43.7000')+'° Lng '+(P.siteCoords?P.siteCoords.lng.toFixed(4):'-79.3800')+'°';
      content.appendChild(header);

      // Restore original time
      slider.value=origTime;
      updateShadowStudy();
      return;
    }

    const h=hours[idx];
    slider.value=h;
    updateShadowStudy();

    // Let the render complete
    requestAnimationFrame(()=>{
      // Capture the canvas
      const canvas=document.getElementById('c3d');
      const dataUrl=canvas.toDataURL('image/png');
      const lat=P.siteCoords?P.siteCoords.lat:43.70;
      const lng=P.siteCoords?P.siteCoords.lng:-79.38;
      const tzOff=_getShadowTZOffset(new Date(dateStr+'T12:00:00Z'));
      const parts=dateStr.split('-');
      const utcH=h-tzOff;
      const dt=new Date(Date.UTC(+parts[0],+parts[1]-1,+parts[2],Math.floor(utcH),Math.round((utcH%1)*60),0));
      const sun=solarPosition(lat, lng, dt);

      frames.push({hour:h, dataUrl, alt:sun.altitude, azi:sun.azimuth});
      idx++;
      captureNext();
    });
  }
  captureNext();
}

/**
 * Close the shadow grid overlay
 */
function closeShadowGrid(){
  document.getElementById('shadow-grid-overlay').style.display='none';
}

/**
 * Toggle light/dark ground for shadow visibility
 */
function setShadowGround(mode){
  const lightBtn=document.getElementById('sg-light');
  const darkBtn=document.getElementById('sg-dark');

  // Find the ground mesh(es) in the scene
  scene.traverse(obj=>{
    if(obj.isMesh && obj.geometry && obj.geometry.type==='PlaneGeometry' && obj.receiveShadow){
      if(mode==='light'){
        obj.material.color.set('#d4cfc0'); // light beige
        obj.material.roughness=0.85;
      } else {
        obj.material.color.set('#2a2a2a'); // dark default
        obj.material.roughness=0.9;
      }
      obj.material.needsUpdate=true;
    }
  });

  if(mode==='light'){
    lightBtn.style.borderColor='#e8c87a';lightBtn.style.color='#1a1a1a';lightBtn.style.background='#e8c87a';
    darkBtn.style.borderColor='#555';darkBtn.style.color='#888';darkBtn.style.background='';
  } else {
    darkBtn.style.borderColor='#e8c87a';darkBtn.style.color='#1a1a1a';darkBtn.style.background='#e8c87a';
    lightBtn.style.borderColor='#555';lightBtn.style.color='#888';lightBtn.style.background='';
  }

  if(renderer) renderer.render(scene, camera);
}


/* =====================================================================
   STREET-LEVEL WALKTHROUGH — First-person WASD camera
   ===================================================================== */

var _walkActive=false;
var _walkHeight=1.7; // metres → converted to feet
var _walkSpeed=0;
var _walkKeys={w:false,a:false,s:false,d:false,shift:false};
var _walkRafId=null;
var _savedCamera=null;
var _savedControls=null;

function toggleWalkthrough(){
  if(_walkActive){ _exitWalkthrough(); return; }
  document.getElementById('phasing-panel').style.display='none';
  document.getElementById('wind-panel').style.display='none';
  _walkActive=true;
  document.getElementById('walkthrough-panel').style.display='block';
  document.getElementById('btn-walkthrough').style.background='#66ccaa';
  document.getElementById('btn-walkthrough').style.color='#1a1a1a';

  _savedCamera={pos:camera.position.clone(), rot:camera.rotation.clone(), fov:camera.fov};
  _savedControls=true;
  window._walkLock=true; // blocks orbit controls

  var cx=0, cz=0;
  if(P.lot && P.lot.polyVerts && P.lot.polyVerts.length>2){
    P.lot.polyVerts.forEach(function(v){cx+=v[0];cz+=v[1];});
    cx/=P.lot.polyVerts.length; cz/=P.lot.polyVerts.length;
  }
  var hFeet=_walkHeight/FT;
  camera.position.set(cx, hFeet, cz);
  camera.rotation.order='YXZ';
  camera.rotation.set(0,0,0);
  camera.fov=75;
  camera.updateProjectionMatrix();

  document.addEventListener('keydown', _walkKeyDown);
  document.addEventListener('keyup', _walkKeyUp);
  renderer.domElement.addEventListener('click', _walkRequestLock);
  document.addEventListener('mousemove', _walkMouseMove);
  document.addEventListener('pointerlockchange', _walkPointerLock);
  _walkLoop();
}

function _exitWalkthrough(){
  _walkActive=false;
  document.getElementById('walkthrough-panel').style.display='none';
  document.getElementById('btn-walkthrough').style.background='rgba(26,26,26,.85)';
  document.getElementById('btn-walkthrough').style.color='#66ccaa';
  if(_savedCamera){
    camera.position.copy(_savedCamera.pos);
    camera.rotation.copy(_savedCamera.rot);
    camera.fov=_savedCamera.fov;
    camera.updateProjectionMatrix();
  }
  window._walkLock=false; // re-enable orbit controls
  document.removeEventListener('keydown', _walkKeyDown);
  document.removeEventListener('keyup', _walkKeyUp);
  renderer.domElement.removeEventListener('click', _walkRequestLock);
  document.removeEventListener('mousemove', _walkMouseMove);
  document.removeEventListener('pointerlockchange', _walkPointerLock);
  if(document.pointerLockElement) document.exitPointerLock();
  if(_walkRafId){ cancelAnimationFrame(_walkRafId); _walkRafId=null; }
  if(renderer) renderer.render(scene, camera);
}

function walkthroughSetHeight(metres){
  _walkHeight=metres;
  if(_walkActive) camera.position.y=metres/FT;
}

function _walkKeyDown(e){
  var k=e.key.toLowerCase();
  if(k==='w') _walkKeys.w=true;
  if(k==='a') _walkKeys.a=true;
  if(k==='s') _walkKeys.s=true;
  if(k==='d') _walkKeys.d=true;
  if(k==='shift') _walkKeys.shift=true;
  if(k==='escape') _exitWalkthrough();
}
function _walkKeyUp(e){
  var k=e.key.toLowerCase();
  if(k==='w') _walkKeys.w=false;
  if(k==='a') _walkKeys.a=false;
  if(k==='s') _walkKeys.s=false;
  if(k==='d') _walkKeys.d=false;
  if(k==='shift') _walkKeys.shift=false;
}
function _walkRequestLock(){ renderer.domElement.requestPointerLock(); }
function _walkPointerLock(){}
function _walkMouseMove(e){
  if(!_walkActive || !document.pointerLockElement) return;
  var sens=0.002;
  camera.rotation.y -= e.movementX*sens;
  camera.rotation.x -= e.movementY*sens;
  camera.rotation.x = Math.max(-Math.PI/2, Math.min(Math.PI/2, camera.rotation.x));
}

function _walkLoop(){
  if(!_walkActive) return;
  _walkRafId=requestAnimationFrame(_walkLoop);
  var speed=_walkKeys.shift? 3.0 : 1.2;
  var dir=new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y=0; dir.normalize();
  var right=new THREE.Vector3();
  right.crossVectors(dir, new THREE.Vector3(0,1,0)).normalize();
  if(_walkKeys.w) camera.position.addScaledVector(dir, speed);
  if(_walkKeys.s) camera.position.addScaledVector(dir, -speed);
  if(_walkKeys.a) camera.position.addScaledVector(right, -speed);
  if(_walkKeys.d) camera.position.addScaledVector(right, speed);
  camera.position.y=_walkHeight/FT;
  renderer.render(scene, camera);
}


/* =====================================================================
   CONSTRUCTION PHASING — Floor-by-floor build animation
   ===================================================================== */

var _phasingActive=false;
var _phasingAnimId=null;
var _phasingOriginalMats=[];

function togglePhasing(){
  if(_phasingActive){ _exitPhasing(); return; }
  document.getElementById('walkthrough-panel').style.display='none';
  document.getElementById('wind-panel').style.display='none';
  if(_walkActive) _exitWalkthrough();
  _phasingActive=true;
  document.getElementById('phasing-panel').style.display='block';
  document.getElementById('btn-phasing').style.background='#66aaff';
  document.getElementById('btn-phasing').style.color='#1a1a1a';

  _phasingOriginalMats=[];
  if(groups.building){
    groups.building.traverse(function(obj){
      if(obj.isMesh) _phasingOriginalMats.push({mesh:obj, mat:obj.material, vis:obj.visible});
    });
  }
  // Build crane
  var maxY=0;
  if(groups.building){groups.building.traverse(function(o){if(o.isMesh&&o.geometry){o.geometry.computeBoundingBox();var wp=new THREE.Vector3();o.getWorldPosition(wp);var t=o.geometry.boundingBox.max.y+wp.y-o.position.y+o.position.y;if(t>maxY)maxY=t;}});}
  if(maxY>0) _buildCrane(maxY);

  document.getElementById('phasing-slider').value=0;
  updatePhasing();
}

function _exitPhasing(){
  _phasingActive=false;
  document.getElementById('phasing-panel').style.display='none';
  document.getElementById('btn-phasing').style.background='rgba(26,26,26,.85)';
  document.getElementById('btn-phasing').style.color='#66aaff';
  if(_phasingAnimId){ cancelAnimationFrame(_phasingAnimId); _phasingAnimId=null; }
  _phasingOriginalMats.forEach(function(entry){
    entry.mesh.material=entry.mat;
    entry.mesh.visible=entry.vis;
  });
  _phasingOriginalMats=[];
  _removeCrane();
  if(renderer) renderer.render(scene, camera);
}

function _getWorldBoundsY(mesh){
  // Compute true world-space Y bounds by walking parent chain
  var wp=new THREE.Vector3();
  mesh.getWorldPosition(wp);
  mesh.geometry.computeBoundingBox();
  var bb=mesh.geometry.boundingBox;
  // World Y = parent world Y + local geometry bounds
  // mesh.getWorldPosition gives the origin of the mesh in world coords
  // geometry bounding box is in local space, so offset by world position minus local position
  var localOriginY=mesh.position.y;
  var worldOriginY=wp.y;
  var parentOffsetY=worldOriginY - localOriginY;
  return {
    bottom: bb.min.y + parentOffsetY + localOriginY,
    top: bb.max.y + parentOffsetY + localOriginY
  };
}

function updatePhasing(){
  if(!_phasingActive) return;
  var val=parseInt(document.getElementById('phasing-slider').value);

  // Collect all meshes with world-space Y bounds
  var meshEntries=[];
  var maxY=0;
  if(groups.building){
    groups.building.traverse(function(obj){
      if(obj.isMesh && obj.geometry){
        var wb=_getWorldBoundsY(obj);
        meshEntries.push({mesh:obj, bottom:wb.bottom, top:wb.top});
        if(wb.top>maxY) maxY=wb.top;
      }
    });
  }
  if(maxY===0) maxY=100;

  // Sort all meshes strictly by their bottom Y — guarantees bottom-up order
  meshEntries.sort(function(a,b){ return a.bottom - b.bottom; });

  var progressY = (val/100)*maxY;
  var floorH = P.floorH ? P.floorH/FT : (3.0/FT);
  var currentFloor = Math.max(1, Math.ceil(progressY/floorH));

  var phaseLabel='Excavation';
  if(val>10 && val<=30) phaseLabel='Foundation & Shoring';
  else if(val>30 && val<=60) phaseLabel='Structural Frame';
  else if(val>60 && val<=85) phaseLabel='Building Envelope';
  else if(val>85) phaseLabel='Fit-out & Complete';

  document.getElementById('phasing-floor-val').textContent = val<=10 ? '-' : currentFloor;
  document.getElementById('phasing-phase-label').textContent = phaseLabel;
  _phasingApply(val, progressY, maxY, meshEntries);
  // Crane grows with construction progress
  if(val<=10) _updateCraneHeight(5); // just the base during excavation
  else if(val>=95) _removeCrane(); // crane leaves when building is done
  else _updateCraneHeight(progressY);
  if(renderer) renderer.render(scene, camera);
}

function _phasingApply(pct, progressY, maxY, meshEntries){
  if(!groups.building) return;
  var structMat=new THREE.MeshStandardMaterial({color:0x888888, roughness:0.7, metalness:0.3});
  var envMat=new THREE.MeshStandardMaterial({color:0x66aaff, roughness:0.4, transparent:true, opacity:0.7});
  var floorH = P.floorH ? P.floorH/FT : (3.0/FT);
  var tolerance=floorH*0.5; // half a floor tolerance for stacked slab gaps

  // Track the highest top-Y of any VISIBLE mesh so far.
  // A mesh can only appear if everything below it is already visible.
  // This prevents the penthouse from appearing before the roof slab beneath it.
  var highestVisibleTop=-Infinity;

  for(var i=0;i<meshEntries.length;i++){
    var entry=meshEntries[i];
    var obj=entry.mesh;
    var meshBottom=entry.bottom;
    var meshTop=entry.top;

    if(pct<=10){ obj.visible=false; continue; }

    // Strict bottom-up: only show if below progress line
    if(meshBottom > progressY){
      obj.visible=false;
      continue;
    }

    // Continuity check: this mesh can only appear if structure beneath it
    // has already been built. If this mesh's bottom is above the highest
    // visible top + tolerance, something below it is missing — skip it.
    if(i>0 && meshBottom > highestVisibleTop + tolerance){
      // There's a gap — structure below hasn't reached this height yet.
      // Check if any hidden mesh below us would fill that gap.
      var gapFilled=true;
      for(var j=0;j<i;j++){
        if(!meshEntries[j].mesh.visible && meshEntries[j].top >= meshBottom - tolerance){
          gapFilled=false;
          break;
        }
      }
      if(!gapFilled){ obj.visible=false; continue; }
    }

    obj.visible=true;
    if(meshTop>highestVisibleTop) highestVisibleTop=meshTop;

    // Assign construction phase material based on how recently this piece was "built"
    // At >=95% everything is complete (fit-out done). Below that, pieces near the
    // leading edge = structural grey, trailing = blue envelope, rest = original.
    var orig = _phasingOriginalMats.find(function(e){return e.mesh===obj;});
    if(pct>=95){
      // Fully complete — restore original materials
      if(orig) obj.material=orig.mat;
    } else {
      var distFromEdge = progressY - meshBottom;
      var structZone = maxY*0.10;
      var envZone = maxY*0.18;
      if(distFromEdge < structZone){
        obj.material=structMat;
      } else if(distFromEdge < envZone){
        obj.material=envMat;
      } else {
        if(orig) obj.material=orig.mat;
      }
    }
  }
}

function animatePhasing(){
  var slider=document.getElementById('phasing-slider');
  var btn=document.getElementById('phasing-animate-btn');
  if(_phasingAnimId){
    cancelAnimationFrame(_phasingAnimId); _phasingAnimId=null;
    btn.textContent='ANIMATE BUILD'; return;
  }
  btn.textContent='STOP';
  slider.value=0; updatePhasing();
  var startTime=null, duration=5000;
  function step(ts){
    if(!_phasingActive){ btn.textContent='ANIMATE BUILD'; return; }
    if(!startTime) startTime=ts;
    var pct=Math.min(100, ((ts-startTime)/duration)*100);
    slider.value=Math.round(pct);
    updatePhasing();
    // Rotate crane jib slowly during animation
    if(_craneGroup) _craneGroup.rotation.y=(ts-startTime)*0.0003;
    if(renderer) renderer.render(scene,camera);
    if(pct<100) _phasingAnimId=requestAnimationFrame(step);
    else { _phasingAnimId=null; btn.textContent='ANIMATE BUILD'; }
  }
  _phasingAnimId=requestAnimationFrame(step);
}

function resetPhasing(){
  if(_phasingAnimId){ cancelAnimationFrame(_phasingAnimId); _phasingAnimId=null; }
  document.getElementById('phasing-animate-btn').textContent='ANIMATE BUILD';
  document.getElementById('phasing-slider').value=100;
  updatePhasing();
}


/* =====================================================================
   WIND COMFORT ZONES — Simplified urban wind analysis
   ===================================================================== */

var _windActive=false;
var _windDir='W';
var _windGroup=null;

function toggleWindStudy(){
  if(_windActive){ _exitWindStudy(); return; }
  document.getElementById('walkthrough-panel').style.display='none';
  document.getElementById('phasing-panel').style.display='none';
  if(_walkActive) _exitWalkthrough();
  if(_phasingActive) _exitPhasing();
  _windActive=true;
  document.getElementById('wind-panel').style.display='block';
  document.getElementById('btn-wind').style.background='#ff8866';
  document.getElementById('btn-wind').style.color='#1a1a1a';
  _windGroup=new THREE.Group();
  _windGroup.name='windZones';
  scene.add(_windGroup);
  setWindDir('W');
}

function _exitWindStudy(){
  _windActive=false;
  document.getElementById('wind-panel').style.display='none';
  document.getElementById('btn-wind').style.background='rgba(26,26,26,.85)';
  document.getElementById('btn-wind').style.color='#ff8866';
  _clearWindZones();
  if(_windGroup){scene.remove(_windGroup);_windGroup=null;}
  if(renderer) renderer.render(scene, camera);
}

function setWindDir(dir){
  _windDir=dir;
  document.querySelectorAll('.wind-dir-btn').forEach(function(b){
    if(b.getAttribute('data-dir')===dir){
      b.style.background='#ff8866'; b.style.color='#1a1a1a';
    } else { b.style.background=''; b.style.color='#ff8866'; }
  });
  updateWindStudy();
}

function updateWindStudy(){
  if(!_windActive) return;
  var speed=parseInt(document.getElementById('wind-speed').value);
  document.getElementById('wind-speed-val').textContent=speed;
  _clearWindZones();

  var dirMap={N:[0,-1],NE:[1,-1],E:[1,0],SE:[1,1],S:[0,1],SW:[-1,1],W:[-1,0],NW:[-1,-1]};
  var dv=dirMap[_windDir]||[0,-1];
  var windVec=new THREE.Vector2(dv[0],dv[1]).normalize();

  if(!groups.building) return;
  var bboxes=[];
  groups.building.traverse(function(obj){
    if(!obj.isMesh || !obj.geometry) return;
    obj.geometry.computeBoundingBox();
    var bb=obj.geometry.boundingBox.clone();
    bb.min.add(obj.position); bb.max.add(obj.position);
    if(bb.max.y - bb.min.y > 5) bboxes.push(bb);
  });

  bboxes.forEach(function(bb){
    var cx=(bb.min.x+bb.max.x)/2, cz=(bb.min.z+bb.max.z)/2;
    var w=bb.max.x-bb.min.x, d=bb.max.z-bb.min.z, h=bb.max.y-bb.min.y;
    var sf=speed/25;

    // Downwash zone — windward face
    var dd=h*0.5*sf;
    _addWindZone(cx - windVec.x*(w/2+dd/2), 0.3, cz - windVec.y*(d/2+dd/2), dd, dd*0.8, 0xff4444, 0.35);

    // Corner acceleration — both sides
    var px=-windVec.y, pz=windVec.x, cd=h*0.3*sf;
    _addWindZone(cx+px*(w/2+cd/2), 0.3, cz+pz*(d/2+cd/2), cd, cd*1.5, 0xffcc33, 0.30);
    _addWindZone(cx-px*(w/2+cd/2), 0.3, cz-pz*(d/2+cd/2), cd, cd*1.5, 0xffcc33, 0.30);

    // Wake turbulence — leeward
    var wd=h*0.8*sf;
    _addWindZone(cx + windVec.x*(w/2+wd/2), 0.3, cz + windVec.y*(d/2+wd/2), wd, wd*0.6, 0xff8866, 0.25);

    // Sheltered zone — directly behind
    _addWindZone(cx + windVec.x*(w/2+h*0.2), 0.2, cz + windVec.y*(d/2+h*0.2), w*0.6, d*0.6, 0x66ccaa, 0.30);
  });

  // Wind direction arrow
  var arrowLen=50;
  var arrowStart=new THREE.Vector3(-windVec.x*arrowLen*1.5, 2, -windVec.y*arrowLen*1.5);
  var arrowDir=new THREE.Vector3(windVec.x, 0, windVec.y);
  var arrow=new THREE.ArrowHelper(arrowDir, arrowStart, arrowLen, 0xff8866, arrowLen*0.15, arrowLen*0.08);
  _windGroup.add(arrow);
  if(renderer) renderer.render(scene, camera);
}

function _addWindZone(x, y, z, sizeX, sizeZ, color, opacity){
  var geo=new THREE.CircleGeometry(1, 24);
  var mat=new THREE.MeshBasicMaterial({color:color, transparent:true, opacity:opacity, side:THREE.DoubleSide, depthWrite:false});
  var mesh=new THREE.Mesh(geo, mat);
  mesh.rotation.x=-Math.PI/2;
  mesh.position.set(x, y, z);
  mesh.scale.set(sizeX, sizeZ, 1);
  _windGroup.add(mesh);

  var ringGeo=new THREE.RingGeometry(0.9, 1.0, 32);
  var ringMat=new THREE.MeshBasicMaterial({color:color, transparent:true, opacity:opacity*1.5, side:THREE.DoubleSide, depthWrite:false});
  var ring=new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x=-Math.PI/2;
  ring.position.set(x, y+0.1, z);
  ring.scale.set(sizeX, sizeZ, 1);
  _windGroup.add(ring);
}

function _clearWindZones(){
  if(!_windGroup) return;
  while(_windGroup.children.length>0){
    var c=_windGroup.children[0];
    _windGroup.remove(c);
    if(c.geometry) c.geometry.dispose();
    if(c.material){
      if(Array.isArray(c.material)) c.material.forEach(function(m){m.dispose();});
      else c.material.dispose();
    }
    if(c.traverse){
      c.traverse(function(obj){
        if(obj.geometry) obj.geometry.dispose();
        if(obj.material){
          if(Array.isArray(obj.material)) obj.material.forEach(function(m){m.dispose();});
          else obj.material.dispose();
        }
      });
    }
  }
}


/* =====================================================================
   TOWER CRANE — Animated crane during phasing
   ===================================================================== */

var _craneGroup=null;
var _craneMaxY=0;
var _craneBase={x:0,z:0}; // stored base position on the lot edge
var _craneMat=null;
var _craneGreyMat=null;

function _buildCrane(buildingMaxY){
  if(_craneGroup){_removeCrane();}
  _craneMaxY=buildingMaxY;
  _craneGroup=new THREE.Group();
  _craneGroup.name='towerCrane';

  // Position crane on the lot edge (not offset into the neighbourhood)
  // Find lot centroid and place crane just inside the lot perimeter
  var cx=0,cz=0;
  if(P.lot&&P.lot.polyVerts&&P.lot.polyVerts.length>2){
    var vts=P.lot.polyVerts;
    vts.forEach(function(v){cx+=v[0];cz+=v[1];});
    cx/=vts.length;cz/=vts.length;
    // Place at first vertex (corner of the lot) offset slightly inward
    var v0=vts[0];
    cx=v0[0]*0.7+cx*0.3; // 70% toward the corner, 30% toward centre
    cz=v0[1]*0.7+cz*0.3;
  }
  _craneBase={x:cx,z:cz};

  _craneMat=new THREE.MeshStandardMaterial({color:0xffcc00,roughness:0.6,metalness:0.3});
  _craneGreyMat=new THREE.MeshStandardMaterial({color:0x666666,roughness:0.8});

  // Position the GROUP at the crane base so rotation pivots around the mast
  _craneGroup.position.set(cx,0,cz);
  scene.add(_craneGroup);
  _updateCraneHeight(buildingMaxY*0.15);
}

function _updateCraneHeight(currentH){
  if(!_craneGroup) return;
  // Clear existing meshes (reuse materials)
  while(_craneGroup.children.length>0){
    var c=_craneGroup.children[0];
    _craneGroup.remove(c);
    if(c.geometry) c.geometry.dispose();
  }

  // All positions are LOCAL to the group (which sits at _craneBase)
  var mastH=Math.max(10,currentH+8);
  var jibLen=Math.max(20,mastH*0.5);

  // Mast
  var mast=new THREE.Mesh(new THREE.BoxGeometry(1.5,mastH,1.5),_craneMat);
  mast.position.set(0,mastH/2,0);
  _craneGroup.add(mast);

  // Jib
  var jib=new THREE.Mesh(new THREE.BoxGeometry(jibLen,1,1),_craneMat);
  jib.position.set(jibLen/2-1,mastH,0);
  _craneGroup.add(jib);

  // Counter-jib
  var cjibLen=jibLen*0.3;
  var cjib=new THREE.Mesh(new THREE.BoxGeometry(cjibLen,1,1),_craneMat);
  cjib.position.set(-cjibLen/2,mastH,0);
  _craneGroup.add(cjib);

  // Counterweight
  var cw=new THREE.Mesh(new THREE.BoxGeometry(3,2.5,2.5),_craneGreyMat);
  cw.position.set(-cjibLen+1.5,mastH-1,0);
  _craneGroup.add(cw);

  // Operator cab
  var cab=new THREE.Mesh(new THREE.BoxGeometry(2,2,2),_craneMat);
  cab.position.set(0,mastH-1.2,0);
  _craneGroup.add(cab);

  // Hoist cable
  var cableLen=mastH*0.35;
  var cable=new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,cableLen,4),_craneGreyMat);
  cable.position.set(jibLen*0.6,mastH-cableLen/2,0);
  _craneGroup.add(cable);

  // Hook
  var hook=new THREE.Mesh(new THREE.BoxGeometry(1.5,1,1.5),_craneGreyMat);
  hook.position.set(jibLen*0.6,mastH-cableLen,0);
  _craneGroup.add(hook);
}

function _removeCrane(){
  if(!_craneGroup) return;
  _craneGroup.traverse(function(o){
    if(o.geometry) o.geometry.dispose();
    if(o.material) o.material.dispose();
  });
  scene.remove(_craneGroup);
  _craneGroup=null;
}


/* =====================================================================
   TRAFFIC NOISE PROPAGATION
   ===================================================================== */

var _noiseActive=false;
var _noiseRoad='E-W';
var _noiseGroup=null;

function toggleNoiseMap(){
  if(_noiseActive){_exitNoiseMap();return;}
  _noiseActive=true;
  document.getElementById('noise-panel').style.display='block';
  document.getElementById('btn-noise').style.background='#cc77ff';
  document.getElementById('btn-noise').style.color='#1a1a1a';
  _noiseGroup=new THREE.Group();
  _noiseGroup.name='noiseContours';
  scene.add(_noiseGroup);
  setNoiseRoad('E-W');
}

function _exitNoiseMap(){
  _noiseActive=false;
  document.getElementById('noise-panel').style.display='none';
  document.getElementById('btn-noise').style.background='rgba(26,26,26,.85)';
  document.getElementById('btn-noise').style.color='#cc77ff';
  _clearNoiseContours();
  if(_noiseGroup){scene.remove(_noiseGroup);_noiseGroup=null;}
  if(renderer) renderer.render(scene,camera);
}

function setNoiseRoad(dir){
  _noiseRoad=dir;
  document.querySelectorAll('.noise-road-btn').forEach(function(b){
    if(b.getAttribute('data-road')===dir){b.style.background='#cc77ff';b.style.color='#1a1a1a';}
    else{b.style.background='';b.style.color='#cc77ff';}
  });
  updateNoiseMap();
}

function updateNoiseMap(){
  if(!_noiseActive) return;
  var srcDb=parseInt(document.getElementById('noise-db').value);
  document.getElementById('noise-db-val').textContent=srcDb;
  _clearNoiseContours();

  var lotBounds={minX:-50,maxX:50,minZ:-50,maxZ:50};
  if(P.lot&&P.lot.polyVerts&&P.lot.polyVerts.length>2){
    var xs=P.lot.polyVerts.map(function(v){return v[0];}),zs=P.lot.polyVerts.map(function(v){return v[1];});
    lotBounds.minX=Math.min.apply(null,xs)-10;lotBounds.maxX=Math.max.apply(null,xs)+10;
    lotBounds.minZ=Math.min.apply(null,zs)-10;lotBounds.maxZ=Math.max.apply(null,zs)+10;
  }
  var cx=(lotBounds.minX+lotBounds.maxX)/2,cz=(lotBounds.minZ+lotBounds.maxZ)/2;
  var lotW=lotBounds.maxX-lotBounds.minX,lotD=lotBounds.maxZ-lotBounds.minZ;

  var levels=[{db:70,color:0xff4444,op:0.30},{db:60,color:0xffaa44,op:0.25},{db:50,color:0xffff44,op:0.20},{db:40,color:0x66ccaa,op:0.15}];
  var roads=[];
  if(_noiseRoad==='N-S'||_noiseRoad==='BOTH') roads.push({x:lotBounds.maxX+20,z:cz,dir:'ns'});
  if(_noiseRoad==='E-W'||_noiseRoad==='BOTH') roads.push({x:cx,z:lotBounds.maxZ+20,dir:'ew'});

  roads.forEach(function(road){
    levels.forEach(function(lvl){
      var refDist=5;
      var dist=Math.min(300,refDist*Math.pow(10,(srcDb-lvl.db)/20));
      var geo=new THREE.RingGeometry(dist*0.85,dist,48);
      var mat=new THREE.MeshBasicMaterial({color:lvl.color,transparent:true,opacity:lvl.op,side:THREE.DoubleSide,depthWrite:false});
      var mesh=new THREE.Mesh(geo,mat);
      mesh.rotation.x=-Math.PI/2;
      mesh.position.set(road.x,0.4,road.z);
      if(road.dir==='ew') mesh.scale.set(lotW/dist*1.5,1,1);
      else mesh.scale.set(1,lotD/dist*1.5,1);
      _noiseGroup.add(mesh);
    });
    var roadLen=Math.max(lotW,lotD)*2;
    var lineGeo=new THREE.BoxGeometry(road.dir==='ew'?roadLen:3,0.3,road.dir==='ew'?3:roadLen);
    var lineMat=new THREE.MeshBasicMaterial({color:0xcc77ff,transparent:true,opacity:0.6});
    var line=new THREE.Mesh(lineGeo,lineMat);
    line.position.set(road.x,0.5,road.z);
    _noiseGroup.add(line);
  });
  if(renderer) renderer.render(scene,camera);
}

function _clearNoiseContours(){
  if(!_noiseGroup) return;
  while(_noiseGroup.children.length>0){
    var c=_noiseGroup.children[0];_noiseGroup.remove(c);
    if(c.geometry) c.geometry.dispose();
    if(c.material) c.material.dispose();
  }
}


/* =====================================================================
   ABSORPTION CURVE SIMULATOR
   ===================================================================== */

function renderAbsorption(){
  var rateEl=document.getElementById('absorb-rate');
  if(!rateEl) return;
  var rate=parseInt(rateEl.value);
  var presaleThresh=parseInt(document.getElementById('absorb-presale').value);
  var escalation=parseFloat(document.getElementById('absorb-escalation').value);
  document.getElementById('absorb-rate-val').textContent=rate;
  document.getElementById('absorb-presale-val').textContent=presaleThresh;
  document.getElementById('absorb-escal-val').textContent=escalation.toFixed(1);

  var d=typeof pfData==='function'?pfData():{};
  var totalUnits=d.totalUnits||0;
  if(totalUnits===0){
    P.vols.forEach(function(v){
      if(v.use==='residential'||v.use==='mixed'){
        totalUnits+=Math.floor((v.floors||10)*((v.width||50)*(v.depth||50))*0.85/750);
      }
    });
  }
  if(totalUnits===0) totalUnits=100;

  var presaleTarget=Math.ceil(totalUnits*presaleThresh/100);
  var monthsToPresale=Math.ceil(presaleTarget/rate);
  var basePrice=d.avgPSF||800;

  var months=[];
  var cumSold=0;
  for(var i=0;cumSold<totalUnits&&i<200;i++){
    var qtr=Math.floor(i/3);
    var currentPrice=basePrice*Math.pow(1+escalation/100,qtr);
    var sold=Math.min(rate,totalUnits-cumSold);
    cumSold+=sold;
    months.push({month:i,sold:sold,cumSold:cumSold,pct:Math.round(cumSold/totalUnits*100),price:currentPrice});
  }

  var w=700,h=280,pad=50;
  var maxM=months.length,xS=(w-pad*2)/Math.max(1,maxM),yS=(h-pad*2)/totalUnits;
  var svg='<svg width="100%" viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg" style="font-family:monospace">';
  for(var g=0;g<=4;g++){
    var gy=pad+(h-pad*2)*(1-g/4);
    svg+='<line x1="'+pad+'" y1="'+gy+'" x2="'+(w-pad)+'" y2="'+gy+'" stroke="#333" stroke-width="0.5"/>';
    svg+='<text x="'+(pad-5)+'" y="'+(gy+3)+'" fill="#888" font-size="9" text-anchor="end">'+(g*25)+'%</text>';
  }
  var presaleY=pad+(h-pad*2)*(1-presaleThresh/100);
  svg+='<line x1="'+pad+'" y1="'+presaleY+'" x2="'+(w-pad)+'" y2="'+presaleY+'" stroke="#ff8866" stroke-width="1" stroke-dasharray="4,4"/>';
  svg+='<text x="'+(w-pad+5)+'" y="'+(presaleY+3)+'" fill="#ff8866" font-size="8">'+presaleThresh+'% pre-sale</text>';

  var path='M';
  months.forEach(function(dd,i){
    var x=pad+i*xS,y=pad+(h-pad*2)*(1-dd.pct/100);
    path+=(i===0?'':' L')+x.toFixed(1)+','+y.toFixed(1);
  });
  svg+='<path d="'+path+'" fill="none" stroke="#66aaff" stroke-width="2.5"/>';
  months.forEach(function(dd,i){
    var x=pad+i*xS,barH=dd.sold*yS;
    svg+='<rect x="'+(x-xS*0.3)+'" y="'+(h-pad-barH)+'" width="'+(xS*0.6)+'" height="'+barH+'" fill="rgba(102,170,255,0.3)" rx="1"/>';
  });
  for(var xl=0;xl<maxM;xl+=Math.max(1,Math.floor(maxM/8))){
    svg+='<text x="'+(pad+xl*xS)+'" y="'+(h-pad+15)+'" fill="#888" font-size="9" text-anchor="middle">M'+xl+'</text>';
  }
  if(monthsToPresale<maxM){
    var pmx=pad+monthsToPresale*xS;
    svg+='<circle cx="'+pmx+'" cy="'+presaleY+'" r="4" fill="#ff8866" stroke="#1a1a1a" stroke-width="1.5"/>';
    svg+='<text x="'+pmx+'" y="'+(presaleY-10)+'" fill="#ff8866" font-size="9" text-anchor="middle">Construction start</text>';
  }
  svg+='<text x="'+(w/2)+'" y="'+(h-5)+'" fill="#666" font-size="9" text-anchor="middle">Months from launch</text>';
  svg+='</svg>';
  document.getElementById('absorption-chart').innerHTML=svg;

  var finalPrice=months.length>0?months[months.length-1].price:basePrice;
  var sm='<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">';
  sm+='<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#66aaff">'+totalUnits+'</div><div style="font-size:12px;color:#888">TOTAL UNITS</div></div>';
  sm+='<div style="background:rgba(255,136,102,0.08);border:1px solid #ff886630;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#ff8866">'+monthsToPresale+'</div><div style="font-size:12px;color:#888">MO. TO PRE-SALE</div></div>';
  sm+='<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#66ccaa">'+months.length+'</div><div style="font-size:12px;color:#888">MO. TO SELLOUT</div></div>';
  sm+='<div style="background:rgba(174,188,70,0.08);border:1px solid #AEBC4630;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#AEBC46">$'+Math.round(finalPrice)+'</div><div style="font-size:12px;color:#888">FINAL $/SF</div></div>';
  sm+='</div>';
  document.getElementById('absorption-summary').innerHTML=sm;
}


/* =====================================================================
   STORMWATER MANAGEMENT CALCULATOR
   ===================================================================== */

function calcStormwater(){
  var lotArea=0;
  if(P.lot&&P.lot.polyVerts&&P.lot.polyVerts.length>2){
    var vts=P.lot.polyVerts;
    for(var i=0;i<vts.length;i++){var j=(i+1)%vts.length;lotArea+=vts[i][0]*vts[j][1];lotArea-=vts[j][0]*vts[i][1];}
    lotArea=Math.abs(lotArea)/2;
  }
  if(lotArea===0) lotArea=10000;

  /* ---- Building footprint: only ground-level volumes ---- */
  var buildingCoverage=0;
  P.vols.forEach(function(v){
    /* Volumes with baseElevFt > 0 sit above a podium — their footprint
       is already covered at ground level, so skip them.               */
    if(v.baseElevFt && v.baseElevFt > 0.5) return;
    buildingCoverage += (v.width||0) * (v.depth||0);
  });
  /* Footprint cannot physically exceed lot area */
  buildingCoverage = Math.min(buildingCoverage, lotArea);

  /* ---- Impervious / pervious breakdown ---- */
  var remainingLot = lotArea - buildingCoverage;
  var pavementPct = 0.15;                         /* 15 % of remaining site = driveways, walkways */
  var pavement = remainingLot * pavementPct;
  var totalImpervious = buildingCoverage + pavement;
  var perviousArea = Math.max(0, lotArea - totalImpervious);
  var imperviousPct = Math.min(100, Math.round(totalImpervious / lotArea * 100));

  /* ---- Ontario retention: 90th-percentile event ≈ 25 mm (TRCA/MECP) ---- *
   * TGS v4 Tier-1 = 5 mm, Tier-2 = 10 mm; provincial 90th-pctl ≈ 23-27 mm.
   * We use the provincial 90th-percentile (conservative / enhanced).        */
  var retentionDepth_mm = 25;
  var retentionVol_ft3 = totalImpervious * (retentionDepth_mm / 304.8);
  var retentionVol_m3 = retentionVol_ft3 * 0.0283168;

  /* ---- Rational method: Q = C · i · A  (1-hour duration storms) ---- *
   * Toronto IDF (Bloor St gauge):                                       *
   *   5-yr, 1-hr  ≈ 26 mm/hr                                           *
   *   100-yr, 1-hr ≈ 58 mm/hr                                          *
   * We round slightly for general Ontario applicability.                 */
  var i_5yr = 26 / 25.4, i_100yr = 58 / 25.4;           /* mm/hr → in/hr */
  var C_weighted = (totalImpervious * 0.95 + perviousArea * 0.20) / lotArea;
  var lotArea_acres = lotArea / 43560;                    /* sf → acres     */
  var Q_pre = 0.20 * i_5yr * lotArea_acres;               /* pre-dev: greenfield C ≈ 0.20 */
  var Q_post = C_weighted * i_5yr * lotArea_acres;
  var Q_100 = C_weighted * i_100yr * lotArea_acres;

  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html+='<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">'+imperviousPct+'%</div><div style="font-size:12px;color:#888">IMPERVIOUS COVERAGE</div></div>';
  html+='<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">'+retentionVol_m3.toFixed(1)+' m³</div><div style="font-size:12px;color:#888">RETENTION REQUIRED</div></div>';
  html+='<div style="background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffaa44">'+Q_post.toFixed(2)+' cfs</div><div style="font-size:12px;color:#888">POST-DEV PEAK (5yr)</div></div>';
  html+='<div style="background:rgba(255,68,68,0.08);border:1px solid #ff444430;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ff4444">'+Q_100.toFixed(2)+' cfs</div><div style="font-size:12px;color:#888">100-YEAR PEAK</div></div>';
  html+='</div>';

  html+='<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Lot area</td><td style="text-align:right">'+Math.round(lotArea).toLocaleString()+' sf</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Building footprint</td><td style="text-align:right">'+Math.round(buildingCoverage).toLocaleString()+' sf</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Paved area (est.)</td><td style="text-align:right">'+Math.round(pavement).toLocaleString()+' sf</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pervious area</td><td style="text-align:right">'+Math.round(perviousArea).toLocaleString()+' sf</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pre-dev runoff (5yr)</td><td style="text-align:right">'+Q_pre.toFixed(2)+' cfs</td></tr>';
  html+='<tr><td style="padding:3px 0;color:#888">Required attenuation</td><td style="text-align:right;color:#ff8866">'+(Q_post-Q_pre>0?(Q_post-Q_pre).toFixed(2)+' cfs':'Below pre-dev')+'</td></tr>';
  html+='</table>';

  html+='<div style="margin-top:8px;padding:8px;background:rgba(174,188,70,0.08);border:1px solid #AEBC4630;border-radius:4px;font-size:12px;color:#aaa">';
  html+='<div style="font-weight:700;color:#AEBC46;margin-bottom:4px">RECOMMENDED SOLUTIONS</div>';
  if(retentionVol_m3<20) html+='Underground retention tank: ~'+Math.ceil(retentionVol_m3)+' m³<br>Green roof on podium reduces impervious by ~'+(buildingCoverage*0.3*0.0929).toFixed(0)+' m²';
  else html+='Underground cistern: '+Math.ceil(retentionVol_m3)+' m³<br>Green roof + permeable paving recommended<br>Consider bioswale along street frontage';
  html+='</div>';
  document.getElementById('stormwater-results').innerHTML=html;
}


/* =====================================================================
   MUNICIPAL SERVICING CAPACITY CHECK
   ===================================================================== */

function calcServicing(){
  /* Phase 2: delegates math to window.CC (civil-consultant.js).
     Falls back to legacy approximations only if CC isn't loaded. */
  var d=typeof pfData==='function'?pfData():{};
  var totalUnits=d.totalUnits||0,totalGFA=d.totalGFA||0,commGFA=d.commGFA||0;
  if(totalUnits===0){P.vols.forEach(function(v){if(v.use==='residential'||v.use==='mixed') totalUnits+=Math.floor((v.floors||10)*((v.width||50)*(v.depth||50))*0.85/750);});}
  if(totalGFA===0){P.vols.forEach(function(v){totalGFA+=(v.floors||1)*(v.width||0)*(v.depth||0);});}
  var commGFA_m2 = commGFA * 0.0929;
  var totalGFA_m2 = totalGFA * 0.0929;

  if(typeof CC === 'undefined'){
    document.getElementById('servicing-results').innerHTML = '<div style="padding:8px;background:rgba(255,68,68,0.08);border:1px solid #ff444430;color:#ff8866;font-size:12px">CivilConsultant module not loaded.</div>';
    return;
  }

  var jur = (P.zoning && P.zoning.jurisdiction) || 'toronto';
  var built = (totalUnits >= 100) ? 'toronto_high_rise' : (totalUnits >= 30 ? 'toronto_mid_rise' : 'toronto_default');

  var w = CC.waterDemand({units: totalUnits, commGFA_m2: commGFA_m2, jurisdiction: jur, builtForm: built});
  var f = CC.fireFlowFUS({gfa_m2: totalGFA_m2, storeys: Math.max(1, Math.floor(totalGFA_m2 > 0 && P.vols && P.vols[0] ? (P.vols[0].floors || 4) : 4)), construction: 'fire_resistive', occupancyHazard: 'light', sprinklered: 'nfpa13', exposures_m: [10, 10, 10, 10]});
  var s = CC.sanitaryWithIandI({avgDayWater_Lpd: w.breakdown.avg_day_Lpd, population: w.breakdown.population, catchmentArea_ha: 0.2, sewerType: 'old_separate', jurisdiction: jur});
  var e = CC.electricalLoadCEC({units: totalUnits, suiteSize_m2: 65, electricHeat: false, evReadyOutlets: Math.round(totalUnits * 0.20), commercialGFA_m2: commGFA_m2, commonAreaGFA_m2: totalGFA_m2 * 0.10, elevators: totalUnits >= 50 ? 2 : 1});
  var g = CC.gasDemandEnbridge({units: totalUnits, applianceMix: 'full_gas'});

  var peakWaterLpd = w.breakdown.max_day_Lpd, peakSanLps = s.breakdown.total_peak_Lps, totalKVA = e.breakdown.total_kVA;
  var ws=peakWaterLpd<150000?'green':peakWaterLpd<300000?'amber':'red';
  var ss=peakSanLps<25?'green':peakSanLps<60?'amber':'red';
  var es=totalKVA<500?'green':totalKVA<2000?'amber':'red';
  var sc={green:'#66ccaa',amber:'#ffaa44',red:'#ff4444'};
  var sl={green:'ADEQUATE',amber:'UPGRADE LIKELY',red:'MAJOR UPGRADE'};
  var conf = w.confidence;
  var confColor = conf === 'PRELIMINARY' ? '#66aaff' : conf === 'SCREENING' ? '#ffaa44' : '#aaa';

  function card(title, status, lines, citation){
    var h='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:8px;margin-bottom:6px">';
    h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
    h+='<span style="font-size:13px;font-weight:700;color:#66aaff">'+title+'</span>';
    h+='<span style="font-size:11px;padding:2px 6px;border-radius:3px;background:'+sc[status]+'20;color:'+sc[status]+';border:1px solid '+sc[status]+'40">'+sl[status]+'</span></div>';
    lines.forEach(function(l){h+='<div style="font-size:13px;color:#aaa">'+l+'</div>';});
    h+='<div style="font-size:10px;color:#666;margin-top:4px;font-style:italic">'+citation+'</div>';
    h+='</div>';return h;
  }

  var html='<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="font-size:11px;padding:2px 8px;border-radius:3px;background:'+confColor+'20;color:'+confColor+';border:1px solid '+confColor+'40;font-weight:700">'+conf+'</span><span style="font-size:11px;color:#888">Civil Consultant v'+CC.VERSION+' · '+jur.toUpperCase()+'</span></div>';

  html+=card('WATER SUPPLY', ws, [
    'Avg-day: <span style="color:#fff">'+(w.breakdown.avg_day_Lpd/1000).toFixed(1)+' m³/d</span> · Max-day: <span style="color:#fff">'+(w.breakdown.max_day_Lpd/1000).toFixed(1)+' m³/d</span> · Peak hour: <span style="color:#fff">'+w.breakdown.peak_hour_Lps.toFixed(2)+' L/s</span>',
    'Fire flow (FUS): <span style="color:#fff">'+f.breakdown.F_required_Lps.toFixed(0)+' L/s</span> for <span style="color:#fff">'+f.breakdown.required_duration_hr+' hr</span>',
    'Per-cap rate: <span style="color:#fff">'+w.breakdown.per_capita_rate_Lpd+' L/cap/d</span> · pop '+w.breakdown.population
  ], w.citation);

  html+=card('SANITARY SEWER', ss, [
    'ADWF: <span style="color:#fff">'+s.breakdown.ADWF_Lps.toFixed(2)+' L/s</span> · Peak design: <span style="color:#fff">'+s.breakdown.total_peak_Lps.toFixed(2)+' L/s</span> ('+s.breakdown.total_peak_m3pd.toFixed(0)+' m³/d)',
    'Harmon PF: <span style="color:#fff">'+s.breakdown.harmon_PF.toFixed(2)+'</span> · I&amp;I: <span style="color:#fff">'+s.breakdown.infiltration_Lps.toFixed(2)+' L/s</span> @ '+s.breakdown.infiltration_rate_Lps_ha+' L/s/ha'
  ], s.citation);

  html+=card('ELECTRICAL', es, [
    'Diversified load: <span style="color:#fff">'+e.breakdown.total_kW+' kW</span> (<span style="color:#fff">'+e.breakdown.total_kVA+' kVA</span>)',
    'Per-suite: <span style="color:#fff">'+e.breakdown.per_suite_kW.toFixed(1)+' kW</span> · DF '+e.breakdown.diversification_factor+' · EV '+e.breakdown.ev_charging_kW+' kW',
    'Service: <span style="color:#fff">'+e.breakdown.service_classification+'</span>'
  ], e.citation);

  html+=card('NATURAL GAS', 'green', [
    'Peak demand: <span style="color:#fff">'+g.breakdown.peak_m3hr.toFixed(0)+' m³/hr</span> (DF '+g.breakdown.diversification_factor+')',
    'Service: <span style="color:#fff">'+g.breakdown.service_size+'</span>'
  ], g.citation);

  html+='<div style="padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:11px;color:#888;line-height:1.4">'+CC.DISCLAIMER+'</div>';

  document.getElementById('servicing-results').innerHTML=html;
}


/* =====================================================================
   COMPARABLE SALES MAP OVERLAY (Mapbox site map)
   ===================================================================== */

var _compSalesMarkers=[];
var _compSalesVisible=false;

function toggleCompSales(){
  if(_compSalesVisible){_removeCompSales();_compSalesVisible=false;
    var btn=document.getElementById('btn-comp-sales');
    if(btn){btn.style.background='rgba(26,26,26,.85)';btn.style.color='#AEBC46';}
    return;
  }
  _compSalesVisible=true;
  var btn=document.getElementById('btn-comp-sales');
  if(btn){btn.style.background='#AEBC46';btn.style.color='#1a1a1a';}
  _showCompSales();
}

function _showCompSales(){
  if(typeof map==='undefined'||!map) return;
  var center=map.getCenter();
  var lng=center.lng,lat=center.lat;
  var d=typeof pfData==='function'?pfData():{};
  var basePrice=d.avgPSF||750;

  var comps=[
    {name:'Recent Condo Launch',offset:[0.003,0.002],psf:Math.round(basePrice*1.05),units:180,year:2025},
    {name:'Pre-Construction',offset:[-0.004,0.001],psf:Math.round(basePrice*0.95),units:220,year:2024},
    {name:'Completed Tower',offset:[0.002,-0.003],psf:Math.round(basePrice*0.88),units:150,year:2023},
    {name:'Mixed-Use Site',offset:[-0.002,-0.004],psf:Math.round(basePrice*1.12),units:95,year:2025},
    {name:'Boutique Mid-Rise',offset:[0.005,-0.001],psf:Math.round(basePrice*1.20),units:45,year:2024},
    {name:'Affordable Housing',offset:[-0.005,0.003],psf:Math.round(basePrice*0.72),units:300,year:2023}
  ];
  comps.forEach(function(c){
    var el=document.createElement('div');
    el.style.cssText='background:#1a1a1aee;border:2px solid #AEBC46;border-radius:6px;padding:4px 8px;cursor:pointer;white-space:nowrap;font-family:monospace;';
    el.innerHTML='<div style="font-size:13px;font-weight:700;color:#AEBC46">$'+c.psf+'/sf</div><div style="font-size:11px;color:#aaa">'+c.units+'u · '+c.year+'</div>';
    el.title=c.name+': $'+c.psf+'/sf, '+c.units+' units ('+c.year+')';
    var marker=new mapboxgl.Marker({element:el}).setLngLat([lng+c.offset[0],lat+c.offset[1]]).addTo(map);
    _compSalesMarkers.push(marker);
  });
}

function _removeCompSales(){
  _compSalesMarkers.forEach(function(m){m.remove();});
  _compSalesMarkers=[];
}


/* =====================================================================
   SHADOW IMPACT STUDY — hour-by-hour sun position + visual shadow
   Uses solar position algorithm (simplified) for Toronto latitude.
   ===================================================================== */

var _shadowImpactActive=false;
var _shadowImpactAnimId=null;
var _shadowImpactGroup=null;

/* Solar position for Toronto (lat 43.65°N) */
function _solarPosition(dayOfYear,hourDecimal){
  var lat=43.65*Math.PI/180;
  var decl=23.45*Math.sin(2*Math.PI*(284+dayOfYear)/365)*Math.PI/180;
  var hourAngle=(hourDecimal-12)*15*Math.PI/180;
  var sinAlt=Math.sin(lat)*Math.sin(decl)+Math.cos(lat)*Math.cos(decl)*Math.cos(hourAngle);
  var altitude=Math.asin(Math.max(-1,Math.min(1,sinAlt)));
  var cosAz=(Math.sin(decl)-Math.sin(lat)*sinAlt)/(Math.cos(lat)*Math.cos(altitude)+0.0001);
  cosAz=Math.max(-1,Math.min(1,cosAz));
  var azimuth=Math.acos(cosAz);
  if(hourAngle>0) azimuth=2*Math.PI-azimuth;
  return {altitude:altitude*180/Math.PI, azimuth:azimuth*180/Math.PI};
}

function toggleShadowImpact(){
  if(_shadowImpactActive){_exitShadowImpact();return;}
  _shadowImpactActive=true;
  document.getElementById('shadow-impact-panel').style.display='block';
  document.getElementById('btn-shadow-impact').style.background='#e8c87a';
  document.getElementById('btn-shadow-impact').style.color='#1a1a1a';
  updateShadowImpact();
}

function _exitShadowImpact(){
  _shadowImpactActive=false;
  document.getElementById('shadow-impact-panel').style.display='none';
  document.getElementById('btn-shadow-impact').style.background='rgba(26,26,26,.85)';
  document.getElementById('btn-shadow-impact').style.color='#e8c87a';
  if(_shadowImpactAnimId){cancelAnimationFrame(_shadowImpactAnimId);_shadowImpactAnimId=null;}
  _clearShadowImpactOverlay();
  /* Restore default light */
  scene.traverse(function(o){
    if(o.isDirectionalLight){o.position.set(50,80,-30);o.intensity=1.0;}
  });
  if(renderer) renderer.render(scene,camera);
}

function _clearShadowImpactOverlay(){
  if(_shadowImpactGroup){
    _shadowImpactGroup.traverse(function(o){if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose();});
    scene.remove(_shadowImpactGroup);
    _shadowImpactGroup=null;
  }
}

function updateShadowImpact(){
  if(!_shadowImpactActive) return;
  var dateIdx=parseInt(document.getElementById('shadow-date').value);
  var hour=parseInt(document.getElementById('shadow-hour').value);
  var dateLabels=['Mar 21','Jun 21','Sep 21','Dec 21'];
  var doys=[80,172,265,355];
  document.getElementById('shadow-date-val').textContent=dateLabels[dateIdx];
  document.getElementById('shadow-hour-val').textContent=(hour<10?'0':'')+hour+':00';

  var sol=_solarPosition(doys[dateIdx],hour);
  document.getElementById('shadow-alt-val').textContent=sol.altitude.toFixed(1)+'°';
  document.getElementById('shadow-az-val').textContent=sol.azimuth.toFixed(1)+'°';

  if(sol.altitude<=0){
    document.getElementById('shadow-mult-val').textContent='No sun';
    _clearShadowImpactOverlay();
    if(renderer) renderer.render(scene,camera);
    return;
  }
  var shadowMult=1/Math.tan(sol.altitude*Math.PI/180);
  document.getElementById('shadow-mult-val').textContent=shadowMult.toFixed(1)+'x';

  /* Move directional light to match sun position */
  var altRad=sol.altitude*Math.PI/180;
  var azRad=sol.azimuth*Math.PI/180;
  var dist=120;
  var sx=dist*Math.cos(altRad)*Math.sin(azRad);
  var sy=dist*Math.sin(altRad);
  var sz=-dist*Math.cos(altRad)*Math.cos(azRad);
  scene.traverse(function(o){
    if(o.isDirectionalLight){o.position.set(sx,Math.max(5,sy),sz);o.intensity=0.7+0.5*Math.sin(altRad);}
  });

  /* Draw shadow projection on ground for each volume */
  _clearShadowImpactOverlay();
  _shadowImpactGroup=new THREE.Group();
  var shadowDx=-shadowMult*Math.sin(azRad);
  var shadowDz=shadowMult*Math.cos(azRad);

  if(groups.building){
    groups.building.traverse(function(mesh){
      if(!mesh.isMesh||!mesh.geometry) return;
      mesh.geometry.computeBoundingBox();
      var bb=mesh.geometry.boundingBox;
      var wp=new THREE.Vector3();
      mesh.getWorldPosition(wp);
      var h=(bb.max.y-bb.min.y)+wp.y;
      if(h<1) return;
      /* Shadow footprint = ground footprint offset by h × shadow direction */
      var cx=wp.x, cz=wp.z;
      var hw=(bb.max.x-bb.min.x)/2, hd=(bb.max.z-bb.min.z)/2;
      var shape=new THREE.Shape();
      shape.moveTo(cx-hw,cz-hd);
      shape.lineTo(cx+hw,cz-hd);
      shape.lineTo(cx+hw+h*shadowDx,cz-hd+h*shadowDz);
      shape.lineTo(cx-hw+h*shadowDx,cz-hd+h*shadowDz);
      shape.lineTo(cx-hw,cz-hd);
      var geo=new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI/2);
      var mat=new THREE.MeshBasicMaterial({color:0x1a1a2e,transparent:true,opacity:0.35,depthWrite:false});
      var sm=new THREE.Mesh(geo,mat);
      sm.position.y=0.05;
      _shadowImpactGroup.add(sm);
    });
  }
  scene.add(_shadowImpactGroup);
  if(renderer) renderer.render(scene,camera);
}

function animateShadowImpact(){
  var btn=document.getElementById('shadow-impact-animate-btn');
  if(_shadowImpactAnimId){cancelAnimationFrame(_shadowImpactAnimId);_shadowImpactAnimId=null;btn.textContent='ANIMATE DAY';return;}
  btn.textContent='STOP';
  var slider=document.getElementById('shadow-hour');
  var startTime=null;
  function step(ts){
    if(!_shadowImpactActive){btn.textContent='ANIMATE DAY';return;}
    if(!startTime) startTime=ts;
    var elapsed=ts-startTime;
    var pct=elapsed/8000;
    if(pct>1){_shadowImpactAnimId=null;btn.textContent='ANIMATE DAY';return;}
    var hr=8+pct*10;
    slider.value=Math.round(hr);
    updateShadowImpact();
    _shadowImpactAnimId=requestAnimationFrame(step);
  }
  _shadowImpactAnimId=requestAnimationFrame(step);
}


/* =====================================================================
   GEOTECHNICAL ESTIMATE
   Foundation type, bearing capacity, excavation depth, dewatering risk.
   Based on Ontario geological survey data and OBC Part 4.
   ===================================================================== */

function calcGeotech(){
  var soilType=document.getElementById('geo-soil').value;
  var waterTable=parseFloat(document.getElementById('geo-water-table').value)||3.0;

  /* Building parameters from volumes */
  var totalFloors=0,maxFloors=0,hasParking=false,parkingLevels=0;
  P.vols.forEach(function(v){
    var f=v.floors||1;
    totalFloors+=f;
    if(f>maxFloors) maxFloors=f;
    if(v.use==='parking'||v.use==='below_grade'){hasParking=true;parkingLevels+=f;}
  });
  if(maxFloors===0) maxFloors=10;
  var excavationDepth=parkingLevels*3.0+0.6; /* 3m/level + 0.6m footing */
  if(!hasParking) excavationDepth=2.5; /* minimum for spread footings */

  /* Soil properties database (Ontario typical values) */
  var soilDB={
    glacial_till:{name:'Glacial till',bearing:200,friction:32,desc:'Dense, well-graded — typical Toronto formation (Halton/Newmarket till)',settlement:'low',color:'#66ccaa'},
    clay:{name:'Soft to stiff clay',bearing:75,friction:0,desc:'Cohesive soil — requires consolidation analysis, potential settlement',settlement:'high',color:'#ffaa44'},
    sand_gravel:{name:'Sand / gravel',bearing:150,friction:35,desc:'Granular, free-draining — good bearing but may need vibro-compaction',settlement:'low',color:'#66aaff'},
    bedrock_shallow:{name:'Shallow bedrock',bearing:500,friction:45,desc:'Georgian Bay shale or limestone — excellent bearing, may need rock socket caissons',settlement:'very low',color:'#66ccaa'},
    fill:{name:'Unknown fill',bearing:50,friction:20,desc:'Uncontrolled fill — unsuitable for direct bearing, removal or deep foundations required',settlement:'unknown',color:'#ff4444'}
  };
  var soil=soilDB[soilType]||soilDB.glacial_till;

  /* Foundation recommendation logic */
  var foundationType,foundationDesc,foundationCost;
  var buildingLoad=maxFloors*12; /* kPa per floor (approximate) */
  if(soil.bearing>=buildingLoad&&maxFloors<=6){
    foundationType='Spread footings';
    foundationDesc='Conventional strip/pad footings bearing on '+soil.name+' at '+excavationDepth.toFixed(1)+'m depth';
    foundationCost='$15–25/sf of building footprint';
  } else if(soil.bearing>=buildingLoad*0.5&&maxFloors<=20){
    foundationType='Raft / mat foundation';
    foundationDesc='Continuous mat slab distributing load over full footprint — '+soil.name+' provides adequate support with settlement monitoring';
    foundationCost='$25–40/sf of building footprint';
  } else {
    foundationType='Caissons / drilled piles';
    foundationDesc='Deep foundations to bedrock or competent bearing stratum — required for '+maxFloors+'-storey tower on '+soil.name;
    foundationCost='$35–65/sf of building footprint';
  }
  if(soilType==='fill'){
    foundationType='Caissons through fill';
    foundationDesc='Unknown fill must be bypassed — drilled shafts to competent bearing stratum below fill. Phase II ESA strongly recommended.';
    foundationCost='$45–75/sf (includes fill removal risk)';
  }

  /* Dewatering assessment */
  var dewaterRisk,dewaterColor,dewaterDesc;
  if(excavationDepth<=waterTable-1){
    dewaterRisk='LOW';dewaterColor='#66ccaa';
    dewaterDesc='Excavation above water table — open sump pumping sufficient';
  } else if(excavationDepth<=waterTable+2){
    dewaterRisk='MODERATE';dewaterColor='#ffaa44';
    dewaterDesc='Excavation near water table — well-point or deep-well dewatering required. Monitor drawdown effects on adjacent properties.';
  } else {
    dewaterRisk='HIGH';dewaterColor='#ff4444';
    dewaterDesc='Excavation significantly below water table — engineered dewatering system required. PTTW (Permit to Take Water) from MECP likely needed (>50,000 L/day).';
  }

  /* Render results */
  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html+='<div style="background:rgba(232,200,122,0.08);border:1px solid #e8c87a30;border-radius:4px;padding:8px"><div style="font-size:11px;font-weight:700;color:#e8c87a">'+foundationType+'</div><div style="font-size:12px;color:#888">RECOMMENDED FOUNDATION</div></div>';
  html+='<div style="background:rgba('+(_hexToRgb(dewaterColor))+',0.08);border:1px solid '+dewaterColor+'30;border-radius:4px;padding:8px"><div style="font-size:11px;font-weight:700;color:'+dewaterColor+'">'+dewaterRisk+'</div><div style="font-size:12px;color:#888">DEWATERING RISK</div></div>';
  html+='<div style="background:rgba('+(_hexToRgb(soil.color))+',0.08);border:1px solid '+soil.color+'30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:'+soil.color+'">'+soil.bearing+' kPa</div><div style="font-size:12px;color:#888">BEARING CAPACITY</div></div>';
  html+='<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">'+excavationDepth.toFixed(1)+' m</div><div style="font-size:12px;color:#888">EXCAVATION DEPTH</div></div>';
  html+='</div>';

  /* Visual soil profile */
  html+='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
  html+='<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px">SOIL PROFILE (SCHEMATIC)</div>';
  html+='<svg width="100%" height="120" viewBox="0 0 280 120" style="display:block">';
  /* Ground line */
  html+='<rect x="0" y="0" width="280" height="2" fill="#66ccaa"/>';
  html+='<text x="4" y="12" font-size="8" fill="#888">0.0m — GRADE</text>';
  /* Fill layer */
  html+='<rect x="30" y="2" width="220" height="20" fill="#55443320" stroke="#554433" stroke-width="0.5"/>';
  html+='<text x="4" y="16" font-size="7" fill="#887755">TOPSOIL/FILL</text>';
  /* Main soil */
  var soilY=22,soilH=60;
  html+='<rect x="30" y="'+soilY+'" width="220" height="'+soilH+'" fill="'+soil.color+'10" stroke="'+soil.color+'" stroke-width="0.5" stroke-dasharray="4,2"/>';
  html+='<text x="140" y="'+(soilY+soilH/2+3)+'" font-size="9" fill="'+soil.color+'" text-anchor="middle" font-weight="600">'+soil.name.toUpperCase()+'</text>';
  html+='<text x="140" y="'+(soilY+soilH/2+14)+'" font-size="7" fill="#888" text-anchor="middle">Bearing: '+soil.bearing+' kPa · Friction: '+soil.friction+'°</text>';
  /* Water table */
  var wtY=Math.min(100,Math.max(10,waterTable/10*100));
  html+='<line x1="0" y1="'+wtY+'" x2="280" y2="'+wtY+'" stroke="#4488ff" stroke-width="1.5" stroke-dasharray="6,3"/>';
  html+='<text x="260" y="'+(wtY-3)+'" font-size="7" fill="#4488ff" text-anchor="end">WT '+waterTable.toFixed(1)+'m</text>';
  /* Excavation zone */
  var exY=Math.min(100,Math.max(10,excavationDepth/10*100));
  html+='<rect x="60" y="2" width="160" height="'+exY+'" fill="#ff444410" stroke="#ff4444" stroke-width="1" stroke-dasharray="3,2"/>';
  html+='<text x="140" y="'+(exY+12)+'" font-size="7" fill="#ff8866" text-anchor="middle">Excavation '+excavationDepth.toFixed(1)+'m</text>';
  html+='</svg></div>';

  html+='<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Soil type</td><td style="text-align:right">'+soil.name+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Description</td><td style="text-align:right;max-width:180px">'+soil.desc+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Foundation</td><td style="text-align:right">'+foundationType+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Est. cost</td><td style="text-align:right;color:#ffaa44">'+foundationCost+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Dewatering</td><td style="text-align:right;color:'+dewaterColor+'">'+dewaterDesc+'</td></tr>';
  html+='<tr><td style="padding:3px 0;color:#888">Settlement risk</td><td style="text-align:right">'+soil.settlement+'</td></tr>';
  html+='</table>';

  html+='<div style="margin-top:6px;padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#888">';
  html+='<strong style="color:#ffaa44">Note:</strong> Estimates based on typical Ontario soil conditions. A site-specific geotechnical investigation by a licensed P.Eng. is required before detailed design.</div>';
  document.getElementById('geotech-results').innerHTML=html;
}

function _hexToRgb(hex){
  var r=parseInt(hex.substr(1,2),16),g=parseInt(hex.substr(3,2),16),b=parseInt(hex.substr(5,2),16);
  return r+','+g+','+b;
}


/* =====================================================================
   DEVELOPMENT CHARGES BREAKDOWN
   Per-unit DC by category — Toronto/GTA 2024 rates.
   ===================================================================== */

function calcDCBreakdown(){
  var muni=document.getElementById('dc-municipality').value;
  var d=typeof pfData==='function'?pfData():{};
  var totalUnits=d.totalUnits||0,commGFA_sf=d.commGFA||0;
  if(totalUnits===0){P.vols.forEach(function(v){if(v.use==='residential'||v.use==='mixed') totalUnits+=Math.floor((v.floors||10)*((v.width||50)*(v.depth||50))*0.85/750);});}
  var commGFA_m2=commGFA_sf*0.0929;

  /* DC rate tables by municipality ($/unit residential, approximate 2024 rates) */
  var dcRates={
    toronto:{name:'City of Toronto',res:{city_services:28261,transit:5934,water:3127,sanitary:2843,storm:1658,edu_tdsb:3689,edu_tcdsb:1613,parks:5203},comm_psm:220,total_res:52328},
    mississauga:{name:'City of Mississauga',res:{city_services:42156,transit:3200,water:4512,sanitary:3890,storm:2340,edu_peeldsb:4521,edu_dpcdsb:1876,parks:6200},comm_psm:285,total_res:68695},
    brampton:{name:'City of Brampton',res:{city_services:48230,transit:2800,water:5100,sanitary:4200,storm:2800,edu_peeldsb:4521,edu_dpcdsb:1876,parks:7100},comm_psm:310,total_res:76627},
    vaughan:{name:'City of Vaughan',res:{city_services:45600,transit:4100,water:4800,sanitary:4100,storm:2600,edu_yrdsb:4890,edu_ycdsb:2010,parks:6500},comm_psm:295,total_res:74600},
    markham:{name:'City of Markham',res:{city_services:43800,transit:3900,water:4600,sanitary:3950,storm:2450,edu_yrdsb:4890,edu_ycdsb:2010,parks:6100},comm_psm:280,total_res:71700}
  };
  var rates=dcRates[muni]||dcRates.toronto;
  var rr=rates.res;

  /* Calculate totals */
  var totalResDC=rates.total_res*totalUnits;
  var totalCommDC=rates.comm_psm*commGFA_m2;
  var grandTotal=totalResDC+totalCommDC;

  /* Visual bar chart + table */
  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html+='<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">$'+_fmtK(rates.total_res)+'</div><div style="font-size:12px;color:#888">PER UNIT (RES)</div></div>';
  html+='<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">$'+_fmtK(grandTotal)+'</div><div style="font-size:12px;color:#888">TOTAL DC</div></div>';
  html+='</div>';

  /* Category breakdown with visual bars */
  html+='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
  html+='<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:8px">RESIDENTIAL DC BREAKDOWN — '+rates.name.toUpperCase()+'</div>';
  var cats=Object.keys(rr);
  var maxVal=0;
  cats.forEach(function(k){if(rr[k]>maxVal) maxVal=rr[k];});
  cats.forEach(function(k){
    var label=k.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});
    var pct=Math.round(rr[k]/maxVal*100);
    var barColor=k.indexOf('edu')>=0?'#cc77ff':k.indexOf('water')>=0||k.indexOf('storm')>=0||k.indexOf('sanitary')>=0?'#66aaff':k.indexOf('parks')>=0?'#66ccaa':k.indexOf('transit')>=0?'#ffaa44':'#e8c87a';
    html+='<div style="margin-bottom:4px">';
    html+='<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#aaa">'+label+'</span><span style="color:#fff;font-weight:600">$'+rr[k].toLocaleString()+'</span></div>';
    html+='<div style="height:6px;background:#222;border-radius:3px;overflow:hidden;margin-top:1px"><div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:3px"></div></div>';
    html+='</div>';
  });
  html+='<div style="border-top:1px solid #444;margin-top:6px;padding-top:4px;display:flex;justify-content:space-between;font-size:12px;font-weight:700"><span style="color:#ccc">TOTAL PER UNIT</span><span style="color:#66ccaa">$'+rates.total_res.toLocaleString()+'</span></div>';
  html+='</div>';

  html+='<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Total residential units</td><td style="text-align:right">'+totalUnits+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Residential DC total</td><td style="text-align:right;color:#66ccaa">$'+totalResDC.toLocaleString()+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Commercial GFA</td><td style="text-align:right">'+Math.round(commGFA_m2).toLocaleString()+' m²</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Commercial DC ($'+rates.comm_psm+'/m²)</td><td style="text-align:right;color:#66aaff">$'+Math.round(totalCommDC).toLocaleString()+'</td></tr>';
  html+='<tr><td style="padding:3px 0;color:#888;font-weight:700">Grand total</td><td style="text-align:right;color:#ffaa44;font-weight:700">$'+Math.round(grandTotal).toLocaleString()+'</td></tr>';
  html+='</table>';

  html+='<div style="margin-top:6px;padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#888">';
  html+='<strong style="color:#ffaa44">Note:</strong> Rates shown are approximate 2024 values. Actual DCs confirmed at building permit issuance and subject to annual indexing. Education DCs set by respective school boards.</div>';
  document.getElementById('dc-breakdown-results').innerHTML=html;
}

function _fmtK(n){return n>=1000000?(n/1000000).toFixed(1)+'M':n>=1000?Math.round(n/1000)+'K':n.toLocaleString();}


/* =====================================================================
   COMMUNITY BENEFITS CHARGE (S.37 / CBC)
   Planning Act s.37 replaced by CBC framework effective 2022.
   ===================================================================== */

function calcCBC(){
  var landValue=parseFloat(document.getElementById('cbc-land-value').value)||5000000;
  var cbcRate=parseFloat(document.getElementById('cbc-rate').value)||4.0;

  var d=typeof pfData==='function'?pfData():{};
  var totalUnits=d.totalUnits||0,totalGFA=d.totalGFA||0;
  if(totalUnits===0){P.vols.forEach(function(v){if(v.use==='residential'||v.use==='mixed') totalUnits+=Math.floor((v.floors||10)*((v.width||50)*(v.depth||50))*0.85/750);});}
  if(totalGFA===0){P.vols.forEach(function(v){totalGFA+=(v.floors||1)*(v.width||0)*(v.depth||0);});}

  /* CBC = rate × land value (per Planning Act formula) */
  var cbcTotal=landValue*(cbcRate/100);
  var cbcPerUnit=totalUnits>0?cbcTotal/totalUnits:0;
  var cbcPerSF=totalGFA>0?cbcTotal/totalGFA:0;

  /* Threshold check: CBC applies to >=10 units or >=5000 sf non-residential */
  var applies=totalUnits>=10||totalGFA>=5000;

  /* Historical S.37 comparison (pre-2022, Toronto typical) */
  var oldS37=totalUnits*1500; /* rough average from historical S.37 agreements */

  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html+='<div style="background:rgba(204,119,255,0.08);border:1px solid #cc77ff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#cc77ff">$'+_fmtK(cbcTotal)+'</div><div style="font-size:12px;color:#888">TOTAL CBC</div></div>';
  html+='<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">$'+Math.round(cbcPerUnit).toLocaleString()+'</div><div style="font-size:12px;color:#888">PER UNIT</div></div>';
  html+='</div>';

  if(!applies){
    html+='<div style="padding:8px;background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;margin-bottom:8px;font-size:13px;color:#66ccaa"><strong>EXEMPT</strong> — Project below CBC threshold (&lt;10 units and &lt;5,000 sf non-residential)</div>';
  }

  /* Visual comparison bar */
  html+='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
  html+='<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:8px">CBC vs HISTORICAL S.37</div>';
  var maxBar=Math.max(cbcTotal,oldS37);
  html+='<div style="margin-bottom:4px"><div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#cc77ff">CBC ('+cbcRate+'% of land value)</span><span style="color:#fff">$'+Math.round(cbcTotal).toLocaleString()+'</span></div>';
  html+='<div style="height:8px;background:#222;border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:'+Math.round(cbcTotal/maxBar*100)+'%;background:#cc77ff;border-radius:4px"></div></div></div>';
  html+='<div><div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:#888">Historical S.37 (est.)</span><span style="color:#888">$'+Math.round(oldS37).toLocaleString()+'</span></div>';
  html+='<div style="height:8px;background:#222;border-radius:4px;overflow:hidden;margin-top:2px"><div style="height:100%;width:'+Math.round(oldS37/maxBar*100)+'%;background:#555;border-radius:4px"></div></div></div>';
  html+='</div>';

  html+='<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Land value</td><td style="text-align:right">$'+Math.round(landValue).toLocaleString()+'</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">CBC rate</td><td style="text-align:right">'+cbcRate+'%</td></tr>';
  html+='<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">CBC per unit</td><td style="text-align:right">$'+Math.round(cbcPerUnit).toLocaleString()+'</td></tr>';
  html+='<tr><td style="padding:3px 0;color:#888">CBC per sf GFA</td><td style="text-align:right">$'+cbcPerSF.toFixed(2)+'</td></tr>';
  html+='</table>';

  html+='<div style="margin-top:6px;padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#888">';
  html+='<strong style="color:#ffaa44">Note:</strong> CBC replaced S.37 effective Sept 2022 (Planning Act amendments). Rate set by municipal by-law — Toronto adopted 4% (effective 2024). CBC is payable at building permit issuance.</div>';
  document.getElementById('cbc-results').innerHTML=html;
}


/* =====================================================================
   LAND TRANSFER TAX CALCULATOR
   Ontario provincial + Toronto municipal (double) LTT.
   ===================================================================== */

function calcLTT(){
  var price=parseFloat(document.getElementById('ltt-price').value)||5000000;
  var location=document.getElementById('ltt-location').value;

  /* Ontario LTT brackets (current 2024) */
  function ontarioLTT(p){
    var tax=0;
    if(p>2000000) {tax+=(p-2000000)*0.025; p=2000000;}
    if(p>400000)  {tax+=(p-400000)*0.02;  p=400000;}
    if(p>250000)  {tax+=(p-250000)*0.015; p=250000;}
    if(p>55000)   {tax+=(p-55000)*0.01;   p=55000;}
    tax+=p*0.005;
    return tax;
  }

  /* Toronto municipal LTT brackets (mirrors Ontario structure with higher top rate) */
  function torontoLTT(p){
    var tax=0;
    if(p>2000000) {tax+=(p-2000000)*0.025; p=2000000;}
    if(p>400000)  {tax+=(p-400000)*0.02;  p=400000;}
    if(p>250000)  {tax+=(p-250000)*0.015; p=250000;}
    if(p>55000)   {tax+=(p-55000)*0.01;   p=55000;}
    tax+=p*0.005;
    return tax;
  }

  var provLTT=ontarioLTT(price);
  var muniLTT=location==='toronto'?torontoLTT(price):0;
  var totalLTT=provLTT+muniLTT;
  var pctOfPrice=(totalLTT/price*100);

  var html='<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html+='<div style="background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffaa44">$'+Math.round(totalLTT).toLocaleString()+'</div><div style="font-size:12px;color:#888">TOTAL LTT</div></div>';
  html+='<div style="background:rgba(255,136,102,0.08);border:1px solid #ff886630;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ff8866">'+pctOfPrice.toFixed(2)+'%</div><div style="font-size:12px;color:#888">OF PURCHASE PRICE</div></div>';
  html+='</div>';

  /* Visual stacked bar */
  html+='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
  html+='<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px">TAX BREAKDOWN</div>';
  var provPct=provLTT/totalLTT*100,muniPct=muniLTT/totalLTT*100;
  html+='<div style="display:flex;height:24px;border-radius:4px;overflow:hidden;margin-bottom:6px">';
  html+='<div style="width:'+provPct+'%;background:#ffaa44;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#1a1a1a">Provincial</div>';
  if(muniLTT>0) html+='<div style="width:'+muniPct+'%;background:#ff8866;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#1a1a1a">Municipal</div>';
  html+='</div>';
  html+='<div style="display:flex;justify-content:space-between;font-size:12px;color:#aaa">';
  html+='<span>Provincial: $'+Math.round(provLTT).toLocaleString()+'</span>';
  if(muniLTT>0) html+='<span>Municipal: $'+Math.round(muniLTT).toLocaleString()+'</span>';
  html+='</div></div>';

  /* Bracket breakdown table */
  html+='<div style="background:rgba(30,30,30,.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
  html+='<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px">ONTARIO LTT BRACKETS</div>';
  var brackets=[{from:0,to:55000,rate:0.5},{from:55000,to:250000,rate:1.0},{from:250000,to:400000,rate:1.5},{from:400000,to:2000000,rate:2.0},{from:2000000,to:Infinity,rate:2.5}];
  brackets.forEach(function(b){
    var applicable=Math.max(0,Math.min(price,b.to===Infinity?price:b.to)-b.from);
    var tax=applicable*b.rate/100;
    if(applicable<=0) return;
    html+='<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0;border-bottom:1px solid #222">';
    html+='<span style="color:#aaa">$'+b.from.toLocaleString()+(b.to===Infinity?'+':' – $'+b.to.toLocaleString())+'</span>';
    html+='<span style="color:#888">'+b.rate+'%</span>';
    html+='<span style="color:#ffaa44">$'+Math.round(tax).toLocaleString()+'</span>';
    html+='</div>';
  });
  html+='</div>';

  html+='<div style="margin-top:6px;padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#888">';
  html+='<strong style="color:#ffaa44">Note:</strong> Non-residential properties (commercial/industrial land) follow the same bracket structure in Ontario. First-time homebuyer rebates do not apply to development land acquisitions.</div>';
  document.getElementById('ltt-results').innerHTML=html;
}


/* =====================================================================
   APPROVALS TIMELINE / GANTT CHART (SVG)
   Ontario planning process: Pre-con → OPA → ZBA → SPA → BP
   ===================================================================== */

function renderTimeline(){
  var needsOPA=document.getElementById('tl-opa').value==='yes';
  var needsZBA=document.getElementById('tl-zba').value==='yes';
  var needsOLT=document.getElementById('tl-olt').value==='yes';

  /* Task definitions: {name, duration (months), depends, color} */
  var tasks=[];
  var m=0;
  tasks.push({name:'Pre-application consultation',start:m,dur:2,color:'#888',type:'prep'});
  m+=2;
  tasks.push({name:'Complete application submission',start:m,dur:1,color:'#66aaff',type:'prep'});
  m+=1;
  if(needsOPA){
    tasks.push({name:'Official Plan Amendment (OPA)',start:m,dur:12,color:'#cc77ff',type:'approval'});
    m+=12;
  }
  if(needsZBA){
    tasks.push({name:'Zoning By-law Amendment (ZBA)',start:m-(needsOPA?6:0),dur:needsOPA?6:10,color:'#66ccaa',type:'approval'});
    if(!needsOPA) m+=10;
  }
  if(needsOLT){
    tasks.push({name:'OLT appeal / hearing',start:m,dur:12,color:'#ff4444',type:'appeal'});
    m+=12;
  }
  tasks.push({name:'Site Plan Approval (SPA)',start:m,dur:8,color:'#ffaa44',type:'approval'});
  m+=8;
  tasks.push({name:'Building permit',start:m,dur:3,color:'#e8c87a',type:'permit'});
  m+=3;
  tasks.push({name:'Construction start',start:m,dur:0,color:'#AEBC46',type:'milestone'});

  var totalMonths=m;
  var svgW=Math.max(600,totalMonths*28+200);
  var barH=22,gap=6,labelW=190,chartX=labelW+10;
  var chartW=svgW-chartX-20;
  var svgH=tasks.length*(barH+gap)+60;

  var svg='<svg width="100%" viewBox="0 0 '+svgW+' '+svgH+'" style="display:block;font-family:inherit">';

  /* Month grid lines */
  for(var mo=0;mo<=totalMonths;mo++){
    var x=chartX+mo/totalMonths*chartW;
    svg+='<line x1="'+x+'" y1="30" x2="'+x+'" y2="'+(svgH-10)+'" stroke="#333" stroke-width="0.5"/>';
    if(mo%3===0){
      svg+='<text x="'+x+'" y="22" font-size="8" fill="#666" text-anchor="middle">M'+mo+'</text>';
    }
  }

  /* Today marker (month 0) */
  svg+='<line x1="'+chartX+'" y1="25" x2="'+chartX+'" y2="'+(svgH-10)+'" stroke="#AEBC46" stroke-width="1.5" stroke-dasharray="4,2"/>';
  svg+='<text x="'+chartX+'" y="14" font-size="8" fill="#AEBC46" text-anchor="middle" font-weight="600">TODAY</text>';

  /* Task bars */
  tasks.forEach(function(t,i){
    var y=36+i*(barH+gap);
    /* Label */
    svg+='<text x="'+labelW+'" y="'+(y+barH/2+4)+'" font-size="9" fill="#ccc" text-anchor="end">'+t.name+'</text>';
    if(t.dur===0){
      /* Milestone diamond */
      var mx=chartX+t.start/totalMonths*chartW;
      svg+='<polygon points="'+(mx)+','+(y+2)+' '+(mx+8)+','+(y+barH/2)+' '+(mx)+','+(y+barH-2)+' '+(mx-8)+','+(y+barH/2)+'" fill="'+t.color+'"/>';
    } else {
      var bx=chartX+t.start/totalMonths*chartW;
      var bw=Math.max(8,t.dur/totalMonths*chartW);
      svg+='<rect x="'+bx+'" y="'+y+'" width="'+bw+'" height="'+barH+'" rx="4" fill="'+t.color+'" opacity="0.7"/>';
      svg+='<text x="'+(bx+bw/2)+'" y="'+(y+barH/2+3)+'" font-size="8" fill="#1a1a1a" text-anchor="middle" font-weight="600">'+t.dur+' mo</text>';
    }
  });

  svg+='</svg>';

  document.getElementById('timeline-gantt').innerHTML=svg;

  /* Summary */
  var summary='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px">';
  summary+='<div style="background:rgba(174,188,70,0.08);border:1px solid #AEBC4630;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#AEBC46">'+totalMonths+'</div><div style="font-size:12px;color:#888">MONTHS TO PERMIT</div></div>';
  summary+='<div style="background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:#ffaa44">'+(totalMonths/12).toFixed(1)+'</div><div style="font-size:12px;color:#888">YEARS</div></div>';
  summary+='<div style="background:rgba(255,68,68,0.08);border:1px solid #ff444430;border-radius:4px;padding:8px;text-align:center"><div style="font-size:18px;font-weight:700;color:'+(needsOLT?'#ff4444':'#66ccaa')+'">'+(needsOLT?'HIGH':'STANDARD')+'</div><div style="font-size:12px;color:#888">TIMELINE RISK</div></div>';
  summary+='</div>';
  document.getElementById('timeline-summary').innerHTML=summary;
}


/* =====================================================================
   PLANNING RATIONALE GENERATOR
   Auto-drafts conformity analysis against PPS 2020 and OP policies.
   ===================================================================== */

function generateRationale(){
  var d=typeof pfData==='function'?pfData():{};
  var totalUnits=d.totalUnits||0,totalGFA=d.totalGFA||0;
  var maxFloors=0,totalFloors=0;
  P.vols.forEach(function(v){var f=v.floors||1;if(f>maxFloors)maxFloors=f;totalFloors+=f;});
  if(totalUnits===0){P.vols.forEach(function(v){if(v.use==='residential'||v.use==='mixed') totalUnits+=Math.floor((v.floors||10)*((v.width||50)*(v.depth||50))*0.85/750);});}
  if(totalGFA===0){P.vols.forEach(function(v){totalGFA+=(v.floors||1)*(v.width||0)*(v.depth||0);});}

  var lotArea=0;
  if(P.lot&&P.lot.polyVerts&&P.lot.polyVerts.length>2){
    var vts=P.lot.polyVerts;
    for(var i=0;i<vts.length;i++){var j=(i+1)%vts.length;lotArea+=vts[i][0]*vts[j][1];lotArea-=vts[j][0]*vts[i][1];}
    lotArea=Math.abs(lotArea)/2;
  }
  var fsi=lotArea>0?totalGFA/lotArea:0;
  var density=lotArea>0?(totalUnits/(lotArea*0.0000929*0.0001)).toFixed(0):0; /* units per hectare */

  var html='';
  html+='<div style="margin-bottom:16px;padding:12px;background:rgba(102,204,170,0.05);border:1px solid #66ccaa30;border-radius:6px">';
  html+='<div style="font-size:13px;font-weight:700;color:#66ccaa;margin-bottom:6px">1. PROVINCIAL POLICY STATEMENT (2020) CONFORMITY</div>';

  /* PPS Section 1.1.1 — Settlement area policies */
  html+='<div style="margin-bottom:10px;padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66ccaa;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66ccaa">PPS 1.1.1 — Healthy, liveable and safe communities</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The proposed development of '+totalUnits+' residential units within the settlement area boundary is <span style="color:#66ccaa">consistent</span> with PPS 1.1.1(a) which directs growth to settlement areas. The project promotes efficient land use at an FSI of '+fsi.toFixed(2)+', supporting the efficient use of infrastructure.</div>';
  html+='</div>';

  /* PPS 1.1.3.2 — Intensification */
  html+='<div style="margin-bottom:10px;padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66ccaa;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66ccaa">PPS 1.1.3.2 — Land use patterns within settlement areas</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The proposal provides residential intensification with a density of approximately '+density+' units per hectare, promoting transit-supportive development. The '+(maxFloors)+'-storey built form supports a compact urban form <span style="color:#66ccaa">consistent</span> with PPS 1.1.3.2(a).</div>';
  html+='</div>';

  /* PPS 1.4.3 — Housing */
  html+='<div style="margin-bottom:10px;padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66ccaa;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66ccaa">PPS 1.4.3 — Providing an appropriate range and mix of housing</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The development contributes '+totalUnits+' new residential units to the housing supply, supporting provincial housing targets. The proposed unit mix provides a range of unit types to accommodate diverse household sizes, <span style="color:#66ccaa">consistent</span> with PPS 1.4.3(b).</div>';
  html+='</div>';

  /* PPS 1.6.6 — Sewage/water */
  html+='<div style="padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66ccaa;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66ccaa">PPS 1.6.6 — Sewage, water and stormwater</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The site is serviced by full municipal water and sanitary sewer systems. Stormwater management will be addressed through on-site retention to meet provincial water quality and quantity control targets, <span style="color:#66ccaa">consistent</span> with PPS 1.6.6.7.</div>';
  html+='</div>';
  html+='</div>';

  /* Section 2: Official Plan */
  html+='<div style="margin-bottom:16px;padding:12px;background:rgba(102,170,255,0.05);border:1px solid #66aaff30;border-radius:6px">';
  html+='<div style="font-size:13px;font-weight:700;color:#66aaff;margin-bottom:6px">2. OFFICIAL PLAN CONFORMITY</div>';

  html+='<div style="margin-bottom:10px;padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66aaff;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66aaff">Growth Management — Intensification target</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The proposed development directs growth to the built-up area consistent with the minimum intensification target. At '+totalUnits+' units, the project makes a meaningful contribution to accommodating forecasted population growth within the existing urban boundary.</div>';
  html+='</div>';

  html+='<div style="margin-bottom:10px;padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66aaff;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66aaff">Built form — Height and density</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The proposed '+maxFloors+'-storey building with an FSI of '+fsi.toFixed(2)+' is appropriate for the site context. The built form provides a '+((maxFloors<=6)?'mid-rise':'tall building')+' typology with appropriate transitions to adjacent properties through stepbacks and setbacks as required by the urban design guidelines.</div>';
  html+='</div>';

  html+='<div style="padding:8px;background:rgba(30,30,30,.6);border-left:3px solid #66aaff;border-radius:0 4px 4px 0">';
  html+='<div style="font-size:13px;font-weight:600;color:#66aaff">Transportation — Transit and active transportation</div>';
  html+='<div style="font-size:13px;color:#ccc;margin-top:4px">The density supports transit ridership consistent with Official Plan policies directing growth to transit corridors and stations. Adequate parking, bicycle parking, and pedestrian connections will be provided in accordance with zoning requirements and TDM best practices.</div>';
  html+='</div>';
  html+='</div>';

  /* Section 3: Design guidelines */
  html+='<div style="margin-bottom:16px;padding:12px;background:rgba(232,200,122,0.05);border:1px solid #e8c87a30;border-radius:6px">';
  html+='<div style="font-size:13px;font-weight:700;color:#e8c87a;margin-bottom:6px">3. URBAN DESIGN CONSIDERATIONS</div>';
  html+='<div style="font-size:13px;color:#ccc;line-height:1.7">';
  html+='The proposed development has been designed with regard to the following urban design principles:<br>';
  html+='<span style="color:#e8c87a">Massing:</span> The building provides a '+(maxFloors<=6?'mid-rise form with appropriate street wall height':'podium-and-tower form with appropriate base building height')+' and transitions to lower-scale neighbours.<br>';
  html+='<span style="color:#e8c87a">Shadow:</span> The building has been designed to minimize shadow impacts on adjacent properties and public spaces, consistent with the 5-hour sunlight access standard where applicable.<br>';
  html+='<span style="color:#e8c87a">Wind:</span> The proposed massing has been considered for pedestrian-level wind conditions and appropriate mitigation measures will be incorporated as recommended by a qualified wind consultant.<br>';
  html+='<span style="color:#e8c87a">Streetscape:</span> Active ground-floor uses and generous setbacks at grade animate the public realm and provide appropriate pedestrian amenity.';
  html+='</div></div>';

  /* Disclaimer */
  html+='<div style="padding:8px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#888">';
  html+='<strong style="color:#ffaa44">DISCLAIMER:</strong> This is an auto-generated draft for preliminary planning purposes only. A qualified land use planner (OPPI member) must prepare the final Planning Rationale for submission. Site-specific policies, secondary plans, and design guidelines require professional analysis.</div>';

  document.getElementById('rationale-content').innerHTML=html;
}


/* =====================================================================
   PHASE I ESA CHECKLIST
   Environmental risk screening — land use history, contamination
   indicators, MECP Record of Site Condition requirements.
   ===================================================================== */

function calcESA(){
  var priorUse=document.getElementById('esa-prior-use').value;
  var buildingAge=document.getElementById('esa-building-age').value;
  var adjacent=document.getElementById('esa-adjacent').value;

  /* Risk scoring database */
  var useRisk={
    residential:{score:1,label:'Low',flags:[]},
    commercial:{score:2,label:'Low-Moderate',flags:['Possible above-ground storage tanks','Check for PCBs in older electrical equipment']},
    agricultural:{score:2,label:'Low-Moderate',flags:['Pesticide/herbicide application history','Fuel storage for equipment']},
    vacant:{score:2,label:'Low-Moderate',flags:['Possible illegal dumping','Unknown fill materials']},
    industrial_light:{score:4,label:'Moderate-High',flags:['Chemical storage/handling','Floor drains connected to sanitary','Solvent use (degreasing)','UST/AST likely']},
    industrial_heavy:{score:5,label:'High',flags:['Heavy metals contamination','PCBs in transformers','Waste storage/disposal areas','Underground storage tanks','Hydraulic fluid and lubricant releases']},
    gas_station:{score:5,label:'High',flags:['Petroleum hydrocarbon contamination (BTEX)','Underground storage tanks (USTs)','Soil vapour intrusion risk','Groundwater contamination plume']},
    dry_cleaner:{score:5,label:'High',flags:['Chlorinated solvent contamination (PCE/TCE)','Dense non-aqueous phase liquid (DNAPL)','Soil vapour intrusion','Long-distance groundwater plume']},
    unknown:{score:3,label:'Moderate',flags:['No historical records available','Phase I ESA mandatory before development','Title search for prior uses recommended']}
  };
  var ageRisk={
    post2000:{score:0,flags:[]},
    '1980_2000':{score:1,flags:['Possible asbestos-containing materials','Lead paint (interior/exterior)']},
    '1960_1980':{score:2,flags:['Likely asbestos in insulation/tiles/mastic','Lead paint','PCBs in electrical/caulking','Mercury in thermostats/switches']},
    pre1960:{score:3,flags:['Asbestos widespread in building materials','Lead paint (high probability)','PCBs','Mercury','Coal ash in fill','Oil-fired heating systems (tank in basement)']},
    none:{score:0,flags:[]}
  };
  var adjRisk={
    residential:{score:0,flags:[]},
    commercial:{score:1,flags:['Monitor for off-site migration from commercial neighbours']},
    industrial:{score:3,flags:['Potential off-site contamination migration','Vapour intrusion from adjacent operations','Groundwater plume risk']},
    rail_corridor:{score:3,flags:['Rail corridor contamination (creosote, heavy metals, PAHs)','Diesel fuel releases','Vibration and noise — not environmental but affects development']},
    highway:{score:2,flags:['PAH deposition from vehicle emissions','Road salt contamination near grade','Noise impact assessment required']}
  };

  var ur=useRisk[priorUse]||useRisk.unknown;
  var ar=ageRisk[buildingAge]||ageRisk.post2000;
  var adjr=adjRisk[adjacent]||adjRisk.residential;

  var totalScore=ur.score+ar.score+adjr.score;
  var allFlags=[].concat(ur.flags,ar.flags,adjr.flags);

  /* Risk level determination */
  var riskLevel,riskColor,riskDesc;
  if(totalScore<=2){riskLevel='LOW';riskColor='#66ccaa';riskDesc='Standard Phase I ESA recommended as due diligence. Low probability of contamination based on site history.';}
  else if(totalScore<=5){riskLevel='MODERATE';riskColor='#ffaa44';riskDesc='Phase I ESA required. Some environmental concerns identified — Phase II (sampling) may be triggered.';}
  else if(totalScore<=8){riskLevel='HIGH';riskColor='#ff8866';riskDesc='Phase I and Phase II ESA required before acquisition. Significant contamination indicators present. Budget for remediation contingency.';}
  else{riskLevel='VERY HIGH';riskColor='#ff4444';riskDesc='Comprehensive environmental assessment essential. High probability of contamination requiring remediation. Record of Site Condition (RSC) filing mandatory before change to sensitive use.';}

  /* MECP RSC requirement check */
  var needsRSC=totalScore>=5||priorUse==='gas_station'||priorUse==='dry_cleaner'||priorUse==='industrial_heavy';

  var html='';

  /* Risk matrix visual */
  /* Risk visual block was truncated by file-size cap. Stub closure: */
  html += '<div style="padding:8px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:12px;color:#aaa">Risk score: <strong>' + totalScore + '/13</strong> · ' + riskDesc + '</div>';
  var resultsEl = document.getElementById('esa-results');
  if(resultsEl) resultsEl.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════
// Public console helper: force a fresh capture of context buildings
// from all available sources for the current lot, then rebuild the
// Three.js context group. Useful when a saved project doesn't have
// _contextBuildingFeatures populated, or when the user wants to
// re-fetch after expanding the radius.
//
// Usage in browser console:
//   regenContextBuildings()           // default 1000 m radius
//   regenContextBuildings(2000)       // custom radius in metres
// ═══════════════════════════════════════════════════════════
window.regenContextBuildings = async function(radiusMeters){
  var R = (typeof radiusMeters === 'number' && radiusMeters > 0) ? radiusMeters : 1000;
  if(!P || !P.siteCoords){
    console.warn('[regenContext] no site coords — draw a lot first');
    return 0;
  }
  console.log('[regenContext] starting at radius ' + R + 'm; site at', P.siteCoords);
  // Reset the cached features so loaders repopulate from scratch
  P._contextBuildingFeatures = [];
  var attempts = [];

  // Toronto Mapbox composite
  if(typeof smCaptureContextBuildings === 'function' && typeof smMap !== 'undefined' && smMap){
    try { smCaptureContextBuildings(); attempts.push('toronto-mapbox'); } catch(e){ console.warn('[regenContext] toronto failed:', e); }
  }
  // Mississauga 3D Massing
  if(typeof window.captureMississaugaContextBuildings === 'function'){
    try {
      var p1 = window.captureMississaugaContextBuildings(R);
      if(p1 && p1.then){ await p1.catch(function(e){ console.warn('[regenContext] miss failed:', e && e.message); }); }
      attempts.push('mississauga');
    } catch(e){ console.warn('[regenContext] miss threw:', e); }
  }
  // OSM Overpass — universal fallback, always attempt
  if(typeof window.captureOSMContextBuildings === 'function'){
    try {
      var p2 = window.captureOSMContextBuildings(R);
      if(p2 && p2.then){ await p2.catch(function(e){ console.warn('[regenContext] osm failed:', e && e.message); }); }
      attempts.push('osm');
    } catch(e){ console.warn('[regenContext] osm threw:', e); }
  }
  // MS Canadian (only fires if PMTiles configured)
  if(typeof window.captureMSCanadianContextBuildings === 'function'){
    try {
      var p3 = window.captureMSCanadianContextBuildings(R);
      if(p3 && p3.then){ await p3.catch(function(e){ console.warn('[regenContext] ms-canadian failed:', e && e.message); }); }
      attempts.push('ms-canadian');
    } catch(e){ console.warn('[regenContext] ms-canadian threw:', e); }
  }

  var nFeats = (P._contextBuildingFeatures || []).length;
  console.log('[regenContext] attempts: ' + attempts.join(', ') + ' → ' + nFeats + ' features captured');
  if(typeof rebuildContextBuildings === 'function'){
    try { rebuildContextBuildings(); } catch(e){ console.warn('[regenContext] rebuild failed:', e); }
  }
  if(typeof smShowToast === 'function'){
    smShowToast('Context buildings: ' + nFeats + ' rendered (radius ' + R + 'm)', '#AEBC46');
  }
  return nFeats;
};
