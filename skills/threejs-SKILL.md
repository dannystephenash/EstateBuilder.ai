---
name: threejs-r128
description: >
  Expert system for Three.js r128 3D rendering in EstateBuilder.ai. Use this skill whenever
  creating, modifying, or debugging Three.js scenes, materials, lighting, geometry, shadows,
  or camera controls. Trigger on: "3D", "Three.js", "massing", "render", "scene", "material",
  "lighting", "shadow", "glass", "building render", "curtain wall", "glazing", "viewport",
  "camera", "orbit controls", or any reference to the 3D preview in EstateBuilder.ai.
  CRITICAL: This project is pinned to Three.js r128 via CDN — never use APIs introduced
  after r128. Always use this skill before writing any Three.js code.
---

# Three.js r128 — EstateBuilder.ai Massing Renderer

## VERSION CONSTRAINT — READ FIRST

This project uses **Three.js r128** loaded via CDN:
```
https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
```

### NEVER USE (introduced after r128):
- `transmission`, `ior`, `thickness` on MeshPhysicalMaterial (r138+)
- `outputColorSpace` (r152+) — use `renderer.outputEncoding = THREE.sRGBEncoding` instead
- `THREE.SRGBColorSpace` — use `THREE.sRGBEncoding`
- `THREE.CapsuleGeometry` (r142+)
- `PMREMGenerator.fromScene()` for environment maps (unreliable in r128)
- `Object.assign()` on any Three.js object — `position`, `rotation`, `scale` are **readonly getters** in r128. Always use `.set()` or `.copy()`
- `RectAreaLight` without importing the helper (not bundled in r128 CDN build)
- `THREE.WebGLRenderer({ outputColorSpace })` constructor option

### SAFE TO USE in r128:
- `MeshPhysicalMaterial` with: `clearcoat`, `clearcoatRoughness`, `reflectivity`, `transparent`, `opacity`
- `MeshStandardMaterial` with all standard properties: `color`, `roughness`, `metalness`, `emissive`, `emissiveIntensity`, `envMapIntensity`
- `renderer.toneMapping = THREE.ACESFilmicToneMapping`
- `renderer.toneMappingExposure`
- `PCFSoftShadowMap`, `PCFShadowMap`, `BasicShadowMap`
- All basic geometries: `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `PlaneGeometry`, `ShapeGeometry`, `ExtrudeGeometry`, `BufferGeometry`
- `THREE.ShaderMaterial` with custom vertex/fragment shaders
- `THREE.Fog`, `THREE.FogExp2`
- `THREE.PointLight`, `THREE.DirectionalLight`, `THREE.AmbientLight`, `THREE.HemisphereLight`, `THREE.SpotLight`
- `THREE.Line`, `THREE.LineBasicMaterial`, `THREE.LineDashedMaterial`
- `THREE.Raycaster` for mouse picking
- `THREE.Group` for scene hierarchy

### r128-Safe Object Creation Pattern

```javascript
// ✅ CORRECT — use a helper function with position.set()
function mk(geo, mat, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// ❌ WRONG — Object.assign on Three.js objects
const m = Object.assign(new THREE.Mesh(geo, mat), { position: new THREE.Vector3(x, y, z) });

// ❌ WRONG — setting position directly via constructor-like syntax
const light = new THREE.DirectionalLight(0xffffff, 1);
Object.assign(light, { position: { x: 10, y: 20, z: 30 } }); // CRASHES

// ✅ CORRECT
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(10, 20, 30);
```

---

## Scene Setup — Recommended Defaults

```javascript
// Renderer
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// Scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1A1A1A);
scene.fog = new THREE.FogExp2(0x1A1A1A, 0.0008);

// Camera
const camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 2000);
camera.position.set(280, 200, 320);
camera.lookAt(0, 80, 0);
```

---

## Lighting — Architectural Rendering

Four-light rig for realistic architectural visualization:

```javascript
// 1. Ambient fill — low intensity, cool tone
scene.add(new THREE.AmbientLight(0x334455, 0.3));

// 2. Hemisphere — sky/ground bounce
scene.add(new THREE.HemisphereLight(0x7799bb, 0x342a20, 0.4));

// 3. Key light (sun) — warm, cast shadows
const sun = new THREE.DirectionalLight(0xffd4a0, 2.0);
sun.position.set(-180, 160, -100);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); // 4096 for high quality
sun.shadow.camera.left = -250;
sun.shadow.camera.right = 250;
sun.shadow.camera.top = 300;
sun.shadow.camera.bottom = -100;
sun.shadow.camera.near = 40;
sun.shadow.camera.far = 800;
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.015;
scene.add(sun);

// 4. Fill light — opposite side, lower intensity
const fill = new THREE.DirectionalLight(0xffeedd, 0.25);
fill.position.set(140, 60, 180);
scene.add(fill);

// Optional 5. Rim/back light — cool, adds depth
const back = new THREE.DirectionalLight(0x7788bb, 0.4);
back.position.set(60, 180, -180);
scene.add(back);
```

### Shadow Study Lighting
For shadow studies, replace the key light with computed solar position:
```javascript
// Sun position from altitude & azimuth (computed from lat/lng/date/time)
const altitude = sunAltitudeDegrees * Math.PI / 180;
const azimuth = sunAzimuthDegrees * Math.PI / 180;
const sunDist = 300;
sun.position.set(
  sunDist * Math.cos(altitude) * Math.sin(azimuth),
  sunDist * Math.sin(altitude),
  sunDist * Math.cos(altitude) * Math.cos(azimuth)
);
```

---

## Materials — Architectural Palette

### Concrete Variants
```javascript
const concreteSmooth = new THREE.MeshStandardMaterial({
  color: 0xd8d2c8, roughness: 0.6, metalness: 0.03
});
const concreteBoardForm = new THREE.MeshStandardMaterial({
  color: 0xccc5b8, roughness: 0.9, metalness: 0.01
});
const concreteDark = new THREE.MeshStandardMaterial({
  color: 0x78746c, roughness: 0.75, metalness: 0.04
});
```

### Brick
```javascript
const brick = new THREE.MeshStandardMaterial({
  color: 0x8b5e4b, roughness: 0.92, metalness: 0.01
});
```

### Steel / Metal
```javascript
const steel = new THREE.MeshStandardMaterial({
  color: 0x6a6a72, roughness: 0.28, metalness: 0.8
});
const steelDark = new THREE.MeshStandardMaterial({
  color: 0x2e2e34, roughness: 0.2, metalness: 0.85
});
const cortenSteel = new THREE.MeshStandardMaterial({
  color: 0x8b4a2a, roughness: 0.7, metalness: 0.4
});
```

### Wood
```javascript
const wood = new THREE.MeshStandardMaterial({
  color: 0x9a7a55, roughness: 0.75, metalness: 0.02
});
const cedar = new THREE.MeshStandardMaterial({
  color: 0xb08858, roughness: 0.7, metalness: 0.01
});
const woodDark = new THREE.MeshStandardMaterial({
  color: 0x5a4030, roughness: 0.8, metalness: 0.02
});
```

### Glass (r128-compatible — NO transmission/ior)
```javascript
// Standard curtain wall glass
const glass = new THREE.MeshPhysicalMaterial({
  color: 0x8ab8d0,
  roughness: 0.05,
  metalness: 0.3,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02,
  transparent: true,
  opacity: 0.55,
});

// Darker upper-tower glass
const glassDark = new THREE.MeshPhysicalMaterial({
  color: 0x3a5a6a,
  roughness: 0.08,
  metalness: 0.35,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  transparent: true,
  opacity: 0.65,
});

// Storefront glass (more transparent)
const glassStorefront = new THREE.MeshPhysicalMaterial({
  color: 0x90b8c8,
  roughness: 0.02,
  metalness: 0.2,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.45,
});

// Balcony glass railing
const glassRailing = new THREE.MeshPhysicalMaterial({
  color: 0xc0dde8,
  roughness: 0.01,
  metalness: 0.1,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
});
```

### Interior / Emissive
```javascript
const warmGlow = new THREE.MeshStandardMaterial({
  color: 0xffe0a0,
  emissive: 0xffe0a0,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
});
```

---

## Building Components — Geometry Patterns

### Curtain Wall Unit (per bay, per floor)
A realistic curtain wall bay consists of:
1. **Spandrel panel** (opaque, at sill height) — BoxGeometry
2. **Vision glass** (transparent) — PlaneGeometry
3. **Vertical mullion** (steel) — BoxGeometry, thin
4. **Horizontal transom** (steel) — BoxGeometry, thin

```javascript
function addCurtainWallBay(parent, x, y, z, bayWidth, floorHeight, face, glassMat) {
  const spandrelMat = concreteDark; // or alternating materials
  
  // Spandrel (bottom 2.5 ft of each floor)
  const sp = mk(new THREE.BoxGeometry(bayWidth - 0.8, 2.5, 0.4), spandrelMat, x, y + 1.25, z);
  parent.add(sp);
  
  // Vision glass
  const gl = mk(new THREE.PlaneGeometry(bayWidth - 1.2, floorHeight - 3.2), glassMat, x, y + floorHeight/2 + 0.5, z + 0.1);
  parent.add(gl);
  
  // Vertical mullion (left edge of bay)
  const vm = mk(new THREE.BoxGeometry(0.35, floorHeight, 0.4), steelDark, x - bayWidth/2 + 0.2, y + floorHeight/2, z + 0.2);
  parent.add(vm);
  
  // Horizontal transom (top of floor)
  const hm = mk(new THREE.BoxGeometry(bayWidth - 0.4, 0.25, 0.35), steelDark, x, y + floorHeight, z + 0.2);
  parent.add(hm);
}
// Rotate/offset for back, left, right faces
```

### Balcony
```javascript
function addBalcony(parent, x, y, z, width) {
  // Concrete slab
  parent.add(mk(new THREE.BoxGeometry(width, 0.5, 4.5), concreteSmooth, x, y + 0.25, z + 2.25));
  // Glass railing
  parent.add(mk(new THREE.BoxGeometry(width - 0.5, 3, 0.25), glassRailing, x, y + 1.8, z + 4.2));
  // Steel cap rail
  parent.add(mk(new THREE.BoxGeometry(width + 0.2, 0.2, 0.4), steelDark, x, y + 3.3, z + 4.2));
}
```

### Interior Room (visible through glass)
```javascript
function addInteriorRoom(parent, x, y, z, width, height, depth, isLit) {
  // Back wall
  parent.add(mk(new THREE.PlaneGeometry(width - 1, height - 2), interiorWall, x, y + height/2, z - depth));
  // Floor (hardwood)
  const fl = mk(new THREE.PlaneGeometry(width - 1, depth * 2), interiorFloor, x, y + 0.1, z - depth/2);
  fl.rotation.x = -Math.PI / 2;
  parent.add(fl);
  
  if (isLit) {
    // Randomly place furniture: sofa, desk+chair, or bed
    // Add ceiling lamp with emissive material
    // Add warm glow plane behind glass
  }
}
```

### Steel I-Beam Column
```javascript
function addSteelColumn(parent, x, y, height, z) {
  // Flange 1
  parent.add(mk(new THREE.BoxGeometry(1.2, height, 0.3), steel, x, y + height/2, z));
  // Web
  parent.add(mk(new THREE.BoxGeometry(0.3, height, 1.0), steel, x, y + height/2, z + 0.3));
  // Flange 2
  parent.add(mk(new THREE.BoxGeometry(1.2, height, 0.3), steel, x, y + height/2, z + 0.6));
}
```

### Wood Cladding Panel with Slats
```javascript
function addWoodCladding(parent, x, y, z, width, height) {
  parent.add(mk(new THREE.BoxGeometry(width, height, 0.6), cedar, x, y + height/2, z));
  // Horizontal slat lines for texture
  const slatCount = Math.floor(height / 1.2);
  for (let s = 0; s < slatCount; s++) {
    parent.add(mk(new THREE.BoxGeometry(width - 0.5, 0.15, 0.1), woodDark, x, y + 1 + s * (height / slatCount), z + 0.35));
  }
}
```

---

## Orbit Controls — Manual Implementation

EstateBuilder uses manual orbit controls (no OrbitControls import needed):

```javascript
const orb = { theta: -Math.PI/6, phi: Math.PI/4, dist: 400, tx: 0, ty: 70, tz: 0, dragging: false, px: 0, py: 0, btn: -1 };

function updateCamera() {
  camera.position.set(
    orb.tx + orb.dist * Math.sin(orb.theta) * Math.cos(orb.phi),
    orb.ty + orb.dist * Math.sin(orb.phi),
    orb.tz + orb.dist * Math.cos(orb.theta) * Math.cos(orb.phi)
  );
  camera.lookAt(orb.tx, orb.ty, orb.tz);
}

canvas.addEventListener('mousedown', e => { orb.dragging = true; orb.px = e.clientX; orb.py = e.clientY; orb.btn = e.button; });
window.addEventListener('mouseup', () => { orb.dragging = false; });
window.addEventListener('mousemove', e => {
  if (!orb.dragging) return;
  const dx = e.clientX - orb.px, dy = e.clientY - orb.py;
  orb.px = e.clientX; orb.py = e.clientY;
  if (orb.btn === 0) { // Left drag = orbit
    orb.theta -= dx * 0.005;
    orb.phi = Math.max(0.05, Math.min(Math.PI / 2.1, orb.phi + dy * 0.005));
  } else { // Right drag = pan
    orb.tx -= dx * 0.5;
    orb.ty += dy * 0.5;
  }
  updateCamera();
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  orb.dist = Math.max(50, Math.min(800, orb.dist + e.deltaY * 0.5));
  updateCamera();
}, { passive: false });
```

---

## Performance Guidelines

- **Reuse geometries** — create BoxGeometry once per unique size, share across meshes
- **Reuse materials** — define material library once, reference by name
- **Limit shadow casters** — only main building volumes and ground need shadows
- **Use Groups** — `THREE.Group` for logical building components (podium, tower, etc.)
- **Frustum culling** — enabled by default, ensure bounding boxes are correct
- **Draw call budget** — keep under 500 draw calls for smooth 60fps
- **Dispose on cleanup** — call `renderer.dispose()`, `geometry.dispose()`, `material.dispose()` when removing objects

---

## EstateBuilder-Specific Conventions

- **Units**: All geometry in feet (matching the `FT = 0.3048` constant in the app)
- **Coordinate system**: X+ = East, Z+ = South, Y+ = Up. Origin = NW corner of lot
- **Lot geometry**: Generated from `lotVerts()` function as 2D polygon in XZ plane
- **Building volumes**: Stored in `P.vols[]` array with position, dimensions, floors, use type
- **Color coding by use**: Ground commercial = warm gold, Amenity = teal, Residential = blue-grey, Core = dark steel
- **Ground plane**: Receives shadows, dark material, placed at Y = -0.1
