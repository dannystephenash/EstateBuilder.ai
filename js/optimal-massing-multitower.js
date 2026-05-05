// optimal-massing-multitower.js — Multi-tower master plan generator
// =============================================================================
// For lots >= ~50,000 sf (~1 acre) on tall-building zones (D, CC1-CC4, RA3-RA5),
// generates a realistic master plan with:
//   - Continuous podium spanning most of the lot (minus property setback)
//   - 2 to 4 separate residential towers on the podium
//   - 25 m tower separation (Toronto Tall Building Design Guidelines, also
//     the de facto Mississauga / GTHA standard)
//   - 750 m² typical floorplate cap per tower (Toronto guideline for
//     comfortable residential typology)
//   - 12.5 m setback from each property line for tower (separation/2)
//
// Auto-dispatches from generateOptimalMassing when conditions match. Falls back
// to single-volume massing for smaller / non-tall-building sites.
//
// References:
//   Toronto Tall Building Design Guidelines (2013) §3.2 (separation), §3.3 (floorplate)
//   Mississauga Downtown Core Local Area Plan §5.5 (built form)
// =============================================================================

(function(){
  'use strict';

  // Trigger thresholds
  var MIN_LOT_AREA_SF      = 50000;        // ~1 acre / 4,650 m²
  var TARGET_TOWER_PLATE_SF= 7500;         // ~700 m² per tower
  var TOWER_SEP_FT         = 82;           // 25 m between towers
  var TOWER_SETBACK_FT     = 41;           // 12.5 m from property line
  var PODIUM_SETBACK_FT    = 13;           // 4 m podium setback
  var PODIUM_STOREYS_DEFAULT = 6;
  var TOWER_STOREYS_FALLBACK = 25;

  // Convert local-feet polygon to lat/lng using current _gpsOrigin (matches
  // the _ftToGps used by optimal-massing.js so realignBuildingToLot can
  // re-derive customPolyLocal whenever the origin shifts).
  function _ftToGps(xFt, zFt){
    var P = (typeof window !== 'undefined') ? window.P : null;
    try { if(typeof P !== 'undefined') P = P || (typeof self !== 'undefined' ? self.P : null); } catch(e){}
    try { P = P || (typeof globalThis !== 'undefined' ? globalThis.P : null); } catch(e){}
    var p = (typeof window !== 'undefined' && window.P) ? window.P :
            (function(){ try { return (typeof P !== 'undefined') ? P : null; } catch(e){ return null; } })();
    if(!p || !p._gpsOrigin) return null;
    var oLat = p._gpsOrigin.lat, oLng = p._gpsOrigin.lng;
    var mPerDegLat = 110540;
    var mPerDegLng = 111320 * Math.cos(oLat * Math.PI / 180);
    return [oLng + (xFt * 0.3048) / mPerDegLng, oLat - (zFt * 0.3048) / mPerDegLat];
  }

  // Compute axis-aligned bounding box of a polygon
  function _bbox(poly){
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for(var i = 0; i < poly.length; i++){
      if(poly[i][0] < minX) minX = poly[i][0];
      if(poly[i][0] > maxX) maxX = poly[i][0];
      if(poly[i][1] < minZ) minZ = poly[i][1];
      if(poly[i][1] > maxZ) maxZ = poly[i][1];
    }
    return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, w: maxX - minX, d: maxZ - minZ };
  }

  // Build a closed rectangular polygon (deep-copied vertices)
  function _rectPoly(minX, minZ, maxX, maxZ){
    return [
      [minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ], [minX, minZ]
    ];
  }

  // Shoelace area
  function _polyAreaSF(poly){
    if(!poly || poly.length < 3) return 0;
    var a = 0;
    var n = (poly[0][0] === poly[poly.length-1][0] && poly[0][1] === poly[poly.length-1][1]) ? poly.length-1 : poly.length;
    for(var i = 0; i < n; i++){
      var j = (i + 1) % n;
      a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
    }
    return Math.abs(a / 2);
  }

  // Inset (centroid-shrink) for podium polygon following lot shape
  function _insetPoly(poly, insetFt){
    if(!poly || poly.length < 3) return poly;
    var n = (poly[0][0] === poly[poly.length-1][0] && poly[0][1] === poly[poly.length-1][1]) ? poly.length-1 : poly.length;
    var cx = 0, cz = 0;
    for(var i = 0; i < n; i++){ cx += poly[i][0]; cz += poly[i][1]; }
    cx /= n; cz /= n;
    var out = [];
    for(var k = 0; k < n; k++){
      var dx = poly[k][0] - cx, dz = poly[k][1] - cz;
      var dist = Math.sqrt(dx*dx + dz*dz);
      var sc = dist > 0.01 ? Math.max(0.3, (dist - insetFt) / dist) : 1;
      out.push([cx + dx*sc, cz + dz*sc]);
    }
    out.push([out[0][0], out[0][1]]);   // close
    return out;
  }

  /**
   * Decide whether multi-tower mode should fire for this lot.
   * Returns { fire: bool, reason: string, towerCount: 1|2|4 }
   */
  function shouldFireMultiTower(lotPoly, zoning){
    if(!lotPoly || lotPoly.length < 3) return { fire: false, reason: 'no lot polygon' };
    var lotArea = _polyAreaSF(lotPoly);
    if(lotArea < MIN_LOT_AREA_SF) return { fire: false, reason: 'lot too small (<50k sf)' };

    var bb = _bbox(lotPoly);
    // Need both dims at least 2 tower-widths + separation: 75' + 82' + 75' = 232' for 2-wide
    var canFit2Wide = bb.w >= 232;
    var canFit2Deep = bb.d >= 232;

    var maxStoreys = (zoning && zoning.maxStoreys) || 0;
    var fsiLimit = (zoning && zoning.fsiLimit) || 0;
    var supportsTall = (maxStoreys >= 12) || (fsiLimit >= 2.5);
    if(!supportsTall) return { fire: false, reason: 'zoning does not support tall buildings (need >=12 storeys or FSI >=2.5)' };

    var towerCount = (canFit2Wide && canFit2Deep) ? 4 :
                     (canFit2Wide || canFit2Deep) ? 2 : 1;
    if(towerCount === 1) return { fire: false, reason: 'lot too narrow for multi-tower separation' };

    return {
      fire: true,
      reason: 'lot area ' + Math.round(lotArea).toLocaleString() + ' sf, ' + towerCount + ' towers fit',
      towerCount: towerCount,
      lotArea: lotArea
    };
  }

  /**
   * Generate a multi-tower master plan and replace P.vols.
   *
   * @param {Array<[x,z]>} lotPoly - Lot polygon in local feet (closed ring or not)
   * @param {Object} zoning - Detected zoning result (fsiLimit, heightLimit, maxStoreys)
   * @param {Object} opts   - { towerCount, podiumStoreys, towerStoreys, hasCommGF }
   * @returns {Array} the volumes array (also assigned to P.vols)
   */
  window.generateMultiTowerMassing = function(lotPoly, zoning, opts){
    opts = opts || {};
    if(!Array.isArray(lotPoly) || lotPoly.length < 3) return null;
    if(typeof P === 'undefined' || !P) return null;

    var bb = _bbox(lotPoly);
    var towerCount = opts.towerCount || (function(){
      var f = shouldFireMultiTower(lotPoly, zoning);
      return f.fire ? f.towerCount : 1;
    })();
    if(towerCount < 2) return null;

    var podSt = opts.podiumStoreys || PODIUM_STOREYS_DEFAULT;
    var maxSt = (zoning && zoning.maxStoreys) || TOWER_STOREYS_FALLBACK;
    var twrSt = Math.max(8, Math.min(opts.towerStoreys || (maxSt - podSt), maxSt - podSt));
    var hasCommGF = (opts.hasCommGF === undefined) ? 1 : opts.hasCommGF;

    // Floor heights
    var gfH = 15, typH = 10;
    var podiumHeightFt = gfH + (podSt - 1) * typH;

    // ── Continuous podium (lot minus podium setback) ──
    var podiumPoly = _insetPoly(lotPoly, PODIUM_SETBACK_FT);
    var podiumPolyGps = podiumPoly.map(function(pt){ return _ftToGps(pt[0], pt[1]); });
    var podiumAreaSF = _polyAreaSF(podiumPoly);

    var vols = [];

    vols.push({
      name: 'Podium',
      storeys: podSt,
      startEg: 0,
      depth: Math.round(bb.d),
      width: Math.round(bb.w),
      offEast: 0, offWest: 0, angle: 0,
      podiumStoreys: podSt - 1,
      stepbackAmt: 0,
      gfHeight: 0,
      baseElevFt: 0,
      color: '#b8c4d0',
      commGF: hasCommGF,
      cladding: 'brick',
      windows: 1, winSpacing: 3,
      balconies: 0, balcEvery: 2, balcDepth: 4,
      balcN: 0, balcS: 0, balcE: 0, balcW: 0,
      storefrontN: hasCommGF, storefrontS: hasCommGF,
      storefrontE: 0, storefrontW: 0,
      customPolyLocal: podiumPoly,
      customPoly: podiumPolyGps,
      customAreaSF: Math.round(podiumAreaSF),
      // Relative-to-lot tag — recomputeRelativeVolumes() reads this each
      // rebuild and re-derives customPolyLocal from the CURRENT lot. Means
      // the volume always tracks the lot regardless of coordinate shifts.
      _relativeToLot: { type: 'lot-inset', insetFt: PODIUM_SETBACK_FT }
    });

    // ── Tower placement on a grid ──
    // Available area inside tower setbacks
    var availMinX = bb.minX + TOWER_SETBACK_FT;
    var availMaxX = bb.maxX - TOWER_SETBACK_FT;
    var availMinZ = bb.minZ + TOWER_SETBACK_FT;
    var availMaxZ = bb.maxZ - TOWER_SETBACK_FT;
    var availW = availMaxX - availMinX;
    var availD = availMaxZ - availMinZ;

    // Decide cols/rows from towerCount + lot proportions
    var cols, rows;
    if(towerCount === 4){ cols = 2; rows = 2; }
    else if(towerCount === 2){
      cols = (availW >= availD) ? 2 : 1;
      rows = cols === 2 ? 1 : 2;
    } else { cols = 1; rows = 1; }

    // Tower footprint sized to fit within grid cell with separation
    var cellW = (availW - (cols - 1) * TOWER_SEP_FT) / cols;
    var cellD = (availD - (rows - 1) * TOWER_SEP_FT) / rows;
    var towerW = Math.max(60, Math.min(cellW, Math.sqrt(TARGET_TOWER_PLATE_SF) * 1.1));   // a bit wider than square
    var towerD = Math.max(60, Math.min(cellD, TARGET_TOWER_PLATE_SF / towerW));

    // Centre the grid in the available area (so unused space is split as
    // open space front + back, not skewed to one side)
    var gridW = cols * towerW + (cols - 1) * TOWER_SEP_FT;
    var gridD = rows * towerD + (rows - 1) * TOWER_SEP_FT;
    var gridStartX = availMinX + (availW - gridW) / 2;
    var gridStartZ = availMinZ + (availD - gridD) / 2;

    var towerLetters = ['A', 'B', 'C', 'D'];
    var ti = 0;
    for(var r = 0; r < rows; r++){
      for(var c = 0; c < cols; c++){
        var tMinX = gridStartX + c * (towerW + TOWER_SEP_FT);
        var tMinZ = gridStartZ + r * (towerD + TOWER_SEP_FT);
        var tMaxX = tMinX + towerW;
        var tMaxZ = tMinZ + towerD;

        var towerPoly = _rectPoly(tMinX, tMinZ, tMaxX, tMaxZ);
        var towerPolyGps = towerPoly.map(function(pt){ return _ftToGps(pt[0], pt[1]); });
        var towerAreaSF = _polyAreaSF(towerPoly);

        vols.push({
          name: 'Tower ' + (towerLetters[ti] || ('T' + (ti + 1))),
          storeys: twrSt,
          startEg: 0,
          depth: Math.round(towerD),
          width: Math.round(towerW),
          offEast: 0, offWest: 0, angle: 0,
          podiumStoreys: 0,
          stepbackAmt: 0,
          gfHeight: 0,
          baseElevFt: podiumHeightFt,            // sits on the podium roofline
          color: '#c4b8a8',
          commGF: 0,
          cladding: 'curtainWall',
          windows: 1, winSpacing: 3,
          balconies: 1, balcEvery: 2, balcDepth: 4,
          balcN: 1, balcS: 1, balcE: 1, balcW: 1,
          storefrontN: 0, storefrontS: 0, storefrontE: 0, storefrontW: 0,
          customPolyLocal: towerPoly,
          customPoly: towerPolyGps,
          customAreaSF: Math.round(towerAreaSF),
          // Relative-to-lot tag — see recomputeRelativeVolumes()
          _relativeToLot: {
            type: 'grid-cell',
            row: r, col: c, rows: rows, cols: cols,
            towerW: towerW, towerD: towerD,
            sepFt: TOWER_SEP_FT, setbackFt: TOWER_SETBACK_FT
          }
        });
        ti++;
      }
    }

    P.vols = vols;
    P._optimalMassing = {
      volumes: vols,
      mode: 'multi-tower',
      towerCount: towerCount,
      podiumStoreys: podSt,
      towerStoreys: twrSt,
      towerSeparationFt: TOWER_SEP_FT
    };

    if(typeof console !== 'undefined' && console.log){
      console.log('[Multi-tower] Generated ' + towerCount + ' towers, ' + cols + 'x' + rows + ', tower=' +
                  Math.round(towerW) + 'x' + Math.round(towerD) + 'ft, ' + twrSt + ' storeys, podium=' +
                  Math.round(podiumAreaSF) + 'sf x ' + podSt + ' storeys');
    }

    if(typeof rebuildAll === 'function'){
      try { rebuildAll(); } catch(e){ console.warn('[Multi-tower] rebuildAll failed:', e); }
    }
    return vols;
  };

  window.shouldFireMultiTower = shouldFireMultiTower;

  window.recomputeRelativeVolumes = function(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return 0;
    if(typeof lotVerts !== 'function') return 0;
    var vts = lotVerts();
    if(!vts || vts.length < 3) return 0;
    var lotPoly = vts.map(function(v){ return [v[0], v[1]]; });
    if(lotPoly[0][0] !== lotPoly[lotPoly.length-1][0] ||
       lotPoly[0][1] !== lotPoly[lotPoly.length-1][1]){
      lotPoly.push([lotPoly[0][0], lotPoly[0][1]]);
    }
    var lbb = _bbox(lotPoly);
    var rebuilt = 0;
    P.vols.forEach(function(v){
      if(!v || !v._relativeToLot) return;
      var rel = v._relativeToLot;
      if(rel.type === 'lot-inset'){
        var poly = (rel.insetFt > 0) ? _insetPoly(lotPoly, rel.insetFt) : lotPoly.map(function(pt){ return [pt[0], pt[1]]; });
        v.customPolyLocal = poly;
        v.customAreaSF = Math.round(_polyAreaSF(poly));
        rebuilt++;
      } else if(rel.type === 'grid-cell'){
        var availMinX = lbb.minX + rel.setbackFt;
        var availMaxX = lbb.maxX - rel.setbackFt;
        var availMinZ = lbb.minZ + rel.setbackFt;
        var availMaxZ = lbb.maxZ - rel.setbackFt;
        var availW = availMaxX - availMinX;
        var availD = availMaxZ - availMinZ;
        var gridW = rel.cols * rel.towerW + (rel.cols - 1) * rel.sepFt;
        var gridD = rel.rows * rel.towerD + (rel.rows - 1) * rel.sepFt;
        var startX = availMinX + (availW - gridW) / 2;
        var startZ = availMinZ + (availD - gridD) / 2;
        var tMinX = startX + rel.col * (rel.towerW + rel.sepFt);
        var tMinZ = startZ + rel.row * (rel.towerD + rel.sepFt);
        var poly = _rectPoly(tMinX, tMinZ, tMinX + rel.towerW, tMinZ + rel.towerD);
        v.customPolyLocal = poly;
        v.customAreaSF = Math.round(rel.towerW * rel.towerD);
        rebuilt++;
      }
    });
    if(rebuilt > 0) console.log('[recomputeRelativeVolumes] re-anchored ' + rebuilt + ' volume(s) to current lot');
    return rebuilt;
  };

})();
