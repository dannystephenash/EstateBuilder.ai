// lot-geometry.js — Lot polygon utilities: vertices, area, bounds
// ═══════════════════════════════════════════════════════════
//  LOT GEOMETRY  (vertices in feet, XZ plane, Y=up)
//  Origin = Northernmost vertex of lot polygon
//  X+ = East (right on screen from south view)
//  Z+ = South (away from origin / toward camera)
// ═══════════════════════════════════════════════════════════

/**
 * Removes consecutive duplicate vertices and zero-area edges from a polygon.
 * The site map / parcel picker / GPS import tools occasionally produce arrays
 * with two identical adjacent vertices (e.g. a [0,0] repeated, often a
 * coordinate-snap artifact). Those degenerate edges break the 3D renderer
 * (missing curtain wall panels, broken balconies) and the Optimal Massing
 * generator inherits the bad polygon when it copies the lot. This helper is
 * called from lotVerts() so EVERY consumer gets clean data.
 *
 * Threshold: vertices within 0.05 ft (~15mm) of each other are treated as the
 * same point — well below any real architectural precision but tight enough
 * to preserve every intentional vertex.
 *
 * @param {number[][]} pts - polygon vertices (open or closed ring)
 * @returns {number[][]} cleaned polygon (closed if input was closed)
 */
function _dedupePolyVerts(pts){
  if(!pts || pts.length < 2) return pts || [];
  const tol = 0.05;
  const isClosed = pts.length >= 2 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < tol &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < tol;
  // Walk the open ring (without the closing dup) and drop any vertex
  // that's coincident with the previous one.
  const open = isClosed ? pts.slice(0, -1) : pts.slice();
  const out = [];
  for(let i = 0; i < open.length; i++){
    const p = open[i];
    if(out.length === 0){ out.push(p); continue; }
    const last = out[out.length - 1];
    if(Math.abs(p[0] - last[0]) < tol && Math.abs(p[1] - last[1]) < tol) continue; // skip dup
    out.push(p);
  }
  // Also drop the LAST vertex if it's coincident with the FIRST (closes a degenerate edge)
  if(out.length > 2){
    const first = out[0], last = out[out.length - 1];
    if(Math.abs(first[0] - last[0]) < tol && Math.abs(first[1] - last[1]) < tol) out.pop();
  }
  // Re-close the ring if the input was closed
  if(isClosed && out.length >= 1) out.push([out[0][0], out[0][1]]);
  return out;
}

/**
 * Simplifies a polygon for clean architectural rendering. Performs three passes:
 *  1. De-duplicate consecutive coincident vertices (uses _dedupePolyVerts)
 *  2. Merge vertices within `mergeDist` feet of each other (combines clustered points)
 *  3. Remove vertices whose interior angle is nearly straight (collinear cleanup)
 *
 * This is intended for cases where a building footprint should follow a CLEAN
 * outline (e.g. the Optimal Massing generator). The raw lot polygon may have
 * many small jogs from GPS imports / parcel-picker snapping; a real building
 * doesn't trace every one of them. Returns a polygon with no consecutive
 * duplicates, no near-duplicates, and no nearly-collinear vertices.
 *
 * @param {number[][]} pts - polygon vertices (open or closed ring)
 * @param {object} [opts] - { mergeDist: ft (default 8), collinearTol: deg (default 5) }
 * @returns {number[][]} simplified polygon (closed if input was closed)
 */
function _simplifyPolygon(pts, opts){
  if(!pts || pts.length < 3) return pts || [];
  const mergeDist = (opts && opts.mergeDist) || 8;
  const collinearTol = (opts && opts.collinearTol) || 5; // degrees from 180°
  const tol = 0.05;
  const isClosed = pts.length >= 2 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < tol &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < tol;
  let ring = isClosed ? pts.slice(0, -1) : pts.slice();

  // Pass 1+2: walk and merge any vertex that's within mergeDist of the previous kept one
  let merged = [];
  for(let i = 0; i < ring.length; i++){
    const p = ring[i];
    if(merged.length === 0){ merged.push(p); continue; }
    const last = merged[merged.length - 1];
    const dx = p[0] - last[0], dy = p[1] - last[1];
    if(Math.sqrt(dx*dx + dy*dy) < mergeDist) continue; // skip — too close to last
    merged.push(p);
  }
  // Same check on the wrap-around (last vs first)
  if(merged.length > 3){
    const a = merged[0], b = merged[merged.length - 1];
    const dx = a[0] - b[0], dy = a[1] - b[1];
    if(Math.sqrt(dx*dx + dy*dy) < mergeDist) merged.pop();
  }

  // Pass 3: remove vertices where the interior angle is nearly straight
  // (i.e. the vertex sits on the line between its neighbors — adds noise
  // without changing the polygon's shape).
  if(merged.length > 3){
    const cleaned = [];
    for(let i = 0; i < merged.length; i++){
      const prev = merged[(i - 1 + merged.length) % merged.length];
      const cur = merged[i];
      const next = merged[(i + 1) % merged.length];
      const v1 = [cur[0] - prev[0], cur[1] - prev[1]];
      const v2 = [next[0] - cur[0], next[1] - cur[1]];
      const m1 = Math.sqrt(v1[0]*v1[0] + v1[1]*v1[1]);
      const m2 = Math.sqrt(v2[0]*v2[0] + v2[1]*v2[1]);
      if(m1 < 1e-6 || m2 < 1e-6){ continue; }
      const cosA = (v1[0]*v2[0] + v1[1]*v2[1]) / (m1 * m2);
      const angleDeg = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
      // Edge vectors near-parallel (angleDeg near 0) → vertex is on a straight line, remove
      if(angleDeg < collinearTol){ continue; }
      cleaned.push(cur);
    }
    if(cleaned.length >= 3) merged = cleaned;
  }

  if(isClosed && merged.length >= 1) merged.push([merged[0][0], merged[0][1]]);
  return merged;
}

/**
 * Computes the convex hull of a polygon using Andrew's monotone chain algorithm.
 * Returns the smallest convex polygon containing all input vertices. This is the
 * right preprocessing for rendering a building footprint when the underlying lot
 * polygon has concave corners that would otherwise produce inward-facing wall
 * fins / misaligned balconies in the 3D renderer.
 *
 * For lots that are already convex, the output equals the input (minus collinear
 * vertices). For concave lots (L-shapes, Z-shapes, irregular property lines),
 * the hull "fills in" the concave dent to create a clean buildable envelope.
 *
 * @param {number[][]} pts - polygon vertices (open or closed ring)
 * @returns {number[][]} convex hull (closed ring, CCW orientation)
 */
function _convexHull(pts){
  if(!pts || pts.length < 3) return pts || [];
  const tol = 0.05;
  const isClosed = pts.length >= 2 &&
    Math.abs(pts[0][0] - pts[pts.length - 1][0]) < tol &&
    Math.abs(pts[0][1] - pts[pts.length - 1][1]) < tol;
  let points = (isClosed ? pts.slice(0, -1) : pts.slice()).map(p => [p[0], p[1]]);
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (O, A, B) => (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);

  const lower = [];
  for(let i = 0; i < points.length; i++){
    while(lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
    lower.push(points[i]);
  }
  const upper = [];
  for(let i = points.length - 1; i >= 0; i--){
    while(upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) upper.pop();
    upper.push(points[i]);
  }
  // concat lower+upper (drop the last of each — they're the start of the other)
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if(isClosed && hull.length >= 1) hull.push([hull[0][0], hull[0][1]]);
  return hull;
}

/**
 * Returns the lot polygon as an array of [x, z] vertices in feet.
 * Uses P.lot.polyVerts (from site map) if available, otherwise builds from parameterized L-shape dimensions.
 * Always returns a polygon with no consecutive duplicate vertices.
 * @returns {number[][]} Array of [x, z] coordinate pairs (closed polygon, origin at NW corner)
 */
function lotVerts(){
  // MODE 1: Direct polygon from site map tool — use vertices exactly as drawn
  // (but de-duplicated so a degenerate vertex from the source can't propagate
  // into volume polygons / the renderer).
  if(P.lot.polyVerts && P.lot.polyVerts.length >= 3){
    return _dedupePolyVerts(P.lot.polyVerts);
  }

  // MODE 2: Parameterized L-shape (manual entry)
  const L=P.lot;
  const depthW = L.upperLeft + L.lowerLeft;
  const depthE = L.upperRight + L.lowerRight;

  const NW = [0, 0];
  const NE = [L.front, 0];
  const ER1 = [L.front, L.upperRight];
  const ER2 = [L.front + L.stepEast, L.upperRight];
  const SE = [L.front + L.stepEast, depthE];
  const swX = SE[0] - L.rear;
  const SW = [swX, depthW];
  const WL1 = [swX, depthW - L.lowerLeft];
  const WL2 = [swX + L.notchWest, depthW - L.lowerLeft];

  return [NW, NE, ER1, ER2, SE, SW, WL1, WL2];
}

/**
 * Calculates lot area in square feet using the Shoelace formula.
 * @returns {number} Lot area in sq ft
 */
function lotArea(){
  const v=lotVerts();
  // Shoelace formula
  let a=0;
  for(let i=0;i<v.length;i++){
    const j=(i+1)%v.length;
    a += v[i][0]*v[j][1] - v[j][0]*v[i][1];
  }
  return Math.abs(a)/2; // sq ft
}

/**
 * Returns bounding box of the lot polygon in feet.
 * @returns {{minX:number, maxX:number, minZ:number, maxZ:number, width:number, depth:number}}
 */
function lotBounds(){
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]), allZ=vts.map(v=>v[1]);
  return {
    minX:Math.min(...allX), maxX:Math.max(...allX),
    minZ:Math.min(...allZ), maxZ:Math.max(...allZ),
    width:Math.max(...allX)-Math.min(...allX),
    depth:Math.max(...allZ)-Math.min(...allZ)
  };
}

/**
 * Re-normalises P.lot.polyVerts so the project convention "origin = northernmost
 * vertex, all z ≥ 0" is enforced. Updates P._gpsOrigin and P.lot.gpsOrigin to
 * match, AND shifts every volume's customPolyLocal by the same delta so the
 * 3D scene stays visually identical (the polygons end up in the same lat/lng
 * positions on the satellite — only the local-feet origin is shifted.
 */
