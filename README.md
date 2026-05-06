# EstateBuilder.ai

Software tool for real estate developers to evaluate project feasibility in the pre-development stage.

## Modules

- **Site Plan** — Mapbox-driven lot drawing, parcel picking, zoning overlays
- **Massing** — 3D residential mid-rise / multi-tower / industrial Class A bulk warehouse generators
- **Pro-Forma** — DCF, sources & uses, sensitivity analysis
- **Unit Mix** — Per-floor unit allocation with manual overrides
- **Reports** — PDF export with embedded plans + financial summary
- **Civil / Servicing** — Stormwater, watermain, sanitary, gas, electrical demand calculators

## Stack

- HTML/CSS/JS (no framework — single-page app, vanilla DOM)
- Three.js r128 for 3D rendering
- Mapbox GL JS v3.3 for 2D site mapping
- Turf.js v7.2 for polygon operations
- jsPDF for report export

## Local development

```bash
node serve.js
# Open http://localhost:3000
```

## Console helpers (browser DevTools)

- `__runSelfTest()` — verify state invariants
- `__inspectRebuildChain()` — list all registered rebuild hooks
- `_validateState()` — log any invariant violations
- `_resetAssetClassState(toClass)` — wipe industrial state on switch to residential
