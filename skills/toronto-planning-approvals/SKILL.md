---
name: toronto-planning-approvals
description: >
  Toronto development approval intelligence for ZBLA-optimized massing.
  Use when generating optimal massing, estimating approval risk, or
  calculating developer-feasible density. Encodes Tall Building Guidelines,
  Mid-Rise Performance Standards, MTSA/PMTSA rules, Section 37/CBC, and
  corridor precedent FSI data.
---

# Toronto Planning Approvals Intelligence

## Purpose
This skill encodes the decision logic that Toronto's planning department, councillors, and the Ontario Land Tribunal (OLT) use to evaluate development applications. The goal: **maximize developer profit by pushing density to the edge of what will be approved.**

## Core Principle
> The as-of-right zoning is the floor, not the ceiling. Every significant Toronto development in the last decade has been approved via ZBLA at multiples of the as-of-right FSI. The question isn't "what does zoning allow?" — it's "what will planning approve?"

---

## 1. Approval-Likely FSI Targets by Context

### Corridor Precedent Multipliers (applied to as-of-right FSI)

| Site Context | Midrise Multiplier | Highrise Multiplier | Examples |
|---|---|---|---|
| **MTSA/PMTSA (<200m from station)** | 3.0-4.0x | 6.0-10.0x | Yonge-Eglinton, Bloor-Yonge |
| **MTSA/PMTSA (200-500m)** | 2.5-3.0x | 4.0-7.0x | Side streets off Yonge, Eglinton |
| **Major Avenue + transit (streetcar/bus)** | 2.0-2.5x | 3.0-5.0x | King West, Queen West, Dundas |
| **Avenue without rapid transit** | 1.5-2.0x | 2.5-4.0x | Suburban avenues |
| **Employment/Regen Area** | 2.0-3.0x | 4.0-8.0x | Liberty Village, Port Lands |
| **Neighbourhoods edge** | 1.3-1.5x | N/A (highrise unlikely) | Low-rise residential transition |

### Absolute FSI Precedent Ranges

| Corridor | Typical Approved FSI | Max Precedent |
|---|---|---|
| Downtown core (King-Yonge-Bay) | 15-25x | ~60x (19 Bloor W) |
| King West / Entertainment | 10-18x | 18x (Forma) |
| Yonge-Eglinton | 8-15x | 15x (5-tower) |
| Queen West / Dundas | 5-10x | 10x |
| Eglinton Crosstown corridor | 5-12x | 14 storeys midrise |
| Suburban transit nodes | 4-8x | 8x |

---

## 2. Tall Building Design Guidelines (2013, Council-adopted)

### Tower Requirements
- **Floor plate cap: 750 m2** (hard cap, rarely exceeded)
- **Tower separation: 25m** between towers on same site
- **Tower setback: 12.5m** from side/rear lot line (ensures 25m to adjacent tower)
- **Tower setback from street: 3m** minimum from street lot line
- **Step-back from podium: 3m** minimum on all sides (demonstrable)
- **Three-part composition**: base (podium) + middle (tower shaft) + top (crown)

### Base Building / Podium
- **Minimum height: 10.5m** (3 storeys, discourages underdevelopment)
- **Maximum height: contextual** (typically = ROW width or surrounding streetwall)
- **Ground floor: 4.5m** minimum floor-to-floor (retail-ready)
- **100% lot coverage** typical for podium in CR zones (0m front setback)

### Angular Plane (from Neighbourhoods)
- **45-degree angular plane** from abutting Neighbourhoods (R, RD zones)
- Starting height: **10.5m** from rear lot line (no lane) or **7.5m** (with lane)
- Constrains tower placement toward the street side of lot

---

## 3. Mid-Rise Performance Standards (Updated November 2024)

### Maximum Height
- **Height = ROW width** (the "1:1 rule")
- 20m ROW = ~6 storeys, 27m ROW = ~9 storeys, 36m ROW = ~11 storeys
- **New max: 14 storeys (45m)** on streets with 45m ROW
- Deep sites: additional height above ROW width may be considered

### Angular Planes (2024 MAJOR CHANGE)
- **Front angular plane: REMOVED** (previously 45deg from 80% ROW)
- **Rear angular plane: REMOVED** (no more wedding-cake stepped massing)
- Replaced with fixed rear setback distances

### Rear Transition
- Under 6 storeys (20m): **7.5m** rear setback
- 7-11 storeys (>20m): **10.0m** rear setback
- Mid-rise to mid-rise/tall separation: **20.0m** minimum

### Side Setbacks
- **5.5m** minimum for window walls above certain heights
- Can be 0m at party wall conditions

---

## 4. MTSA / PMTSA Density Rules (Provincial, August 2025)

### Mandated Minimums (for Mixed Use, Apartment Neighbourhoods, Regen)
- **Within 200m of station: FSI 8 minimum permitted**
- **200-500m from station: FSI 6 minimum permitted**

### Height Permissions (3+ tower sites)
- Within 200m: up to **30 storeys**
- 200-500m: up to **20 storeys**

### In Neighbourhoods Designation
- Within 200m or on major streets: up to **6 storeys**
- Otherwise: up to **4 storeys**

### Inclusionary Zoning (PMTSAs)
- **5% of residential units** at affordable rents (current)
- Rising to **8-22% by 2030**
- 25-year affordability period

---

## 5. Community Benefits Charges (CBC)

### Calculation
- **Statutory cap: 4% of appraised land value** at building permit date
- Applies to: 10+ residential units AND 5+ storeys
- Replaces old Section 37 negotiated contributions

### Estimation for Optimizer
```
CBC = 0.04 * land_value_per_sf * lot_area_sf
```
Use P.pf.landCostPSF (from proforma) as the land value input.

---

## 6. Approval Risk Assessment

### LIKELY APPROVED (Green Light)
- Tower plate <= 750 m2
- Tower separation >= 25m (12.5m to lot line)
- Angular plane respected from Neighbourhoods
- No net new shadow on parks (March 21, 10am-4pm)
- FSI within corridor precedent range
- Podium height contextual to streetwall
- CBC/inclusionary zoning provided
- Public realm improvements offered

### MODERATE RISK (Yellow Light)
- FSI 10-20% above corridor precedent
- Tower plate 750-850 m2 (needs justification)
- Minor shadow impact on non-protected spaces
- 1-2 guideline deviations with rationale

### LIKELY REJECTED (Red Light)
- Tower plate > 850 m2 without exceptional justification
- Tower separation < 20m
- Angular plane violated into Neighbourhoods without mitigation
- Net new shadow on protected parks
- FSI far exceeds corridor precedent without transit rationale
- No public realm or community benefits

---

## 7. Decision Logic for Massing Optimizer

### Step 1: Determine Context
```
isNearMTSA200 = (distance to subway/LRT station < 200m)
isNearMTSA500 = (distance to subway/LRT station < 500m)
isMajorAvenue = (ROW >= 20m) OR (zone starts with CR)
isNearNeighbourhoods = (adjacent zone starts with R and not CR)
```

### Step 2: Set Target FSI
```
if (isNearMTSA200):     targetFSI = asOfRight * 8.0  (highrise) or 3.5 (midrise)
else if (isNearMTSA500): targetFSI = asOfRight * 5.0  (highrise) or 2.5 (midrise)
else if (isMajorAvenue):  targetFSI = asOfRight * 3.5  (highrise) or 2.0 (midrise)
else:                     targetFSI = asOfRight * 2.0  (highrise) or 1.5 (midrise)
```

### Step 3: Derive Storeys from Target FSI
```
targetGFA = targetFSI * lotArea
podiumGFA = lotArea * podiumStoreys  (100% coverage)
towerGFA  = targetGFA - podiumGFA
towerStoreys = ceil(towerGFA / towerPlateArea)
totalStoreys = podiumStoreys + towerStoreys
```

### Step 4: Apply Constraints
```
if (totalStoreys > heightLimitStoreys * corridorMultiplier): cap to precedent
if (towerPlate > 750m2): reduce plate, increase storeys
if (towerSeparation < 25m): shift tower or reduce plate
if (angularPlane violated): step back upper floors
```

### Step 5: Assess Approval Risk
```
Compare achieved FSI to corridor precedent table
Check all guideline compliance
Rate: GREEN / YELLOW / RED with specific issues
Estimate timeline: SPA (6-12mo), MV (3-6mo), ZBLA (12-24mo)
```

---

## 8. Key Numbers Reference

| Parameter | Value | Source |
|---|---|---|
| Tower plate cap | 750 m2 (8,073 sf) | Tall Building Guidelines 3.2.1 |
| Tower separation | 25m (12.5m to lot line) | Tall Building Guidelines 3.2.3 |
| Podium step-back | 3m (10ft) | Tall Building Guidelines |
| Ground floor height | 4.5m (15ft) min | Tall Building Guidelines |
| Mid-rise 1:1 rule | height = ROW width | Mid-Rise Standards |
| Mid-rise max | 14 storeys (45m) | Mid-Rise Standards 2024 |
| Rear setback (<6 st) | 7.5m (25ft) | Mid-Rise Standards 2024 |
| Rear setback (7-11 st) | 10.0m (33ft) | Mid-Rise Standards 2024 |
| MTSA min density <200m | FSI 8 | Provincial OPA 2025 |
| MTSA min density 200-500m | FSI 6 | Provincial OPA 2025 |
| CBC cap | 4% of land value | Municipal Act |
| IZ requirement (PMTSA) | 5% of units | Planning Act |
| Shadow test date | March 21 | Official Plan 3.1.2 |
| Typical storey height | 3.0m (10ft) | Industry standard |
| GF commercial height | 4.5m (15ft) | Guideline minimum |
| Residential efficiency | 82-85% | Industry standard |
