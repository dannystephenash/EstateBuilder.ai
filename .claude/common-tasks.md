# Common Tasks Cookbook

Step-by-step recipes for frequent modifications. Follow these patterns exactly.

## Add a New Building Volume Type
1. Edit `js/renderer-components.js` → find the volume rendering loop in `rebuildBuilding()`
2. Add a new `case` in the use-type switch (or a new color in the color map)
3. Add matching color in `.claude/rendering.md` color table
4. Add a new entry in the volume panel builder (same file, `buildVolPanel()`)
5. Run `node syntax-check.js`

## Add a New Cladding Material
1. Edit `js/renderer-components.js` → find the `MAT` object and `mkCladding()` (or equivalent)
2. Add a new key (e.g. `'stone'`) with a `THREE.MeshStandardMaterial` using r128-safe APIs
3. Add the matching option in the volume panel dropdown (search for `cladding` select element)
4. Update `.claude/rendering.md` → Cladding Materials table
5. Run `node syntax-check.js`
6. **MUST READ** `skills/threejs-r128-constraint-SKILL.md` before touching any material code

## Add a New Tab
1. Edit `estatebuilder-ai.html`:
   - Add a `<button class="tab-btn" onclick="switchTab('newtab')">LABEL</button>` in the `.tab-bar`
   - Add a `<div id="tab-newtab" class="tab-content">` with initial content
2. Edit `js/ui.js` → `switchTab()`:
   - Add `'newtab'` to the `tabs` array
   - Add any show/hide logic for viewport (map vs 3D)
3. Create rendering function (e.g. `renderNewTab()`) in the appropriate JS file
4. Run `node syntax-check.js`

## Add a New Unit Type
1. Edit `js/data-model.js` → add entry to `P.unitPlan.unitTypes[]` with `{type, defaultSize, color}`
2. The proforma will auto-distribute units of this type in `pfCalc()` if added to `P.pf.units[]`
3. Edit `js/proforma.js` → add the type to `defaultPcts` and `defaultSizes` objects in `pfCalc()`
4. Run `node syntax-check.js` and `node test.js`

## Add a New Zoning Jurisdiction
1. Edit `js/ai-chat.js` → `JURISDICTIONS` object:
   - Add a new key (e.g. `'vancouver'`) with `zoningContext` and `bylawRef`
2. Edit `estatebuilder-ai.html` → jurisdiction `<select>`:
   - Add `<option value="vancouver">City of Vancouver</option>`
3. Edit `js/sitemap.js` → `PARCEL_SERVICES` (if the city has an ArcGIS parcel API):
   - Add service URL, field mappings, and coordinate system
4. Run `node syntax-check.js`

## Add a New AI Analysis Endpoint
1. Edit `js/ai-chat.js`:
   - Add case in `buildSystemPrompt(endpoint)` for the new endpoint
   - Add case in `buildUserMessage(endpoint)` to construct the data payload
   - Add renderer function `renderNewResult(data, el)`
   - Add routing in `renderAIResult(endpoint, data, container)`
2. Edit `estatebuilder-ai.html` → AI tab:
   - Add a new `<div class="sec">` card with button `onclick="requestAI('new-endpoint')"`
   - Add result container `<div id="ai-result-new"></div>`
3. Run `node syntax-check.js`

## Add a New Pro-Forma Cost Category
1. Edit `js/proforma.js`:
   - Add the rate to `P.pf.hc` (hard cost) or `P.pf.sc` (soft cost as % of hard)
   - Include it in the totalHard or totalSoft calculation in `pfCalc()`
2. Edit the pro-forma renderer (`renderProForma()` in same file) to show the new row
3. Run `node test.js` — the financial consistency tests will catch errors
4. Run `node syntax-check.js`

## Add a New Report Section
1. Edit `js/report.js` → `renderReport()`:
   - Add a new `<div class="rpt-page">` block at the appropriate position
   - Use `.rpt-h1`, `.rpt-h2`, `.rpt-table` classes for consistent styling
2. For PDF: edit `exportPDF()` to add the section
3. For PPTX: edit `exportPPTX()` to add a slide
4. Run `node syntax-check.js`

## Add a New Landscape Element
1. Edit `js/renderer-components.js` → `rebuildEnvironment()`:
   - Find the landscape rendering loop
   - Add geometry for the new element type
2. Add matching UI controls in the Landscape section (massing tab)
3. Run `node syntax-check.js`
4. **MUST READ** `skills/threejs-r128-constraint-SKILL.md` first

## Modify the Site Map (Mapbox)
1. All map code is in `js/sitemap.js`
2. Map instance is stored in `window._map` (set during `initSiteMap()`)
3. Parcel services are in `PARCEL_SERVICES` object
4. Zoning detection is in `detectZoning()`
5. Building drawing is in `smDrawBuilding()`
6. **Never import mapbox-gl** — it's loaded via CDN as `mapboxgl` global

## Run Tests After Any Financial Change
```
node test.js
```
Tests cover: lot geometry, pfCalc, DC schedule, DCF, Monte Carlo, scenarios, sensitivity, and financial consistency (77 assertions).

## Pre-Flight Checklist (Before Any PR or Deploy)
1. `node syntax-check.js` — all JS files parse cleanly
2. `node test.js` — all 77 tests pass
3. Open in browser — no red error banner
4. Check 3D viewport loads (MASSING tab)
5. Check site map loads (SITE MAP tab with Mapbox token)
