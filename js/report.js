// report.js — Report generation, PDF/PPTX export, comparables database
// ══════ EMBEDDED TORONTO DEVELOPMENT APPLICATIONS DATABASE ══════
// Fetched from City of Toronto Open Data Portal (CKAN) — avoids CORS issues at runtime
// NAD27 MTM Zone 10 coords (X,Y) with approximate WGS84 lat/lng for proximity search
const TORONTO_DEV_DB=[
  // the area Corridor (near Lanark/Oakwood/Dufferin)
  {addr:"1685 Eglinton Ave W",st:"OMB Appeal",desc:"37-storey mixed-use, 416 units, 26,500 m² GFA, 500 m² retail",x:309107,y:4839363,lat:43.6929,lng:-79.4490,dev:"Shelborne Capital",arch:"KIRKOR"},
  {addr:"1711 Eglinton Ave W",st:"OMB Appeal",desc:"39-storey mixed-use, 423 units, 26,800 m² GFA, community space",x:309092,y:4839372,lat:43.6930,lng:-79.4492,dev:"Shelborne Capital",arch:"KIRKOR"},
  {addr:"1812 Eglinton Ave W",st:"Under Review",desc:"50-storey mixed-use, 503 units, 31,759 m² GFA, commercial",x:308833,y:4839348,lat:43.6928,lng:-79.4524,dev:"DMJ Eglinton Dev.",arch:"IBI Group/Arcadis"},
  {addr:"1818 Eglinton Ave W",st:"Under Review",desc:"50-storey mixed-use, 687 units incl. affordable housing",x:308818,y:4839342,lat:43.6927,lng:-79.4526,dev:"KingSett Capital",arch:"BDP Quadrangle"},
  {addr:"1603 Eglinton Ave W / 66 Lanark Ave",st:"Built",desc:"16-storey mixed-use, 219 units, Empire Midtown, completed 2020",x:309300,y:4839440,lat:43.6936,lng:-79.4466,dev:"Empire Communities",arch:"E.I. Richmond"},
  {addr:"1890-1896 Eglinton Ave W",st:"NOAC Issued",desc:"9-storey mixed-use, 194 units, 1,201 m² retail",x:308658,y:4839298,lat:43.6924,lng:-79.4545,dev:"—",arch:"—"},
  {addr:"1928 Eglinton Ave W",st:"Closed",desc:"8-storey mixed-use, 27 units, retail",x:308587,y:4839269,lat:43.6921,lng:-79.4554,dev:"—",arch:"—"},
  // Slightly further the area
  {addr:"2270-2296 Eglinton Ave W",st:"Closed",desc:"8-storey mixed-use, 141 units, 86 parking, at-grade retail",x:307742,y:4839011,lat:43.6897,lng:-79.4659,dev:"—",arch:"—"},
  {addr:"2330-2400 Eglinton Ave W",st:"Closed",desc:"OPA for mixed-use development, site-specific policy",x:307562,y:4838979,lat:43.6894,lng:-79.4681,dev:"—",arch:"—"},
  {addr:"2204 Eglinton Ave W",st:"Under Review",desc:"6-storey municipal shelter, 36 rooms, 76 beds",x:307878,y:4839052,lat:43.6901,lng:-79.4642,dev:"City of Toronto",arch:"—"},
  // Eglinton East / Yonge-Eglinton
  {addr:"50-60 Eglinton Ave W",st:"Appeal Received",desc:"Two towers 34+39 storeys, mixed-use, 688 units",x:312805,y:4840513,lat:43.7034,lng:-79.4016,dev:"—",arch:"—"},
  {addr:"90 Eglinton Ave W",st:"OMB Appeal",desc:"Two towers 34+39 storeys, 688 units",x:312749,y:4840504,lat:43.7033,lng:-79.4023,dev:"—",arch:"—"},
  {addr:"346-352 Eglinton Ave W",st:"Closed",desc:"15-storey mixed-use, 112 units, ground floor commercial",x:312114,y:4840317,lat:43.7016,lng:-79.4101,dev:"—",arch:"—"},
  {addr:"50 Eglinton Ave E",st:"Closed",desc:"46-storey residential, 444 units, POPS",x:313102,y:4840618,lat:43.7044,lng:-79.3979,dev:"—",arch:"—"},
  {addr:"165 Eglinton Ave E",st:"Closed",desc:"34-storey mixed-use, 443 units",x:313457,y:4840651,lat:43.7047,lng:-79.3935,dev:"—",arch:"—"},
  {addr:"496-498 Eglinton Ave E",st:"Closed",desc:"10-storey mixed-use, 92 units",x:314218,y:4840912,lat:43.7071,lng:-79.3841,dev:"—",arch:"—"},
  {addr:"589 Eglinton Ave E",st:"Under Review",desc:"35-storey mixed-use, 389 units, 660 m² retail",x:314608,y:4840972,lat:43.7077,lng:-79.3793,dev:"—",arch:"—"},
  // Scarborough / East
  {addr:"815-845 Eglinton Ave E",st:"NOAC Issued",desc:"Redevelopment with 1,616 units, retail, office, community",x:315825,y:4841325,lat:43.7110,lng:-79.3642,dev:"—",arch:"—"},
  {addr:"1150-1155 Eglinton Ave E",st:"Closed",desc:"60-acre redevelopment, 4,921 units, office, retail, community",x:317280,y:4841873,lat:43.7161,lng:-79.3461,dev:"—",arch:"—"},
  {addr:"1940 Eglinton Ave E",st:"Under Review",desc:"11 tall buildings (18-48 storeys), 4,285 units",x:321802,y:4842932,lat:43.7258,lng:-79.2899,dev:"—",arch:"—"},
  {addr:"2200-2206 Eglinton Ave E",st:"OMB Approved",desc:"Mixed-use, 4 blocks, 2,363 units, 35/42 storey towers",x:322499,y:4843108,lat:43.7274,lng:-79.2812,dev:"—",arch:"—"},
  {addr:"1 Eglinton Square",st:"OMB Approved",desc:"6 tall buildings (20-50 storeys), 3,618 units",x:320832,y:4842358,lat:43.7205,lng:-79.3019,dev:"—",arch:"—"},
  // Nearby non-Eglinton
  {addr:"645-655 Northcliffe Blvd",st:"SPA Submitted",desc:"42-storey tower (revised from 15), 336 units, near Fairbank LRT",x:309050,y:4839200,lat:43.6915,lng:-79.4497,dev:"Stanford Homes",arch:"superkül"},
  {addr:"4696 Yonge St",st:"Under Review",desc:"40-storey mixed-use, 35,311 m² resi + 719 m² retail, FSI 14.09",x:311997,y:4846331,lat:43.7571,lng:-79.4113,dev:"—",arch:"—"},
  {addr:"45 Balliol St",st:"Under Review",desc:"40-storey residential, 34,000 m², 477 units",x:313248,y:4839495,lat:43.6942,lng:-79.3960,dev:"—",arch:"—"},
  {addr:"4241 Dundas St W",st:"Under Review",desc:"10-storey mid-rise, 274 units, 19,084 m² resi + 606 m² retail",x:303723,y:4835263,lat:43.6562,lng:-79.5155,dev:"—",arch:"—"},
  {addr:"30 Bay St",st:"Under Review",desc:"57-storey non-residential tower",x:314639,y:4833372,lat:43.6394,lng:-79.3781,dev:"—",arch:"—"},
  // Major corridor projects
  {addr:"2990 Eglinton Ave E",st:"Under Review",desc:"4 blocks, 25-37 storey buildings",x:326298,y:4844328,lat:43.7387,lng:-79.2338,dev:"—",arch:"—"},
  {addr:"1900 Eglinton Ave E",st:"OMB Approved",desc:"Phase 1: two mixed-use buildings 38+40 storeys",x:321388,y:4842857,lat:43.7251,lng:-79.2950,dev:"—",arch:"—"},
  {addr:"740 Eglinton Ave W",st:"Closed",desc:"OPA for conversion to standard condominium",x:311086,y:4840018,lat:43.6989,lng:-79.4229,dev:"—",arch:"—"},
  // City-wide developments (from Toronto Open Data)
  {addr:"135 Fenelon Dr",st:"OMB Appeal",desc:"10+4 storey, 427 rental units",x:317832,y:4846776,lat:43.7597,lng:-79.3403,dev:"Beaux Properties",arch:"—"},
  {addr:"1925 Victoria Park Ave",st:"Closed",desc:"12-storey, 185 units, 16341 m² GFA",x:319975,y:4845207,lat:43.7455,lng:-79.3136,dev:"—",arch:"—"},
  {addr:"2075 Kennedy Rd",st:"Under Review",desc:"37+39 storey towers, 920 units",x:322078,y:4848484,lat:43.7751,lng:-79.2874,dev:"Landa Global",arch:"—"},
  {addr:"480 Wilson Ave",st:"Closed",desc:"12-storey condo 394+rental 161 units",x:309276,y:4843726,lat:43.7322,lng:-79.4469,dev:"—",arch:"—"},
  {addr:"6040 Bathurst St",st:"Council Approved",desc:"29+26 storey towers, 16-storey bldg",x:309059,y:4849670,lat:43.7858,lng:-79.4496,dev:"—",arch:"—"},
  {addr:"50 Wilson Heights Blvd",st:"Closed",desc:"12+16+14 storey towers, mixed-use",x:308883,y:4843716,lat:43.7321,lng:-79.4518,dev:"—",arch:"—"},
  {addr:"25 St Dennis Dr",st:"Closed",desc:"37-storey 404 units + 12-storey 133 units, FSI 3.83",x:318241,y:4841706,lat:43.7140,lng:-79.3352,dev:"DBS Developments",arch:"—"},
  {addr:"1 Deauville Lane",st:"Under Review",desc:"44+47+49 storey, 1830 units, 113317 m² GFA, FSI 10.46",x:318476,y:4841691,lat:43.7139,lng:-79.3323,dev:"Stanford Homes",arch:"—"},
  {addr:"530 The East Mall",st:"Closed",desc:"14+22+22 storey, 1095 units",x:299686,y:4834400,lat:43.6482,lng:-79.5664,dev:"—",arch:"—"},
  {addr:"620 The East Mall",st:"Closed",desc:"Two 24-storey towers, 902 units",x:299370,y:4834905,lat:43.6527,lng:-79.5703,dev:"—",arch:"—"},
  {addr:"106 Earl Pl",st:"Appeal Received",desc:"58-storey, 680 units, FSI 23.25",x:314568,y:4836249,lat:43.6648,lng:-79.3809,dev:"Originate Developments",arch:"—"},
  {addr:"3718 Kingston Rd",st:"Under Review",desc:"24-storey, 419 units, 30902 m² GFA, FSI 5.24",x:328105,y:4844945,lat:43.7432,lng:-79.2123,dev:"—",arch:"—"},
  {addr:"155 Antibes Dr",st:"Closed",desc:"36+32+8 storey, 1151 units",x:309138,y:4848904,lat:43.7789,lng:-79.4486,dev:"Tenblock",arch:"—"},
  {addr:"20 Broadoaks Dr",st:"Under Review",desc:"18+30 storey towers, 12-storey mixed",x:305516,y:4846194,lat:43.7544,lng:-79.4937,dev:"—",arch:"—"},
  {addr:"3636 Bathurst St",st:"Closed",desc:"9+10 storey additions to 19-storey, 277 units",x:310167,y:4843398,lat:43.7293,lng:-79.4358,dev:"—",arch:"—"},
  {addr:"10 Wellington St E",st:"Closed",desc:"58-storey, 523 units, 50072 m² GFA",x:314718,y:4834023,lat:43.6448,lng:-79.3791,dev:"—",arch:"—"},
  {addr:"2035 Kennedy Rd",st:"Closed",desc:"31+34+40 storey, 1044 units",x:322280,y:4848369,lat:43.7740,lng:-79.2848,dev:"—",arch:"—"},
  {addr:"5220 Yonge St",st:"Closed",desc:"31-storey + 10-storey office, 308 units",x:311712,y:4847685,lat:43.7679,lng:-79.4165,dev:"—",arch:"—"},
  {addr:"126 Bellamy Rd N",st:"Under Review",desc:"8-storey, 184 units, 36573 m² GFA, FSI 2.92",x:326373,y:4844531,lat:43.7395,lng:-79.2338,dev:"—",arch:"—"},
  {addr:"2180 Lawrence Ave E",st:"Under Review",desc:"21+8+7+6 storey, 488 units with park",x:322143,y:4845155,lat:43.7451,lng:-79.2866,dev:"—",arch:"—"},
  {addr:"240 Markland Dr",st:"Closed",desc:"9-storey + 3-storey townhouses, 234 units",x:298430,y:4831913,lat:43.6258,lng:-79.5820,dev:"—",arch:"—"},
  {addr:"100 Queen St E",st:"Closed",desc:"34-storey mixed-use, 369 units, 23211 m² GFA",x:314800,y:4835800,lat:43.6608,lng:-79.3781,dev:"—",arch:"—"},
  // Dundas Street corridor
  {addr:"1113 Dundas St W",st:"Pre-Construction",desc:"10-storey mass timber, 100 rental units (30% affordable), FSI 4.0, OPA/ZBA approved Sept 2024",x:311261,y:4834158,lat:43.6460,lng:-79.4222,dev:"CreateTO",arch:"Brook McIlroy"},
  {addr:"4208 Dundas St W",st:"Closed",desc:"8-storey + 21-storey mixed-use",x:303856,y:4835392,lat:43.6571,lng:-79.5144,dev:"Urban Capital / Northam",arch:"—"},
  {addr:"4928 Dundas St W",st:"Closed",desc:"9-storey seniors residence, 204 units",x:302428,y:4834065,lat:43.6452,lng:-79.5322,dev:"—",arch:"—"},
  {addr:"1544 Dundas St W",st:"Closed",desc:"8-storey mixed-use, 95 units",x:310163,y:4834237,lat:43.6467,lng:-79.4358,dev:"Edenshaw Homes",arch:"—"},
  {addr:"191 Dundas St E",st:"Closed",desc:"50-storey mixed-use, 563 units",x:314952,y:4835021,lat:43.6538,lng:-79.3762,dev:"Gupta Group / Easton's",arch:"—"},
  {addr:"4886 Dundas St W",st:"OMB Approved",desc:"25-storey mixed-use, 398 units",x:302499,y:4834187,lat:43.6463,lng:-79.5313,dev:"Islington Village Dev.",arch:"—"},
  {addr:"5245 Dundas St W",st:"Closed",desc:"40-storey + 3-storey commercial podium",x:301769,y:4832959,lat:43.6352,lng:-79.5404,dev:"Main and Main / FCR REIT",arch:"—"},
  {addr:"163 Dundas St E",st:"Closed",desc:"43-storey, 384 units (PACE Condos)",x:314875,y:4834987,lat:43.6535,lng:-79.3771,dev:"Great Gulf",arch:"—"},
  {addr:"117 Dundas St E",st:"Closed",desc:"52-storey, 602 units (Social Condos)",x:314739,y:4834957,lat:43.6532,lng:-79.3788,dev:"Pemberton Group",arch:"—"},
  {addr:"1200 Dundas St W",st:"Under Construction",desc:"8-storey mixed-use, 76 units (The Twelve Hundred), est. completion 2025",x:311034,y:4834209,lat:43.6465,lng:-79.4250,dev:"Fieldgate Urban",arch:"—"},
  {addr:"4215 Dundas St W",st:"OMB Appeal",desc:"14-storey midrise, 619 units + townhouses",x:303827,y:4835325,lat:43.6565,lng:-79.5148,dev:"Marlin Spring",arch:"—"},
  {addr:"2708 Dundas St W",st:"Closed",desc:"9-storey mixed-use, 144 units",x:308057,y:4835892,lat:43.6616,lng:-79.4621,dev:"—",arch:"—"},
  {addr:"591 Dundas St E",st:"Closed",desc:"25+29 storey condo, 781 units (DuEast)",x:316019,y:4835392,lat:43.6571,lng:-79.3629,dev:"Daniels Corporation",arch:"—"},
  {addr:"2400 Dundas St W",st:"Under Review",desc:"37-storey tower, 447 rental units",x:308596,y:4835162,lat:43.6551,lng:-79.4554,dev:"Fora Developments",arch:"—"},
  {addr:"3300 Dundas St W",st:"Under Review",desc:"11-storey mixed-use, 191 units",x:306367,y:4835987,lat:43.6625,lng:-79.4831,dev:"Terra Firma Homes",arch:"—"},
  {addr:"3245 Dundas St W",st:"Under Review",desc:"11-storey mixed-use, 130 units",x:306546,y:4835936,lat:43.6620,lng:-79.4809,dev:"—",arch:"—"},
  {addr:"5359 Dundas St W",st:"Closed",desc:"50-storey mixed-use, 600 units",x:301564,y:4832648,lat:43.6324,lng:-79.5430,dev:"—",arch:"—"},
  {addr:"1496 Dundas St W",st:"NOAC Issued",desc:"8-storey mixed-use, 48 units, NOAC issued Mar 2025",x:310267,y:4834218,lat:43.6466,lng:-79.4345,dev:"—",arch:"—"},
  {addr:"4237 Dundas St W",st:"Closed",desc:"11-storey residential mid-rise with retail",x:303748,y:4835282,lat:43.6561,lng:-79.5157,dev:"—",arch:"—"},
  // King Street corridor
  {addr:"300 King St W",st:"Approved",desc:"74+84 storey (262m+300m), 2034 units",x:313713,y:4833906,lat:43.6437,lng:-79.3916,dev:"Hallman",arch:"—"},
  {addr:"337 King St W",st:"Built",desc:"47+35 storey towers (M5V Condos), 542 resi + 116 hotel units, completed 2012, LEED Gold",x:313533,y:4833794,lat:43.6427,lng:-79.3938,dev:"Lifetime Developments",arch:"CORE Architects"},
  {addr:"629 King St W",st:"Built",desc:"15+11 storey towers, 408 units (Thompson Residences), completed 2017",x:312733,y:4833560,lat:43.6406,lng:-79.4038,dev:"Freed Developments",arch:"—"},
  {addr:"321 King St W",st:"Built",desc:"49-storey, 328 units (Empire Maverick), completed 2024",x:313590,y:4833811,lat:43.6429,lng:-79.3931,dev:"Empire Communities",arch:"—"},
  {addr:"333 King St E",st:"Council Approved",desc:"37-storey resi (140m) + 28-storey office (127m)",x:315616,y:4834394,lat:43.6481,lng:-79.3679,dev:"First Gulf Corp.",arch:"—"},
  // Queen Street corridor
  {addr:"85 Queen St E",st:"Closed",desc:"59-storey mixed-use, 690 units",x:314853,y:4834590,lat:43.6499,lng:-79.3774,dev:"—",arch:"—"},
  {addr:"64 Queen St E",st:"Closed",desc:"57-storey, 445 units (QueenChurch Condos)",x:314832,y:4834615,lat:43.6501,lng:-79.3777,dev:"Bazis / Tridel",arch:"—"},
  {addr:"333 Queen St E",st:"Under Review",desc:"49-storey, 545 units",x:315665,y:4834827,lat:43.6520,lng:-79.3673,dev:"Generation Capital",arch:"—"},
  {addr:"229 Queen St E",st:"OMB Approved",desc:"34-37 storey, 450 units",x:315302,y:4834714,lat:43.6510,lng:-79.3718,dev:"Dash Developments",arch:"—"},
  {addr:"373 Queen St E",st:"NOAC Issued",desc:"28-storey, 526 units",x:315793,y:4834865,lat:43.6524,lng:-79.3657,dev:"—",arch:"—"},
  {addr:"1266 Queen St W",st:"Under Review",desc:"27-storey, 362 purpose-built rental units, revised proposal Apr 2025, construction target Spring 2026",x:310461,y:4833392,lat:43.6391,lng:-79.4321,dev:"Carttera",arch:"BDP Quadrangle"},
  {addr:"1153 Queen St W",st:"Under Review",desc:"27-storey, 367 rental units, ZBA application submitted Nov 2024",x:310846,y:4833418,lat:43.6393,lng:-79.4273,dev:"QuadReal Property",arch:"Turner Fleischer"},
  {addr:"550 Queen St E",st:"Closed",desc:"18-storey mixed-use, 380 units",x:316299,y:4835069,lat:43.6542,lng:-79.3594,dev:"Spotlight / Liberty Dev.",arch:"—"},
  {addr:"133 Queen St E",st:"Closed",desc:"39-storey, 440 units",x:314993,y:4834621,lat:43.6502,lng:-79.3757,dev:"Cortel Group",arch:"—"},
  {addr:"92 Queen St E",st:"Closed",desc:"34-storey mixed-use, 369 units",x:314939,y:4834652,lat:43.6505,lng:-79.3763,dev:"St. Thomas Dev.",arch:"—"},
  {addr:"1358 Queen St W",st:"Pre-Construction",desc:"12-storey mixed-use, 21 units (revised from 9s/117u), heritage-listed buildings, ZBA approved",x:310212,y:4833305,lat:43.6383,lng:-79.4352,dev:"KingSett Capital",arch:"—"},
  {addr:"1181 Queen St W",st:"Built",desc:"15-storey mixed-use, 112 units (1181 Queen West Condos), completed 2023",x:310714,y:4833363,lat:43.6389,lng:-79.4290,dev:"Skale Developments",arch:"—"},
];

// Find nearby comparables from embedded DB using Haversine distance
/**
 * Finds development comparables near given coordinates from the TORONTO_DEV_DB.
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {number} [radiusKm=2] - Search radius in km
 * @param {number} [maxResults=8] - Maximum results to return
 * @returns {Object[]} Sorted array of comparable developments with distance
 */
function findNearbyComparables(lat,lng,radiusKm=2,maxResults=8){
  if(!lat||!lng)return[];
  const R=6371; // earth radius km
  const toRad=d=>d*Math.PI/180;
  const results=TORONTO_DEV_DB.map(d=>{
    if(!d.lat||!d.lng)return null;
    const dLat=toRad(d.lat-lat), dLng=toRad(d.lng-lng);
    const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat))*Math.cos(toRad(d.lat))*Math.sin(dLng/2)**2;
    const dist=R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    if(dist>radiusKm)return null;
    // Parse storeys and units from description
    const stMatch=d.desc.match(/(\d+)[-\s]?stor/i);
    const unitMatch=d.desc.match(/([\d,]+)\s*(?:units|dwelling)/i);
    const gfaMatch=d.desc.match(/([\d,]+)\s*(?:m²|sq\.?\s*m)/i);
    return{
      ...d, distKm:dist,
      storeys:stMatch?parseInt(stMatch[1]):null,
      units:unitMatch?parseInt(unitMatch[1].replace(/,/g,'')):null,
      gfaM2:gfaMatch?parseInt(gfaMatch[1].replace(/,/g,'')):null
    };
  }).filter(Boolean).sort((a,b)=>a.distKm-b.distKm);
  return results.slice(0,maxResults);
}

/** Generates and downloads a multi-page PDF report using jsPDF. Includes 3D viewport capture. */
async function exportPDF(){
  try{
  if(!window.jspdf){alert('PDF library still loading — please wait a moment and try again.');return;}
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
  const W=210, H=297, M=15;
  const cw=W-M*2;
  let y=M;
  const d=pfData();
  const dcs=calcDCSchedule(d.unitMix, d.commGFA);
  const mc=runMonteCarlo(d,3000);
  const pct=v=>(v*100).toFixed(1)+'%';
  const fmt$=v=>'$'+Math.round(v).toLocaleString();
  const fmtM=v=>v>=1e6?'$'+(v/1e6).toFixed(2)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':fmt$(v);
  const OLIVE=[174,188,70], DARK=[26,26,26], WHITE=[255,255,255], GREY=[136,136,136], LGREY=[180,180,180];
  const maxSt=Math.max(...P.vols.map(v=>v.storeys));
  const maxHtM=((P.vols.some(v=>v.commGF)?P.flr.gf:P.flr.typ)+(maxSt-1)*P.flr.typ)*0.3048;

  // ── Capture 3D massing canvas (perspective view, dynamically framed) ──
  let massingImg=null, sitemapImg=null;
  try{
    const cw_=document.getElementById('canvas-wrap');
    const wasHidden=cw_&&cw_.style.display==='none';
    if(wasHidden){cw_.style.display='block';cw_.style.position='absolute';cw_.style.left='-9999px';cw_.style.width='1200px';cw_.style.height='800px';}
    const c=document.querySelector('#canvas-wrap canvas');
    if(c&&renderer){
      // Save current orbit state
      const savedTheta=orb.theta, savedPhi=orb.phi, savedDist=orb.dist;
      const savedTarget=orb.target.clone();
      // Use perspective view — setView() auto-calculates distance from building extents
      setView('perspective');
      // Add 20% extra distance for padding so the full building is visible
      orb.dist=orb.dist*1.2;
      updateCam();
      // Render at high resolution
      renderer.setSize(1200,800);
      camera.aspect=1200/800;camera.updateProjectionMatrix();
      renderer.render(scene,camera);
      massingImg=c.toDataURL('image/jpeg',0.92);
      // Restore orbit state
      orb.theta=savedTheta;orb.phi=savedPhi;orb.dist=savedDist;
      orb.target.copy(savedTarget);
      updateCam();
    }
    if(wasHidden){cw_.style.display='none';cw_.style.position='';cw_.style.left='';cw_.style.width='';cw_.style.height='';onResize();}
  }catch(e){console.warn('Could not capture massing:',e);}
  // Capture site map (with lot polygon overlay)
  try{
    const mapDiv=document.getElementById('sitemap-container');
    const mapWasHidden=mapDiv&&mapDiv.style.display==='none';
    if(mapWasHidden){mapDiv.style.display='flex';mapDiv.style.position='absolute';mapDiv.style.left='-9999px';mapDiv.style.width='800px';mapDiv.style.height='600px';}
    if(smMap){
      smMap.resize();
      // Ensure lot polygon layers are visible on the map before capture
      if(P.lot.gpsVerts&&P.lot.gpsVerts.length>=3){
        const coords=P.lot.gpsVerts;
        // Add/update the lot polygon source and layers for capture
        const ring=coords.concat([coords[0]]);
        const poly={type:'Feature',geometry:{type:'Polygon',coordinates:[ring]}};
        try{
          if(smMap.getSource('pdf-lot')){smMap.getSource('pdf-lot').setData(poly);}
          else{
            smMap.addSource('pdf-lot',{type:'geojson',data:poly});
            smMap.addLayer({id:'pdf-lot-fill',type:'fill',source:'pdf-lot',paint:{'fill-color':'#AEBC46','fill-opacity':0.18}});
            smMap.addLayer({id:'pdf-lot-line',type:'line',source:'pdf-lot',paint:{'line-color':'#AEBC46','line-width':3}});
          }
        }catch(e){}
        const lngs=coords.map(c=>c[0]),lats=coords.map(c=>c[1]);
        // Expand bounds to show surrounding context (streets, neighbours)
        const lngSpan=Math.max(...lngs)-Math.min(...lngs);
        const latSpan=Math.max(...lats)-Math.min(...lats);
        const expand=1.8; // show ~2x the lot extent in each direction
        const bounds=[
          [Math.min(...lngs)-lngSpan*expand, Math.min(...lats)-latSpan*expand],
          [Math.max(...lngs)+lngSpan*expand, Math.max(...lats)+latSpan*expand]
        ];
        smMap.fitBounds(bounds,{padding:30,duration:0});
      } else if(P.siteCoords){
        smMap.setCenter([P.siteCoords.lng,P.siteCoords.lat]);
        smMap.setZoom(18);
      }
      // Wait for map to fully render tiles and layers
      await new Promise(r=>{
        var done=false;
        function onIdle(){done=true;smMap.off('idle',onIdle);r();}
        smMap.on('idle',onIdle);
        // Fallback timeout in case idle never fires
        setTimeout(()=>{if(!done){smMap.off('idle',onIdle);r();}},3000);
      });
      smMap.resize();
      await new Promise(r=>setTimeout(r,500));
      const mc=smMap.getCanvas();sitemapImg=mc.toDataURL('image/jpeg',0.92);
      // Clean up temporary lot layer
      try{if(smMap.getLayer('pdf-lot-line'))smMap.removeLayer('pdf-lot-line');}catch(e){}
      try{if(smMap.getLayer('pdf-lot-fill'))smMap.removeLayer('pdf-lot-fill');}catch(e){}
      try{if(smMap.getSource('pdf-lot'))smMap.removeSource('pdf-lot');}catch(e){}
    }
    if(mapWasHidden){mapDiv.style.display='none';mapDiv.style.position='';mapDiv.style.left='';mapDiv.style.width='';mapDiv.style.height='';}
  }catch(e){console.warn('Could not capture site map:',e);}

  // ── Helpers ──
  function addText(t,x,yP,o={}){doc.setFont('helvetica',o.style||'normal');doc.setFontSize(o.size||10);doc.setTextColor(...(o.color||LGREY));if(o.align)doc.text(t,x,yP,{align:o.align});else if(o.maxWidth)doc.text(t,x,yP,{maxWidth:o.maxWidth});else doc.text(t,x,yP);}
  function addLine(y_,c=[50,50,50]){doc.setDrawColor(...c);doc.setLineWidth(0.3);doc.line(M,y_,W-M,y_);}
  function newPage(){doc.addPage();y=M;doc.setFillColor(...DARK);doc.rect(0,0,W,H,'F');doc.setFillColor(...OLIVE);doc.rect(0,0,W,3,'F');}
  function pageTitle(t){addText(t,M,y+8,{size:14,color:OLIVE,style:'bold'});y+=16;addLine(y);y+=8;}
  function sectionHead(t){addText(t,M,y,{size:11,color:OLIVE,style:'bold'});y+=7;}
  // Render a paragraph with proper word-wrap and per-line page-break safety.
  // Uses splitTextToSize manually + per-line doc.text — avoids the justified/stretched
  // output that jsPDF's doc.text(maxWidth) produces with unicode characters.
  // Options: {size, color, style, indent, maxW} — indent shifts left margin (for bullets).
  function para(t,o={}){
    var fontSize = o.size || 8.5;
    var indent = o.indent || 0;
    var availW = (o.maxW != null ? o.maxW : cw) - indent;
    doc.setFont('helvetica', o.style || 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(...(o.color || LGREY));
    var lineHeight = Math.max(4.0, fontSize * 0.55);
    var lines = doc.splitTextToSize(String(t == null ? '' : t), availW);
    for(var li = 0; li < lines.length; li++){
      // Force a new page if this line would spill below the bottom margin
      if(y + lineHeight > H - 20){ newPage(); }
      doc.text(lines[li], M + indent, y);
      y += lineHeight;
    }
  }
  function checkP(n){if(y+n>H-20){newPage();return true;}return false;}

  function addTable(headers,rows,startY,opts={}){
    const colW=opts.colWidths||headers.map(()=>cw/headers.length);
    let ty=startY;
    const lineH = 4.5;            // mm per text line at 8pt
    const cellPad = 2;            // mm inner padding inside a cell
    const minRowH = 6;            // mm minimum row height

    // Header row
    doc.setFillColor(30,30,30);doc.rect(M,ty-4,cw,7,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(8);doc.setTextColor(...OLIVE);
    let cx=M+2;
    headers.forEach((h,i)=>{
      const lines = doc.splitTextToSize(String(h), colW[i] - cellPad*2);
      doc.text(lines[0]||'', cx, ty);
      cx += colW[i];
    });
    ty += minRowH;

    // Body rows — each cell wraps to its column width; row height grows with longest cell
    doc.setFont('helvetica','normal');doc.setFontSize(8);
    rows.forEach((row,ri)=>{
      // Pre-wrap every cell so we know the max line count for this row
      const cellLines = row.map((cell,ci)=>{
        const text = (typeof cell === 'object') ? String(cell.text || '') : String(cell == null ? '' : cell);
        return doc.splitTextToSize(text, Math.max(8, colW[ci] - cellPad*2));
      });
      const maxLines = Math.max(1, ...cellLines.map(L => L.length));
      const rowH = Math.max(minRowH, maxLines * lineH + 1.5);

      // Page break if this row won't fit
      if(ty + rowH > H - M - 5){
        doc.addPage();
        ty = M;
        doc.setFillColor(...DARK);
        doc.rect(0,0,W,H,'F');
        doc.setFont('helvetica','normal');
        doc.setFontSize(8);
      }

      // Zebra row background spans the full row height
      if(ri%2===0){ doc.setFillColor(20,20,20); doc.rect(M, ty-4, cw, rowH, 'F'); }

      // Render each cell's wrapped lines vertically within the row
      cx = M + cellPad;
      row.forEach((cell,ci)=>{
        const colorOverride = (typeof cell === 'object') ? (cell.color || LGREY) : LGREY;
        doc.setTextColor(...colorOverride);
        const lines = cellLines[ci];
        for(let li = 0; li < lines.length; li++){
          doc.text(lines[li], cx, ty + li * lineH);
        }
        cx += colW[ci];
      });
      ty += rowH;
    });
    return ty;
  }

  // ══════════════════════════════════════════════════════════════════
  //  PAGE 1: COVER — branded title page with hero render
  // ══════════════════════════════════════════════════════════════════
  // Pulled common values into the outer scope so the Executive Summary
  // page (page 2) can use them without recomputing.
  const now = new Date();
  const BRAND = P.brand || {};
  const brandName = BRAND.companyName || 'EstateBuilder.ai';
  const brandTag  = BRAND.tagline     || 'Real Estate Development Feasibility';
  const dcfR = calcDCF(d);
  const projectAddress = P.siteAddress
    || (P.siteCoords ? ('Lat ' + P.siteCoords.lat.toFixed(4) + ', Lng ' + P.siteCoords.lng.toFixed(4)) : 'City of Toronto, Ontario');
  const dateLong = now.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'});

  // Page background + olive accent at top edge
  doc.setFillColor(...DARK); doc.rect(0,0,W,H,'F');
  doc.setFillColor(...OLIVE); doc.rect(0,0,W,8,'F');

  // ── Brand mark (top-left) — logo if uploaded, else company name only ──
  if(BRAND.logo){
    try { doc.addImage(BRAND.logo, M, 18, 22, 22); } catch(_eLogo){}
    addText(brandName, M+28, 28, {size:14, color:OLIVE, style:'bold'});
    addText(brandTag,  M+28, 35, {size:8.5, color:GREY});
  } else {
    addText(brandName, M, 28, {size:14, color:OLIVE, style:'bold'});
    addText(brandTag,  M, 35, {size:8.5, color:GREY});
  }
  addLine(48, [60,60,60]);

  // ── Title ──
  addText('DEVELOPMENT FEASIBILITY', M, 72, {size:24, color:WHITE, style:'bold'});
  addText('REPORT',                  M, 86, {size:24, color:OLIVE, style:'bold'});
  addLine(94, [60,60,60]);

  // ── Project meta ──
  // Project name wraps to multiple lines via splitTextToSize so long
  // multi-address titles ("1621 Eglinton Ave W + 1623 Eglinton Ave W
  // + 1625 Eglinton Ave W + 88 Lanark Ave + 86 Lanark Ave") don't get
  // truncated. Caps at 3 lines so the rest of the cover layout stays
  // intact; address + date follow the last project-name line.
  doc.setFont('helvetica','normal');
  doc.setFontSize(16);
  doc.setTextColor(...WHITE);
  const projTitleLines = doc.splitTextToSize(P.projectName || 'Untitled Project', cw).slice(0, 3);
  let projY = 110;
  const projLineH = 7;
  projTitleLines.forEach((line, i) => {
    doc.text(line, M, projY + i * projLineH);
  });
  // Address + date sit just below the last title line
  const metaY = projY + projTitleLines.length * projLineH + 2;
  addText(projectAddress, M, metaY,     {size:10, color:LGREY});
  addText(dateLong,       M, metaY + 7, {size:9,  color:GREY});

  // ── Hero massing render — fills the rest of the cover above the
  // prepared-by block. Top edge moves down based on how many title
  // lines wrapped, so the layout breathes for longer project names.
  const heroTop = Math.max(138, metaY + 18);
  const heroH   = Math.min(105, 240 - heroTop);
  if(massingImg){
    try { doc.addImage(massingImg, 'JPEG', M, heroTop, cw, heroH); } catch(_eImg){}
  } else {
    // No massing yet — placeholder block so the cover still has visual weight
    doc.setFillColor(40,40,40); doc.roundedRect(M, heroTop, cw, heroH, 2, 2, 'F');
    addText('— massing render unavailable —', W/2, heroTop + heroH/2, {size:9, color:GREY, align:'center'});
  }

  // ── Prepared by / Prepared for (only render if set, so unbranded
  //    projects don't show empty placeholders) ──
  let preparedY = 248;
  if(BRAND.preparedFor){
    addText('PREPARED FOR', M, preparedY, {size:7, color:GREY, style:'bold'});
    addText(BRAND.preparedFor, M, preparedY+5, {size:10, color:WHITE});
    preparedY += 14;
  }
  if(BRAND.preparedBy){
    addText('PREPARED BY', M, preparedY, {size:7, color:GREY, style:'bold'});
    addText(BRAND.preparedBy, M, preparedY+5, {size:10, color:WHITE});
  }
  // (Per-page footer is added once at the end via doc.getNumberOfPages()
  // loop — no need for a separate cover footer here.)

  // ══════════════════════════════════════════════════════════════════
  //  PAGE 2: EXECUTIVE SUMMARY — six KPI cards + project narrative
  // ══════════════════════════════════════════════════════════════════
  newPage();
  // Page header
  addText('EXECUTIVE SUMMARY', M, y+8, {size:18, color:OLIVE, style:'bold'});
  y += 16;
  addText(P.projectName || 'Untitled Project', M, y, {size:11, color:WHITE});
  y += 5;
  addText(projectAddress + ' · ' + dateLong, M, y, {size:8.5, color:GREY});
  y += 6;
  addLine(y, [60,60,60]);
  y += 10;

  // ── KPI grid: 2 rows × 3 columns ──
  const kpiGap = 4;
  const kpiW = (cw - 2 * kpiGap) / 3;
  const kpiH = 32;
  const kpiBaseY = y;

  function _kpiCard(col, row, label, value, valueColor){
    const x = M + col * (kpiW + kpiGap);
    const cardY = kpiBaseY + row * (kpiH + kpiGap);
    doc.setFillColor(28,28,30);
    doc.roundedRect(x, cardY, kpiW, kpiH, 2, 2, 'F');
    doc.setDrawColor(...OLIVE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, cardY, kpiW, kpiH, 2, 2, 'S');
    // Tiny olive accent strip on the left edge — visual anchor
    doc.setFillColor(...OLIVE);
    doc.rect(x, cardY, 1.2, kpiH, 'F');
    // Label (small caps grey)
    addText(label, x + 5, cardY + 8, {size:7.5, color:GREY, style:'bold'});
    // Value (large bold, color depends on KPI)
    addText(value, x + 5, cardY + 24, {size:18, color: valueColor || WHITE, style:'bold'});
  }

  // Row 1 — financial outcomes
  _kpiCard(0, 0, 'TOTAL COST',     fmtM(d.totalCost),                                   WHITE);
  _kpiCard(1, 0, 'GROSS REVENUE',  fmtM(d.totalGrossRev),                               [120,200,120]);
  _kpiCard(2, 0, 'PROFIT MARGIN',  pct(d.marginOnCost),
                                   d.marginOnCost >= 0.15 ? [120,200,120] :
                                   d.marginOnCost >= 0.05 ? [225,200,90]  : [220,120,90]);

  // Row 2 — risk & program
  _kpiCard(0, 1, 'IRR',            pct(dcfR.irr),                                       [196,154,222]);
  _kpiCard(1, 1, 'TOTAL UNITS',    String(d.totalUnits),                                WHITE);
  _kpiCard(2, 1, 'TOTAL GFA',      Math.round(d.totalGFA).toLocaleString() + ' sf',     WHITE);

  y = kpiBaseY + 2 * (kpiH + kpiGap) + 8;

  // ── Project narrative ──
  addText('PROJECT OVERVIEW', M, y, {size:9, color:OLIVE, style:'bold'});
  y += 6;
  const narrativeStoreys = (typeof maxSt === 'number' && maxSt > 0) ? maxSt : 1;
  const narrative =
    'A ' + narrativeStoreys + '-storey ' + (P.projectType || 'midrise') + ' development of ' +
    d.totalUnits.toLocaleString() + ' residential units' +
    (d.commGFA > 0 ? ' and ' + Math.round(d.commGFA).toLocaleString() + ' sf of ground-floor commercial space' : '') +
    ' on a ' + Math.round(d.siteArea).toLocaleString() + ' sf site (FSI ' + d.fsi.toFixed(2) + '×). ' +
    'Total project cost is estimated at ' + fmtM(d.totalCost) + ' against gross revenue of ' +
    fmtM(d.totalGrossRev) + ', producing a profit margin of ' + pct(d.marginOnCost) +
    ' and an internal rate of return of ' + pct(dcfR.irr) + '. ' +
    'The following sections provide site analysis, zoning framework, building massing, ' +
    'unit mix, full pro-forma, cost summary, DCF model + risk analysis, and project recommendations.';
  para(narrative, {size:9.5, color:LGREY});
  y += 4;
  // (Per-page footer is appended later — no need for one here.)

  // ══════ PAGE 2: SITE ANALYSIS ══════
  newPage();pageTitle('1. SITE ANALYSIS');
  if(sitemapImg){try{doc.addImage(sitemapImg,'JPEG',M,y,cw,60);y+=64;}catch(e){}}
  sectionHead('1.1 Location & Context');
  para('The subject property is located at '+(P.siteAddress||P.projectName||'the development site')+'. '+(P.siteCoords?'Site coordinates: '+P.siteCoords.lat.toFixed(5)+', '+P.siteCoords.lng.toFixed(5)+'. ':'')+'The lot encompasses approximately '+Math.round(lotArea()).toLocaleString()+' square feet ('+((lotArea()*0.0929).toFixed(0))+' m²) and is situated within the City of Toronto.');y+=2;
  para('The surrounding area should be assessed through a site visit and review of the City of Toronto Official Plan land use designations, zoning by-law provisions, and any applicable secondary plans or area-specific policies. The proximity to transit, existing built form context, and infrastructure capacity are key factors in determining the highest and best use.');y+=2;
  checkP(30);
  sectionHead('1.2 Lot Dimensions & Configuration');y+=2;
  const L=P.lot;
  y=addTable(['Dimension','Imperial','Metric'],[
    ['North Frontage',L.front+"'",((L.front*0.3048).toFixed(1))+'m'],
    ['West Side — Upper Depth',L.upperLeft+"'",((L.upperLeft*0.3048).toFixed(1))+'m'],
    ['West Side — Lower Depth',L.lowerLeft+"'",((L.lowerLeft*0.3048).toFixed(1))+'m'],
    ['East Side — Step (N-S)',L.upperRight+"'",((L.upperRight*0.3048).toFixed(1))+'m'],
    ['East Side — Step Width',L.stepEast+"'",((L.stepEast*0.3048).toFixed(1))+'m'],
    ['South Frontage',L.rear+"'",((L.rear*0.3048).toFixed(1))+'m'],
    [{text:'Total Lot Area',color:OLIVE},{text:d.siteArea.toLocaleString()+" sf",color:WHITE},{text:(d.siteArea*0.0929).toFixed(0)+' m²',color:WHITE}],
  ],y,{colWidths:[75,50,55]});y+=4;
  para('The lot configuration provides an opportunity for a podium-and-tower massing strategy. The primary frontage accommodates a mid-rise podium while the secondary frontage supports a taller tower element. Multiple street frontages enable separation of residential access from commercial servicing.');y+=3;

  // ══════ PAGE 3: ZONING ══════
  newPage();pageTitle('2. ZONING & PLANNING FRAMEWORK');
  sectionHead('2.1 Zoning Designation');
  para('The subject property is zoned Commercial Residential (CR) under City of Toronto Zoning By-law 569-2013, the harmonized zoning by-law that consolidated the former municipalities\u2019 zoning regulations. The CR zone permits a broad range of uses including apartment buildings, retail stores, restaurants, personal service shops, offices, day nurseries, community centres, and places of worship.');y+=2;
  para('Key as-of-right permissions under the CR zone:');y+=1;
  const zoningItems=[
    'Residential Use: Apartment buildings, including mixed-use with ground-floor commercial',
    'Maximum Density: Subject to site-specific zoning provisions and Official Plan policies',
    'Height: Governed by applicable planning framework and site-specific by-law amendments',
    'Minimum Setbacks: Front 3.0m, Rear 7.5m, Side 5.5m residential / 0m commercial (verify with site-specific zoning)',
    'Angular Plane: 45-degree angular plane from rear lot line abutting residential zones',
    'Amenity Space: Minimum 4.0 m² per dwelling unit (indoor) + 4.0 m² per unit (outdoor)',
    'Parking: Category 1 rates apply — 0.7-1.0 spaces/unit residential, visitor parking at 0.1/unit',
  ];
  zoningItems.forEach(item=>{
    checkP(10);
    // Use para() for proper word-wrap without jsPDF's justified-text bug
    para('• '+item, {size:8, color:LGREY, indent:3});
  });y+=3;
  checkP(35);
  // ── DYNAMIC AI ZONING ANALYSIS — full content, proper pagination ──
  if (P._aiZoning && !P._aiZoning.raw) {
    var az = P._aiZoning;

    // 2.2 — Compliance status + summary
    checkP(40);
    sectionHead('2.2 AI Zoning Compliance Analysis');
    if (az.compliance_status) {
      var statusLabel = String(az.compliance_status).replace(/_/g, ' ').toUpperCase();
      var statusColor = az.compliance_status === 'compliant' ? [100,200,100] :
                        az.compliance_status === 'minor_variance_needed' ? [232,200,122] : [220,100,100];
      addText('STATUS: ' + statusLabel + (az.confidence ? '  (Confidence ' + Math.round(az.confidence*100) + '%)' : ''),
              M, y, {size:10, color:statusColor, style:'bold'});
      y += 7;
    }
    if (az.summary) { para(az.summary); y += 3; }

    // 2.2.1 — Permitted envelope (max FSI/height/storeys)
    if (az.permitted_envelope) {
      checkP(30);
      sectionHead('2.2.1 As-of-Right Permitted Envelope');
      var pe = az.permitted_envelope;
      var envRows = [];
      if (pe.max_fsi != null) envRows.push(['Maximum FSI', pe.max_fsi + '×']);
      if (pe.max_height_m != null) envRows.push(['Maximum Height', pe.max_height_m + ' m']);
      if (pe.max_storeys != null) envRows.push(['Maximum Storeys', pe.max_storeys + ' storeys']);
      if (envRows.length) y = addTable(['Parameter','Permitted'], envRows, y, {colWidths:[80,100]});
      if (pe.notes) { y += 2; para(pe.notes); y += 3; }
      else y += 3;
    }

    // 2.2.2 — Compliance issues (full detail, per-item page-break safety)
    if (az.issues && az.issues.length) {
      checkP(20);
      sectionHead('2.2.2 Compliance Issues');
      az.issues.forEach(function(iss){
        // Reserve ~30mm so multi-line issue doesn't split mid-content
        checkP(30);
        var sevLabel = (iss.severity || 'note').toUpperCase();
        var sevColor = iss.severity === 'critical' ? [220,100,100] :
                       iss.severity === 'moderate' ? [232,200,122] : [180,180,180];
        // Header line: parameter + severity badge (use para for safe wrapping)
        para('• ' + (iss.parameter || 'Issue') + '  [' + sevLabel + ']',
             {size:9, color:sevColor, style:'bold'});
        // Proposed vs permitted values (indented body text)
        if (iss.proposed_value || iss.permitted_value) {
          para('Proposed: ' + (iss.proposed_value || 'N/A') + '  ·  Permitted: ' + (iss.permitted_value || 'N/A'),
               {size:8, color:LGREY, indent:6});
        }
        if (iss.bylaw_reference) {
          para('By-law: ' + iss.bylaw_reference, {size:8, color:GREY, indent:6});
        }
        if (iss.resolution_path) {
          para('Resolution: ' + iss.resolution_path, {size:8.5, color:LGREY, indent:6});
        }
        y += 3;
      });
      y += 2;
    }

    // 2.2.3 — Actionable suggestions (specific numeric changes)
    if (az.actionable_suggestions && az.actionable_suggestions.length) {
      checkP(20);
      sectionHead('2.2.3 Recommended Compliance Changes');
      az.actionable_suggestions.forEach(function(s){
        checkP(20);
        var label = s.label || s.field || 'Change';
        para('• ' + label, {size:9, color:OLIVE, style:'bold'});
        if (s.current_value != null && s.suggested_value != null) {
          para((s.field || '') + ': ' + s.current_value + ' -> ' + s.suggested_value,
               {size:8, color:LGREY, indent:6});
        }
        if (s.rationale) para(s.rationale, {size:8.5, color:LGREY, indent:6});
        if (s.impact) para('Impact: ' + s.impact, {size:8, color:[100,200,100], indent:6});
        y += 3;
      });
      y += 2;
    }

    // 2.2.4 — Opportunities
    if (az.opportunities && az.opportunities.length) {
      checkP(20);
      sectionHead('2.2.4 Opportunities Identified');
      az.opportunities.forEach(function(opp){
        checkP(10);
        para('+ ' + opp, {size:8.5, color:[100,200,100]});
        y += 1;
      });
      y += 3;
    }

    // 2.3 — Recommendations (high-level next steps)
    if (az.recommendations && az.recommendations.length) {
      checkP(20);
      sectionHead('2.3 Recommendations');
      az.recommendations.forEach(function(rec, ri){
        checkP(10);
        para((ri+1) + '. ' + rec);
        y += 1;
      });
      y += 3;
    }

    // Source attribution
    if (az.data_sources_used && az.data_sources_used.length) {
      checkP(8);
      addText('Sources: ' + az.data_sources_used.join(', '), M, y, {size:7, color:GREY});
      y += 6;
    }
  } else {
    sectionHead('2.2 Site-Specific Zoning Analysis');
    para('Run the AI Zoning Analysis from the AI tab to populate this section with site-specific compliance details, zoning exceptions, and planning framework analysis based on the project geocoordinates.');y+=3;
  }

  // ══════ PAGE 4: ANGULAR PLANE / SHADOW / WIND (only render template content if AI didn't cover it) ──
  // If AI zoning includes shadow/angular issues, that detail is already above. The template
  // sections below provide a generic narrative based on the live massing. Still rendered for
  // continuity, but with safeguards against empty data (e.g. no podium volumes).
  newPage();pageTitle('2. ZONING & PLANNING FRAMEWORK (Continued)');
  sectionHead('2.4 Angular Plane & Shadow Analysis');
  // Compute volume groupings safely so we never produce empty parens
  var podVols = (P.vols||[]).filter(v => v.storeys <= 5);
  var twrVols = (P.vols||[]).filter(v => v.storeys > 5);
  var podNames = podVols.map(v => v.name).join(', ') || 'lower volumes';
  var podSt    = podVols.map(v => v.storeys).join('-') || (P.vols && P.vols.length ? P.vols[0].storeys : '?');
  var twrDesc  = twrVols.length ? twrVols.map(v => v.name+' at '+v.storeys+'F').join(', ') : null;
  para('The proposed massing has been designed to comply with the angular plane requirements through a stepped building form. The ' + (podVols.length ? 'podium (' + podNames + ')' : 'lower volumes') + ' establish a ' + podSt + 'F streetwall along the primary frontage with ground-floor commercial space at ' + P.flr.gf + ' ft (' + ((P.flr.gf*0.3048).toFixed(1)) + 'm) floor-to-floor height.');y+=2;
  if (twrDesc) {
    para('The tower element (' + twrDesc + ') is set back from the podium edge to reduce visual bulk and shadow impact on adjacent low-rise residential properties. The step-back distance of ' + (P.set ? P.set.stepback : 3) + "' (" + (((P.set?P.set.stepback:3)*0.3048).toFixed(1)) + 'm) is consistent with Tall Building Design Guidelines.');y+=2;
  }
  para('Shadow Impact Assessment: At the proposed height of '+maxHtM.toFixed(1)+'m ('+maxSt+' storeys), the building will cast shadows primarily to the north and northwest during morning hours (March/September equinox). The shadow path at the summer solstice (June 21) will clear the southern residential properties by approximately 11:30am. The massing strategy minimizes shadow duration on the most sensitive receptors compared to a uniform slab form.');y+=3;
  checkP(40);
  sectionHead('2.5 Comparable Precedents');
  // Use user-entered comparables from the Report tab editor
  const comps=(P.comparables||[]).filter(c=>c.addr&&c.addr.trim());
  const compRows=comps.map(c=>[
    c.addr,
    c.dev||'—',
    c.storeys?c.storeys+'':'—',
    c.units?c.units.toLocaleString():'—',
    c.fsi||'—',
    c.status||'—'
  ]);
  if(comps.length===0){
    para('No comparable developments have been entered. Use the Report tab\u2019s Comparable Developments editor to add nearby projects from Urban Toronto or the City of Toronto Development Applications portal.');y+=2;
  } else {
    para('The following '+comps.length+' development applications in the vicinity of the subject site provide strong precedent for the proposed density, height, and mixed-use program:');y+=2;
  }
  y=addTable(['Address','Developer','Storeys','Units','FSI','Status'],[
    ...compRows
  ],y,{colWidths:[40,32,20,18,18,52]});y+=4;
  para('Key observations from the comparable set:');y+=1;
  // Dynamic observations based on user-entered comparables
  if(comps.length>0){
    const built=comps.filter(c=>c.status==='Built');
    const proposed=comps.filter(c=>c.status!=='Built');
    const maxStoreyComp=comps.reduce((m,c)=>(c.storeys||0)>(m.storeys||0)?c:m,comps[0]);
    const maxUnitComp=comps.reduce((m,c)=>(c.units||0)>(m.units||0)?c:m,comps[0]);
    // FSI analysis
    const fsiComps=comps.filter(c=>c.fsi&&c.fsi!=='—'&&parseFloat(c.fsi)>0);
    const fsiValues=fsiComps.map(c=>parseFloat(c.fsi));
    const minFSI=fsiValues.length>0?Math.min(...fsiValues):0;
    const maxFSI=fsiValues.length>0?Math.max(...fsiValues):0;
    const avgFSI=fsiValues.length>0?(fsiValues.reduce((s,v)=>s+v,0)/fsiValues.length):0;
    if(built.length>0){
      const b=built[0];
      para('\u2022 '+b.addr+(b.dev&&b.dev!=='\u2014'?' ('+b.dev+')':'')+' at '+(b.storeys||'?')+' storeys and '+(b.units||'?')+' units'+(b.fsi&&b.fsi!=='\u2014'?' (FSI '+b.fsi+'\u00D7)':'')+' is a completed project nearby, establishing a baseline for as-built density on this corridor.');y+=1;
    }
    if(proposed.length>0){
      para('\u2022 '+proposed.length+' active/proposed development application'+(proposed.length>1?'s':'')+' in the area signal significant intensification pressure. The tallest proposal is '+maxStoreyComp.addr+' at '+(maxStoreyComp.storeys||'?')+' storeys with '+(maxStoreyComp.units||'?')+' units.');y+=1;
    }
    if(maxUnitComp&&maxUnitComp.units>100){
      para('\u2022 The largest project by unit count is '+maxUnitComp.addr+' with '+maxUnitComp.units.toLocaleString()+' units, indicating the market can absorb significant residential inventory in this area.');y+=1;
    }
    if(fsiValues.length>=2){
      para('\u2022 FSI analysis: Comparable projects range from '+minFSI.toFixed(1)+'\u00D7 to '+maxFSI.toFixed(1)+'\u00D7 (avg '+avgFSI.toFixed(1)+'\u00D7). The subject proposal at '+d.fsi.toFixed(2)+'\u00D7 is '+(d.fsi<avgFSI?'conservative':'in line with')+' relative to the emerging context, '+(d.fsi<maxFSI?'suggesting potential for additional density optimization.':'at the upper end of the range.'));y+=1;
    }
    const devs=[...new Set(comps.map(c=>c.dev).filter(d=>d&&d!=='\u2014'&&d!==''))];
    if(devs.length>1){
      para('\u2022 Multiple developers are active in the area ('+devs.join(', ')+'), confirming broad market confidence in this corridor\u2019s development potential.');y+=1;
    }
  }
  y+=1;
  para('The proposed FSI of '+d.fsi.toFixed(2)+'× should be evaluated against the emerging built-form context of surrounding approvals and proposals. The density and height trends in the comparable set suggest the planning environment is receptive to intensification at this location.');y+=3;

  // ══════ PAGE 5: MASSING & RENDER ══════
  newPage();pageTitle('3. BUILDING MASSING');
  if(massingImg){try{doc.addImage(massingImg,'JPEG',M,y,cw,80);y+=84;}catch(e){}}
  sectionHead('3.1 Volume Breakdown');
  const volRows=P.vols.map(v=>{
    const fp=v.customAreaSF||(v.width*v.depth);
    return [v.name,v.storeys+'F',fp.toLocaleString()+' sf',(fp*v.storeys).toLocaleString()+' sf',v.commGF?'Yes':'No'];
  });
  y=addTable(['Volume','Storeys','Floor Plate','Total GFA','GF Comm.'],volRows,y,{colWidths:[30,25,40,45,40]});y+=4;
  y=addTable(['Metric','Value'],[
    ['Total Gross Floor Area',d.totalGFA.toLocaleString()+' sf ('+(d.totalGFA*0.0929).toFixed(0)+' m²)'],
    ['Floor Space Index (FSI)',d.fsi.toFixed(2)+'×'],
    ['Maximum Height',maxHtM.toFixed(1)+'m ('+maxSt+' storeys)'],
    ['Residential GFA',d.resiGFA.toLocaleString()+' sf'],
    ['Commercial GFA (Ground Floor)',d.commGFA.toLocaleString()+' sf'],
    ['Net Sellable Residential',d.netResiSF.toLocaleString()+' sf ('+pct(d.netResiSF/d.resiGFA)+' efficiency)'],
  ],y,{colWidths:[100,80]});y+=4;

  // ══════ PAGE 5b: AI-DESIGNED MASSING DETAIL ══════
  var aiOpt=P._optimalMassing||null;
  var aiA=aiOpt?aiOpt.aiAnalysis:null;
  var aiPF=aiOpt?aiOpt.realProforma:null;
  newPage();pageTitle(aiA?'3.2 AI-DESIGNED MASSING':'3.2 MASSING DETAIL');

  if(aiA){
    // AI Developer Strategy
    sectionHead('Developer Strategy');
    para(aiA.reasoning||'AI massing analysis was run but no reasoning was provided.');y+=3;

    // Approval path
    checkP(25);
    var approvalLabels={'as-of-right':'As-of-Right (SPA Only)','minor_variance':'Minor Variance','zbla':'ZBLA (s.34)','opa_zbla':'OPA + ZBLA'};
    y=addTable(['Parameter','Value'],[
      ['Approval Path',approvalLabels[aiA.approval_path]||aiA.approval_path||'N/A'],
      ['Target FSI',(aiA.target_fsi||'?')+'×'],
      ['AI Confidence',Math.round((aiA.confidence||0)*100)+'%'],
    ],y,{colWidths:[65,115]});y+=4;

    // Variance strategy
    if(aiA.variance_strategy){
      checkP(20);
      sectionHead('Minor Variance Strategy');
      para(aiA.variance_strategy);y+=3;
    }

    // Setbacks
    if(aiA.setbacks){
      checkP(20);
      sectionHead('Setbacks Applied');
      var sb=aiA.setbacks;
      y=addTable(['Edge','Setback (ft)','Setback (m)'],[
        ['Front',(sb.front||0)+"'",((sb.front||0)*0.3048).toFixed(1)+'m'],
        ['Side East',(sb.sideE||0)+"'",((sb.sideE||0)*0.3048).toFixed(1)+'m'],
        ['Side West',(sb.sideW||0)+"'",((sb.sideW||0)*0.3048).toFixed(1)+'m'],
        ['Rear',(sb.rear||0)+"'",((sb.rear||0)*0.3048).toFixed(1)+'m'],
      ],y,{colWidths:[50,65,65]});y+=4;
    }

    // Precedent justification
    if(aiA.precedent_justification){
      checkP(20);
      sectionHead('Precedent Justification');
      para(aiA.precedent_justification);y+=3;
    }
  }

  // Per-volume detailed specifications
  checkP(30);
  sectionHead(aiA?'Building Volumes':'Volume Specifications');
  P.vols.forEach(function(v,vi){
    checkP(50);
    var volFP=v.customAreaSF||(v.width||0)*(v.depth||0);
    var gfH=v.commGF?P.flr.gf:P.flr.typ;
    var totalHtFt=gfH+(v.storeys-1)*P.flr.typ;
    var totalHtM=(totalHtFt*0.3048).toFixed(1);
    var podSt=v.podiumStoreys!==undefined?v.podiumStoreys:(v.storeys<=4?v.storeys-1:Math.min(3,v.storeys-1));
    var towerSt=v.storeys-1-podSt;
    var clad=(v.cladding||'brick').replace(/([A-Z])/g,' $1').replace(/^./,function(s){return s.toUpperCase();});
    var isCustomPoly=!!(v.customPolyLocal&&v.customPolyLocal.length>=4);
    var dims=isCustomPoly?'Custom polygon footprint':((v.width||0)+"' × "+(v.depth||0)+"'");
    var dimsM=isCustomPoly?'':(((v.width||0)*0.3048).toFixed(1)+'m × '+((v.depth||0)*0.3048).toFixed(1)+'m');

    addText('VOLUME '+v.name+(vi===0&&aiA?' (Podium)':vi===1&&aiA?' (Tower)':''),M,y,{size:10,color:OLIVE,style:'bold'});y+=6;
    var volDetailRows=[
      ['Storeys',v.storeys+'F ('+totalHtM+'m / '+Math.round(totalHtFt)+"' total height)"],
      ['Footprint',dims+(dimsM?' ('+dimsM+')':'')],
      ['Floor Plate Area',volFP.toLocaleString()+' sf ('+(volFP*0.0929).toFixed(0)+' m²)'],
      ['Total GFA (est.)',(volFP*v.storeys).toLocaleString()+' sf'],
      ['Ground Floor Height',gfH+"' ("+(gfH*0.3048).toFixed(1)+'m) '+(v.commGF?'— Commercial/Retail':'— Residential')],
      ['Typical Floor Height',P.flr.typ+"' ("+(P.flr.typ*0.3048).toFixed(1)+'m)'],
      ['Cladding',clad],
    ];
    if(podSt>0) volDetailRows.push(['Podium Floors',podSt+' storeys (brick/masonry)']);
    if(towerSt>0) volDetailRows.push(['Tower Floors',towerSt+' storeys (curtain wall)']);
    if(v.stepbackAmt>0&&towerSt>0) volDetailRows.push(['Tower Step-back',v.stepbackAmt+"' ("+(v.stepbackAmt*0.3048).toFixed(1)+"m) from podium face"]);
    if(v.baseElevFt>0) volDetailRows.push(['Base Elevation',v.baseElevFt+"' ("+(v.baseElevFt*0.3048).toFixed(1)+"m) — tower starts above podium roofline"]);
    if(v.balconies) volDetailRows.push(['Balconies','Yes — typical floors']);
    y=addTable(['Parameter','Specification'],volDetailRows,y,{colWidths:[55,125]});y+=6;
  });

  // Building-wide specifications
  checkP(50);
  sectionHead('Building Design Parameters');
  var belowGradeLevels=Math.max(1,Math.ceil((d.parkSpaces||0)*350/(Math.max(1,Math.round(lotArea())))));
  var designRows=[
    ['Site Area',Math.round(lotArea()).toLocaleString()+" sf ("+(lotArea()*0.0929).toFixed(0)+" m²)"],
    ['Site Coverage',pct(d.totalGFA>0?(P.vols.reduce(function(s,v){return s+(v.customAreaSF||(v.width||0)*(v.depth||0));},0))/Math.max(1,lotArea()):0)],
    ['Floor Space Index (FSI)',d.fsi.toFixed(2)+'×'],
    ['Total Building Height',maxHtM.toFixed(1)+'m ('+maxSt+' storeys)'],
    ['Ground Floor Program',d.commGFA>0?'Commercial/Retail ('+Math.round(d.commGFA).toLocaleString()+' sf)':'Residential'],
    ['Parking Spaces',d.parkSpaces+' stalls ('+P.pf.parkRatio+' per unit)'],
    ['Below-Grade Parking',belowGradeLevels+' level'+(belowGradeLevels>1?'s':'')+' (~350 sf/stall)'],
    ['Storage Lockers',d.lockers+' units ('+P.pf.lockerRatio+' per unit)'],
    ['Total Residential Units',d.totalUnits+''],
    ['Avg Unit Size',d.totalUnits>0?Math.round(d.netResiSF/d.totalUnits)+' sf':'N/A'],
    ['Net-to-Gross Efficiency',d.resiGFA>0?pct(d.netResiSF/d.resiGFA):'N/A'],
  ];
  y=addTable(['Parameter','Value'],designRows,y,{colWidths:[65,115]});y+=4;

  // ══════ PAGE 6: UNIT MIX ══════
  newPage();pageTitle('4. UNIT MIX & PROGRAM');
  sectionHead('4.1 Residential Unit Schedule');
  const umRows=d.unitMix.map(u=>[u.type,u.size+' sf',u.count+'',pct(u.count/d.totalUnits),(u.count*u.size).toLocaleString()+' sf']);
  umRows.push([{text:'TOTAL',color:OLIVE},{text:'—',color:OLIVE},{text:d.totalUnits+'',color:OLIVE},{text:'100%',color:OLIVE},{text:d.netResiSF.toLocaleString()+' sf',color:OLIVE}]);
  y=addTable(['Unit Type','Avg Size','Count','Mix %','Total NSA'],umRows,y,{colWidths:[40,30,25,25,60]});y+=4;
  para('The unit mix is designed to meet market demand along the the area corridor, with a focus on smaller units (studio and 1-bedroom) that appeal to young professionals, transit commuters, and first-time buyers attracted by the Crosstown LRT. The 2-bedroom and larger units ('+pct((d.unitMix.filter(u=>u.type.includes('2-')||u.type.includes('3-')).reduce((s,u)=>s+u.count,0))/d.totalUnits)+' of total mix) cater to downsizing empty-nesters and small families.');y+=3;
  checkP(30);
  sectionHead('4.2 Ground Floor Commercial');
  y=addTable(['Tenant Category','Area (sf)','Rent ($/sf NNN)','NOI','Cap Rate','Value'],
    d.commTenants.map(t=>[t.label||t.type,Math.round(t.area).toLocaleString(),'$'+t.rent,fmt$(t.noi),pct(t.cap),fmtM(t.value)]),
    y,{colWidths:[35,25,30,30,25,35]});y+=4;
  para('The ground floor commercial program assumes a grocery-anchored retail mix, reflecting the neighbourhood demand for walkable daily-needs retail along the the corridor. Net leasable commercial area of '+Math.round(d.netLeasableComm).toLocaleString()+' sf after lobby, loading, and mechanical deductions.');y+=3;

  // ══════ PAGE 7: PRO-FORMA ══════
  newPage();pageTitle('5. DEVELOPMENT PRO-FORMA');
  sectionHead('5.1 Revenue');
  y=addTable(['Source','Amount','$/sf GFA'],[
    ['Residential Sales ('+d.totalUnits+' units)',fmtM(d.resiRevenue),'$'+(d.resiRevenue/d.totalGFA).toFixed(0)],
    ['Commercial Value (Cap Rate)',fmtM(d.totalCommValue),'$'+(d.totalCommValue/d.totalGFA).toFixed(0)],
    ['Parking ('+d.parkSpaces+' stalls @ '+fmt$(P.pf.parkPrice)+'/ea)',fmtM(d.parkRev),''],
    ['Lockers ('+d.lockers+' @ '+fmt$(P.pf.lockerPrice)+'/ea)',fmtM(d.lockerRev),''],
    [{text:'TOTAL GROSS REVENUE',color:OLIVE},{text:fmtM(d.totalGrossRev),color:OLIVE},{text:'$'+(d.totalGrossRev/d.totalGFA).toFixed(0),color:OLIVE}],
  ],y,{colWidths:[85,45,50]});y+=6;
  sectionHead('5.2 Development Costs');
  y=addTable(['Category','Amount','$/sf GFA','% of Total'],[
    ['Land Acquisition',fmtM(d.totalLand),'$'+(d.totalLand/d.totalGFA).toFixed(0),pct(d.totalLand/d.totalCost)],
    ['Hard Construction Costs',fmtM(d.totalHard),'$'+(d.totalHard/d.totalGFA).toFixed(0),pct(d.totalHard/d.totalCost)],
    ['Soft Costs (incl. DCs)',fmtM(d.totalSoft),'$'+(d.totalSoft/d.totalGFA).toFixed(0),pct(d.totalSoft/d.totalCost)],
    ['Financing & Time Costs',fmtM(d.totalFinancing),'$'+(d.totalFinancing/d.totalGFA).toFixed(0),pct(d.totalFinancing/d.totalCost)],
    [{text:'TOTAL DEVELOPMENT COST',color:OLIVE},{text:fmtM(d.totalCost),color:OLIVE},{text:'$'+(d.totalCost/d.totalGFA).toFixed(0),color:OLIVE},{text:'100%',color:OLIVE}],
  ],y,{colWidths:[60,40,40,40]});y+=6;
  sectionHead('5.3 Returns Summary');
  const retCol=d.marginOnCost>=0.15?[100,200,100]:[220,100,100];
  y=addTable(['Metric','Value'],[
    ['Developer Margin',{text:fmtM(d.margin),color:retCol}],
    ['Profit Margin',{text:pct(d.marginOnCost),color:retCol}],
    ['Margin on Revenue',pct(d.marginOnRev)],
    ['Project IRR (Unlevered)',{text:pct(dcfR.irr),color:[196,154,222]}],
    ['NPV @ '+pct(P.pf.dcf.discountRate)+' discount',fmtM(dcfR.npv)],
    ['Equity Multiple',dcfR.equityMultiple.toFixed(2)+'×'],
  ],y,{colWidths:[100,80]});y+=4;

  // ══════ PAGE 7b: AI PRO-FORMA OPTIMIZATION (only if AI was run) ══════
  if(P._aiProforma && !P._aiProforma.raw){
    var ap = P._aiProforma;
    newPage(); pageTitle('5.4 AI PRO-FORMA OPTIMIZATION');
    var apOverall = (ap.assessment && ap.assessment.overall) || 'unknown';
    var apColor = apOverall === 'strong' ? [100,200,100] : apOverall === 'viable' ? [174,188,70]
      : apOverall === 'marginal' ? [232,200,122] : [220,100,100];
    addText('Assessment: ' + apOverall.toUpperCase() + (ap.confidence ? '  (Confidence ' + Math.round(ap.confidence*100) + '%)' : ''),
            M, y, {size:10, color:apColor, style:'bold'}); y += 7;
    if(ap.assessment && ap.assessment.summary){ para(ap.assessment.summary); y += 3; }
    if(ap.benchmarks){
      checkP(30); sectionHead('5.4.1 Market Benchmarks');
      var benchRows = [];
      ['cost_per_sf','revenue_per_sf','margin_pct'].forEach(function(k){
        var b = ap.benchmarks[k]; if(!b) return;
        var label = k.replace(/_/g,' ').replace(/\b\w/g, function(c){return c.toUpperCase();});
        var isPct = k.indexOf('pct') >= 0;
        benchRows.push([label,
          isPct ? b.project + '%' : '$' + b.project,
          isPct ? (b.market_low + '-' + b.market_high + '%') : ('$' + b.market_low + '-$' + b.market_high)]);
      });
      if(benchRows.length) y = addTable(['Metric','Project','Market Range'], benchRows, y, {colWidths:[60,40,80]}); y += 4;
    }
    if(ap.actionable_suggestions && ap.actionable_suggestions.length){
      checkP(20); sectionHead('5.4.2 Actionable Suggestions');
      ap.actionable_suggestions.forEach(function(s){
        checkP(25);
        para('\u2022 ' + (s.label || s.field || 'Change'), {size:9, color:OLIVE, style:'bold'});
        para((s.field || '') + ': ' + s.current_value + ' ->' + s.suggested_value, {size:8, color:LGREY, indent:6});
        if(s.rationale) para(s.rationale, {size:8.5, color:LGREY, indent:6});
        if(s.impact) para('Impact: ' + s.impact, {size:8, color:[100,200,100], indent:6});
        y += 3;
      });
      y += 2;
    }
    if(ap.unit_mix_recommendations && ap.unit_mix_recommendations.length){
      checkP(20); sectionHead('5.4.3 Unit Mix Recommendations');
      ap.unit_mix_recommendations.forEach(function(r){
        checkP(15);
        para('Current: ' + r.current + '  -> Recommended: ' + r.recommended, {size:8.5, style:'bold'});
        if(r.rationale) para(r.rationale, {size:8, color:LGREY, indent:4});
        if(r.revenue_impact_estimate) para('Revenue impact: ' + r.revenue_impact_estimate, {size:8, color:[100,200,100], indent:4});
        y += 2;
      });
    }
    if(ap.cost_flags && ap.cost_flags.length){
      checkP(20); sectionHead('5.4.4 Cost Flags');
      ap.cost_flags.forEach(function(f){
        checkP(12);
        para('(!) ' + f.line_item + ': ' + f.current_value + ' (market: ' + f.market_range + ') \u2014 ' + f.risk,
          {size:8.5, color:[232,200,122]});
        y += 1;
      });
      y += 2;
    }
    if(ap.top_sensitivities && ap.top_sensitivities.length){
      checkP(20); sectionHead('5.4.5 Key Sensitivities');
      ap.top_sensitivities.forEach(function(s, i){
        checkP(8);
        para((i+1) + '. ' + s.input + ' (' + s.current_value + ') ->' + s.impact, {size:8.5});
      });
    }
  }

  // ══════ PAGE 7c: AI RISK ASSESSMENT (only if AI was run) ══════
  if(P._aiRisk && !P._aiRisk.raw){
    var ar = P._aiRisk;
    newPage(); pageTitle('5.5 AI RISK ASSESSMENT');
    var arColor = ar.risk_rating === 'low' ? [100,200,100] : ar.risk_rating === 'moderate' ? [232,200,122]
      : ar.risk_rating === 'elevated' ? [255,150,100] : [220,100,100];
    addText('Risk Rating: ' + (ar.risk_rating || 'unknown').toUpperCase() + (ar.confidence ? '  (Confidence ' + Math.round(ar.confidence*100) + '%)' : ''),
            M, y, {size:10, color:arColor, style:'bold'}); y += 7;
    if(ar.summary){ para(ar.summary); y += 3; }
    if(ar.scenario_analysis){
      checkP(30); sectionHead('5.5.1 Scenario Analysis');
      var scenRows = [];
      ['best_case','base_case','worst_case'].forEach(function(k){
        var s = ar.scenario_analysis[k]; if(!s) return;
        scenRows.push([k.replace(/_/g,' ').toUpperCase(), s.margin || '', s.probability || '', s.description || '']);
      });
      // Description gets the most width since it's a sentence
      if(scenRows.length) y = addTable(['Scenario','Margin','Probability','Description'], scenRows, y, {colWidths:[28,22,28,102]}); y += 4;
    }
    if(ar.break_even_thresholds && ar.break_even_thresholds.length){
      checkP(20); sectionHead('5.5.2 Break-Even Thresholds');
      var beRows = ar.break_even_thresholds.map(function(t){ return [t.input, t.current, t.break_even, t.headroom]; });
      // Wider headroom column since AI tends to write a sentence here
      y = addTable(['Input','Current','Break-Even','Headroom'], beRows, y, {colWidths:[40,30,35,75]}); y += 4;
    }
    if(ar.stress_tests && ar.stress_tests.length){
      checkP(20); sectionHead('5.5.3 Stress Tests');
      ar.stress_tests.forEach(function(t){
        checkP(20);
        var sevColor = t.severity === 'critical' ? [220,100,100] : t.severity === 'concerning' ? [232,200,122] : [100,200,100];
        para('\u2022 ' + t.scenario + ' [' + (t.severity || 'note').toUpperCase() + ']', {size:9, color:sevColor, style:'bold'});
        if(t.assumptions) para(t.assumptions, {size:8, color:LGREY, indent:4});
        if(t.outcome) para('-> ' + t.outcome, {size:8.5, indent:4});
        y += 2;
      });
    }
    if(ar.mitigation_strategies && ar.mitigation_strategies.length){
      checkP(20); sectionHead('5.5.4 Mitigation Strategies');
      ar.mitigation_strategies.forEach(function(m, i){
        checkP(10);
        para((i+1) + '. ' + m.strategy + ' \u2014 ' + m.impact + ' (' + m.implementation + ')', {size:8.5});
      });
    }
  }

  // ══════ PAGE 7d: AI COMPARABLE INSIGHTS (only if AI was run) ══════
  if(P._aiComps && !P._aiComps.raw){
    var ac = P._aiComps;
    newPage(); pageTitle('5.6 AI COMPARABLE INSIGHTS');
    var acColor = ac.competitive_position === 'under-supplied' ? [100,200,100]
      : ac.competitive_position === 'balanced' ? [174,188,70]
      : ac.competitive_position === 'competitive' ? [232,200,122] : [220,100,100];
    addText('Market Position: ' + (ac.competitive_position || 'unknown').replace(/_/g,' ').toUpperCase() + (ac.confidence ? '  (Confidence ' + Math.round(ac.confidence*100) + '%)' : ''),
            M, y, {size:10, color:acColor, style:'bold'}); y += 7;
    if(ac.summary){ para(ac.summary); y += 3; }
    if(ac.pricing_assessment){
      checkP(30); sectionHead('5.6.1 Pricing Assessment');
      var pa = ac.pricing_assessment;
      var paRows = [['Subject Pricing', '$' + (pa.subject_psf||'?') + '/SF']];
      if(pa.comp_range_psf) paRows.push(['Comparable Range', '$' + (pa.comp_range_psf.low||'?') + ' - $' + (pa.comp_range_psf.high||'?') + '/SF']);
      if(pa.comp_range_psf && pa.comp_range_psf.median != null) paRows.push(['Comp Median', '$' + pa.comp_range_psf.median + '/SF']);
      if(pa.assessment) paRows.push(['Assessment', pa.assessment.toUpperCase()]);
      y = addTable(['Metric','Value'], paRows, y, {colWidths:[60,120]}); y += 3;
      if(pa.recommendation){ para(pa.recommendation, {size:8.5, color:LGREY}); y += 2; }
    }
    if(ac.absorption_analysis){
      checkP(20); sectionHead('5.6.2 Absorption Analysis');
      var ab = ac.absorption_analysis;
      var abRows = [];
      if(ab.pipeline_units_1km != null) abRows.push(['Pipeline (1km)', ab.pipeline_units_1km + ' units']);
      if(ab.estimated_annual_absorption != null) abRows.push(['Est. Annual Absorption', String(ab.estimated_annual_absorption)]);
      if(ab.months_of_inventory != null) abRows.push(['Months of Inventory', String(ab.months_of_inventory)]);
      if(ab.risk) abRows.push(['Risk', ab.risk.toUpperCase()]);
      if(abRows.length) y = addTable(['Metric','Value'], abRows, y, {colWidths:[60,120]}); y += 3;
      if(ab.commentary){ para(ab.commentary, {size:8.5, color:LGREY}); y += 2; }
    }
    if(ac.differentiation_opportunities && ac.differentiation_opportunities.length){
      checkP(20); sectionHead('5.6.3 Differentiation Opportunities');
      ac.differentiation_opportunities.forEach(function(o){
        checkP(20);
        para('\u2022 ' + o.strategy, {size:9, color:OLIVE, style:'bold'});
        if(o.rationale) para(o.rationale, {size:8.5, color:LGREY, indent:4});
        if(o.comparable_gap) para('Gap: ' + o.comparable_gap, {size:8, color:GREY, indent:4});
        y += 2;
      });
    }
    if(ac.timing_recommendation){
      checkP(15); sectionHead('5.6.4 Timing Recommendation');
      para(ac.timing_recommendation.optimal_launch || '', {size:9, color:OLIVE, style:'bold'});
      if(ac.timing_recommendation.rationale) para(ac.timing_recommendation.rationale, {size:8.5, color:LGREY});
    }
  }

  // ══════ PAGE 8: COST SUMMARY (replaced DC Schedule) ══════
  newPage();pageTitle('6. COST SUMMARY');
  sectionHead('6.1 Hard & Soft Costs');
  y=addTable(['Category','Amount'],[
    ['Hard Costs ('+fmt$(d.hardCostPSF)+'/sf × '+Math.round(d.totalGFA).toLocaleString()+' sf)',fmtM(d.totalHard)],
    ['Soft Costs ('+(d.softCostPct*100).toFixed(1)+'% of Hard)',fmtM(d.totalSoft)],
    ['Financing',fmtM(d.totalFinancing)],
    [{text:'TOTAL PROJECT COST',color:OLIVE},{text:fmtM(d.totalCost),color:OLIVE}],
  ],y,{colWidths:[120,60]});y+=8;

  // ── 6.2 Pre-Development & Approvals — itemized City of Toronto fees + studies ──
  if(d.planningFees){
    checkP(70);
    var routeLabel = ({spa:'As-of-Right (SPA only)',mv:'Minor Variance',zba:'ZBLA Rezoning',opa_zba:'OPA + ZBLA Rezoning'})[d.approvalRoute] || d.approvalRoute;
    sectionHead('6.2 Pre-Development & Approvals  -  '+routeLabel);
    para('City of Toronto 2026 User Fee Schedule (Appendix A, City Planning & Development Review). Project scale: '+d.totalUnits+' units, '+(d.maxStoreys||0)+' storeys, '+Math.round(d.totalGFA).toLocaleString()+' sf GFA, FSI '+(d.fsi||0).toFixed(2)+'x'+(d.asOfRightFSI?' vs as-of-right '+d.asOfRightFSI.toFixed(1)+'x':'')+'. Building permit per Toronto Building Group C rates (BL010/BL011). Approval route may be manually overridden in the proforma when zoning constraints (use, height, density, parking) require an application beyond what FSI alone would suggest. Consultant studies (Phase 1 ESA, geotech, planning rationale, etc.) are captured under Section 1 (Land Acquisition - Due Diligence).', {size:8.5, color:LGREY}); y+=2;

    // Application fees table — itemized City of Toronto fees only
    var appRows = d.planningFees.applications.map(function(a){
      return [a.label + (a.section ? '   ['+a.section+']' : ''), fmt$(a.fee)];
    });
    appRows.push([{text:'TOTAL PRE-DEVELOPMENT (City Application Fees)', color:OLIVE}, {text:fmt$(d.planningFees.total), color:OLIVE}]);
    y = addTable(['Application', 'Fee'], appRows, y, {colWidths:[130,50]}); y += 8;
  }

  // ══════ PAGE 9: DCF + RISK ══════
  newPage();pageTitle('7. DCF MODEL & RISK ANALYSIS');
  sectionHead('7.1 Cash Flow Summary ('+d.totalProjectMonths+'-Month Project)');
  y=addTable(['Metric','Value'],[
    ['Pre-Development',d.preDevelopmentMonths+' months'],
    ['Active Construction',d.activeConstructionMonths+' months'],
    ['Absorption Period',d.absorptionMonths+' months'],
    ['Total Project Timeline',d.totalProjectMonths+' months'],
    ['Project IRR (Unlevered)',{text:pct(dcfR.irr),color:[196,154,222]}],
    ['NPV @ '+pct(P.pf.dcf.discountRate)+' Discount Rate',fmtM(dcfR.npv)],
    ['Equity Multiple',dcfR.equityMultiple.toFixed(2)+'×'],
    ['Peak Equity Requirement',fmtM(dcfR.peakEquity)],
  ],y,{colWidths:[100,80]});y+=6;
  checkP(50);
  sectionHead('7.2 Monte Carlo Risk Analysis ('+mc.stats.iterations.toLocaleString()+' Simulations)');
  const ms=mc.stats;
  y=addTable(['','P10 (Bear Case)','P25','Median','Mean','P75','P90 (Bull Case)'],[
    ['IRR',pct(ms.irrP10),pct(ms.irrP25),{text:pct(ms.irrMedian),color:[100,200,100]},pct(ms.irrMean),pct(ms.irrP75),{text:pct(ms.irrP90),color:[78,205,196]}],
    ['Margin',pct(ms.marginP10),'',{text:pct(ms.marginMedian),color:[100,200,100]},pct(ms.marginMean),'',{text:pct(ms.marginP90),color:[78,205,196]}],
  ],y,{colWidths:[25,27,22,27,22,22,35]});y+=6;
  doc.setFillColor(30,30,30);doc.roundedRect(M,y,cw/2-2,18,2,2,'F');
  addText('Prob. Viable (>15%)',M+5,y+7,{size:8,color:GREY});
  addText(pct(ms.probViable),M+5,y+14,{size:14,color:ms.probViable>=0.6?[100,200,100]:[220,100,100],style:'bold'});
  doc.setFillColor(30,30,30);doc.roundedRect(M+cw/2+2,y,cw/2-2,18,2,2,'F');
  addText('Value at Risk (P10)',M+cw/2+7,y+7,{size:8,color:GREY});
  addText(pct(ms.varAt10),M+cw/2+7,y+14,{size:14,color:[232,200,122],style:'bold'});y+=24;
  sectionHead('7.3 Key Risk Drivers (Tornado)');
  const torRows=mc.tornado.slice(0,6).map((t,i)=>[(i+1)+'',t.name,'±'+pct(t.swing/2)]);
  y=addTable(['Rank','Variable','Impact on Margin'],torRows,y,{colWidths:[15,105,60]});y+=4;

  // ══════ PAGE 10: RECOMMENDATIONS ══════
  newPage();pageTitle('8. RECOMMENDATIONS & CONCLUSIONS');
  sectionHead('8.1 Development Recommendation');
  const viable=d.marginOnCost>=0.15;
  para(viable?
    'Based on the analysis presented herein, OleaDev recommends proceeding with a Zoning By-law Amendment (ZBA) and Site Plan Approval (SPA) application for the proposed mixed-use development. The project yields a profit margin of '+pct(d.marginOnCost)+', exceeding the industry-standard 15% threshold for project viability. The Monte Carlo simulation confirms a '+pct(ms.probViable)+' probability of achieving the target return under a range of market conditions.':
    'The current pro-forma yields a profit margin of '+pct(d.marginOnCost)+', which falls below the 15% threshold typically required by developers and institutional investors. OleaDev recommends revisiting the land acquisition price, construction cost assumptions, or revenue expectations before proceeding with planning applications. Alternatively, consider optimizing the unit mix or density to improve the returns profile.');y+=3;
  checkP(40);
  sectionHead('8.2 Key Risk Factors');
  const risks=[
    'Construction Cost Escalation: Toronto is experiencing sustained construction cost inflation of 4-8% annually. A 10% escalation in hard costs would reduce the margin by approximately '+pct(0.1*d.totalHard/d.totalCost)+'.',
    'Interest Rate Environment: The Bank of Canada policy rate influences construction financing costs. Each 100 bps increase in the overnight rate adds approximately '+fmtM(d.totalCost*0.35*0.01*(d.activeConstructionMonths/12)*0.6)+' to project costs.',
    'Absorption Risk: Pre-sale velocity determines the timing of deposit collections and construction financing availability. A slower absorption rate extends the project timeline and increases carrying costs.',
    'Municipal Approvals: The ZBA and SPA process typically requires 12-24 months in Toronto. Delays in approvals directly impact the IRR through extended pre-development carrying costs and potential DC escalation.',
    'Development Charge Indexing: Toronto DCs are indexed semi-annually. The current analysis uses '+new Date().getFullYear()+' rates; a '+pct(0.05)+' annual escalation over a 2-year approval period would add approximately '+fmtM(dcs.grandTotal*0.10)+' to the DC burden.',
  ];
  risks.forEach(r=>{checkP(12);para('• '+r);y+=1;});y+=3;
  checkP(30);
  sectionHead('8.3 Next Steps');
  const steps=['Engage planning consultant for pre-application consultation with City of Toronto','Commission Phase 1 Environmental Site Assessment (ESA)','Prepare and submit ZBA and SPA applications','Engage structural engineer for shoring design and below-grade parking layout','Initiate pre-sales marketing program (target 70% pre-sale threshold for construction financing)','Secure construction financing commitment (target LTC of '+(P.pf.ltc*100)+'% at prime + 200 bps)','Tender construction contract with fixed-price GMP structure'];
  steps.forEach((s,i)=>{checkP(6);addText((i+1)+'. '+s,M+3,y,{size:8.5,color:LGREY});y+=5;});

  // Footer on all pages — uses the brand metadata (no more hardcoded
  // "OleaDev"). Single line: confidential + brand on the left,
  // page-x-of-y on the right. The redundant centered project-name
  // line was removed; project name already appears prominently on
  // the cover and the executive summary header.
  const pageCount=doc.getNumberOfPages();
  for(let p=1;p<=pageCount;p++){
    doc.setPage(p);doc.setFontSize(7);doc.setTextColor(100,100,100);
    doc.text('Confidential · ' + brandName, M, H-8);
    doc.text('Page '+p+' of '+pageCount, W-M, H-8, {align:'right'});
  }
  // Filename uses sanitized brand + project name. Default brand falls
  // back to "EstateBuilder", and an empty project name to "Project".
  const fileBrand = (brandName || 'EstateBuilder').replace(/[^a-zA-Z0-9]/g,'_');
  const fileProj  = (P.projectName || 'Project').replace(/[^a-zA-Z0-9]/g,'_').slice(0, 60);
  doc.save(fileBrand + '_' + fileProj + '_Feasibility_Report.pdf');
  }catch(err){alert('PDF export error: '+err.message);console.error(err);}
}

// ═══════════════════════════════════════════════════════════
//  EXPORT: PPTX PITCH DECK
// ═══════════════════════════════════════════════════════════
/** Generates and downloads a PPTX pitch deck using PptxGenJS. */
async function exportPPTX(){
  try{
  // PptxGenJS exposes as window.PptxGenJS from the bundle
  const PptxGen=window.PptxGenJS||window.pptxgen;
  if(!PptxGen){alert('PPTX library still loading — please wait a moment and try again.');return;}
  const pptx=new PptxGen();
  pptx.defineLayout({name:'WIDE',width:13.33,height:7.5});
  pptx.layout='WIDE';

  const d=pfData();
  // Capture images (use bird's eye view to frame building)
  let massingImg=null;
  try{
    const cw_=document.getElementById('canvas-wrap');
    const wasHidden=cw_&&cw_.style.display==='none';
    if(wasHidden){cw_.style.display='block';cw_.style.position='absolute';cw_.style.left='-9999px';cw_.style.width='1200px';cw_.style.height='800px';}
    const c=document.querySelector('#canvas-wrap canvas');
    if(c&&renderer){
      const sT=orb.theta,sP=orb.phi,sD=orb.dist,sTgt=orb.target.clone();
      setView('bird');orb.dist=130;updateCam();
      renderer.setSize(1200,800);camera.aspect=1200/800;camera.updateProjectionMatrix();
      renderer.render(scene,camera);massingImg=c.toDataURL('image/jpeg',0.92);
      orb.theta=sT;orb.phi=sP;orb.dist=sD;orb.target.copy(sTgt);updateCam();
    }
    if(wasHidden){cw_.style.display='none';cw_.style.position='';cw_.style.left='';cw_.style.width='';cw_.style.height='';onResize();}
  }catch(e){}
  const mc=runMonteCarlo(d,3000);
  const pct=v=>(v*100).toFixed(1)+'%';
  const fmt$=v=>'$'+Math.round(v).toLocaleString();
  const fmtM=v=>v>=1e6?'$'+(v/1e6).toFixed(2)+'M':v>=1e3?'$'+(v/1e3).toFixed(0)+'K':fmt$(v);

  // Brand colors
  const OLIVE='AEBC46', BG='1A1A1A', LTGREY='888888', WHITE='FFFFFF';

  // Slide master
  pptx.defineSlideMaster({
    title:'OLEADEV',
    background:{fill:BG},
    objects:[
      {rect:{x:0,y:0,w:'100%',h:0.15,fill:{color:OLIVE}}},
      {text:{text:'OLEADEV',options:{x:0.3,y:7.0,w:3,h:0.4,fontSize:8,color:LTGREY,fontFace:'Arial'}}},
      {text:{text:'Confidential',options:{x:10,y:7.0,w:3,h:0.4,fontSize:8,color:LTGREY,align:'right',fontFace:'Arial'}}},
    ]
  });

  function addSlide(titleText){
    const s=pptx.addSlide({masterName:'OLEADEV'});
    s.addText(titleText,{x:0.5,y:0.3,w:12,h:0.6,fontSize:22,bold:true,color:OLIVE,fontFace:'Arial'});
    return s;
  }
  function addTableToSlide(slide,headers,rows,opts={}){
    const tableRows=[headers.map(h=>({text:h,options:{bold:true,fontSize:9,color:OLIVE,fill:{color:'222222'}}}))];
    rows.forEach((row,ri)=>{
      tableRows.push(row.map(cell=>({text:String(cell),options:{fontSize:9,color:WHITE,fill:{color:ri%2===0?'1a1a1a':'222222'}}})));
    });
    slide.addTable(tableRows,{x:opts.x||0.5,y:opts.y||1.2,w:opts.w||12,colW:opts.colW,border:{pt:0.5,color:'333333'},fontFace:'Arial'});
  }

  // ── SLIDE 1: Title ──
  const s1=pptx.addSlide({masterName:'OLEADEV'});
  s1.addText('HIGHEST & BEST USE\nANALYSIS',{x:0.8,y:1.5,w:8,h:2.5,fontSize:40,bold:true,color:WHITE,fontFace:'Arial',lineSpacing:48});
  s1.addText(P.projectName||'Development Site',{x:0.8,y:4.0,w:8,h:0.5,fontSize:16,color:LTGREY,fontFace:'Arial'});
  s1.addText('April 2026',{x:0.8,y:4.6,w:4,h:0.4,fontSize:12,color:LTGREY,fontFace:'Arial'});
  s1.addShape(pptx.shapes.RECTANGLE,{x:0.8,y:5.2,w:4,h:0.06,fill:{color:OLIVE}});

  // ── SLIDE 2: Site Context ──
  const s2=addSlide('SITE CONTEXT & LOCATION');
  s2.addText([
    {text:'Lot Area: ',options:{fontSize:14,color:LTGREY}},{text:d.siteArea.toLocaleString()+' sf\n',options:{fontSize:14,bold:true,color:WHITE}},
    {text:'Zoning: ',options:{fontSize:14,color:LTGREY}},{text:'CR (Commercial Residential)\n',options:{fontSize:14,bold:true,color:WHITE}},
    {text:'Transit: ',options:{fontSize:14,color:LTGREY}},{text:'nearby transit infrastructure (at-grade)\n',options:{fontSize:14,bold:true,color:WHITE}},
    {text:'Frontages: ',options:{fontSize:14,color:LTGREY}},{text:(P.siteAddress||'Primary + Secondary').split(',')[0],options:{fontSize:14,bold:true,color:WHITE}},
  ],{x:0.5,y:1.2,w:6,h:3,fontFace:'Arial',lineSpacing:24});

  // ── SLIDE 3: Massing with 3D render ──
  const s3=addSlide('BUILDING MASSING');
  if(massingImg){s3.addImage({data:massingImg,x:6.5,y:0.8,w:6.5,h:6,sizing:{type:'contain',w:6.5,h:6}});}
  addTableToSlide(s3,['Volume','Storeys','Plate','Comm'],
    P.vols.map(v=>[v.name,v.storeys+'F',(v.customAreaSF||(v.width*v.depth)).toLocaleString()+' sf',v.commGF?'Yes':'No']),
    {y:1.2,w:6,colW:[1.5,1,2,1.5]});
  s3.addText([
    {text:'Total GFA: ',options:{color:LTGREY}},{text:d.totalGFA.toLocaleString()+' sf\n',options:{bold:true,color:WHITE}},
    {text:'FSI: ',options:{color:LTGREY}},{text:d.fsi.toFixed(2)+'×\n',options:{bold:true,color:WHITE}},
    {text:'Max Height: ',options:{color:LTGREY}},{text:Math.max(...P.vols.map(v=>v.storeys))+' storeys\n',options:{bold:true,color:WHITE}},
    {text:'Resi GFA: ',options:{color:LTGREY}},{text:d.resiGFA.toLocaleString()+' sf\n',options:{bold:true,color:WHITE}},
    {text:'Comm GFA: ',options:{color:LTGREY}},{text:d.commGFA.toLocaleString()+' sf',options:{bold:true,color:WHITE}},
  ],{x:0.5,y:4.0,w:6,h:3,fontSize:12,fontFace:'Arial',lineSpacing:20});

  // ── SLIDE 4: Unit Mix ──
  const s4=addSlide('UNIT MIX & PROGRAM');
  addTableToSlide(s4,['Unit Type','Avg Size','Count','Mix %','Total SF'],
    d.unitMix.map(u=>[u.type,u.size+' sf',u.count+'',pct(u.count/d.totalUnits),(u.count*u.size).toLocaleString()+' sf']),
    {y:1.2,colW:[3,2,1.5,1.5,4]});
  s4.addText('Total Units: '+d.totalUnits+'   |   Net Sellable: '+d.netResiSF.toLocaleString()+' sf   |   Efficiency: '+pct(d.netResiSF/d.resiGFA),
    {x:0.5,y:5.5,w:12,h:0.4,fontSize:11,color:OLIVE,bold:true,fontFace:'Arial'});

  // ── SLIDE 5: Pro Forma ──
  const s5=addSlide('PRO-FORMA SUMMARY');
  addTableToSlide(s5,['','Amount','$/sf GFA'],[
    ['Gross Revenue',fmtM(d.totalGrossRev),'$'+(d.totalGrossRev/d.totalGFA).toFixed(0)],
    ['Land',fmtM(d.totalLand),'$'+(d.totalLand/d.totalGFA).toFixed(0)],
    ['Hard Costs',fmtM(d.totalHard),'$'+(d.totalHard/d.totalGFA).toFixed(0)],
    ['Soft Costs (incl. DC)',fmtM(d.totalSoft),'$'+(d.totalSoft/d.totalGFA).toFixed(0)],
    ['Financing',fmtM(d.totalFinancing),'$'+(d.totalFinancing/d.totalGFA).toFixed(0)],
    ['TOTAL COST',fmtM(d.totalCost),'$'+(d.totalCost/d.totalGFA).toFixed(0)],
    ['PROFIT',fmtM(d.margin),pct(d.marginOnCost)],
  ],{y:1.2,colW:[5,3.5,3.5]});

  // ── SLIDE 6: DCF & IRR ──
  const s6=addSlide('DCF MODEL & RETURNS');
  const dcfR=calcDCF(d);
  addTableToSlide(s6,['Metric','Value'],[
    ['Project IRR (Unlevered)',pct(dcfR.irr)],
    ['NPV @ '+pct(P.pf.dcf.discountRate),fmtM(dcfR.npv)],
    ['Equity Multiple',dcfR.equityMultiple.toFixed(2)+'×'],
    ['Peak Equity',fmtM(dcfR.peakEquity)],
    ['Construction Duration',d.totalConstructionMonths+' months'],
    ['Absorption',d.absorptionMonths+' months'],
    ['Total Timeline',d.totalProjectMonths+' months'],
  ],{y:1.2,colW:[7,5]});

  // ── SLIDE 7: Monte Carlo ──
  const s7=addSlide('MONTE CARLO RISK ANALYSIS');
  s7.addText(mc.stats.iterations.toLocaleString()+' simulations',{x:0.5,y:0.7,w:5,h:0.3,fontSize:10,color:LTGREY,fontFace:'Arial'});
  addTableToSlide(s7,['','P10 (Bear)','Median','P90 (Bull)'],[
    ['IRR',pct(mc.stats.irrP10),pct(mc.stats.irrMedian),pct(mc.stats.irrP90)],
    ['Profit Margin',pct(mc.stats.marginP10),pct(mc.stats.marginMedian),pct(mc.stats.marginP90)],
  ],{y:1.2,colW:[4,2.5,2.5,3]});
  s7.addText('Probability of Viability (>15%): '+pct(mc.stats.probViable),{x:0.5,y:3.2,w:8,h:0.5,fontSize:16,bold:true,
    color:mc.stats.probViable>=0.6?'4CAF50':'E07B6A',fontFace:'Arial'});
  // Tornado top 5
  addTableToSlide(s7,['Rank','Risk Driver','Impact'],
    mc.tornado.slice(0,5).map((t,i)=>[(i+1)+'',t.name,'±'+pct(t.swing/2)]),
    {y:4.0,colW:[1,7,4]});

  // ── SLIDE 8: Sensitivity ──
  const s8=addSlide('SENSITIVITY — PROFIT MARGIN');
  const psfVals=[900,950,1000,1050,1100,1150];
  const hcVals=[280,310,340,370,400];
  const sensRows=psfVals.map(psf=>{
    return ['$'+psf+'/sf',...hcVals.map(hc=>{
      const rev=psf*d.netResiSF+d.totalCommValue+d.parkRev+d.lockerRev;
      const cost=d.totalLand+hc*d.totalGFA*1.35;
      return pct((rev-cost)/cost);
    })];
  });
  addTableToSlide(s8,['PSF ↓ / HC →',...hcVals.map(v=>'$'+v+'/sf')],sensRows,{y:1.2,colW:[2.5,...hcVals.map(()=>2)]});

  // ── SLIDE 9: Timeline ──
  const s9=addSlide('CONSTRUCTION PHASING & TIMELINE');
  const timeline=P.pf.dcf.phases;
  let cm=0;
  const phaseRows=timeline.map(ph=>{
    const start=cm;cm+=ph.months;
    return [ph.label,ph.months+' mo','Mo '+start+' → '+cm,pct(ph.costPct)];
  });
  phaseRows.push(['TOTAL',cm+' mo','','100%']);
  addTableToSlide(s9,['Phase','Duration','Period','Cost %'],phaseRows,{y:1.2,colW:[4,2,3.5,3.5]});

  // ── SLIDE 10: Thank You ──
  const s10=pptx.addSlide({masterName:'OLEADEV'});
  s10.addText('THANK YOU',{x:0,y:2,w:13.33,h:1.5,fontSize:44,bold:true,color:OLIVE,align:'center',fontFace:'Arial'});
  s10.addText('OleaDev Development Advisory\ninfo@oleadev.com',{x:0,y:4,w:13.33,h:1,fontSize:14,color:LTGREY,align:'center',fontFace:'Arial',lineSpacing:22});
  s10.addShape(pptx.shapes.RECTANGLE,{x:5.5,y:5.5,w:2.33,h:0.06,fill:{color:OLIVE}});

  await pptx.writeFile({fileName:'OleaDev_'+(P.projectName||'Project').replace(/[^a-zA-Z0-9]/g,'_')+'_Pitch_Deck.pptx'});
  }catch(err){alert('PPTX export error: '+err.message);console.error(err);}
}

// ═══════════════════════════════════════════════════════════
//  REPORT RENDERING
// ═══════════════════════════════════════════════════════════
function addComparable(){
  if(!P.comparables) P.comparables=[];
  P.comparables.push({addr:'',dev:'',storeys:0,units:0,fsi:'',status:'Under Review'});
  autoSave();renderReport();
}
function autoFillComparables(){
  const lat=P.siteCoords?P.siteCoords.lat:(P.lot.gpsVerts?P.lot.gpsVerts[0][1]:null);
  const lng=P.siteCoords?P.siteCoords.lng:(P.lot.gpsVerts?P.lot.gpsVerts[0][0]:null);
  if(!lat||!lng){alert('No site coordinates found. Draw a lot on the Site Map first.');return;}
  // Use the multi-source search
  fetchNearbyComparables(lat,lng,P.siteAddress);
  return;
}

/** Legacy: synchronous embedded-database lookup. Kept for offline fallback / reference. */
function _autoFillComparablesLegacy(lat, lng){
  const nearby=findNearbyComparables(lat,lng,3,10);
  if(nearby.length===0){
    alert('No developments found within 3km of your site (lat: '+lat.toFixed(4)+', lng: '+lng.toFixed(4)+'). The embedded database covers ~60 major Toronto projects. Try adding comparables manually from Urban Toronto.');
    return;
  }
  if(!P.comparables) P.comparables=[];
  // Don't duplicate — check existing addresses
  const existing=new Set(P.comparables.map(c=>(c.addr||'').toLowerCase().trim()));
  let added=0;
  nearby.forEach(c=>{
    const addr=(c.addr||'').toLowerCase().trim();
    if(existing.has(addr))return;
    P.comparables.push({
      addr:c.addr,
      dev:c.dev||'',
      storeys:c.storeys||0,
      units:c.units||0,
      fsi:c.gfaM2?((c.gfaM2*10.7639/Math.max(1,lotArea())).toFixed(1)+'×'):'',
      status:c.st||'Under Review'
    });
    existing.add(addr);
    added++;
  });
  autoSave();renderReport();
  alert('Added '+added+' comparable'+(added!==1?'s':'')+' from the embedded City of Toronto database ('+nearby.length+' found within 1.5km). You can edit, add, or remove entries in the table below.');
}
function updateReport(){renderReport();}
/** Renders the full Highest & Best Use report into #report-content. Reads P, pfCalc(), comparables. */
function renderReport(){
  const el=document.getElementById('report-content');
  if(!el)return;
  try{
  const d=pfData();
  const L=P.lot;
  const maxSt=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
  const lotA=Math.round(lotArea());
  const lotAm=Math.round(lotA*0.0929);
  const f2m_r=n=>(n*0.3048).toFixed(1);
  const umRows=d.unitMix.map(u=>{
    const p=d.totalUnits>0?Math.round(u.count/d.totalUnits*100):0;
    return `<tr><td>${u.type}</td><td>${u.size.toLocaleString()} sf</td><td>${u.count}</td><td>${p}%</td></tr>`;
  }).join('');

  // Dynamic volume descriptions
  const commVols=P.vols.filter(v=>v.commGF);
  const resiVols=P.vols.filter(v=>!v.commGF);
  const podiumVols=P.vols.filter(v=>v.storeys<=5);
  const towerVols=P.vols.filter(v=>v.storeys>5);
  const maxTowerSt=towerVols.length>0?Math.max(...towerVols.map(v=>v.storeys)):0;
  const podiumSt=podiumVols.length>0?Math.max(...podiumVols.map(v=>v.storeys)):0;
  const totalDepthFt=Math.max(L.upperLeft+L.lowerLeft, L.upperRight+L.lowerRight);
  const maxBldgHt=((commVols.length>0?P.flr.gf:P.flr.typ)+(maxSt-1)*P.flr.typ)*FT;

  // Per-volume table rows
  const volRows=P.vols.map(v=>{
    const fp=v.customAreaSF||(v.width||0)*(v.depth||0);
    const gfH=v.commGF?P.flr.gf:P.flr.typ;
    const ht=((gfH+(v.storeys-1)*P.flr.typ)*FT).toFixed(1);
    const dims=v.customAreaSF?'Custom poly':'('+((v.width||0))+"' × "+((v.depth||0))+"')";
    return `<tr><td style="color:${v.color||'#888'};font-weight:600">${v.name||'Vol'}</td><td>${v.storeys||0}</td><td>${dims}</td><td>${fp.toLocaleString()} sf</td><td>${ht}m</td><td>${v.commGF?'Yes':'No'}</td></tr>`;
  }).join('');

  // ── AI narrative injection helper ──
  const aiN = P._aiNarratives || {};
  const hasAI = !!aiN.executive_summary;

  // ── AI section helpers ──
  // All AI-derived sections get a small "✨ AI" badge so the reader knows they're
  // AI-generated. Sections are SKIPPED entirely if the corresponding AI tool
  // hasn't been run yet (clean report — no placeholders).
  const _esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const _aiBadge = '<span class="pf-live-badge" style="background:#1a3a1a;color:#4a8;border:1px solid #4a8;margin-left:8px">✨ AI</span>';

  // Renders the AI Zoning Compliance section as HTML (returns '' if not run)
  function _renderAiZoningHTML(){
    const az = P._aiZoning;
    if(!az || az.raw) return '';
    const statusColor = az.compliance_status === 'compliant' ? '#4a8'
      : az.compliance_status === 'minor_variance_needed' ? '#e8c87a' : '#c44';
    const statusLabel = (az.compliance_status || 'unknown').replace(/_/g,' ').toUpperCase();
    let h = `<div class="rpt-page"><div class="rpt-h1">AI ZONING COMPLIANCE ANALYSIS${_aiBadge}</div>`;
    h += `<div class="rpt-p"><b style="color:${statusColor}">Status: ${_esc(statusLabel)}</b>${az.confidence?' &middot; Confidence '+Math.round(az.confidence*100)+'%':''}</div>`;
    if(az.summary) h += `<div class="rpt-p">${_esc(az.summary)}</div>`;
    if(az.permitted_envelope){
      const pe = az.permitted_envelope;
      h += `<div class="rpt-h2">As-of-Right Permitted Envelope</div><table class="rpt-table">`;
      if(pe.max_fsi != null)     h += `<tr><td>Maximum FSI</td><td><b>${_esc(pe.max_fsi)}×</b></td></tr>`;
      if(pe.max_height_m != null)h += `<tr><td>Maximum Height</td><td><b>${_esc(pe.max_height_m)} m</b></td></tr>`;
      if(pe.max_storeys != null) h += `<tr><td>Maximum Storeys</td><td><b>${_esc(pe.max_storeys)}</b></td></tr>`;
      h += `</table>`;
      if(pe.notes) h += `<div class="rpt-p" style="font-size:13px;color:#888">${_esc(pe.notes)}</div>`;
    }
    if(az.issues && az.issues.length){
      h += `<div class="rpt-h2">Compliance Issues (${az.issues.length})</div>`;
      az.issues.forEach(iss => {
        const sevColor = iss.severity === 'critical' ? '#c44' : iss.severity === 'moderate' ? '#e8c87a' : '#888';
        h += `<div class="rpt-p" style="border-left:3px solid ${sevColor};padding-left:10px;margin-bottom:8px">
          <b style="color:${sevColor}">${_esc(iss.parameter || 'Issue')} &mdash; ${_esc((iss.severity||'note').toUpperCase())}</b><br>
          <span style="color:#aaa">Proposed: ${_esc(iss.proposed_value||'N/A')} &middot; Permitted: ${_esc(iss.permitted_value||'N/A')}</span><br>
          ${iss.bylaw_reference?'<span style="color:#777;font-size:13px">By-law: '+_esc(iss.bylaw_reference)+'</span><br>':''}
          ${iss.resolution_path?'<span>Resolution: '+_esc(iss.resolution_path)+'</span>':''}
        </div>`;
      });
    }
    if(az.opportunities && az.opportunities.length){
      h += `<div class="rpt-h2">Opportunities Identified</div>`;
      az.opportunities.forEach(o => h += `<div class="rpt-p" style="color:#4a8">+ ${_esc(o)}</div>`);
    }
    if(az.recommendations && az.recommendations.length){
      h += `<div class="rpt-h2">Recommendations</div>`;
      az.recommendations.forEach((r,i) => h += `<div class="rpt-p">${i+1}. ${_esc(r)}</div>`);
    }
    h += `</div>`;
    return h;
  }

  // Renders the AI Pro-Forma Optimization section as HTML
  function _renderAiProformaHTML(){
    const ap = P._aiProforma;
    if(!ap || ap.raw) return '';
    const overall = ap.assessment && ap.assessment.overall || 'unknown';
    const oColor = overall === 'strong' ? '#4a8' : overall === 'viable' ? '#AEBC46'
      : overall === 'marginal' ? '#e8c87a' : '#c44';
    let h = `<div class="rpt-page"><div class="rpt-h1">AI PRO-FORMA OPTIMIZATION${_aiBadge}</div>`;
    h += `<div class="rpt-p"><b style="color:${oColor}">Assessment: ${_esc(overall.toUpperCase())}</b>`;
    if(ap.assessment && ap.assessment.risk_level) h += ` &middot; Risk: ${_esc(ap.assessment.risk_level)}`;
    if(ap.confidence) h += ` &middot; Confidence ${Math.round(ap.confidence*100)}%`;
    h += `</div>`;
    if(ap.assessment && ap.assessment.summary) h += `<div class="rpt-p">${_esc(ap.assessment.summary)}</div>`;
    if(ap.assessment && ap.assessment.margin_assessment) h += `<div class="rpt-p" style="color:#aaa;font-size:11px">${_esc(ap.assessment.margin_assessment)}</div>`;
    if(ap.benchmarks){
      h += `<div class="rpt-h2">Market Benchmarks</div><table class="rpt-table"><tr><th>Metric</th><th>Project</th><th>Market Range</th></tr>`;
      ['cost_per_sf','revenue_per_sf','margin_pct'].forEach(k => {
        const b = ap.benchmarks[k];
        if(!b) return;
        const label = k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
        const isPct = k.includes('pct');
        const inRange = b.project >= b.market_low && b.project <= b.market_high;
        h += `<tr><td>${label}</td><td><b style="color:${inRange?'#4a8':'#e8c87a'}">${isPct?b.project+'%':'$'+b.project}</b></td><td>${isPct?b.market_low+'&ndash;'+b.market_high+'%':'$'+b.market_low+'&ndash;$'+b.market_high}</td></tr>`;
      });
      h += `</table>`;
    }
    if(ap.actionable_suggestions && ap.actionable_suggestions.length){
      h += `<div class="rpt-h2">Actionable Suggestions (${ap.actionable_suggestions.length})</div>`;
      ap.actionable_suggestions.forEach(s => {
        h += `<div class="rpt-p" style="border-left:3px solid #AEBC46;padding-left:10px;margin-bottom:8px">
          <b>${_esc(s.label||s.field||'Change')}</b><br>
          <span style="color:#aaa">${_esc(s.field||'')}: <span style="color:#c44;text-decoration:line-through">${_esc(s.current_value)}</span> &rarr; <span style="color:#4a8;font-weight:700">${_esc(s.suggested_value)}</span></span><br>
          ${s.rationale?'<span style="font-size:11px">'+_esc(s.rationale)+'</span><br>':''}
          ${s.impact?'<span style="color:#4a8;font-size:11px">Impact: '+_esc(s.impact)+'</span>':''}
        </div>`;
      });
    }
    if(ap.unit_mix_recommendations && ap.unit_mix_recommendations.length){
      h += `<div class="rpt-h2">Unit Mix Analysis</div>`;
      ap.unit_mix_recommendations.forEach(r => {
        h += `<div class="rpt-p"><span style="color:#888">Current: ${_esc(r.current)}</span> &rarr; <b style="color:#AEBC46">${_esc(r.recommended)}</b><br><span style="font-size:11px;color:#aaa">${_esc(r.rationale)}</span>${r.revenue_impact_estimate?'<br><span style="color:#4a8;font-size:11px">Impact: '+_esc(r.revenue_impact_estimate)+'</span>':''}</div>`;
      });
    }
    if(ap.cost_flags && ap.cost_flags.length){
      h += `<div class="rpt-h2">Cost Flags</div>`;
      ap.cost_flags.forEach(f => {
        h += `<div class="rpt-p" style="color:#e8c87a">&#9888; <b>${_esc(f.line_item)}</b>: ${_esc(f.current_value)} (market: ${_esc(f.market_range)}) &mdash; ${_esc(f.risk)}</div>`;
      });
    }
    if(ap.top_sensitivities && ap.top_sensitivities.length){
      h += `<div class="rpt-h2">Key Sensitivities</div>`;
      ap.top_sensitivities.forEach((s,i) => {
        h += `<div class="rpt-p">${i+1}. <b>${_esc(s.input)}</b> (${_esc(s.current_value)}) &rarr; ${_esc(s.impact)}</div>`;
      });
    }
    h += `</div>`;
    return h;
  }

  // Renders the AI Risk Assessment section as HTML
  function _renderAiRiskHTML(){
    const ar = P._aiRisk;
    if(!ar || ar.raw) return '';
    const rColor = ar.risk_rating === 'low' ? '#4a8' : ar.risk_rating === 'moderate' ? '#e8c87a'
      : ar.risk_rating === 'elevated' ? '#f96' : '#c44';
    let h = `<div class="rpt-page"><div class="rpt-h1">AI RISK ASSESSMENT${_aiBadge}</div>`;
    h += `<div class="rpt-p"><b style="color:${rColor}">Risk Rating: ${_esc((ar.risk_rating||'unknown').toUpperCase())}</b>${ar.confidence?' &middot; Confidence '+Math.round(ar.confidence*100)+'%':''}</div>`;
    if(ar.summary) h += `<div class="rpt-p">${_esc(ar.summary)}</div>`;
    if(ar.scenario_analysis){
      h += `<div class="rpt-h2">Scenario Analysis</div><table class="rpt-table"><tr><th>Scenario</th><th>Margin</th><th>Probability</th><th>Description</th></tr>`;
      ['best_case','base_case','worst_case'].forEach(k => {
        const s = ar.scenario_analysis[k];
        if(!s) return;
        const c = k === 'best_case' ? '#4a8' : k === 'base_case' ? '#AEBC46' : '#c44';
        h += `<tr><td><b style="color:${c}">${k.replace(/_/g,' ').toUpperCase()}</b></td><td><b style="color:${c}">${_esc(s.margin)}</b></td><td>${_esc(s.probability)}</td><td>${_esc(s.description)}</td></tr>`;
      });
      h += `</table>`;
    }
    if(ar.break_even_thresholds && ar.break_even_thresholds.length){
      h += `<div class="rpt-h2">Break-Even Thresholds</div><table class="rpt-table"><tr><th>Input</th><th>Current</th><th>Break-Even</th><th>Headroom</th></tr>`;
      ar.break_even_thresholds.forEach(t => {
        h += `<tr><td>${_esc(t.input)}</td><td>${_esc(t.current)}</td><td>${_esc(t.break_even)}</td><td>${_esc(t.headroom)}</td></tr>`;
      });
      h += `</table>`;
    }
    if(ar.stress_tests && ar.stress_tests.length){
      h += `<div class="rpt-h2">Stress Tests</div>`;
      ar.stress_tests.forEach(t => {
        const tc = t.severity === 'critical' ? '#c44' : t.severity === 'concerning' ? '#e8c87a' : '#4a8';
        h += `<div class="rpt-p" style="border-left:3px solid ${tc};padding-left:10px;margin-bottom:8px">
          <b style="color:${tc}">${_esc(t.scenario)}</b><br>
          <span style="font-size:11px;color:#aaa">${_esc(t.assumptions)}</span><br>
          <span>&rarr; ${_esc(t.outcome)}</span>
        </div>`;
      });
    }
    if(ar.mitigation_strategies && ar.mitigation_strategies.length){
      h += `<div class="rpt-h2">Mitigation Strategies</div>`;
      ar.mitigation_strategies.forEach((m,i) => {
        h += `<div class="rpt-p">${i+1}. <b>${_esc(m.strategy)}</b> &mdash; ${_esc(m.impact)} <span style="color:#888">(${_esc(m.implementation)})</span></div>`;
      });
    }
    h += `</div>`;
    return h;
  }

  // Renders the AI Comparable Insights section as HTML
  function _renderAiCompsHTML(){
    const ac = P._aiComps;
    if(!ac || ac.raw) return '';
    const pColor = ac.competitive_position === 'under-supplied' ? '#4a8'
      : ac.competitive_position === 'balanced' ? '#AEBC46'
      : ac.competitive_position === 'competitive' ? '#e8c87a' : '#c44';
    let h = `<div class="rpt-page"><div class="rpt-h1">AI COMPARABLE INSIGHTS${_aiBadge}</div>`;
    h += `<div class="rpt-p"><b style="color:${pColor}">Market Position: ${_esc((ac.competitive_position||'unknown').replace(/_/g,' ').toUpperCase())}</b>${ac.confidence?' &middot; Confidence '+Math.round(ac.confidence*100)+'%':''}</div>`;
    if(ac.summary) h += `<div class="rpt-p">${_esc(ac.summary)}</div>`;
    if(ac.pricing_assessment){
      const pa = ac.pricing_assessment;
      const paColor = pa.assessment === 'conservative' ? '#4a8' : pa.assessment === 'market' ? '#AEBC46' : '#c44';
      h += `<div class="rpt-h2">Pricing Assessment</div>
        <div class="rpt-p">Subject pricing: <b style="color:${paColor}">$${_esc(pa.subject_psf)}/SF</b> &middot; Comparable range: $${_esc(pa.comp_range_psf&&pa.comp_range_psf.low)} &ndash; $${_esc(pa.comp_range_psf&&pa.comp_range_psf.high)}/SF
        &middot; <b style="color:${paColor}">${_esc((pa.assessment||'').toUpperCase())}</b></div>
        ${pa.recommendation?'<div class="rpt-p" style="color:#aaa">'+_esc(pa.recommendation)+'</div>':''}`;
    }
    if(ac.absorption_analysis){
      const ab = ac.absorption_analysis;
      h += `<div class="rpt-h2">Absorption Analysis</div><table class="rpt-table">`;
      if(ab.pipeline_units_1km != null) h += `<tr><td>Pipeline (1km)</td><td>${_esc(ab.pipeline_units_1km)} units</td></tr>`;
      if(ab.estimated_annual_absorption != null) h += `<tr><td>Est. Annual Absorption</td><td>${_esc(ab.estimated_annual_absorption)}</td></tr>`;
      if(ab.months_of_inventory != null) h += `<tr><td>Months of Inventory</td><td>${_esc(ab.months_of_inventory)}</td></tr>`;
      if(ab.risk) h += `<tr><td>Risk</td><td><b>${_esc(ab.risk.toUpperCase())}</b></td></tr>`;
      h += `</table>`;
      if(ab.commentary) h += `<div class="rpt-p" style="color:#aaa">${_esc(ab.commentary)}</div>`;
    }
    if(ac.differentiation_opportunities && ac.differentiation_opportunities.length){
      h += `<div class="rpt-h2">Differentiation Opportunities</div>`;
      ac.differentiation_opportunities.forEach(o => {
        h += `<div class="rpt-p" style="border-left:3px solid #AEBC46;padding-left:10px;margin-bottom:8px">
          <b style="color:#AEBC46">${_esc(o.strategy)}</b><br>
          <span style="font-size:11px">${_esc(o.rationale)}</span><br>
          ${o.comparable_gap?'<span style="font-size:13px;color:#888">Gap: '+_esc(o.comparable_gap)+'</span>':''}
        </div>`;
      });
    }
    if(ac.timing_recommendation){
      h += `<div class="rpt-h2">Timing Recommendation</div>
        <div class="rpt-p"><b style="color:#AEBC46">${_esc(ac.timing_recommendation.optimal_launch)}</b></div>
        ${ac.timing_recommendation.rationale?'<div class="rpt-p" style="color:#aaa;font-size:11px">'+_esc(ac.timing_recommendation.rationale)+'</div>':''}`;
    }
    h += `</div>`;
    return h;
  }

  el.innerHTML=`
    <div class="rpt-page">
      <div class="rpt-h1">EXECUTIVE SUMMARY ${hasAI?'<span class="pf-live-badge" style="background:#4a8">AI-ENHANCED</span>':''}</div>
      ${hasAI ? aiN.executive_summary : `
      <div class="rpt-p">This report presents a highest and best use analysis for the subject property located at <b>${P.siteAddress||P.projectName||'the development site'}</b>. The site encompasses approximately ${Math.round(lotArea()).toLocaleString()} square feet and is situated within the City of Toronto, where the Official Plan and applicable planning frameworks support intensification and transit-oriented development.</div>
      <div class="rpt-p">The analysis concludes that a <b style="color:#AEBC46">${maxSt}-storey</b> mixed-use building composed of <b style="color:#AEBC46">${P.vols.length} building volumes</b> represents the highest and best use of the site. The current massing yields approximately <b style="color:#AEBC46">${d.totalUnits} residential units</b>, <b style="color:#AEBC46">${Math.round(d.commGFA).toLocaleString()} sq ft</b> of ground-floor commercial, and a total GFA of <b style="color:#AEBC46">${Math.round(d.totalGFA).toLocaleString()} sq ft</b> at a floor space index of <b style="color:#AEBC46">${d.fsi.toFixed(1)}x</b>.</div>
      ${podiumVols.length>0&&towerVols.length>0?`<div class="rpt-p">The building incorporates a <b>${podiumSt}-storey podium</b> (${podiumVols.length} volume${podiumVols.length>1?'s':''}) with ${commVols.length>0?'ground-floor commercial and ':''}upper residential, plus <b>${towerVols.length} tower volume${towerVols.length>1?'s':''}</b> rising to ${maxTowerSt} storeys (${maxBldgHt.toFixed(1)}m).</div>`:''}
      <div class="rpt-p"><b style="color:#AEBC46">Key Finding:</b> Based on the site's location${P.siteAddress?(' at '+P.siteAddress.split(',')[0]):''}, lot configuration, and surrounding development context, this property presents a strong development opportunity for a mixed-use residential project.</div>
      `}
      ${!hasAI?'<div style="margin-top:8px"><button class="sec3d-btn" onclick="switchTab(\'ai\')">✨ Generate AI-Enhanced Narratives</button></div>':''}
    </div>
    <div class="rpt-page">
      <div class="rpt-h1">SITE ANALYSIS</div>
      <div class="rpt-h2">Location & Context</div>
      <div class="rpt-p">The subject property is located at <b>${P.projectName||'the development site'}</b>${P.siteAddress?', '+P.siteAddress:''}. ${P.siteCoords?'Site coordinates: '+P.siteCoords.lat.toFixed(5)+', '+P.siteCoords.lng.toFixed(5)+'.':''}</div>
      <div class="rpt-h2" style="margin-top:16px">Comparable Developments <span class="pf-live-badge">EDITABLE</span></div>
      <div style="margin-bottom:10px;display:flex;gap:8px;flex-wrap:wrap">
        <button onclick="window.open(P.siteCoords?'https://urbantoronto.ca/map?lat='+P.siteCoords.lat+'&lng='+P.siteCoords.lng:'https://urbantoronto.ca/map','_blank')" style="background:#4ecdc4;color:#111;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:11px">🗺️ Open Urban Toronto Map</button>
        <button onclick="window.open('https://www.toronto.ca/city-government/planning-development/application-information-centre/','_blank')" style="background:#88aabb;color:#111;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:11px">🏗️ City of Toronto Dev Apps</button>
        <button onclick="window.open('https://secure.toronto.ca/ApplicationStatus/setup.do?action=init','_blank')" style="background:#7799bb;color:#fff;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:11px">📋 Building Permit Status</button>
        <button onclick="autoFillComparables()" style="background:#e8c87a;color:#111;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:11px">⚡ Auto-Fill from Database</button>
        <button onclick="addComparable()" style="background:#AEBC46;color:#111;border:none;border-radius:4px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:11px">+ Add Manually</button>
      </div>
      <div class="rpt-p" style="font-size:13px;color:#888;margin-bottom:8px">Add comparable developments from Urban Toronto or the City of Toronto portal. These will appear in the PDF report with FSI analysis.</div>
      <table class="rpt-table" style="font-size:11px;table-layout:fixed;width:100%">
        <colgroup><col style="width:25%"><col style="width:18%"><col style="width:10%"><col style="width:10%"><col style="width:8%"><col style="width:16%"><col style="width:5%"></colgroup>
        <tr><th>Address</th><th>Developer</th><th style="text-align:center">Storeys</th><th style="text-align:center">Units</th><th style="text-align:center">FSI</th><th>Status</th><th></th></tr>
        ${(()=>{
          const cs=P.comparables||[];
          if(cs.length===0) return '<tr><td colspan="7" style="text-align:center;color:#555;padding:12px;font-style:italic">No comparables added yet. Click &quot;Open Urban Toronto Map&quot; to research nearby developments, then add them here.</td></tr>';
          const esc=s=>(s||'').replace(/"/g,'&quot;');
          const ist='background:#1a1a1a;color:#eee;border:1px solid #333;padding:4px 6px;font-size:11px;border-radius:3px;-moz-appearance:textfield;appearance:textfield';
          return cs.map((c,i)=>{
            const sts=['Under Review','Approved','OLT Appeal','Built','Under Construction','Pre-Construction','NOAC Issued','SPA Filed'];
            const opts=sts.map(s=>'<option value="'+s+'"'+(c.status===s?' selected':'')+'>'+s+'</option>').join('');
            return '<tr>'
              +'<td><input value="'+esc(c.addr)+'" onchange="P.comparables['+i+'].addr=this.value;autoSave();updateReport()" style="'+ist+';width:100%"></td>'
              +'<td><input value="'+esc(c.dev)+'" onchange="P.comparables['+i+'].dev=this.value;autoSave();updateReport()" style="'+ist+';width:100%"></td>'
              +'<td style="text-align:center"><input type="number" value="'+(c.storeys||'')+'" onchange="P.comparables['+i+'].storeys=parseInt(this.value)||0;autoSave();updateReport()" style="'+ist+';width:100%;text-align:center"></td>'
              +'<td style="text-align:center"><input type="number" value="'+(c.units||'')+'" onchange="P.comparables['+i+'].units=parseInt(this.value)||0;autoSave();updateReport()" style="'+ist+';width:100%;text-align:center"></td>'
              +'<td style="text-align:center"><input value="'+esc(c.fsi)+'" onchange="P.comparables['+i+'].fsi=this.value;autoSave();updateReport()" style="'+ist+';width:100%;text-align:center"></td>'
              +'<td><select onchange="P.comparables['+i+'].status=this.value;autoSave();updateReport()" style="'+ist+';width:100%">'+opts+'</select></td>'
              +'<td style="text-align:center"><button onclick="if(confirm(\'Delete this comparable?\')){P.comparables.splice('+i+',1);autoSave();updateReport()}" style="background:#c44;color:#fff;border:none;border-radius:3px;padding:3px 8px;cursor:pointer;font-size:11px;font-weight:700">\u2715</button></td>'
              +'</tr>';
          }).join('');
        })()}
      </table>
      <div class="rpt-h2">Lot Dimensions <span class="pf-live-badge">LIVE</span></div>
      <table class="rpt-table">
        <tr><th>Edge</th><th>Feet</th><th>Metres</th></tr>
        ${(()=>{
          const vts=lotVerts();
          if(!vts||vts.length<3) return '<tr><td colspan="3" style="color:#555">No lot polygon defined</td></tr>';
          return vts.map((v,i)=>{
            const n=vts[(i+1)%vts.length];
            const len=Math.round(Math.sqrt((n[0]-v[0])**2+(n[1]-v[1])**2));
            return '<tr><td>Edge '+String.fromCharCode(65+i)+'</td><td>'+len+"'</td><td>"+(len*0.3048).toFixed(1)+'m</td></tr>';
          }).join('');
        })()}
      </table>
      <div class="rpt-p">Total Estimated Lot Area: <b style="color:#AEBC46">${lotA.toLocaleString()} sq ft</b> (${lotAm.toLocaleString()} sq m / ${(lotA/43560).toFixed(2)} acres).</div>
    </div>
    <div class="rpt-page">
      <div class="rpt-h1">ZONING FRAMEWORK</div>
      ${P.zoning&&P.zoning.zone?`<div class="rpt-h2">${P.zoning.zone} Zone</div>
      <div class="rpt-p">The subject property is zoned ${P.zoning.zone} as detected from the site geocoordinates.</div>`:
      `<div class="rpt-p">Zoning data will populate when a site address is set and zoning is detected.</div>`}
      <div class="rpt-h2">Zoning Analysis <span class="pf-live-badge">AUTO-DETECTED</span></div>
      ${P.zoning&&P.zoning.zone?`
        <table class="rpt-table" style="table-layout:fixed">
          <colgroup><col style="width:40%"><col style="width:60%"></colgroup>
          <tr><th>Parameter</th><th style="text-align:right">Value</th></tr>
          <tr><td>Zone Designation</td><td style="text-align:right"><b style="color:#AEBC46">${P.zoning.zoneString||P.zoning.zone}</b></td></tr>
          <tr><td>Permitted Uses</td><td style="text-align:right">${P.zoning.permitted?P.zoning.permitted.join(', '):'—'}</td></tr>
          <tr><td>Max Total FSI</td><td style="text-align:right"><b>${P.zoning.fsiLimit?P.zoning.fsiLimit+'×':'Site-specific / See Exception'}</b></td></tr>
          ${P.zoning.fsiResi?'<tr><td style="padding-left:16px;color:#888">Residential FSI</td><td style="text-align:right">'+P.zoning.fsiResi+'×</td></tr>':''}
          ${P.zoning.fsiComm?'<tr><td style="padding-left:16px;color:#888">Commercial FSI</td><td style="text-align:right">'+P.zoning.fsiComm+'×</td></tr>':''}
          ${P.zoning.fsiEmploy?'<tr><td style="padding-left:16px;color:#888">Employment FSI</td><td style="text-align:right">'+P.zoning.fsiEmploy+'×</td></tr>':''}
          <tr><td>Height Overlay</td><td style="text-align:right"><b>${P.zoning.heightLimit?P.zoning.heightLimit+'m':'No height overlay'}</b></td></tr>
          <tr><td>Lot Coverage</td><td style="text-align:right">${P.zoning.coverage?(P.zoning.coverage*100).toFixed(0)+'%':'No coverage overlay'}</td></tr>
          ${P.zoning.exception?'<tr><td>Exception</td><td style="text-align:right"><b style="color:#e8c87a">#'+P.zoning.exceptionNo+'</b> ('+P.zoning.bylawException+')</td></tr>':''}
          ${P.zoning.bylawSection?'<tr><td>By-law Section</td><td style="text-align:right">'+P.zoning.bylawSection+'</td></tr>':''}
        </table>
        <div class="rpt-p" style="color:#888;font-size:12px">Zoning data auto-detected from City of Toronto ArcGIS REST API (By-law 569-2013). Always verify with the City's interactive zoning map at map.toronto.ca.</div>
      `:'<div class="rpt-p" style="color:#888">Zoning data not yet loaded. Draw a lot on the Site Map to auto-detect zoning.</div>'}
    </div>
    ${_renderAiZoningHTML()}
    <div class="rpt-page">
      <div class="rpt-h1">BUILDING MASSING <span class="pf-live-badge">LIVE</span></div>
      <div class="rpt-h2">Volume Breakdown</div>
      <table class="rpt-table">
        <tr><th>Volume</th><th>Storeys</th><th>Floor Plate</th><th>Area/Floor</th><th>Height</th><th>Comm. GF</th></tr>
        ${volRows}
      </table>
      <div class="rpt-h2">Development Statistics</div>
      <table class="rpt-table">
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Site Area</td><td><b>${lotA.toLocaleString()} sq ft</b> (${lotAm.toLocaleString()} sq m)</td></tr>
        <tr><td>Total GFA</td><td><b>${Math.round(d.totalGFA).toLocaleString()} sq ft</b> (${Math.round(d.totalGFA*0.0929).toLocaleString()} sq m)</td></tr>
        <tr><td>Floor Space Index (FSI)</td><td><b>${d.fsi.toFixed(1)}x</b></td></tr>
        <tr><td>Maximum Building Height</td><td><b>${maxSt} storeys (${maxBldgHt.toFixed(1)}m)</b></td></tr>
        <tr><td>Ground Floor Commercial</td><td><b>${Math.round(d.commGFA).toLocaleString()} sq ft</b></td></tr>
        <tr><td>Residential GFA</td><td><b>${Math.round(d.resiGFA).toLocaleString()} sq ft</b></td></tr>
        <tr><td>Total Residential Units</td><td><b>${d.totalUnits}</b></td></tr>
        <tr><td>Parking Spaces (est.)</td><td><b>${d.parkSpaces}</b> (${P.pf.parkRatio}/unit)</td></tr>
      </table>
    </div>
    <div class="rpt-page">
      <div class="rpt-h1">RESIDENTIAL PROGRAM <span class="pf-live-badge">LIVE</span></div>
      <div class="rpt-h2">Unit Mix</div>
      <table class="rpt-table">
        <tr><th>Type</th><th>Avg Size</th><th>Count</th><th>%</th></tr>
        ${umRows}
        <tr style="border-top:2px solid #AEBC46"><td><b>Total</b></td><td><b>${d.totalUnits>0?Math.round(d.netResiSF/d.totalUnits):0} sf avg</b></td><td><b>${d.totalUnits}</b></td><td><b>100%</b></td></tr>
      </table>
      <div class="rpt-h2">Parking & Servicing</div>
      <div class="rpt-p">${d.parkSpaces} parking spaces at ${P.pf.parkRatio} spaces/unit ratio. Loading via single the secondary street access (1 Type G + 1 Type C).</div>
    </div>
    <div class="rpt-page">
      <div class="rpt-h1">FINANCIAL ANALYSIS <span class="pf-live-badge">LIVE</span></div>
      <div class="rpt-h2">Revenue</div>
      <table class="rpt-table" style="table-layout:fixed">
        <colgroup><col style="width:70%"><col style="width:30%"></colgroup>
        <tr><th>Component</th><th style="text-align:right">Value</th></tr>
        <tr><td>Residential Revenue (${d.totalUnits} units)</td><td style="text-align:right"><b>${fmtM(d.resiRevenue)}</b></td></tr>
        <tr><td>Commercial Value (${Math.round(d.commGFA).toLocaleString()} sf)</td><td style="text-align:right"><b>${fmtM(d.totalCommValue)}</b></td></tr>
        <tr><td>Parking (${d.parkSpaces} spaces × $${(P.pf.parkPrice||0).toLocaleString()})</td><td style="text-align:right"><b>${fmtM(d.parkRev)}</b></td></tr>
        <tr><td>Lockers</td><td style="text-align:right"><b>${fmtM(d.lockerRev)}</b></td></tr>
        <tr style="border-top:2px solid #AEBC46"><td><b>Total Gross Revenue</b></td><td style="text-align:right"><b style="color:#AEBC46">${fmtM(d.totalGrossRev)}</b></td></tr>
      </table>
      <div class="rpt-h2">Costs</div>
      <table class="rpt-table" style="table-layout:fixed">
        <colgroup><col style="width:70%"><col style="width:30%"></colgroup>
        <tr><th>Component</th><th style="text-align:right">Value</th></tr>
        <tr><td>Land Acquisition</td><td style="text-align:right">${fmtM(d.totalLand)}</td></tr>
        <tr><td>Hard Construction</td><td style="text-align:right">${fmtM(d.totalHard)}</td></tr>
        <tr><td>Soft Costs</td><td style="text-align:right">${fmtM(d.totalSoft)}</td></tr>
        <tr><td>Financing</td><td style="text-align:right">${fmtM(d.totalFinancing)}</td></tr>
        <tr style="border-top:2px solid #AEBC46"><td><b>Total Development Cost</b></td><td style="text-align:right"><b>${fmtM(d.totalCost)}</b></td></tr>
      </table>
      ${d.planningFees ? `
      <div class="rpt-h2" style="margin-top:14px">Pre-Development &amp; Approvals — ${({spa:'As-of-Right (SPA)',mv:'Minor Variance',zba:'ZBLA Rezoning',opa_zba:'OPA + ZBLA Rezoning'})[d.approvalRoute]||d.approvalRoute}</div>
      <div class="rpt-p" style="font-size:13px;color:#888">Application fees per official <a href="https://www.toronto.ca/city-government/planning-development/application-forms-fees/fees/" target="_blank" style="color:#AEBC46">City of Toronto 2026 User Fee Schedule</a> (Appendix A · UR/BL codes shown per line). Building permit per Toronto Building Group C Multi-Unit Residential rates (BL010/BL011).${d.asOfRightFSI?' Project FSI '+d.fsi.toFixed(2)+'× vs as-of-right '+d.asOfRightFSI.toFixed(1)+'×.':''} <i>Approval route may be manually overridden when zoning constraints (use, height, density, parking) require an application beyond what FSI alone would suggest. Consultant studies (Phase 1 ESA, geotech, planning rationale, etc.) are captured under Land Acquisition / Due Diligence above.</i></div>
      <table class="rpt-table" style="table-layout:fixed;font-size:11px">
        <colgroup><col style="width:55%"><col style="width:25%"><col style="width:20%"></colgroup>
        <tr><th>Application</th><th>Section</th><th style="text-align:right">Fee</th></tr>
        ${d.planningFees.applications.map(a=>`<tr><td>${a.label}</td><td style="color:#888">${a.section||''}</td><td style="text-align:right">${fmt$(a.fee)}</td></tr>`).join('')}
        <tr style="border-top:2px solid #AEBC46"><td><b>Total Pre-Development (City Application Fees)</b></td><td></td><td style="text-align:right"><b style="color:#AEBC46">${fmt$(d.planningFees.total)}</b></td></tr>
      </table>` : ''}
      <div class="rpt-h2">Returns</div>
      <table class="rpt-table" style="table-layout:fixed">
        <colgroup><col style="width:70%"><col style="width:30%"></colgroup>
        <tr><td><b>Developer Margin</b></td><td style="text-align:right"><b style="color:${d.margin>=0?'#4a8':'#c44'}">${fmtM(d.margin)}</b></td></tr>
        <tr><td><b>Profit Margin</b></td><td style="text-align:right"><b style="color:${d.marginOnCost>=0.15?'#4a8':'#c44'}">${pct(d.marginOnCost)}</b></td></tr>
        <tr><td><b>Margin on Revenue</b></td><td style="text-align:right"><b>${d.totalGrossRev>0?pct(d.margin/d.totalGrossRev):'--'}</b></td></tr>
        <tr><td><b>Cost per Buildable SF</b></td><td style="text-align:right"><b>$${d.totalGFA>0?Math.round(d.totalCost/d.totalGFA):0}/sf</b></td></tr>
        <tr><td><b>Revenue per Buildable SF</b></td><td style="text-align:right"><b>$${d.totalGFA>0?Math.round(d.totalGrossRev/d.totalGFA):0}/sf</b></td></tr>
      </table>
      <div class="rpt-p" style="margin-top:8px;color:${d.marginOnCost>=0.15?'#4a8':'#c44'};font-weight:600">${d.marginOnCost>=0.15?'✓ Project is financially viable (profit margin exceeds 15% threshold)':'⚠ Profit margin is below the 15% viability threshold — review assumptions'}</div>
    </div>
    ${_renderAiProformaHTML()}
    ${_renderAiRiskHTML()}
    ${_renderAiCompsHTML()}
    ${hasAI && aiN.market_context ? `
    <div class="rpt-page">
      <div class="rpt-h1">MARKET CONTEXT <span class="pf-live-badge" style="background:#4a8">AI-ENHANCED</span></div>
      ${aiN.market_context}
    </div>` : ''}
    ${hasAI && aiN.development_rationale ? `
    <div class="rpt-page">
      <div class="rpt-h1">DEVELOPMENT RATIONALE <span class="pf-live-badge" style="background:#4a8">AI-ENHANCED</span></div>
      ${aiN.development_rationale}
    </div>` : ''}
    ${hasAI && aiN.risk_factors ? `
    <div class="rpt-page">
      <div class="rpt-h1">RISK FACTORS <span class="pf-live-badge" style="background:#4a8">AI-ENHANCED</span></div>
      ${aiN.risk_factors}
    </div>` : ''}
    <div class="rpt-page">
      <div class="rpt-h1">RECOMMENDATIONS ${hasAI && aiN.recommendations ? '<span class="pf-live-badge" style="background:#4a8">AI-ENHANCED</span>' : ''}</div>
      ${hasAI && aiN.recommendations ? aiN.recommendations : `
      <div class="rpt-p"><b>1. Zoning Confirmation</b> — Engage City Planning to confirm as-of-right permissions.</div>
      <div class="rpt-p"><b>2. Pre-Application Consultation</b> — Formal meeting with City to identify required studies (Planning Rationale, Urban Design, Traffic, Shadow, Wind, Servicing).</div>
      <div class="rpt-p"><b>3. Architectural Design</b> — Engage architect for detailed design reflecting the massing strategy.</div>
      <div class="rpt-p"><b>4. Market Feasibility Study</b> — Confirm pricing, unit mix optimization, and absorption.</div>
      <div class="rpt-p"><b>5. Land Assembly & Due Diligence</b> — Complete ESA, geotech, survey, and title search.</div>
      `}
      <div class="rpt-p" style="margin-top:16px;color:#777;font-style:italic">This report has been prepared by OleaDev for internal planning purposes. All figures are preliminary estimates subject to confirmation. All values update automatically from the massing model.${hasAI?' AI-enhanced sections generated by Claude (Anthropic).':''}</div>
    </div>
  `;
  }catch(e){
    // XSS-safe: escape both the error message and the stack trace before injecting as HTML.
    var _safeMsg = String(e && e.message || 'Unknown error').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    var _safeStack = String(e && e.stack || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    el.innerHTML='<div style="color:#ff6644;padding:20px;font-size:12px"><b>Report render error:</b> '+_safeMsg+'<pre style="font-size:12px;color:#888;margin-top:8px">'+_safeStack+'</pre></div>';
    console.error('renderReport error:',e);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  BRAND METADATA HELPERS — call from browser console
// ═══════════════════════════════════════════════════════════════════════════
//
//  uploadBrandLogo()
//    Opens a file picker. Reads the chosen image (PNG / JPEG / SVG) as a
//    base64 data URL and stores it in P.brand.logo. The cover page of the
//    next PDF export will display it in the top-left.
//
//  setBrandInfo({companyName, tagline, preparedBy, preparedFor})
//    Updates one or more brand text fields. Pass only the keys you want
//    to change. Saves immediately so refresh persists the change.
//
//  clearBrandLogo()
//    Removes the uploaded logo (cover falls back to text-only company name).
// ═══════════════════════════════════════════════════════════════════════════
(function(){
  if(typeof window === 'undefined') return;

  function _ensureBrand(){
    if(typeof P === 'undefined' || !P) return null;
    P.brand = P.brand || {
      companyName:'EstateBuilder.ai',
      tagline:'Real Estate Development Feasibility',
      preparedBy:'',
      preparedFor:'',
      logo:''
    };
    return P.brand;
  }

  window.uploadBrandLogo = function(){
    var brand = _ensureBrand();
    if(!brand){ console.warn('[Brand] P not ready yet'); return; }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/svg+xml';
    input.style.display = 'none';
    input.onchange = function(e){
      var file = e.target && e.target.files && e.target.files[0];
      if(!file){ console.warn('[Brand] no file selected'); return; }
      // 2 MB hard limit — base64 encoding inflates ~33 %, larger files
      // bloat localStorage and slow PDF export. Most logos are < 200 KB.
      if(file.size > 2 * 1024 * 1024){
        console.warn('[Brand] file too large (' + Math.round(file.size/1024) + ' KB). Limit: 2 MB.');
        return;
      }
      var reader = new FileReader();
      reader.onload = function(ev){
        brand.logo = ev.target.result;
        try { if(typeof autoSave === 'function') autoSave(); } catch(_eA){}
        console.log('[Brand] Logo uploaded (' + Math.round(file.size/1024) + ' KB, ' +
                    file.type + '). Will appear on the next PDF cover page.');
      };
      reader.onerror = function(){ console.warn('[Brand] FileReader failed'); };
      reader.readAsDataURL(file);
      try { document.body.removeChild(input); } catch(_eR){}
    };
    document.body.appendChild(input);
    input.click();
  };

  window.setBrandInfo = function(opts){
    var brand = _ensureBrand();
    if(!brand){ console.warn('[Brand] P not ready yet'); return; }
    if(!opts || typeof opts !== 'object'){
      console.log('[Brand] Current state:', JSON.parse(JSON.stringify(brand)));
      console.log('[Brand] Usage: setBrandInfo({companyName, tagline, preparedBy, preparedFor})');
      return;
    }
    ['companyName','tagline','preparedBy','preparedFor'].forEach(function(k){
      if(opts[k] !== undefined) brand[k] = String(opts[k]);
    });
    try { if(typeof autoSave === 'function') autoSave(); } catch(_eA){}
    console.log('[Brand] Updated:', JSON.parse(JSON.stringify(brand)));
  };

  window.clearBrandLogo = function(){
    var brand = _ensureBrand();
    if(!brand) return;
    brand.logo = '';
    try { if(typeof autoSave === 'function') autoSave(); } catch(_eA){}
    console.log('[Brand] Logo cleared.');
  };

  console.log('[Brand] helpers ready: uploadBrandLogo(), setBrandInfo({...}), clearBrandLogo()');
})();
