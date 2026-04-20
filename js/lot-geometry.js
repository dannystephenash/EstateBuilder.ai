// lot-geometry.js — Lot polygon utilities: vertices, area, bounds
// ═══════════════════════════════════════════════════════════
//  LOT GEOMETRY  (vertices in feet, XZ plane, Y=up)
//  Origin = Northernmost vertex of lot polygon
//  X+ = East (right on screen from south view)
//  Z+ = South (away from origin / toward camera)
// ═══════════════════════════════════════════════════════════
/**
 * Returns the lot polygon as an array of [x, z] vertices in feet.
 * Uses P.lot.polyVerts (from site map) if available, otherwise builds from parameterized L-shape dimensions.
 * @returns {number[][]} Array of [x, z] coordinate pairs (closed polygon, origin at NW corner)
 */
function lotVerts(){
  // MODE 1: Direct polygon from site map tool — use vertices exactly as drawn
  if(P.lot.polyVerts && P.lot.polyVerts.length >= 3){
    return P.lot.polyVerts;
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

// ═══════════════════════════════════════════════════════════
//  THREE.JS SETUP
// ═══════════════════════════════════════════════════════════
