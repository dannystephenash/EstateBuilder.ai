# Architecture

## Single-File Design
Everything lives in `estatebuilder-ai.html` — HTML structure, CSS, and all JavaScript in `<script>` blocks. No build tools, no bundling, no transpilation.

## Server
`serve.js` is a Node.js static file server that also proxies API calls to AI endpoints (OpenAI, Anthropic). It reads keys from environment or `.env.local`.

## Validation
`syntax-check.js` extracts every `<script>` block from the HTML file and validates it with `new Function(js)`. Run after every edit.

## Folder Structure
```
estatebuilder-ai.html    <- the product
serve.js                 <- dev server + API proxy
syntax-check.js          <- script block validator
CLAUDE.md                <- root instructions for Claude
.claude/                 <- detailed docs
backups/                 <- timestamped .bak files
docs/                    <- implementation plans, prompts
library/                 <- extracted JS modules (future)
skills/                  <- Three.js r128 constraint skill
```

## Key Globals
| Variable | Description |
|---|---|
| `P` | Project state object — lot, volumes, zoning, site coords, everything |
| `P.vols[]` | Building volumes array — position, dimensions, floors, use type |
| `P.zoning` | Zoning data — zone, FSI, height limit, coverage, setbacks |
| `P.lot.gpsVerts` | GPS coordinates `[lng, lat]` for each lot polygon vertex |
| `P.siteCoords` | Site center `{lat, lng}` |
| `P.flr.gf` | Ground floor height (typically 15 ft) |
| `P.flr.typ` | Typical floor height (typically 10 ft) |

## Coordinate System
- All geometry in **feet**
- Conversion constant: `FT = 0.3048`
- X+ = East, Z+ = South, Y+ = Up
- Origin: Northwest corner of lot polygon
- `lotVerts()` — returns lot polygon as `[x, z]` pairs in local feet
- `lotBounds()` — returns `{minX, maxX, minZ, maxZ, width, depth}`

## Volume Positioning
Each volume in `P.vols[]` is positioned relative to the lot bounding box:
- `offEast` — distance from east lot line (maxX) to east face
- `startEg` — distance from north edge (minZ) to north face
- `width` / `depth` — dimensions in feet
- `customPolyLocal` — optional `[x,z]` array for freeform polygon volumes (replaces rectangular footprint)
- `customAreaSF` — floor area when using polygon shape

## Key Functions
| Function | Purpose |
|---|---|
| `lotVerts()` | Returns lot polygon vertices in local feet |
| `lotBounds()` | Returns bounding box of lot |
| `detectZoning(lat, lng)` | Queries Toronto ArcGIS for zoning at a point |
| `generateOptimalMassing()` | AI-driven massing generator |
| `rebuild3D()` | Re-renders the 3D scene from `P.vols[]` |
| `autoSave()` | Persists project state to localStorage |
| `f2m(feet)` | Converts feet to metres (× 0.3048) |
| `mk(geo, mat, x, y, z)` | Creates positioned mesh (avoids Object.assign) |
| `mkRot(geo, mat, x, y, z, rx, ry)` | Creates positioned + rotated mesh |
