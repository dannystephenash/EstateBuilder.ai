// infrastructure-queries.js — CKAN/OEB query helpers for SCAN INFRASTRUCTURE
// =============================================================================
// CKAN doesn't support JSONP. This file uses the same fetch + CORS-proxy
// fallback pattern as fetchNearbyComparables (the project's working
// comparables fetcher) — direct first, then allorigins, then corsproxy.io.
// =============================================================================

(function(){
  'use strict';

  // ── CORS-proxy fetch helper (matches fetchNearbyComparables pattern) ───────
  var CORS_PROXIES = ['', 'https://api.allorigins.win/raw?url=', 'https://corsproxy.io/?'];

  function _ckanFetch(rawUrl, timeoutMs){
    return new Promise(function(resolve){
      var attempts = CORS_PROXIES.map(function(proxy){
        var url = proxy ? proxy + encodeURIComponent(rawUrl) : rawUrl;
        return url;
      });
      var i = 0;
      function tryNext(){
        if(i >= attempts.length){ resolve({error: 'all CORS proxies failed'}); return; }
        var url = attempts[i++];
        fetch(url, { signal: AbortSignal.timeout(timeoutMs || 12000) })
          .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function(d){ resolve(d); })
          .catch(function(e){ console.log('[infra] proxy ' + (i-1) + ' failed: ' + e.message); tryNext(); });
      }
      tryNext();
    });
  }

  // Haversine distance in metres for proximity filtering.
  function _distM(lng1, lat1, lng2, lat2){
    var R = 6371000;
    var toRad = function(d){ return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
    var a = Math.sin(dLat/2)*Math.sin(dLat/2) +
            Math.cos(toRad(lat1))*Math.cos(toRad(lat2)) *
            Math.sin(dLng/2)*Math.sin(dLng/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // ── Toronto Open Data CKAN base ────────────────────────────────────────────
  var CKAN_BASE = 'https://ckan0.cf.opendata.inter.prod-toronto.ca';

  // Resolve a CKAN package slug → datastore_active resource id (cached).
  function _resolveResourceId(packageSlug){
    return new Promise(function(resolve){
      var cacheKey = '_ckanResId_' + packageSlug;
      try {
        var cached = localStorage.getItem(cacheKey);
        if(cached){ resolve({ resourceId: cached, cached: true }); return; }
      } catch(e){}
      var url = CKAN_BASE + '/api/3/action/package_show?id=' + encodeURIComponent(packageSlug);
      _ckanFetch(url, 10000).then(function(data){
        if(!data || data.error || !data.success || !data.result || !data.result.resources){
          resolve({ error: 'package_show failed for ' + packageSlug + ': ' + (data && data.error || 'no result') });
          return;
        }
        var picked = null;
        data.result.resources.forEach(function(r){
          if(r.datastore_active && !picked) picked = r.id;
        });
        if(!picked) picked = data.result.resources[0] && data.result.resources[0].id;
        if(picked){
          try { localStorage.setItem(cacheKey, picked); } catch(e){}
          resolve({ resourceId: picked });
        } else {
          resolve({ error: 'no resource for ' + packageSlug });
        }
      });
    });
  }

  function _datastoreSearch(resourceId, params){
    return new Promise(function(resolve){
      var qs = 'resource_id=' + encodeURIComponent(resourceId);
      Object.keys(params || {}).forEach(function(k){
        qs += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
      var url = CKAN_BASE + '/api/3/action/datastore_search?' + qs;
      _ckanFetch(url, 12000).then(function(data){
        if(data && data.success && data.result && data.result.records){
          resolve({ records: data.result.records });
        } else {
          resolve({ error: (data && data.error && data.error.message) || 'datastore_search returned no records' });
        }
      });
    });
  }

  // ── _queryTorontoHydrants — bundled data with on-demand load ───────────────
  function _filterHydrants(lng, lat, cb){
    var data = window._hydrantsData;
    if(!data || !Array.isArray(data.records)){
      _infraData.hydrant = { error: 'hydrants dataset failed to load' };
      cb(); return;
    }
    var radiusM = 500;
    var pts = [];
    data.records.forEach(function(rec){
      var hLng = rec[1], hLat = rec[2];
      if(typeof hLng !== 'number' || typeof hLat !== 'number') return;
      var d = _distM(lng, lat, hLng, hLat);
      if(d <= radiusM){
        pts.push({ id: rec[0], lng: hLng, lat: hLat, dist: Math.round(d) });
      }
    });
    pts.sort(function(a, b){ return a.dist - b.dist; });
    _infraData.hydrant = pts.slice(0, 60);
    cb();
  }
  window._queryTorontoHydrants = function(lng, lat, cb){
    if(window._hydrantsData && Array.isArray(window._hydrantsData.records)){
      _filterHydrants(lng, lat, cb);
      return;
    }
    var existing = document.querySelector('script[data-hydrants-loader]');
    if(existing){
      var poll = setInterval(function(){
        if(window._hydrantsData){ clearInterval(poll); _filterHydrants(lng, lat, cb); }
      }, 100);
      setTimeout(function(){
        clearInterval(poll);
        if(!window._hydrantsData){
          _infraData.hydrant = { error: 'hydrant data load timeout' };
          cb();
        }
      }, 10000);
      return;
    }
    var s = document.createElement('script');
    s.setAttribute('data-hydrants-loader', '1');
    s.src = 'data/hydrants.min.js';
    s.onload  = function(){ _filterHydrants(lng, lat, cb); };
    s.onerror = function(){
      _infraData.hydrant = { error: 'failed to load data/hydrants.min.js — file missing' };
      cb();
    };
    document.head.appendChild(s);
  };

  // Generic CKAN-by-slug fetcher used by water/sewer/valve/catchbasin.
  // Pulls up to 1000 records, post-filters to a proximity radius if the
  // dataset has lat/lng columns. If it doesn't, returns the first 50.
  function _ckanProximityQuery(packageSlug, lng, lat, radiusM, infraKey, cb){
    _resolveResourceId(packageSlug).then(function(resolved){
      if(resolved.error){
        _infraData[infraKey] = { error: resolved.error };
        cb(); return;
      }
      _datastoreSearch(resolved.resourceId, { limit: 1000 }).then(function(searchResult){
        if(searchResult.error){
          _infraData[infraKey] = { error: searchResult.error };
          cb(); return;
        }
        var records = searchResult.records || [];
        // Detect lat/lng column names — varies by dataset
        var sample = records[0] || {};
        var lngKey = null, latKey = null;
        ['lng','LNG','longitude','LONGITUDE','x','X','lon'].forEach(function(k){ if(sample[k] != null && !lngKey) lngKey = k; });
        ['lat','LAT','latitude','LATITUDE','y','Y'].forEach(function(k){ if(sample[k] != null && !latKey) latKey = k; });
        if(lngKey && latKey){
          var nearby = [];
          records.forEach(function(r){
            var rlng = parseFloat(r[lngKey]), rlat = parseFloat(r[latKey]);
            if(!isFinite(rlng) || !isFinite(rlat)) return;
            var d = _distM(lng, lat, rlng, rlat);
            if(d <= radiusM){
              nearby.push({ id: r._id, lng: rlng, lat: rlat, dist: Math.round(d), _row: r });
            }
          });
          nearby.sort(function(a, b){ return a.dist - b.dist; });
          _infraData[infraKey] = nearby.slice(0, 100);
        } else {
          // No coords — pass first 50 records back so the panel still shows something
          _infraData[infraKey] = records.slice(0, 50);
        }
        cb();
      });
    });
  }

  // Toronto Open Data dataset slugs. These are the package slugs used in URLs
  // like https://open.toronto.ca/dataset/<slug>/ — confirmable by the user.
  // If a slug is wrong, the error message in the UI will name it so you can fix it.
  // ── _queryTorontoWatermains — bundled local data ───────────────────────────
  // Reads from data/watermains.min.js (auto-loaded on first scan, ~5.4 MB).
  // Each bundled record: [assetId, diameterMm, material, installYear,
  //                       segments[][[lng,lat]...], [centroidLng, centroidLat]]
  // Output records match the format _infraPipesToFeatureCollection expects:
  //   {geometry:[[lng,lat],...], diameter, material, year, street, dist}
  function _filterWatermains(lng, lat, cb){
    var data = window._watermainsData;
    if(!data || !Array.isArray(data.records)){
      _infraData.watermain = {error:'watermains dataset failed to load'};
      cb(); return;
    }
    var radiusM = 600; // 600 m around site
    var hits = [];
    data.records.forEach(function(rec){
      // rec = [id, diam, mat, year, segments, centroid]
      var centroid = rec[5];
      if(!centroid) return;
      var d = _distM(lng, lat, centroid[0], centroid[1]);
      if(d > radiusM) return;
      // Use the longest segment as the pipe's representative geometry (most pipes
      // have only one segment). Skip pipes without valid geometry.
      var segments = rec[4];
      if(!Array.isArray(segments) || segments.length === 0) return;
      var bestSeg = segments[0];
      for(var s=1; s<segments.length; s++){
        if(segments[s].length > bestSeg.length) bestSeg = segments[s];
      }
      hits.push({
        geometry: bestSeg,
        diameter: rec[1],
        material: rec[2],
        year: rec[3],
        street: '',
        dist: Math.round(d),
        assetId: rec[0]
      });
    });
    hits.sort(function(a, b){ return a.dist - b.dist; });
    _infraData.watermain = hits.slice(0, 200);
    cb();
  }
  window._queryTorontoWatermains = function(lng, lat, streets, cb){
    if(window._watermainsData && Array.isArray(window._watermainsData.records)){
      _filterWatermains(lng, lat, cb);
      return;
    }
    var existing = document.querySelector('script[data-watermains-loader]');
    if(existing){
      var poll = setInterval(function(){
        if(window._watermainsData){ clearInterval(poll); _filterWatermains(lng, lat, cb); }
      }, 100);
      setTimeout(function(){
        clearInterval(poll);
        if(!window._watermainsData){
          _infraData.watermain = {error:'watermain data load timeout'};
          cb();
        }
      }, 30000); // generous timeout for 5.4 MB load
      return;
    }
    var s = document.createElement('script');
    s.setAttribute('data-watermains-loader','1');
    s.src = 'data/watermains.min.js';
    s.onload  = function(){ _filterWatermains(lng, lat, cb); };
    s.onerror = function(){
      _infraData.watermain = {error:'failed to load data/watermains.min.js — file missing'};
      cb();
    };
    document.head.appendChild(s);
  };
  // ── _queryTorontoSewers — bundled local data ───────────────────────────────
  // Reads from data/sewers.min.js (auto-loaded on first scan, ~16 MB).
  // Each bundled record: [assetId, diameterMm, material, installYear,
  //                       flowType (SAN/STM/CMB/CSO/FD/EO/UNK),
  //                       segments[][[lng,lat]...], [centroidLng, centroidLat]]
  // Run the proximity filter against any [id,diam,mat,year,flow,segments,centroid]
  // array. Pushes matches into the `hits` collector. Used for both the Toronto
  // dataset (window._sewersData) and the Mississauga storm dataset
  // (window._mississaugaStormData) — the schemas are identical, only the
  // geographic coverage differs.
  function _scanSewerRecords(records, lng, lat, radiusM, hits){
    if(!Array.isArray(records)) return;
    for(var i = 0; i < records.length; i++){
      var rec = records[i];
      var centroid = rec[6];
      if(!centroid) continue;
      var d = _distM(lng, lat, centroid[0], centroid[1]);
      if(d > radiusM) continue;
      var segments = rec[5];
      if(!Array.isArray(segments) || segments.length === 0) continue;
      var bestSeg = segments[0];
      for(var s = 1; s < segments.length; s++){
        if(segments[s].length > bestSeg.length) bestSeg = segments[s];
      }
      hits.push({
        geometry: bestSeg,
        diameter: rec[1],
        material: rec[2],
        year: rec[3],
        flowType: rec[4],   // SAN, STM, CMB, etc. — used by _classifySewerFlow
        street: '',
        dist: Math.round(d),
        assetId: rec[0]
      });
    }
  }
  function _filterSewers(lng, lat, cb){
    var torontoData = window._sewersData;
    var mississaugaStorm = window._mississaugaStormData;   // optional; may be undefined
    if((!torontoData || !Array.isArray(torontoData.records)) &&
       (!mississaugaStorm || !Array.isArray(mississaugaStorm.records))){
      _infraData.sewer = {error:'sewers dataset failed to load'};
      cb(); return;
    }
    var radiusM = 600;
    var hits = [];
    if(torontoData     && Array.isArray(torontoData.records))     _scanSewerRecords(torontoData.records,     lng, lat, radiusM, hits);
    if(mississaugaStorm && Array.isArray(mississaugaStorm.records)) _scanSewerRecords(mississaugaStorm.records, lng, lat, radiusM, hits);
    hits.sort(function(a, b){ return a.dist - b.dist; });
    _infraData.sewer = hits.slice(0, 200);
    cb();
  }
  window._queryTorontoSewers = function(lng, lat, streets, cb){
    if(window._sewersData && Array.isArray(window._sewersData.records)){
      _filterSewers(lng, lat, cb);
      return;
    }
    var existing = document.querySelector('script[data-sewers-loader]');
    if(existing){
      var poll = setInterval(function(){
        if(window._sewersData){ clearInterval(poll); _filterSewers(lng, lat, cb); }
      }, 100);
      setTimeout(function(){
        clearInterval(poll);
        if(!window._sewersData){
          _infraData.sewer = {error:'sewer data load timeout'};
          cb();
        }
      }, 60000); // generous — 16 MB load
      return;
    }
    var s = document.createElement('script');
    s.setAttribute('data-sewers-loader','1');
    s.src = 'data/sewers.min.js';
    s.onload  = function(){ _filterSewers(lng, lat, cb); };
    s.onerror = function(){
      // Toronto load failed — but if Mississauga storm data is loaded, still
      // surface those records via _filterSewers (which now reads either source).
      if(window._mississaugaStormData && Array.isArray(window._mississaugaStormData.records)){
        _filterSewers(lng, lat, cb);
      } else {
        _infraData.sewer = {error:'failed to load data/sewers.min.js — file missing'};
        cb();
      }
    };
    document.head.appendChild(s);
  };
  window._queryTorontoValves = function(lng, lat, cb){
    _ckanProximityQuery('water-valves', lng, lat, 500, 'valve', cb);
  };
  window._queryTorontoCatchbasins = function(lng, lat, cb){
    _ckanProximityQuery('catchbasin', lng, lat, 500, 'catchbasin', cb);
  };

  // OEB grid capacity — no public API exists. Stub with a clear message.
  window._queryOEBCapacity = function(lng, lat, cb){
    _infraData.electrical = {
      error: 'No public OEB grid-capacity API — request a Toronto Hydro Customer Connection Application for site-specific capacity confirmation.'
    };
    cb();
  };

  // ── scanInfrastructure orchestrator ────────────────────────────────────────
  window._infraData = window._infraData || { electrical:null, watermain:null, sewer:null, hydrant:null, valve:null, catchbasin:null };
  window.scanInfrastructure = function(){
    if(typeof P === 'undefined' || !P.siteCoords || !P.siteCoords.lng){
      var s = document.getElementById('infra-scan-status');
      if(s) s.innerHTML = '<span style="color:#ff4444">No site coordinates. Select a site on the map first.</span>';
      return;
    }
    var btn = document.getElementById('infra-scan-btn');
    if(btn){ btn.textContent = 'SCANNING...'; btn.disabled = true; }
    var statusEl = document.getElementById('infra-scan-status');
    if(statusEl) statusEl.innerHTML = '<span style="color:#AEBC46">Querying OEB + Toronto Open Data CKAN (via CORS proxies)…</span>';
    window._infraData = { electrical:null, watermain:null, sewer:null, hydrant:null, valve:null, catchbasin:null };

    var lng = P.siteCoords.lng, lat = P.siteCoords.lat;
    var completed = 0, total = 6;
    function checkDone(){
      completed++;
      if(completed >= total){
        if(btn){ btn.textContent = 'SCAN INFRASTRUCTURE'; btn.disabled = false; }
        _renderInfraResults();
        if(typeof _renderInfraOnMap === 'function'){ try { _renderInfraOnMap(); } catch(e){ console.warn('[infra] _renderInfraOnMap:', e); } }
        if(typeof _renderInfraOn3D === 'function'){ try { _renderInfraOn3D(); } catch(e){ console.warn('[infra] _renderInfraOn3D:', e); } }
        // Refresh the demand-estimate panels so MUNICIPAL SERVICING (water /
        // sanitary / electrical / gas), STORMWATER, and WATERMAIN CAPACITY
        // CHECK all reflect the latest project state and the freshly-scanned
        // pipe diameters. These are independent calculators — calling each
        // is cheap and idempotent.
        ['calcServicing','calcStormwater','calcWaterCapacity'].forEach(function(fn){
          if(typeof window[fn] === 'function'){
            try { window[fn](); }
            catch(e){ console.warn('[infra] ' + fn + ' refresh failed:', e); }
          }
        });
      }
    }
    function _safe(fnName, args){
      var fn = (typeof window !== 'undefined' && window[fnName]) || null;
      if(typeof fn === 'function'){
        try { fn.apply(null, args); }
        catch(e){ console.warn('[infra]', fnName, 'threw:', e); checkDone(); }
      } else { checkDone(); }
    }
    _safe('_queryOEBCapacity',        [lng, lat, checkDone]);
    _safe('_queryTorontoWatermains',  [lng, lat, [], checkDone]);
    _safe('_queryTorontoSewers',      [lng, lat, [], checkDone]);
    _safe('_queryTorontoHydrants',    [lng, lat, checkDone]);
    _safe('_queryTorontoValves',      [lng, lat, checkDone]);
    _safe('_queryTorontoCatchbasins', [lng, lat, checkDone]);
  };

  window._renderInfraResults = function(){
    var statusEl = document.getElementById('infra-scan-status');
    var resultsEl = document.getElementById('infra-scan-results');
    if(!resultsEl) return;
    resultsEl.style.display = 'block';
    var keys = ['electrical','watermain','sewer','hydrant','valve','catchbasin'];
    var labels = {
      electrical: 'OEB grid capacity',
      watermain:  'Watermains (CKAN)',
      sewer:      'Sewer mains (CKAN)',
      hydrant:    'Hydrants (bundled)',
      valve:      'Valves (CKAN)',
      catchbasin: 'Catchbasins (CKAN)'
    };
    var available = 0, errors = 0;
    keys.forEach(function(k){
      var v = window._infraData ? window._infraData[k] : null;
      if(Array.isArray(v) && v.length > 0) available++;
      else if(v && v.error) errors++;
    });
    if(statusEl){
      if(available === 0 && errors > 0){
        statusEl.innerHTML = '<span style="color:#ffaa44">Scan complete — ' + errors + ' query/queries errored. See details below.</span>';
      } else if(available === 0){
        statusEl.innerHTML = '<span style="color:#ffaa44">Scan complete — no data within range.</span>';
      } else {
        statusEl.innerHTML = '<span style="color:#AEBC46">Scan complete: ' + available + ' of 6 datasets returned data.</span>';
      }
    }
    var html = '<div style="font-size:12px;color:#888;line-height:1.7">';
    keys.forEach(function(k){
      var v = window._infraData ? window._infraData[k] : null;
      if(v == null){
        html += '<div>' + labels[k] + ': <span style="color:#888">no data</span></div>';
      } else if(v.error){
        html += '<div>' + labels[k] + ': <span style="color:#ff8866">' + v.error + '</span></div>';
      } else if(Array.isArray(v)){
        html += '<div>' + labels[k] + ': <span style="color:#AEBC46">' + v.length + ' features</span></div>';
      } else {
        html += '<div>' + labels[k] + ': <span style="color:#AEBC46">data loaded</span></div>';
      }
    });
    html += '</div>';
    resultsEl.innerHTML = html;
  };

  console.log('[infra-queries] CKAN+OEB helpers loaded.');


/* ── Live infrastructure match — injected into MUNICIPAL SERVICING ─────────
   After scanInfrastructure completes, append a panel showing the actual
   pipe diameters / hydrant proximity from the scan alongside the demand
   estimates. The panel is added to the existing #servicing-results div
   so users see both project demand and live infrastructure availability
   in one place. */
function _renderLiveInfraMatch(){
  var el = document.getElementById('servicing-results');
  if(!el) return;
  var data = window._infraData || {};
  var hasScan = (Array.isArray(data.watermain) && data.watermain.length > 0)
             || (Array.isArray(data.sewer)     && data.sewer.length     > 0)
             || (Array.isArray(data.hydrant)   && data.hydrant.length   > 0);
  // Remove previous match panel if any
  var prev = document.getElementById('live-infra-match');
  if(prev) prev.parentNode.removeChild(prev);

  var html = '<div id="live-infra-match" style="margin-top:10px;padding:8px;background:rgba(102,170,255,0.06);border:1px solid #66aaff30;border-radius:4px">';
  html += '<div style="font-size:13px;font-weight:700;color:#66aaff;margin-bottom:6px">LIVE INFRASTRUCTURE MATCH</div>';

  if(!hasScan){
    html += '<div style="font-size:12px;color:#aaa">Click <strong>SCAN INFRASTRUCTURE</strong> below to populate this with the nearest watermain, sewer, and hydrant — then this panel will pair your demand estimates against what is actually available at the curb.</div>';
  } else {
    // Estimate peak water demand from same formula as calcServicing
    var d = (typeof pfData === 'function') ? (pfData() || {}) : {};
    var totalUnits = d.totalUnits || 0;
    var commGFA   = d.commGFA   || 0;
    if(totalUnits === 0 && typeof P !== 'undefined' && P.vols){
      P.vols.forEach(function(v){
        if(v.use === 'residential' || v.use === 'mixed'){
          totalUnits += Math.floor((v.floors || 10) * ((v.width || 50) * (v.depth || 50)) * 0.85 / 750);
        }
      });
    }
    var totalWater = totalUnits * 300 + commGFA * 0.0929 * 75 / 100;
    var peakWater  = totalWater * 2.5;     // L/d
    var demandLps  = peakWater / 86400;

    if(Array.isArray(data.watermain) && data.watermain.length > 0){
      var nearestW = data.watermain[0];
      for(var iw = 1; iw < data.watermain.length; iw++){
        if((data.watermain[iw].dist || 9999) < (nearestW.dist || 9999)) nearestW = data.watermain[iw];
      }
      var diaMM   = parseFloat(nearestW.diameter) || 0;
      var areaM2  = Math.PI * Math.pow(diaMM / 2000, 2);
      var capLps  = areaM2 * 1.5 * 1000;
      var marginPct = capLps > 0 ? ((capLps - demandLps) / capLps * 100) : 0;
      var marginColor = marginPct < 0 ? '#ff4444' : marginPct < 30 ? '#ffaa44' : '#66ccaa';
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:4px"><strong style="color:#fff">Nearest watermain:</strong> ' + diaMM + ' mm ' + (nearestW.material || '') + ' at ' + (nearestW.dist || '?') + ' m';
      if(nearestW.year) html += ' (' + nearestW.year + ')';
      html += '</div>';
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:6px">Demand <span style="color:#fff">' + demandLps.toFixed(2) + ' L/s</span> vs. capacity ≈ <span style="color:#fff">' + capLps.toFixed(0) + ' L/s</span> · margin <span style="color:' + marginColor + ';font-weight:700">' + (marginPct >= 0 ? '+' : '') + marginPct.toFixed(0) + '%</span></div>';
    }
    if(Array.isArray(data.sewer) && data.sewer.length > 0){
      var nearestS = data.sewer[0];
      for(var is = 1; is < data.sewer.length; is++){
        if((data.sewer[is].dist || 9999) < (nearestS.dist || 9999)) nearestS = data.sewer[is];
      }
      var flowLabel = nearestS.flowType === 'SAN' ? 'sanitary' :
                      nearestS.flowType === 'STM' ? 'storm' :
                      nearestS.flowType === 'CMB' ? 'combined' :
                      (nearestS.flowType || 'unknown');
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:4px"><strong style="color:#fff">Nearest sewer:</strong> ' + (nearestS.diameter || '?') + ' mm ' + flowLabel + ' main at ' + (nearestS.dist || '?') + ' m' + (nearestS.material ? ' (' + nearestS.material + ')' : '') + '</div>';
    }
    if(Array.isArray(data.hydrant) && data.hydrant.length > 0){
      var nearestH = data.hydrant[0];
      for(var ih = 1; ih < data.hydrant.length; ih++){
        if((data.hydrant[ih].dist || 9999) < (nearestH.dist || 9999)) nearestH = data.hydrant[ih];
      }
      var hC = nearestH.dist <= 90 ? '#66ccaa' : nearestH.dist <= 150 ? '#ffaa44' : '#ff4444';
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:4px"><strong style="color:#fff">Nearest hydrant:</strong> <span style="color:' + hC + '">' + (nearestH.dist || '?') + ' m</span> · ' + data.hydrant.length + ' within 500 m</div>';
      html += '<div style="font-size:11px;color:#888">Toronto Fire Services typical max distance from building: 90 m (frontage) / 150 m (rear)</div>';
    }
  }
  html += '</div>';
  el.insertAdjacentHTML('beforeend', html);
}

/* Wrap calcServicing so the live-match panel appends after every render. */
(function(){
  var origCalcServicing = window.calcServicing;
  if(typeof origCalcServicing !== 'function'){
    /* calcServicing not yet defined when this script loads — wait. */
    var poll = setInterval(function(){
      if(typeof window.calcServicing === 'function'){
        clearInterval(poll);
        var orig = window.calcServicing;
        window.calcServicing = function(){
          orig.apply(this, arguments);
          try { _renderLiveInfraMatch(); } catch(e){ console.warn('[infra-match]', e); }
        };
      }
    }, 200);
    setTimeout(function(){ clearInterval(poll); }, 10000);
  } else {
    window.calcServicing = function(){
      origCalcServicing.apply(this, arguments);
      try { _renderLiveInfraMatch(); } catch(e){ console.warn('[infra-match]', e); }
    };
  }
})();

})();
