# Zoning System

## Detection
`detectZoning(lat, lng)` queries the Toronto ArcGIS REST API and returns:

```javascript
P.zoning = {
  zone,           // "CR", "R", "E", etc.
  zoneString,     // Full zone string e.g. "CR 3.0 (c2.0; r2.5) SS2"
  fsiLimit,       // Total FSI (e.g. 3.0)
  fsiResi,        // Residential FSI component
  fsiComm,        // Commercial FSI component
  heightLimit,    // Height in metres
  coverage,       // Max lot coverage (0-1)
  permitted[],    // Permitted uses
  exception,      // Exception text if any
  exceptionNo,    // Exception number
  bylawSection    // By-law section reference
}
```

## Auto-Probing for Assembled Sites
When the site center has no zoning (common for land assemblies), `generateOptimalMassing()` probes multiple GPS points within the lot polygon in parallel using `Promise.all`:
- Samples every other vertex from `P.lot.gpsVerts` plus the centroid
- Picks the most permissive zoning (highest FSI)
- Assumes a ZBLA will rezone the full assembly to match

## Toronto By-law 569-2013 Setback Rules

| Zone Type | Front | Side | Rear |
|---|---|---|---|
| CR (Commercial Residential) | 0m | 5.5m (18ft) | 7.5m (25ft) |
| R (Residential) | 3m (10ft) | varies | 7.5m (25ft) |

## Toronto Tall Building Design Guidelines
- **Streetwall**: 80% of ROW width, typically 4 storeys (20m) for CR zones
- **Tower step-back**: 3m (10ft) on ALL sides above streetwall
- **Tower plate cap**: 750m² (8,073 sf) maximum
- **Tower separation**: 25m between towers
- **Floor plate aspect ratio**: minimum 1:2 (no thinner than 2:1)

## Optimal Massing Generator Flow
1. Check for zoning data; if missing, probe GPS vertices in parallel
2. Analyze zone type to derive setbacks, streetwall height, step-back rules
3. Build polygon podium (follows lot shape via `customPolyLocal`)
4. Find inscribed tower rectangle using ray-casting from candidate centers
5. Verify tower corners are inside polygon AND at least 10ft from all lot edges
6. Output two volumes: podium + tower

## Asset Class Benchmarks
The `ASSET_BENCHMARKS` object contains `zoningContext` strings per asset class with city-wide design guidelines (angular planes, DC rates, parking ratios). These are general Toronto rules, not site-specific.
