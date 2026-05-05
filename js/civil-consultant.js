// civil-consultant.js — GTHA site-servicing calculation engine
// =============================================================================
// Implementation of the formulas documented in skills/civil-consultant/SKILL.md
//
// Public API: window.CivilConsultant (alias: window.CC)
//   CC.waterDemand(input)         — average + peak water demand
//   CC.fireFlowFUS(input)         — Fire Underwriters Survey 1999 method
//   CC.sanitaryWithIandI(input)   — sanitary peak flow with I&I
//   CC.stormwaterTGS(input)       — Toronto Green Standard tier-aware stormwater
//   CC.electricalLoadCEC(input)   — Ontario Electrical Code §8 multi-residential
//   CC.gasDemandEnbridge(input)   — Enbridge Gas peak demand
//   CC.watermainAvailableFlow(input) — pressure-aware fire-flow availability
//   CC.manningCircularFull(input) — gravity-pipe full-flow capacity
//   CC.idfToronto(returnYr, durMin) — Toronto IDF lookup with climate factor
//
// Every function returns:
//   {
//     value:      <primary numeric result>,
//     unit:       <SI unit string>,
//     formula:    <human-readable formula>,
//     citation:   <source standard>,
//     confidence: 'SCREENING' | 'PRELIMINARY' | 'FSR-DRAFT',
//     inputs:     <echoed back for audit>,
//     breakdown:  <intermediate values>,
//     notes:      [<caveats>]
//   }
//
// All math is pure (no DOM access) so each function is independently testable.
// =============================================================================

(function(){
  'use strict';

  var STANDARD_DISCLAIMER =
    'Screening estimate per civil-consultant skill v1. Formulas from FUS 1999, ' +
    'MECP 2008, Toronto Water Design Criteria 2009, Ontario Electrical Code §8, ' +
    'Toronto Green Standard v4. Not a substitute for a sealed Functional ' +
    'Servicing Report by a P.Eng. licensed in Ontario.';

  // ── 1. WATER DEMAND ────────────────────────────────────────────────────────
  // Per-jurisdiction average-day per-capita rates (L/cap/day)
  var WATER_RATES = {
    toronto:    365,
    peel:       350,
    york:       350,
    halton:     400,
    durham:     365,
    hamilton:   425,
    mecp_min:   225,
    mecp_max:   450
  };

  // ICI (institutional/commercial/industrial) demand rates
  var ICI_RATES_L_PER_100M2_DAY = {
    office:           50,
    retail:           75,
    restaurant:      250,
    hotel:           380,    // note: per room, not per m²
    school_elem:      75,    // per student
    school_sec:      100,    // per student
    hospital:       1300,    // per bed
    industrial_light: 50,
    industrial_heavy: 0      // process-specific
  };

  // Population per residential unit by built form
  var PPL_PER_UNIT = {
    toronto_high_rise:   2.0,
    toronto_mid_rise:    2.2,
    toronto_default:     2.4,
    suburban_townhouse:  3.0,
    suburban_detached:   3.3
  };

  // Peaking factors for water (Toronto criteria, applicable GTHA-wide as default)
  var WATER_PEAK = { maxDay: 2.5, peakHour: 4.0, fireFlow: 1.5 };

  /**
   * Compute residential + non-residential water demand.
   * @param {Object} i
   *   i.units            : residential unit count
   *   i.commGFA_m2       : commercial GFA in m²
   *   i.jurisdiction     : 'toronto'|'peel'|'york'|'halton'|'durham'|'hamilton'
   *   i.builtForm        : key from PPL_PER_UNIT (default 'toronto_default')
   *   i.iciType          : key from ICI_RATES_L_PER_100M2_DAY (default 'office')
   *   i.iciCount         : if iciType is per-room/per-student/per-bed, supply count
   */
  function waterDemand(i){
    i = i || {};
    var units    = +i.units || 0;
    var commGFA  = +i.commGFA_m2 || 0;
    var jur      = (i.jurisdiction || 'toronto').toLowerCase();
    var builtForm = i.builtForm || 'toronto_default';
    var iciType  = i.iciType || 'office';
    var iciCount = +i.iciCount || 0;
    var notes = [];
    var rate = WATER_RATES[jur];
    if(rate == null){ rate = WATER_RATES.toronto; notes.push('Unknown jurisdiction "' + i.jurisdiction + '" — using Toronto rate (365 L/cap/day).'); }
    var pplPerUnit = PPL_PER_UNIT[builtForm] || PPL_PER_UNIT.toronto_default;
    var population = units * pplPerUnit;

    var resDemand_Lpd = population * rate;

    // ICI demand: uses per-100m² rate unless type is per-count
    var iciDemand_Lpd = 0;
    if(iciType === 'school_elem' || iciType === 'school_sec' || iciType === 'hospital' || iciType === 'hotel'){
      // Per-occupant rate
      iciDemand_Lpd = iciCount * ICI_RATES_L_PER_100M2_DAY[iciType];
    } else {
      // Per-100m² rate × commGFA
      iciDemand_Lpd = (commGFA / 100) * ICI_RATES_L_PER_100M2_DAY[iciType];
    }

    var avgDay_Lpd  = resDemand_Lpd + iciDemand_Lpd;
    var maxDay_Lpd  = avgDay_Lpd * WATER_PEAK.maxDay;
    var peakHour_Lpd = avgDay_Lpd * WATER_PEAK.peakHour;

    return {
      value: maxDay_Lpd,
      unit: 'L/day',
      formula: 'Avg-day = (units × ppl/unit × ' + rate + ' L/cap/day) + ICI; Max-day = avg × 2.5; Peak hour = avg × 4.0',
      citation: jur === 'toronto' ? 'Toronto Water Servicing & Wastewater System Design Criteria 2009' :
                jur === 'peel'    ? 'Region of Peel Linear Infrastructure Design Criteria 2018' :
                jur === 'york'    ? 'Region of York Water and Wastewater Servicing Standards 2014' :
                jur === 'halton'  ? 'Region of Halton Linear Servicing Standards' :
                jur === 'durham'  ? 'Region of Durham Servicing Criteria' :
                jur === 'hamilton'? 'City of Hamilton Comprehensive Development Guidelines' :
                'MECP Design Guidelines for Drinking-Water Systems 2008',
      confidence: 'PRELIMINARY',
      inputs: {units: units, commGFA_m2: commGFA, jurisdiction: jur, builtForm: builtForm, iciType: iciType, iciCount: iciCount},
      breakdown: {
        population: Math.round(population),
        per_capita_rate_Lpd: rate,
        residential_demand_Lpd: Math.round(resDemand_Lpd),
        ici_demand_Lpd: Math.round(iciDemand_Lpd),
        avg_day_Lpd: Math.round(avgDay_Lpd),
        max_day_Lpd: Math.round(maxDay_Lpd),
        peak_hour_Lpd: Math.round(peakHour_Lpd),
        peak_hour_Lps: +(peakHour_Lpd / 86400).toFixed(2)
      },
      notes: notes.concat([
        'Service connection size governed by max(peak hour demand, max-day + fire flow).',
        STANDARD_DISCLAIMER
      ])
    };
  }

  // ── 2. FIRE FLOW (FUS 1999) ────────────────────────────────────────────────
  var FUS_C = {
    wood_frame:        1.5,
    ordinary:          1.0,
    non_combustible:   0.8,
    fire_resistive:    0.6
  };
  var FUS_HAZARD = {
    light:     1.00,    // residential, office, hotel
    ordinary:  1.15,    // mercantile, light manufacturing
    extra:     1.50     // high-piled storage, paint, woodworking (mid-range of 1.25–1.75)
  };
  var FUS_SPRINKLER = {
    none:    0,
    nfpa13r: 0.30,
    nfpa13:  0.50
  };

  /**
   * @param i
   *   i.gfa_m2           : total above-grade floor area (m²)
   *   i.storeys          : storeys above grade
   *   i.construction     : key from FUS_C
   *   i.occupancyHazard  : 'light'|'ordinary'|'extra'
   *   i.sprinklered      : 'none'|'nfpa13r'|'nfpa13'
   *   i.exposures_m      : array of distances to neighbour buildings on each side (m)
   */
  function fireFlowFUS(i){
    i = i || {};
    var A = +i.gfa_m2 || 0;
    var n = +i.storeys || 1;
    var C = FUS_C[i.construction] || FUS_C.ordinary;
    var hazardMult = FUS_HAZARD[i.occupancyHazard] || FUS_HAZARD.light;
    var sprinklerCredit = FUS_SPRINKLER[i.sprinklered] || 0;
    var exposures = Array.isArray(i.exposures_m) ? i.exposures_m : [];
    var notes = [];

    // Base fire flow: F = 220 · C · √A
    var F_base_Lpm = 220 * C * Math.sqrt(A);

    // Storey adjustment factor: (1 − 0.5 · √n) only valid for n ≥ 1; FUS clamps low n
    // Strictly the n term in the original FUS is for "number of storeys above grade
    // included in the fire compartment". We apply it as a small downward correction.
    // Per FUS: replace base eqn for low-rise; for high-rise treat fire compartment.
    // Pragmatic approximation:
    var storeyFactor = 1 - 0.5 * Math.sqrt(Math.max(0, n - 1));
    storeyFactor = Math.max(0.5, Math.min(1.0, storeyFactor));
    var F_after_storey = F_base_Lpm * storeyFactor;

    // Hazard multiplier
    var F_after_hazard = F_after_storey * hazardMult;

    // Sprinkler credit (subtractive)
    var F_after_sprinkler = F_after_hazard * (1 - sprinklerCredit);

    // Exposure surcharges
    var exposureSurcharge = 0;
    var exposureBreakdown = exposures.map(function(d){
      var s = 0;
      if(d == null) return {distance_m: null, surcharge: 0};
      d = +d;
      if(d <= 3) s = 0.25;
      else if(d <= 10) s = 0.20;
      else if(d <= 20) s = 0.15;
      else if(d <= 30) s = 0.10;
      else if(d <= 45) s = 0.05;
      else s = 0;
      exposureSurcharge += s;
      return {distance_m: d, surcharge: s};
    });
    var F_with_exposures = F_after_sprinkler * (1 + exposureSurcharge);

    // Cap at 45,000 L/min (750 L/s); floor at 2,000 L/min (33 L/s)
    var F_required = Math.min(45000, Math.max(2000, F_with_exposures));
    if(F_with_exposures > 45000) notes.push('Calculated flow exceeded 45,000 L/min cap; verify with AHJ.');
    if(F_with_exposures < 2000) notes.push('Floor of 2,000 L/min applied per OBC minimum for Group C/D.');

    // Required duration (FUS table)
    var duration_hr =
      F_required < 7500  ? 1.5 :
      F_required < 15000 ? 2.0 :
      F_required < 22500 ? 2.5 :
      3.0;

    return {
      value: F_required,
      unit: 'L/min',
      formula: 'F = 220 · C · √A · storey_factor · hazard · (1 − sprinkler) · (1 + Σ exposure_surcharge)',
      citation: 'Fire Underwriters Survey, Water Supply for Public Fire Protection (1999)',
      confidence: 'PRELIMINARY',
      inputs: {gfa_m2: A, storeys: n, construction: i.construction, occupancyHazard: i.occupancyHazard, sprinklered: i.sprinklered, exposures_m: exposures},
      breakdown: {
        C_factor: C,
        F_base_Lpm: Math.round(F_base_Lpm),
        storey_factor: +storeyFactor.toFixed(3),
        hazard_mult: hazardMult,
        sprinkler_credit: sprinklerCredit,
        exposure_total_surcharge: +exposureSurcharge.toFixed(2),
        exposure_breakdown: exposureBreakdown,
        F_required_Lpm: Math.round(F_required),
        F_required_Lps: +(F_required / 60).toFixed(1),
        required_duration_hr: duration_hr
      },
      notes: notes.concat([
        'Hydrant placement: ≤ 90 m from frontage / ≤ 150 m from rear (Toronto Fire Services).',
        STANDARD_DISCLAIMER
      ])
    };
  }

  // ── 3. SANITARY SEWER (with I&I) ───────────────────────────────────────────
  var SAN_RETURN = { toronto: 0.90, peel: 0.90, york: 0.80, halton: 0.85, durham: 0.85, hamilton: 0.85 };
  var SAN_INFILT_LpsHa = {
    new_separate:  0.10,
    old_separate:  0.286,    // Toronto default
    combined:      0.50      // base; storm inflow handled separately
  };

  /**
   * @param i
   *   i.avgDayWater_Lpd : average-day water demand (from waterDemand result)
   *   i.population      : total population (or compute from units × ppl/unit)
   *   i.units           : alternative: residential units (with builtForm)
   *   i.builtForm       : if computing from units
   *   i.catchmentArea_ha: drainage area contributing I&I (default = lot area)
   *   i.sewerType       : 'new_separate'|'old_separate'|'combined'
   *   i.jurisdiction    : for return ratio
   */
  function sanitaryWithIandI(i){
    i = i || {};
    var jur = (i.jurisdiction || 'toronto').toLowerCase();
    var returnRatio = SAN_RETURN[jur] || SAN_RETURN.toronto;
    var avgWater = +i.avgDayWater_Lpd || 0;
    var population = +i.population || 0;
    if(population === 0 && i.units){
      var pplPerUnit = PPL_PER_UNIT[i.builtForm] || PPL_PER_UNIT.toronto_default;
      population = (+i.units || 0) * pplPerUnit;
    }
    var catchment_ha = +i.catchmentArea_ha || 0.1;
    var sewerType = i.sewerType || 'old_separate';
    var infiltRate = SAN_INFILT_LpsHa[sewerType] || SAN_INFILT_LpsHa.old_separate;

    // ADWF in L/day
    var ADWF_Lpd = avgWater * returnRatio;

    // Harmon peaking factor (P in thousands)
    var P_thousands = Math.max(0.001, population / 1000);
    var harmon = 1 + 14 / (4 + Math.sqrt(P_thousands));
    harmon = Math.max(1.5, Math.min(harmon, 4.0));

    // Peak dry weather flow
    var PDWF_Lps = (ADWF_Lpd * harmon) / 86400;

    // Infiltration component
    var infilt_Lps = infiltRate * catchment_ha;

    // Total peak design flow
    var totalPeak_Lps = PDWF_Lps + infilt_Lps;

    return {
      value: totalPeak_Lps,
      unit: 'L/s',
      formula: 'Peak = (avg_water × return_ratio × Harmon_PF) / 86400 + I&I_rate × catchment_ha',
      citation: 'MECP Design Guidelines for Sewage Works 2008; Toronto Water Design Criteria 2009',
      confidence: 'PRELIMINARY',
      inputs: {avgDayWater_Lpd: avgWater, population: population, catchmentArea_ha: catchment_ha, sewerType: sewerType, jurisdiction: jur},
      breakdown: {
        return_ratio: returnRatio,
        ADWF_Lpd: Math.round(ADWF_Lpd),
        ADWF_Lps: +(ADWF_Lpd / 86400).toFixed(3),
        harmon_PF: +harmon.toFixed(2),
        PDWF_Lps: +PDWF_Lps.toFixed(2),
        infiltration_rate_Lps_ha: infiltRate,
        infiltration_Lps: +infilt_Lps.toFixed(3),
        total_peak_Lps: +totalPeak_Lps.toFixed(2),
        total_peak_m3pd: +(totalPeak_Lps * 86.4).toFixed(1)
      },
      notes: [
        sewerType === 'combined' ? 'Combined sewer: Toronto WWFMP requires post-development flow not to exceed pre-development. Storm retention may be mandatory.' : '',
        'Design pipe at < 75% depth at peak design flow per Toronto criteria.',
        STANDARD_DISCLAIMER
      ].filter(Boolean)
    };
  }

  // ── 4. STORMWATER (Toronto Green Standard) ─────────────────────────────────
  var TGS_QUALITY_CAPTURE_MM = { 1: 5, 2: 10, 3: 15, 4: 25 };
  var TORONTO_IDF_MM_HR_1HR = {
    2:   19,
    5:   26,
    10:  32,
    25:  40,
    50:  47,
    100: 58
  };
  // Climate change adjustment factor per Toronto guidance (2022)
  var CLIMATE_ADJUST = 1.20;

  /**
   * @param i
   *   i.lotArea_m2         : total lot area (m²)
   *   i.imperviousArea_m2  : impervious area (building + paving)
   *   i.tgsTier            : 1|2|3|4
   *   i.designReturnYr     : 2|5|10|25|50|100 (default 100)
   *   i.preDev_C           : pre-development runoff coefficient (default 0.20)
   */
  function stormwaterTGS(i){
    i = i || {};
    var lotArea = +i.lotArea_m2 || 0;
    var impArea = +i.imperviousArea_m2 || 0;
    var tier = +i.tgsTier || 1;
    var returnYr = +i.designReturnYr || 100;
    var preC = +i.preDev_C || 0.20;
    var perv = Math.max(0, lotArea - impArea);

    var qualityDepth_mm = TGS_QUALITY_CAPTURE_MM[tier] || 5;
    var qualityVol_m3 = (qualityDepth_mm / 1000) * impArea;

    // Erosion: 25 mm 24-hr extended detention
    var erosionVol_m3 = 0.025 * impArea;

    // Quantity: pre vs post peak (rational method, sites < 1 ha only)
    var i_mm_hr = (TORONTO_IDF_MM_HR_1HR[returnYr] || 58) * CLIMATE_ADJUST;
    var i_m_per_s = i_mm_hr / 1000 / 3600;
    var totalArea_m2 = lotArea;
    var weightedC_post = lotArea > 0 ? (impArea * 0.95 + perv * 0.20) / lotArea : 0.95;
    var Q_pre_m3s  = preC * i_m_per_s * totalArea_m2;
    var Q_post_m3s = weightedC_post * i_m_per_s * totalArea_m2;
    var attenuationNeeded_m3s = Math.max(0, Q_post_m3s - Q_pre_m3s);

    var notes = [];
    if(lotArea > 10000){
      notes.push('Site > 1 ha: Rational method shown for screening; Toronto requires PCSWMM or SWMHYMO continuous-simulation modelling.');
    }
    if(impArea > 3000){
      notes.push('Site > 3,000 m² impervious: Conservation Authority Section 28 approval likely required (TRCA/CVC/etc).');
    }

    return {
      value: qualityVol_m3,
      unit: 'm³',
      formula: 'V_quality = (TGS_depth_mm / 1000) × impervious_area_m2; Q_pre/post = C × i × A',
      citation: 'Toronto Wet Weather Flow Master Plan; Toronto Green Standard v4',
      confidence: 'PRELIMINARY',
      inputs: {lotArea_m2: lotArea, imperviousArea_m2: impArea, tgsTier: tier, designReturnYr: returnYr, preDev_C: preC},
      breakdown: {
        tgs_quality_depth_mm: qualityDepth_mm,
        quality_retention_m3: +qualityVol_m3.toFixed(1),
        erosion_24hr_m3: +erosionVol_m3.toFixed(1),
        impervious_pct: lotArea > 0 ? +(impArea/lotArea*100).toFixed(0) : 0,
        weighted_post_C: +weightedC_post.toFixed(2),
        intensity_mm_hr_climate_adj: +i_mm_hr.toFixed(1),
        Q_pre_m3s:  +Q_pre_m3s.toFixed(3),
        Q_post_m3s: +Q_post_m3s.toFixed(3),
        attenuation_needed_m3s: +attenuationNeeded_m3s.toFixed(3),
        attenuation_needed_Lps: +(attenuationNeeded_m3s * 1000).toFixed(1)
      },
      notes: notes.concat([STANDARD_DISCLAIMER])
    };
  }

  // ── 5. ELECTRICAL (CEC §8) ─────────────────────────────────────────────────
  // Diversification factor: largest suite + DF × (others)
  function _diversificationFactor(units){
    if(units <= 1) return 1.00;
    if(units <= 2) return 0.65;
    if(units <= 5) return 0.65;
    if(units <= 10) return 0.60;
    if(units <= 20) return 0.55;
    if(units <= 30) return 0.50;
    return 0.45;
  }

  /**
   * @param i
   *   i.units            : residential unit count
   *   i.suiteSize_m2     : average suite size (m²)
   *   i.electricHeat     : boolean (1,250 W/m² heated area)
   *   i.electricHotWater : boolean
   *   i.electricRange    : boolean (default true)
   *   i.evReadyOutlets   : count of Level 2 EV outlets (per TGS)
   *   i.commercialGFA_m2 : commercial GFA
   *   i.commonAreaGFA_m2 : corridor + amenity + garage common area
   *   i.elevators        : number of elevators
   */
  function electricalLoadCEC(i){
    i = i || {};
    var units = +i.units || 0;
    var suite_m2 = +i.suiteSize_m2 || 65;
    var heat = !!i.electricHeat;
    var hotWater = !!i.electricHotWater;
    var range = i.electricRange !== false;       // default true
    var evOutlets = +i.evReadyOutlets || 0;
    var commGFA = +i.commercialGFA_m2 || 0;
    var commonGFA = +i.commonAreaGFA_m2 || 0;
    var elevators = +i.elevators || 0;

    // Per-suite load (W)
    var perSuite_W = 4500;                                    // base
    perSuite_W += Math.min(90, suite_m2) * 100;               // first 90 m² × 100 W/m²
    if(suite_m2 > 90) perSuite_W += (suite_m2 - 90) * 25;     // additional × 25 W/m²
    if(heat)      perSuite_W += suite_m2 * 1250;              // electric heat
    if(hotWater)  perSuite_W += 1500;                         // tankless DHW
    if(range)     perSuite_W += 6000;                         // electric range

    // Diversification (largest at 100% + remainder × DF)
    var df = _diversificationFactor(units);
    var diversified_W;
    if(units <= 1){
      diversified_W = perSuite_W;
    } else {
      diversified_W = perSuite_W + (units - 1) * perSuite_W * df;
    }

    // EV charging is added at 100% (shared among outlets via EV management system,
    // so not full diversification — Toronto Hydro typically allows 25% diversity factor
    // across an EV-managed system)
    var evDF = 0.25;
    var ev_W = evOutlets * 7200 * evDF;

    // Commercial: 80 W/m² typical (lighting + HVAC + plug loads, fully diversified)
    var commercial_W = commGFA * 80;

    // Common-area: corridor lighting (5 W/m²) + makeup air + pumps (≈ 20 W/m²)
    var common_W = commonGFA * 25;

    // Elevators
    var elevator_W = elevators * 25000;

    var total_W = diversified_W + ev_W + commercial_W + common_W + elevator_W;
    var total_kVA = total_W / 1000 / 0.95;        // assume 0.95 power factor

    var serviceClass =
      total_kVA < 200       ? 'Pad-mount transformer in property easement' :
      total_kVA < 1500      ? 'Pad-mount or vault transformer; primary metering' :
      total_kVA < 5000      ? 'Customer-owned vault or dedicated substation' :
                              'Dedicated substation (possibly 27.6 kV)';

    return {
      value: total_kVA,
      unit: 'kVA',
      formula: 'Per-suite = 4500W + min(90,A)×100 + max(0,A−90)×25 + heat + range + DHW; Total = suite_largest + (n−1)×DF + EV + comm + common + elevators',
      citation: 'Ontario Electrical Code Part 2 §8 (current edition)',
      confidence: 'PRELIMINARY',
      inputs: {units: units, suiteSize_m2: suite_m2, electricHeat: heat, electricHotWater: hotWater, electricRange: range, evReadyOutlets: evOutlets, commercialGFA_m2: commGFA, commonAreaGFA_m2: commonGFA, elevators: elevators},
      breakdown: {
        per_suite_W: Math.round(perSuite_W),
        per_suite_kW: +(perSuite_W / 1000).toFixed(1),
        diversification_factor: df,
        diversified_residential_kW: +(diversified_W / 1000).toFixed(0),
        ev_charging_kW: +(ev_W / 1000).toFixed(1),
        commercial_kW: +(commercial_W / 1000).toFixed(1),
        common_area_kW: +(common_W / 1000).toFixed(1),
        elevator_kW: +(elevator_W / 1000).toFixed(0),
        total_kW: +(total_W / 1000).toFixed(0),
        total_kVA: +total_kVA.toFixed(0),
        service_classification: serviceClass
      },
      notes: [
        'Toronto Hydro Customer Connection Application required for any service > 200 amp; expect 12–24 weeks.',
        'TGS v4: 20% Tier 1 / 50% Tier 2 / 100% Tier 3 of resident parking spaces require EV-ready rough-in.',
        STANDARD_DISCLAIMER
      ]
    };
  }

  // ── 6. NATURAL GAS (Enbridge) ──────────────────────────────────────────────
  /**
   * @param i
   *   i.units      : residential unit count
   *   i.applianceMix : 'cooking_only'|'dhw_cooking'|'full_gas'  (default full_gas)
   */
  function gasDemandEnbridge(i){
    i = i || {};
    var units = +i.units || 0;
    var mix = i.applianceMix || 'full_gas';

    var perUnit_m3hr =
      mix === 'cooking_only' ? 0.5 :
      mix === 'dhw_cooking'  ? 1.8 :
      mix === 'full_gas'     ? 4.0 :
                                4.0;
    // Diversification by count
    var df =
      units <=  10 ? 1.00 :
      units <=  25 ? 0.85 :
      units <=  50 ? 0.75 :
      units <= 100 ? 0.65 :
                     0.55;
    var peak_m3hr = units * perUnit_m3hr * df;

    var serviceSize =
      peak_m3hr < 30  ? '25 mm PE' :
      peak_m3hr < 80  ? '50 mm PE' :
      peak_m3hr < 250 ? '100 mm PE/steel' :
                        '150 mm steel + regulator';

    return {
      value: peak_m3hr,
      unit: 'm³/hr',
      formula: 'Peak = units × per_unit_rate × diversification_factor',
      citation: 'Enbridge Gas Distribution design typical practice',
      confidence: 'SCREENING',
      inputs: {units: units, applianceMix: mix},
      breakdown: {
        per_unit_m3hr: perUnit_m3hr,
        diversification_factor: df,
        peak_m3hr: +peak_m3hr.toFixed(1),
        service_size: serviceSize
      },
      notes: [
        'Enbridge application 8–16 weeks. Sites without an existing main on frontage may face long extensions or refusal.',
        'TGS Tier 2+ may eliminate gas (electrification): confirm with mechanical strategy before sizing.',
        STANDARD_DISCLAIMER
      ]
    };
  }

  // ── 7. WATERMAIN AVAILABLE FLOW (AWWA M14 extrapolation) ──────────────────
  /**
   * Estimate available fire flow at residual pressure floor, given a static
   * pressure and a hypothetical / measured flow at higher residual.
   * Use when no witnessed hydrant test is available.
   * @param i
   *   i.staticPSI            : static pressure at hydrant (psi)
   *   i.residualMinPSI       : minimum required residual (default 20 psi / 140 kPa)
   *   i.testFlowLpm          : test flow rate (L/min) — if no test, estimate via continuity
   *   i.residualAtTestPSI    : residual pressure during test (psi)
   *   i.pipeDiaMM            : nearest pipe diameter (for continuity-based estimate)
   *   i.designVelocity_mps   : default 1.5 m/s
   */
  function watermainAvailableFlow(i){
    i = i || {};
    var staticP = +i.staticPSI || 0;
    var resMin = +i.residualMinPSI || 20;
    var testFlow = +i.testFlowLpm || 0;
    var resTest = +i.residualAtTestPSI || 0;
    var dia = +i.pipeDiaMM || 0;
    var v = +i.designVelocity_mps || 1.5;

    var usedMethod = '';
    var available_Lpm = 0;
    var notes = [];

    if(testFlow > 0 && resTest > 0 && staticP > resTest){
      // AWWA M14 extrapolation
      var ratio = (staticP - resMin) / (staticP - resTest);
      available_Lpm = testFlow * Math.pow(ratio, 0.54);
      usedMethod = 'AWWA M14 pressure extrapolation';
    } else if(dia > 0){
      // Fall back to continuity-based ceiling
      var areaM2 = Math.PI * Math.pow(dia/2000, 2);
      available_Lpm = areaM2 * v * 1000 * 60;        // L/s × 60
      usedMethod = 'Continuity Q = v × A (no pressure data — ceiling only)';
      notes.push('Without a witnessed flow test, available flow is unknown. Continuity result is an UPPER BOUND only — actual deliverable flow depends on pressure zone HGL and upstream network head loss.');
    } else {
      available_Lpm = 0;
      usedMethod = 'Insufficient input';
      notes.push('Provide either (testFlowLpm + residualAtTestPSI + staticPSI) or pipeDiaMM.');
    }

    return {
      value: available_Lpm,
      unit: 'L/min',
      formula: testFlow > 0 ? 'Q_avail = Q_test × ((P_static − P_resMin) / (P_static − P_resTest))^0.54' :
                              'Q_ceiling = π × (D/2)² × v',
      citation: 'AWWA M14 Recommended Practice / AWWA C150 design velocity',
      confidence: testFlow > 0 ? 'PRELIMINARY' : 'SCREENING',
      inputs: {staticPSI: staticP, residualMinPSI: resMin, testFlowLpm: testFlow, residualAtTestPSI: resTest, pipeDiaMM: dia, designVelocity_mps: v},
      breakdown: {
        method: usedMethod,
        available_Lpm: Math.round(available_Lpm),
        available_Lps: +(available_Lpm / 60).toFixed(1)
      },
      notes: notes.concat([
        'Real FSR submissions require a witnessed hydrant flow test by Toronto Water (or Region equivalent).',
        STANDARD_DISCLAIMER
      ])
    };
  }

  // ── 8. MANNING (gravity pipe full flow) ────────────────────────────────────
  /**
   * @param i
   *   i.diameterMM   : pipe diameter (mm)
   *   i.slope_pct    : pipe slope (%) e.g., 0.5 for 0.5%
   *   i.material     : 'concrete'|'pvc'|'hdpe'  (default concrete)
   */
  function manningCircularFull(i){
    i = i || {};
    var D_m = (+i.diameterMM || 0) / 1000;
    var S = (+i.slope_pct || 0) / 100;
    var n_map = { concrete: 0.013, pvc: 0.012, hdpe: 0.011 };
    var n = n_map[i.material] || 0.013;

    if(D_m <= 0 || S <= 0){
      return {value: 0, unit: 'L/s', formula: 'Q = (1/n) · A · R^(2/3) · S^(1/2)', citation: 'Manning equation', confidence: 'PRELIMINARY', inputs: i, breakdown: {error: 'invalid input'}, notes: ['Provide diameterMM > 0 and slope_pct > 0.']};
    }

    var A = Math.PI * Math.pow(D_m/2, 2);
    var P = Math.PI * D_m;                            // wetted perimeter (full flow)
    var R = A / P;                                    // = D/4 for full circular
    var Q_full_m3s = (1/n) * A * Math.pow(R, 2/3) * Math.pow(S, 0.5);
    var Q_design_m3s = Q_full_m3s * 0.75;             // design at 75% capacity (per Toronto)

    return {
      value: Q_design_m3s * 1000,
      unit: 'L/s',
      formula: 'Q_full = (1/n) · A · R^(2/3) · S^(1/2);  Q_design = 0.75 × Q_full',
      citation: 'Manning equation (1889) / Toronto Water Design Criteria 2009',
      confidence: 'PRELIMINARY',
      inputs: {diameterMM: i.diameterMM, slope_pct: i.slope_pct, material: i.material || 'concrete'},
      breakdown: {
        n_value: n,
        area_m2: +A.toFixed(4),
        hydraulic_radius_m: +R.toFixed(4),
        Q_full_m3s: +Q_full_m3s.toFixed(3),
        Q_full_Lps: +(Q_full_m3s * 1000).toFixed(1),
        Q_design_m3s: +Q_design_m3s.toFixed(3),
        Q_design_Lps: +(Q_design_m3s * 1000).toFixed(1)
      },
      notes: [
        'Toronto criteria: design at < 75% depth at peak design flow.',
        STANDARD_DISCLAIMER
      ]
    };
  }

  // ── 9. TORONTO IDF LOOKUP ──────────────────────────────────────────────────
  /**
   * Returns rainfall intensity (mm/hr) for given return period and 1-hour
   * duration, with climate-change adjustment applied per Toronto guidance.
   * @param returnYr  2|5|10|25|50|100
   * @param applyClimateAdjust  default true
   */
  function idfToronto(returnYr, applyClimateAdjust){
    var base = TORONTO_IDF_MM_HR_1HR[returnYr] || TORONTO_IDF_MM_HR_1HR[100];
    var adj = applyClimateAdjust !== false ? CLIMATE_ADJUST : 1.0;
    return {
      value: base * adj,
      unit: 'mm/hr',
      formula: 'IDF base × climate_adjust (1.20)',
      citation: 'Environment and Climate Change Canada, Bloor Street rain gauge; Toronto climate guidance 2022',
      confidence: 'PRELIMINARY',
      inputs: {returnYr: returnYr, applyClimateAdjust: applyClimateAdjust !== false},
      breakdown: {base_intensity_mm_hr: base, climate_adjust_factor: adj, adjusted_intensity_mm_hr: +(base * adj).toFixed(1)},
      notes: [
        'Use ECCC IDF curves for actual gauge nearest the site for design.',
        STANDARD_DISCLAIMER
      ]
    };
  }

  // ── EXPORT ─────────────────────────────────────────────────────────────────
  var CC = {
    waterDemand:           waterDemand,
    fireFlowFUS:           fireFlowFUS,
    sanitaryWithIandI:     sanitaryWithIandI,
    stormwaterTGS:         stormwaterTGS,
    electricalLoadCEC:     electricalLoadCEC,
    gasDemandEnbridge:     gasDemandEnbridge,
    watermainAvailableFlow: watermainAvailableFlow,
    manningCircularFull:   manningCircularFull,
    idfToronto:            idfToronto,
    // Constants exposed for tools that want to display source values
    CONSTANTS: {
      WATER_RATES: WATER_RATES,
      ICI_RATES_L_PER_100M2_DAY: ICI_RATES_L_PER_100M2_DAY,
      PPL_PER_UNIT: PPL_PER_UNIT,
      WATER_PEAK: WATER_PEAK,
      FUS_C: FUS_C,
      FUS_HAZARD: FUS_HAZARD,
      FUS_SPRINKLER: FUS_SPRINKLER,
      SAN_RETURN: SAN_RETURN,
      SAN_INFILT_LpsHa: SAN_INFILT_LpsHa,
      TGS_QUALITY_CAPTURE_MM: TGS_QUALITY_CAPTURE_MM,
      TORONTO_IDF_MM_HR_1HR: TORONTO_IDF_MM_HR_1HR,
      CLIMATE_ADJUST: CLIMATE_ADJUST
    },
    DISCLAIMER: STANDARD_DISCLAIMER,
    VERSION: '1.0.0'
  };

  if(typeof window !== 'undefined'){
    window.CivilConsultant = CC;
    window.CC = CC;
    console.log('[CivilConsultant v1.0.0] GTHA servicing engine loaded. Methods: waterDemand, fireFlowFUS, sanitaryWithIandI, stormwaterTGS, electricalLoadCEC, gasDemandEnbridge, watermainAvailableFlow, manningCircularFull, idfToronto');
  }
  if(typeof module !== 'undefined' && module.exports){
    module.exports = CC;
  }
})();

/* =====================================================================
   PHASE 2 INTEGRATION: panel wrappers that delegate to CC
   These override the legacy calcStormwater + calcWaterCapacity that
   live in ui.js / analysis-tools.js, replacing rules-of-thumb with
   CC.stormwaterTGS + CC.watermainAvailableFlow / FUS.
   Loaded after the legacy versions, so last-define wins.
   ===================================================================== */
(function(){
  if(typeof window === 'undefined') return;
  var STD_DISC = (window.CC && window.CC.DISCLAIMER) ? window.CC.DISCLAIMER : '';

  // ── calcStormwater (CC version) ──
  // Stormwater impervious model:
  //   impArea  = lot area covered by building footprint (at grade)
  //              + paved fraction of any remaining margin
  //   greenRoofArea = podium green roof (auto, when podium+tower present)
  //                 + tower green roof (user toggle)
  //   Effective impervious = impArea − greenRoofArea × retention credit (0.6)
  //
  //   Retention credit 0.6 reflects extensive green roof performance per
  //   Toronto Green Standard guidance (60% rainfall retention typical for
  //   100mm substrate over filter membrane on a flat or low-slope roof).
  function _ccLotAreaSF(){
    /* CRITICAL: `P` is declared with `const` in data-model.js so it is NOT
       a property of `window` (only `var` declarations become window props
       in classic scripts). Use a `typeof` guard + bare-identifier access
       instead — that resolves through the global lexical environment that
       all classic scripts share. */
    var pRef = null;
    try { if(typeof P !== 'undefined' && P) pRef = P; } catch(e){ pRef = null; }
    var lotArea = 0;
    if(pRef && pRef.lot && pRef.lot.polyVerts && pRef.lot.polyVerts.length > 2){
      var v = pRef.lot.polyVerts;
      for(var i = 0; i < v.length; i++){
        var j = (i+1) % v.length;
        lotArea += v[i][0]*v[j][1] - v[j][0]*v[i][1];
      }
      lotArea = Math.abs(lotArea) / 2;
    }
    return lotArea || 10000;
  }
  function _polyAreaSF(poly){
    if(!Array.isArray(poly) || poly.length < 3) return 0;
    var a = 0;
    for(var k = 0; k < poly.length; k++){
      var n = (k + 1) % poly.length;
      a += poly[k][0] * poly[n][1] - poly[n][0] * poly[k][1];
    }
    return Math.abs(a) / 2;
  }

  // User toggle for tower green roof — persisted in localStorage
  function _getTowerGreenRoof(){
    try { return localStorage.getItem('cc_tower_green_roof') === '1'; } catch(e){ return false; }
  }
  function _setTowerGreenRoof(on){
    try { localStorage.setItem('cc_tower_green_roof', on ? '1' : '0'); } catch(e){}
  }
  window.toggleCCTowerGreenRoof = function(){
    var on = !_getTowerGreenRoof();
    _setTowerGreenRoof(on);
    // Trigger 3D rebuild so the renderer paints the green roof on the tower
    if(typeof rebuildAll === 'function'){
      try { rebuildAll(); } catch(e){ console.warn('[cc] rebuildAll failed:', e); }
    }
    if(typeof window.calcStormwater === 'function') window.calcStormwater();
    var btn = document.getElementById('cc-tower-green-btn');
    if(btn) btn.textContent = on ? '🌿 TOWER GREEN ROOF: ON' : '⬜ TOWER GREEN ROOF: OFF';
  };

  window.calcStormwater = function(){
    var el = document.getElementById('stormwater-results');
    if(!el) return;
    if(typeof CC === 'undefined'){
      el.innerHTML = '<div style="color:#ff8866">CivilConsultant not loaded.</div>';
      return;
    }
    var lotArea_sf = _ccLotAreaSF();
    var lotArea_m2 = lotArea_sf * 0.092903;

    /* Building footprint at grade — read with field-name fallbacks because
       different parts of the codebase store polygon data under different keys:
         - sitemap-volumes.js (Site-Plan tab):       v.customPoly + v.customAreaSF + v.widthFt + v.depthFt
         - renderer-components.js (3D scene):        v.customPolyLocal (transformed to local feet)
         - data-model legacy:                        v.width + v.depth (no Ft suffix)
       Try all variants so this works regardless of which tab created the volume. */
    function _volFootprintSF(v){
      // 1) Cached area is most reliable
      if(typeof v.customAreaSF === 'number' && v.customAreaSF > 0) return v.customAreaSF;
      // 2) Polygon shoelace (try both field names)
      if(v.customPoly && Array.isArray(v.customPoly) && v.customPoly.length >= 3){
        return _polyAreaSF(v.customPoly);
      }
      if(v.customPolyLocal && Array.isArray(v.customPolyLocal) && v.customPolyLocal.length >= 3){
        return _polyAreaSF(v.customPolyLocal);
      }
      // 3) Parametric width × depth (with both field-name conventions)
      var w = v.widthFt || v.width || 0;
      var d = v.depthFt || v.depth || 0;
      return w * d;
    }

    var bldgFP_sf = 0;
    var podiumRoofArea_sf = 0;
    var towerRoofArea_sf = 0;
    var totalRoofArea_sf = 0;     // sum of all topmost-roof footprints
    var diag = [];

    /* The project may store volumes in either P.vols (parametric / legacy)
       OR smVolumes (drawn via the Site Map tab). CRITICAL: both `P` (from
       data-model.js, declared with `const`) and `smVolumes` (from
       sitemap-lot.js, declared with `let`) are top-level lexical bindings —
       they are reachable as bare identifiers from any classic-script file
       but are NOT properties of `window` (a quirk of `let`/`const` at script
       top level vs. `var`). Resolve each via `typeof` to avoid ReferenceError
       in case load order is wrong. */
    var pRef = null;
    try {
      if(typeof P !== 'undefined' && P && Array.isArray(P.vols)) pRef = P;
    } catch(e){ pRef = null; }

    var smVolsRef = null;
    try {
      if(typeof smVolumes !== 'undefined' && Array.isArray(smVolumes)) smVolsRef = smVolumes;
    } catch(e){ smVolsRef = null; }

    var allVols = [];
    var pVolsLen = pRef ? pRef.vols.length : -1;
    var smVolsLen = smVolsRef ? smVolsRef.length : -1;
    if(pRef) allVols = allVols.concat(pRef.vols);
    if(smVolsRef){
      smVolsRef.forEach(function(sv){
        var dup = allVols.some(function(v){ return v.id === sv.id; });
        if(!dup) allVols.push(sv);
      });
    }
    console.log('[CC stormwater] container counts: P.vols='+pVolsLen+', smVolumes='+smVolsLen+', merged='+allVols.length);
    if(allVols.length === 0){
      console.log('[CC stormwater] NO VOLUMES FOUND — checking other possible sources...');
      console.log('  window.P keys:', window.P ? Object.keys(window.P).filter(function(k){return k.indexOf("vol")>=0||k.indexOf("Vol")>=0;}) : 'P undefined');
      console.log('  globals with vol:', Object.keys(window).filter(function(k){return /vol/i.test(k) && Array.isArray(window[k]);}));
    } else {
      console.log('[CC stormwater] first volume keys:', Object.keys(allVols[0]).filter(function(k){return !k.startsWith("_");}).join(', '));
    }

    if(allVols.length){
      allVols.forEach(function(v, idx){
        var fp = _volFootprintSF(v);
        var baseElev = v.baseElevFt || 0;
        diag.push({i: idx, name: v.name || 'V'+idx, fp_sf: Math.round(fp), baseElev: baseElev, podium: v.podiumStoreys || 0, stepback: v.stepbackAmt || 0, hasCustomPoly: !!(v.customPoly||v.customPolyLocal)});

        // Ground-level (baseElev <= 0.5 ft, i.e., at grade)
        if(baseElev < 0.5 && fp > bldgFP_sf) bldgFP_sf = fp;

        // Podium-roof exposed area (when stepback creates terrace)
        if(v.podiumStoreys > 0 && v.stepbackAmt > 0){
          var stepRatio = Math.min(0.6, v.stepbackAmt / 50);
          var thisPodium = fp * stepRatio;
          if(thisPodium > podiumRoofArea_sf) podiumRoofArea_sf = thisPodium;
        }

        // Tower roof area: prefer cached real polygon area from renderer
        if(v._towerRoofAreaSF && v._towerRoofAreaSF > towerRoofArea_sf){
          towerRoofArea_sf = v._towerRoofAreaSF;
        } else if(v.podiumStoreys > 0 && (v.floors || v.storeys || 0) > v.podiumStoreys){
          var tStep = Math.min(0.6, (v.stepbackAmt || 0) / 50);
          var thisTower = fp * (1 - tStep);
          if(thisTower > towerRoofArea_sf) towerRoofArea_sf = thisTower;
        } else if(!v.podiumStoreys && fp > towerRoofArea_sf){
          towerRoofArea_sf = fp;
        }

        totalRoofArea_sf += fp;
      });
    }

    // Diagnostic logging — appears in DevTools console for debugging
    if(typeof console !== 'undefined' && console.log){
      console.log('[CC stormwater] vols:', diag, '| bldgFP:', Math.round(bldgFP_sf), '| podium roof:', Math.round(podiumRoofArea_sf), '| tower roof:', Math.round(towerRoofArea_sf));
    }

    bldgFP_sf = Math.min(bldgFP_sf, lotArea_sf);

    // If no ground-level footprint detected on existing volumes, fall back
    // to the largest volume's footprint regardless of baseElev.
    if(bldgFP_sf === 0 && allVols.length > 0){
      allVols.forEach(function(v){
        var fp = _volFootprintSF(v);
        if(fp > bldgFP_sf) bldgFP_sf = fp;
      });
      bldgFP_sf = Math.min(bldgFP_sf, lotArea_sf);
    }

    // Worst-case assumption: NO building drawn yet. Default to building
    // covering the entire lot — this gives developers a conservative
    // stormwater estimate for early-stage planning (what's the maximum
    // retention I might need to design for?).
    var emptyProject = false;
    if(bldgFP_sf === 0 && allVols.length === 0){
      bldgFP_sf = lotArea_sf;     // assume full lot coverage
      emptyProject = true;
    }
    // Also: if the building polygon covers >95% of the lot, treat it as
    // a 100%-coverage worst case — the small unbuilt margin is rounding
    // and doesn't justify a 15% paving overhead.
    if(bldgFP_sf / lotArea_sf > 0.95 && !emptyProject){
      bldgFP_sf = lotArea_sf;
    }

    // Pavement on the unbuilt margin
    var unbuilt_sf = Math.max(0, lotArea_sf - bldgFP_sf);
    var pavement_sf = unbuilt_sf * 0.15;
    var imp_sf = bldgFP_sf + pavement_sf;

    // Green roof credit
    // Podium green roof: auto-present when podium exists (the renderer draws it).
    var podiumGreenOn = podiumRoofArea_sf > 0;
    // Tower green roof: user toggle.
    var towerGreenOn = _getTowerGreenRoof();
    var GREEN_ROOF_RETENTION = 0.60; // 60% rainfall retention per TGS guidance
    var greenRoofCredit_sf = 0;
    if(podiumGreenOn) greenRoofCredit_sf += podiumRoofArea_sf * GREEN_ROOF_RETENTION;
    if(towerGreenOn)  greenRoofCredit_sf += towerRoofArea_sf  * GREEN_ROOF_RETENTION;

    var effImp_sf = Math.max(0, imp_sf - greenRoofCredit_sf);
    var effImp_m2 = effImp_sf * 0.092903;

    var tgsTier = 1;
    var sw = CC.stormwaterTGS({lotArea_m2: lotArea_m2, imperviousArea_m2: effImp_m2, tgsTier: tgsTier, designReturnYr: 100, preDev_C: 0.20});

    var b = sw.breakdown;
    var color = b.attenuation_needed_Lps > 100 ? '#ff8866' : b.attenuation_needed_Lps > 30 ? '#ffaa44' : '#66ccaa';
    var conf = sw.confidence, confColor = '#66aaff';

    var html = '';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap"><span style="font-size:11px;padding:2px 8px;border-radius:3px;background:'+confColor+'20;color:'+confColor+';border:1px solid '+confColor+'40;font-weight:700">'+conf+'</span><span style="font-size:11px;color:#888">CC v'+CC.VERSION+' · TGS Tier '+tgsTier+'</span></div>';
    if(emptyProject){
      html += '<div style="margin-bottom:8px;padding:8px;background:rgba(255,170,68,0.10);border:1px solid #ffaa44;border-radius:4px;font-size:12px;color:#ffd58c"><strong>⚠ NO BUILDING DRAWN</strong> — showing worst-case scenario (100% lot coverage). Draw a building on the Site Map or place a volume on the Site Plan tab to refine this estimate.</div>';
    }

    // Tower green roof toggle button
    html += '<div style="margin-bottom:8px"><button id="cc-tower-green-btn" onclick="toggleCCTowerGreenRoof()" style="width:100%;padding:6px 10px;background:'+(towerGreenOn?'rgba(102,204,170,0.15)':'rgba(60,60,60,0.4)')+';border:1px solid '+(towerGreenOn?'#66ccaa':'#444')+';color:'+(towerGreenOn?'#66ccaa':'#aaa')+';border-radius:4px;font-size:12px;font-weight:700;cursor:pointer">'+(towerGreenOn?'🌿 TOWER GREEN ROOF: ON':'⬜ TOWER GREEN ROOF: OFF')+'</button></div>';

    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">';
    html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">'+b.impervious_pct+'%</div><div style="font-size:12px;color:#888">EFFECTIVE IMPERVIOUS</div></div>';
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">'+b.quality_retention_m3+' m³</div><div style="font-size:12px;color:#888">TGS QUALITY ('+b.tgs_quality_depth_mm+' mm)</div></div>';
    html += '<div style="background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffaa44">'+b.erosion_24hr_m3+' m³</div><div style="font-size:12px;color:#888">EROSION (25 mm)</div></div>';
    html += '<div style="background:rgba(255,68,68,0.08);border:1px solid '+color+'30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:'+color+'">'+b.attenuation_needed_Lps+' L/s</div><div style="font-size:12px;color:#888">ATTENUATION NEEDED</div></div>';
    html += '</div>';

    html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Lot area</td><td style="text-align:right">'+Math.round(lotArea_m2).toLocaleString()+' m²</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Building footprint at grade</td><td style="text-align:right">'+Math.round(bldgFP_sf*0.092903).toLocaleString()+' m² ('+Math.round(bldgFP_sf/lotArea_sf*100)+'%)</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pavement (15% of margin)</td><td style="text-align:right">'+Math.round(pavement_sf*0.092903).toLocaleString()+' m²</td></tr>';
    if(podiumGreenOn){
      html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#66ccaa">Podium green roof (auto)</td><td style="text-align:right;color:#66ccaa">'+Math.round(podiumRoofArea_sf*0.092903).toLocaleString()+' m² × 60%</td></tr>';
    }
    if(towerGreenOn){
      html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#66ccaa">Tower green roof (user)</td><td style="text-align:right;color:#66ccaa">'+Math.round(towerRoofArea_sf*0.092903).toLocaleString()+' m² × 60%</td></tr>';
    }
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Effective impervious area</td><td style="text-align:right">'+Math.round(effImp_m2).toLocaleString()+' m²</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Post-dev runoff coeff</td><td style="text-align:right">'+b.weighted_post_C+'</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Design intensity (100-yr, climate-adj)</td><td style="text-align:right">'+b.intensity_mm_hr_climate_adj+' mm/hr</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pre-dev peak flow</td><td style="text-align:right">'+b.Q_pre_m3s+' m³/s</td></tr>';
    html += '<tr><td style="padding:3px 0;color:#888">Post-dev peak flow</td><td style="text-align:right;color:#ff8866">'+b.Q_post_m3s+' m³/s</td></tr>';
    html += '</table>';

    html += '<div style="margin-top:8px;padding:6px;font-size:10px;color:#666;font-style:italic">'+sw.citation+'</div>';
    html += '<div style="margin-top:6px;padding:6px;background:rgba(102,204,170,0.06);border:1px solid #66ccaa30;border-radius:4px;font-size:11px;color:#aaa;line-height:1.5">';
    html += '<strong style="color:#66ccaa">Green roof retention factor: 60%</strong> per Toronto Green Standard guidance for 100mm-substrate extensive green roof. Toggle the tower roof above to model retrofit impact. Toronto Green Roof Bylaw (Municipal Code §492) mandates green roofs on new buildings ≥ 2,000 m² GFA: 20–60% of available roof area sliding scale.';
    html += '</div>';
    if(sw.notes && sw.notes.length){
      html += '<div style="margin-top:6px;padding:6px;background:rgba(255,170,68,0.06);border:1px solid #ffaa4420;border-radius:4px;font-size:11px;color:#aaa">';
      sw.notes.forEach(function(n){ if(n) html += '• ' + n + '<br>'; });
      html += '</div>';
    }
    el.innerHTML = html;
  };

  // ── calcWaterCapacity (CC version) ──
  // The legacy version remains in analysis-tools.js for direct DOM use; this
  // overrides it with CC-powered math. Reads pipe data from _infraData.watermain.
  window.calcWaterCapacity = function(){
    var el = document.getElementById('watercap-results');
    if(!el) return;
    if(typeof CC === 'undefined'){
      el.innerHTML = '<div style="color:#ff8866">CivilConsultant not loaded.</div>';
      return;
    }

    /* Demand from CC.waterDemand */
    var d = (typeof pfData === 'function') ? (pfData() || {}) : {};
    var totalUnits = d.totalUnits || 0;
    var commGFA = d.commGFA || 0;
    if(totalUnits === 0){
      /* P is `const` at module scope — not a window property. Resolve via typeof guard. */
      var _wcPRef = null;
      try { if(typeof P !== 'undefined' && P && Array.isArray(P.vols)) _wcPRef = P; } catch(e){ _wcPRef = null; }
      if(_wcPRef){
        _wcPRef.vols.forEach(function(v){
          if(v.use === 'residential' || v.use === 'mixed'){
            totalUnits += Math.floor((v.floors||10) * ((v.width||50)*(v.depth||50)) * 0.85 / 750);
          }
        });
      }
    }
    var commGFA_m2 = commGFA * 0.092903;

    var w = CC.waterDemand({units: totalUnits, commGFA_m2: commGFA_m2, jurisdiction: 'toronto', builtForm: totalUnits >= 100 ? 'toronto_high_rise' : 'toronto_mid_rise'});
    var demand_Lps = w.breakdown.peak_hour_Lps;

    /* Find smallest pipe near site from scan */
    var pipes = (window._infraData && window._infraData.watermain) ? window._infraData.watermain : null;
    var smallestDia = null, nearestPipe = null;
    if(Array.isArray(pipes) && pipes.length > 0){
      var withDia = pipes.filter(function(p){ var d = parseFloat(p.diameter || p.PIPE_SIZE); return isFinite(d) && d > 0; });
      withDia.sort(function(a,b){ return parseFloat(a.diameter || a.PIPE_SIZE) - parseFloat(b.diameter || b.PIPE_SIZE); });
      if(withDia.length){
        smallestDia = parseFloat(withDia[0].diameter || withDia[0].PIPE_SIZE);
        // Nearest pipe overall (sorted by dist already)
        nearestPipe = pipes[0];
      }
    }

    var avail = smallestDia ? CC.watermainAvailableFlow({pipeDiaMM: smallestDia, designVelocity_mps: 1.5}) : null;
    var capLps = avail ? avail.breakdown.available_Lps : null;
    var marginPct = (capLps && capLps > 0) ? ((capLps - demand_Lps) / capLps * 100) : null;
    var marginColor = marginPct == null ? '#888' : marginPct < 0 ? '#ff4444' : marginPct < 30 ? '#ffaa44' : '#66ccaa';

    var conf = avail ? avail.confidence : 'SCREENING';
    var confColor = conf === 'PRELIMINARY' ? '#66aaff' : '#ffaa44';

    var html = '';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><span style="font-size:11px;padding:2px 8px;border-radius:3px;background:'+confColor+'20;color:'+confColor+';border:1px solid '+confColor+'40;font-weight:700">'+conf+'</span><span style="font-size:11px;color:#888">CC v'+CC.VERSION+'</span></div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">';
    html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">'+demand_Lps.toFixed(2)+' L/s</div><div style="font-size:12px;color:#888">PEAK HOUR DEMAND</div></div>';
    if(smallestDia){
      html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">'+smallestDia+' mm</div><div style="font-size:12px;color:#888">SMALLEST PIPE NEAR SITE</div></div>';
      html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">'+capLps.toFixed(0)+' L/s</div><div style="font-size:12px;color:#888">CONTINUITY CEILING</div></div>';
      html += '<div style="background:rgba(102,204,170,0.08);border:1px solid '+marginColor+'30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:'+marginColor+'">'+(marginPct >= 0 ? '+' : '')+marginPct.toFixed(0)+'%</div><div style="font-size:12px;color:#888">CAPACITY MARGIN</div></div>';
    } else {
      html += '<div style="grid-column:span 1;background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px;text-align:center;color:#ffaa44">Run SCAN INFRASTRUCTURE to load pipe data.</div>';
    }
    html += '</div>';
    if(avail && avail.notes && avail.notes.length){
      html += '<div style="margin-top:8px;padding:8px;background:rgba(102,170,255,0.06);border:1px solid #66aaff30;border-radius:4px;font-size:11px;color:#aaa;line-height:1.5">';
      html += '<div style="font-weight:700;color:#66aaff;margin-bottom:4px">METHOD &amp; CAVEATS</div>';
      html += '<div style="margin-bottom:4px">'+avail.formula+'</div>';
      avail.notes.forEach(function(n){ if(n) html += '* ' + n + '<br>'; });
      html += '</div>';
    }
    html += '<div style="margin-top:8px;font-size:10px;color:#666;font-style:italic">'+w.citation+'</div>';
    el.innerHTML = html;
  };
})();
