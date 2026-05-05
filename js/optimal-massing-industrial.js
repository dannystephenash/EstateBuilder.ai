// cache-buster: 20260506c
// optimal-massing-industrial.js — modern Class A bulk warehouse generator
// =============================================================================
// Inscribed-rectangle algorithm so the building always fits inside the actual
// lot polygon (not just its bounding box). Produces 1 warehouse + 1 office
// volume plus rich surface zones (truck court, dock apron, dock doors, trailer
// stripes, car parking, parking stripes).
// =============================================================================

(function(){
  'use strict';

  var INDUSTRIAL = {
    coverageRatio:        0.40,
    aspectRatio:          1.8,    // bumped 2.5→1.8 to match Hamilton reference (415k sf = ~750x553 ft, ratio ~1.4)
    officeFraction:       0.05,
    clearHeightFt:        40,
    warehouseTotalHtFt:   40,   // user request: total building height = 40 ft (clear ~36 ft + roof structure)
    officeStoreys:        2,
    officeStoreyHtFt:     18,   // user request: office max height = 40 ft (2 storeys × 18 + parapet)
    truckCourtDepthFt:   130,
    dockApronDepthFt:     15,
    dockDoorWidthFt:      10,
    dockDoorSpacingFt:    25,
    parkingStripDepthFt:  60,
    carStallWidthFt:       9,
    carStallDepthFt:      19,
    trailerStallWidthFt:  12,
    trailerStallDepthFt:  60,
    landscapeBufferFt:    10,    // 3 m / 10 ft minimum perimeter green buffer (per Toronto/Mississauga industrial zoning typical)
    defaultSetbacks: { front: 25, side: 15, rear: 20 }
  };

  function _polyArea(verts){
    if(!Array.isArray(verts) || verts.length < 3) return 0;
    var v = verts, n = v.length;
    if(v[0][0] === v[n-1][0] && v[0][1] === v[n-1][1]) n -= 1;
    var area = 0;
    for(var i = 0; i < n; i++){
      var j = (i + 1) % n;
      area += v[i][0] * v[j][1] - v[j][0] * v[i][1];
    }
    return Math.abs(area / 2);
  }

  function _bbox(verts){
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for(var i = 0; i < verts.length; i++){
      var v = verts[i];
      if(v[0] < minX) minX = v[0];
      if(v[0] > maxX) maxX = v[0];
      if(v[1] < minZ) minZ = v[1];
      if(v[1] > maxZ) maxZ = v[1];
    }
    return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ, w: maxX - minX, d: maxZ - minZ };
  }

  function _pointInPoly(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function _rectFitsInPoly(cx, cz, w, d, poly){
    var hw = w / 2, hd = d / 2;
    var samples = [
      [cx - hw, cz - hd], [cx + hw, cz - hd],
      [cx + hw, cz + hd], [cx - hw, cz + hd],
      [cx, cz - hd], [cx + hw, cz], [cx, cz + hd], [cx - hw, cz],
      [cx - hw / 2, cz - hd], [cx + hw / 2, cz - hd],
      [cx - hw / 2, cz + hd], [cx + hw / 2, cz + hd]
    ];
    for(var i = 0; i < samples.length; i++){
      if(!_pointInPoly(samples[i][0], samples[i][1], poly)) return false;
    }
    return true;
  }

  function _rectPoly(cx, cz, w, d){
    var hw = w / 2, hd = d / 2;
    return [
      [cx - hw, cz - hd], [cx + hw, cz - hd],
      [cx + hw, cz + hd], [cx - hw, cz + hd],
      [cx - hw, cz - hd]
    ];
  }

  function _findInscribedRect(lot, aspectRatio, maxArea){
    var bb = _bbox(lot);
    if(bb.w < 50 || bb.d < 50) return null;
    var step = Math.max(8, Math.min(bb.w, bb.d) / 24);
    var best = null;

    function _search(orientLongIsX){
      var ar = orientLongIsX ? aspectRatio : (1 / aspectRatio);
      for(var cx = bb.minX + step / 2; cx <= bb.maxX - step / 2; cx += step){
        for(var cz = bb.minZ + step / 2; cz <= bb.maxZ - step / 2; cz += step){
          if(!_pointInPoly(cx, cz, lot)) continue;
          var lo = 0, hi = Math.min(bb.w, bb.d);
          for(var iter = 0; iter < 18; iter++){
            var mid = (lo + hi) / 2;
            if(_rectFitsInPoly(cx, cz, ar * mid, mid, lot)){ lo = mid; } else { hi = mid; }
          }
          var d = lo;
          var w = ar * d;
          if(w * d > maxArea){
            d = Math.sqrt(maxArea / ar);
            w = ar * d;
            if(!_rectFitsInPoly(cx, cz, w, d, lot)) continue;
          }
          var area = w * d;
          if(area < 5000) continue;
          if(!best || area > best.area){
            best = { cx: cx, cz: cz, w: w, d: d, area: area, longAxisIsX: orientLongIsX };
          }
        }
      }
    }
    _search(true);
    _search(false);
    return best;
  }

  function _polyCentroid(poly){
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    var cx = 0, cz = 0;
    for(var i = 0; i < n; i++){ cx += poly[i][0]; cz += poly[i][1]; }
    return [cx / n, cz / n];
  }

  function _makeVol(label, kind, polyVerts, storeys, floorHt){
    var area = _polyArea(polyVerts);
    return {
      label: label,
      kind: kind,
      industrial: true,
      customPolyLocal: polyVerts,
      customAreaSF: area,
      storeys: storeys || 1,
      floorHt: floorHt || 12,
      gfHt: floorHt || 12,
      w: 0, d: 0,
      offEast: 0,
      startEg: 0
    };
  }

  window._industrialBuildSurfaceZones = function(wcx, wcz, ww, wd, longAxisIsX){ return _buildSurfaceZones(wcx, wcz, ww, wd, longAxisIsX); };
  function _buildSurfaceZones(wcx, wcz, ww, wd, longAxisIsX){
    var surfaces = [];
    var tcDepth = INDUSTRIAL.truckCourtDepthFt;
    var apronDepth = INDUSTRIAL.dockApronDepthFt;
    var pkDepth = INDUSTRIAL.parkingStripDepthFt;
    var truckCourt, dockApron, parkingLot;
    var dockDoorBays = [], trailerStalls = [], carStalls = [];

    if(longAxisIsX){
      var dockFaceZ = wcz + wd / 2;
      var tcCenterZ = dockFaceZ + tcDepth / 2;
      var apronCenterZ = dockFaceZ + apronDepth / 2;
      truckCourt = _rectPoly(wcx, tcCenterZ, ww + 30, tcDepth);
      dockApron = _rectPoly(wcx, apronCenterZ, ww + 4, apronDepth);
      var doorCount = Math.max(1, Math.floor((ww - 20) / INDUSTRIAL.dockDoorSpacingFt));
      var firstDoorX = wcx - (doorCount - 1) * INDUSTRIAL.dockDoorSpacingFt / 2;
      for(var di = 0; di < doorCount; di++){
        var doorX = firstDoorX + di * INDUSTRIAL.dockDoorSpacingFt;
        dockDoorBays.push(_rectPoly(doorX, apronCenterZ, INDUSTRIAL.dockDoorWidthFt, apronDepth - 1));
      }
      var trailerSpacing = INDUSTRIAL.trailerStallWidthFt + 2;
      var trailerCount = Math.max(1, Math.floor(ww / trailerSpacing));
      var firstTrailerX = wcx - (trailerCount - 1) * trailerSpacing / 2;
      for(var ti = 0; ti < trailerCount; ti++){
        var trailerX = firstTrailerX + ti * trailerSpacing;
        var trailerCenterZ = dockFaceZ + apronDepth + INDUSTRIAL.trailerStallDepthFt / 2;
        trailerStalls.push(_rectPoly(trailerX - INDUSTRIAL.trailerStallWidthFt / 2, trailerCenterZ, 0.5, INDUSTRIAL.trailerStallDepthFt));
        trailerStalls.push(_rectPoly(trailerX + INDUSTRIAL.trailerStallWidthFt / 2, trailerCenterZ, 0.5, INDUSTRIAL.trailerStallDepthFt));
      }
      var pkFaceZ = wcz - wd / 2;
      var pkCenterZ = pkFaceZ - pkDepth / 2;
      parkingLot = _rectPoly(wcx, pkCenterZ, ww + 30, pkDepth);
      var stallSpacing = INDUSTRIAL.carStallWidthFt;
      var stallCount = Math.max(1, Math.floor((ww + 20) / stallSpacing));
      var firstStallX = wcx - (stallCount - 1) * stallSpacing / 2;
      var rowOffset = INDUSTRIAL.carStallDepthFt / 2 + 12;
      [-rowOffset, rowOffset].forEach(function(rowDz){
        for(var si = 0; si < stallCount; si++){
          var stallX = firstStallX + si * stallSpacing;
          var stallCenterZ = pkCenterZ + rowDz;
          carStalls.push(_rectPoly(stallX - stallSpacing / 2, stallCenterZ, 0.4, INDUSTRIAL.carStallDepthFt));
        }
        carStalls.push(_rectPoly(firstStallX + stallCount * stallSpacing - stallSpacing / 2, pkCenterZ + rowDz, 0.4, INDUSTRIAL.carStallDepthFt));
      });
    } else {
      var dockFaceX = wcx + ww / 2;
      var tcCenterX = dockFaceX + tcDepth / 2;
      var apronCenterX = dockFaceX + apronDepth / 2;
      truckCourt = _rectPoly(tcCenterX, wcz, tcDepth, wd + 30);
      dockApron = _rectPoly(apronCenterX, wcz, apronDepth, wd + 4);
      var doorCount2 = Math.max(1, Math.floor((wd - 20) / INDUSTRIAL.dockDoorSpacingFt));
      var firstDoorZ = wcz - (doorCount2 - 1) * INDUSTRIAL.dockDoorSpacingFt / 2;
      for(var di2 = 0; di2 < doorCount2; di2++){
        var doorZ = firstDoorZ + di2 * INDUSTRIAL.dockDoorSpacingFt;
        dockDoorBays.push(_rectPoly(apronCenterX, doorZ, apronDepth - 1, INDUSTRIAL.dockDoorWidthFt));
      }
      var trailerSpacing2 = INDUSTRIAL.trailerStallWidthFt + 2;
      var trailerCount2 = Math.max(1, Math.floor(wd / trailerSpacing2));
      var firstTrailerZ = wcz - (trailerCount2 - 1) * trailerSpacing2 / 2;
      for(var ti2 = 0; ti2 < trailerCount2; ti2++){
        var trailerZ = firstTrailerZ + ti2 * trailerSpacing2;
        var trailerCenterX = dockFaceX + apronDepth + INDUSTRIAL.trailerStallDepthFt / 2;
        trailerStalls.push(_rectPoly(trailerCenterX, trailerZ - INDUSTRIAL.trailerStallWidthFt / 2, INDUSTRIAL.trailerStallDepthFt, 0.5));
        trailerStalls.push(_rectPoly(trailerCenterX, trailerZ + INDUSTRIAL.trailerStallWidthFt / 2, INDUSTRIAL.trailerStallDepthFt, 0.5));
      }
      var pkFaceX = wcx - ww / 2;
      var pkCenterX = pkFaceX - pkDepth / 2;
      parkingLot = _rectPoly(pkCenterX, wcz, pkDepth, wd + 30);
      var stallSpacing2 = INDUSTRIAL.carStallWidthFt;
      var stallCount2 = Math.max(1, Math.floor((wd + 20) / stallSpacing2));
      var firstStallZ = wcz - (stallCount2 - 1) * stallSpacing2 / 2;
      var rowOffset2 = INDUSTRIAL.carStallDepthFt / 2 + 12;
      [-rowOffset2, rowOffset2].forEach(function(rowDx){
        for(var si2 = 0; si2 < stallCount2; si2++){
          var stallZ = firstStallZ + si2 * stallSpacing2;
          var stallCenterX = pkCenterX + rowDx;
          carStalls.push(_rectPoly(stallCenterX, stallZ - stallSpacing2 / 2, INDUSTRIAL.carStallDepthFt, 0.4));
        }
        carStalls.push(_rectPoly(pkCenterX + rowDx, firstStallZ + stallCount2 * stallSpacing2 - stallSpacing2 / 2, INDUSTRIAL.carStallDepthFt, 0.4));
      });
    }

    surfaces.push({ type: 'truckCourt',  label: 'Truck Court (130 ft)', coords: truckCourt, color: 0x1c1c1c, opacity: 0.92 });
    surfaces.push({ type: 'parkingLot',  label: 'Car Parking',          coords: parkingLot, color: 0x3d3d3d, opacity: 0.88 });
    surfaces.push({ type: 'dockApron',   label: 'Dock Apron',           coords: dockApron,  color: 0x787878, opacity: 0.95 });
    dockDoorBays.forEach(function(d, i){ surfaces.push({ type: 'dockDoor', label: 'Dock Door ' + (i+1), coords: d, color: 0x141414, opacity: 1.0 }); });
    trailerStalls.forEach(function(s){ surfaces.push({ type: 'trailerStripe', label: 'Trailer stripe', coords: s, color: 0xf5d000, opacity: 1.0 }); });
    carStalls.forEach(function(s){ surfaces.push({ type: 'carStripe', label: 'Car stripe', coords: s, color: 0xf5f5f5, opacity: 0.9 }); });

    // ── DRIVEWAY ENTRIES from street to parking + truck court ──
    //    Two paved entries cut through the 10 ft landscape buffer so cars
    //    and trucks can actually access the site. Each entry extends 200 ft
    //    outward from the respective zone's outer edge — turf.intersect
    //    clips it to the lot polygon in _clipSurfacesAndAddLandscape, so
    //    only the portion that crosses the buffer is rendered. The clip
    //    pass also subtracts these entries from the landscape ring so the
    //    green buffer has visible gaps where the driveways are.
    var carDriveWidthFt = 32;     // ~2 lanes for cars
    var truckDriveWidthFt = 60;   // 2 lanes for tractor-trailers
    var driveProjectFt = 200;     // way out beyond the lot edge — clipped to lot
    var carDriveCx, carDriveCz, truckDriveCx, truckDriveCz, carDriveW, carDriveD, truckDriveW, truckDriveD;
    if(longAxisIsX){
      // Parking is at NORTH (low Z); driveway extends NORTH (decreasing Z)
      carDriveCx = wcx;
      carDriveCz = (wcz - wd / 2 - pkDepth) - driveProjectFt / 2;
      carDriveW = carDriveWidthFt; carDriveD = driveProjectFt;
      // Truck court is at SOUTH (high Z); driveway extends SOUTH
      truckDriveCx = wcx;
      truckDriveCz = (wcz + wd / 2 + tcDepth) + driveProjectFt / 2;
      truckDriveW = truckDriveWidthFt; truckDriveD = driveProjectFt;
    } else {
      // Parking is at WEST (low X); driveway extends WEST (decreasing X)
      carDriveCx = (wcx - ww / 2 - pkDepth) - driveProjectFt / 2;
      carDriveCz = wcz;
      carDriveW = driveProjectFt; carDriveD = carDriveWidthFt;
      // Truck court is at EAST (high X); driveway extends EAST
      truckDriveCx = (wcx + ww / 2 + tcDepth) + driveProjectFt / 2;
      truckDriveCz = wcz;
      truckDriveW = driveProjectFt; truckDriveD = truckDriveWidthFt;
    }
    surfaces.push({
      type: 'drivewayEntry',
      label: 'Car driveway entry',
      coords: _rectPoly(carDriveCx, carDriveCz, carDriveW, carDriveD),
      color: 0x484a4d,
      opacity: 0.92
    });
    surfaces.push({
      type: 'drivewayEntry',
      label: 'Truck driveway entry',
      coords: _rectPoly(truckDriveCx, truckDriveCz, truckDriveW, truckDriveD),
      color: 0x383a3d,
      opacity: 0.94
    });

    return surfaces;
  }

  window._omGenerateIndustrial = function(zoning, vts){
    if(!Array.isArray(vts) || vts.length < 3){ console.warn('[Industrial] insufficient lot vertices'); return; }
    var lot = vts.slice();
    if(lot[0][0] !== lot[lot.length-1][0] || lot[0][1] !== lot[lot.length-1][1]){
      lot.push([lot[0][0], lot[0][1]]);
    }
    var lotAreaSF = _polyArea(lot);
    var bb = _bbox(lot);
    if(bb.w < 100 || bb.d < 100){
      console.warn('[Industrial] lot too small');
      return;
    }
    var targetFootprint = lotAreaSF * INDUSTRIAL.coverageRatio;
    var ar = INDUSTRIAL.aspectRatio;

    // Shrink lot by truck-court + parking margins so the rectangle leaves room
    var insetTotal = INDUSTRIAL.truckCourtDepthFt + INDUSTRIAL.parkingStripDepthFt;
    var sideInset = INDUSTRIAL.landscapeBufferFt;
    var c = _polyCentroid(lot);
    var shrunkLot = lot.map(function(p){
      var avgInset = (insetTotal + sideInset) / 2;
      var dx = c[0] - p[0], dz = c[1] - p[1];
      var len = Math.sqrt(dx*dx + dz*dz);
      if(len < avgInset) return [c[0], c[1]];
      return [p[0] + (dx / len) * avgInset, p[1] + (dz / len) * avgInset];
    });

    var rect = _findInscribedRect(shrunkLot, ar, targetFootprint);
    if(!rect) rect = _findInscribedRect(lot, ar, targetFootprint);
    if(!rect){ console.warn('[Industrial] no inscribable rectangle'); return; }

    var bldgCx = rect.cx, bldgCz = rect.cz, bldgW = rect.w, bldgD = rect.d;
    var actualFootprint = bldgW * bldgD;
    var actualCoverage = actualFootprint / lotAreaSF;
    var longAxisIsX = rect.longAxisIsX;

    // ── ONE volume: warehouse covering the FULL inscribed rectangle ──
    //    Previously we created a separate Office volume (5 % slice on one
    //    end). Even with the post-hoc _absorb pass, cached projects + the
    //    residential glass-tower treatment kept rendering the office as a
    //    detached glassy cube. We now generate a single warehouse rectangle
    //    that is the full target footprint; office GFA is tracked as
    //    metadata on the warehouse vol so the pro-forma still has access
    //    to it without producing a separate visible volume.
    var wW = bldgW, wD = bldgD;
    var wCx = bldgCx, wCz = bldgCz;
    var officeAreaSF = actualFootprint * INDUSTRIAL.officeFraction;
    var officeGFA = officeAreaSF * INDUSTRIAL.officeStoreys;
    var warehouseVol = _makeVol('Warehouse', 'warehouse', _rectPoly(wCx, wCz, wW, wD), 1, INDUSTRIAL.warehouseTotalHtFt);
    warehouseVol.officeAreaSF = Math.round(officeAreaSF);
    warehouseVol.officeGFA = Math.round(officeGFA);
    warehouseVol.officeFraction = INDUSTRIAL.officeFraction;
    P.vols = [warehouseVol];
    P.industrialSurfaces = _buildSurfaceZones(wCx, wCz, wW, wD, longAxisIsX);

    var carStallCount = Math.round((actualFootprint * 0.8) / 1000);
    var dockCount = Math.round(actualFootprint / 10000);
    console.log(
      '[Industrial] Generated Class A bulk warehouse:\n' +
      '  Lot area: '            + Math.round(lotAreaSF).toLocaleString() + ' sf (polygon, not bbox)\n' +
      '  Building footprint: '  + Math.round(actualFootprint).toLocaleString() + ' sf (' + (actualCoverage * 100).toFixed(1) + '% coverage)\n' +
      '  Warehouse:           ' + Math.round(wW) + ' x ' + Math.round(wD) + ' ft @ ' + INDUSTRIAL.clearHeightFt + ' ft clear (single volume; office is metadata only)\n' +
      '  Office GFA (metadata):' + Math.round(officeGFA).toLocaleString() + ' sf (' + (INDUSTRIAL.officeFraction*100).toFixed(0) + '% × ' + INDUSTRIAL.officeStoreys + ' storeys)\n' +
      '  Long axis: '           + (longAxisIsX ? 'East-West' : 'North-South') + '\n' +
      '  Truck court: '         + INDUSTRIAL.truckCourtDepthFt + ' ft deep, ' + dockCount + ' dock doors\n' +
      '  Car parking: ~'        + carStallCount + ' stalls\n' +
      '  Surfaces: '            + P.industrialSurfaces.length + ' polygons rendered'
    );

    if(typeof rebuildAll === 'function'){
      try { rebuildAll(); } catch(e){ console.warn('[Industrial] rebuildAll failed:', e); }
    }
    if(typeof smShowToast === 'function'){
      smShowToast('Industrial: ' + Math.round(actualFootprint).toLocaleString() + ' sf @ ' + (actualCoverage * 100).toFixed(0) + '% coverage', '#AEBC46');
    }
  };

  // Post-render material override: warehouse gets flat tilt-up concrete.
  // Also kills any THREE.Line / THREE.LineSegments / wireframe child whose
  // XZ footprint sits inside the warehouse polygon — these are residential
  // renderer artifacts (curtain-wall mullions, edge wireframes, podium
  // outlines) that have no place on a tilt-up bulk warehouse.
  var _tiltUpMat = null;
  function _industrialPostRender(){
    try {
      if(typeof groups === 'undefined' || !groups || !groups.building) return;
      if(typeof THREE === 'undefined') return;
      if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
      var whIdx = {};
      var wh = null;
      P.vols.forEach(function(v, i){
        if(v && v.kind === 'warehouse'){ whIdx[i] = true; if(!wh) wh = v; }
      });
      if(Object.keys(whIdx).length === 0) return;
      // IMP (insulated metal panel) — white/silver default; user-changeable via
      // the cladding colour picker. Sync the colour on every rebuild so the
      // slider's last value sticks to existing material instances too.
      var __imp = (typeof window !== 'undefined' && window._industrialCladdingHex) ? window._industrialCladdingHex : '#eef0f2';
      var __impInt = (function(s){
        s = (s || '').replace('#','');
        if(s.length === 3) s = s.split('').map(function(c){ return c+c; }).join('');
        var n = parseInt(s, 16);
        return isFinite(n) ? n : 0xeef0f2;
      })(__imp);
      if(!_tiltUpMat){
        _tiltUpMat = new THREE.MeshStandardMaterial({
          color: __impInt, roughness: 0.42, metalness: 0.32, side: THREE.DoubleSide
        });
      } else {
        try { _tiltUpMat.color.setHex(__impInt); } catch(e){}
      }

      // ── Compute warehouse XZ bounding box in world meters. The previous
      //    version of this function referenced minXm/maxXm/minZm/maxZm and a
      //    bare `wh` variable as if they were closure variables — they
      //    weren't, so every line below the bbox check threw ReferenceError
      //    silently inside the outer try/catch and the wireframe-kill never
      //    ran. That's why thin dark mullion lines remained on the warehouse
      //    in screenshots even after generation.
      var FT = 0.3048;
      var minXm = Infinity, maxXm = -Infinity, minZm = Infinity, maxZm = -Infinity;
      if(wh && Array.isArray(wh.customPolyLocal)){
        wh.customPolyLocal.forEach(function(pt){
          var xm = pt[0] * FT, zm = pt[1] * FT;
          if(xm < minXm) minXm = xm; if(xm > maxXm) maxXm = xm;
          if(zm < minZm) minZm = zm; if(zm > maxZm) maxZm = zm;
        });
      }
      var hasBbox = isFinite(minXm) && isFinite(maxXm) && isFinite(minZm) && isFinite(maxZm);
      var whHeightM = wh ? ((wh.gfHt || wh.floorHt || 40) * FT) : 12.2;

      // Collect victims first (can't mutate parent during traverse)
      var toDelete = [];
      groups.building.traverse(function(obj){
        if(!obj) return;
        if(obj === groups.building) return;

        // Lines / line segments / points anywhere in the warehouse footprint
        // — terrace dashed outlines, mullion wireframes, podium edge rings.
        if(obj.isLine || obj.isLineSegments || obj.isPoints){
          if(!hasBbox){ toDelete.push(obj); return; }
          try {
            var bx = new THREE.Box3().setFromObject(obj);
            var bcx = (bx.min.x + bx.max.x) / 2;
            var bcz = (bx.min.z + bx.max.z) / 2;
            if(bcx >= minXm - 6 && bcx <= maxXm + 6 && bcz >= minZm - 6 && bcz <= maxZm + 6){
              toDelete.push(obj);
            }
          } catch(_eL){ toDelete.push(obj); }
          return;
        }
        if(!obj.isMesh) return;

        // Residential decoration heuristics — if any of these match AND the
        // mesh sits inside the warehouse footprint, delete it. We delete
        // (not just hide) because the residential renderer re-creates them
        // on every rebuildAll; toggling .visible would just leave them and
        // they'd still affect bbox/raycasts.
        var bcxM = 0, bczM = 0, topY = 0;
        try {
          var bbm = new THREE.Box3().setFromObject(obj);
          bcxM = (bbm.min.x + bbm.max.x) / 2;
          bczM = (bbm.min.z + bbm.max.z) / 2;
          topY = bbm.max.y;
        } catch(__e){ return; }
        var insideXZ = !hasBbox || (
          bcxM >= minXm - 2 && bcxM <= maxXm + 2 &&
          bczM >= minZm - 2 && bczM <= maxZm + 2
        );
        if(!insideXZ) return;

        // 1) Anything taller than the warehouse cap that sits over the
        //    warehouse — parapets, planters on terrace, mullions, glass tower
        //    walls extending above 40 ft.
        if(hasBbox && topY > whHeightM + 0.5){
          toDelete.push(obj);
          return;
        }

        // 2) Glass-railing-shaped boxes (residential terrace railings):
        //    BoxGeometry (bw-0.2, 1.07, 0.02) — one face under 5 cm thick,
        //    height roughly 1 m, the other face >> 1 m. Look at param dims.
        try {
          if(obj.geometry && obj.geometry.type === 'BoxGeometry' && obj.geometry.parameters){
            var pp = obj.geometry.parameters;
            var thinX = pp.width  < 0.10;
            var thinZ = pp.depth  < 0.10;
            var slabY = pp.height > 0.5 && pp.height < 1.5;
            if(slabY && (thinX || thinZ)){
              toDelete.push(obj);
              return;
            }
            // Planter-shaped boxes (5×1.8×~2): also doesn't belong here.
            if(pp.width > 3 && pp.width < 7 && pp.height > 1 && pp.height < 3 && pp.depth > 1 && pp.depth < 3){
              toDelete.push(obj);
              return;
            }
          }
          // Sphere = shrub on terrace.
          if(obj.geometry && obj.geometry.type === 'SphereGeometry' && hasBbox){
            toDelete.push(obj);
            return;
          }
        } catch(__e){}

        // 3) Apply tilt-up material to legitimate warehouse meshes.
        var vi = -1;
        if(typeof getVolIdxFromMesh === 'function'){
          try { vi = getVolIdxFromMesh(obj); } catch(e){}
        }
        if(vi < 0 && obj.userData && typeof obj.userData.volIdx === 'number'){ vi = obj.userData.volIdx; }
        if(vi < 0 || !whIdx[vi]) return;
        if(obj.material && obj.material.transparent) return;
        try { obj.material = _tiltUpMat; } catch(e){}
      });

      // Detach victims from their parents so they can be GC'd and don't
      // interfere with raycasts / bounds / future traversals.
      toDelete.forEach(function(obj){
        try {
          if(obj.parent) obj.parent.remove(obj);
          if(obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
          if(obj.material){
            if(Array.isArray(obj.material)) obj.material.forEach(function(m){ if(m && m.dispose) m.dispose(); });
            else if(obj.material.dispose) obj.material.dispose();
          }
        } catch(_eD){}
      });
    } catch(e){ console.warn('[Industrial post-render] error:', e && e.message); }
  }

  // Register as postRebuild hook (synchronous after rebuild). Migrated
  // from rebuildAll wrapper to hook registry. Priority 50 = mid-range; the
  // hook runs after rebuild completes but before the postRender timers.
  function _registerPostRender(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerPostRender, 50);
      return;
    }
    window.registerRebuildHook('postRebuild', 'industrialPostRender',
      function(){ try { _industrialPostRender(); } catch(e){} }, 50);
  }
  _registerPostRender();

  // ── Coverage slider hook ───────────────────────────────────────────────
  // Exposes INDUSTRIAL.coverageRatio to the side-panel slider. The slider
  // sends an integer percentage (e.g. 40) and we re-run the optimal-massing
  // generator with the updated ratio so the user sees the building grow /
  // shrink immediately. Range is clamped to 20–60 % which spans Class A
  // bulk warehouse through small-format light industrial.
  if(typeof window !== 'undefined'){
    window.getIndustrialCoverage = function(){
      return Math.round((INDUSTRIAL.coverageRatio || 0.4) * 100);
    };
    window.setIndustrialCoverage = function(pct){
      var v = Number(pct);
      if(!isFinite(v)) return;
      v = Math.max(20, Math.min(60, Math.round(v)));
      INDUSTRIAL.coverageRatio = v / 100;
      // Sync DOM
      var sl = document.getElementById('industrial-coverage-slider');
      if(sl && Number(sl.value) !== v) sl.value = v;
      var lbl = document.getElementById('industrial-coverage-val');
      if(lbl) lbl.textContent = v + '%';
      // Re-run the generator only if a lot exists. lotVerts is required.
      try {
        if(typeof lotVerts !== 'function') return;
        var vts = lotVerts();
        if(!Array.isArray(vts) || vts.length < 3) return;
        if(typeof window._omGenerateIndustrial === 'function'){
          window._omGenerateIndustrial(P.zoning || null, vts);
        }
      } catch(e){ console.warn('[Industrial coverage slider] regen failed:', e && e.message); }
    };

    // ── Building height (clear + parapet) ────────────────────────────────
    window.getIndustrialHeight = function(){
      return Math.round(INDUSTRIAL.warehouseTotalHtFt || 40);
    };
    window.setIndustrialHeight = function(ft){
      var v = Number(ft);
      if(!isFinite(v)) return;
      v = Math.max(28, Math.min(60, Math.round(v)));   // 28–60 ft total
      INDUSTRIAL.warehouseTotalHtFt = v;
      INDUSTRIAL.clearHeightFt = Math.max(20, v - 4);  // parapet ~4 ft
      var sl = document.getElementById('industrial-height-slider');
      if(sl && Number(sl.value) !== v) sl.value = v;
      var lbl = document.getElementById('industrial-height-val');
      if(lbl) lbl.textContent = v + ' ft';
      // Update the warehouse vol's height and rebuild — does not need a full
      // regenerate (footprint is unchanged), just a rebuild.
      if(typeof P !== 'undefined' && P && Array.isArray(P.vols)){
        P.vols.forEach(function(v0){
          if(v0 && (v0.kind === 'warehouse' || v0.industrial)){
            v0.gfHt = v0.floorHt = v;
          }
        });
      }
      try { if(typeof rebuildAll === 'function') rebuildAll(); } catch(e){}
      try { if(typeof autoSave === 'function') autoSave(); } catch(e){}
    };

    // ── Cladding (IMP) colour picker ─────────────────────────────────────
    window.getIndustrialCladdingColor = function(){
      return window._industrialCladdingHex || '#eef0f2';
    };
    window.setIndustrialCladdingColor = function(hex){
      if(typeof hex !== 'string' || !/^#?[0-9a-fA-F]{3,6}$/.test(hex)) return;
      if(hex.charAt(0) !== '#') hex = '#' + hex;
      window._industrialCladdingHex = hex;
      var pick = document.getElementById('industrial-cladding-color');
      if(pick && pick.value.toLowerCase() !== hex.toLowerCase()){ pick.value = hex; }
      var swatch = document.getElementById('industrial-cladding-swatch-label');
      if(swatch) swatch.textContent = hex.toUpperCase();
      try { if(typeof rebuildAll === 'function') rebuildAll(); } catch(e){}
    };
  }

})();

// ═══════════════════════════════════════════════════════════
//  COVERAGE SLIDER VISIBILITY
//  Show #sec-ind-coverage in the Site Plan side panel only when the user
//  has the asset class set to industrial. Listens to changes on the
//  asset-class <select> and also runs once on DOMContentLoaded so a
//  refreshed industrial project sees the slider immediately.
// ═══════════════════════════════════════════════════════════
(function(){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(window._industrialCoverageSliderInstalled) return;
  window._industrialCoverageSliderInstalled = true;

  function _isIndustrial(){
    var sel = document.getElementById('project-type-select');
    return !!(sel && sel.value === 'industrial');
  }
  function _syncVisibility(){
    var sec = document.getElementById('sec-ind-coverage');
    if(!sec) return;
    sec.style.display = _isIndustrial() ? '' : 'none';
    if(!_isIndustrial()) return;
    // Reflect coverage % back into the slider.
    if(typeof window.getIndustrialCoverage === 'function'){
      var pct = window.getIndustrialCoverage();
      var sl = document.getElementById('industrial-coverage-slider');
      var lbl = document.getElementById('industrial-coverage-val');
      if(sl && Number(sl.value) !== pct) sl.value = pct;
      if(lbl) lbl.textContent = pct + '%';
    }
    // Reflect height (ft) back into the slider.
    if(typeof window.getIndustrialHeight === 'function'){
      var ft = window.getIndustrialHeight();
      var sl2 = document.getElementById('industrial-height-slider');
      var lbl2 = document.getElementById('industrial-height-val');
      if(sl2 && Number(sl2.value) !== ft) sl2.value = ft;
      if(lbl2) lbl2.textContent = ft + ' ft';
    }
    // Reflect cladding hex back into the colour picker.
    if(typeof window.getIndustrialCladdingColor === 'function'){
      var hex = window.getIndustrialCladdingColor();
      var pick = document.getElementById('industrial-cladding-color');
      var swl = document.getElementById('industrial-cladding-swatch-label');
      if(pick && pick.value.toLowerCase() !== hex.toLowerCase()) pick.value = hex;
      if(swl) swl.textContent = hex.toUpperCase();
    }
  }

  function _attachListener(){
    var sel = document.getElementById('project-type-select');
    if(!sel){ setTimeout(_attachListener, 200); return; }
    if(sel._industrialCoverageBound) return;
    sel._industrialCoverageBound = true;
    sel.addEventListener('change', _syncVisibility);
    _syncVisibility();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_attachListener, 100); });
  } else {
    setTimeout(_attachListener, 100);
  }
  window._syncIndustrialCoverageVisibility = _syncVisibility;
})();

// ═══════════════════════════════════════════════════════════
//  INDUSTRIAL MOVE / REPOSITION
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';

  function _shiftPoly(poly, dx, dz){
    return poly.map(function(p){ return [p[0] + dx, p[1] + dz]; });
  }

  function _polyEscapesLot(poly){
    if(typeof lotVerts !== 'function') return false;
    var lot = lotVerts();
    if(!Array.isArray(lot) || lot.length < 3) return false;
    function _pip(px, pz){
      var inside = false;
      for(var i = 0, j = lot.length - 1; i < lot.length; j = i++){
        var xi = lot[i][0], zi = lot[i][1], xj = lot[j][0], zj = lot[j][1];
        var hit = ((zi > pz) !== (zj > pz)) &&
                  (px < (xj - xi) * (pz - zi) / ((zj - zi) || 1e-9) + xi);
        if(hit) inside = !inside;
      }
      return inside;
    }
    for(var k = 0; k < poly.length; k++){
      if(!_pip(poly[k][0], poly[k][1])) return true;
    }
    return false;
  }

  window.moveIndustrialBuilding = function(dxFt, dzFt){
    if(typeof P === 'undefined' || !P) return null;
    if(!Array.isArray(P.vols) || P.vols.length === 0) return null;
    dxFt = (typeof dxFt === 'number') ? dxFt : 0;
    dzFt = (typeof dzFt === 'number') ? dzFt : 0;
    if(dxFt === 0 && dzFt === 0) return { appliedDx: 0, appliedDz: 0, clamped: false };

    var snapVols = P.vols.map(function(v){
      return v && v.customPolyLocal ? v.customPolyLocal.map(function(p){ return [p[0], p[1]]; }) : null;
    });
    var snapSurfs = (P.industrialSurfaces || []).map(function(s){
      return s && s.coords ? s.coords.map(function(p){ return [p[0], p[1]]; }) : null;
    });

    P.vols.forEach(function(v){
      if(v && Array.isArray(v.customPolyLocal)) v.customPolyLocal = _shiftPoly(v.customPolyLocal, dxFt, dzFt);
    });
    if(Array.isArray(P.industrialSurfaces)){
      P.industrialSurfaces.forEach(function(s){
        if(s && Array.isArray(s.coords)) s.coords = _shiftPoly(s.coords, dxFt, dzFt);
      });
    }

    var clamped = false;
    var anyEscaped = P.vols.some(function(v){
      return v && v.customPolyLocal && _polyEscapesLot(v.customPolyLocal);
    });
    if(anyEscaped){
      var lo = 0, hi = 1;
      for(var iter = 0; iter < 12; iter++){
        var mid = (lo + hi) / 2;
        P.vols.forEach(function(v, i){
          if(snapVols[i]) v.customPolyLocal = snapVols[i].map(function(p){ return [p[0] + dxFt * mid, p[1] + dzFt * mid]; });
        });
        var stillEscapes = P.vols.some(function(v){
          return v && v.customPolyLocal && _polyEscapesLot(v.customPolyLocal);
        });
        if(stillEscapes){ hi = mid; } else { lo = mid; }
      }
      var frac = lo;
      P.vols.forEach(function(v, i){
        if(snapVols[i]) v.customPolyLocal = snapVols[i].map(function(p){ return [p[0] + dxFt * frac, p[1] + dzFt * frac]; });
      });
      if(Array.isArray(P.industrialSurfaces)){
        P.industrialSurfaces.forEach(function(s, i){
          if(snapSurfs[i]) s.coords = snapSurfs[i].map(function(p){ return [p[0] + dxFt * frac, p[1] + dzFt * frac]; });
        });
      }
      dxFt = dxFt * frac;
      dzFt = dzFt * frac;
      clamped = true;
    }

    if(typeof rebuildAll === 'function'){
      try { rebuildAll(); } catch(e){}
    }
    return { appliedDx: dxFt, appliedDz: dzFt, clamped: clamped };
  };

  window.nudgeIndustrial = function(dir, stepFt){
    var s = (typeof stepFt === 'number' && stepFt > 0) ? stepFt : 25;
    var d = String(dir || '').toUpperCase();
    if(d === 'N' || d === 'NORTH') return window.moveIndustrialBuilding(0, -s);
    if(d === 'S' || d === 'SOUTH') return window.moveIndustrialBuilding(0,  s);
    if(d === 'E' || d === 'EAST')  return window.moveIndustrialBuilding( s, 0);
    if(d === 'W' || d === 'WEST')  return window.moveIndustrialBuilding(-s, 0);
    return null;
  };

  window.recentreIndustrial = function(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols) || P.vols.length === 0) return null;
    if(typeof lotVerts !== 'function') return null;
    var lot = lotVerts();
    if(!Array.isArray(lot) || lot.length < 3) return null;
    var lcx = 0, lcz = 0;
    lot.forEach(function(p){ lcx += p[0]; lcz += p[1]; });
    lcx /= lot.length; lcz /= lot.length;
    var bcx = 0, bcz = 0, n = 0;
    P.vols.forEach(function(v){
      if(!v || !v.customPolyLocal) return;
      v.customPolyLocal.slice(0, -1).forEach(function(p){ bcx += p[0]; bcz += p[1]; n++; });
    });
    if(n === 0) return null;
    bcx /= n; bcz /= n;
    return window.moveIndustrialBuilding(lcx - bcx, lcz - bcz);
  };

  function _ensureMovePanel(){
    if(typeof document === 'undefined') return null;
    var panel = document.getElementById('industrial-move-panel');
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'industrial-move-panel';
    panel.style.cssText = 'position:fixed;top:90px;right:24px;z-index:9000;background:rgba(20,22,28,0.92);border:1px solid #3a5a8a;border-radius:8px;padding:10px 12px;font:11px Outfit,system-ui,sans-serif;color:#ddd;box-shadow:0 4px 16px rgba(0,0,0,0.6);display:none';
    panel.innerHTML =
      '<div style="font-size:10px;letter-spacing:1.5px;color:#AEBC46;font-weight:700;text-align:center;margin-bottom:6px">MOVE BUILDING</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3, 32px);grid-gap:4px;justify-content:center">' +
      '<div></div><button data-dir="N" style="padding:6px;background:#222;border:1px solid #444;color:#ddd;border-radius:4px;cursor:pointer;font-size:13px">^</button><div></div>' +
      '<button data-dir="W" style="padding:6px;background:#222;border:1px solid #444;color:#ddd;border-radius:4px;cursor:pointer;font-size:13px">&lt;</button>' +
      '<button data-act="recentre" title="Recentre" style="padding:6px;background:#2a3a4a;border:1px solid #3a5a8a;color:#AEBC46;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700">[]</button>' +
      '<button data-dir="E" style="padding:6px;background:#222;border:1px solid #444;color:#ddd;border-radius:4px;cursor:pointer;font-size:13px">&gt;</button>' +
      '<div></div><button data-dir="S" style="padding:6px;background:#222;border:1px solid #444;color:#ddd;border-radius:4px;cursor:pointer;font-size:13px">v</button><div></div></div>' +
      '<div style="margin-top:6px;text-align:center;font-size:11px;color:#666">step: <select id="industrial-move-step" style="background:#1a1a1a;color:#ddd;border:1px solid #444;font-size:11px;padding:2px 4px;border-radius:3px">' +
      '<option value="10">10 ft</option><option value="25" selected>25 ft</option><option value="50">50 ft</option><option value="100">100 ft</option></select></div>';
    document.body.appendChild(panel);
    panel.addEventListener('click', function(e){
      var t = e.target;
      if(!t || !t.dataset) return;
      var step = parseFloat((document.getElementById('industrial-move-step') || {}).value || 25);
      if(t.dataset.dir){ window.nudgeIndustrial(t.dataset.dir, step); }
      else if(t.dataset.act === 'recentre'){ window.recentreIndustrial(); }
    });
    return panel;
  }

  window._industrialMovePanelSync = function(){
    var panel = _ensureMovePanel();
    if(!panel) return;
    var hasIndustrial = typeof P !== 'undefined' && P && Array.isArray(P.industrialSurfaces) && P.industrialSurfaces.length > 0;
    panel.style.display = hasIndustrial ? 'block' : 'none';
  };

  if(typeof document !== 'undefined'){
    if(document.readyState === 'complete' || document.readyState === 'interactive'){
      setTimeout(window._industrialMovePanelSync, 0);
    } else {
      document.addEventListener('DOMContentLoaded', window._industrialMovePanelSync);
    }
  }
  if(typeof window !== 'undefined'){
    var _origRA2 = window.rebuildAll;
    if(typeof _origRA2 === 'function'){
      window.rebuildAll = function(){
        var r = _origRA2.apply(this, arguments);
        try { window._industrialMovePanelSync(); } catch(e){}
        return r;
      };
    }
  }

})();


// ═══════════════════════════════════════════════════════════
//  AGGRESSIVE INDUSTRIAL PAINT JOB
//  The earlier _industrialPostRender used getVolIdxFromMesh / userData.volIdx
//  to identify warehouse meshes — neither was being set by the renderer, so
//  the override silently no-op'd. This version uses world-space bbox matching:
//  walk every mesh in groups.building, compute its bounding-box centre, and
//  paint it tilt-up concrete if the centre falls inside the warehouse polygon.
//  Also adds 3D dock-door planes on the dock face and a flat white roof.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';

  var _tiltUpMat = null;
  var _whiteRoofMat = null;
  var _dockDoorMat = null;
  var _rtuMat = null;
  var _industrialDecorGroup = null;

  function _ftToM(ft){ return ft * 0.3048; }
  function _bboxOf(poly){
    var minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for(var i=0; i<poly.length; i++){
      var p = poly[i];
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    }
    return { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ };
  }

  function _paintWarehouseIndustrial(){
    try {
      if(typeof groups === 'undefined' || !groups) return;
      if(typeof scene === 'undefined' || !scene) return;
      if(typeof THREE === 'undefined') return;
      if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;

      var wh = null;
      for(var i=0; i<P.vols.length; i++){
        if(P.vols[i] && P.vols[i].kind === 'warehouse'){ wh = P.vols[i]; break; }
      }
      if(!wh || !wh.customPolyLocal) return;

      var bb = _bboxOf(wh.customPolyLocal);
      var minXm = _ftToM(bb.minX - 1), maxXm = _ftToM(bb.maxX + 1);
      var minZm = _ftToM(bb.minZ - 1), maxZm = _ftToM(bb.maxZ + 1);

      if(!_tiltUpMat){
        _tiltUpMat = new THREE.MeshStandardMaterial({
          color: 0xe2ddd2, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide
        });
      }
      if(!_whiteRoofMat){
        _whiteRoofMat = new THREE.MeshStandardMaterial({
          color: 0xf2f0eb, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide
        });
      }
      if(!_dockDoorMat){
        _dockDoorMat = new THREE.MeshStandardMaterial({
          color: 0x2a2a2a, roughness: 0.7, metalness: 0.15, side: THREE.DoubleSide
        });
      }
      if(!_rtuMat){
        _rtuMat = new THREE.MeshStandardMaterial({
          color: 0xa8a8a8, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide
        });
      }

      // ── 1) Override existing renderer's warehouse meshes with tilt-up ───────
      var overridden = 0;
      if(groups.building){
        groups.building.traverse(function(obj){
          if(!obj || !obj.isMesh) return;
          if(obj.userData && obj.userData._industrialPaintGen === wh) return;
          var box = new THREE.Box3().setFromObject(obj);
          var center = new THREE.Vector3();
          box.getCenter(center);
          if(center.x < minXm || center.x > maxXm) return;
          if(center.z < minZm || center.z > maxZm) return;
          if(obj.material && obj.material.transparent) return;
          try {
            // Top of mesh ≈ y close to building total height → use white-roof material
            var top = box.max.y;
            var heightM = wh.storeys * (wh.floorHt || 44) * 0.3048;
            if(top >= heightM * 0.9){
              // Roof-level mesh: paint white
              obj.material = _whiteRoofMat;
            } else {
              // Wall-level mesh: paint tilt-up concrete
              obj.material = _tiltUpMat;
            }
            if(!obj.userData) obj.userData = {};
            obj.userData._industrialPaintGen = wh;
            overridden++;
          } catch(e){}
        });
      }

      // ── 2) Add custom industrial decor (dock doors + RTUs) in our own group ─
      if(typeof clearGroup === 'function'){
        clearGroup('industrial_decor');
      } else {
        // Manual group management
        if(_industrialDecorGroup && _industrialDecorGroup.parent){
          _industrialDecorGroup.parent.remove(_industrialDecorGroup);
        }
        _industrialDecorGroup = new THREE.Group();
        scene.add(_industrialDecorGroup);
      }
      var decorGroup = (typeof groups !== 'undefined' && groups.industrial_decor)
        ? groups.industrial_decor
        : _industrialDecorGroup;

      // Find the dock face: it's the face on the side closest to the truckCourt
      // surface zone. Determine longAxisIsX by comparing wall lengths.
      var whW = bb.maxX - bb.minX;
      var whD = bb.maxZ - bb.minZ;
      var longAxisIsX = whW >= whD;
      var heightM = wh.storeys * (wh.floorHt || 44) * 0.3048;

      // Dock door geometry: 10 ft wide × 14 ft tall, spaced 25 ft o.c.
      var doorW = _ftToM(10);
      var doorH = _ftToM(14);
      var doorSpacing = _ftToM(25);
      var doorY = doorH / 2 + 0.05;   // sit just above ground

      if(longAxisIsX){
        // Dock face is at maxZ (south)
        var doorZ = _ftToM(bb.maxZ) + 0.02;
        var bldgWm = _ftToM(whW);
        var doorCount = Math.max(1, Math.floor((bldgWm - 4) / doorSpacing));
        var firstDoorX = _ftToM((bb.minX + bb.maxX) / 2) - (doorCount - 1) * doorSpacing / 2;
        for(var di = 0; di < doorCount; di++){
          var doorX = firstDoorX + di * doorSpacing;
          var doorGeo = new THREE.PlaneGeometry(doorW, doorH);
          var doorMesh = new THREE.Mesh(doorGeo, _dockDoorMat);
          doorMesh.position.set(doorX, doorY, doorZ);
          // Plane faces north by default; rotate so it faces south
          doorMesh.rotation.y = 0;
          decorGroup.add(doorMesh);
        }
      } else {
        // Dock face is at maxX (east)
        var doorXe = _ftToM(bb.maxX) + 0.02;
        var bldgDm = _ftToM(whD);
        var doorCountZ = Math.max(1, Math.floor((bldgDm - 4) / doorSpacing));
        var firstDoorZ = _ftToM((bb.minZ + bb.maxZ) / 2) - (doorCountZ - 1) * doorSpacing / 2;
        for(var dj = 0; dj < doorCountZ; dj++){
          var doorZe = firstDoorZ + dj * doorSpacing;
          var doorGeoE = new THREE.PlaneGeometry(doorW, doorH);
          var doorMeshE = new THREE.Mesh(doorGeoE, _dockDoorMat);
          doorMeshE.position.set(doorXe, doorY, doorZe);
          doorMeshE.rotation.y = Math.PI / 2;
          decorGroup.add(doorMeshE);
        }
      }

      // Add 3-5 RTU boxes on the roof for industrial detail
      var rtuCount = 4;
      for(var ri = 0; ri < rtuCount; ri++){
        var rtuW_m = _ftToM(8);
        var rtuD_m = _ftToM(6);
        var rtuH_m = _ftToM(4);
        var rtuGeo = new THREE.BoxGeometry(rtuW_m, rtuH_m, rtuD_m);
        var rtuMesh = new THREE.Mesh(rtuGeo, _rtuMat);
        // Distribute along the roof
        var t = (ri + 1) / (rtuCount + 1);
        var rtuX = _ftToM(bb.minX + (bb.maxX - bb.minX) * t);
        var rtuZ = _ftToM(bb.minZ + (bb.maxZ - bb.minZ) * (0.3 + 0.4 * (ri % 2)));
        rtuMesh.position.set(rtuX, heightM + rtuH_m / 2 + 0.1, rtuZ);
        decorGroup.add(rtuMesh);
      }

      if(overridden > 0 && !window._industrialPaintLogged){
        console.log('[Industrial paint] painted ' + overridden + ' warehouse meshes (tilt-up + white roof) + ' + decorGroup.children.length + ' dock doors and RTUs');
        window._industrialPaintLogged = true;
      }
    } catch(e){
      console.warn('[Industrial paint] error:', e && e.message);
    }
  }

  // Reset the painted-flag and decor when warehouse vol changes (eg. regenerated)
  function _resetIndustrialPaint(){
    window._industrialPaintLogged = false;
    if(typeof clearGroup === 'function'){
      try { clearGroup('industrial_decor'); } catch(e){}
    }
  }

  // Hook into rebuildAll — chained on top of any existing hooks. Defer 60ms
  // so the renderer's mesh creation finishes before we override materials.
  if(typeof window !== 'undefined'){
    var _origRA_paint = window.rebuildAll;
    if(typeof _origRA_paint === 'function'){
      window.rebuildAll = function(){
        var r = _origRA_paint.apply(this, arguments);
        setTimeout(_paintWarehouseIndustrial, 60);
        return r;
      };
    }
  }
  window._paintWarehouseIndustrial = _paintWarehouseIndustrial;
  window._resetIndustrialPaint = _resetIndustrialPaint;
})();

// ═══════════════════════════════════════════════════════════
//  ENHANCED MOVE PANEL — always visible, more prominent placement
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  // Override the existing _industrialMovePanelSync to use a more visible position
  if(typeof window === 'undefined') return;
  var _ensurePanelV2 = function(){
    if(typeof document === 'undefined') return null;
    var panel = document.getElementById('industrial-move-panel');
    if(panel){
      // Reposition the existing panel
      panel.style.cssText = 'position:fixed;top:130px;left:24px;z-index:9000;background:rgba(20,22,28,0.95);border:2px solid #AEBC46;border-radius:8px;padding:12px 14px;font:11px Outfit,system-ui,sans-serif;color:#ddd;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:none';
    }
    return panel;
  };
  var _origSync = window._industrialMovePanelSync;
  window._industrialMovePanelSync = function(){
    if(typeof _origSync === 'function') _origSync();
    _ensurePanelV2();
  };
})();


// ═══════════════════════════════════════════════════════════
//  INDUSTRIAL-AWARE POLYGON DRAW HOOK
//  When the user draws a polygon on the Site Map AND the asset class is
//  'industrial', we override the new volume's residential defaults
//  (storeys=8, balconies, windows) with industrial defaults (storeys=1,
//  flat tilt-up, no fenestration). We also auto-generate surface zones
//  (truck court, parking, dock doors, trailer/car stripes) around the
//  drawn polygon's bbox so the full site plan appears immediately.
//
//  This hook wraps the existing smCloseBldgPoly (from sitemap-volumes.js)
//  and runs AFTER the original creates+syncs the volume.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';

  if(typeof window === 'undefined') return;

  function _bboxLocal(verts){
    var minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for(var i=0; i<verts.length; i++){
      var p = verts[i];
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    }
    return { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ, w:maxX-minX, d:maxZ-minZ };
  }

  /**
   * After the user draws an industrial polygon, look up the just-synced
   * warehouse volume in P.vols and generate surface zones around its bbox.
   * Has to run AFTER smAutoSync has copied smVolumes → P.vols.
   */
  function _industrialPostDraw(){
    try {
      if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
      // Find the most recently added volume, mark it warehouse
      var wh = null;
      for(var i = P.vols.length - 1; i >= 0; i--){
        var v = P.vols[i];
        if(!v) continue;
        if(v.kind === 'warehouse'){ wh = v; break; }
        // If this volume was just drawn (no kind set yet), claim it
        if(!v.kind && v.customPolyLocal && v.customPolyLocal.length >= 4){
          v.kind = 'warehouse';
          v.industrial = true;
          v.storeys = 1;
          v.floorHt = 44;
          v.gfHt = 40;
          v.commGF = 0;
          v.windows = 0;
          v.balconies = 0;
          v.balcFront = 0;
          v.balcBack = 0;
          v.balcLeft = 0;
          v.balcRight = 0;
          v.color = '#cfc8b8';      // tilt-up concrete tone (matches paint hook)
          wh = v;
          break;
        }
      }
      if(!wh || !wh.customPolyLocal) return;

      var bb = _bboxLocal(wh.customPolyLocal);
      var wcx = (bb.minX + bb.maxX) / 2;
      var wcz = (bb.minZ + bb.maxZ) / 2;
      var longAxisIsX = bb.w >= bb.d;

      // Use the public helper if exposed; otherwise defer to inline
      if(typeof window._industrialBuildSurfaceZones === 'function'){
        P.industrialSurfaces = window._industrialBuildSurfaceZones(wcx, wcz, bb.w, bb.d, longAxisIsX);
      }

      console.log('[Industrial draw] applied industrial properties to drawn polygon: ' +
        Math.round(bb.w) + ' x ' + Math.round(bb.d) + ' ft, ' + Math.round(wh.customAreaSF || 0).toLocaleString() + ' sf footprint, ' +
        ((P.industrialSurfaces || []).length) + ' surface zones generated');

      if(typeof rebuildAll === 'function'){
        try { rebuildAll(); } catch(e){}
      }
    } catch(e){
      console.warn('[Industrial draw] post-draw hook failed:', e && e.message);
    }
  }

  /**
   * Wrap smCloseBldgPoly so that, after the original finishes, we apply
   * industrial styling and surface zones if the asset class is industrial.
   */
  function _installSmCloseHook(){
    if(typeof smCloseBldgPoly !== 'function'){
      // sitemap-volumes.js may not have loaded yet — retry shortly
      setTimeout(_installSmCloseHook, 150);
      return;
    }
    if(window._industrialDrawHookInstalled) return;
    var _origClose = smCloseBldgPoly;
    window.smCloseBldgPoly = function(){
      var r = _origClose.apply(this, arguments);
      try {
        var sel = document.getElementById('project-type-select');
        var cls = sel ? sel.value : 'midrise';
        if(cls === 'industrial'){
          // smAutoSync inside _origClose copies smVolumes → P.vols, but the
          // sync may be asynchronous. Defer slightly so P.vols is populated.
          setTimeout(_industrialPostDraw, 80);
        }
      } catch(e){}
      return r;
    };
    window._industrialDrawHookInstalled = true;
    console.log('[Industrial] polygon-draw hook installed — drawing while in Industrial asset class will produce a warehouse with surface zones');
  }

  // Install on DOM ready (smCloseBldgPoly is defined at script load, but
  // we play safe with retry logic above).
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(_installSmCloseHook, 0);
  } else {
    document.addEventListener('DOMContentLoaded', _installSmCloseHook);
  }

  // Also expose manual entry point so the user can convert ANY existing volume
  // to industrial via the console: convertToIndustrial() or convertToIndustrial(volIdx)
  window.convertToIndustrial = function(volIdx){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return null;
    var idx = (typeof volIdx === 'number') ? volIdx : (P.vols.length - 1);
    var v = P.vols[idx];
    if(!v || !v.customPolyLocal){
      console.warn('[convertToIndustrial] no volume at idx ' + idx);
      return null;
    }
    v.kind = 'warehouse';
    v.industrial = true;
    v.storeys = 1;
    v.floorHt = 44;
    v.gfHt = 40;
    v.commGF = 0;
    v.windows = 0;
    v.balconies = 0;
    v.balcFront = 0; v.balcBack = 0; v.balcLeft = 0; v.balcRight = 0;
    v.color = '#cfc8b8';
    var bb = _bboxLocal(v.customPolyLocal);
    var wcx = (bb.minX + bb.maxX) / 2;
    var wcz = (bb.minZ + bb.maxZ) / 2;
    var longAxisIsX = bb.w >= bb.d;
    if(typeof window._industrialBuildSurfaceZones === 'function'){
      P.industrialSurfaces = window._industrialBuildSurfaceZones(wcx, wcz, bb.w, bb.d, longAxisIsX);
    }
    if(typeof rebuildAll === 'function') rebuildAll();
    console.log('[convertToIndustrial] vol[' + idx + '] converted; ' + ((P.industrialSurfaces || []).length) + ' surface zones generated');
    return idx;
  };
})();


// ═══════════════════════════════════════════════════════════
//  CLASS A INDUSTRIAL VISUAL DECOR
//  Adds the visual signatures of an Ontario Class A bulk warehouse:
//    1. Office tower at one corner with dark glass curtain wall + dark
//       grey accent panels (replaces the residential-styled office mesh)
//    2. Vertical panel reveal lines on the long warehouse walls (mimics
//       tilt-up panel joints, every 30 ft o.c.)
//    3. Two-tone wall scheme: lighter upper + dark grey base parapet band
//    4. Copper-toned canopy strip above the office entrance
//    5. Punched window strips on the office side walls
//
//  All decor lives in a dedicated scene group ('industrial_decor' / a child
//  group) and is rebuilt every time _paintWarehouseIndustrial fires.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';

  if(typeof window === 'undefined') return;

  // Cached materials (created once when first used)
  var _matTiltUpLight = null;     // light grey tilt-up panels (upper wall)
  var _matTiltUpDark  = null;     // dark grey accent (base parapet, office walls)
  var _matGlassCW     = null;     // dark blue-tinted curtain-wall glass
  var _matMullion     = null;     // white aluminium mullions
  var _matCopper      = null;     // copper-tone canopy
  var _matRevealLine  = null;     // dark vertical panel-joint stripe
  var _matWhiteRoof   = null;     // flat TPO membrane

  function _ftToM(ft){ return ft * 0.3048; }

  // Default IMP cladding colour. User-changeable via the side-panel colour
  // picker (window.setIndustrialCladdingColor). Stored on window so the
  // material override hook in _industrialPostRender picks up the same value.
  if(typeof window !== 'undefined' && typeof window._industrialCladdingHex === 'undefined'){
    window._industrialCladdingHex = '#eef0f2';   // white / silver IMP
  }
  function _hexToInt(hex){
    if(typeof hex !== 'string') return 0xeef0f2;
    var s = hex.replace('#','');
    if(s.length === 3) s = s.split('').map(function(c){ return c+c; }).join('');
    var n = parseInt(s, 16);
    return isFinite(n) ? n : 0xeef0f2;
  }
  function _initMats(){
    if(typeof THREE === 'undefined') return false;
    var impColor = _hexToInt(window._industrialCladdingHex || '#eef0f2');
    if(!_matTiltUpLight){
      // IMP (insulated metal panel) — white / silver, low roughness, slight metalness
      _matTiltUpLight = new THREE.MeshStandardMaterial({color: impColor, roughness: 0.42, metalness: 0.32, side: THREE.DoubleSide});
    } else {
      // Re-sync colour on every rebuild so the slider's last value sticks.
      try { _matTiltUpLight.color.setHex(impColor); } catch(e){}
    }
    if(!_matTiltUpDark)  _matTiltUpDark  = new THREE.MeshStandardMaterial({color: 0x55585d, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide});
    if(!_matGlassCW)     _matGlassCW     = new THREE.MeshStandardMaterial({color: 0x101826, roughness: 0.10, metalness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.92});
    if(!_matMullion)     _matMullion     = new THREE.MeshStandardMaterial({color: 0xf5f5f3, roughness: 0.25, metalness: 0.55, side: THREE.DoubleSide});
    if(!_matCopper)      _matCopper      = new THREE.MeshStandardMaterial({color: 0xb8632a, roughness: 0.42, metalness: 0.65, side: THREE.DoubleSide});
    if(!_matRevealLine)  _matRevealLine  = new THREE.MeshStandardMaterial({color: 0x6a6e75, roughness: 0.55, metalness: 0.4, side: THREE.DoubleSide});
    if(!_matWhiteRoof)   _matWhiteRoof   = new THREE.MeshStandardMaterial({color: 0xf2f0eb, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide});
    return true;
  }

  function _bboxLocal(verts){
    var minX=Infinity, maxX=-Infinity, minZ=Infinity, maxZ=-Infinity;
    for(var i=0; i<verts.length; i++){
      var p = verts[i];
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    }
    return { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ, w:maxX-minX, d:maxZ-minZ };
  }

  /**
   * Hide the residential-styled office volume's meshes so they don't show
   * through our custom industrial decor. Done by bbox-matching world-space
   * mesh centres against the office volume's footprint.
   */
  function _hideResidentialOffice(){
    try {
      if(typeof groups === 'undefined' || !groups || !groups.building) return;
      if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
      var off = null;
      for(var i = 0; i < P.vols.length; i++){
        if(P.vols[i] && P.vols[i].kind === 'office'){ off = P.vols[i]; break; }
      }
      if(!off || !off.customPolyLocal) return;
      var bb = _bboxLocal(off.customPolyLocal);
      var minXm = _ftToM(bb.minX - 1), maxXm = _ftToM(bb.maxX + 1);
      var minZm = _ftToM(bb.minZ - 1), maxZm = _ftToM(bb.maxZ + 1);
      groups.building.traverse(function(obj){
        if(!obj || !obj.isMesh) return;
        if(obj.userData && obj.userData._industrialOfficeHidden) return;
        var box = new THREE.Box3().setFromObject(obj);
        var center = new THREE.Vector3();
        box.getCenter(center);
        if(center.x < minXm || center.x > maxXm) return;
        if(center.z < minZm || center.z > maxZm) return;
        obj.visible = false;
        if(!obj.userData) obj.userData = {};
        obj.userData._industrialOfficeHidden = true;
      });
    } catch(e){}
  }

  /**
   * Build the full Class A industrial decor — runs after the post-paint hook
   * has already overridden warehouse materials with tilt-up concrete.
   * Adds: office tower, vertical panel reveals, two-tone base, copper canopy.
   */
  function _drawIndustrialDecor(){
    try {
      if(!_initMats()) return;
      if(typeof groups === 'undefined' || !groups) return;
      if(typeof scene === 'undefined' || !scene) return;
      if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
      var wh = null;
      for(var i = 0; i < P.vols.length; i++){
        if(P.vols[i] && P.vols[i].kind === 'warehouse'){ wh = P.vols[i]; break; }
      }
      if(!wh || !wh.customPolyLocal) return;

      // Use clearGroup if available (creates / clears the named group),
      // otherwise manually manage a top-level group attached to the scene.
      if(typeof clearGroup === 'function'){ clearGroup('industrial_decor'); }
      var dg = (groups && groups.industrial_decor) ? groups.industrial_decor : null;
      if(!dg){
        dg = new THREE.Group();
        scene.add(dg);
        if(groups) groups.industrial_decor = dg;
      }

      var bb = _bboxLocal(wh.customPolyLocal);
      var whW = bb.w, whD = bb.d;
      var longAxisIsX = whW >= whD;
      var clearM = (wh.storeys || 1) * (wh.floorHt || 44) * 0.3048;
      var minXm = _ftToM(bb.minX), maxXm = _ftToM(bb.maxX);
      var minZm = _ftToM(bb.minZ), maxZm = _ftToM(bb.maxZ);
      var cxM = (minXm + maxXm) / 2;
      var czM = (minZm + maxZm) / 2;
      var wM  = maxXm - minXm;
      var dM  = maxZm - minZm;

      // ─── 1) PARAPET — handled by _buildCustomWarehouseBox ─────────────────
      //    The offset plane parapet that used to live here was duplicating the
      //    proper extruded parapet that _buildCustomWarehouseBox already
      //    creates flush with the wall (line ~2087). Two parapets at the same
      //    height — one offset 5 cm outward, one flush — read as a "floating
      //    frame" around the building. The flush extruded version stays; the
      //    offset planes are now removed. clearM left unchanged for downstream
      //    sections (reveal lines, RTUs, etc.) that read the warehouse height.

      // ─── 2) VERTICAL PANEL REVEAL LINES ───────────────────────────────────
      // 30 ft o.c. on long walls. Lines are thin vertical planes (0.4 ft wide,
      // full wall height), dark grey, slightly proud of the wall.
      // parapetH used to be defined in section (1) above; that section was
      // removed when the offset plane parapet was deleted (the proper extruded
      // parapet from _buildCustomWarehouseBox now handles it). Keep a local
      // 3 ft constant here so the reveal lines stop just below the parapet
      // band as before.
      var parapetH = _ftToM(3);
      var revealW = _ftToM(0.4);
      var revealH = clearM - parapetH;       // stop at parapet band
      var revealY = revealH / 2;
      var revealOffset = 0.06;
      function _addReveals(longSide /* 'N','S','E','W' */){
        var spacing = _ftToM(30);
        var baseDim = (longSide === 'N' || longSide === 'S') ? wM : dM;
        var count = Math.max(1, Math.floor(baseDim / spacing) + 1);
        for(var k = 1; k < count; k++){
          var offset = -baseDim / 2 + k * spacing;
          var rGeo = new THREE.PlaneGeometry(revealW, revealH);
          var rMesh = new THREE.Mesh(rGeo, _matRevealLine);
          if(longSide === 'N'){ rMesh.position.set(cxM + offset, revealY, minZm - revealOffset); rMesh.rotation.y = Math.PI; }
          else if(longSide === 'S'){ rMesh.position.set(cxM + offset, revealY, maxZm + revealOffset); }
          else if(longSide === 'E'){ rMesh.position.set(maxXm + revealOffset, revealY, czM + offset); rMesh.rotation.y = -Math.PI/2; }
          else if(longSide === 'W'){ rMesh.position.set(minXm - revealOffset, revealY, czM + offset); rMesh.rotation.y = Math.PI/2; }
          dg.add(rMesh);
        }
      }
      if(longAxisIsX){ _addReveals('N'); _addReveals('S'); }
      else { _addReveals('E'); _addReveals('W'); }

      // ─── 2.5) ROOFTOP MECHANICAL UNITS (RTUs) ──────────────────────────────
      // Class A bulk warehouses have packaged HVAC + dock-area heaters as
      // grey boxes on the roof. Sized realistically: 8 ft × 5 ft × 3 ft tall,
      // distributed in a grid roughly one unit per 15,000 sf of warehouse.
      // Material reuses the dark cladding tone so they read as mechanical
      // equipment, not architectural elements.
      try {
        var rtuW = _ftToM(8), rtuD = _ftToM(5), rtuH = _ftToM(3);
        var roofY = clearM + 0.02;                   // sit just above flat roof
        var rtuFootprintSF = (whW * whD);             // ft²
        var rtuCount = Math.max(2, Math.min(18, Math.round(rtuFootprintSF / 15000)));
        // Grid arrangement: keep RTUs 12 ft from each parapet so they don't
        // poke through the parapet band.
        var rtuMarginM = _ftToM(12);
        var usableW = wM - 2 * rtuMarginM;
        var usableD = dM - 2 * rtuMarginM;
        if(usableW > rtuW * 2 && usableD > rtuD * 2){
          // Choose a grid that approximates rtuCount, biased toward the long axis.
          var cols, rows;
          if(longAxisIsX){
            cols = Math.max(1, Math.round(Math.sqrt(rtuCount * (usableW / usableD))));
            rows = Math.max(1, Math.round(rtuCount / cols));
          } else {
            rows = Math.max(1, Math.round(Math.sqrt(rtuCount * (usableD / usableW))));
            cols = Math.max(1, Math.round(rtuCount / rows));
          }
          var stepX = usableW / cols;
          var stepZ = usableD / rows;
          // RTU material — mid-grey painted galvanized box, slightly darker than dark parapet.
          var rtuMat = new THREE.MeshStandardMaterial({color: 0x4a4d52, roughness: 0.65, metalness: 0.5, side: THREE.DoubleSide});
          var fanMat = new THREE.MeshStandardMaterial({color: 0x2a2c2e, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide});
          for(var rc = 0; rc < cols; rc++){
            for(var rr = 0; rr < rows; rr++){
              var rx = (minXm + rtuMarginM) + stepX * (rc + 0.5);
              var rz = (minZm + rtuMarginM) + stepZ * (rr + 0.5);
              var rtuGeo = new THREE.BoxGeometry(rtuW, rtuH, rtuD);
              var rtu = new THREE.Mesh(rtuGeo, rtuMat);
              rtu.position.set(rx, roofY + rtuH / 2, rz);
              rtu.castShadow = true;
              dg.add(rtu);
              // Fan grille on top — short cylinder
              try {
                var fanGeo = new THREE.CylinderGeometry(_ftToM(1.4), _ftToM(1.4), _ftToM(0.4), 16);
                var fan = new THREE.Mesh(fanGeo, fanMat);
                fan.position.set(rx, roofY + rtuH + _ftToM(0.2), rz);
                dg.add(fan);
              } catch(_eFan){}
            }
          }
        }
      } catch(_eRtu){ console.warn('[Industrial decor RTU] error:', _eRtu && _eRtu.message); }

      // ─── 3) OFFICE — REMOVED ENTIRELY ───────────────────────────────────
      //    No glass panel, no mullions, no canopy, no projecting cube. The
      //    warehouse facade is 100 % uniform IMP cladding. User asked to
      //    REMOVE the office component entirely — restore later as a flush
      //    material zone (no projecting geometry) if requested.

      // ════════════════════════════════════════════════════════════════════
      //  EXTENDED INDUSTRIAL FEATURES
      //  ─────────────────────────────────────────────────────────────────
      //  Dock doors + bumpers + canopy + drive-in ramp (#4)
      //  Light poles + curbs + trailer stalls + painted arrows (#5)
      //  Hedges + tree rows along property lines (#6)
      //
      //  All meshes are added to dg ('industrial_decor') so they're cleared
      //  and rebuilt on every regen, never leak across rebuilds.
      // ════════════════════════════════════════════════════════════════════
      try {
        // ── Cached materials for site features ─────────────────────────
        var _matDockDoor    = new THREE.MeshStandardMaterial({color:0x1c1d20, roughness:0.78, metalness:0.18, side:THREE.DoubleSide});
        var _matDriveIn     = new THREE.MeshStandardMaterial({color:0x2a2c30, roughness:0.78, metalness:0.18, side:THREE.DoubleSide});
        var _matBumper      = new THREE.MeshStandardMaterial({color:0x111111, roughness:0.95, metalness:0.05});
        var _matCanopy      = new THREE.MeshStandardMaterial({color:0x55585d, roughness:0.55, metalness:0.45, side:THREE.DoubleSide});
        var _matPole        = new THREE.MeshStandardMaterial({color:0x2c2e32, roughness:0.4,  metalness:0.7});
        var _matLuminaire   = new THREE.MeshStandardMaterial({color:0xb8bcc4, roughness:0.3,  metalness:0.85});
        var _matCurb        = new THREE.MeshStandardMaterial({color:0xc4c2bc, roughness:0.85, metalness:0.05});
        var _matArrowPaint  = new THREE.MeshBasicMaterial({color:0xf5f5f5, transparent:true, opacity:0.92, side:THREE.DoubleSide});
        var _matFireLane    = new THREE.MeshBasicMaterial({color:0xf5d000, transparent:true, opacity:0.95, side:THREE.DoubleSide});
        var _matTrailerSide = new THREE.MeshStandardMaterial({color:0xeeeeee, roughness:0.7,  metalness:0.05, side:THREE.DoubleSide});
        var _matTrailerEnd  = new THREE.MeshStandardMaterial({color:0x444444, roughness:0.85, metalness:0.05, side:THREE.DoubleSide});
        var _matHedge       = new THREE.MeshStandardMaterial({color:0x3a5e30, roughness:0.95, metalness:0.02});
        var _matTrunk       = new THREE.MeshStandardMaterial({color:0x4a3520, roughness:0.95, metalness:0.0});
        var _matFoliage     = new THREE.MeshStandardMaterial({color:0x3e6e3a, roughness:0.85, metalness:0.02});
        var _matFoliageDark = new THREE.MeshStandardMaterial({color:0x2e5832, roughness:0.85, metalness:0.02});

        // ── Determine dock face + parking face ──────────────────────────
        // longAxisIsX: dock = S, parking = N. Otherwise dock = E, parking = W.
        var dockFace    = longAxisIsX ? 'S' : 'E';
        var parkingFace = longAxisIsX ? 'N' : 'W';

        // ─── 4a) DOCK DOORS + BUMPERS on the dock face ──────────────────
        // Spec: 10 ft × 10 ft openings, bottom at 4 ft (truck-bed dock),
        // 25 ft on centre. Bumpers each side of every door.
        var dockBottomM = _ftToM(4);
        var dockDoorWm  = _ftToM(10);
        var dockDoorHm  = _ftToM(10);
        var dockSpacingM = _ftToM(25);
        var dockEndPad   = _ftToM(20);   // 20 ft from each end
        var dockFaceLen  = (dockFace === 'S' || dockFace === 'N') ? wM : dM;
        var dockDoorCount = Math.max(1, Math.floor((dockFaceLen - dockEndPad * 2) / dockSpacingM) + 1);
        // Reserve last bay near the parking corner for the drive-in ramp
        if(dockDoorCount > 4) dockDoorCount -= 1;
        var dockBaseAlong = ((dockFace === 'S' || dockFace === 'N') ? cxM : czM) - (dockDoorCount - 1) * dockSpacingM / 2;

        function _placeDockDoor(centreAlong){
          var doorMesh = new THREE.Mesh(new THREE.PlaneGeometry(dockDoorWm, dockDoorHm), _matDockDoor);
          var y = dockBottomM + dockDoorHm / 2;
          if(dockFace === 'S'){ doorMesh.position.set(centreAlong, y, maxZm + 0.07); }
          else if(dockFace === 'N'){ doorMesh.position.set(centreAlong, y, minZm - 0.07); doorMesh.rotation.y = Math.PI; }
          else if(dockFace === 'E'){ doorMesh.position.set(maxXm + 0.07, y, centreAlong); doorMesh.rotation.y = -Math.PI/2; }
          else if(dockFace === 'W'){ doorMesh.position.set(minXm - 0.07, y, centreAlong); doorMesh.rotation.y = Math.PI/2; }
          dg.add(doorMesh);

          // Bumpers: two short black blocks at the bottom of the door, sticking ~1 ft out
          var bW = _ftToM(0.8), bH = _ftToM(3.5), bD = _ftToM(1);
          for(var bi = -1; bi <= 1; bi += 2){
            var bMesh = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, bD), _matBumper);
            var off = (dockDoorWm / 2 + bW / 2) * bi;
            if(dockFace === 'S'){ bMesh.position.set(centreAlong + off, bH/2, maxZm + bD/2 + 0.02); }
            else if(dockFace === 'N'){ bMesh.position.set(centreAlong + off, bH/2, minZm - bD/2 - 0.02); }
            else if(dockFace === 'E'){ bMesh.position.set(maxXm + bD/2 + 0.02, bH/2, centreAlong + off); }
            else if(dockFace === 'W'){ bMesh.position.set(minXm - bD/2 - 0.02, bH/2, centreAlong + off); }
            dg.add(bMesh);
          }
        }
        for(var ddI = 0; ddI < dockDoorCount; ddI++){
          _placeDockDoor(dockBaseAlong + ddI * dockSpacingM);
        }

        // ─── 4b) DRIVE-IN RAMP DOOR — at corner of dock face nearest office ─
        // 12 ft × 14 ft, base at grade (forklifts / pickups roll in directly).
        // Place at the FAR end of the dock face from the office corner.
        var diW = _ftToM(12), diH = _ftToM(14);
        var diMesh = new THREE.Mesh(new THREE.PlaneGeometry(diW, diH), _matDriveIn);
        if(dockFace === 'S'){
          // Office is at NW corner; drive-in goes near SE corner
          diMesh.position.set(maxXm - _ftToM(20), diH/2, maxZm + 0.07);
        } else if(dockFace === 'E'){
          diMesh.position.set(maxXm + 0.07, diH/2, maxZm - _ftToM(20));
          diMesh.rotation.y = -Math.PI/2;
        }
        dg.add(diMesh);

        // ─── 4c) DOCK CANOPY — REMOVED ─────────────────────────────────
        //    The projecting box read as a detached awning floating above the
        //    truck court at the wrong angle in rotated lots. Re-add later as
        //    a simple flat plane flush against the wall if needed.

        // ─── 5a) LIGHT POLES on parking + truck-court perimeters ────────
        // 25 ft tall round mast, 0.5 ft Ø, with a 2 ft × 1 ft luminaire box
        // at the top. Spaced ~80 ft along the long edge of each paved zone.
        var poleH = _ftToM(25), poleR = _ftToM(0.4);
        var lumW = _ftToM(2), lumH = _ftToM(0.5), lumD = _ftToM(1);
        function _addLightPole(xm, zm){
          var pole = new THREE.Mesh(new THREE.CylinderGeometry(poleR, poleR, poleH, 8), _matPole);
          pole.position.set(xm, poleH / 2, zm);
          dg.add(pole);
          var lum = new THREE.Mesh(new THREE.BoxGeometry(lumW, lumH, lumD), _matLuminaire);
          lum.position.set(xm, poleH + lumH / 2, zm);
          dg.add(lum);
        }
        function _surfaceBboxFt(s){
          var x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
          s.coords.forEach(function(p){
            if(p[0]<x0)x0=p[0]; if(p[0]>x1)x1=p[0];
            if(p[1]<z0)z0=p[1]; if(p[1]>z1)z1=p[1];
          });
          return {x0:x0,x1:x1,z0:z0,z1:z1};
        }
        if(Array.isArray(P.industrialSurfaces)){
          P.industrialSurfaces.forEach(function(s){
            if(s.type !== 'parkingLot' && s.type !== 'truckCourt') return;
            var bbF = _surfaceBboxFt(s);
            var lenX = bbF.x1 - bbF.x0, lenZ = bbF.z1 - bbF.z0;
            var spacingFt = 80;
            if(lenX >= lenZ){
              var n = Math.max(1, Math.round(lenX / spacingFt));
              for(var pi2 = 0; pi2 <= n; pi2++){
                var fx = bbF.x0 + (lenX / n) * pi2;
                _addLightPole(_ftToM(fx), _ftToM(bbF.z0 + 4));
                _addLightPole(_ftToM(fx), _ftToM(bbF.z1 - 4));
              }
            } else {
              var nz = Math.max(1, Math.round(lenZ / spacingFt));
              for(var pj = 0; pj <= nz; pj++){
                var fz = bbF.z0 + (lenZ / nz) * pj;
                _addLightPole(_ftToM(bbF.x0 + 4), _ftToM(fz));
                _addLightPole(_ftToM(bbF.x1 - 4), _ftToM(fz));
              }
            }
          });
        }

        // ─── 5b) CURBS around paved zones ───────────────────────────────
        // Raised concrete edge, 6 in × 6 in profile, runs the bbox perimeter
        // of each truck court / parking lot zone. Cheap visual cue between
        // landscape and pavement.
        var curbT = _ftToM(0.5), curbY = curbT / 2;
        function _addCurbBbox(bbF){
          var x0m = _ftToM(bbF.x0), x1m = _ftToM(bbF.x1);
          var z0m = _ftToM(bbF.z0), z1m = _ftToM(bbF.z1);
          var wmm = x1m - x0m, dmm = z1m - z0m;
          var n1 = new THREE.Mesh(new THREE.BoxGeometry(wmm, curbT, curbT), _matCurb);
          n1.position.set((x0m+x1m)/2, curbY, z0m); dg.add(n1);
          var n2 = new THREE.Mesh(new THREE.BoxGeometry(wmm, curbT, curbT), _matCurb);
          n2.position.set((x0m+x1m)/2, curbY, z1m); dg.add(n2);
          var e1 = new THREE.Mesh(new THREE.BoxGeometry(curbT, curbT, dmm), _matCurb);
          e1.position.set(x0m, curbY, (z0m+z1m)/2); dg.add(e1);
          var e2 = new THREE.Mesh(new THREE.BoxGeometry(curbT, curbT, dmm), _matCurb);
          e2.position.set(x1m, curbY, (z0m+z1m)/2); dg.add(e2);
        }
        if(Array.isArray(P.industrialSurfaces)){
          P.industrialSurfaces.forEach(function(s){
            if(s.type !== 'parkingLot' && s.type !== 'truckCourt') return;
            _addCurbBbox(_surfaceBboxFt(s));
          });
        }

        // ─── 5c) TRAILER STALLS — REMOVED ────────────────────────────────
        //    Parked trailers drifted outside the lot in rotated lots and
        //    read as detached white boxes floating in landscape — visually
        //    confusing. The truck court paving + dock doors + yellow trailer
        //    stripes already imply where trailers WOULD park. Re-add later
        //    once the rotation orientation is verified end-to-end.

        // ─── 5d) FIRE-LANE STRIPES around the building ──────────────────
        // Yellow stripes 1 ft wide along the parking + dock apron paving
        // immediately adjacent to the building. Marks fire-access route per
        // typical municipal site-plan requirements.
        var flY = 0.06;
        var flT = _ftToM(0.8);
        var flMargin = _ftToM(2);
        var flN = new THREE.Mesh(new THREE.PlaneGeometry(wM + 2*flMargin, flT), _matFireLane);
        flN.rotation.x = -Math.PI / 2; flN.position.set(cxM, flY, minZm - flMargin); dg.add(flN);
        var flS = new THREE.Mesh(new THREE.PlaneGeometry(wM + 2*flMargin, flT), _matFireLane);
        flS.rotation.x = -Math.PI / 2; flS.position.set(cxM, flY, maxZm + flMargin); dg.add(flS);
        var flW = new THREE.Mesh(new THREE.PlaneGeometry(flT, dM + 2*flMargin), _matFireLane);
        flW.rotation.x = -Math.PI / 2; flW.position.set(minXm - flMargin, flY, czM); dg.add(flW);
        var flE = new THREE.Mesh(new THREE.PlaneGeometry(flT, dM + 2*flMargin), _matFireLane);
        flE.rotation.x = -Math.PI / 2; flE.position.set(maxXm + flMargin, flY, czM); dg.add(flE);

        // ─── 5e) PAINTED DIRECTIONAL ARROWS on parking surface ──────────
        // White chevron pairs at parking-lot entry/midpoint. Built from two
        // tilted thin planes meeting at a point so it reads as a chevron.
        function _addArrow(xm, zm, faceAngle){
          // faceAngle 0 = points +Z (south), Math.PI = points -Z, etc.
          var armLen = _ftToM(4), armW = _ftToM(0.6);
          var aGeo = new THREE.PlaneGeometry(armLen, armW);
          var a1 = new THREE.Mesh(aGeo, _matArrowPaint);
          var a2 = new THREE.Mesh(aGeo, _matArrowPaint);
          a1.rotation.x = -Math.PI / 2; a2.rotation.x = -Math.PI / 2;
          a1.rotation.z = faceAngle + Math.PI / 6;
          a2.rotation.z = faceAngle - Math.PI / 6;
          a1.position.set(xm, 0.07, zm);
          a2.position.set(xm, 0.07, zm);
          dg.add(a1); dg.add(a2);
        }
        if(Array.isArray(P.industrialSurfaces)){
          P.industrialSurfaces.forEach(function(s){
            if(s.type !== 'parkingLot') return;
            var bbF = _surfaceBboxFt(s);
            var midX = (bbF.x0 + bbF.x1) / 2;
            var midZ = (bbF.z0 + bbF.z1) / 2;
            _addArrow(_ftToM(midX), _ftToM(midZ), 0);
            _addArrow(_ftToM(midX - 30), _ftToM(midZ), 0);
            _addArrow(_ftToM(midX + 30), _ftToM(midZ), 0);
          });
        }

        // ─── 6) HEDGES + TREE ROWS along property lines (#6) ────────────
        // Hedges: low continuous green box along the inside of the lot.
        // Trees: trunk + foliage sphere, distributed every ~30 ft along the
        // lot perimeter, with a denser row screening the truck court side.
        if(typeof lotVerts === 'function'){
          var lotF = lotVerts();
          if(Array.isArray(lotF) && lotF.length >= 3){
            var lotPts = lotF.slice();
            // Strip closing duplicate
            if(lotPts.length > 1 &&
               lotPts[0][0] === lotPts[lotPts.length-1][0] &&
               lotPts[0][1] === lotPts[lotPts.length-1][1]){
              lotPts = lotPts.slice(0, -1);
            }
            // Compute centroid for inward-direction tests
            var cFt = [0,0];
            lotPts.forEach(function(p){ cFt[0]+=p[0]; cFt[1]+=p[1]; });
            cFt[0] /= lotPts.length; cFt[1] /= lotPts.length;
            var insetFt = 4;       // 4 ft inside lot edge for trees/hedges

            // Build a quick list of driveway-entry bboxes so trees/hedges
            // can skip the area where curb cuts come through the buffer.
            var drivewayBboxes = [];
            if(Array.isArray(P.industrialSurfaces)){
              P.industrialSurfaces.forEach(function(ss){
                if(ss.type !== 'drivewayEntry' || !Array.isArray(ss.coords)) return;
                var bx0=Infinity,bx1=-Infinity,bz0=Infinity,bz1=-Infinity;
                ss.coords.forEach(function(p){
                  if(p[0]<bx0)bx0=p[0]; if(p[0]>bx1)bx1=p[0];
                  if(p[1]<bz0)bz0=p[1]; if(p[1]>bz1)bz1=p[1];
                });
                drivewayBboxes.push({x0:bx0,x1:bx1,z0:bz0,z1:bz1});
              });
            }
            function _inAnyDriveway(fx, fz, padFt){
              padFt = padFt || 6;
              for(var di3 = 0; di3 < drivewayBboxes.length; di3++){
                var b = drivewayBboxes[di3];
                if(fx >= b.x0 - padFt && fx <= b.x1 + padFt &&
                   fz >= b.z0 - padFt && fz <= b.z1 + padFt) return true;
              }
              return false;
            }

            // Distribute trees along each edge, ~30 ft apart
            for(var ei = 0; ei < lotPts.length; ei++){
              var pa = lotPts[ei];
              var pb = lotPts[(ei + 1) % lotPts.length];
              var dx = pb[0] - pa[0], dz = pb[1] - pa[1];
              var len = Math.sqrt(dx*dx + dz*dz);
              if(len < 5) continue;
              var ux = dx / len, uz = dz / len;
              // Inward normal (perp toward centroid)
              var nx = -uz, nz = ux;
              var midX = (pa[0]+pb[0])/2, midZ = (pa[1]+pb[1])/2;
              var dot = (cFt[0]-midX)*nx + (cFt[1]-midZ)*nz;
              if(dot < 0){ nx = -nx; nz = -nz; }

              var spacing = 30;     // ft between trees
              var n = Math.max(1, Math.floor(len / spacing));
              for(var ti2 = 0; ti2 <= n; ti2++){
                var t = (ti2 + 0.5) / (n + 1);   // skip exact corners so trees don't overlap
                var fx = pa[0] + ux * len * t + nx * insetFt;
                var fz = pa[1] + uz * len * t + nz * insetFt;
                // Skip trees that would land inside the warehouse footprint or
                // a paved zone. Cheap check: distance to warehouse centre.
                var dxw = fx - (bb.cx), dzw = fz - (bb.cz);
                if(Math.abs(dxw) < bb.w/2 + 8 && Math.abs(dzw) < bb.d/2 + 8) continue;
                // Skip trees blocking a driveway entry (cars need to drive through)
                if(_inAnyDriveway(fx, fz)) continue;

                var trunkH = _ftToM(8 + Math.random()*4);
                var trunkR = _ftToM(0.45);
                var trunk = new THREE.Mesh(new THREE.CylinderGeometry(trunkR, trunkR, trunkH, 6), _matTrunk);
                trunk.position.set(_ftToM(fx), trunkH / 2, _ftToM(fz));
                dg.add(trunk);
                var folR = _ftToM(5 + Math.random() * 3);
                var folMat = (ti2 % 3 === 0) ? _matFoliageDark : _matFoliage;
                var fol = new THREE.Mesh(new THREE.SphereGeometry(folR, 7, 6), folMat);
                fol.position.set(_ftToM(fx), trunkH + folR * 0.55, _ftToM(fz));
                fol.scale.set(1, 0.85, 1);
                dg.add(fol);
              }
            }

            // Continuous low hedge: 3.5 ft tall, 2.5 ft wide, set 1 ft inside
            // lot edge. Split into segments around any driveway entry that
            // crosses the edge so the hedge doesn't block the curb cut.
            var hedgeH = _ftToM(3.5), hedgeW = _ftToM(2.5);
            for(var hi2 = 0; hi2 < lotPts.length; hi2++){
              var ha = lotPts[hi2];
              var hb = lotPts[(hi2 + 1) % lotPts.length];
              var hdx = hb[0] - ha[0], hdz = hb[1] - ha[1];
              var hlen = Math.sqrt(hdx*hdx + hdz*hdz);
              if(hlen < 8) continue;
              var hux = hdx / hlen, huz = hdz / hlen;
              var hnx = -huz, hnz = hux;
              var hmidX = (ha[0]+hb[0])/2, hmidZ = (ha[1]+hb[1])/2;
              var hdot = (cFt[0]-hmidX)*hnx + (cFt[1]-hmidZ)*hnz;
              if(hdot < 0){ hnx = -hnx; hnz = -hnz; }

              // Walk the edge in 5 ft samples and emit hedge sub-segments
              // that skip the portion overlapping any driveway entry.
              var step = 5;
              var nSteps = Math.max(1, Math.ceil(hlen / step));
              var inSeg = false, segStart = 0;
              for(var hsi = 0; hsi <= nSteps; hsi++){
                var ts = hsi / nSteps;
                var sx = ha[0] + hux * hlen * ts + hnx * 1;
                var sz = ha[1] + huz * hlen * ts + hnz * 1;
                var blocked = _inAnyDriveway(sx, sz);
                if(!blocked && !inSeg){ inSeg = true; segStart = ts; }
                if((blocked || hsi === nSteps) && inSeg){
                  var segEnd = blocked ? ts : ts;
                  var segLen = (segEnd - segStart) * hlen;
                  if(segLen > 8){
                    var segMid = (segStart + segEnd) / 2;
                    var hcx = ha[0] + hux * hlen * segMid + hnx * 1;
                    var hcz = ha[1] + huz * hlen * segMid + hnz * 1;
                    var hMesh = new THREE.Mesh(new THREE.BoxGeometry(_ftToM(segLen) - _ftToM(2), hedgeH, hedgeW), _matHedge);
                    hMesh.position.set(_ftToM(hcx), hedgeH / 2, _ftToM(hcz));
                    hMesh.rotation.y = -Math.atan2(huz, hux);
                    dg.add(hMesh);
                  }
                  inSeg = false;
                }
              }
            }
          }
        }
      } catch(_eExt){ console.warn('[Industrial extended decor] error:', _eExt && _eExt.message); }

      // Hide the residential-styled office mesh so it doesn't poke through
      _hideResidentialOffice();

      console.log('[Industrial decor] built ' + dg.children.length + ' decor meshes (parapet, reveals, RTUs, office tower, dock doors, drive-in, canopy, light poles, curbs, trailers, fire-lane stripes, arrows, hedges, trees)');
    } catch(e){
      console.warn('[Industrial decor] error:', e && e.message);
    }
  }

  // Register as postRender hook (130 ms — after the +60ms paint hook).
  // Migrated from rebuildAll wrapper to hook registry. Note that
  // _drawIndustrialDecor is itself wrapped further down by the rotation
  // wrap (window._drawIndustrialDecor gets monkey-patched there); the
  // hook fires the latest assigned version, so the rotation wrap still
  // takes effect.
  function _registerDecorHook(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerDecorHook, 50);
      return;
    }
    window.registerRebuildHook('postRender', 'drawIndustrialDecor',
      function(){ window._drawIndustrialDecor(); }, 130);
  }
  _registerDecorHook();
  window._drawIndustrialDecor = _drawIndustrialDecor;
})();


// ═══════════════════════════════════════════════════════════
//  GLAZING VARIATIONS
//  Lets the user pick the office curtain wall's glass tint, mullion pattern,
//  and density without rebuilding the whole project. Settings are persisted to
//  localStorage and read by the decor builder on each rebuild.
//
//  Console:    setIndustrialGlazing({tint:'blue', pattern:'curtain', density:'standard'})
//  UI panel:   floating selector beside the MOVE BUILDING panel
//
//  Tints       (color, opacity, metalness, name):
//    'dark'    — 0x101826 / 0.92 / 0.85   (mirrored dark — default, ref #5525)
//    'blue'    — 0x2a4a6e / 0.85 / 0.7    (clear blue tint)
//    'smoke'   — 0x3a3a3e / 0.85 / 0.55   (smoked grey)
//    'bronze'  — 0x5a4530 / 0.82 / 0.6    (bronze tinted, 1980s-style)
//    'mirror'  — 0xa0b0c0 / 0.95 / 0.95   (chrome mirrored)
//    'clear'   — 0xc8d4e0 / 0.4  / 0.3    (low-iron, transparent)
//
//  Patterns    (placement of glass on office front face):
//    'curtain' — full-height continuous glazing (default, ref #5525)
//    'ribbon'  — horizontal band at upper level only (60% of height)
//    'punched' — rectangular openings in solid wall (3 windows per storey)
//    'fins'    — full-height with prominent vertical mullion fins
//
//  Mullion density:
//    'sparse'  — 8 ft horizontal spacing
//    'standard'— 5 ft   (default)
//    'dense'   — 3 ft
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  var TINTS = {
    'dark':   { color: 0x101826, opacity: 0.92, metalness: 0.85, roughness: 0.10, label: 'Dark mirror' },
    'blue':   { color: 0x2a4a6e, opacity: 0.85, metalness: 0.70, roughness: 0.18, label: 'Blue tint' },
    'smoke':  { color: 0x3a3a3e, opacity: 0.85, metalness: 0.55, roughness: 0.22, label: 'Smoked grey' },
    'bronze': { color: 0x5a4530, opacity: 0.82, metalness: 0.60, roughness: 0.25, label: 'Bronze' },
    'mirror': { color: 0xa0b0c0, opacity: 0.95, metalness: 0.95, roughness: 0.05, label: 'Mirrored' },
    'clear':  { color: 0xc8d4e0, opacity: 0.40, metalness: 0.30, roughness: 0.10, label: 'Clear (low-iron)' }
  };
  var PATTERNS = ['curtain', 'ribbon', 'punched', 'fins'];
  var DENSITIES = { 'sparse': 8, 'standard': 5, 'dense': 3 };

  var LS_KEY = 'EB_INDUSTRIAL_GLAZING';
  function _readConfig(){
    try {
      var raw = localStorage.getItem(LS_KEY);
      if(raw) return JSON.parse(raw);
    } catch(e){}
    return { tint: 'dark', pattern: 'curtain', density: 'standard' };
  }
  function _writeConfig(cfg){
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch(e){}
  }

  // Expose preset tables so the decor builder can read them
  window._industrialGlazingTints = TINTS;
  window._industrialGlazingDensities = DENSITIES;
  window._industrialGlazingPatterns = PATTERNS;

  /** @returns {{tint:string, pattern:string, density:string, tintSpec:Object, mullionSpacingFt:number}} */
  window.getIndustrialGlazing = function(){
    var cfg = _readConfig();
    return {
      tint: cfg.tint,
      pattern: cfg.pattern,
      density: cfg.density,
      tintSpec: TINTS[cfg.tint] || TINTS.dark,
      mullionSpacingFt: DENSITIES[cfg.density] || DENSITIES.standard
    };
  };

  /**
   * Set glazing options. Any subset; missing keys keep previous value.
   * @param {{tint?:string, pattern?:string, density?:string}} opts
   */
  window.setIndustrialGlazing = function(opts){
    opts = opts || {};
    var cfg = _readConfig();
    if(opts.tint && TINTS[opts.tint]) cfg.tint = opts.tint;
    if(opts.pattern && PATTERNS.indexOf(opts.pattern) >= 0) cfg.pattern = opts.pattern;
    if(opts.density && DENSITIES[opts.density]) cfg.density = opts.density;
    _writeConfig(cfg);
    console.log('[Industrial glazing] set to', cfg);
    if(typeof rebuildAll === 'function'){ try { rebuildAll(); } catch(e){} }
    if(typeof window._industrialGlazingPanelSync === 'function') window._industrialGlazingPanelSync();
  };

  // ── Floating glazing control panel ──────────────────────────────────────
  function _ensureGlazingPanel(){
    if(typeof document === 'undefined') return null;
    var panel = document.getElementById('industrial-glazing-panel');
    if(panel) return panel;
    panel = document.createElement('div');
    panel.id = 'industrial-glazing-panel';
    panel.style.cssText = 'position:fixed;top:340px;left:24px;z-index:9000;background:rgba(20,22,28,0.95);border:2px solid #3a5a8a;border-radius:8px;padding:10px 12px;font:11px Outfit,system-ui,sans-serif;color:#ddd;box-shadow:0 6px 24px rgba(0,0,0,0.7);display:none;min-width:170px';
    panel.innerHTML =
      '<div style="font-size:10px;letter-spacing:1.5px;color:#AEBC46;font-weight:700;text-align:center;margin-bottom:8px">GLAZING</div>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Tint</label>' +
      '<select id="ig-tint" style="background:#1a1a1a;color:#ddd;border:1px solid #444;font-size:11px;padding:3px 5px;border-radius:3px;width:100%;margin-bottom:6px">' +
      Object.keys(TINTS).map(function(k){ return '<option value="' + k + '">' + TINTS[k].label + '</option>'; }).join('') +
      '</select>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Pattern</label>' +
      '<select id="ig-pattern" style="background:#1a1a1a;color:#ddd;border:1px solid #444;font-size:11px;padding:3px 5px;border-radius:3px;width:100%;margin-bottom:6px">' +
      '<option value="curtain">Full curtain wall</option>' +
      '<option value="ribbon">Ribbon band</option>' +
      '<option value="punched">Punched openings</option>' +
      '<option value="fins">Vertical fins</option>' +
      '</select>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Mullion density</label>' +
      '<select id="ig-density" style="background:#1a1a1a;color:#ddd;border:1px solid #444;font-size:11px;padding:3px 5px;border-radius:3px;width:100%">' +
      '<option value="sparse">Sparse (8 ft o.c.)</option>' +
      '<option value="standard">Standard (5 ft o.c.)</option>' +
      '<option value="dense">Dense (3 ft o.c.)</option>' +
      '</select>';
    document.body.appendChild(panel);
    var t = panel.querySelector('#ig-tint');
    var p = panel.querySelector('#ig-pattern');
    var d = panel.querySelector('#ig-density');
    t.addEventListener('change', function(){ window.setIndustrialGlazing({ tint: t.value }); });
    p.addEventListener('change', function(){ window.setIndustrialGlazing({ pattern: p.value }); });
    d.addEventListener('change', function(){ window.setIndustrialGlazing({ density: d.value }); });
    return panel;
  }

  window._industrialGlazingPanelSync = function(){
    var panel = _ensureGlazingPanel();
    if(!panel) return;
    var hasIndustrial = typeof P !== 'undefined' && P && Array.isArray(P.industrialSurfaces) && P.industrialSurfaces.length > 0;
    panel.style.display = hasIndustrial ? 'block' : 'none';
    if(hasIndustrial){
      var cfg = _readConfig();
      panel.querySelector('#ig-tint').value = cfg.tint;
      panel.querySelector('#ig-pattern').value = cfg.pattern;
      panel.querySelector('#ig-density').value = cfg.density;
    }
  };

  // Hook into rebuildAll to sync visibility + selected values
  if(typeof window !== 'undefined'){
    var _origRA_glazing = window.rebuildAll;
    if(typeof _origRA_glazing === 'function'){
      window.rebuildAll = function(){
        var r = _origRA_glazing.apply(this, arguments);
        try { window._industrialGlazingPanelSync(); } catch(e){}
        return r;
      };
    }
  }

  // First-load sync
  if(typeof document !== 'undefined'){
    if(document.readyState === 'complete' || document.readyState === 'interactive'){
      setTimeout(window._industrialGlazingPanelSync, 100);
    } else {
      document.addEventListener('DOMContentLoaded', window._industrialGlazingPanelSync);
    }
  }
})();


// ═══════════════════════════════════════════════════════════
//  AGGRESSIVE HIDE + CUSTOM WAREHOUSE BOX
//  After many iterations of trying to override the residential renderer's
//  output on warehouse volumes, we stop fighting it and just HIDE everything
//  in the warehouse footprint, then draw a clean custom 40 ft tilt-up box
//  from scratch. No more escaping mullions, punched windows, or curtain
//  wall frames. The user-visible result is exactly what _drawIndustrialDecor
//  draws plus this custom warehouse mesh.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  var _customWarehouseGroup = null;
  var _matCustomWall = null;
  var _matCustomRoof = null;
  var _matCustomParapet = null;

  function _ftToM2(ft){ return ft * 0.3048; }

  function _wallMat(){
    if(!_matCustomWall && typeof THREE !== 'undefined'){
      _matCustomWall = new THREE.MeshStandardMaterial({
        color: 0xe2ddd2, roughness: 0.88, metalness: 0.04, side: THREE.DoubleSide
      });
    }
    return _matCustomWall;
  }
  function _roofMat(){
    if(!_matCustomRoof && typeof THREE !== 'undefined'){
      _matCustomRoof = new THREE.MeshStandardMaterial({
        color: 0xf2f0eb, roughness: 0.92, metalness: 0.02, side: THREE.DoubleSide
      });
    }
    return _matCustomRoof;
  }
  function _parapetMat(){
    if(!_matCustomParapet && typeof THREE !== 'undefined'){
      _matCustomParapet = new THREE.MeshStandardMaterial({
        color: 0x55585d, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide
      });
    }
    return _matCustomParapet;
  }

  /**
   * Aggressively hide ALL meshes/lines/sprites whose XZ centroid sits
   * inside the warehouse polygon. The custom box drawn afterward is the
   * only visible warehouse content. Returns counts for diagnostics.
   */
  function _hideAllInWarehouseFootprint(){
    if(typeof groups === 'undefined' || !groups || !groups.building) return {hidden:0};
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return {hidden:0};
    var wh = null;
    for(var i = 0; i < P.vols.length; i++){
      if(P.vols[i] && P.vols[i].kind === 'warehouse'){ wh = P.vols[i]; break; }
    }
    if(!wh || !wh.customPolyLocal) return {hidden:0};

    // Polygon bbox in metres
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for(var k = 0; k < wh.customPolyLocal.length; k++){
      var p = wh.customPolyLocal[k];
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    }
    var minXm = _ftToM2(minX - 1), maxXm = _ftToM2(maxX + 1);
    var minZm = _ftToM2(minZ - 1), maxZm = _ftToM2(maxZ + 1);
    var hidden = 0;
    groups.building.traverse(function(obj){
      if(!obj) return;
      if(obj === groups.building) return;
      if(!obj.isMesh && !obj.isLine && !obj.isLineSegments && !obj.isPoints && !obj.isSprite) return;
      if(obj.userData && obj.userData._industrialHidden) return;   // already hidden
      try {
        var box = new THREE.Box3().setFromObject(obj);
        var bcx = (box.min.x + box.max.x) / 2;
        var bcz = (box.min.z + box.max.z) / 2;
        if(bcx >= minXm && bcx <= maxXm && bcz >= minZm && bcz <= maxZm){
          obj.visible = false;
          if(!obj.userData) obj.userData = {};
          obj.userData._industrialHidden = true;
          hidden++;
        }
      } catch(e){}
    });
    return {hidden: hidden};
  }

  /**
   * Build a fresh custom warehouse mesh: extruded polygon walls + flat roof
   * + dark parapet band on top. Total height locked at 40 ft.
   * Stored in groups.industrial_warehouse_box (separate from decor so the
   * surface zones layer can come on top).
   */
  function _buildCustomWarehouseBox(){
    if(typeof groups === 'undefined' || !groups || !groups.building) return null;
    if(typeof THREE === 'undefined') return null;
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return null;
    var wh = null;
    for(var i = 0; i < P.vols.length; i++){
      if(P.vols[i] && P.vols[i].kind === 'warehouse'){ wh = P.vols[i]; break; }
    }
    if(!wh || !wh.customPolyLocal) return null;

    // Tear down previous custom box
    if(typeof clearGroup === 'function'){
      try { clearGroup('industrial_warehouse_box'); } catch(e){}
    } else {
      if(_customWarehouseGroup && _customWarehouseGroup.parent){
        _customWarehouseGroup.parent.remove(_customWarehouseGroup);
      }
      _customWarehouseGroup = new THREE.Group();
      if(typeof scene !== 'undefined' && scene){ scene.add(_customWarehouseGroup); }
    }
    var grp = (typeof groups !== 'undefined' && groups.industrial_warehouse_box)
      ? groups.industrial_warehouse_box : _customWarehouseGroup;
    if(!grp) return null;

    var bldgHm = _ftToM2(40);
    var parapetHm = _ftToM2(3);
    var wallHm = bldgHm - parapetHm;

    // Build polygon shape from customPolyLocal (in feet, X+ east Z+ south).
    // Three.js shape uses (x, y) where y is screen-up. The standard renderer
    // rotation maps shape's (x, y) → world (x, -z). So we negate Z to convert.
    var poly = wh.customPolyLocal;
    var pts = [];
    for(var pi = 0; pi < poly.length - 1; pi++){
      pts.push(new THREE.Vector2(_ftToM2(poly[pi][0]), -_ftToM2(poly[pi][1])));
    }
    if(pts.length < 3) return null;
    var shape = new THREE.Shape(pts);

    // Wall extrusion (37 ft = 11.28m of tilt-up)
    var wallGeo = new THREE.ExtrudeGeometry(shape, { depth: wallHm, bevelEnabled: false });
    var wallMesh = new THREE.Mesh(wallGeo, _wallMat());
    wallMesh.rotation.x = -Math.PI / 2;
    wallMesh.position.y = 0;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    grp.add(wallMesh);

    // Parapet band on top (3 ft, dark grey)
    var parapetGeo = new THREE.ExtrudeGeometry(shape, { depth: parapetHm, bevelEnabled: false });
    var parapetMesh = new THREE.Mesh(parapetGeo, _parapetMat());
    parapetMesh.rotation.x = -Math.PI / 2;
    parapetMesh.position.y = wallHm;
    grp.add(parapetMesh);

    // Roof — flat plane at the top
    var roofGeo = new THREE.ShapeGeometry(shape);
    var roofMesh = new THREE.Mesh(roofGeo, _roofMat());
    roofMesh.rotation.x = -Math.PI / 2;
    roofMesh.position.y = bldgHm + 0.02;
    roofMesh.receiveShadow = true;
    grp.add(roofMesh);

    return grp;
  }

  // Register as postRender hook (80 ms — renderer needs to finish first).
  // Migrated from rebuildAll wrapper to hook registry.
  function _customWarehouseHookFn(){
    try {
      var stats = _hideAllInWarehouseFootprint();
      var grp = _buildCustomWarehouseBox();
      if(stats.hidden > 0 || grp){
        if(!window._industrialBoxLogged){
          console.log('[Industrial box] hid ' + stats.hidden + ' residential meshes/lines, drew clean custom 40 ft tilt-up warehouse box');
          window._industrialBoxLogged = true;
        }
      }
    } catch(e){ console.warn('[Industrial box] error:', e && e.message); }
  }
  function _registerCustomWarehouse(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerCustomWarehouse, 50);
      return;
    }
    window.registerRebuildHook('postRender', 'customWarehouseBox', _customWarehouseHookFn, 80);
  }
  _registerCustomWarehouse();
  window._buildCustomIndustrialWarehouse = _buildCustomWarehouseBox;
  window._hideResidentialInWarehouse = _hideAllInWarehouseFootprint;
})();


// ═══════════════════════════════════════════════════════════
//  POLYGON CLIPPING + LANDSCAPE FILL
//  Hooks into rebuildAll. Clips truck court / parking surfaces to the lot
//  polygon (so they never extend outside the orange boundary), then adds a
//  green LANDSCAPE surface filling whatever lot space remains after the
//  building + clipped surfaces are subtracted.
//  Uses turf.js (already loaded by the app for sitemap operations).
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  function _coordsToTurfPoly(coords){
    if(!Array.isArray(coords) || coords.length < 4) return null;
    var ring = coords.map(function(p){ return [p[0], p[1]]; });
    if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
      ring.push([ring[0][0], ring[0][1]]);
    }
    try { return turf.polygon([ring]); } catch(e){ return null; }
  }

  function _turfPolyToCoords(tp){
    if(!tp || !tp.geometry) return null;
    var g = tp.geometry;
    if(g.type === 'Polygon'){ return g.coordinates[0].map(function(p){ return [p[0], p[1]]; }); }
    if(g.type === 'MultiPolygon' && g.coordinates.length){ return g.coordinates[0][0].map(function(p){ return [p[0], p[1]]; }); }
    return null;
  }

  function _lotPoly(){
    if(typeof lotVerts !== 'function') return null;
    var lv = lotVerts();
    if(!Array.isArray(lv) || lv.length < 3) return null;
    return _coordsToTurfPoly(lv);
  }

  // ── Turf v7 compat helpers ───────────────────────────────────────────
  // turf v7 deprecated the two-argument form of intersect / difference and
  // requires a FeatureCollection containing both polygons. The previous
  // two-argument calls in this function silently failed, leaving truck
  // courts, parking lots, and landscape rings unclipped — visible in the
  // 3D site plan as paving and grass spilling well past the lot polygon.
  function _safeIntersect(a, b){
    if(!a || !b) return null;
    try { return turf.intersect(turf.featureCollection([a, b])); }
    catch(e){
      try { return turf.intersect(a, b); }   // fallback for older turf
      catch(e2){ return null; }
    }
  }
  function _safeDifference(a, b){
    if(!a || !b) return a || null;
    try { return turf.difference(turf.featureCollection([a, b])); }
    catch(e){
      try { return turf.difference(a, b); }  // fallback for older turf
      catch(e2){ return a; }
    }
  }

  function _clipSurfacesAndAddLandscape(){
    if(typeof turf === 'undefined') return;
    if(typeof P === 'undefined' || !P || !Array.isArray(P.industrialSurfaces)) return;
    if(P.industrialSurfaces.length === 0) return;
    var lotTp = _lotPoly();
    if(!lotTp) return;

    // Find the warehouse polygon as a turf poly so we can subtract it from landscape
    var whTp = null;
    if(Array.isArray(P.vols)){
      for(var i = 0; i < P.vols.length; i++){
        var v = P.vols[i];
        if(v && v.kind === 'warehouse' && v.customPolyLocal){
          whTp = _coordsToTurfPoly(v.customPolyLocal);
          break;
        }
      }
    }

    // Clip every existing zone to the lot polygon. Drop previously-generated
    // landscape AND driveAisle entries so they get rebuilt fresh below.
    var clipped = [];
    for(var s = 0; s < P.industrialSurfaces.length; s++){
      var surf = P.industrialSurfaces[s];
      if(surf.type === 'landscape' || surf.type === 'driveAisle') continue;
      var sTp = _coordsToTurfPoly(surf.coords);
      if(!sTp){ clipped.push(surf); continue; }
      var inter = _safeIntersect(sTp, lotTp);
      if(inter){
        var newCoords = _turfPolyToCoords(inter);
        if(newCoords && newCoords.length >= 4){
          surf.coords = newCoords;
        } else if(!newCoords){
          // No intersection — surface is entirely outside the lot. Drop it.
          continue;
        }
      }
      clipped.push(surf);
    }
    P.industrialSurfaces = clipped;

    // ── 10 ft perimeter landscape buffer ──
    //    Real industrial site plans show a green strip along property lines —
    //    typically the municipal landscape setback (3 m / 10 ft per Toronto +
    //    Mississauga Class A standards). Compute it as lot - lot_inset_10ft so
    //    the green ring hugs the property boundary instead of absorbing the
    //    east/west side strips between the building and the lot edge (those
    //    used to fall through to "remaining = lot - building - zones" and
    //    showed up as huge green wedges that don't match a real site plan).
    var lotInsetTp = null;
    var landscapeRingTp = null;
    try {
      lotInsetTp = turf.buffer(lotTp, -10 * 0.3048, {units: 'meters'});
      if(lotInsetTp && lotInsetTp.geometry && lotInsetTp.geometry.coordinates && lotInsetTp.geometry.coordinates.length){
        landscapeRingTp = _safeDifference(lotTp, lotInsetTp);
      }
    } catch(e){
      // Buffer can fail on tiny / sliver lots — fall back to whole-lot landscape below.
      lotInsetTp = null;
      landscapeRingTp = null;
    }

    // ── Drive aisle = lot_inset - building - (truck court + parking lot + dock apron) ──
    //    This captures the paved circulation areas that wrap the building (the
    //    east/west sides + any inner gaps the rectangular zones miss). Without
    //    this step those gaps were silently classified as landscape, which read
    //    as huge unrealistic green pads rather than asphalt.
    var driveAisleTp = lotInsetTp;
    if(driveAisleTp){
      if(whTp){
        var dw = _safeDifference(driveAisleTp, whTp); if(dw) driveAisleTp = dw;
      }
      for(var k = 0; k < P.industrialSurfaces.length; k++){
        var surf2 = P.industrialSurfaces[k];
        if(surf2.type === 'truckCourt' || surf2.type === 'parkingLot' || surf2.type === 'dockApron' || surf2.type === 'drivewayEntry'){
          var sTp2 = _coordsToTurfPoly(surf2.coords);
          if(!sTp2) continue;
          var d2 = _safeDifference(driveAisleTp, sTp2); if(d2) driveAisleTp = d2;
        }
      }
    }

    // ── Subtract driveway entries from the landscape ring so the green
    //    perimeter buffer has visible openings at the curb cuts (cars enter
    //    from the parking-side street, trucks from the dock-side street).
    if(landscapeRingTp){
      for(var dki = 0; dki < P.industrialSurfaces.length; dki++){
        var dks = P.industrialSurfaces[dki];
        if(dks.type !== 'drivewayEntry') continue;
        var dkT = _coordsToTurfPoly(dks.coords);
        if(!dkT) continue;
        var dkD = _safeDifference(landscapeRingTp, dkT);
        if(dkD) landscapeRingTp = dkD;
      }
    }

    // ── Emit landscape (perimeter ring) at index 0 so it paints first ──
    if(landscapeRingTp && landscapeRingTp.geometry){
      var ringPolys = (landscapeRingTp.geometry.type === 'MultiPolygon')
        ? landscapeRingTp.geometry.coordinates
        : [landscapeRingTp.geometry.coordinates];
      ringPolys.forEach(function(rings){
        if(!rings || !rings[0] || rings[0].length < 4) return;
        var coords = rings[0].map(function(p){ return [p[0], p[1]]; });
        P.industrialSurfaces.unshift({
          type: 'landscape',
          label: 'Landscape buffer',
          coords: coords,
          color: 0x4a6840,
          opacity: 0.92,
          _renderY: 0.03
        });
      });
    } else {
      // Fallback (lot too small for a 10ft inset): use legacy "remaining" so the
      // function still emits a sensible green pad rather than nothing.
      var remaining = lotTp;
      if(whTp){
        var d = _safeDifference(remaining, whTp); if(d) remaining = d;
      }
      for(var kk = 0; kk < P.industrialSurfaces.length; kk++){
        var ss = P.industrialSurfaces[kk];
        if(ss.type === 'truckCourt' || ss.type === 'parkingLot' || ss.type === 'dockApron'){
          var ssT = _coordsToTurfPoly(ss.coords);
          if(!ssT) continue;
          var dd = _safeDifference(remaining, ssT); if(dd) remaining = dd;
        }
      }
      if(remaining && remaining.geometry){
        var polys = (remaining.geometry.type === 'MultiPolygon')
          ? remaining.geometry.coordinates
          : [remaining.geometry.coordinates];
        polys.forEach(function(rings){
          if(!rings || !rings[0] || rings[0].length < 4) return;
          var coords = rings[0].map(function(p){ return [p[0], p[1]]; });
          P.industrialSurfaces.unshift({
            type: 'landscape',
            label: 'Landscape buffer',
            coords: coords,
            color: 0x4a6840,
            opacity: 0.92,
            _renderY: 0.03
          });
        });
      }
    }

    // ── Emit drive aisle(s) just after landscape so they paint over the green
    //    edge but under truck court / parking / dock apron. Each ring becomes
    //    its own surface entry to honour MultiPolygon results.
    if(driveAisleTp && driveAisleTp.geometry){
      var aislePolys = (driveAisleTp.geometry.type === 'MultiPolygon')
        ? driveAisleTp.geometry.coordinates
        : [driveAisleTp.geometry.coordinates];
      aislePolys.forEach(function(rings){
        if(!rings || !rings[0] || rings[0].length < 4) return;
        var coords = rings[0].map(function(p){ return [p[0], p[1]]; });
        // Insert at index 1 — landscape sits at 0, aisle one step above it,
        // truck court / parking / stripes append later in P.industrialSurfaces.
        P.industrialSurfaces.splice(1, 0, {
          type: 'driveAisle',
          label: 'Drive aisle',
          coords: coords,
          color: 0x4d4d4d,
          opacity: 0.88,
          _renderY: 0.04
        });
      });
    }
  }

  // Hook into rebuildAll so clipping/landscape happen on every regen, AND
  // run office-absorb / hard-strip first so cached projects (autosaved with
  // two vols) get collapsed back to a single warehouse rectangle before
  // surfaces are clipped.
  function _stripIndustrialOfficeVols(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
    var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
    var isIndustrial = !!(sel && sel.value === 'industrial') ||
                       (P.assetClass === 'industrial') ||
                       (P.projectType === 'industrial') ||
                       P.vols.some(function(v){ return v && v.kind === 'warehouse'; });
    if(!isIndustrial) return;
    var before = P.vols.length;
    P.vols = P.vols.filter(function(v){ return !(v && v.kind === 'office'); });
    if(P.vols.length !== before){
      console.log('[Industrial strip] removed ' + (before - P.vols.length) + ' cached office vol(s)');
    }
  }
  if(typeof window !== 'undefined'){
    var _origRA_clip = window.rebuildAll;
    if(typeof _origRA_clip === 'function'){
      window.rebuildAll = function(){
        // 1) Strip any cached office vol up front — the new generator only
        //    produces a warehouse, but autosaved older projects still have
        //    a separate office volume that renders as a glass tower cube.
        try { _stripIndustrialOfficeVols(); } catch(e){ console.warn('[Industrial strip] error:', e && e.message); }
        // 2) Run the legacy absorb pass for projects that have _industrialAxis
        //    but were created before the single-vol generator landed.
        try {
          if(typeof window._industrialAbsorbOffice === 'function') window._industrialAbsorbOffice();
        } catch(e){ console.warn('[Industrial absorb (rebuildAll)] error:', e && e.message); }
        // 3) Clip surfaces + rebuild landscape ring + drive aisle.
        try { _clipSurfacesAndAddLandscape(); } catch(e){ console.warn('[Industrial clip] error:', e && e.message); }
        return _origRA_clip.apply(this, arguments);
      };
    }
  }
  window._industrialClipSurfaces = _clipSurfacesAndAddLandscape;
  window._industrialStripOffice = _stripIndustrialOfficeVols;
})();

// ═══════════════════════════════════════════════════════════
//  GLAZING PANEL → SIDE PANEL
//  Removes the fixed-position floating glazing panel and instead injects
//  a collapsible GLAZING section into the Site Plan tab's side panel,
//  matching the existing SETBACKS / FLOOR HEIGHTS / TOWER STEPBACK style.
//  Only visible when asset class is industrial.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  // Hide the old floating panel if it ever appears
  var floatStyleEl = null;
  function _suppressFloating(){
    if(floatStyleEl) return;
    if(typeof document === 'undefined') return;
    floatStyleEl = document.createElement('style');
    floatStyleEl.textContent = '#industrial-glazing-panel{display:none !important;}';
    document.head.appendChild(floatStyleEl);
  }

  function _findSidePanelContainer(){
    if(typeof document === 'undefined') return null;
    // Try by section text — find SETBACKS section's parent
    var hits = document.querySelectorAll('div, section');
    for(var i = 0; i < hits.length; i++){
      var el = hits[i];
      if(el.textContent && /SETBACKS/.test(el.textContent.slice(0, 120))){
        // The side panel container is typically 1-3 levels up
        var p = el;
        for(var d = 0; d < 5; d++){
          if(!p) break;
          if(p.children && p.children.length > 3) return p;
          p = p.parentElement;
        }
      }
    }
    return null;
  }

  function _injectSideSection(){
    if(typeof document === 'undefined') return null;
    if(document.getElementById('industrial-glazing-section')) return document.getElementById('industrial-glazing-section');
    var container = _findSidePanelContainer();
    if(!container) return null;
    var section = document.createElement('div');
    section.id = 'industrial-glazing-section';
    section.style.cssText = 'background:#1a1a1a;border:1px solid #333;border-radius:6px;padding:10px 12px;margin:8px 0;font:11px Outfit,system-ui,sans-serif;color:#ddd';
    var TINTS = window._industrialGlazingTints || {};
    var tintOpts = '';
    Object.keys(TINTS).forEach(function(k){ tintOpts += '<option value="' + k + '">' + TINTS[k].label + '</option>'; });
    section.innerHTML =
      '<div style="font-size:11px;letter-spacing:1.5px;color:#AEBC46;font-weight:700;margin-bottom:8px">GLAZING</div>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Tint</label>' +
      '<select id="ig-tint-side" style="background:#0f0f0f;color:#ddd;border:1px solid #444;font-size:11px;padding:4px 6px;border-radius:3px;width:100%;margin-bottom:8px">' + tintOpts + '</select>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Pattern</label>' +
      '<select id="ig-pattern-side" style="background:#0f0f0f;color:#ddd;border:1px solid #444;font-size:11px;padding:4px 6px;border-radius:3px;width:100%;margin-bottom:8px">' +
      '<option value="curtain">Full curtain wall</option>' +
      '<option value="ribbon">Ribbon band</option>' +
      '<option value="punched">Punched openings</option>' +
      '<option value="fins">Vertical fins</option>' +
      '</select>' +
      '<label style="font-size:10px;color:#888;display:block;margin-bottom:2px">Mullion density</label>' +
      '<select id="ig-density-side" style="background:#0f0f0f;color:#ddd;border:1px solid #444;font-size:11px;padding:4px 6px;border-radius:3px;width:100%">' +
      '<option value="sparse">Sparse (8 ft o.c.)</option>' +
      '<option value="standard">Standard (5 ft o.c.)</option>' +
      '<option value="dense">Dense (3 ft o.c.)</option>' +
      '</select>';
    container.appendChild(section);
    var t = section.querySelector('#ig-tint-side');
    var p = section.querySelector('#ig-pattern-side');
    var d = section.querySelector('#ig-density-side');
    t && t.addEventListener('change', function(){ if(typeof window.setIndustrialGlazing === 'function') window.setIndustrialGlazing({ tint: t.value }); });
    p && p.addEventListener('change', function(){ if(typeof window.setIndustrialGlazing === 'function') window.setIndustrialGlazing({ pattern: p.value }); });
    d && d.addEventListener('change', function(){ if(typeof window.setIndustrialGlazing === 'function') window.setIndustrialGlazing({ density: d.value }); });
    return section;
  }

  function _syncSideSection(){
    var assetClass = (document.getElementById('project-type-select') || {}).value;
    var hasIndustrial = typeof P !== 'undefined' && P && Array.isArray(P.industrialSurfaces) && P.industrialSurfaces.length > 0;
    var section = document.getElementById('industrial-glazing-section');
    if(assetClass === 'industrial' && hasIndustrial){
      _suppressFloating();
      if(!section) section = _injectSideSection();
      if(section){
        section.style.display = 'block';
        if(typeof window.getIndustrialGlazing === 'function'){
          var cur = window.getIndustrialGlazing();
          var t = section.querySelector('#ig-tint-side');     if(t) t.value = cur.tint;
          var p = section.querySelector('#ig-pattern-side');  if(p) p.value = cur.pattern;
          var d = section.querySelector('#ig-density-side');  if(d) d.value = cur.density;
        }
      }
    } else if(section){
      section.style.display = 'none';
    }
  }

  if(typeof document !== 'undefined'){
    if(document.readyState === 'complete' || document.readyState === 'interactive'){
      setTimeout(_syncSideSection, 200);
    } else {
      document.addEventListener('DOMContentLoaded', function(){ setTimeout(_syncSideSection, 200); });
    }
  }
  if(typeof window !== 'undefined'){
    var _origRA_g2 = window.rebuildAll;
    if(typeof _origRA_g2 === 'function'){
      window.rebuildAll = function(){
        var r = _origRA_g2.apply(this, arguments);
        try { _syncSideSection(); } catch(e){}
        return r;
      };
    }
  }
})();


// ═══════════════════════════════════════════════════════════
//  HIDE CONTEXT BUILDINGS INSIDE THE PARCEL
//  When the user picks a lot, any pre-existing 3D context buildings (OSM /
//  Mapbox composite / Mississauga 3D Massing / MS Canadian Footprints) that
//  fall INSIDE that lot block the view of the proposed development. This
//  hook walks groups.context after every rebuildAll and sets visible=false
//  for any context mesh whose XZ centroid sits inside the lot polygon.
//  Generic across all asset classes — runs whenever a lot exists.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  function _ftToM3(ft){ return ft * 0.3048; }

  function _pip(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function _hideContextInLot(){
    try {
      if(typeof groups === 'undefined' || !groups || !groups.context) return;
      if(typeof THREE === 'undefined') return;
      if(typeof lotVerts !== 'function') return;
      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return;
      // Convert lot polygon from feet → metres (world space)
      var lotM = lot.map(function(p){ return [_ftToM3(p[0]), _ftToM3(p[1])]; });
      // Slight inset so buildings whose footprint just brushes the lot edge
      // (e.g. neighbours along a property line) remain visible.
      var hidden = 0, kept = 0;
      groups.context.children.forEach(function(mesh){
        if(!mesh) return;
        if(mesh.userData && mesh.userData._lotHideProcessed && !mesh.visible) return;
        try {
          var box = new THREE.Box3().setFromObject(mesh);
          var cx = (box.min.x + box.max.x) / 2;
          var cz = (box.min.z + box.max.z) / 2;
          if(_pip(cx, cz, lotM)){
            mesh.visible = false;
            if(!mesh.userData) mesh.userData = {};
            mesh.userData._lotHideProcessed = true;
            hidden++;
          } else {
            mesh.visible = true;
            kept++;
          }
        } catch(e){}
      });
      if(hidden > 0 && !window._contextHideLogged){
        console.log('[Site prep] hid ' + hidden + ' context building(s) inside lot polygon (' + kept + ' kept around perimeter)');
        window._contextHideLogged = true;
      }
    } catch(e){ console.warn('[Site prep] hide context error:', e && e.message); }
  }

  // Register as postRender hook (100 ms after rebuild — groups.context
  // needs that long to finish populating from Mapbox tile loads).
  // Migrated from rebuildAll wrapper to hook registry.
  function _registerCtxHide(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerCtxHide, 50);
      return;
    }
    window.registerRebuildHook('postRender', 'hideContextInLot', _hideContextInLot, 100);
  }
  _registerCtxHide();
  window._hideContextBuildingsInLot = _hideContextInLot;
  // Reset so the next rebuild logs again (useful when user changes lot)
  window._resetContextHideLog = function(){ window._contextHideLogged = false; };
})();


// ═══════════════════════════════════════════════════════════
//  AGGRESSIVE MULTI-PASS HIDE OF ALL IN-LOT BUILDINGS
//  Earlier hide hooks only walked groups.context with a single 100ms delay.
//  Two failure modes:
//    1. Meshes can live in DIFFERENT scene groups (env, building cache, or
//       direct scene children added by smCapture variants).
//    2. Async captures (OSM Overpass ~1-2s, Mississauga ArcGIS up to 3s)
//       complete AFTER the 100ms hook fires, so newly added buildings escape.
//  This pass:
//    a) Filters P._contextBuildingFeatures BEFORE the next rebuild — cuts
//       the data at source, so the renderer never builds those meshes.
//    b) Post-render scene-wide traversal at 100/500/1500/3000ms, hides any
//       mesh in groups OTHER than industrial_*/lot/setbacks/labels/env.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  var EXCLUDED_GROUP_NAMES = {   // groups whose contents we PROTECT (do not hide)
    'lot': true, 'setbacks': true, 'env': true, 'labels': true,
    'building': true,   // user's rendered building (residential or industrial-decor-only)
    'industrial_surfaces': true, 'industrial_decor': true,
    'industrial_warehouse_box': true, 'industrial_decor_v2': true
  };

  function _ftToM4(ft){ return ft * 0.3048; }

  function _pip2(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  /**
   * Compute polygon centroid (closed or open).
   * @param {Array<Array<number>>} poly
   * @returns {[number, number]}
   */
  function _centroid(poly){
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    var cx = 0, cz = 0;
    for(var i = 0; i < n; i++){ cx += poly[i][0]; cz += poly[i][1]; }
    return [cx / n, cz / n];
  }

  /**
   * Convert a (lng, lat) pair to local feet using P._gpsOrigin and the same
   * spherical-projection math the existing renderer uses.
   * @returns {[number, number] | null}
   */
  function _llToFt(lng, lat){
    if(typeof P === 'undefined' || !P || !P._gpsOrigin) return null;
    var oLat = P._gpsOrigin.lat, oLng = P._gpsOrigin.lng;
    var mPerDegLat = 111132;
    var mPerDegLng = 111132 * Math.cos(oLat * Math.PI / 180);
    var dxM = (lng - oLng) * mPerDegLng;
    var dzM = -(lat - oLat) * mPerDegLat;   // Z+ = south (lat decreases southward)
    return [dxM / 0.3048, dzM / 0.3048];
  }

  /** Pre-render filter — remove context-building features whose centroid is in lot. */
  function _filterContextFeaturesPreRender(){
    try {
      if(typeof P === 'undefined' || !P) return 0;
      if(!Array.isArray(P._contextBuildingFeatures)) return 0;
      if(typeof lotVerts !== 'function') return 0;
      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var before = P._contextBuildingFeatures.length;
      P._contextBuildingFeatures = P._contextBuildingFeatures.filter(function(b){
        if(!b || !Array.isArray(b.coords) || b.coords.length < 3) return true;
        // coords are lng/lat — convert centroid to local feet and test against lot
        var c = _centroid(b.coords);
        var ft = _llToFt(c[0], c[1]);
        if(!ft) return true;   // can't determine — keep
        return !_pip2(ft[0], ft[1], lot);
      });
      var removed = before - P._contextBuildingFeatures.length;
      if(removed > 0 && !window._industrialPreFilterLogged){
        console.log('[Site prep] pre-filtered ' + removed + ' context-building feature(s) inside lot polygon (data-level)');
        window._industrialPreFilterLogged = true;
      }
      return removed;
    } catch(e){
      console.warn('[Site prep] pre-filter error:', e && e.message);
      return 0;
    }
  }

  /** Post-render — walk every scene group except the protected ones, hide in-lot meshes. */
  function _postRenderHideInLot(){
    try {
      if(typeof scene === 'undefined' || !scene) return 0;
      if(typeof THREE === 'undefined') return 0;
      if(typeof lotVerts !== 'function') return 0;
      // GUARD: only run for industrial projects. groups.building is NOT
      // in EXCLUDED_GROUP_NAMES, so for residential projects this function
      // hides the user's actual building meshes (walls + glazing), leaving
      // only the floor slabs visible.
      var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
      var isIndustrial = !!(sel && sel.value === 'industrial') ||
                         (typeof P !== 'undefined' && P && (P.assetClass === 'industrial' || P.projectType === 'industrial')) ||
                         (typeof P !== 'undefined' && P && Array.isArray(P.vols) &&
                          P.vols.some(function(v){ return v && v.kind === 'warehouse'; }));
      if(!isIndustrial) return 0;

      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var lotM = lot.map(function(p){ return [_ftToM4(p[0]), _ftToM4(p[1])]; });

      // Identify protected groups by reference (so we can skip ENTIRE subtrees)
      var protectedGroups = [];
      if(typeof groups !== 'undefined' && groups){
        Object.keys(EXCLUDED_GROUP_NAMES).forEach(function(name){
          if(groups[name]) protectedGroups.push(groups[name]);
        });
      }
      function _isInProtected(obj){
        var p = obj;
        while(p){
          for(var i = 0; i < protectedGroups.length; i++){
            if(p === protectedGroups[i]) return true;
          }
          p = p.parent;
        }
        return false;
      }

      var hidden = 0;
      scene.traverse(function(obj){
        if(!obj || !obj.isMesh) return;
        if(obj.userData && obj.userData._lotHideProcessed && obj.visible === false) return;
        if(_isInProtected(obj)) return;
        try {
          var box = new THREE.Box3().setFromObject(obj);
          var cx = (box.min.x + box.max.x) / 2;
          var cz = (box.min.z + box.max.z) / 2;
          // Only consider buildings — meshes that have non-trivial height + footprint
          var dy = box.max.y - box.min.y;
          if(dy < 0.5) return;   // skip thin / ground meshes
          if(_pip2(cx, cz, lotM)){
            obj.visible = false;
            if(!obj.userData) obj.userData = {};
            obj.userData._lotHideProcessed = true;
            hidden++;
          }
        } catch(e){}
      });
      if(hidden > 0){
        console.log('[Site prep] post-render hid ' + hidden + ' building mesh(es) inside lot polygon');
      }
      return hidden;
    } catch(e){
      console.warn('[Site prep] post-render hide error:', e && e.message);
      return 0;
    }
  }

  // Migrated from rebuildAll wrapper to hook registry:
  //   • _filterContextFeaturesPreRender runs synchronously BEFORE rebuild
  //     (preRebuild hook, priority 10) so context-building data is filtered
  //     before the renderer ever sees it.
  //   • _postRenderHideInLot runs FOUR times after rebuild at 100, 500,
  //     1500, 3000 ms — Mapbox PMTiles loads context buildings async, so
  //     we re-hide on a multi-pass schedule.
  function _registerCtxFilterHooks(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerCtxFilterHooks, 50);
      return;
    }
    window.registerRebuildHook('preRebuild',  'filterContextFeatures', _filterContextFeaturesPreRender, 10);
    window.registerRebuildHook('postRender',  'postHideInLot-100',  _postRenderHideInLot,  100);
    window.registerRebuildHook('postRender',  'postHideInLot-500',  _postRenderHideInLot,  500);
    window.registerRebuildHook('postRender',  'postHideInLot-1500', _postRenderHideInLot, 1500);
    window.registerRebuildHook('postRender',  'postHideInLot-3000', _postRenderHideInLot, 3000);
  }
  _registerCtxFilterHooks();
  window._aggressiveHideContextInLot = _postRenderHideInLot;
  window._preFilterContextInLot = _filterContextFeaturesPreRender;
})();


// ═══════════════════════════════════════════════════════════
//  TREES IN LANDSCAPE BUFFERS
//  After landscape polygons are computed, scatter tree markers (small dark
//  green disc + lighter green canopy) along the perimeter buffers. Trees
//  are added as additional surface entries with their own type 'tree' so
//  the renderer paints them as small filled circles. Spacing 30 ft o.c.
//  along all landscape edges (Ontario industrial-zone Type B planting std).
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  function _scatterTrees(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.industrialSurfaces)) return 0;
    var landscape = P.industrialSurfaces.filter(function(s){ return s.type === 'landscape'; });
    if(landscape.length === 0) return 0;
    // Strip any pre-existing tree markers so re-runs don't accumulate
    P.industrialSurfaces = P.industrialSurfaces.filter(function(s){ return s.type !== 'tree'; });

    var added = 0;
    var TREE_RADIUS_FT = 6;
    var SPACING_FT = 30;
    landscape.forEach(function(ls){
      // Sample points along each edge of the landscape polygon at SPACING_FT intervals
      var coords = ls.coords;
      if(!Array.isArray(coords) || coords.length < 4) return;
      for(var i = 0; i < coords.length - 1; i++){
        var a = coords[i], b = coords[i + 1];
        var dx = b[0] - a[0], dz = b[1] - a[1];
        var len = Math.sqrt(dx*dx + dz*dz);
        if(len < SPACING_FT) continue;
        var nSteps = Math.floor(len / SPACING_FT);
        for(var k = 1; k <= nSteps; k++){
          var t = k / (nSteps + 1);
          var cx = a[0] + dx * t;
          var cz = a[1] + dz * t;
          // Inset 8 ft from edge so the tree sits inside the landscape strip
          var nx = -dz / len, nz = dx / len;
          cx += nx * 6; cz += nz * 6;
          // Small octagonal disc around (cx, cz) with radius TREE_RADIUS_FT
          var ring = [];
          for(var s = 0; s < 8; s++){
            var ang = (s / 8) * Math.PI * 2;
            ring.push([cx + Math.cos(ang) * TREE_RADIUS_FT, cz + Math.sin(ang) * TREE_RADIUS_FT]);
          }
          ring.push([ring[0][0], ring[0][1]]);
          P.industrialSurfaces.push({
            type: 'tree',
            label: 'Tree',
            coords: ring,
            color: 0x2f5430,    // slightly darker than landscape green
            opacity: 0.95,
            _renderY: 0.06     // sit just above landscape (0.03) but below stripes
          });
          added++;
        }
      }
    });
    if(added > 0 && !window._industrialTreesLogged){
      console.log('[Industrial trees] scattered ' + added + ' tree markers along landscape buffers (30 ft o.c.)');
      window._industrialTreesLogged = true;
    }
    return added;
  }

  // Run after rebuildAll. Defer 200ms so landscape clipping finishes first.
  if(typeof window !== 'undefined'){
    var _origRA_trees = window.rebuildAll;
    if(typeof _origRA_trees === 'function'){
      window.rebuildAll = function(){
        var r = _origRA_trees.apply(this, arguments);
        setTimeout(function(){
          try { _scatterTrees(); } catch(e){ console.warn('[Industrial trees] error:', e && e.message); }
        }, 200);
        return r;
      };
    }
  }
  window._scatterIndustrialTrees = _scatterTrees;
})();

// ═══════════════════════════════════════════════════════════
//  PARKING RATIO + STAT REPORT — 1 stall / 1500 sf, 24 ft drive aisle
//  Console reports the actual stall count delivered by the layout so the
//  user can compare against the by-law minimum.
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  window._industrialReportStalls = function(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return null;
    var wh = P.vols.find(function(v){ return v && v.kind === 'warehouse'; });
    if(!wh) return null;
    var gfa = wh.customAreaSF || 0;
    var requiredStalls = Math.ceil(gfa / 1500);
    var dockCount = Math.round(gfa / 10000);
    var trailerStalls = Math.round(dockCount * 1.2);   // 1.2 trailers per dock typical
    console.log('[Industrial] Site stats — GFA: ' + gfa.toLocaleString() + ' sf, required parking: ' + requiredStalls + ' stalls (1/1500 sf), docks: ' + dockCount + ', trailer stalls: ' + trailerStalls);
    return { gfa: gfa, requiredStalls: requiredStalls, dockCount: dockCount, trailerStalls: trailerStalls };
  };
})();


// ═══════════════════════════════════════════════════════════
//  BRUTE-FORCE IN-LOT HIDE + TREE FILTER
//  Previous multi-pass hide still left some buildings visible inside the
//  lot. This pass:
//    - Walks the ENTIRE scene with NO group restrictions other than skipping
//      our own industrial_*/lot/setbacks/env/labels groups by name match.
//    - Hides if ANY corner of the bbox is inside the lot polygon (not just
//      the centroid) — catches long buildings straddling the boundary.
//    - Filters trees whose centroid is OUTSIDE the lot polygon (drops them
//      from P.industrialSurfaces before the renderer paints).
//    - Runs at 50/200/500/1000/2000/3500ms (more passes, longer schedule).
// ═══════════════════════════════════════════════════════════
(function(){
  'use strict';
  if(typeof window === 'undefined') return;

  function _ftToM5(ft){ return ft * 0.3048; }

  function _pip3(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n -= 1;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function _isProtectedAncestor(obj){
    var p = obj;
    while(p){
      if(p.userData && (p.userData._industrialPainted || p.userData._industrialHidden ||
                       p.userData._industrialPaintGen || p.userData._lotHideProcessed)) {
        // Already processed by us — but still skip industrial decor groups
      }
      // Skip any group whose name (set via userData.name or .name) indicates ours
      if(p.name && /^(industrial_|lot|setbacks|env|labels|building)/.test(p.name)) return true;
      // Match against the global `groups` object by reference. 'building'
      // added so this brute-hide can NEVER touch the user's actual rendered
      // building meshes — even in industrial mode the asset-class guard at
      // the renderer entry means industrial vols are never painted into
      // groups.building, so anything in there is residential and must stay.
      if(typeof groups !== 'undefined' && groups){
        var keys = ['lot','setbacks','env','labels','building','industrial_surfaces','industrial_decor','industrial_warehouse_box','industrial_decor_v2'];
        for(var i = 0; i < keys.length; i++){
          if(groups[keys[i]] === p) return true;
        }
      }
      p = p.parent;
    }
    return false;
  }

  function _bruteHide(){
    try {
      if(typeof scene === 'undefined' || !scene) return 0;
      if(typeof THREE === 'undefined') return 0;
      if(typeof lotVerts !== 'function') return 0;
      // GUARD: only run for industrial projects. Same root cause as
      // _hardHide / _killBuildingWires — this function walks every mesh
      // in the scene and hides any whose footprint touches the lot
      // polygon, but groups.building is NOT in the protected ancestor
      // list. For residential projects it was hiding ~1600 of the
      // user's own wall + glazing meshes, leaving only the floor slabs
      // visible. Detect industrial mode and bail otherwise.
      var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
      var isIndustrial = !!(sel && sel.value === 'industrial') ||
                         (typeof P !== 'undefined' && P && (P.assetClass === 'industrial' || P.projectType === 'industrial')) ||
                         (typeof P !== 'undefined' && P && Array.isArray(P.vols) &&
                          P.vols.some(function(v){ return v && v.kind === 'warehouse'; }));
      if(!isIndustrial) return 0;

      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var lotM = lot.map(function(p){ return [_ftToM5(p[0]), _ftToM5(p[1])]; });

      var hidden = 0, checked = 0;
      scene.traverse(function(obj){
        if(!obj || !obj.isMesh) return;
        if(_isProtectedAncestor(obj)) return;
        if(obj.userData && obj.userData._lotHideProcessed && obj.visible === false) return;
        checked++;
        try {
          var box = new THREE.Box3().setFromObject(obj);
          var dy = box.max.y - box.min.y;
          if(dy < 0.5) return;   // skip thin / ground
          // Test 9 points: corners + edge midpoints + centroid
          var samples = [
            [box.min.x, box.min.z], [box.max.x, box.min.z],
            [box.min.x, box.max.z], [box.max.x, box.max.z],
            [(box.min.x + box.max.x)/2, box.min.z],
            [(box.min.x + box.max.x)/2, box.max.z],
            [box.min.x, (box.min.z + box.max.z)/2],
            [box.max.x, (box.min.z + box.max.z)/2],
            [(box.min.x + box.max.x)/2, (box.min.z + box.max.z)/2]
          ];
          var anyInside = false;
          for(var s = 0; s < samples.length; s++){
            if(_pip3(samples[s][0], samples[s][1], lotM)){ anyInside = true; break; }
          }
          if(anyInside){
            obj.visible = false;
            if(!obj.userData) obj.userData = {};
            obj.userData._lotHideProcessed = true;
            hidden++;
          }
        } catch(e){}
      });
      if(hidden > 0){
        console.log('[Site prep brute] checked ' + checked + ' meshes, hid ' + hidden + ' touching lot polygon');
      }
      return hidden;
    } catch(e){ console.warn('[Site prep brute] error:', e && e.message); return 0; }
  }

  function _filterTreesToLot(){
    try {
      if(typeof P === 'undefined' || !P || !Array.isArray(P.industrialSurfaces)) return 0;
      if(typeof lotVerts !== 'function') return 0;
      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var before = P.industrialSurfaces.length;
      P.industrialSurfaces = P.industrialSurfaces.filter(function(s){
        if(s.type !== 'tree') return true;
        if(!Array.isArray(s.coords) || s.coords.length < 3) return false;
        // Tree centroid in feet
        var n = s.coords.length;
        if(s.coords[0][0] === s.coords[n-1][0] && s.coords[0][1] === s.coords[n-1][1]) n -= 1;
        var cx = 0, cz = 0;
        for(var i = 0; i < n; i++){ cx += s.coords[i][0]; cz += s.coords[i][1]; }
        cx /= n; cz /= n;
        return _pip3(cx, cz, lot);
      });
      var dropped = before - P.industrialSurfaces.length;
      if(dropped > 0){
        console.log('[Industrial trees] filtered out ' + dropped + ' tree(s) outside lot polygon');
      }
      return dropped;
    } catch(e){ console.warn('[Industrial trees filter] error:', e && e.message); return 0; }
  }

  // Hook into rebuildAll. Multi-pass schedule for hide; tree filter runs synchronously
  // BEFORE rebuildAll so the renderer never paints out-of-lot trees in the first place.
  if(typeof window !== 'undefined'){
    var _origRA_brute = window.rebuildAll;
    if(typeof _origRA_brute === 'function'){
      window.rebuildAll = function(){
        try { _filterTreesToLot(); } catch(e){}
        var r = _origRA_brute.apply(this, arguments);
        var schedule = [50, 200, 500, 1000, 2000, 3500];
        schedule.forEach(function(ms){ setTimeout(_bruteHide, ms); });
        // Trees are added by the trees IIFE at 200ms, so re-filter at 250ms
        setTimeout(_filterTreesToLot, 250);
        setTimeout(_filterTreesToLot, 1000);
        return r;
      };
    }
  }
  window._bruteHideInLot = _bruteHide;
  window._filterTreesToLot = _filterTreesToLot;
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  CLICK-AND-DRAG INDUSTRIAL BUILDING (3D)
 *  ──────────────────────────────────────────────────────────────────────────
 *  Lets the user grab the warehouse / office / dock doors / RTUs in the 3D
 *  view and drag the entire building across the lot. Visual feedback is
 *  zero-latency: during drag we translate THREE.Group transforms only.
 *  On mouseup we apply the cumulative offset to P.vols + P.industrialSurfaces
 *  via window.moveIndustrialBuilding(dxFt, dzFt) and rebuildAll() runs once.
 *
 *  Capture-phase mousedown lets us intercept before the orbit handler. We
 *  only steal the click if the ray hits an industrial mesh; otherwise the
 *  orbit camera keeps working as before.
 *
 *  Conventions: world units = metres, P.vols units = feet (FT = 0.3048).
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialDragInstalled) return;
  window._industrialDragInstalled = true;

  var FT = 0.3048;
  var raycaster = new THREE.Raycaster();
  var mouseN = new THREE.Vector2();
  var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var startWorld = new THREE.Vector3();
  var lastWorld = new THREE.Vector3();
  var dragging = false;
  var bldgGroups = [];
  var surfacesGroup = null;
  var rafPending = false;

  function _industrialActive(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols) || !P.vols.length) return false;
    // Match if projectType / assetClass is industrial, OR ANY vol is a warehouse.
    // The vol-kind fallback makes drag work after a refresh + autoLoad even
    // when neither field somehow got restored.
    if(P.assetClass === 'industrial' || P.projectType === 'industrial') return true;
    for(var i = 0; i < P.vols.length; i++){
      if(P.vols[i] && P.vols[i].kind === 'warehouse') return true;
    }
    return false;
  }

  function _isolateIndustrialMeshes(){
    var meshes = [];
    if(typeof groups === 'undefined' || !groups) return meshes;
    var keys = ['industrial_warehouse_box', 'industrial_decor', 'industrial_decor_v2'];
    keys.forEach(function(k){
      var g = groups[k];
      if(!g) return;
      g.traverse(function(o){
        if(o.isMesh && o.visible !== false) meshes.push(o);
      });
    });
    return meshes;
  }

  function _collectBldgGroups(){
    if(typeof groups === 'undefined' || !groups) return [];
    return ['industrial_warehouse_box', 'industrial_decor', 'industrial_decor_v2']
      .map(function(k){ return groups[k] || null; })
      .filter(Boolean);
  }

  function _ndc(e, canvas){
    var r = canvas.getBoundingClientRect();
    mouseN.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouseN.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  function _hitGround(){
    var v = new THREE.Vector3();
    if(raycaster.ray.intersectPlane(groundPlane, v)) return v;
    return null;
  }

  function _resetGroupTransforms(){
    bldgGroups.forEach(function(g){ g.position.x = 0; g.position.z = 0; });
    if(surfacesGroup){
      surfacesGroup.children.forEach(function(c){ c.position.x = 0; c.position.z = 0; });
    }
  }

  function onMouseDown(e){
    if(e.button !== 0) return;
    if(e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    if(!_industrialActive()) return;
    var canvas = document.getElementById('c3d');
    if(!canvas) return;
    if(e.target !== canvas) return;
    if(typeof camera === 'undefined' || !camera) return;

    _ndc(e, canvas);
    raycaster.setFromCamera(mouseN, camera);
    var meshes = _isolateIndustrialMeshes();
    if(!meshes.length) return;
    var hits = raycaster.intersectObjects(meshes, false);
    if(!hits.length) return;

    var gp = _hitGround();
    if(!gp) return;
    startWorld.copy(gp);
    lastWorld.copy(gp);
    bldgGroups = _collectBldgGroups();
    surfacesGroup = (typeof groups !== 'undefined' && groups && groups.industrial_surfaces) || null;
    dragging = true;
    canvas.style.cursor = 'grabbing';
    if(document && document.body) document.body.style.userSelect = 'none';
    e.preventDefault();
    e.stopPropagation();
  }

  function _scheduleApply(){
    if(rafPending) return;
    rafPending = true;
    requestAnimationFrame(function(){
      rafPending = false;
      if(!dragging) return;
      var dxM = lastWorld.x - startWorld.x;
      var dzM = lastWorld.z - startWorld.z;
      bldgGroups.forEach(function(g){ g.position.x = dxM; g.position.z = dzM; });
      if(surfacesGroup){
        surfacesGroup.children.forEach(function(c){
          var t = (c.userData && c.userData.surfaceType) || '';
          if(t === 'landscape'){ c.position.x = 0; c.position.z = 0; return; }
          c.position.x = dxM; c.position.z = dzM;
        });
      }
    });
  }

  function onMouseMove(e){
    if(!dragging) return;
    var canvas = document.getElementById('c3d');
    if(!canvas) return;
    _ndc(e, canvas);
    raycaster.setFromCamera(mouseN, camera);
    var gp = _hitGround();
    if(!gp) return;
    lastWorld.copy(gp);
    _scheduleApply();
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseUp(e){
    if(!dragging) return;
    dragging = false;
    var canvas = document.getElementById('c3d');
    if(canvas) canvas.style.cursor = '';
    if(document && document.body) document.body.style.userSelect = '';

    _resetGroupTransforms();

    var dxM = lastWorld.x - startWorld.x;
    var dzM = lastWorld.z - startWorld.z;
    var dxFt = dxM / FT;
    var dzFt = dzM / FT;
    if(Math.abs(dxFt) < 0.5 && Math.abs(dzFt) < 0.5){
      return;
    }
    if(typeof window.moveIndustrialBuilding === 'function'){
      try {
        var r = window.moveIndustrialBuilding(dxFt, dzFt);
        if(r && r.clamped && typeof smShowToast === 'function'){
          smShowToast('Building clamped to lot perimeter', '#FFB000');
        }
      } catch(err){
        console.warn('[Industrial drag] move err:', err);
      }
    }
  }

  function _install(){
    var canvas = document.getElementById('c3d');
    if(!canvas){ setTimeout(_install, 250); return; }
    canvas.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);
    console.log('[Industrial drag] click-and-drag building handler installed (capture phase)');
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _install);
  } else {
    _install();
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  AUTO DRIVEWAY: parking lot → nearest lot edge (assumed front street)
 *  ──────────────────────────────────────────────────────────────────────────
 *  Heuristic: the parking lot is on the front face of a Class A bulk
 *  warehouse (truck court is on the back). The closest lot edge to the
 *  parking centroid is therefore the front street. We project the parking
 *  centroid perpendicular to that edge to pick the entry point, then build
 *  a 24 ft asphalt strip from the parking-lot edge to that lot-edge point.
 *
 *  The driveway is appended to P.industrialSurfaces and is shifted along
 *  with everything else by moveIndustrialBuilding(dxFt, dzFt) — so when the
 *  user drags the building, the driveway moves with it.
 *
 *  Mapbox-driven precise frontage detection is the v2 follow-up.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialDrivewayInstalled) return;
  window._industrialDrivewayInstalled = true;

  function _polyCentroid(coords){
    if(!Array.isArray(coords) || coords.length < 4) return [0, 0];
    var n = coords.length - 1;
    var cx = 0, cz = 0;
    for(var i = 0; i < n; i++){ cx += coords[i][0]; cz += coords[i][1]; }
    return [cx / n, cz / n];
  }

  function _bbox(coords){
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    coords.forEach(function(p){
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    });
    return { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ };
  }

  function _distPtToSeg(px, pz, ax, az, bx, bz){
    var dx = bx - ax, dz = bz - az;
    var len2 = dx*dx + dz*dz;
    var t = len2 > 1e-9 ? Math.max(0, Math.min(1, ((px - ax)*dx + (pz - az)*dz) / len2)) : 0;
    var qx = ax + dx * t;
    var qz = az + dz * t;
    return { dist: Math.hypot(px - qx, pz - qz), qx:qx, qz:qz, t:t };
  }

  function _rectFromTwoPoints(ax, az, bx, bz, widthFt){
    var dx = bx - ax, dz = bz - az;
    var len = Math.hypot(dx, dz) || 1;
    var ux = dx / len, uz = dz / len;
    var nx = -uz, nz = ux;
    var hw = widthFt / 2;
    var p1 = [ax + nx * hw, az + nz * hw];
    var p2 = [bx + nx * hw, bz + nz * hw];
    var p3 = [bx - nx * hw, bz - nz * hw];
    var p4 = [ax - nx * hw, az - nz * hw];
    return [p1, p2, p3, p4, p1];
  }

  window._industrialAddDriveway = function(){
    if(typeof P === 'undefined' || !P) return null;
    if(!Array.isArray(P.industrialSurfaces) || !P.industrialSurfaces.length) return null;
    if(typeof lotVerts !== 'function') return null;

    var lot = lotVerts();
    if(!Array.isArray(lot) || lot.length < 3) return null;

    P.industrialSurfaces = P.industrialSurfaces.filter(function(s){ return s && s.type !== 'driveway'; });

    var pk = P.industrialSurfaces.find(function(s){ return s && s.type === 'parkingLot'; });
    if(!pk || !pk.coords || pk.coords.length < 4) return null;
    var pkCentroid = _polyCentroid(pk.coords);
    var pkBBox = _bbox(pk.coords);

    var ring = lot.slice();
    if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
      ring.push([ring[0][0], ring[0][1]]);
    }

    var best = null;
    for(var i = 0; i < ring.length - 1; i++){
      var r = _distPtToSeg(pkCentroid[0], pkCentroid[1],
                           ring[i][0], ring[i][1],
                           ring[i+1][0], ring[i+1][1]);
      if(!best || r.dist < best.dist){
        best = { dist: r.dist, qx: r.qx, qz: r.qz, edgeIdx: i };
      }
    }
    if(!best) return null;

    var dxToLot = best.qx - pkCentroid[0];
    var dzToLot = best.qz - pkCentroid[1];
    var lenToLot = Math.hypot(dxToLot, dzToLot) || 1;
    var ux = dxToLot / lenToLot;
    var uz = dzToLot / lenToLot;

    var startX, startZ;
    if(Math.abs(ux) > Math.abs(uz)){
      startX = ux > 0 ? pkBBox.maxX : pkBBox.minX;
      var travelX = Math.abs(startX - pkCentroid[0]);
      startZ = pkCentroid[1] + uz * travelX / Math.max(0.01, Math.abs(ux));
    } else {
      startZ = uz > 0 ? pkBBox.maxZ : pkBBox.minZ;
      var travelZ = Math.abs(startZ - pkCentroid[1]);
      startX = pkCentroid[0] + ux * travelZ / Math.max(0.01, Math.abs(uz));
    }

    var driveCoords = _rectFromTwoPoints(startX, startZ, best.qx, best.qz, 24);
    P.industrialSurfaces.push({
      type: 'driveway',
      label: 'Driveway (24 ft)',
      coords: driveCoords,
      color: 0x303030,
      opacity: 0.92,
      _renderY: 0.06,
      _frontStreet: { edgeIdx: best.edgeIdx, qx: best.qx, qz: best.qz }
    });
    P._frontStreetEdge = best.edgeIdx;
    return best;
  };

  function _wrapGen(){
    if(typeof window._omGenerateIndustrial !== 'function'){ setTimeout(_wrapGen, 250); return; }
    if(window._omGenerateIndustrial._drivewayWrapped) return;
    var orig = window._omGenerateIndustrial;
    window._omGenerateIndustrial = function(zoning, vts){
      var r = orig.apply(this, arguments);
      try {
        if(typeof window._industrialAddDriveway === 'function'){
          window._industrialAddDriveway();
        }
        if(typeof rebuildIndustrialSurfaces === 'function'){
          rebuildIndustrialSurfaces();
        }
      } catch(err){
        console.warn('[Industrial driveway] post-gen err:', err);
      }
      return r;
    };
    window._omGenerateIndustrial._drivewayWrapped = true;
    console.log('[Industrial driveway] generator wrapped');
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', _wrapGen);
  } else {
    _wrapGen();
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  AUTO-ROTATE BUILDING TO LONGEST LOT EDGE
 *  ──────────────────────────────────────────────────────────────────────────
 *  Real-estate convention: a Class A bulk warehouse should be parallel to
 *  its longest street frontage. The longest lot edge is a strong proxy for
 *  the primary street (an irregular parcel's diagonal edge is typically the
 *  street line, not an interior side-yard).
 *
 *  Strategy:
 *    1) Compute the lot's longest-edge angle θ (in lot-poly feet)
 *    2) Rotate the lot vertices by -θ around the lot centroid so the
 *       longest edge lies along +X (rotated frame)
 *    3) Run the existing axis-aligned inscribed-rectangle generator on
 *       the rotated lot — it builds a perfectly aligned warehouse + office
 *       + surface zones in the rotated frame
 *    4) Rotate every emitted polygon (P.vols[*].customPolyLocal +
 *       P.industrialSurfaces[*].coords) by +θ back to the world frame
 *    5) Stash { angle, pivot, w, d, cx, cz, longAxisIsX } on the warehouse
 *       vol as `_industrialAxis` so the decor builder can place dock doors
 *       and RTUs in the local axis-aligned frame and post-rotate them.
 *
 *  Inner rebuildAll is suppressed; the wrap calls rebuildAll once at the
 *  end so the user sees a single consistent render.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialRotationInstalled) return;
  window._industrialRotationInstalled = true;

  function _polyCentroidF(ring){
    if(!Array.isArray(ring) || ring.length < 3) return [0, 0];
    var n = ring.length;
    if(ring[0][0] === ring[n-1][0] && ring[0][1] === ring[n-1][1]) n--;
    if(n < 1) return [0, 0];
    var cx = 0, cz = 0;
    for(var i = 0; i < n; i++){ cx += ring[i][0]; cz += ring[i][1]; }
    return [cx / n, cz / n];
  }

  function _longestEdge(ring){
    var r = ring.slice();
    if(r[0][0] !== r[r.length-1][0] || r[0][1] !== r[r.length-1][1]){ r.push(r[0]); }
    var bestLen = 0, bestAng = 0;
    for(var i = 0; i < r.length - 1; i++){
      var dx = r[i+1][0] - r[i][0];
      var dz = r[i+1][1] - r[i][1];
      var L = Math.hypot(dx, dz);
      if(L > bestLen){ bestLen = L; bestAng = Math.atan2(dz, dx); }
    }
    // Normalise to (-π/2, π/2] — a rectangle has 180° rotational symmetry
    // so an angle of 170° is equivalent to -10° for our alignment purposes.
    while(bestAng > Math.PI / 2) bestAng -= Math.PI;
    while(bestAng <= -Math.PI / 2) bestAng += Math.PI;
    return { length: bestLen, angle: bestAng };
  }

  function _rotPoly(poly, cx, cz, theta){
    var c = Math.cos(theta), s = Math.sin(theta);
    return poly.map(function(p){
      var px = p[0] - cx, pz = p[1] - cz;
      return [cx + px * c - pz * s, cz + px * s + pz * c];
    });
  }

  function _bboxLocal(poly){
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    poly.forEach(function(p){
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    });
    return { cx:(minX+maxX)/2, cz:(minZ+maxZ)/2, w:maxX-minX, d:maxZ-minZ };
  }

  function _wrap(){
    if(typeof window._omGenerateIndustrial !== 'function'){ setTimeout(_wrap, 100); return; }
    if(window._omGenerateIndustrial._rotationWrapped) return;
    var orig = window._omGenerateIndustrial;
    window._omGenerateIndustrial = function(zoning, vts){
      if(!Array.isArray(vts) || vts.length < 3){
        return orig.apply(this, arguments);
      }
      var centroid = _polyCentroidF(vts);
      var le = _longestEdge(vts);
      var theta = le.angle;
      // Skip rotation if the longest edge is already within ~3° of horizontal —
      // avoids tiny floating-point jitter on rectangular lots and keeps the
      // existing axis-aligned path (and all its decor placement) untouched.
      if(Math.abs(theta) < 0.05){
        return orig.apply(this, arguments);
      }

      var rotatedVts = _rotPoly(vts, centroid[0], centroid[1], -theta);

      // Suppress rebuildAll while we're in the rotated frame
      var savedRA = (typeof window.rebuildAll === 'function') ? window.rebuildAll : null;
      if(savedRA) window.rebuildAll = function(){};
      try {
        orig.call(this, zoning, rotatedVts);
      } finally {
        if(savedRA) window.rebuildAll = savedRA;
      }

      // Annotate vols with their local axis-aligned info (decor builder uses this)
      // and rotate every poly back to the world frame.
      if(Array.isArray(P.vols)){
        P.vols.forEach(function(v){
          if(!v || !Array.isArray(v.customPolyLocal)) return;
          var bb = _bboxLocal(v.customPolyLocal);
          v._industrialAxis = {
            cx: bb.cx, cz: bb.cz, w: bb.w, d: bb.d,
            angle: theta,
            pivotX: centroid[0], pivotZ: centroid[1],
            longAxisIsX: bb.w >= bb.d
          };
          v.customPolyLocal = _rotPoly(v.customPolyLocal, centroid[0], centroid[1], theta);
        });
      }
      if(Array.isArray(P.industrialSurfaces)){
        P.industrialSurfaces.forEach(function(s){
          if(!s || !Array.isArray(s.coords)) return;
          s.coords = _rotPoly(s.coords, centroid[0], centroid[1], theta);
        });
      }
      P._industrialRotation = { angle: theta, pivot: [centroid[0], centroid[1]] };

      console.log('[Industrial rotation] aligned to longest lot edge: ' +
                  (theta * 180 / Math.PI).toFixed(1) + '° around centroid (' +
                  centroid[0].toFixed(1) + ', ' + centroid[1].toFixed(1) + ') ft');

      if(savedRA){
        try { savedRA.call(this); } catch(e){ console.warn('[Industrial rotation] rebuildAll err:', e); }
      }
    };
    window._omGenerateIndustrial._rotationWrapped = true;
    console.log('[Industrial rotation] generator wrapped — will auto-align to longest lot edge');
  }
  _wrap();
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  ROTATION-AWARE DECOR (dock doors + RTUs)
 *  ──────────────────────────────────────────────────────────────────────────
 *  The original decor builder reads bbox(wh.customPolyLocal) to place dock
 *  doors along the building's south face and RTUs across the roof. After
 *  the rotation wrap, customPolyLocal is rotated, so its axis-aligned bbox
 *  is wrong (oversized + diagonally aligned).
 *
 *  Fix: temporarily swap customPolyLocal with the axis-aligned local-frame
 *  rectangle (from _industrialAxis) for the duration of the original paint
 *  call, then post-rotate every decor child around the lot pivot.
 *
 *  Position rotation: in poly feet AND in Three.js world, +X = east, +Z =
 *  south. So a rotation by +θ around (pivotX*FT, pivotZ*FT) takes local
 *  positions to world positions.
 *
 *  Mesh facing: Three.js rotation.y = α maps +X to (cos α, 0, -sin α). For
 *  the rotated mesh to point in the same direction as the rotated polygon
 *  (+X mapped to (cos θ, 0, sin θ)), set rotation.y -= θ.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialDecorRotationInstalled) return;
  window._industrialDecorRotationInstalled = true;

  var FT = 0.3048;

  function _findWarehouse(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return null;
    for(var i = 0; i < P.vols.length; i++){
      if(P.vols[i] && P.vols[i].kind === 'warehouse') return P.vols[i];
    }
    return null;
  }

  function _localRectPoly(ax){
    var x0 = ax.cx - ax.w/2, x1 = ax.cx + ax.w/2;
    var z0 = ax.cz - ax.d/2, z1 = ax.cz + ax.d/2;
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  }

  function _rotateDecorChildren(grpName, ax){
    if(typeof groups === 'undefined' || !groups || !groups[grpName]) return;
    var pivotX = ax.pivotX * FT;
    var pivotZ = ax.pivotZ * FT;
    var c = Math.cos(ax.angle), s = Math.sin(ax.angle);
    groups[grpName].children.forEach(function(child){
      if(child.userData && child.userData._industrialRotated === ax.angle) return;
      var dx = child.position.x - pivotX;
      var dz = child.position.z - pivotZ;
      child.position.x = pivotX + dx * c - dz * s;
      child.position.z = pivotZ + dx * s + dz * c;
      child.rotation.y = (child.rotation.y || 0) - ax.angle;
      if(!child.userData) child.userData = {};
      child.userData._industrialRotated = ax.angle;
    });
  }

  function _wrapPaint(){
    if(typeof window._paintWarehouseIndustrial !== 'function'){ setTimeout(_wrapPaint, 100); return; }
    if(window._paintWarehouseIndustrial._rotationWrapped) return;
    var orig = window._paintWarehouseIndustrial;
    window._paintWarehouseIndustrial = function(){
      var wh = _findWarehouse();
      if(!wh || !wh._industrialAxis || !wh._industrialAxis.angle){
        return orig.apply(this, arguments);
      }
      var ax = wh._industrialAxis;
      var savedPoly = wh.customPolyLocal;
      // Use axis-aligned local-frame rectangle so the decor builder's
      // bbox-based dock-door & RTU placement is correct.
      wh.customPolyLocal = _localRectPoly(ax);
      try {
        orig.apply(this, arguments);
      } finally {
        wh.customPolyLocal = savedPoly;
      }
      // Post-rotate decor children around lot pivot
      _rotateDecorChildren('industrial_decor', ax);
      _rotateDecorChildren('industrial_decor_v2', ax);
    };
    window._paintWarehouseIndustrial._rotationWrapped = true;
    console.log('[Industrial decor rotation] paint wrapper installed');
  }
  _wrapPaint();
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  ROTATION-AWARE DECOR (parapet bands + panel reveals + office tower + canopy)
 *  ──────────────────────────────────────────────────────────────────────────
 *  _drawIndustrialDecor builds axis-aligned parapet bands and reveal lines
 *  using bbox(wh.customPolyLocal). When the rotation wrap is active we
 *  swap customPolyLocal for the local-frame rect, run the original, then
 *  restore and post-rotate every child of groups.industrial_decor that
 *  hasn't been rotated yet (using the per-child userData._industrialRotated
 *  marker so we don't double-rotate the painter's children).
 *
 *  We also have to swap the OFFICE volume's customPolyLocal so the office
 *  tower's _addOfficeFace() draws axis-aligned faces in local space.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialDecor2RotationInstalled) return;
  window._industrialDecor2RotationInstalled = true;

  var FT = 0.3048;

  function _findVol(kind){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return null;
    for(var i = 0; i < P.vols.length; i++){
      if(P.vols[i] && P.vols[i].kind === kind) return P.vols[i];
    }
    return null;
  }

  function _localRectPoly(ax){
    var x0 = ax.cx - ax.w/2, x1 = ax.cx + ax.w/2;
    var z0 = ax.cz - ax.d/2, z1 = ax.cz + ax.d/2;
    return [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
  }

  function _rotateUnrotatedChildren(grpName, ax){
    if(typeof groups === 'undefined' || !groups || !groups[grpName]) return;
    var pivotX = ax.pivotX * FT;
    var pivotZ = ax.pivotZ * FT;
    var c = Math.cos(ax.angle), s = Math.sin(ax.angle);
    groups[grpName].children.forEach(function(child){
      if(child.userData && child.userData._industrialRotated === ax.angle) return;
      var dx = child.position.x - pivotX;
      var dz = child.position.z - pivotZ;
      child.position.x = pivotX + dx * c - dz * s;
      child.position.z = pivotZ + dx * s + dz * c;
      child.rotation.y = (child.rotation.y || 0) - ax.angle;
      if(!child.userData) child.userData = {};
      child.userData._industrialRotated = ax.angle;
    });
  }

  function _wrapDecor(){
    if(typeof window._drawIndustrialDecor !== 'function'){ setTimeout(_wrapDecor, 100); return; }
    if(window._drawIndustrialDecor._rotationWrapped) return;
    var orig = window._drawIndustrialDecor;
    window._drawIndustrialDecor = function(){
      var wh = _findVol('warehouse');
      var off = _findVol('office');
      if(!wh || !wh._industrialAxis || !wh._industrialAxis.angle){
        return orig.apply(this, arguments);
      }
      var ax = wh._industrialAxis;
      var savedWh = wh.customPolyLocal;
      var savedOff = off ? off.customPolyLocal : null;

      wh.customPolyLocal = _localRectPoly(ax);
      if(off && off._industrialAxis){
        off.customPolyLocal = _localRectPoly(off._industrialAxis);
      }
      try {
        orig.apply(this, arguments);
      } finally {
        wh.customPolyLocal = savedWh;
        if(off) off.customPolyLocal = savedOff;
      }
      _rotateUnrotatedChildren('industrial_decor', ax);
      _rotateUnrotatedChildren('industrial_decor_v2', ax);
    };
    window._drawIndustrialDecor._rotationWrapped = true;
    console.log('[Industrial decor2 rotation] _drawIndustrialDecor wrapper installed');
  }
  _wrapDecor();
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  HARDCORE LOT PROTECTION — runs forever, no rebuild required
 *  ──────────────────────────────────────────────────────────────────────────
 *  setInterval that fires every 500 ms FOREVER. Every cycle it walks the
 *  entire scene tree and hides any object (mesh/line/lineSegments/sprite/
 *  points) whose XZ bounding-box centre sits inside the lot polygon.
 *
 *  Protected groups (industrial_*, lot, setbacks, env, labels, our own
 *  hide markers) are skipped via _isProtectedAncestor.
 *
 *  Why interval and not "rebuild hook only": Mapbox PMTiles loads buildings
 *  asynchronously over many seconds; new tiles arrive after rebuildAll has
 *  long finished. The interval is the only guarantee that tiles arriving
 *  after generation get culled.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialHardcoreLotHideInstalled) return;
  window._industrialHardcoreLotHideInstalled = true;

  var FT = 0.3048;

  function _pip(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n--;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function _isProtected(obj){
    var p = obj;
    while(p){
      if(p.name && /^(industrial_|lot|setbacks|env|labels|building)/.test(p.name)) return true;
      if(typeof groups !== 'undefined' && groups){
        // 'building' added so the user's rendered building is never hidden,
        // even if this hard-hide accidentally fires for the wrong asset class.
        var keys = ['lot','setbacks','env','labels','building',
                    'industrial_surfaces','industrial_decor',
                    'industrial_warehouse_box','industrial_decor_v2'];
        for(var i = 0; i < keys.length; i++){
          if(groups[keys[i]] === p) return true;
        }
      }
      p = p.parent;
    }
    return false;
  }

  function _hardHide(){
    try {
      if(typeof scene === 'undefined' || !scene) return 0;
      if(typeof THREE === 'undefined') return 0;
      if(typeof lotVerts !== 'function') return 0;
      // GUARD: only run for industrial projects. The "hard hide" was meant
      // to suppress async-loaded Mapbox / PMTiles context buildings that
      // ghost into the lot polygon. For residential projects it was
      // INCORRECTLY hiding the user's actual building (because
      // groups.building is not in the protected list), which made
      // residential mid-rise / multi-tower render as bare floor slabs
      // with no walls. Only-fire for industrial restores residential.
      var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
      var isIndustrial = !!(sel && sel.value === 'industrial') ||
                         (typeof P !== 'undefined' && P && (P.assetClass === 'industrial' || P.projectType === 'industrial')) ||
                         (typeof P !== 'undefined' && P && Array.isArray(P.vols) &&
                          P.vols.some(function(v){ return v && v.kind === 'warehouse'; }));
      if(!isIndustrial) return 0;

      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var lotM = lot.map(function(p){ return [p[0] * FT, p[1] * FT]; });

      var hidden = 0;
      scene.traverse(function(obj){
        if(!obj || !obj.visible) return;
        // Walk every renderable primitive — mesh, line, lineSegments, points, sprite
        if(!obj.isMesh && !obj.isLine && !obj.isLineSegments &&
           !obj.isPoints && !obj.isSprite) return;
        if(_isProtected(obj)) return;
        if(obj.userData && obj.userData._lotHardHidden) return;
        try {
          var box = new THREE.Box3().setFromObject(obj);
          var dy = box.max.y - box.min.y;
          // Cull our own thin ground/surface markers by skipping objects with
          // tiny vertical extent — they're flat hardscape, not buildings.
          if(dy < 0.4) return;
          // Sample 9 points on the bbox footprint
          var s = [
            [box.min.x, box.min.z], [box.max.x, box.min.z],
            [box.min.x, box.max.z], [box.max.x, box.max.z],
            [(box.min.x + box.max.x)/2, box.min.z],
            [(box.min.x + box.max.x)/2, box.max.z],
            [box.min.x, (box.min.z + box.max.z)/2],
            [box.max.x, (box.min.z + box.max.z)/2],
            [(box.min.x + box.max.x)/2, (box.min.z + box.max.z)/2]
          ];
          for(var k = 0; k < s.length; k++){
            if(_pip(s[k][0], s[k][1], lotM)){
              obj.visible = false;
              if(!obj.userData) obj.userData = {};
              obj.userData._lotHardHidden = true;
              hidden++;
              return;
            }
          }
        } catch(e){}
      });
      return hidden;
    } catch(e){ return 0; }
  }

  // Permanent interval — hides any newly-loaded Mapbox/PMTiles tiles forever
  setInterval(_hardHide, 500);
  // Run once on install
  setTimeout(_hardHide, 100);

  window._lotHardHide = _hardHide;
  console.log('[Hardcore lot hide] permanent 500 ms interval installed');
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  ABSORB OFFICE INTO WAREHOUSE RECTANGLE (no separate jutting tower)
 *  ──────────────────────────────────────────────────────────────────────────
 *  After the rotation+driveway wraps return, we have:
 *      P.vols = [warehouse, office]
 *  Office sits at one end of the inscribed rectangle as a separate vol with
 *  its own decor (glass tower, mullions, copper canopy). User wants the
 *  office gone — just one warehouse rectangle.
 *
 *  Strategy:
 *    1) Compute the union bbox of warehouse + office in their LOCAL axis-
 *       aligned frame (using _industrialAxis annotations from the rotation
 *       wrap). This gives us the original inscribed rectangle.
 *    2) Replace warehouse.customPolyLocal with that union rectangle, rotated
 *       to world frame using the same pivot/angle.
 *    3) Update warehouse._industrialAxis to reflect the new bounds.
 *    4) Drop the office vol from P.vols.
 *    5) rebuildAll — the residential renderer no longer creates an office
 *       tower; the post-paint hooks find no office vol and skip the tower
 *       face builders.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialOfficeAbsorbInstalled) return;
  window._industrialOfficeAbsorbInstalled = true;

  function _bboxLocal(poly){
    var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    poly.forEach(function(p){
      if(p[0] < minX) minX = p[0]; if(p[0] > maxX) maxX = p[0];
      if(p[1] < minZ) minZ = p[1]; if(p[1] > maxZ) maxZ = p[1];
    });
    return { minX:minX, maxX:maxX, minZ:minZ, maxZ:maxZ,
             cx:(minX+maxX)/2, cz:(minZ+maxZ)/2,
             w:maxX-minX, d:maxZ-minZ };
  }

  function _absorb(){
    if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
    var wh = null, off = null;
    P.vols.forEach(function(v){
      if(!v) return;
      if(v.kind === 'warehouse') wh = v;
      else if(v.kind === 'office') off = v;
    });
    if(!wh || !off) return;

    if(wh._industrialAxis && off._industrialAxis){
      // Local-frame union rectangle, then rotate to world
      var aW = wh._industrialAxis;
      var aO = off._industrialAxis;
      var minX = Math.min(aW.cx - aW.w/2, aO.cx - aO.w/2);
      var maxX = Math.max(aW.cx + aW.w/2, aO.cx + aO.w/2);
      var minZ = Math.min(aW.cz - aW.d/2, aO.cz - aO.d/2);
      var maxZ = Math.max(aW.cz + aW.d/2, aO.cz + aO.d/2);
      var newW = maxX - minX, newD = maxZ - minZ;
      var newCx = (minX + maxX)/2, newCz = (minZ + maxZ)/2;

      var localRect = [[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ],[minX,minZ]];
      var c = Math.cos(aW.angle), s = Math.sin(aW.angle);
      var px = aW.pivotX, pz = aW.pivotZ;
      wh.customPolyLocal = localRect.map(function(p){
        var dx = p[0] - px, dz = p[1] - pz;
        return [px + dx*c - dz*s, pz + dx*s + dz*c];
      });
      wh.customAreaSF = newW * newD;
      wh._industrialAxis = {
        cx:newCx, cz:newCz, w:newW, d:newD,
        angle: aW.angle, pivotX: aW.pivotX, pivotZ: aW.pivotZ,
        longAxisIsX: newW >= newD
      };
    } else if(wh.customPolyLocal && off.customPolyLocal){
      // No-rotation case — bbox union in world coords
      var bbW = _bboxLocal(wh.customPolyLocal);
      var bbO = _bboxLocal(off.customPolyLocal);
      var miX = Math.min(bbW.minX, bbO.minX);
      var maX = Math.max(bbW.maxX, bbO.maxX);
      var miZ = Math.min(bbW.minZ, bbO.minZ);
      var maZ = Math.max(bbW.maxZ, bbO.maxZ);
      wh.customPolyLocal = [[miX,miZ],[maX,miZ],[maX,maZ],[miX,maZ],[miX,miZ]];
      wh.customAreaSF = (maX - miX) * (maZ - miZ);
    } else {
      return;
    }

    // Drop the office vol
    P.vols = P.vols.filter(function(v){ return !(v && v.kind === 'office'); });
    console.log('[Industrial absorb] office absorbed into warehouse rectangle; ' +
                P.vols.length + ' vol(s) remain');
  }

  // Expose absorb so the rebuildAll wrapper (and any cached-state path) can
  // call it directly without going through _omGenerateIndustrial. Required so
  // projects autoSaved with a still-separated office vol get fixed up on the
  // next render instead of waiting for the user to re-click Generate.
  window._industrialAbsorbOffice = _absorb;

  function _wrap(){
    if(typeof window._omGenerateIndustrial !== 'function'){ setTimeout(_wrap, 100); return; }
    if(window._omGenerateIndustrial._absorbWrapped) return;
    var orig = window._omGenerateIndustrial;
    window._omGenerateIndustrial = function(zoning, vts){
      var ret = orig.apply(this, arguments);
      try {
        _absorb();
        if(typeof rebuildAll === 'function'){ rebuildAll(); }
      } catch(e){ console.warn('[Industrial absorb] err:', e); }
      return ret;
    };
    window._omGenerateIndustrial._absorbWrapped = true;
    console.log('[Industrial absorb] _omGenerateIndustrial wrapped — office will be absorbed into warehouse rect');
  }
  // Defer to DOMContentLoaded so we wrap AFTER both rotation (synchronous, runs at script load)
  // and driveway (DOMContentLoaded, runs first because its IIFE runs first).
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_wrap, 50); });
  } else {
    setTimeout(_wrap, 50);
  }
  window._industrialAbsorbOffice = _absorb;
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  WIREFRAME KILL — bulletproof line/edge hide for in-lot residential meshes
 *  ──────────────────────────────────────────────────────────────────────────
 *  The hardcore lot hide skips objects with dy < 0.4 to preserve thin
 *  hardscape (parking, truck court, dock apron, driveway). But residential
 *  amenity-terrace outlines, edge guides, and other Line geometries are
 *  flat horizontal lines (dy = 0) at podium roof height. Without an extra
 *  pass for them, they slip through.
 *
 *  This pass exclusively walks groups.building (residential renderer's
 *  output) every 500 ms. ANY Line/LineSegments/Points whose XZ centre sits
 *  inside the lot polygon is hidden — regardless of dy.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialWireKillInstalled) return;
  window._industrialWireKillInstalled = true;

  var FT = 0.3048;

  function _pip(x, z, poly){
    var inside = false;
    var n = poly.length;
    if(poly[0][0] === poly[n-1][0] && poly[0][1] === poly[n-1][1]) n--;
    for(var i = 0, j = n - 1; i < n; j = i++){
      var xi = poly[i][0], zi = poly[i][1];
      var xj = poly[j][0], zj = poly[j][1];
      var hit = ((zi > z) !== (zj > z)) &&
                (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-12) + xi);
      if(hit) inside = !inside;
    }
    return inside;
  }

  function _killBuildingWires(){
    try {
      if(typeof groups === 'undefined' || !groups || !groups.building) return 0;
      if(typeof THREE === 'undefined') return 0;
      if(typeof lotVerts !== 'function') return 0;
      // GUARD: only run for industrial projects. The wire-killer was
      // originally added to suppress residential mullion / edge wireframes
      // that ghost over the warehouse box. For residential projects, the
      // residential renderer's own Lines (terrace outlines, etc.) ARE
      // legitimate and must not be hidden. Detect industrial mode by
      // either an explicit asset-class flag or a warehouse vol in P.vols.
      var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
      var isIndustrial = !!(sel && sel.value === 'industrial') ||
                         (typeof P !== 'undefined' && P && (P.assetClass === 'industrial' || P.projectType === 'industrial')) ||
                         (typeof P !== 'undefined' && P && Array.isArray(P.vols) &&
                          P.vols.some(function(v){ return v && v.kind === 'warehouse'; }));
      if(!isIndustrial) return 0;

      var lot = lotVerts();
      if(!Array.isArray(lot) || lot.length < 3) return 0;
      var lotM = lot.map(function(p){ return [p[0]*FT, p[1]*FT]; });

      var killed = 0;
      groups.building.traverse(function(obj){
        if(!obj || !obj.visible) return;
        if(obj === groups.building) return;
        // Lines, line segments, points — the wireframe primitives
        if(!obj.isLine && !obj.isLineSegments && !obj.isPoints) return;
        if(obj.userData && obj.userData._wireKilled) return;
        try {
          var box = new THREE.Box3().setFromObject(obj);
          var cx = (box.min.x + box.max.x) / 2;
          var cz = (box.min.z + box.max.z) / 2;
          if(_pip(cx, cz, lotM)){
            obj.visible = false;
            if(!obj.userData) obj.userData = {};
            obj.userData._wireKilled = true;
            killed++;
          }
        } catch(e){}
      });
      return killed;
    } catch(e){ return 0; }
  }

  setInterval(_killBuildingWires, 500);
  setTimeout(_killBuildingWires, 100);
  window._killBuildingWires = _killBuildingWires;
  console.log('[Wireframe kill] permanent 500 ms wire-killer installed');
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  ASSET-CLASS STAMP (for save/load persistence)
 *  ──────────────────────────────────────────────────────────────────────────
 *  When an industrial building is generated, mark P.assetClass and
 *  P.projectType so save-load.js's getState picks them up. Without this,
 *  the project type is lost on autoSave → autoLoad and the page reloads
 *  as a residential project, forcing the user to clear the parcel and
 *  generate from scratch.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialAssetStampInstalled) return;
  window._industrialAssetStampInstalled = true;

  function _wrap(){
    if(typeof window._omGenerateIndustrial !== 'function'){ setTimeout(_wrap, 100); return; }
    if(window._omGenerateIndustrial._stampWrapped) return;
    var orig = window._omGenerateIndustrial;
    window._omGenerateIndustrial = function(zoning, vts){
      try {
        if(typeof P !== 'undefined' && P){
          P.assetClass = 'industrial';
          P.projectType = 'industrial';
        }
      } catch(e){}
      var ret = orig.apply(this, arguments);
      // Trigger autoSave so the stamp survives a refresh
      try {
        if(typeof autoSave === 'function') autoSave();
      } catch(e){}
      return ret;
    };
    window._omGenerateIndustrial._stampWrapped = true;
    console.log('[Industrial stamp] _omGenerateIndustrial wrapped — projectType + assetClass will persist');
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_wrap, 60); });
  } else {
    setTimeout(_wrap, 60);
  }
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  ASSET-CLASS STATE RESET on dropdown change
 *  ──────────────────────────────────────────────────────────────────────────
 *  When the user switches the project-type-select between industrial and
 *  any residential class (and vice-versa), wipe industrial-specific state
 *  so the two pipelines can't cross-contaminate. Without this, switching
 *  from industrial → residential leaves stale flags (P.assetClass,
 *  P.projectType, vol.industrial, vol._industrialAxis) that make every
 *  "is this industrial?" detector return true for what's now a residential
 *  project, re-triggering the brute-hide pipeline that erases residential
 *  walls.
 *
 *  Run once on DOMContentLoaded to attach the listener; idempotent if
 *  the script loads twice.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined' || typeof document === 'undefined') return;
  if(window._industrialAssetResetInstalled) return;
  window._industrialAssetResetInstalled = true;

  function resetAssetClassState(toClass){
    if(typeof P === 'undefined' || !P) return;
    var newClass = (toClass || '').toLowerCase();
    var leavingIndustrial = (P.assetClass === 'industrial' || P.projectType === 'industrial' ||
                             (Array.isArray(P.vols) && P.vols.some(function(v){ return v && v.industrial === true; })))
                          && newClass !== 'industrial';
    if(!leavingIndustrial){
      // Switching INTO industrial or between two residential classes — just
      // record the new asset class. Industrial generator sets the stamp later.
      P.assetClass = newClass;
      P.projectType = newClass;
      return;
    }
    // ── Leaving industrial → residential ──────────────────────────────
    // 1. Clear the asset-class stamp + project type
    P.assetClass = newClass;
    P.projectType = newClass;
    // 2. Clear the industrial-surface array (truck court, parking, dock
    //    apron, stripes, drivewayEntry, landscape ring, drive aisle, etc.)
    P.industrialSurfaces = [];
    // 3. Drop industrial volumes (warehouse / kind === 'warehouse' / industrial:true)
    if(Array.isArray(P.vols)){
      var before = P.vols.length;
      P.vols = P.vols.filter(function(v){
        return !(v && (v.industrial === true || v.kind === 'warehouse' || v.kind === 'office' && v.industrial === true));
      });
      if(P.vols.length !== before){
        console.log('[Asset reset] dropped ' + (before - P.vols.length) + ' industrial vol(s) on switch to ' + newClass);
      }
    }
    // 4. Strip _industrialAxis annotations from any remaining vols
    if(Array.isArray(P.vols)){
      P.vols.forEach(function(v){ if(v && v._industrialAxis) delete v._industrialAxis; });
    }
    // 5. Clear the rotation marker on the project
    if(P._industrialRotation) delete P._industrialRotation;
    // 6. Force a rebuild so the renderer reflects the new state
    try { if(typeof rebuildAll === 'function') rebuildAll(); } catch(e){}
    try { if(typeof autoSave === 'function') autoSave(); } catch(e){}
    console.log('[Asset reset] industrial state cleared on switch to ' + newClass);
  }

  function _attach(){
    var sel = document.getElementById('project-type-select');
    if(!sel){ setTimeout(_attach, 200); return; }
    if(sel._industrialResetBound) return;
    sel._industrialResetBound = true;
    sel.addEventListener('change', function(e){
      try { resetAssetClassState(e.target.value); } catch(err){
        console.warn('[Asset reset] error:', err && err.message);
      }
    });
    console.log('[Asset reset] dropdown listener attached');
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(_attach, 100); });
  } else {
    setTimeout(_attach, 100);
  }
  window._resetAssetClassState = resetAssetClassState;
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  STATE VALIDATOR + SELF-TEST
 *  ──────────────────────────────────────────────────────────────────────────
 *  Two utilities that catch the exact class of bugs that hurt us repeatedly
 *  during this session:
 *
 *  1) validateState() — runs after every rebuildAll. Checks for state
 *     pollution (e.g. industrial flags on residential project) and logs
 *     concise warnings. Cheap (single P.vols pass) and non-breaking.
 *
 *  2) __runSelfTest() — invokable from console. Runs the validator + a
 *     series of structural assertions on the current scene graph. Returns
 *     a pass/fail summary the user can paste back when things look wrong.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._industrialStateValidatorInstalled) return;
  window._industrialStateValidatorInstalled = true;

  function _isIndustrialMode(){
    var sel = (typeof document !== 'undefined') ? document.getElementById('project-type-select') : null;
    return !!(sel && sel.value === 'industrial') ||
           (typeof P !== 'undefined' && P && (P.assetClass === 'industrial' || P.projectType === 'industrial'));
  }

  function validateState(){
    if(typeof P === 'undefined' || !P) return [];
    if(!Array.isArray(P.vols)) return [];
    var warnings = [];
    var industrialMode = _isIndustrialMode();

    // Cross-class pollution
    if(industrialMode){
      var hasWarehouse = P.vols.some(function(v){ return v && (v.kind === 'warehouse' || v.industrial === true); });
      var hasResi = P.vols.some(function(v){ return v && !v.industrial && v.kind !== 'warehouse'; });
      if(!hasWarehouse && P.vols.length > 0){
        warnings.push('industrial mode but no warehouse vol — generator may not have fired');
      }
      if(hasResi){
        warnings.push('industrial mode contains stale residential vol(s) — call _resetAssetClassState("industrial")');
      }
    } else {
      var pollute = P.vols.filter(function(v){ return v && (v.industrial === true || v.kind === 'warehouse'); });
      if(pollute.length > 0){
        warnings.push(pollute.length + ' residential vol(s) flagged industrial — call _resetAssetClassState("' + (P.assetClass || 'midrise') + '")');
      }
      if(Array.isArray(P.industrialSurfaces) && P.industrialSurfaces.length > 0){
        warnings.push('residential mode has ' + P.industrialSurfaces.length + ' industrial surface(s) lingering — call _resetAssetClassState("' + (P.assetClass || 'midrise') + '")');
      }
    }

    // Vol structural integrity
    P.vols.forEach(function(v, i){
      if(!v) { warnings.push('P.vols[' + i + '] is null/undefined'); return; }
      if(v.industrial === true && v.kind !== 'warehouse'){
        warnings.push('vol[' + i + '] has industrial:true but kind="' + v.kind + '" — should be "warehouse"');
      }
      if(v.customPolyLocal && (!Array.isArray(v.customPolyLocal) || v.customPolyLocal.length < 3)){
        warnings.push('vol[' + i + '].customPolyLocal is not a valid polygon (' + (v.customPolyLocal && v.customPolyLocal.length) + ' verts)');
      }
    });

    if(warnings.length > 0){
      console.warn('[State validator] ' + warnings.length + ' invariant violation(s):');
      warnings.forEach(function(w){ console.warn('  • ' + w); });
    }
    return warnings;
  }

  function runSelfTest(){
    var results = [];
    function check(name, fn){
      try {
        var v = fn();
        results.push({ name: name, pass: !!v, detail: (v === true || v === false || v == null) ? '' : String(v) });
      } catch(e){
        results.push({ name: name, pass: false, detail: e && e.message || 'threw' });
      }
    }

    check('THREE loaded', function(){ return typeof THREE !== 'undefined'; });
    check('turf loaded', function(){ return typeof turf !== 'undefined'; });
    check('P object exists', function(){ return typeof P !== 'undefined' && !!P; });
    check('_resetAssetClassState exists', function(){ return typeof window._resetAssetClassState === 'function'; });
    check('validateState exists', function(){ return typeof window._validateState === 'function'; });
    check('Industrial generator wrapped', function(){ return typeof window._omGenerateIndustrial === 'function'; });
    check('P.vols is an array', function(){ return Array.isArray(P && P.vols); });
    check('groups object available', function(){ return typeof groups !== 'undefined' && !!groups; });
    check('groups.building exists', function(){ return typeof groups !== 'undefined' && groups && !!groups.building; });

    var violations = (typeof window._validateState === 'function') ? window._validateState() : [];
    check('No invariant violations', function(){ return Array.isArray(violations) ? violations.length === 0 : true; });

    var industrialMode = _isIndustrialMode();
    if(industrialMode){
      check('Industrial: P.industrialSurfaces populated', function(){
        return Array.isArray(P && P.industrialSurfaces) && P.industrialSurfaces.length > 0 ? P.industrialSurfaces.length + ' surfaces' : false;
      });
      check('Industrial: industrial_warehouse_box group exists', function(){
        return typeof groups !== 'undefined' && groups && !!groups.industrial_warehouse_box;
      });
    } else if(P && Array.isArray(P.vols) && P.vols.length > 0) {
      check('Residential: groups.building has > 50 meshes', function(){
        var n = 0;
        if(groups && groups.building) groups.building.traverse(function(o){ if(o.isMesh) n++; });
        return n > 50 ? (n + ' meshes') : false;
      });
    }

    var passed = results.filter(function(r){ return r.pass; }).length;
    var failed = results.filter(function(r){ return !r.pass; }).length;
    var label = '[Self-test] ' + passed + ' passed, ' + failed + ' failed' +
                (industrialMode ? ' (mode: industrial)' : ' (mode: residential)');
    if(failed === 0){
      console.log('%c' + label, 'color:#3a8;font-weight:bold');
    } else {
      console.warn('%c' + label, 'color:#c44;font-weight:bold');
    }
    results.forEach(function(r){
      if(r.pass){
        console.log('  ✓ ' + r.name + (r.detail ? ' — ' + r.detail : ''));
      } else {
        console.warn('  ✗ ' + r.name + (r.detail ? ' — ' + r.detail : ''));
      }
    });
    return { passed: passed, failed: failed, violations: violations };
  }

  // Register validator as a postRender hook (200 ms after rebuild).
  // FIRST migration from the wrapper-on-wrapper pattern to the registry —
  // the validator is the safest one because it only LOGS, never mutates.
  // Deferred registration in case the registry IIFE hasn't run yet.
  function _registerValidator(){
    if(typeof window.registerRebuildHook !== 'function'){
      setTimeout(_registerValidator, 50);
      return;
    }
    window.registerRebuildHook('postRender', 'validateState', validateState, 200);
  }
  _registerValidator();
  window._validateState = validateState;
  window.__runSelfTest = runSelfTest;
  console.log('[State validator] installed — run __runSelfTest() in console to verify state');
})();

/* ═══════════════════════════════════════════════════════════════════════════
 *  REBUILD HOOK REGISTRY
 *  ──────────────────────────────────────────────────────────────────────────
 *  Replacement mechanism for the 8-deep monkey-patched chain on
 *  window.rebuildAll. New code registers named, prioritized hooks instead of
 *  wrapping. The single dispatcher runs them in priority order.
 *
 *  Existing wrappers (8 of them in this file, more elsewhere) are NOT
 *  migrated — they still work, and migrating in one shot is too risky.
 *  This registry is additive: new features should use it; over time the
 *  old wrappers can be migrated one at a time, each test-verified.
 *
 *  Three phases:
 *    'preRebuild'  — runs SYNCHRONOUSLY before rebuildAll (mutate state, etc.)
 *    'postRebuild' — runs SYNCHRONOUSLY after rebuildAll returns
 *    'postRender'  — runs ASYNC after a delay (scene must be fully painted)
 *
 *  Usage:
 *    registerRebuildHook('postRebuild', 'myFeature', function(){ ... }, 50);
 *    registerRebuildHook('postRender',  'myDecor',   function(){ ... }, 200);
 *      // The 4th argument is priority for sync phases, OR delay-ms for postRender.
 *
 *    unregisterRebuildHook('postRebuild', 'myFeature');
 *    __inspectRebuildChain();   // logs the full registry to console
 * ═══════════════════════════════════════════════════════════════════════════ */
(function(){
  if(typeof window === 'undefined') return;
  if(window._ebRebuildHookRegistryInstalled) return;
  window._ebRebuildHookRegistryInstalled = true;

  // Each entry: { name, fn, priority }
  // For postRender, priority is interpreted as the setTimeout delay in ms.
  var hooks = {
    preRebuild:  [],
    postRebuild: [],
    postRender:  []
  };

  function registerRebuildHook(phase, name, fn, priority){
    if(!hooks[phase]) {
      console.warn('[Hook registry] unknown phase: ' + phase + ' (use preRebuild|postRebuild|postRender)');
      return false;
    }
    if(typeof fn !== 'function') {
      console.warn('[Hook registry] hook fn must be a function, got: ' + typeof fn);
      return false;
    }
    // De-duplicate by name (idempotent registration)
    hooks[phase] = hooks[phase].filter(function(h){ return h.name !== name; });
    hooks[phase].push({ name: name, fn: fn, priority: (typeof priority === 'number') ? priority : 100 });
    // Sort: lower priority runs first for sync phases.
    hooks[phase].sort(function(a, b){ return a.priority - b.priority; });
    return true;
  }

  function unregisterRebuildHook(phase, name){
    if(!hooks[phase]) return false;
    var before = hooks[phase].length;
    hooks[phase] = hooks[phase].filter(function(h){ return h.name !== name; });
    return hooks[phase].length < before;
  }

  function _dispatchSync(phase){
    hooks[phase].forEach(function(h){
      try { h.fn(); }
      catch(e){ console.warn('[Hook ' + phase + ':' + h.name + '] error:', e && e.message); }
    });
  }

  function _dispatchPostRender(){
    // Each postRender hook fires at its OWN delay (priority field).
    hooks.postRender.forEach(function(h){
      setTimeout(function(){
        try { h.fn(); }
        catch(e){ console.warn('[Hook postRender:' + h.name + '] error:', e && e.message); }
      }, Math.max(0, h.priority|0));
    });
  }

  // Wrap rebuildAll once with the dispatcher. This wrap is the OUTERMOST
  // — pre/post hooks fire around the entire existing 8-deep chain. Adding
  // a new hook is safe; removing one doesn't touch the chain at all.
  if(typeof window !== 'undefined'){
    var _origRA_hookDispatch = window.rebuildAll;
    if(typeof _origRA_hookDispatch === 'function'){
      window.rebuildAll = function(){
        try { _dispatchSync('preRebuild'); } catch(e){ console.warn('[Hook preRebuild] error:', e && e.message); }
        var r = _origRA_hookDispatch.apply(this, arguments);
        try { _dispatchSync('postRebuild'); } catch(e){ console.warn('[Hook postRebuild] error:', e && e.message); }
        try { _dispatchPostRender(); } catch(e){ console.warn('[Hook postRender] error:', e && e.message); }
        return r;
      };
    }
  }

  // Inspector — readable runtime view of all registered hooks.
  function inspectRebuildChain(){
    console.log('%c[Rebuild hooks]', 'color:#3a8;font-weight:bold');
    ['preRebuild','postRebuild','postRender'].forEach(function(phase){
      if(hooks[phase].length === 0){
        console.log('  ' + phase + ': (none)');
      } else {
        console.log('  ' + phase + ':');
        hooks[phase].forEach(function(h){
          var label = phase === 'postRender' ? (h.priority + ' ms') : ('priority ' + h.priority);
          console.log('    • ' + h.name + ' [' + label + ']');
        });
      }
    });
    console.log('  (Note: this only shows hooks registered via registerRebuildHook.');
    console.log('   Pre-existing rebuildAll wrappers are not visible here — they still');
    console.log('   run inside the original chain, before postRebuild fires.)');
    return hooks;
  }

  window.registerRebuildHook = registerRebuildHook;
  window.unregisterRebuildHook = unregisterRebuildHook;
  window.__inspectRebuildChain = inspectRebuildChain;
  window._ebRebuildHooks = hooks;
  console.log('[Hook registry] installed — use registerRebuildHook(phase, name, fn, priority)');
})();
