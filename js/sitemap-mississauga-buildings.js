// sitemap-mississauga-buildings.js — Mississauga 3D Massing buildings overlay
// =============================================================================
// Adds the City of Mississauga 3D Massing Model (LOD 1.75) as a Mapbox
// fill-extrusion layer on the Site Map, plus captures context buildings for
// the Site Plan tab — same role as smCaptureContextBuildings does for Toronto's
// Mapbox composite buildings, but for Mississauga where the composite source
// is sparse outside the Toronto core.
//
// DATA SOURCES (tried in order):
//   1. Local bundled file: data/mississauga-buildings.min.geojson
//      (drop-in for offline use — fastest, recommended for production)
//   2. ArcGIS Hub direct download:
//      https://opendata.arcgis.com/api/v3/datasets/499cc2269aa544049f47d222a11274e8/downloads/data?format=geojson&spatialRefId=4326
//   3. Mississauga FeatureServer (live, bbox-filtered):
//      https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/3D_Massing_Model/FeatureServer/0
//
// Schema (verified from City of Mississauga LOD 1.75 metadata):
//   ROOFTOP_ELEV_M     - building height (m above ground)
//   GROUND_ELEV_M      - ground elevation (m AGL)
//   STOREYS_AGL        - storeys above grade
//   BUILDING_HEIGHT    - height in metres (alt name)
//   HEIGHT             - generic fallback
//   POLYGON geometry
//
// Public API (window):
//   loadMississaugaBuildings()         -> Promise<{features, source}>
//   toggleMississauga3DBuildings()     -> Mapbox fill-extrusion layer toggle
//   captureMississaugaContextBuildings()-> populate P._contextBuildingFeatures
//                                          for Site Plan tab rendering
// =============================================================================

(function(){
  'use strict';

  var DATASET_ID = '499cc2269aa544049f47d222a11274e8';
  var LOCAL_GEOJSON_URL = 'data/mississauga-buildings.min.geojson';
  var LOCAL_JS_GLOBAL   = 'MISSISSAUGA_BUILDINGS_GEOJSON';   // window.MISSISSAUGA_BUILDINGS_GEOJSON if bundled
  var HUB_DIRECT_URL    = 'https://opendata.arcgis.com/api/v3/datasets/' + DATASET_ID + '/downloads/data?format=geojson&spatialRefId=4326';
  var FS_BASE           = 'https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/3D_Massing_Model/FeatureServer/0';

  // Candidate height attribute names — the loader walks these until one returns a number
  var HEIGHT_FIELDS = [
    'ROOFTOP_ELEV_M', 'BUILDING_HEIGHT_M', 'BUILDING_HEIGHT', 'HEIGHT_M',
    'HEIGHT', 'BLDG_HEIGHT', 'MAX_HEIGHT_M', 'AGL_HEIGHT'
  ];
  var GROUND_FIELDS = ['GROUND_ELEV_M', 'GROUND_ELEV', 'BASE_ELEV_M', 'BASE_ELEVATION'];
  var STOREYS_FIELDS = ['STOREYS_AGL', 'STOREYS', 'NUM_STOREYS', 'FLOORS'];

  // Mississauga rough bounds — used to bbox-filter the FeatureServer query
  var MISS_BBOX = { minLng: -79.85, maxLng: -79.45, minLat: 43.45, maxLat: 43.75 };

  // ── Cached state ──
  var _cache = null;        // { features, source, heightField }
  var _loading = null;      // in-flight promise

  // Pull the first non-empty value from a list of property keys
  function _firstField(props, keys){
    if(!props) return null;
    for(var i = 0; i < keys.length; i++){
      if(props[keys[i]] !== undefined && props[keys[i]] !== null && props[keys[i]] !== '') return props[keys[i]];
    }
    return null;
  }

  /**
   * Load the buildings GeoJSON via the first URL that succeeds.
   * Caches the result on window for re-use.
   */
  window.loadMississaugaBuildings = function(){
    if(_cache) return Promise.resolve(_cache);
    if(_loading) return _loading;

    _loading = (async function(){
      // 1) Bundled global (if a future minified .js file is loaded first)
      try {
        if(typeof window[LOCAL_JS_GLOBAL] === 'object' && window[LOCAL_JS_GLOBAL] && Array.isArray(window[LOCAL_JS_GLOBAL].features)){
          _cache = { features: window[LOCAL_JS_GLOBAL].features, source: 'bundle-js' };
          console.log('[Miss buildings] using bundled JS global - ' + _cache.features.length + ' features');
          return _cache;
        }
      } catch(e){}

      // 2) Local GeoJSON file (drop-in for offline use)
      try {
        var lr = await fetch(LOCAL_GEOJSON_URL, { signal: AbortSignal.timeout(15000) });
        if(lr.ok){
          var lj = await lr.json();
          if(lj && Array.isArray(lj.features)){
            _cache = { features: lj.features, source: 'local-file' };
            console.log('[Miss buildings] loaded local file - ' + _cache.features.length + ' features');
            return _cache;
          }
        }
      } catch(e){ /* fall through to remote */ }

      // 3) ArcGIS Hub direct download (full dataset GeoJSON)
      try {
        console.log('[Miss buildings] fetching from ArcGIS Hub (this may be slow on first load)...');
        var hr = await fetch(HUB_DIRECT_URL, { signal: AbortSignal.timeout(60000) });
        if(hr.ok){
          var hj = await hr.json();
          if(hj && Array.isArray(hj.features)){
            _cache = { features: hj.features, source: 'arcgis-hub' };
            console.log('[Miss buildings] loaded from ArcGIS Hub - ' + _cache.features.length + ' features');
            return _cache;
          }
        }
      } catch(e){ console.warn('[Miss buildings] Hub fetch failed:', e.message); }

      // 4) Last-resort: live FeatureServer with current map bbox
      try {
        if(typeof smMap === 'undefined' || !smMap) throw new Error('smMap not ready');
        var b = smMap.getBounds();
        var bboxQuery = b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth();
        var fsUrl = FS_BASE + '/query?where=1%3D1' +
                    '&geometry=' + encodeURIComponent(bboxQuery) +
                    '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326' +
                    '&spatialRel=esriSpatialRelIntersects&outFields=*' +
                    '&resultRecordCount=2000&f=geojson';
        var fr = await fetch(fsUrl, { signal: AbortSignal.timeout(20000) });
        if(fr.ok){
          var fj = await fr.json();
          if(fj && Array.isArray(fj.features)){
            _cache = { features: fj.features, source: 'feature-server-bbox' };
            console.log('[Miss buildings] loaded from FeatureServer (bbox) - ' + _cache.features.length + ' features (truncated to bbox + 2000 record limit)');
            return _cache;
          }
        }
      } catch(e){ console.warn('[Miss buildings] FeatureServer fetch failed:', e.message); }

      console.warn('[Miss buildings] All sources failed. Drop a GeoJSON file at data/mississauga-buildings.min.geojson to enable offline use.');
      throw new Error('Unable to load Mississauga buildings dataset');
    })();
    _loading.then(function(){ _loading = null; }).catch(function(){ _loading = null; });
    return _loading;
  };

  // ── Mapbox fill-extrusion layer toggle ──
  var _missBldg3DVisible = false;

  window.toggleMississauga3DBuildings = function(){
    if(typeof smMap === 'undefined' || !smMap){ console.warn('[Miss buildings] smMap not ready'); return; }
    _missBldg3DVisible = !_missBldg3DVisible;

    if(!_missBldg3DVisible){
      try { if(smMap.getLayer('miss-bldg-3d')) smMap.removeLayer('miss-bldg-3d'); } catch(e){}
      try { if(smMap.getSource('miss-bldg-src')) smMap.removeSource('miss-bldg-src'); } catch(e){}
      if(typeof smShowToast === 'function') smShowToast('Mississauga 3D buildings off', '#888');
      return;
    }

    if(typeof smShowToast === 'function') smShowToast('Loading Mississauga 3D buildings...', '#88aacc');
    window.loadMississaugaBuildings().then(function(data){
      if(!data || !data.features) return;

      // Detect the height field on the first feature
      var heightField = null;
      for(var i = 0; i < data.features.length && i < 50; i++){
        var p = data.features[i].properties || {};
        for(var f = 0; f < HEIGHT_FIELDS.length; f++){
          if(typeof p[HEIGHT_FIELDS[f]] === 'number' && p[HEIGHT_FIELDS[f]] > 0){
            heightField = HEIGHT_FIELDS[f]; break;
          }
        }
        if(heightField) break;
      }
      if(!heightField){
        console.warn('[Miss buildings] no height field detected - schema may differ. Tried:', HEIGHT_FIELDS);
        heightField = HEIGHT_FIELDS[0];   // best-guess
      }
      console.log('[Miss buildings] using height field:', heightField);

      try { if(smMap.getLayer('miss-bldg-3d')) smMap.removeLayer('miss-bldg-3d'); } catch(e){}
      try { if(smMap.getSource('miss-bldg-src')) smMap.removeSource('miss-bldg-src'); } catch(e){}

      smMap.addSource('miss-bldg-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: data.features }
      });
      smMap.addLayer({
        id: 'miss-bldg-3d',
        type: 'fill-extrusion',
        source: 'miss-bldg-src',
        paint: {
          'fill-extrusion-color': '#aaaaaa',
          'fill-extrusion-height': ['coalesce', ['to-number', ['get', heightField]], 6],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.85
        }
      });
      if(typeof smShowToast === 'function')
        smShowToast('Mississauga 3D buildings ON - ' + data.features.length + ' (' + data.source + ')', '#AEBC46');
    }).catch(function(e){
      console.error('[Miss buildings] load failed:', e);
      if(typeof smShowToast === 'function') smShowToast('Failed to load Mississauga buildings: ' + e.message, '#c44');
    });
  };

  // ── Capture context buildings for the Site Plan 3D scene ──
  // Populates P._contextBuildingFeatures with the same structure as
  // sitemap-lot.js _smProcessBuildingFeatures, so renderer-components.js's
  // rebuildContextBuildings() can render them as gray context masses around
  // the user's project.
  window.captureMississaugaContextBuildings = function(radiusMeters){
    if(typeof P === 'undefined' || !P){ console.warn('[Miss buildings] P not ready'); return; }
    if(!P.siteCoords){ console.warn('[Miss buildings] no site coords'); return; }
    var lat = P.siteCoords.lat, lng = P.siteCoords.lng;
    var R = radiusMeters || 1000;   // bumped from 500m to render context buildings beyond 1 km

    return window.loadMississaugaBuildings().then(function(data){
      if(!data || !data.features) return;
      // Filter to features within `R` metres of site centroid
      function _haversineM(lat1, lng1, lat2, lng2){
        var toRad = Math.PI / 180;
        var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
        var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
                Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLng/2)*Math.sin(dLng/2);
        return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
      }
      function _featureCentroid(feat){
        if(!feat || !feat.geometry) return null;
        var coords = feat.geometry.coordinates;
        if(feat.geometry.type === 'Polygon') coords = coords[0];
        else if(feat.geometry.type === 'MultiPolygon') coords = coords[0][0];
        else return null;
        var cx = 0, cy = 0, n = coords.length;
        for(var i = 0; i < n; i++){ cx += coords[i][0]; cy += coords[i][1]; }
        return [cx / n, cy / n];
      }
      var nearby = [];
      var heightField = null;
      data.features.forEach(function(feat){
        var c = _featureCentroid(feat);
        if(!c) return;
        if(_haversineM(lat, lng, c[1], c[0]) > R) return;
        // Detect height field per-feature
        var p = feat.properties || {};
        if(!heightField){
          for(var f = 0; f < HEIGHT_FIELDS.length; f++){
            if(typeof p[HEIGHT_FIELDS[f]] === 'number' && p[HEIGHT_FIELDS[f]] > 0){ heightField = HEIGHT_FIELDS[f]; break; }
          }
        }
        var h = _firstField(p, HEIGHT_FIELDS);
        var minH = _firstField(p, GROUND_FIELDS) || 0;
        if(typeof h !== 'number' || !isFinite(h) || h <= 0) h = 8;
        // Convert geometry to lng/lat coordinate ring (matching the format
        // sitemap-lot.js _smProcessBuildingFeatures produces)
        var ring = null;
        if(feat.geometry.type === 'Polygon') ring = feat.geometry.coordinates[0];
        else if(feat.geometry.type === 'MultiPolygon') ring = feat.geometry.coordinates[0][0];
        if(!ring || ring.length < 4) return;
        nearby.push({
          coords: ring,
          height: h,
          minHeight: typeof minH === 'number' ? minH : 0,
          source: 'mississauga-3d-massing'
        });
      });
      P._contextBuildingFeatures = (P._contextBuildingFeatures || []).filter(function(b){
        return b.source !== 'mississauga-3d-massing';   // dedupe re-runs
      }).concat(nearby);
      console.log('[Miss buildings] captured ' + nearby.length + ' context buildings within ' + R + 'm of site');
      if(typeof rebuildContextBuildings === 'function'){
        try { rebuildContextBuildings(); } catch(e){ console.warn('[Miss buildings] rebuildContextBuildings failed:', e); }
      }
    });
  };

})();
