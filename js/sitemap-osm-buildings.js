// sitemap-osm-buildings.js — OpenStreetMap building footprints loader
// =============================================================================
// Fetches building footprints from the OpenStreetMap Overpass API for any
// lat/lng anywhere in the world. Used as the primary "context buildings"
// source for Mississauga (and any other location where Mapbox composite
// buildings are sparse). Works alongside the existing Toronto context-buildings
// pipeline — populates P._contextBuildingFeatures in the same format that
// renderer-components.js's rebuildContextBuildings() expects.
//
// Endpoint: https://overpass-api.de/api/interpreter (CORS-enabled, free)
//
// OSM building tags used:
//   building=*                  — any building tag triggers inclusion
//   height=<n m>                — explicit roof height in metres (preferred)
//   building:levels=<n>         — storey count (multiplied by 3.5m if no height)
//   min_height=<n m>            — base elevation above grade (rare)
//
// Public API (window):
//   loadOSMBuildingsAround(lat, lng, radiusMeters) -> Promise<features[]>
//   captureOSMContextBuildings(radiusMeters)        -> populate P._contextBuildingFeatures
//   toggleOSMBuildings3D()                          -> Mapbox fill-extrusion overlay
// =============================================================================

(function(){
  'use strict';

  var OVERPASS_ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',     // mirror, often faster
    'https://overpass.openstreetmap.ru/api/interpreter'  // backup mirror
  ];
  var DEFAULT_FLOOR_HEIGHT_M = 3.5;
  var DEFAULT_BUILDING_HEIGHT_M = 8;   // 1-2 storey fallback

  var _cache = {};   // key = bbox-rounded-string, value = features

  // Approximate bbox around (lat, lng) of N metres on each side.
  function _bboxAround(lat, lng, radiusM){
    var dLat = radiusM / 110540;
    var dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
    return {
      south: lat - dLat,
      north: lat + dLat,
      west:  lng - dLng,
      east:  lng + dLng
    };
  }

  // Parse an OSM height tag: "12", "12 m", "12m", "39 ft" -> metres
  function _parseHeight(s){
    if(typeof s === 'number') return s;
    if(typeof s !== 'string') return null;
    var m = s.match(/([\d.]+)\s*(m|ft|')?/i);
    if(!m) return null;
    var v = parseFloat(m[1]);
    if(!isFinite(v)) return null;
    var unit = (m[2] || '').toLowerCase();
    if(unit === 'ft' || unit === "'") v *= 0.3048;
    return v;
  }

  // Convert an OSM way (geometry-included) to a GeoJSON-style feature
  function _wayToFeature(el){
    if(!el || !Array.isArray(el.geometry) || el.geometry.length < 4) return null;
    var ring = el.geometry.map(function(pt){ return [pt.lon, pt.lat]; });
    if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
      ring.push([ring[0][0], ring[0][1]]);
    }
    var t = el.tags || {};
    var height = _parseHeight(t.height);
    var levels = parseFloat(t['building:levels']);
    if(height == null && isFinite(levels) && levels > 0) height = levels * DEFAULT_FLOOR_HEIGHT_M;
    if(height == null) height = DEFAULT_BUILDING_HEIGHT_M;
    var minHeight = _parseHeight(t.min_height) || 0;
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        osm_id: el.id,
        building: t.building || 'yes',
        name: t.name || null,
        height: height,
        levels: isFinite(levels) ? levels : null,
        min_height: minHeight
      }
    };
  }

  // Convert an OSM relation (multipolygon) — take the first outer ring as a Polygon
  function _relationToFeature(el){
    if(!el || !Array.isArray(el.members)) return null;
    var outer = null;
    for(var i = 0; i < el.members.length; i++){
      var m = el.members[i];
      if(m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 4){
        outer = m.geometry; break;
      }
    }
    if(!outer) return null;
    var ring = outer.map(function(pt){ return [pt.lon, pt.lat]; });
    if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
      ring.push([ring[0][0], ring[0][1]]);
    }
    var t = el.tags || {};
    var height = _parseHeight(t.height);
    var levels = parseFloat(t['building:levels']);
    if(height == null && isFinite(levels) && levels > 0) height = levels * DEFAULT_FLOOR_HEIGHT_M;
    if(height == null) height = DEFAULT_BUILDING_HEIGHT_M;
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        osm_id: el.id,
        building: t.building || 'yes',
        name: t.name || null,
        height: height,
        levels: isFinite(levels) ? levels : null,
        min_height: _parseHeight(t.min_height) || 0
      }
    };
  }

  /**
   * Fetch buildings within a bbox around (lat, lng).
   * @param {number} lat
   * @param {number} lng
   * @param {number} radiusMeters - default 500
   * @returns {Promise<Array<Feature>>}
   */
  window.loadOSMBuildingsAround = async function(lat, lng, radiusMeters){
    var R = radiusMeters || 1000;   // bumped from 500m to fetch buildings beyond 1 km
    var bb = _bboxAround(lat, lng, R);
    var key = lat.toFixed(4) + ',' + lng.toFixed(4) + ',' + R;
    if(_cache[key]) return _cache[key];

    // Overpass QL: all way+relation features tagged building, with full geometry
    var query = '[out:json][timeout:25];' +
      '(' +
        'way["building"](' + bb.south + ',' + bb.west + ',' + bb.north + ',' + bb.east + ');' +
        'relation["building"](' + bb.south + ',' + bb.west + ',' + bb.north + ',' + bb.east + ');' +
      ');' +
      'out geom;';

    var lastErr = null;
    for(var ep = 0; ep < OVERPASS_ENDPOINTS.length; ep++){
      try {
        var url = OVERPASS_ENDPOINTS[ep];
        var resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: AbortSignal.timeout(30000)
        });
        if(!resp.ok) throw new Error('HTTP ' + resp.status);
        var data = await resp.json();
        var feats = [];
        (data.elements || []).forEach(function(el){
          var feat = null;
          if(el.type === 'way') feat = _wayToFeature(el);
          else if(el.type === 'relation') feat = _relationToFeature(el);
          if(feat) feats.push(feat);
        });
        _cache[key] = feats;
        console.log('[OSM buildings] ' + feats.length + ' buildings within ' + R + 'm of (' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ') from ' + url);
        return feats;
      } catch(e){
        lastErr = e;
        console.warn('[OSM buildings] endpoint ' + OVERPASS_ENDPOINTS[ep] + ' failed:', e.message);
      }
    }
    throw lastErr || new Error('All Overpass endpoints failed');
  };

  /**
   * Populate P._contextBuildingFeatures with OSM buildings near the lot
   * centroid, in the format renderer-components.js expects.
   */
  window.captureOSMContextBuildings = async function(radiusMeters){
    if(typeof P === 'undefined' || !P || !P.siteCoords){
      console.warn('[OSM buildings] no site coords - draw a lot first');
      return;
    }
    var R = radiusMeters || 1000;   // bumped from 500m
    try {
      var feats = await window.loadOSMBuildingsAround(P.siteCoords.lat, P.siteCoords.lng, R);
      var ctx = (P._contextBuildingFeatures || []).filter(function(b){ return b.source !== 'osm'; });
      feats.forEach(function(feat){
        if(!feat.geometry || feat.geometry.type !== 'Polygon') return;
        var ring = feat.geometry.coordinates[0];
        if(!ring || ring.length < 4) return;
        ctx.push({
          coords: ring,
          height: feat.properties.height || DEFAULT_BUILDING_HEIGHT_M,
          minHeight: feat.properties.min_height || 0,
          source: 'osm'
        });
      });
      P._contextBuildingFeatures = ctx;
      console.log('[OSM buildings] captured ' + feats.length + ' context buildings within ' + R + 'm of site');
      if(typeof rebuildContextBuildings === 'function'){
        try { rebuildContextBuildings(); } catch(e){ console.warn('[OSM buildings] rebuildContextBuildings failed:', e); }
      }
    } catch(e){
      console.error('[OSM buildings] capture failed:', e.message);
      if(typeof smShowToast === 'function') smShowToast('OSM buildings fetch failed: ' + e.message, '#c44');
    }
  };

  // ── Mapbox fill-extrusion toggle for the Site Map ──
  var _osmVisible = false;

  window.toggleOSMBuildings3D = async function(){
    if(typeof smMap === 'undefined' || !smMap){ console.warn('[OSM] smMap not ready'); return; }
    _osmVisible = !_osmVisible;

    if(!_osmVisible){
      try { if(smMap.getLayer('osm-bldg-3d')) smMap.removeLayer('osm-bldg-3d'); } catch(e){}
      try { if(smMap.getSource('osm-bldg-src')) smMap.removeSource('osm-bldg-src'); } catch(e){}
      if(typeof smShowToast === 'function') smShowToast('OSM buildings off', '#888');
      return;
    }

    var b = smMap.getBounds();
    var center = { lat: (b.getNorth() + b.getSouth()) / 2, lng: (b.getEast() + b.getWest()) / 2 };
    // Approximate the visible radius as half the diagonal of the bbox in metres
    var diagM = Math.sqrt(
      Math.pow((b.getNorth() - b.getSouth()) * 110540, 2) +
      Math.pow((b.getEast() - b.getWest()) * 111320 * Math.cos(center.lat * Math.PI/180), 2)
    );
    var radius = Math.min(2500, Math.max(500, diagM / 2));

    if(typeof smShowToast === 'function') smShowToast('Loading OSM buildings (~' + Math.round(radius) + 'm)...', '#88aacc');

    try {
      var feats = await window.loadOSMBuildingsAround(center.lat, center.lng, radius);
      try { if(smMap.getLayer('osm-bldg-3d')) smMap.removeLayer('osm-bldg-3d'); } catch(e){}
      try { if(smMap.getSource('osm-bldg-src')) smMap.removeSource('osm-bldg-src'); } catch(e){}
      smMap.addSource('osm-bldg-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: feats }
      });
      smMap.addLayer({
        id: 'osm-bldg-3d',
        type: 'fill-extrusion',
        source: 'osm-bldg-src',
        paint: {
          'fill-extrusion-color': '#999999',
          'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'height']], 8],
          'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'min_height']], 0],
          'fill-extrusion-opacity': 0.85
        }
      });
      if(typeof smShowToast === 'function') smShowToast('OSM buildings ON - ' + feats.length + ' loaded', '#AEBC46');
    } catch(e){
      if(typeof smShowToast === 'function') smShowToast('OSM buildings failed: ' + e.message, '#c44');
    }
  };

})();
