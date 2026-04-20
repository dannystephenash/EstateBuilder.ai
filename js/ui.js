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
        <span style="color:#666;font-size:10px">Gross ${fl.grossSF.toLocaleString()} sf · Net ${fl.netSF.toLocaleString()} sf · ${fl.units.length} units · ${fl.efficiency}% eff</span>
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
      .meta{font-size:10px;color:#888}
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
          '<div style="padding:4px 8px;display:flex;justify-content:space-between;font-size:10px">'+
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

