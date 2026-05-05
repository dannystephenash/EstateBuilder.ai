// sitemap-zoning-mississauga.js — Mississauga zoning lookup + overlay
// =============================================================================
// Uses BUNDLED Mississauga 2022 Zoning GeoJSON (10,693 polygons) loaded from
// data/mississauga-zoning.min.js.  The live FeatureServer endpoint at
// services6.arcgis.com truncates to ~2,000 features per query at low zoom,
// so the entire dataset would never render properly. The bundled file gives
// us all polygons at once with no truncation.
//
// Falls back to the live FeatureServer if the bundle hasn't loaded yet.
//
// Verified attribute schema (from City of Mississauga GeoJSON, 2026-05-03):
//   ZONE_CODE         — base zone code (e.g. "RA1", "C4-117", "RM5", "OS1")
//   ZONE_DESCRIPTION  — human-readable label
//   ZONE_CATEGORY     — broader bucket (e.g. "Residential", "Commercial")
//   BASE_ZONE         — zone code without exception suffix
//   GREENLANDS        — greenlands overlay flag
//   BYLAW             — always "0225-2007"
//
// Public API (window):
//   detectZoningMississauga(lat, lng) -> Promise<ZoningResult>
//   detectZoningAuto(lat, lng)        -> Promise<ZoningResult>  (Toronto OR Mississauga)
//   toggleMississaugaZoningOverlay()  -> Mapbox vector layer toggle
//
// NOTE: FSI / height / coverage limits are NOT in the GeoJSON. Those live in
// the by-law text (Mississauga Bylaw 0225-2007) under the per-zone definition
// or per-exception schedule. We expose only the zone code itself; the user
// can look up FSI/height limits from the by-law or we can ship a separate
// per-zone-code reference table later.
// =============================================================================

(function(){
  'use strict';

  var MISS_ZONING_BASE = 'https://services6.arcgis.com/hM5ymMLbxIyWTjn2/arcgis/rest/services/2022_Zoning/FeatureServer/0';

  var BOUNDS_TORONTO     = { minLng: -79.65, maxLng: -79.10, minLat: 43.58, maxLat: 43.86 };
  var BOUNDS_MISSISSAUGA = { minLng: -79.85, maxLng: -79.45, minLat: 43.45, maxLat: 43.75 };

  function _inBounds(lat, lng, b){
    return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
  }

  // Returns the bundled GeoJSON FeatureCollection if loaded, else null
  function _bundle(){
    return (typeof window.MISSISSAUGA_ZONING_GEOJSON === 'object') ? window.MISSISSAUGA_ZONING_GEOJSON : null;
  }

  // Map a Mississauga zone code prefix to a permitted-use category
  function _permittedFromZone(zoneCode){
    var zc = (zoneCode || '').toUpperCase();
    if(zc.indexOf('RA') === 0)       return ['Residential Apartment'];
    if(zc.indexOf('RM') === 0)       return ['Residential Multiple (Townhouse / Stacked)'];
    if(zc.indexOf('RT') === 0)       return ['Residential Townhouse'];
    if(zc.indexOf('RL') === 0)       return ['Residential Detached (Large Lot)'];
    if(zc.indexOf('RS') === 0)       return ['Residential Detached / Semi'];
    if(zc.charAt(0) === 'R')         return ['Residential'];
    if(zc.indexOf('CC') === 0)       return ['Commercial — Convenience'];
    if(zc.indexOf('C') === 0)        return ['Commercial / Mixed Use'];
    if(zc.indexOf('E') === 0)        return ['Employment / Industrial'];
    if(zc.indexOf('I') === 0)        return ['Institutional'];
    if(zc.indexOf('OS') === 0)       return ['Open Space'];
    if(zc.charAt(0) === 'O')         return ['Open Space'];
    if(zc.charAt(0) === 'G')         return ['Greenlands'];
    if(zc === 'U')                   return ['Utility'];
    if(zc.charAt(0) === 'D')         return ['Downtown Mixed Use'];
    if(zc === 'B')                   return ['Buffer / Setback'];
    return ['See By-law 0225-2007'];
  }

  // Local point-in-polygon search using turf.js if available; bundled GeoJSON
  function _localLookup(lat, lng){
    var fc = _bundle();
    if(!fc || !Array.isArray(fc.features) || typeof turf === 'undefined') return null;
    var pt = turf.point([lng, lat]);
    for(var i = 0; i < fc.features.length; i++){
      var feat = fc.features[i];
      if(!feat || !feat.geometry) continue;
      try {
        if(turf.booleanPointInPolygon(pt, feat)) return feat;
      } catch(e){ /* skip malformed geometry */ }
    }
    return null;
  }

  /**
   * Query Mississauga 2022 Zoning at a given lat/lng.
   * Prefers the bundled GeoJSON (instant, complete) and falls back to the live
   * FeatureServer endpoint if the bundle hasn't loaded.
   */
  window.detectZoningMississauga = async function(lat, lng){
    var result = {
      jurisdiction: 'Mississauga',
      zone: null, zoneString: null,
      category: null, baseZone: null,
      bylaw: '0225-2007',
      greenlands: false,
      fsiLimit: null, heightLimit: null, coverage: null,
      exception: false, exceptionNo: null,
      bylawSection: null, permitted: [],
      source: null, raw: null
    };

    // ── 1) Try bundled local lookup first ──
    var feat = _localLookup(lat, lng);
    if(feat){
      var p = feat.properties || {};
      result.zone        = p.ZONE_CODE || null;
      result.zoneString  = p.ZONE_DESCRIPTION || result.zone;
      result.category    = p.ZONE_CATEGORY || null;
      result.baseZone    = p.BASE_ZONE || null;
      result.greenlands  = !!(p.GREENLANDS && p.GREENLANDS !== 'None');
      result.bylaw       = p.BYLAW || '0225-2007';
      result.source      = 'bundle';
      result.raw         = p;

      // Detect "-NNN" exception suffix on zone code
      var em = (result.zone || '').match(/-(\d+)/);
      if(em){ result.exception = true; result.exceptionNo = em[1]; }

      result.permitted = _permittedFromZone(result.zone);
      // Merge in zone standards (FSI, height, storeys) from the lookup table
      _mergeStandards(result);
      return result;
    }

    // ── 2) Fall back to live FeatureServer ──
    try {
      var url = MISS_ZONING_BASE +
        '/query?geometry=' + lng + ',' + lat +
        '&geometryType=esriGeometryPoint&inSR=4326' +
        '&spatialRel=esriSpatialRelIntersects&outFields=*&returnGeometry=false&f=json';
      var resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if(!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      if(!data.features || data.features.length === 0) return result;
      var p = data.features[0].attributes || {};
      result.zone        = p.ZONE_CODE || p.ZONE || null;
      result.zoneString  = p.ZONE_DESCRIPTION || p.ZONE_FULL || result.zone;
      result.category    = p.ZONE_CATEGORY || null;
      result.baseZone    = p.BASE_ZONE_DESIGNATION || p.BASE_ZONE || null;
      result.greenlands  = !!(p.GREENLANDS_OVERLAY && p.GREENLANDS_OVERLAY !== 'None');
      result.bylaw       = p.BYLAW || '0225-2007';
      result.source      = 'live';
      result.raw         = p;
      var em = (result.zone || '').match(/-(\d+)/);
      if(em){ result.exception = true; result.exceptionNo = em[1]; }
      result.permitted = _permittedFromZone(result.zone);
      _mergeStandards(result);
    } catch(e){
      console.warn('[Mississauga zoning] live query failed:', e.message);
    }
    return result;
  };

  // Merge by-law standards (FSI / height / storeys) into the result if
  // window.lookupMississaugaZoneStandards is available
  function _mergeStandards(result){
    if(typeof window.lookupMississaugaZoneStandards !== 'function') return;
    var std = window.lookupMississaugaZoneStandards(result.zone);
    if(!std) return;
    if(std.maxFSI != null)     result.fsiLimit = std.maxFSI;
    if(std.maxHeightM != null) result.heightLimit = std.maxHeightM;
    if(std.maxStoreys != null) result.maxStoreys = std.maxStoreys;
    result.standardsSource    = std.source;
    result.standardsMatchedAs = std.matchedAs;
    if(std.exceptionFromBase) result.exceptionNote = std.exceptionNote;
  }

  /**
   * Auto-dispatch zoning lookup based on lat/lng bounds.
   */
  window.detectZoningAuto = async function(lat, lng){
    if(_inBounds(lat, lng, BOUNDS_MISSISSAUGA)){
      var miss = await window.detectZoningMississauga(lat, lng);
      if(miss && miss.zone) return miss;
    }
    if(_inBounds(lat, lng, BOUNDS_TORONTO) && typeof window.detectZoning === 'function'){
      var tor = await window.detectZoning(lat, lng);
      if(tor && tor.zone){ tor.jurisdiction = 'Toronto'; return tor; }
    }
    return await window.detectZoningMississauga(lat, lng);
  };

  // ── Mapbox vector overlay toggle ──
  var _missZoningVisible = false;
  var _missZoningPopup = null;

  function _zoneFillColor(){
    // Bolder, saturated colors readable through satellite imagery.
    // Two nested match expressions: the outer matches the 2-letter prefix
    // (RA, RM, RT, RL, RS, CC, OS) for specific use sub-categories; the
    // default falls through to an inner match on the 1-letter prefix
    // for everything else.
    return [
      'match',
      ['slice', ['coalesce', ['get','ZONE_CODE'], ['literal','']], 0, 2],
      'RA', '#fff44d',   // Residential Apartment - bright yellow
      'RM', '#f5a623',   // Residential Multiple (townhouse) - orange
      'RT', '#f0c040',   // Residential Townhouse - amber
      'RL', '#7ed321',   // Residential Large Lot - bright green
      'RS', '#a8e44a',   // Residential Standard / Semi - lime
      'CC', '#9013fe',   // Downtown Core - purple
      'OS', '#0aa650',   // Open Space - dark green
      // default = inner match on first letter
      [
        'match',
        ['slice', ['coalesce', ['get','ZONE_CODE'], ['literal','']], 0, 1],
        'R', '#a8e44a',   // Residential generic
        'C', '#ff5a5a',   // Commercial - red
        'E', '#3a7bd5',   // Employment - blue
        'I', '#d4a017',   // Institutional - gold
        'D', '#9013fe',   // Downtown - purple
        'G', '#1e7a3e',   // Greenlands - forest green
        'U', '#888888',   // Utility - gray
        'B', '#666666',   // Buffer - dark gray
        '#bbbbbb'           // unknown
      ]
    ];
  }

  window.toggleMississaugaZoningOverlay = function(){
    if(typeof smMap === 'undefined' || !smMap) return;
    _missZoningVisible = !_missZoningVisible;

    if(!_missZoningVisible){
      try { if(smMap.getLayer('miss-zoning-fill'))  smMap.removeLayer('miss-zoning-fill');  } catch(e){}
      try { if(smMap.getLayer('miss-zoning-line'))  smMap.removeLayer('miss-zoning-line');  } catch(e){}
      try { if(smMap.getSource('miss-zoning-src')) smMap.removeSource('miss-zoning-src'); } catch(e){}
      smMap.off('click', _missZoningClick);
      if(_missZoningPopup){ _missZoningPopup.remove(); _missZoningPopup = null; }
      if(typeof smShowToast === 'function') smShowToast('Mississauga zoning overlay off', '#888');
      return;
    }

    if(smMap.getSource('miss-zoning-src')){
      try { smMap.removeLayer('miss-zoning-fill'); } catch(e){}
      try { smMap.removeLayer('miss-zoning-line'); } catch(e){}
      try { smMap.removeSource('miss-zoning-src'); } catch(e){}
    }

    // Prefer the bundled GeoJSON (complete, fast, offline).  If unavailable,
    // fall back to the live FeatureServer URL with bbox filter.
    var bundle = _bundle();
    if(bundle){
      smMap.addSource('miss-zoning-src', { type: 'geojson', data: bundle });
      if(typeof smShowToast === 'function') smShowToast('Mississauga zoning ON — '+bundle.features.length+' polygons (bundled)', '#AEBC46');
    } else {
      var b = smMap.getBounds();
      var bboxQuery = b.getWest() + ',' + b.getSouth() + ',' + b.getEast() + ',' + b.getNorth();
      var dataUrl = MISS_ZONING_BASE + '/query?where=1%3D1' +
                    '&geometry=' + encodeURIComponent(bboxQuery) +
                    '&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326' +
                    '&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson';
      smMap.addSource('miss-zoning-src', { type: 'geojson', data: dataUrl });
      if(typeof smShowToast === 'function') smShowToast('Mississauga zoning ON — bundle unavailable, using live API (truncated)', '#ffaa44');
    }

    smMap.addLayer({
      id: 'miss-zoning-fill', type: 'fill', source: 'miss-zoning-src',
      paint: {
        'fill-color': _zoneFillColor(),
        'fill-opacity': 0.65,           // bolder than 0.35 — readable against satellite
        'fill-outline-color': '#222'    // darker outline reads cleaner
      }
    });
    smMap.addLayer({
      id: 'miss-zoning-line', type: 'line', source: 'miss-zoning-src',
      paint: {
        'line-color': '#1a1a1a',
        'line-width': 1.0,              // thicker than 0.6
        'line-opacity': 0.85            // bolder than 0.6
      }
    });
    smMap.on('click', _missZoningClick);
  };

  // Auto-couple to the existing Toronto zoning toggle so one click activates BOTH overlays
  function _attachToExistingToggle(){
    if(typeof window.toggleZoningOverlay !== 'function') return false;
    if(window.toggleZoningOverlay._missCoupled) return true;
    var orig = window.toggleZoningOverlay;
    var wrapped = async function(){
      var rv = await orig.apply(this, arguments);
      try { window.toggleMississaugaZoningOverlay(); } catch(e){ console.warn('[Mississauga zoning] auto-toggle failed:', e); }
      return rv;
    };
    wrapped._missCoupled = true;
    window.toggleZoningOverlay = wrapped;
    return true;
  }
  if(!_attachToExistingToggle()){
    var _attempts = 0;
    var _intv = setInterval(function(){
      _attempts++;
      if(_attachToExistingToggle() || _attempts > 20){ clearInterval(_intv); }
    }, 250);
  }

  function _missZoningClick(e){
    var feats = smMap.queryRenderedFeatures(e.point, { layers: ['miss-zoning-fill'] });
    if(!feats || feats.length === 0) return;
    var p = feats[0].properties || {};
    var zone     = p.ZONE_CODE || 'Unknown';
    var category = p.ZONE_CATEGORY || '';
    var desc     = p.ZONE_DESCRIPTION || '';
    var base     = p.BASE_ZONE || '';
    var bylaw    = p.BYLAW || '0225-2007';
    var greenLand= (p.GREENLANDS && p.GREENLANDS !== 'None') ? p.GREENLANDS : '';
    var em = (zone + '').match(/-(\d+)/);
    var exNo = em ? em[1] : null;
    // Pull FSI/height/storeys from the by-law standards lookup if available
    var std = (typeof window.lookupMississaugaZoneStandards === 'function') ? window.lookupMississaugaZoneStandards(zone) : null;
    var fsi = (std && std.maxFSI != null) ? std.maxFSI : null;
    var ht  = (std && std.maxHeightM != null) ? std.maxHeightM : null;
    var st  = (std && std.maxStoreys != null) ? std.maxStoreys : null;
    var html =
      '<div style="font-family:Outfit,DM Sans,sans-serif;padding:6px;min-width:240px">' +
        '<div style="color:#AEBC46;font-weight:700;font-size:14px;margin-bottom:2px">'+zone+'</div>' +
        '<div style="color:#666;font-size:11px;margin-bottom:6px">'+category+(category && desc !== category ? ' - ' : '')+desc+'</div>' +
        '<table style="width:100%;font-size:11px;color:#444;border-spacing:0">' +
          (base && base !== zone ? '<tr><td style="color:#888">Base zone</td><td style="text-align:right;font-weight:600">'+base+'</td></tr>' : '') +
          (exNo ? '<tr><td style="color:#888">Exception</td><td style="text-align:right;font-weight:600">'+exNo+'</td></tr>' : '') +
          (greenLand ? '<tr><td style="color:#888">Greenlands</td><td style="text-align:right;font-weight:600">'+greenLand+'</td></tr>' : '') +
          (fsi != null ? '<tr><td style="color:#888">Max FSI</td><td style="text-align:right;font-weight:600;color:#AEBC46">'+fsi+'</td></tr>' : '') +
          (ht  != null ? '<tr><td style="color:#888">Max height</td><td style="text-align:right;font-weight:600;color:#AEBC46">'+ht+' m</td></tr>' : '') +
          (st  != null ? '<tr><td style="color:#888">Max storeys</td><td style="text-align:right;font-weight:600;color:#AEBC46">'+st+'</td></tr>' : '') +
          '<tr><td style="color:#888">By-law</td><td style="text-align:right;font-weight:600">'+bylaw+'</td></tr>' +
        '</table>' +
        (std ? '' : '<div style="font-size:10px;color:#999;margin-top:6px;font-style:italic">Zone standards not in lookup - see by-law schedule</div>') +
        (std && std.exceptionFromBase ? '<div style="font-size:10px;color:#ffaa44;margin-top:6px;font-style:italic">Standards from base zone - exception may override</div>' : '') +
      '</div>';
    if(_missZoningPopup) _missZoningPopup.remove();
    _missZoningPopup = new mapboxgl.Popup({ maxWidth: '300px' })
      .setLngLat(e.lngLat)
      .setHTML(html)
      .addTo(smMap);
  }

})();
