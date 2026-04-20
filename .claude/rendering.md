# Rendering System

## Volume Types
The 3D renderer reads `P.vols[]` and draws each volume. Two modes:

### Rectangular Volumes
Standard box with position from `offEast`/`startEg`, dimensions from `width`/`depth`.
Supports `podiumStoreys` + `stepbackAmt` for built-in tower step-back (insets on all 4 sides above podium floors).

### Polygon Volumes (`customPolyLocal`)
When `vol.customPolyLocal` is set (array of `[x,z]` closed polygon points), the renderer uses `THREE.ExtrudeGeometry` from a `THREE.Shape` instead of `BoxGeometry`.
- The polygon shape is used for ALL floors of that volume
- No native step-back support for polygon volumes
- To achieve step-back: use TWO volumes (polygon podium + rectangular tower)

## Color Coding by Use
| Use | Color | Hex |
|---|---|---|
| Ground commercial | Warm gold | `#e8c87a` |
| Amenity | Teal | `#4ecdc4` |
| Residential | Blue-grey | `#88aabb` |
| Elevator | Purple | `#c49ade` |
| Stairwell | Rust | `#b06050` |

## Cladding Materials
Set via `vol.cladding`: `"brick"`, `"glass"`, `"metal"`, `"concrete"`, `"wood"`

## Facades
- `vol.windows` — enable window grid
- `vol.winSpacing` — window spacing in feet
- `vol.balconies` — enable balconies
- `vol.balcEvery` — balcony frequency (every N floors)
- `vol.balcDepth` — balcony projection depth in feet
- `vol.balcN/S/E/W` — enable balconies per face
- `vol.storefrontN/S/E/W` — ground floor retail glazing per face
- `vol.commGF` — flag for commercial ground floor treatment

## View System
`setView(name)` sets camera position. Available views:
- `perspective`, `front`, `rear`, `aerial`, `birdseye`

## Renderer Coordinate Mapping
The renderer converts from volume local coordinates to Three.js world coordinates:
```
cx1 = f2m(lotMaxX) - f2m(offEast)       // east face in metres
cx0 = cx1 - f2m(width)                   // west face
cz0 = f2m(lotMinZ) + f2m(startEg)       // north face
cz1 = cz0 + f2m(depth)                   // south face
```

For polygon volumes, `customPolyLocal` vertices use the same coordinate system as `lotVerts()` and are converted to metres via `f2m()`.

## Rebuild
Call `rebuild3D()` after modifying `P.vols[]` to re-render the scene.
