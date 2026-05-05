// dc-calculator.js — Enhanced Development Charges calculator for Site Plan tab
// =============================================================================
// Layers on top of TO_DC_RATES (from proforma.js) to add:
//   1. Bill 23 / More Homes Built Faster Act statutory rental discount
//      (DC Act s. 26.2 — 15/20/25% off based on bedrooms, applies to rental only)
//   2. Annual rate indexation (Toronto re-indexes Feb 1 each year per S&P CCI)
//   3. Affordable / non-profit exemption (DC Act s. 4.1, 4.2 — full waiver)
//   4. Phased-payment NPV under Bill 23 (5-year installment with prescribed
//      interest @ Bank of Canada rate + 1%) for rental & non-profit projects
//   5. Per-bedroom-type granularity from project unit mix
//
// This file LOADS AFTER ui.js + analysis-tools.js so its window.calcDCBreakdown
// assignment overrides the legacy version.
//
// Loading rule reminder: P (data-model.js, `const`) and smVolumes (sitemap-lot.js,
// `let`) are TOP-LEVEL LEXICAL bindings — accessible by bare name from any
// classic script, NOT as properties of `window`. Always resolve via `typeof`
// guard + bare reference.
// =============================================================================

(function(){
  'use strict';

  // Bill 23 / DC Act s. 26.2 statutory rental discount %
  // (Reg. 82/98 as amended; values per O.Reg. 509/22)
  var BILL23_RENTAL_DISCOUNT = {
    bachelor_1bed:  0.15,   // 15%
    two_bed:        0.20,   // 20%
    three_plus_bed: 0.25    // 25%
  };

  // Bill 23 phased-payment schedule (DC Act s. 26.1)
  // Rental & non-profit: equal annual installments over 5 years starting at occupancy
  // Interest: prescribed under Reg. 82/98 = Bank of Canada policy rate + 1%
  var BILL23_INSTALLMENT_YEARS = 5;
  var BILL23_PRESCRIBED_RATE = 0.06;   // BoC ~5% + 1% (May 2026 best estimate)

  // Resolve project state via bare-name typeof guard (P is `const`, not on window)
  function _getP(){
    try {
      if(typeof P !== 'undefined' && P) return P;
    } catch(e){}
    return null;
  }

  // Compute unit mix breakdown by bedroom category from project volumes.
  // Falls back to GFA-derived heuristic if no explicit unit mix exists.
  function _bedroomBreakdown(){
    var p = _getP();
    var totalUnits = 0, b1 = 0, b2 = 0, b3 = 0;
    var d = (typeof pfData === 'function') ? (pfData() || {}) : {};
    var mix = d.unitMix || (p && p.unitMix) || null;
    if(Array.isArray(mix) && mix.length){
      mix.forEach(function(u){
        var c = u.count || 0;
        totalUnits += c;
        var t = (u.type || '').toLowerCase();
        if(t.indexOf('studio') >= 0 || t.indexOf('bachelor') >= 0 || t === '1-bedroom' || t === '1br') b1 += c;
        else if(t.indexOf('2-') >= 0 || t === '2br' || t.indexOf('2 bed') >= 0) b2 += c;
        else if(t.indexOf('3') >= 0 || t.indexOf('family') >= 0) b3 += c;
        else b1 += c; // 1+den lumped with 1-bed under Toronto DC Act
      });
    } else if(d.totalUnits || (p && Array.isArray(p.vols))){
      // Fallback: use total unit count + Toronto Avenue unit-mix profile
      // (40% 1-bed, 50% 2-bed, 10% 3-bed — typical mid-rise condo per CMHC)
      totalUnits = d.totalUnits || 0;
      if(totalUnits === 0 && p){
        p.vols.forEach(function(v){
          if(v.use === 'residential' || v.use === 'mixed'){
            totalUnits += Math.floor((v.floors || 10) * ((v.width || 50) * (v.depth || 50)) * 0.85 / 750);
          }
        });
      }
      b1 = Math.round(totalUnits * 0.40);
      b3 = Math.round(totalUnits * 0.10);
      b2 = totalUnits - b1 - b3;
    }
    return { total: totalUnits, b1: b1, b2: b2, b3: b3 };
  }

  // Read project commercial GFA in sf
  function _commGFA_sf(){
    var d = (typeof pfData === 'function') ? (pfData() || {}) : {};
    return d.commGFA || 0;
  }

  // Compute NPV of a 5-year deferred installment plan under Bill 23 s. 26.1
  // grossDC: total liability before phasing
  // discountRate: developer's cost of capital (use 8% default for IRR comparison)
  // returns: { pvCost, savingsVsUpfront, schedule }
  function _phasedNPV(grossDC, discountRate){
    var rate = (typeof discountRate === 'number') ? discountRate : 0.08;
    var prescribed = BILL23_PRESCRIBED_RATE;
    var n = BILL23_INSTALLMENT_YEARS;
    var basePmt = grossDC / n;   // equal principal
    var pv = 0;
    var schedule = [];
    var balance = grossDC;
    for(var t = 1; t <= n; t++){
      var interest = balance * prescribed;
      var pmt = basePmt + interest;
      var pvPmt = pmt / Math.pow(1 + rate, t);
      pv += pvPmt;
      schedule.push({ year: t, principal: basePmt, interest: interest, total: pmt, pv: pvPmt });
      balance -= basePmt;
    }
    return { pvCost: pv, savingsVsUpfront: grossDC - pv, schedule: schedule };
  }

  // ── Main entry point ──
  // Reads inputs from the DC panel, computes gross + adjusted DC, and renders.
  window.calcDCBreakdown = function(){
    var resultsEl = document.getElementById('dc-breakdown-results');
    if(!resultsEl) return;

    var muni = (document.getElementById('dc-municipality') || {}).value || 'toronto';
    var tenure = (document.getElementById('dc-tenure') || {}).value || 'condo';
    var indexationPct = parseFloat((document.getElementById('dc-indexation') || {}).value || '0') || 0;
    var affordablePct = parseFloat((document.getElementById('dc-affordable') || {}).value || '0') || 0;
    var phased = ((document.getElementById('dc-phased') || {}).checked === true);
    var coc = parseFloat((document.getElementById('dc-coc') || {}).value || '8') || 8;

    var bd = _bedroomBreakdown();
    var commGFA_sf = _commGFA_sf();
    var commGFA_m2 = commGFA_sf * 0.0929;

    // Prefer the verified DC_RATES database (data/dc-rates.js) over the older
    // granular TO_DC_RATES table in proforma.js. The granular table's totals
    // ($31k/$44k) are stale vs verified June 6, 2024 figures ($52,676/$80,690).
    // Use granular only as a fallback when DC_RATES.toronto is unavailable.
    var hasLiveData = (typeof window.DC_RATES !== 'undefined') && window.DC_RATES[muni];
    var useGranularTO = !hasLiveData && (muni === 'toronto') && (typeof TO_DC_RATES !== 'undefined') && TO_DC_RATES.residential;

    var html = '';
    var grossResDC = 0, grossEduDC = 0, grossCommDC = 0;
    var lineItems = [];

    if(useGranularTO){
      // Granular Toronto rates: 10 service categories + TDSB/TCDSB education + commercial
      var R = TO_DC_RATES.residential.services;
      var E = TO_DC_RATES.education;
      // Toronto rates are 'bachelor_1bed' and 'two_plus_bed' — split 2-bed and 3+bed at the 2+ rate
      var b1 = bd.b1, b2plus = bd.b2 + bd.b3;
      R.forEach(function(svc){
        var amt = b1 * svc.bachelor_1bed + b2plus * svc.two_plus_bed;
        grossResDC += amt;
        lineItems.push({ category: 'res', label: svc.label, amount: amt });
      });
      var tdsb = b1 * E.tdsb.bachelor_1bed + b2plus * E.tdsb.two_plus_bed;
      var tcdsb = b1 * E.tcdsb.bachelor_1bed + b2plus * E.tcdsb.two_plus_bed;
      grossEduDC = tdsb + tcdsb;
      lineItems.push({ category: 'edu', label: E.tdsb.label, amount: tdsb });
      lineItems.push({ category: 'edu', label: E.tcdsb.label, amount: tcdsb });
      // Commercial DC by service category — Toronto uses $/sf
      TO_DC_RATES.commercial.services.forEach(function(svc){
        var amt = commGFA_sf * svc.perSF;
        grossCommDC += amt;
        lineItems.push({ category: 'comm', label: svc.label + ' (commercial)', amount: amt });
      });
      var commEdu = commGFA_sf * TO_DC_RATES.commercial.education.perSF;
      grossCommDC += commEdu;
      lineItems.push({ category: 'comm', label: TO_DC_RATES.commercial.education.label, amount: commEdu });
    } else if(typeof window.DC_RATES !== 'undefined' && window.DC_RATES[muni]){
      // Live database (data/dc-rates.js) — verified rates from official by-laws.
      // For two-tier regional municipalities (Mississauga, Brampton, Vaughan,
      // Markham, etc.) the developer pays Local City DC + Regional DC stacked.
      // We render each tier as a SEPARATE line item so the stack is visible.
      var muniRec = window.DC_RATES[muni];
      var rec = muniRec.rates || {};
      var b1 = bd.b1, b2plus = bd.b2 + bd.b3;

      // ── Special case: when tenure=rental AND muni publishes a separate
      //    rental schedule, use those discounted rates DIRECTLY rather than
      //    applying Bill 23 % on top of non-rental rates. Toronto's published
      //    rental schedule is MORE generous than the Bill 23 minimum (36-44%
      //    reduction vs Bill 23's 15-25%). Using the published schedule is
      //    the legally accurate basis. ──
      if(tenure === 'rental' && muniRec.rentalRates){
        var rr = muniRec.rentalRates;
        var rentalBach = rr.apartment_1bed_bach ? rr.apartment_1bed_bach.perUnit : 0;
        var rental2bed = rr.apartment_2bed ? rr.apartment_2bed.perUnit : 0;
        var rental3plus = rr.apartment_3plus ? rr.apartment_3plus.perUnit : rental2bed;
        var rentalTotal = bd.b1 * rentalBach + bd.b2 * rental2bed + bd.b3 * rental3plus;
        grossResDC += rentalTotal;
        lineItems.push({
          category: 'res',
          label: muniRec.name + ' (RENTAL schedule) — ' + bd.b1 + '× $' + rentalBach.toLocaleString() + ' + ' + bd.b2 + '× $' + rental2bed.toLocaleString() + ' + ' + bd.b3 + '× $' + rental3plus.toLocaleString(),
          amount: rentalTotal
        });
        lineItems.push({
          category: 'res',
          label: '⚠ Using municipality\'s published rental schedule — already includes Bill 23 + local rental incentive. Bill 23 discount NOT separately applied.',
          amount: 0
        });
      } else {
        // ── Tier 1: Local city DC (non-rental / condo path) ──
        var localBach = (rec.apartment_small ? rec.apartment_small.perUnit :
                         rec.apartment_1bed_bach ? rec.apartment_1bed_bach.perUnit :
                         rec.apartment ? rec.apartment.perUnit : 0);
        var local2plus = (rec.apartment_large ? rec.apartment_large.perUnit :
                          rec.apartment_2plus ? rec.apartment_2plus.perUnit :
                          rec.apartment ? rec.apartment.perUnit : 0);
        var localTotal = b1 * localBach + b2plus * local2plus;
        grossResDC += localTotal;
        lineItems.push({
          category: 'res',
          label: muniRec.name + ' — ' + b1 + '× $' + localBach.toLocaleString() + ' + ' + b2plus + '× $' + local2plus.toLocaleString(),
          amount: localTotal
        });
      }

      // ── Tier 2: Regional DC (only present for two-tier lower-tier cities) ──
      if(muniRec.parent && window.DC_RATES[muniRec.parent]){
        var parentRec = window.DC_RATES[muniRec.parent];
        var parentRates = parentRec.rates || {};
        var regBach = (parentRates.apartment_small ? parentRates.apartment_small.perUnit : 0);
        var reg2plus = (parentRates.apartment_large ? parentRates.apartment_large.perUnit : 0);
        var regTotal = b1 * regBach + b2plus * reg2plus;
        grossResDC += regTotal;
        lineItems.push({
          category: 'res',
          label: parentRec.name + ' — ' + b1 + '× $' + regBach.toLocaleString() + ' + ' + b2plus + '× $' + reg2plus.toLocaleString(),
          amount: regTotal
        });
      }

      // ── Tier 3: Education DCs (school boards) ──
      // EDCs are levied per dwelling unit under the Education Act. Look up
      // every board whose appliesToCity / appliesToCities matches the current
      // municipality and add it as a separate line item.
      if(window.DC_RATES.school_boards){
        var sb = window.DC_RATES.school_boards;
        Object.keys(sb).forEach(function(boardKey){
          var board = sb[boardKey];
          if(!board || typeof board !== 'object') return;
          // Match by appliesToCity (string) OR appliesToCities (array)
          var matches = (board.appliesToCity === muni) ||
                        (Array.isArray(board.appliesToCities) && board.appliesToCities.indexOf(muni) >= 0);
          if(!matches) return;
          // EDCs typically have a single per-unit rate (not split by bedroom count)
          var perUnit = (typeof board.apartment === 'number') ? board.apartment :
                        (typeof board.apartment_2plus === 'number') ? board.apartment_2plus : 0;
          if(perUnit === 0) {
            // Still display the line so the user knows the board exists but charges $0
            lineItems.push({
              category: 'edu',
              label: board.name + ' — $0/unit (' + (board.notes ? board.notes[0] : 'no current EDC') + ')',
              amount: 0
            });
            return;
          }
          var boardTotal = bd.total * perUnit;
          grossEduDC += boardTotal;
          lineItems.push({
            category: 'edu',
            label: board.name + ' — ' + bd.total + ' units × $' + perUnit.toLocaleString() + '/unit',
            amount: boardTotal
          });
        });
      }

      // ── Active temporary incentive notes ──
      // Both local and parent records may have incentives. Display them as
      // zero-dollar flags (the actual discount math should be applied via
      // the affordable% / tenure inputs by the user — these are just notes).
      function _appendIncentives(rec){
        if(Array.isArray(rec.tempIncentives)){
          rec.tempIncentives.forEach(function(inc){
            lineItems.push({
              category: 'res',
              label: '⚠ ' + (rec.name || '') + ': ' + inc.name + ' — ' + inc.discount + ' (' + inc.from + ' → ' + inc.to + ')',
              amount: 0
            });
          });
        }
      }
      _appendIncentives(muniRec);
      if(muniRec.parent && window.DC_RATES[muniRec.parent]){
        _appendIncentives(window.DC_RATES[muniRec.parent]);
      }

      // Commercial — most non-Toronto records don't have detailed comm rates yet
      grossCommDC = 0;
    } else {
      // Last-resort fallback (data file missing)
      var fbRates = {
        toronto:    { name: 'City of Toronto',     perUnit: 66000, commPerSqM: 444 },
        mississauga:{ name: 'City of Mississauga', perUnit: 98200, commPerSqM: 285 },
        brampton:   { name: 'City of Brampton',    perUnit: 60000, commPerSqM: 310 },
        vaughan:    { name: 'City of Vaughan',     perUnit: 0,     commPerSqM: 295 },
        markham:    { name: 'City of Markham',     perUnit: 0,     commPerSqM: 280 }
      };
      var r = fbRates[muni] || fbRates.toronto;
      grossResDC = r.perUnit * bd.total;
      grossCommDC = r.commPerSqM * commGFA_m2;
      lineItems.push({ category: 'res', label: 'Residential lumped ($'+r.perUnit.toLocaleString()+'/unit × '+bd.total+') — DC_RATES data not loaded', amount: grossResDC });
      lineItems.push({ category: 'comm', label: 'Commercial lumped ($'+r.commPerSqM+'/m² × '+Math.round(commGFA_m2)+' m²)', amount: grossCommDC });
    }

    var grossTotal = grossResDC + grossEduDC + grossCommDC;

    // Apply Bill 23 statutory rental discount (residential only — does NOT apply to commercial)
    var rentalDiscountAmt = 0;
    var rentalDiscountDetail = '';
    // Detect whether the published rental schedule was already used in the
    // gross calc above (Toronto provides one). If so, the rental discount is
    // already baked in and we MUST NOT also subtract Bill 23 % here.
    var usedPublishedRentalSchedule = (typeof window.DC_RATES !== 'undefined') &&
                                       window.DC_RATES[muni] &&
                                       window.DC_RATES[muni].rentalRates &&
                                       tenure === 'rental';
    if(tenure === 'rental' && !usedPublishedRentalSchedule){
      // Per-bedroom statutory weighted discount on residential portion only
      // Calculate effective discount as weighted average across bedroom mix
      var resWithEdu = grossResDC + grossEduDC;
      if(bd.total > 0){
        // Statutory rates apply ONLY to residential city services (not edu); apply weighted to grossResDC
        var weighted =
          (bd.b1 * BILL23_RENTAL_DISCOUNT.bachelor_1bed +
           bd.b2 * BILL23_RENTAL_DISCOUNT.two_bed +
           bd.b3 * BILL23_RENTAL_DISCOUNT.three_plus_bed) / bd.total;
        rentalDiscountAmt = grossResDC * weighted;
        rentalDiscountDetail =
          'Bill 23 rental discount applied: ' +
          (bd.b1 ? bd.b1 + '× 1-bed/bachelor @ 15%, ' : '') +
          (bd.b2 ? bd.b2 + '× 2-bed @ 20%, ' : '') +
          (bd.b3 ? bd.b3 + '× 3+bed @ 25%' : '');
        rentalDiscountDetail = rentalDiscountDetail.replace(/, $/, '');
      }
    }

    // Apply affordable / non-profit waiver (full exemption on the affordable portion)
    var affordableExemption = 0;
    if(affordablePct > 0){
      affordableExemption = grossTotal * (affordablePct / 100);
    }

    // Apply indexation factor (compounds simply — applies to net DC after exemptions)
    var indexationFactor = 1 + indexationPct / 100;

    var netBeforeIndex = grossTotal - rentalDiscountAmt - affordableExemption;
    var netAfterIndex = netBeforeIndex * indexationFactor;
    var indexationAdj = netAfterIndex - netBeforeIndex;

    // Phased payment NPV (only valid for rental + non-profit per Bill 23)
    var phasingResult = null;
    if(phased && tenure === 'rental'){
      phasingResult = _phasedNPV(netAfterIndex, coc / 100);
    }

    // ── RENDER ──
    var muniLabel = useGranularTO ? 'City of Toronto (granular)' :
                    (muni.charAt(0).toUpperCase() + muni.slice(1));

    // Summary tiles — 4 KPIs
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">';
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">$'+_fmtKMB(grossTotal)+'</div><div style="font-size:12px;color:#888">GROSS DC</div></div>';
    html += '<div style="background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffaa44">$'+_fmtKMB(netAfterIndex)+'</div><div style="font-size:12px;color:#888">NET DC (PAYABLE)</div></div>';
    html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">$'+(bd.total > 0 ? _fmtKMB(netAfterIndex / bd.total) : '0')+'</div><div style="font-size:12px;color:#888">PER UNIT (NET)</div></div>';
    var savingsTotal = rentalDiscountAmt + affordableExemption;
    html += '<div style="background:rgba(174,188,70,0.08);border:1px solid #AEBC4630;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#AEBC46">$'+_fmtKMB(savingsTotal)+'</div><div style="font-size:12px;color:#888">STATUTORY SAVINGS</div></div>';
    html += '</div>';

    // Adjustments waterfall
    html += '<div style="background:rgba(30,30,30,0.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px;font-size:12px">';
    html += '<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px">DC WATERFALL — '+muniLabel.toUpperCase()+'</div>';
    html += _waterfallRow('Gross residential DC',          grossResDC,          '#66ccaa', false);
    if(grossEduDC > 0) html += _waterfallRow('Gross education DC (TDSB+TCDSB)', grossEduDC, '#cc77ff', false);
    if(grossCommDC > 0) html += _waterfallRow('Gross commercial DC',           grossCommDC,         '#66aaff', false);
    html += _waterfallRow('= Gross total',                  grossTotal,          '#fff',   true);
    if(rentalDiscountAmt > 0) html += _waterfallRow('− Bill 23 rental discount', rentalDiscountAmt, '#AEBC46', false);
    if(affordableExemption > 0) html += _waterfallRow('− Affordable/non-profit exemption ('+affordablePct+'%)', affordableExemption, '#AEBC46', false);
    html += _waterfallRow('= Net before indexation',         netBeforeIndex,      '#ccc',   true);
    if(Math.abs(indexationAdj) > 1) html += _waterfallRow((indexationPct >= 0 ? '+ ' : '− ') + 'Indexation ('+indexationPct.toFixed(1)+'%/yr)', Math.abs(indexationAdj), '#ffaa44', false);
    html += _waterfallRow('= Net DC payable',                netAfterIndex,       '#ffaa44', true);
    html += '</div>';

    // Bill 23 rental discount detail (when applied)
    if(rentalDiscountDetail){
      html += '<div style="padding:6px;background:rgba(174,188,70,0.06);border:1px solid #AEBC4620;border-radius:4px;font-size:11px;color:#AEBC46;margin-bottom:8px">';
      html += '<strong>BILL 23 APPLIED:</strong> ' + rentalDiscountDetail;
      html += '</div>';
    }

    // Phased payment schedule (if enabled)
    if(phasingResult){
      html += '<div style="background:rgba(30,30,30,0.6);border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:8px">';
      html += '<div style="font-size:13px;font-weight:700;color:#888;margin-bottom:6px">PHASED PAYMENT — BILL 23 INSTALLMENT (5 YR @ '+(BILL23_PRESCRIBED_RATE*100)+'%)</div>';
      html += '<table style="width:100%;font-size:11px;color:#ccc"><tr style="color:#888"><td>YEAR</td><td style="text-align:right">PRINCIPAL</td><td style="text-align:right">INTEREST</td><td style="text-align:right">TOTAL</td><td style="text-align:right">PV @ '+coc+'%</td></tr>';
      phasingResult.schedule.forEach(function(s){
        html += '<tr><td>Y'+s.year+'</td><td style="text-align:right">$'+_fmtKMB(s.principal)+'</td><td style="text-align:right">$'+_fmtKMB(s.interest)+'</td><td style="text-align:right">$'+_fmtKMB(s.total)+'</td><td style="text-align:right;color:#66aaff">$'+_fmtKMB(s.pv)+'</td></tr>';
      });
      html += '<tr style="border-top:1px solid #444;font-weight:700"><td style="padding-top:4px">PV TOTAL</td><td colspan="3"></td><td style="text-align:right;color:#66ccaa;padding-top:4px">$'+_fmtKMB(phasingResult.pvCost)+'</td></tr>';
      html += '</table>';
      html += '<div style="font-size:11px;color:#AEBC46;margin-top:4px">Phasing saves $'+_fmtKMB(phasingResult.savingsVsUpfront)+' in PV terms vs. upfront payment</div>';
      html += '</div>';
    }

    // Detailed line items (collapsible)
    html += '<details style="margin-bottom:8px"><summary style="cursor:pointer;font-size:12px;color:#888;padding:6px;background:rgba(30,30,30,0.6);border:1px solid #333;border-radius:4px">▶ DETAILED LINE ITEMS ('+lineItems.length+' categories)</summary>';
    html += '<div style="background:rgba(30,30,30,0.4);border:1px solid #333;border-top:none;border-radius:0 0 4px 4px;padding:8px;font-size:11px">';
    html += '<table style="width:100%;color:#ccc"><tr style="color:#888;border-bottom:1px solid #444"><td style="padding-bottom:4px">CATEGORY</td><td style="text-align:right;padding-bottom:4px">AMOUNT</td></tr>';
    lineItems.forEach(function(li){
      var color = li.category === 'res' ? '#66ccaa' : li.category === 'edu' ? '#cc77ff' : '#66aaff';
      html += '<tr><td style="padding:2px 0;color:#aaa">'+li.label+'</td><td style="text-align:right;color:'+color+'">$'+_fmtKMB(li.amount)+'</td></tr>';
    });
    html += '</table></div></details>';

    // Inputs summary table
    html += '<table style="width:100%;font-size:12px;color:#ccc">';
    html += '<tr><td style="color:#888">Tenure</td><td style="text-align:right">'+(tenure === 'rental' ? 'Purpose-built rental' : 'Condo/ownership')+'</td></tr>';
    html += '<tr><td style="color:#888">Total residential units</td><td style="text-align:right">'+bd.total+' ('+bd.b1+' x 1-bed/bach, '+bd.b2+' x 2-bed, '+bd.b3+' x 3+bed)</td></tr>';
    html += '<tr><td style="color:#888">Commercial GFA</td><td style="text-align:right">'+Math.round(commGFA_sf).toLocaleString()+' sf ('+Math.round(commGFA_m2).toLocaleString()+' m^2)</td></tr>';
    html += '<tr><td style="color:#888">Indexation applied</td><td style="text-align:right">'+indexationPct.toFixed(1)+'%</td></tr>';
    html += '<tr><td style="color:#888">Affordable share</td><td style="text-align:right">'+affordablePct+'%</td></tr>';
    html += '</table>';

    // Citation
    html += '<div style="margin-top:8px;font-size:10px;color:#666;font-style:italic;line-height:1.5">';
    if(typeof window.DC_RATES !== 'undefined' && window.DC_RATES[muni]){
      var src = window.DC_RATES[muni];
      html += '<strong>Source:</strong> '+src.name+' - effective '+src.effectiveDate+', last verified '+src.lastVerified+'. Confidence: '+src.confidence.toUpperCase()+'. ';
      if(src.verifiedAgainstPDF) html += 'Verified against PDF: '+src.verifiedAgainstPDF+'. ';
      if(src.bylaw) html += src.bylaw+'. ';
      if(src.sourceUrl) html += '<a href="'+src.sourceUrl+'" target="_blank" style="color:#66aaff">Official rate page</a> ';
      if(src.indexation && src.indexation.currentStatus) html += 'Indexation: '+src.indexation.currentStatus+'. ';
    } else {
      html += '<strong>Source:</strong> Fallback rate table (data/dc-rates.js not loaded). ';
    }
    html += 'Bill 23 (More Homes Built Faster Act 2022) - DC Act s. 26.1 phased payment + s. 26.2 statutory rental discount. ';
    html += 'Affordable exemption per DC Act s. 4.1. ';
    html += 'Education DCs per Education Act and Reg. 20/98. ';
    html += 'Estimates only - confirm actual rates at building permit issuance.';
    html += '</div>';

    resultsEl.innerHTML = html;
  };

  function _waterfallRow(label, amount, color, bold){
    var weight = bold ? '700' : '400';
    var border = bold ? 'border-top:1px solid #444;padding-top:4px;margin-top:2px' : '';
    return '<div style="display:flex;justify-content:space-between;'+border+'"><span style="color:'+color+';font-weight:'+weight+'">'+label+'</span><span style="color:'+color+';font-weight:'+weight+'">$'+_fmtKMB(amount)+'</span></div>';
  }

  function _fmtKMB(n){
    if(!isFinite(n)) return '0';
    var a = Math.abs(n);
    if(a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if(a >= 1e3) return (n / 1e3).toFixed(0) + 'K';
    return Math.round(n).toLocaleString();
  }

})();
