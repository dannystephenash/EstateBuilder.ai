// renderer.js — 3D scene init, orbit controls, camera, views, dispose
let scene,camera,renderer,controls;
const groups={lot:null,building:null,labels:null,env:null,setbacks:null};

/**
 * Initializes the Three.js scene, camera, renderer, lighting rig, sky dome, and orbit controls.
 * Called once on app startup. Creates the #c3d canvas context with shadow maps and tone mapping.
 */
function initThree(){
  const c=document.getElementById('c3d');
  const wrap=document.getElementById('canvas-wrap');

  scene=new THREE.Scene();
  scene.background=new THREE.Color(0x12151e);
  scene.fog=new THREE.FogExp2(0x12151e,0.0007);

  camera=new THREE.PerspectiveCamera(50,wrap.clientWidth/wrap.clientHeight,0.5,500);
  renderer=new THREE.WebGLRenderer({canvas:c,antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  renderer.setSize(wrap.clientWidth,wrap.clientHeight);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=0.95;
  renderer.outputEncoding=THREE.sRGBEncoding;

  // Gradient sky dome
  {
    const skyGeo=new THREE.SphereGeometry(200,32,16);
    const skyMat=new THREE.ShaderMaterial({
      uniforms:{topColor:{value:new THREE.Color('#1a2233')},bottomColor:{value:new THREE.Color(0x12151e)}},
      vertexShader:'varying vec3 vWorldPos;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vWorldPos=wp.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:'uniform vec3 topColor;uniform vec3 bottomColor;varying vec3 vWorldPos;void main(){float h=normalize(vWorldPos).y;gl_FragColor=vec4(mix(bottomColor,topColor,max(h,0.0)),1.0);}',
      side:THREE.BackSide,depthWrite:false
    });
    scene.add(new THREE.Mesh(skyGeo,skyMat));
  }

  // Golden hour 4-light rig
  var ambLight=new THREE.AmbientLight(0x334455,0.28);
  scene.add(ambLight);
  var hemiLight=new THREE.HemisphereLight(0x7799bb,0x342a20,0.38);
  scene.add(hemiLight);
  var sunLight=new THREE.DirectionalLight(0xffd0a0,1.6);
  sunLight.position.set(-200,170,-110);
  sunLight.castShadow=true;
  sunLight.shadow.mapSize.width=2048;
  sunLight.shadow.mapSize.height=2048;
  sunLight.shadow.camera.near=0.5;
  sunLight.shadow.camera.far=500;
  sunLight.shadow.camera.left=-100;
  sunLight.shadow.camera.right=100;
  sunLight.shadow.camera.top=100;
  sunLight.shadow.camera.bottom=-100;
  sunLight.shadow.bias=-0.0005;
  scene.add(sunLight);
  var fillLight=new THREE.DirectionalLight(0xffeedd,0.22);
  fillLight.position.set(150,70,190);
  scene.add(fillLight);
  var rimLight=new THREE.DirectionalLight(0x7788bb,0.42);
  rimLight.position.set(70,190,-190);
  scene.add(rimLight);

  // Shadow-receiving ground plane
  {
    const gpGeo=new THREE.PlaneGeometry(400,400);
    const gpMat=new THREE.ShadowMaterial({opacity:0.35});
    const gp=new THREE.Mesh(gpGeo,gpMat);
    gp.rotation.x=-Math.PI/2;
    gp.position.y=-0.01;
    gp.receiveShadow=true;
    scene.add(gp);
  }

  // Simple orbit controls (manual)
  initOrbit(c);

  // Default view from south
  setView('perspective');

  window.addEventListener('resize',onResize);
}

// ── manual orbit controls + volume drag ──
let orb={theta:-Math.PI/6,phi:Math.PI/4,dist:70,target:new THREE.Vector3(0,5,0),dragging:false,btn:-1,px:0,py:0};
const _drag={active:false,volIdx:-1,startMouse:{x:0,y:0},startPos:{startEg:0,offEast:0},startWorld:{x:0,z:0},startPoly:null,groundPlane:new THREE.Plane(new THREE.Vector3(0,1,0),0)};
const _ray=new THREE.Raycaster();
const _mouse=new THREE.Vector2();
let _dragRebuildTimer=null; // debounce drag rebuilds

// ── 3D Polygon Edit Mode ──
// When active, displays per-vertex handles at the bottom, middle, and top of the
// polygon volume (customPolyLocal). Dragging any handle moves THAT vertex of the
// polygon. During drag, only a lightweight WIREFRAME preview updates (real-time,
// no lag); the full mesh rebuild happens on mouseup. This is the "pro CAD" pattern.
const _poly3D = {
  active: false,           // mode toggle
  volIdx: -1,              // index of the volume being resized
  addVertexMode: false,    // when true, edge midpoint handles are clickable to insert a vertex
  handleGroup: null,       // THREE.Group containing handle meshes
  handles: [],             // metadata array
  previewGroup: null,      // THREE.Group with wireframe + ghost outlines (live during drag)
  previewLines: null,      // THREE.LineSegments for top/bottom polygon outline
  drag: {
    active: false,
    vertexIdx: -1,                  // which polygon vertex is being moved
    startVertex: { xFt: 0, zFt: 0 },// vertex's xz at drag start
    startMouseWorld: { x: 0, z: 0 } // ground-plane hit at mousedown (metres)
  }
};

/** Build/refresh the lightweight wireframe preview that updates during drag.
 *  Two horizontal rings at top/bottom + vertical lines at each vertex.
 *  Total: ~3*nVerts line segments, vs thousands for the full mesh. */
function _poly3DBuildPreview(){
  if(!_poly3D.previewGroup){
    _poly3D.previewGroup = new THREE.Group();
    scene.add(_poly3D.previewGroup);
  }
  // Clear previous
  for(var i = _poly3D.previewGroup.children.length - 1; i >= 0; i--){
    var ch = _poly3D.previewGroup.children[i];
    _poly3D.previewGroup.remove(ch);
    if(ch.geometry) ch.geometry.dispose();
    if(ch.material) ch.material.dispose();
  }
  if(!_poly3D.active) return;
  var vol = P.vols[_poly3D.volIdx];
  if(!vol || !vol.customPolyLocal || vol.customPolyLocal.length < 3) return;
  var pts = vol.customPolyLocal;
  var closed = pts.length > 1 && pts[0][0] === pts[pts.length-1][0] && pts[0][1] === pts[pts.length-1][1];
  var ring = closed ? pts : pts.concat([pts[0]]);
  var totalH = ((vol.commGF ? P.flr.gf : P.flr.typ) + (vol.storeys - 1) * P.flr.typ) * 0.3048;
  var baseY = vol.baseElevFt > 0 ? vol.baseElevFt * 0.3048 : 0;
  var topY  = baseY + totalH;
  // Build line segment list: bottom ring + top ring + verticals
  var verts = [];
  for(var ri = 0; ri < ring.length - 1; ri++){
    var a = ring[ri], b = ring[ri+1];
    var ax = f2m(a[0]), az = f2m(a[1]);
    var bx = f2m(b[0]), bz = f2m(b[1]);
    // Bottom ring edge
    verts.push(ax, baseY + 0.05, az,  bx, baseY + 0.05, bz);
    // Top ring edge
    verts.push(ax, topY,        az,  bx, topY,        bz);
    // Vertical at vertex
    verts.push(ax, baseY + 0.05, az,  ax, topY, az);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  var mat = new THREE.LineBasicMaterial({ color: 0xAEBC46, transparent: true, opacity: 0.9, depthTest: false });
  var lines = new THREE.LineSegments(geo, mat);
  lines.renderOrder = 998;
  _poly3D.previewGroup.add(lines);
  _poly3D.previewLines = lines;
}

function _poly3DDestroyPreview(){
  if(!_poly3D.previewGroup) return;
  for(var i = _poly3D.previewGroup.children.length - 1; i >= 0; i--){
    var ch = _poly3D.previewGroup.children[i];
    _poly3D.previewGroup.remove(ch);
    if(ch.geometry) ch.geometry.dispose();
    if(ch.material) ch.material.dispose();
  }
  scene.remove(_poly3D.previewGroup);
  _poly3D.previewGroup = null;
  _poly3D.previewLines = null;
}

/** Hide/show the actual building mesh for the volume being dragged.
 *  During drag the wireframe represents the new shape; if the heavy mesh
 *  stays visible at its OLD position, the user sees a confusing "ghost". */
function _poly3DSetMeshVisibility(volIdx, visible){
  if(!groups || !groups.building || !groups.building.children) return;
  for(var i = 0; i < groups.building.children.length; i++){
    var child = groups.building.children[i];
    if(child._volIdx === volIdx){
      child.visible = visible;
    }
  }
}

/** Compute polygon bbox in feet (the customPolyLocal coordinate space) */
function _polyBBoxFt(polyFt){
  if(!polyFt || polyFt.length < 3) return null;
  var xs = polyFt.map(p => p[0]);
  var zs = polyFt.map(p => p[1]);
  return {
    minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs),
    minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs)
  };
}

/** Convert (x,z) in feet to world-space (Three.js) coordinates.
 *  customPolyLocal uses [x,z] in feet; the polygon Shape uses [f2m(x), -f2m(z)]
 *  internally, BUT ExtrudeGeometry then rotates -90° on X axis which UN-negates Z.
 *  Net result: polygon vertex (xFt, zFt) ends up at world (f2m(xFt), height, +f2m(zFt)).
 *  The lot mesh confirms this: it uses [f2m(x), Y, f2m(z)] directly with POSITIVE z.
 *  Earlier bug: this function used -f2m(zFt) which placed handles mirrored across the origin. */
function _ftToWorld(xFt, zFt){
  return { x: f2m(xFt), z: f2m(zFt) };
}

/** Get the 4 corner positions in feet for the volume's bounding box */
function _polyCornerPositions(vol){
  var b = _polyBBoxFt(vol.customPolyLocal);
  if(!b) return null;
  // NW = top-left when looking from above (small X, large Z)
  // NE = top-right (large X, large Z); SW = small X small Z; SE = large X small Z
  return {
    nw: { xFt: b.minX, zFt: b.maxZ },
    ne: { xFt: b.maxX, zFt: b.maxZ },
    sw: { xFt: b.minX, zFt: b.minZ },
    se: { xFt: b.maxX, zFt: b.minZ },
    bbox: b
  };
}

/** In direct-click mode the only persistent indicator is the wireframe outline,
 *  built by _poly3DBuildPreview(). Tiny vertex dots are also added so the user
 *  knows where the polygon corners are, but the primary interaction is clicking
 *  directly on the building mesh — see the mousedown handler. */
function _poly3DBuildHandles(){
  if(!_poly3D.handleGroup){
    _poly3D.handleGroup = new THREE.Group();
    _poly3D.handleGroup.renderOrder = 999;
    scene.add(_poly3D.handleGroup);
  }
  // Clear old
  for(var i = _poly3D.handleGroup.children.length - 1; i >= 0; i--){
    var ch = _poly3D.handleGroup.children[i];
    _poly3D.handleGroup.remove(ch);
    if(ch.geometry) ch.geometry.dispose();
    if(ch.material) ch.material.dispose();
  }
  _poly3D.handles = [];

  var vol = P.vols[_poly3D.volIdx];
  if(!vol || !vol.customPolyLocal || vol.customPolyLocal.length < 3) return;

  // Always show the wireframe outline so the user knows what they're editing
  _poly3DBuildPreview();

  // Tiny vertex marker dots at GROUND level only (visual hint where corners are)
  var baseY = vol.baseElevFt > 0 ? vol.baseElevFt * 0.3048 : 0;
  var pts = vol.customPolyLocal;
  var nPts = pts.length;
  var closed = (nPts > 1 && pts[0][0] === pts[nPts-1][0] && pts[0][1] === pts[nPts-1][1]);
  var nUnique = closed ? nPts - 1 : nPts;
  var dotGeo = new THREE.SphereGeometry(0.6, 8, 6);
  for(var vi = 0; vi < nUnique; vi++){
    var p = pts[vi];
    var w = _ftToWorld(p[0], p[1]);
    var dotMat = new THREE.MeshBasicMaterial({ color: 0xAEBC46, transparent: true, opacity: 0.85, depthTest: false });
    var dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.set(w.x, baseY + 0.3, w.z);
    dot.renderOrder = 999;
    _poly3D.handleGroup.add(dot);
    _poly3D.handles.push({ mesh: dot, vertexIdx: vi, kind: 'vertexDot' });
  }
}

/** Find the polygon vertex (in customPolyLocal) nearest to a world-space point.
 *  Returns { vertexIdx, distFt } or null. */
function _poly3DNearestVertex(vol, worldX, worldZ){
  if(!vol || !vol.customPolyLocal || vol.customPolyLocal.length < 3) return null;
  var ftX = worldX / 0.3048;
  var ftZ = worldZ / 0.3048;
  var pts = vol.customPolyLocal;
  var nPts = pts.length;
  var closed = (nPts > 1 && pts[0][0] === pts[nPts-1][0] && pts[0][1] === pts[nPts-1][1]);
  var nUnique = closed ? nPts - 1 : nPts;
  var bestIdx = -1, bestD = Infinity;
  for(var i = 0; i < nUnique; i++){
    var dx = pts[i][0] - ftX;
    var dz = pts[i][1] - ftZ;
    var d = Math.sqrt(dx*dx + dz*dz);
    if(d < bestD){ bestD = d; bestIdx = i; }
  }
  return bestIdx >= 0 ? { vertexIdx: bestIdx, distFt: bestD } : null;
}

/** Translate a polygon by (dxFt, dzFt) but clamp the offset so the polygon's
 *  bounding box stays within the lot's bounding box. Returns the adjusted offsets.
 *  This is used for drag-to-move so the building never leaks outside the lot. */
function _polyTranslateClampToLot(startPoly, dxFt, dzFt){
  var lotVts = (typeof lotVerts === 'function') ? lotVerts() : null;
  if(!lotVts || lotVts.length < 3 || !startPoly || startPoly.length < 1) return { dx: dxFt, dz: dzFt };
  // Polygon bbox after the proposed translation
  var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for(var i = 0; i < startPoly.length; i++){
    var x = startPoly[i][0] + dxFt, z = startPoly[i][1] + dzFt;
    if(x < minX) minX = x; if(x > maxX) maxX = x;
    if(z < minZ) minZ = z; if(z > maxZ) maxZ = z;
  }
  // Lot bbox
  var lotMinX = Infinity, lotMaxX = -Infinity, lotMinZ = Infinity, lotMaxZ = -Infinity;
  for(var j = 0; j < lotVts.length; j++){
    if(lotVts[j][0] < lotMinX) lotMinX = lotVts[j][0];
    if(lotVts[j][0] > lotMaxX) lotMaxX = lotVts[j][0];
    if(lotVts[j][1] < lotMinZ) lotMinZ = lotVts[j][1];
    if(lotVts[j][1] > lotMaxZ) lotMaxZ = lotVts[j][1];
  }
  // Pull the offset back so polygon bbox fits inside lot bbox
  var adjDx = dxFt, adjDz = dzFt;
  if(minX < lotMinX) adjDx += (lotMinX - minX);
  if(maxX > lotMaxX) adjDx -= (maxX - lotMaxX);
  if(minZ < lotMinZ) adjDz += (lotMinZ - minZ);
  if(maxZ > lotMaxZ) adjDz -= (maxZ - lotMaxZ);
  return { dx: adjDx, dz: adjDz };
}

/** Clamp an (xFt, zFt) point to be inside the lot polygon.
 *  If outside, project to the nearest point on the lot perimeter using turf.
 *  Falls back to lot bbox clamping if turf isn't available. */
function _poly3DClampToLot(xFt, zFt){
  // Get the lot polygon vertices (positive XZ in feet)
  var lotVts = (typeof lotVerts === 'function') ? lotVerts() : null;
  if(!lotVts || lotVts.length < 3) return [xFt, zFt];

  // Quick path: if turf is available, use proper polygon containment + projection
  if(typeof turf !== 'undefined' && turf.point && turf.polygon && turf.booleanPointInPolygon){
    try {
      var ring = lotVts.slice();
      // Ensure closed
      if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
        ring.push([ring[0][0], ring[0][1]]);
      }
      var lotPoly = turf.polygon([ring]);
      var pt = turf.point([xFt, zFt]);
      if(turf.booleanPointInPolygon(pt, lotPoly)){
        return [xFt, zFt]; // inside, no change
      }
      // Outside — project to nearest point on the perimeter
      if(turf.nearestPointOnLine && turf.polygonToLine){
        var line = turf.polygonToLine(lotPoly);
        // polygonToLine of a single polygon returns a Feature<LineString>
        var nearest = turf.nearestPointOnLine(line, pt);
        if(nearest && nearest.geometry && nearest.geometry.coordinates){
          // Pull slightly inward (~1ft) so subsequent rebuilds don't see the vertex
          // exactly on the edge (which can cause numerical issues)
          var nx = nearest.geometry.coordinates[0];
          var nz = nearest.geometry.coordinates[1];
          // Vector from nearest point toward lot centroid (simple approximation)
          var cx = 0, cz = 0;
          for(var ci = 0; ci < lotVts.length; ci++){ cx += lotVts[ci][0]; cz += lotVts[ci][1]; }
          cx /= lotVts.length; cz /= lotVts.length;
          var inX = cx - nx, inZ = cz - nz;
          var inMag = Math.sqrt(inX*inX + inZ*inZ) || 1;
          return [nx + (inX/inMag)*0.5, nz + (inZ/inMag)*0.5];
        }
      }
    } catch(e) { /* fall through to bbox clamp */ }
  }
  // Fallback: clamp to lot bbox
  var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for(var i = 0; i < lotVts.length; i++){
    if(lotVts[i][0] < minX) minX = lotVts[i][0];
    if(lotVts[i][0] > maxX) maxX = lotVts[i][0];
    if(lotVts[i][1] < minZ) minZ = lotVts[i][1];
    if(lotVts[i][1] > maxZ) maxZ = lotVts[i][1];
  }
  return [Math.max(minX, Math.min(maxX, xFt)), Math.max(minZ, Math.min(maxZ, zFt))];
}

// ═══════════════════════════════════════════════════════════════════════
//  CORNER-HANDLE RESHAPE SYSTEM — DISABLED
//  This experiment was abandoned. The constants and functions below are
//  retained as no-ops so existing call sites (mousedown/mousemove/mouseup
//  in initOrbit, plus the rebuildAll hook in renderer-components.js) don't
//  break. _ph.meshList stays empty so nothing is interactive.
// ═══════════════════════════════════════════════════════════════════════
const _ph = {
  group: null,           // THREE.Group containing all handle spheres
  meshList: [],          // [{ mesh, volIdx, vertexIdx, level, baseColor }] for raycast/lookup
  drag: {
    active: false,
    volIdx: -1,
    vertexIdx: -1,
    level: 'bottom',     // 'bottom' or 'top' — which sphere was grabbed (purely cosmetic)
    startVertex: { xFt: 0, zFt: 0 },
    startMouseWorld: { x: 0, z: 0 }
  },
  rebuildScheduled: false,
  hoverMeshUuid: null
};

/** Per-volume color palette so each volume's handles are visually distinct.
 *  Volume 0 (typically Podium) gets orange; Volume 1 (typically Tower) gets cyan; etc.
 *  Returns { base, light, baseHex, name } for a given volume index. */
function _phColorForVol(vi){
  // Bright, well-separated hues — each volume's handles stand apart at any camera angle.
  var palette = [
    { base: 0xFF7A00, light: 0xFFB000, name: 'orange' }, // vol 0 → podium-ish
    { base: 0x00C8FF, light: 0x66E0FF, name: 'cyan' },   // vol 1 → tower-ish
    { base: 0xFF3DCB, light: 0xFF80E0, name: 'magenta' },
    { base: 0x88FF00, light: 0xC8FF66, name: 'lime' },
    { base: 0xB066FF, light: 0xD0A0FF, name: 'purple' },
    { base: 0xFFE000, light: 0xFFF080, name: 'yellow' }
  ];
  return palette[vi % palette.length];
}

/** Make a small canvas-based text label that hovers above a corner.
 *  Returns a THREE.Sprite. Used to label which volume each set of handles belongs to. */
function _phMakeLabel(text, colorHex){
  var canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  // Dark pill background
  ctx.fillStyle = 'rgba(20, 24, 32, 0.85)';
  ctx.beginPath();
  if(ctx.roundRect) ctx.roundRect(4, 12, 248, 40, 16);
  else ctx.rect(4, 12, 248, 40);
  ctx.fill();
  // Colored text
  ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0').toUpperCase();
  ctx.font = 'bold 28px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(8, 2, 1); // ~8m wide
  sprite.renderOrder = 1001;
  return sprite;
}

/** DISABLED — see header comment. No-op stub kept so external callers don't crash. */
function _phRebuild(){ return; }
function _phRebuild_DISABLED(){
  // Lazily create the parent group
  if(!_ph.group){
    if(typeof scene === 'undefined' || !scene) return; // scene not ready
    _ph.group = new THREE.Group();
    _ph.group.renderOrder = 999;
    scene.add(_ph.group);
  }
  // Wipe old children + free GPU memory
  for(var ci = _ph.group.children.length - 1; ci >= 0; ci--){
    var ch = _ph.group.children[ci];
    _ph.group.remove(ch);
    if(ch.geometry) ch.geometry.dispose();
    if(ch.material){
      if(ch.material.map) ch.material.map.dispose();
      ch.material.dispose();
    }
  }
  _ph.meshList = [];
  if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;

  // One shared geometry; one material per sphere (so we can recolor on hover)
  var sphereGeo = new THREE.SphereGeometry(1.4, 16, 12);
  var ringGeo = new THREE.RingGeometry(1.6, 2.2, 24);
  ringGeo.rotateX(-Math.PI / 2);

  for(var vi = 0; vi < P.vols.length; vi++){
    var vol = P.vols[vi];
    if(!vol || !vol.customPolyLocal || vol.customPolyLocal.length < 3) continue;
    var pts = vol.customPolyLocal;
    var closed = pts.length > 1 && pts[0][0] === pts[pts.length-1][0] && pts[0][1] === pts[pts.length-1][1];
    var nUnique = closed ? pts.length - 1 : pts.length;
    var baseY = vol.baseElevFt > 0 ? vol.baseElevFt * 0.3048 : 0;
    var gfH   = (vol.commGF ? P.flr.gf : P.flr.typ) || 10;
    var totalH = (gfH + (Math.max(1, vol.storeys) - 1) * (P.flr.typ || 10)) * 0.3048;
    var topY  = baseY + totalH;

    // Per-volume color so each volume's handles are visually distinct
    var palette = _phColorForVol(vi);
    var labelText = (vol.name || ('Vol ' + (vi+1))).toUpperCase();

    for(var pi = 0; pi < nUnique; pi++){
      var p = pts[pi];
      var wx = f2m(p[0]), wz = f2m(p[1]);

      // BOTTOM sphere — base color, always-on-top so you can always see it
      var matB = new THREE.MeshBasicMaterial({ color: palette.base, transparent: true, opacity: 0.95, depthTest: false });
      var sBot = new THREE.Mesh(sphereGeo, matB);
      sBot.position.set(wx, baseY + 1.2, wz);
      sBot.renderOrder = 1000;
      _ph.group.add(sBot);
      _ph.meshList.push({ mesh: sBot, volIdx: vi, vertexIdx: pi, level: 'bottom', baseColor: palette.base });

      // Ground ring around the bottom — extra-large click target hint
      var matR = new THREE.MeshBasicMaterial({ color: palette.base, transparent: true, opacity: 0.55, depthTest: false, side: THREE.DoubleSide });
      var ring = new THREE.Mesh(ringGeo, matR);
      ring.position.set(wx, baseY + 0.05, wz);
      ring.renderOrder = 999;
      _ph.group.add(ring);

      // TOP sphere — lighter shade so top vs bottom is clearly readable
      var matT = new THREE.MeshBasicMaterial({ color: palette.light, transparent: true, opacity: 0.95, depthTest: false });
      var sTop = new THREE.Mesh(sphereGeo, matT);
      sTop.position.set(wx, topY + 0.3, wz);
      sTop.renderOrder = 1000;
      _ph.group.add(sTop);
      _ph.meshList.push({ mesh: sTop, volIdx: vi, vertexIdx: pi, level: 'top', baseColor: palette.light });

      // Vertical guide line connecting top + bottom handle (subtle)
      var lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(wx, baseY + 0.05, wz),
        new THREE.Vector3(wx, topY + 0.3, wz)
      ]);
      var lineMat = new THREE.LineBasicMaterial({ color: palette.base, transparent: true, opacity: 0.35, depthTest: false });
      var line = new THREE.Line(lineGeo, lineMat);
      line.renderOrder = 998;
      _ph.group.add(line);

      // Volume-name label floating above the TOP handle of CORNER 0 (one label per volume)
      if(pi === 0){
        var label = _phMakeLabel(labelText, palette.base);
        label.position.set(wx, topY + 4.5, wz);
        _ph.group.add(label);
      }
    }
  }
}

/** Schedule a handle rebuild on the next animation frame (coalesces rapid calls). */
function _phRebuildScheduled(){
  if(_ph.rebuildScheduled) return;
  _ph.rebuildScheduled = true;
  requestAnimationFrame(function(){
    _ph.rebuildScheduled = false;
    try { _phRebuild(); } catch(e){ console.warn('handle rebuild err:', e); }
  });
}

/** Quick reposition of handles for a single dragging volume — no full rebuild.
 *  Used during real-time drag for zero-flicker handle tracking. */
function _phRepositionForVol(volIdx){
  if(!P || !P.vols || !P.vols[volIdx]) return;
  var vol = P.vols[volIdx];
  if(!vol.customPolyLocal) return;
  var baseY = vol.baseElevFt > 0 ? vol.baseElevFt * 0.3048 : 0;
  var gfH   = (vol.commGF ? P.flr.gf : P.flr.typ) || 10;
  var totalH = (gfH + (Math.max(1, vol.storeys) - 1) * (P.flr.typ || 10)) * 0.3048;
  var topY = baseY + totalH;
  for(var i = 0; i < _ph.meshList.length; i++){
    var h = _ph.meshList[i];
    if(h.volIdx !== volIdx) continue;
    var p = vol.customPolyLocal[h.vertexIdx];
    if(!p) continue;
    var wx = f2m(p[0]), wz = f2m(p[1]);
    if(h.level === 'bottom') h.mesh.position.set(wx, baseY + 1.2, wz);
    else h.mesh.position.set(wx, topY + 0.3, wz);
  }
}

/** Enter 3D polygon resize mode for a given volume index */
function enterPoly3DResize(volIdx){
  exitPoly3DResize();
  if(volIdx == null || volIdx < 0 || volIdx >= P.vols.length) return false;
  var vol = P.vols[volIdx];
  if(!vol || !vol.customPolyLocal || vol.customPolyLocal.length < 3){
    return false;
  }
  _poly3D.active = true;
  _poly3D.volIdx = volIdx;
  _poly3DBuildHandles();
  return true;
}

/** Exit 3D polygon resize mode and remove handles + preview */
function exitPoly3DResize(){
  _poly3D.active = false;
  _poly3D.volIdx = -1;
  _poly3D.drag.active = false;
  _poly3D.drag.vertexIdx = -1;
  if(_poly3D.handleGroup){
    for(var i = _poly3D.handleGroup.children.length - 1; i >= 0; i--){
      var ch = _poly3D.handleGroup.children[i];
      _poly3D.handleGroup.remove(ch);
      if(ch.geometry) ch.geometry.dispose();
      if(ch.material) ch.material.dispose();
    }
    scene.remove(_poly3D.handleGroup);
    _poly3D.handleGroup = null;
  }
  _poly3D.handles = [];
  _poly3DDestroyPreview();
}

/** Toggle 3D polygon resize mode for the FIRST polygon volume (or named volume by letter) */
function togglePoly3DResize(volLetterOrIdx){
  if(_poly3D.active){
    exitPoly3DResize();
    if(typeof updatePoly3DButton === 'function') updatePoly3DButton(false);
    return;
  }
  // Find target volume: by letter, by index, or first polygon volume
  var idx = -1;
  if(typeof volLetterOrIdx === 'number'){
    idx = volLetterOrIdx;
  } else if(typeof volLetterOrIdx === 'string'){
    idx = P.vols.findIndex(function(v){ return v.name === volLetterOrIdx; });
  } else {
    // Default: prefer the TOWER (highest storeys), fallback to first polygon vol
    var maxSt = -1;
    P.vols.forEach(function(v, i){
      if(v.customPolyLocal && v.customPolyLocal.length >= 3 && v.storeys > maxSt){
        maxSt = v.storeys;
        idx = i;
      }
    });
  }
  if(idx < 0){
    console.warn('[poly3D] No polygon volume found to resize');
    return;
  }
  var ok = enterPoly3DResize(idx);
  if(typeof updatePoly3DButton === 'function') updatePoly3DButton(ok);
}

/** Update the visual state of the RESIZE TOWER button based on whether mode is active */
function updatePoly3DButton(active){
  var btn = document.getElementById('btn-poly3d-resize');
  if(btn){
    if(active){
      btn.style.background = 'rgba(174,188,70,0.85)';
      btn.style.color = '#111';
      btn.textContent = '✓ EDITING — click building to drag';
      btn.title = 'Click anywhere on the tower to grab the nearest corner. Drag to reshape. Building stays inside the lot.';
    } else {
      btn.style.background = 'rgba(26,26,26,.85)';
      btn.style.color = '#AEBC46';
      btn.textContent = '⬄ EDIT TOWER SHAPE';
      btn.title = 'Toggle edit mode — then click directly on the building to grab the nearest corner';
    }
  }
  var addBtn = document.getElementById('btn-poly3d-add-vertex');
  if(addBtn){
    addBtn.style.display = active ? '' : 'none';
  }
}

/** Update the visual state of the ADD VERTEX button */
function updatePoly3DAddVertexButton(active){
  var btn = document.getElementById('btn-poly3d-add-vertex');
  if(!btn) return;
  if(active){
    btn.style.background = 'rgba(255,255,255,0.85)';
    btn.style.color = '#111';
    btn.textContent = '✓ Click an edge midpoint';
  } else {
    btn.style.background = 'rgba(26,26,26,.85)';
    btn.style.color = '#fff';
    btn.textContent = '+ ADD DRAG POINT';
  }
}

/** Toggle the addVertex sub-mode (only callable while edit mode is active) */
function togglePoly3DAddVertex(){
  if(!_poly3D.active){
    // Auto-enter edit mode if user clicks Add Vertex without first being in edit
    togglePoly3DResize();
    if(!_poly3D.active) return;
  }
  _poly3D.addVertexMode = !_poly3D.addVertexMode;
  updatePoly3DAddVertexButton(_poly3D.addVertexMode);
  _poly3DBuildHandles(); // rebuild to show/hide midpoint handles
}

/** Apply uniform scale to the polygon, anchored at (anchorXFt, anchorZFt) */
function _poly3DApplyScale(vol, startPolyFt, anchorXFt, anchorZFt, sx, sz){
  if(!startPolyFt || !startPolyFt.length) return;
  // Clamp scales to prevent collapse / inversion
  sx = Math.max(0.15, Math.min(5.0, sx));
  sz = Math.max(0.15, Math.min(5.0, sz));
  vol.customPolyLocal = startPolyFt.map(function(p){
    return [
      anchorXFt + (p[0] - anchorXFt) * sx,
      anchorZFt + (p[1] - anchorZFt) * sz
    ];
  });
  // Recalc area
  var ax = 0;
  var pts = vol.customPolyLocal;
  for(var i = 0; i < pts.length - 1; i++){
    ax += (pts[i+1][0] - pts[i][0]) * (pts[i+1][1] + pts[i][1]);
  }
  vol.customAreaSF = Math.abs(ax / 2);
}

/** Constrain a tower's polygon to stay inside the podium polygon (if one exists) */
function _poly3DClampToPodium(vol, candidateFt){
  // Find the podium = a different polygon volume that fully contains this volume's bbox
  var podium = null;
  for(var i = 0; i < P.vols.length; i++){
    var v = P.vols[i];
    if(v === vol || v.storeys <= vol.storeys) continue;
    // Skip — the podium has FEWER storeys than the tower, not more
  }
  // Actually podium has fewer storeys. Find a vol with fewer storeys whose poly contains tower
  for(var j = 0; j < P.vols.length; j++){
    var pv = P.vols[j];
    if(pv === vol || !pv.customPolyLocal || pv.customPolyLocal.length < 3) continue;
    if(pv.storeys >= vol.storeys) continue; // podium must be shorter
    podium = pv; break;
  }
  if(!podium) return candidateFt;
  // Quick bbox check — if candidate bbox is inside podium bbox, just return as-is
  var pb = _polyBBoxFt(podium.customPolyLocal);
  var cb = _polyBBoxFt(candidateFt);
  if(!pb || !cb) return candidateFt;
  // Clamp to podium bbox (cheap approximation; turf.intersect would be more precise but heavy)
  var clampX = function(x){ return Math.max(pb.minX, Math.min(pb.maxX, x)); };
  var clampZ = function(z){ return Math.max(pb.minZ, Math.min(pb.maxZ, z)); };
  return candidateFt.map(function(p){ return [clampX(p[0]), clampZ(p[1])]; });
}

function getVolIdxFromMesh(obj){
  // Walk up to find the volGroup tagged with _volIdx
  let cur=obj;
  while(cur){
    if(cur._volIdx!==undefined) return cur._volIdx;
    cur=cur.parent;
  }
  return -1;
}

function initOrbit(el){
  el.addEventListener('mousedown',e=>{
    // ── PRIORITY 0: Polygon EDIT MODE — click directly on the building mesh ──
    // No more separate floating handles. The user clicks anywhere on the building's
    // surface (or close to its outline) and the nearest polygon vertex begins to drag.
    // If addVertexMode is on, a NEW vertex is created at the click location instead.
    if(e.button===0 && _poly3D.active){
      const vol = P.vols[_poly3D.volIdx];
      if(vol && vol.customPolyLocal && vol.customPolyLocal.length >= 3){
        const rect2 = el.getBoundingClientRect();
        _mouse.x = ((e.clientX - rect2.left) / rect2.width) * 2 - 1;
        _mouse.y = -((e.clientY - rect2.top) / rect2.height) * 2 + 1;
        _ray.setFromCamera(_mouse, camera);

        // Try to hit the building mesh directly. Fall back to the ground plane
        // (so the user can click on the polygon outline / floor as well).
        let worldHit = null;
        if(groups.building && groups.building.children.length > 0){
          const hits = _ray.intersectObjects(groups.building.children, true);
          for(let hi = 0; hi < hits.length; hi++){
            const vi = getVolIdxFromMesh(hits[hi].object);
            // Only count hits on the SAME volume we're editing
            if(vi === _poly3D.volIdx){
              worldHit = hits[hi].point.clone();
              break;
            }
          }
        }
        if(!worldHit){
          // Fallback: project ray onto the ground plane
          const gp = new THREE.Vector3();
          if(_ray.ray.intersectPlane(_drag.groundPlane, gp)) worldHit = gp;
        }
        if(!worldHit){
          // Couldn't hit anything — let orbit handle it
        } else {
          // Decide: insert a new vertex at click point, OR snap to the nearest existing one
          const wxFt = worldHit.x / 0.3048;
          const wzFt = worldHit.z / 0.3048;
          let dragVertexIdx = -1;

          if(_poly3D.addVertexMode){
            // ── INSERT NEW VERTEX at click point on the closest edge ──
            const pts = vol.customPolyLocal;
            const closed = (pts.length > 1 && pts[0][0] === pts[pts.length-1][0] && pts[0][1] === pts[pts.length-1][1]);
            const nUnique = closed ? pts.length - 1 : pts.length;
            // Find the closest edge by projecting (wxFt, wzFt) onto each segment
            let bestEdge = 0, bestT = 0.5, bestD = Infinity;
            for(let ei = 0; ei < nUnique; ei++){
              const a = pts[ei], b = pts[(ei + 1) % nUnique];
              const ax = b[0] - a[0], az = b[1] - a[1];
              const len2 = ax*ax + az*az;
              const t = len2 > 0.001 ? Math.max(0, Math.min(1, ((wxFt - a[0]) * ax + (wzFt - a[1]) * az) / len2)) : 0.5;
              const px = a[0] + ax * t, pz = a[1] + az * t;
              const d = Math.sqrt((px - wxFt)*(px - wxFt) + (pz - wzFt)*(pz - wzFt));
              if(d < bestD){ bestD = d; bestEdge = ei; bestT = t; }
            }
            const a = pts[bestEdge], b = pts[(bestEdge + 1) % nUnique];
            const newVert = [a[0] + (b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT];
            const insertAt = bestEdge + 1;
            const newPts = pts.slice();
            newPts.splice(insertAt, 0, newVert);
            vol.customPolyLocal = newPts;
            dragVertexIdx = insertAt;
            // Auto-exit addVertex mode after one insert
            _poly3D.addVertexMode = false;
            if(typeof updatePoly3DAddVertexButton === 'function') updatePoly3DAddVertexButton(false);
            rebuildAll(); // need to rebuild — polygon has new vertex
          } else {
            // ── SNAP TO NEAREST EXISTING VERTEX ──
            const nv = _poly3DNearestVertex(vol, worldHit.x, worldHit.z);
            if(!nv) return; // nothing to grab
            dragVertexIdx = nv.vertexIdx;
          }

          // Begin drag of the chosen vertex
          _poly3D.drag.active = true;
          _poly3D.drag.vertexIdx = dragVertexIdx;
          _poly3D.drag.startVertex = {
            xFt: vol.customPolyLocal[dragVertexIdx][0],
            zFt: vol.customPolyLocal[dragVertexIdx][1]
          };
          _poly3D.drag.startMouseWorld = { x: worldHit.x, z: worldHit.z };
          _poly3DBuildPreview();
          _poly3DSetMeshVisibility(_poly3D.volIdx, false);
          el.style.cursor = 'move';
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }
    // Check placement mode first
    if(e.button===0 && _placeMode.active){
      if(_handlePlaceClick(e)){e.preventDefault();e.stopPropagation();return;}
    }
    // ── PRIORITY 1: Click on a CORNER HANDLE (always-on orange spheres) ──
    if(e.button===0 && _ph.group && _ph.meshList.length > 0){
      const rectH=el.getBoundingClientRect();
      _mouse.x=((e.clientX-rectH.left)/rectH.width)*2-1;
      _mouse.y=-((e.clientY-rectH.top)/rectH.height)*2+1;
      _ray.setFromCamera(_mouse,camera);
      const handleMeshes = _ph.meshList.map(h=>h.mesh);
      const hHits = _ray.intersectObjects(handleMeshes, false);
      if(hHits.length > 0){
        // Find which handle was hit
        const hitMesh = hHits[0].object;
        const handle = _ph.meshList.find(h => h.mesh === hitMesh);
        if(handle && P.vols[handle.volIdx] && P.vols[handle.volIdx].customPolyLocal){
          const vol = P.vols[handle.volIdx];
          const v = vol.customPolyLocal[handle.vertexIdx];
          // Capture mouse position on the ground plane at drag-start
          const hpt = new THREE.Vector3();
          _ray.ray.intersectPlane(_drag.groundPlane, hpt);
          _ph.drag.active = true;
          _ph.drag.volIdx = handle.volIdx;
          _ph.drag.vertexIdx = handle.vertexIdx;
          _ph.drag.level = handle.level;
          _ph.drag.startVertex = { xFt: v[0], zFt: v[1] };
          _ph.drag.startMouseWorld = { x: hpt.x, z: hpt.z };
          el.style.cursor = 'grabbing';
          // Visual feedback: brighten the grabbed handle
          try { hitMesh.material.color.set(0xFFFFFF); } catch(e){}
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    }

    // Check if clicking on a building volume (left-click only)
    if(e.button===0 && groups.building){
      const rect=el.getBoundingClientRect();
      _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
      _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
      _ray.setFromCamera(_mouse,camera);
      const hits=_ray.intersectObjects(groups.building.children,true);
      if(hits.length>0){
        const vi=getVolIdxFromMesh(hits[0].object);
        if(vi>=0 && vi<P.vols.length && P.vols[vi]){
          const vol = P.vols[vi];
          // Get 3D hit point on ground plane for accurate mapping
          const hitPt=new THREE.Vector3();
          _ray.ray.intersectPlane(_drag.groundPlane,hitPt);

          // ── POLYGON VOLUME — face clicks do nothing (corner handles are the grabbers). ──
          if(vol.customPolyLocal && vol.customPolyLocal.length >= 3){
            // Fall through to orbit — user can rotate camera by dragging from face.
          } else {
            // ── RECTANGULAR VOLUME — original behaviour (whole-building drag) ──
            _drag.active=true;
            _drag.volIdx=vi;
            _drag.mode='rect';
            _drag.startPos={startEg:vol.startEg||0, offEast:vol.offEast||0};
            _drag.startWorld={x:hitPt.x,z:hitPt.z};
            el.style.cursor='move';
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }
    }
    orb.dragging=true;orb.btn=e.button;orb.px=e.clientX;orb.py=e.clientY;e.preventDefault();
  });

  window.addEventListener('mousemove',e=>{
    // ── PRIORITY -1: ALWAYS-ON HANDLE DRAG — fast path, building-only rebuild ──
    if(_ph.drag.active){
      try{
        const rectH = el.getBoundingClientRect();
        _mouse.x = ((e.clientX - rectH.left) / rectH.width) * 2 - 1;
        _mouse.y = -((e.clientY - rectH.top) / rectH.height) * 2 + 1;
        _ray.setFromCamera(_mouse, camera);
        const hpt = new THREE.Vector3();
        if(_ray.ray.intersectPlane(_drag.groundPlane, hpt)){
          // Vertex moves by EXACTLY the same delta as the cursor (in feet)
          const dxFt = (hpt.x - _ph.drag.startMouseWorld.x) / 0.3048;
          const dzFt = (hpt.z - _ph.drag.startMouseWorld.z) / 0.3048;
          const newX = _ph.drag.startVertex.xFt + dxFt;
          const newZ = _ph.drag.startVertex.zFt + dzFt;
          // Clamp to lot perimeter so building can't escape the parcel
          const clamped = (typeof _poly3DClampToLot === 'function')
            ? _poly3DClampToLot(newX, newZ) : [newX, newZ];
          const vol = P.vols[_ph.drag.volIdx];
          if(!vol || !vol.customPolyLocal){ _ph.drag.active = false; return; }
          const pts = vol.customPolyLocal;
          const startClosed = pts.length > 1 && pts[0][0] === pts[pts.length-1][0] && pts[0][1] === pts[pts.length-1][1];
          // Apply ONLY to the dragged vertex
          pts[_ph.drag.vertexIdx] = [clamped[0], clamped[1]];
          // Keep the closing vertex in sync if we moved index 0
          if(_ph.drag.vertexIdx === 0 && startClosed){
            pts[pts.length - 1] = [clamped[0], clamped[1]];
          }
          // Update area cache
          let area = 0;
          for(let ai = 0; ai < pts.length - 1; ai++){
            area += (pts[ai+1][0] - pts[ai][0]) * (pts[ai+1][1] + pts[ai][1]);
          }
          vol.customAreaSF = Math.abs(area / 2);

          // Reposition this vertex's handles INSTANTLY (zero-latency feedback)
          _phRepositionForVol(_ph.drag.volIdx);

          // FAST mesh rebuild — only the building geometry, NOT proforma/report/autosave.
          // Throttled by requestAnimationFrame so we never queue more than one rebuild
          // per render frame (typically 60 Hz). This is the key to "no latency".
          if(!_dragRebuildTimer){
            _dragRebuildTimer = requestAnimationFrame(() => {
              _dragRebuildTimer = null;
              try {
                if(typeof rebuildBuilding === 'function') rebuildBuilding();
              } catch(err){ console.warn('fast rebuild err:', err); }
            });
          }
        }
      }catch(err){ _ph.drag.active = false; console.warn('handle drag err:', err); }
      return;
    }

    // ── PRIORITY 0: Polygon vertex drag (3D) — REAL-TIME wireframe preview, no full rebuild ──
    if(_poly3D.drag.active){
      try{
        const rect=el.getBoundingClientRect();
        _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
        _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
        _ray.setFromCamera(_mouse,camera);
        const hitPt=new THREE.Vector3();
        if(_ray.ray.intersectPlane(_drag.groundPlane,hitPt)){
          const vol=P.vols[_poly3D.volIdx];
          if(!vol || !vol.customPolyLocal){ _poly3D.drag.active=false; return; }
          // Mouse delta → feet (Z is NOT negated; _ftToWorld now uses positive Z)
          const dxWorldM = hitPt.x - _poly3D.drag.startMouseWorld.x;
          const dzWorldM = hitPt.z - _poly3D.drag.startMouseWorld.z;
          const dxFt = dxWorldM / 0.3048;
          const dzFt = dzWorldM / 0.3048;
          const rawXFt = _poly3D.drag.startVertex.xFt + dxFt;
          const rawZFt = _poly3D.drag.startVertex.zFt + dzFt;
          // Constrain inside the lot polygon — never let the building leak past lot lines
          const clamped = _poly3DClampToLot(rawXFt, rawZFt);
          const newXFt = clamped[0];
          const newZFt = clamped[1];
          const vIdx = _poly3D.drag.vertexIdx;
          if(vIdx >= 0 && vIdx < vol.customPolyLocal.length){
            vol.customPolyLocal[vIdx] = [newXFt, newZFt];
            // Keep ring closed if dragging vertex 0
            const pts = vol.customPolyLocal;
            const closed = pts.length > 1 && pts[0][0] === _poly3D.drag.startVertex.xFt && pts[pts.length-1][0] === _poly3D.drag.startVertex.xFt;
            if(vIdx === 0 && closed){ pts[pts.length-1] = [newXFt, newZFt]; }
            // Recalc area (cheap)
            let ax = 0;
            for(let i = 0; i < pts.length - 1; i++){
              ax += (pts[i+1][0] - pts[i][0]) * (pts[i+1][1] + pts[i][1]);
            }
            vol.customAreaSF = Math.abs(ax / 2);
            // ── REAL-TIME UPDATE — only the wireframe + handle for this vertex ──
            // No rebuildAll. Wireframe rebuild is ~3*nVerts line segments — sub-millisecond.
            _poly3DBuildPreview();
            // Move just the dragged handle's column (bottom + mid + top) so the user
            // sees the handle follow their cursor without flicker.
            const wPos = _ftToWorld(newXFt, newZFt);
            for(let hi = 0; hi < _poly3D.handles.length; hi++){
              const h = _poly3D.handles[hi];
              if(h.vertexIdx === vIdx && h.mesh){
                h.mesh.position.x = wPos.x;
                h.mesh.position.z = wPos.z;
              }
            }
          }
        }
      }catch(err){ _poly3D.drag.active=false; console.warn('Poly3D vertex drag error:',err); }
      return;
    }
    // Volume drag mode (works for both rectangular and polygon volumes)
    if(_drag.active && _drag.volIdx>=0){
      try{
        const vol=P.vols[_drag.volIdx];
        if(!vol || _drag.volIdx>=P.vols.length){ _drag.active=false; return; }
        const rect=el.getBoundingClientRect();
        _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
        _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
        _ray.setFromCamera(_mouse,camera);
        const hitPt=new THREE.Vector3();
        if(_ray.ray.intersectPlane(_drag.groundPlane,hitPt)){
          const dxWorld=hitPt.x-_drag.startWorld.x;
          const dzWorld=hitPt.z-_drag.startWorld.z;
          // ── POLYGON VOLUME — pure corner drag. ONLY the grabbed corner moves. ──
          if(_drag.startPoly && vol.customPolyLocal && _drag.mode === 'corner' && _drag.cornerVertexIdx >= 0){
            const startClosed = _drag.startPoly.length > 1 &&
              _drag.startPoly[0][0] === _drag.startPoly[_drag.startPoly.length-1][0] &&
              _drag.startPoly[0][1] === _drag.startPoly[_drag.startPoly.length-1][1];
            const ftMouseX = hitPt.x / 0.3048;
            const ftMouseZ = hitPt.z / 0.3048;
            // Corner = cursor + (corner - clickPoint) → corner moves by the same delta as cursor
            const newX = ftMouseX + (_drag.grabOffsetX || 0);
            const newZ = ftMouseZ + (_drag.grabOffsetZ || 0);
            const clamped = (typeof _poly3DClampToLot === 'function')
              ? _poly3DClampToLot(newX, newZ) : [newX, newZ];
            const newPoly = _drag.startPoly.map(p => [p[0], p[1]]);
            newPoly[_drag.cornerVertexIdx] = [clamped[0], clamped[1]];
            if(_drag.cornerVertexIdx === 0 && startClosed){
              newPoly[newPoly.length - 1] = [clamped[0], clamped[1]];
            }
            vol.customPolyLocal = newPoly;
            // Recalculate area (cheap)
            let area = 0;
            const pts = vol.customPolyLocal;
            for(let i = 0; i < pts.length - 1; i++){
              area += (pts[i+1][0] - pts[i][0]) * (pts[i+1][1] + pts[i][1]);
            }
            vol.customAreaSF = Math.abs(area / 2);
            // ── REAL-TIME mesh rebuild — throttled with requestAnimationFrame ──
            // No wireframe stand-in. The user sees the actual building update live.
            // requestAnimationFrame lets the browser pace the updates to its render rate
            // (typically 60Hz) and skip frames if we can't keep up — much smoother
            // than setTimeout debouncing.
            if(!_dragRebuildTimer){
              _dragRebuildTimer = requestAnimationFrame(() => {
                _dragRebuildTimer = null;
                try { rebuildAll(); } catch(e){ console.warn('drag rebuild err:', e); }
              });
            }
            return;
          }
          // ── RECTANGULAR VOLUME — original behaviour ──
          const maxZ=lotBounds().maxZ;
          const dxFt=Math.round(dxWorld/FT);
          const dzFt=Math.round(dzWorld/FT);
          vol.startEg=Math.max(0,Math.min(maxZ-vol.depth,_drag.startPos.startEg+dzFt));
          vol.offEast=Math.max(-50,Math.min(150,_drag.startPos.offEast-dxFt));
          if(!_dragRebuildTimer){
            _dragRebuildTimer=setTimeout(()=>{_dragRebuildTimer=null;rebuildAll();},60);
          }
        }
      }catch(err){ _drag.active=false; console.warn('Drag error:',err); }
      return;
    }
    // Normal orbit
    if(!orb.dragging)return;
    const dx=e.clientX-orb.px, dy=e.clientY-orb.py;
    orb.px=e.clientX;orb.py=e.clientY;
    if(orb.btn===0){orb.theta-=dx*0.005;orb.phi=Math.max(0.1,Math.min(Math.PI/2-0.01,orb.phi-dy*0.005))}
    if(orb.btn===2){
      const right=new THREE.Vector3(-Math.cos(orb.theta),0,Math.sin(orb.theta));
      const up=new THREE.Vector3(0,1,0);
      orb.target.addScaledVector(right,dx*0.05);
      orb.target.addScaledVector(up,dy*0.05);
    }
    updateCam();
  });

  window.addEventListener('mouseup',()=>{
    // ── Release a corner-handle drag — full rebuild now (proforma, report, save) ──
    if(_ph.drag.active){
      _ph.drag.active = false;
      _ph.drag.volIdx = -1;
      _ph.drag.vertexIdx = -1;
      el.style.cursor = '';
      if(_dragRebuildTimer){
        try { cancelAnimationFrame(_dragRebuildTimer); } catch(e) { try { clearTimeout(_dragRebuildTimer); } catch(e2) {} }
        _dragRebuildTimer = null;
      }
      // Full rebuild: updates proforma, report, saves to localStorage, refreshes section view
      try { rebuildAll(); } catch(e) { console.warn('handle release rebuild err:', e); }
      try { if(typeof buildVolPanel === 'function') buildVolPanel(); } catch(e) {}
      try { if(typeof autoSave === 'function') autoSave(); } catch(e) {}
      return;
    }

    if(_poly3D.drag.active){
      _poly3D.drag.active=false;
      _poly3D.drag.vertexIdx=-1;
      el.style.cursor='';
      // Heavy operations only happen ONCE on release (not during drag)
      try {
        rebuildAll();           // build the real mesh from new polygon
        _poly3DDestroyPreview(); // hide wireframe now that real mesh is up
        _poly3DBuildHandles();  // re-snap handles to exact vertex positions
        buildVolPanel();
      } catch(e) { console.warn('poly3D mouseup err:', e); }
      try { if(typeof autoSave==='function') autoSave(); } catch(e) {}
    }
    if(_drag.active){
      _drag.active=false;
      _drag.volIdx=-1;
      _drag.startPoly=null;
      _drag.cornerVertexIdx=-1;
      _drag.edgeIdx=-1;
      _drag.edgeNormal=null;
      _drag.grabOffsetX=0;
      _drag.grabOffsetZ=0;
      _drag.mode=null;
      el.style.cursor='';
      // Cancel any pending requestAnimationFrame; do one final synchronous rebuild
      if(_dragRebuildTimer){
        try { cancelAnimationFrame(_dragRebuildTimer); } catch(e) { try { clearTimeout(_dragRebuildTimer); } catch(e2) {} }
        _dragRebuildTimer = null;
      }
      try { rebuildAll(); } catch(e) { console.warn('drag mouseup rebuild err:', e); }
      buildVolPanel();
      try { if(typeof autoSave==='function') autoSave(); } catch(e) {}
    }
    orb.dragging=false;
  });

  // Hover: change cursor when over a volume
  el.addEventListener('mousemove',e=>{
    if(_drag.active||orb.dragging||_ph.drag.active)return;
    // ── Hover over an orange corner handle → grab cursor + brighten ──
    if(_ph.group && _ph.meshList.length > 0){
      const rectX = el.getBoundingClientRect();
      _mouse.x = ((e.clientX - rectX.left) / rectX.width) * 2 - 1;
      _mouse.y = -((e.clientY - rectX.top) / rectX.height) * 2 + 1;
      _ray.setFromCamera(_mouse, camera);
      const hMeshes = _ph.meshList.map(h=>h.mesh);
      const hh = _ray.intersectObjects(hMeshes, false);
      // Clear previous hover highlight (restore each handle's per-volume base color)
      if(_ph.hoverMeshUuid){
        const prev = _ph.meshList.find(m => m.mesh.uuid === _ph.hoverMeshUuid);
        if(prev){
          try { prev.mesh.material.color.setHex(prev.baseColor); } catch(e){}
        }
        _ph.hoverMeshUuid = null;
      }
      if(hh.length > 0){
        try { hh[0].object.material.color.set(0xFFFFFF); } catch(e){}
        _ph.hoverMeshUuid = hh[0].object.uuid;
        el.style.cursor = 'grab';
        return;
      }
    }
    const rect=el.getBoundingClientRect();
    _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
    _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
    _ray.setFromCamera(_mouse,camera);
    if(groups.building){
      const hits=_ray.intersectObjects(groups.building.children,true);
      if(hits.length>0){
        const vi = getVolIdxFromMesh(hits[0].object);
        if(vi >= 0){
          // For polygon volumes, check if hovering near a corner — show crosshair to indicate corner-grab
          const vol = P.vols[vi];
          if(vol && vol.customPolyLocal && vol.customPolyLocal.length >= 3){
            // Anywhere on a polygon volume is grabbable — every click reshapes.
            el.style.cursor = e.shiftKey ? 'move' : 'grab';
            return;
          }
          el.style.cursor='move';
        } else {
          el.style.cursor='';
        }
      } else {
        el.style.cursor='';
      }
    }
  });

  el.addEventListener('wheel',e=>{orb.dist=Math.max(10,Math.min(200,orb.dist+e.deltaY*0.05));updateCam();e.preventDefault()},{passive:false});
  el.addEventListener('contextmenu',e=>e.preventDefault());
  // Escape cancels placement mode
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&_placeMode.active)_cancelPlace();});
}
function updateCam(){
  const x=orb.target.x+orb.dist*Math.sin(orb.theta)*Math.cos(orb.phi);
  const y=orb.target.y+orb.dist*Math.sin(orb.phi);
  const z=orb.target.z+orb.dist*Math.cos(orb.theta)*Math.cos(orb.phi);
  camera.position.set(x,y,z);
  camera.lookAt(orb.target);
}

function onResize(){
  const wrap=document.getElementById('canvas-wrap');
  var w=wrap.clientWidth, h=wrap.clientHeight;
  // Guard: skip resize if element has zero dimensions (hidden or mid-reflow)
  if(w < 1 || h < 1) return;
  camera.aspect=w/h;
  camera.updateProjectionMatrix();
  renderer.setSize(w,h);
}

/**
 * Sets camera position to a named view preset.
 * @param {string} v - View name: 'perspective'|'front'|'rear'|'aerial'|'bird'
 */
function setView(v){
  const vts=lotVerts();
  // Find center of lot in metres
  let cx=0,cz=0;
  vts.forEach(p=>{cx+=f2m(p[0]);cz+=f2m(p[1])});
  cx/=vts.length;cz/=vts.length;

  // Calculate building extents for dynamic camera framing
  var maxH=0,maxW=0,maxD=0;
  P.vols.forEach(function(vol){
    var s=vol.storeys||1;
    var hFt=(P.gfHt||14)+(s-1)*(P.floorHt||10);
    var hM=hFt*0.3048;
    if(hM>maxH) maxH=hM;
    var wM=f2m(vol.w||60);
    var dM=f2m(vol.d||40);
    if(wM>maxW) maxW=wM;
    if(dM>maxD) maxD=dM;
  });
  var bldgSpan=Math.max(maxH,maxW,maxD,20);
  var baseDist=bldgSpan*2.8;
  var targetY=maxH*0.4;

  orb.target.set(cx,targetY,cz);

  switch(v){
    case 'perspective': orb.theta=Math.PI*0.75;orb.phi=0.55;orb.dist=baseDist;break;
    case 'front': orb.theta=Math.PI;orb.phi=0.35;orb.dist=baseDist*0.9;break;
    case 'rear': orb.theta=0;orb.phi=0.35;orb.dist=baseDist*0.9;break;
    case 'aerial': orb.theta=Math.PI*0.5;orb.phi=1.3;orb.dist=baseDist*1.1;break;
    case 'bird': orb.theta=Math.PI*0.65;orb.phi=0.7;orb.dist=baseDist*1.1;break;
  }
  updateCam();
}

// ═══════════════════════════════════════════════════════════
//  SCENE BUILDERS
// ═══════════════════════════════════════════════════════════

/**
 * Recursively disposes a Three.js object and all its children, freeing geometry and materials.
 * @param {THREE.Object3D} obj - The object to dispose
 */
// All texture slots a Three.js material may hold. Disposing only `.map` (the old
// implementation) leaks normal/roughness/emissive/etc. textures, accumulating GPU memory.
const _MAT_TEX_SLOTS = ['map','normalMap','roughnessMap','metalnessMap','emissiveMap',
  'alphaMap','envMap','aoMap','bumpMap','displacementMap','lightMap','specularMap',
  'gradientMap','clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','sheenColorMap',
  'sheenRoughnessMap','transmissionMap','thicknessMap','iridescenceMap','iridescenceThicknessMap'];
function _disposeMaterial(mat){
  if(!mat) return;
  for(let i = 0; i < _MAT_TEX_SLOTS.length; i++){
    const slot = _MAT_TEX_SLOTS[i];
    if(mat[slot] && typeof mat[slot].dispose === 'function'){
      try { mat[slot].dispose(); } catch(e) {}
      mat[slot] = null;
    }
  }
  try { mat.dispose(); } catch(e) {}
}
function disposeObject(obj){
  if(!obj)return;
  if(obj.children){
    for(let i=obj.children.length-1;i>=0;i--) disposeObject(obj.children[i]);
  }
  if(obj.geometry){
    try { obj.geometry.dispose(); } catch(e) {}
  }
  if(obj.material){
    if(Array.isArray(obj.material)) obj.material.forEach(_disposeMaterial);
    else _disposeMaterial(obj.material);
  }
}
/**
 * Clears and recreates a named scene group (lot, building, labels, env, setbacks).
 * @param {string} name - Group key from the `groups` object
 */
function clearGroup(name){
  if(groups[name]){
    disposeObject(groups[name]);
    scene.remove(groups[name]);
  }
  groups[name]=new THREE.Group();
  scene.add(groups[name]);
}

