// sitemap-volumes.js — Building volumes, shape editing, volume panel
// ═══════════════════════════════════════════════════════════════════════════════════

// Globals for volume drawing state. Declared here because they are used across
// sitemap-volumes.js, sitemap-lot.js, sitemap-parcel-picker.js, and
// sitemap-zoning.js. Original lived in the monolithic sitemap.js.bak; lost
// during modularization, restored here so file load order produces a valid
// global state on first reference.
if(typeof smBldgDrawing === 'undefined') var smBldgDrawing = false;
if(typeof smBldgDrawPts === 'undefined') var smBldgDrawPts = [];
// Restore additional volume globals lost in the same modularization (sitemap.js.bak 865-901)
if(typeof smVolumes === 'undefined') var smVolumes = [];
if(typeof smVolNextId === 'undefined') var smVolNextId = 1;
if(typeof smSelectedVolId === 'undefined') var smSelectedVolId = null;
if(typeof smVolColors === 'undefined') var smVolColors = ['#5588bb','#77aa99','#aa7788','#8877aa','#bb8855','#55aa77','#aa5577','#7788bb'];
if(typeof smBldgDrawMarkers === 'undefined') var smBldgDrawMarkers = [];
if(typeof smBldgDrawLine === 'undefined') var smBldgDrawLine = null;


function smDrawBuilding(){
  if(!smLotData||!smMap)return alert('Draw a lot first');
  if(smBldgDrawing){smCancelBldgDraw();return;}
  // Cancel lot drawing if active
  if(smLotDrawing) smCancelLotDraw();
  smBldgDrawing=true;
  smBldgDrawPts=[];
  document.getElementById('btn-draw-bldg').textContent='CANCEL DRAW';
  document.getElementById('btn-draw-bldg').style.background='#c44';
  document.getElementById('btn-draw-bldg').style.color='#fff';
  document.getElementById('sm-draw-hint').style.display='block';
  // Show snap-to-lot option if this is the first building
  const isFirst=smVolumes.length===0;
  const snapBtn=isFirst?'<button onclick="smSnapToLot()" style="margin-top:4px;margin-right:6px;background:#4ecdc4;color:#111;border:none;border-radius:3px;padding:4px 16px;cursor:pointer;font-weight:700;font-size:11px">⬡ SNAP TO LOT</button>':'';
  document.getElementById('sm-draw-hint').innerHTML='<b>Click</b> to place vertices (snaps to lot edges within 3m) · <b>Click first vertex</b> or press <b>CLOSE</b> to finish<br>'+snapBtn+'<button onclick="smCloseBldgPoly()" style="margin-top:4px;background:#AEBC46;color:#111;border:none;border-radius:3px;padding:4px 16px;cursor:pointer;font-weight:700;font-size:11px">CLOSE POLYGON</button>';
  smMap.getCanvas().style.cursor='crosshair';
  // Only use click — NO dblclick handler (avoids all conflicts with Mapbox Draw)
  smMap.on('click',smBldgClickHandler);
}

// Snap first building to lot polygon (uses lot vertices directly)
function smSnapToLot(){
  if(!smLotData||!smLotData.vertices||smLotData.vertices.length<3)return alert('No lot polygon found');
  // Use the lot polygon vertices as building vertices
  smBldgDrawPts=[...smLotData.vertices];
  smCloseBldgPoly();
}

// Snap a point to the nearest lot vertex or lot edge if within threshold
function smSnapToLotPt(pt){
  if(!smLotData||!smLotData.vertices)return pt;
  const snapThresholdM=3; // snap within 3 metres
  const lotVerts=smLotData.vertices;

  // Check each lot vertex
  let bestDist=Infinity, bestPt=pt;
  for(const lv of lotVerts){
    const d=turf.distance(turf.point(pt),turf.point(lv),{units:'meters'});
    if(d<bestDist){bestDist=d;bestPt=lv;}
  }
  if(bestDist<snapThresholdM) return [...bestPt];

  // Check each lot edge — find nearest point on edge
  for(let i=0;i<lotVerts.length;i++){
    const a=lotVerts[i], b=lotVerts[(i+1)%lotVerts.length];
    const nearest=turf.nearestPointOnLine(turf.lineString([a,b]),turf.point(pt));
    const d=turf.distance(turf.point(pt),nearest,{units:'meters'});
    if(d<bestDist){bestDist=d;bestPt=nearest.geometry.coordinates;}
  }
  if(bestDist<snapThresholdM) return [...bestPt];

  return pt; // no snap
}

function smCancelBldgDraw(){
  smBldgDrawing=false;
  smBldgDrawPts=[];
  const btn=document.getElementById('btn-draw-bldg');
  if(btn){btn.textContent='✏️ DRAW BUILDING';btn.style.background='';btn.style.color='';}
  const hint=document.getElementById('sm-draw-hint');
  if(hint)hint.style.display='none';
  if(smMap){
    smMap.getCanvas().style.cursor='';
    smMap.off('click',smBldgClickHandler);
  }
  smBldgDrawMarkers.forEach(m=>m.remove());
  smBldgDrawMarkers=[];
  try{if(smMap&&smMap.getLayer('sm-bldg-draw-line'))smMap.removeLayer('sm-bldg-draw-line');}catch(e){}
  try{if(smMap&&smMap.getSource('sm-bldg-draw-line'))smMap.removeSource('sm-bldg-draw-line');}catch(e){}
}

// Close building polygon — called by button or by clicking near first vertex
function smCloseBldgPoly(){
  if(!smBldgDrawing||smBldgDrawPts.length<3){alert('Need at least 3 points');return;}
  const coords=[...smBldgDrawPts,smBldgDrawPts[0]];
  const poly=turf.polygon([coords]);
  const areaSqM=turf.area(poly);
  const areaSqFt=areaSqM*10.7639;
  const centroid=turf.centroid(poly);
  const [cLng,cLat]=centroid.geometry.coordinates;
  const bbox=turf.bbox(poly);
  const bboxWidthM=turf.distance(turf.point([bbox[0],bbox[1]]),turf.point([bbox[2],bbox[1]]),{units:'meters'});
  const bboxDepthM=turf.distance(turf.point([bbox[0],bbox[1]]),turf.point([bbox[0],bbox[3]]),{units:'meters'});
  const color=smVolColors[(smVolNextId-1)%smVolColors.length];
  const vol={
    id:smVolNextId++,
    lngLat:[cLng,cLat],
    widthFt:Math.round(bboxWidthM*3.28084), depthFt:Math.round(bboxDepthM*3.28084),
    storeys:8,
    angle:0, commGF:1, color:color,
    name:String.fromCharCode(64+smVolumes.length+1),
    windows:1, winSpacing:3,
    balconies:1, balcEvery:2, balcDepth:4,
    balcFront:1, balcBack:1, balcLeft:0, balcRight:0,
    customPoly:coords, customAreaSF:Math.round(areaSqFt)
  };
  // ── INDUSTRIAL ASSET CLASS OVERRIDE ─────────────────────────────────────
  //   When the user has chosen 'industrial' from the asset-class selector,
  //   replace the residential defaults (storeys=8, balconies, windows, brick
  //   ground floor) with industrial Class A defaults BEFORE the volume is
  //   pushed into smVolumes / synced to P.vols. Also auto-generate the
  //   surface zones (truck court, dock apron, dock doors, trailer/car
  //   stripes, parking) around the polygon's bounding box so the user
  //   sees a complete industrial site plan immediately.
  try {
    var __selEl = document.getElementById('project-type-select');
    var __cls = __selEl ? __selEl.value : 'midrise';
    if(__cls === 'industrial'){
      vol.kind        = 'warehouse';
      vol.industrial  = true;
      vol.storeys     = 1;
      vol.gfHt        = 40;
      vol.totalHt     = 40;
      vol.storeys     = 1;
      vol.floorHt     = 40;
      vol.windows     = 0;
      vol.balconies   = 0;
      vol.commGF      = 0;
      vol.commGF      = 0;
      vol.windows     = 0;
      vol.balconies   = 0;
      vol.balcFront   = 0;
      vol.balcBack    = 0;
      vol.balcLeft    = 0;
      vol.balcRight   = 0;
      vol.color       = '#cfc8b8';   // tilt-up concrete tone
      console.log('[Industrial] Site Map polygon → warehouse vol — ' + vol.widthFt + ' x ' + vol.depthFt + ' ft, ' + vol.customAreaSF.toLocaleString() + ' sf');
    }
  } catch(__e){}
  smConformEdges(vol); // conform edges to nearby lot/building edges
  smVolumes.push(vol);
  smSelectedVolId=vol.id;
  smCancelBldgDraw();
  smDrawVolume(vol);
  smRenderVolPanel();
  smAutoSync();
  // Industrial asset class: defer surface-zone generation slightly so smAutoSync
  // has finished copying smVolumes → P.vols. The hook reads vol.kind from P.vols.
  try {
    var __selEl2 = document.getElementById('project-type-select');
    if(__selEl2 && __selEl2.value === 'industrial'){
      setTimeout(function(){
        try {
          if(typeof P === 'undefined' || !P || !Array.isArray(P.vols)) return;
          if(typeof window._industrialBuildSurfaceZones !== 'function') return;
          // Find warehouse vol in P.vols (the just-synced one)
          var __wh = null;
          for(var __i = P.vols.length - 1; __i >= 0; __i--){
            if(P.vols[__i] && (P.vols[__i].kind === 'warehouse' || P.vols[__i].industrial)){
              __wh = P.vols[__i]; break;
            }
          }
          // If smAutoSync didn't preserve our flags, force them on the most-recent vol
          if(!__wh && P.vols.length){
            __wh = P.vols[P.vols.length - 1];
            if(__wh){
              __wh.kind = 'warehouse';
              __wh.industrial = true;
              __wh.storeys = 1;
              __wh.floorHt = 40;
              __wh.gfHt = 40;
              __wh.commGF = 0;
              __wh.windows = 0;
              __wh.balconies = 0;
            }
          }
          if(!__wh || !__wh.customPolyLocal) return;
          // Compute bbox of the polygon in local feet
          var __minX = Infinity, __maxX = -Infinity, __minZ = Infinity, __maxZ = -Infinity;
          for(var __k = 0; __k < __wh.customPolyLocal.length; __k++){
            var __pt = __wh.customPolyLocal[__k];
            if(__pt[0] < __minX) __minX = __pt[0];
            if(__pt[0] > __maxX) __maxX = __pt[0];
            if(__pt[1] < __minZ) __minZ = __pt[1];
            if(__pt[1] > __maxZ) __maxZ = __pt[1];
          }
          var __wcx = (__minX + __maxX) / 2;
          var __wcz = (__minZ + __maxZ) / 2;
          var __ww = __maxX - __minX;
          var __wd = __maxZ - __minZ;
          P.industrialSurfaces = window._industrialBuildSurfaceZones(__wcx, __wcz, __ww, __wd, __ww >= __wd);
          console.log('[Industrial] Generated ' + P.industrialSurfaces.length + ' surface zones around drawn polygon (' + Math.round(__ww) + ' x ' + Math.round(__wd) + ' ft bbox)');
          if(typeof rebuildAll === 'function'){
            try { rebuildAll(); } catch(__e){}
          }
        } catch(__e){ console.warn('[Industrial post-draw] failed:', __e && __e.message); }
      }, 120);
    }
  } catch(__e){}
}

function smBldgClickHandler(e){
  if(!smBldgDrawing||smLotDrawing)return;
  let pt=[e.lngLat.lng,e.lngLat.lat];

  // Snap to lot vertices/edges
  pt=smSnapToLotPt(pt);

  // Also snap to existing building vertices (for subsequent buildings)
  if(smVolumes.length>0){
    let bestD=Infinity, bestP=null;
    smVolumes.forEach(vol=>{
      if(!vol.customPoly)return;
      vol.customPoly.forEach(vp=>{
        const d=turf.distance(turf.point(pt),turf.point(vp),{units:'meters'});
        if(d<3&&d<bestD){bestD=d;bestP=[...vp];}
      });
    });
    if(bestP) pt=bestP;
  }

  // If we have 3+ points and click near the FIRST vertex → close the polygon
  if(smBldgDrawPts.length>=3){
    const first=smBldgDrawPts[0];
    const distM=turf.distance(turf.point(pt),turf.point(first),{units:'meters'});
    if(distM<3){ // within 3 meters of first vertex = close
      smCloseBldgPoly();
      return;
    }
  }

  smBldgDrawPts.push(pt);

  // Vertex marker (orange-red to distinguish from lot polygon; first vertex is larger)
  const isFirst=smBldgDrawPts.length===1;
  const el=document.createElement('div');
  el.style.cssText=`width:${isFirst?16:12}px;height:${isFirst?16:12}px;background:${isFirst?'#AEBC46':'#ff6644'};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.5);${isFirst?'cursor:pointer':''}`;
  if(isFirst) el.title='Click here to close polygon';
  const m=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat(pt).addTo(smMap);
  if(isFirst){
    el.addEventListener('click',(ev)=>{ev.stopPropagation();if(smBldgDrawPts.length>=3)smCloseBldgPoly();});
  }
  smBldgDrawMarkers.push(m);

  // Update preview line
  smUpdateBldgDrawLine();
}

function smUpdateBldgDrawLine(){
  if(smBldgDrawPts.length<2)return;
  const data={type:'Feature',geometry:{type:'LineString',coordinates:smBldgDrawPts}};
  if(smMap.getSource('sm-bldg-draw-line')){
    smMap.getSource('sm-bldg-draw-line').setData(data);
  } else {
    smMap.addSource('sm-bldg-draw-line',{type:'geojson',data:data});
    smMap.addLayer({id:'sm-bldg-draw-line',type:'line',source:'sm-bldg-draw-line',paint:{'line-color':'#ff6644','line-width':3}});
  }
}

// ── Edit existing freeform polygon vertices ──
let smEditingVolId=null;
let smEditMarkers=[];

function smEditBldgPoly(volId){
  const vol=smVolumes.find(v=>v.id===volId);
  if(!vol||!vol.customPoly)return;

  // If already editing this one, finish
  if(smEditingVolId===volId){smFinishEditPoly();return;}
  // If editing another, finish that first
  if(smEditingVolId)smFinishEditPoly();

  smEditingVolId=volId;
  smSelectedVolId=volId;
  const coords=vol.customPoly;

  // Place draggable markers on each vertex (skip closing vertex)
  for(let i=0;i<coords.length-1;i++){
    const el=document.createElement('div');
    el.style.cssText=`width:14px;height:14px;background:#AEBC46;border:2px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,0.6)`;
    el.title='Drag to move vertex '+(i+1);
    const marker=new mapboxgl.Marker({element:el,draggable:true,anchor:'center'})
      .setLngLat(coords[i])
      .addTo(smMap);
    const idx=i;
    marker.on('drag',()=>{
      const ll=marker.getLngLat();
      coords[idx]=[ll.lng,ll.lat];
      coords[coords.length-1]=[coords[0][0],coords[0][1]]; // keep closed
      // Recalc area
      try{
        const poly=turf.polygon([coords]);
        vol.customAreaSF=Math.round(turf.area(poly)*10.7639);
        const c=turf.centroid(poly);
        vol.lngLat=[c.geometry.coordinates[0],c.geometry.coordinates[1]];
      }catch(e){}
      smDrawVolume(vol);
    });
    marker.on('dragend',()=>{
      smRenderVolPanel();
      smAutoSync();
    });
    smEditMarkers.push(marker);
  }

  // Add midpoint markers for inserting new vertices
  for(let i=0;i<coords.length-1;i++){
    const j=(i+1)%(coords.length-1);
    if(j===0&&i===coords.length-2) continue;
    const mid=[(coords[i][0]+coords[i+1][0])/2,(coords[i][1]+coords[i+1][1])/2];
    const el=document.createElement('div');
    el.style.cssText='width:10px;height:10px;background:#AEBC4666;border:1px solid #AEBC46;border-radius:50%;cursor:pointer';
    el.title='Click to add vertex here';
    const marker=new mapboxgl.Marker({element:el,anchor:'center'}).setLngLat(mid).addTo(smMap);
    const insertIdx=i+1;
    el.addEventListener('click',()=>{
      coords.splice(insertIdx,0,[mid[0],mid[1]]);
      smFinishEditPoly();
      smEditBldgPoly(volId); // re-enter edit with new vertex
      smRenderVolPanel();
      smAutoSync();
    });
    smEditMarkers.push(marker);
  }

  smRenderVolPanel();
}

function smFinishEditPoly(){
  smEditMarkers.forEach(m=>m.remove());
  smEditMarkers=[];
  smEditingVolId=null;
}

function smResetToRect(volId){
  const vol=smVolumes.find(v=>v.id===volId);
  if(!vol)return;
  if(smEditingVolId===volId) smFinishEditPoly();
  if(_smShapeEditId===volId) smExitShapeEdit();
  // Clean up old layers fully, then redraw as rect
  smRemoveVolGeo(vol);
  vol.customPoly=null;
  vol.customAreaSF=null;
  vol.shapeType=null;
  vol.shapeParams=null;
  smDrawVolume(vol);
  smRenderVolPanel();
  smAutoSync();
}

// ═══════════════════════════════════════════════════════════
//  SHAPE BUILDER — parametric building shapes
// ═══════════════════════════════════════════════════════════
let _smShapeMenuOpen=false;
let _smShapeHandles=[];    // resize/rotate markers on map
let _smShapeRotLine=null;  // rotation handle connecting line
let _smShapeEditId=null;   // volume ID currently in shape-edit mode

function smToggleShapeMenu(){
  if(!smLotData||!smMap){alert('Draw a lot first');return;}
  _smShapeMenuOpen=!_smShapeMenuOpen;
  const menu=document.getElementById('sm-shape-menu');
  if(!menu)return;

  const opt=(type,svg,title,sub)=>`<div onclick="smAddShape('${type}')" class="sm-shape-opt">${svg}<div><div style="color:#eee;font-weight:600;font-size:11px">${title}</div><div style="color:#666;font-size:9px">${sub}</div></div></div>`;
  menu.innerHTML=`
    <div style="font-size:9px;color:#AEBC46;font-weight:700;letter-spacing:1px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #333">SHAPE BUILDER</div>
    ${opt('rect','<svg width="28" height="20" viewBox="0 0 28 20"><rect x="2" y="2" width="24" height="16" fill="none" stroke="#AEBC46" stroke-width="1.5" rx="1"/></svg>','Rectangle','Width × Depth')}
    ${opt('square','<svg width="28" height="20" viewBox="0 0 28 20"><rect x="4" y="1" width="18" height="18" fill="none" stroke="#4ecdc4" stroke-width="1.5" rx="1"/></svg>','Square','Equal sides')}
    ${opt('lshape','<svg width="28" height="20" viewBox="0 0 28 20"><path d="M3,1 L13,1 L13,10 L25,10 L25,19 L3,19 Z" fill="none" stroke="#ff9966" stroke-width="1.5"/></svg>','L-Shape','Podium wrap / corner')}
    ${opt('ushape','<svg width="28" height="20" viewBox="0 0 28 20"><path d="M2,1 L10,1 L10,12 L18,12 L18,1 L26,1 L26,19 L2,19 Z" fill="none" stroke="#b088cc" stroke-width="1.5"/></svg>','U-Shape','Courtyard building')}
    ${opt('tshape','<svg width="28" height="20" viewBox="0 0 28 20"><path d="M9,19 L9,8 L2,8 L2,1 L26,1 L26,8 L19,8 L19,19 Z" fill="none" stroke="#e8c87a" stroke-width="1.5"/></svg>','T-Shape','Tower + wing')}`;
  menu.style.display=_smShapeMenuOpen?'block':'none';
}

// ── Generate local (meter) vertices for each shape type ──
function smShapeLocalVerts(type,p){
  // Returns array of [x,y] in meters, CCW, NOT closed (no duplicate last vertex)
  // Origin at shape centroid
  let pts=[];
  if(type==='rect'){
    const hw=p.w/2, hd=p.d/2;
    pts=[[-hw,-hd],[hw,-hd],[hw,hd],[-hw,hd]];
  } else if(type==='square'){
    const h=p.s/2;
    pts=[[-h,-h],[h,-h],[h,h],[-h,h]];
  } else if(type==='lshape'){
    // L: main body W×D, wing extends from top-right corner
    // p.w=total width, p.d=total depth, p.ww=wing width (left arm), p.wd=wing depth (bottom bar height)
    const W=p.w, D=p.d, ww=p.ww, wd=p.wd;
    pts=[[0,0],[W,0],[W,wd],[ww,wd],[ww,D],[0,D]];
  } else if(type==='ushape'){
    // U: two wings + base, open at top
    // p.w=total width, p.d=total depth, p.cw=courtyard width, p.cd=courtyard depth
    const W=p.w, D=p.d, cw=p.cw, cd=p.cd;
    const wingW=(W-cw)/2;
    pts=[[0,0],[W,0],[W,D],[W-wingW,D],[W-wingW,D-cd],[wingW,D-cd],[wingW,D],[0,D]];
  } else if(type==='tshape'){
    // T: top bar + stem going down
    // p.tw=top bar width, p.td=top bar depth, p.sw=stem width, p.sd=stem depth
    const tw=p.tw, td=p.td, sw=p.sw, sd=p.sd;
    const stemL=(tw-sw)/2, stemR=stemL+sw;
    pts=[[stemL,0],[stemR,0],[stemR,sd],[tw,sd],[tw,sd+td],[0,sd+td],[0,sd],[stemL,sd]];
  }
  // Center on centroid
  if(pts.length>0){
    let cx=0,cy=0;
    pts.forEach(p=>{cx+=p[0];cy+=p[1];});
    cx/=pts.length; cy/=pts.length;
    pts=pts.map(p=>[p[0]-cx, p[1]-cy]);
  }
  return pts;
}

// ── Convert local shape verts → GPS polygon (with rotation) ──
function smShapeToGPS(localPts, centerLngLat, angleDeg){
  const [cLng,cLat]=centerLngLat;
  const rad=angleDeg*Math.PI/180;
  const mPerLat=111132;
  const mPerLng=111132*Math.cos(cLat*Math.PI/180);
  const gpsPts=localPts.map(([x,y])=>{
    const rx=x*Math.cos(rad)-y*Math.sin(rad);
    const ry=x*Math.sin(rad)+y*Math.cos(rad);
    return [cLng+rx/mPerLng, cLat+ry/mPerLat];
  });
  gpsPts.push([...gpsPts[0]]); // close polygon
  return gpsPts;
}

// ── Regenerate a shape volume's polygon from its params ──
function smRegenerateShapePoly(vol, skipArea){
  if(!vol.shapeType||!vol.shapeParams)return;
  const local=smShapeLocalVerts(vol.shapeType, vol.shapeParams);
  const gps=smShapeToGPS(local, vol.lngLat, vol.angle||0);
  vol.customPoly=gps;
  if(!skipArea){
    const poly=turf.polygon([gps]);
    vol.customAreaSF=Math.round(turf.area(poly)*10.7639);
  }
}

// ── Default shape params based on lot size ──
function smDefaultShapeParams(type){
  // Base on lot dimensions if available
  let lotW=25, lotD=35; // default meters
  if(smLotData){
    const bbox=turf.bbox(smLotData.geometry);
    lotW=turf.distance(turf.point([bbox[0],bbox[1]]),turf.point([bbox[2],bbox[1]]),{units:'meters'});
    lotD=turf.distance(turf.point([bbox[0],bbox[1]]),turf.point([bbox[0],bbox[3]]),{units:'meters'});
  }
  let w=Math.round(lotW*0.6);
  let d=Math.round(lotD*0.5);
  if(type==='rect') return {w:w, d:d};
  if(type==='square'){const s=Math.round(Math.min(w,d)*0.9); return {s:s};}
  if(type==='lshape') return {w:w, d:d, ww:Math.round(w*0.4), wd:Math.round(d*0.5)};
  if(type==='ushape') return {w:w, d:d, cw:Math.round(w*0.4), cd:Math.round(d*0.4)};
  if(type==='tshape') return {tw:w, td:Math.round(d*0.35), sw:Math.round(w*0.4), sd:Math.round(d*0.5)};
  return {w:20, d:15};
}

// ── Translate a freehand (non-shape) custom polygon when its center is dragged ──
function smTranslateCustomPoly(vol, newCenter){
  if(!vol.customPoly||vol.customPoly.length<3)return;
  const oldC=vol._prevLngLat||vol.lngLat;
  const dx=newCenter[0]-oldC[0], dy=newCenter[1]-oldC[1];
  if(Math.abs(dx)<1e-12&&Math.abs(dy)<1e-12)return;
  vol.customPoly=vol.customPoly.map(p=>[p[0]+dx,p[1]+dy]);
  vol._prevLngLat=[...newCenter];
}

// Center snap removed — edge conforming handles all alignment now

// Nearest point on segment (ax,ay)-(bx,by) to point (px,py)
function nearestOnSeg(ax,ay,bx,by,px,py){
  const dx=bx-ax, dy=by-ay;
  const len2=dx*dx+dy*dy;
  if(len2<1e-10)return [ax,ay];
  let t=((px-ax)*dx+(py-ay)*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  return [ax+t*dx, ay+t*dy];
}

// ═══════════════════════════════════════════════════════════
//  EDGE CONFORMING — reshape building edges to match nearby
//  lot edges or other building edges for seamless alignment
// ═══════════════════════════════════════════════════════════
const SM_CONFORM_DIST=3; // metres — edge conform threshold

function smConformEdges(vol){
  if(!vol.customPoly||vol.customPoly.length<4)return;
  const [refLng,refLat]=vol.lngLat;
  const mPerLat=111132, mPerLng=111132*Math.cos(refLat*Math.PI/180);
  const toM=p=>[(p[0]-refLng)*mPerLng,(p[1]-refLat)*mPerLat];
  const toGPS=m=>[m[0]/mPerLng+refLng, m[1]/mPerLat+refLat];
  const dist2=(a,b)=>(a[0]-b[0])**2+(a[1]-b[1])**2;
  const dist=(a,b)=>Math.sqrt(dist2(a,b));

  // ── Collect target edges + vertices (lot + other buildings) ──
  const tSegs=[]; // {ax,ay,bx,by}
  const tVerts=[]; // [mx,my]
  if(smLotData&&smLotData.vertices){
    const lv=smLotData.vertices;
    for(let i=0;i<lv.length;i++){
      const a=toM(lv[i]), b=toM(lv[(i+1)%lv.length]);
      tSegs.push({ax:a[0],ay:a[1],bx:b[0],by:b[1]});
      tVerts.push(a);
    }
  }
  smVolumes.forEach(ov=>{
    if(ov.id===vol.id||!ov.customPoly||ov.customPoly.length<3)return;
    for(let i=0;i<ov.customPoly.length-1;i++){
      const a=toM(ov.customPoly[i]),b=toM(ov.customPoly[i+1]);
      tSegs.push({ax:a[0],ay:a[1],bx:b[0],by:b[1]});
      tVerts.push(a);
    }
  });
  if(tSegs.length===0)return;

  // ── Step 1: Snap each volume vertex to nearest target edge if within threshold ──
  let pts=vol.customPoly.slice(0,-1).map(toM); // open ring in metres
  let snapped=pts.map(p=>{
    let best=Infinity, bp=null;
    for(const s of tSegs){
      const np=nearestOnSeg(s.ax,s.ay,s.bx,s.by,p[0],p[1]);
      const d=dist(p,np);
      if(d<best){best=d;bp=np;}
    }
    return(best<SM_CONFORM_DIST&&bp)?[...bp]:[...p];
  });

  // ── Step 2: Insert target vertices that fall within threshold of a volume edge ──
  // This handles non-straight lot lines — kink points get added to the polygon
  let result=[];
  for(let i=0;i<snapped.length;i++){
    result.push(snapped[i]);
    const ni=(i+1)%snapped.length;
    const a=snapped[i], b=snapped[ni];
    const edgeLen=dist(a,b);
    if(edgeLen<0.3)continue; // skip tiny edges

    // Find target vertices close to this volume edge
    const inserts=[];
    for(const tv of tVerts){
      const np=nearestOnSeg(a[0],a[1],b[0],b[1],tv[0],tv[1]);
      const d=dist(tv,np);
      if(d<SM_CONFORM_DIST){
        // Parameter along edge for ordering
        const dx=b[0]-a[0], dy=b[1]-a[1];
        const len2=dx*dx+dy*dy;
        if(len2<0.01)continue;
        const t=((tv[0]-a[0])*dx+(tv[1]-a[1])*dy)/len2;
        if(t>0.03&&t<0.97){ // not too close to endpoints
          // Check it's not duplicating an existing vertex
          const dToA=dist(tv,a), dToB=dist(tv,b);
          if(dToA>0.5&&dToB>0.5){
            inserts.push({t,pt:[...tv]});
          }
        }
      }
    }
    // Sort by parameter and deduplicate
    inserts.sort((x,y)=>x.t-y.t);
    for(const ins of inserts){
      const last=result[result.length-1];
      if(dist(ins.pt,last)>0.4)result.push(ins.pt);
    }
  }

  // ── Convert back to GPS and close the polygon ──
  vol.customPoly=result.map(toGPS);
  vol.customPoly.push([...vol.customPoly[0]]);
}

// ── Add shape to map ──
function smAddShape(type){
  if(!smLotData||!smMap)return alert('Draw a lot first');
  _smShapeMenuOpen=false;
  document.getElementById('sm-shape-menu').style.display='none';

  const c=turf.centroid(smLotData.geometry);
  const [lng,lat]=c.geometry.coordinates;
  const color=smVolColors[(smVolNextId-1)%smVolColors.length];
  const params=smDefaultShapeParams(type);

  const vol={
    id:smVolNextId++,
    lngLat:[lng,lat],
    widthFt:0, depthFt:0,
    storeys:8,
    angle:0, commGF:1,
    color:color,
    name:String.fromCharCode(64+smVolumes.length+1),
    windows:1, winSpacing:3,
    balconies:1, balcEvery:2, balcDepth:4,
    balcFront:1, balcBack:1, balcLeft:0, balcRight:0,
    shapeType:type,
    shapeParams:params
  };

  // Generate polygon + conform to nearby edges
  smRegenerateShapePoly(vol);
  smConformEdges(vol);

  smVolumes.push(vol);
  smSelectedVolId=vol.id;
  smDrawVolume(vol);
  smRenderVolPanel();
  smAutoSync();

  // Auto-enter shape edit mode (show handles)
  smEnterShapeEdit(vol.id);
  smShowToast('Shape placed — drag handles to resize, drag circle to rotate','#AEBC46');
}

// Legacy rectangle add (now goes through shape builder)
function smAddVolume(){
  smAddShape('rect');
}

// Add a new building volume
function smAddPhase(){
  smAddShape('rect');
}

// Phase button not used for residential — keep hidden
function smUpdatePhaseButton(){
  const wrap=document.getElementById('sm-add-phase-wrap');
  if(!wrap)return;
  wrap.style.display='none';
}

// ═══════════════════════════════════════════════════════════
//  SHAPE EDIT MODE — rotation handle + resize handles on map
// ═══════════════════════════════════════════════════════════

// Lightweight polygon update — only updates GeoJSON data, no marker/layer recreation
// skipDims=true during drag moves (dimensions don't change, only position does)
function smUpdateShapeGeo(vol, skipDims){
  if(!smMap)return;
  const sourceId='smvol-'+vol.id;
  const poly=vol.customPoly
    ?{type:'Feature',geometry:{type:'Polygon',coordinates:[vol.customPoly]},properties:{id:vol.id}}
    :smVolToGeoJSON(vol);
  try{if(smMap.getSource(sourceId))smMap.getSource(sourceId).setData(poly);}catch(e){}
  // Update dimension labels (skip during drag moves for performance)
  if(skipDims)return;
  const dimId='smvol-dims-'+vol.id;
  if(vol.customPoly&&vol.customPoly.length>=3){
    const dimFeatures=[];
    for(let i=0;i<vol.customPoly.length-1;i++){
      const a=vol.customPoly[i],b=vol.customPoly[i+1];
      const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
      const dFt=Math.round(dM*3.28084);
      if(dFt<3)continue;
      dimFeatures.push({type:'Feature',geometry:{type:'Point',coordinates:[(a[0]+b[0])/2,(a[1]+b[1])/2]},properties:{label:dFt+"'"}});
    }
    try{if(smMap.getSource(dimId))smMap.getSource(dimId).setData({type:'FeatureCollection',features:dimFeatures});}catch(e){}
  }
}

// Compute bounding box midpoints in GPS for the resize handles
function smShapeBBoxHandles(vol){
  if(!vol.customPoly||vol.customPoly.length<3)return{};
  const [cLng,cLat]=vol.lngLat;
  const mPerLat=111132, mPerLng=111132*Math.cos(cLat*Math.PI/180);
  const rad=(vol.angle||0)*Math.PI/180;
  const localPts=smShapeLocalVerts(vol.shapeType,vol.shapeParams);
  const xs=localPts.map(p=>p[0]), ys=localPts.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  // Edge midpoints in local coords, then rotate+offset to GPS
  const toGPS=([lx,ly])=>{
    const rx=lx*Math.cos(rad)-ly*Math.sin(rad);
    const ry=lx*Math.sin(rad)+ly*Math.cos(rad);
    return[cLng+rx/mPerLng,cLat+ry/mPerLat];
  };
  return{
    e:toGPS([maxX,(minY+maxY)/2]),  // right edge midpoint
    w:toGPS([minX,(minY+maxY)/2]),  // left edge midpoint
    n:toGPS([(minX+maxX)/2,maxY]),  // top edge midpoint
    s:toGPS([(minX+maxX)/2,minY]),  // bottom edge midpoint
    width:maxX-minX,  // current width in meters
    depth:maxY-minY   // current depth in meters
  };
}

function smEnterShapeEdit(volId){
  smExitShapeEdit();
  const vol=smVolumes.find(v=>v.id===volId);
  if(!vol||!vol.shapeType)return;
  _smShapeEditId=volId;

  const [cLng,cLat]=vol.lngLat;
  const mPerLat=111132, mPerLng=111132*Math.cos(cLat*Math.PI/180);

  // ── Rotation handle ──
  const rotDist=20;
  const rad=(vol.angle||0)*Math.PI/180;
  const rotLng=cLng+rotDist*Math.sin(rad)/mPerLng;
  const rotLat=cLat+rotDist*Math.cos(rad)/mPerLat;

  // Connecting line
  const lineId='sm-shape-rot-line';
  const lineData={type:'Feature',geometry:{type:'LineString',coordinates:[[cLng,cLat],[rotLng,rotLat]]}};
  if(smMap.getSource(lineId)){
    smMap.getSource(lineId).setData(lineData);
  } else {
    smMap.addSource(lineId,{type:'geojson',data:lineData});
    smMap.addLayer({id:lineId,type:'line',source:lineId,paint:{'line-color':'#AEBC46','line-width':2,'line-dasharray':[4,3]}});
  }
  _smShapeRotLine=lineId;

  // Rotation marker
  const rotEl=document.createElement('div');
  rotEl.style.cssText='width:24px;height:24px;background:#AEBC46;border:2px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center';
  rotEl.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1a5 5 0 0 1 4.5 2.8" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="round"/><path d="M10 1l1 3-3-.5" fill="#111"/></svg>';
  rotEl.title='Drag to rotate';
  const rotMarker=new mapboxgl.Marker({element:rotEl,draggable:true,anchor:'center'})
    .setLngLat([rotLng,rotLat]).addTo(smMap);

  rotMarker.on('drag',()=>{
    const ll=rotMarker.getLngLat();
    const dx=(ll.lng-cLng)*mPerLng, dy=(ll.lat-cLat)*mPerLat;
    let a=Math.atan2(dx,dy)*180/Math.PI;
    if(a<0)a+=360;
    vol.angle=Math.round(a);
    smRegenerateShapePoly(vol);
    smConformEdges(vol);
    smUpdateShapeGeo(vol); // lightweight — no flicker
    try{smMap.getSource(lineId).setData({type:'Feature',geometry:{type:'LineString',coordinates:[[cLng,cLat],[ll.lng,ll.lat]]}});}catch(e){}
    // Reposition resize handles
    smRepositionResizeHandles(vol);
  });
  rotMarker.on('dragend',()=>{
    smRenderVolPanel();
    smAutoSync();
  });
  _smShapeHandles.push(rotMarker);

  // ── 4 Edge resize handles (E, W, N, S) ──
  const bbox=smShapeBBoxHandles(vol);
  const dirs=[
    {key:'e',gps:bbox.e,cursor:'ew-resize',dim:'width',label:'→'},
    {key:'w',gps:bbox.w,cursor:'ew-resize',dim:'width',label:'←'},
    {key:'n',gps:bbox.n,cursor:'ns-resize',dim:'depth',label:'↑'},
    {key:'s',gps:bbox.s,cursor:'ns-resize',dim:'depth',label:'↓'}
  ];

  dirs.forEach(d=>{
    if(!d.gps)return;
    const el=document.createElement('div');
    el.style.cssText='width:16px;height:16px;background:#fff;border:2px solid '+vol.color+';border-radius:3px;cursor:'+d.cursor+';box-shadow:0 1px 4px rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;font-size:9px;color:#333;font-weight:700';
    el.textContent=d.label;
    el.title='Drag to resize '+d.dim;
    const marker=new mapboxgl.Marker({element:el,draggable:true,anchor:'center'})
      .setLngLat(d.gps).addTo(smMap);
    marker._shapeDir=d.key; // tag for repositioning
    const startGPS=[...d.gps];

    marker.on('drag',()=>{
      const ll=marker.getLngLat();
      // Convert drag delta to local meters (un-rotate)
      const dx=(ll.lng-cLng)*mPerLng, dy=(ll.lat-cLat)*mPerLat;
      const negRad=-rad;
      const lx=dx*Math.cos(negRad)-dy*Math.sin(negRad);
      const ly=dx*Math.sin(negRad)+dy*Math.cos(negRad);
      // Compute new dimension directly from handle position
      // E/W handles control width, N/S handles control depth
      const isWidth=(d.key==='e'||d.key==='w');
      const newDim=isWidth?Math.abs(lx)*2:Math.abs(ly)*2; // *2 because handle is at edge, shape centered
      smApplyDimChange(vol,isWidth?'width':'depth',Math.max(4,Math.round(newDim)));
      smRegenerateShapePoly(vol);
      smConformEdges(vol);
      smUpdateShapeGeo(vol);
      // Reposition OTHER handles (not this one being dragged)
      smRepositionResizeHandles(vol, d.key);
    });
    marker.on('dragend',()=>{
      smRegenerateShapePoly(vol);
      smConformEdges(vol);
      smUpdateShapeGeo(vol);
      smRenderVolPanel();
      smAutoSync();
      // Reposition all handles to final positions
      smRepositionResizeHandles(vol);
    });
    _smShapeHandles.push(marker);
  });
}

// Reposition all shape edit handles to match current shape
function smRepositionResizeHandles(vol, skipKey){
  const bbox=smShapeBBoxHandles(vol);
  const map={e:bbox.e,w:bbox.w,n:bbox.n,s:bbox.s};
  const [cLng,cLat]=vol.lngLat;
  const mPerLat=111132, mPerLng=111132*Math.cos(cLat*Math.PI/180);
  const rad=(vol.angle||0)*Math.PI/180;
  const rotDist=20;
  const rotLng=cLng+rotDist*Math.sin(rad)/mPerLng;
  const rotLat=cLat+rotDist*Math.cos(rad)/mPerLat;

  _smShapeHandles.forEach(m=>{
    // Resize handles (tagged with _shapeDir)
    if(m._shapeDir&&m._shapeDir!==skipKey&&map[m._shapeDir]){
      m.setLngLat(map[m._shapeDir]);
    }
    // Rotation handle (no _shapeDir tag, but is the first handle)
    if(!m._shapeDir&&m!==_smShapeHandles[0])return; // skip unknown
    if(!m._shapeDir){
      m.setLngLat([rotLng,rotLat]);
    }
  });
  // Update rotation line
  if(_smShapeRotLine){
    try{smMap.getSource(_smShapeRotLine).setData({type:'Feature',geometry:{type:'LineString',coordinates:[[cLng,cLat],[rotLng,rotLat]]}});}catch(e){}
  }
}

// Apply a dimension change to the right shape param
function smApplyDimChange(vol,axis,newMeters){
  const p=vol.shapeParams, t=vol.shapeType;
  const cl=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  if(axis==='width'){
    if(t==='rect') p.w=cl(newMeters,4,200);
    else if(t==='square') p.s=cl(newMeters,4,200);
    else if(t==='lshape'){p.w=cl(newMeters,6,200);p.ww=Math.min(p.ww,p.w-2);}
    else if(t==='ushape'){p.w=cl(newMeters,8,200);p.cw=Math.min(p.cw,p.w-4);}
    else if(t==='tshape'){p.tw=cl(newMeters,6,200);p.sw=Math.min(p.sw,p.tw-2);}
  } else {
    if(t==='rect') p.d=cl(newMeters,4,200);
    else if(t==='square') p.s=cl(newMeters,4,200);
    else if(t==='lshape') p.d=cl(newMeters,6,200);
    else if(t==='ushape') p.d=cl(newMeters,8,200);
    else if(t==='tshape'){const total=p.sd+p.td;p.sd=cl(Math.round(newMeters*p.sd/Math.max(1,total)),4,200);p.td=cl(Math.round(newMeters*p.td/Math.max(1,total)),3,80);}
  }
}

function smExitShapeEdit(){
  _smShapeHandles.forEach(m=>{try{m.remove();}catch(e){}});
  _smShapeHandles=[];
  if(_smShapeRotLine){
    try{if(smMap.getLayer(_smShapeRotLine))smMap.removeLayer(_smShapeRotLine);}catch(e){}
    try{if(smMap.getSource(_smShapeRotLine))smMap.removeSource(_smShapeRotLine);}catch(e){}
    _smShapeRotLine=null;
  }
  _smShapeEditId=null;
}

// ═══════════════════════════════════════════════════════════
//  POLYGON RESIZE — Corner-drag resize for customPoly volumes
//  Used primarily for AI-generated tower volumes. Drags one of 4 corner
//  handles to scale the polygon. Opposite corner stays anchored (window-resize
//  pattern). Polygon shape (L/T/U/freeform) is preserved — only scaled.
//  For tower volumes, optionally constrains to stay inside podium footprint.
// ═══════════════════════════════════════════════════════════

/** Compute current bounding box of the polygon in GPS coords */
function smPolyBBox(coords){
  if(!coords || coords.length < 3) return null;
  var lngs = coords.map(c => c[0]);
  var lats = coords.map(c => c[1]);
  return {
    minLng: Math.min.apply(null, lngs), maxLng: Math.max.apply(null, lngs),
    minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats),
  };
}

/** Compute the 4 corner handle positions (NW, NE, SW, SE) for a polygon's bbox */
function smPolyCornerHandles(coords){
  var b = smPolyBBox(coords);
  if(!b) return null;
  return {
    nw: [b.minLng, b.maxLat],
    ne: [b.maxLng, b.maxLat],
    sw: [b.minLng, b.minLat],
    se: [b.maxLng, b.minLat],
    bbox: b
  };
}

/** Scale a polygon coordinates set by sx,sy around an anchor [aLng,aLat]
 *  Each vertex's distance from anchor is multiplied by the scale factors. */
function smScalePolygon(coords, aLng, aLat, sx, sy){
  return coords.map(function(p){
    return [aLng + (p[0] - aLng) * sx, aLat + (p[1] - aLat) * sy];
  });
}

/** Update the volume's customPoly (and lngLat) in place after a scale operation */
function smApplyScaledPoly(vol, newCoords){
  // Recompute closed ring (first === last) and centroid for marker position
  var ring = newCoords.slice();
  if(ring.length > 0){
    var first = ring[0], last = ring[ring.length-1];
    if(first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  vol.customPoly = ring;
  // Recentre the marker on the new polygon centroid
  var sumLng = 0, sumLat = 0, n = ring.length - 1;
  for(var i = 0; i < n; i++){ sumLng += ring[i][0]; sumLat += ring[i][1]; }
  if(n > 0){ vol.lngLat = [sumLng / n, sumLat / n]; }
  // Recalculate area
  try {
    var poly = turf.polygon([ring]);
    vol.customAreaSF = turf.area(poly) * 10.7639;
  } catch(e) {}
}

/** If the volume is a TOWER (above a podium), clamp its polygon inside the podium footprint */
function smClampTowerInsidePodium(vol, candidateCoords){
  // Only apply if there's another volume that this tower sits on (the podium)
  // Heuristic: any volume whose customPoly contains this volume's center
  if(!candidateCoords || candidateCoords.length < 3) return candidateCoords;
  var podium = smVolumes.find(function(v){
    if(v.id === vol.id) return false;
    if(!v.customPoly || v.customPoly.length < 3) return false;
    try {
      var pp = turf.polygon([v.customPoly]);
      var center = turf.point(vol.lngLat);
      return turf.booleanPointInPolygon(center, pp);
    } catch(e) { return false; }
  });
  if(!podium || !podium.customPoly) return candidateCoords;
  // Use turf.intersect to clip the candidate to the podium polygon.
  // Turf v7 requires a FeatureCollection. The two-arg form returned null
  // silently in v7 — fall back to it for older turf in case it gets bundled.
  try {
    var candidatePoly = turf.polygon([candidateCoords]);
    var podiumPoly = turf.polygon([podium.customPoly]);
    var clipped = null;
    try { clipped = turf.intersect(turf.featureCollection([candidatePoly, podiumPoly])); }
    catch(e7){ try { clipped = turf.intersect(candidatePoly, podiumPoly); } catch(e6){ clipped = null; } }
    if(clipped && clipped.geometry && clipped.geometry.coordinates && clipped.geometry.coordinates[0]){
      return clipped.geometry.coordinates[0];
    }
  } catch(e) { /* fall through */ }
  return candidateCoords;
}

/** Enter polygon resize mode — adds 4 corner handles that scale the polygon */
function smEnterPolyResize(volId){
  smExitShapeEdit();
  var vol = smVolumes.find(function(v){ return v.id === volId; });
  if(!vol || !vol.customPoly || vol.customPoly.length < 3){
    smShowToast('Resize requires a polygon volume','#e8c87a');
    return;
  }
  _smShapeEditId = volId;

  function buildHandles(){
    // Wipe existing handles before rebuilding
    _smShapeHandles.forEach(function(m){ try { m.remove(); } catch(e) {} });
    _smShapeHandles = [];

    var corners = smPolyCornerHandles(vol.customPoly);
    if(!corners) return;
    var dirs = [
      {key: 'nw', gps: corners.nw, anchor: corners.se, cursor: 'nwse-resize'},
      {key: 'ne', gps: corners.ne, anchor: corners.sw, cursor: 'nesw-resize'},
      {key: 'sw', gps: corners.sw, anchor: corners.ne, cursor: 'nesw-resize'},
      {key: 'se', gps: corners.se, anchor: corners.nw, cursor: 'nwse-resize'},
    ];
    dirs.forEach(function(d){
      var el = document.createElement('div');
      el.style.cssText = 'width:18px;height:18px;background:#fff;border:2px solid ' + (vol.color || '#AEBC46') +
        ';border-radius:3px;cursor:' + d.cursor + ';box-shadow:0 1px 4px rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;font-size:10px;color:#333;font-weight:700';
      el.textContent = '⤡';
      el.title = 'Drag to resize (opposite corner anchored)';
      var marker = new mapboxgl.Marker({element: el, draggable: true, anchor: 'center'})
        .setLngLat(d.gps).addTo(smMap);

      // Capture the original bbox so scaling is proportional from anchor
      var startBBox = smPolyBBox(vol.customPoly);
      var startCoords = vol.customPoly.map(function(p){ return [p[0], p[1]]; });
      var anchor = d.anchor;
      var startDragLng = d.gps[0], startDragLat = d.gps[1];

      marker.on('dragstart', function(){
        // Re-snapshot in case other operations happened
        startCoords = vol.customPoly.map(function(p){ return [p[0], p[1]]; });
        startBBox = smPolyBBox(startCoords);
        var c = smPolyCornerHandles(startCoords);
        anchor = c[d.key === 'nw' ? 'se' : d.key === 'ne' ? 'sw' : d.key === 'sw' ? 'ne' : 'nw'];
      });

      marker.on('drag', function(){
        var ll = marker.getLngLat();
        // Compute scale factors based on new corner distance from anchor vs original
        var origDx = startDragLng - anchor[0];
        var origDy = startDragLat - anchor[1];
        var newDx  = ll.lng - anchor[0];
        var newDy  = ll.lat - anchor[1];
        // Avoid division by zero / sign flip
        var sx = Math.abs(origDx) > 1e-8 ? (newDx / origDx) : 1;
        var sy = Math.abs(origDy) > 1e-8 ? (newDy / origDy) : 1;
        // Clamp to reasonable bounds — prevent tiny or inverted polygons
        sx = Math.max(0.1, Math.min(5.0, sx));
        sy = Math.max(0.1, Math.min(5.0, sy));
        var scaled = smScalePolygon(startCoords, anchor[0], anchor[1], sx, sy);
        // Clamp tower inside podium if applicable
        var finalCoords = smClampTowerInsidePodium(vol, scaled);
        smApplyScaledPoly(vol, finalCoords);
        // Live update map
        smDrawVolume(vol);
        // Reposition handles in real time
        buildHandles();
      });

      marker.on('dragend', function(){
        smConformEdges(vol);
        smUpdateShapeGeo(vol);
        smRenderVolPanel();
        smAutoSync();
        buildHandles();
      });

      _smShapeHandles.push(marker);
    });
  }
  buildHandles();
  smShowToast('Drag the corner handles to resize • Click another building to exit','#AEBC46');
}

// ── Update shape param from panel input ──
function smUpdateShapeParam(volId,key,val){
  const vol=smVolumes.find(v=>v.id===volId);
  if(!vol||!vol.shapeParams)return;
  vol.shapeParams[key]=parseFloat(val)||0;
  // Clamp wing/court dimensions
  const p=vol.shapeParams, t=vol.shapeType;
  if(t==='lshape'){p.ww=Math.min(p.ww,p.w-2);p.wd=Math.min(p.wd,p.d-2);}
  if(t==='ushape'){p.cw=Math.min(p.cw,p.w-4);p.cd=Math.min(p.cd,p.d-4);}
  if(t==='tshape'){p.sw=Math.min(p.sw,p.tw-2);}
  smRegenerateShapePoly(vol);
  smConformEdges(vol);
  smUpdateShapeGeo(vol);
  smDrawVolume(vol);
  smAutoSync();
  if(_smShapeEditId===volId) smEnterShapeEdit(volId);
}

// ── Readable shape name ──
function smShapeLabel(type){
  return {rect:'Rectangle',square:'Square',lshape:'L-Shape',ushape:'U-Shape',tshape:'T-Shape'}[type]||'Shape';
}

// ── Generate dimension inputs for shape param editing ──
function smShapeDimInputs(vol){
  const p=vol.shapeParams, t=vol.shapeType, id=vol.id;
  const si=`background:#1A1A1A;border:1px solid #333333;color:#AEBC46;padding:3px 6px;border-radius:3px;font-size:11px;width:100%`;
  const sinp=(key,val,label)=>`<label style="color:#777">${label}</label><input type="number" value="${Math.round(val)}" min="2" max="200" style="${si}" onchange="smUpdateShapeParam(${id},'${key}',this.value)">`;
  let html='';
  if(t==='rect'){
    html+=sinp('w',p.w,'Width (m)');
    html+=sinp('d',p.d,'Depth (m)');
  } else if(t==='square'){
    html+=sinp('s',p.s,'Side (m)');
  } else if(t==='lshape'){
    html+=sinp('w',p.w,'Total Width (m)');
    html+=sinp('d',p.d,'Total Depth (m)');
    html+=sinp('ww',p.ww,'Arm Width (m)');
    html+=sinp('wd',p.wd,'Base Depth (m)');
  } else if(t==='ushape'){
    html+=sinp('w',p.w,'Total Width (m)');
    html+=sinp('d',p.d,'Total Depth (m)');
    html+=sinp('cw',p.cw,'Court Width (m)');
    html+=sinp('cd',p.cd,'Court Depth (m)');
  } else if(t==='tshape'){
    html+=sinp('tw',p.tw,'Bar Width (m)');
    html+=sinp('td',p.td,'Bar Depth (m)');
    html+=sinp('sw',p.sw,'Stem Width (m)');
    html+=sinp('sd',p.sd,'Stem Depth (m)');
  }
  html+=`<label style="color:#777">Footprint</label><span style="color:#AEBC46;font-size:11px;font-weight:600;padding:3px 0">${(vol.customAreaSF||0).toLocaleString()} sf</span>`;
  return html;
}

// ── Convert parametric shape to freeform polygon (loses shape params, gains full vertex control) ──
function smConvertToFreeform(volId){
  const vol=smVolumes.find(v=>v.id===volId);
  if(!vol||!vol.shapeType)return;
  smExitShapeEdit();
  vol.shapeType=null;
  vol.shapeParams=null;
  smUpdateShapeGeo(vol);
  smRenderVolPanel();
  smAutoSync();
  smShowToast('Converted to freeform — use EDIT SHAPE for vertex control','#4ecdc4');
}

function smDrawVolume(vol){
  const sourceId='smvol-'+vol.id;
  const fillId='smvol-fill-'+vol.id;
  const lineId='smvol-line-'+vol.id;
  const dimId='smvol-dims-'+vol.id;
  const labelId='smvol-label-'+vol.id;

  // Build polygon data
  const poly=vol.customPoly
    ?{type:'Feature',geometry:{type:'Polygon',coordinates:[vol.customPoly]},properties:{id:vol.id}}
    :smVolToGeoJSON(vol);

  // Update or create polygon layers (no remove/re-add)
  if(smMap.getSource(sourceId)){
    smMap.getSource(sourceId).setData(poly);
  } else {
    smMap.addSource(sourceId,{type:'geojson',data:poly});
    smMap.addLayer({id:fillId,type:'fill',source:sourceId,paint:{'fill-color':vol.color,'fill-opacity':0.4}});
    smMap.addLayer({id:lineId,type:'line',source:sourceId,paint:{'line-color':vol.color,'line-width':3}});
  }

  // Dimension labels on edges
  if(vol.customPoly&&vol.customPoly.length>=3){
    const dimFeatures=[];
    for(let i=0;i<vol.customPoly.length-1;i++){
      const a=vol.customPoly[i],b=vol.customPoly[i+1];
      const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
      const dFt=Math.round(dM*3.28084);
      if(dFt<3)continue;
      dimFeatures.push({type:'Feature',geometry:{type:'Point',coordinates:[(a[0]+b[0])/2,(a[1]+b[1])/2]},properties:{label:dFt+"'"}});
    }
    const dimData={type:'FeatureCollection',features:dimFeatures};
    if(smMap.getSource(dimId)){smMap.getSource(dimId).setData(dimData);}
    else{
      smMap.addSource(dimId,{type:'geojson',data:dimData});
      smMap.addLayer({id:dimId,type:'symbol',source:dimId,layout:{'text-field':['get','label'],'text-size':10,'text-font':['Open Sans Bold'],'text-allow-overlap':true,'text-offset':[0,-0.8]},paint:{'text-color':'#fff','text-halo-color':vol.color,'text-halo-width':1.5}});
    }
  }

  // Center marker — reuse if exists, only recreate if needed
  const isSel=smSelectedVolId===vol.id;
  if(vol.marker){
    // Just reposition and restyle — don't destroy/recreate
    vol.marker.setLngLat(vol.lngLat);
    const mEl=vol.marker.getElement();
    if(mEl){
      mEl.style.width=(isSel?30:24)+'px';
      mEl.style.height=(isSel?30:24)+'px';
      mEl.style.border=isSel?'3px solid #AEBC46':'2px solid #fff';
      mEl.style.fontSize=(isSel?12:10)+'px';
    }
  } else {
    const el=document.createElement('div');
    el.style.cssText=`width:${isSel?30:24}px;height:${isSel?30:24}px;background:${vol.color};border:${isSel?'3px solid #AEBC46':'2px solid #fff'};border-radius:50%;cursor:grab;display:flex;align-items:center;justify-content:center;font-size:${isSel?12:10}px;font-weight:700;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,0.5)`;
    el.textContent=vol.name;
    el.title='Drag to move · Click to select · Shift+Arrow to rotate';
    el.addEventListener('click',(e)=>{
      e.stopPropagation();
      smSelectedVolId=vol.id;
      smVolumes.forEach(v=>smDrawVolume(v));
      smRenderVolPanel();
    });
    vol.marker=new mapboxgl.Marker({element:el,draggable:true,anchor:'center'})
      .setLngLat(vol.lngLat).addTo(smMap);
    // ── Drag: real-time polygon follow + edge conforming ──
    vol.marker.on('dragstart',()=>{
      vol._prevLngLat=[...vol.lngLat];
      vol._dragRaf=null;
    });
    vol.marker.on('drag',()=>{
      if(vol._dragRaf)return; // throttle to 1 update per animation frame
      vol._dragRaf=requestAnimationFrame(()=>{
        vol._dragRaf=null;
        const ll=vol.marker.getLngLat();
        vol.lngLat=[ll.lng,ll.lat];
        if(vol.shapeType) smRegenerateShapePoly(vol, true); // skipArea during drag
        else if(vol.customPoly) smTranslateCustomPoly(vol,[ll.lng,ll.lat]);
        smConformEdges(vol); // reshape edges to match nearby lot/building edges
        smUpdateShapeGeo(vol, true); // skipDims during drag
        // Update label
        const lid='smvol-label-'+vol.id;
        try{if(smMap.getSource(lid))smMap.getSource(lid).setData({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:vol.lngLat},properties:{label:vol.name+' ('+vol.storeys+'F)'}}]});}catch(e){}
        if(_smShapeEditId===vol.id) smRepositionResizeHandles(vol);
      });
    });
    vol.marker.on('dragend',()=>{
      if(vol._dragRaf){cancelAnimationFrame(vol._dragRaf);vol._dragRaf=null;}
      const ll=vol.marker.getLngLat();
      vol.lngLat=[ll.lng,ll.lat];
      if(vol.shapeType) smRegenerateShapePoly(vol);
      else if(vol.customPoly) smTranslateCustomPoly(vol,[ll.lng,ll.lat]);
      smConformEdges(vol); // reshape edges to match nearby lot/building edges
      smUpdateShapeGeo(vol);
      smAutoSync();
      delete vol._prevLngLat;
      if(_smShapeEditId===vol.id) smEnterShapeEdit(vol.id);
    });
  }

  // Label on polygon — update or create
  const labelData={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:vol.lngLat},properties:{label:vol.name+' ('+vol.storeys+'F)'}}]};
  if(smMap.getSource(labelId)){
    smMap.getSource(labelId).setData(labelData);
  } else {
    smMap.addSource(labelId,{type:'geojson',data:labelData});
    smMap.addLayer({id:labelId,type:'symbol',source:labelId,layout:{'text-field':['get','label'],'text-size':11,'text-font':['Open Sans Bold'],'text-allow-overlap':true},paint:{'text-color':'#fff','text-halo-color':'rgba(0,0,0,0.8)','text-halo-width':1.5}});
  }
}

function smVolToGeoJSON(vol){
  const [lng,lat]=vol.lngLat;
  const halfW=vol.widthFt*0.3048/2;
  const halfD=vol.depthFt*0.3048/2;
  const angleRad=vol.angle*Math.PI/180;

  // Corner offsets in meters (before rotation)
  const corners=[[-halfW,-halfD],[halfW,-halfD],[halfW,halfD],[-halfW,halfD]];

  // Rotate and convert to lng/lat
  const mPerDegLat=111132;
  const mPerDegLng=111132*Math.cos(lat*Math.PI/180);

  const pts=corners.map(([dx,dz])=>{
    const rx=dx*Math.cos(angleRad)-dz*Math.sin(angleRad);
    const rz=dx*Math.sin(angleRad)+dz*Math.cos(angleRad);
    return [lng+rx/mPerDegLng, lat+rz/mPerDegLat];
  });
  pts.push(pts[0]); // close

  return {type:'Feature',geometry:{type:'Polygon',coordinates:[pts]},properties:{id:vol.id}};
}

function smRemoveVolGeo(vol){
  const sourceId='smvol-'+vol.id;
  const fillId='smvol-fill-'+vol.id;
  const lineId='smvol-line-'+vol.id;
  const labelId='smvol-label-'+vol.id;
  const dimId='smvol-dims-'+vol.id;
  [fillId,lineId,labelId,dimId].forEach(id=>{try{if(smMap.getLayer(id))smMap.removeLayer(id);}catch(e){}});
  [sourceId,labelId,dimId].forEach(id=>{try{if(smMap.getSource(id))smMap.removeSource(id);}catch(e){}});
  if(vol.marker){vol.marker.remove();vol.marker=null;}
}

function smDeleteVolume(id){
  if(_smShapeEditId===id) smExitShapeEdit();
  const idx=smVolumes.findIndex(v=>v.id===id);
  if(idx<0)return;
  const vol=smVolumes[idx];
  // Clean up map layers, source, and marker
  smRemoveVolGeo(vol);
  smVolumes.splice(idx,1);
  if(smSelectedVolId===id) smSelectedVolId=smVolumes.length>0?smVolumes[0].id:null;
  // Defer panel rebuild to avoid DOM conflicts with click event chain
  setTimeout(()=>{
    smRenderVolPanel();
    smAutoSync();
  },0);
}

function smRenderVolPanel(){
  const list=document.getElementById('sitemap-vol-list');
  if(!list)return;
  list.innerHTML='';

  smVolumes.forEach(vol=>{
    const isSel=smSelectedVolId===vol.id;
    const card=document.createElement('div');
    card.style.cssText=`background:${isSel?'#1a1a3a':'#1A1A1A'};border:1px solid ${isSel?vol.color:vol.color+'44'};border-left:3px solid ${vol.color};border-radius:4px;padding:8px;margin-bottom:6px;cursor:pointer;transition:all 0.15s`;
    card.onclick=(e)=>{if(e.target.closest('button')||e.target.tagName==='INPUT')return;smSelectedVolId=vol.id;smVolumes.forEach(v=>smDrawVolume(v));smRenderVolPanel();};

    const fp=vol.customPoly?vol.customAreaSF:(vol.widthFt*vol.depthFt);
    const rawGFA=fp*vol.storeys;
    // Compute overlap using actual polygon geometry
    let overlapSF=0;
    smVolumes.forEach(other=>{
      if(other.id===vol.id)return;
      try{
        const polyA=vol.customPoly
          ?turf.polygon([vol.customPoly])
          :smVolToGeoJSON(vol);
        const polyB=other.customPoly
          ?turf.polygon([other.customPoly])
          :smVolToGeoJSON(other);
        const inter=turf.intersect(turf.featureCollection([polyA,polyB]));
        if(inter){
          const areaSqFt=turf.area(inter)*10.7639;
          const commonSt=Math.min(vol.storeys,other.storeys);
          overlapSF+=areaSqFt*commonSt;
        }
      }catch(e){}
    });
    const netGFA=rawGFA-overlapSF;

    const inp=(key,val,min,max,isCheck)=>{
      if(isCheck) return `<input type="checkbox" ${val?'checked':''} style="accent-color:#AEBC46;width:16px;height:16px" onchange="smUpdateVol(${vol.id},'${key}',this.checked?1:0)">`;
      return `<input type="number" value="${val}" min="${min}" max="${max}" style="background:#1A1A1A;border:1px solid #333333;color:#AEBC46;padding:3px 6px;border-radius:3px;font-size:11px;width:100%" onchange="smUpdateVol(${vol.id},'${key}',this.value)">`;
    };

    // Compute lot area for coverage %
    let lotAreaSF=0;
    if(smLotData){try{lotAreaSF=turf.area(smLotData.geometry)*10.7639;}catch(e){}}
    const coveragePct=lotAreaSF>0?((fp/lotAreaSF)*100).toFixed(1):0;
    card.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="color:${vol.color};font-weight:700;font-size:12px">${isSel?'▸ ':''}VOL ${vol.name}</span>
        <div style="display:flex;gap:4px;align-items:center">
          ${isSel?'<span style="font-size:9px;color:#AEBC46;background:#AEBC4622;padding:1px 6px;border-radius:3px">SELECTED</span>':''}
          <button onclick="event.stopPropagation();smDeleteVolume(${vol.id})" style="background:#c44;color:#fff;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:10px">X</button>
        </div>
      </div>

      <div style="font-size:9px;color:#777;letter-spacing:1px;margin:4px 0 2px;font-weight:600">DIMENSIONS ${vol.shapeType?'<span style="color:#AEBC46;font-weight:400">('+smShapeLabel(vol.shapeType)+')</span>':vol.customPoly?'<span style="color:#AEBC46;font-weight:400">(freeform polygon)</span>':''}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
        ${vol.shapeType?smShapeDimInputs(vol)
          :vol.customPoly
          ?`<label style="color:#777">Footprint</label><span style="color:#AEBC46;font-size:11px;font-weight:600;padding:3px 0">${vol.customAreaSF.toLocaleString()} sf</span>
             <label style="color:#777">Vertices</label><span style="color:#888;font-size:11px;padding:3px 0">${vol.customPoly.length-1} pts</span>`
          :`<label style="color:#777">Width (ft)</label>${inp('widthFt',vol.widthFt,10,300)}
             <label style="color:#777">Depth (ft)</label>${inp('depthFt',vol.depthFt,10,300)}
             <label style="color:#777">Angle (°)</label>${inp('angle',vol.angle,0,360)}`}
        <label style="color:#777">Storeys</label>${inp('storeys',vol.storeys,1,40)}
        <label style="color:#777">Comm. GF</label>${inp('commGF',vol.commGF,0,0,true)}
        ${vol.shapeType?`<label style="color:#777">Angle (°)</label>${inp('angle',vol.angle,0,360)}`:''}
      </div>

      <div style="font-size:9px;color:#777;letter-spacing:1px;margin:6px 0 2px;font-weight:600">FACADE</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
        <label style="color:#777">Windows</label>${inp('windows',vol.windows,0,0,true)}
        <label style="color:#777">Win Spacing (ft)</label>${inp('winSpacing',vol.winSpacing,1,10)}
      </div>

      <div style="font-size:9px;color:#777;letter-spacing:1px;margin:6px 0 2px;font-weight:600">BALCONIES</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:10px">
        <label style="color:#777">Every N floors</label>${inp('balcEvery',vol.balcEvery,1,10)}
        <label style="color:#777">Depth (ft)</label>${inp('balcDepth',vol.balcDepth,1,8)}
        <label style="color:#777">Front</label>${inp('balcFront',vol.balcFront,0,0,true)}
        <label style="color:#777">Back</label>${inp('balcBack',vol.balcBack,0,0,true)}
        <label style="color:#777">Left</label>${inp('balcLeft',vol.balcLeft,0,0,true)}
        <label style="color:#777">Right</label>${inp('balcRight',vol.balcRight,0,0,true)}
      </div>

      <div style="margin-top:6px;padding-top:4px;border-top:1px solid #333333;font-size:10px;color:#777">
          Floor plate: <b style="color:#AEBC46">${fp.toLocaleString()} sf</b> ·
          Gross GFA: <b style="color:#AEBC46">${rawGFA.toLocaleString()} sf</b>
          ${overlapSF>10?`<br><span style="color:#ff6644">⚠ Overlap: ${Math.round(overlapSF).toLocaleString()} sf deducted</span><br>Net GFA: <b style="color:#AEBC46">${Math.round(netGFA).toLocaleString()} sf</b>`:'<br><span style="color:#4a8">✓ No overlap</span>'}
      </div>
      ${vol.shapeType?`<div style="margin-top:4px;display:flex;gap:4px">
        <button onclick="event.stopPropagation();smEnterShapeEdit(${vol.id})" style="flex:1;background:#444444;color:#AEBC46;border:1px solid #AEBC4644;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px;font-weight:600">${_smShapeEditId===vol.id?'✓ EDITING':'🔧 EDIT HANDLES'}</button>
        <button onclick="event.stopPropagation();smConvertToFreeform(${vol.id})" style="flex:1;background:#444444;color:#888;border:1px solid #333333;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px">✏️ TO FREEFORM</button>
      </div>`
      :vol.customPoly?`<div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">
        <button onclick="event.stopPropagation();smEnterPolyResize(${vol.id})" style="flex:1;min-width:60px;background:${_smShapeEditId===vol.id?'#AEBC46':'#444444'};color:${_smShapeEditId===vol.id?'#111':'#AEBC46'};border:1px solid #AEBC4644;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px;font-weight:700">${_smShapeEditId===vol.id?'✓ RESIZING':'⬄ RESIZE'}</button>
        <button onclick="event.stopPropagation();smEditBldgPoly(${vol.id})" style="flex:1;min-width:60px;background:#444444;color:#AEBC46;border:1px solid #AEBC4644;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px;font-weight:600">✏️ EDIT VERTICES</button>
        <button onclick="event.stopPropagation();smResetToRect(${vol.id})" style="flex:1;min-width:60px;background:#444444;color:#888;border:1px solid #333333;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:10px">⬜ TO RECT</button>
      </div>`:''}
      ${isSel?`<div style="margin-top:4px;font-size:9px;color:#777;text-align:center">${vol.shapeType?'Shift + ← → to rotate · Drag handles to resize':'Click RESIZE to drag corners · Shift + ← → to rotate'} · Drag marker to move</div>`:''}`;
    list.appendChild(card);
  });
  // Update phase button visibility
  if(typeof smUpdatePhaseButton==='function') smUpdatePhaseButton();
}

function smUpdateVol(id,key,val){
  const vol=smVolumes.find(v=>v.id===id);
  if(!vol)return;
  vol[key]=typeof val==='string'?parseFloat(val):val;
  // Regenerate shape polygon if angle changed on a shape-builder volume
  if(vol.shapeType&&(key==='angle')){
    smRegenerateShapePoly(vol);
    smConformEdges(vol);
    if(_smShapeEditId===id) smEnterShapeEdit(id);
  }
  smDrawVolume(vol);
  smRenderVolPanel();
  smAutoSync();
}

// Compute overlap-adjusted GFA across all map volumes
function smComputeTotals(){
  let rawGFA=0, commGFA=0, totalOverlap=0;
  smVolumes.forEach((vol,i)=>{
    const fp=vol.customPoly?vol.customAreaSF:(vol.widthFt*vol.depthFt);
    rawGFA+=fp*vol.storeys;
    if(vol.commGF) commGFA+=fp;
    // Overlap with volumes already counted
    for(let j=0;j<i;j++){
      try{
        const polyA=vol.customPoly?turf.polygon([vol.customPoly]):smVolToGeoJSON(vol);
        const polyB=smVolumes[j].customPoly?turf.polygon([smVolumes[j].customPoly]):smVolToGeoJSON(smVolumes[j]);
        const inter=turf.intersect(turf.featureCollection([polyA,polyB]));
        if(inter){
          const areaSqFt=turf.area(inter)*10.7639;
          const commonSt=Math.min(vol.storeys,smVolumes[j].storeys);
          totalOverlap+=areaSqFt*commonSt;
        }
      }catch(e){}
    }
  });
  const netGFA=rawGFA-totalOverlap;
  const resiGFA=netGFA-commGFA;
  const lotA=smLotData?Math.round(smLotData.areaSqFt):1;
  return {rawGFA,netGFA,commGFA,resiGFA,totalOverlap,fsi:netGFA/lotA,units:Math.round(Math.max(0,resiGFA)*0.82/650),lotA};
}

function smUpdateVolStats(){
  const el=document.getElementById('sitemap-vol-stats');
  if(!el)return;
  if(smVolumes.length===0){el.innerHTML='';return;}
  const t=smComputeTotals();

  el.innerHTML=`
  <div style="background:#1A1A1A;border-radius:4px;padding:8px;border:1px solid #333333">
    <div style="font-size:10px;font-weight:600;letter-spacing:1px;color:#AEBC46;margin-bottom:6px">PROJECT STATS (LIVE)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px;font-size:11px">
      <span style="color:#777">Gross GFA:</span><span style="color:#888">${Math.round(t.rawGFA).toLocaleString()} sf</span>
      ${t.totalOverlap>10?`<span style="color:#ff6644">Overlap:</span><span style="color:#ff6644">-${Math.round(t.totalOverlap).toLocaleString()} sf</span>`:''}
      <span style="color:#777">Net GFA:</span><span style="color:#AEBC46;font-weight:700">${Math.round(t.netGFA).toLocaleString()} sf</span>
      <span style="color:#777">Commercial:</span><span style="color:#AEBC46">${Math.round(t.commGFA).toLocaleString()} sf</span>
      <span style="color:#777">Residential:</span><span style="color:#AEBC46">${Math.round(t.resiGFA).toLocaleString()} sf</span>
      <span style="color:#777">FSI:</span><span style="color:#AEBC46;font-weight:600">${t.fsi.toFixed(1)}x</span>
      <span style="color:#777">Est. Units:</span><span style="color:#AEBC46">${t.units}</span>
      <span style="color:#777">Volumes:</span><span style="color:#AEBC46">${smVolumes.length}</span>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════
//  ZONING AUTO-DETECT — Toronto Zoning By-law 569-2013
// ═══════════════════════════════════════════════════════════
const ZONING_URLS={
  area:'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/d75fa1ed-cd04-4a0b-bb6d-2b928ffffa6e/download/zoning-area-4326.geojson',
  height:'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/eec27e60-7c2d-4c46-8fa1-b64f441bcc39/download/zoning-height-overlay-4326.geojson',
  lotCov:'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/d8a64423-8754-46f3-aa28-d78d1b639ed6/download/zoning-lot-coverage-overlay-4326.geojson',
  policy:'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/34927e44-fc11-4336-a8aa-a0dfb27658b7/resource/a4502214-9441-4299-9f50-ecd5a5e4de35/download/zoning-policy-area-overlay-4326.geojson'
};
let _zoningCache={area:null,height:null,lotCov:null,policy:null};
let _zoningLoading=false;
let _zoningOverlayVisible=false;

// Load zoning GeoJSON data (cached per session)
async function loadZoningData(layer){
  if(_zoningCache[layer])return _zoningCache[layer];
  try{
    const resp=await fetch(ZONING_URLS[layer]);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    const data=await resp.json();
    _zoningCache[layer]=data;
    return data;
  }catch(e){
    console.warn('Failed to load zoning '+layer+':',e.message);
    return null;
  }
}

// Toggle zoning overlay on the Mapbox map
let _zoningPopup=null;
