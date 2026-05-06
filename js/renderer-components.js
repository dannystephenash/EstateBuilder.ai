// cache-buster: 20260504k
// renderer-components.js — Rebuild orchestration, environment, textures, materials, building renderer, lighting, vol panel
let _rebuildTimer=null;
let _rebuildRunning=false;
/**
 * Debounced entry point that triggers a full scene rebuild after a short delay.
 */
function rebuildAll(){
  // Debounce: collapse rapid calls into one
  if(_rebuildTimer){clearTimeout(_rebuildTimer);}
  _rebuildTimer=setTimeout(_doRebuild,30);
}
function _doRebuild(){
  _rebuildTimer=null;
  if(_rebuildRunning)return; // prevent re-entrant calls
  _rebuildRunning=true;
  _pfCache=null; // invalidate cached pro-forma data
  // ── COORDINATE-ORIGIN AUTO-SYNC ──
  // Before every render, force-sync all polygon data from lat/lng → local feet
  // using current _gpsOrigin. This guarantees the lot polygon, every volume's
  // customPolyLocal, and the satellite ground texture share one origin and
  // can never drift apart between Site Map and Site Plan tabs.
  try {
    /* P is `const` in data-model.js, so window.P is undefined. Use bare-name
       reference (resolves through the shared global lexical environment). */
    var _doRebuildHasOrigin = false;
    try { _doRebuildHasOrigin = (typeof P !== 'undefined' && P && P._gpsOrigin); } catch(e){}
    if(typeof realignBuildingToLot === 'function' && _doRebuildHasOrigin && typeof turf !== 'undefined'){
      // Suppress the cascading rebuildAll inside realign — we ARE the rebuild.
      var _origRebuildAll = window.rebuildAll;
      window.rebuildAll = function(){};
      realignBuildingToLot();
      window.rebuildAll = _origRebuildAll;
    }
    if(typeof normalizeLotPolygon === 'function') normalizeLotPolygon();
    // Re-anchor any volume tagged with _relativeToLot (multi-tower podium +
    // towers) to the current lot polygon — guarantees they always render
    // inside the lot regardless of coordinate-system shifts.
    if(typeof window.recomputeRelativeVolumes === 'function') window.recomputeRelativeVolumes();
  } catch(e){ console.warn('[doRebuild] auto-realign failed:', e); }
  try{ rebuildEnvironment(); }catch(e){ console.error('rebuildEnvironment error:',e); }
  try{ rebuildContextBuildings(); }catch(e){ console.error('rebuildContextBuildings error:',e); }
  try{ rebuildLot(); }catch(e){ console.error('rebuildLot error:',e); }
  try{ rebuildSetbacks(); }catch(e){ console.error('rebuildSetbacks error:',e); }
  try{ rebuildIndustrialSurfaces(); }catch(e){ console.error('rebuildIndustrialSurfaces error:',e); }
  try{ rebuildBuilding(); }catch(e){ console.error('rebuildBuilding error:',e); }
  try{ if(typeof _phRebuild === 'function') _phRebuild(); }catch(e){ console.error('_phRebuild error:',e); }
  try{ rebuildLabels(); }catch(e){ console.error('rebuildLabels error:',e); }
  try{ computeAngularPlanes(); renderAngularPlanes(); }catch(e){ console.error('angularPlanes error:',e); }
  try{ updateStats(); }catch(e){ console.error('updateStats error:',e); }
  try{ updateVolInfo(); }catch(e){ console.error('updateVolInfo error:',e); }
  try{ drawSection(); }catch(e){ console.error('drawSection error:',e); }
  try{ updateUnitSummary(); }catch(e){ console.error('updateUnitSummary error:',e); }
  try{ buildFloorSchedule(); }catch(e){ console.error('buildFloorSchedule error:',e); }
  try{
    if(document.getElementById('tab-units')&&document.getElementById('tab-units').classList.contains('active')){
      renderUnitEditor();
    }
  }catch(e){ console.error('renderUnitEditor error:',e); }
  try{ updateInfoBar(); }catch(e){ console.error('updateInfoBar error:',e); }
  try{ updateProForma(); }catch(e){ console.error('updateProForma error:',e); }
  try{ renderReport(); }catch(e){ console.error('renderReport error:',e); }
  try{ if(sec3d.group){ buildSection3DModel(); updateSection3DStats(); } }catch(e){ console.error('section3D error:',e); }
  try{ autoSave(); }catch(e){ console.error('autoSave error:',e); }
  _rebuildRunning=false;
}

/**
 * Clears and rebuilds the environment group (ground plane, roads, landscape items).
 */
function rebuildEnvironment(){
  clearGroup('env');
  const g=groups.env;
  if(!Array.isArray(P.roads)) P.roads=[];
  if(!Array.isArray(P.landscape)) P.landscape=[];

  // Lot bounding box (compute first so ground plane can be centered)
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]), allZ=vts.map(v=>v[1]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const lotMinZ=Math.min(...allZ), lotMaxZ=Math.max(...allZ);
  const cx=f2m((lotMinX+lotMaxX)/2);
  const cz=f2m((lotMinZ+lotMaxZ)/2);

  // Ground plane — centered on lot, with satellite imagery if GPS origin available.
  //
  // Now uses Mapbox raster TILES (the same ones the Site Map tab streams
  // via Mapbox GL JS) instead of the Static Images API. Site Map streams
  // zoom-19 tiles at ~0.15 m/px; this 3D ground now does the same. Trade-
  // off: smaller covered area (since each high-zoom tile covers less
  // ground), so groundSize is reduced from 2400 m to 800 m default. Beyond
  // 800 m the existing farGround (solid mid-grey, 8 km wide) fills in.
  // Larger lots scale groundSize up automatically; the tile-fetch logic
  // picks the highest zoom level that produces ≤ ~80 tiles for the area.
  const groundSize=Math.min(1500, Math.max(800, f2m(Math.max(lotMaxX-lotMinX, lotMaxZ-lotMinZ))*4));
  const groundMat=new THREE.MeshStandardMaterial({color:0x383530,roughness:0.92});
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(groundSize,groundSize), groundMat);
  ground.rotation.x=-Math.PI/2;
  ground.position.set(cx,-0.05,cz);
  ground.receiveShadow=true;
  g.add(ground);

  // Fallback far-field underlay — solid matte ground that extends to ±4000 m
  // so the camera never sees void/sky at the horizon. Sits 5 cm below the
  // satellite plane so it's only visible BEYOND the satellite extent.
  // Cheap (single quad), no texture, no shadows — purely visual horizon fill.
  const farGroundMat = new THREE.MeshBasicMaterial({color:0x2a2a2a});
  const farGround = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), farGroundMat);
  farGround.rotation.x = -Math.PI / 2;
  farGround.position.set(cx, -0.10, cz);
  farGround.receiveShadow = false;
  g.add(farGround);

  // ── SATELLITE IMAGERY TEXTURE ──
  // Fetches a Mapbox satellite tile for the ground plane area via Static Images API.
  // Caches the raw HTMLImageElement so it survives clearGroup disposal.
  var _satToken = (typeof mapboxgl !== 'undefined' && mapboxgl.accessToken)
    ? mapboxgl.accessToken
    : (typeof localStorage !== 'undefined' ? localStorage.getItem('oleadev_mapbox_token') : null);

  if(!P._gpsOrigin){ console.log('[SAT] Skipped — no GPS origin (draw lot on Site Map first)'); }
  else if(!_satToken){ console.log('[SAT] Skipped — no Mapbox token (open Site Map tab first)'); }

  if(P._gpsOrigin && _satToken){
    try {
      var originLng = P._gpsOrigin.lng, originLat = P._gpsOrigin.lat;
      var halfG = groundSize / 2;

      // Convert ground plane edges from meters to feet, then to degree offsets
      // Coordinate system: X+ = East, Z+ = South, origin = P._gpsOrigin
      var westM = cx - halfG, eastM = cx + halfG;
      var northM = cz - halfG, southM = cz + halfG;

      var mPerDegLat = 111132;
      var mPerDegLng = 111132 * Math.cos(originLat * Math.PI / 180);

      var bboxWest = originLng + westM / mPerDegLng;
      var bboxEast = originLng + eastM / mPerDegLng;
      // Z+ = South, so larger Z = further south = lower latitude
      var bboxNorth = originLat - northM / mPerDegLat;
      var bboxSouth = originLat - southM / mPerDegLat;

      // Ensure south < north for bbox format [west,south,east,north]
      if(bboxSouth > bboxNorth){ var _tmp=bboxSouth; bboxSouth=bboxNorth; bboxNorth=_tmp; }

      // ── MAPBOX RASTER-TILE STRATEGY ───────────────────────────────────
      // The Site Map tab streams Mapbox satellite tiles at zoom 18-19 via
      // Mapbox GL JS, giving ~0.15-0.30 m/px. The previous Static Images
      // mosaic approach maxed out at ~0.47 m/px regardless of zoom. To
      // match Site Map quality, fetch the same raster tiles directly:
      //
      //   https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90
      //
      // Each tile is 256×256 logical / 512×512 actual at @2x. Compute
      // the tile range covering the bbox, fetch every tile in parallel,
      // composite onto a canvas, then crop to the EXACT target bbox
      // (tiles align to a global grid so they overhang slightly).
      // Zoom is auto-picked: highest zoom whose grid is ≤ 9 tiles wide
      // (so we never blow up to 100+ API calls). For default ~800 m
      // ground extent that's zoom 18 (5-7 tiles wide).
      //
      // Cost: tile count grows with bbox area. The cache (bbox+zoom keyed)
      // means repeat rebuilds at the same lot reuse the composited canvas
      // without re-fetching.
      var TILE_PX = 512;     // 256 logical × @2x = 512 actual pixels per tile

      // Web Mercator tile-coordinate helpers
      function _lngToTileX(lng, z){ return ((lng + 180) / 360) * Math.pow(2, z); }
      function _latToTileY(lat, z){
        var r = lat * Math.PI / 180;
        return (1 - Math.log(Math.tan(r) + 1/Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
      }
      function _tileXToLng(x, z){ return x / Math.pow(2, z) * 360 - 180; }
      function _tileYToLat(y, z){
        var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
        return Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))) * 180 / Math.PI;
      }

      // Pick the optimal zoom level for this bbox so the tile grid is
      // ≤ maxTilesWide tiles wide — sweet spot between resolution and
      // API cost. Walks zooms 19 → 12 picking the highest acceptable.
      function _pickZoom(W, S, E, N, maxTilesWide){
        for(var z = 19; z >= 12; z--){
          var nx = Math.ceil(_lngToTileX(E, z)) - Math.floor(_lngToTileX(W, z));
          if(nx <= maxTilesWide) return z;
        }
        return 12;
      }
      var SAT_ZOOM = _pickZoom(bboxWest, bboxSouth, bboxEast, bboxNorth, 9);

      // Tile range covering the bbox (inclusive)
      var minTX = Math.floor(_lngToTileX(bboxWest,  SAT_ZOOM));
      var maxTX = Math.floor(_lngToTileX(bboxEast,  SAT_ZOOM));
      var minTY = Math.floor(_latToTileY(bboxNorth, SAT_ZOOM));
      var maxTY = Math.floor(_latToTileY(bboxSouth, SAT_ZOOM));
      var nTX = maxTX - minTX + 1;
      var nTY = maxTY - minTY + 1;
      var nTiles = nTX * nTY;
      var rawCanvasW = nTX * TILE_PX;
      var rawCanvasH = nTY * TILE_PX;

      // Tile-aligned bbox (slightly larger than target — used to compute
      // crop offsets so we end up with a canvas that exactly covers the
      // target bbox, not the tile-aligned superset).
      var tileW = _tileXToLng(minTX,         SAT_ZOOM);
      var tileE = _tileXToLng(maxTX + 1,     SAT_ZOOM);
      var tileN = _tileYToLat(minTY,         SAT_ZOOM);
      var tileS = _tileYToLat(maxTY + 1,     SAT_ZOOM);

      console.log('[SAT] zoom=' + SAT_ZOOM + ', ' + nTX + '×' + nTY + '=' +
                  nTiles + ' tiles for ' + Math.round(groundSize) + 'm extent (~' +
                  (groundSize / Math.min(rawCanvasW, rawCanvasH)).toFixed(3) + ' m/px)');

      // Cache key includes zoom + tile range so different zooms don't collide
      var _satKey = SAT_ZOOM + '/' + minTX + '_' + minTY + '_' + maxTX + '_' + maxTY;

      // Static-Images single-tile fallback URL — used if any tile fetch fails.
      var satUrl = 'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/'
        + '[' + bboxWest.toFixed(6) + ',' + bboxSouth.toFixed(6) + ','
        + bboxEast.toFixed(6) + ',' + bboxNorth.toFixed(6) + ']'
        + '/1280x1280@2x?access_token=' + _satToken;

      // Helper: create a fresh texture from an image / canvas with
      // mipmapping + anisotropic filtering, then apply it to the ground
      // mesh. Anisotropic filtering is the single biggest perceived-
      // quality win for ground textures viewed at oblique angles.
      function _applySatToGround(imgOrCanvas, targetMesh){
        var tex = new THREE.CanvasTexture(imgOrCanvas);
        tex.encoding = THREE.sRGBEncoding;
        tex.minFilter = THREE.LinearMipmapLinearFilter;   // mipmaps when minified
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        if(typeof renderer !== 'undefined' && renderer && renderer.capabilities){
          tex.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy() || 1);
        }
        targetMesh.material.dispose();
        targetMesh.material = new THREE.MeshStandardMaterial({map:tex, roughness:0.95, metalness:0.0});
        targetMesh.receiveShadow = true;
        var dim = (imgOrCanvas.width || imgOrCanvas.naturalWidth || 0);
        console.log('[SAT] Texture applied: ' + dim + '×' + dim +
                    ', anisotropy=' + tex.anisotropy + ', mipmaps=on');
      }

      function _findGroundAndApply(imgOrCanvas){
        var envG = groups.env;
        if(!envG){ console.warn('[SAT] No env group found'); return; }
        for(var ci=0; ci<envG.children.length; ci++){
          var ch = envG.children[ci];
          if(ch.isMesh && ch.geometry && ch.position.y < 0){
            _applySatToGround(imgOrCanvas, ch);
            return;
          }
        }
        console.warn('[SAT] Ground mesh not found in env group');
      }

      if(window._satImgCache && window._satImgCache.key === _satKey && window._satImgCache.img){
        _findGroundAndApply(window._satImgCache.img);
      } else {
        var _fetchId = (window._satFetchId = (window._satFetchId || 0) + 1);
        var rawCanvas = document.createElement('canvas');
        rawCanvas.width  = rawCanvasW;
        rawCanvas.height = rawCanvasH;
        var rawCtx = rawCanvas.getContext('2d');
        var loaded = 0;
        var failed = false;

        function _composeAndApply(){
          if(_fetchId !== window._satFetchId) return;   // a newer fetch superseded
          // Crop the tile-aligned canvas to the EXACT target bbox.
          // canvas y=0 is top (north), y=H is bottom (south).
          var srcX = (bboxWest  - tileW) / (tileE - tileW) * rawCanvasW;
          var srcY = (tileN     - bboxNorth) / (tileN - tileS) * rawCanvasH;
          var srcW = (bboxEast  - bboxWest) / (tileE - tileW) * rawCanvasW;
          var srcH = (tileN     - bboxSouth) / (tileN - tileS) * rawCanvasH;
          var cropCanvas = document.createElement('canvas');
          cropCanvas.width  = Math.max(2, Math.round(srcW));
          cropCanvas.height = Math.max(2, Math.round(srcH));
          cropCanvas.getContext('2d').drawImage(
            rawCanvas, srcX, srcY, srcW, srcH,
            0, 0, cropCanvas.width, cropCanvas.height
          );
          window._satImgCache = {key: _satKey, img: cropCanvas};
          console.log('[SAT] ' + nTiles + '-tile mosaic composited + cropped to ' +
                      cropCanvas.width + '×' + cropCanvas.height);
          _findGroundAndApply(cropCanvas);
        }

        function _fallbackToSingleTile(){
          if(_fetchId !== window._satFetchId) return;
          console.warn('[SAT] Falling back to Static Images single-tile fetch');
          var fb = new Image();
          fb.crossOrigin = 'anonymous';
          fb.onload = function(){
            if(_fetchId !== window._satFetchId) return;
            window._satImgCache = {key: _satKey, img: fb};
            _findGroundAndApply(fb);
          };
          fb.onerror = function(){ console.error('[SAT] Fallback also failed.'); };
          fb.src = satUrl;
        }

        // Fire all tile requests in parallel
        for(var ty = minTY; ty <= maxTY; ty++){
          for(var tx = minTX; tx <= maxTX; tx++){
            (function(tx, ty){
              var url = 'https://api.mapbox.com/v4/mapbox.satellite/' +
                        SAT_ZOOM + '/' + tx + '/' + ty +
                        '@2x.jpg90?access_token=' + _satToken;
              var img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = function(){
                if(_fetchId !== window._satFetchId) return;
                if(failed) return;
                rawCtx.drawImage(
                  img,
                  (tx - minTX) * TILE_PX,
                  (ty - minTY) * TILE_PX,
                  TILE_PX, TILE_PX
                );
                loaded++;
                if(loaded === nTiles) _composeAndApply();
              };
              img.onerror = function(){
                if(failed) return;
                failed = true;
                console.warn('[SAT] Tile ' + SAT_ZOOM + '/' + tx + '/' + ty + ' failed.');
                _fallbackToSingleTile();
              };
              img.src = url;
            })(tx, ty);
          }
        }
      }
    } catch(e){ console.error('[SAT] Error:', e); }
  }

  // ── ROADS (dynamic array, togglable) ──
  if(P._showRoads===false){/* skip roads */} else {
  P.roads.forEach(rd=>{
    const roadW=f2m(rd.width);
    const angleRad=rd.angle*Math.PI/180;
    let rX=cx, rZ=0;
    if(rd.side==='north') rZ=f2m(lotMinZ)+f2m(rd.offZ)-roadW/2;
    else if(rd.side==='south') rZ=f2m(lotMaxZ)+f2m(rd.offZ)+roadW/2;
    else if(rd.side==='east'){ rX=f2m(lotMaxX)+f2m(rd.offZ)+roadW/2; rZ=cz; }
    else if(rd.side==='west'){ rX=f2m(lotMinX)+f2m(rd.offZ)-roadW/2; rZ=cz; }

    const roadGrp=new THREE.Group();
    const isEW=(rd.side==='east'||rd.side==='west');
    const roadLen=150;

    // Road surface
    const rGeo=new THREE.PlaneGeometry(isEW?roadW:roadLen, isEW?roadLen:roadW);
    const rMesh=new THREE.Mesh(rGeo,new THREE.MeshStandardMaterial({color:'#333340',roughness:0.8}));
    rMesh.rotation.x=-Math.PI/2;
    roadGrp.add(rMesh);

    // Centre dashes
    for(let i=-25;i<25;i++){
      const dW=isEW?0.15:1.5, dH=isEW?1.5:0.15;
      const dash=new THREE.Mesh(new THREE.PlaneGeometry(dW,dH),new THREE.MeshBasicMaterial({color:'#AEBC46'}));
      dash.rotation.x=-Math.PI/2;
      dash.position.set(isEW?0:i*3, 0.02, isEW?i*3:0);
      roadGrp.add(dash);
    }

    // Sidewalks
    [-1,1].forEach(s=>{
      const swGeo=isEW?new THREE.PlaneGeometry(2,roadLen):new THREE.PlaneGeometry(roadLen,2);
      const sw=new THREE.Mesh(swGeo,new THREE.MeshStandardMaterial({color:'#555560',roughness:0.7}));
      sw.rotation.x=-Math.PI/2;
      sw.position.set(isEW?s*(roadW/2+1):0, 0.02, isEW?0:s*(roadW/2+1));
      roadGrp.add(sw);
    });

    roadGrp.position.set(rX,0.01,rZ);
    roadGrp.rotation.y=angleRad;
    g.add(roadGrp);

    // Road label (3D text sprite)
    const labelX=isEW?rX:rX;
    const labelZ=isEW?rZ:rZ;
    addTextSprite(g, rd.label, labelX, 0.3, labelZ, '#AEBC46', rd.fontSize/14*0.8);
  });
  } // end if _showRoads

  // ── LANDSCAPE (user-placed trees & bushes) ──
  P.landscape.forEach(item=>{
    const x=f2m(item.x), z=f2m(item.z);
    if(item.type==='tree') addTree(g,x,z);
    else if(item.type==='bush'){
      const shrub=new THREE.Mesh(new THREE.SphereGeometry(0.5,6,6),
        new THREE.MeshStandardMaterial({color:'#2d6b30',roughness:0.8}));
      shrub.position.set(x,0.5,z);shrub.castShadow=true;g.add(shrub);
    } else if(item.type==='tree-row'){
      const count=item.count||5;
      const dx=Math.cos((item.angle||0)*Math.PI/180)*f2m(item.spacing||10);
      const dz=Math.sin((item.angle||0)*Math.PI/180)*f2m(item.spacing||10);
      for(let t=0;t<count;t++) addTree(g,x+t*dx,z+t*dz);
    } else if(item.type==='bush-row'){
      const count=item.count||8;
      const dx=Math.cos((item.angle||0)*Math.PI/180)*f2m(item.spacing||5);
      const dz=Math.sin((item.angle||0)*Math.PI/180)*f2m(item.spacing||5);
      for(let t=0;t<count;t++){
        const s=new THREE.Mesh(new THREE.SphereGeometry(0.4,6,6),
          new THREE.MeshStandardMaterial({color:`hsl(${110+Math.random()*30},50%,${25+Math.random()*12}%)`,roughness:0.8}));
        s.position.set(x+t*dx,0.4,z+t*dz);s.castShadow=true;g.add(s);
      }
    }
  });
}

function addTree(g,x,z){
  const trunk=new THREE.Mesh(
    new THREE.CylinderGeometry(0.15,0.2,2.5,6),
    new THREE.MeshStandardMaterial({color:'#5a4030'})
  );
  trunk.position.set(x,1.25,z);
  trunk.castShadow=true;
  g.add(trunk);
  const canopy=new THREE.Mesh(
    new THREE.SphereGeometry(1.5,8,8),
    new THREE.MeshStandardMaterial({color:'#2d6b30',roughness:0.8})
  );
  canopy.position.set(x,3.5,z);
  canopy.castShadow=true;
  g.add(canopy);
}

/**
 * Renders neighbouring building footprints (cached in P._contextBuildingFeatures)
 * as muted extruded blocks in the Three.js massing view.
 * Features are captured at lot-draw time by smCaptureContextBuildings() in sitemap-lot.js,
 * when Mapbox tiles are guaranteed to be loaded.
 */
/* Module-level cache of context buildings: footprint polygon (in local feet,
   project convention X+=East / Z+=South) PLUS the neighbour's height in
   metres. Populated by rebuildContextBuildings() and consumed by
   _isEdgeAbuttedByContext() to decide which user-building edges should hide
   their windows / storefront glass per FLOOR, taking neighbour height into
   account (so a 14-storey building next to a 3-storey neighbour only loses
   windows on the bottom 3 floors). */
var _ctxBuildingPolysFt = [];   /* array of { poly: [[x,z],...], heightM: number } */

/* Point-in-polygon test (ray casting) — returns true if (px, pz) is inside
   the polygon. Polygon is array of [x, z] pairs (closing vertex optional). */
function _pointInPolyXZ(px, pz, poly){
  var inside = false;
  for(var i = 0, j = poly.length - 1; i < poly.length; j = i++){
    var xi = poly[i][0], zi = poly[i][1];
    var xj = poly[j][0], zj = poly[j][1];
    if(((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)){
      inside = !inside;
    }
  }
  return inside;
}

/* Per-EDGE abutment check (5-sample majority). Used for the GF storefront
   suppression — there's only one storefront per face, so a coarse check is OK.
   For windows / balconies that need PER-WINDOW or PER-BALCONY granularity,
   use _isPointAbuttedByContext() instead. */
function _isEdgeAbuttedByContext(p0, p1, nx, nz, floorMidYM, walkOutFt){
  if(!Array.isArray(_ctxBuildingPolysFt) || _ctxBuildingPolysFt.length === 0) return false;
  var W = walkOutFt || 4;
  var samples = 5;
  var hits = 0;
  var minNeighbourH = (typeof floorMidYM === 'number') ? Math.max(0.5, floorMidYM) : 0.5;
  for(var s = 1; s <= samples; s++){
    var t = s / (samples + 1);
    var midX = p0[0] + (p1[0] - p0[0]) * t;
    var midZ = p0[1] + (p1[1] - p0[1]) * t;
    var probeX = midX + nx * W;
    var probeZ = midZ + nz * W;
    for(var ci = 0; ci < _ctxBuildingPolysFt.length; ci++){
      var ctx = _ctxBuildingPolysFt[ci];
      if(_pointInPolyXZ(probeX, probeZ, ctx.poly) && ctx.heightM >= minNeighbourH){
        hits++;
        break;
      }
    }
  }
  return hits >= Math.ceil(samples / 2);
}

/* Per-POINT abutment check — used for individual windows and balconies so each
   element gets its own decision (instead of a majority-rules vote across an
   entire edge). Probes a single point `walkOutFt` outward from (xFt, zFt) in
   the (nx, nz) direction; returns true if the probe lands inside a context
   building whose roof reaches at or above floorMidYM (in metres, world Y). */
function _isPointAbuttedByContext(xFt, zFt, nx, nz, floorMidYM, walkOutFt){
  if(!Array.isArray(_ctxBuildingPolysFt) || _ctxBuildingPolysFt.length === 0) return false;
  var W = walkOutFt || 8;
  var probeX = xFt + nx * W;
  var probeZ = zFt + nz * W;
  var minNeighbourH = (typeof floorMidYM === 'number') ? Math.max(0.5, floorMidYM) : 0.5;
  for(var ci = 0; ci < _ctxBuildingPolysFt.length; ci++){
    var ctx = _ctxBuildingPolysFt[ci];
    if(_pointInPolyXZ(probeX, probeZ, ctx.poly) && ctx.heightM >= minNeighbourH){
      return true;
    }
  }
  return false;
}

function rebuildContextBuildings(){
  clearGroup('context');
  var g = groups.context;
  /* Reset the polygon cache — re-populated below as we iterate features. */
  _ctxBuildingPolysFt = [];

  // Need cached features and GPS origin
  if(!P._contextBuildingFeatures || P._contextBuildingFeatures.length === 0) return;
  if(!P._gpsOrigin) return;
  if(typeof turf === 'undefined') return;

  var originLng = P._gpsOrigin.lng;
  var originLat = P._gpsOrigin.lat;

  // Compute lot bounding box in feet for proximity filtering
  var lotV = lotVerts();
  var lotXs = lotV.map(function(v){return v[0];}), lotZs = lotV.map(function(v){return v[1];});
  var lotCx = (Math.min.apply(null,lotXs) + Math.max.apply(null,lotXs)) / 2;
  var lotCz = (Math.min.apply(null,lotZs) + Math.max.apply(null,lotZs)) / 2;
  var maxRadius = 3500; // feet (≈1067 m) — bumped from 1500 to render context buildings beyond 1 km

  // Shared material for context buildings — slightly warm grey, substantial
  // opacity so they read as solid context masses while still looking subordinate
  // to the user's main design.  side:DoubleSide is required because we negate
  // shape-Y below to fix the N/S mirroring bug — that flip reverses polygon
  // winding, so without DoubleSide the side faces of each building would be
  // back-face culled and only the rooftop would render.
  var ctxMat = new THREE.MeshStandardMaterial({
    color: 0xa8a8a8,
    roughness: 0.85,
    metalness: 0.05,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide
  });

  P._contextBuildingFeatures.forEach(function(bldg){
    var outerRing = bldg.coords;
    if(!outerRing || outerRing.length < 4) return;

    var heightM = bldg.height;
    var minHeightM = bldg.minHeight || 0;
    var heightFt = heightM * 3.28084;
    var minHeightFt = minHeightM * 3.28084;
    var extrudeH = heightFt - minHeightFt;
    if(extrudeH <= 0) return;

    // Convert GPS coordinates to local feet (project convention: X+ = East, Z+ = South).
    //
    // KEY FIX: shape's Y is set to -zFt (north-positive), not +zFt (south-positive).
    // This is because the mesh is rotated by `mesh.rotation.x = -π/2` below, which
    // maps shape's +Y axis to world's -Z. With the previous +zFt, a building south
    // of origin (zFt > 0) ended up at world -Z (north of origin) — mirrored across
    // the E-W axis. Negating zFt here puts it back where it belongs.
    var shapePts = [];
    var polyFt = [];        /* xFt, zFt pairs for the abutment-check cache */
    var centroidX = 0, centroidZ = 0;
    for(var i = 0; i < outerRing.length - 1; i++){ // skip closing duplicate vertex
      var lng = outerRing[i][0], lat = outerRing[i][1];
      var xM = turf.distance(turf.point([originLng, originLat]), turf.point([lng, originLat]), {units:'meters'});
      var xFt = xM * 3.28084 * (lng > originLng ? 1 : -1);
      var zM = turf.distance(turf.point([originLng, originLat]), turf.point([originLng, lat]), {units:'meters'});
      var zFt = zM * 3.28084 * (lat < originLat ? 1 : -1);
      shapePts.push(new THREE.Vector2(f2m(xFt), -f2m(zFt)));  /* note negated Y */
      polyFt.push([xFt, zFt]);
      centroidX += xFt;
      centroidZ += zFt;
    }
    if(shapePts.length < 3) return;
    centroidX /= shapePts.length;
    centroidZ /= shapePts.length;

    // Proximity filter: skip buildings too far from lot centre
    var dx = centroidX - lotCx, dz = centroidZ - lotCz;
    if(Math.sqrt(dx*dx + dz*dz) > maxRadius) return;

    /* Push this building's polygon (in local feet) AND its height (metres)
       into the cache so the user-building renderer can detect per-floor
       abutment — a neighbour only blocks windows on floors at or below its
       roof height. */
    _ctxBuildingPolysFt.push({ poly: polyFt, heightM: heightM || 0 });

    // Create extruded geometry
    try {
      var shape = new THREE.Shape(shapePts);
      var extGeo = new THREE.ExtrudeGeometry(shape, {
        depth: f2m(extrudeH),
        bevelEnabled: false
      });
      // ExtrudeGeometry extrudes along Z — rotate so it goes up (Y)
      var mesh = new THREE.Mesh(extGeo, ctxMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = f2m(minHeightFt);
      mesh.receiveShadow = true;
      g.add(mesh);
    } catch(e){
      // Skip malformed geometries silently
    }
  });
}

function rebuildLot(){
  clearGroup('lot');
  const g=groups.lot;
  const vts=lotVerts();

  // Center camera and lights on lot centroid
  const lb=lotBounds();
  const lotCenterX=f2m((lb.minX+lb.maxX)/2);
  const lotCenterZ=f2m((lb.minZ+lb.maxZ)/2);
  const lotMaxDim=Math.max(f2m(lb.width),f2m(lb.depth));
  if(lotMaxDim>0.5){
    orb.target.set(lotCenterX, 5, lotCenterZ);
    orb.dist=Math.max(30, lotMaxDim*1.8);
    // Move directional light to cover the lot
    const dirLight=scene.children.find(c=>c.isDirectionalLight);
    if(dirLight){
      dirLight.position.set(lotCenterX-20, 40, lotCenterZ-30);
      dirLight.target.position.set(lotCenterX, 0, lotCenterZ);
      dirLight.target.updateMatrixWorld();
      const s=Math.max(60, lotMaxDim*1.2);
      dirLight.shadow.camera.left=-s;dirLight.shadow.camera.right=s;
      dirLight.shadow.camera.top=s;dirLight.shadow.camera.bottom=-s;
      dirLight.shadow.camera.updateProjectionMatrix();
    }
  }

  // Lot outline — ALWAYS render so the user can visually verify the property
  // boundary against the satellite imagery, especially when the building
  // extends past the lot (large massing on a small parcel). When buildings
  // exist we draw it in a brighter "alert" colour at a slightly raised Y so
  // it's visible above the satellite ground and reads as a "property line".
  {
    const hasVols = P.vols && P.vols.length > 0;
    const outlineColor = hasVols ? '#ff3300' : '#AEBC46';
    /* CRITICAL: outline MUST be at the SAME Y as the building footprint
       (essentially ground level) so it visually aligns with the building edge
       in 3D perspective. Drawing it above (Y=1m) causes parallax — the line
       appears offset from the building when viewed at a tilt, even though
       the X/Z coords match exactly. depthTest:false + high renderOrder lets
       it draw THROUGH the building so it's always visible. */
    const outlineY = 0.05;
    const pts=vts.map(v=>new THREE.Vector3(f2m(v[0]),outlineY,f2m(v[1])));
    pts.push(pts[0].clone());
    const lineGeo=new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat=new THREE.LineBasicMaterial({color:outlineColor,linewidth:3,toneMapped:false,depthTest:false,transparent:true,opacity:0.95});
    const line=new THREE.Line(lineGeo,lineMat);
    line.renderOrder = 999;
    g.add(line);

    /* Console diagnostic — helps you compare the lot's actual size against
       what each building volume is set to. If a volume's width/depth is much
       larger than the lot, the building will extend past the property line.
       Also flags volumes whose customPolyLocal is OFFSET from the current lot
       polygon (typical cause of "building doesn't sit on the parcel"). */
    if(hasVols){
      var lbDiag = lotBounds();
      var lotW = Math.round(lbDiag.width), lotD = Math.round(lbDiag.depth);
      var lotArea = 0;
      /* Shoelace formula for area in sq ft. */
      for(var pi=0; pi<vts.length; pi++){
        var pj = (pi + 1) % vts.length;
        lotArea += (vts[pi][0] * vts[pj][1] - vts[pj][0] * vts[pi][1]);
      }
      lotArea = Math.abs(lotArea / 2);
      /* Lot vertex count for shape-match comparison (excluding the closing
         duplicate vertex). */
      var lotVtxCount = vts.length;
      if(lotVtxCount > 1 && vts[0][0] === vts[lotVtxCount-1][0] && vts[0][1] === vts[lotVtxCount-1][1]) lotVtxCount--;

      /* Lot area for comparison against volume polygon area. */
      var volSummary = P.vols.map(function(v){
        var hasPoly = Array.isArray(v.customPolyLocal) && v.customPolyLocal.length >= 3;
        if(!hasPoly){
          return v.name + ': ' + (v.width||0) + "'x" + (v.depth||0) + "' [RECT - does NOT match lot polygon - click Match Lot]";
        }
        /* Check both bbox and SHAPE: a 4-vertex rectangle filling the lot's
           bbox would score "matched" on bbox alone but render as a rectangle,
           overshooting any concave notches in an L/stepped lot. */
        var vXs = v.customPolyLocal.map(function(p){return p[0];});
        var vZs = v.customPolyLocal.map(function(p){return p[1];});
        var vMinX = Math.min.apply(null, vXs), vMinZ = Math.min.apply(null, vZs);
        var vMaxX = Math.max.apply(null, vXs), vMaxZ = Math.max.apply(null, vZs);
        var dx = vMinX - lbDiag.minX, dz = vMinZ - lbDiag.minZ;
        if(Math.abs(dx) > 2 || Math.abs(dz) > 2){
          return v.name + ': [POLYGON OFFSET by dx=' + Math.round(dx) + "', dz=" + Math.round(dz) + "' - click Match Lot]";
        }
        /* Vertex count comparison — if lot has 6 verts but volume has 4,
           the volume is a rectangle approximation, not the real shape. */
        var volVtxCount = v.customPolyLocal.length;
        if(volVtxCount > 1 && v.customPolyLocal[0][0] === v.customPolyLocal[volVtxCount-1][0] &&
           v.customPolyLocal[0][1] === v.customPolyLocal[volVtxCount-1][1]) volVtxCount--;
        /* Polygon area via shoelace. */
        var volArea = 0;
        for(var vai=0; vai<volVtxCount; vai++){
          var vaj = (vai+1) % volVtxCount;
          volArea += (v.customPolyLocal[vai][0]*v.customPolyLocal[vaj][1] - v.customPolyLocal[vaj][0]*v.customPolyLocal[vai][1]);
        }
        volArea = Math.abs(volArea/2);
        var areaDelta = volArea - lotArea;
        var shapeOK = (volVtxCount === lotVtxCount) && Math.abs(areaDelta) < (lotArea * 0.02); /* within 2% */
        if(!shapeOK){
          return v.name + ': [SHAPE MISMATCH — volume has ' + volVtxCount + ' verts ('+Math.round(volArea).toLocaleString()+' sf) vs lot ' + lotVtxCount + ' verts ('+Math.round(lotArea).toLocaleString()+' sf) - click Match Lot]';
        }
        return v.name + ': [POLYGON-MATCHED] ' + volVtxCount + ' verts, ' + Math.round(volArea).toLocaleString() + ' sf';
      }).join('  |  ');
      console.log('[Lot] bounds: ' + lotW + ' x ' + lotD + ' ft (' + Math.round(lotArea).toLocaleString() + ' sq ft, ' + lotVtxCount + ' vertices)');
      console.log('[Volumes] ' + volSummary);

      /* Print actual vertices of both polygons side-by-side so we can detect
         a per-vertex discrepancy that summary stats don't catch (e.g. polygons
         with identical bbox/area but mirror-image shapes, vertex-rotation, or
         a single vertex shifted). */
      console.log('[Lot] vertices (xFt, zFt):');
      vts.forEach(function(v, i){
        if(i < lotVtxCount) console.log('  '+i+': ['+Math.round(v[0])+', '+Math.round(v[1])+']');
      });
      P.vols.forEach(function(v){
        if(!Array.isArray(v.customPolyLocal) || v.customPolyLocal.length < 3) return;
        var vCount = v.customPolyLocal.length;
        if(vCount > 1 && v.customPolyLocal[0][0] === v.customPolyLocal[vCount-1][0] &&
           v.customPolyLocal[0][1] === v.customPolyLocal[vCount-1][1]) vCount--;
        console.log('[Volume '+v.name+'] customPolyLocal vertices (xFt, zFt):');
        for(var pvi = 0; pvi < vCount; pvi++){
          console.log('  '+pvi+': ['+Math.round(v.customPolyLocal[pvi][0])+', '+Math.round(v.customPolyLocal[pvi][1])+']');
        }
      });
    }
    /* Skip the transparent fill / corner labels when buildings are present —
       the simple outline is enough to read the property boundary. */
    if(hasVols){
      /* Done — outline only. */
    } else {

    // Lot fill (transparent)
    const shape=new THREE.Shape();
    shape.moveTo(f2m(vts[0][0]),f2m(vts[0][1]));
    for(let i=1;i<vts.length;i++) shape.lineTo(f2m(vts[i][0]),f2m(vts[i][1]));
    shape.closePath();
    const fillGeo=new THREE.ShapeGeometry(shape);
    const fill=new THREE.Mesh(fillGeo,new THREE.MeshBasicMaterial({color:'#AEBC46',transparent:true,opacity:0.08}));
    fill.rotation.x=-Math.PI/2;
    fill.position.y=0.03;
    g.add(fill);
    }   /* end else (no buildings) */
  }   /* end lot-outline block */

  // Dimension labels on lot edges
  for(let i=0;i<vts.length;i++){
    const j=(i+1)%vts.length;
    const dx=vts[j][0]-vts[i][0], dz=vts[j][1]-vts[i][1];
    const len=Math.sqrt(dx*dx+dz*dz);
    if(len<5)continue;
    const mx=f2m((vts[i][0]+vts[j][0])/2);
    const mz=f2m((vts[i][1]+vts[j][1])/2);
    // Offset label outward from lot center
    const cx=f2m(vts.reduce((s,v)=>s+v[0],0)/vts.length);
    const cz=f2m(vts.reduce((s,v)=>s+v[1],0)/vts.length);
    const nx=mx-cx,nz=mz-cz;
    const nd=Math.sqrt(nx*nx+nz*nz)||1;
    addTextSprite(g, Math.round(len)+"'", mx+nx/nd*2.5, 1.5, mz+nz/nd*2.5, '#ffffff', 0.4);
  }
}

function rebuildSetbacks(){
  clearGroup('setbacks');
  const g=groups.setbacks;
  g.visible=false; // hidden by default — toggle via setbacks panel if needed
  const vts=lotVerts();
  const S=P.set;

  // Bail out if lot has insufficient vertices (e.g. after CLEAR LOT before redraw).
  // Without this guard, accessing vts[5] / vts[4] threw "can't access property 0,
  // vts[5] is undefined" which cascaded and broke other rebuild steps.
  if(!Array.isArray(vts) || vts.length < 2) return;

  // Simple dashed setback lines
  // Front (North) setback at z = front
  if(S.front>0 && vts[0] && vts[1]){
    const z=f2m(S.front);
    const pts=[new THREE.Vector3(f2m(vts[0][0])-2,0.06,z),new THREE.Vector3(f2m(vts[1][0])+2,0.06,z)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#ff6644',dashSize:0.5,gapSize:0.3})));
  }
  // Rear (South) setback — needs at least 6 vertices (uses vts[4] and vts[5])
  const maxZ=lotBounds().maxZ;
  if(S.rear>0 && vts.length >= 6 && vts[4] && vts[5]){
    const z=f2m(maxZ-S.rear);
    const pts=[new THREE.Vector3(f2m(vts[5][0])-2,0.06,z),new THREE.Vector3(f2m(vts[4][0])+2,0.06,z)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#ff6644',dashSize:0.5,gapSize:0.3})));
    g.children[g.children.length-1].computeLineDistances();
  }
}

// ── Procedural texture generators (canvas-based, no external files) ──
const _texCache={};
let _texCacheSize=0;
function clearTexCache(){
  for(const k in _texCache){if(_texCache[k]&&_texCache[k].dispose)_texCache[k].dispose();delete _texCache[k];}
  _texCacheSize=0;
}
function makeWindowTex(w,h,cols,rows,glassCol,frameCol,spandrelCol){
  const key=`win_${w}_${h}_${cols}_${rows}_${glassCol}`;
  if(_texCache[key]) return _texCache[key];
  const cw2=1024,ch2=1024;
  const cv=document.createElement('canvas');cv.width=cw2;cv.height=ch2;
  const ctx=cv.getContext('2d');
  // Spandrel background
  ctx.fillStyle=spandrelCol||'#c8c0b0';ctx.fillRect(0,0,cw2,ch2);
  const cellW=cw2/cols, cellH=ch2/rows;
  const pad=Math.round(cw2/cols*0.08), framePx=Math.max(2,Math.round(cw2/cols*0.04));
  const mullion=Math.max(1,Math.round(framePx*0.5));
  for(let r=0;r<rows;r++){
    // Horizontal spandrel band between floor rows
    const bandH=Math.round(cellH*0.12);
    const bandY=r*cellH;
    const sc=spandrelCol||'#c8c0b0';
    // Darken spandrel band
    ctx.fillStyle=_darkenHex(sc,20);
    ctx.fillRect(0,bandY,cw2,bandH);
    for(let c=0;c<cols;c++){
      const x=c*cellW+pad, y=r*cellH+pad+bandH*0.5, ww=cellW-pad*2, hh=cellH-pad*2-bandH*0.5;
      if(ww<=0||hh<=0)continue;
      // Frame
      ctx.fillStyle=frameCol||'#2a2a2a';ctx.fillRect(x,y,ww,hh);
      // Glass pane with gradient (darker at top, lighter at bottom simulating sky reflection)
      const gx=x+framePx,gy=y+framePx,gw=ww-framePx*2,gh=hh-framePx*2;
      if(gw<=0||gh<=0)continue;
      // Lit interior window? (10-15% chance, warm glow)
      const isLit=Math.random()<0.12;
      if(isLit){
        const litGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
        const warmR=200+Math.floor(Math.random()*55);
        const warmG=160+Math.floor(Math.random()*60);
        const warmB=80+Math.floor(Math.random()*40);
        litGrad.addColorStop(0,`rgba(${warmR},${warmG},${warmB},0.95)`);
        litGrad.addColorStop(1,`rgba(${Math.max(warmR-30,100)},${Math.max(warmG-40,80)},${warmB-20},0.85)`);
        ctx.fillStyle=litGrad;ctx.fillRect(gx,gy,gw,gh);
      } else {
        const glGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
        const gc=glassCol||'#6b8fa8';
        glGrad.addColorStop(0,_darkenHex(gc,15));
        glGrad.addColorStop(0.6,gc);
        glGrad.addColorStop(1,_lightenHex(gc,12));
        ctx.fillStyle=glGrad;ctx.fillRect(gx,gy,gw,gh);
        // Reflection highlight
        ctx.fillStyle='rgba(180,210,240,0.13)';
        ctx.fillRect(gx+2,gy+2,gw*0.35,gh*0.5);
      }
      // Thin mullion lines (vertical center)
      ctx.fillStyle=frameCol||'#2a2a2a';
      ctx.fillRect(gx+Math.floor(gw/2)-Math.floor(mullion/2),gy,mullion,gh);
      // Horizontal mullion at mid-height
      ctx.fillRect(gx,gy+Math.floor(gh*0.45)-Math.floor(mullion/2),gw,mullion);
    }
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}
// Helpers for hex color manipulation
function _darkenHex(hex,amt){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return '#'+[Math.max(r-amt,0),Math.max(g-amt,0),Math.max(b-amt,0)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function _lightenHex(hex,amt){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return '#'+[Math.min(r+amt,255),Math.min(g+amt,255),Math.min(b+amt,255)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function makeBrickTex(w,h){
  const key=`brick_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  const brickW=24,brickH=10,mortarW=2;
  // Realistic red/orange/brown brick palette — heritage Toronto brick tones
  const baseColors=[
    '#8B3A2A',  // deep red brick
    '#A0442E',  // classic red
    '#934030',  // burnt sienna
    '#7C3320',  // dark red-brown
    '#B05234',  // warm orange-red
    '#6E2E1E',  // dark brown brick
    '#9C4A32',  // medium red
    '#854535',  // red-brown
  ];
  // Mortar — light grey cement
  ctx.fillStyle='#b5afa5';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=brickH+mortarW){
    const offset=(Math.floor(y/(brickH+mortarW))%2)*(brickW/2);
    for(let x=-brickW;x<w+brickW;x+=brickW+mortarW){
      // Per-brick color variation for realistic look
      const bc=baseColors[Math.floor(Math.random()*baseColors.length)];
      let br=parseInt(bc.slice(1,3),16),bg=parseInt(bc.slice(3,5),16),bb=parseInt(bc.slice(5,7),16);
      // Slight hue/brightness shifts per brick
      const hueShift=Math.floor(Math.random()*14)-7;
      const lightShift=Math.floor(Math.random()*18)-9;
      br=Math.max(0,Math.min(255,br+hueShift+lightShift));
      bg=Math.max(0,Math.min(255,bg+Math.floor(hueShift*0.4)+lightShift));
      bb=Math.max(0,Math.min(255,bb+Math.floor(hueShift*0.2)+lightShift));
      // Occasional dark/aged brick (8% chance)
      if(Math.random()<0.08){br=Math.floor(br*0.55);bg=Math.floor(bg*0.55);bb=Math.floor(bb*0.55);}
      // Occasional lighter/weathered brick (5%)
      else if(Math.random()<0.05){br=Math.min(255,br+25);bg=Math.min(255,bg+18);bb=Math.min(255,bb+12);}
      ctx.fillStyle='rgb('+br+','+bg+','+bb+')';
      ctx.fillRect(x+offset,y,brickW,brickH);
      // Subtle surface variation within each brick (horizontal streaks)
      for(let s=0;s<2;s++){
        var sy=y+2+Math.floor(Math.random()*(brickH-4));
        ctx.fillStyle='rgba(0,0,0,'+(0.03+Math.random()*0.06)+')';
        ctx.fillRect(x+offset+1,sy,brickW-2,1);
      }
      // Mortar joint shadow at bottom of brick
      ctx.fillStyle='rgba(0,0,0,0.18)';
      ctx.fillRect(x+offset,y+brickH-1,brickW,1);
      // Mortar joint highlight at top (light catching mortar edge)
      ctx.fillStyle='rgba(255,255,255,0.06)';
      ctx.fillRect(x+offset,y,brickW,1);
      // Mortar joint shadow at right of brick
      ctx.fillStyle='rgba(0,0,0,0.12)';
      ctx.fillRect(x+offset+brickW-1,y,1,brickH);
    }
  }
  // Subtle noise overlay for texture
  const imgData=ctx.getImageData(0,0,w,h);
  const d=imgData.data;
  for(let i=0;i<d.length;i+=4){
    const n=Math.floor(Math.random()*8)-4;
    d[i]=Math.max(0,Math.min(255,d[i]+n));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));
  }
  ctx.putImageData(imgData,0,0);
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeStorefrontTex(w,h){
  const key=`store_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  // Base wall with subtle gradient
  const wallGrad=ctx.createLinearGradient(0,0,0,h);
  wallGrad.addColorStop(0,'#d8d3cb');wallGrad.addColorStop(1,'#ccc7bf');
  ctx.fillStyle=wallGrad;ctx.fillRect(0,0,w,h);
  // Kick plate (bottom 15%) with gradient
  const kickGrad=ctx.createLinearGradient(0,h*0.85,0,h);
  kickGrad.addColorStop(0,'#4a4a4a');kickGrad.addColorStop(1,'#3a3a3a');
  ctx.fillStyle=kickGrad;ctx.fillRect(0,h*0.85,w,h*0.15);
  // Glazing panels
  const panels=Math.max(2,Math.round(w/60));
  const pW=w/panels,pad=4,framePx=3;
  for(let i=0;i<panels;i++){
    const x=i*pW+pad;
    ctx.fillStyle='#1a1a1a';ctx.fillRect(x,h*0.08,pW-pad*2,h*0.76);
    // Glass with reflection gradient
    const gx=x+framePx,gy=h*0.08+framePx,gw=pW-pad*2-framePx*2,gh=h*0.76-framePx*2;
    const glGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
    glGrad.addColorStop(0,'#3a6a80');glGrad.addColorStop(0.4,'#4a7a90');glGrad.addColorStop(1,'#5a8a9a');
    ctx.fillStyle=glGrad;ctx.fillRect(gx,gy,gw,gh);
    // Warm interior glow (slightly more vivid)
    ctx.fillStyle='rgba(255,225,140,0.25)';
    ctx.fillRect(gx+4,gy+gh*0.2,gw*0.45,gh*0.65);
    // Transom bar
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(x,gy+gh*0.85,pW-pad*2,2);
  }
  // Signage band
  ctx.fillStyle='#2e2e2e';ctx.fillRect(0,0,w,h*0.08);
  // Thin line under signage band
  ctx.fillStyle='#555';ctx.fillRect(0,h*0.08-1,w,1);
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeMetalPanelTex(w,h,color){
  const col=color||'#b8bcc0';
  const key=`metal_${w}_${h}_${col}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=col;ctx.fillRect(0,0,w,h);
  // Horizontal panels with thin reveal lines
  const panelCount=Math.max(4,Math.round(h/30));
  const pH=h/panelCount;
  for(let p=0;p<panelCount;p++){
    const py=p*pH;
    // Subtle gradient per panel (lighter at top edge)
    const r=parseInt(col.slice(1,3),16),g2=parseInt(col.slice(3,5),16),b=parseInt(col.slice(5,7),16);
    const varR=Math.floor(Math.random()*6)-3;
    const panelGrad=ctx.createLinearGradient(0,py,0,py+pH);
    panelGrad.addColorStop(0,`rgb(${Math.min(r+8+varR,255)},${Math.min(g2+8+varR,255)},${Math.min(b+8+varR,255)})`);
    panelGrad.addColorStop(1,`rgb(${Math.max(r-3+varR,0)},${Math.max(g2-3+varR,0)},${Math.max(b-3+varR,0)})`);
    ctx.fillStyle=panelGrad;ctx.fillRect(0,py+1,w,pH-2);
    // Reveal line (dark)
    ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(0,py,w,1);
    // Light edge at top of panel
    ctx.fillStyle='rgba(255,255,255,0.08)';ctx.fillRect(0,py+1,w,1);
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeConcretePrecastTex(w,h){
  const key=`concrete_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  // Light grey concrete base
  ctx.fillStyle='#c4c4c0';ctx.fillRect(0,0,w,h);
  // Subtle aggregate noise
  const imgData=ctx.getImageData(0,0,w,h);
  const d=imgData.data;
  for(let i=0;i<d.length;i+=4){
    const n=Math.floor(Math.random()*14)-7;
    d[i]=Math.max(0,Math.min(255,d[i]+n));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+n-2));
  }
  ctx.putImageData(imgData,0,0);
  // Form lines every ~10ft equivalent (horizontal and vertical)
  const formSpacing=Math.round(w/4);
  ctx.strokeStyle='rgba(0,0,0,0.12)';ctx.lineWidth=1;
  for(let fx=formSpacing;fx<w;fx+=formSpacing){
    ctx.beginPath();ctx.moveTo(fx,0);ctx.lineTo(fx,h);ctx.stroke();
  }
  for(let fy=formSpacing;fy<h;fy+=formSpacing){
    ctx.beginPath();ctx.moveTo(0,fy);ctx.lineTo(w,fy);ctx.stroke();
  }
  // Slight discoloration patches
  for(let p=0;p<6;p++){
    const px=Math.random()*w,py=Math.random()*h;
    const pr=20+Math.random()*30;
    ctx.fillStyle=`rgba(${Math.random()>0.5?160:140},${Math.random()>0.5?155:145},${Math.random()>0.5?148:138},0.08)`;
    ctx.beginPath();ctx.arc(px,py,pr,0,Math.PI*2);ctx.fill();
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeGreenRoofTex(w,h){
  const key=`green_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#4a7040';ctx.fillRect(0,0,w,h);
  for(let i=0;i<200;i++){
    ctx.fillStyle=`hsl(${100+Math.random()*40},${40+Math.random()*30}%,${25+Math.random()*20}%)`;
    ctx.beginPath();ctx.arc(Math.random()*w,Math.random()*h,1+Math.random()*3,0,Math.PI*2);ctx.fill();
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

// ═══ MATERIAL LIBRARY (module level, reused across rebuilds) ═══
var MAT = {
  // Brick — red-brown heritage brick
  brick: new THREE.MeshStandardMaterial({color:0x8B3A2A, roughness:0.92, metalness:0.01}),
  brickDark: new THREE.MeshStandardMaterial({color:0x5C2418, roughness:0.95, metalness:0.01}),
  // Concrete — darkened to survive ACES + golden hour without blowing out
  concreteSmooth: new THREE.MeshStandardMaterial({color:0x706860, roughness:0.65, metalness:0.03}),
  concreteDark: new THREE.MeshStandardMaterial({color:0x3a3834, roughness:0.78, metalness:0.04}),
  concreteBoard: new THREE.MeshStandardMaterial({color:0x605a52, roughness:0.9, metalness:0.01}),
  // Metal
  steel: new THREE.MeshStandardMaterial({color:0x6a6a72, roughness:0.28, metalness:0.8}),
  steelDark: new THREE.MeshStandardMaterial({color:0x2e2e34, roughness:0.2, metalness:0.85}),
  corten: new THREE.MeshStandardMaterial({color:0x8b4a2a, roughness:0.7, metalness:0.4}),
  // Wood
  wood: new THREE.MeshStandardMaterial({color:0x9a7a55, roughness:0.75, metalness:0.02}),
  woodDark: new THREE.MeshStandardMaterial({color:0x5a4030, roughness:0.8, metalness:0.02}),
  cedar: new THREE.MeshStandardMaterial({color:0xb08858, roughness:0.7, metalness:0.01}),
  // Glass — blue-tinted reflective
  glass: new THREE.MeshPhysicalMaterial({color:0x8ab8d0, roughness:0.05, metalness:0.3, clearcoat:1.0, clearcoatRoughness:0.02, transparent:true, opacity:0.5, side:THREE.DoubleSide}),
  glassDark: new THREE.MeshPhysicalMaterial({color:0x3a5a6a, roughness:0.08, metalness:0.35, clearcoat:1.0, clearcoatRoughness:0.04, transparent:true, opacity:0.6, side:THREE.DoubleSide}),
  glassSF: new THREE.MeshPhysicalMaterial({color:0x90b8c8, roughness:0.02, metalness:0.2, clearcoat:1.0, transparent:true, opacity:0.4}),
  glassRailing: new THREE.MeshPhysicalMaterial({color:0xc0dde8, roughness:0.01, metalness:0.1, clearcoat:1.0, transparent:true, opacity:0.45, side:THREE.DoubleSide}),
  // Curtain wall
  mullion: new THREE.MeshStandardMaterial({color:0x2e2e34, roughness:0.2, metalness:0.85}),
  spandrel: new THREE.MeshStandardMaterial({color:0x404048, roughness:0.7, metalness:0.06}),
  // Landscape
  greenRoof: new THREE.MeshStandardMaterial({color:0x4a7040, roughness:0.95}),
  planter: new THREE.MeshStandardMaterial({color:0x888078, roughness:0.85, metalness:0.03}),
  shrubA: new THREE.MeshStandardMaterial({color:0x4a7040, roughness:0.95}),
  shrubB: new THREE.MeshStandardMaterial({color:0x2d4a25, roughness:0.92}),
  // Interior
  warmGlow: new THREE.MeshStandardMaterial({color:0xffe0a0, emissive:0xffe0a0, emissiveIntensity:0.3, transparent:true, opacity:0.18, side:THREE.DoubleSide}),
  // Per-unit window glow materials — randomized across building for realistic occupied look.
  // Opacity & emissive intensity are dynamically updated by setLightingPreset().
  // depthWrite:false prevents z-fighting / flickering when orbiting around the building.
  unitGlowWarm: new THREE.MeshStandardMaterial({color:0xffd896, emissive:0xffc070, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  unitGlowCool: new THREE.MeshStandardMaterial({color:0xb8d4ff, emissive:0x90b8ff, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  unitGlowAmber: new THREE.MeshStandardMaterial({color:0xffb060, emissive:0xff8030, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  // Interior unit "back wall" — visible through curtain wall glass to give units depth
  // Soft warm-cream colour. Emissive intensity controlled by setLightingPreset.
  unitInterior: new THREE.MeshStandardMaterial({color:0xe8d8b8, roughness:0.85, emissive:0xffd896, emissiveIntensity:0.0, side:THREE.DoubleSide}),
  intWall: new THREE.MeshStandardMaterial({color:0xf0ebe0, roughness:0.9, side:THREE.DoubleSide}),
  carpet: new THREE.MeshStandardMaterial({color:0x5a5a62, roughness:0.95}),
  // Furniture
  deskMat: new THREE.MeshStandardMaterial({color:0xb89970, roughness:0.7}),
  chairMat: new THREE.MeshStandardMaterial({color:0x3a3a50, roughness:0.8}),
  sofaMat: new THREE.MeshStandardMaterial({color:0x6a5a50, roughness:0.85}),
  ceilingWhite: new THREE.MeshStandardMaterial({color:0xf8f8f0, roughness:0.5}),
  // Terrace furniture
  loungeMat: new THREE.MeshStandardMaterial({color:0x8a8078, roughness:0.7}),
  cushionMat: new THREE.MeshStandardMaterial({color:0xd8d0c0, roughness:0.85}),
  deckingMat: new THREE.MeshStandardMaterial({color:0x9a8060, roughness:0.8, metalness:0.01}),
  // Punched windows (podium) — darker than curtain wall glass
  punchedWin: new THREE.MeshStandardMaterial({color:0x8899aa, roughness:0.3, metalness:0.2})
};

/* mk() mesh helper — r128 skill pattern */
/**
 * Creates a positioned THREE.Mesh with shadow casting and receiving enabled.
 * @param {THREE.BufferGeometry} geo - Mesh geometry.
 * @param {THREE.Material} mat - Mesh material.
 * @param {number} x - X position.
 * @param {number} y - Y position.
 * @param {number} z - Z position.
 * @returns {THREE.Mesh} The constructed mesh.
 */
function mk(geo, mat, x, y, z){
  var m=new THREE.Mesh(geo, mat);
  m.position.set(x||0, y||0, z||0);
  m.castShadow=true;m.receiveShadow=true;
  return m;
}

/* Per-UNIT deterministic randomization helpers for "occupied building" effect
   Bays are grouped into 2-3 bay "units" so contiguous windows share the same
   lit/dark state — looks like real apartments with multiple windows.
   ~65% of units lit; 80% warm, 12% amber, 8% cool. */
function _unitIdx(b, unitWidthBays){
  return Math.floor(b / (unitWidthBays || 2));
}
function _winLit(f, b, seed, unitWidthBays){
  var u = _unitIdx(b, unitWidthBays);
  var x = Math.sin((f+1) * 374.892 + (u+1) * 191.731 + (seed||0) * 53.247) * 10000;
  return (x - Math.floor(x)) > 0.35; // ~65% lit
}
function _winGlowMat(f, b, seed, unitWidthBays){
  var u = _unitIdx(b, unitWidthBays);
  var x = Math.sin((f+1) * 217.331 + (u+1) * 88.471 + (seed||0) * 31.193) * 10000;
  var v = x - Math.floor(x);
  if(v < 0.08) return MAT.unitGlowCool;   // 8% TV-blue
  if(v < 0.20) return MAT.unitGlowAmber;  // 12% amber/warm-orange
  return MAT.unitGlowWarm;                // 80% standard warm
}

/* Curtain wall helper — spandrel + vision glass + mullions + transom per bay per floor
   opts: {glass, mullion, concrete, bayWidth} — defaults to MAT */
function addCurtainWall(parent, ox, oy, oz, w, floors, fh, rotY, opts){
  var o = opts || {};
  var glassMat = o.glass || MAT.glass;
  var mullionMat = o.mullion || MAT.mullion;
  var concMat = o.concrete || MAT.concreteDark;
  // ── backDepthM option ──
  // How deep behind the glass the interior back wall + partition walls + floor
  // slabs are positioned. Default 3.2m simulates real apartment depth so the
  // warm interior is visible through the glass at night (and through the day's
  // tinted glass too).
  //
  // For edges adjacent to a CONCAVE polygon vertex, the renderer overrides this
  // to a shallow value (e.g. 0.6m) so the back wall can't poke through the
  // OPPOSITE facade and appear as a visible white wall outside the building.
  // The night-time interior glow still works — the back wall is just placed
  // immediately behind the glass instead of 3.2m back.
  //
  // (Earlier fix used a binary noBackWall:true skip that left those facades
  // dark at night — backDepthM keeps the glow while killing the artifact.)
  // backDepthM:0 → no back wall at all (concave-adjacent edges).
  // backDepthM:undefined/null → default 3.2m (standard apartment depth).
  // backDepthM:>0 → explicit shallow depth.
  var intDepth;
  if(typeof o.backDepthM === 'number'){
    intDepth = Math.max(0, o.backDepthM);
  } else {
    intDepth = 3.2;
  }
  var skipBackWall = intDepth < 0.01;
  var gr = new THREE.Group();
  var bayW = o.bayWidth || 3.0;
  var nBays = Math.max(1, Math.round(w / bayW));
  var actualBayW = w / nBays;
  var spH = 0.7;
  var visionH = fh - spH;
  var mullW = 0.06, mullD = 0.08;
  // Seed per facade so different facades have different random patterns
  var seed = Math.abs(Math.round((ox + oz * 7.13) * 1000)) % 9999;
  // Group bays into "units" of 2 bays each so contiguous windows share lit state
  var unitWidthBays = 2;
  // Partition + floor-slab depth derived from intDepth — must always be slightly
  // less so the slab doesn't visually clip with adjacent geometry.
  var slabDepth = Math.max(0.2, intDepth - 0.05);
  for(var f = 0; f < floors; f++){
    var fy = f * fh;
    var spMat = (f % 2 === 0) ? concMat : MAT.spandrel;
    // ── INTERIOR BACK WALL (per floor) — visible through glass, gives apartment depth ──
    // One opaque plane spanning the full facade width, positioned `intDepth` inside
    // the glass. Shows as warm-cream surface through transparent curtain wall —
    // looks like room interiors. Skipped entirely when backDepthM:0 was passed
    // (concave-adjacent edges — no interior depth, clean flat facade).
    if(!skipBackWall){
      var backWall = new THREE.Mesh(
        new THREE.PlaneGeometry(w - 0.05, visionH - 0.04),
        MAT.unitInterior
      );
      backWall.position.set(0, fy + spH + visionH / 2, -intDepth);
      gr.add(backWall);
    }
    // ── PARTITION WALLS — vertical dividers between apartment units (every unitWidthBays bays) ──
    // Skip when intDepth is very shallow (concave-edge walls) — partitions wouldn't be visible anyway
    // and could create visual noise.
    if(!skipBackWall && intDepth >= 1.0){
      for(var pw = unitWidthBays; pw < nBays; pw += unitWidthBays){
        var pwx = pw * actualBayW - w / 2;
        // Wall: thin in X (along facade), tall in Y, deep in Z (perpendicular to facade)
        gr.add(mk(
          new THREE.BoxGeometry(0.06, visionH - 0.04, slabDepth),
          MAT.intWall,
          pwx, fy + spH + visionH / 2, -intDepth / 2
        ));
      }
      // ── FLOOR/CEILING SLAB inside each floor — thin horizontal divider at storey lines ──
      // Caps the unit interior so adjacent floors don't blend at night
      gr.add(mk(
        new THREE.BoxGeometry(w - 0.05, 0.08, slabDepth),
        MAT.spandrel,
        0, fy + 0.04, -intDepth / 2
      ));
    }
    for(var b = 0; b < nBays; b++){
      var bx = b * actualBayW - w / 2 + actualBayW / 2;
      // Spandrel panel
      gr.add(mk(new THREE.BoxGeometry(actualBayW - mullW, spH, 0.06), spMat, bx, fy + spH / 2, 0.03));
      // Vision glass
      var vg = new THREE.Mesh(new THREE.PlaneGeometry(actualBayW - mullW * 2, visionH - 0.04), glassMat);
      vg.position.set(bx, fy + spH + visionH / 2, 0.005);
      gr.add(vg);
      // ── INTERIOR UNIT GLOW (lit window effect at night) ──
      // Bright emissive plane positioned slightly IN FRONT of the glass so it isn't
      // dimmed by the tinted/metallic/clearcoated glass material. Same approach as the
      // podium punched-window glows (which sit in front of the opaque window). At day
      // the glow is opacity=0 so it's invisible — only appears at golden hour and night.
      if(_winLit(f, b, seed, unitWidthBays)){
        var glowMat = _winGlowMat(f, b, seed, unitWidthBays);
        var glow = new THREE.Mesh(new THREE.PlaneGeometry(actualBayW - mullW * 2, visionH - 0.06), glowMat);
        glow.position.set(bx, fy + spH + visionH / 2, 0.025);
        gr.add(glow);
      }
      // Vertical mullion right edge
      gr.add(mk(new THREE.BoxGeometry(mullW, fh, mullD), mullionMat, bx + actualBayW / 2, fy + fh / 2, mullD / 2));
      if(b === 0){
        gr.add(mk(new THREE.BoxGeometry(mullW, fh, mullD), mullionMat, -w / 2, fy + fh / 2, mullD / 2));
      }
    }
    // Horizontal transom
    gr.add(mk(new THREE.BoxGeometry(w, 0.04, mullD), mullionMat, 0, fy + fh - 0.02, mullD / 2));
  }
  gr.position.set(ox, oy, oz);
  if(rotY) gr.rotation.y = rotY;
  parent.add(gr);
  return gr;
}

/* Balcony unit helper — concrete slab + opaque railing + steel cap rail + posts.
   Coordinate convention: the GROUP'S Y position (the y argument) is the floor's
   walkable surface — the slab TOP sits at y, slab bottom at y-slabH, railing
   extends upward from y to y+rH. This keeps the balcony floor level visually
   continuous with the building's floor on the same level. */
function addBalconyUnit(parent, x, y, z, w, proj, rotY){
  var gr = new THREE.Group();
  var rH = 1.07;
  var slabH = 0.30;
  /* Opaque materials with proper depth testing — no bleed-through. */
  var _balcSlabMat = new THREE.MeshBasicMaterial({color:0xe8e4dc, toneMapped:false});
  var _soffitMat   = new THREE.MeshBasicMaterial({color:0x444038, toneMapped:false});
  var _railMat     = new THREE.MeshBasicMaterial({color:0x4a5560, toneMapped:false});
  var _capMat      = new THREE.MeshBasicMaterial({color:0x1a1a1a, toneMapped:false});

  function _addM(geo, mat, px, py, pz){
    var m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    gr.add(m);
    return m;
  }
  /* Slab — top surface at local y=0 (= floor level), extends downward by slabH. */
  _addM(new THREE.BoxGeometry(w, slabH, proj), _balcSlabMat, 0, -slabH / 2, proj / 2);
  /* Slab soffit (under-side detail). */
  _addM(new THREE.BoxGeometry(w - 0.02, 0.04, proj - 0.02), _soffitMat, 0, -slabH + 0.02, proj / 2);
  /* Front railing — sits ON the slab top (y=0) and extends up to y=rH. */
  _addM(new THREE.BoxGeometry(w - 0.05, rH, 0.05), _railMat, 0, rH / 2, proj - 0.025);
  /* Steel cap rail — at top of railing. */
  _addM(new THREE.BoxGeometry(w + 0.10, 0.10, 0.12), _capMat, 0, rH + 0.05, proj - 0.025);
  /* Corner posts — span from slab bottom (-slabH) to railing top (rH). */
  for(var s = -1; s <= 1; s += 2){
    _addM(new THREE.BoxGeometry(0.08, rH + slabH, 0.08), _capMat, s * (w / 2 - 0.04), (rH - slabH) / 2, proj);
  }
  /* Side panels — same vertical range as front railing. */
  for(var s = -1; s <= 1; s += 2){
    _addM(new THREE.BoxGeometry(0.05, rH, proj - 0.1), _railMat, s * (w / 2 - 0.025), rH / 2, proj / 2);
  }
  gr.position.set(x, y, z);
  if(rotY) gr.rotation.y = rotY;
  parent.add(gr);
}

/**
 * Clears and rebuilds all building volumes, floors, facades, and interior elements in the 3D scene.
 */
function rebuildBuilding(){
  clearGroup('building');
  var g = groups.building;
  var vts = lotVerts();
  var bounds = lotBounds();
  var gfH = f2m(P.flr.gf || 15);
  var typH = f2m(P.flr.typ || 10);
  var maxZ = bounds.maxZ;
  var allX = vts.map(function(v){return v[0];});
  var lotMinX = Math.min.apply(null, allX), lotMaxX = Math.max.apply(null, allX);

  // ═══ GROUND PLANE — handled by rebuildEnvironment, not duplicated here ═══
  // Lot outline is rendered by rebuildLot() — no duplicate needed here.

  // ═══ PRE-COMPUTE VOLUME BOUNDING BOXES ═══
  // Point-in-polygon test (meter coordinates)
  function _pipM(px, pz, polyM){
    var inside=false;
    for(var i=0,j=polyM.length-1;i<polyM.length;j=i++){
      var xi=polyM[i][0],zi=polyM[i][1],xj=polyM[j][0],zj=polyM[j][1];
      if((zi>pz)!==(zj>pz)&&(px<(xj-xi)*(pz-zi)/(zj-zi)+xi)) inside=!inside;
    }
    return inside;
  }
  var volBounds = P.vols.map(function(vol){
    var cx0, cx1, cz0, cz1, bw, bd, polyM=null;
    if(vol.customPolyLocal && vol.customPolyLocal.length >= 4){
      polyM = vol.customPolyLocal.map(function(p){return [f2m(p[0]), f2m(p[1])];});
      // Remove closing point if present
      if(polyM.length>1 && Math.abs(polyM[0][0]-polyM[polyM.length-1][0])<0.001 && Math.abs(polyM[0][1]-polyM[polyM.length-1][1])<0.001) polyM=polyM.slice(0,-1);
      var xs = polyM.map(function(p){return p[0];});
      var zs = polyM.map(function(p){return p[1];});
      cx0 = Math.min.apply(null, xs); cx1 = Math.max.apply(null, xs);
      cz0 = Math.min.apply(null, zs); cz1 = Math.max.apply(null, zs);
      bw = cx1 - cx0; bd = cz1 - cz0;
    } else {
      var oE = f2m(vol.offEast || 0);
      var w = f2m(vol.width || 0);
      cx1 = f2m(lotMaxX) - oE; cx0 = cx1 - w;
      cz0 = f2m(vol.startEg || 0); cz1 = cz0 + f2m(vol.depth || 0);
      bw = w; bd = f2m(vol.depth || 0);
    }
    var hasComm = !!vol.commGF;
    var customGF = vol.gfHeight > 0 ? f2m(vol.gfHeight) : 0;
    var storeyH = customGF > 0 ? customGF : (hasComm ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var baseElev = vol.baseElevFt > 0 ? f2m(vol.baseElevFt) : 0;
    var totalH = baseElev + storeyH + (vol.storeys - 1) * f2m(P.flr.typ);
    return {cx0:cx0, cx1:cx1, cz0:cz0, cz1:cz1, bw:bw, bd:bd, totalH:totalH, storeys:vol.storeys, polyM:polyM};
  });

  // ═══ OVERLAP UTILITY FUNCTIONS ═══
  function faceHidden(vi, face){
    var a = volBounds[vi]; if(!a || a.bw <= 0 || a.bd <= 0) return false;
    var tol = 0.3;
    for(var j = 0; j < volBounds.length; j++){
      if(j === vi) continue;
      var b = volBounds[j]; if(!b || b.bw <= 0 || b.bd <= 0) continue;
      if(b.totalH < a.totalH - tol) continue;
      if(face === 'north'){ if(Math.abs(b.cz1 - a.cz0) < tol && b.cx0 <= a.cx0 + tol && b.cx1 >= a.cx1 - tol) return true; }
      else if(face === 'south'){ if(Math.abs(b.cz0 - a.cz1) < tol && b.cx0 <= a.cx0 + tol && b.cx1 >= a.cx1 - tol) return true; }
      else if(face === 'east'){ if(Math.abs(b.cx0 - a.cx1) < tol && b.cz0 <= a.cz0 + tol && b.cz1 >= a.cz1 - tol) return true; }
      else if(face === 'west'){ if(Math.abs(b.cx1 - a.cx0) < tol && b.cz0 <= a.cz0 + tol && b.cz1 >= a.cz1 - tol) return true; }
    }
    return false;
  }
  function volsOverlapPlan(vi, vj){
    var a = volBounds[vi], b = volBounds[vj];
    if(!a || !b) return false;
    return a.cx0 < b.cx1 && a.cx1 > b.cx0 && a.cz0 < b.cz1 && a.cz1 > b.cz0;
  }
  function findOverlappingTallerVol(px, pz, excludeVi, minH){
    for(var j = 0; j < volBounds.length; j++){
      if(j === excludeVi) continue;
      var b = volBounds[j];
      if(!b || b.bw <= 0 || b.bd <= 0) continue;
      if(b.totalH <= minH) continue;
      if(px >= b.cx0 - 0.1 && px <= b.cx1 + 0.1 && pz >= b.cz0 - 0.1 && pz <= b.cz1 + 0.1){
        // For polygon volumes, also verify point is inside actual polygon (not just bbox)
        if(b.polyM && !_pipM(px, pz, b.polyM)) continue;
        return j;
      }
    }
    return -1;
  }
  function getOverlapHoles(vi){
    var holes = [];
    var myB = volBounds[vi]; if(!myB) return holes;
    for(var j = 0; j < volBounds.length; j++){
      if(j === vi) continue;
      var ob = volBounds[j];
      if(!ob || ob.bw <= 0 || ob.bd <= 0) continue;
      if(ob.totalH <= myB.totalH) continue;
      // Skip hole-cutting when both volumes are polygon-based (e.g. podium + tower
      // from AI massing). The manual facade PlaneGeometry panels handle the visuals;
      // cutting holes in the ExtrudeGeometry only creates triangulation artifacts.
      if(myB.polyM && ob.polyM) continue;
      if(ob.polyM){
        // For polygon volumes, pass actual polygon for precise hole cutting
        holes.push({polyM:ob.polyM, x0:ob.cx0, x1:ob.cx1, z0:ob.cz0, z1:ob.cz1});
      } else {
        var ox0 = Math.max(ob.cx0, myB.cx0), ox1 = Math.min(ob.cx1, myB.cx1);
        var oz0 = Math.max(ob.cz0, myB.cz0), oz1 = Math.min(ob.cz1, myB.cz1);
        if(ox1 - ox0 > 0.5 && oz1 - oz0 > 0.5) holes.push({x0:ox0, x1:ox1, z0:oz0, z1:oz1});
      }
    }
    return holes;
  }

  // ═══ TALLEST VOLUME SCAN ═══
  var tallestVi = -1, tallestTotalH = 0;
  P.vols.forEach(function(vol, vi){
    var sH = vol.gfHeight > 0 ? f2m(vol.gfHeight) : (vol.commGF ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var h = sH + (vol.storeys - 1) * f2m(P.flr.typ);
    if(h > tallestTotalH){ tallestTotalH = h; tallestVi = vi; }
  });

  // ═══ Cladding material helper ═══
  function getCladdingMat(type){
    if(type === 'cedar') return MAT.cedar;
    if(type === 'metal') return MAT.steelDark;
    if(type === 'precast') return MAT.concreteSmooth;
    if(type === 'stone') return MAT.concreteDark;
    if(type === 'corten') return MAT.corten;
    if(type === 'curtainWall') return MAT.spandrel || MAT.concreteDark;
    return MAT.brick;
  }

  // ═══════════════════════════════════════════════════════════
  //  VOLUME LOOP
  // ═══════════════════════════════════════════════════════════
  P.vols.forEach(function(vol, vi){
    // ── Asset-class isolation ──────────────────────────────────────────
    //    Skip industrial volumes entirely — they are rendered by the
    //    dedicated industrial-decor pipeline in optimal-massing-industrial.js
    //    (parapet, IMP cladding, dock doors, RTUs, etc.). The previous
    //    "hide-and-replace" pattern (residential renders over the warehouse,
    //    then a brute-force scene-traversal hides everything inside the lot)
    //    was the source of repeated regressions where residential walls
    //    disappeared. Single-property check ('industrial' flag set by
    //    _makeVol in the industrial generator) — does NOT match on
    //    vol.kind to avoid false-positives on residential mixed-use vols
    //    that legitimately use kind === 'office' for ground-floor commercial.
    if(vol && vol.industrial === true) return;
    var hasComm = !!vol.commGF;
    var customGF = vol.gfHeight > 0 ? f2m(vol.gfHeight) : 0;
    var storeyH = customGF > 0 ? customGF : (hasComm ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var upperH = f2m(P.flr.typ);
    var totalH = storeyH + (vol.storeys - 1) * upperH;
    var overlapHoles = getOverlapHoles(vi);
    var hasOverlappingTaller = overlapHoles.length > 0;
    // If podiumStoreys is explicitly set (from optimal massing), respect it.
    // podiumStoreys: undefined = use defaults; 0 = no podium (all tower); >0 = this many podium floors
    var hasExplicitPodium = vol.podiumStoreys !== undefined;
    var isMidrise = hasExplicitPodium ? false : ((vol.storeys <= 4) || hasOverlappingTaller);
    var podiumFloors = hasExplicitPodium ? Math.min(vol.podiumStoreys, vol.storeys - 1)
      : (isMidrise ? vol.storeys - 1 : Math.min(3, vol.storeys - 1));
    var showWin = vol.windows !== undefined ? !!vol.windows : true;
    var wSpc = vol.winSpacing || 3;
    var claddingType = vol.cladding || 'brick';
    var claddingMat = getCladdingMat(claddingType);

    // ══════════════════════════════════════════
    //  CUSTOM POLYGON VOLUMES
    // ══════════════════════════════════════════
    if(vol.customPolyLocal && vol.customPolyLocal.length >= 4){
     try{
      // Base elevation: if set, the entire volume is raised (e.g. tower starting above podium)
      var baseElev = vol.baseElevFt > 0 ? f2m(vol.baseElevFt) : 0;
      // Wrap volume in a sub-group so baseElev offsets everything at once
      var _parentG = g;
      var volG = new THREE.Group();
      if(baseElev > 0) volG.position.y = baseElev;
      g = volG; // all g.add() calls now go into this sub-group
      var pts = vol.customPolyLocal;
      var shapePts = [];
      for(var si = 0; si < pts.length - 1; si++) shapePts.push([f2m(pts[si][0]), -f2m(pts[si][1])]);
      if(shapePts.length < 3){ console.warn('Not enough shape pts'); return; }
      var signedArea = 0;
      for(var sa2 = 0; sa2 < shapePts.length; sa2++){
        var sj = (sa2 + 1) % shapePts.length;
        signedArea += (shapePts[sj][0] - shapePts[sa2][0]) * (shapePts[sj][1] + shapePts[sa2][1]);
      }
      if(signedArea > 0) shapePts.reverse();
      var shape = new THREE.Shape();
      shape.moveTo(shapePts[0][0], shapePts[0][1]);
      for(var si3 = 1; si3 < shapePts.length; si3++) shape.lineTo(shapePts[si3][0], shapePts[si3][1]);
      shape.closePath();

      var closedPts = pts.slice(0, -1);
      var polyCX = 0, polyCZ = 0;
      closedPts.forEach(function(p){ polyCX += f2m(p[0]); polyCZ += f2m(p[1]); });
      polyCX /= closedPts.length; polyCZ /= closedPts.length;

      var polyXs = closedPts.map(function(p){return f2m(p[0]);}), polyZs = closedPts.map(function(p){return f2m(p[1]);});
      var polyMinX = Math.min.apply(null, polyXs), polyMaxX = Math.max.apply(null, polyXs);
      var polyMinZ = Math.min.apply(null, polyZs), polyMaxZ = Math.max.apply(null, polyZs);
      var polyBW = polyMaxX - polyMinX, polyBD = polyMaxZ - polyMinZ;

      // Shape with holes for overlapping taller volumes
      var shapeWithHoles = shape;
      if(overlapHoles.length > 0){
        shapeWithHoles = new THREE.Shape();
        shapeWithHoles.moveTo(shapePts[0][0], shapePts[0][1]);
        for(var si4 = 1; si4 < shapePts.length; si4++) shapeWithHoles.lineTo(shapePts[si4][0], shapePts[si4][1]);
        shapeWithHoles.closePath();
        overlapHoles.forEach(function(oh){
          var hp = new THREE.Path();
          if(oh.polyM){
            // Polygon-shaped hole — use actual polygon vertices
            var hpArr = oh.polyM.map(function(p){return [p[0], -p[1]];});
            // Ensure clockwise winding for holes (opposite of outer shape)
            var hArea = 0;
            for(var ha=0; ha<hpArr.length; ha++){
              var hb=(ha+1)%hpArr.length;
              hArea += (hpArr[hb][0]-hpArr[ha][0])*(hpArr[hb][1]+hpArr[ha][1]);
            }
            if(hArea < 0) hpArr.reverse();
            hp.moveTo(hpArr[0][0], hpArr[0][1]);
            for(var hj=1; hj<hpArr.length; hj++) hp.lineTo(hpArr[hj][0], hpArr[hj][1]);
          } else {
            var inset = 0.05;
            hp.moveTo(oh.x0 + inset, -(oh.z0 + inset));
            hp.lineTo(oh.x1 - inset, -(oh.z0 + inset));
            hp.lineTo(oh.x1 - inset, -(oh.z1 - inset));
            hp.lineTo(oh.x0 + inset, -(oh.z1 - inset));
          }
          hp.closePath();
          shapeWithHoles.holes.push(hp);
        });
      }

      // Podium polygon in metres for inside-test outward-normal disambiguation.
      // Required because polyCX/polyCZ (centroid) sits OUTSIDE the polygon for
      // L-shapes / T-shapes — concave corner notches pull the centroid into
      // empty space — which inverts the centroid-direction "outward" guess for
      // every edge near the concave area. Using a point-in-polygon probe is
      // robust regardless of polygon shape.
      var _podPolyM_eN = closedPts.map(function(p){ return [f2m(p[0]), f2m(p[1])]; });
      function edgeNormals(p0, p1){
        var dx = f2m(p1[0] - p0[0]), dz = f2m(p1[1] - p0[1]);
        var len = Math.sqrt(dx * dx + dz * dz);
        if(len < 0.01) return [{nx:0, nz:1}];
        var n1x = -dz / len, n1z = dx / len;
        var n2x = dz / len, n2z = -dx / len;
        var mx2 = f2m((p0[0] + p1[0]) / 2), mz2 = f2m((p0[1] + p1[1]) / 2);
        // Probe each candidate normal a small distance beyond the edge — the
        // candidate whose probe lands OUTSIDE the polygon is the outward one.
        var probe = 0.1;
        if(_podPolyM_eN && _podPolyM_eN.length >= 3){
          var n1Out = !_pipM(mx2 + n1x * probe, mz2 + n1z * probe, _podPolyM_eN);
          if(n1Out) return [{nx:n1x, nz:n1z}];
          return [{nx:n2x, nz:n2z}];
        }
        // Fallback: centroid direction (only used if no polygon available).
        var toCX = mx2 - polyCX, toCZ = mz2 - polyCZ;
        var dot1 = n1x * toCX + n1z * toCZ;
        var dot2 = n2x * toCX + n2z * toCZ;
        if(dot1 >= dot2) return [{nx:n1x, nz:n1z}];
        return [{nx:n2x, nz:n2z}];
      }
      function normalCardinal(nx, nz){
        if(Math.abs(nz) > Math.abs(nx)) return nz < 0 ? 'N' : 'S';
        return nx > 0 ? 'E' : 'W';
      }

      // ── CONCAVE-VERTEX DETECTION ──
      // Flag every vertex of the polygon as convex or concave (interior angle).
      // The curtain-wall renderer uses this to decide whether to draw the
      // INTERIOR BACK WALL (3.2m behind the glass): on edges adjacent to concave
      // vertices the back wall would poke through the OPPOSITE facade and be
      // visible from outside as a white wall — the "wall leaking outside the
      // building" rendering bug. Detection is a simple cross-product sign test
      // at each vertex; result is cached in `_isConcaveVertex[i]` (true=concave).
      var _polySignedArea = 0;
      for(var _pa = 0; _pa < closedPts.length; _pa++){
        var _pb = (_pa + 1) % closedPts.length;
        _polySignedArea += closedPts[_pa][0]*closedPts[_pb][1] - closedPts[_pb][0]*closedPts[_pa][1];
      }
      var _polyIsCCW = _polySignedArea > 0;
      var _isConcaveVertex = new Array(closedPts.length);
      for(var _ci = 0; _ci < closedPts.length; _ci++){
        var _pp = closedPts[(_ci - 1 + closedPts.length) % closedPts.length];
        var _pc = closedPts[_ci];
        var _pn = closedPts[(_ci + 1) % closedPts.length];
        var _e1x = _pc[0] - _pp[0], _e1y = _pc[1] - _pp[1];
        var _e2x = _pn[0] - _pc[0], _e2y = _pn[1] - _pc[1];
        var _cross = _e1x * _e2y - _e1y * _e2x;
        // For CCW polygon: cross > 0 = convex (left turn); cross < 0 = concave
        // For CW polygon: invert
        _isConcaveVertex[_ci] = _polyIsCCW ? (_cross < 0) : (_cross > 0);
      }
      // An EDGE needs noBackWall if EITHER endpoint is a concave vertex
      function _edgeAdjacentToConcave(edgeIdx){
        var endIdx = (edgeIdx + 1) % closedPts.length;
        return _isConcaveVertex[edgeIdx] || _isConcaveVertex[endIdx];
      }

      var towerFloors = isMidrise ? 0 : vol.storeys - 1 - podiumFloors;

      // ── GROUND FLOOR (extruded mass + facade per edge) ──
      // Pure tower volumes (podiumFloors=0, no commercial) use dark core + curtain wall for GF
      var isTowerVol = podiumFloors === 0 && !hasComm && claddingType === 'curtainWall';
      var gfGeo = new THREE.ExtrudeGeometry(shapeWithHoles, {depth:storeyH, bevelEnabled:false});
      gfGeo.rotateX(-Math.PI / 2);
      var gfCoreMat = isTowerVol
        ? new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:0.12, side:THREE.DoubleSide})
        : claddingMat;
      var gfMesh = new THREE.Mesh(gfGeo, gfCoreMat);
      gfMesh.position.y = 0; gfMesh.castShadow = true; gfMesh.receiveShadow = true;
      g.add(gfMesh);

      // GF facade per edge
      if(isTowerVol){
        // Tower GF: render curtain wall on this floor (1 floor at y=0)
        for(var ei = 0; ei < closedPts.length; ei++){
          var p0 = closedPts[ei], p1 = closedPts[(ei + 1) % closedPts.length];
          var edgeLen = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]));
          if(edgeLen < 2) continue;
          var edgeLenM = f2m(edgeLen);
          var mx = f2m((p0[0] + p1[0]) / 2), mz = f2m((p0[1] + p1[1]) / 2);
          if(findOverlappingTallerVol(mx, mz, vi, totalH) >= 0) continue;
          var normals = edgeNormals(p0, p1);
          for(var ni = 0; ni < normals.length; ni++){
            var nx = normals[ni].nx, nz = normals[ni].nz;
            var angle = Math.atan2(nx, nz);
            addCurtainWall(g, mx + nx * 0.01, 0, mz + nz * 0.01, edgeLenM, 1, storeyH, angle, {
              bayWidth: 3.0,
              // Concave-adjacent edges: skip ALL interior depth (back wall,
              // partitions, slabs). The curtain wall becomes a flat glass
              // facade with no elements projecting into the concave dent.
              backDepthM: _edgeAdjacentToConcave(ei) ? 0.0 : 3.2
            });
          }
        }
      } else {
        // Podium/midrise GF: render storefront or brick
        for(var ei = 0; ei < closedPts.length; ei++){
          var p0 = closedPts[ei], p1 = closedPts[(ei + 1) % closedPts.length];
          var edgeLen = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]));
          if(edgeLen < 2) continue;
          var edgeLenM = f2m(edgeLen);
          var midZ = (p0[1] + p1[1]) / 2;
          var isStreetFace = hasComm && ((midZ < 5) || (midZ > maxZ - 5));
          var mx = f2m((p0[0] + p1[0]) / 2), mz = f2m((p0[1] + p1[1]) / 2);
          if(findOverlappingTallerVol(mx, mz, vi, totalH) >= 0) continue;
          var normals = edgeNormals(p0, p1);
          for(var ni = 0; ni < normals.length; ni++){
            var nx = normals[ni].nx, nz = normals[ni].nz;
            var angle = Math.atan2(nx, nz);
            var card = normalCardinal(nx, nz);
            var sfOverride = (card === 'N' ? vol.storefrontN : card === 'S' ? vol.storefrontS : card === 'E' ? vol.storefrontE : vol.storefrontW);
            var doStorefront = sfOverride !== undefined ? !!sfOverride : isStreetFace;
            /* Abutment check for GROUND FLOOR: pass floorMidYM = storeyH/2
               (middle of GF). Any neighbour with height >= GF mid-height
               blocks GF storefront / windows. Most real-world buildings
               are at least one storey, so almost any neighbour will trip
               this — which is correct for GF. */
            var isAbutted = _isEdgeAbuttedByContext(p0, p1, nx, nz, storeyH * 0.5);
            if(isAbutted) doStorefront = false;
            var gfGr = new THREE.Group();
            if(doStorefront){
              var sfGlassH = storeyH * 0.75, sfBaseH = storeyH * 0.1;
              gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, sfBaseH, 0.06), MAT.concreteDark, 0, sfBaseH / 2, 0));
              var sfGlass = new THREE.Mesh(new THREE.PlaneGeometry(edgeLenM - 0.1, sfGlassH), MAT.glassSF);
              sfGlass.position.set(0, sfBaseH + sfGlassH / 2, 0.005); gfGr.add(sfGlass);
              var sfNCols = Math.max(1, Math.floor(edgeLenM / 4.0));
              for(var c = 0; c <= sfNCols; c++){
                var cx2 = c / sfNCols * edgeLenM - edgeLenM / 2;
                gfGr.add(mk(new THREE.BoxGeometry(0.06, sfGlassH, 0.06), MAT.steelDark, cx2, sfBaseH + sfGlassH / 2, 0.03));
              }
              gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, 0.06, 0.06), MAT.steelDark, 0, sfBaseH + sfGlassH, 0.03));
              var headerH = storeyH - sfBaseH - sfGlassH;
              if(headerH > 0.05) gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, headerH, 0.04), MAT.concreteDark, 0, storeyH - headerH / 2, 0));
            } else {
              var gfWall = new THREE.Mesh(new THREE.PlaneGeometry(edgeLenM, storeyH), claddingMat);
              gfWall.position.set(0, storeyH / 2, 0.005); gfGr.add(gfWall);
              /* Suppress punched GF windows on abutted edges — solid wall only. */
              if(!isAbutted){
                var nWinGf = Math.max(1, Math.floor(edgeLenM / 3));
                for(var wi = 0; wi < nWinGf; wi++){
                  var winCX = (wi + 0.5) / nWinGf * edgeLenM - edgeLenM / 2;
                  var wm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), MAT.glass);
                  wm.position.set(winCX, storeyH * 0.55, 0.01); gfGr.add(wm);
                }
              }
            }
            gfGr.position.set(mx + nx * 0.01, 0, mz + nz * 0.01);
            gfGr.rotation.y = angle;
            g.add(gfGr);
          }
        }
      }

      // ── UPPER FLOORS ──
      if(vol.storeys > 1){
        var upFloors = vol.storeys - 1;
        var upH = upFloors * upperH;
        var podiumH = podiumFloors * upperH;
        var twrFloors = upFloors - podiumFloors;
        var towerH2 = twrFloors * upperH;

        // Tower core mass (semi-transparent dark so glass reads properly)
        // Apply stepback: inset the polygon for tower floors above podium
        // towerClosedPtsFt: inset polygon in FEET (for curtain wall / balcony / slab loops)
        var towerClosedPtsFt = closedPts; // default: same as podium if no stepback
        var towerPolyCX = polyCX, towerPolyCZ = polyCZ; // centroid in metres
        var twrShape = shapeWithHoles; // tower shape (updated if stepback applies)

        // Edge normal helper for tower polygon. Picks the outward-facing
        // perpendicular by point-in-polygon test rather than direction-from-
        // centroid. The centroid method is INCORRECT for concave polygons
        // (L-shapes, T-shapes) — for those the centroid lies in the concave
        // notch, OUTSIDE the polygon, which inverts the "outward" direction
        // for every edge near the concave area. The visible symptom was
        // tower curtain walls facing inward at concave frontages, leaving
        // those frontages looking like the tower had no stepback.
        function towerEdgeNormals(p0, p1){
          var dx = f2m(p1[0] - p0[0]), dz = f2m(p1[1] - p0[1]);
          var len = Math.sqrt(dx * dx + dz * dz);
          if(len < 0.01) return [{nx:0, nz:1}];
          var n1x = -dz / len, n1z = dx / len;
          var n2x = dz / len, n2z = -dx / len;
          var mx2 = f2m((p0[0] + p1[0]) / 2), mz2 = f2m((p0[1] + p1[1]) / 2);
          // Use the inset (tower) polygon if we have it, otherwise the podium
          // polygon — both work because both have the same handedness near
          // each edge and we're testing a point just past the boundary.
          var testPolyM = null;
          if(typeof towerClosedPtsFt !== 'undefined' && towerClosedPtsFt && towerClosedPtsFt.length >= 3){
            testPolyM = towerClosedPtsFt.map(function(p){ return [f2m(p[0]), f2m(p[1])]; });
          } else if(typeof podiumPolyM !== 'undefined' && podiumPolyM){
            testPolyM = podiumPolyM;
          }
          if(testPolyM){
            // 0.1m probe — small enough to stay within the polygon's voronoi
            // region of this edge (no cross-edge bleed).
            var probe = 0.1;
            var n1Outside = !_pipM(mx2 + n1x * probe, mz2 + n1z * probe, testPolyM);
            if(n1Outside) return [{nx:n1x, nz:n1z}];
            return [{nx:n2x, nz:n2z}];
          }
          // No polygon available — fall back to centroid direction.
          var toCX = mx2 - towerPolyCX, toCZ = mz2 - towerPolyCZ;
          var dot1 = n1x * toCX + n1z * toCZ;
          var dot2 = n2x * toCX + n2z * toCZ;
          if(dot1 >= dot2) return [{nx:n1x, nz:n1z}];
          return [{nx:n2x, nz:n2z}];
        }

        if(twrFloors > 0){
          var stepFtRen = hasExplicitPodium ? (vol.stepbackAmt != null ? vol.stepbackAmt : 10) : 0;
          var stepM = f2m(stepFtRen);
          if(stepM > 0 && closedPts.length >= 3){
            // Inset the polygon perpendicular to each edge by stepFtRen feet.
            // Uses the same edge-perpendicular offset as optimal-massing.js
            // _insetPolygon so the tower faces stay PARALLEL to the podium
            // faces. The previous centroid-radial shrink rotated edges,
            // producing the tilted-tower-over-podium artifact for irregular
            // (multi-parcel) lots.
            var towerPts = [];
            var towerPtsFt = []; // parallel array in feet for facade loops
            var lotRingFt = closedPts.slice();
            if(lotRingFt[0][0] !== lotRingFt[lotRingFt.length-1][0] || lotRingFt[0][1] !== lotRingFt[lotRingFt.length-1][1]){
              lotRingFt.push(lotRingFt[0].slice());
            }
            var insetFtRing = null;
            try {
              if(typeof _insetPolygon === 'function'){
                insetFtRing = _insetPolygon(lotRingFt, stepFtRen);
              }
            } catch(e){ insetFtRing = null; }

            if(insetFtRing && insetFtRing.length >= 4){
              // Strip closing duplicate vertex (matches towerPtsFt convention)
              var insetOpen = insetFtRing.slice(0, -1);
              for(var ti = 0; ti < insetOpen.length; ti++){
                var fxR = insetOpen[ti][0], fzR = insetOpen[ti][1];
                towerPts.push(new THREE.Vector2(f2m(fxR), -f2m(fzR)));
                towerPtsFt.push([fxR, fzR]);
              }
            }

            // Fallback: if proper inset is unavailable or returned the
            // original poly (no stepback applied), use the original closedPts
            // — tower with no stepback rather than ship a broken footprint.
            if(towerPts.length < 3){
              for(var ti2 = 0; ti2 < closedPts.length; ti2++){
                var fxF = closedPts[ti2][0], fzF = closedPts[ti2][1];
                towerPts.push(new THREE.Vector2(f2m(fxF), -f2m(fzF)));
                towerPtsFt.push([fxF, fzF]);
              }
            }

            // ── CLIP TOWER POLYGON TO LOT (PROPERTY-LINE GUARANTEE) ──
            // The centroid-shrink inset above can push convex corners that are
            // CLOSE to the polygon centroid OUTSIDE the original polygon — for
            // L-shaped or notched lots, the tower vertex at a notch corner can
            // land in the notch (which is OUTSIDE the property line). Without
            // this clip, the tower would extend onto the neighbour's land.
            //
            // We clip the inset polygon to the volume's customPolyLocal (which
            // = the lot polygon for optimal-massing volumes) using turf.intersect.
            // Result: tower can never extend outside the property.
            if(towerPtsFt.length >= 3 && typeof turf !== 'undefined' && turf.intersect && pts && pts.length >= 4){
              try {
                // Build the bounding building polygon ring (in feet, closed)
                var lotRing = pts.slice();
                if(lotRing[0][0] !== lotRing[lotRing.length-1][0] || lotRing[0][1] !== lotRing[lotRing.length-1][1]){
                  lotRing.push([lotRing[0][0], lotRing[0][1]]);
                }
                // Build the inset tower ring (in feet, closed)
                var insetRing = towerPtsFt.slice();
                insetRing.push([insetRing[0][0], insetRing[0][1]]);
                var lotPolyT = turf.polygon([lotRing]);
                var insetPolyT = turf.polygon([insetRing]);
                var clipped = null;
                try { clipped = turf.intersect(turf.featureCollection([insetPolyT, lotPolyT])); }
                catch(e){ try { clipped = turf.intersect(insetPolyT, lotPolyT); } catch(e2){ clipped = null; } }
                if(clipped && clipped.geometry){
                  // Use the largest polygon piece if clipping produced a MultiPolygon
                  var clippedCoords;
                  if(clipped.geometry.type === 'MultiPolygon'){
                    var bestArea = 0;
                    clipped.geometry.coordinates.forEach(function(rings){
                      var r0 = rings[0]; var a = 0;
                      for(var i = 0; i < r0.length - 1; i++) a += r0[i][0]*r0[i+1][1] - r0[i+1][0]*r0[i][1];
                      var area = Math.abs(a/2);
                      if(area > bestArea){ bestArea = area; clippedCoords = r0; }
                    });
                  } else {
                    clippedCoords = clipped.geometry.coordinates[0];
                  }
                  if(clippedCoords && clippedCoords.length >= 4){
                    // Drop the closing duplicate to match towerPtsFt convention
                    var clippedOpen = clippedCoords.slice(0, -1);
                    if(clippedOpen.length >= 3){
                      towerPtsFt = clippedOpen;
                      // Re-derive towerPts (Three.js Vector2 array, with -Z convention)
                      towerPts = clippedOpen.map(function(p){ return new THREE.Vector2(f2m(p[0]), -f2m(p[1])); });
                    }
                  }
                }
              } catch(e){ /* clipping failed — fall back to unclipped inset */ }
            }

            if(towerPts.length >= 3){
              // Ensure correct winding (counter-clockwise in shape space)
              var twrSignedArea = 0;
              for(var twa = 0; twa < towerPts.length; twa++){
                var twb = (twa + 1) % towerPts.length;
                twrSignedArea += (towerPts[twb].x - towerPts[twa].x) * (towerPts[twb].y + towerPts[twa].y);
              }
              if(twrSignedArea > 0) towerPts.reverse();
              twrShape = new THREE.Shape(towerPts);
              towerClosedPtsFt = towerPtsFt;
              // Recompute tower centroid in metres (world space, positive Z)
              towerPolyCX = 0; towerPolyCZ = 0;
              for(var tc = 0; tc < towerPtsFt.length; tc++){
                towerPolyCX += f2m(towerPtsFt[tc][0]);
                towerPolyCZ += f2m(towerPtsFt[tc][1]);
              }
              towerPolyCX /= towerPtsFt.length;
              towerPolyCZ /= towerPtsFt.length;
            }
          }
          var twrGeo = new THREE.ExtrudeGeometry(twrShape, {depth:towerH2, bevelEnabled:false});
          twrGeo.rotateX(-Math.PI / 2);
          var twrCoreOpacity = showWin ? (hasOverlappingTaller ? 0.5 : 0.12) : 0.85;
          var twrCoreMat = new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:twrCoreOpacity, side:THREE.DoubleSide});
          var twrMesh = new THREE.Mesh(twrGeo, twrCoreMat);
          twrMesh.position.y = storeyH + podiumH; twrMesh.castShadow = true;
          g.add(twrMesh);
        }

        // Podium floors (brick with punched windows) per edge
        if(podiumFloors > 0 && showWin){
          for(var ei2 = 0; ei2 < closedPts.length; ei2++){
            var pp0 = closedPts[ei2], pp1 = closedPts[(ei2 + 1) % closedPts.length];
            var eLen2 = Math.sqrt((pp1[0] - pp0[0]) * (pp1[0] - pp0[0]) + (pp1[1] - pp0[1]) * (pp1[1] - pp0[1]));
            if(eLen2 < 2) continue;
            var eLM2 = f2m(eLen2);
            var mx3 = f2m((pp0[0] + pp1[0]) / 2), mz3 = f2m((pp0[1] + pp1[1]) / 2);
            if(findOverlappingTallerVol(mx3, mz3, vi, totalH) >= 0) continue;
            var norms2 = edgeNormals(pp0, pp1);
            for(var ni2 = 0; ni2 < norms2.length; ni2++){
              var enx = norms2[ni2].nx, enz = norms2[ni2].nz;
              var eAngle = Math.atan2(enx, enz);
              // Brick face with punched windows — always brick (Fix 8), standardised size (Fix 7)
              var podFGr = new THREE.Group();
              podFGr.add(new THREE.Mesh(new THREE.PlaneGeometry(eLM2, podiumFloors * upperH), MAT.brick));
              podFGr.children[0].position.set(0, podiumFloors * upperH / 2, 0);
              var pWinSpacing = 4.0;
              var pWinCols = Math.max(1, Math.floor(eLM2 / pWinSpacing));
              var pActualSpacing = eLM2 / pWinCols;
              var pWinW2 = upperH * 0.5;
              var pWinH2 = upperH * 0.55;
              var polySeed = Math.abs(Math.round((mx3 + mz3 * 7.13) * 1000)) % 9999;
              /* Edge length in feet — used to convert window's face-local
                 X (in metres) to a fraction along the edge for per-window
                 abutment probing. */
              var eLenFt = eLen2;
              for(var pfl = 0; pfl < podiumFloors; pfl++){
                var pflBase = pfl * upperH;
                /* PER-FLOOR + PER-WINDOW abutment. floorMidYM is the world-Y
                   middle of this floor. For each individual window we project
                   its world-XZ position back to the edge, then probe outward
                   ~10 ft to catch neighbours up to a typical urban setback
                   away. A neighbour only suppresses a window if it's tall
                   enough to reach this floor. */
                var floorMidYM = storeyH + pflBase + upperH * 0.5;
                for(var pwi = 0; pwi < pWinCols; pwi++){
                  var pwinCX = -eLM2/2 + pActualSpacing/2 + pwi * pActualSpacing;
                  /* Per-window probe — convert face-local X (metres) to edge
                     fraction t (0..1), interpolate world-feet position. */
                  var tEdge = (pwinCX + eLM2/2) / eLM2;
                  var winXFt = pp0[0] + (pp1[0] - pp0[0]) * tEdge;
                  var winZFt = pp0[1] + (pp1[1] - pp0[1]) * tEdge;
                  if(_isPointAbuttedByContext(winXFt, winZFt, enx, enz, floorMidYM, 10)){
                    continue;
                  }
                  podFGr.add(new THREE.Mesh(new THREE.PlaneGeometry(pWinW2, pWinH2), MAT.punchedWin));
                  podFGr.children[podFGr.children.length-1].position.set(pwinCX, pflBase + upperH * 0.55, 0.3);
                  // Interior unit glow — visible at night
                  if(_winLit(pfl, pwi, polySeed)){
                    var polyGlow = new THREE.Mesh(new THREE.PlaneGeometry(pWinW2 - 0.06, pWinH2 - 0.06), _winGlowMat(pfl, pwi, polySeed));
                    polyGlow.position.set(pwinCX, pflBase + upperH * 0.55, 0.305);
                    podFGr.add(polyGlow);
                  }
                  podFGr.add(mk(new THREE.BoxGeometry(pWinW2 + 0.15, 0.04, 0.06), MAT.concreteSmooth, pwinCX, pflBase + upperH * 0.55 - pWinH2/2 - 0.04, 0.3));
                  podFGr.add(mk(new THREE.BoxGeometry(pWinW2 + 0.1, 0.06, 0.04), MAT.concreteSmooth, pwinCX, pflBase + upperH * 0.55 + pWinH2/2 + 0.03, 0.3));
                }
              }
              podFGr.position.set(mx3 + enx * 0.01, storeyH, mz3 + enz * 0.01);
              podFGr.rotation.y = eAngle;
              g.add(podFGr);
            }
          }
        }

        // Cornice at podium-to-tower transition
        if(podiumFloors > 0 && twrFloors > 0){
          var transY = storeyH + podiumH;
          for(var ei3 = 0; ei3 < closedPts.length; ei3++){
            var tp0 = closedPts[ei3], tp1 = closedPts[(ei3 + 1) % closedPts.length];
            var tELen = Math.sqrt((tp1[0] - tp0[0]) * (tp1[0] - tp0[0]) + (tp1[1] - tp0[1]) * (tp1[1] - tp0[1]));
            if(tELen < 2) continue;
            var tELM = f2m(tELen);
            var tmx = f2m((tp0[0] + tp1[0]) / 2), tmz = f2m((tp0[1] + tp1[1]) / 2);
            if(findOverlappingTallerVol(tmx, tmz, vi, totalH) >= 0) continue;
            var tnorms = edgeNormals(tp0, tp1);
            for(var tni = 0; tni < tnorms.length; tni++){
              var tnx = tnorms[tni].nx, tnz = tnorms[tni].nz;
              var cornice = mk(new THREE.BoxGeometry(tELM + 0.05, 0.08, 0.06), MAT.concreteDark, 0, 0, 0);
              cornice.position.set(tmx + tnx * 0.03, transY - 0.04, tmz + tnz * 0.03);
              cornice.rotation.y = Math.atan2(tnx, tnz); g.add(cornice);
            }
          }
        }

        // Green terrace on exposed podium roof at transition level
        if(podiumFloors > 0 && twrFloors > 0){
          var polyCapBeamH = 0.15;
          var terrY = storeyH + podiumH + polyCapBeamH + 0.05;
          console.log('[polygon] podiumTopY:', (storeyH + podiumH).toFixed(2), 'capBeam:', polyCapBeamH, 'terraceY:', terrY.toFixed(2));
          var terrGeo = new THREE.ShapeGeometry(shapeWithHoles); terrGeo.rotateX(-Math.PI / 2);
          var terrMesh = new THREE.Mesh(terrGeo, MAT.greenRoof);
          terrMesh.position.y = terrY; terrMesh.receiveShadow = true; g.add(terrMesh);
          // Planter boxes along longest edges — positioned OUTWARD from building edge
          for(var tei = 0; tei < closedPts.length; tei++){
            var plp0 = closedPts[tei], plp1 = closedPts[(tei + 1) % closedPts.length];
            var plLen = Math.sqrt((plp1[0]-plp0[0])*(plp1[0]-plp0[0])+(plp1[1]-plp0[1])*(plp1[1]-plp0[1]));
            if(plLen < 8) continue;
            var plLM = f2m(plLen);
            var plmx = f2m((plp0[0]+plp1[0])/2), plmz = f2m((plp0[1]+plp1[1])/2);
            var plnorms = edgeNormals(plp0, plp1);
            for(var pni = 0; pni < plnorms.length; pni++){
              var pnx = plnorms[pni].nx, pnz = plnorms[pni].nz;
              var pAng = Math.atan2(pnx, pnz);
              // Planter box along this edge — pushed outward along normal
              var planterGr = new THREE.Group();
              var plBoxH = 0.45;
              planterGr.add(mk(new THREE.BoxGeometry(plLM * 0.7, plBoxH, 0.5), MAT.planter, 0, plBoxH/2, 0));
              // Shrubs on planter
              var nShrubs = Math.max(1, Math.floor(plLM / 2.5));
              for(var si = 0; si < nShrubs; si++){
                var sx = (si + 0.5) / nShrubs * plLM * 0.7 - plLM * 0.35;
                var shrubR = 0.25 + Math.random() * 0.15;
                var shrub = new THREE.Mesh(new THREE.SphereGeometry(shrubR, 8, 6), si % 2 === 0 ? MAT.shrubA : MAT.shrubB);
                shrub.position.set(sx, plBoxH + shrubR * 0.7, 0);
                shrub.scale.y = 0.65 + Math.random() * 0.2;
                shrub.castShadow = true; planterGr.add(shrub);
              }
              planterGr.position.set(plmx + pnx * 0.8, terrY, plmz + pnz * 0.8);
              planterGr.rotation.y = pAng;
              g.add(planterGr);
            }
          }

          // ── BISTRO FURNITURE ON GREEN ROOF TERRACE ──
          // Distributes outdoor bistro sets (round table + 4 chairs) across
          // the green roof. Sets are placed INWARD from each podium edge
          // midpoint, with a tower-polygon check so nothing lands inside
          // the tower footprint. Pure ShapeGeometry — no edge-to-edge
          // alignment needed, so no concave-corner artifacts.
          var twrPolyM = null;
          if(typeof towerClosedPtsFt !== 'undefined' && towerClosedPtsFt.length >= 3){
            twrPolyM = towerClosedPtsFt.map(function(p){return [f2m(p[0]), f2m(p[1])];});
          }
          var bistroPodiumPolyM = closedPts.map(function(p){ return [f2m(p[0]), f2m(p[1])]; });
          var _bistroTopMat = new THREE.MeshBasicMaterial({color: 0xf2efe8, toneMapped: false});
          var _bistroFrameMat = new THREE.MeshBasicMaterial({color: 0x2a2a2a, toneMapped: false});
          var _bistroSeatMat = new THREE.MeshBasicMaterial({color: 0x8b6f47, toneMapped: false});
          var _addBistroSet = function(cx, cy, cz){
            var bgr = new THREE.Group();
            // Table top
            var tTop = new THREE.Mesh(
              new THREE.CylinderGeometry(0.40, 0.40, 0.05, 16),
              _bistroTopMat
            );
            tTop.position.y = 0.74; bgr.add(tTop);
            // Table pedestal
            var tPed = new THREE.Mesh(
              new THREE.CylinderGeometry(0.04, 0.06, 0.74, 8),
              _bistroFrameMat
            );
            tPed.position.y = 0.37; bgr.add(tPed);
            // Table base disc
            var tBase = new THREE.Mesh(
              new THREE.CylinderGeometry(0.18, 0.18, 0.03, 12),
              _bistroFrameMat
            );
            tBase.position.y = 0.015; bgr.add(tBase);
            // 4 chairs distributed around the table
            for(var ci = 0; ci < 4; ci++){
              var ang = ci * Math.PI / 2 + Math.PI / 4;
              var radius = 0.85;
              var ccx = Math.cos(ang) * radius;
              var ccz = Math.sin(ang) * radius;
              // Chair seat
              var seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.40, 0.05, 0.40),
                _bistroSeatMat
              );
              seat.position.set(ccx, 0.45, ccz); bgr.add(seat);
              // Chair back
              var backX = ccx + Math.cos(ang) * 0.18;
              var backZ = ccz + Math.sin(ang) * 0.18;
              var back = new THREE.Mesh(
                new THREE.BoxGeometry(0.40, 0.45, 0.04),
                _bistroSeatMat
              );
              back.position.set(backX, 0.67, backZ);
              back.rotation.y = -ang + Math.PI / 2;
              bgr.add(back);
              // Chair legs (4 thin posts)
              for(var li = 0; li < 4; li++){
                var lAng = li * Math.PI / 2 + Math.PI / 4;
                var lx = ccx + Math.cos(lAng) * 0.16;
                var lz = ccz + Math.sin(lAng) * 0.16;
                var leg = new THREE.Mesh(
                  new THREE.BoxGeometry(0.03, 0.45, 0.03),
                  _bistroFrameMat
                );
                leg.position.set(lx, 0.225, lz); bgr.add(leg);
              }
            }
            bgr.position.set(cx, cy, cz);
            // Random rotation so multiple sets don't all face same way
            bgr.rotation.y = ((cx * 7.31 + cz * 3.17) % (Math.PI * 2));
            g.add(bgr);
          };
          // Walk podium edges and place a bistro set inboard of each
          for(var bei = 0; bei < closedPts.length; bei++){
            var bp0 = closedPts[bei], bp1 = closedPts[(bei + 1) % closedPts.length];
            var bDx = bp1[0] - bp0[0], bDz = bp1[1] - bp0[1];
            var bLen = Math.sqrt(bDx * bDx + bDz * bDz);
            if(bLen < 6) continue;
            var bMx = f2m((bp0[0] + bp1[0]) / 2);
            var bMz = f2m((bp0[1] + bp1[1]) / 2);
            // Inward normal (opposite of edgeNormals' outward direction)
            var bNorms = edgeNormals(bp0, bp1);
            for(var bni = 0; bni < bNorms.length; bni++){
              var bnx = -bNorms[bni].nx, bnz = -bNorms[bni].nz;
              // Step 2.5 m inboard from edge midpoint
              var bsX = bMx + bnx * 2.5;
              var bsZ = bMz + bnz * 2.5;
              // Skip if inside tower footprint
              if(twrPolyM && _pipM(bsX, bsZ, twrPolyM)) continue;
              // Skip if outside podium polygon (defensive)
              if(!_pipM(bsX, bsZ, bistroPodiumPolyM)) continue;
              _addBistroSet(bsX, terrY, bsZ);
            }
          }

          // ── POLYGON TERRACE AREA LABEL ──
          // Compute terrace area = podium footprint minus tower footprint
          var podiumAreaM2 = 0;
          try {
            // Podium area from shape (using shoelace formula in metres)
            for(var tai = 0; tai < shapePts.length; tai++){
              var taj = (tai + 1) % shapePts.length;
              podiumAreaM2 += shapePts[tai][0] * shapePts[taj][1] - shapePts[taj][0] * shapePts[tai][1];
            }
            podiumAreaM2 = Math.abs(podiumAreaM2) / 2;
          } catch(e){}
          var towerAreaM2 = 0;
          if(typeof towerClosedPtsFt !== 'undefined' && towerClosedPtsFt.length >= 3){
            var twrPtsM = towerClosedPtsFt.map(function(p){return [f2m(p[0]), f2m(p[1])];});
            for(var tti = 0; tti < twrPtsM.length; tti++){
              var ttj = (tti + 1) % twrPtsM.length;
              towerAreaM2 += twrPtsM[tti][0] * twrPtsM[ttj][1] - twrPtsM[ttj][0] * twrPtsM[tti][1];
            }
            towerAreaM2 = Math.abs(towerAreaM2) / 2;
          }
          var terraceSF = Math.round((podiumAreaM2 - towerAreaM2) * 10.7639); // m² to sf
          if(terraceSF > 50){
            addTextSprite(g, 'AMENITY TERRACE', polyCX, terrY + 0.5, polyCZ, '#AEBC46', 0.35);
            addTextSprite(g, terraceSF.toLocaleString() + ' sf', polyCX, terrY + 0.1, polyCZ, '#ffffff', 0.28);
          }
        }

        // Tower floors (curtain wall) per edge — use INSET tower polygon, not podium polygon
        // Build podium polygon in metres for interior-face culling
        var podiumPolyM = closedPts.map(function(p){ return [f2m(p[0]), f2m(p[1])]; });
        if(twrFloors > 0 && showWin){
          var towerBaseY = storeyH + podiumH;
          for(var ei4 = 0; ei4 < towerClosedPtsFt.length; ei4++){
            var cp0 = towerClosedPtsFt[ei4], cp1 = towerClosedPtsFt[(ei4 + 1) % towerClosedPtsFt.length];
            var cELen = Math.sqrt((cp1[0] - cp0[0]) * (cp1[0] - cp0[0]) + (cp1[1] - cp0[1]) * (cp1[1] - cp0[1]));
            if(cELen < 2) continue;
            var cELM = f2m(cELen);
            var cmx = f2m((cp0[0] + cp1[0]) / 2), cmz = f2m((cp0[1] + cp1[1]) / 2);
            if(findOverlappingTallerVol(cmx, cmz, vi, totalH) >= 0) continue;
            var cnorms = towerEdgeNormals(cp0, cp1);
            for(var cni = 0; cni < cnorms.length; cni++){
              var cnx = cnorms[cni].nx, cnz = cnorms[cni].nz;
              // Interior-face cull: shoot a test point outward along the normal.
              // If that point is still inside the podium polygon, this face is interior — skip it.
              var probeD = Math.max(polyBW, polyBD) + 1; // probe well past podium boundary
              var probePx = cmx + cnx * probeD, probePz = cmz + cnz * probeD;
              if(_pipM(probePx, probePz, podiumPolyM)) continue;
              var edgeAngle = Math.atan2(cnx, cnz);
              // Tower edges always render with ZERO interior depth — the curtain
              // wall is just glass + mullions + spandrels, no back walls, no
              // partition walls between "apartments", no interior floor slabs.
              // Those interior elements were misaligning on irregular polygon
              // towers (visible as misplaced internal walls through the glass),
              // so they're disabled for the tower entirely.
              addCurtainWall(g, cmx + cnx * 0.01, towerBaseY, cmz + cnz * 0.01, cELM, twrFloors, upperH, edgeAngle, {
                bayWidth: 3.0,
                backDepthM: 0
              });
            }
          }
        }

        // ── Balconies along polygon edges ──
        // PROPERTY-LINE GUARANTEE: regardless of vol.balconies / balcN/S/E/W,
        // a balcony will NEVER be drawn if its outer face would extend beyond
        // the LOT polygon (the property line). This prevents the recurring
        // "walls outside the building" issue where balconies project onto the
        // neighbour's land. Lot polygon is fetched from lotVerts() in feet.
        var _lotPolyPLForBalc = null;
        if(typeof lotVerts === 'function'){
          try {
            var _lvForBalc = lotVerts();
            if(_lvForBalc && _lvForBalc.length >= 3){
              _lotPolyPLForBalc = _lvForBalc.slice();
              if(_lotPolyPLForBalc[0][0] !== _lotPolyPLForBalc[_lotPolyPLForBalc.length-1][0] ||
                 _lotPolyPLForBalc[0][1] !== _lotPolyPLForBalc[_lotPolyPLForBalc.length-1][1]){
                _lotPolyPLForBalc.push([_lotPolyPLForBalc[0][0], _lotPolyPLForBalc[0][1]]);
              }
            }
          } catch(e){}
        }
        function _ptInsideLotPL(xFt, zFt){
          if(!_lotPolyPLForBalc) return true;        // no lot polygon — allow (rectangular volumes etc.)
          var inside = false;
          var n = _lotPolyPLForBalc.length - 1;
          for(var pli = 0, plj = n - 1; pli < n; plj = pli++){
            var xi = _lotPolyPLForBalc[pli][0], yi = _lotPolyPLForBalc[pli][1];
            var xj = _lotPolyPLForBalc[plj][0], yj = _lotPolyPLForBalc[plj][1];
            if(((yi > zFt) !== (yj > zFt)) && (xFt < (xj - xi) * (zFt - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
          }
          return inside;
        }

        /* Per-side flags (balcN/S/E/W) are AUTHORITATIVE — if any is on,
           balconies render. The master `vol.balconies` toggle used to veto
           everything even when per-side flags were on, which surprised users
           (they'd toggle a side checkbox on and nothing would happen).
           New rule:
             - any per-side flag on  → showBalc = true
             - all per-side flags off → showBalc = false
             - per-side flags missing → fall back to master `vol.balconies`
               (defaulting to true if it's also undefined). */
        var anySideOn = !!(vol.balcN || vol.balcS || vol.balcE || vol.balcW);
        var anySideDefined = vol.balcN !== undefined || vol.balcS !== undefined ||
                             vol.balcE !== undefined || vol.balcW !== undefined;
        var showBalc;
        if(anySideDefined){
          showBalc = anySideOn;          /* per-side wins */
        } else {
          showBalc = vol.balconies !== undefined ? !!vol.balconies : true;
        }
        var bEvery = vol.balcEvery || 2;
        var bDep = f2m(vol.balcDepth || 4);
        if(showBalc && showWin && !hasOverlappingTaller){
          for(var bf = 0; bf < upFloors; bf++){
            if(bf % bEvery !== 0) continue;
            var bfy = storeyH + bf * upperH;
            // Use tower polygon for floors above podium, original polygon for podium floors
            var isTowerFloor = bf >= podiumFloors;
            /* SKIP tower floors here — they're handled by the dedicated tower
               balcony pass below, which uses simpler unconstrained logic that
               actually produces visible balconies on the tower. */
            if(isTowerFloor) continue;
            var balcEdgePts = isTowerFloor ? towerClosedPtsFt : closedPts;
            var balcNormFn = isTowerFloor ? towerEdgeNormals : edgeNormals;
            for(var bei = 0; bei < balcEdgePts.length; bei++){
              var bp0 = balcEdgePts[bei], bp1 = balcEdgePts[(bei + 1) % balcEdgePts.length];
              var bELen = Math.sqrt((bp1[0] - bp0[0]) * (bp1[0] - bp0[0]) + (bp1[1] - bp0[1]) * (bp1[1] - bp0[1]));
              if(bELen < 4) continue;
              var bELM = f2m(bELen);
              var bdx = bp1[0] - bp0[0], bdz = bp1[1] - bp0[1];
              var bnorms = balcNormFn(bp0, bp1);
              for(var bni = 0; bni < bnorms.length; bni++){
                var onx = bnorms[bni].nx, onz = bnorms[bni].nz;
                // Interior-face cull for tower floors: skip edges facing into podium interior
                if(isTowerFloor && towerClosedPtsFt !== closedPts){
                  var bMidX = f2m((bp0[0] + bp1[0]) / 2), bMidZ = f2m((bp0[1] + bp1[1]) / 2);
                  var bProbeD = Math.max(polyBW, polyBD) + 1;
                  if(_pipM(bMidX + onx * bProbeD, bMidZ + onz * bProbeD, podiumPolyM)) continue;
                }
                var bcard = normalCardinal(onx, onz);
                /* Each cardinal direction now respects its OWN flag (vol.balcN
                   for N edges, vol.balcS for S, etc.). Previous code wired N
                   and S to the master `showBalc`, which meant clicking just
                   "East" caused balconies to also appear on N and S edges
                   because showBalc became true the moment any per-side flag
                   was on.
                   Backward-compat: if a per-side flag is `undefined` (e.g. an
                   old saved project that never had directional flags), fall
                   back to the master `showBalc` so legacy data still renders. */
                var sideOk = true;
                if(bcard === 'N')      sideOk = (vol.balcN !== undefined) ? vol.balcN > 0 : showBalc;
                else if(bcard === 'S') sideOk = (vol.balcS !== undefined) ? vol.balcS > 0 : showBalc;
                else if(bcard === 'E') sideOk = (vol.balcE !== undefined) ? vol.balcE > 0 : false;
                else if(bcard === 'W') sideOk = (vol.balcW !== undefined) ? vol.balcW > 0 : false;
                if(!sideOk) continue;
                // ── CONCAVE-EDGE BALCONY SUPPRESSION ──
                // At concave corners the balcony projects into a dent that's
                // visible from outside the building. Even if the balcony is
                // technically inside the lot, it looks like a wall "protruding"
                // from the building when viewed through the concave gap. Skip
                // balconies entirely on concave-adjacent edges.
                if(_isConcaveVertex && _edgeAdjacentToConcave && _edgeAdjacentToConcave(bei)){
                  continue;
                }
                var balcCount = Math.max(1, Math.floor(bELM / 4));
                var balcW = bELM / balcCount - 0.3;
                var normAngle = Math.atan2(onx, onz);
                for(var bb = 0; bb < balcCount; bb++){
                  var bt = (bb + 0.5) / balcCount;
                  var bbx = f2m(bp0[0] + bdx * bt), bbz = f2m(bp0[1] + bdz * bt);
                  /* PROPERTY-LINE CHECK (relaxed):
                     Old behaviour rejected any balcony whose OUTER face extended
                     past the lot polygon — but if the user has matched their
                     building footprint to the lot (Match Lot button or default
                     parametric width = lot width), every balcony's outer face is
                     by definition past the lot edge, so all balconies were
                     suppressed.
                     New rule: check a probe point 1 ft INSIDE the building face
                     (i.e. inside the volume mass). If that point is inside the
                     lot polygon, the balcony is OK to draw — its visual mass
                     belongs to this lot even if it cantilevers slightly past
                     the property line. This still suppresses balconies on
                     faces that point INTO an adjacent parcel (e.g. a side wall
                     directly abutting another lot's interior). */
                  var balcInnerXFt = bp0[0] + bdx * bt - onx * 1.0;
                  var balcInnerZFt = bp0[1] + bdz * bt - onz * 1.0;
                  if(!_ptInsideLotPL(balcInnerXFt, balcInnerZFt)){
                    continue;
                  }
                  /* PER-BALCONY abutment check — probe at the balcony's OUTER
                     edge (building face + balcony depth + small buffer) to
                     catch neighbours that the balcony would project OVER, not
                     just neighbours directly against the building wall. Each
                     individual balcony gets its own decision based on its
                     specific X-Z position along the edge AND this floor's Y. */
                  var balcFloorMidYM = bfy + upperH * 0.5;
                  /* Balcony's center XZ in lot-feet coords (it's at the building
                     face — bbx/bbz are already the face-edge midpoint of THIS
                     balcony in world metres; convert back to feet for probe). */
                  var balcCenterXFt = bp0[0] + bdx * bt;
                  var balcCenterZFt = bp0[1] + bdz * bt;
                  /* Probe distance = balcony depth + 2 ft so we sample the
                     balcony's outer-face position. If a neighbour sits there
                     and is tall enough to reach this floor, drop the balcony. */
                  var balcProbeFt = (vol.balcDepth || 4) + 2;
                  if(_isPointAbuttedByContext(balcCenterXFt, balcCenterZFt, onx, onz, balcFloorMidYM, balcProbeFt)){
                    continue;
                  }
                  /* Tiny 0.05m offset — balcony attaches directly to the building
                     face like real architecture. The slab projects outward by
                     `bDep` so it's still visible past the wall. */
                  addBalconyUnit(g, bbx + onx * 0.05, bfy, bbz + onz * 0.05, balcW, bDep, normAngle);
                }
              }
            }
          }
        }

        /* ──────────────────────────────────────────────────────────────────────
           DEDICATED TOWER BALCONY PASS — bypass-all-constraints
           The constrained loop above produces no visible balconies on the tower
           because of curtain wall occlusion / per-edge geometry quirks. This
           second pass just iterates every tower polygon edge and adds visible
           balconies. No concave check, no abutment check, no per-side toggle —
           it draws unconditionally. Skipped when the tower has no upper floors
           (e.g. midrise / podium-only volumes).
           ────────────────────────────────────────────────────────────────── */
        if(twrFloors > 0 && Array.isArray(towerClosedPtsFt) && towerClosedPtsFt.length >= 3 && showWin){
          var twrBalcEvery = vol.balcEvery || 2;
          /* Tower floor index — relative to the start of upper floors (bf=0
             is the first floor above GF). Tower floors start at bf=podiumFloors. */
          /* Skip tbf === podiumFloors (the FIRST tower floor immediately above
             the podium). That floor gets a LARGE PATIO/TERRACE instead of small
             projecting balconies — see the podium-roof patio rendering further
             down. Without this skip, you'd see both small balconies AND a
             patio on the same floor, looking cluttered. */
          for(var tbf = podiumFloors + 1; tbf < upFloors; tbf++){
            if((tbf - podiumFloors) % twrBalcEvery !== 0) continue;
            var tbfy = storeyH + tbf * upperH;
            for(var tbei = 0; tbei < towerClosedPtsFt.length; tbei++){
              var tbp0 = towerClosedPtsFt[tbei];
              var tbp1 = towerClosedPtsFt[(tbei + 1) % towerClosedPtsFt.length];
              var tbELen = Math.sqrt((tbp1[0]-tbp0[0])*(tbp1[0]-tbp0[0]) + (tbp1[1]-tbp0[1])*(tbp1[1]-tbp0[1]));
              if(tbELen < 6) continue;        /* skip tiny segments */
              var tbELM = f2m(tbELen);
              var tbnorms = towerEdgeNormals(tbp0, tbp1);
              for(var tbni = 0; tbni < tbnorms.length; tbni++){
                var tbnx = tbnorms[tbni].nx, tbnz = tbnorms[tbni].nz;
                /* Filter using per-side toggles so user controls still work. */
                var tbcard = normalCardinal(tbnx, tbnz);
                var tbsideOk = true;
                if(tbcard === 'N')      tbsideOk = vol.balcN === undefined ? true : vol.balcN > 0;
                else if(tbcard === 'S') tbsideOk = vol.balcS === undefined ? true : vol.balcS > 0;
                else if(tbcard === 'E') tbsideOk = vol.balcE === undefined ? true : vol.balcE > 0;
                else if(tbcard === 'W') tbsideOk = vol.balcW === undefined ? true : vol.balcW > 0;
                if(!tbsideOk) continue;
                var tbAngle = Math.atan2(tbnx, tbnz);
                /* One balcony every ~4m along the edge. */
                var tbCount = Math.max(1, Math.floor(tbELM / 4));
                var tbW = tbELM / tbCount - 0.3;
                var tbDep = f2m(vol.balcDepth || 4);
                var tbDx = tbp1[0] - tbp0[0], tbDz = tbp1[1] - tbp0[1];
                for(var tbb = 0; tbb < tbCount; tbb++){
                  var tbt = (tbb + 0.5) / tbCount;
                  var tbbx = f2m(tbp0[0] + tbDx * tbt);
                  var tbbz = f2m(tbp0[1] + tbDz * tbt);
                  /* Tiny 0.05m offset — balcony attaches directly to the tower
                     curtain wall instead of floating in space in front of it. */
                  addBalconyUnit(g, tbbx + tbnx * 0.05, tbfy, tbbz + tbnz * 0.05, tbW, tbDep, tbAngle);
                }
              }
            }
          }
        }

        // Floor slabs on every level — tower floors use inset polygon
        if(!hasOverlappingTaller){
          for(var fl3 = 0; fl3 < upFloors; fl3++){
            var fy3 = storeyH + fl3 * upperH;
            var isTwrSlab = fl3 >= podiumFloors;
            var slabShape = isTwrSlab && twrFloors > 0 && towerClosedPtsFt !== closedPts ? twrShape : shapeWithHoles;
            var slabGeo = new THREE.ShapeGeometry(slabShape); slabGeo.rotateX(-Math.PI / 2);
            var slab = new THREE.Mesh(slabGeo, MAT.concreteDark); slab.position.y = fy3 + 0.02; slab.receiveShadow = true; g.add(slab);
            var slabEdgePts = isTwrSlab ? towerClosedPtsFt : closedPts;
            var slabNormFn = isTwrSlab ? towerEdgeNormals : edgeNormals;
            for(var sei = 0; sei < slabEdgePts.length; sei++){
              // Skip slab edge on concave-adjacent edges — slab would project
              // into the concave dent and be visible from outside as a wall
              // protrusion. Same rule as balconies and back walls.
              if(_isConcaveVertex && _edgeAdjacentToConcave && _edgeAdjacentToConcave(sei)){
                continue;
              }
              var sp0 = slabEdgePts[sei], sp1 = slabEdgePts[(sei + 1) % slabEdgePts.length];
              var seLen = Math.sqrt((sp1[0] - sp0[0]) * (sp1[0] - sp0[0]) + (sp1[1] - sp0[1]) * (sp1[1] - sp0[1]));
              if(seLen < 2) continue;
              var seLM = f2m(seLen);
              var smx = f2m((sp0[0] + sp1[0]) / 2), smz = f2m((sp0[1] + sp1[1]) / 2);
              if(findOverlappingTallerVol(smx, smz, vi, totalH) >= 0) continue;
              var snorms = slabNormFn(sp0, sp1);
              for(var sni = 0; sni < snorms.length; sni++){
                var snx = snorms[sni].nx, snz = snorms[sni].nz;
                var slabEdge = mk(new THREE.BoxGeometry(seLM, 0.06, 0.05), MAT.concreteDark, 0, 0, 0);
                slabEdge.position.set(smx + snx * 0.18, fy3 + 0.03, smz + snz * 0.18);
                slabEdge.rotation.y = Math.atan2(snx, snz);
                slabEdge.castShadow = true; g.add(slabEdge);
              }
            }
          }
        }

        // Interior furniture intentionally not rendered — appears as floating objects
        // through semi-transparent curtain wall glass. Lit-window emissive planes
        // (added per bay in addCurtainWall + punched window blocks) handle the
        // "occupied building" effect at night without needing furniture meshes.
      }

      // ── ROOF with parapet — use tower polygon if stepback exists ──
      // Tower-green-roof toggle: read from localStorage. When ON, swap roof
      // material to MAT.greenRoof so the user can visualize a green-roof
      // retrofit and the stormwater calc gets a real retention credit.
      var towerGreenOn = false;
      try { towerGreenOn = (typeof localStorage !== 'undefined' && localStorage.getItem('cc_tower_green_roof') === '1'); } catch(e){}
      var roofMembraneMat = new THREE.MeshStandardMaterial({color:0x2a2828, roughness:0.95, metalness:0.01});
      var roofShape = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? twrShape : shapeWithHoles;
      var roofEdgePts = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? towerClosedPtsFt : closedPts;
      var roofNormFn = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? towerEdgeNormals : edgeNormals;
      // Compute and cache the real roof polygon area for the consultant module
      try {
        if(Array.isArray(roofEdgePts) && roofEdgePts.length >= 3){
          var rfA = 0;
          for(var rfi = 0; rfi < roofEdgePts.length; rfi++){
            var rfp = roofEdgePts[rfi];
            var rfn = roofEdgePts[(rfi+1) % roofEdgePts.length];
            if(!rfp || !rfn || rfp.length < 2 || rfn.length < 2) continue;
            rfA += rfp[0]*rfn[1] - rfn[0]*rfp[1];
          }
          vol._towerRoofAreaSF = Math.abs(rfA) / 2;
        }
      } catch(e){ console.warn('[CC] tower roof area calc failed:', e); }
      var roofGeo2 = new THREE.ShapeGeometry(roofShape); roofGeo2.rotateX(-Math.PI / 2);
      var roofMatToUse = (towerGreenOn && typeof MAT !== 'undefined' && MAT.greenRoof) ? MAT.greenRoof : roofMembraneMat;
      var roof2 = new THREE.Mesh(roofGeo2, roofMatToUse);
      roof2.position.y = totalH + 0.02; roof2.receiveShadow = true; g.add(roof2);
      // Add scatter of shrub spheres on tower green roof for visual depth
      if(towerGreenOn && typeof MAT !== 'undefined' && MAT.shrubA && roofEdgePts.length >= 3){
        try {
          var rxs = roofEdgePts.map(function(p){return p[0];});
          var rzs = roofEdgePts.map(function(p){return p[1];});
          var rMinX = Math.min.apply(null, rxs), rMaxX = Math.max.apply(null, rxs);
          var rMinZ = Math.min.apply(null, rzs), rMaxZ = Math.max.apply(null, rzs);
          var nShrubs = Math.min(40, Math.floor(vol._towerRoofAreaSF / 200));
          for(var si = 0; si < nShrubs; si++){
            var sx = rMinX + Math.random() * (rMaxX - rMinX);
            var sz = rMinZ + Math.random() * (rMaxZ - rMinZ);
            // Rough point-in-polygon check
            var inside = false;
            for(var pi=0, pj=roofEdgePts.length-1; pi<roofEdgePts.length; pj=pi++){
              var pix=roofEdgePts[pi][0], piy=roofEdgePts[pi][1];
              var pjx=roofEdgePts[pj][0], pjy=roofEdgePts[pj][1];
              if(((piy>sz)!==(pjy>sz)) && (sx<(pjx-pix)*(sz-piy)/(pjy-piy)+pix)) inside = !inside;
            }
            if(!inside) continue;
            var shrubR = 0.3 + Math.random() * 0.2;
            var shrub = new THREE.Mesh(new THREE.SphereGeometry(shrubR, 8, 6), si % 2 === 0 ? MAT.shrubA : MAT.shrubB);
            shrub.position.set(f2m(sx), totalH + 0.05 + shrubR * 0.7, f2m(sz));
            shrub.scale.y = 0.65 + Math.random() * 0.2;
            g.add(shrub);
          }
        } catch(e){}
      }
      var resParapetH2 = 0.6;
      for(var rei = 0; rei < roofEdgePts.length; rei++){
        var rp0 = roofEdgePts[rei], rp1 = roofEdgePts[(rei + 1) % roofEdgePts.length];
        var reLen = Math.sqrt((rp1[0] - rp0[0]) * (rp1[0] - rp0[0]) + (rp1[1] - rp0[1]) * (rp1[1] - rp0[1]));
        if(reLen < 1) continue;
        var reLM = f2m(reLen);
        var rmx = f2m((rp0[0] + rp1[0]) / 2), rmz = f2m((rp0[1] + rp1[1]) / 2);
        if(findOverlappingTallerVol(rmx, rmz, vi, totalH) >= 0) continue;
        var rnorms = roofNormFn(rp0, rp1);
        for(var rni = 0; rni < rnorms.length; rni++){
          var rnx = rnorms[rni].nx, rnz = rnorms[rni].nz;
          var rang = Math.atan2(rnx, rnz);
          var parapet = mk(new THREE.BoxGeometry(reLM, resParapetH2, 0.12), MAT.concreteDark, 0, resParapetH2 / 2, 0);
          parapet.position.set(rmx + rnx * 0.06, totalH, rmz + rnz * 0.06); parapet.rotation.y = rang; g.add(parapet);
          var capM = mk(new THREE.BoxGeometry(reLM + 0.05, 0.04, 0.18), MAT.steelDark, 0, resParapetH2 + 0.02, 0);
          capM.position.set(rmx + rnx * 0.06, totalH, rmz + rnz * 0.06); capM.rotation.y = rang; g.add(capM);
        }
      }

      // ── MECHANICAL PENTHOUSE (tallest volume only) ──
      if(vol.storeys > 3 && vi === tallestVi){
        // Use the tower polygon (inset) for sizing if available, otherwise podium
        var mechRefW = polyBW, mechRefD = polyBD;
        var mechCX = towerPolyCX, mechCZ = towerPolyCZ;
        if(typeof towerClosedPtsFt !== 'undefined' && towerClosedPtsFt.length >= 3){
          var mxs = towerClosedPtsFt.map(function(p){return f2m(p[0]);}), mzs = towerClosedPtsFt.map(function(p){return f2m(p[1]);});
          mechRefW = Math.max.apply(null, mxs) - Math.min.apply(null, mxs);
          mechRefD = Math.max.apply(null, mzs) - Math.min.apply(null, mzs);
        }
        // Align penthouse to longest edge of the roof polygon
        var longestEdgeLen = 0, longestAngle = 0;
        var roofRef = (typeof towerClosedPtsFt !== 'undefined' && towerClosedPtsFt.length >= 3) ? towerClosedPtsFt : closedPts;
        for(var mei = 0; mei < roofRef.length; mei++){
          var mp0 = roofRef[mei], mp1 = roofRef[(mei + 1) % roofRef.length];
          var meLen = Math.sqrt((mp1[0] - mp0[0]) * (mp1[0] - mp0[0]) + (mp1[1] - mp0[1]) * (mp1[1] - mp0[1]));
          if(meLen > longestEdgeLen){ longestEdgeLen = meLen; longestAngle = Math.atan2(f2m(mp1[0] - mp0[0]), f2m(mp1[1] - mp0[1])); }
        }
        var mechW2 = Math.min(mechRefW * 0.45, 8.0);
        var mechD2 = Math.min(mechRefD * 0.40, 6.0);
        var mechH2 = 2.8;
        if(mechW2 > 1.5 && mechD2 > 1.5){
          var mechY2 = totalH + 0.02;
          var mechGrp = new THREE.Group();
          // Main enclosure
          mechGrp.add(mk(new THREE.BoxGeometry(mechW2, mechH2, mechD2), MAT.concreteDark, 0, mechH2 / 2, 0));
          // Cap flashing
          mechGrp.add(mk(new THREE.BoxGeometry(mechW2 + 0.08, 0.05, mechD2 + 0.08), MAT.steelDark, 0, mechH2 + 0.025, 0));
          // Louvers on two faces
          var lCount2 = Math.floor(mechH2 / 0.35);
          for(var li2 = 0; li2 < lCount2; li2++){
            var ly2 = 0.3 + li2 * 0.35;
            mechGrp.add(mk(new THREE.BoxGeometry(mechW2 * 0.7, 0.04, 0.05), MAT.steelDark, 0, ly2, -mechD2 / 2 - 0.025));
            mechGrp.add(mk(new THREE.BoxGeometry(mechW2 * 0.7, 0.04, 0.05), MAT.steelDark, 0, ly2, mechD2 / 2 + 0.025));
          }
          // Rooftop equipment (condensers, exhaust)
          for(var ri2 = 0; ri2 < 3; ri2++){
            var rW2 = 0.8 + Math.random() * 0.4, rD2 = 0.6 + Math.random() * 0.3, rH2 = 0.35 + Math.random() * 0.2;
            mechGrp.add(mk(new THREE.BoxGeometry(rW2, rH2, rD2), MAT.steel, -1.2 + ri2 * 1.2, mechH2 + rH2 / 2 + 0.06, 0));
          }
          mechGrp.position.set(mechCX, mechY2, mechCZ);
          mechGrp.rotation.y = longestAngle;
          g.add(mechGrp);
        }
      }

      // Volume ground outline removed — lot boundary is shown by rebuildLot().
      // Restore parent group and add the volume sub-group.
      // CRITICAL: tag with _volIdx so click-to-drag (renderer.js mousedown) can
      // find this volume when the user clicks on it. Without this tag, getVolIdxFromMesh
      // returns -1 and polygon volumes (e.g. AI-generated tower) can't be dragged.
      g = _parentG;
      volG._volIdx = vi;
      g.add(volG);
      return; // skip rectangular
     }catch(polyErr){
      console.error('CUSTOM POLY ERROR for', vol.name, ':', polyErr.message, polyErr.stack);
      g = _parentG; // restore on error too
      volG._volIdx = vi;
      g.add(volG);
     }
    }

    // ══════════════════════════════════════════
    //  RECTANGULAR VOLUMES
    // ══════════════════════════════════════════
    var cx1 = f2m(lotMaxX) - f2m(vol.offEast || 0);
    var cx0 = cx1 - f2m(vol.width);
    var cz0 = f2m(vol.startEg || 0);
    var cz1 = cz0 + f2m(vol.depth || 0);
    var bw = f2m(vol.width), bd = f2m(vol.depth || 0);
    if(bw <= 0 || bd <= 0 || vol.storeys <= 0) return;

    var hideN = faceHidden(vi, 'north');
    var hideS = faceHidden(vi, 'south');
    var hideE = faceHidden(vi, 'east');
    var hideW = faceHidden(vi, 'west');
    var childrenBefore = g.children.length;

    // Street-facing detection
    var frontZ = 0, rearZ = f2m(maxZ), streetTol = f2m(3);
    var frontsFront = (cz0 < frontZ + streetTol);
    var frontsRear = (cz1 > rearZ - streetTol);
    // Fix 6: When commGF is true, front face always gets storefronts
    var sfN = hasComm || (vol.storefrontN !== undefined ? !!vol.storefrontN : frontsFront);
    var sfS = vol.storefrontS !== undefined ? !!vol.storefrontS : frontsRear;
    var sfE = vol.storefrontE !== undefined ? !!vol.storefrontE : false;
    var sfW = vol.storefrontW !== undefined ? !!vol.storefrontW : false;

    // ── GROUND FLOOR (15' commercial) ──
    // Dark plinth at base
    var plinthH = 0.3;
    g.add(mk(new THREE.BoxGeometry(bw + 0.04, plinthH, bd + 0.04), MAT.brickDark, cx0 + bw/2, plinthH/2, cz0 + bd/2));
    // Brick mass for ground floor (always brick, never cedar — Fix 8)
    g.add(mk(new THREE.BoxGeometry(bw, storeyH, bd), MAT.brick, cx0 + bw/2, storeyH/2, cz0 + bd/2));

    // GF Storefront faces
    function addGFStorefront(faceW, px, py, pz, rotY){
      var sfGr = new THREE.Group();
      var baseH = storeyH * 0.08;
      var glassH = storeyH * 0.78;
      var headerH = storeyH - baseH - glassH;
      // Base
      sfGr.add(mk(new THREE.BoxGeometry(faceW, baseH, 0.06), MAT.brickDark, 0, baseH/2, 0));
      // Steel I-beam columns every ~18ft (Fix 6)
      var colSpacing = 5.5;
      var nCols = Math.max(2, Math.floor(faceW / colSpacing));
      var actualColSpacing = faceW / nCols;
      for(var c = 0; c <= nCols; c++){
        var cx2 = c * actualColSpacing - faceW/2;
        // I-beam profile: web + 2 flanges
        sfGr.add(mk(new THREE.BoxGeometry(0.10, glassH + 0.1, 0.08), MAT.steelDark, cx2, baseH + glassH/2, 0.04));
        sfGr.add(mk(new THREE.BoxGeometry(0.22, glassH + 0.1, 0.015), MAT.steelDark, cx2, baseH + glassH/2, 0.08));
        sfGr.add(mk(new THREE.BoxGeometry(0.22, glassH + 0.1, 0.015), MAT.steelDark, cx2, baseH + glassH/2, 0.0));
      }
      // Large storefront glass panels between columns
      for(var bay = 0; bay < nCols; bay++){
        var bayCenter = (bay + 0.5) * actualColSpacing - faceW/2;
        var panelW = actualColSpacing - 0.4;
        var panelH = glassH - 0.2;
        var sfGlass = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), MAT.glassSF);
        sfGlass.position.set(bayCenter, baseH + glassH/2, 0.02);
        sfGr.add(sfGlass);
      }
      // Steel header beam
      sfGr.add(mk(new THREE.BoxGeometry(faceW, 0.08, 0.1), MAT.steelDark, 0, baseH + glassH, 0.05));
      // Header panel
      if(headerH > 0.05) sfGr.add(mk(new THREE.BoxGeometry(faceW, headerH, 0.04), MAT.concreteDark, 0, storeyH - headerH/2, 0));
      sfGr.position.set(px, py, pz);
      if(rotY) sfGr.rotation.y = rotY;
      g.add(sfGr);
    }
    function addGFBrick(faceW, px, py, pz, rotY){
      var bp = new THREE.Mesh(new THREE.PlaneGeometry(faceW, storeyH), MAT.brick);
      bp.position.set(px, py + storeyH/2, pz);
      if(rotY) bp.rotation.y = rotY;
      g.add(bp);
      // Standardised punched windows — same size as podium (Fix 7), Z=0.3 (Fix 8: always brick)
      var gfWinSpacing = 4.0;
      var nWin = Math.max(1, Math.floor(faceW / gfWinSpacing));
      var gfActualSpacing = faceW / nWin;
      var gfWinW = storeyH * 0.5;
      var gfWinH = storeyH * 0.55;
      var gfSeed = Math.abs(Math.round((px + pz * 7.13) * 1000)) % 9999;
      for(var wi = 0; wi < nWin; wi++){
        var wCX = -faceW/2 + gfActualSpacing/2 + wi * gfActualSpacing;
        var wm = new THREE.Mesh(new THREE.PlaneGeometry(gfWinW, gfWinH), MAT.punchedWin);
        wm.position.set(wCX, storeyH * 0.55, 0.3);
        var wGr = new THREE.Group();
        wGr.add(wm);
        // Interior unit glow — placed in front of opaque punched window at night
        if(_winLit(0, wi, gfSeed)){
          var gfGlow = new THREE.Mesh(new THREE.PlaneGeometry(gfWinW - 0.06, gfWinH - 0.06), _winGlowMat(0, wi, gfSeed));
          gfGlow.position.set(wCX, storeyH * 0.55, 0.305);
          wGr.add(gfGlow);
        }
        wGr.position.set(px, py, pz);
        if(rotY) wGr.rotation.y = rotY;
        g.add(wGr);
      }
    }
    if(!hideN){ if(sfN) addGFStorefront(bw, cx0+bw/2, 0, cz0-0.02, 0); else addGFBrick(bw, cx0+bw/2, 0, cz0-0.02, 0); }
    if(!hideS){ if(sfS) addGFStorefront(bw, cx0+bw/2, 0, cz1+0.02, Math.PI); else addGFBrick(bw, cx0+bw/2, 0, cz1+0.02, Math.PI); }
    if(!hideW){ if(sfW) addGFStorefront(bd, cx0-0.02, 0, cz0+bd/2, Math.PI/2); else addGFBrick(bd, cx0-0.02, 0, cz0+bd/2, Math.PI/2); }
    if(!hideE){ if(sfE) addGFStorefront(bd, cx1+0.02, 0, cz0+bd/2, -Math.PI/2); else addGFBrick(bd, cx1+0.02, 0, cz0+bd/2, -Math.PI/2); }

    // ── GROUND FLOOR ZONE MARKERS (lobby, loading, parking ramp) ──
    // These are placed on non-retail faces to show functional ground-floor program
    if(hasComm && vi === 0){
      var lobbyW = f2m(12), lobbyH = storeyH * 0.85; // ~12ft wide lobby
      var loadW = f2m(12), loadH = storeyH * 0.7;     // ~12ft wide loading bay
      var rampOpenW = f2m(14), rampOpenH = storeyH * 0.65; // ~14ft ramp opening

      // Place lobby on the south face (residential entry off side street), loading on east
      // Lobby — glass double-door entrance with canopy
      if(!hideS){
        var lobbyGr = new THREE.Group();
        // Glass doors
        lobbyGr.add(mk(new THREE.PlaneGeometry(lobbyW, lobbyH), MAT.glassSF, 0, lobbyH / 2 + storeyH * 0.08, 0.01));
        // Door frame
        lobbyGr.add(mk(new THREE.BoxGeometry(lobbyW + 0.1, 0.06, 0.08), MAT.steelDark, 0, lobbyH + storeyH * 0.08, 0.01));
        lobbyGr.add(mk(new THREE.BoxGeometry(0.06, lobbyH, 0.08), MAT.steelDark, -lobbyW / 2, lobbyH / 2 + storeyH * 0.08, 0.01));
        lobbyGr.add(mk(new THREE.BoxGeometry(0.06, lobbyH, 0.08), MAT.steelDark, lobbyW / 2, lobbyH / 2 + storeyH * 0.08, 0.01));
        // Canopy overhang
        lobbyGr.add(mk(new THREE.BoxGeometry(lobbyW + f2m(4), 0.08, f2m(6)), MAT.concreteDark, 0, storeyH - 0.2, -f2m(3)));
        lobbyGr.position.set(cx0 + bw * 0.3, 0, cz1 + 0.04);
        lobbyGr.rotation.y = Math.PI;
        g.add(lobbyGr);
        addTextSprite(g, 'LOBBY', cx0 + bw * 0.3, storeyH * 0.4, cz1 + f2m(2), '#88ccff', 0.25);
      }
      // Loading bay — roll-up door on east face (or west if east is hidden)
      var loadFace = hideE ? 'west' : 'east';
      var loadX = loadFace === 'east' ? cx1 + 0.04 : cx0 - 0.04;
      var loadRot = loadFace === 'east' ? -Math.PI / 2 : Math.PI / 2;
      if(!(loadFace === 'east' ? hideE : hideW)){
        var loadGr = new THREE.Group();
        // Roll-up door (dark opening)
        loadGr.add(mk(new THREE.PlaneGeometry(loadW, loadH), new THREE.MeshBasicMaterial({color:0x1a1a1a}), 0, loadH / 2 + 0.05, 0.01));
        // Door frame
        loadGr.add(mk(new THREE.BoxGeometry(loadW + 0.15, 0.08, 0.1), MAT.steelDark, 0, loadH + 0.09, 0.01));
        loadGr.add(mk(new THREE.BoxGeometry(0.08, loadH + 0.08, 0.1), MAT.steelDark, -loadW / 2 - 0.04, loadH / 2 + 0.05, 0.01));
        loadGr.add(mk(new THREE.BoxGeometry(0.08, loadH + 0.08, 0.1), MAT.steelDark, loadW / 2 + 0.04, loadH / 2 + 0.05, 0.01));
        loadGr.position.set(loadX, 0, cz1 - f2m(8));
        loadGr.rotation.y = loadRot;
        g.add(loadGr);
        addTextSprite(g, 'LOADING', loadX + (loadFace === 'east' ? f2m(2) : -f2m(2)), storeyH * 0.4, cz1 - f2m(8), '#ff9944', 0.22);
      }
      // Parking ramp opening — on east face near south end (or same face as loading but offset)
      if(!(loadFace === 'east' ? hideE : hideW)){
        var rampGr = new THREE.Group();
        rampGr.add(mk(new THREE.PlaneGeometry(rampOpenW, rampOpenH), new THREE.MeshBasicMaterial({color:0x111111}), 0, rampOpenH / 2 + 0.05, 0.01));
        rampGr.add(mk(new THREE.BoxGeometry(rampOpenW + 0.15, 0.08, 0.1), MAT.steelDark, 0, rampOpenH + 0.09, 0.01));
        rampGr.add(mk(new THREE.BoxGeometry(0.08, rampOpenH + 0.08, 0.1), MAT.steelDark, -rampOpenW / 2 - 0.04, rampOpenH / 2 + 0.05, 0.01));
        rampGr.add(mk(new THREE.BoxGeometry(0.08, rampOpenH + 0.08, 0.1), MAT.steelDark, rampOpenW / 2 + 0.04, rampOpenH / 2 + 0.05, 0.01));
        rampGr.position.set(loadX, 0, cz0 + f2m(10));
        rampGr.rotation.y = loadRot;
        g.add(rampGr);
        addTextSprite(g, 'P. RAMP', loadX + (loadFace === 'east' ? f2m(2) : -f2m(2)), storeyH * 0.4, cz0 + f2m(10), '#ff9944', 0.22);
      }
    }

    // ── UPPER FLOORS ──
    if(vol.storeys > 1){
      var upFloors = vol.storeys - 1;
      var upH = upFloors * upperH;

      // Podium = first 3 floors above GF (floors 2-4 = brick)
      var podiumFloors2 = Math.min(3, upFloors);
      var towerFloors2 = upFloors - podiumFloors2;
      var podiumH2 = podiumFloors2 * upperH;
      var towerH2 = towerFloors2 * upperH;

      // ── TOWER STEPBACK (so podium roof terrace is exposed) ──
      var stepbackM = towerFloors2 > 0 ? f2m(vol.stepbackAmt != null ? vol.stepbackAmt : 5) : 0;
      var tCx0 = cx0 + stepbackM, tCx1 = cx1 - stepbackM;
      var tCz0 = cz0 + stepbackM, tCz1 = cz1 - stepbackM;
      var tBw = bw - stepbackM * 2, tBd = bd - stepbackM * 2;
      var tCenterX = cx0 + bw / 2, tCenterZ = cz0 + bd / 2;

      // ── BRICK PODIUM (floors 2-4) ──
      if(podiumFloors2 > 0){
        // Opaque brick core
        var podCoreMat2 = new THREE.MeshStandardMaterial({color:0x7a5040, roughness:0.88, metalness:0.01});
        g.add(mk(new THREE.BoxGeometry(bw - 0.04, podiumH2, bd - 0.04), podCoreMat2, cx0+bw/2, storeyH+podiumH2/2, cz0+bd/2));

        // Brick faces with punched windows
        function addBrickPodiumFace(faceW, nFlr, flrH, px, baseY, pz, rotY2){
          var fGr = new THREE.Group();
          // Always brick on podium (Fix 8: never cedar on brick podium)
          fGr.add(new THREE.Mesh(new THREE.PlaneGeometry(faceW, nFlr * flrH), MAT.brick));
          fGr.children[0].position.set(0, nFlr * flrH / 2, 0);
          // Standardised punched windows — one per ~13ft, same size all faces (Fix 7)
          var winSpacing = 4.0;
          var windowCols = Math.max(1, Math.floor(faceW / winSpacing));
          var actualSpacing = faceW / windowCols;
          var winW = flrH * 0.5;
          var winH = flrH * 0.55;
          var podSeed = Math.abs(Math.round((px + pz * 7.13) * 1000)) % 9999;
          for(var fl = 0; fl < nFlr; fl++){
            var flBase = fl * flrH;
            for(var wi = 0; wi < windowCols; wi++){
              var winCX = -faceW/2 + actualSpacing/2 + wi * actualSpacing;
              // Window glass — punched window material, Z=0.3 avoids z-fighting
              fGr.add(new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), MAT.punchedWin));
              fGr.children[fGr.children.length-1].position.set(winCX, flBase + flrH * 0.55, 0.3);
              // Interior unit glow — visible at night
              if(_winLit(fl, wi, podSeed)){
                var pGlow = new THREE.Mesh(new THREE.PlaneGeometry(winW - 0.06, winH - 0.06), _winGlowMat(fl, wi, podSeed));
                pGlow.position.set(winCX, flBase + flrH * 0.55, 0.305);
                fGr.add(pGlow);
              }
              // Window sill
              fGr.add(mk(new THREE.BoxGeometry(winW + 0.15, 0.04, 0.06), MAT.concreteSmooth, winCX, flBase + flrH * 0.55 - winH/2 - 0.04, 0.3));
              // Window header
              fGr.add(mk(new THREE.BoxGeometry(winW + 0.1, 0.06, 0.04), MAT.concreteSmooth, winCX, flBase + flrH * 0.55 + winH/2 + 0.03, 0.3));
            }
          }
          fGr.position.set(px, baseY, pz);
          if(rotY2) fGr.rotation.y = rotY2;
          g.add(fGr);
        }
        if(showWin){
          if(!hideN) addBrickPodiumFace(bw, podiumFloors2, upperH, cx0+bw/2, storeyH, cz0-0.02, 0);
          if(!hideS) addBrickPodiumFace(bw, podiumFloors2, upperH, cx0+bw/2, storeyH, cz1+0.02, Math.PI);
          if(!hideW) addBrickPodiumFace(bd, podiumFloors2, upperH, cx0-0.02, storeyH, cz0+bd/2, Math.PI/2);
          if(!hideE) addBrickPodiumFace(bd, podiumFloors2, upperH, cx1+0.02, storeyH, cz0+bd/2, -Math.PI/2);
        }
      }

      // ── TRANSITION CORNICE + GREEN TERRACE (on exposed podium roof) ──
      if(podiumFloors2 > 0 && towerFloors2 > 0 && stepbackM > 0.5){
        var podiumTopY = storeyH + podiumH2;
        var capBeamH = 0.15;
        var capBeamTopY = podiumTopY + capBeamH;
        var terraceY = capBeamTopY + 0.1;
        // Concrete cap beam on podium perimeter
        if(!hideN) g.add(mk(new THREE.BoxGeometry(bw+0.1, capBeamH, 0.12), MAT.concreteDark, cx0+bw/2, podiumTopY+capBeamH/2, cz0-0.02));
        if(!hideS) g.add(mk(new THREE.BoxGeometry(bw+0.1, capBeamH, 0.12), MAT.concreteDark, cx0+bw/2, podiumTopY+capBeamH/2, cz1+0.02));
        if(!hideW) g.add(mk(new THREE.BoxGeometry(0.12, capBeamH, bd+0.1), MAT.concreteDark, cx0-0.02, podiumTopY+capBeamH/2, cz0+bd/2));
        if(!hideE) g.add(mk(new THREE.BoxGeometry(0.12, capBeamH, bd+0.1), MAT.concreteDark, cx1+0.02, podiumTopY+capBeamH/2, cz0+bd/2));
        // Exposed setback strips (NOT under tower footprint)
        var nStripD = tCz0 - cz0 - 0.2;
        var sStripD = cz1 - tCz1 - 0.2;
        var wStripW = tCx0 - cx0 - 0.2;
        var eStripW = cx1 - tCx1 - 0.2;
        // Green terrace — north strip (Fix 3: BoxGeometry with 0.3 height)
        if(nStripD > 0.3){
          g.add(mk(new THREE.BoxGeometry(bw - 0.3, 0.3, nStripD), MAT.greenRoof, cx0+bw/2, terraceY, cz0 + nStripD/2 + 0.1));
          // Planter boxes with shrubs on top — front strip only (Fix 4)
          var planterSpacing = 5.5;
          var nPlanters = Math.max(2, Math.floor(bw / planterSpacing));
          var plActualSpacing = bw / nPlanters;
          var planterH = 1.8;
          var planterW = 5.0;
          var planterD = Math.min(2.2, nStripD * 0.7);
          var planterZ = cz0 + Math.min(0.91, nStripD * 0.5);
          var firstPlanterY = 0, firstShrubY = 0;
          for(var pi3 = 0; pi3 < nPlanters; pi3++){
            var ppx2 = cx0 + plActualSpacing/2 + pi3 * plActualSpacing;
            // Planter box underneath shrub
            g.add(mk(new THREE.BoxGeometry(planterW, planterH, planterD), MAT.planter, ppx2, terraceY + planterH/2, planterZ));
            // Shrub ON TOP of planter
            var shrubR = 1.5 + Math.random() * 2;
            var shrubY = terraceY + planterH + shrubR * 0.7;
            var shrubMesh = mk(new THREE.SphereGeometry(shrubR, 6, 5), pi3 % 2 === 0 ? MAT.shrubA : MAT.shrubB, ppx2, shrubY, planterZ);
            shrubMesh.scale.set(1, 0.65 + Math.random() * 0.3, 1);
            g.add(shrubMesh);
            if(pi3 === 0){ firstPlanterY = terraceY + planterH/2; firstShrubY = shrubY; }
          }
        }
        // Green terrace — south strip (green surface, no planters)
        if(sStripD > 0.3){
          g.add(mk(new THREE.BoxGeometry(bw - 0.3, 0.3, sStripD), MAT.greenRoof, cx0+bw/2, terraceY, cz1 - sStripD/2 - 0.1));
        }
        // Green terrace — west strip
        if(wStripW > 0.3){
          g.add(mk(new THREE.BoxGeometry(wStripW, 0.3, bd - 0.3), MAT.greenRoof, cx0+wStripW/2+0.1, terraceY, cz0+bd/2));
        }
        // Green terrace — east strip
        if(eStripW > 0.3){
          g.add(mk(new THREE.BoxGeometry(eStripW, 0.3, bd - 0.3), MAT.greenRoof, cx1-eStripW/2-0.1, terraceY, cz0+bd/2));
        }
        // Glass railing around exposed terrace perimeter
        if(!hideN) g.add(mk(new THREE.BoxGeometry(bw-0.2, 1.07, 0.02), MAT.glassRailing, cx0+bw/2, terraceY+1.07/2, cz0+0.01));
        if(!hideS) g.add(mk(new THREE.BoxGeometry(bw-0.2, 1.07, 0.02), MAT.glassRailing, cx0+bw/2, terraceY+1.07/2, cz1-0.01));
        if(!hideW) g.add(mk(new THREE.BoxGeometry(0.02, 1.07, bd-0.2), MAT.glassRailing, cx0+0.01, terraceY+1.07/2, cz0+bd/2));
        if(!hideE) g.add(mk(new THREE.BoxGeometry(0.02, 1.07, bd-0.2), MAT.glassRailing, cx1-0.01, terraceY+1.07/2, cz0+bd/2));

        // ── TERRACE AREA LABELS + OUTLINE ──
        // Compute usable terrace area (total exposed podium roof minus tower footprint)
        var terrTotalSF = 0;
        if(nStripD > 0.3) terrTotalSF += m2f(bw - 0.3) * m2f(nStripD);
        if(sStripD > 0.3) terrTotalSF += m2f(bw - 0.3) * m2f(sStripD);
        if(wStripW > 0.3) terrTotalSF += m2f(wStripW) * m2f(bd - 0.3);
        if(eStripW > 0.3) terrTotalSF += m2f(eStripW) * m2f(bd - 0.3);
        terrTotalSF = Math.round(terrTotalSF);
        if(terrTotalSF > 50){
          // Dashed outline around entire terrace perimeter (at terrace Y, slightly above green roof)
          var outlineY = terraceY + 0.35;
          var olMat = new THREE.LineBasicMaterial({color:0xAEBC46, transparent:true, opacity:0.7});
          var olPts = [
            new THREE.Vector3(cx0 + 0.1, outlineY, cz0 + 0.1),
            new THREE.Vector3(cx1 - 0.1, outlineY, cz0 + 0.1),
            new THREE.Vector3(cx1 - 0.1, outlineY, cz1 - 0.1),
            new THREE.Vector3(cx0 + 0.1, outlineY, cz1 - 0.1),
            new THREE.Vector3(cx0 + 0.1, outlineY, cz0 + 0.1)
          ];
          g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(olPts), olMat));
          // Tower footprint outline (inner cutout)
          if(tBw > 0.5 && tBd > 0.5){
            var ilPts = [
              new THREE.Vector3(tCx0 + 0.1, outlineY, tCz0 + 0.1),
              new THREE.Vector3(tCx1 - 0.1, outlineY, tCz0 + 0.1),
              new THREE.Vector3(tCx1 - 0.1, outlineY, tCz1 - 0.1),
              new THREE.Vector3(tCx0 + 0.1, outlineY, tCz1 - 0.1),
              new THREE.Vector3(tCx0 + 0.1, outlineY, tCz0 + 0.1)
            ];
            g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ilPts), olMat));
          }
          // Area label on the largest strip (usually north/front)
          var labelZ2 = cz0 + (nStripD > sStripD ? nStripD / 2 : bd - sStripD / 2);
          addTextSprite(g, 'AMENITY TERRACE', cx0 + bw / 2, outlineY + 0.3, labelZ2, '#AEBC46', 0.35);
          addTextSprite(g, terrTotalSF.toLocaleString() + ' sf', cx0 + bw / 2, outlineY - 0.1, labelZ2, '#ffffff', 0.28);
          // Per-strip dimension labels on smaller strips
          if(wStripW > 0.5){
            var wSF = Math.round(m2f(wStripW) * m2f(bd - 0.3));
            addTextSprite(g, wSF + ' sf', cx0 + wStripW / 2, outlineY + 0.2, cz0 + bd / 2, '#aaaaaa', 0.2);
          }
          if(eStripW > 0.5){
            var eSF = Math.round(m2f(eStripW) * m2f(bd - 0.3));
            addTextSprite(g, eSF + ' sf', cx1 - eStripW / 2, outlineY + 0.2, cz0 + bd / 2, '#aaaaaa', 0.2);
          }
        }
      }

      // ── TOWER (curtain wall) ──
      if(towerFloors2 > 0){
        var towerBaseY2 = storeyH + podiumH2;
        // Semi-transparent tower core (stepped-back dimensions)
        var twrCoreMat2 = new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:showWin ? 0.12 : 0.85, side:THREE.DoubleSide});
        g.add(mk(new THREE.BoxGeometry(tBw-0.04, towerH2, tBd-0.04), twrCoreMat2, tCenterX, towerBaseY2+towerH2/2, tCenterZ));
        // Curtain wall faces (stepped-back, slightly narrower than tower for corner clearance)
        if(showWin){
          if(!hideN) addCurtainWall(g, tCenterX, towerBaseY2, tCz0-0.02, tBw-0.3, towerFloors2, upperH, 0, {bayWidth:3.0, backDepthM:0});
          if(!hideS) addCurtainWall(g, tCenterX, towerBaseY2, tCz1+0.02, tBw-0.3, towerFloors2, upperH, Math.PI, {bayWidth:3.0, backDepthM:0});
          if(!hideW) addCurtainWall(g, tCx0-0.02, towerBaseY2, tCenterZ, tBd-0.3, towerFloors2, upperH, Math.PI/2, {bayWidth:3.0, backDepthM:0});
          if(!hideE) addCurtainWall(g, tCx1+0.02, towerBaseY2, tCenterZ, tBd-0.3, towerFloors2, upperH, -Math.PI/2, {bayWidth:3.0, backDepthM:0});
        }
      }

      // Floor slabs removed — spandrel panels and transoms define floor levels visually

      // Corner reveals — podium corners + tower corners
      if(showWin){
        var pCorners = [{x:cx0,z:cz0},{x:cx1,z:cz0},{x:cx0,z:cz1},{x:cx1,z:cz1}];
        for(var ci3 = 0; ci3 < pCorners.length; ci3++){
          g.add(mk(new THREE.BoxGeometry(0.08, podiumH2+storeyH, 0.08), MAT.steelDark, pCorners[ci3].x, (podiumH2+storeyH)/2, pCorners[ci3].z));
        }
        if(towerFloors2 > 0){
          var tCorners = [{x:tCx0,z:tCz0},{x:tCx1,z:tCz0},{x:tCx0,z:tCz1},{x:tCx1,z:tCz1}];
          for(var ci4 = 0; ci4 < tCorners.length; ci4++){
            g.add(mk(new THREE.BoxGeometry(0.08, towerH2, 0.08), MAT.steelDark, tCorners[ci4].x, towerBaseY2+towerH2/2, tCorners[ci4].z));
          }
        }
      }

      // Interior glow removed — visible as floating rectangles from side views

      // ── BALCONIES (every other floor above GF) ──
      var showBalc = vol.balconies !== undefined ? !!vol.balconies : true;
      var bEvery = vol.balcEvery || 2;
      var bDep = f2m(vol.balcDepth || 4);
      // Balconies — N/S follow master; use tower coords for tower floors, podium for podium
      var bN2 = showBalc && (vol.balcN === undefined || vol.balcN !== -1);
      var bS2 = showBalc && (vol.balcS === undefined || vol.balcS !== -1);
      var bE2 = vol.balcE > 0;
      var bW3 = vol.balcW > 0;
      if(bN2 || bS2 || bE2 || bW3){
        for(var bf2 = 0; bf2 < upFloors; bf2++){
          if(bf2 % bEvery !== 0) continue;
          var bfy2 = storeyH + bf2 * upperH;
          var isTowerFloor = bf2 >= podiumFloors2;
          var bFaceW = isTowerFloor ? tBw : bw;
          var bFaceD = isTowerFloor ? tBd : bd;
          var bFaceNz = isTowerFloor ? tCz0 : cz0;
          var bFaceSz = isTowerFloor ? tCz1 : cz1;
          var bFaceWx = isTowerFloor ? tCx0 : cx0;
          var bFaceEx = isTowerFloor ? tCx1 : cx1;
          var bCX = isTowerFloor ? tCenterX : cx0 + bw/2;
          var nBalcW = Math.max(1, Math.floor(bFaceW / 4));
          var balcWid = bFaceW / nBalcW - 0.3;
          for(var b2 = 0; b2 < nBalcW; b2++){
            var bx2 = bFaceWx + 0.15 + b2 * (bFaceW / nBalcW) + balcWid/2;
            if(bN2 && !hideN) addBalconyUnit(g, bx2, bfy2, bFaceNz-0.02, balcWid, bDep, 0);
            if(bS2 && !hideS) addBalconyUnit(g, bx2, bfy2, bFaceSz+0.02, balcWid, bDep, Math.PI);
          }
          var nBalcD = Math.max(1, Math.floor(bFaceD / 4));
          var balcWid2 = bFaceD / nBalcD - 0.3;
          for(var b3 = 0; b3 < nBalcD; b3++){
            var bz2 = bFaceNz + 0.15 + b3 * (bFaceD / nBalcD) + balcWid2/2;
            if(bE2 && !hideE) addBalconyUnit(g, bFaceEx+0.02, bfy2, bz2, balcWid2, bDep, -Math.PI/2);
            if(bW3 && !hideW) addBalconyUnit(g, bFaceWx-0.02, bfy2, bz2, balcWid2, bDep, Math.PI/2);
          }
        }
      }
    }

    // ── ROOF (on tower footprint if stepped back) ──
    var roofW = towerFloors2 > 0 ? tBw : bw;
    var roofD = towerFloors2 > 0 ? tBd : bd;
    var roofMembraneMat = new THREE.MeshStandardMaterial({color:0x2a2828, roughness:0.95, metalness:0.01});
    var roofR = new THREE.Mesh(new THREE.PlaneGeometry(roofW, roofD), roofMembraneMat);
    roofR.rotation.x = -Math.PI/2; roofR.position.set(tCenterX, totalH+0.02, tCenterZ);
    roofR.receiveShadow = true; g.add(roofR);

    // Parapet (on tower footprint)
    var rpH2 = 0.6, rpT2 = 0.1;
    var rNz = towerFloors2 > 0 ? tCz0 : cz0;
    var rSz = towerFloors2 > 0 ? tCz1 : cz1;
    var rWx = towerFloors2 > 0 ? tCx0 : cx0;
    var rEx = towerFloors2 > 0 ? tCx1 : cx1;
    if(!hideN){ g.add(mk(new THREE.BoxGeometry(roofW+0.08, rpH2, rpT2), MAT.concreteDark, tCenterX, totalH+rpH2/2, rNz)); g.add(mk(new THREE.BoxGeometry(roofW+0.12, 0.04, rpT2+0.04), MAT.steelDark, tCenterX, totalH+rpH2+0.02, rNz)); }
    if(!hideS){ g.add(mk(new THREE.BoxGeometry(roofW+0.08, rpH2, rpT2), MAT.concreteDark, tCenterX, totalH+rpH2/2, rSz)); g.add(mk(new THREE.BoxGeometry(roofW+0.12, 0.04, rpT2+0.04), MAT.steelDark, tCenterX, totalH+rpH2+0.02, rSz)); }
    if(!hideW){ g.add(mk(new THREE.BoxGeometry(rpT2, rpH2, roofD+0.08), MAT.concreteDark, rWx, totalH+rpH2/2, tCenterZ)); g.add(mk(new THREE.BoxGeometry(rpT2+0.04, 0.04, roofD+0.12), MAT.steelDark, rWx, totalH+rpH2+0.02, tCenterZ)); }
    if(!hideE){ g.add(mk(new THREE.BoxGeometry(rpT2, rpH2, roofD+0.08), MAT.concreteDark, rEx, totalH+rpH2/2, tCenterZ)); g.add(mk(new THREE.BoxGeometry(rpT2+0.04, 0.04, roofD+0.12), MAT.steelDark, rEx, totalH+rpH2+0.02, tCenterZ)); }

    // ── MECHANICAL PENTHOUSE ──
    if(vol.storeys > 4 && vi === tallestVi){
      var mechW = Math.min(roofW*0.35, 8), mechD = Math.min(roofD*0.3, 6), mechH = 1.8;
      if(mechW > 1.5 && mechD > 1.5){
        var rcx = tCenterX, rcz = tCenterZ;
        var mechY = totalH + rpH2;
        g.add(mk(new THREE.BoxGeometry(mechW, mechH, mechD), MAT.concreteDark, rcx, mechY+mechH/2+0.05, rcz));
        g.add(mk(new THREE.BoxGeometry(mechW+0.1, 0.06, mechD+0.1), MAT.steelDark, rcx, mechY+mechH+0.08, rcz));
        // Louvers
        var louverCt = Math.floor(mechH / 0.3);
        for(var li = 0; li < louverCt; li++){
          var ly = mechY + 0.2 + li * 0.3;
          g.add(mk(new THREE.BoxGeometry(mechW*0.85, 0.04, 0.05), MAT.steelDark, rcx, ly, rcz-mechD/2-0.03));
          g.add(mk(new THREE.BoxGeometry(mechW*0.85, 0.04, 0.05), MAT.steelDark, rcx, ly, rcz+mechD/2+0.03));
        }
      }
    }

    // ── ROTATION: wrap volume meshes ──
    var volGrp = new THREE.Group();
    var centerX = cx0 + bw / 2, centerZ = cz0 + bd / 2;
    var newChildren = [];
    while(g.children.length > childrenBefore){
      newChildren.unshift(g.children.pop());
    }
    for(var nci = 0; nci < newChildren.length; nci++){
      newChildren[nci].position.x -= centerX;
      newChildren[nci].position.z -= centerZ;
      volGrp.add(newChildren[nci]);
    }
    volGrp.position.set(centerX, 0, centerZ);
    volGrp.rotation.y = (vol.angle || 0) * Math.PI / 180;
    volGrp._volIdx = vi;
    g.add(volGrp);
  });

}

function addTextSprite(group, text, x, y, z, color, scale){
  const canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=64;
  const ctx=canvas.getContext('2d');
  ctx.font='bold 32px Outfit';
  ctx.fillStyle=color||'#ffffff';
  ctx.textAlign='center';
  ctx.fillText(text,128,42);
  const tex=new THREE.CanvasTexture(canvas);
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true});
  const sp=new THREE.Sprite(mat);
  sp.position.set(x,y,z);
  sp.scale.set((scale||0.5)*5,(scale||0.5)*1.25,1);
  group.add(sp);
}

function rebuildLabels(){
  clearGroup('labels');
  const g=groups.labels;
  const vts=lotVerts();
  const maxZ=lotBounds().maxZ;
  const cx=f2m(vts.reduce((s,v)=>s+v[0],0)/vts.length);

  // Street names
  addTextSprite(g,'NORTH AVE W',cx,2,f2m(-8),'#ffffff',0.6);
  addTextSprite(g,'SOUTH AVE',cx,2,f2m(maxZ+8),'#ffffff',0.6);
}

// ═══════════════════════════════════════════════════════════
//  ANGULAR PLANE CONSTRAINT ENGINES
//  Toronto Mid-Rise Design Guidelines — 45° angular planes
// ═══════════════════════════════════════════════════════════
// ═══ LIGHTING PRESETS ═══
var _currentLightPreset = 'golden';
/**
 * Applies a named lighting preset (e.g. 'golden', 'day', 'night') to the scene.
 * @param {string} mode - The lighting preset identifier.
 */
function setLightingPreset(mode){
  _currentLightPreset = mode;
  var lights = [];
  scene.traverse(function(obj){ if(obj.isLight) lights.push(obj); });
  // Find lights by type
  var amb = lights.find(function(l){ return l.type === 'AmbientLight'; });
  var hemi = lights.find(function(l){ return l.type === 'HemisphereLight'; });
  var dirs = lights.filter(function(l){ return l.type === 'DirectionalLight'; });
  var sun = dirs[0], fill = dirs[1], rim = dirs[2];

  // Helper to set per-unit window glow intensity (warm/cool/amber materials)
  function _setUnitGlow(opacity, emissive){
    if(MAT.unitGlowWarm){ MAT.unitGlowWarm.opacity = opacity; MAT.unitGlowWarm.emissiveIntensity = emissive; }
    if(MAT.unitGlowCool){ MAT.unitGlowCool.opacity = opacity * 0.85; MAT.unitGlowCool.emissiveIntensity = emissive * 0.9; }
    if(MAT.unitGlowAmber){ MAT.unitGlowAmber.opacity = opacity * 0.95; MAT.unitGlowAmber.emissiveIntensity = emissive * 1.1; }
  }
  // Helper to control interior back-wall glow (the cream surface visible inside each unit)
  function _setUnitInterior(emissive){
    if(MAT.unitInterior) MAT.unitInterior.emissiveIntensity = emissive;
  }
  if(mode === 'golden'){
    scene.background = new THREE.Color(0x12151e);
    if(scene.fog) scene.fog.color.set(0x12151e);
    if(amb){ amb.color.set(0x334455); amb.intensity = 0.28; }
    if(hemi){ hemi.color.set(0x7799bb); hemi.groundColor.set(0x342a20); hemi.intensity = 0.38; }
    if(sun){ sun.color.set(0xffd0a0); sun.intensity = 1.6; sun.position.set(-200,170,-110); sun.castShadow = true; }
    if(fill){ fill.color.set(0xffeedd); fill.intensity = 0.22; fill.position.set(150,70,190); }
    if(rim){ rim.color.set(0x7788bb); rim.intensity = 0.42; rim.position.set(70,190,-190); }
    if(renderer) renderer.toneMappingExposure = 0.95;
    // Subtle interior glow for golden hour — some units lit at dusk
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.18;
    });
    _setUnitGlow(0.45, 1.2);
    _setUnitInterior(0.15);
    // Restore standard glass at golden hour
    if(MAT.glass){ MAT.glass.opacity = 0.5; MAT.glass.metalness = 0.3; }
  } else if(mode === 'night'){
    scene.background = new THREE.Color(0x080a10);
    if(scene.fog) scene.fog.color.set(0x080a10);
    if(amb){ amb.color.set(0x1a1a2a); amb.intensity = 0.15; }
    if(hemi){ hemi.color.set(0x2a3040); hemi.groundColor.set(0x0a0a0a); hemi.intensity = 0.12; }
    if(sun){ sun.intensity = 0; sun.castShadow = false; }
    if(fill){ fill.intensity = 0.05; }
    if(rim){ rim.color.set(0x4455aa); rim.intensity = 0.15; }
    if(renderer) renderer.toneMappingExposure = 0.7;
    // Brighten interior glow for night — building lit up like an occupied tower
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.45;
    });
    // High emissive intensity needed because the curtain wall glass is tinted (0x8ab8d0),
    // metallic (0.3), and clearcoated — it dims any light coming from behind.
    _setUnitGlow(1.0, 2.8);
    // Back walls do NOT auto-glow at night — only lit units (~65% via glow planes) should appear lit.
    // Setting interior emissive to 0 at night keeps unlit units visibly dark for proper contrast.
    _setUnitInterior(0.0);
    // At night, make tower glass more transparent + less metallic so interior glow reads clearly
    if(MAT.glass){ MAT.glass.opacity = 0.25; MAT.glass.metalness = 0.05; }
  } else if(mode === 'day'){
    scene.background = new THREE.Color(0xc8d8e8);
    if(scene.fog) scene.fog.color.set(0xc8d8e8);
    if(amb){ amb.color.set(0x8899aa); amb.intensity = 0.5; }
    if(hemi){ hemi.color.set(0xaabbcc); hemi.groundColor.set(0x666660); hemi.intensity = 0.5; }
    if(sun){ sun.color.set(0xffffff); sun.intensity = 1.5; sun.position.set(-100,250,50); sun.castShadow = true; }
    if(fill){ fill.color.set(0xeeeeff); fill.intensity = 0.35; fill.position.set(150,70,190); }
    if(rim){ rim.color.set(0x99aacc); rim.intensity = 0.25; rim.position.set(70,190,-190); }
    if(renderer) renderer.toneMappingExposure = 1.2;
    // Hide interior glow during daytime — daylight overpowers any visible interior light
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.06;
    });
    _setUnitGlow(0.0, 0.0);
    _setUnitInterior(0.0);
    // Restore standard glass for daytime
    if(MAT.glass){ MAT.glass.opacity = 0.5; MAT.glass.metalness = 0.3; }
  }
  // Update sky dome if present
  scene.traverse(function(obj){
    if(obj.isMesh && obj.material && obj.material.type === 'ShaderMaterial' && obj.material.uniforms && obj.material.uniforms.topColor){
      if(mode === 'golden'){ obj.material.uniforms.topColor.value.set(0x1a2233); obj.material.uniforms.bottomColor.value.set(0x12151e); }
      else if(mode === 'night'){ obj.material.uniforms.topColor.value.set(0x050810); obj.material.uniforms.bottomColor.value.set(0x080a10); }
      else if(mode === 'day'){ obj.material.uniforms.topColor.value.set(0x6688bb); obj.material.uniforms.bottomColor.value.set(0xc8d8e8); }
    }
  });
  // Update buttons
  var btns = document.querySelectorAll('.lighting-btn');
  btns.forEach(function(b){ b.style.background = 'rgba(26,26,26,.85)'; b.style.color = '#888'; });
  var activeBtn = document.getElementById('btn-light-' + mode);
  if(activeBtn){ activeBtn.style.background = 'rgba(174,188,70,0.3)'; activeBtn.style.color = '#AEBC46'; }
}

if(typeof P._showInteriors==='undefined') P._showInteriors=false;
/**
 * Toggles interior visibility on/off and rebuilds the building to reflect the change.
 */
function toggleInteriors(){
  P._showInteriors=!P._showInteriors;
  var btn=document.getElementById('btnInteriors');
  if(btn){btn.style.background=P._showInteriors?'#e8a87a':'rgba(26,26,26,.85)';btn.style.color=P._showInteriors?'#111':'#e8a87a';}
  rebuildBuilding();
}

let _angularPlanesVisible=false;
let _angularPlaneGroup=null;

// Cache last computation for zoning dashboard
let _angularPlaneResults={front:null,rear:null};

/**
 * Compute which storeys of each volume penetrate a 45° angular plane.
 *
 * FRONT ANGULAR PLANE:
 *   Origin = opposite side of the primary street ROW, at grade (y=0).
 *   The plane rises at 45° toward the building from Z = -(ROW_width) in metres.
 *   At horizontal distance d from the origin, max height = d.
 *   For a building face at Z position z_face (in metres, measured from front lot line),
 *   distance from plane origin = ROW_width + z_face (front setback moves building further).
 *   Allowed height at face = ROW_width_m + z_face_m  (since tan(45°)=1).
 *
 * REAR TRANSITION PLANE:
 *   Origin = rear lot line at 10.5m height.
 *   Plane rises at 45° inward (toward front of lot).
 *   At horizontal distance d inward from rear lot line, max height = 10.5 + d.
 *   For a building rear face at Z position z_face from front,
 *   distance from rear = rearZ - z_face (in metres).
 *   Allowed height at face = 10.5 + (rearZ_m - z_rear_face_m).
 */
function computeAngularPlanes(){
  const lb=lotBounds();
  const rearZft=lb.maxZ;
  const rearZm=f2m(rearZft);

  // Find primary street (north-side road with largest width, or first road)
  let primaryRoad=null;
  P.roads.forEach(rd=>{
    if(rd.side==='north'||rd.side==='front'){
      if(!primaryRoad||rd.width>primaryRoad.width) primaryRoad=rd;
    }
  });
  if(!primaryRoad&&P.roads.length>0) primaryRoad=P.roads[0];
  const rowWidthFt=primaryRoad?primaryRoad.width:66;
  const rowWidthM=f2m(rowWidthFt);

  const frontResult={rowWidthM:rowWidthM,violations:[],maxAllowedAtFront:rowWidthM};
  const rearResult={originHeight:10.5,violations:[],maxAllowedAtRear:10.5};

  P.vols.forEach((vol,vi)=>{
    const storeyH_gf=f2m(vol.gfHeight||P.flr.gf);
    const storeyH_typ=f2m(P.flr.typ);
    const cx0=f2m(vol.startEg||0);
    const cz0=f2m(vol.offEast||0);
    const bw=f2m(vol.width||0);
    const bd=f2m(vol.depth||0);
    const angleRad=(vol.angle||0)*Math.PI/180;

    // For custom polygon volumes, use bounding box
    let volFrontZ,volRearZ;
    if(vol.customPoly&&vol.customPoly.length>=3){
      const zs=vol.customPoly.map(p=>f2m(p[1]));
      volFrontZ=Math.min(...zs);
      volRearZ=Math.max(...zs);
    } else {
      // For rectangular volumes, account for rotation
      if(Math.abs(angleRad)<0.01){
        volFrontZ=cz0;
        volRearZ=cz0+bd;
      } else {
        const corners=[[0,0],[bw,0],[bw,bd],[0,bd]];
        const cos=Math.cos(angleRad),sin=Math.sin(angleRad);
        const pivotX=bw/2,pivotZ=bd/2;
        const rotated=corners.map(c=>{
          const dx=c[0]-pivotX,dz=c[1]-pivotZ;
          return cz0+pivotZ+(dx*sin+dz*cos);
        });
        volFrontZ=Math.min(...rotated);
        volRearZ=Math.max(...rotated);
      }
    }

    // Check each storey
    const volViolationsFront=[];
    const volViolationsRear=[];
    let floorBase=0;
    for(let s=0;s<vol.storeys;s++){
      const floorH=(s===0)?storeyH_gf:storeyH_typ;
      const floorTop=floorBase+floorH;

      // FRONT: distance from opposite curb to building front face
      // Opposite curb is at Z = -rowWidthM (in metres, north of lot line)
      // Building front face is at volFrontZ (positive Z = south from lot origin)
      // Distance = rowWidthM + volFrontZ
      const distFront=rowWidthM+volFrontZ;
      const maxHeightFront=distFront; // tan(45°)=1

      if(floorTop>maxHeightFront+0.01){
        volViolationsFront.push({
          storey:s+1,
          floorTop:floorTop,
          maxAllowed:maxHeightFront,
          overshoot:floorTop-maxHeightFront
        });
      }

      // REAR: distance from rear lot line to building rear face
      // Rear lot line is at rearZm
      // Building rear face is at volRearZ
      const distRear=rearZm-volRearZ;
      const maxHeightRear=10.5+Math.max(0,distRear); // starts at 10.5m

      if(floorTop>maxHeightRear+0.01){
        volViolationsRear.push({
          storey:s+1,
          floorTop:floorTop,
          maxAllowed:maxHeightRear,
          overshoot:floorTop-maxHeightRear
        });
      }

      floorBase=floorTop;
    }

    if(volViolationsFront.length>0){
      frontResult.violations.push({volIndex:vi,label:vol.label||('Volume '+(vi+1)),storeys:volViolationsFront});
    }
    if(volViolationsRear.length>0){
      rearResult.violations.push({volIndex:vi,label:vol.label||('Volume '+(vi+1)),storeys:volViolationsRear});
    }
  });

  _angularPlaneResults={front:frontResult,rear:rearResult};
  return _angularPlaneResults;
}

/**
 * Render semi-transparent 45° angular plane surfaces in the 3D scene
 */
function renderAngularPlanes(){
  // Remove old group
  if(_angularPlaneGroup){
    disposeObject(_angularPlaneGroup);
    scene.remove(_angularPlaneGroup);
    _angularPlaneGroup=null;
  }
  if(!_angularPlanesVisible) return;

  _angularPlaneGroup=new THREE.Group();

  const lb=lotBounds();
  const lotW=f2m(lb.width);
  const lotD=f2m(lb.depth);
  const rearZm=f2m(lb.maxZ);
  const lotMinXm=f2m(lb.minX);
  const lotMaxXm=f2m(lb.maxX);

  // Find primary road ROW width
  let primaryRoad=null;
  P.roads.forEach(rd=>{
    if(rd.side==='north'||rd.side==='front'){
      if(!primaryRoad||rd.width>primaryRoad.width) primaryRoad=rd;
    }
  });
  if(!primaryRoad&&P.roads.length>0) primaryRoad=P.roads[0];
  const rowWidthM=f2m(primaryRoad?primaryRoad.width:66);

  // Extend planes a bit beyond lot boundaries for visibility
  const pad=2;
  const x0=lotMinXm-pad;
  const x1=lotMaxXm+pad;

  // ── FRONT ANGULAR PLANE (45° from opposite curb) ──
  // Plane origin: Z = -rowWidthM (opposite side of ROW), Y = 0
  // At any Z position, max height = rowWidthM + Z (since Z=0 is front lot line)
  // Plane rises at 45° going south, so at Z=0, height = rowWidthM
  // We render from Z = -rowWidthM (height=0) to Z = lotD+pad (height = rowWidthM + lotD+pad)
  const frontMaxH=rowWidthM+rearZm+pad;
  const frontGeo=new THREE.BufferGeometry();
  const frontVerts=new Float32Array([
    x0, 0, -rowWidthM,                    // bottom-left (at curb, height 0)
    x1, 0, -rowWidthM,                    // bottom-right
    x1, Math.min(frontMaxH,80), rearZm+pad, // top-right
    x0, 0, -rowWidthM,                    // bottom-left (repeat for 2nd triangle)
    x1, Math.min(frontMaxH,80), rearZm+pad,
    x0, Math.min(frontMaxH,80), rearZm+pad  // top-left
  ]);
  frontGeo.setAttribute('position',new THREE.BufferAttribute(frontVerts,3));
  frontGeo.computeVertexNormals();
  const frontMat=new THREE.MeshBasicMaterial({
    color:0x4ecdc4, transparent:true, opacity:0.15,
    side:THREE.DoubleSide, depthWrite:false
  });
  const frontMesh=new THREE.Mesh(frontGeo,frontMat);
  _angularPlaneGroup.add(frontMesh);

  // Front plane edge line
  const frontEdgeGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,0,-rowWidthM),
    new THREE.Vector3(x0,Math.min(frontMaxH,80),rearZm+pad),
    new THREE.Vector3(x1,Math.min(frontMaxH,80),rearZm+pad),
    new THREE.Vector3(x1,0,-rowWidthM),
    new THREE.Vector3(x0,0,-rowWidthM)
  ]);
  const frontEdge=new THREE.Line(frontEdgeGeo,new THREE.LineBasicMaterial({color:0x4ecdc4,transparent:true,opacity:0.5}));
  _angularPlaneGroup.add(frontEdge);

  // Label for front plane
  addTextSprite(_angularPlaneGroup,'45° FRONT ANGULAR PLANE',(x0+x1)/2,rowWidthM+2,-rowWidthM/2,'#4ecdc4',0.5);

  // ── REAR TRANSITION PLANE (45° from rear lot line at 10.5m) ──
  // Origin: Z = rearZm, Y = 10.5m
  // Going inward (decreasing Z), max height = 10.5 + (rearZm - Z)
  // At Z = rearZm: height = 10.5m
  // Plane rises at 45° going north
  const rearMaxH=10.5+rearZm+pad;
  const rearGeo=new THREE.BufferGeometry();
  const rearVerts=new Float32Array([
    x0, 10.5, rearZm,                           // bottom-left (at rear lot line, 10.5m)
    x1, 10.5, rearZm,                           // bottom-right
    x1, Math.min(rearMaxH,80), -pad,            // top-right (at front)
    x0, 10.5, rearZm,                           // bottom-left
    x1, Math.min(rearMaxH,80), -pad,
    x0, Math.min(rearMaxH,80), -pad             // top-left
  ]);
  rearGeo.setAttribute('position',new THREE.BufferAttribute(rearVerts,3));
  rearGeo.computeVertexNormals();
  const rearMat=new THREE.MeshBasicMaterial({
    color:0xe88d7a, transparent:true, opacity:0.15,
    side:THREE.DoubleSide, depthWrite:false
  });
  const rearMesh=new THREE.Mesh(rearGeo,rearMat);
  _angularPlaneGroup.add(rearMesh);

  // Rear plane edge line
  const rearEdgeGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,10.5,rearZm),
    new THREE.Vector3(x0,Math.min(rearMaxH,80),-pad),
    new THREE.Vector3(x1,Math.min(rearMaxH,80),-pad),
    new THREE.Vector3(x1,10.5,rearZm),
    new THREE.Vector3(x0,10.5,rearZm)
  ]);
  const rearEdge=new THREE.Line(rearEdgeGeo,new THREE.LineBasicMaterial({color:0xe88d7a,transparent:true,opacity:0.5}));
  _angularPlaneGroup.add(rearEdge);

  // Label for rear plane
  addTextSprite(_angularPlaneGroup,'45° REAR TRANSITION (10.5m)',(x0+x1)/2,12,rearZm+2,'#e88d7a',0.5);

  // 10.5m reference line at rear
  const refLineGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,10.5,rearZm),
    new THREE.Vector3(x1,10.5,rearZm)
  ]);
  const refLine=new THREE.Line(refLineGeo,new THREE.LineBasicMaterial({color:0xe88d7a,transparent:true,opacity:0.8,linewidth:2}));
  _angularPlaneGroup.add(refLine);

  scene.add(_angularPlaneGroup);
}

/**
 * Toggles the angular-plane overlay visibility and recomputes compliance.
 */
function toggleAngularPlanes(){
  _angularPlanesVisible=!_angularPlanesVisible;
  const btn=document.getElementById('btn-angular-toggle');
  if(btn){
    btn.style.background=_angularPlanesVisible?'rgba(196,154,222,0.3)':'rgba(26,26,26,.85)';
    btn.style.borderColor=_angularPlanesVisible?'#c49ade':'#c49ade';
  }
  computeAngularPlanes();
  renderAngularPlanes();
  // Re-render zoning dashboard to update compliance rows
  try{renderZoningDashboard();}catch(e){}
}

// ═══════════════════════════════════════════════════════════
//  UI BUILDERS
// ═══════════════════════════════════════════════════════════

function makeRow(parent, label, obj, key, min, max, step, unit){
  const row=document.createElement('div');
  row.className='row';

  const lbl=document.createElement('label');
  lbl.textContent=label;

  const slider=document.createElement('input');
  slider.type='range';slider.min=min;slider.max=max;slider.step=step||1;
  slider.value=obj[key];

  const valWrap=document.createElement('span');
  valWrap.className='val';
  const valInput=document.createElement('input');
  valInput.type='number';valInput.min=min;valInput.max=max;valInput.step=step||1;
  valInput.value=obj[key];

  const unitSpan=document.createElement('span');
  unitSpan.className='unit';
  unitSpan.textContent=unit||'ft';

  slider.oninput=()=>{
    var _v = parseFloat(slider.value);
    if(!isFinite(_v)) _v = min;  // NaN guard
    _v = Math.max(min, Math.min(max, _v)); // clamp to valid range
    obj[key]=_v;
    valInput.value=slider.value;
    rebuildAll();
  };
  valInput.onchange=()=>{
    let v=parseFloat(valInput.value);
    if(isNaN(v))v=min;
    v=Math.max(min,Math.min(max,v));
    obj[key]=v;
    slider.value=v;
    valInput.value=v;
    rebuildAll();
  };

  valWrap.appendChild(valInput);
  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(valWrap);
  row.appendChild(unitSpan);
  parent.appendChild(row);
}

function buildLotPanel(){
  const bd=document.getElementById('sec-lot-bd');
  bd.innerHTML='';

  // Lot dimensions come ONLY from the site map polygon
  if(P.lot.polyVerts && P.lot.polyVerts.length>=3){
    const vts=P.lot.polyVerts;
    const area=lotArea();

    // Source badge
    const badge=document.createElement('div');
    badge.style.cssText='background:#AEBC46;color:#111;padding:4px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:8px;text-align:center';
    badge.textContent='FROM SITE MAP — '+vts.length+' VERTICES';
    bd.appendChild(badge);

    // Area summary
    const areaDiv=document.createElement('div');
    areaDiv.style.cssText='text-align:center;margin-bottom:8px;padding:6px;background:#1A1A1A;border-radius:4px';
    const areaM=Math.round(area*0.0929);
    areaDiv.innerHTML=`<div style="font-size:18px;font-weight:700;color:#AEBC46">${Math.round(area).toLocaleString()} sq ft</div>
      <div style="font-size:10px;color:#777">${areaM.toLocaleString()} sq m / ${(area/43560).toFixed(2)} acres</div>`;
    bd.appendChild(areaDiv);

    // Edge dimensions (read-only, sourced from site map)
    for(let i=0;i<vts.length;i++){
      const j=(i+1)%vts.length;
      const dx=vts[j][0]-vts[i][0], dz=vts[j][1]-vts[i][1];
      const len=Math.round(Math.sqrt(dx*dx+dz*dz));
      const lenM=(len*0.3048).toFixed(1);
      const bearing=Math.atan2(dx,dz)*180/Math.PI;
      const dirs=['N','NE','E','SE','S','SW','W','NW'];
      const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];

      const row=document.createElement('div');
      row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#1A1A1A;border-radius:4px;border-left:3px solid #AEBC46;margin-bottom:4px';
      row.innerHTML=`<div><span style="font-size:10px;color:#777">Edge ${String.fromCharCode(65+i)}</span><br><span style="font-size:9px;color:#445">${compass}</span></div>
        <div style="text-align:right"><span style="font-size:14px;font-weight:600;color:#AEBC46">${len}'</span><br><span style="font-size:9px;color:#777">${lenM}m</span></div>`;
      bd.appendChild(row);
    }

    // Link back to site map to edit
    const editBtn=document.createElement('button');
    editBtn.className='btn-add';
    editBtn.style.cssText='background:#444444;color:#AEBC46;margin-top:8px;width:100%';
    editBtn.textContent='Edit Lot in Site Map';
    editBtn.onclick=()=>{switchTab('sitemap');};
    bd.appendChild(editBtn);

  } else {
    // No polygon yet — prompt user to go to site map
    const msg=document.createElement('div');
    msg.style.cssText='text-align:center;padding:20px 12px;color:#777';
    msg.innerHTML=`<div style="font-size:32px;margin-bottom:8px">📍</div>
      <div style="font-size:13px;font-weight:600;color:#aaa;margin-bottom:6px">No lot defined yet</div>
      <div style="font-size:11px;color:#777;margin-bottom:12px">Draw your lot polygon on the Site Map tab first. The lot dimensions will automatically appear here.</div>`;
    bd.appendChild(msg);

    const goBtn=document.createElement('button');
    goBtn.className='btn-add';
    goBtn.style.cssText='background:#AEBC46;color:#111;font-weight:700;width:100%;padding:10px';
    goBtn.textContent='Go to Site Map';
    goBtn.onclick=()=>{switchTab('sitemap');};
    bd.appendChild(goBtn);
  }
}

function buildSetbackPanel(){
  const bd=document.getElementById('sec-set-bd');
  bd.innerHTML='';
  makeRow(bd,'Front (North)',P.set,'front',0,30,1);
  makeRow(bd,'Stepback @13.5m',P.set,'stepback',0,20,1);
  makeRow(bd,'Side (East)',P.set,'sideE',0,30,1);
  makeRow(bd,'Side (West)',P.set,'sideW',0,30,1);
  makeRow(bd,'Rear (South)',P.set,'rear',0,50,1);
}

if(typeof P._showRoads==='undefined') P._showRoads=false;

function buildRoadsPanel(){
  if(!Array.isArray(P.roads)) P.roads=[];
  const bd=document.getElementById('sec-roads-bd');
  bd.innerHTML='';

  // Toggle roads visibility
  const togRow=document.createElement('div');
  togRow.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;background:#1A1A1A;border-radius:6px';
  const togCb=document.createElement('input');togCb.type='checkbox';
  togCb.checked=P._showRoads;
  togCb.style.cssText='accent-color:#AEBC46;width:16px;height:16px;cursor:pointer';
  togCb.onchange=()=>{P._showRoads=togCb.checked;rebuildAll();};
  const togLbl=document.createElement('span');
  togLbl.style.cssText='font-size:12px;font-weight:600;color:#AEBC46';
  togLbl.textContent=P._showRoads?'Roads Visible':'Roads Hidden';
  togRow.appendChild(togCb);togRow.appendChild(togLbl);
  bd.appendChild(togRow);

  P.roads.forEach((rd,i)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #444444;border-radius:6px;margin-bottom:8px;overflow:hidden';

    const hd=document.createElement('div');
    hd.style.cssText='padding:5px 8px;background:#2D2D2D;display:flex;justify-content:space-between;align-items:center';
    const nm=document.createElement('span');nm.style.cssText='font-size:10px;font-weight:600;color:#AEBC46';
    nm.textContent='Road '+(i+1)+' — '+rd.label;
    const del=document.createElement('button');del.className='btn-del';del.textContent='X';
    del.onclick=()=>{ if(!confirm('Delete this road?')) return; P.roads.splice(i,1);buildRoadsPanel();rebuildAll()};
    hd.appendChild(nm);hd.appendChild(del);card.appendChild(hd);

    const body=document.createElement('div');body.style.cssText='padding:6px 8px';

    // Label
    const lr=document.createElement('div');lr.className='row';
    lr.innerHTML='<label style="flex:0 0 110px;font-size:11px;color:#aaa">Label</label>';
    const li=document.createElement('input');li.type='text';li.value=rd.label;
    li.style.cssText='flex:1;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;padding:4px 6px;border-radius:3px;font-size:11px;font-family:inherit';
    li.onchange=()=>{rd.label=li.value;buildRoadsPanel();rebuildAll()};
    lr.appendChild(li);body.appendChild(lr);

    // Side dropdown
    const sr=document.createElement('div');sr.className='row';
    sr.innerHTML='<label style="flex:0 0 110px;font-size:11px;color:#aaa">Side</label>';
    const sel=document.createElement('select');
    sel.style.cssText='flex:1;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;padding:4px;border-radius:3px;font-size:11px;font-family:inherit';
    ['north','south','east','west'].forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s.charAt(0).toUpperCase()+s.slice(1);if(rd.side===s)o.selected=true;sel.appendChild(o)});
    sel.onchange=()=>{rd.side=sel.value;rebuildAll()};
    sr.appendChild(sel);body.appendChild(sr);

    makeRow(body,'Offset',rd,'offZ',-80,80,1);
    makeRow(body,'Angle (°)',rd,'angle',-45,45,1,'°');
    makeRow(body,'Width',rd,'width',15,120,1);
    makeRow(body,'Label Size',rd,'fontSize',6,30,1,'px');

    card.appendChild(body);bd.appendChild(card);
  });

  const addBtn=document.createElement('button');addBtn.className='btn-add';addBtn.textContent='+ Add Road';
  addBtn.onclick=()=>{
    P.roads.push({label:'NEW ROAD',offZ:0,angle:0,width:40,fontSize:14,side:'east'});
    buildRoadsPanel();rebuildAll();
  };
  bd.appendChild(addBtn);
}

function buildLandscapePanel(){
  if(!Array.isArray(P.landscape)) P.landscape=[];
  const bd=document.getElementById('sec-landscape-bd');
  bd.innerHTML='';

  // Quick-add buttons
  const btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px';
  [{label:'🌳 Tree',type:'tree'},{label:'🌿 Bush',type:'bush'},{label:'🌳🌳 Tree Row',type:'tree-row'},{label:'🌿🌿 Bush Row',type:'bush-row'}].forEach(opt=>{
    const b=document.createElement('button');b.className='btn-add';
    b.style.cssText='flex:1;min-width:80px;padding:5px 8px;font-size:10px';
    b.textContent=opt.label;
    b.onclick=()=>{
      // Place at lot center with slight random offset
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]),allZ=vts.map(v=>v[1]);
      const cx=(Math.min(...allX)+Math.max(...allX))/2;
      const cz=(Math.min(...allZ)+Math.max(...allZ))/2;
      const item={type:opt.type,x:Math.round(cx+Math.random()*20-10),z:Math.round(cz+Math.random()*20-10)};
      if(opt.type.includes('row')){item.count=6;item.spacing=8;item.angle=90;}
      P.landscape.push(item);
      buildLandscapePanel();rebuildAll();
    };
    btnRow.appendChild(b);
  });
  bd.appendChild(btnRow);

  // List existing items
  P.landscape.forEach((item,i)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #444444;border-radius:4px;margin-bottom:6px;padding:6px 8px;background:#1A1A1A';

    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    const icon=item.type==='tree'?'🌳':item.type==='bush'?'🌿':item.type==='tree-row'?'🌳🌳':'🌿🌿';
    const lbl=document.createElement('span');lbl.style.cssText='font-size:11px;font-weight:600;color:#AEBC46';
    lbl.textContent=icon+' '+item.type.replace('-',' ').toUpperCase();
    const del=document.createElement('button');del.className='btn-del';del.textContent='X';del.style.cssText='padding:1px 6px;font-size:10px';
    del.onclick=()=>{ if(!confirm('Delete this landscape feature?')) return; P.landscape.splice(i,1);buildLandscapePanel();rebuildAll()};
    hdr.appendChild(lbl);hdr.appendChild(del);card.appendChild(hdr);

    makeRow(card,'X Position',item,'x',-100,300,1);
    makeRow(card,'Z Position',item,'z',-100,300,1);
    if(item.type.includes('row')){
      makeRow(card,'Count',item,'count',2,20,1);
      makeRow(card,'Spacing',item,'spacing',3,20,1);
      makeRow(card,'Angle (°)',item,'angle',0,360,5,'°');
    }
    bd.appendChild(card);
  });

  if(P.landscape.length===0){
    const empty=document.createElement('div');
    empty.style.cssText='font-size:10px;color:#777;text-align:center;padding:8px';
    empty.textContent='No landscape items. Click a button above to add.';
    bd.appendChild(empty);
  }
}

function buildFloorPanel(){
  const bd=document.getElementById('sec-flr-bd');
  bd.innerHTML='';
  makeRow(bd,'Ground (Comm.)',P.flr,'gf',12,25,0.5);
  makeRow(bd,'Typical Res.',P.flr,'typ',8,15,0.5);
}

function buildVolPanel(){
  const list=document.getElementById('vol-list');
  list.innerHTML='';
  P.vols.forEach((vol,i)=>{
    const card=document.createElement('div');
    card.className='vol-card';
    card.style.borderColor=vol.color;

    const hd=document.createElement('div');
    hd.className='vol-hd';
    hd.style.background=vol.color+'33';

    const nameSpan=document.createElement('span');
    nameSpan.textContent='VOLUME '+vol.name;
    nameSpan.style.color=vol.color;

    const delBtn=document.createElement('button');
    delBtn.className='btn-del';
    delBtn.textContent='X';
    delBtn.onclick=()=>{ if(!confirm('Delete Volume "'+(P.vols[i]&&P.vols[i].name||'')+'"? This removes the entire building mass.')) return; P.vols.splice(i,1);buildVolPanel();rebuildAll()};

    hd.appendChild(nameSpan);
    hd.appendChild(delBtn);
    card.appendChild(hd);

    const bd=document.createElement('div');
    bd.className='vol-bd';

    // ── GEOMETRY ──
    const geoTitle=document.createElement('div');
    geoTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin-bottom:4px;letter-spacing:1px';
    geoTitle.textContent='GEOMETRY';
    bd.appendChild(geoTitle);

      // Residential/mixed-use controls
      makeRow(bd,'Storeys',vol,'storeys',1,40,1,'fl');
      makeRow(bd,'Position (N→S)',vol,'startEg',-50,400,1);
      makeRow(bd,'Depth',vol,'depth',5,400,1);
      makeRow(bd,'Width',vol,'width',5,400,1);
      makeRow(bd,'Offset East',vol,'offEast',-200,200,1);
      if(vol.offWest===undefined) vol.offWest=0;
      makeRow(bd,'Offset West',vol,'offWest',-50,150,1);
      if(vol.angle===undefined) vol.angle=0;
      makeRow(bd,'Rotation (°)',vol,'angle',0,359,1,'°');

      // ── PODIUM / TOWER ──
      const ptTitle=document.createElement('div');
      ptTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
      ptTitle.textContent='PODIUM / TOWER';
      bd.appendChild(ptTitle);
      if(vol.podiumStoreys===undefined) vol.podiumStoreys=0;
      if(vol.stepbackAmt===undefined) vol.stepbackAmt=5;
      makeRow(bd,'Podium Storeys',vol,'podiumStoreys',0,10,1,'fl');
      if(vol.podiumStoreys>0) makeRow(bd,'Tower Step-back',vol,'stepbackAmt',0,30,1);

      // ── GROUND FLOOR ──
      const gfTitle=document.createElement('div');
      gfTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
      gfTitle.textContent='GROUND FLOOR';
      bd.appendChild(gfTitle);

      const commRow=document.createElement('div');
      commRow.className='row';
      const commLbl=document.createElement('label');
      commLbl.textContent='Commercial GF';
      const commCb=document.createElement('input');
      commCb.type='checkbox';
      commCb.checked=!!vol.commGF;
      commCb.style.cssText='accent-color:#AEBC46;width:18px;height:18px;cursor:pointer';
      commCb.onchange=()=>{vol.commGF=commCb.checked?1:0;rebuildAll();buildVolPanel()};
      const commNote=document.createElement('span');
      commNote.style.cssText='font-size:10px;color:#888;margin-left:6px';
      commNote.textContent=vol.commGF?`${P.flr.gf}' GF height`:`${P.flr.typ}' GF height`;
      commRow.appendChild(commLbl);
      commRow.appendChild(commCb);
      commRow.appendChild(commNote);
      bd.appendChild(commRow);
      if(vol.gfHeight===undefined) vol.gfHeight=0;
      makeRow(bd,'GF Height Override',vol,'gfHeight',0,25,0.5,'ft');
      const gfNote=document.createElement('div');
      gfNote.style.cssText='font-size:9px;color:#777;margin:-4px 0 4px 136px';
      gfNote.textContent=vol.gfHeight>0?`Using ${vol.gfHeight}' custom`:'Using global default';
      bd.appendChild(gfNote);

    // ── ACTIONS ──
    const actTitle=document.createElement('div');
    actTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
    actTitle.textContent='ACTIONS';
    bd.appendChild(actTitle);
    const actRow=document.createElement('div');
    actRow.style.cssText='display:flex;gap:4px;margin-bottom:6px';

    const dupBtn=document.createElement('button');
    dupBtn.className='btn-add';dupBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    dupBtn.textContent='📋 Duplicate';
    dupBtn.onclick=()=>{
      const copy=JSON.parse(JSON.stringify(vol));
      copy.name=String.fromCharCode(65+P.vols.length);
      copy.startEg=vol.startEg+10;
      copy.color=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'][P.vols.length%6];
      P.vols.push(copy);buildVolPanel();rebuildAll();
    };
    actRow.appendChild(dupBtn);

    const mirBtn=document.createElement('button');
    mirBtn.className='btn-add';mirBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    mirBtn.textContent='🪞 Mirror';
    mirBtn.onclick=()=>{
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]);
      const lotW=Math.max(...allX)-Math.min(...allX);
      const copy=JSON.parse(JSON.stringify(vol));
      copy.name=String.fromCharCode(65+P.vols.length);
      // Mirror: swap east/west offsets relative to lot center
      copy.offEast=lotW-vol.offEast-vol.width;
      if(copy.offEast<0) copy.offEast=0;
      copy.angle=-vol.angle;
      copy.color=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'][P.vols.length%6];
      P.vols.push(copy);buildVolPanel();rebuildAll();
    };
    actRow.appendChild(mirBtn);

    const snapBtn=document.createElement('button');
    snapBtn.className='btn-add';snapBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    snapBtn.textContent='📐 Snap Edge';
    snapBtn.onclick=()=>{
      const side=prompt('Snap to which lot edge?\n\nType: north, south, east, or west');
      if(!side) return;
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]),allZ=vts.map(v=>v[1]);
      const lotMinX=Math.min(...allX),lotMaxX=Math.max(...allX);
      const lotMinZ=Math.min(...allZ),lotMaxZ=Math.max(...allZ);
      if(side==='north') vol.startEg=Math.round(lotMinZ);
      else if(side==='south') vol.startEg=Math.round(lotMaxZ-vol.depth);
      else if(side==='east') vol.offEast=0;
      else if(side==='west') vol.offEast=Math.round(lotMaxX-lotMinX-vol.width);
      buildVolPanel();rebuildAll();
    };
    actRow.appendChild(snapBtn);

    /* "Match Lot" button — copies the lot polygon DIRECTLY into customPolyLocal.
       IMPORTANT: customPolyLocal is interpreted as ABSOLUTE world-feet coords
       (see rebuildBuilding: `polyM = vol.customPolyLocal.map(p => [f2m(p[0]), f2m(p[1])])`),
       NOT volume-local — so we must NOT subtract lot bounds when copying. The
       volume's offEast / startEg / width / depth become irrelevant when a polygon
       is set, but we keep them consistent with the lot bounding box for any
       parametric fallback paths. */
    const matchBtn=document.createElement('button');
    matchBtn.className='btn-add';
    matchBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#3a4a3a;color:#AEBC46;border:1px solid #5a7a5a';
    matchBtn.textContent='🎯 Match Lot';
    matchBtn.title='Reshape this volume to follow the drawn lot polygon';
    matchBtn.onclick=()=>{
      const vts=lotVerts();
      if(!vts || vts.length < 3){ alert('No lot polygon — draw one on the Site Map first.'); return; }
      const lb=lotBounds();
      /* Direct copy of lot vertices — polygon is in world-feet coords. */
      vol.customPolyLocal = vts.map(function(v){ return [v[0], v[1]]; });
      /* Ensure polygon is closed (first vertex repeated at end). */
      var first = vol.customPolyLocal[0], last = vol.customPolyLocal[vol.customPolyLocal.length-1];
      if(first[0] !== last[0] || first[1] !== last[1]) vol.customPolyLocal.push([first[0], first[1]]);
      /* Reset parametric values so they don't conflict if a downstream code path
         falls back to them. With a polygon set, the renderer uses the polygon
         as-is in world coords — startEg / offEast / width / depth become unused
         for placement but kept consistent for UI display. */
      vol.width = Math.round(lb.width);
      vol.depth = Math.round(lb.depth);
      vol.offEast = 0;
      vol.startEg = Math.round(lb.minZ);
      /* Diagnostic so we can see exactly what got set + verify alignment. */
      console.log('[Match Lot] Volume', vol.name, 'now uses polygon:',
        JSON.stringify(vol.customPolyLocal.map(function(p){return [Math.round(p[0]),Math.round(p[1])];})));
      console.log('[Match Lot] Lot bounds: minX=' + Math.round(lb.minX) + ', minZ=' + Math.round(lb.minZ) +
                  ', maxX=' + Math.round(lb.maxX) + ', maxZ=' + Math.round(lb.maxZ));
      buildVolPanel();
      rebuildAll();
    };
    actRow.appendChild(matchBtn);
    bd.appendChild(actRow);
  });
}

/* ===== Restored from git baseline (truncation recovery) ===== */

function updateVolInfo(){
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMaxX=Math.max(...allX);

  P.vols.forEach((vol,i)=>{
    const el=document.getElementById('vol-info-'+i);
    if(!el)return;

    const fp=vol.width*vol.depth;
    const hasComm=vol.commGF?true:false;
    const gfH=hasComm?f2m(P.flr.gf):f2m(P.flr.typ);
    const totalH=gfH+(vol.storeys-1)*f2m(P.flr.typ);

    // Check overlap with every other volume
    let overlapArea=0;
    P.vols.forEach((other,j)=>{
      if(j===i)return;
      const ax1=lotMaxX-vol.offEast, ax0=ax1-vol.width;
      const az0=vol.startEg, az1=vol.startEg+vol.depth;
      const bx1=lotMaxX-other.offEast, bx0=bx1-other.width;
      const bz0=other.startEg, bz1=other.startEg+other.depth;
      const ox=Math.max(0,Math.min(ax1,bx1)-Math.max(ax0,bx0));
      const oz=Math.max(0,Math.min(az1,bz1)-Math.max(az0,bz0));
      const commonStoreys=Math.min(vol.storeys,other.storeys);
      if(ox>0&&oz>0&&commonStoreys>0) overlapArea+=ox*oz*commonStoreys;
    });

    const hasAngle=Math.abs(vol.angle||0)>0.5;
    const overlapNote=overlapArea>1
      ? `<br><span style="color:#ff6644;font-weight:600">⚠ ~${Math.round(overlapArea).toLocaleString()} sf overlaps${hasAngle?' (approx. — rotated)':''}</span>`
      : '<br><span style="color:#4a8">✓ No overlap</span>';
    const angleNote=hasAngle?` · <span style="color:#d4a">⟳ ${vol.angle}°</span>`:'';

    el.innerHTML=`Floor plate: <b style="color:#AEBC46">${fp.toLocaleString()} sq ft</b> · `
      +`Height: <b style="color:#AEBC46">${(totalH*3.281).toFixed(0)} ft (${totalH.toFixed(1)}m)</b>`
      +angleNote+overlapNote;
  });
}

// ── Click-to-place mode for new volumes ──
let _placeMode={active:false,preview:null};

/**
 * Activates placement mode so the user can click on the lot to add a new building volume.
 */
function addVolume(){
  // Enter placement mode — next click on the lot sets the position
  _placeMode.active=true;
  // Show placement banner
  let banner=document.getElementById('place-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='place-banner';
    banner.style.cssText='position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:100;background:#AEBC46;color:#1A1A1A;padding:8px 20px;border-radius:6px;font-weight:700;font-size:13px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    document.getElementById('canvas-wrap').appendChild(banner);
  }
  banner.textContent='CLICK ON THE LOT TO PLACE NEW VOLUME';
  banner.style.display='block';

  // Change cursor
  const cv=document.getElementById('c3d');
  if(cv) cv.style.cursor='crosshair';
}

function _handlePlaceClick(e){
  if(!_placeMode.active)return false;
  const cv=document.getElementById('c3d');
  if(!cv)return false;
  const rect=cv.getBoundingClientRect();
  _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
  _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
  _ray.setFromCamera(_mouse,camera);
  const hitPt=new THREE.Vector3();
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  if(!_ray.ray.intersectPlane(plane,hitPt))return false;

  // Convert world coords (metres) to lot coords (feet)
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const maxZ=lotBounds().maxZ;

  const clickXft=hitPt.x/FT; // world X in feet
  const clickZft=hitPt.z/FT; // world Z in feet (= startEg)

  // Check if click is within lot bounds (with tolerance)
  if(clickXft<lotMinX-10||clickXft>lotMaxX+10||clickZft<-10||clickZft>maxZ+10){
    // Clicked outside lot — cancel
    _cancelPlace();
    return true;
  }

  // Create the volume centered on the click point
  const defW=50, defD=40;
  const offEast=Math.max(-50,Math.min(150,Math.round(lotMaxX-clickXft-defW/2)));
  const startEg=Math.max(0,Math.min(maxZ-defD,Math.round(clickZft-defD/2)));

  const colors=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'];
  const c=colors[P.vols.length%colors.length];
  const letter=String.fromCharCode(65+P.vols.length);
  P.vols.push({name:letter,storeys:4,startEg:startEg,depth:defD,width:defW,offEast:offEast,offWest:0,
    angle:0,podiumStoreys:0,stepbackAmt:5,gfHeight:0,
    color:c,commGF:0,windows:1,winSpacing:3,balconies:1,balcEvery:2,balcDepth:4,
    balcN:1,balcS:1,balcE:0,balcW:0});

  _cancelPlace();
  buildVolPanel();
  rebuildAll();
  return true;
}

function _cancelPlace(){
  _placeMode.active=false;
  const banner=document.getElementById('place-banner');
  if(banner)banner.style.display='none';
  const cv=document.getElementById('c3d');
  if(cv)cv.style.cursor='';
}

// ── Overlap-aware GFA: rasterize volumes per storey onto a 1ft grid ──
function computeGFA(){
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const maxZ=lotBounds().maxZ;

  // Helper: get bounds for any volume (freeform or rectangular)
  function getBounds(vol){
    if(vol.customPolyLocal&&vol.customPolyLocal.length>=4){
      const xs=vol.customPolyLocal.map(p=>p[0]), zs=vol.customPolyLocal.map(p=>p[1]);
      return {minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
    }
    const x1=(lotMaxX||0)-(vol.offEast||0);
    const x0=x1-vol.width;
    return {minX:x0,maxX:x1,minZ:vol.startEg,maxZ:vol.startEg+vol.depth};
  }

  // Check if any volumes are freeform polygons — if so, use per-volume actual areas
  const hasCustom=P.vols.some(v=>v.customPolyLocal&&v.customPolyLocal.length>=4);

  if(hasCustom){
    // ── Step 1: Compute total GFA per storey using UNION (not sum) ──
    // For each storey, collect all volumes active at that storey,
    // then compute union = largest footprint at that level (no double-count)
    const maxStorey=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
    if(maxStorey===0) return {totalGFA:0,commGFA:0,resGFA:0,overlap:0,perStorey:[]};

    // Pre-compute each volume's footprint area (podium vs tower)
    // When a volume has podiumStoreys > 0 and stepbackAmt, tower floors above the podium
    // use a reduced footprint area matching the visual stepback in the renderer.
    const volFPs=P.vols.map((vol,vi)=>{
      const isCustom=vol.customPolyLocal&&vol.customPolyLocal.length>=4;
      const baseFP=isCustom?(vol.customAreaSF||0):(vol.width*vol.depth);
      let towerFP=baseFP; // default: same as podium
      const podFloors=vol.podiumStoreys||0;

      // Compute tower plate area after stepback (same centroid-shrink as renderer)
      if(podFloors>0 && (vol.stepbackAmt||0)>0){
        if(isCustom && vol.customPolyLocal && vol.customPolyLocal.length>=4){
          // Shrink polygon toward centroid by stepbackAmt feet, compute area
          const poly=vol.customPolyLocal;
          const n=poly[0][0]===poly[poly.length-1][0]&&poly[0][1]===poly[poly.length-1][1]?poly.length-1:poly.length;
          let cx=0,cz=0;
          for(let i=0;i<n;i++){cx+=poly[i][0];cz+=poly[i][1];}
          cx/=n; cz/=n;
          const stepFt=vol.stepbackAmt;
          // Compute scale factor for each vertex (same as renderer's centroid shrink)
          let towerArea=0;
          const shrunk=[];
          for(let i=0;i<n;i++){
            const dx=poly[i][0]-cx, dz=poly[i][1]-cz;
            const dist=Math.sqrt(dx*dx+dz*dz);
            const scale=dist>0.01?Math.max(0.3,(dist-stepFt)/dist):1;
            shrunk.push([cx+dx*scale, cz+dz*scale]);
          }
          // Shoelace area of shrunk polygon
          for(let i=0;i<shrunk.length;i++){
            const j=(i+1)%shrunk.length;
            towerArea+=shrunk[i][0]*shrunk[j][1]-shrunk[j][0]*shrunk[i][1];
          }
          towerFP=Math.abs(towerArea)/2;
        } else {
          // Rectangle: reduce width and depth by stepback on each side
          const tw=Math.max(20, vol.width - vol.stepbackAmt*2);
          const td=Math.max(20, vol.depth - vol.stepbackAmt*2);
          towerFP=tw*td;
        }
      }

      return {
        fpArea:baseFP, towerFpArea:towerFP, podiumStoreys:podFloors,
        storeys:vol.storeys, commGF:!!vol.commGF, bounds:getBounds(vol), name:vol.name||('Vol'+vi)
      };
    }).filter(v=>v.fpArea>0&&v.storeys>0);

    let totalGFA=0;
    let naiveSum=volFPs.reduce((s,v)=>{
      // podiumStoreys = upper floors at full lot (not counting GF), so GF+podium = podiumStoreys+1
      const podTotal=Math.min(v.podiumStoreys+1,v.storeys); // GF + podium upper floors
      const twr=Math.max(0,v.storeys-podTotal);
      return s+v.fpArea*podTotal+v.towerFpArea*twr;
    },0);
    const perStorey=[];

    // For each storey, compute the UNION area of all active volumes
    // Using inclusion-exclusion on bounding box overlaps
    // Storey 1 = ground floor, storeys 2..podiumStoreys = podium, above = tower (smaller plate)
    for(let s=1;s<=maxStorey;s++){
      const active=volFPs.filter(v=>s<=v.storeys);
      if(active.length===0){perStorey.push({storey:s,area:0,volumes:[]});continue;}

      let storeyArea;
      if(active.length===1){
        const v=active[0];
        // Use tower plate area for floors above podium
        storeyArea=(v.podiumStoreys>0 && s>v.podiumStoreys+1) ? v.towerFpArea : v.fpArea;
      } else {
        storeyArea=active.reduce((sum,v)=>{
          return sum+((v.podiumStoreys>0 && s>v.podiumStoreys+1) ? v.towerFpArea : v.fpArea);
        },0);
        for(let i=0;i<active.length;i++){
          for(let j=i+1;j<active.length;j++){
            const a=active[i].bounds, b=active[j].bounds;
            if(!a||!b)continue;
            const ox=Math.max(0,Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX));
            const oz=Math.max(0,Math.min(a.maxZ,b.maxZ)-Math.max(a.minZ,b.minZ));
            if(ox>0&&oz>0) storeyArea-=ox*oz;
          }
        }
        storeyArea=Math.max(0,storeyArea);
      }
      totalGFA+=storeyArea;
      perStorey.push({storey:s,area:storeyArea,volumes:active.map(v=>v.name)});
    }

    // ── Step 2: Commercial GFA = ONLY the first volume (Building A) footprint ──
    // Other volumes may have commGF checked solely to get the taller GF ceiling height,
    // but they do NOT contribute additional commercial area — Building A is the main GF.
    let commGFA=0;
    if(volFPs.length>0 && volFPs[0].commGF){
      commGFA=volFPs[0].fpArea;
    }

    const overlap=naiveSum-totalGFA;
    const resGFA=Math.max(0,totalGFA-commGFA);
    return {totalGFA, commGFA, resGFA, overlap, perStorey};
  }

  // ── Rectangular mode (original coordinate compression) ──
  const resolved=P.vols.map((vol,vi)=>{
    const x1ft=(lotMaxX||0)-(vol.offEast||0);
    const x0ft=x1ft-vol.width;
    return {
      x0:x0ft, x1:x1ft,
      z0:vol.startEg, z1:vol.startEg+vol.depth,
      storeys:vol.storeys, startEg:vol.startEg, commGF:vol.commGF?true:false,
      fpArea:(x1ft-x0ft)*(vol.depth), name:vol.name||('Vol'+vi)
    };
  }).filter(r=>r.x1>r.x0 && r.z1>r.z0 && r.storeys>0);

  // Find max storey across all volumes
  const maxStorey=resolved.reduce((m,r)=>Math.max(m,r.storeys),0);
  if(maxStorey===0) return {totalGFA:0,commGFA:0,resGFA:0,overlap:0,perStorey:[]};

  // For each storey, compute the UNION area of all volumes present at that storey
  let totalGFA=0, commGFA=0, overlap=0;
  const perStorey=[];

  // Also compute naive sum for overlap detection
  let naiveSum=0;
  resolved.forEach(r=>{naiveSum+=r.fpArea*r.storeys});

  for(let s=1;s<=maxStorey;s++){
    // Collect all volume rectangles active at this storey
    const rects=resolved.filter(r=>s<=r.storeys);
    if(rects.length===0)continue;

    // Compute union area using coordinate compression (exact, no grid needed)
    // Collect all unique X breakpoints
    const xs=new Set();
    rects.forEach(r=>{xs.add(r.x0);xs.add(r.x1)});
    const sortedX=[...xs].sort((a,b)=>a-b);

    let storeyArea=0;
    for(let i=0;i<sortedX.length-1;i++){
      const sx0=sortedX[i], sx1=sortedX[i+1];
      const sliceW=sx1-sx0;
      if(sliceW<=0)continue;

      // For this X slice, collect all Z intervals from active rects
      const zIntervals=[];
      rects.forEach(r=>{
        if(r.x0<sx1 && r.x1>sx0){
          zIntervals.push([r.z0, r.z1]);
        }
      });

      // Merge Z intervals
      zIntervals.sort((a,b)=>a[0]-b[0]);
      let mergedLen=0, curStart=-Infinity, curEnd=-Infinity;
      zIntervals.forEach(([a,b])=>{
        if(a>curEnd){
          if(curEnd>curStart) mergedLen+=curEnd-curStart;
          curStart=a;curEnd=b;
        } else {
          curEnd=Math.max(curEnd,b);
        }
      });
      if(curEnd>curStart) mergedLen+=curEnd-curStart;

      storeyArea+=sliceW*mergedLen;
    }

    totalGFA+=storeyArea;
    perStorey.push({storey:s,area:storeyArea,volumes:rects.map(r=>r.name)});

    // Storey 1 — commercial area = ONLY the first volume (Building A) footprint
    // Other volumes with commGF checked only get the taller GF height, not additional commercial area
    if(s===1){
      if(resolved.length>0 && resolved[0].commGF){
        commGFA=resolved[0].fpArea;
      }
    }
  }

  overlap=naiveSum-totalGFA;
  const resGFA=totalGFA-commGFA;
  return {totalGFA, commGFA, resGFA, overlap, perStorey};
}

function updateStats(){
  const grid=document.getElementById('stats-grid');
  const area=lotArea();
  const gfa=computeGFA();
  const fsi=gfa.totalGFA/area;
  const pfd=pfData();
  const fmt0=n=>n.toLocaleString(undefined,{maximumFractionDigits:0});

  const overlapWarn=gfa.overlap>1 ? `<div class="stat-item" style="grid-column:span 2;color:#ff6644;font-weight:700">
    ⚠ ${fmt0(gfa.overlap)} sf overlap removed from GFA</div>` : '';

  const units=pfd.totalUnits||0;
  grid.innerHTML=`
    <div class="stat-item">Lot Area<br><span class="stat-val">${fmt0(area)} sf</span></div>
    <div class="stat-item">Total GFA<br><span class="stat-val">${fmt0(gfa.totalGFA)} sf</span></div>
    <div class="stat-item">FSI<br><span class="stat-val">${fsi.toFixed(2)}x</span></div>
    <div class="stat-item">Units<br><span class="stat-val">${units}</span></div>
    <div class="stat-item">Res. GFA<br><span class="stat-val">${fmt0(gfa.resGFA)} sf</span></div>
    <div class="stat-item">Comm. GFA<br><span class="stat-val">${fmt0(gfa.commGFA)} sf</span></div>
    <div class="stat-item">Max Height<br><span class="stat-val">${getMaxHeight().toFixed(0)} ft</span></div>
    <div class="stat-item">Rear (derived)<br><span class="stat-val">${derivedRearFrontage().toFixed(0)} ft</span></div>
    ${overlapWarn}
  `;
}

function getMaxHeight(){
  let max=0;
  P.vols.forEach(v=>{
    const h=(v.commGF?P.flr.gf:P.flr.typ)+(v.storeys-1)*P.flr.typ;
    if(h>max)max=h;
  });
  return max;
}

function derivedRearFrontage(){
  const vts=lotVerts();
  if(vts.length<6){
    // For polygon lots without the L-shape parametric model, find the longest south-facing edge
    let maxLen=0;
    for(let i=0;i<vts.length;i++){
      const j=(i+1)%vts.length;
      const len=Math.sqrt(Math.pow(vts[j][0]-vts[i][0],2)+Math.pow(vts[j][1]-vts[i][1],2));
      if(len>maxLen) maxLen=len;
    }
    return maxLen;
  }
  return Math.sqrt(Math.pow(vts[4][0]-vts[5][0],2)+Math.pow(vts[4][1]-vts[5][1],2));
}

function updateInfoBar(){
  document.getElementById('info-bar').textContent=
    `LOT - ${P.lot.front}' x ${P.lot.rear}' - ${lotArea().toLocaleString(undefined,{maximumFractionDigits:0})} SF`;
}

// ═══════════════════════════════════════════════════════════
//  INDUSTRIAL SURFACE ZONES
//  Renders P.industrialSurfaces (truck court, car parking, etc.) as flat
//  coloured polygons on the ground plane. Populated by _omGenerateIndustrial.
//  Each surface entry: { type, label, coords:[[x,z],...], color, opacity }
//  Coords are in feet (X+ = East, Z+ = South). Rendered at y=0.05 so they sit
//  just above the satellite ground texture without z-fighting.
// ═══════════════════════════════════════════════════════════
function rebuildIndustrialSurfaces(){
  clearGroup('industrial_surfaces');
  if(typeof P === 'undefined' || !P || !Array.isArray(P.industrialSurfaces)) return;
  if(P.industrialSurfaces.length === 0) return;
  var g = groups.industrial_surfaces;

  P.industrialSurfaces.forEach(function(surf){
    if(!surf || !Array.isArray(surf.coords) || surf.coords.length < 4) return;
    // Build 2D shape in (X, -Z) — see comments in rebuildContextBuildings
    // for why the Z-axis is negated (group rotation.x = -Math.PI/2 maps
    // shape's +Y to world's -Z).
    var pts = [];
    for(var i = 0; i < surf.coords.length - 1; i++){
      pts.push(new THREE.Vector2(f2m(surf.coords[i][0]), -f2m(surf.coords[i][1])));
    }
    if(pts.length < 3) return;
    var shape = new THREE.Shape(pts);
    var geo = new THREE.ShapeGeometry(shape);
    var mat = new THREE.MeshBasicMaterial({
      color: (typeof surf.color === 'number') ? surf.color : 0x444444,
      transparent: true,
      opacity: (typeof surf.opacity === 'number') ? surf.opacity : 0.85,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = (typeof surf._renderY === 'number') ? surf._renderY : 0.05;          // honour _renderY hint (used by industrial landscape)
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    mesh.userData.surfaceType = surf.type || 'unknown';
    g.add(mesh);
  });
}
