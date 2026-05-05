/* sitemap-infrastructure.js
   ─────────────────────────────────────────────────────────────────────────
   Renders civil servicing infrastructure (watermains, sewers, hydrants,
   catchbasins) as visual layers on:

     1. The Mapbox Site Map  — line + circle layers tied to GeoJSON sources
     2. The Three.js Site Plan view — line meshes drawn ~3m underground

   Triggered by the "⚡ SCAN INFRASTRUCTURE" button in the Site Plan tab. After
   `_infraData` is populated by ui.js, this module reads the pipe / point
   collections and builds the layers.

   Dependencies (loaded earlier):
     - smMap         (Mapbox map, from sitemap-core.js)
     - scene         (Three.js scene, from renderer.js)
     - P.siteCoords  ({lng, lat}, from data-model.js)
     - f2m / m2f / FT (unit conversion, from data-model.js)
     - _infraData    (populated by scanInfrastructure() in ui.js)
   ─────────────────────────────────────────────────────────────────────── */

/* === Layer ID constants — used for cleanup so re-scans don't duplicate === */
var INFRA_LAYER_IDS = {
  water:      ['infra-water-line', 'infra-water-casing'],
  sewer:      ['infra-sewer-line', 'infra-sewer-casing'],
  hydrant:    ['infra-hydrant-pt', 'infra-hydrant-glow', 'infra-hydrant-core'],
  valve:      ['infra-valve-pt', 'infra-valve-glow'],
  catchbasin: ['infra-catchbasin-pt', 'infra-catchbasin-glow']
};
var INFRA_SOURCE_IDS = {
  water:      'infra-water-src',
  sewer:      'infra-sewer-src',
  hydrant:    'infra-hydrant-src',
  valve:      'infra-valve-src',
  catchbasin: 'infra-catchbasin-src'
};

/* === Color palette — kept close to existing UI colors in ui.js ===
   Sewer hues bumped to be more saturated so they read as clearly distinct
   from the watermain blue (especially important in 3D where lines compete
   with the satellite ground texture). */
var INFRA_COLORS = {
  water:    '#66aaff',  /* matches NEAREST WATERMAINS panel */
  sanitary: '#aa55ee',  /* vivid purple — was #8888cc (too close to water blue) */
  storm:    '#33cc77',  /* deeper green — was #66cc88 */
  combined: '#ff7733',  /* deeper orange — was #ff8866 */
  sewerDef: '#cc55ff',  /* vivid magenta-purple — fallback when flow type unknown */
  hydrant:  '#ff3333',  /* fire-engine red — slightly more saturated */
  valve:    '#ffaa00',  /* amber */
  catchbasin:'#22ccdd'  /* brighter cyan */
};

/* === Storage of Three.js objects so we can remove them on rescan === */
var _infra3DObjects = [];

/* Helper: convert a CSS hex colour into a linear-space THREE.Color.
   The renderer is configured with outputEncoding = sRGBEncoding, which means
   shader outputs are gamma-encoded on the way to the screen. To make the
   *displayed* pixel match the requested CSS hex (e.g. the same #66aaff used
   on the Mapbox layer), we need the material colour in LINEAR space so the
   sRGB encoding round-trips back to the original hex.
   Without this conversion, a hex colour interpreted as linear would be
   over-brightened on screen — which is why colours looked muted/washed out
   when compared side-by-side with the map. */
function _infraColor(hex){
  if(typeof THREE === 'undefined') return null;
  var c = new THREE.Color(hex);
  if(typeof c.convertSRGBToLinear === 'function') c.convertSRGBToLinear();
  return c;
}

/* ──────────────────────────────────────────────────────────────────────────
   Public entry point — call this after scanInfrastructure() completes.
   Reads _infraData and rebuilds all layers (clears old ones first).
   ────────────────────────────────────────────────────────────────────── */
function renderInfraLayers(){
  if(typeof _infraData === 'undefined' || !_infraData) return;

  /* Mapbox layers — only if the map is initialised. */
  if(typeof smMap !== 'undefined' && smMap && smMap.isStyleLoaded && smMap.isStyleLoaded()){
    _renderInfraOnMap();
  } else if(typeof smMap !== 'undefined' && smMap){
    /* Style not yet loaded — wait for it. */
    smMap.once('style.load', _renderInfraOnMap);
  }

  /* Three.js — only if scene is initialised. */
  if(typeof scene !== 'undefined' && scene && typeof THREE !== 'undefined'){
    _renderInfraOn3D();
  }
}

/* ──────────────────────────────────────────────────────────────────────────
                              MAPBOX LAYERS
   ────────────────────────────────────────────────────────────────────── */

function _renderInfraOnMap(){
  _clearInfraMapLayers();

  var stats = {water:0, sewer:0, hydrant:0, valve:0, catchbasin:0};

  /* === Watermains === */
  if(Array.isArray(_infraData.watermain) && _infraData.watermain.length > 0){
    var waterFc = _infraPipesToFeatureCollection(_infraData.watermain, 'water');
    stats.water = waterFc.features.length;
    if(waterFc.features.length){
      smMap.addSource(INFRA_SOURCE_IDS.water, {type:'geojson', data:waterFc});
      /* Outer halo (white glow) for visibility against dark/busy satellite imagery. */
      smMap.addLayer({
        id:'infra-water-casing', type:'line', source:INFRA_SOURCE_IDS.water,
        layout:{'line-join':'round','line-cap':'round'},
        paint:{
          'line-color':'#ffffff','line-opacity':0.45,
          'line-width':['interpolate',['linear'],['get','diameter'], 100, 14, 300, 18, 600, 24],
          'line-blur':2
        }
      });
      smMap.addLayer({
        id:'infra-water-line', type:'line', source:INFRA_SOURCE_IDS.water,
        layout:{'line-join':'round','line-cap':'round'},
        paint:{
          'line-color':INFRA_COLORS.water,
          /* Thicker, more visible — diameter in mm scaled to px. */
          'line-width':['interpolate',['linear'],['get','diameter'], 100, 6, 300, 9, 600, 14],
          'line-opacity':1.0
        }
      });
    }
  }

  /* === Sewers — coloured by flow type === */
  if(Array.isArray(_infraData.sewer) && _infraData.sewer.length > 0){
    var sewerFc = _infraPipesToFeatureCollection(_infraData.sewer, 'sewer');
    stats.sewer = sewerFc.features.length;
    if(sewerFc.features.length){
      smMap.addSource(INFRA_SOURCE_IDS.sewer, {type:'geojson', data:sewerFc});
      smMap.addLayer({
        id:'infra-sewer-casing', type:'line', source:INFRA_SOURCE_IDS.sewer,
        layout:{'line-join':'round','line-cap':'round'},
        paint:{
          'line-color':'#ffffff','line-opacity':0.45,
          'line-width':['interpolate',['linear'],['get','diameter'], 200, 16, 600, 22, 1500, 30],
          'line-blur':2
        }
      });
      smMap.addLayer({
        id:'infra-sewer-line', type:'line', source:INFRA_SOURCE_IDS.sewer,
        layout:{'line-join':'round','line-cap':'round'},
        paint:{
          'line-color':[
            'match', ['get','flowCat'],
            'sanitary', INFRA_COLORS.sanitary,
            'storm',    INFRA_COLORS.storm,
            'combined', INFRA_COLORS.combined,
            INFRA_COLORS.sewerDef
          ],
          'line-width':['interpolate',['linear'],['get','diameter'], 200, 8, 600, 12, 1500, 18],
          'line-opacity':1.0
        }
      });
    }
  }

  /* === Point features (hydrants / valves / catchbasins) === */
  /* Bumped radii so points read clearly against satellite imagery — hydrants
     deliberately largest (most operationally important for fire-flow review). */
  stats.hydrant    = _renderInfraPointLayer('hydrant',    INFRA_COLORS.hydrant,    10);
  stats.valve      = _renderInfraPointLayer('valve',      INFRA_COLORS.valve,      7);
  stats.catchbasin = _renderInfraPointLayer('catchbasin', INFRA_COLORS.catchbasin, 8);

  /* Hover popups so you can verify the data looks right. */
  _attachInfraPopups();

  console.log('[Infra] Map layers rendered:',
    stats.water+' watermains, '+stats.sewer+' sewers, '+
    stats.hydrant+' hydrants, '+stats.valve+' valves, '+stats.catchbasin+' catchbasins');
}

/* Renders a point feature as THREE stacked circle layers:
     1. Soft outer halo (low opacity, blurred) — pulls the eye and survives
        being placed on busy satellite imagery
     2. Solid white ring (2px thicker than core) — high-contrast outline
     3. Coloured core circle (the main marker)
   Hydrants additionally get a small white centre dot to read like a fire-
   hydrant cap symbol from a distance.
   Returns the number of features rendered. */
function _renderInfraPointLayer(key, color, radius){
  var data = _infraData[key];
  if(!Array.isArray(data) || data.length === 0) return 0;
  var features = data.filter(function(p){
    return p && typeof p.lng === 'number' && typeof p.lat === 'number';
  }).map(function(p){
    return {
      type:'Feature',
      geometry:{type:'Point', coordinates:[p.lng, p.lat]},
      properties:{id:p.id||'', label:p.label||key, kind:key, dist:p.dist||0}
    };
  });
  if(!features.length) return 0;

  smMap.addSource(INFRA_SOURCE_IDS[key], {type:'geojson', data:{type:'FeatureCollection', features:features}});

  /* Layer 1 — outer glow halo (drawn first = bottom of stack). */
  smMap.addLayer({
    id:INFRA_LAYER_IDS[key][1], /* infra-<key>-glow */
    type:'circle', source:INFRA_SOURCE_IDS[key],
    paint:{
      'circle-radius':radius + 8,
      'circle-color':color,
      'circle-opacity':0.30,
      'circle-blur':1.0
    }
  });

  /* Layer 2 — main coloured core with white outline. */
  smMap.addLayer({
    id:INFRA_LAYER_IDS[key][0], /* infra-<key>-pt */
    type:'circle', source:INFRA_SOURCE_IDS[key],
    paint:{
      'circle-radius':radius,
      'circle-color':color,
      'circle-stroke-color':'#ffffff',
      'circle-stroke-width':3,
      'circle-opacity':1.0
    }
  });

  /* Layer 3 — small white centre dot for hydrants only (gives them a
     hydrant-cap look so they're instantly recognisable). */
  if(key === 'hydrant' && INFRA_LAYER_IDS[key][2]){
    smMap.addLayer({
      id:INFRA_LAYER_IDS[key][2], /* infra-hydrant-core */
      type:'circle', source:INFRA_SOURCE_IDS[key],
      paint:{
        'circle-radius':Math.max(2, radius * 0.35),
        'circle-color':'#ffffff',
        'circle-opacity':1.0
      }
    });
  }
  return features.length;
}

/* Hover popup for the Site Map — implemented as a plain fixed-position HTML
   overlay (NOT mapboxgl.Popup). The Mapbox Popup component was producing
   inconsistent results for the user — events registered but the popup either
   failed to anchor or was hidden by another element's CSS. Using the same
   HTML-overlay pattern as the 3D tooltip gives identical, reliable behaviour
   and lets the two views share a consistent look. */
var _infraPopupsWired = false;
var _infraMapTooltipEl = null;

function _attachInfraPopups(){
  if(_infraPopupsWired) return; /* idempotent — re-scans don't re-bind */
  if(typeof smMap === 'undefined' || !smMap) return;

  /* Build (or reuse) the floating tooltip element. */
  _infraMapTooltipEl = document.getElementById('infra-map-tooltip');
  if(!_infraMapTooltipEl){
    _infraMapTooltipEl = document.createElement('div');
    _infraMapTooltipEl.id = 'infra-map-tooltip';
    _infraMapTooltipEl.style.cssText =
      'position:fixed;display:none;pointer-events:none;z-index:10000;'+
      'background:#fff;color:#222;font-family:sans-serif;font-size:12px;'+
      'line-height:1.4;padding:8px 10px;border-radius:6px;'+
      'box-shadow:0 4px 12px rgba(0,0,0,0.35);max-width:260px;'+
      'border:1px solid #ddd';
    document.body.appendChild(_infraMapTooltipEl);
  }
  var hoverable = ['infra-water-line','infra-sewer-line',
                   'infra-hydrant-pt','infra-valve-pt','infra-catchbasin-pt'];

  function _formatHtml(p){
    var html = '<div>';
    if(p.kind === 'water'){
      html += '<div style="font-weight:700;color:#0066cc;margin-bottom:4px">WATERMAIN</div>';
      html += 'Diameter: <b>'+p.diameter+'mm</b><br>';
      html += 'Material: '+(p.material||'—')+'<br>';
      html += 'Year: '+(p.year||'—')+'<br>';
      html += 'Street: '+(p.street||'—');
    } else if(p.kind === 'sewer'){
      var cat = (p.flowCat||'unknown').toUpperCase();
      html += '<div style="font-weight:700;color:#7744cc;margin-bottom:4px">SEWER · '+cat+'</div>';
      html += 'Diameter: <b>'+p.diameter+'mm</b><br>';
      html += 'Material: '+(p.material||'—')+'<br>';
      html += 'Year: '+(p.year||'—')+'<br>';
      html += 'Street: '+(p.street||'—');
    } else if(p.kind === 'hydrant'){
      html += '<div style="font-weight:700;color:#cc2222;margin-bottom:4px">🔥 FIRE HYDRANT</div>';
      html += 'ID: '+(p.id||'—')+'<br>';
      html += 'Distance from site: <b>'+(p.dist||'?')+'m</b>';
    } else if(p.kind === 'valve'){
      html += '<div style="font-weight:700;color:#cc8800;margin-bottom:4px">VALVE</div>';
      html += 'ID: '+(p.id||'—');
    } else if(p.kind === 'catchbasin'){
      html += '<div style="font-weight:700;color:#1188aa;margin-bottom:4px">CATCH BASIN</div>';
      html += 'ID: '+(p.id||'—');
    }
    html += '</div>';
    return html;
  }

  /* Single map-wide mousemove handler — uses queryRenderedFeatures to pick
     the topmost infra feature under the cursor. More reliable than per-layer
     mouseenter/mouseleave events. */
  smMap.on('mousemove', function(e){
    var existing = hoverable.filter(function(id){return !!smMap.getLayer(id);});
    if(existing.length === 0){
      _infraMapTooltipEl.style.display = 'none';
      smMap.getCanvas().style.cursor = '';
      return;
    }
    var features = smMap.queryRenderedFeatures(e.point, {layers:existing});
    if(features.length > 0){
      var props = features[0].properties || {};
      _infraMapTooltipEl.innerHTML = _formatHtml(props);
      _infraMapTooltipEl.style.display = 'block';
      /* originalEvent gives us page coordinates needed for `position:fixed`. */
      var oe = e.originalEvent || e;
      _infraMapTooltipEl.style.left = (oe.clientX + 12) + 'px';
      _infraMapTooltipEl.style.top  = (oe.clientY + 12) + 'px';
      smMap.getCanvas().style.cursor = 'pointer';
    } else {
      _infraMapTooltipEl.style.display = 'none';
      smMap.getCanvas().style.cursor = '';
    }
  });

  /* Hide on cursor leaving the map canvas. */
  smMap.on('mouseout', function(){
    if(_infraMapTooltipEl) _infraMapTooltipEl.style.display = 'none';
    smMap.getCanvas().style.cursor = '';
  });

  _infraPopupsWired = true;
}

function _clearInfraMapLayers(){
  if(typeof smMap === 'undefined' || !smMap) return;
  Object.keys(INFRA_LAYER_IDS).forEach(function(key){
    INFRA_LAYER_IDS[key].forEach(function(lid){
      if(smMap.getLayer(lid)) smMap.removeLayer(lid);
    });
    var sid = INFRA_SOURCE_IDS[key];
    if(smMap.getSource(sid)) smMap.removeSource(sid);
  });
}

/* Convert array of pipe records → GeoJSON FeatureCollection.
   Pipe records have .geometry = [[lng,lat],[lng,lat],...] (array of coords). */
function _infraPipesToFeatureCollection(pipes, kind){
  var features = [];
  pipes.forEach(function(p){
    if(!p.geometry || !Array.isArray(p.geometry) || p.geometry.length < 2) return;
    var props = {
      diameter: typeof p.diameter === 'number' ? p.diameter : parseFloat(p.diameter)||300,
      material: p.material || '',
      year:     p.year || '',
      street:   p.street || '',
      kind:     kind
    };
    if(kind === 'sewer') props.flowCat = _classifySewerFlow(p.flowType);
    features.push({
      type:'Feature',
      geometry:{type:'LineString', coordinates:p.geometry},
      properties:props
    });
  });
  return {type:'FeatureCollection', features:features};
}

/* Map raw flow type codes from Toronto CKAN to broad categories. */
function _classifySewerFlow(flowType){
  var ft = (flowType||'').toUpperCase();
  if(ft === 'SAN') return 'sanitary';
  if(ft === 'STM' || ft === 'STRM' || ft === 'SCSO') return 'storm';
  if(ft === 'COM' || ft === 'CMB' || ft === 'CSO') return 'combined';
  return 'unknown';
}

/* ──────────────────────────────────────────────────────────────────────────
                              THREE.JS LAYERS
   Render pipes as line meshes ~3m below grade (Y = -3m).
   Lat/lng coords are projected to local meters using a flat-earth approx
   centred on P.siteCoords (accurate to <1m within typical 300m radius).
   ────────────────────────────────────────────────────────────────────── */

/* Conceptually pipes are buried, but rendering them at Y < 0 hides them
   under the opaque satellite ground plane. We instead render JUST ABOVE the
   ground plane so the user can see the alignment overlaid on the imagery.
   Sewer lines are nudged a bit higher than water so the two don't z-fight. */
var INFRA_WATER_Y_M = 0.30;
var INFRA_SEWER_Y_M = 0.45;
var INFRA_HYDRANT_HEIGHT_M = 0.6;      /* hydrants stand above grade */

function _renderInfraOn3D(){
  _clearInfra3DLayers();

  /* Use P._gpsOrigin (the lot centroid) — this is what renderer-components.js
     uses to position the satellite ground plane, so pipes will line up with
     the satellite imagery and the building. Fall back to siteCoords if not set. */
  var origin = (P && P._gpsOrigin) || (P && P.siteCoords) || null;
  if(!origin) return;
  var oLng = origin.lng, oLat = origin.lat;

  /* Watermains — flat blue ribbons with white halo (matches Mapbox style). */
  if(Array.isArray(_infraData.watermain)){
    _infraData.watermain.forEach(function(p){
      _addPipeStrip3D(p.geometry, INFRA_COLORS.water, INFRA_WATER_Y_M, p.diameter, oLng, oLat,
        {kind:'water', diameter:p.diameter, material:p.material, year:p.year, street:p.street},
        'water');
    });
  }

  /* Sewers — flat coloured ribbons by flow category. Passed `kind:'sewer'` so
     _addPipeStrip3D applies the chunkier sewer width formula (sewer pipes are
     typically 2-3× the diameter of watermains, so they read thicker on the map). */
  if(Array.isArray(_infraData.sewer)){
    _infraData.sewer.forEach(function(p){
      var cat = _classifySewerFlow(p.flowType);
      var col = INFRA_COLORS.sewerDef;
      if(cat === 'sanitary') col = INFRA_COLORS.sanitary;
      else if(cat === 'storm') col = INFRA_COLORS.storm;
      else if(cat === 'combined') col = INFRA_COLORS.combined;
      _addPipeStrip3D(p.geometry, col, INFRA_SEWER_Y_M, p.diameter, oLng, oLat,
        {kind:'sewer', flowCat:cat, diameter:p.diameter, material:p.material, year:p.year, street:p.street},
        'sewer');
    });
  }

  /* Hydrants — flat circular discs (red core + white ring + white centre dot
     + soft halo) so they look like the Mapbox hydrant markers. */
  _addHydrants3D(oLng, oLat);

  /* Valves and catchbasins — small flat coloured discs, scaled to match the
     map markers. (core_radius_m, halo_radius_m). */
  _addPointDiscs3D('valve',      INFRA_COLORS.valve,      0.50, 1.05, oLng, oLat);
  _addPointDiscs3D('catchbasin', INFRA_COLORS.catchbasin, 0.55, 1.15, oLng, oLat);

  /* Wire up hover tooltip — uses raycasting on the renderer canvas. */
  _attachInfra3DHover();
}

/* ──────────────────────────────────────────────────────────────────────────
   Flat-ribbon pipe rendering — builds a 2-vertex-wide strip following the
   polyline so it appears as a coloured line on the ground (no rounded tube).
   Includes a wider white halo strip below for contrast against satellite.
   ────────────────────────────────────────────────────────────────────── */
function _addPipeStrip3D(coords, color, yM, diameterMm, oLng, oLat, hoverData, kind){
  if(!Array.isArray(coords) || coords.length < 2) return;
  var pts = [];
  for(var i = 0; i < coords.length; i++){
    var c = coords[i];
    if(!c || c.length < 2) continue;
    var local = _llToLocalMeters(c[0], c[1], oLng, oLat);
    pts.push({x:local.x, z:local.z});
  }
  if(pts.length < 2) return;

  /* Strip width scales with diameter (mm), but sewers and watermains use
     different scale factors that mirror the Mapbox interpolation:
       - Watermains: 100mm→6px, 600mm→14px  (line-width / 50 → metres)
       - Sewers:     200mm→8px, 1500mm→18px (line-width / 50 → metres)
     The result: a typical 600mm sewer reads chunkier than a 300mm watermain,
     matching the visual hierarchy on the map. */
  var dMm = (typeof diameterMm === 'number' && diameterMm > 0) ? diameterMm : 250;
  var coreW;
  if(kind === 'sewer'){
    /* 200mm → 1.6m, 600mm → 2.4m, 1500mm → 3.6m, clamped 1.4-3.6 */
    coreW = Math.max(1.4, Math.min(3.6, 1.4 + (dMm - 200) * (3.6 - 1.4) / (1500 - 200)));
  } else {
    /* watermain: 100mm → 1.0m, 300mm → 1.5m, 600mm → 2.4m, clamped 0.9-2.4 */
    coreW = Math.max(0.9, Math.min(2.4, 0.9 + (dMm - 100) * (2.4 - 0.9) / (600 - 100)));
  }
  var haloW = coreW + 1.2;                                  /* halo ~1.2m wider — subtle but visible */

  /* Halo strip — narrow white outline. Lower Y, lower opacity, lower renderOrder
     so it sits BEHIND the coloured core (otherwise the transparent halo paints
     over the core and washes out the colour). */
  var haloGeom = _buildFlatStripGeometry(pts, haloW / 2, yM - 0.02);
  if(haloGeom){
    var haloMat = new THREE.MeshBasicMaterial({
      color:0xffffff, transparent:true, opacity:0.35, depthWrite:false,
      toneMapped:false
    });
    var halo = new THREE.Mesh(haloGeom, haloMat);
    halo.renderOrder = 1;          /* behind core */
    halo.userData = {infraLayer:true};
    scene.add(halo);
    _infra3DObjects.push(halo);
  }

  /* Core strip — coloured line. Higher renderOrder so it always paints on
     top of the halo, preserving the saturated colour. */
  var coreGeom = _buildFlatStripGeometry(pts, coreW / 2, yM);
  if(coreGeom){
    var coreMat = new THREE.MeshBasicMaterial({
      color:_infraColor(color), transparent:false, depthWrite:false,
      toneMapped:false
    });
    var core = new THREE.Mesh(coreGeom, coreMat);
    core.renderOrder = 2;          /* on top of halo */
    core.userData = {infraLayer:true, infraData:hoverData};
    scene.add(core);
    _infra3DObjects.push(core);
  }
}

/* Builds a flat ribbon BufferGeometry following the given XZ polyline.
   For each vertex we compute the perpendicular in the XZ plane (mitered at
   joints by averaging incoming and outgoing directions) and emit two vertices,
   left and right of the centreline. Triangles connect consecutive pairs.
   Returns null on degenerate input. */
function _buildFlatStripGeometry(pts, halfWidth, yM){
  var n = pts.length;
  if(n < 2) return null;
  var verts = [];
  var indices = [];
  for(var i = 0; i < n; i++){
    var p = pts[i];
    var dx, dz;
    if(i === 0){
      dx = pts[1].x - p.x;
      dz = pts[1].z - p.z;
    } else if(i === n - 1){
      dx = p.x - pts[n-2].x;
      dz = p.z - pts[n-2].z;
    } else {
      /* Average of segment-in and segment-out directions for a mitered join. */
      dx = pts[i+1].x - pts[i-1].x;
      dz = pts[i+1].z - pts[i-1].z;
    }
    var len = Math.sqrt(dx*dx + dz*dz);
    if(len < 1e-6){ dx = 1; dz = 0; len = 1; }
    /* Perpendicular in XZ plane: rotate (dx,dz) 90° → (-dz, dx) and normalise. */
    var perpX = -dz / len;
    var perpZ =  dx / len;
    /* Left vertex (centre + perp*halfWidth), then right vertex. */
    verts.push(p.x + perpX * halfWidth, yM, p.z + perpZ * halfWidth);
    verts.push(p.x - perpX * halfWidth, yM, p.z - perpZ * halfWidth);
  }
  /* Two triangles per quad between consecutive vertex pairs. */
  for(var j = 0; j < n - 1; j++){
    var a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
  var geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/* Hydrants — three flat circular discs stacked: outer halo (semi-transparent),
   red core, small white centre dot. Mirrors the Mapbox hydrant style. */
function _addHydrants3D(oLng, oLat){
  var data = _infraData.hydrant;
  if(!Array.isArray(data) || data.length === 0) return;

  /* Sizes drastically reduced — match the small bright dots the Mapbox layer
     produces (~10 px ≈ 1.0-1.4m at typical zoom). */
  var haloRm = 1.3, ringRm = 0.85, coreRm = 0.65, dotRm = 0.20;
  var haloGeom = new THREE.CircleGeometry(haloRm, 24); haloGeom.rotateX(-Math.PI/2);
  var ringGeom = new THREE.CircleGeometry(ringRm, 24); ringGeom.rotateX(-Math.PI/2);
  var coreGeom = new THREE.CircleGeometry(coreRm, 24); coreGeom.rotateX(-Math.PI/2);
  var dotGeom  = new THREE.CircleGeometry(dotRm,  16); dotGeom.rotateX(-Math.PI/2);

  /* 4-layer stack: red halo (soft glow) → white ring → red core → white dot.
     Mirrors the Mapbox triple-stack (halo + core+stroke + dot) but with an
     explicit white ring layer because Three.js MeshBasicMaterial doesn't
     support strokes the way Mapbox circles do. */
  /* Subtle red halo — low opacity so it doesn't wash out the core. */
  var haloMat = new THREE.MeshBasicMaterial({color:_infraColor(INFRA_COLORS.hydrant), transparent:true, opacity:0.25, depthWrite:false, toneMapped:false});
  var ringMat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:false, depthWrite:false, toneMapped:false});
  var coreMat = new THREE.MeshBasicMaterial({color:_infraColor(INFRA_COLORS.hydrant), transparent:false, depthWrite:false, toneMapped:false});
  var dotMat  = new THREE.MeshBasicMaterial({color:0xffffff, transparent:false, depthWrite:false, toneMapped:false});

  data.forEach(function(p){
    if(typeof p.lng !== 'number' || typeof p.lat !== 'number') return;
    var loc = _llToLocalMeters(p.lng, p.lat, oLng, oLat);
    var hoverData = {kind:'hydrant', id:p.id||'', dist:p.dist||0};

    /* Stack via renderOrder so transparent halo can never paint over the
       opaque core. Layers (back→front): halo → ring → core → dot. */
    var halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.set(loc.x, INFRA_WATER_Y_M + 0.02, loc.z);
    halo.renderOrder = 1;
    halo.userData = {infraLayer:true};
    scene.add(halo); _infra3DObjects.push(halo);

    var ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(loc.x, INFRA_WATER_Y_M + 0.03, loc.z);
    ring.renderOrder = 2;
    ring.userData = {infraLayer:true};
    scene.add(ring); _infra3DObjects.push(ring);

    var core = new THREE.Mesh(coreGeom, coreMat);
    core.position.set(loc.x, INFRA_WATER_Y_M + 0.04, loc.z);
    core.renderOrder = 3;
    /* Hover-data lives on the core so the tooltip fires when the user mouses
       over the visible red disc. */
    core.userData = {infraLayer:true, infraData:hoverData};
    scene.add(core); _infra3DObjects.push(core);

    var dot = new THREE.Mesh(dotGeom, dotMat);
    dot.position.set(loc.x, INFRA_WATER_Y_M + 0.05, loc.z);
    dot.renderOrder = 4;
    dot.userData = {infraLayer:true};
    scene.add(dot); _infra3DObjects.push(dot);
  });
}

/* Generic flat-disc renderer for valves and catchbasins — coloured core
   with a soft halo behind. */
function _addPointDiscs3D(key, color, coreRm, haloRm, oLng, oLat){
  var data = _infraData[key];
  if(!Array.isArray(data) || data.length === 0) return;

  var haloGeom = new THREE.CircleGeometry(haloRm, 24); haloGeom.rotateX(-Math.PI/2);
  var ringGeom = new THREE.CircleGeometry(coreRm * 1.35, 24); ringGeom.rotateX(-Math.PI/2);
  var coreGeom = new THREE.CircleGeometry(coreRm, 24); coreGeom.rotateX(-Math.PI/2);
  /* Subtle halo so the core colour is preserved at full saturation. */
  var haloMat = new THREE.MeshBasicMaterial({color:_infraColor(color), transparent:true, opacity:0.25, depthWrite:false, toneMapped:false});
  var ringMat = new THREE.MeshBasicMaterial({color:0xffffff, transparent:false, depthWrite:false, toneMapped:false});
  var coreMat = new THREE.MeshBasicMaterial({color:_infraColor(color), transparent:false, depthWrite:false, toneMapped:false});

  data.forEach(function(p){
    if(typeof p.lng !== 'number' || typeof p.lat !== 'number') return;
    var loc = _llToLocalMeters(p.lng, p.lat, oLng, oLat);
    var hoverData = {kind:key, id:p.id||''};

    var halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.set(loc.x, INFRA_WATER_Y_M + 0.02, loc.z);
    halo.renderOrder = 1;
    halo.userData = {infraLayer:true};
    scene.add(halo); _infra3DObjects.push(halo);

    var ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.set(loc.x, INFRA_WATER_Y_M + 0.03, loc.z);
    ring.renderOrder = 2;
    ring.userData = {infraLayer:true};
    scene.add(ring); _infra3DObjects.push(ring);

    var core = new THREE.Mesh(coreGeom, coreMat);
    core.position.set(loc.x, INFRA_WATER_Y_M + 0.04, loc.z);
    core.renderOrder = 3;
    core.userData = {infraLayer:true, infraData:hoverData};
    scene.add(core); _infra3DObjects.push(core);
  });
}

/* Flat-earth lng/lat → local (x, z) in metres centred on origin (oLng, oLat).
   Uses the same constants the satellite renderer uses (mPerDegLat = 111132)
   so pipes line up exactly with the ground-plane imagery.
   X+ = East, Z+ = South (matches project convention from CLAUDE.md). */
function _llToLocalMeters(lng, lat, oLng, oLat){
  var mPerDegLat = 111132;
  var mPerDegLng = 111132 * Math.cos(oLat * Math.PI / 180);
  var x = (lng - oLng) * mPerDegLng;       /* East+ */
  var z = -(lat - oLat) * mPerDegLat;       /* Z+ = South: north of origin → z<0 */
  return {x:x, z:z};
}

function _clearInfra3DLayers(){
  if(typeof scene === 'undefined' || !scene) return;
  _infra3DObjects.forEach(function(obj){
    scene.remove(obj);
    if(obj.geometry) obj.geometry.dispose();
    if(obj.material){
      if(Array.isArray(obj.material)) obj.material.forEach(function(m){m.dispose();});
      else obj.material.dispose();
    }
  });
  _infra3DObjects = [];
}

/* ──────────────────────────────────────────────────────────────────────────
   3D Hover Tooltip — uses Three.js raycasting to detect mouse-over on infra
   meshes and shows an HTML overlay matching the Mapbox popup style.

   Listener is attached only once (idempotent). Tracked separately from the
   _infra3DObjects array so that re-scans don't duplicate event listeners.
   ────────────────────────────────────────────────────────────────────── */
var _infra3DHoverWired = false;
var _infra3DTooltipEl = null;
var _infra3DRaycaster = null;
var _infra3DPointer = null;

function _attachInfra3DHover(){
  if(_infra3DHoverWired) return;
  if(typeof renderer === 'undefined' || !renderer || !renderer.domElement) return;
  if(typeof camera === 'undefined' || !camera) return;

  /* Build the floating tooltip element once — positioned absolutely over the canvas. */
  _infra3DTooltipEl = document.createElement('div');
  _infra3DTooltipEl.id = 'infra-3d-tooltip';
  _infra3DTooltipEl.style.cssText =
    'position:fixed;display:none;pointer-events:none;z-index:10000;'+
    'background:#fff;color:#222;font-family:sans-serif;font-size:12px;'+
    'line-height:1.4;padding:8px 10px;border-radius:6px;'+
    'box-shadow:0 4px 12px rgba(0,0,0,0.35);max-width:260px;'+
    'border:1px solid #ddd';
  document.body.appendChild(_infra3DTooltipEl);

  _infra3DRaycaster = new THREE.Raycaster();
  /* Slightly thicker ray hit threshold for line objects (not used by our
     ribbon meshes, but covers the line-fallback path). */
  _infra3DRaycaster.params.Line.threshold = 0.5;
  _infra3DPointer = new THREE.Vector2();

  var canvas = renderer.domElement;

  canvas.addEventListener('mousemove', function(ev){
    /* Only ray-cast if there are infra objects in the scene. */
    if(_infra3DObjects.length === 0){ _infra3DTooltipEl.style.display = 'none'; return; }

    var rect = canvas.getBoundingClientRect();
    _infra3DPointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    _infra3DPointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    _infra3DRaycaster.setFromCamera(_infra3DPointer, camera);

    /* Ray-cast only against infra meshes — keeps perf snappy and avoids hits
       on the building/lot/satellite ground. */
    var hits = _infra3DRaycaster.intersectObjects(_infra3DObjects, false);
    /* Find first hit that has hover data attached. */
    var hit = null;
    for(var i = 0; i < hits.length; i++){
      if(hits[i].object && hits[i].object.userData && hits[i].object.userData.infraData){
        hit = hits[i]; break;
      }
    }
    if(hit){
      _infra3DTooltipEl.innerHTML = _infra3DFormatHtml(hit.object.userData.infraData);
      _infra3DTooltipEl.style.display = 'block';
      _infra3DTooltipEl.style.left = (ev.clientX + 12) + 'px';
      _infra3DTooltipEl.style.top  = (ev.clientY + 12) + 'px';
      canvas.style.cursor = 'pointer';
    } else {
      _infra3DTooltipEl.style.display = 'none';
      canvas.style.cursor = '';
    }
  });

  canvas.addEventListener('mouseleave', function(){
    if(_infra3DTooltipEl) _infra3DTooltipEl.style.display = 'none';
    canvas.style.cursor = '';
  });

  _infra3DHoverWired = true;
}

/* Same HTML format as the Mapbox popup so the two views feel consistent. */
function _infra3DFormatHtml(p){
  var html = '<div>';
  if(p.kind === 'water'){
    html += '<div style="font-weight:700;color:#0066cc;margin-bottom:4px">WATERMAIN</div>';
    html += 'Diameter: <b>'+p.diameter+'mm</b><br>';
    html += 'Material: '+(p.material||'—')+'<br>';
    html += 'Year: '+(p.year||'—')+'<br>';
    html += 'Street: '+(p.street||'—');
  } else if(p.kind === 'sewer'){
    var cat = (p.flowCat||'unknown').toUpperCase();
    html += '<div style="font-weight:700;color:#7744cc;margin-bottom:4px">SEWER · '+cat+'</div>';
    html += 'Diameter: <b>'+p.diameter+'mm</b><br>';
    html += 'Material: '+(p.material||'—')+'<br>';
    html += 'Year: '+(p.year||'—')+'<br>';
    html += 'Street: '+(p.street||'—');
  } else if(p.kind === 'hydrant'){
    html += '<div style="font-weight:700;color:#cc2222;margin-bottom:4px">🔥 FIRE HYDRANT</div>';
    html += 'ID: '+(p.id||'—')+'<br>';
    html += 'Distance from site: <b>'+(p.dist||'?')+'m</b>';
  } else if(p.kind === 'valve'){
    html += '<div style="font-weight:700;color:#cc8800;margin-bottom:4px">VALVE</div>';
    html += 'ID: '+(p.id||'—');
  } else if(p.kind === 'catchbasin'){
    html += '<div style="font-weight:700;color:#1188aa;margin-bottom:4px">CATCH BASIN</div>';
    html += 'ID: '+(p.id||'—');
  }
  html += '</div>';
  return html;
}

/* ──────────────────────────────────────────────────────────────────────────
   Toggle helpers — called from a UI legend if added later.
   ────────────────────────────────────────────────────────────────────── */
function toggleInfraLayer(key, visible){
  if(typeof smMap === 'undefined' || !smMap) return;
  var ids = INFRA_LAYER_IDS[key] || [];
  ids.forEach(function(lid){
    if(smMap.getLayer(lid)){
      smMap.setLayoutProperty(lid, 'visibility', visible ? 'visible' : 'none');
    }
  });
}
