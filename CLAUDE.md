# EstateBuilder.ai

Real estate development massing and feasibility tool. Vanilla HTML + JS, no framework.

## Quick Reference
- **Run**: `node serve.js` → http://localhost:3000 (live reload enabled)
- **Validate**: `node syntax-check.js` (run after EVERY edit)
- **Test**: `node test.js` (77 assertions — run after financial math changes)
- **3D Engine**: Three.js r128 via CDN — global `THREE`, no imports

## Project Structure
```
estatebuilder-ai.html           ← HTML structure only (631 lines)
css/estatebuilder.css            ← All application styles (173 lines)
serve.js                        ← Static file server + live reload (SSE)
syntax-check.js                 ← Script block validator
test.js                          ← Financial math unit tests (77 assertions)

js/                             ← All application JavaScript
  data-model.js                 ← P object, FT/f2m/m2f constants
  lot-geometry.js               ← lotVerts(), lotArea(), lotBounds()
  renderer.js                   ← initThree(), orbit controls, camera, setView()
  save-load.js                  ← localStorage, import/export, project management
  proforma.js                   ← Pro-forma calc, DCF, Monte Carlo, benchmarks
  report.js                     ← Report rendering, PDF/PPTX export, comparables DB
  section3d.js                  ← 3D building section view
  renderer-components.js        ← Textures, materials, rebuildBuilding(), lighting, vol panel
  unit-mix.js                   ← Unit mix editor, floor plans, SVG viewer
  sitemap.js                    ← Mapbox map, parcel picker, zoning overlay, geocoder
  optimal-massing.js            ← generateOptimalMassing(), midrise/highrise builders
  ai-chat.js                    ← Groq API, AI analysis renderers, jurisdiction config
  scenarios.js                  ← Financial scenario modelling, sensitivity analysis
  zoning.js                     ← Zoning dashboard, compliance checks
  ui.js                         ← Tab switching, shadow study, initialization
```

## Rules
1. NEVER use Three.js APIs introduced after r128 — see `.claude/threejs-r128.md`
2. NEVER use `Object.assign()` on THREE objects — use `.set()` methods
3. ALWAYS run `node syntax-check.js` after editing any JS file
4. All geometry units are in **feet** (conversion: `FT = 0.3048`)
5. Coordinate system: X+ = East, Z+ = South, Y+ = Up
6. All JS files share global scope — no import/export, no modules

## Where to Put New Code
| If you're working on... | Edit this file |
|---|---|
| Project data structure, defaults | `js/data-model.js` |
| Lot polygon math | `js/lot-geometry.js` |
| 3D scene setup, camera, orbit | `js/renderer.js` |
| Building rendering, materials, textures | `js/renderer-components.js` |
| Lighting presets, angular planes | `js/renderer-components.js` |
| Volume panel UI, massing controls | `js/renderer-components.js` |
| Save/load, import/export | `js/save-load.js` |
| Pro-forma, DCF, Monte Carlo | `js/proforma.js` |
| Report, PDF/PPTX export | `js/report.js` |
| 3D section view | `js/section3d.js` |
| Unit mix editor, floor plans | `js/unit-mix.js` |
| Mapbox map, parcel picking, geocoding | `js/sitemap.js` |
| Zoning detection, overlay | `js/sitemap.js` |
| Optimal massing generator | `js/optimal-massing.js` |
| AI chat, Groq API | `js/ai-chat.js` |
| Financial scenarios | `js/scenarios.js` |
| Zoning dashboard UI | `js/zoning.js` |
| Tab switching, shadow study | `js/ui.js` |
| CSS styles | `css/estatebuilder.css` |
| HTML layout | `estatebuilder-ai.html` |

## Dependency Order
Files are loaded in this order (each can use globals from all files above it):
1. CDN libs (Three.js r128, Mapbox, Turf, jsPDF, PptxGen)
2. data-model.js → lot-geometry.js → renderer.js → save-load.js
3. proforma.js → report.js → section3d.js → renderer-components.js
4. unit-mix.js → sitemap.js → optimal-massing.js
5. ai-chat.js → scenarios.js → zoning.js → ui.js (last — has init code)

## Docs
- `.claude/architecture.md` — key globals, coordinate system, volume positioning
- `.claude/threejs-r128.md` — banned APIs, safe APIs, required patterns
- `.claude/zoning.md` — zoning detection, setbacks, Toronto design guidelines
- `.claude/rendering.md` — volume system, materials, color coding
- `.claude/common-tasks.md` — cookbook: how to add tabs, units, materials, jurisdictions, etc.

## Skills — Auto-Load Rules
`skills/` symlinks to `../Claude Skills/` — always current when new skills are added.

**IMPORTANT: Before writing ANY code, check if a relevant skill exists and READ it first.**

### When to load which skill:

| Trigger keywords in user request | Read this skill FIRST |
|---|---|
| 3D, render, scene, mesh, material, glass, building, massing, viewport, camera, shadow, lighting, curtain wall, glazing, balcony, mullion, texture, geometry | `skills/threejs-r128-constraint-SKILL.md` (ALWAYS first for any 3D work) |
| Three.js scene setup, Object3D, hierarchy, transforms, coordinate system | `skills/Three.js Skills/threejs-fundamentals/SKILL.md` |
| Material, PBR, roughness, metalness, clearcoat, shader, emissive | `skills/Three.js Skills/threejs-materials/SKILL.md` |
| Light, shadow, ambient, directional, hemisphere, sun | `skills/Three.js Skills/threejs-lighting/SKILL.md` |
| Texture, UV, map, envMap, canvas texture, repeat, wrap | `skills/Three.js Skills/threejs-textures/SKILL.md` |
| Geometry, shape, extrude, buffer, vertices, faces | `skills/Three.js Skills/threejs-geometry/SKILL.md` |
| Animation, tween, clock, keyframe, morph | `skills/Three.js Skills/threejs-animation/SKILL.md` |
| Raycaster, mouse, click, hover, drag, pick | `skills/Three.js Skills/threejs-interaction/SKILL.md` |
| Shader, GLSL, vertex, fragment, uniform | `skills/Three.js Skills/threejs-shaders/SKILL.md` |
| Post-processing, bloom, SSAO, outline, effect | `skills/Three.js Skills/threejs-postprocessing/SKILL.md` |
| GLTF, OBJ, FBX, loader, model import | `skills/Three.js Skills/threejs-loaders/SKILL.md` |
| Three.js r128 expert, EstateBuilder 3D (comprehensive) | `skills/threejs-SKILL.md` |
| PDF, export PDF, jsPDF | `skills/skills-main/skills/pdf/SKILL.md` |
| PPTX, PowerPoint, slide, pitch deck | `skills/skills-main/skills/pptx/SKILL.md` |
| XLSX, Excel, spreadsheet | `skills/skills-main/skills/xlsx/SKILL.md` |
| DOCX, Word document | `skills/skills-main/skills/docx/SKILL.md` |
| Frontend, UI design, layout, responsive | `skills/skills-main/skills/frontend-design/SKILL.md` |
| Canvas, 2D drawing, HTML canvas | `skills/skills-main/skills/canvas-design/SKILL.md` |
| Generative art, algorithmic art, p5.js, flow field, particle system | `skills/skills-main/skills/algorithmic-art/SKILL.md` |
| Brand colors, style guidelines, Anthropic design, visual formatting | `skills/skills-main/skills/brand-guidelines/SKILL.md` |
| Claude API, Anthropic SDK, Agent SDK, `import anthropic` | `skills/skills-main/skills/claude-api/SKILL.md` |
| Documentation, proposal, technical spec, decision doc, co-authoring | `skills/skills-main/skills/doc-coauthoring/SKILL.md` |
| Internal comms, status report, leadership update, newsletter, FAQ | `skills/skills-main/skills/internal-comms/SKILL.md` |
| MCP server, Model Context Protocol, tool integration | `skills/skills-main/skills/mcp-builder/SKILL.md` |
| Create skill, edit skill, skill eval, skill performance | `skills/skills-main/skills/skill-creator/SKILL.md` |
| Slack GIF, animated GIF, GIF for Slack | `skills/skills-main/skills/slack-gif-creator/SKILL.md` |
| Theme, styling artifacts, slides theme, color palette | `skills/skills-main/skills/theme-factory/SKILL.md` |
| Web artifact, React artifact, shadcn, multi-component UI | `skills/skills-main/skills/web-artifacts-builder/SKILL.md` |
| Playwright, webapp testing, browser test, UI test, screenshot test | `skills/skills-main/skills/webapp-testing/SKILL.md` |
| Playwright best practices, e2e test, browser automation, test selectors | `skills/playwright-best-practices/SKILL.md` |
| Zoning approval, ZBLA, site plan, FSI target, corridor precedent, CBC, tower separation, angular plane, MTSA, density, developer feasibility | `skills/toronto-planning-approvals/SKILL.md` |
| Bug, debug, error, broken, fix, regression, root cause, investigate | `skills/systematic-debugging/SKILL.md` |
| Done, complete, finish, verify, prove, confirm it works, check | `skills/verification-before-completion/SKILL.md` |

### Loading rules:
1. For ANY 3D/renderer work: ALWAYS read `threejs-r128-constraint-SKILL.md` FIRST, then the topic-specific skill
2. Multiple skills can be loaded for one task (e.g., materials + textures + lighting)
3. **Before writing any non-trivial code, scan `skills/` for relevant SKILL.md files** — new skills may have been added since this table was last updated
4. Skills override general knowledge — if a skill says "don't use X", don't use X
5. If you find a skill not listed in the table above, still use it and follow its instructions
