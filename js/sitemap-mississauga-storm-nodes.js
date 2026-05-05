// sitemap-mississauga-storm-nodes.js — Mississauga Storm Sewer Network nodes
// =============================================================================
// Renders the City of Mississauga's Storm Node feature service on the Site Map
// and exposes proximity + graph-link helpers. The dataset is lazy-loaded on
// first toggle to avoid a 2.9 MB cost at startup — the script tag in HTML
// only loads when toggleMSStormNodes3D() is invoked.
//
// LIMITATION (verified at integration time): the open-data publication does
// NOT include elevation fields. Depth-of-cover, slope, and hydraulic-capacity
// analyses are not possible from this dataset alone. Intended use is for:
//   • Visual presence of storm infrastructure on/near the lot
//   • Outlet detection (creek/pond discharge constraints)
//   • Service-connection candidate identification (closest manhole)
//   • FDC manhole detection (older areas with weeping-tile connections)
//   • Pipe NODEFROM/NODETO → node coordinate resolution
//
// VISUAL HIERARCHY (color choices justified by importance, not aesthetics):
//   Outlets / Headwalls / OGS — red, larger radius (rare, hard constraints)
//   FDC Manhole               — orange (older-area relevance)
//   Manhole / Catchbasin Manhole — slate blue (service-connection candidates)
//   Catchbasin / Double / Grate / Inlets — light grey, small (clutter, but useful)
//   Plug / Connection / Unknown — neutral grey
//
// Public API (window):
//   loadMSStormNodes()                       - lazy-load + cache the data
//   toggleMSStormNodes3D()                   - Mapbox layer toggle
//   queryMSStormNodesNear(lng, lat, radiusM) - proximity counts + records
//   resolveMSStormNode(assetId)              - graph-link helper for pipe nodes
// =============================================================================

(function(){
  'use strict';

  /** @type {string} */
  var DATA_URL = 'data/mississauga-storm-nodes.min.js';

  // Mississauga rough bounds — used to short-circuit non-Mississauga lots
  var MISS_BBOX = { minLng: -79.85, maxLng: -79.45, minLat: 43.45, maxLat: 43.75 };

  // Visual buckets — drives Mapbox circle layer colours and radii
  // Keys are typeCode integers (matching MS_STORM_NODE_TYPES order):
  //   0 Catchbasin, 1 Manhole, 2 Double Catchbasin, 3 Catchbasin Manhole,
  //   4 FDC Manhole, 5 Outlet, 6 Plug, 7 Connection, 8 Pipe Inlet,
  //   9 Ditch Inlet, 10 Unknown, 11 Grate, 12 Headwall, 13 OGS Manhole,
  //   14 Grate Inlet
  var BUCKET_OUTLET   = [5, 12, 13];          // Outlet, Headwall, OGS Manhole
  var BUCKET_FDC      = [4];                  // FDC Manhole
  var BUCKET_MANHOLE  = [1, 3];               // Manhole, Catchbasin Manhole
  var BUCKET_INLET    = [0, 2, 8, 9, 11, 14]; // Catchbasin, Double CB, inlets, grates
  var BUCKET_OTHER    = [6, 7, 10];           // Plug, Connection, Unknown

  var COLOR_OUTLET   = '#d62828';   // red
  var COLOR_FDC      = '#f08c00';   // orange
  var COLOR_MANHOLE  = '#3a5a8a';   // slate blue
  var COLOR_INLET    = '#a8a8a8';   // light grey
  var COLOR_OTHER    = '#7a7a7a';   // neutral grey

  // Mapbox source/layer IDs
  var SRC_ID                 = 'ms-storm-nodes-src';
  var LAYER_ID_OUTLET        = 'ms-storm-nodes-outlet';
  var LAYER_ID_FDC           = 'ms-storm-nodes-fdc';
  var LAYER_ID_MANHOLE       = 'ms-storm-nodes-manhole';
  var LAYER_ID_INLET         = 'ms-storm-nodes-inlet';
  var LAYER_ID_OTHER         = 'ms-storm-nodes-other';
  var LAYER_IDS = [LAYER_ID_OUTLET, LAYER_ID_FDC, LAYER_ID_MANHOLE, LAYER_ID_INLET, LAYER_ID_OTHER];

  var ATTRIBUTION_HTML = 'Storm nodes © <a href="https://data.mississauga.ca" target="_blank" rel="noopener">City of Mississauga</a>';

  // ── Internal state ──
  /** @type {boolean} */ var _visible = false;
  /** @type {Promise|null} */ var _loadPromise = null;
  /** @type {Object|null} */ var _byAssetId = null;   // index for resolveMSStormNode

  // ── Loader: dynamically inject the data script on first call ──
  /**
   * Lazy-load data/mississauga-storm-nodes.min.js. Resolves with the data
   * payload {records, typeCodes}. Cached after first successful load.
   * @returns {Promise<{records: Array, typeCodes: Array<string>}>}
   */
  window.loadMSStormNodes = function(){
    if(window._mississaugaStormNodesData) return Promise.resolve(window._mississaugaStormNodesData);
    if(_loadPromise) return _loadPromise;
    _loadPromise = new Promise(function(resolve, reject){
      var existing = document.querySelector('script[data-ms-storm-nodes-loader]');
      if(existing){
        var poll = setInterval(function(){
          if(window._mississaugaStormNodesData){
            clearInterval(poll); resolve(window._mississaugaStormNodesData);
          }
        }, 100);
        setTimeout(function(){ clearInterval(poll); reject(new Error('storm-nodes load timeout')); }, 30000);
        return;
      }
      var s = document.createElement('script');
      s.setAttribute('data-ms-storm-nodes-loader', '1');
      s.src = DATA_URL;
      s.onload  = function(){
        if(window._mississaugaStormNodesData) resolve(window._mississaugaStormNodesData);
        else reject(new Error('storm-nodes file loaded but no data'));
      };
      s.onerror = function(){ reject(new Error('failed to load ' + DATA_URL)); };
      document.head.appendChild(s);
    });
    return _loadPromise;
  };

  // Build a {assetId: record} index lazily — used by resolveMSStormNode
  function _ensureIndex(records){
    if(_byAssetId) return _byAssetId;
    _byAssetId = Object.create(null);
    for(var i = 0; i < records.length; i++){
      _byAssetId[records[i][0]] = records[i];
    }
    return _byAssetId;
  }

  // Convert flat records to a GeoJSON FeatureCollection
  function _toFeatureCollection(records){
    var features = new Array(records.length);
    for(var i = 0; i < records.length; i++){
      var r = records[i];
      features[i] = {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: r[3] },
        properties: { assetId: r[0], typeCode: r[1], year: r[2] }
      };
    }
    return { type: 'FeatureCollection', features: features };
  }

  // ── Mapbox toggle ──
  /**
   * Show / hide the Mississauga storm node layers on the Site Map.
   * Auto-loads the dataset on first invocation.
   */
  window.toggleMSStormNodes3D = async function(){
    if(typeof smMap === 'undefined' || !smMap){ console.warn('[MS storm nodes] smMap not ready'); return; }
    _visible = !_visible;

    if(!_visible){
      LAYER_IDS.forEach(function(id){ try { if(smMap.getLayer(id)) smMap.removeLayer(id); } catch(e){} });
      try { if(smMap.getSource(SRC_ID)) smMap.removeSource(SRC_ID); } catch(e){}
      if(typeof smShowToast === 'function') smShowToast('MS storm nodes off', '#888');
      return;
    }

    if(typeof smShowToast === 'function') smShowToast('Loading MS storm nodes...', '#88aacc');
    try {
      var data = await window.loadMSStormNodes();
      var fc = _toFeatureCollection(data.records);
      LAYER_IDS.forEach(function(id){ try { if(smMap.getLayer(id)) smMap.removeLayer(id); } catch(e){} });
      try { if(smMap.getSource(SRC_ID)) smMap.removeSource(SRC_ID); } catch(e){}

      smMap.addSource(SRC_ID, { type: 'geojson', data: fc, attribution: ATTRIBUTION_HTML });

      // Layer 1: outlets / headwalls — most prominent
      smMap.addLayer({
        id: LAYER_ID_OUTLET, type: 'circle', source: SRC_ID,
        filter: ['in', ['get', 'typeCode'], ['literal', BUCKET_OUTLET]],
        minzoom: 11,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 16, 9],
          'circle-color': COLOR_OUTLET,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1.5,
          'circle-opacity': 0.95
        }
      });
      // Layer 2: FDC manholes
      smMap.addLayer({
        id: LAYER_ID_FDC, type: 'circle', source: SRC_ID,
        filter: ['in', ['get', 'typeCode'], ['literal', BUCKET_FDC]],
        minzoom: 13,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 3, 16, 6],
          'circle-color': COLOR_FDC,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 1,
          'circle-opacity': 0.9
        }
      });
      // Layer 3: regular manholes — service-connection candidates
      smMap.addLayer({
        id: LAYER_ID_MANHOLE, type: 'circle', source: SRC_ID,
        filter: ['in', ['get', 'typeCode'], ['literal', BUCKET_MANHOLE]],
        minzoom: 14,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2.5, 17, 5],
          'circle-color': COLOR_MANHOLE,
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 0.8,
          'circle-opacity': 0.85
        }
      });
      // Layer 4: catchbasins / inlets / grates — de-emphasized
      smMap.addLayer({
        id: LAYER_ID_INLET, type: 'circle', source: SRC_ID,
        filter: ['in', ['get', 'typeCode'], ['literal', BUCKET_INLET]],
        minzoom: 15,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.8, 18, 3.5],
          'circle-color': COLOR_INLET,
          'circle-stroke-color': '#444',
          'circle-stroke-width': 0.4,
          'circle-opacity': 0.7
        }
      });
      // Layer 5: plug / connection / unknown
      smMap.addLayer({
        id: LAYER_ID_OTHER, type: 'circle', source: SRC_ID,
        filter: ['in', ['get', 'typeCode'], ['literal', BUCKET_OTHER]],
        minzoom: 15,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 1.6, 18, 3],
          'circle-color': COLOR_OTHER,
          'circle-stroke-color': '#444',
          'circle-stroke-width': 0.4,
          'circle-opacity': 0.6
        }
      });

      if(typeof smShowToast === 'function')
        smShowToast('MS storm nodes ON — ' + data.records.length.toLocaleString() + ' features', '#AEBC46');

      _attachPopup();
    } catch(e){
      _visible = false;
      console.error('[MS storm nodes] toggle failed:', e);
      if(typeof smShowToast === 'function') smShowToast('MS storm nodes: ' + e.message, '#c44');
    }
  };

  // ── Hover popup ──
  /** @type {Object|null} */ var _popup = null;
  /** @type {boolean} */     var _popupAttached = false;

  function _attachPopup(){
    if(_popupAttached) return;
    if(typeof mapboxgl === 'undefined') return;
    _popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
    LAYER_IDS.forEach(function(id){
      smMap.on('mouseenter', id, function(e){
        smMap.getCanvas().style.cursor = 'pointer';
        var f = e.features && e.features[0];
        if(!f) return;
        var p = f.properties || {};
        var typeName = (window.MS_STORM_NODE_TYPES || [])[Number(p.typeCode)] || 'Storm node';
        var html = '<div style="font:12px/1.3 system-ui;padding:2px 4px;">' +
                   '<b>' + typeName + '</b><br>' +
                   'Asset ID: ' + p.assetId +
                   (p.year ? '<br>Installed: ' + p.year : '') +
                   '</div>';
        _popup.setLngLat(e.lngLat).setHTML(html).addTo(smMap);
      });
      smMap.on('mouseleave', id, function(){
        smMap.getCanvas().style.cursor = '';
        if(_popup) _popup.remove();
      });
    });
    _popupAttached = true;
  }

  // ── Proximity helper ──
  /**
   * Returns storm node records within radiusMeters of (lng, lat), bucketed by type.
   * @param {number} lng
   * @param {number} lat
   * @param {number} [radiusMeters=200]
   * @returns {Promise<{
   *   total: number,
   *   countsByType: Object<string, number>,
   *   nearestByBucket: Object<string, {assetId:number, type:string, distM:number, lngLat:Array<number>}>,
   *   records: Array<{assetId:number, type:string, distM:number, lngLat:Array<number>}>
   * }>}
   */
  window.queryMSStormNodesNear = async function(lng, lat, radiusMeters){
    var R = (typeof radiusMeters === 'number' && radiusMeters > 0) ? radiusMeters : 200;
    var data = await window.loadMSStormNodes();
    var TYPES = window.MS_STORM_NODE_TYPES || data.typeCodes || [];

    // Approx degree extents for a coarse bbox prefilter (metres → degrees)
    var dLat = R / 110540;
    var dLng = R / (111320 * Math.cos(lat * Math.PI / 180));
    var south = lat - dLat, north = lat + dLat, west = lng - dLng, east = lng + dLng;

    var hits = [];
    var countsByType = Object.create(null);
    var nearestByBucket = Object.create(null);
    var bucketName = function(code){
      if(BUCKET_OUTLET.indexOf(code)  !== -1) return 'outlet';
      if(BUCKET_FDC.indexOf(code)     !== -1) return 'fdc';
      if(BUCKET_MANHOLE.indexOf(code) !== -1) return 'manhole';
      if(BUCKET_INLET.indexOf(code)   !== -1) return 'inlet';
      return 'other';
    };

    for(var i = 0; i < data.records.length; i++){
      var r = data.records[i];
      var pt = r[3];
      if(pt[0] < west || pt[0] > east || pt[1] < south || pt[1] > north) continue;
      var d = _haversineM(lat, lng, pt[1], pt[0]);
      if(d > R) continue;
      var t = TYPES[r[1]] || 'Unknown';
      countsByType[t] = (countsByType[t] || 0) + 1;
      var bucket = bucketName(r[1]);
      var entry = { assetId: r[0], type: t, distM: Math.round(d), lngLat: pt };
      hits.push(entry);
      if(!nearestByBucket[bucket] || nearestByBucket[bucket].distM > entry.distM){
        nearestByBucket[bucket] = entry;
      }
    }
    hits.sort(function(a, b){ return a.distM - b.distM; });
    return {
      total: hits.length,
      countsByType: countsByType,
      nearestByBucket: nearestByBucket,
      records: hits.slice(0, 500)
    };
  };

  // ── Graph-link helper: resolve pipe NODEFROM/NODETO to node coords ──
  /**
   * Returns the node record for an ASSETID (typically taken from a pipe's
   * NODEFROM or NODETO). Useful for "trace to outfall" queries.
   * @param {number} assetId
   * @returns {Promise<{assetId:number, type:string, year:number, lngLat:Array<number>}|null>}
   */
  window.resolveMSStormNode = async function(assetId){
    var data = await window.loadMSStormNodes();
    var idx = _ensureIndex(data.records);
    var r = idx[assetId];
    if(!r) return null;
    var TYPES = window.MS_STORM_NODE_TYPES || data.typeCodes || [];
    return { assetId: r[0], type: TYPES[r[1]] || 'Unknown', year: r[2], lngLat: r[3] };
  };

  // ── Geometry ──
  function _haversineM(lat1, lng1, lat2, lng2){
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad, dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
  }

  // Expose Mississauga bbox for any caller that wants to short-circuit
  // non-Mississauga lots (the storm-nodes data only covers Mississauga).
  window.MS_STORM_NODES_BBOX = MISS_BBOX;

})();
