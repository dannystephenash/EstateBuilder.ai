// sitemap-ms-canadian-buildings.js — Microsoft Canadian Building Footprints loader
// =============================================================================
// Integrates Microsoft's open-source Canadian Building Footprints dataset
// (https://github.com/microsoft/CanadianBuildingFootprints) into EstateBuilder.
// The dataset is ML-derived from Bing imagery — ~5M polygons in Ontario alone —
// so we load it as PMTiles vector tiles via Mapbox's custom protocol API
// rather than as raw GeoJSON.
//
// IMPORTANT: Microsoft's source data has NO height attribute. Polygons are
// 2D footprints only. This loader applies a default 6 m height for the 3D
// fill-extrusion display and a default 8 m height when populating context
// buildings for the Three.js scene. Operators who need accurate heights
// should layer this with OSM (loadOSMBuildingsAround) or municipal LIDAR
// data, both of which already have separate loaders in this app.
//
// LICENSE NOTE: The Microsoft dataset is published under the Open Data Commons
// Open Database License (ODbL). Attribution is required when displayed —
// the loader injects a credit string into the Mapbox attribution control.
//
// DATA SOURCES (tried in order):
//   1. Local PMTiles file: data/ontario-buildings.pmtiles
//      (run scripts/build-ontario-buildings-pmtiles.sh to generate)
//   2. Local minified GeoJSON: data/ontario-buildings.min.geojson
//      (clipped subsets — e.g. just GTA — are practical here)
//   3. Remote PMTiles URL set via setMSBuildingsPmtilesUrl()
//      (recommended for production; host on Cloudflare R2 / S3 / static)
//
// Public API (window):
//   setMSBuildingsPmtilesUrl(url)             - configure remote PMTiles URL
//   getMSBuildingsPmtilesUrl()                - read current configured URL
//   loadMSCanadianBuildings()                 - lazy-load + cache the data source
//   toggleMSCanadianBuildings3D()             - Mapbox fill-extrusion overlay
//   captureMSCanadianContextBuildings(radius) - populate P._contextBuildingFeatures
//   queryMSBuildingsInLot()                   - return footprints inside lot polygon
// =============================================================================

(function(){
  'use strict';

  // ── Configuration ──
  var LS_KEY_PMTILES_URL = 'EB_MS_BUILDINGS_PMTILES_URL';
  var LOCAL_PMTILES_URL  = 'data/ontario-buildings.pmtiles';
  var LOCAL_GEOJSON_URL  = 'data/ontario-buildings.min.geojson';
  var SOURCE_LAYER_NAME  = 'buildings';   // matches tippecanoe --layer=buildings
  var ATTRIBUTION_HTML   = '<a href="https://github.com/microsoft/CanadianBuildingFootprints" target="_blank" rel="noopener">Microsoft Canadian Building Footprints</a> (ODbL)';

  // Mapbox + Three.js render tunables
  var DEFAULT_FILL_EXTRUSION_HEIGHT_M = 6;   // 1-2 storeys — Microsoft data has no height
  var DEFAULT_CONTEXT_HEIGHT_M        = 8;   // matches OSM loader fallback
  var EARTH_RADIUS_M                  = 6371008.8;
  var SOURCE_TAG                      = 'ms-canadian';   // dedupe key in P._contextBuildingFeatures

  // Mapbox source/layer IDs (kept stable so toggle can find them)
  var SRC_ID_PMTILES = 'ms-cdn-bldg-pmtiles-src';
  var SRC_ID_GEOJSON = 'ms-cdn-bldg-geojson-src';
  var LAYER_ID_FILL  = 'ms-cdn-bldg-3d';
  var LAYER_ID_LINE  = 'ms-cdn-bldg-outline';

  // ── In-memory state ──
  var _resolved = null;     // { mode: 'pmtiles'|'geojson', url, features?, attribution }
  var _loading  = null;     // in-flight Promise
  var _visible3D = false;
  var _pmtilesProtocolRegistered = false;

  // ── Storage helpers ──
  function _safeGetLS(key){
    try { return localStorage.getItem(key); } catch(e){ return null; }
  }
  function _safeSetLS(key, val){
    try { localStorage.setItem(key, val); } catch(e){}
  }

  /**
   * Set the remote PMTiles URL (persisted to localStorage).
   * Call once in the browser console after hosting your tiles.
   * @param {string} url
   */
  window.setMSBuildingsPmtilesUrl = function(url){
    if(typeof url !== 'string' || !url) {
      _safeSetLS(LS_KEY_PMTILES_URL, '');
      _resolved = null;
      console.log('[MS bldg] cleared PMTiles URL');
      return;
    }
    _safeSetLS(LS_KEY_PMTILES_URL, url);
    _resolved = null;
    console.log('[MS bldg] PMTiles URL set:', url);
  };

  /** @returns {string|null} */
  window.getMSBuildingsPmtilesUrl = function(){
    return _safeGetLS(LS_KEY_PMTILES_URL) || null;
  };

  // ── PMTiles protocol registration (one-time) ──
  // The pmtiles JS library (loaded via CDN in HTML) exposes window.pmtiles
  // and self-registers a Mapbox custom protocol for "pmtiles://" URLs.
  function _ensurePmtilesProtocol(){
    if(_pmtilesProtocolRegistered) return true;
    if(typeof mapboxgl === 'undefined' || typeof mapboxgl.addProtocol !== 'function'){
      console.warn('[MS bldg] mapboxgl.addProtocol not available — Mapbox GL v2+ required');
      return false;
    }
    if(typeof window.pmtiles !== 'object' || !window.pmtiles || typeof window.pmtiles.Protocol !== 'function'){
      console.warn('[MS bldg] pmtiles.js library not loaded — add <script src="https://unpkg.com/pmtiles@3/dist/pmtiles.js"></script> before this file');
      return false;
    }
    try {
      var protocol = new window.pmtiles.Protocol();
      mapboxgl.addProtocol('pmtiles', protocol.tile);
      _pmtilesProtocolRegistered = true;
      console.log('[MS bldg] pmtiles:// protocol registered with Mapbox');
      return true;
    } catch(e){
      console.warn('[MS bldg] failed to register pmtiles protocol:', e.message);
      return false;
    }
  }

  // ── Source resolution: figure out which data source is available ──
  /**
   * Resolves the best available data source. Result is cached.
   * @returns {Promise<{mode:string, url:string, features?:Array, attribution:string}>}
   */
  window.loadMSCanadianBuildings = function(){
    if(_resolved) return Promise.resolve(_resolved);
    if(_loading) return _loading;

    _loading = (async function(){
      // Priority 1: explicit remote PMTiles URL
      var configuredUrl = window.getMSBuildingsPmtilesUrl();
      if(configuredUrl){
        _resolved = { mode: 'pmtiles', url: 'pmtiles://' + configuredUrl, attribution: ATTRIBUTION_HTML };
        console.log('[MS bldg] using configured remote PMTiles:', configuredUrl);
        return _resolved;
      }

      // Priority 2: local PMTiles file (HEAD probe)
      try {
        var hr = await fetch(LOCAL_PMTILES_URL, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
        if(hr.ok){
          _resolved = {
            mode: 'pmtiles',
            url: 'pmtiles://' + new URL(LOCAL_PMTILES_URL, window.location.href).href,
            attribution: ATTRIBUTION_HTML
          };
          console.log('[MS bldg] using local PMTiles file:', LOCAL_PMTILES_URL);
          return _resolved;
        }
      } catch(e){ /* fall through */ }

      // Priority 3: local GeoJSON fallback (clipped subsets)
      try {
        var gr = await fetch(LOCAL_GEOJSON_URL, { signal: AbortSignal.timeout(15000) });
        if(gr.ok){
          var gj = await gr.json();
          if(gj && Array.isArray(gj.features)){
            _resolved = {
              mode: 'geojson',
              url: LOCAL_GEOJSON_URL,
              features: gj.features,
              attribution: ATTRIBUTION_HTML
            };
            console.log('[MS bldg] using local GeoJSON — ' + gj.features.length + ' features');
            return _resolved;
          }
        }
      } catch(e){ /* fall through */ }

      throw new Error('No Microsoft Canadian Building Footprints data source available. ' +
        'Either: (a) run scripts/build-ontario-buildings-pmtiles.sh and host the output, ' +
        'then call setMSBuildingsPmtilesUrl(url); or (b) drop a clipped GeoJSON at ' + LOCAL_GEOJSON_URL);
    })();

    _loading.then(function(){ _loading = null; }).catch(function(){ _loading = null; });
    return _loading;
  };

  // ── Mapbox layer toggle ──
  /**
   * Toggle the Microsoft Canadian Building Footprints overlay on the Site Map.
   * Renders polygons as a low-extrusion fill (default 6 m) with grey outline.
   */
  window.toggleMSCanadianBuildings3D = async function(){
    if(typeof smMap === 'undefined' || !smMap){ console.warn('[MS bldg] smMap not ready'); return; }
    _visible3D = !_visible3D;

    if(!_visible3D){
      try { if(smMap.getLayer(LAYER_ID_LINE))    smMap.removeLayer(LAYER_ID_LINE); } catch(e){}
      try { if(smMap.getLayer(LAYER_ID_FILL))    smMap.removeLayer(LAYER_ID_FILL); } catch(e){}
      try { if(smMap.getSource(SRC_ID_PMTILES))  smMap.removeSource(SRC_ID_PMTILES); } catch(e){}
      try { if(smMap.getSource(SRC_ID_GEOJSON))  smMap.removeSource(SRC_ID_GEOJSON); } catch(e){}
      if(typeof smShowToast === 'function') smShowToast('MS Canadian buildings off', '#888');
      return;
    }

    if(typeof smShowToast === 'function') smShowToast('Loading MS Canadian buildings...', '#88aacc');
    try {
      var data = await window.loadMSCanadianBuildings();

      if(data.mode === 'pmtiles'){
        if(!_ensurePmtilesProtocol()) throw new Error('PMTiles protocol unavailable');
        try { if(smMap.getLayer(LAYER_ID_LINE))   smMap.removeLayer(LAYER_ID_LINE); } catch(e){}
        try { if(smMap.getLayer(LAYER_ID_FILL))   smMap.removeLayer(LAYER_ID_FILL); } catch(e){}
        try { if(smMap.getSource(SRC_ID_PMTILES)) smMap.removeSource(SRC_ID_PMTILES); } catch(e){}
        smMap.addSource(SRC_ID_PMTILES, {
          type: 'vector',
          url: data.url,
          attribution: data.attribution
        });
        smMap.addLayer({
          id: LAYER_ID_FILL,
          type: 'fill-extrusion',
          source: SRC_ID_PMTILES,
          'source-layer': SOURCE_LAYER_NAME,
          minzoom: 12,
          paint: {
            'fill-extrusion-color': '#a0a0a0',
            'fill-extrusion-height': DEFAULT_FILL_EXTRUSION_HEIGHT_M,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.75
          }
        });
        smMap.addLayer({
          id: LAYER_ID_LINE,
          type: 'line',
          source: SRC_ID_PMTILES,
          'source-layer': SOURCE_LAYER_NAME,
          minzoom: 14,
          paint: { 'line-color': '#666', 'line-width': 0.5, 'line-opacity': 0.6 }
        });
        if(typeof smShowToast === 'function') smShowToast('MS Canadian buildings ON (PMTiles)', '#AEBC46');
      } else if(data.mode === 'geojson'){
        try { if(smMap.getLayer(LAYER_ID_LINE))   smMap.removeLayer(LAYER_ID_LINE); } catch(e){}
        try { if(smMap.getLayer(LAYER_ID_FILL))   smMap.removeLayer(LAYER_ID_FILL); } catch(e){}
        try { if(smMap.getSource(SRC_ID_GEOJSON)) smMap.removeSource(SRC_ID_GEOJSON); } catch(e){}
        smMap.addSource(SRC_ID_GEOJSON, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: data.features },
          attribution: data.attribution
        });
        smMap.addLayer({
          id: LAYER_ID_FILL,
          type: 'fill-extrusion',
          source: SRC_ID_GEOJSON,
          paint: {
            'fill-extrusion-color': '#a0a0a0',
            'fill-extrusion-height': DEFAULT_FILL_EXTRUSION_HEIGHT_M,
            'fill-extrusion-base': 0,
            'fill-extrusion-opacity': 0.75
          }
        });
        smMap.addLayer({
          id: LAYER_ID_LINE,
          type: 'line',
          source: SRC_ID_GEOJSON,
          paint: { 'line-color': '#666', 'line-width': 0.5, 'line-opacity': 0.6 }
        });
        if(typeof smShowToast === 'function')
          smShowToast('MS Canadian buildings ON — ' + data.features.length + ' features (GeoJSON)', '#AEBC46');
      }
    } catch(e){
      _visible3D = false;
      console.error('[MS bldg] toggle failed:', e);
      if(typeof smShowToast === 'function') smShowToast('MS Canadian buildings: ' + e.message, '#c44');
    }
  };

  // ── Geometry helpers ──
  function _haversineM(lat1, lng1, lat2, lng2){
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
  }
  function _featureCentroid(feat){
    if(!feat || !feat.geometry) return null;
    var coords = feat.geometry.coordinates;
    if(feat.geometry.type === 'Polygon') coords = coords[0];
    else if(feat.geometry.type === 'MultiPolygon') coords = coords[0][0];
    else return null;
    if(!coords || !coords.length) return null;
    var cx = 0, cy = 0, n = coords.length;
    for(var i = 0; i < n; i++){ cx += coords[i][0]; cy += coords[i][1]; }
    return [cx / n, cy / n];
  }
  function _featureRing(feat){
    if(!feat || !feat.geometry) return null;
    if(feat.geometry.type === 'Polygon') return feat.geometry.coordinates[0];
    if(feat.geometry.type === 'MultiPolygon') return feat.geometry.coordinates[0][0];
    return null;
  }

  // For PMTiles vector sources we have to query the rendered tile cache
  // rather than a stored feature array. This requires the layer to be visible
  // and the map zoomed/panned over the area of interest.
  function _queryRenderedFootprintsInBbox(bb){
    if(typeof smMap === 'undefined' || !smMap) return [];
    var sw = smMap.project([bb.west, bb.south]);
    var ne = smMap.project([bb.east, bb.north]);
    var rendered;
    try {
      rendered = smMap.queryRenderedFeatures([sw, ne], { layers: [LAYER_ID_FILL] });
    } catch(e){
      console.warn('[MS bldg] queryRenderedFeatures failed:', e.message);
      return [];
    }
    return rendered || [];
  }

  // ── Capture context buildings for the Three.js Site Plan scene ──
  /**
   * Populates P._contextBuildingFeatures with neighbour buildings inside
   * radiusMeters of the lot centroid. Uses the same shape that
   * renderer-components.js's rebuildContextBuildings() expects:
   *   { coords: [[lng,lat],...], height, minHeight, source }
   *
   * @param {number} [radiusMeters=300]
   * @returns {Promise<number>} count of features captured
   */
  window.captureMSCanadianContextBuildings = async function(radiusMeters){
    if(typeof P === 'undefined' || !P){ console.warn('[MS bldg] P not ready'); return 0; }
    if(!P.siteCoords){ console.warn('[MS bldg] no site coords — draw a lot first'); return 0; }
    var R = (typeof radiusMeters === 'number' && radiusMeters > 0) ? radiusMeters : 1000;   // bumped from 300m
    var lat = P.siteCoords.lat, lng = P.siteCoords.lng;

    var data;
    try { data = await window.loadMSCanadianBuildings(); }
    catch(e){
      console.warn('[MS bldg] capture aborted:', e.message);
      if(typeof smShowToast === 'function') smShowToast('MS bldg: ' + e.message, '#c44');
      return 0;
    }

    var candidates = [];
    if(data.mode === 'geojson'){
      candidates = data.features;
    } else if(data.mode === 'pmtiles'){
      // Need the layer visible and zoomed in to query rendered tiles
      if(!_visible3D){
        await window.toggleMSCanadianBuildings3D();   // turn on temporarily
      }
      // Convert radius (m) to a bbox in degrees for the query
      var dLat = R / 110540;
      var dLng = R / (111320 * Math.cos(lat * Math.PI / 180));
      var bb = { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
      // Pan to centre + zoom 16 so tiles load — the caller is responsible
      // for awaiting an idle state. We rely on the caller having the map
      // already centred over the lot (which sitemap-lot.js does).
      candidates = _queryRenderedFootprintsInBbox(bb);
      if(candidates.length === 0){
        console.warn('[MS bldg] no rendered features — make sure map is zoomed in (≥14) over the lot before capturing');
      }
    }

    var nearby = [];
    candidates.forEach(function(feat){
      var c = _featureCentroid(feat);
      if(!c) return;
      if(_haversineM(lat, lng, c[1], c[0]) > R) return;
      var ring = _featureRing(feat);
      if(!ring || ring.length < 4) return;
      nearby.push({
        coords: ring,
        height: DEFAULT_CONTEXT_HEIGHT_M,
        minHeight: 0,
        source: SOURCE_TAG
      });
    });

    P._contextBuildingFeatures = (P._contextBuildingFeatures || [])
      .filter(function(b){ return b.source !== SOURCE_TAG; })
      .concat(nearby);

    console.log('[MS bldg] captured ' + nearby.length + ' context buildings within ' + R + 'm of site');
    if(typeof rebuildContextBuildings === 'function'){
      try { rebuildContextBuildings(); }
      catch(e){ console.warn('[MS bldg] rebuildContextBuildings failed:', e); }
    }
    return nearby.length;
  };

  // ── On-lot detection: find footprints inside the user's drawn lot polygon ──
  /**
   * Returns Microsoft footprints whose centroids fall inside the current lot
   * polygon. Useful for "what's already on this site?" detection.
   * @returns {Promise<Array<Feature>>}
   */
  window.queryMSBuildingsInLot = async function(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.lotPolygon) || P.lotPolygon.length < 3){
      console.warn('[MS bldg] no lot polygon — draw a lot first'); return [];
    }
    var lotRing = P.lotPolygon.map(function(pt){
      // P.lotPolygon entries are typically {lat, lng}
      if(typeof pt.lng === 'number') return [pt.lng, pt.lat];
      if(Array.isArray(pt) && pt.length === 2) return [pt[0], pt[1]];
      return null;
    }).filter(Boolean);
    if(lotRing.length < 3) return [];
    if(lotRing[0][0] !== lotRing[lotRing.length-1][0] ||
       lotRing[0][1] !== lotRing[lotRing.length-1][1]){
      lotRing.push([lotRing[0][0], lotRing[0][1]]);
    }

    var data;
    try { data = await window.loadMSCanadianBuildings(); }
    catch(e){ return []; }

    var candidates = data.mode === 'geojson'
      ? data.features
      : (function(){
          // For PMTiles, query rendered features at the lot bbox
          var minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          lotRing.forEach(function(p){
            if(p[0] < minLng) minLng = p[0]; if(p[0] > maxLng) maxLng = p[0];
            if(p[1] < minLat) minLat = p[1]; if(p[1] > maxLat) maxLat = p[1];
          });
          return _queryRenderedFootprintsInBbox({ west: minLng, east: maxLng, south: minLat, north: maxLat });
        })();

    // Point-in-polygon via Turf if available, otherwise ray-cast fallback
    var inside = [];
    var lotPolygonGeoJSON = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [lotRing] }, properties: {} };
    candidates.forEach(function(feat){
      var c = _featureCentroid(feat);
      if(!c) return;
      var hit = false;
      if(typeof turf !== 'undefined' && turf.booleanPointInPolygon){
        try { hit = turf.booleanPointInPolygon(turf.point(c), lotPolygonGeoJSON); }
        catch(e){ hit = _pointInRing(c, lotRing); }
      } else {
        hit = _pointInRing(c, lotRing);
      }
      if(hit) inside.push(feat);
    });
    console.log('[MS bldg] ' + inside.length + ' footprints inside lot polygon');
    return inside;
  };

  // Standard ray-casting point-in-polygon (lng, lat)
  function _pointInRing(pt, ring){
    var x = pt[0], y = pt[1];
    var inside = false;
    for(var i = 0, j = ring.length - 1; i < ring.length; j = i++){
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi);
      if(intersect) inside = !inside;
    }
    return inside;
  }

})();
