// analysis-tools.js — Trip Gen, Shadow Study, Applications Checklist
// Split out from ui.js because the OneDrive mount caps file size at ~161KB.

/* =====================================================================
   TRIP GENERATION + PARKING DEMAND
   ---------------------------------------------------------------------
   Sources (all publicly published; user can override every input):
     • ITE Trip Generation Manual, 11th Edition (2021), Land Use 221 —
       Multifamily Housing (Mid-Rise). Average rates:
         AM peak (adjacent street, 1-hr) = 0.36 trips/dwelling unit
         PM peak (adjacent street, 1-hr) = 0.39 trips/dwelling unit
         Weekday daily                   = 4.54 trips/dwelling unit
       (These are PERSON trips per ITE methodology; vehicle trips =
        person trips × auto-driver mode share.)
     • City of Toronto Zoning By-law 569-2013 Chapter 200 (parking) and
       Chapter 230 (bicycle parking). By-law 89-2022 (Dec 2021)
       eliminated MIN residential parking citywide; max parking caps
       apply in PA1 (downtown).
     • Visitor parking: 0.1 spaces/unit retained as minimum.
     • Bicycle parking minima (resi): long-term 0.9/unit, short-term
       0.1/unit (Chapter 230 §1).
     • Auto-driver mode share defaults from Transportation Tomorrow
       Survey (TTS) — Toronto auto-driver share by zone:
         Downtown (PA1) ≈ 30–35%
         Inner suburbs (PA2)≈ 50–60%
         Outer suburbs (PA3/4) ≈ 65–75%
   ===================================================================== */
function calcTripParking(){
  var resultsEl = document.getElementById('tripgen-results');
  if(!resultsEl) return;

  // Pull total residential units from pro-forma; fallback to volume estimate
  var d = typeof pfData === 'function' ? pfData() : {};
  var totalUnits = d.totalUnits || 0;
  var commGFA = d.commGFA || 0;
  if(totalUnits === 0 && P && P.vols){
    P.vols.forEach(function(v){
      if(v.use === 'residential' || v.use === 'mixed'){
        totalUnits += Math.floor((v.floors||10) * ((v.width||50) * (v.depth||50)) * 0.85 / 750);
      }
    });
  }

  // Read user-editable inputs (every assumption is overridable)
  var amRate    = parseFloat(document.getElementById('tg-am-rate').value)     || 0.36;
  var pmRate    = parseFloat(document.getElementById('tg-pm-rate').value)     || 0.39;
  var dailyRate = parseFloat(document.getElementById('tg-daily-rate').value)  || 4.54;
  var autoShare = (parseFloat(document.getElementById('tg-auto-share').value) || 40) / 100;
  var visRate   = parseFloat(document.getElementById('tg-visitor-rate').value)|| 0.1;
  var paZone    = document.getElementById('tg-parking-zone').value || 'PA1';

  // Person trips → vehicle trips via auto-driver share
  var amPerson = totalUnits * amRate;
  var pmPerson = totalUnits * pmRate;
  var dailyPerson = totalUnits * dailyRate;
  var amVeh    = amPerson * autoShare;
  var pmVeh    = pmPerson * autoShare;
  var dailyVeh = dailyPerson * autoShare;

  /* Toronto parking standards by zone (residential, post-By-law 89-2022).
     Source: City of Toronto Zoning By-law 569-2013 Chapter 200 — note
     residential MINIMUMS were removed citywide Dec 2021. PA1 has a
     MAXIMUM cap; PA2-PA4 have no min/max for residential.
     Visitor parking minimum (0.1/unit) retained per §200.5.10.
     Bicycle parking minima per §230.5.1.10. */
  var parkingNote, residentMin, residentMax;
  if(paZone === 'PA1'){
    residentMin = 0;
    residentMax = 0.5; // PA1 max ≈ 0.5/unit (Chapter 200 §10.20.40.40)
    parkingNote = 'PA1 (downtown) — no minimum, maximum 0.5/unit';
  } else if(paZone === 'PA2'){
    residentMin = 0;
    residentMax = null;
    parkingNote = 'PA2 (inside Greenbelt) — no min/max for residential';
  } else if(paZone === 'PA3'){
    residentMin = 0;
    residentMax = null;
    parkingNote = 'PA3 (outside Greenbelt) — no min/max for residential';
  } else {
    residentMin = 0;
    residentMax = null;
    parkingNote = 'PA4 (suburban) — no min/max for residential';
  }
  var visitorReq = totalUnits * visRate;
  var bikeLong   = Math.ceil(totalUnits * 0.9);
  var bikeShort  = Math.ceil(totalUnits * 0.1);

  // Practical parking estimate = auto share × occupancy proxy (1.0 vehicle per auto-driver household)
  // This is just a planning-level estimate of demand; user can override
  var demandEst = Math.round(totalUnits * autoShare);
  var demandRangeLow = Math.round(totalUnits * autoShare * 0.7);
  var demandRangeHigh = Math.round(totalUnits * autoShare * 1.0);

  // Build output
  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html += '<div style="background:rgba(168,124,255,0.08);border:1px solid #a87cff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#a87cff">' + Math.round(amVeh) + '</div><div style="font-size:12px;color:#888">AM PEAK VEH TRIPS</div></div>';
  html += '<div style="background:rgba(168,124,255,0.08);border:1px solid #a87cff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#a87cff">' + Math.round(pmVeh) + '</div><div style="font-size:12px;color:#888">PM PEAK VEH TRIPS</div></div>';
  html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">' + Math.round(dailyVeh).toLocaleString() + '</div><div style="font-size:12px;color:#888">DAILY VEH TRIPS</div></div>';
  html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">' + demandRangeLow + '–' + demandRangeHigh + '</div><div style="font-size:12px;color:#888">RESIDENT PARKING DEMAND</div></div>';
  html += '</div>';

  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#a87cff;font-weight:700">TRIP GENERATION (ITE 221 person trips)</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Units (resi)</td><td style="text-align:right">' + totalUnits.toLocaleString() + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">AM person trips (= ' + amRate + ' × units)</td><td style="text-align:right">' + Math.round(amPerson) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">PM person trips (= ' + pmRate + ' × units)</td><td style="text-align:right">' + Math.round(pmPerson) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Daily person trips (= ' + dailyRate + ' × units)</td><td style="text-align:right">' + Math.round(dailyPerson).toLocaleString() + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Vehicle trips = person × auto-share (' + Math.round(autoShare*100) + '%)</td><td style="text-align:right">see KPIs</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:8px 0 5px 0;color:#66ccaa;font-weight:700">PARKING (Toronto 569-2013, ' + paZone + ')</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Resident — minimum required</td><td style="text-align:right">' + (residentMin === 0 ? 'None' : (residentMin + '/unit')) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Resident — maximum permitted</td><td style="text-align:right">' + (residentMax === null ? 'No cap' : (residentMax + '/unit = ' + Math.floor(residentMax * totalUnits) + ' max')) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Visitor — required (' + visRate + '/unit)</td><td style="text-align:right">' + Math.ceil(visitorReq) + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Resident demand estimate (planning-level)</td><td style="text-align:right">' + demandRangeLow + '–' + demandRangeHigh + ' (mid: ' + demandEst + ')</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:8px 0 5px 0;color:#ffcc66;font-weight:700">BICYCLE PARKING (Chapter 230)</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Long-term (0.9/unit)</td><td style="text-align:right">' + bikeLong + '</td></tr>';
  html += '<tr><td style="padding:3px 0;color:#888">Short-term (0.1/unit)</td><td style="text-align:right">' + bikeShort + '</td></tr>';
  html += '</table>';

  html += '<div style="margin-top:8px;padding:8px;background:rgba(168,124,255,0.08);border:1px solid #a87cff30;border-radius:4px;font-size:12px;color:#aaa;line-height:1.5">';
  html += '<div style="font-weight:700;color:#a87cff;margin-bottom:4px">PLANNING NOTES</div>';
  html += parkingNote + '.<br>';
  html += 'A formal Transportation Impact Study (TIS) is typically required by City of Toronto Transportation Services for projects ≥30 residential units or that change peak-hour intersection operations. ITE 221 average rates are the conventional basis but local data (TTS, intersection counts, transit ridership) refines results.';
  if(commGFA > 0){
    html += '<br><br>Commercial GFA = ' + Math.round(commGFA).toLocaleString() + ' sf — ITE Land Use 820 (Shopping Center) or 710 (Office) rates apply for the non-resi portion (not included above).';
  }
  html += '</div>';

  resultsEl.innerHTML = html;
}


/* =====================================================================
   REQUIRED APPLICATIONS CHECKLIST
   ---------------------------------------------------------------------
   Determines which Planning Act applications are triggered by the
   delta between as-of-right zoning and proposed massing.
   Sources:
     • Planning Act R.S.O. 1990, c.P.13:
         §17 — Official Plan Amendment (OPA)
         §22 — Privately-initiated OPA (120 day clock per §22(7.0.2))
         §34 — Zoning By-law Amendment (120 day clock per §34(11))
         §41 — Site Plan Control
         §45 — Minor Variance / Committee of Adjustment
     • Toronto Municipal Code Ch. 415 — Site Plan Control thresholds
     • Pre-application Consultation: §17(7.4), §34(10.0.1), §41(3.1)
   Logic mirrors the EstateBuilder zoning-navigator skill conventions.
   ===================================================================== */
function calcApplications(){
  var resultsEl = document.getElementById('applications-results');
  if(!resultsEl) return;

  /* Fixed planning conventions (NOT user-editable):
     - 10% setback shortfall = practice rule of thumb for MV vs ZBA boundary,
       derived from De Gasperis v. Vaughan (1999) 4-test jurisprudence on
       what constitutes "minor" under Planning Act §45.
     - SPA trigger: Toronto Municipal Code §415-3 designates multi-residential
       and most non-residential as Site-Plan-Control; effectively any building
       with 3+ residential units OR with non-residential GFA. */
  var mvThresholdPct = 10;

  // As-of-right zoning (from P.zoning, populated by zoning detection)
  var z = (P && P.zoning) ? P.zoning : {};
  var asOfRightFSI = z.fsiLimit || null;
  var asOfRightHeightM = z.heightLimit || null;
  var zoneStr = z.zoneString || z.zone || 'unknown';

  // Lot area from polygon (shoelace)
  var lotAreaSF = 0;
  if(P && P.lot && P.lot.polyVerts && P.lot.polyVerts.length > 2){
    var v = P.lot.polyVerts;
    for(var i = 0; i < v.length; i++){
      var j = (i + 1) % v.length;
      lotAreaSF += v[i][0] * v[j][1] - v[j][0] * v[i][1];
    }
    lotAreaSF = Math.abs(lotAreaSF) / 2;
  }
  var lotAreaM2 = lotAreaSF * 0.092903;

  // Use the project's authoritative GFA computation (handles polygon volumes,
  // stepbacks, podium/tower, union-not-sum). Falls back to a primitive
  // estimate if computeGFA isn't available.
  var proposedGFASF = 0;
  if(typeof computeGFA === 'function'){
    try {
      var g = computeGFA();
      proposedGFASF = g && g.totalGFA ? g.totalGFA : 0;
    } catch(e){ proposedGFASF = 0; }
  }
  if(proposedGFASF === 0 && P && P.vols){
    P.vols.forEach(function(vol){
      var floors = vol.floors || vol.storeys || 0;
      var fp = (vol.customAreaSF) ? vol.customAreaSF : (vol.width || 0) * (vol.depth || 0);
      proposedGFASF += floors * fp;
    });
  }
  var proposedGFAM2 = proposedGFASF * 0.092903;

  // Tallest building height
  var maxHeightFt = 0;
  if(P && P.vols){
    P.vols.forEach(function(vol){
      var floors = vol.floors || vol.storeys || 0;
      var storeyH = vol.storeyHeightFt || (P.flr && (vol.commGF ? P.flr.gf : P.flr.typ)) || 10;
      var hFt = (vol.baseElevFt || 0) + floors * storeyH;
      if(hFt > maxHeightFt) maxHeightFt = hFt;
    });
  }
  var proposedHeightM = maxHeightFt * 0.3048;
  var proposedFSI = lotAreaSF > 0 ? (proposedGFASF / lotAreaSF) : 0;

  // Auto-detect use mix from volumes (SPA trigger logic)
  var hasResidential = false, hasCommercial = false, totalUnits = 0;
  if(P && P.vols){
    P.vols.forEach(function(vol){
      if(vol.use === 'residential' || vol.use === 'mixed' || (!vol.use && (vol.floors || 0) > 0)){
        hasResidential = true;
      }
      if(vol.commGF || vol.use === 'commercial' || vol.use === 'mixed' || vol.use === 'office'){
        hasCommercial = true;
      }
    });
  }
  if(typeof pfData === 'function'){
    try { totalUnits = (pfData() || {}).totalUnits || 0; } catch(e){}
  }

  // Triggers + apps
  var triggers = [];
  var apps = {};

  // ZBA / OPA: FSI overage
  if(asOfRightFSI && proposedFSI > asOfRightFSI * 1.001){
    apps.ZBA = true;
    triggers.push('FSI: proposed ' + proposedFSI.toFixed(2) + 'x exceeds as-of-right ' + asOfRightFSI.toFixed(2) + 'x → ZBA required (Planning Act §34).');
    if(proposedFSI > asOfRightFSI * 1.5){
      apps.OPA_LIKELY = true;
      triggers.push('FSI delta >50% over as-of-right typically also requires Official Plan Amendment (§22).');
    }
  }
  // ZBA / OPA: height overage
  if(asOfRightHeightM && proposedHeightM > asOfRightHeightM * 1.001){
    apps.ZBA = true;
    triggers.push('Height: proposed ' + proposedHeightM.toFixed(1) + 'm exceeds as-of-right ' + asOfRightHeightM.toFixed(1) + 'm → ZBA required (§34).');
    if(proposedHeightM > asOfRightHeightM * 1.5){
      apps.OPA_LIKELY = true;
      triggers.push('Height delta >50% over as-of-right typically also requires Official Plan Amendment (§22).');
    }
  }

  // MV / ZBA: setback shortfalls
  if(P && P.set){
    ['front','rear','sideL','sideR'].forEach(function(side){
      var prop = P.set[side + 'Prop'];
      var req = P.set[side + 'Req'];
      if(prop != null && req != null && prop < req){
        var pct = ((req - prop) / req) * 100;
        if(pct <= mvThresholdPct){
          apps.MV = true;
          triggers.push(side + ' setback: proposed ' + prop + 'ft vs. required ' + req + 'ft (' + pct.toFixed(1) + '% shortfall) → Minor Variance (§45).');
        } else {
          apps.ZBA = true;
          triggers.push(side + ' setback: ' + pct.toFixed(1) + '% shortfall exceeds 10% MV practice threshold → ZBA required (§34).');
        }
      }
    });
  }

  // SPA: auto-detect from use + unit count
  // Toronto MC §415-3: SPC applies to multi-residential (3+ units), most
  // non-residential, and any development on lots subject to SPC by-law.
  // Detached/semi/single-family typically exempt unless explicitly designated.
  var spaReason = null;
  if(totalUnits >= 3 || (hasResidential && proposedGFAM2 > 200)){
    apps.SPA = true;
    spaReason = totalUnits >= 3
      ? 'Multi-residential (' + totalUnits + ' units, ≥3 trigger) → SPA required (Toronto MC §415-3).'
      : 'Multi-residential building → SPA required (Toronto MC §415-3).';
    triggers.push(spaReason);
  } else if(hasCommercial && proposedGFAM2 > 0){
    apps.SPA = true;
    spaReason = 'Non-residential GFA present → SPA required (Toronto MC §415-3, §415-4).';
    triggers.push(spaReason);
  }

  // Pre-Application Consultation: triggered for ZBA, OPA, or SPA
  if(apps.ZBA || apps.OPA_LIKELY || apps.SPA){
    apps.PAC = true;
  }

  // Build output
  var html = '';
  var any = apps.OPA_LIKELY || apps.ZBA || apps.MV || apps.SPA;
  var verdictColor = any ? '#ff8c42' : '#66ccaa';
  var verdictText = any ? 'APPLICATIONS REQUIRED' : 'AS-OF-RIGHT (no apps needed)';
  html += '<div style="background:rgba(255,140,66,0.08);border:1px solid ' + verdictColor + '40;border-radius:4px;padding:8px;text-align:center;margin-bottom:10px"><div style="font-size:14px;font-weight:700;color:' + verdictColor + '">' + verdictText + '</div></div>';

  // Auto-pulled metrics table
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc;margin-bottom:8px">';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:4px 0;color:#a87cff;font-weight:700">FROM RENDERED MODEL (auto)</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Zone</td><td style="text-align:right">' + zoneStr + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Lot area</td><td style="text-align:right">' + Math.round(lotAreaM2).toLocaleString() + ' m² (' + Math.round(lotAreaSF).toLocaleString() + ' sf)</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Proposed GFA</td><td style="text-align:right">' + Math.round(proposedGFAM2).toLocaleString() + ' m² (' + Math.round(proposedGFASF).toLocaleString() + ' sf)</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Proposed FSI</td><td style="text-align:right">' + proposedFSI.toFixed(2) + 'x' + (asOfRightFSI ? ' (limit ' + asOfRightFSI.toFixed(2) + 'x)' : ' (no limit set)') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Proposed height</td><td style="text-align:right">' + proposedHeightM.toFixed(1) + ' m' + (asOfRightHeightM ? ' (limit ' + asOfRightHeightM.toFixed(1) + ' m)' : ' (no limit set)') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Residential units</td><td style="text-align:right">' + (totalUnits ? totalUnits.toLocaleString() : '—') + '</td></tr>';
  html += '<tr><td style="padding:3px 0;color:#888">Use mix</td><td style="text-align:right">' + (hasResidential ? 'Resi ' : '') + (hasCommercial ? 'Comm ' : '') + (!hasResidential && !hasCommercial ? '—' : '') + '</td></tr>';
  html += '</table>';

  // Apps table
  var appList = [
    {key:'PAC', name:'Pre-Application Consultation', section:'Toronto policy + Planning Act §17(7.4)/§34(10.0.1)/§41(3.1)', timeline:'~30 days to schedule, ~60 days to receive notes'},
    {key:'OPA_LIKELY', name:'Official Plan Amendment (likely)', section:'Planning Act §22 (privately-initiated)', timeline:'120 days statutory; OLT appeal possible'},
    {key:'ZBA', name:'Zoning By-law Amendment', section:'Planning Act §34', timeline:'120 days statutory; appeal window 20 days post-decision'},
    {key:'MV', name:'Minor Variance', section:'Planning Act §45', timeline:'~3 months from filing to Committee of Adjustment hearing'},
    {key:'SPA', name:'Site Plan Approval', section:'Planning Act §41 + Toronto MC Ch.415', timeline:'30 days delegated; longer if council-approval required'}
  ];
  html += '<div style="font-size:13px;font-weight:700;color:#ff8c42;margin-bottom:4px">REQUIRED APPLICATIONS</div>';
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc;margin-bottom:8px">';
  appList.forEach(function(a){
    var req = !!apps[a.key];
    var color = req ? '#ff8c42' : '#666';
    var statusText = req ? 'REQUIRED' : '—';
    html += '<tr style="border-bottom:1px solid #333">';
    html += '<td style="padding:5px 0;color:' + color + ';font-weight:' + (req ? '700' : '400') + ';width:35%">' + a.name + '</td>';
    html += '<td style="color:#888;font-size:11px">' + a.section + (req ? '<br><span style="color:#ccc">' + a.timeline + '</span>' : '') + '</td>';
    html += '<td style="text-align:right;color:' + color + ';font-weight:700">' + statusText + '</td>';
    html += '</tr>';
  });
  html += '</table>';

  // Triggers
  if(triggers.length > 0){
    html += '<div style="margin-top:8px;padding:8px;background:rgba(255,140,66,0.08);border:1px solid #ff8c4230;border-radius:4px;font-size:12px;color:#aaa;line-height:1.6">';
    html += '<div style="font-weight:700;color:#ff8c42;margin-bottom:4px">TRIGGERS</div>';
    triggers.forEach(function(t){ html += '• ' + t + '<br>'; });
    html += '</div>';
  } else {
    html += '<div style="margin-top:8px;padding:8px;background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;font-size:12px;color:#aaa;line-height:1.6">';
    html += 'No application triggers detected. Proposal appears to be within as-of-right parameters. Verify against the actual zoning by-law text — this tool checks FSI, height, configured setbacks, and SPA-trigger use mix only.';
    html += '</div>';
  }

  // Scope note
  html += '<div style="margin-top:8px;padding:8px;background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;font-size:11px;color:#aaa;line-height:1.5">';
  html += '<div style="font-weight:700;color:#66aaff;margin-bottom:4px">SCOPE NOTE</div>';
  html += 'Constants used: 10% MV practice threshold (De Gasperis v. Vaughan), 3-unit SPA trigger (Toronto MC §415-3). Not checked: change of use, draft plan of subdivision (§51), draft plan of condominium (Condo Act §9), heritage permits (Ontario Heritage Act §33/§34), Section 37/CBC, conservation authority permits, Toronto Pearson glide-path overlays, MTSA designation impacts.';
  html += '</div>';

  resultsEl.innerHTML = html;
}

/* =====================================================================
   SHADOW STUDY — NOAA Solar Position Algorithm
   ---------------------------------------------------------------------
   Sources:
     • NOAA Earth System Research Laboratory — solar position equations
       (https://gml.noaa.gov/grad/solcalc/calcdetails.html). Uses
       Spencer 1971 truncated Fourier series for solar declination and
       NOAA equation of time. Accurate to ±0.01° vs. JPL DE405 within
       year span 1900–2100.
     • Cast shadow length L on flat ground = h / tan(altitude),
       direction = solar azimuth + 180°. Trigonometric identity, exact
       for a vertical line of height h above flat ground.
     • Toronto Tall Building Design Guidelines §3.3 — net new shadow on
       parks/POPS should not exceed 50% of plan area for any 1-hour
       interval between 9:00–18:00 on March 21 (spring equinox).
   Limitations:
     • Treats the building as a point at its tallest vertex — a true
       shadow polygon would require sweeping all roof vertices. This is
       a planning-level estimate, NOT a CGI shadow render.
     • Atmospheric refraction not corrected (negligible for h > 5°).
     • Assumes flat ground (no topography correction).
   ===================================================================== */
function _solarPositionNOAA(lat, lon, year, month, day, hourLocal, tzOffsetHr){
  // Convert local time to UTC
  var hourUTC = hourLocal - tzOffsetHr;
  // Day of year (Julian-ish; correct for leap years)
  var daysInMonth = [31,28,31,30,31,30,31,31,30,31,30,31];
  if((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) daysInMonth[1] = 29;
  var doy = day;
  for(var m = 0; m < month - 1; m++) doy += daysInMonth[m];
  // Fractional year γ in radians (NOAA equation 1)
  var gamma = (2 * Math.PI / 365) * (doy - 1 + (hourUTC - 12) / 24);
  // Equation of time (minutes), NOAA equation 3
  var eqtime = 229.18 * (
      0.000075
    + 0.001868 * Math.cos(gamma)
    - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma)
    - 0.040849 * Math.sin(2 * gamma)
  );
  // Solar declination (radians), NOAA equation 4
  var decl = 0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148  * Math.sin(3 * gamma);
  // True solar time (minutes)
  var timeOffset = eqtime + 4 * lon - 60 * tzOffsetHr;
  var tst = hourLocal * 60 + timeOffset;
  // Solar hour angle (degrees → radians)
  var ha = ((tst / 4) - 180) * Math.PI / 180;
  // Convert lat to radians
  var latR = lat * Math.PI / 180;
  // Solar zenith angle (radians)
  var cosZenith = Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha);
  cosZenith = Math.max(-1, Math.min(1, cosZenith));
  var zenith = Math.acos(cosZenith);
  var altitude = Math.PI / 2 - zenith; // radians
  // Solar azimuth (radians, measured clockwise from N)
  var cosAz = (Math.sin(decl) - Math.sin(latR) * Math.cos(zenith)) / (Math.cos(latR) * Math.sin(zenith));
  cosAz = Math.max(-1, Math.min(1, cosAz));
  var azimuth = Math.acos(cosAz);
  if(ha > 0) azimuth = 2 * Math.PI - azimuth;
  return {
    altitudeDeg: altitude * 180 / Math.PI,
    azimuthDeg: azimuth * 180 / Math.PI,
    declinationDeg: decl * 180 / Math.PI,
    eqtimeMin: eqtime
  };
}

function calcShadow(){
  var resultsEl = document.getElementById('shadow-results');
  if(!resultsEl) return;

  // Get project lat/lon — use sitemap centre if available, else Toronto City Hall
  var lat = 43.6532, lon = -79.3832; // Toronto City Hall
  var locSrc = 'Toronto City Hall (default — no sitemap fix)';
  if(P && P.lot && P.lot.centerLat && P.lot.centerLng){
    lat = P.lot.centerLat;
    lon = P.lot.centerLng;
    locSrc = 'Project sitemap fix';
  } else if(typeof window.lastSitemapCenter === 'object' && window.lastSitemapCenter){
    lat = window.lastSitemapCenter.lat;
    lon = window.lastSitemapCenter.lng;
    locSrc = 'Last sitemap centre';
  }

  // Date input (MM-DD format)
  var dateStr = document.getElementById('sh-date').value;
  var month = parseInt(dateStr.split('-')[0], 10);
  var day = parseInt(dateStr.split('-')[1], 10);
  var year = new Date().getFullYear();
  var hour = parseInt(document.getElementById('sh-time').value, 10);
  // Toronto timezone offset (EST = -5, EDT = -4). Use a date check:
  // EDT runs roughly 2nd Sun Mar – 1st Sun Nov (use simplified rule)
  var isEDT = (month > 3 && month < 11) || (month === 3 && day >= 14) || (month === 11 && day < 7);
  var tzOffset = isEDT ? -4 : -5;

  // Compute solar position
  var sp = _solarPositionNOAA(lat, lon, year, month, day, hour, tzOffset);
  var altitude = sp.altitudeDeg;
  var azimuth = sp.azimuthDeg;

  // Determine tallest building height in metres
  var tallestM = 0;
  if(P && P.vols){
    P.vols.forEach(function(v){
      var h = (v.floors || 0) * (v.storeyHeightFt || 10) + (v.baseElevFt || 0);
      var hm = h * 0.3048;
      if(hm > tallestM) tallestM = hm;
    });
  }
  if(tallestM === 0) tallestM = 30; // sensible default for messaging

  // Shadow length (metres) on flat ground
  var sunBelowHorizon = altitude <= 0;
  var shadowLenM = sunBelowHorizon ? Infinity : tallestM / Math.tan(altitude * Math.PI / 180);
  // Shadow direction = sun azimuth + 180° (shadow points away from sun)
  var shadowAzDeg = (azimuth + 180) % 360;
  var compass = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(shadowAzDeg / 22.5) % 16];

  // Compliance interpretation (only meaningful for the TBG threshold case)
  var isTBGCheck = (dateStr === '03-21' && hour >= 9 && hour <= 18);

  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html += '<div style="background:rgba(255,204,102,0.08);border:1px solid #ffcc6630;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffcc66">' + altitude.toFixed(1) + '°</div><div style="font-size:12px;color:#888">SOLAR ALTITUDE</div></div>';
  html += '<div style="background:rgba(255,204,102,0.08);border:1px solid #ffcc6630;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#ffcc66">' + azimuth.toFixed(0) + '°</div><div style="font-size:12px;color:#888">SOLAR AZIMUTH (from N)</div></div>';
  if(sunBelowHorizon){
    html += '<div style="grid-column:1/3;background:rgba(102,102,102,0.08);border:1px solid #66666630;border-radius:4px;padding:8px;text-align:center;color:#888">Sun below horizon at this time — no shadow.</div>';
  } else {
    html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">' + shadowLenM.toFixed(1) + ' m</div><div style="font-size:12px;color:#888">SHADOW LENGTH (h=' + tallestM.toFixed(0) + 'm)</div></div>';
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">' + compass + '</div><div style="font-size:12px;color:#888">SHADOW DIRECTION</div></div>';
  }
  html += '</div>';

  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Latitude / Longitude</td><td style="text-align:right">' + lat.toFixed(4) + '°, ' + lon.toFixed(4) + '°</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Location source</td><td style="text-align:right">' + locSrc + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Date / time / TZ</td><td style="text-align:right">' + year + '-' + dateStr + ' ' + (hour < 10 ? '0' : '') + hour + ':00 (UTC' + (tzOffset >= 0 ? '+' : '') + tzOffset + ')</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Solar declination</td><td style="text-align:right">' + sp.declinationDeg.toFixed(2) + '°</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Equation of time</td><td style="text-align:right">' + sp.eqtimeMin.toFixed(1) + ' min</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Tallest building point</td><td style="text-align:right">' + tallestM.toFixed(1) + ' m</td></tr>';
  html += '<tr><td style="padding:3px 0;color:#888">Shadow azimuth (from N)</td><td style="text-align:right">' + shadowAzDeg.toFixed(0) + '° (' + compass + ')</td></tr>';
  html += '</table>';

  if(isTBGCheck){
    html += '<div style="margin-top:8px;padding:8px;background:rgba(255,204,102,0.08);border:1px solid #ffcc6630;border-radius:4px;font-size:12px;color:#aaa;line-height:1.5">';
    html += '<div style="font-weight:700;color:#ffcc66;margin-bottom:4px">TBG SHADOW THRESHOLD CHECK</div>';
    html += 'Mar 21 between 9:00–18:00 is the Toronto Tall Building Design Guidelines compliance window. Net new shadow on adjacent parks/POPS must not exceed 50% of plan area in any 1-hour interval. The shadow extends ' + shadowLenM.toFixed(0) + ' m to the ' + compass + ' from your tallest point. To verify compliance, overlay this cast distance against any park boundaries within ' + Math.ceil(shadowLenM) + ' m.';
    html += '</div>';
  }

  resultsEl.innerHTML = html;
}

/* =====================================================================
   INCLUSIONARY ZONING ESTIMATOR
   ---------------------------------------------------------------------
   Sources:
     • City of Toronto Inclusionary Zoning By-law 89-2022 (consolidated).
       Authority: Planning Act §35.2.
     • Trigger: residential development of 100+ units within a Protected
       Major Transit Station Area (PMTSA) per OPA 558.
     • Affordable rent definitions (Toronto IZ Policy):
         Low-income tier:    ≤60% of CMHC AMR
         Moderate-income:    ≤80% of CMHC AMR
         Middle-income:      ≤100% of CMHC AMR
     • Affordability period: 99 years (By-law 89-2022).
   Limitations: PMTSA boundary not embedded — user toggles. AMR varies
   by unit-type and CMHC CMA — user inputs the relevant figure.
   ===================================================================== */
function calcInclusionaryZoning(){
  var resultsEl = document.getElementById('iz-results');
  if(!resultsEl) return;

  var inPMTSA = document.getElementById('iz-pmtsa').value === 'yes';
  var izRate  = (parseFloat(document.getElementById('iz-rate').value) || 0) / 100;
  var amr     = parseFloat(document.getElementById('iz-amr').value) || 0;
  var affShare= (parseFloat(document.getElementById('iz-affshare').value) || 80) / 100;

  // Total residential units (auto-pulled from pro-forma / volumes)
  var totalUnits = 0;
  if(typeof pfData === 'function'){
    try { totalUnits = (pfData() || {}).totalUnits || 0; } catch(e){}
  }
  if(totalUnits === 0 && P && P.vols){
    P.vols.forEach(function(v){
      if(v.use === 'residential' || v.use === 'mixed'){
        totalUnits += Math.floor((v.floors || 10) * ((v.width || 50) * (v.depth || 50)) * 0.85 / 750);
      }
    });
  }

  var triggers = !inPMTSA ? false : (totalUnits >= 100);
  var requiredAffordable = triggers ? Math.ceil(totalUnits * izRate) : 0;
  var marketRent = amr;
  var affordableRent = amr * affShare;
  var monthlyGap = marketRent - affordableRent;
  var annualGap = monthlyGap * 12;

  // 99-year value gap, present-valued at a typical discount rate (5% real)
  // PV(annuity) = C × (1 − (1+r)^-n) / r
  var r = 0.05;
  var n = 99;
  var pvFactor = (1 - Math.pow(1 + r, -n)) / r;
  var perUnitValueGapPV = annualGap * pvFactor;
  var totalValueGapPV = perUnitValueGapPV * requiredAffordable;

  var html = '';
  var verdictColor = triggers ? '#ff8c42' : '#66ccaa';
  var verdictText = !inPMTSA ? 'IZ DOES NOT APPLY (not in PMTSA)' :
                    triggers ? 'IZ APPLIES — affordable units required' :
                               'IZ DOES NOT APPLY (<100 units)';
  html += '<div style="background:rgba(255,140,66,0.08);border:1px solid ' + verdictColor + '40;border-radius:4px;padding:8px;text-align:center;margin-bottom:10px"><div style="font-size:14px;font-weight:700;color:' + verdictColor + '">' + verdictText + '</div></div>';

  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc;margin-bottom:8px">';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Total residential units</td><td style="text-align:right">' + totalUnits.toLocaleString() + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">In PMTSA?</td><td style="text-align:right">' + (inPMTSA ? 'Yes' : 'No') + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">100-unit threshold met?</td><td style="text-align:right">' + (totalUnits >= 100 ? 'Yes' : 'No (' + totalUnits + ' units)') + '</td></tr>';
  if(triggers){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">IZ rate applied</td><td style="text-align:right">' + (izRate * 100).toFixed(1) + '%</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Required affordable units</td><td style="text-align:right;color:#ff8c42;font-weight:700">' + requiredAffordable + '</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Market rent (1BR)</td><td style="text-align:right">$' + marketRent.toLocaleString() + '/mo</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Affordable rent (' + Math.round(affShare*100) + '% AMR)</td><td style="text-align:right">$' + Math.round(affordableRent).toLocaleString() + '/mo</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Annual rent gap / unit</td><td style="text-align:right">$' + Math.round(annualGap).toLocaleString() + '/yr</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">99-yr PV factor (5% discount)</td><td style="text-align:right">' + pvFactor.toFixed(2) + '</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Per-unit value gap (PV)</td><td style="text-align:right">$' + Math.round(perUnitValueGapPV).toLocaleString() + '</td></tr>';
    html += '<tr><td style="padding:3px 0;color:#888;font-weight:700">Total IZ value gap (PV)</td><td style="text-align:right;color:#ff8c42;font-weight:700">$' + Math.round(totalValueGapPV).toLocaleString() + '</td></tr>';
  }
  html += '</table>';

  if(triggers){
    html += '<div style="margin-top:8px;padding:8px;background:rgba(255,140,66,0.08);border:1px solid #ff8c4230;border-radius:4px;font-size:12px;color:#aaa;line-height:1.6">';
    html += '<div style="font-weight:700;color:#ff8c42;margin-bottom:4px">PRO-FORMA IMPACT</div>';
    html += 'Roughly $' + Math.round(totalValueGapPV / 1000000 * 10) / 10 + 'M of present-value income foregone over the 99-year affordability period (vs. market rent), at a 5% real discount rate. This is the opportunity cost the IRR model should absorb. Capital subsidies (HSP, MURP, CMHC RCFi) and section 37/CBC offsets may reduce net impact.';
    html += '</div>';
  }

  resultsEl.innerHTML = html;
}


/* =====================================================================
   WALKABILITY + TRANSIT PROXIMITY
   ---------------------------------------------------------------------
   Reports objective distance metrics, not a proprietary "Walk Score".
   Sources:
     • TTC subway + Line 5 station coordinates: bundled from publicly
       published TTC station list (ttc.ca). Lines 1, 2, 4, 5 included.
     • Amenity counts: Mapbox Search Box API /category endpoint.
     • Distance: haversine formula (great-circle on WGS84).
   ===================================================================== */
/* TTC station data is bundled from official GTFS feed (data/ttc-rapid-stops.min.js
   and data/ttc-streetcar-stops.min.js). window._ttcRapidStops and
   window._ttcStreetcarStops are populated before this script loads. */

function _haversineKm(lat1, lng1, lat2, lng2){
  var R = 6371; // earth radius km
  var toRad = function(d){ return d * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLng/2) * Math.sin(dLng/2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function calcWalkability(){
  var resultsEl = document.getElementById('walkability-results');
  if(!resultsEl) return;

  // Site coordinates
  var lat = null, lng = null, locSrc = '';
  if(P && P.siteCoords && P.siteCoords.lat && P.siteCoords.lng){
    lat = P.siteCoords.lat;
    lng = P.siteCoords.lng;
    locSrc = 'P.siteCoords';
  } else if(P && P.lot && P.lot.centerLat && P.lot.centerLng){
    lat = P.lot.centerLat;
    lng = P.lot.centerLng;
    locSrc = 'P.lot.center';
  }
  if(lat == null || lng == null){
    resultsEl.innerHTML = '<div style="padding:8px;background:rgba(255,68,68,0.08);border:1px solid #ff444430;border-radius:4px;color:#ff8866;font-size:12px">No site coordinates set. Pick a site on the map first.</div>';
    return;
  }

  // ── RAPID TRANSIT (subway + LRT) from bundled GTFS ──
  var rapid = (typeof window !== 'undefined' && window._ttcRapidStops) ? window._ttcRapidStops : [];
  var streetcars = (typeof window !== 'undefined' && window._ttcStreetcarStops) ? window._ttcStreetcarStops : [];
  var feedInfo = (typeof window !== 'undefined' && window._ttcFeedInfo) ? window._ttcFeedInfo : {};

  // Distance to nearest rapid transit station, broken out by mode
  var nearestSubway = null, nearestSubwayDist = Infinity;
  var nearestLRT5  = null, nearestLRT5Dist  = Infinity;
  var nearestLRT6  = null, nearestLRT6Dist  = Infinity;
  var nearestAny   = null, nearestAnyDist   = Infinity;
  var rapidWithin500m = 0, rapidWithin1km = 0;
  rapid.forEach(function(st){
    var d = _haversineKm(lat, lng, st.lat, st.lng);
    if(d < nearestAnyDist){ nearestAnyDist = d; nearestAny = st; }
    if(st.mode === 'Subway' && d < nearestSubwayDist){ nearestSubwayDist = d; nearestSubway = st; }
    if(st.mode === 'LRT-5' && d < nearestLRT5Dist){  nearestLRT5Dist  = d; nearestLRT5  = st; }
    if(st.mode === 'LRT-6' && d < nearestLRT6Dist){  nearestLRT6Dist  = d; nearestLRT6  = st; }
    if(d <= 0.5) rapidWithin500m++;
    if(d <= 1.0) rapidWithin1km++;
  });

  // Streetcar — nearest stop + counts
  var nearestStreetcar = null, nearestStreetcarDist = Infinity;
  var streetcarWithin500m = 0, streetcarWithin1km = 0;
  streetcars.forEach(function(st){
    var d = _haversineKm(lat, lng, st.lat, st.lng);
    if(d < nearestStreetcarDist){ nearestStreetcarDist = d; nearestStreetcar = st; }
    if(d <= 0.5) streetcarWithin500m++;
    if(d <= 1.0) streetcarWithin1km++;
  });

  // KPI row — show whichever transit type is closest first
  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  if(nearestAny){
    var labelLine = nearestAny.lines && nearestAny.lines.length ? nearestAny.lines.join(' / ') : nearestAny.mode;
    html += '<div style="background:rgba(66,179,255,0.08);border:1px solid #42b3ff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#42b3ff">' + (nearestAnyDist * 1000).toFixed(0) + ' m</div><div style="font-size:12px;color:#888">TO NEAREST RAPID TRANSIT</div></div>';
    html += '<div style="background:rgba(66,179,255,0.08);border:1px solid #42b3ff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#42b3ff">' + nearestAny.name + '</div><div style="font-size:12px;color:#888">' + labelLine + '</div></div>';
  }
  if(nearestStreetcar){
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid #66ccaa30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66ccaa">' + (nearestStreetcarDist * 1000).toFixed(0) + ' m</div><div style="font-size:12px;color:#888">TO NEAREST STREETCAR STOP</div></div>';
  }
  html += '<div style="background:rgba(168,124,255,0.08);border:1px solid #a87cff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#a87cff">' + rapidWithin1km + '</div><div style="font-size:12px;color:#888">RAPID TRANSIT STATIONS ≤1km</div></div>';
  html += '</div>';

  // Detail table
  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc;margin-bottom:8px">';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#42b3ff;font-weight:700">RAPID TRANSIT (TTC GTFS)</td></tr>';
  if(nearestSubway){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Nearest subway</td><td style="text-align:right">' + nearestSubway.name + ' — ' + (nearestSubwayDist*1000).toFixed(0) + ' m (~' + Math.round(nearestSubwayDist/4.5*60) + ' min walk)</td></tr>';
  }
  if(nearestLRT5){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Nearest Line 5 LRT</td><td style="text-align:right">' + nearestLRT5.name + ' — ' + (nearestLRT5Dist*1000).toFixed(0) + ' m</td></tr>';
  }
  if(nearestLRT6){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Nearest Line 6 LRT</td><td style="text-align:right">' + nearestLRT6.name + ' — ' + (nearestLRT6Dist*1000).toFixed(0) + ' m</td></tr>';
  }
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Stations ≤500m / ≤1km</td><td style="text-align:right">' + rapidWithin500m + ' / ' + rapidWithin1km + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#66ccaa;font-weight:700">STREETCARS (TTC GTFS)</td></tr>';
  if(nearestStreetcar){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Nearest streetcar stop</td><td style="text-align:right">' + nearestStreetcar.name.substring(0, 50) + ' — ' + (nearestStreetcarDist*1000).toFixed(0) + ' m</td></tr>';
  }
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Streetcar stops ≤500m / ≤1km</td><td style="text-align:right">' + streetcarWithin500m + ' / ' + streetcarWithin1km + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#888;font-weight:700">DATA PROVENANCE</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Site coordinates</td><td style="text-align:right">' + lat.toFixed(4) + '°, ' + lng.toFixed(4) + '°</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">TTC GTFS feed version</td><td style="text-align:right">' + (feedInfo.feed_version || '?') + '</td></tr>';
  html += '<tr><td style="padding:3px 0;color:#888">Feed coverage</td><td style="text-align:right">' + (feedInfo.feed_start_date || '?') + ' – ' + (feedInfo.feed_end_date || '?') + '</td></tr>';
  html += '</table>';

  html += '<div id="walkability-amenities" style="font-size:12px;color:#888;margin-top:8px">Loading amenity counts from Mapbox…</div>';
  resultsEl.innerHTML = html;

  // ── AMENITIES via Mapbox Search Box API ──
  var token = (typeof mapboxgl !== 'undefined' && mapboxgl.accessToken) ? mapboxgl.accessToken : null;
  if(!token){
    document.getElementById('walkability-amenities').innerHTML = '<div style="color:#ff8866">Mapbox token not loaded — amenity counts unavailable.</div>';
    return;
  }
  var categories = [
    {key:'grocery', label:'Grocery'},
    {key:'restaurant', label:'Restaurant'},
    {key:'school', label:'School'},
    {key:'park', label:'Park'},
    {key:'medical_clinic', label:'Medical clinic'},
    {key:'pharmacy', label:'Pharmacy'},
    {key:'transit_station', label:'Transit station (Mapbox)'},
    {key:'bus_station', label:'Bus stop (Mapbox)'}
  ];
  var counts1km = {}, counts500m = {};
  var done = 0;
  categories.forEach(function(cat){ counts1km[cat.key] = 0; counts500m[cat.key] = 0; });

  function _renderAmenities(){
    var ah = '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc;margin-top:8px">';
    ah += '<tr style="border-bottom:1px solid #333"><td colspan="3" style="padding:5px 0;color:#42b3ff;font-weight:700">AMENITIES (Mapbox)</td></tr>';
    ah += '<tr style="border-bottom:1px solid #333"><td style="color:#888;padding:3px 0">Category</td><td style="color:#888;text-align:right">≤500m</td><td style="color:#888;text-align:right">≤1km</td></tr>';
    categories.forEach(function(cat){
      ah += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0">' + cat.label + '</td><td style="text-align:right">' + counts500m[cat.key] + '</td><td style="text-align:right">' + counts1km[cat.key] + '</td></tr>';
    });
    ah += '</table>';
    document.getElementById('walkability-amenities').innerHTML = ah;
  }

  categories.forEach(function(cat){
    var url = 'https://api.mapbox.com/search/searchbox/v1/category/' + cat.key
      + '?access_token=' + token
      + '&proximity=' + lng + ',' + lat
      + '&limit=25'
      + '&language=en';
    fetch(url).then(function(r){ return r.json(); }).then(function(data){
      if(data.features){
        data.features.forEach(function(f){
          if(f.geometry && f.geometry.coordinates){
            var fLng = f.geometry.coordinates[0], fLat = f.geometry.coordinates[1];
            var d = _haversineKm(lat, lng, fLat, fLng);
            if(d <= 1.0) counts1km[cat.key]++;
            if(d <= 0.5) counts500m[cat.key]++;
          }
        });
      }
      done++;
      if(done >= categories.length){ _renderAmenities(); }
    }).catch(function(){
      done++;
      if(done >= categories.length){ _renderAmenities(); }
    });
  });
}

/* =====================================================================
   WATERMAIN CAPACITY CHECK
   ---------------------------------------------------------------------
   Sources:
     • Domestic per-capita water use: MECP Design Guidelines for
       Drinking-Water Systems (formerly MOE Sewage/Water Works
       Guidelines). Toronto residential range 225–450 L/cap/day.
     • Peaking factor 2.5 standard for max-day demand (AWWA M32 range
       2.0–3.0).
     • Pipe capacity: continuity equation Q = v × A where
       A = π × (d/2)². Design velocity 1.5 m/s is the upper limit for
       ductile-iron mains per AWWA C150.
     • Pipe data: Toronto Open Data CKAN watermain dataset.
   ===================================================================== */
function calcWaterCapacity(){
  var resultsEl = document.getElementById('watercap-results');
  if(!resultsEl) return;

  // Inputs
  var pplPerUnit = parseFloat(document.getElementById('wc-ppl').value)        || 2.4;
  var peaking    = parseFloat(document.getElementById('wc-peaking').value)    || 2.5;
  var velocity   = parseFloat(document.getElementById('wc-velocity').value)   || 1.5;
  var domestic   = parseFloat(document.getElementById('wc-domestic').value)   || 350;

  // Pull units + commercial GFA
  var totalUnits = 0, commGFASF = 0;
  if(typeof pfData === 'function'){
    try {
      var d = pfData();
      totalUnits = d.totalUnits || 0;
      commGFASF = d.commGFA || 0;
    } catch(e){}
  }
  var commGFAm2 = commGFASF * 0.092903;

  // Demand calc
  var people = totalUnits * pplPerUnit;
  var resDemandLpd = people * domestic;
  var commDemandLpd = commGFAm2 * 0.75; // 75 L per 100 m² per day → 0.75 L/m²/day for office/retail (MECP range)
  var avgDayDemandLpd = resDemandLpd + commDemandLpd;
  var maxDayDemandLpd = avgDayDemandLpd * peaking;
  var maxDayDemandM3pd = maxDayDemandLpd / 1000;
  var maxDayDemandLps = maxDayDemandLpd / 86400;

  // Pipe data from infrastructure scan
  // Records can carry the diameter/material/street under either the old
  // CKAN column names (PIPE_SIZE / STREET_NAME / MATERIAL) or the new
  // bundled-data field names (diameter / material / street). Read both.
  function _getDiameter(p){
    var v = p.diameter != null ? p.diameter
          : p.PIPE_SIZE != null ? p.PIPE_SIZE
          : p.pipe_size != null ? p.pipe_size : null;
    var n = parseFloat(v);
    return isFinite(n) && n > 0 ? n : null;
  }
  function _getMaterial(p){ return p.material || p.MATERIAL || ''; }
  function _getStreet(p){   return p.street   || p.STREET_NAME || (p.assetId ? 'Pipe ' + p.assetId : 'Pipe'); }
  function _getYear(p){     return p.year || p.INSTALL_YEAR || ''; }

  var pipes = (typeof _infraData !== 'undefined' && _infraData && _infraData.watermain) ? _infraData.watermain : null;
  var pipeRows = '';
  var capacityRowMM = null;
  if(Array.isArray(pipes) && pipes.length > 0){
    // Find smallest-diameter pipe (most constrained)
    var mins = pipes.slice().filter(function(p){ return _getDiameter(p) != null; });
    mins.sort(function(a, b){ return _getDiameter(a) - _getDiameter(b); });
    capacityRowMM = mins.length > 0 ? _getDiameter(mins[0]) : null;
    // Show 5 nearest pipes (pipes are already sorted by distance from scan)
    pipes.slice(0, 5).forEach(function(p){
      var d = _getDiameter(p);
      var distLbl = (typeof p.dist === 'number') ? ' · ' + p.dist + ' m' : '';
      pipeRows += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">' + _getStreet(p) + distLbl + '</td><td style="text-align:right">' + (d || '?') + ' mm ' + _getMaterial(p) + '</td></tr>';
    });
  }

  // Capacity from continuity Q = v × A
  // For a 200 mm pipe: A = π × (0.1)² = 0.0314 m², Q = 1.5 × 0.0314 = 0.0471 m³/s = 47 L/s
  var pipeCapacityLps = null, pipeCapacityM3pd = null, marginPct = null;
  if(capacityRowMM){
    var areaM2 = Math.PI * Math.pow(capacityRowMM / 1000 / 2, 2);
    var capacityM3ps = velocity * areaM2;
    pipeCapacityLps = capacityM3ps * 1000;
    pipeCapacityM3pd = capacityM3ps * 86400;
    marginPct = ((pipeCapacityLps - maxDayDemandLps) / pipeCapacityLps) * 100;
  }

  // Build output
  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">';
  html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">' + Math.round(maxDayDemandM3pd).toLocaleString() + ' m³/d</div><div style="font-size:12px;color:#888">MAX-DAY DEMAND</div></div>';
  html += '<div style="background:rgba(102,170,255,0.08);border:1px solid #66aaff30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:#66aaff">' + maxDayDemandLps.toFixed(2) + ' L/s</div><div style="font-size:12px;color:#888">PEAK FLOW</div></div>';
  if(capacityRowMM){
    var capColor = marginPct < 0 ? '#ff4444' : marginPct < 30 ? '#ffaa44' : '#66ccaa';
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid ' + capColor + '30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:' + capColor + '">' + capacityRowMM + ' mm</div><div style="font-size:12px;color:#888">SMALLEST PIPE NEAR SITE</div></div>';
    html += '<div style="background:rgba(102,204,170,0.08);border:1px solid ' + capColor + '30;border-radius:4px;padding:8px"><div style="font-size:14px;font-weight:700;color:' + capColor + '">' + (marginPct >= 0 ? '+' : '') + marginPct.toFixed(0) + '%</div><div style="font-size:12px;color:#888">CAPACITY MARGIN</div></div>';
  } else {
    html += '<div style="grid-column:1/3;background:rgba(255,170,68,0.08);border:1px solid #ffaa4430;border-radius:4px;padding:8px;text-align:center;color:#ffaa44">No pipe data — run SCAN INFRASTRUCTURE to enable capacity comparison.</div>';
  }
  html += '</div>';

  html += '<table style="width:100%;font-size:12px;border-collapse:collapse;color:#ccc">';
  html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#66aaff;font-weight:700">DEMAND CALCULATION</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Residential units</td><td style="text-align:right">' + totalUnits.toLocaleString() + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Population estimate (' + pplPerUnit + ' ppl/unit)</td><td style="text-align:right">' + Math.round(people).toLocaleString() + '</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Residential demand (' + domestic + ' L/cap/day)</td><td style="text-align:right">' + Math.round(resDemandLpd).toLocaleString() + ' L/d</td></tr>';
  if(commGFAm2 > 0){
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Commercial demand (' + Math.round(commGFAm2).toLocaleString() + ' m²)</td><td style="text-align:right">' + Math.round(commDemandLpd).toLocaleString() + ' L/d</td></tr>';
  }
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Average-day demand</td><td style="text-align:right">' + Math.round(avgDayDemandLpd).toLocaleString() + ' L/d</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Peaking factor (max-day)</td><td style="text-align:right">' + peaking + '×</td></tr>';
  html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Max-day demand</td><td style="text-align:right;color:#66aaff;font-weight:700">' + Math.round(maxDayDemandM3pd) + ' m³/d (' + maxDayDemandLps.toFixed(2) + ' L/s)</td></tr>';
  if(capacityRowMM){
    html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#66ccaa;font-weight:700">PIPE CAPACITY (continuity Q=v×A)</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pipe diameter</td><td style="text-align:right">' + capacityRowMM + ' mm</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Pipe area</td><td style="text-align:right">' + (Math.PI * Math.pow(capacityRowMM/1000/2, 2)).toFixed(4) + ' m²</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Design velocity</td><td style="text-align:right">' + velocity + ' m/s</td></tr>';
    html += '<tr style="border-bottom:1px solid #333"><td style="padding:3px 0;color:#888">Estimated capacity</td><td style="text-align:right;color:#66ccaa;font-weight:700">' + pipeCapacityLps.toFixed(1) + ' L/s (' + Math.round(pipeCapacityM3pd).toLocaleString() + ' m³/d)</td></tr>';
  }
  if(pipeRows){
    html += '<tr style="border-bottom:1px solid #333"><td colspan="2" style="padding:5px 0;color:#66ccaa;font-weight:700">NEARBY WATERMAINS (top 5)</td></tr>';
    html += pipeRows;
  }
  html += '</table>';

  if(capacityRowMM){
    var msgColor = marginPct < 0 ? '#ff4444' : marginPct < 30 ? '#ffaa44' : '#66ccaa';
    var msgText  = marginPct < 0 ?
        'Demand exceeds nearest pipe capacity. Likely upgrade required — request a Functional Servicing Report and consult Toronto Water capacity confirmation.' :
      marginPct < 30 ?
        'Margin tight (<30%). Recommend Functional Servicing Report to confirm available capacity at hydrant/connection point under fire-flow conditions.' :
        'Capacity appears comfortable on a screening basis. A Functional Servicing Report (P.Eng.) is still required for development application.';
    html += '<div style="margin-top:8px;padding:8px;background:rgba(102,204,170,0.08);border:1px solid ' + msgColor + '40;border-radius:4px;font-size:12px;color:#aaa;line-height:1.6">';
    html += '<div style="font-weight:700;color:' + msgColor + ';margin-bottom:4px">SCREENING VERDICT</div>';
    html += msgText;
    html += '</div>';
  }

  resultsEl.innerHTML = html;
}

/* =====================================================================
   TTC TRANSIT MAP OVERLAY
   ---------------------------------------------------------------------
   Renders the bundled TTC GTFS stops as a layered Mapbox visual on the
   Site Plan map. Mode-specific colours match TTC's official wayfinding:
     • Subway (Lines 1, 2, 4): #FFCC00 (yellow)
     • Line 5 Eglinton:        #65BC55 (green-yellow Crosstown signage)
     • Line 6 Finch West:      #C42032 (red — TTC Finch West signage)
     • Streetcar:              #DA291C (TTC red)
   Same glow + outlined-circle + label pattern as civil infrastructure.
   ===================================================================== */
var _ttcTransitVisible = false;
var _TTC_LAYER_IDS = {
  subway:    ['ttc-subway-pt', 'ttc-subway-glow', 'ttc-subway-label'],
  lrt5:      ['ttc-lrt5-pt',   'ttc-lrt5-glow',   'ttc-lrt5-label'],
  lrt6:      ['ttc-lrt6-pt',   'ttc-lrt6-glow',   'ttc-lrt6-label'],
  streetcar: ['ttc-streetcar-pt', 'ttc-streetcar-glow']
};
var _TTC_SOURCE_IDS = {
  subway:    'ttc-subway-src',
  lrt5:      'ttc-lrt5-src',
  lrt6:      'ttc-lrt6-src',
  streetcar: 'ttc-streetcar-src'
};

function _ttcMakeFC(stops){
  return {
    type: 'FeatureCollection',
    features: stops.map(function(s){
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        properties: { name: s.name, mode: s.mode || 'streetcar', lines: (s.lines||[]).join(',') }
      };
    })
  };
}

function renderTTCTransitOnMap(){
  if(typeof smMap === 'undefined' || !smMap) return;
  if(!smMap.isStyleLoaded || !smMap.isStyleLoaded()){
    smMap.once('style.load', renderTTCTransitOnMap);
    return;
  }

  var rapid = (typeof window !== 'undefined' && window._ttcRapidStops) ? window._ttcRapidStops : [];
  var streetcars = (typeof window !== 'undefined' && window._ttcStreetcarStops) ? window._ttcStreetcarStops : [];

  var subway = rapid.filter(function(s){ return s.mode === 'Subway'; });
  var lrt5   = rapid.filter(function(s){ return s.mode === 'LRT-5'; });
  var lrt6   = rapid.filter(function(s){ return s.mode === 'LRT-6'; });

  removeTTCTransitOverlay();

  function _addStationLayer(srcId, layerIds, fc, color, radius, withLabel){
    if(!fc.features.length) return;
    smMap.addSource(srcId, {type:'geojson', data:fc});
    smMap.addLayer({
      id: layerIds[1], type:'circle', source: srcId,
      paint:{
        'circle-radius': radius + 8,
        'circle-color': color,
        'circle-opacity': 0.45,
        'circle-blur': 0.8
      }
    });
    smMap.addLayer({
      id: layerIds[0], type:'circle', source: srcId,
      paint:{
        'circle-radius': radius,
        'circle-color': color,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 3,
        'circle-opacity': 1.0
      }
    });
    if(withLabel){
      smMap.addLayer({
        id: layerIds[2], type:'symbol', source: srcId,
        minzoom: 12,
        layout:{
          'text-field': ['get','name'],
          'text-font': ['DIN Pro Bold','Arial Unicode MS Bold'],
          'text-size': 13,
          'text-offset': [0, 1.6],
          'text-anchor': 'top',
          'text-allow-overlap': false
        },
        paint:{
          'text-color': '#ffffff',
          'text-halo-color': color,
          'text-halo-width': 2.5
        }
      });
    }
  }

  /* Larger radii + bolder labels so stations are unmistakable. */
  _addStationLayer(_TTC_SOURCE_IDS.subway,    _TTC_LAYER_IDS.subway,    _ttcMakeFC(subway),    '#FFCC00', 12, true);
  _addStationLayer(_TTC_SOURCE_IDS.lrt5,      _TTC_LAYER_IDS.lrt5,      _ttcMakeFC(lrt5),      '#65BC55', 11, true);
  _addStationLayer(_TTC_SOURCE_IDS.lrt6,      _TTC_LAYER_IDS.lrt6,      _ttcMakeFC(lrt6),      '#C42032', 11, true);
  _addStationLayer(_TTC_SOURCE_IDS.streetcar, _TTC_LAYER_IDS.streetcar, _ttcMakeFC(streetcars), '#DA291C', 5, false);

  _ttcTransitVisible = true;
  _attachTTCPopups();

  /* Also render 3D markers on the Site Plan (Three.js) scene. */
  renderTTCTransitOn3DScene();
  console.log('[TTC] Rendered ' + subway.length + ' subway, ' + lrt5.length + ' LRT-5, ' + lrt6.length + ' LRT-6, ' + streetcars.length + ' streetcar stops on Site Map. 3D markers: see Site Plan scene.');
}

function removeTTCTransitOverlay(){
  if(typeof smMap !== 'undefined' && smMap){
    Object.keys(_TTC_LAYER_IDS).forEach(function(key){
      _TTC_LAYER_IDS[key].forEach(function(id){
        try { if(smMap.getLayer(id)) smMap.removeLayer(id); } catch(e){}
      });
    });
    Object.keys(_TTC_SOURCE_IDS).forEach(function(key){
      try { if(smMap.getSource(_TTC_SOURCE_IDS[key])) smMap.removeSource(_TTC_SOURCE_IDS[key]); } catch(e){}
    });
  }
  removeTTCTransit3DScene();
  _ttcTransitVisible = false;
}

function toggleTTCTransitOverlay(){
  if(_ttcTransitVisible){ removeTTCTransitOverlay(); }
  else { renderTTCTransitOnMap(); }
  var btn = document.getElementById('ttc-toggle-btn');
  if(btn) btn.textContent = _ttcTransitVisible ? '✕ HIDE TRANSIT' : '🚇 SHOW TRANSIT';
}

/* ── 3D SCENE MARKERS (Site Plan tab) ──────────────────────────────────
   Converts each station's lat/lng to local-feet coordinates using the
   same formula renderer-components.js uses for context buildings:
     xFt = haversine(origin, [lng, originLat])  · sign by lng > originLng
     zFt = haversine(origin, [originLng, lat])  · sign by lat < originLat
   Then position in scene meters with Y negated (per project convention
   for the rotateX(-π/2) extrude pipeline) and a fixed height above ground
   so markers always sit above terrain. */
var _ttcSceneGroup = null;

function _ttcLngLatToSceneXZ(lng, lat){
  /* Convert lat/lng to scene-coordinate metres.
     Project convention: X+ = East, Z+ = South.
     This MUST match how context buildings are placed (see
     renderer-components.js around L368).
     For a sphere/pole marker (no ExtrudeGeometry + rotateX trick),
     the pos goes DIRECTLY into scene.position(x,y,z) — no extra
     Y/Z flips.  */
  if(!P || !P._gpsOrigin || typeof turf === 'undefined') return null;
  var oLng = P._gpsOrigin.lng, oLat = P._gpsOrigin.lat;
  var FT = 0.3048;
  var xM = turf.distance(turf.point([oLng, oLat]), turf.point([lng, oLat]), {units:'meters'});
  var xFt = xM * 3.28084 * (lng > oLng ? 1 : -1);  // east positive
  var zM = turf.distance(turf.point([oLng, oLat]), turf.point([oLng, lat]), {units:'meters'});
  var zFt = zM * 3.28084 * (lat < oLat ? 1 : -1);  // south positive
  return { x: xFt * FT, z: zFt * FT };  /* DIRECT mapping; do not negate */
}

function _ttcStationLabelSprite(label, hexColor){
  /* Dedicated label sprite for transit stations: coloured pill background,
     bold white text with halo, drawn via canvas → CanvasTexture → Sprite.
     Sprites always face the camera, so the label reads from any angle. */
  var canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  var ctx = canvas.getContext('2d');
  // Measure text first
  var fontSize = 56;
  ctx.font = 'bold ' + fontSize + 'px Outfit, "DM Sans", sans-serif';
  var metrics = ctx.measureText(label);
  var textW = metrics.width;
  var pillW = textW + 60;          // generous horizontal padding
  var pillH = fontSize + 28;       // vertical padding
  var pillX = (canvas.width - pillW) / 2;
  var pillY = (canvas.height - pillH) / 2;
  var radius = pillH / 2;
  // Filled pill background in station colour
  ctx.fillStyle = hexColor;
  ctx.beginPath();
  ctx.moveTo(pillX + radius, pillY);
  ctx.lineTo(pillX + pillW - radius, pillY);
  ctx.arcTo(pillX + pillW, pillY, pillX + pillW, pillY + radius, radius);
  ctx.lineTo(pillX + pillW, pillY + pillH - radius);
  ctx.arcTo(pillX + pillW, pillY + pillH, pillX + pillW - radius, pillY + pillH, radius);
  ctx.lineTo(pillX + radius, pillY + pillH);
  ctx.arcTo(pillX, pillY + pillH, pillX, pillY + pillH - radius, radius);
  ctx.lineTo(pillX, pillY + radius);
  ctx.arcTo(pillX, pillY, pillX + radius, pillY, radius);
  ctx.closePath();
  ctx.fill();
  // White outer ring for high contrast against satellite imagery
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Bold white label text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Drop-shadow for readability
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  ctx.shadowBlur = 0;
  var tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  var mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    toneMapped: false,
    depthTest: false   // always render on top — labels never occluded
  });
  var sprite = new THREE.Sprite(mat);
  // World-units scale: pill is ~9–14 m wide depending on label length
  var widthMeters = (pillW / 9);  // 2x larger again — readable at full orbit zoom
  sprite.scale.set(widthMeters, widthMeters * (canvas.height / canvas.width), 1);
  sprite.renderOrder = 999;        // ensure last in render queue
  return sprite;
}

function _ttcMakeStationMarker(color, label, isStation){
  /* Vertical pole + spherical bulb + glow halo + ground-disc anchor.
     Streetcar stops now have a much larger bulb, taller pole, brighter
     glow, and a coloured ring on the ground so they read as a distinct
     element rather than "small dot". */
  var gr = new THREE.Group();
  var heightM = isStation ? 18 : 9;        // streetcar pole now 9 m (was 5)
  var bulbR   = isStation ? 2.2 : 1.6;     // streetcar bulb 1.6 m (was 0.8)

  // Ground-anchor ring — bright coloured disc + thin white outline so the
  // marker reads from a top-down/orbit view even when bulb is at small zoom
  var anchorR = isStation ? 2.5 : 2.2;
  var anchorMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
  var anchor = new THREE.Mesh(new THREE.CircleGeometry(anchorR, 24), anchorMat);
  anchor.rotation.x = -Math.PI / 2;
  anchor.position.y = 0.05;
  gr.add(anchor);
  var anchorOuter = new THREE.Mesh(new THREE.CircleGeometry(anchorR * 1.15, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, toneMapped: false, depthWrite: false }));
  anchorOuter.rotation.x = -Math.PI / 2;
  anchorOuter.position.y = 0.04;
  gr.add(anchorOuter);

  // Pole — tagged ttcTall so click-to-minimize can hide it
  var pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, heightM, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  );
  pole.position.y = heightM / 2;
  pole.userData.ttcTall = true;
  gr.add(pole);

  // Bulb
  var bulb = new THREE.Mesh(
    new THREE.SphereGeometry(bulbR, 16, 12),
    new THREE.MeshBasicMaterial({ color: color, toneMapped: false })
  );
  bulb.position.y = heightM + bulbR;
  bulb.userData.ttcTall = true;
  gr.add(bulb);

  // Glow — streetcar stops get a brighter (0.40) glow vs station 0.25
  var glowOpacity = isStation ? 0.25 : 0.40;
  var glow = new THREE.Mesh(
    new THREE.SphereGeometry(bulbR * 1.7, 16, 12),
    new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: glowOpacity, toneMapped: false, depthWrite: false })
  );
  glow.position.y = heightM + bulbR;
  glow.userData.ttcTall = true;
  gr.add(glow);

  // Tag the anchor rings so the click handler knows they're the always-visible base
  anchor.userData.ttcAnchor = true;
  anchorOuter.userData.ttcAnchor = true;

  // Mode-specific signage on top of the bulb
  if(!isStation){
    // Streetcar: small "🚋" sprite-style text label that always faces camera
    var stcLabel = _ttcStationLabelSprite('🚋 STREETCAR', '#DA291C');
    // Override the auto-sized scale to keep streetcar label modest
    stcLabel.scale.multiplyScalar(0.55);
    stcLabel.position.set(0, heightM + bulbR * 2 + 3.5, 0);
    stcLabel.userData.ttcTall = true;
    gr.add(stcLabel);
  } else if(label){
    var hex = '#' + ('000000' + (typeof color === 'number' ? color.toString(16) : 'FFCC00')).slice(-6);
    var labelSprite = _ttcStationLabelSprite(label, hex);
    labelSprite.position.set(0, heightM + bulbR * 2 + 8, 0);
    labelSprite.userData.ttcTall = true;
    gr.add(labelSprite);
  }
  // Mark the root group so click handler can find the marker root via .parent walk
  gr.userData.ttcMarkerRoot = true;
  gr.userData.ttcMinimized = false;
  return gr;
}

/* Toggle a marker between full (pole+bulb+glow+label visible) and minimized
   (only the flat ground ring visible — still raycastable so the user can
   click it again to restore). */
function _ttcToggleMarkerVisibility(markerRoot){
  if(!markerRoot) return;
  var minimize = !markerRoot.userData.ttcMinimized;
  markerRoot.children.forEach(function(child){
    if(child.userData && child.userData.ttcTall){
      child.visible = !minimize;
    }
  });
  markerRoot.userData.ttcMinimized = minimize;
}

/* Walk up the parent chain to find the marker root group. */
function _ttcFindMarkerRoot(obj){
  var cur = obj;
  while(cur){
    if(cur.userData && cur.userData.ttcMarkerRoot) return cur;
    cur = cur.parent;
  }
  return null;
}

function renderTTCTransitOn3DScene(){
  if(typeof scene === 'undefined' || !scene) {
    console.log('[TTC 3D] scene not yet available');
    return;
  }
  if(!P || !P._gpsOrigin) {
    console.log('[TTC 3D] No GPS origin yet — draw a lot first');
    return;
  }
  removeTTCTransit3DScene();
  var rapid = window._ttcRapidStops || [];
  var streetcars = window._ttcStreetcarStops || [];
  _ttcSceneGroup = new THREE.Group();
  _ttcSceneGroup.name = 'TTC_Transit_Markers';

  /* Proximity radius — show only markers within ~1.5 km of lot centre.
     Beyond that they pollute the satellite ground texture's edges. */
  var maxRangeM = 1500;

  function _withinRange(xz){
    return Math.sqrt(xz.x*xz.x + xz.z*xz.z) < maxRangeM;
  }

  var added = 0;
  var samplePositions = [];

  rapid.forEach(function(st){
    var xz = _ttcLngLatToSceneXZ(st.lng, st.lat);
    if(!xz || !_withinRange(xz)) return;
    var color = st.mode === 'Subway' ? 0xFFCC00 : (st.mode === 'LRT-5' ? 0x65BC55 : 0xC42032);
    var marker = _ttcMakeStationMarker(color, st.name, true);
    marker.position.set(xz.x, 0, xz.z);
    /* Attach station info to marker + all children so raycast hover can read it */
    marker.userData.ttc = { name: st.name, mode: st.mode, lines: st.lines || [], lng: st.lng, lat: st.lat };
    marker.traverse(function(o){ o.userData.ttcStation = marker.userData.ttc; });
    _ttcSceneGroup.add(marker);
    if(samplePositions.length < 5){
      samplePositions.push({ name: st.name, mode: st.mode, x: xz.x.toFixed(1), z: xz.z.toFixed(1) });
    }
    added++;
  });
  streetcars.forEach(function(st){
    var xz = _ttcLngLatToSceneXZ(st.lng, st.lat);
    if(!xz || !_withinRange(xz)) return;
    var marker = _ttcMakeStationMarker(0xDA291C, '', false);
    marker.position.set(xz.x, 0, xz.z);
    marker.userData.ttc = { name: st.name, mode: 'Streetcar', lines: [], lng: st.lng, lat: st.lat };
    marker.traverse(function(o){ o.userData.ttcStation = marker.userData.ttc; });
    _ttcSceneGroup.add(marker);
    added++;
  });

  scene.add(_ttcSceneGroup);
  _attachTTC3DHover();
  console.log('[TTC 3D] Added ' + added + ' transit markers within ' + maxRangeM + 'm of lot. Sample positions:', samplePositions);
  /* Force a render in case the animate loop is paused. */
  if(typeof renderer !== 'undefined' && renderer && typeof camera !== 'undefined' && camera) {
    try { renderer.render(scene, camera); } catch(e){}
  }
}

function removeTTCTransit3DScene(){
  if(_ttcSceneGroup && typeof scene !== 'undefined' && scene){
    scene.remove(_ttcSceneGroup);
    _ttcSceneGroup.traverse(function(obj){
      if(obj.geometry) obj.geometry.dispose();
      if(obj.material){
        if(Array.isArray(obj.material)) obj.material.forEach(function(m){m.dispose();});
        else obj.material.dispose();
      }
    });
    _ttcSceneGroup = null;
  }
}

/* Hover popup on station markers (Mapbox). */
var _ttcPopupsWired = false;
var _ttcMapTooltipEl = null;
function _attachTTCPopups(){
  if(_ttcPopupsWired) return;
  if(typeof smMap === 'undefined' || !smMap) return;
  _ttcPopupsWired = true;
  var allLayers = [
    _TTC_LAYER_IDS.subway[0], _TTC_LAYER_IDS.lrt5[0],
    _TTC_LAYER_IDS.lrt6[0], _TTC_LAYER_IDS.streetcar[0]
  ];
  smMap.on('mousemove', function(e){
    var present = allLayers.filter(function(id){ return !!smMap.getLayer(id); });
    if(!present.length){
      if(_ttcMapTooltipEl) _ttcMapTooltipEl.style.display = 'none';
      return;
    }
    var fts = smMap.queryRenderedFeatures(e.point, {layers: present});
    if(!fts.length){
      if(_ttcMapTooltipEl) _ttcMapTooltipEl.style.display = 'none';
      return;
    }
    smMap.getCanvas().style.cursor = 'pointer';
    if(!_ttcMapTooltipEl){
      _ttcMapTooltipEl = document.createElement('div');
      _ttcMapTooltipEl.style.cssText = 'position:fixed;z-index:9999;background:rgba(20,20,20,0.95);color:#fff;padding:6px 10px;border-radius:4px;font-size:12px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.5);font-family:Outfit,DM Sans,sans-serif;border:1px solid #444';
      document.body.appendChild(_ttcMapTooltipEl);
    }
    var p = fts[0].properties;
    var modeLabel = p.mode === 'Subway' ? 'TTC Subway' : (p.mode === 'LRT-5' ? 'Line 5 Eglinton LRT' : (p.mode === 'LRT-6' ? 'Line 6 Finch West LRT' : 'TTC Streetcar'));
    var html = '<div style="font-weight:700">' + (p.name || '') + '</div>';
    html += '<div style="color:#aaa;font-size:11px">' + modeLabel + (p.lines ? ' · ' + p.lines : '') + '</div>';
    _ttcMapTooltipEl.innerHTML = html;
    _ttcMapTooltipEl.style.left = (e.originalEvent.clientX + 12) + 'px';
    _ttcMapTooltipEl.style.top = (e.originalEvent.clientY + 12) + 'px';
    _ttcMapTooltipEl.style.display = 'block';
  });
  smMap.on('mouseout', function(){
    if(_ttcMapTooltipEl) _ttcMapTooltipEl.style.display = 'none';
  });
}

/* Auto-render when Mapbox map finishes loading (deferred). */
(function(){
  function _tryAttach(){
    if(typeof smMap !== 'undefined' && smMap){
      if(smMap.isStyleLoaded && smMap.isStyleLoaded()){
        renderTTCTransitOnMap();
      } else {
        smMap.once('style.load', renderTTCTransitOnMap);
      }
    } else {
      setTimeout(_tryAttach, 1000);
    }
  }
  setTimeout(_tryAttach, 1500);
})();

/* ── 3D scene raycaster: show tooltip when hovering over a transit marker ── */
var _ttc3dHoverWired = false;
var _ttc3dTooltipEl = null;
function _attachTTC3DHover(){
  if(_ttc3dHoverWired) return;
  if(typeof renderer === 'undefined' || !renderer || !renderer.domElement) return;
  if(typeof camera === 'undefined' || !camera) return;
  if(typeof scene === 'undefined' || !scene) return;
  if(typeof THREE === 'undefined' || !THREE.Raycaster) return;
  _ttc3dHoverWired = true;

  var canvas = renderer.domElement;
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();

  canvas.addEventListener('mousemove', function(e){
    if(!_ttcSceneGroup || !_ttcTransitVisible){
      if(_ttc3dTooltipEl) _ttc3dTooltipEl.style.display = 'none';
      canvas.style.cursor = '';
      return;
    }
    var rect = canvas.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    /* Recursive intersect over the transit group only — fast and ignores buildings */
    var hits = raycaster.intersectObject(_ttcSceneGroup, true);
    if(!hits.length){
      if(_ttc3dTooltipEl) _ttc3dTooltipEl.style.display = 'none';
      canvas.style.cursor = '';
      return;
    }
    /* Find the first hit that has station info attached */
    var info = null;
    for(var i = 0; i < hits.length; i++){
      var ud = hits[i].object && hits[i].object.userData;
      if(ud && ud.ttcStation){ info = ud.ttcStation; break; }
    }
    if(!info){
      if(_ttc3dTooltipEl) _ttc3dTooltipEl.style.display = 'none';
      canvas.style.cursor = '';
      return;
    }
    canvas.style.cursor = 'pointer';
    if(!_ttc3dTooltipEl){
      _ttc3dTooltipEl = document.createElement('div');
      _ttc3dTooltipEl.style.cssText = 'position:fixed;z-index:9999;background:rgba(20,20,20,0.96);color:#fff;padding:10px 14px;border-radius:6px;font-size:13px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.6);font-family:Outfit,DM Sans,sans-serif;border:1px solid #444;max-width:280px;line-height:1.5';
      document.body.appendChild(_ttc3dTooltipEl);
    }
    var modeLabel = info.mode === 'Subway' ? 'TTC Subway' :
                    info.mode === 'LRT-5'  ? 'Line 5 Eglinton LRT' :
                    info.mode === 'LRT-6'  ? 'Line 6 Finch West LRT' :
                    'TTC Streetcar';
    var modeColor = info.mode === 'Subway' ? '#FFCC00' :
                    info.mode === 'LRT-5'  ? '#65BC55' :
                    info.mode === 'LRT-6'  ? '#C42032' :
                    '#DA291C';
    /* Compute distance from current site if available */
    var distLine = '';
    if(P && P.siteCoords && typeof P.siteCoords.lat === 'number'){
      var dM = _haversineKm(P.siteCoords.lat, P.siteCoords.lng, info.lat, info.lng) * 1000;
      var walkMin = Math.round(dM / 75); /* 4.5 km/h ~ 75 m/min */
      distLine = '<div style="color:#aaa;font-size:11px;margin-top:4px">' + Math.round(dM) + ' m from site - ~' + walkMin + ' min walk</div>';
    }
    var html = '';
    html += '<div style="font-weight:700;font-size:14px;color:' + modeColor + ';margin-bottom:2px">' + info.name + '</div>';
    html += '<div style="color:#ccc;font-size:12px">' + modeLabel + (info.lines && info.lines.length ? ' / ' + info.lines.join(' / ') : '') + '</div>';
    html += distLine;
    html += '<div style="color:#888;font-size:10px;margin-top:6px">' + info.lat.toFixed(5) + ', ' + info.lng.toFixed(5) + '</div>';
    _ttc3dTooltipEl.innerHTML = html;
    _ttc3dTooltipEl.style.left = (e.clientX + 14) + 'px';
    _ttc3dTooltipEl.style.top  = (e.clientY + 14) + 'px';
    _ttc3dTooltipEl.style.display = 'block';
  });
  canvas.addEventListener('mouseout', function(){
    if(_ttc3dTooltipEl) _ttc3dTooltipEl.style.display = 'none';
    canvas.style.cursor = '';
  });

  /* Click handler: toggle marker minimize/restore. Uses pointerdown->pointerup
     proximity check so a drag-orbit doesn't trigger a click. */
  var _downX = 0, _downY = 0, _downAt = 0;
  canvas.addEventListener('pointerdown', function(e){
    _downX = e.clientX; _downY = e.clientY; _downAt = Date.now();
  });
  canvas.addEventListener('pointerup', function(e){
    if(!_ttcSceneGroup || !_ttcTransitVisible) return;
    /* Distinguish click from orbit-drag: less than 5 px movement, less than 400 ms */
    var dx = e.clientX - _downX, dy = e.clientY - _downY;
    if(Math.hypot(dx, dy) > 5) return;
    if(Date.now() - _downAt > 400) return;

    var rect = canvas.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObject(_ttcSceneGroup, true);
    if(!hits.length) return;
    /* Pick the first hit whose ancestor chain has a marker root */
    for(var i = 0; i < hits.length; i++){
      var root = _ttcFindMarkerRoot(hits[i].object);
      if(root){
        _ttcToggleMarkerVisibility(root);
        /* Hide tooltip when the marker collapses */
        if(_ttc3dTooltipEl) _ttc3dTooltipEl.style.display = 'none';
        e.stopPropagation();
        return;
      }
    }
  });
}
/* end of analysis-tools.js */
