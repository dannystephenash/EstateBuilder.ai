# Three.js r128 Constraints

CDN source: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`
No npm. No imports. No modules. Global `THREE` object via script tag.

## BANNED APIs — Will Crash

| API | Introduced In | Use Instead |
|---|---|---|
| `transmission` | r138 | `transparent: true, opacity: 0.5` |
| `ior` | r138 | omit entirely |
| `thickness` | r138 | omit entirely |
| `specularIntensity` | r136 | omit entirely |
| `specularColor` | r136 | omit entirely |
| `outputColorSpace` | r152 | `renderer.outputEncoding = THREE.sRGBEncoding` |
| `THREE.SRGBColorSpace` | r152 | `THREE.sRGBEncoding` |
| `THREE.LinearSRGBColorSpace` | r152 | `THREE.LinearEncoding` |
| `THREE.CapsuleGeometry` | r142 | `CylinderGeometry` + `SphereGeometry` |
| `texture.colorSpace` | r152 | `texture.encoding = THREE.sRGBEncoding` |
| `Object.assign()` on THREE objects | r128 bug | `.position.set()`, `.rotation.set()`, `.scale.set()` |
| `envMapIntensity` without envMap | r128 | only set if envMap is assigned |
| `RectAreaLight` | not in CDN | use `SpotLight` or `PointLight` |

## The Object.assign Bug — MOST COMMON CRASH

In r128, `position`, `rotation`, and `scale` are readonly getters returning `Vector3`/`Euler` objects.

```javascript
// CRASHES
Object.assign(mesh, { position: new THREE.Vector3(10, 20, 30) });
mesh.position = new THREE.Vector3(10, 20, 30);
const light = Object.assign(new THREE.DirectionalLight(0xffffff, 1), { position: { x: 10 } });

// CORRECT
mesh.position.set(10, 20, 30);
mesh.rotation.set(Math.PI / 2, 0, 0);
mesh.scale.set(1, 0.75, 1);
```

## Required Helpers

```javascript
function mk(geo, mat, x, y, z, castShadow, receiveShadow) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (castShadow) m.castShadow = true;
  if (receiveShadow) m.receiveShadow = true;
  return m;
}

function mkRot(geo, mat, x, y, z, rx, ry) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (ry) m.rotation.y = ry;
  return m;
}
```

## Safe Material Recipes

**Glass (r128-compatible):**
```javascript
new THREE.MeshPhysicalMaterial({
  color: 0x8ab8d0,
  roughness: 0.05,
  metalness: 0.3,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02,
  transparent: true,
  opacity: 0.5
  // NO transmission, NO ior, NO thickness
});
```

**MeshPhysicalMaterial — ONLY these properties:**
```javascript
new THREE.MeshPhysicalMaterial({
  // All MeshStandardMaterial props PLUS:
  clearcoat,           // 0-1
  clearcoatRoughness,  // 0-1
  reflectivity,        // 0-1
  // DO NOT USE: transmission, ior, thickness, specularIntensity, specularColor, sheen
});
```

## Safe Renderer Setup
```javascript
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// Do NOT set outputColorSpace — doesn't exist in r128
```

## Pre-Flight Checklist
Before writing ANY Three.js code, verify:
- [ ] No `transmission`, `ior`, `thickness`
- [ ] No `outputColorSpace` or `SRGBColorSpace`
- [ ] No `CapsuleGeometry`
- [ ] No `Object.assign()` on THREE objects
- [ ] All positions via `.set()`
- [ ] All lights positioned via `.position.set()`
- [ ] Glass uses `transparent + opacity + clearcoat`, not transmission
- [ ] Using `mk()` / `mkRot()` helpers
- [ ] `envMapIntensity` only when `envMap` is assigned
