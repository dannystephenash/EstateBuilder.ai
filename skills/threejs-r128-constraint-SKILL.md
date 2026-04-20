---
name: threejs-r128-constraint
description: >
  CRITICAL version constraint for Three.js r128 in EstateBuilder.ai. This skill MUST be
  read before ANY of the other Three.js skills (threejs-fundamentals, threejs-materials,
  threejs-geometry, threejs-lighting, threejs-shaders, threejs-textures, threejs-postprocessing,
  threejs-animation, threejs-loaders, threejs-interaction, 3d-buildings). It overrides any
  API references in those skills that are incompatible with r128. Trigger on: ANY Three.js
  code generation, "3D", "render", "massing", "scene", "material", "glass", "building",
  "viewport", "camera", "shadow", "lighting", "curtain wall", "glazing", "balcony", "mullion".
  Always load this skill FIRST, then load the relevant Three.js topic skill second.
---

# Three.js r128 Version Constraint — EstateBuilder.ai

**This file overrides all other Three.js skills. Read this FIRST.**

## CDN Source

```
https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js
```

No npm. No imports. No modules. It is a global `THREE` object loaded via script tag in a single HTML file.

---

## BANNED APIs — Will crash the application

| API | Introduced | What to use instead |
|-----|-----------|-------------------|
| `transmission` on MeshPhysicalMaterial | r138 | `transparent: true, opacity: 0.5` |
| `ior` on MeshPhysicalMaterial | r138 | omit entirely |
| `thickness` on MeshPhysicalMaterial | r138 | omit entirely |
| `specularIntensity` on MeshPhysicalMaterial | r136 | omit entirely |
| `specularColor` on MeshPhysicalMaterial | r136 | omit entirely |
| `outputColorSpace` on WebGLRenderer | r152 | `renderer.outputEncoding = THREE.sRGBEncoding` |
| `THREE.SRGBColorSpace` | r152 | `THREE.sRGBEncoding` |
| `THREE.LinearSRGBColorSpace` | r152 | `THREE.LinearEncoding` |
| `THREE.CapsuleGeometry` | r142 | `CylinderGeometry` + `SphereGeometry` |
| `PMREMGenerator.fromScene()` | unreliable in r128 | omit environment maps or use simpler approach |
| `Object.assign()` on any THREE object | r128 bug | `position.set()`, `rotation.set()`, `scale.set()` |
| `material.envMapIntensity` without envMap set | r128 | only set if you have an actual envMap assigned |
| `RectAreaLight` (without helper import) | not in CDN build | use `SpotLight` or `PointLight` instead |
| `texture.colorSpace` | r152 | `texture.encoding = THREE.sRGBEncoding` |

## The Object.assign Bug — MOST COMMON CRASH

In r128, `position`, `rotation`, and `scale` are **readonly getters** that return `Vector3`/`Euler` objects. You cannot assign to them.

```javascript
// ❌ CRASHES — "Attempted to assign to readonly property"
Object.assign(mesh, { position: new THREE.Vector3(10, 20, 30) });
const light = Object.assign(new THREE.DirectionalLight(0xffffff, 1), { position: { x: 10 } });

// ❌ ALSO CRASHES
mesh.position = new THREE.Vector3(10, 20, 30);

// ✅ CORRECT
mesh.position.set(10, 20, 30);
mesh.rotation.set(Math.PI / 2, 0, 0);
mesh.scale.set(1, 0.75, 1);
```

### Required Helper Pattern

All code in this project MUST use this helper:

```javascript
function mk(geo, mat, x, y, z, castShadow, receiveShadow) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (castShadow) m.castShadow = true;
  if (receiveShadow) m.receiveShadow = true;
  return m;
}

// For rotated objects (floors, roads)
function mkRot(geo, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  return m;
}

// For lights — NEVER Object.assign
const sun = new THREE.DirectionalLight(0xffd4a0, 2.0);
sun.position.set(-200, 170, -110);  // ← .set(), not assign
```

---

## SAFE APIs — Full list for r128

### Renderer
```javascript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(width, height);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;  // also: PCFShadowMap, BasicShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping; // also: LinearToneMapping, ReinhardToneMapping
renderer.toneMappingExposure = 1.0;
// Do NOT set outputColorSpace — it doesn't exist in r128
```

### Materials — What works

**MeshStandardMaterial** (all properties safe):
```javascript
new THREE.MeshStandardMaterial({
  color, roughness, metalness, // core PBR
  emissive, emissiveIntensity,  // glow
  envMap, envMapIntensity,      // reflections (only if envMap assigned)
  map, normalMap, roughnessMap, metalnessMap, aoMap, // texture maps
  transparent, opacity, side,   // transparency
  wireframe, flatShading,       // debug
})
```

**MeshPhysicalMaterial** (ONLY these properties):
```javascript
new THREE.MeshPhysicalMaterial({
  // All MeshStandardMaterial properties PLUS:
  clearcoat,           // 0.0 - 1.0, adds glossy layer
  clearcoatRoughness,  // 0.0 - 1.0
  reflectivity,        // 0.0 - 1.0, affects Fresnel
  // DO NOT USE: transmission, ior, thickness, specularIntensity, specularColor, sheen
})
```

**Glass recipe for r128:**
```javascript
new THREE.MeshPhysicalMaterial({
  color: 0x8ab8d0,
  roughness: 0.05,
  metalness: 0.3,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02,
  transparent: true,
  opacity: 0.5,          // adjust 0.3-0.7 for more/less see-through
  // NO transmission, NO ior, NO thickness
})
```

### Geometries (all safe)
```
BoxGeometry, SphereGeometry, CylinderGeometry, PlaneGeometry,
CircleGeometry, RingGeometry, TorusGeometry, TorusKnotGeometry,
ConeGeometry, DodecahedronGeometry, IcosahedronGeometry,
OctahedronGeometry, TetrahedronGeometry, ShapeGeometry,
ExtrudeGeometry, LatheGeometry, TubeGeometry, BufferGeometry
// NOT: CapsuleGeometry (r142+)
```

### Lights (all safe)
```
AmbientLight, DirectionalLight, HemisphereLight, PointLight, SpotLight
// NOT: RectAreaLight (needs separate import not in CDN bundle)
```

### Other safe APIs
```
THREE.Group, THREE.Object3D
THREE.Raycaster
THREE.Line, THREE.LineBasicMaterial, THREE.LineDashedMaterial
THREE.Fog, THREE.FogExp2
THREE.ShaderMaterial (custom vertex/fragment shaders)
THREE.TextureLoader
THREE.Vector2, THREE.Vector3, THREE.Euler, THREE.Matrix4, THREE.Quaternion
THREE.Shape, THREE.Path, THREE.CurvePath
THREE.BufferAttribute, THREE.Float32BufferAttribute
THREE.Clock
```

---

## EstateBuilder.ai Conventions

- **Units**: All geometry in feet. Conversion constant `FT = 0.3048`
- **Coordinate system**: X+ = East, Z+ = South, Y+ = Up
- **Origin**: Northwest corner of lot polygon
- **Lot geometry**: Generated from `lotVerts()` as 2D polygon in XZ plane
- **Building volumes**: Stored in `P.vols[]` with position, dimensions, floors, use type
- **Floor heights**: `P.flr.gf` (ground floor, typically 15 ft), `P.flr.typ` (typical, 10 ft)
- **Color coding**: Ground commercial = warm gold (#e8c87a), Amenity = teal (#4ecdc4), Residential = blue-grey (#88aabb), Elevator = purple (#c49ade), Stairwell = rust (#b06050)

---

## Pre-Flight Checklist

Before writing ANY Three.js code, verify:

- [ ] No `transmission`, `ior`, `thickness` anywhere
- [ ] No `outputColorSpace` or `SRGBColorSpace`
- [ ] No `CapsuleGeometry`
- [ ] No `Object.assign()` on any THREE object
- [ ] All positions set via `.set()` method
- [ ] All lights positioned via `.position.set()`
- [ ] Glass uses `transparent + opacity + clearcoat`, not transmission
- [ ] Using `mk()` helper for mesh creation
- [ ] `envMapIntensity` only used when `envMap` is actually assigned
