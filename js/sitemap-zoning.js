// sitemap-zoning.js — Zoning overlay
// ═══════════════════════════════════════════════════════════════════════════════════
function _smZoningClickHandler(e){
  // Don't fire while drawing lot or building polygons
  if(smLotDrawing||smBldgDrawing)return;
  const lng=e.lngLat.lng, lat=e.lngLat.lat;
  // Remove previous popup
  if(_zoningPopup){_zoningPopup.remove();_zoningPopup=null;}
  // Show loading popup
  _zoningPopup=new mapboxgl.Popup({maxWidth:'340px',className:'zoning-popup'})
    .setLngLat([lng,lat])
    .setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#AEBC46;font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:6px">QUERYING ZONING...</div><div style="color:#888;font-size:10px">Loading from City of Toronto ArcGIS...</div></div>')
    .addTo(smMap);
  // Query ArcGIS
  detectZoning(lat,lng).then(z=>{
    if(!_zoningPopup)return;
    if(!z||!z.zone){
      _zoningPopup.setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#c44;font-size:10px;font-weight:700">NO ZONING DATA</div><div style="color:#888;font-size:10px;margin-top:4px">No zoning polygon found at this location.<br>This may be outside City of Toronto jurisdiction.</div></div>');
      return;
    }
    // Build the popup content
    const zc=(z.zone||'').toUpperCase();
    let typeLabel='Mixed-Use', typeColor='#AEBC46';
    if(zc.startsWith('CRE')){typeLabel='Commercial · Residential · Employment';typeColor='#e8c87a';}
    else if(zc.startsWith('CR')){typeLabel='Commercial · Residential';typeColor='#AEBC46';}
    else if(zc.startsWith('C')){typeLabel='Commercial';typeColor='#4ecdc4';}
    else if(zc.startsWith('RA')){typeLabel='Residential Apartment';typeColor='#ff9966';}
    else if(zc.startsWith('RD')){typeLabel='Residential Detached';typeColor='#88cc66';}
    else if(zc.startsWith('RS')){typeLabel='Residential Semi-Detached';typeColor='#88cc66';}
    else if(zc.startsWith('RT')){typeLabel='Residential Townhouse';typeColor='#88cc66';}
    else if(zc.startsWith('R')){typeLabel='Residential';typeColor='#ff9966';}
    else if(zc.startsWith('E')){typeLabel='Employment / Industrial';typeColor='#b088cc';}
    else if(zc.startsWith('I')){typeLabel='Institutional';typeColor='#cc8888';}
    else if(zc.startsWith('O')){typeLabel='Open Space / Parks';typeColor='#66bb66';}
    else if(zc.startsWith('U')){typeLabel='Utility';typeColor='#8899aa';}
    else{typeLabel='Other';typeColor='#888';}

    let html='<div style="font-family:Outfit,DM Sans,sans-serif;padding:2px;min-width:220px">';
    // Header bar
    html+='<div style="background:'+typeColor+';color:#111;padding:6px 10px;border-radius:4px;margin:-2px -2px 8px -2px">';
    html+='<div style="font-size:15px;font-weight:800;letter-spacing:0.5px">'+(z.zoneString||z.zone)+'</div>';
    html+='<div style="font-size:9px;font-weight:600;opacity:0.7;margin-top:1px">'+typeLabel+'</div>';
    html+='</div>';
    // Data grid
    html+='<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:11px;color:#333">';
    if(z.fsiLimit) html+='<span style="color:#888;font-weight:600">Max FSI</span><span style="font-weight:700">'+z.fsiLimit+'×</span>';
    if(z.fsiResi) html+='<span style="color:#888;font-size:10px;padding-left:8px">Residential</span><span style="font-size:10px">'+z.fsiResi+'×</span>';
    if(z.fsiComm) html+='<span style="color:#888;font-size:10px;padding-left:8px">Commercial</span><span style="font-size:10px">'+z.fsiComm+'×</span>';
    if(z.fsiEmploy) html+='<span style="color:#888;font-size:10px;padding-left:8px">Employment</span><span style="font-size:10px">'+z.fsiEmploy+'×</span>';
    if(!z.fsiLimit) html+='<span style="color:#888;font-weight:600">FSI</span><span style="color:#666;font-style:italic">Site-specific</span>';
    if(z.heightLimit) html+='<span style="color:#888;font-weight:600">Height</span><span style="font-weight:700">'+z.heightLimit+'m</span>';
    if(z.coverage) html+='<span style="color:#888;font-weight:600">Coverage</span><span style="font-weight:700">'+(z.coverage*100).toFixed(0)+'%</span>';
    html+='</div>';
    // Permitted uses
    if(z.permitted&&z.permitted.length>0){
      html+='<div style="margin-top:6px;padding-top:6px;border-top:1px solid #ddd">';
      html+='<div style="font-size:9px;color:#888;font-weight:600;letter-spacing:0.5px;margin-bottom:3px">PERMITTED USES</div>';
      html+='<div style="display:flex;flex-wrap:wrap;gap:3px">';
      z.permitted.forEach(p=>{html+='<span style="background:#f0f0f0;color:#333;padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600">'+p+'</span>';});
      html+='</div></div>';
    }
    // Exception warning
    if(z.exception){
      html+='<div style="margin-top:6px;padding:5px 8px;background:#fff8e8;border:1px solid #e8c87a;border-radius:4px;font-size:10px;color:#8a6d20">';
      html+='<b>⚠ Exception #'+(z.exceptionNo||'—')+'</b>';
      if(z.bylawException) html+=' <span style="color:#a08030">'+z.bylawException+'</span>';
      html+='</div>';
    }
    // By-law reference
    if(z.bylawSection){
      html+='<div style="margin-top:4px;font-size:9px;color:#999">§ '+z.bylawSection+' · By-law 569-2013</div>';
    }
    // Apply to project button
    html+='<button onclick="smApplyZoningToProject('+lat+','+lng+')" style="margin-top:8px;width:100%;background:#AEBC46;color:#111;border:none;border-radius:4px;padding:6px 0;cursor:pointer;font-weight:700;font-size:10px;letter-spacing:0.5px">APPLY TO PROJECT</button>';
    html+='</div>';
    _zoningPopup.setHTML(html);
  }).catch(e=>{
    if(_zoningPopup) _zoningPopup.setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#c44;font-size:10px;font-weight:700">QUERY FAILED</div><div style="color:#888;font-size:10px;margin-top:4px">'+e.message+'</div></div>');
  });
}

// Apply clicked zoning data to the current project
async function smApplyZoningToProject(lat,lng){
  try{
    const z=await detectZoning(lat,lng);
    if(z&&z.zone){
      P.zoning=z;
      autoSave();
      smShowToast('Zoning applied: '+(z.zoneString||z.zone),'#AEBC46');
      // Update the zoning info panel
      const zi=document.getElementById('zoning-info');
      if(zi){
        zi.style.display='block';
        zi.innerHTML=`
          <div style="color:#4ecdc4;font-weight:700;font-size:11px;margin-bottom:6px">📋 ZONING — By-law 569-2013</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div><span style="color:#888">Zone:</span> <b style="color:#AEBC46">${z.zoneString||z.zone}</b></div>
            <div><span style="color:#888">Max FSI:</span> <b style="color:#AEBC46">${z.fsiLimit?z.fsiLimit+'×':'Site-specific'}</b></div>
            <div><span style="color:#888">Height:</span> <b style="color:#AEBC46">${z.heightLimit?z.heightLimit+'m':'No overlay'}</b></div>
            <div><span style="color:#888">Coverage:</span> <b style="color:#AEBC46">${z.coverage?(z.coverage*100).toFixed(0)+'%':'—'}</b></div>
          </div>
          <div style="margin-top:4px"><span style="color:#888">Permitted:</span> <span style="color:#eee">${z.permitted.join(', ')}</span></div>
          ${z.exception?'<div style="margin-top:4px;color:#e8c87a">⚠ Exception #'+z.exceptionNo+' applies</div>':''}
        `;
      }
      try{renderReport();}catch(e){}
    }
  }catch(e){smShowToast('Failed to apply zoning','#c44');}
}

function smUpdateZoningToggleUI(on){
  const row=document.getElementById('zoning-toggle-row');
  const sw=document.getElementById('zoning-toggle-switch');
  const knob=document.getElementById('zoning-toggle-knob');
  const label=document.getElementById('zoning-toggle-label');
  const sub=document.getElementById('zoning-toggle-sub');
  if(on){
    if(row) row.style.border='1px solid #AEBC46';
    if(sw) sw.style.background='#AEBC46';
    if(knob){knob.style.left='16px';knob.style.background='#111';}
    if(label){label.style.color='#AEBC46';label.textContent='ZONING ON';}
    if(sub){sub.style.color='#AEBC46';sub.textContent='ON — Click map to identify zoning';}
  } else {
    if(row) row.style.border='1px solid #333';
    if(sw) sw.style.background='#333';
    if(knob){knob.style.left='2px';knob.style.background='#666';}
    if(label){label.style.color='#ccc';label.textContent='ZONING';}
    if(sub){sub.style.color='#666';sub.textContent='Click to show zoning overlay';}
  }
}

/**
 * Toggles the Toronto zoning WMS raster overlay on or off, and registers
 * a click handler for point-based zoning identification when active.
 */
async function toggleZoningOverlay(){
  if(!smMap)return;
  _zoningOverlayVisible=!_zoningOverlayVisible;

  if(!_zoningOverlayVisible){
    try{if(smMap.getLayer('zoning-tiles'))smMap.removeLayer('zoning-tiles');}catch(e){}
    try{if(smMap.getSource('zoning-wms'))smMap.removeSource('zoning-wms');}catch(e){}
    // Remove click handler & popup
    smMap.off('click',_smZoningClickHandler);
    if(_zoningPopup){_zoningPopup.remove();_zoningPopup=null;}
    if(!smLotDrawing&&!smBldgDrawing) smMap.getCanvas().style.cursor='';
    smUpdateZoningToggleUI(false);
    return;
  }

  smUpdateZoningToggleUI(true);

  // Use ArcGIS MapServer export as a raster tile source (no CORS issues, lightweight)
  try{if(smMap.getSource('zoning-wms'))smMap.removeSource('zoning-wms');}catch(e){}
  smMap.addSource('zoning-wms',{
    type:'raster',
    tiles:[
      'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&layers=show:3&f=image'
    ],
    tileSize:512
  });
  smMap.addLayer({
    id:'zoning-tiles',type:'raster',source:'zoning-wms',
    paint:{'raster-opacity':0.5}
  });

  // Register click handler for zoning identify
  smMap.off('click',_smZoningClickHandler); // prevent duplicates
  smMap.on('click',_smZoningClickHandler);
  if(!smLotDrawing&&!smBldgDrawing) smMap.getCanvas().style.cursor='pointer';
  smShowToast('Zoning overlay active — click anywhere to identify','#AEBC46');
}

// Auto-detect zoning using Toronto ArcGIS REST API (no CORS issues, lightweight queries)
const ZONING_ARCGIS='https://gis.toronto.ca/arcgis/rest/services/cot_geospatial11/FeatureServer';

/**
 * Queries the Toronto ArcGIS REST API to detect zoning designation, FSI limits,
 * height overlays, and permitted uses for a given coordinate.
 * @param {number} lat - Latitude of the query point.
 * @param {number} lng - Longitude of the query point.
 * @returns {Promise<Object>} Zoning result with zone, fsiLimit, heightLimit, permitted uses, etc.
 */
async function detectZoning(lat,lng){
  const result={zone:null,zoneString:null,height:null,lotCoverage:null,policy:null,permitted:[],fsiLimit:null,fsiResi:null,fsiComm:null,fsiEmploy:null,heightLimit:null,exception:null,exceptionNo:null,bylawSection:null,bylawException:null,coverage:null};

  try{
    // Query Zoning Area layer (ID: 3) by point
    const url=ZONING_ARCGIS+'/3/query?geometry='+lng+','+lat+'&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json&returnGeometry=false';
    const resp=await fetch(url,{signal:AbortSignal.timeout(10000)});
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const data=await resp.json();

    if(data.features&&data.features.length>0){
      const p=data.features[0].attributes;
      result.zone=p.ZN_ZONE||'Unknown';
      result.zoneString=p.ZN_STRING||result.zone;
      result.fsiLimit=p.FSI_TOTAL>0?p.FSI_TOTAL:null;
      result.fsiResi=p.FSI_RESIDENTIAL_USE>0?p.FSI_RESIDENTIAL_USE:null;
      result.fsiComm=p.FSI_COMMERCIAL_USE>0?p.FSI_COMMERCIAL_USE:null;
      result.fsiEmploy=p.FSI_EMPLOYMENT_USE>0?p.FSI_EMPLOYMENT_USE:null;
      result.coverage=p.ZN_COVERAGE>0?p.ZN_COVERAGE:null;
      result.exception=(p.ZN_EXCPTN==='Y');
      result.exceptionNo=p.ZN_EXCPTN_NO||null;
      result.bylawSection=p.ZBL_SECTION||null;
      result.bylawException=p.ZBL_EXCPTN||null;

      // Parse permitted uses from zone code
      const zc=(result.zone||'').toUpperCase();
      if(zc.startsWith('CRE'))result.permitted=['Commercial','Residential','Employment','Mixed-Use'];
      else if(zc.startsWith('CR'))result.permitted=['Commercial','Residential','Mixed-Use'];
      else if(zc.startsWith('C'))result.permitted=['Commercial','Retail','Office'];
      else if(zc.startsWith('RA'))result.permitted=['Residential Apartment'];
      else if(zc.startsWith('RD'))result.permitted=['Residential Detached'];
      else if(zc.startsWith('RS'))result.permitted=['Residential Semi-Detached'];
      else if(zc.startsWith('RT'))result.permitted=['Residential Townhouse'];
      else if(zc.startsWith('R'))result.permitted=['Residential'];
      else if(zc.startsWith('EL'))result.permitted=['Employment Light Industrial'];
      else if(zc.startsWith('EH'))result.permitted=['Employment Heavy Industrial'];
      else if(zc.startsWith('EO'))result.permitted=['Employment Office'];
      else if(zc.startsWith('E'))result.permitted=['Employment','Industrial','Office'];
      else if(zc.startsWith('I'))result.permitted=['Institutional'];
      else if(zc.startsWith('OS'))result.permitted=['Open Space — Natural'];
      else if(zc.startsWith('OR'))result.permitted=['Open Space — Recreation'];
      else if(zc.startsWith('O'))result.permitted=['Open Space'];
      else if(zc.startsWith('U'))result.permitted=['Utility'];
      else result.permitted=['See By-law 569-2013'];

      // Parse FSI from zone string if not in fields (e.g. "CR 3.0 (x142)")
      if(!result.fsiLimit){
        const fsiMatch=(result.zoneString||'').match(/([\d.]+)\s*(?:\(|$)/);
        if(fsiMatch)result.fsiLimit=parseFloat(fsiMatch[1]);
      }
    }
  }catch(e){
    console.warn('Zoning area query failed:',e.message);
  }

  // Query Height Overlay layer (try layer IDs that might contain height data)
  try{
    // Height overlay is typically in a separate layer — check layers 4-10
    for(const layerId of [4,5,6,7]){
      try{
        const url=ZONING_ARCGIS+'/'+layerId+'/query?geometry='+lng+','+lat+'&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=json&returnGeometry=false';
        const resp=await fetch(url,{signal:AbortSignal.timeout(5000)});
        if(!resp.ok)continue;
        const data=await resp.json();
        if(data.features&&data.features.length>0){
          const p=data.features[0].attributes;
          // Look for height-related fields
          if(p.HT_TXT||p.HEIGHT||p.ZN_ZONE){
            const htStr=p.HT_TXT||p.HEIGHT||p.ZN_ZONE||'';
            const htMatch=(htStr+'').match(/([\d.]+)/);
            if(htMatch){result.heightLimit=parseFloat(htMatch[1]);result.height=htStr;}
            break;
          }
        }
      }catch(e){continue;}
    }
  }catch(e){}

  return result;
}

// ══════════════════════════════════════════════════════════════════════
// PARCEL PICKER — Click-to-select property lot boundaries
// Uses free municipal ArcGIS Feature Services (CORS-enabled)
// ══════════════════════════════════════════════════════════════════════

const PARCEL_SERVICES=[
  // Service registry — ordered by reliability
  // PRIMARY: ArcGIS Online hosted (Esri cloud) — fast, ~0.2s, always available
  // FALLBACK: gis.toronto.ca on-premise — can be slow/timeout under load
  {
    name:'City of Toronto',
    url:'https://services3.arcgis.com/b9WvedVPoizGfvfD/ArcGIS/rest/services/COTGEO_MUN_PARCEL/FeatureServer/0/query',
    bounds:{minLng:-79.65,maxLng:-79.10,minLat:43.58,maxLat:43.86},
    fields:'ADDRESS_NUMBER,LINEAR_NAME_FULL,STATEDAREA,PARCELID,FEATURE_TYPE,Shape__Area',
    distance:10,
    filterType:'COMMON', // Skip CORRIDOR (roads), RESERVE parcels
    parse:p=>({
      address:(p.ADDRESS_NUMBER||'')+' '+(p.LINEAR_NAME_FULL||''),
      parcelId:p.PARCELID||null,
      areaSqM:p.Shape__Area||null,
      featureType:p.FEATURE_TYPE||null,
      owner:null, zoningCode:null
    })
  },
  {
    name:'City of Toronto (backup)',
    url:'https://gis.toronto.ca/arcgis/rest/services/cot_geospatial27/MapServer/34/query',
    bounds:{minLng:-79.65,maxLng:-79.10,minLat:43.58,maxLat:43.86},
    fields:'ADDRESS_NUMBER,LINEAR_NAME_FULL,STATEDAREA,PARCELID',
    distance:15,
    parse:p=>({
      address:(p.ADDRESS_NUMBER||'')+' '+(p.LINEAR_NAME_FULL||''),
      parcelId:p.PARCELID||null,
      areaSqM:p['SHAPE.AREA']||p.Shape__Area||null,
      owner:null, zoningCode:null
    })
  },
  {
    name:'City of Hamilton',
    url:'https://spatialsolutions.hamilton.ca/webgis/rest/services/General/Property/MapServer/19/query',
    bounds:{minLng:-80.25,maxLng:-79.55,minLat:43.15,maxLat:43.45},
    fields:'PROPERTY_ADDRESS,ROLL_NO,ASSESSMENT_2021',
    parse:p=>({
      address:p.PROPERTY_ADDRESS||null,
      parcelId:p.ROLL_NO||null,
      areaSqM:null,
      assessedValue:p.ASSESSMENT_2021||null
    })
  },
  {
    name:'City of Mississauga',
    url:'https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/Parcel/FeatureServer/0/query',
    bounds:{minLng:-79.82,maxLng:-79.50,minLat:43.50,maxLat:43.72},
    fields:'CITY_PIN,GIS_AREA,Shape__Area',
    parse:p=>({
      address:null,
      parcelId:p.CITY_PIN||null,
      areaSqM:p.GIS_AREA||p.Shape__Area||null
    })
  }
];

let smParcelPickerActive=false;
let smSelectedParcels=[];       // Array of {ringCoords, attributes, serviceName, geojsonFeature}
let smMultiParcelMode=false;    // true when accumulating parcels
let _smParcelClickBusy=false;   // guard against concurrent click handlers
let _smActivePopup=null;        // track active loading popup to prevent accumulation

// ── Vertex / Edge Snapping for Adjacent Parcels ──
// When two parcels share a boundary that differs by a few feet in the
// ArcGIS data, we snap vertices together so turf.union produces a clean
// merge without zig-zag slivers.

/**
 * Distance in metres between two [lng,lat] points (Haversine, inline).
 */
