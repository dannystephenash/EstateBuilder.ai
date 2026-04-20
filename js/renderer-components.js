// renderer-components.js — Rebuild orchestration, environment, textures, materials, building renderer, lighting, vol panel
let _rebuildTimer=null;
let _rebuildRunning=false;
/**
 * Debounced entry point that triggers a full scene rebuild after a short delay.
 */
function rebuildAll(){
  // Debounce: collapse rapid calls into one
  if(_rebuildTimer){clearTimeout(_rebuildTimer);}
  _rebuildTimer=setTimeout(_doRebuild,30);
}
function _doRebuild(){
  _rebuildTimer=null;
  if(_rebuildRunning)return; // prevent re-entrant calls
  _rebuildRunning=true;
  _pfCache=null; // invalidate cached pro-forma data
  try{ rebuildEnvironment(); }catch(e){ console.error('rebuildEnvironment error:',e); }
  try{ rebuildLot(); }catch(e){ console.error('rebuildLot error:',e); }
  try{ rebuildSetbacks(); }catch(e){ console.error('rebuildSetbacks error:',e); }
  try{ rebuildBuilding(); }catch(e){ console.error('rebuildBuilding error:',e); }
  try{ if(typeof _phRebuild === 'function') _phRebuild(); }catch(e){ console.error('_phRebuild error:',e); }
  try{ rebuildLabels(); }catch(e){ console.error('rebuildLabels error:',e); }
  try{ computeAngularPlanes(); renderAngularPlanes(); }catch(e){ console.error('angularPlanes error:',e); }
  try{ updateStats(); }catch(e){ console.error('updateStats error:',e); }
  try{ updateVolInfo(); }catch(e){ console.error('updateVolInfo error:',e); }
  try{ drawSection(); }catch(e){ console.error('drawSection error:',e); }
  try{ updateUnitSummary(); }catch(e){ console.error('updateUnitSummary error:',e); }
  try{ buildFloorSchedule(); }catch(e){ console.error('buildFloorSchedule error:',e); }
  try{
    if(document.getElementById('tab-units')&&document.getElementById('tab-units').classList.contains('active')){
      renderUnitEditor();
    }
  }catch(e){ console.error('renderUnitEditor error:',e); }
  try{ updateInfoBar(); }catch(e){ console.error('updateInfoBar error:',e); }
  try{ updateProForma(); }catch(e){ console.error('updateProForma error:',e); }
  try{ renderReport(); }catch(e){ console.error('renderReport error:',e); }
  try{ if(sec3d.group){ buildSection3DModel(); updateSection3DStats(); } }catch(e){ console.error('section3D error:',e); }
  try{ autoSave(); }catch(e){ console.error('autoSave error:',e); }
  _rebuildRunning=false;
}

/**
 * Clears and rebuilds the environment group (ground plane, roads, landscape items).
 */
function rebuildEnvironment(){
  clearGroup('env');
  const g=groups.env;
  if(!Array.isArray(P.roads)) P.roads=[];
  if(!Array.isArray(P.landscape)) P.landscape=[];

  // Lot bounding box (compute first so ground plane can be centered)
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]), allZ=vts.map(v=>v[1]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const lotMinZ=Math.min(...allZ), lotMaxZ=Math.max(...allZ);
  const cx=f2m((lotMinX+lotMaxX)/2);
  const cz=f2m((lotMinZ+lotMaxZ)/2);

  // Ground plane — centered on lot
  const groundSize=Math.max(300, f2m(Math.max(lotMaxX-lotMinX, lotMaxZ-lotMinZ))*3);
  const ground=new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize,groundSize),
    new THREE.MeshStandardMaterial({color:0x383530,roughness:0.92})
  );
  ground.rotation.x=-Math.PI/2;
  ground.position.set(cx,-0.05,cz);
  ground.receiveShadow=true;
  g.add(ground);

  // ── ROADS (dynamic array, togglable) ──
  if(P._showRoads===false){/* skip roads */} else {
  P.roads.forEach(rd=>{
    const roadW=f2m(rd.width);
    const angleRad=rd.angle*Math.PI/180;
    let rX=cx, rZ=0;
    if(rd.side==='north') rZ=f2m(lotMinZ)+f2m(rd.offZ)-roadW/2;
    else if(rd.side==='south') rZ=f2m(lotMaxZ)+f2m(rd.offZ)+roadW/2;
    else if(rd.side==='east'){ rX=f2m(lotMaxX)+f2m(rd.offZ)+roadW/2; rZ=cz; }
    else if(rd.side==='west'){ rX=f2m(lotMinX)+f2m(rd.offZ)-roadW/2; rZ=cz; }

    const roadGrp=new THREE.Group();
    const isEW=(rd.side==='east'||rd.side==='west');
    const roadLen=150;

    // Road surface
    const rGeo=new THREE.PlaneGeometry(isEW?roadW:roadLen, isEW?roadLen:roadW);
    const rMesh=new THREE.Mesh(rGeo,new THREE.MeshStandardMaterial({color:'#333340',roughness:0.8}));
    rMesh.rotation.x=-Math.PI/2;
    roadGrp.add(rMesh);

    // Centre dashes
    for(let i=-25;i<25;i++){
      const dW=isEW?0.15:1.5, dH=isEW?1.5:0.15;
      const dash=new THREE.Mesh(new THREE.PlaneGeometry(dW,dH),new THREE.MeshBasicMaterial({color:'#AEBC46'}));
      dash.rotation.x=-Math.PI/2;
      dash.position.set(isEW?0:i*3, 0.02, isEW?i*3:0);
      roadGrp.add(dash);
    }

    // Sidewalks
    [-1,1].forEach(s=>{
      const swGeo=isEW?new THREE.PlaneGeometry(2,roadLen):new THREE.PlaneGeometry(roadLen,2);
      const sw=new THREE.Mesh(swGeo,new THREE.MeshStandardMaterial({color:'#555560',roughness:0.7}));
      sw.rotation.x=-Math.PI/2;
      sw.position.set(isEW?s*(roadW/2+1):0, 0.02, isEW?0:s*(roadW/2+1));
      roadGrp.add(sw);
    });

    roadGrp.position.set(rX,0.01,rZ);
    roadGrp.rotation.y=angleRad;
    g.add(roadGrp);

    // Road label (3D text sprite)
    const labelX=isEW?rX:rX;
    const labelZ=isEW?rZ:rZ;
    addTextSprite(g, rd.label, labelX, 0.3, labelZ, '#AEBC46', rd.fontSize/14*0.8);
  });
  } // end if _showRoads

  // ── LANDSCAPE (user-placed trees & bushes) ──
  P.landscape.forEach(item=>{
    const x=f2m(item.x), z=f2m(item.z);
    if(item.type==='tree') addTree(g,x,z);
    else if(item.type==='bush'){
      const shrub=new THREE.Mesh(new THREE.SphereGeometry(0.5,6,6),
        new THREE.MeshStandardMaterial({color:'#2d6b30',roughness:0.8}));
      shrub.position.set(x,0.5,z);shrub.castShadow=true;g.add(shrub);
    } else if(item.type==='tree-row'){
      const count=item.count||5;
      const dx=Math.cos((item.angle||0)*Math.PI/180)*f2m(item.spacing||10);
      const dz=Math.sin((item.angle||0)*Math.PI/180)*f2m(item.spacing||10);
      for(let t=0;t<count;t++) addTree(g,x+t*dx,z+t*dz);
    } else if(item.type==='bush-row'){
      const count=item.count||8;
      const dx=Math.cos((item.angle||0)*Math.PI/180)*f2m(item.spacing||5);
      const dz=Math.sin((item.angle||0)*Math.PI/180)*f2m(item.spacing||5);
      for(let t=0;t<count;t++){
        const s=new THREE.Mesh(new THREE.SphereGeometry(0.4,6,6),
          new THREE.MeshStandardMaterial({color:`hsl(${110+Math.random()*30},50%,${25+Math.random()*12}%)`,roughness:0.8}));
        s.position.set(x+t*dx,0.4,z+t*dz);s.castShadow=true;g.add(s);
      }
    }
  });
}

function addTree(g,x,z){
  const trunk=new THREE.Mesh(
    new THREE.CylinderGeometry(0.15,0.2,2.5,6),
    new THREE.MeshStandardMaterial({color:'#5a4030'})
  );
  trunk.position.set(x,1.25,z);
  trunk.castShadow=true;
  g.add(trunk);
  const canopy=new THREE.Mesh(
    new THREE.SphereGeometry(1.5,8,8),
    new THREE.MeshStandardMaterial({color:'#2d6b30',roughness:0.8})
  );
  canopy.position.set(x,3.5,z);
  canopy.castShadow=true;
  g.add(canopy);
}

function rebuildLot(){
  clearGroup('lot');
  const g=groups.lot;
  const vts=lotVerts();

  // Center camera and lights on lot centroid
  const lb=lotBounds();
  const lotCenterX=f2m((lb.minX+lb.maxX)/2);
  const lotCenterZ=f2m((lb.minZ+lb.maxZ)/2);
  const lotMaxDim=Math.max(f2m(lb.width),f2m(lb.depth));
  if(lotMaxDim>0.5){
    orb.target.set(lotCenterX, 5, lotCenterZ);
    orb.dist=Math.max(30, lotMaxDim*1.8);
    // Move directional light to cover the lot
    const dirLight=scene.children.find(c=>c.isDirectionalLight);
    if(dirLight){
      dirLight.position.set(lotCenterX-20, 40, lotCenterZ-30);
      dirLight.target.position.set(lotCenterX, 0, lotCenterZ);
      dirLight.target.updateMatrixWorld();
      const s=Math.max(60, lotMaxDim*1.2);
      dirLight.shadow.camera.left=-s;dirLight.shadow.camera.right=s;
      dirLight.shadow.camera.top=s;dirLight.shadow.camera.bottom=-s;
      dirLight.shadow.camera.updateProjectionMatrix();
    }
  }

  // Lot outline
  const pts=vts.map(v=>new THREE.Vector3(f2m(v[0]),0.05,f2m(v[1])));
  pts.push(pts[0].clone());
  const lineGeo=new THREE.BufferGeometry().setFromPoints(pts);
  const line=new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:'#AEBC46',linewidth:2}));
  g.add(line);

  // Lot fill (transparent)
  const shape=new THREE.Shape();
  shape.moveTo(f2m(vts[0][0]),f2m(vts[0][1]));
  for(let i=1;i<vts.length;i++) shape.lineTo(f2m(vts[i][0]),f2m(vts[i][1]));
  shape.closePath();
  const fillGeo=new THREE.ShapeGeometry(shape);
  const fill=new THREE.Mesh(fillGeo,new THREE.MeshBasicMaterial({color:'#AEBC46',transparent:true,opacity:0.08}));
  fill.rotation.x=-Math.PI/2;
  fill.position.y=0.03;
  g.add(fill);

  // Dimension labels on lot edges
  for(let i=0;i<vts.length;i++){
    const j=(i+1)%vts.length;
    const dx=vts[j][0]-vts[i][0], dz=vts[j][1]-vts[i][1];
    const len=Math.sqrt(dx*dx+dz*dz);
    if(len<5)continue;
    const mx=f2m((vts[i][0]+vts[j][0])/2);
    const mz=f2m((vts[i][1]+vts[j][1])/2);
    // Offset label outward from lot center
    const cx=f2m(vts.reduce((s,v)=>s+v[0],0)/vts.length);
    const cz=f2m(vts.reduce((s,v)=>s+v[1],0)/vts.length);
    const nx=mx-cx,nz=mz-cz;
    const nd=Math.sqrt(nx*nx+nz*nz)||1;
    addTextSprite(g, Math.round(len)+"'", mx+nx/nd*2.5, 1.5, mz+nz/nd*2.5, '#ffffff', 0.4);
  }
}

function rebuildSetbacks(){
  clearGroup('setbacks');
  const g=groups.setbacks;
  g.visible=false; // hidden by default — toggle via setbacks panel if needed
  const vts=lotVerts();
  const S=P.set;

  // Bail out if lot has insufficient vertices (e.g. after CLEAR LOT before redraw).
  // Without this guard, accessing vts[5] / vts[4] threw "can't access property 0,
  // vts[5] is undefined" which cascaded and broke other rebuild steps.
  if(!Array.isArray(vts) || vts.length < 2) return;

  // Simple dashed setback lines
  // Front (North) setback at z = front
  if(S.front>0 && vts[0] && vts[1]){
    const z=f2m(S.front);
    const pts=[new THREE.Vector3(f2m(vts[0][0])-2,0.06,z),new THREE.Vector3(f2m(vts[1][0])+2,0.06,z)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#ff6644',dashSize:0.5,gapSize:0.3})));
  }
  // Rear (South) setback — needs at least 6 vertices (uses vts[4] and vts[5])
  const maxZ=lotBounds().maxZ;
  if(S.rear>0 && vts.length >= 6 && vts[4] && vts[5]){
    const z=f2m(maxZ-S.rear);
    const pts=[new THREE.Vector3(f2m(vts[5][0])-2,0.06,z),new THREE.Vector3(f2m(vts[4][0])+2,0.06,z)];
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#ff6644',dashSize:0.5,gapSize:0.3})));
    g.children[g.children.length-1].computeLineDistances();
  }
}

// ── Procedural texture generators (canvas-based, no external files) ──
const _texCache={};
let _texCacheSize=0;
function clearTexCache(){
  for(const k in _texCache){if(_texCache[k]&&_texCache[k].dispose)_texCache[k].dispose();delete _texCache[k];}
  _texCacheSize=0;
}
function makeWindowTex(w,h,cols,rows,glassCol,frameCol,spandrelCol){
  const key=`win_${w}_${h}_${cols}_${rows}_${glassCol}`;
  if(_texCache[key]) return _texCache[key];
  const cw2=1024,ch2=1024;
  const cv=document.createElement('canvas');cv.width=cw2;cv.height=ch2;
  const ctx=cv.getContext('2d');
  // Spandrel background
  ctx.fillStyle=spandrelCol||'#c8c0b0';ctx.fillRect(0,0,cw2,ch2);
  const cellW=cw2/cols, cellH=ch2/rows;
  const pad=Math.round(cw2/cols*0.08), framePx=Math.max(2,Math.round(cw2/cols*0.04));
  const mullion=Math.max(1,Math.round(framePx*0.5));
  for(let r=0;r<rows;r++){
    // Horizontal spandrel band between floor rows
    const bandH=Math.round(cellH*0.12);
    const bandY=r*cellH;
    const sc=spandrelCol||'#c8c0b0';
    // Darken spandrel band
    ctx.fillStyle=_darkenHex(sc,20);
    ctx.fillRect(0,bandY,cw2,bandH);
    for(let c=0;c<cols;c++){
      const x=c*cellW+pad, y=r*cellH+pad+bandH*0.5, ww=cellW-pad*2, hh=cellH-pad*2-bandH*0.5;
      if(ww<=0||hh<=0)continue;
      // Frame
      ctx.fillStyle=frameCol||'#2a2a2a';ctx.fillRect(x,y,ww,hh);
      // Glass pane with gradient (darker at top, lighter at bottom simulating sky reflection)
      const gx=x+framePx,gy=y+framePx,gw=ww-framePx*2,gh=hh-framePx*2;
      if(gw<=0||gh<=0)continue;
      // Lit interior window? (10-15% chance, warm glow)
      const isLit=Math.random()<0.12;
      if(isLit){
        const litGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
        const warmR=200+Math.floor(Math.random()*55);
        const warmG=160+Math.floor(Math.random()*60);
        const warmB=80+Math.floor(Math.random()*40);
        litGrad.addColorStop(0,`rgba(${warmR},${warmG},${warmB},0.95)`);
        litGrad.addColorStop(1,`rgba(${Math.max(warmR-30,100)},${Math.max(warmG-40,80)},${warmB-20},0.85)`);
        ctx.fillStyle=litGrad;ctx.fillRect(gx,gy,gw,gh);
      } else {
        const glGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
        const gc=glassCol||'#6b8fa8';
        glGrad.addColorStop(0,_darkenHex(gc,15));
        glGrad.addColorStop(0.6,gc);
        glGrad.addColorStop(1,_lightenHex(gc,12));
        ctx.fillStyle=glGrad;ctx.fillRect(gx,gy,gw,gh);
        // Reflection highlight
        ctx.fillStyle='rgba(180,210,240,0.13)';
        ctx.fillRect(gx+2,gy+2,gw*0.35,gh*0.5);
      }
      // Thin mullion lines (vertical center)
      ctx.fillStyle=frameCol||'#2a2a2a';
      ctx.fillRect(gx+Math.floor(gw/2)-Math.floor(mullion/2),gy,mullion,gh);
      // Horizontal mullion at mid-height
      ctx.fillRect(gx,gy+Math.floor(gh*0.45)-Math.floor(mullion/2),gw,mullion);
    }
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}
// Helpers for hex color manipulation
function _darkenHex(hex,amt){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return '#'+[Math.max(r-amt,0),Math.max(g-amt,0),Math.max(b-amt,0)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
function _lightenHex(hex,amt){
  let r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return '#'+[Math.min(r+amt,255),Math.min(g+amt,255),Math.min(b+amt,255)].map(v=>v.toString(16).padStart(2,'0')).join('');
}

function makeBrickTex(w,h){
  const key=`brick_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  const brickW=24,brickH=10,mortarW=2;
  const baseColors=['#8b5e4b','#9a6e5a','#7a5040','#8d6550','#7b5545'];
  // Mortar base
  ctx.fillStyle='#aaa095';ctx.fillRect(0,0,w,h);
  for(let y=0;y<h;y+=brickH+mortarW){
    const offset=(Math.floor(y/(brickH+mortarW))%2)*(brickW/2);
    for(let x=-brickW;x<w+brickW;x+=brickW+mortarW){
      // Per-brick color variation
      const bc=baseColors[Math.floor(Math.random()*baseColors.length)];
      let br=parseInt(bc.slice(1,3),16),bg=parseInt(bc.slice(3,5),16),bb=parseInt(bc.slice(5,7),16);
      const hueShift=Math.floor(Math.random()*10)-5;
      const lightShift=Math.floor(Math.random()*16)-8;
      br=Math.max(0,Math.min(255,br+hueShift+lightShift));
      bg=Math.max(0,Math.min(255,bg+hueShift*0.5+lightShift));
      bb=Math.max(0,Math.min(255,bb+lightShift));
      // Occasional aged/dark brick (5% chance)
      if(Math.random()<0.05){br=Math.floor(br*0.6);bg=Math.floor(bg*0.6);bb=Math.floor(bb*0.6);}
      ctx.fillStyle='rgb('+br+','+bg+','+bb+')';
      ctx.fillRect(x+offset,y,brickW,brickH);
      // Mortar joint shadow at bottom of brick (darker line)
      ctx.fillStyle='rgba(0,0,0,0.15)';
      ctx.fillRect(x+offset,y+brickH-1,brickW,1);
      // Mortar joint shadow at right of brick
      ctx.fillRect(x+offset+brickW-1,y,1,brickH);
    }
  }
  // Subtle noise overlay for texture
  const imgData=ctx.getImageData(0,0,w,h);
  const d=imgData.data;
  for(let i=0;i<d.length;i+=4){
    const n=Math.floor(Math.random()*10)-5;
    d[i]=Math.max(0,Math.min(255,d[i]+n));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+n));
  }
  ctx.putImageData(imgData,0,0);
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeStorefrontTex(w,h){
  const key=`store_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  // Base wall with subtle gradient
  const wallGrad=ctx.createLinearGradient(0,0,0,h);
  wallGrad.addColorStop(0,'#d8d3cb');wallGrad.addColorStop(1,'#ccc7bf');
  ctx.fillStyle=wallGrad;ctx.fillRect(0,0,w,h);
  // Kick plate (bottom 15%) with gradient
  const kickGrad=ctx.createLinearGradient(0,h*0.85,0,h);
  kickGrad.addColorStop(0,'#4a4a4a');kickGrad.addColorStop(1,'#3a3a3a');
  ctx.fillStyle=kickGrad;ctx.fillRect(0,h*0.85,w,h*0.15);
  // Glazing panels
  const panels=Math.max(2,Math.round(w/60));
  const pW=w/panels,pad=4,framePx=3;
  for(let i=0;i<panels;i++){
    const x=i*pW+pad;
    ctx.fillStyle='#1a1a1a';ctx.fillRect(x,h*0.08,pW-pad*2,h*0.76);
    // Glass with reflection gradient
    const gx=x+framePx,gy=h*0.08+framePx,gw=pW-pad*2-framePx*2,gh=h*0.76-framePx*2;
    const glGrad=ctx.createLinearGradient(gx,gy,gx,gy+gh);
    glGrad.addColorStop(0,'#3a6a80');glGrad.addColorStop(0.4,'#4a7a90');glGrad.addColorStop(1,'#5a8a9a');
    ctx.fillStyle=glGrad;ctx.fillRect(gx,gy,gw,gh);
    // Warm interior glow (slightly more vivid)
    ctx.fillStyle='rgba(255,225,140,0.25)';
    ctx.fillRect(gx+4,gy+gh*0.2,gw*0.45,gh*0.65);
    // Transom bar
    ctx.fillStyle='#1a1a1a';
    ctx.fillRect(x,gy+gh*0.85,pW-pad*2,2);
  }
  // Signage band
  ctx.fillStyle='#2e2e2e';ctx.fillRect(0,0,w,h*0.08);
  // Thin line under signage band
  ctx.fillStyle='#555';ctx.fillRect(0,h*0.08-1,w,1);
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeMetalPanelTex(w,h,color){
  const col=color||'#b8bcc0';
  const key=`metal_${w}_${h}_${col}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  ctx.fillStyle=col;ctx.fillRect(0,0,w,h);
  // Horizontal panels with thin reveal lines
  const panelCount=Math.max(4,Math.round(h/30));
  const pH=h/panelCount;
  for(let p=0;p<panelCount;p++){
    const py=p*pH;
    // Subtle gradient per panel (lighter at top edge)
    const r=parseInt(col.slice(1,3),16),g2=parseInt(col.slice(3,5),16),b=parseInt(col.slice(5,7),16);
    const varR=Math.floor(Math.random()*6)-3;
    const panelGrad=ctx.createLinearGradient(0,py,0,py+pH);
    panelGrad.addColorStop(0,`rgb(${Math.min(r+8+varR,255)},${Math.min(g2+8+varR,255)},${Math.min(b+8+varR,255)})`);
    panelGrad.addColorStop(1,`rgb(${Math.max(r-3+varR,0)},${Math.max(g2-3+varR,0)},${Math.max(b-3+varR,0)})`);
    ctx.fillStyle=panelGrad;ctx.fillRect(0,py+1,w,pH-2);
    // Reveal line (dark)
    ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fillRect(0,py,w,1);
    // Light edge at top of panel
    ctx.fillStyle='rgba(255,255,255,0.08)';ctx.fillRect(0,py+1,w,1);
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeConcretePrecastTex(w,h){
  const key=`concrete_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  // Light grey concrete base
  ctx.fillStyle='#c4c4c0';ctx.fillRect(0,0,w,h);
  // Subtle aggregate noise
  const imgData=ctx.getImageData(0,0,w,h);
  const d=imgData.data;
  for(let i=0;i<d.length;i+=4){
    const n=Math.floor(Math.random()*14)-7;
    d[i]=Math.max(0,Math.min(255,d[i]+n));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+n));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+n-2));
  }
  ctx.putImageData(imgData,0,0);
  // Form lines every ~10ft equivalent (horizontal and vertical)
  const formSpacing=Math.round(w/4);
  ctx.strokeStyle='rgba(0,0,0,0.12)';ctx.lineWidth=1;
  for(let fx=formSpacing;fx<w;fx+=formSpacing){
    ctx.beginPath();ctx.moveTo(fx,0);ctx.lineTo(fx,h);ctx.stroke();
  }
  for(let fy=formSpacing;fy<h;fy+=formSpacing){
    ctx.beginPath();ctx.moveTo(0,fy);ctx.lineTo(w,fy);ctx.stroke();
  }
  // Slight discoloration patches
  for(let p=0;p<6;p++){
    const px=Math.random()*w,py=Math.random()*h;
    const pr=20+Math.random()*30;
    ctx.fillStyle=`rgba(${Math.random()>0.5?160:140},${Math.random()>0.5?155:145},${Math.random()>0.5?148:138},0.08)`;
    ctx.beginPath();ctx.arc(px,py,pr,0,Math.PI*2);ctx.fill();
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

function makeGreenRoofTex(w,h){
  const key=`green_${w}_${h}`;
  if(_texCache[key]) return _texCache[key];
  const cv=document.createElement('canvas');cv.width=w;cv.height=h;
  const ctx=cv.getContext('2d');
  ctx.fillStyle='#4a7040';ctx.fillRect(0,0,w,h);
  for(let i=0;i<200;i++){
    ctx.fillStyle=`hsl(${100+Math.random()*40},${40+Math.random()*30}%,${25+Math.random()*20}%)`;
    ctx.beginPath();ctx.arc(Math.random()*w,Math.random()*h,1+Math.random()*3,0,Math.PI*2);ctx.fill();
  }
  const tex=new THREE.CanvasTexture(cv);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  _texCache[key]=tex;
  return tex;
}

// ═══ MATERIAL LIBRARY (module level, reused across rebuilds) ═══
var MAT = {
  // Brick — warm brown heritage brick
  brick: new THREE.MeshStandardMaterial({color:0x8b5e4b, roughness:0.92, metalness:0.01}),
  brickDark: new THREE.MeshStandardMaterial({color:0x5a3d30, roughness:0.95, metalness:0.01}),
  // Concrete — darkened to survive ACES + golden hour without blowing out
  concreteSmooth: new THREE.MeshStandardMaterial({color:0x706860, roughness:0.65, metalness:0.03}),
  concreteDark: new THREE.MeshStandardMaterial({color:0x3a3834, roughness:0.78, metalness:0.04}),
  concreteBoard: new THREE.MeshStandardMaterial({color:0x605a52, roughness:0.9, metalness:0.01}),
  // Metal
  steel: new THREE.MeshStandardMaterial({color:0x6a6a72, roughness:0.28, metalness:0.8}),
  steelDark: new THREE.MeshStandardMaterial({color:0x2e2e34, roughness:0.2, metalness:0.85}),
  corten: new THREE.MeshStandardMaterial({color:0x8b4a2a, roughness:0.7, metalness:0.4}),
  // Wood
  wood: new THREE.MeshStandardMaterial({color:0x9a7a55, roughness:0.75, metalness:0.02}),
  woodDark: new THREE.MeshStandardMaterial({color:0x5a4030, roughness:0.8, metalness:0.02}),
  cedar: new THREE.MeshStandardMaterial({color:0xb08858, roughness:0.7, metalness:0.01}),
  // Glass — blue-tinted reflective
  glass: new THREE.MeshPhysicalMaterial({color:0x8ab8d0, roughness:0.05, metalness:0.3, clearcoat:1.0, clearcoatRoughness:0.02, transparent:true, opacity:0.5, side:THREE.DoubleSide}),
  glassDark: new THREE.MeshPhysicalMaterial({color:0x3a5a6a, roughness:0.08, metalness:0.35, clearcoat:1.0, clearcoatRoughness:0.04, transparent:true, opacity:0.6, side:THREE.DoubleSide}),
  glassSF: new THREE.MeshPhysicalMaterial({color:0x90b8c8, roughness:0.02, metalness:0.2, clearcoat:1.0, transparent:true, opacity:0.4}),
  glassRailing: new THREE.MeshPhysicalMaterial({color:0xc0dde8, roughness:0.01, metalness:0.1, clearcoat:1.0, transparent:true, opacity:0.45, side:THREE.DoubleSide}),
  // Curtain wall
  mullion: new THREE.MeshStandardMaterial({color:0x2e2e34, roughness:0.2, metalness:0.85}),
  spandrel: new THREE.MeshStandardMaterial({color:0x404048, roughness:0.7, metalness:0.06}),
  // Landscape
  greenRoof: new THREE.MeshStandardMaterial({color:0x4a7040, roughness:0.95}),
  planter: new THREE.MeshStandardMaterial({color:0x888078, roughness:0.85, metalness:0.03}),
  shrubA: new THREE.MeshStandardMaterial({color:0x4a7040, roughness:0.95}),
  shrubB: new THREE.MeshStandardMaterial({color:0x2d4a25, roughness:0.92}),
  // Interior
  warmGlow: new THREE.MeshStandardMaterial({color:0xffe0a0, emissive:0xffe0a0, emissiveIntensity:0.3, transparent:true, opacity:0.18, side:THREE.DoubleSide}),
  // Per-unit window glow materials — randomized across building for realistic occupied look.
  // Opacity & emissive intensity are dynamically updated by setLightingPreset().
  // depthWrite:false prevents z-fighting / flickering when orbiting around the building.
  unitGlowWarm: new THREE.MeshStandardMaterial({color:0xffd896, emissive:0xffc070, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  unitGlowCool: new THREE.MeshStandardMaterial({color:0xb8d4ff, emissive:0x90b8ff, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  unitGlowAmber: new THREE.MeshStandardMaterial({color:0xffb060, emissive:0xff8030, emissiveIntensity:0.0, transparent:true, opacity:0.0, side:THREE.DoubleSide, depthWrite:false}),
  // Interior unit "back wall" — visible through curtain wall glass to give units depth
  // Soft warm-cream colour. Emissive intensity controlled by setLightingPreset.
  unitInterior: new THREE.MeshStandardMaterial({color:0xe8d8b8, roughness:0.85, emissive:0xffd896, emissiveIntensity:0.0, side:THREE.DoubleSide}),
  intWall: new THREE.MeshStandardMaterial({color:0xf0ebe0, roughness:0.9, side:THREE.DoubleSide}),
  carpet: new THREE.MeshStandardMaterial({color:0x5a5a62, roughness:0.95}),
  // Furniture
  deskMat: new THREE.MeshStandardMaterial({color:0xb89970, roughness:0.7}),
  chairMat: new THREE.MeshStandardMaterial({color:0x3a3a50, roughness:0.8}),
  sofaMat: new THREE.MeshStandardMaterial({color:0x6a5a50, roughness:0.85}),
  ceilingWhite: new THREE.MeshStandardMaterial({color:0xf8f8f0, roughness:0.5}),
  // Terrace furniture
  loungeMat: new THREE.MeshStandardMaterial({color:0x8a8078, roughness:0.7}),
  cushionMat: new THREE.MeshStandardMaterial({color:0xd8d0c0, roughness:0.85}),
  deckingMat: new THREE.MeshStandardMaterial({color:0x9a8060, roughness:0.8, metalness:0.01}),
  // Punched windows (podium) — darker than curtain wall glass
  punchedWin: new THREE.MeshStandardMaterial({color:0x8899aa, roughness:0.3, metalness:0.2})
};

/* mk() mesh helper — r128 skill pattern */
/**
 * Creates a positioned THREE.Mesh with shadow casting and receiving enabled.
 * @param {THREE.BufferGeometry} geo - Mesh geometry.
 * @param {THREE.Material} mat - Mesh material.
 * @param {number} x - X position.
 * @param {number} y - Y position.
 * @param {number} z - Z position.
 * @returns {THREE.Mesh} The constructed mesh.
 */
function mk(geo, mat, x, y, z){
  var m=new THREE.Mesh(geo, mat);
  m.position.set(x||0, y||0, z||0);
  m.castShadow=true;m.receiveShadow=true;
  return m;
}

/* Per-UNIT deterministic randomization helpers for "occupied building" effect
   Bays are grouped into 2-3 bay "units" so contiguous windows share the same
   lit/dark state — looks like real apartments with multiple windows.
   ~65% of units lit; 80% warm, 12% amber, 8% cool. */
function _unitIdx(b, unitWidthBays){
  return Math.floor(b / (unitWidthBays || 2));
}
function _winLit(f, b, seed, unitWidthBays){
  var u = _unitIdx(b, unitWidthBays);
  var x = Math.sin((f+1) * 374.892 + (u+1) * 191.731 + (seed||0) * 53.247) * 10000;
  return (x - Math.floor(x)) > 0.35; // ~65% lit
}
function _winGlowMat(f, b, seed, unitWidthBays){
  var u = _unitIdx(b, unitWidthBays);
  var x = Math.sin((f+1) * 217.331 + (u+1) * 88.471 + (seed||0) * 31.193) * 10000;
  var v = x - Math.floor(x);
  if(v < 0.08) return MAT.unitGlowCool;   // 8% TV-blue
  if(v < 0.20) return MAT.unitGlowAmber;  // 12% amber/warm-orange
  return MAT.unitGlowWarm;                // 80% standard warm
}

/* Curtain wall helper — spandrel + vision glass + mullions + transom per bay per floor
   opts: {glass, mullion, concrete, bayWidth} — defaults to MAT */
function addCurtainWall(parent, ox, oy, oz, w, floors, fh, rotY, opts){
  var o = opts || {};
  var glassMat = o.glass || MAT.glass;
  var mullionMat = o.mullion || MAT.mullion;
  var concMat = o.concrete || MAT.concreteDark;
  var gr = new THREE.Group();
  var bayW = o.bayWidth || 3.0;
  var nBays = Math.max(1, Math.round(w / bayW));
  var actualBayW = w / nBays;
  var spH = 0.7;
  var visionH = fh - spH;
  var mullW = 0.06, mullD = 0.08;
  // Seed per facade so different facades have different random patterns
  var seed = Math.abs(Math.round((ox + oz * 7.13) * 1000)) % 9999;
  // Group bays into "units" of 2 bays each so contiguous windows share lit state
  var unitWidthBays = 2;
  // Interior depth — how far behind the glass the back wall sits (real apartment depth ~3-4m)
  var intDepth = 3.2;
  for(var f = 0; f < floors; f++){
    var fy = f * fh;
    var spMat = (f % 2 === 0) ? concMat : MAT.spandrel;
    // ── INTERIOR BACK WALL (per floor) — visible through glass, gives apartment depth ──
    // One opaque plane spanning the full facade width, positioned ~1.4m inside the glass.
    // Shows as warm-cream surface through transparent curtain wall — looks like room interiors.
    var backWall = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.05, visionH - 0.04),
      MAT.unitInterior
    );
    backWall.position.set(0, fy + spH + visionH / 2, -intDepth);
    gr.add(backWall);
    // ── PARTITION WALLS — vertical dividers between apartment units (every unitWidthBays bays) ──
    for(var pw = unitWidthBays; pw < nBays; pw += unitWidthBays){
      var pwx = pw * actualBayW - w / 2;
      // Wall: thin in X (along facade), tall in Y, deep in Z (perpendicular to facade)
      gr.add(mk(
        new THREE.BoxGeometry(0.06, visionH - 0.04, intDepth - 0.05),
        MAT.intWall,
        pwx, fy + spH + visionH / 2, -intDepth / 2
      ));
    }
    // ── FLOOR/CEILING SLAB inside each floor — thin horizontal divider at storey lines ──
    // Caps the unit interior so adjacent floors don't blend at night
    gr.add(mk(
      new THREE.BoxGeometry(w - 0.05, 0.08, intDepth - 0.05),
      MAT.spandrel,
      0, fy + 0.04, -intDepth / 2
    ));
    for(var b = 0; b < nBays; b++){
      var bx = b * actualBayW - w / 2 + actualBayW / 2;
      // Spandrel panel
      gr.add(mk(new THREE.BoxGeometry(actualBayW - mullW, spH, 0.06), spMat, bx, fy + spH / 2, 0.03));
      // Vision glass
      var vg = new THREE.Mesh(new THREE.PlaneGeometry(actualBayW - mullW * 2, visionH - 0.04), glassMat);
      vg.position.set(bx, fy + spH + visionH / 2, 0.005);
      gr.add(vg);
      // ── INTERIOR UNIT GLOW (lit window effect at night) ──
      // Bright emissive plane positioned slightly IN FRONT of the glass so it isn't
      // dimmed by the tinted/metallic/clearcoated glass material. Same approach as the
      // podium punched-window glows (which sit in front of the opaque window). At day
      // the glow is opacity=0 so it's invisible — only appears at golden hour and night.
      if(_winLit(f, b, seed, unitWidthBays)){
        var glowMat = _winGlowMat(f, b, seed, unitWidthBays);
        var glow = new THREE.Mesh(new THREE.PlaneGeometry(actualBayW - mullW * 2, visionH - 0.06), glowMat);
        glow.position.set(bx, fy + spH + visionH / 2, 0.025);
        gr.add(glow);
      }
      // Vertical mullion right edge
      gr.add(mk(new THREE.BoxGeometry(mullW, fh, mullD), mullionMat, bx + actualBayW / 2, fy + fh / 2, mullD / 2));
      if(b === 0){
        gr.add(mk(new THREE.BoxGeometry(mullW, fh, mullD), mullionMat, -w / 2, fy + fh / 2, mullD / 2));
      }
    }
    // Horizontal transom
    gr.add(mk(new THREE.BoxGeometry(w, 0.04, mullD), mullionMat, 0, fy + fh - 0.02, mullD / 2));
  }
  gr.position.set(ox, oy, oz);
  if(rotY) gr.rotation.y = rotY;
  parent.add(gr);
  return gr;
}

/* Balcony unit helper — concrete slab + glass railing + steel cap rail + corner posts
   Always uses MAT materials */
function addBalconyUnit(parent, x, y, z, w, proj, rotY){
  var gr = new THREE.Group();
  var rH = 1.07;
  var slabH = 0.15;
  // Concrete slab (dark so it doesn't blow out under ACES)
  gr.add(mk(new THREE.BoxGeometry(w, slabH, proj), MAT.concreteDark, 0, slabH / 2, proj / 2));
  // Slab soffit (darker underside visible from below)
  var _soffitMat = new THREE.MeshStandardMaterial({color:0x2a2826, roughness:0.85, metalness:0.02});
  gr.add(mk(new THREE.BoxGeometry(w - 0.02, 0.02, proj - 0.02), _soffitMat, 0, 0.01, proj / 2));
  // Glass railing front — BoxGeometry for visibility
  gr.add(mk(new THREE.BoxGeometry(w - 0.3, rH, 0.02), MAT.glassRailing, 0, slabH + rH / 2, proj - 0.01));
  // Steel cap rail
  gr.add(mk(new THREE.BoxGeometry(w + 0.04, 0.05, 0.06), MAT.steelDark, 0, slabH + rH + 0.025, proj - 0.01));
  // Corner posts
  for(var s = -1; s <= 1; s += 2){
    gr.add(mk(new THREE.BoxGeometry(0.04, rH + slabH, 0.04), MAT.steelDark, s * (w / 2 - 0.02), (rH + slabH) / 2, proj));
  }
  // Side glass panels
  for(var s = -1; s <= 1; s += 2){
    gr.add(mk(new THREE.BoxGeometry(0.02, rH, proj - 0.1), MAT.glassRailing, s * (w / 2 - 0.01), slabH + rH / 2, proj / 2));
  }
  gr.position.set(x, y, z);
  if(rotY) gr.rotation.y = rotY;
  parent.add(gr);
}

/**
 * Clears and rebuilds all building volumes, floors, facades, and interior elements in the 3D scene.
 */
function rebuildBuilding(){
  clearGroup('building');
  var g = groups.building;
  var vts = lotVerts();
  var bounds = lotBounds();
  var gfH = f2m(P.flr.gf || 15);
  var typH = f2m(P.flr.typ || 10);
  var maxZ = bounds.maxZ;
  var allX = vts.map(function(v){return v[0];});
  var lotMinX = Math.min.apply(null, allX), lotMaxX = Math.max.apply(null, allX);

  // ═══ GROUND PLANE — handled by rebuildEnvironment, not duplicated here ═══
  // Lot outline glow
  var lotPts = vts.map(function(v){ return new THREE.Vector3(f2m(v[0]), 0.03, f2m(v[1])); });
  if(lotPts.length > 0) lotPts.push(lotPts[0].clone());
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lotPts),
    new THREE.LineBasicMaterial({color:0x88aacc, transparent:true, opacity:0.6})));

  // ═══ PRE-COMPUTE VOLUME BOUNDING BOXES ═══
  // Point-in-polygon test (meter coordinates)
  function _pipM(px, pz, polyM){
    var inside=false;
    for(var i=0,j=polyM.length-1;i<polyM.length;j=i++){
      var xi=polyM[i][0],zi=polyM[i][1],xj=polyM[j][0],zj=polyM[j][1];
      if((zi>pz)!==(zj>pz)&&(px<(xj-xi)*(pz-zi)/(zj-zi)+xi)) inside=!inside;
    }
    return inside;
  }
  var volBounds = P.vols.map(function(vol){
    var cx0, cx1, cz0, cz1, bw, bd, polyM=null;
    if(vol.customPolyLocal && vol.customPolyLocal.length >= 4){
      polyM = vol.customPolyLocal.map(function(p){return [f2m(p[0]), f2m(p[1])];});
      // Remove closing point if present
      if(polyM.length>1 && Math.abs(polyM[0][0]-polyM[polyM.length-1][0])<0.001 && Math.abs(polyM[0][1]-polyM[polyM.length-1][1])<0.001) polyM=polyM.slice(0,-1);
      var xs = polyM.map(function(p){return p[0];});
      var zs = polyM.map(function(p){return p[1];});
      cx0 = Math.min.apply(null, xs); cx1 = Math.max.apply(null, xs);
      cz0 = Math.min.apply(null, zs); cz1 = Math.max.apply(null, zs);
      bw = cx1 - cx0; bd = cz1 - cz0;
    } else {
      var oE = f2m(vol.offEast || 0);
      var w = f2m(vol.width || 0);
      cx1 = f2m(lotMaxX) - oE; cx0 = cx1 - w;
      cz0 = f2m(vol.startEg || 0); cz1 = cz0 + f2m(vol.depth || 0);
      bw = w; bd = f2m(vol.depth || 0);
    }
    var hasComm = !!vol.commGF;
    var customGF = vol.gfHeight > 0 ? f2m(vol.gfHeight) : 0;
    var storeyH = customGF > 0 ? customGF : (hasComm ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var baseElev = vol.baseElevFt > 0 ? f2m(vol.baseElevFt) : 0;
    var totalH = baseElev + storeyH + (vol.storeys - 1) * f2m(P.flr.typ);
    return {cx0:cx0, cx1:cx1, cz0:cz0, cz1:cz1, bw:bw, bd:bd, totalH:totalH, storeys:vol.storeys, polyM:polyM};
  });

  // ═══ OVERLAP UTILITY FUNCTIONS ═══
  function faceHidden(vi, face){
    var a = volBounds[vi]; if(!a || a.bw <= 0 || a.bd <= 0) return false;
    var tol = 0.3;
    for(var j = 0; j < volBounds.length; j++){
      if(j === vi) continue;
      var b = volBounds[j]; if(!b || b.bw <= 0 || b.bd <= 0) continue;
      if(b.totalH < a.totalH - tol) continue;
      if(face === 'north'){ if(Math.abs(b.cz1 - a.cz0) < tol && b.cx0 <= a.cx0 + tol && b.cx1 >= a.cx1 - tol) return true; }
      else if(face === 'south'){ if(Math.abs(b.cz0 - a.cz1) < tol && b.cx0 <= a.cx0 + tol && b.cx1 >= a.cx1 - tol) return true; }
      else if(face === 'east'){ if(Math.abs(b.cx0 - a.cx1) < tol && b.cz0 <= a.cz0 + tol && b.cz1 >= a.cz1 - tol) return true; }
      else if(face === 'west'){ if(Math.abs(b.cx1 - a.cx0) < tol && b.cz0 <= a.cz0 + tol && b.cz1 >= a.cz1 - tol) return true; }
    }
    return false;
  }
  function volsOverlapPlan(vi, vj){
    var a = volBounds[vi], b = volBounds[vj];
    if(!a || !b) return false;
    return a.cx0 < b.cx1 && a.cx1 > b.cx0 && a.cz0 < b.cz1 && a.cz1 > b.cz0;
  }
  function findOverlappingTallerVol(px, pz, excludeVi, minH){
    for(var j = 0; j < volBounds.length; j++){
      if(j === excludeVi) continue;
      var b = volBounds[j];
      if(!b || b.bw <= 0 || b.bd <= 0) continue;
      if(b.totalH <= minH) continue;
      if(px >= b.cx0 - 0.1 && px <= b.cx1 + 0.1 && pz >= b.cz0 - 0.1 && pz <= b.cz1 + 0.1){
        // For polygon volumes, also verify point is inside actual polygon (not just bbox)
        if(b.polyM && !_pipM(px, pz, b.polyM)) continue;
        return j;
      }
    }
    return -1;
  }
  function getOverlapHoles(vi){
    var holes = [];
    var myB = volBounds[vi]; if(!myB) return holes;
    for(var j = 0; j < volBounds.length; j++){
      if(j === vi) continue;
      var ob = volBounds[j];
      if(!ob || ob.bw <= 0 || ob.bd <= 0) continue;
      if(ob.totalH <= myB.totalH) continue;
      // Skip hole-cutting when both volumes are polygon-based (e.g. podium + tower
      // from AI massing). The manual facade PlaneGeometry panels handle the visuals;
      // cutting holes in the ExtrudeGeometry only creates triangulation artifacts.
      if(myB.polyM && ob.polyM) continue;
      if(ob.polyM){
        // For polygon volumes, pass actual polygon for precise hole cutting
        holes.push({polyM:ob.polyM, x0:ob.cx0, x1:ob.cx1, z0:ob.cz0, z1:ob.cz1});
      } else {
        var ox0 = Math.max(ob.cx0, myB.cx0), ox1 = Math.min(ob.cx1, myB.cx1);
        var oz0 = Math.max(ob.cz0, myB.cz0), oz1 = Math.min(ob.cz1, myB.cz1);
        if(ox1 - ox0 > 0.5 && oz1 - oz0 > 0.5) holes.push({x0:ox0, x1:ox1, z0:oz0, z1:oz1});
      }
    }
    return holes;
  }

  // ═══ TALLEST VOLUME SCAN ═══
  var tallestVi = -1, tallestTotalH = 0;
  P.vols.forEach(function(vol, vi){
    var sH = vol.gfHeight > 0 ? f2m(vol.gfHeight) : (vol.commGF ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var h = sH + (vol.storeys - 1) * f2m(P.flr.typ);
    if(h > tallestTotalH){ tallestTotalH = h; tallestVi = vi; }
  });

  // ═══ Cladding material helper ═══
  function getCladdingMat(type){
    if(type === 'cedar') return MAT.cedar;
    if(type === 'metal') return MAT.steelDark;
    if(type === 'precast') return MAT.concreteSmooth;
    if(type === 'stone') return MAT.concreteDark;
    if(type === 'corten') return MAT.corten;
    if(type === 'curtainWall') return MAT.spandrel || MAT.concreteDark;
    return MAT.brick;
  }

  // ═══════════════════════════════════════════════════════════
  //  VOLUME LOOP
  // ═══════════════════════════════════════════════════════════
  P.vols.forEach(function(vol, vi){
    var hasComm = !!vol.commGF;
    var customGF = vol.gfHeight > 0 ? f2m(vol.gfHeight) : 0;
    var storeyH = customGF > 0 ? customGF : (hasComm ? f2m(P.flr.gf) : f2m(P.flr.typ));
    var upperH = f2m(P.flr.typ);
    var totalH = storeyH + (vol.storeys - 1) * upperH;
    var overlapHoles = getOverlapHoles(vi);
    var hasOverlappingTaller = overlapHoles.length > 0;
    // If podiumStoreys is explicitly set (from optimal massing), respect it.
    // podiumStoreys: undefined = use defaults; 0 = no podium (all tower); >0 = this many podium floors
    var hasExplicitPodium = vol.podiumStoreys !== undefined;
    var isMidrise = hasExplicitPodium ? false : ((vol.storeys <= 4) || hasOverlappingTaller);
    var podiumFloors = hasExplicitPodium ? Math.min(vol.podiumStoreys, vol.storeys - 1)
      : (isMidrise ? vol.storeys - 1 : Math.min(3, vol.storeys - 1));
    var showWin = vol.windows !== undefined ? !!vol.windows : true;
    var wSpc = vol.winSpacing || 3;
    var claddingType = vol.cladding || 'brick';
    var claddingMat = getCladdingMat(claddingType);

    // ══════════════════════════════════════════
    //  CUSTOM POLYGON VOLUMES
    // ══════════════════════════════════════════
    if(vol.customPolyLocal && vol.customPolyLocal.length >= 4){
     try{
      // Base elevation: if set, the entire volume is raised (e.g. tower starting above podium)
      var baseElev = vol.baseElevFt > 0 ? f2m(vol.baseElevFt) : 0;
      // Wrap volume in a sub-group so baseElev offsets everything at once
      var _parentG = g;
      var volG = new THREE.Group();
      if(baseElev > 0) volG.position.y = baseElev;
      g = volG; // all g.add() calls now go into this sub-group
      var pts = vol.customPolyLocal;
      var shapePts = [];
      for(var si = 0; si < pts.length - 1; si++) shapePts.push([f2m(pts[si][0]), -f2m(pts[si][1])]);
      if(shapePts.length < 3){ console.warn('Not enough shape pts'); return; }
      var signedArea = 0;
      for(var sa2 = 0; sa2 < shapePts.length; sa2++){
        var sj = (sa2 + 1) % shapePts.length;
        signedArea += (shapePts[sj][0] - shapePts[sa2][0]) * (shapePts[sj][1] + shapePts[sa2][1]);
      }
      if(signedArea > 0) shapePts.reverse();
      var shape = new THREE.Shape();
      shape.moveTo(shapePts[0][0], shapePts[0][1]);
      for(var si3 = 1; si3 < shapePts.length; si3++) shape.lineTo(shapePts[si3][0], shapePts[si3][1]);
      shape.closePath();

      var closedPts = pts.slice(0, -1);
      var polyCX = 0, polyCZ = 0;
      closedPts.forEach(function(p){ polyCX += f2m(p[0]); polyCZ += f2m(p[1]); });
      polyCX /= closedPts.length; polyCZ /= closedPts.length;

      var polyXs = closedPts.map(function(p){return f2m(p[0]);}), polyZs = closedPts.map(function(p){return f2m(p[1]);});
      var polyMinX = Math.min.apply(null, polyXs), polyMaxX = Math.max.apply(null, polyXs);
      var polyMinZ = Math.min.apply(null, polyZs), polyMaxZ = Math.max.apply(null, polyZs);
      var polyBW = polyMaxX - polyMinX, polyBD = polyMaxZ - polyMinZ;

      // Shape with holes for overlapping taller volumes
      var shapeWithHoles = shape;
      if(overlapHoles.length > 0){
        shapeWithHoles = new THREE.Shape();
        shapeWithHoles.moveTo(shapePts[0][0], shapePts[0][1]);
        for(var si4 = 1; si4 < shapePts.length; si4++) shapeWithHoles.lineTo(shapePts[si4][0], shapePts[si4][1]);
        shapeWithHoles.closePath();
        overlapHoles.forEach(function(oh){
          var hp = new THREE.Path();
          if(oh.polyM){
            // Polygon-shaped hole — use actual polygon vertices
            var hpArr = oh.polyM.map(function(p){return [p[0], -p[1]];});
            // Ensure clockwise winding for holes (opposite of outer shape)
            var hArea = 0;
            for(var ha=0; ha<hpArr.length; ha++){
              var hb=(ha+1)%hpArr.length;
              hArea += (hpArr[hb][0]-hpArr[ha][0])*(hpArr[hb][1]+hpArr[ha][1]);
            }
            if(hArea < 0) hpArr.reverse();
            hp.moveTo(hpArr[0][0], hpArr[0][1]);
            for(var hj=1; hj<hpArr.length; hj++) hp.lineTo(hpArr[hj][0], hpArr[hj][1]);
          } else {
            var inset = 0.05;
            hp.moveTo(oh.x0 + inset, -(oh.z0 + inset));
            hp.lineTo(oh.x1 - inset, -(oh.z0 + inset));
            hp.lineTo(oh.x1 - inset, -(oh.z1 - inset));
            hp.lineTo(oh.x0 + inset, -(oh.z1 - inset));
          }
          hp.closePath();
          shapeWithHoles.holes.push(hp);
        });
      }

      function edgeNormals(p0, p1){
        var dx = f2m(p1[0] - p0[0]), dz = f2m(p1[1] - p0[1]);
        var len = Math.sqrt(dx * dx + dz * dz);
        if(len < 0.01) return [{nx:0, nz:1}];
        var n1x = -dz / len, n1z = dx / len;
        var n2x = dz / len, n2z = -dx / len;
        var mx2 = f2m((p0[0] + p1[0]) / 2), mz2 = f2m((p0[1] + p1[1]) / 2);
        var toCX = mx2 - polyCX, toCZ = mz2 - polyCZ;
        var dot1 = n1x * toCX + n1z * toCZ;
        var dot2 = n2x * toCX + n2z * toCZ;
        if(dot1 >= dot2) return [{nx:n1x, nz:n1z}];
        return [{nx:n2x, nz:n2z}];
      }
      function normalCardinal(nx, nz){
        if(Math.abs(nz) > Math.abs(nx)) return nz < 0 ? 'N' : 'S';
        return nx > 0 ? 'E' : 'W';
      }

      var towerFloors = isMidrise ? 0 : vol.storeys - 1 - podiumFloors;

      // ── GROUND FLOOR (extruded mass + facade per edge) ──
      // Pure tower volumes (podiumFloors=0, no commercial) use dark core + curtain wall for GF
      var isTowerVol = podiumFloors === 0 && !hasComm && claddingType === 'curtainWall';
      var gfGeo = new THREE.ExtrudeGeometry(shapeWithHoles, {depth:storeyH, bevelEnabled:false});
      gfGeo.rotateX(-Math.PI / 2);
      var gfCoreMat = isTowerVol
        ? new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:0.12, side:THREE.DoubleSide})
        : claddingMat;
      var gfMesh = new THREE.Mesh(gfGeo, gfCoreMat);
      gfMesh.position.y = 0; gfMesh.castShadow = true; gfMesh.receiveShadow = true;
      g.add(gfMesh);

      // GF facade per edge
      if(isTowerVol){
        // Tower GF: render curtain wall on this floor (1 floor at y=0)
        for(var ei = 0; ei < closedPts.length; ei++){
          var p0 = closedPts[ei], p1 = closedPts[(ei + 1) % closedPts.length];
          var edgeLen = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]));
          if(edgeLen < 2) continue;
          var edgeLenM = f2m(edgeLen);
          var mx = f2m((p0[0] + p1[0]) / 2), mz = f2m((p0[1] + p1[1]) / 2);
          if(findOverlappingTallerVol(mx, mz, vi, totalH) >= 0) continue;
          var normals = edgeNormals(p0, p1);
          for(var ni = 0; ni < normals.length; ni++){
            var nx = normals[ni].nx, nz = normals[ni].nz;
            var angle = Math.atan2(nx, nz);
            addCurtainWall(g, mx + nx * 0.01, 0, mz + nz * 0.01, edgeLenM, 1, storeyH, angle, {bayWidth:3.0});
          }
        }
      } else {
        // Podium/midrise GF: render storefront or brick
        for(var ei = 0; ei < closedPts.length; ei++){
          var p0 = closedPts[ei], p1 = closedPts[(ei + 1) % closedPts.length];
          var edgeLen = Math.sqrt((p1[0] - p0[0]) * (p1[0] - p0[0]) + (p1[1] - p0[1]) * (p1[1] - p0[1]));
          if(edgeLen < 2) continue;
          var edgeLenM = f2m(edgeLen);
          var midZ = (p0[1] + p1[1]) / 2;
          var isStreetFace = hasComm && ((midZ < 5) || (midZ > maxZ - 5));
          var mx = f2m((p0[0] + p1[0]) / 2), mz = f2m((p0[1] + p1[1]) / 2);
          if(findOverlappingTallerVol(mx, mz, vi, totalH) >= 0) continue;
          var normals = edgeNormals(p0, p1);
          for(var ni = 0; ni < normals.length; ni++){
            var nx = normals[ni].nx, nz = normals[ni].nz;
            var angle = Math.atan2(nx, nz);
            var card = normalCardinal(nx, nz);
            var sfOverride = (card === 'N' ? vol.storefrontN : card === 'S' ? vol.storefrontS : card === 'E' ? vol.storefrontE : vol.storefrontW);
            var doStorefront = sfOverride !== undefined ? !!sfOverride : isStreetFace;
            var gfGr = new THREE.Group();
            if(doStorefront){
              var sfGlassH = storeyH * 0.75, sfBaseH = storeyH * 0.1;
              gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, sfBaseH, 0.06), MAT.concreteDark, 0, sfBaseH / 2, 0));
              var sfGlass = new THREE.Mesh(new THREE.PlaneGeometry(edgeLenM - 0.1, sfGlassH), MAT.glassSF);
              sfGlass.position.set(0, sfBaseH + sfGlassH / 2, 0.005); gfGr.add(sfGlass);
              var sfNCols = Math.max(1, Math.floor(edgeLenM / 4.0));
              for(var c = 0; c <= sfNCols; c++){
                var cx2 = c / sfNCols * edgeLenM - edgeLenM / 2;
                gfGr.add(mk(new THREE.BoxGeometry(0.06, sfGlassH, 0.06), MAT.steelDark, cx2, sfBaseH + sfGlassH / 2, 0.03));
              }
              gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, 0.06, 0.06), MAT.steelDark, 0, sfBaseH + sfGlassH, 0.03));
              var headerH = storeyH - sfBaseH - sfGlassH;
              if(headerH > 0.05) gfGr.add(mk(new THREE.BoxGeometry(edgeLenM, headerH, 0.04), MAT.concreteDark, 0, storeyH - headerH / 2, 0));
            } else {
              var gfWall = new THREE.Mesh(new THREE.PlaneGeometry(edgeLenM, storeyH), claddingMat);
              gfWall.position.set(0, storeyH / 2, 0.005); gfGr.add(gfWall);
              var nWinGf = Math.max(1, Math.floor(edgeLenM / 3));
              for(var wi = 0; wi < nWinGf; wi++){
                var winCX = (wi + 0.5) / nWinGf * edgeLenM - edgeLenM / 2;
                var wm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), MAT.glass);
                wm.position.set(winCX, storeyH * 0.55, 0.01); gfGr.add(wm);
              }
            }
            gfGr.position.set(mx + nx * 0.01, 0, mz + nz * 0.01);
            gfGr.rotation.y = angle;
            g.add(gfGr);
          }
        }
      }

      // ── UPPER FLOORS ──
      if(vol.storeys > 1){
        var upFloors = vol.storeys - 1;
        var upH = upFloors * upperH;
        var podiumH = podiumFloors * upperH;
        var twrFloors = upFloors - podiumFloors;
        var towerH2 = twrFloors * upperH;

        // Tower core mass (semi-transparent dark so glass reads properly)
        // Apply stepback: inset the polygon for tower floors above podium
        // towerClosedPtsFt: inset polygon in FEET (for curtain wall / balcony / slab loops)
        var towerClosedPtsFt = closedPts; // default: same as podium if no stepback
        var towerPolyCX = polyCX, towerPolyCZ = polyCZ; // centroid in metres
        var twrShape = shapeWithHoles; // tower shape (updated if stepback applies)

        // Edge normal helper for tower polygon (uses tower centroid)
        function towerEdgeNormals(p0, p1){
          var dx = f2m(p1[0] - p0[0]), dz = f2m(p1[1] - p0[1]);
          var len = Math.sqrt(dx * dx + dz * dz);
          if(len < 0.01) return [{nx:0, nz:1}];
          var n1x = -dz / len, n1z = dx / len;
          var n2x = dz / len, n2z = -dx / len;
          var mx2 = f2m((p0[0] + p1[0]) / 2), mz2 = f2m((p0[1] + p1[1]) / 2);
          var toCX = mx2 - towerPolyCX, toCZ = mz2 - towerPolyCZ;
          var dot1 = n1x * toCX + n1z * toCZ;
          var dot2 = n2x * toCX + n2z * toCZ;
          if(dot1 >= dot2) return [{nx:n1x, nz:n1z}];
          return [{nx:n2x, nz:n2z}];
        }

        if(twrFloors > 0){
          var stepM = hasExplicitPodium ? f2m(vol.stepbackAmt || 10) : 0;
          if(stepM > 0 && closedPts.length >= 3){
            // Inset the polygon by stepM metres on all sides using centroid shrink.
            // Coordinates in metres; shape uses negated Z to match main shape convention.
            var cxAvg = 0, czAvg = 0;
            for(var si = 0; si < closedPts.length; si++){ cxAvg += f2m(closedPts[si][0]); czAvg += f2m(closedPts[si][1]); }
            cxAvg /= closedPts.length; czAvg /= closedPts.length;
            var towerPts = [];
            var towerPtsFt = []; // parallel array in feet for facade loops
            for(var si2 = 0; si2 < closedPts.length; si2++){
              var px2 = f2m(closedPts[si2][0]), pz2 = f2m(closedPts[si2][1]);
              var dx2 = px2 - cxAvg, dz2 = pz2 - czAvg;
              var dist2 = Math.sqrt(dx2*dx2 + dz2*dz2);
              if(dist2 > 0.01){
                var scale2 = Math.max(0.3, (dist2 - stepM) / dist2);
                var inX = cxAvg + dx2 * scale2, inZ = czAvg + dz2 * scale2;
                // Shape convention: (x_metres, -z_metres) — negate Z to match main shape
                towerPts.push(new THREE.Vector2(inX, -inZ));
                towerPtsFt.push([inX / f2m(1), inZ / f2m(1)]); // feet: keep positive Z
              }
            }
            if(towerPts.length >= 3){
              // Ensure correct winding (counter-clockwise in shape space)
              var twrSignedArea = 0;
              for(var twa = 0; twa < towerPts.length; twa++){
                var twb = (twa + 1) % towerPts.length;
                twrSignedArea += (towerPts[twb].x - towerPts[twa].x) * (towerPts[twb].y + towerPts[twa].y);
              }
              if(twrSignedArea > 0) towerPts.reverse();
              twrShape = new THREE.Shape(towerPts);
              towerClosedPtsFt = towerPtsFt;
              // Recompute tower centroid in metres (world space, positive Z)
              towerPolyCX = 0; towerPolyCZ = 0;
              for(var tc = 0; tc < towerPtsFt.length; tc++){
                towerPolyCX += f2m(towerPtsFt[tc][0]);
                towerPolyCZ += f2m(towerPtsFt[tc][1]);
              }
              towerPolyCX /= towerPtsFt.length;
              towerPolyCZ /= towerPtsFt.length;
            }
          }
          var twrGeo = new THREE.ExtrudeGeometry(twrShape, {depth:towerH2, bevelEnabled:false});
          twrGeo.rotateX(-Math.PI / 2);
          var twrCoreOpacity = showWin ? (hasOverlappingTaller ? 0.5 : 0.12) : 0.85;
          var twrCoreMat = new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:twrCoreOpacity, side:THREE.DoubleSide});
          var twrMesh = new THREE.Mesh(twrGeo, twrCoreMat);
          twrMesh.position.y = storeyH + podiumH; twrMesh.castShadow = true;
          g.add(twrMesh);
        }

        // Podium floors (brick with punched windows) per edge
        if(podiumFloors > 0 && showWin){
          for(var ei2 = 0; ei2 < closedPts.length; ei2++){
            var pp0 = closedPts[ei2], pp1 = closedPts[(ei2 + 1) % closedPts.length];
            var eLen2 = Math.sqrt((pp1[0] - pp0[0]) * (pp1[0] - pp0[0]) + (pp1[1] - pp0[1]) * (pp1[1] - pp0[1]));
            if(eLen2 < 2) continue;
            var eLM2 = f2m(eLen2);
            var mx3 = f2m((pp0[0] + pp1[0]) / 2), mz3 = f2m((pp0[1] + pp1[1]) / 2);
            if(findOverlappingTallerVol(mx3, mz3, vi, totalH) >= 0) continue;
            var norms2 = edgeNormals(pp0, pp1);
            for(var ni2 = 0; ni2 < norms2.length; ni2++){
              var enx = norms2[ni2].nx, enz = norms2[ni2].nz;
              var eAngle = Math.atan2(enx, enz);
              // Brick face with punched windows — always brick (Fix 8), standardised size (Fix 7)
              var podFGr = new THREE.Group();
              podFGr.add(new THREE.Mesh(new THREE.PlaneGeometry(eLM2, podiumFloors * upperH), MAT.brick));
              podFGr.children[0].position.set(0, podiumFloors * upperH / 2, 0);
              var pWinSpacing = 4.0;
              var pWinCols = Math.max(1, Math.floor(eLM2 / pWinSpacing));
              var pActualSpacing = eLM2 / pWinCols;
              var pWinW2 = upperH * 0.5;
              var pWinH2 = upperH * 0.55;
              var polySeed = Math.abs(Math.round((mx3 + mz3 * 7.13) * 1000)) % 9999;
              for(var pfl = 0; pfl < podiumFloors; pfl++){
                var pflBase = pfl * upperH;
                for(var pwi = 0; pwi < pWinCols; pwi++){
                  var pwinCX = -eLM2/2 + pActualSpacing/2 + pwi * pActualSpacing;
                  podFGr.add(new THREE.Mesh(new THREE.PlaneGeometry(pWinW2, pWinH2), MAT.punchedWin));
                  podFGr.children[podFGr.children.length-1].position.set(pwinCX, pflBase + upperH * 0.55, 0.3);
                  // Interior unit glow — visible at night
                  if(_winLit(pfl, pwi, polySeed)){
                    var polyGlow = new THREE.Mesh(new THREE.PlaneGeometry(pWinW2 - 0.06, pWinH2 - 0.06), _winGlowMat(pfl, pwi, polySeed));
                    polyGlow.position.set(pwinCX, pflBase + upperH * 0.55, 0.305);
                    podFGr.add(polyGlow);
                  }
                  podFGr.add(mk(new THREE.BoxGeometry(pWinW2 + 0.15, 0.04, 0.06), MAT.concreteSmooth, pwinCX, pflBase + upperH * 0.55 - pWinH2/2 - 0.04, 0.3));
                  podFGr.add(mk(new THREE.BoxGeometry(pWinW2 + 0.1, 0.06, 0.04), MAT.concreteSmooth, pwinCX, pflBase + upperH * 0.55 + pWinH2/2 + 0.03, 0.3));
                }
              }
              podFGr.position.set(mx3 + enx * 0.01, storeyH, mz3 + enz * 0.01);
              podFGr.rotation.y = eAngle;
              g.add(podFGr);
            }
          }
        }

        // Cornice at podium-to-tower transition
        if(podiumFloors > 0 && twrFloors > 0){
          var transY = storeyH + podiumH;
          for(var ei3 = 0; ei3 < closedPts.length; ei3++){
            var tp0 = closedPts[ei3], tp1 = closedPts[(ei3 + 1) % closedPts.length];
            var tELen = Math.sqrt((tp1[0] - tp0[0]) * (tp1[0] - tp0[0]) + (tp1[1] - tp0[1]) * (tp1[1] - tp0[1]));
            if(tELen < 2) continue;
            var tELM = f2m(tELen);
            var tmx = f2m((tp0[0] + tp1[0]) / 2), tmz = f2m((tp0[1] + tp1[1]) / 2);
            if(findOverlappingTallerVol(tmx, tmz, vi, totalH) >= 0) continue;
            var tnorms = edgeNormals(tp0, tp1);
            for(var tni = 0; tni < tnorms.length; tni++){
              var tnx = tnorms[tni].nx, tnz = tnorms[tni].nz;
              var cornice = mk(new THREE.BoxGeometry(tELM + 0.05, 0.08, 0.06), MAT.concreteDark, 0, 0, 0);
              cornice.position.set(tmx + tnx * 0.03, transY - 0.04, tmz + tnz * 0.03);
              cornice.rotation.y = Math.atan2(tnx, tnz); g.add(cornice);
            }
          }
        }

        // Green terrace on exposed podium roof at transition level
        if(podiumFloors > 0 && twrFloors > 0){
          var polyCapBeamH = 0.15;
          var terrY = storeyH + podiumH + polyCapBeamH + 0.05;
          console.log('[polygon] podiumTopY:', (storeyH + podiumH).toFixed(2), 'capBeam:', polyCapBeamH, 'terraceY:', terrY.toFixed(2));
          var terrGeo = new THREE.ShapeGeometry(shapeWithHoles); terrGeo.rotateX(-Math.PI / 2);
          var terrMesh = new THREE.Mesh(terrGeo, MAT.greenRoof);
          terrMesh.position.y = terrY; terrMesh.receiveShadow = true; g.add(terrMesh);
          // Planter boxes along longest edges — positioned OUTWARD from building edge
          for(var tei = 0; tei < closedPts.length; tei++){
            var plp0 = closedPts[tei], plp1 = closedPts[(tei + 1) % closedPts.length];
            var plLen = Math.sqrt((plp1[0]-plp0[0])*(plp1[0]-plp0[0])+(plp1[1]-plp0[1])*(plp1[1]-plp0[1]));
            if(plLen < 8) continue;
            var plLM = f2m(plLen);
            var plmx = f2m((plp0[0]+plp1[0])/2), plmz = f2m((plp0[1]+plp1[1])/2);
            var plnorms = edgeNormals(plp0, plp1);
            for(var pni = 0; pni < plnorms.length; pni++){
              var pnx = plnorms[pni].nx, pnz = plnorms[pni].nz;
              var pAng = Math.atan2(pnx, pnz);
              // Planter box along this edge — pushed outward along normal
              var planterGr = new THREE.Group();
              var plBoxH = 0.45;
              planterGr.add(mk(new THREE.BoxGeometry(plLM * 0.7, plBoxH, 0.5), MAT.planter, 0, plBoxH/2, 0));
              // Shrubs on planter
              var nShrubs = Math.max(1, Math.floor(plLM / 2.5));
              for(var si = 0; si < nShrubs; si++){
                var sx = (si + 0.5) / nShrubs * plLM * 0.7 - plLM * 0.35;
                var shrubR = 0.25 + Math.random() * 0.15;
                var shrub = new THREE.Mesh(new THREE.SphereGeometry(shrubR, 8, 6), si % 2 === 0 ? MAT.shrubA : MAT.shrubB);
                shrub.position.set(sx, plBoxH + shrubR * 0.7, 0);
                shrub.scale.y = 0.65 + Math.random() * 0.2;
                shrub.castShadow = true; planterGr.add(shrub);
              }
              planterGr.position.set(plmx + pnx * 0.8, terrY, plmz + pnz * 0.8);
              planterGr.rotation.y = pAng;
              g.add(planterGr);
            }
          }
        }

        // Tower floors (curtain wall) per edge — use INSET tower polygon, not podium polygon
        // Build podium polygon in metres for interior-face culling
        var podiumPolyM = closedPts.map(function(p){ return [f2m(p[0]), f2m(p[1])]; });
        if(twrFloors > 0 && showWin){
          var towerBaseY = storeyH + podiumH;
          for(var ei4 = 0; ei4 < towerClosedPtsFt.length; ei4++){
            var cp0 = towerClosedPtsFt[ei4], cp1 = towerClosedPtsFt[(ei4 + 1) % towerClosedPtsFt.length];
            var cELen = Math.sqrt((cp1[0] - cp0[0]) * (cp1[0] - cp0[0]) + (cp1[1] - cp0[1]) * (cp1[1] - cp0[1]));
            if(cELen < 2) continue;
            var cELM = f2m(cELen);
            var cmx = f2m((cp0[0] + cp1[0]) / 2), cmz = f2m((cp0[1] + cp1[1]) / 2);
            if(findOverlappingTallerVol(cmx, cmz, vi, totalH) >= 0) continue;
            var cnorms = towerEdgeNormals(cp0, cp1);
            for(var cni = 0; cni < cnorms.length; cni++){
              var cnx = cnorms[cni].nx, cnz = cnorms[cni].nz;
              // Interior-face cull: shoot a test point outward along the normal.
              // If that point is still inside the podium polygon, this face is interior — skip it.
              var probeD = Math.max(polyBW, polyBD) + 1; // probe well past podium boundary
              var probePx = cmx + cnx * probeD, probePz = cmz + cnz * probeD;
              if(_pipM(probePx, probePz, podiumPolyM)) continue;
              var edgeAngle = Math.atan2(cnx, cnz);
              addCurtainWall(g, cmx + cnx * 0.01, towerBaseY, cmz + cnz * 0.01, cELM, twrFloors, upperH, edgeAngle, {bayWidth:3.0});
            }
          }
        }

        // Balconies along polygon edges — use tower polygon for tower floors, podium polygon for podium floors
        var showBalc = vol.balconies !== undefined ? !!vol.balconies : true;
        var bEvery = vol.balcEvery || 2;
        var bDep = f2m(vol.balcDepth || 4);
        if(showBalc && showWin && !hasOverlappingTaller){
          for(var bf = 0; bf < upFloors; bf++){
            if(bf % bEvery !== 0) continue;
            var bfy = storeyH + bf * upperH;
            // Use tower polygon for floors above podium, original polygon for podium floors
            var isTowerFloor = bf >= podiumFloors;
            var balcEdgePts = isTowerFloor ? towerClosedPtsFt : closedPts;
            var balcNormFn = isTowerFloor ? towerEdgeNormals : edgeNormals;
            for(var bei = 0; bei < balcEdgePts.length; bei++){
              var bp0 = balcEdgePts[bei], bp1 = balcEdgePts[(bei + 1) % balcEdgePts.length];
              var bELen = Math.sqrt((bp1[0] - bp0[0]) * (bp1[0] - bp0[0]) + (bp1[1] - bp0[1]) * (bp1[1] - bp0[1]));
              if(bELen < 4) continue;
              var bELM = f2m(bELen);
              var bdx = bp1[0] - bp0[0], bdz = bp1[1] - bp0[1];
              var bnorms = balcNormFn(bp0, bp1);
              for(var bni = 0; bni < bnorms.length; bni++){
                var onx = bnorms[bni].nx, onz = bnorms[bni].nz;
                // Interior-face cull for tower floors: skip edges facing into podium interior
                if(isTowerFloor && towerClosedPtsFt !== closedPts){
                  var bMidX = f2m((bp0[0] + bp1[0]) / 2), bMidZ = f2m((bp0[1] + bp1[1]) / 2);
                  var bProbeD = Math.max(polyBW, polyBD) + 1;
                  if(_pipM(bMidX + onx * bProbeD, bMidZ + onz * bProbeD, podiumPolyM)) continue;
                }
                var bcard = normalCardinal(onx, onz);
                var sideOk = true;
                // N/S follow master; E/W only if explicitly enabled
                if(bcard === 'N') sideOk = showBalc;
                else if(bcard === 'S') sideOk = showBalc;
                else if(bcard === 'E') sideOk = vol.balcE > 0;
                else if(bcard === 'W') sideOk = vol.balcW > 0;
                if(!sideOk) continue;
                var balcCount = Math.max(1, Math.floor(bELM / 4));
                var balcW = bELM / balcCount - 0.3;
                var normAngle = Math.atan2(onx, onz);
                for(var bb = 0; bb < balcCount; bb++){
                  var bt = (bb + 0.5) / balcCount;
                  var bbx = f2m(bp0[0] + bdx * bt), bbz = f2m(bp0[1] + bdz * bt);
                  addBalconyUnit(g, bbx + onx * 0.02, bfy, bbz + onz * 0.02, balcW, bDep, normAngle);
                }
              }
            }
          }
        }

        // Floor slabs on every level — tower floors use inset polygon
        if(!hasOverlappingTaller){
          for(var fl3 = 0; fl3 < upFloors; fl3++){
            var fy3 = storeyH + fl3 * upperH;
            var isTwrSlab = fl3 >= podiumFloors;
            var slabShape = isTwrSlab && twrFloors > 0 && towerClosedPtsFt !== closedPts ? twrShape : shapeWithHoles;
            var slabGeo = new THREE.ShapeGeometry(slabShape); slabGeo.rotateX(-Math.PI / 2);
            var slab = new THREE.Mesh(slabGeo, MAT.concreteDark); slab.position.y = fy3 + 0.02; slab.receiveShadow = true; g.add(slab);
            var slabEdgePts = isTwrSlab ? towerClosedPtsFt : closedPts;
            var slabNormFn = isTwrSlab ? towerEdgeNormals : edgeNormals;
            for(var sei = 0; sei < slabEdgePts.length; sei++){
              var sp0 = slabEdgePts[sei], sp1 = slabEdgePts[(sei + 1) % slabEdgePts.length];
              var seLen = Math.sqrt((sp1[0] - sp0[0]) * (sp1[0] - sp0[0]) + (sp1[1] - sp0[1]) * (sp1[1] - sp0[1]));
              if(seLen < 2) continue;
              var seLM = f2m(seLen);
              var smx = f2m((sp0[0] + sp1[0]) / 2), smz = f2m((sp0[1] + sp1[1]) / 2);
              if(findOverlappingTallerVol(smx, smz, vi, totalH) >= 0) continue;
              var snorms = slabNormFn(sp0, sp1);
              for(var sni = 0; sni < snorms.length; sni++){
                var snx = snorms[sni].nx, snz = snorms[sni].nz;
                var slabEdge = mk(new THREE.BoxGeometry(seLM, 0.06, 0.05), MAT.concreteDark, 0, 0, 0);
                slabEdge.position.set(smx + snx * 0.18, fy3 + 0.03, smz + snz * 0.18);
                slabEdge.rotation.y = Math.atan2(snx, snz);
                slabEdge.castShadow = true; g.add(slabEdge);
              }
            }
          }
        }

        // Interior furniture intentionally not rendered — appears as floating objects
        // through semi-transparent curtain wall glass. Lit-window emissive planes
        // (added per bay in addCurtainWall + punched window blocks) handle the
        // "occupied building" effect at night without needing furniture meshes.
      }

      // ── ROOF with parapet — use tower polygon if stepback exists ──
      var roofMembraneMat = new THREE.MeshStandardMaterial({color:0x2a2828, roughness:0.95, metalness:0.01});
      var roofShape = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? twrShape : shapeWithHoles;
      var roofEdgePts = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? towerClosedPtsFt : closedPts;
      var roofNormFn = (twrFloors > 0 && towerClosedPtsFt !== closedPts) ? towerEdgeNormals : edgeNormals;
      var roofGeo2 = new THREE.ShapeGeometry(roofShape); roofGeo2.rotateX(-Math.PI / 2);
      var roof2 = new THREE.Mesh(roofGeo2, roofMembraneMat);
      roof2.position.y = totalH + 0.02; roof2.receiveShadow = true; g.add(roof2);
      var resParapetH2 = 0.6;
      for(var rei = 0; rei < roofEdgePts.length; rei++){
        var rp0 = roofEdgePts[rei], rp1 = roofEdgePts[(rei + 1) % roofEdgePts.length];
        var reLen = Math.sqrt((rp1[0] - rp0[0]) * (rp1[0] - rp0[0]) + (rp1[1] - rp0[1]) * (rp1[1] - rp0[1]));
        if(reLen < 1) continue;
        var reLM = f2m(reLen);
        var rmx = f2m((rp0[0] + rp1[0]) / 2), rmz = f2m((rp0[1] + rp1[1]) / 2);
        if(findOverlappingTallerVol(rmx, rmz, vi, totalH) >= 0) continue;
        var rnorms = roofNormFn(rp0, rp1);
        for(var rni = 0; rni < rnorms.length; rni++){
          var rnx = rnorms[rni].nx, rnz = rnorms[rni].nz;
          var rang = Math.atan2(rnx, rnz);
          var parapet = mk(new THREE.BoxGeometry(reLM, resParapetH2, 0.12), MAT.concreteDark, 0, resParapetH2 / 2, 0);
          parapet.position.set(rmx + rnx * 0.06, totalH, rmz + rnz * 0.06); parapet.rotation.y = rang; g.add(parapet);
          var capM = mk(new THREE.BoxGeometry(reLM + 0.05, 0.04, 0.18), MAT.steelDark, 0, resParapetH2 + 0.02, 0);
          capM.position.set(rmx + rnx * 0.06, totalH, rmz + rnz * 0.06); capM.rotation.y = rang; g.add(capM);
        }
      }

      // ── MECHANICAL PENTHOUSE (tallest volume only) ──
      if(vol.storeys > 3 && vi === tallestVi){
        var longestEdgeLen = 0, longestAngle = 0;
        for(var mei = 0; mei < closedPts.length; mei++){
          var mp0 = closedPts[mei], mp1 = closedPts[(mei + 1) % closedPts.length];
          var meLen = Math.sqrt((mp1[0] - mp0[0]) * (mp1[0] - mp0[0]) + (mp1[1] - mp0[1]) * (mp1[1] - mp0[1]));
          if(meLen > longestEdgeLen){ longestEdgeLen = meLen; longestAngle = Math.atan2(f2m(mp1[0] - mp0[0]), f2m(mp1[1] - mp0[1])); }
        }
        var mechW2 = Math.min(polyBW * 0.38, 4.0);
        var mechD2 = Math.min(polyBD * 0.32, 3.0);
        var mechH2 = 2.4;
        if(mechW2 > 1.5 && mechD2 > 1.5){
          var mechY2 = totalH + 0.02;
          var mechGrp = new THREE.Group();
          mechGrp.add(mk(new THREE.BoxGeometry(mechW2, mechH2, mechD2), MAT.concreteDark, 0, mechH2 / 2, 0));
          mechGrp.add(mk(new THREE.BoxGeometry(mechW2 + 0.08, 0.05, mechD2 + 0.08), MAT.steelDark, 0, mechH2 + 0.025, 0));
          var lCount2 = Math.floor(mechH2 / 0.3);
          for(var li2 = 0; li2 < lCount2; li2++){
            var ly2 = 0.25 + li2 * 0.3;
            mechGrp.add(mk(new THREE.BoxGeometry(mechW2 * 0.6, 0.035, 0.05), MAT.steelDark, 0, ly2, -mechD2 / 2 - 0.025));
          }
          for(var ri2 = 0; ri2 < 2; ri2++){
            var rW2 = 0.7 + Math.random() * 0.3, rD2 = 0.5 + Math.random() * 0.2, rH2 = 0.3 + Math.random() * 0.15;
            mechGrp.add(mk(new THREE.BoxGeometry(rW2, rH2, rD2), MAT.steel, -0.6 + ri2 * 1.2, mechH2 + rH2 / 2 + 0.06, 0));
          }
          mechGrp.position.set(towerPolyCX, mechY2, towerPolyCZ);
          mechGrp.rotation.y = longestAngle;
          g.add(mechGrp);
        }
      }

      // Ground outline
      var outPts = pts.map(function(p){ return new THREE.Vector3(f2m(p[0]), 0.1, f2m(p[1])); });
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(outPts),
        new THREE.LineBasicMaterial({color:vol.color, linewidth:2})));
      // Restore parent group and add the volume sub-group.
      // CRITICAL: tag with _volIdx so click-to-drag (renderer.js mousedown) can
      // find this volume when the user clicks on it. Without this tag, getVolIdxFromMesh
      // returns -1 and polygon volumes (e.g. AI-generated tower) can't be dragged.
      g = _parentG;
      volG._volIdx = vi;
      g.add(volG);
      return; // skip rectangular
     }catch(polyErr){
      console.error('CUSTOM POLY ERROR for', vol.name, ':', polyErr.message, polyErr.stack);
      g = _parentG; // restore on error too
      volG._volIdx = vi;
      g.add(volG);
     }
    }

    // ══════════════════════════════════════════
    //  RECTANGULAR VOLUMES
    // ══════════════════════════════════════════
    var cx1 = f2m(lotMaxX) - f2m(vol.offEast || 0);
    var cx0 = cx1 - f2m(vol.width);
    var cz0 = f2m(vol.startEg || 0);
    var cz1 = cz0 + f2m(vol.depth || 0);
    var bw = f2m(vol.width), bd = f2m(vol.depth || 0);
    if(bw <= 0 || bd <= 0 || vol.storeys <= 0) return;

    var hideN = faceHidden(vi, 'north');
    var hideS = faceHidden(vi, 'south');
    var hideE = faceHidden(vi, 'east');
    var hideW = faceHidden(vi, 'west');
    var childrenBefore = g.children.length;

    // Street-facing detection
    var frontZ = 0, rearZ = f2m(maxZ), streetTol = f2m(3);
    var frontsFront = (cz0 < frontZ + streetTol);
    var frontsRear = (cz1 > rearZ - streetTol);
    // Fix 6: When commGF is true, front face always gets storefronts
    var sfN = hasComm || (vol.storefrontN !== undefined ? !!vol.storefrontN : frontsFront);
    var sfS = vol.storefrontS !== undefined ? !!vol.storefrontS : frontsRear;
    var sfE = vol.storefrontE !== undefined ? !!vol.storefrontE : false;
    var sfW = vol.storefrontW !== undefined ? !!vol.storefrontW : false;

    // ── GROUND FLOOR (15' commercial) ──
    // Dark plinth at base
    var plinthH = 0.3;
    g.add(mk(new THREE.BoxGeometry(bw + 0.04, plinthH, bd + 0.04), MAT.brickDark, cx0 + bw/2, plinthH/2, cz0 + bd/2));
    // Brick mass for ground floor (always brick, never cedar — Fix 8)
    g.add(mk(new THREE.BoxGeometry(bw, storeyH, bd), MAT.brick, cx0 + bw/2, storeyH/2, cz0 + bd/2));

    // GF Storefront faces
    function addGFStorefront(faceW, px, py, pz, rotY){
      var sfGr = new THREE.Group();
      var baseH = storeyH * 0.08;
      var glassH = storeyH * 0.78;
      var headerH = storeyH - baseH - glassH;
      // Base
      sfGr.add(mk(new THREE.BoxGeometry(faceW, baseH, 0.06), MAT.brickDark, 0, baseH/2, 0));
      // Steel I-beam columns every ~18ft (Fix 6)
      var colSpacing = 5.5;
      var nCols = Math.max(2, Math.floor(faceW / colSpacing));
      var actualColSpacing = faceW / nCols;
      for(var c = 0; c <= nCols; c++){
        var cx2 = c * actualColSpacing - faceW/2;
        // I-beam profile: web + 2 flanges
        sfGr.add(mk(new THREE.BoxGeometry(0.10, glassH + 0.1, 0.08), MAT.steelDark, cx2, baseH + glassH/2, 0.04));
        sfGr.add(mk(new THREE.BoxGeometry(0.22, glassH + 0.1, 0.015), MAT.steelDark, cx2, baseH + glassH/2, 0.08));
        sfGr.add(mk(new THREE.BoxGeometry(0.22, glassH + 0.1, 0.015), MAT.steelDark, cx2, baseH + glassH/2, 0.0));
      }
      // Large storefront glass panels between columns
      for(var bay = 0; bay < nCols; bay++){
        var bayCenter = (bay + 0.5) * actualColSpacing - faceW/2;
        var panelW = actualColSpacing - 0.4;
        var panelH = glassH - 0.2;
        var sfGlass = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), MAT.glassSF);
        sfGlass.position.set(bayCenter, baseH + glassH/2, 0.02);
        sfGr.add(sfGlass);
      }
      // Steel header beam
      sfGr.add(mk(new THREE.BoxGeometry(faceW, 0.08, 0.1), MAT.steelDark, 0, baseH + glassH, 0.05));
      // Header panel
      if(headerH > 0.05) sfGr.add(mk(new THREE.BoxGeometry(faceW, headerH, 0.04), MAT.concreteDark, 0, storeyH - headerH/2, 0));
      sfGr.position.set(px, py, pz);
      if(rotY) sfGr.rotation.y = rotY;
      g.add(sfGr);
    }
    function addGFBrick(faceW, px, py, pz, rotY){
      var bp = new THREE.Mesh(new THREE.PlaneGeometry(faceW, storeyH), MAT.brick);
      bp.position.set(px, py + storeyH/2, pz);
      if(rotY) bp.rotation.y = rotY;
      g.add(bp);
      // Standardised punched windows — same size as podium (Fix 7), Z=0.3 (Fix 8: always brick)
      var gfWinSpacing = 4.0;
      var nWin = Math.max(1, Math.floor(faceW / gfWinSpacing));
      var gfActualSpacing = faceW / nWin;
      var gfWinW = storeyH * 0.5;
      var gfWinH = storeyH * 0.55;
      var gfSeed = Math.abs(Math.round((px + pz * 7.13) * 1000)) % 9999;
      for(var wi = 0; wi < nWin; wi++){
        var wCX = -faceW/2 + gfActualSpacing/2 + wi * gfActualSpacing;
        var wm = new THREE.Mesh(new THREE.PlaneGeometry(gfWinW, gfWinH), MAT.punchedWin);
        wm.position.set(wCX, storeyH * 0.55, 0.3);
        var wGr = new THREE.Group();
        wGr.add(wm);
        // Interior unit glow — placed in front of opaque punched window at night
        if(_winLit(0, wi, gfSeed)){
          var gfGlow = new THREE.Mesh(new THREE.PlaneGeometry(gfWinW - 0.06, gfWinH - 0.06), _winGlowMat(0, wi, gfSeed));
          gfGlow.position.set(wCX, storeyH * 0.55, 0.305);
          wGr.add(gfGlow);
        }
        wGr.position.set(px, py, pz);
        if(rotY) wGr.rotation.y = rotY;
        g.add(wGr);
      }
    }
    if(!hideN){ if(sfN) addGFStorefront(bw, cx0+bw/2, 0, cz0-0.02, 0); else addGFBrick(bw, cx0+bw/2, 0, cz0-0.02, 0); }
    if(!hideS){ if(sfS) addGFStorefront(bw, cx0+bw/2, 0, cz1+0.02, Math.PI); else addGFBrick(bw, cx0+bw/2, 0, cz1+0.02, Math.PI); }
    if(!hideW){ if(sfW) addGFStorefront(bd, cx0-0.02, 0, cz0+bd/2, Math.PI/2); else addGFBrick(bd, cx0-0.02, 0, cz0+bd/2, Math.PI/2); }
    if(!hideE){ if(sfE) addGFStorefront(bd, cx1+0.02, 0, cz0+bd/2, -Math.PI/2); else addGFBrick(bd, cx1+0.02, 0, cz0+bd/2, -Math.PI/2); }

    // ── UPPER FLOORS ──
    if(vol.storeys > 1){
      var upFloors = vol.storeys - 1;
      var upH = upFloors * upperH;

      // Podium = first 3 floors above GF (floors 2-4 = brick)
      var podiumFloors2 = Math.min(3, upFloors);
      var towerFloors2 = upFloors - podiumFloors2;
      var podiumH2 = podiumFloors2 * upperH;
      var towerH2 = towerFloors2 * upperH;

      // ── TOWER STEPBACK (so podium roof terrace is exposed) ──
      var stepbackM = towerFloors2 > 0 ? f2m(vol.stepbackAmt || 5) : 0;
      var tCx0 = cx0 + stepbackM, tCx1 = cx1 - stepbackM;
      var tCz0 = cz0 + stepbackM, tCz1 = cz1 - stepbackM;
      var tBw = bw - stepbackM * 2, tBd = bd - stepbackM * 2;
      var tCenterX = cx0 + bw / 2, tCenterZ = cz0 + bd / 2;

      // ── BRICK PODIUM (floors 2-4) ──
      if(podiumFloors2 > 0){
        // Opaque brick core
        var podCoreMat2 = new THREE.MeshStandardMaterial({color:0x7a5040, roughness:0.88, metalness:0.01});
        g.add(mk(new THREE.BoxGeometry(bw - 0.04, podiumH2, bd - 0.04), podCoreMat2, cx0+bw/2, storeyH+podiumH2/2, cz0+bd/2));

        // Brick faces with punched windows
        function addBrickPodiumFace(faceW, nFlr, flrH, px, baseY, pz, rotY2){
          var fGr = new THREE.Group();
          // Always brick on podium (Fix 8: never cedar on brick podium)
          fGr.add(new THREE.Mesh(new THREE.PlaneGeometry(faceW, nFlr * flrH), MAT.brick));
          fGr.children[0].position.set(0, nFlr * flrH / 2, 0);
          // Standardised punched windows — one per ~13ft, same size all faces (Fix 7)
          var winSpacing = 4.0;
          var windowCols = Math.max(1, Math.floor(faceW / winSpacing));
          var actualSpacing = faceW / windowCols;
          var winW = flrH * 0.5;
          var winH = flrH * 0.55;
          var podSeed = Math.abs(Math.round((px + pz * 7.13) * 1000)) % 9999;
          for(var fl = 0; fl < nFlr; fl++){
            var flBase = fl * flrH;
            for(var wi = 0; wi < windowCols; wi++){
              var winCX = -faceW/2 + actualSpacing/2 + wi * actualSpacing;
              // Window glass — punched window material, Z=0.3 avoids z-fighting
              fGr.add(new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), MAT.punchedWin));
              fGr.children[fGr.children.length-1].position.set(winCX, flBase + flrH * 0.55, 0.3);
              // Interior unit glow — visible at night
              if(_winLit(fl, wi, podSeed)){
                var pGlow = new THREE.Mesh(new THREE.PlaneGeometry(winW - 0.06, winH - 0.06), _winGlowMat(fl, wi, podSeed));
                pGlow.position.set(winCX, flBase + flrH * 0.55, 0.305);
                fGr.add(pGlow);
              }
              // Window sill
              fGr.add(mk(new THREE.BoxGeometry(winW + 0.15, 0.04, 0.06), MAT.concreteSmooth, winCX, flBase + flrH * 0.55 - winH/2 - 0.04, 0.3));
              // Window header
              fGr.add(mk(new THREE.BoxGeometry(winW + 0.1, 0.06, 0.04), MAT.concreteSmooth, winCX, flBase + flrH * 0.55 + winH/2 + 0.03, 0.3));
            }
          }
          fGr.position.set(px, baseY, pz);
          if(rotY2) fGr.rotation.y = rotY2;
          g.add(fGr);
        }
        if(showWin){
          if(!hideN) addBrickPodiumFace(bw, podiumFloors2, upperH, cx0+bw/2, storeyH, cz0-0.02, 0);
          if(!hideS) addBrickPodiumFace(bw, podiumFloors2, upperH, cx0+bw/2, storeyH, cz1+0.02, Math.PI);
          if(!hideW) addBrickPodiumFace(bd, podiumFloors2, upperH, cx0-0.02, storeyH, cz0+bd/2, Math.PI/2);
          if(!hideE) addBrickPodiumFace(bd, podiumFloors2, upperH, cx1+0.02, storeyH, cz0+bd/2, -Math.PI/2);
        }
      }

      // ── TRANSITION CORNICE + GREEN TERRACE (on exposed podium roof) ──
      if(podiumFloors2 > 0 && towerFloors2 > 0 && stepbackM > 0.5){
        var podiumTopY = storeyH + podiumH2;
        var capBeamH = 0.15;
        var capBeamTopY = podiumTopY + capBeamH;
        var terraceY = capBeamTopY + 0.1;
        // Concrete cap beam on podium perimeter
        if(!hideN) g.add(mk(new THREE.BoxGeometry(bw+0.1, capBeamH, 0.12), MAT.concreteDark, cx0+bw/2, podiumTopY+capBeamH/2, cz0-0.02));
        if(!hideS) g.add(mk(new THREE.BoxGeometry(bw+0.1, capBeamH, 0.12), MAT.concreteDark, cx0+bw/2, podiumTopY+capBeamH/2, cz1+0.02));
        if(!hideW) g.add(mk(new THREE.BoxGeometry(0.12, capBeamH, bd+0.1), MAT.concreteDark, cx0-0.02, podiumTopY+capBeamH/2, cz0+bd/2));
        if(!hideE) g.add(mk(new THREE.BoxGeometry(0.12, capBeamH, bd+0.1), MAT.concreteDark, cx1+0.02, podiumTopY+capBeamH/2, cz0+bd/2));
        // Exposed setback strips (NOT under tower footprint)
        var nStripD = tCz0 - cz0 - 0.2;
        var sStripD = cz1 - tCz1 - 0.2;
        var wStripW = tCx0 - cx0 - 0.2;
        var eStripW = cx1 - tCx1 - 0.2;
        // Green terrace — north strip (Fix 3: BoxGeometry with 0.3 height)
        if(nStripD > 0.3){
          g.add(mk(new THREE.BoxGeometry(bw - 0.3, 0.3, nStripD), MAT.greenRoof, cx0+bw/2, terraceY, cz0 + nStripD/2 + 0.1));
          // Planter boxes with shrubs on top — front strip only (Fix 4)
          var planterSpacing = 5.5;
          var nPlanters = Math.max(2, Math.floor(bw / planterSpacing));
          var plActualSpacing = bw / nPlanters;
          var planterH = 1.8;
          var planterW = 5.0;
          var planterD = Math.min(2.2, nStripD * 0.7);
          var planterZ = cz0 + Math.min(0.91, nStripD * 0.5);
          var firstPlanterY = 0, firstShrubY = 0;
          for(var pi3 = 0; pi3 < nPlanters; pi3++){
            var ppx2 = cx0 + plActualSpacing/2 + pi3 * plActualSpacing;
            // Planter box underneath shrub
            g.add(mk(new THREE.BoxGeometry(planterW, planterH, planterD), MAT.planter, ppx2, terraceY + planterH/2, planterZ));
            // Shrub ON TOP of planter
            var shrubR = 1.5 + Math.random() * 2;
            var shrubY = terraceY + planterH + shrubR * 0.7;
            var shrubMesh = mk(new THREE.SphereGeometry(shrubR, 6, 5), pi3 % 2 === 0 ? MAT.shrubA : MAT.shrubB, ppx2, shrubY, planterZ);
            shrubMesh.scale.set(1, 0.65 + Math.random() * 0.3, 1);
            g.add(shrubMesh);
            if(pi3 === 0){ firstPlanterY = terraceY + planterH/2; firstShrubY = shrubY; }
          }
        }
        // Green terrace — south strip (green surface, no planters)
        if(sStripD > 0.3){
          g.add(mk(new THREE.BoxGeometry(bw - 0.3, 0.3, sStripD), MAT.greenRoof, cx0+bw/2, terraceY, cz1 - sStripD/2 - 0.1));
        }
        // Green terrace — west strip
        if(wStripW > 0.3){
          g.add(mk(new THREE.BoxGeometry(wStripW, 0.3, bd - 0.3), MAT.greenRoof, cx0+wStripW/2+0.1, terraceY, cz0+bd/2));
        }
        // Green terrace — east strip
        if(eStripW > 0.3){
          g.add(mk(new THREE.BoxGeometry(eStripW, 0.3, bd - 0.3), MAT.greenRoof, cx1-eStripW/2-0.1, terraceY, cz0+bd/2));
        }
        // Glass railing around exposed terrace perimeter
        if(!hideN) g.add(mk(new THREE.BoxGeometry(bw-0.2, 1.07, 0.02), MAT.glassRailing, cx0+bw/2, terraceY+1.07/2, cz0+0.01));
        if(!hideS) g.add(mk(new THREE.BoxGeometry(bw-0.2, 1.07, 0.02), MAT.glassRailing, cx0+bw/2, terraceY+1.07/2, cz1-0.01));
        if(!hideW) g.add(mk(new THREE.BoxGeometry(0.02, 1.07, bd-0.2), MAT.glassRailing, cx0+0.01, terraceY+1.07/2, cz0+bd/2));
        if(!hideE) g.add(mk(new THREE.BoxGeometry(0.02, 1.07, bd-0.2), MAT.glassRailing, cx1-0.01, terraceY+1.07/2, cz0+bd/2));
        // Fix 9: Position debug output
        console.log('=== POSITION DEBUG ===');
        console.log('podiumTopY:', podiumTopY.toFixed(2));
        console.log('capBeamTopY:', capBeamTopY.toFixed(2));
        console.log('terraceY:', terraceY.toFixed(2));
        console.log('first planter Y:', (firstPlanterY||0).toFixed(2));
        console.log('first shrub Y:', (firstShrubY||0).toFixed(2));
        console.log('towerBaseY:', (storeyH + podiumH2).toFixed(2));
        console.log('tower footprint:', tBw.toFixed(2), 'x', tBd.toFixed(2));
        console.log('podium footprint:', bw.toFixed(2), 'x', bd.toFixed(2));
        console.log('front setback strip depth:', nStripD.toFixed(2));
      }

      // ── TOWER (curtain wall) ──
      if(towerFloors2 > 0){
        var towerBaseY2 = storeyH + podiumH2;
        // Semi-transparent tower core (stepped-back dimensions)
        var twrCoreMat2 = new THREE.MeshStandardMaterial({color:0x1a2028, roughness:0.5, metalness:0.05, transparent:true, opacity:showWin ? 0.12 : 0.85, side:THREE.DoubleSide});
        g.add(mk(new THREE.BoxGeometry(tBw-0.04, towerH2, tBd-0.04), twrCoreMat2, tCenterX, towerBaseY2+towerH2/2, tCenterZ));
        // Curtain wall faces (stepped-back, slightly narrower than tower for corner clearance)
        if(showWin){
          if(!hideN) addCurtainWall(g, tCenterX, towerBaseY2, tCz0-0.02, tBw-0.3, towerFloors2, upperH, 0, {bayWidth:3.0});
          if(!hideS) addCurtainWall(g, tCenterX, towerBaseY2, tCz1+0.02, tBw-0.3, towerFloors2, upperH, Math.PI, {bayWidth:3.0});
          if(!hideW) addCurtainWall(g, tCx0-0.02, towerBaseY2, tCenterZ, tBd-0.3, towerFloors2, upperH, Math.PI/2, {bayWidth:3.0});
          if(!hideE) addCurtainWall(g, tCx1+0.02, towerBaseY2, tCenterZ, tBd-0.3, towerFloors2, upperH, -Math.PI/2, {bayWidth:3.0});
        }
      }

      // Floor slabs removed — spandrel panels and transoms define floor levels visually

      // Corner reveals — podium corners + tower corners
      if(showWin){
        var pCorners = [{x:cx0,z:cz0},{x:cx1,z:cz0},{x:cx0,z:cz1},{x:cx1,z:cz1}];
        for(var ci3 = 0; ci3 < pCorners.length; ci3++){
          g.add(mk(new THREE.BoxGeometry(0.08, podiumH2+storeyH, 0.08), MAT.steelDark, pCorners[ci3].x, (podiumH2+storeyH)/2, pCorners[ci3].z));
        }
        if(towerFloors2 > 0){
          var tCorners = [{x:tCx0,z:tCz0},{x:tCx1,z:tCz0},{x:tCx0,z:tCz1},{x:tCx1,z:tCz1}];
          for(var ci4 = 0; ci4 < tCorners.length; ci4++){
            g.add(mk(new THREE.BoxGeometry(0.08, towerH2, 0.08), MAT.steelDark, tCorners[ci4].x, towerBaseY2+towerH2/2, tCorners[ci4].z));
          }
        }
      }

      // Interior glow removed — visible as floating rectangles from side views

      // ── BALCONIES (every other floor above GF) ──
      var showBalc = vol.balconies !== undefined ? !!vol.balconies : true;
      var bEvery = vol.balcEvery || 2;
      var bDep = f2m(vol.balcDepth || 4);
      // Balconies — N/S follow master; use tower coords for tower floors, podium for podium
      var bN2 = showBalc && (vol.balcN === undefined || vol.balcN !== -1);
      var bS2 = showBalc && (vol.balcS === undefined || vol.balcS !== -1);
      var bE2 = vol.balcE > 0;
      var bW3 = vol.balcW > 0;
      if(bN2 || bS2 || bE2 || bW3){
        for(var bf2 = 0; bf2 < upFloors; bf2++){
          if(bf2 % bEvery !== 0) continue;
          var bfy2 = storeyH + bf2 * upperH;
          var isTowerFloor = bf2 >= podiumFloors2;
          var bFaceW = isTowerFloor ? tBw : bw;
          var bFaceD = isTowerFloor ? tBd : bd;
          var bFaceNz = isTowerFloor ? tCz0 : cz0;
          var bFaceSz = isTowerFloor ? tCz1 : cz1;
          var bFaceWx = isTowerFloor ? tCx0 : cx0;
          var bFaceEx = isTowerFloor ? tCx1 : cx1;
          var bCX = isTowerFloor ? tCenterX : cx0 + bw/2;
          var nBalcW = Math.max(1, Math.floor(bFaceW / 4));
          var balcWid = bFaceW / nBalcW - 0.3;
          for(var b2 = 0; b2 < nBalcW; b2++){
            var bx2 = bFaceWx + 0.15 + b2 * (bFaceW / nBalcW) + balcWid/2;
            if(bN2 && !hideN) addBalconyUnit(g, bx2, bfy2, bFaceNz-0.02, balcWid, bDep, 0);
            if(bS2 && !hideS) addBalconyUnit(g, bx2, bfy2, bFaceSz+0.02, balcWid, bDep, Math.PI);
          }
          var nBalcD = Math.max(1, Math.floor(bFaceD / 4));
          var balcWid2 = bFaceD / nBalcD - 0.3;
          for(var b3 = 0; b3 < nBalcD; b3++){
            var bz2 = bFaceNz + 0.15 + b3 * (bFaceD / nBalcD) + balcWid2/2;
            if(bE2 && !hideE) addBalconyUnit(g, bFaceEx+0.02, bfy2, bz2, balcWid2, bDep, -Math.PI/2);
            if(bW3 && !hideW) addBalconyUnit(g, bFaceWx-0.02, bfy2, bz2, balcWid2, bDep, Math.PI/2);
          }
        }
      }
    }

    // ── ROOF (on tower footprint if stepped back) ──
    var roofW = towerFloors2 > 0 ? tBw : bw;
    var roofD = towerFloors2 > 0 ? tBd : bd;
    var roofMembraneMat = new THREE.MeshStandardMaterial({color:0x2a2828, roughness:0.95, metalness:0.01});
    var roofR = new THREE.Mesh(new THREE.PlaneGeometry(roofW, roofD), roofMembraneMat);
    roofR.rotation.x = -Math.PI/2; roofR.position.set(tCenterX, totalH+0.02, tCenterZ);
    roofR.receiveShadow = true; g.add(roofR);

    // Parapet (on tower footprint)
    var rpH2 = 0.6, rpT2 = 0.1;
    var rNz = towerFloors2 > 0 ? tCz0 : cz0;
    var rSz = towerFloors2 > 0 ? tCz1 : cz1;
    var rWx = towerFloors2 > 0 ? tCx0 : cx0;
    var rEx = towerFloors2 > 0 ? tCx1 : cx1;
    if(!hideN){ g.add(mk(new THREE.BoxGeometry(roofW+0.08, rpH2, rpT2), MAT.concreteDark, tCenterX, totalH+rpH2/2, rNz)); g.add(mk(new THREE.BoxGeometry(roofW+0.12, 0.04, rpT2+0.04), MAT.steelDark, tCenterX, totalH+rpH2+0.02, rNz)); }
    if(!hideS){ g.add(mk(new THREE.BoxGeometry(roofW+0.08, rpH2, rpT2), MAT.concreteDark, tCenterX, totalH+rpH2/2, rSz)); g.add(mk(new THREE.BoxGeometry(roofW+0.12, 0.04, rpT2+0.04), MAT.steelDark, tCenterX, totalH+rpH2+0.02, rSz)); }
    if(!hideW){ g.add(mk(new THREE.BoxGeometry(rpT2, rpH2, roofD+0.08), MAT.concreteDark, rWx, totalH+rpH2/2, tCenterZ)); g.add(mk(new THREE.BoxGeometry(rpT2+0.04, 0.04, roofD+0.12), MAT.steelDark, rWx, totalH+rpH2+0.02, tCenterZ)); }
    if(!hideE){ g.add(mk(new THREE.BoxGeometry(rpT2, rpH2, roofD+0.08), MAT.concreteDark, rEx, totalH+rpH2/2, tCenterZ)); g.add(mk(new THREE.BoxGeometry(rpT2+0.04, 0.04, roofD+0.12), MAT.steelDark, rEx, totalH+rpH2+0.02, tCenterZ)); }

    // ── MECHANICAL PENTHOUSE ──
    if(vol.storeys > 4 && vi === tallestVi){
      var mechW = Math.min(roofW*0.35, 8), mechD = Math.min(roofD*0.3, 6), mechH = 1.8;
      if(mechW > 1.5 && mechD > 1.5){
        var rcx = tCenterX, rcz = tCenterZ;
        var mechY = totalH + rpH2;
        g.add(mk(new THREE.BoxGeometry(mechW, mechH, mechD), MAT.concreteDark, rcx, mechY+mechH/2+0.05, rcz));
        g.add(mk(new THREE.BoxGeometry(mechW+0.1, 0.06, mechD+0.1), MAT.steelDark, rcx, mechY+mechH+0.08, rcz));
        // Louvers
        var louverCt = Math.floor(mechH / 0.3);
        for(var li = 0; li < louverCt; li++){
          var ly = mechY + 0.2 + li * 0.3;
          g.add(mk(new THREE.BoxGeometry(mechW*0.85, 0.04, 0.05), MAT.steelDark, rcx, ly, rcz-mechD/2-0.03));
          g.add(mk(new THREE.BoxGeometry(mechW*0.85, 0.04, 0.05), MAT.steelDark, rcx, ly, rcz+mechD/2+0.03));
        }
      }
    }

    // ── ROTATION: wrap volume meshes ──
    var volGrp = new THREE.Group();
    var centerX = cx0 + bw / 2, centerZ = cz0 + bd / 2;
    var newChildren = [];
    while(g.children.length > childrenBefore){
      newChildren.unshift(g.children.pop());
    }
    for(var nci = 0; nci < newChildren.length; nci++){
      newChildren[nci].position.x -= centerX;
      newChildren[nci].position.z -= centerZ;
      volGrp.add(newChildren[nci]);
    }
    volGrp.position.set(centerX, 0, centerZ);
    volGrp.rotation.y = (vol.angle || 0) * Math.PI / 180;
    volGrp._volIdx = vi;
    g.add(volGrp);
  });
}

function addTextSprite(group, text, x, y, z, color, scale){
  const canvas=document.createElement('canvas');
  canvas.width=256;canvas.height=64;
  const ctx=canvas.getContext('2d');
  ctx.font='bold 32px Outfit';
  ctx.fillStyle=color||'#ffffff';
  ctx.textAlign='center';
  ctx.fillText(text,128,42);
  const tex=new THREE.CanvasTexture(canvas);
  const mat=new THREE.SpriteMaterial({map:tex,transparent:true});
  const sp=new THREE.Sprite(mat);
  sp.position.set(x,y,z);
  sp.scale.set((scale||0.5)*5,(scale||0.5)*1.25,1);
  group.add(sp);
}

function rebuildLabels(){
  clearGroup('labels');
  const g=groups.labels;
  const vts=lotVerts();
  const maxZ=lotBounds().maxZ;
  const cx=f2m(vts.reduce((s,v)=>s+v[0],0)/vts.length);

  // Street names
  addTextSprite(g,'NORTH AVE W',cx,2,f2m(-8),'#ffffff',0.6);
  addTextSprite(g,'SOUTH AVE',cx,2,f2m(maxZ+8),'#ffffff',0.6);
}

// ═══════════════════════════════════════════════════════════
//  ANGULAR PLANE CONSTRAINT ENGINES
//  Toronto Mid-Rise Design Guidelines — 45° angular planes
// ═══════════════════════════════════════════════════════════
// ═══ LIGHTING PRESETS ═══
var _currentLightPreset = 'golden';
/**
 * Applies a named lighting preset (e.g. 'golden', 'day', 'night') to the scene.
 * @param {string} mode - The lighting preset identifier.
 */
function setLightingPreset(mode){
  _currentLightPreset = mode;
  var lights = [];
  scene.traverse(function(obj){ if(obj.isLight) lights.push(obj); });
  // Find lights by type
  var amb = lights.find(function(l){ return l.type === 'AmbientLight'; });
  var hemi = lights.find(function(l){ return l.type === 'HemisphereLight'; });
  var dirs = lights.filter(function(l){ return l.type === 'DirectionalLight'; });
  var sun = dirs[0], fill = dirs[1], rim = dirs[2];

  // Helper to set per-unit window glow intensity (warm/cool/amber materials)
  function _setUnitGlow(opacity, emissive){
    if(MAT.unitGlowWarm){ MAT.unitGlowWarm.opacity = opacity; MAT.unitGlowWarm.emissiveIntensity = emissive; }
    if(MAT.unitGlowCool){ MAT.unitGlowCool.opacity = opacity * 0.85; MAT.unitGlowCool.emissiveIntensity = emissive * 0.9; }
    if(MAT.unitGlowAmber){ MAT.unitGlowAmber.opacity = opacity * 0.95; MAT.unitGlowAmber.emissiveIntensity = emissive * 1.1; }
  }
  // Helper to control interior back-wall glow (the cream surface visible inside each unit)
  function _setUnitInterior(emissive){
    if(MAT.unitInterior) MAT.unitInterior.emissiveIntensity = emissive;
  }
  if(mode === 'golden'){
    scene.background = new THREE.Color(0x12151e);
    if(scene.fog) scene.fog.color.set(0x12151e);
    if(amb){ amb.color.set(0x334455); amb.intensity = 0.28; }
    if(hemi){ hemi.color.set(0x7799bb); hemi.groundColor.set(0x342a20); hemi.intensity = 0.38; }
    if(sun){ sun.color.set(0xffd0a0); sun.intensity = 1.6; sun.position.set(-200,170,-110); sun.castShadow = true; }
    if(fill){ fill.color.set(0xffeedd); fill.intensity = 0.22; fill.position.set(150,70,190); }
    if(rim){ rim.color.set(0x7788bb); rim.intensity = 0.42; rim.position.set(70,190,-190); }
    if(renderer) renderer.toneMappingExposure = 0.95;
    // Subtle interior glow for golden hour — some units lit at dusk
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.18;
    });
    _setUnitGlow(0.45, 1.2);
    _setUnitInterior(0.15);
    // Restore standard glass at golden hour
    if(MAT.glass){ MAT.glass.opacity = 0.5; MAT.glass.metalness = 0.3; }
  } else if(mode === 'night'){
    scene.background = new THREE.Color(0x080a10);
    if(scene.fog) scene.fog.color.set(0x080a10);
    if(amb){ amb.color.set(0x1a1a2a); amb.intensity = 0.15; }
    if(hemi){ hemi.color.set(0x2a3040); hemi.groundColor.set(0x0a0a0a); hemi.intensity = 0.12; }
    if(sun){ sun.intensity = 0; sun.castShadow = false; }
    if(fill){ fill.intensity = 0.05; }
    if(rim){ rim.color.set(0x4455aa); rim.intensity = 0.15; }
    if(renderer) renderer.toneMappingExposure = 0.7;
    // Brighten interior glow for night — building lit up like an occupied tower
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.45;
    });
    // High emissive intensity needed because the curtain wall glass is tinted (0x8ab8d0),
    // metallic (0.3), and clearcoated — it dims any light coming from behind.
    _setUnitGlow(1.0, 2.8);
    // Back walls do NOT auto-glow at night — only lit units (~65% via glow planes) should appear lit.
    // Setting interior emissive to 0 at night keeps unlit units visibly dark for proper contrast.
    _setUnitInterior(0.0);
    // At night, make tower glass more transparent + less metallic so interior glow reads clearly
    if(MAT.glass){ MAT.glass.opacity = 0.25; MAT.glass.metalness = 0.05; }
  } else if(mode === 'day'){
    scene.background = new THREE.Color(0xc8d8e8);
    if(scene.fog) scene.fog.color.set(0xc8d8e8);
    if(amb){ amb.color.set(0x8899aa); amb.intensity = 0.5; }
    if(hemi){ hemi.color.set(0xaabbcc); hemi.groundColor.set(0x666660); hemi.intensity = 0.5; }
    if(sun){ sun.color.set(0xffffff); sun.intensity = 1.5; sun.position.set(-100,250,50); sun.castShadow = true; }
    if(fill){ fill.color.set(0xeeeeff); fill.intensity = 0.35; fill.position.set(150,70,190); }
    if(rim){ rim.color.set(0x99aacc); rim.intensity = 0.25; rim.position.set(70,190,-190); }
    if(renderer) renderer.toneMappingExposure = 1.2;
    // Hide interior glow during daytime — daylight overpowers any visible interior light
    scene.traverse(function(obj){
      if(obj.isMesh && obj.material === MAT.warmGlow) obj.material.opacity = 0.06;
    });
    _setUnitGlow(0.0, 0.0);
    _setUnitInterior(0.0);
    // Restore standard glass for daytime
    if(MAT.glass){ MAT.glass.opacity = 0.5; MAT.glass.metalness = 0.3; }
  }
  // Update sky dome if present
  scene.traverse(function(obj){
    if(obj.isMesh && obj.material && obj.material.type === 'ShaderMaterial' && obj.material.uniforms && obj.material.uniforms.topColor){
      if(mode === 'golden'){ obj.material.uniforms.topColor.value.set(0x1a2233); obj.material.uniforms.bottomColor.value.set(0x12151e); }
      else if(mode === 'night'){ obj.material.uniforms.topColor.value.set(0x050810); obj.material.uniforms.bottomColor.value.set(0x080a10); }
      else if(mode === 'day'){ obj.material.uniforms.topColor.value.set(0x6688bb); obj.material.uniforms.bottomColor.value.set(0xc8d8e8); }
    }
  });
  // Update buttons
  var btns = document.querySelectorAll('.lighting-btn');
  btns.forEach(function(b){ b.style.background = 'rgba(26,26,26,.85)'; b.style.color = '#888'; });
  var activeBtn = document.getElementById('btn-light-' + mode);
  if(activeBtn){ activeBtn.style.background = 'rgba(174,188,70,0.3)'; activeBtn.style.color = '#AEBC46'; }
}

if(typeof P._showInteriors==='undefined') P._showInteriors=false;
/**
 * Toggles interior visibility on/off and rebuilds the building to reflect the change.
 */
function toggleInteriors(){
  P._showInteriors=!P._showInteriors;
  var btn=document.getElementById('btnInteriors');
  if(btn){btn.style.background=P._showInteriors?'#e8a87a':'rgba(26,26,26,.85)';btn.style.color=P._showInteriors?'#111':'#e8a87a';}
  rebuildBuilding();
}

let _angularPlanesVisible=false;
let _angularPlaneGroup=null;

// Cache last computation for zoning dashboard
let _angularPlaneResults={front:null,rear:null};

/**
 * Compute which storeys of each volume penetrate a 45° angular plane.
 *
 * FRONT ANGULAR PLANE:
 *   Origin = opposite side of the primary street ROW, at grade (y=0).
 *   The plane rises at 45° toward the building from Z = -(ROW_width) in metres.
 *   At horizontal distance d from the origin, max height = d.
 *   For a building face at Z position z_face (in metres, measured from front lot line),
 *   distance from plane origin = ROW_width + z_face (front setback moves building further).
 *   Allowed height at face = ROW_width_m + z_face_m  (since tan(45°)=1).
 *
 * REAR TRANSITION PLANE:
 *   Origin = rear lot line at 10.5m height.
 *   Plane rises at 45° inward (toward front of lot).
 *   At horizontal distance d inward from rear lot line, max height = 10.5 + d.
 *   For a building rear face at Z position z_face from front,
 *   distance from rear = rearZ - z_face (in metres).
 *   Allowed height at face = 10.5 + (rearZ_m - z_rear_face_m).
 */
function computeAngularPlanes(){
  const lb=lotBounds();
  const rearZft=lb.maxZ;
  const rearZm=f2m(rearZft);

  // Find primary street (north-side road with largest width, or first road)
  let primaryRoad=null;
  P.roads.forEach(rd=>{
    if(rd.side==='north'||rd.side==='front'){
      if(!primaryRoad||rd.width>primaryRoad.width) primaryRoad=rd;
    }
  });
  if(!primaryRoad&&P.roads.length>0) primaryRoad=P.roads[0];
  const rowWidthFt=primaryRoad?primaryRoad.width:66;
  const rowWidthM=f2m(rowWidthFt);

  const frontResult={rowWidthM:rowWidthM,violations:[],maxAllowedAtFront:rowWidthM};
  const rearResult={originHeight:10.5,violations:[],maxAllowedAtRear:10.5};

  P.vols.forEach((vol,vi)=>{
    const storeyH_gf=f2m(vol.gfHeight||P.flr.gf);
    const storeyH_typ=f2m(P.flr.typ);
    const cx0=f2m(vol.startEg||0);
    const cz0=f2m(vol.offEast||0);
    const bw=f2m(vol.width||0);
    const bd=f2m(vol.depth||0);
    const angleRad=(vol.angle||0)*Math.PI/180;

    // For custom polygon volumes, use bounding box
    let volFrontZ,volRearZ;
    if(vol.customPoly&&vol.customPoly.length>=3){
      const zs=vol.customPoly.map(p=>f2m(p[1]));
      volFrontZ=Math.min(...zs);
      volRearZ=Math.max(...zs);
    } else {
      // For rectangular volumes, account for rotation
      if(Math.abs(angleRad)<0.01){
        volFrontZ=cz0;
        volRearZ=cz0+bd;
      } else {
        const corners=[[0,0],[bw,0],[bw,bd],[0,bd]];
        const cos=Math.cos(angleRad),sin=Math.sin(angleRad);
        const pivotX=bw/2,pivotZ=bd/2;
        const rotated=corners.map(c=>{
          const dx=c[0]-pivotX,dz=c[1]-pivotZ;
          return cz0+pivotZ+(dx*sin+dz*cos);
        });
        volFrontZ=Math.min(...rotated);
        volRearZ=Math.max(...rotated);
      }
    }

    // Check each storey
    const volViolationsFront=[];
    const volViolationsRear=[];
    let floorBase=0;
    for(let s=0;s<vol.storeys;s++){
      const floorH=(s===0)?storeyH_gf:storeyH_typ;
      const floorTop=floorBase+floorH;

      // FRONT: distance from opposite curb to building front face
      // Opposite curb is at Z = -rowWidthM (in metres, north of lot line)
      // Building front face is at volFrontZ (positive Z = south from lot origin)
      // Distance = rowWidthM + volFrontZ
      const distFront=rowWidthM+volFrontZ;
      const maxHeightFront=distFront; // tan(45°)=1

      if(floorTop>maxHeightFront+0.01){
        volViolationsFront.push({
          storey:s+1,
          floorTop:floorTop,
          maxAllowed:maxHeightFront,
          overshoot:floorTop-maxHeightFront
        });
      }

      // REAR: distance from rear lot line to building rear face
      // Rear lot line is at rearZm
      // Building rear face is at volRearZ
      const distRear=rearZm-volRearZ;
      const maxHeightRear=10.5+Math.max(0,distRear); // starts at 10.5m

      if(floorTop>maxHeightRear+0.01){
        volViolationsRear.push({
          storey:s+1,
          floorTop:floorTop,
          maxAllowed:maxHeightRear,
          overshoot:floorTop-maxHeightRear
        });
      }

      floorBase=floorTop;
    }

    if(volViolationsFront.length>0){
      frontResult.violations.push({volIndex:vi,label:vol.label||('Volume '+(vi+1)),storeys:volViolationsFront});
    }
    if(volViolationsRear.length>0){
      rearResult.violations.push({volIndex:vi,label:vol.label||('Volume '+(vi+1)),storeys:volViolationsRear});
    }
  });

  _angularPlaneResults={front:frontResult,rear:rearResult};
  return _angularPlaneResults;
}

/**
 * Render semi-transparent 45° angular plane surfaces in the 3D scene
 */
function renderAngularPlanes(){
  // Remove old group
  if(_angularPlaneGroup){
    disposeObject(_angularPlaneGroup);
    scene.remove(_angularPlaneGroup);
    _angularPlaneGroup=null;
  }
  if(!_angularPlanesVisible) return;

  _angularPlaneGroup=new THREE.Group();

  const lb=lotBounds();
  const lotW=f2m(lb.width);
  const lotD=f2m(lb.depth);
  const rearZm=f2m(lb.maxZ);
  const lotMinXm=f2m(lb.minX);
  const lotMaxXm=f2m(lb.maxX);

  // Find primary road ROW width
  let primaryRoad=null;
  P.roads.forEach(rd=>{
    if(rd.side==='north'||rd.side==='front'){
      if(!primaryRoad||rd.width>primaryRoad.width) primaryRoad=rd;
    }
  });
  if(!primaryRoad&&P.roads.length>0) primaryRoad=P.roads[0];
  const rowWidthM=f2m(primaryRoad?primaryRoad.width:66);

  // Extend planes a bit beyond lot boundaries for visibility
  const pad=2;
  const x0=lotMinXm-pad;
  const x1=lotMaxXm+pad;

  // ── FRONT ANGULAR PLANE (45° from opposite curb) ──
  // Plane origin: Z = -rowWidthM (opposite side of ROW), Y = 0
  // At any Z position, max height = rowWidthM + Z (since Z=0 is front lot line)
  // Plane rises at 45° going south, so at Z=0, height = rowWidthM
  // We render from Z = -rowWidthM (height=0) to Z = lotD+pad (height = rowWidthM + lotD+pad)
  const frontMaxH=rowWidthM+rearZm+pad;
  const frontGeo=new THREE.BufferGeometry();
  const frontVerts=new Float32Array([
    x0, 0, -rowWidthM,                    // bottom-left (at curb, height 0)
    x1, 0, -rowWidthM,                    // bottom-right
    x1, Math.min(frontMaxH,80), rearZm+pad, // top-right
    x0, 0, -rowWidthM,                    // bottom-left (repeat for 2nd triangle)
    x1, Math.min(frontMaxH,80), rearZm+pad,
    x0, Math.min(frontMaxH,80), rearZm+pad  // top-left
  ]);
  frontGeo.setAttribute('position',new THREE.BufferAttribute(frontVerts,3));
  frontGeo.computeVertexNormals();
  const frontMat=new THREE.MeshBasicMaterial({
    color:0x4ecdc4, transparent:true, opacity:0.15,
    side:THREE.DoubleSide, depthWrite:false
  });
  const frontMesh=new THREE.Mesh(frontGeo,frontMat);
  _angularPlaneGroup.add(frontMesh);

  // Front plane edge line
  const frontEdgeGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,0,-rowWidthM),
    new THREE.Vector3(x0,Math.min(frontMaxH,80),rearZm+pad),
    new THREE.Vector3(x1,Math.min(frontMaxH,80),rearZm+pad),
    new THREE.Vector3(x1,0,-rowWidthM),
    new THREE.Vector3(x0,0,-rowWidthM)
  ]);
  const frontEdge=new THREE.Line(frontEdgeGeo,new THREE.LineBasicMaterial({color:0x4ecdc4,transparent:true,opacity:0.5}));
  _angularPlaneGroup.add(frontEdge);

  // Label for front plane
  addTextSprite(_angularPlaneGroup,'45° FRONT ANGULAR PLANE',(x0+x1)/2,rowWidthM+2,-rowWidthM/2,'#4ecdc4',0.5);

  // ── REAR TRANSITION PLANE (45° from rear lot line at 10.5m) ──
  // Origin: Z = rearZm, Y = 10.5m
  // Going inward (decreasing Z), max height = 10.5 + (rearZm - Z)
  // At Z = rearZm: height = 10.5m
  // Plane rises at 45° going north
  const rearMaxH=10.5+rearZm+pad;
  const rearGeo=new THREE.BufferGeometry();
  const rearVerts=new Float32Array([
    x0, 10.5, rearZm,                           // bottom-left (at rear lot line, 10.5m)
    x1, 10.5, rearZm,                           // bottom-right
    x1, Math.min(rearMaxH,80), -pad,            // top-right (at front)
    x0, 10.5, rearZm,                           // bottom-left
    x1, Math.min(rearMaxH,80), -pad,
    x0, Math.min(rearMaxH,80), -pad             // top-left
  ]);
  rearGeo.setAttribute('position',new THREE.BufferAttribute(rearVerts,3));
  rearGeo.computeVertexNormals();
  const rearMat=new THREE.MeshBasicMaterial({
    color:0xe88d7a, transparent:true, opacity:0.15,
    side:THREE.DoubleSide, depthWrite:false
  });
  const rearMesh=new THREE.Mesh(rearGeo,rearMat);
  _angularPlaneGroup.add(rearMesh);

  // Rear plane edge line
  const rearEdgeGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,10.5,rearZm),
    new THREE.Vector3(x0,Math.min(rearMaxH,80),-pad),
    new THREE.Vector3(x1,Math.min(rearMaxH,80),-pad),
    new THREE.Vector3(x1,10.5,rearZm),
    new THREE.Vector3(x0,10.5,rearZm)
  ]);
  const rearEdge=new THREE.Line(rearEdgeGeo,new THREE.LineBasicMaterial({color:0xe88d7a,transparent:true,opacity:0.5}));
  _angularPlaneGroup.add(rearEdge);

  // Label for rear plane
  addTextSprite(_angularPlaneGroup,'45° REAR TRANSITION (10.5m)',(x0+x1)/2,12,rearZm+2,'#e88d7a',0.5);

  // 10.5m reference line at rear
  const refLineGeo=new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(x0,10.5,rearZm),
    new THREE.Vector3(x1,10.5,rearZm)
  ]);
  const refLine=new THREE.Line(refLineGeo,new THREE.LineBasicMaterial({color:0xe88d7a,transparent:true,opacity:0.8,linewidth:2}));
  _angularPlaneGroup.add(refLine);

  scene.add(_angularPlaneGroup);
}

/**
 * Toggles the angular-plane overlay visibility and recomputes compliance.
 */
function toggleAngularPlanes(){
  _angularPlanesVisible=!_angularPlanesVisible;
  const btn=document.getElementById('btn-angular-toggle');
  if(btn){
    btn.style.background=_angularPlanesVisible?'rgba(196,154,222,0.3)':'rgba(26,26,26,.85)';
    btn.style.borderColor=_angularPlanesVisible?'#c49ade':'#c49ade';
  }
  computeAngularPlanes();
  renderAngularPlanes();
  // Re-render zoning dashboard to update compliance rows
  try{renderZoningDashboard();}catch(e){}
}

// ═══════════════════════════════════════════════════════════
//  UI BUILDERS
// ═══════════════════════════════════════════════════════════

function makeRow(parent, label, obj, key, min, max, step, unit){
  const row=document.createElement('div');
  row.className='row';

  const lbl=document.createElement('label');
  lbl.textContent=label;

  const slider=document.createElement('input');
  slider.type='range';slider.min=min;slider.max=max;slider.step=step||1;
  slider.value=obj[key];

  const valWrap=document.createElement('span');
  valWrap.className='val';
  const valInput=document.createElement('input');
  valInput.type='number';valInput.min=min;valInput.max=max;valInput.step=step||1;
  valInput.value=obj[key];

  const unitSpan=document.createElement('span');
  unitSpan.className='unit';
  unitSpan.textContent=unit||'ft';

  slider.oninput=()=>{
    var _v = parseFloat(slider.value);
    if(!isFinite(_v)) _v = min;  // NaN guard
    obj[key]=_v;
    valInput.value=slider.value;
    rebuildAll();
  };
  valInput.onchange=()=>{
    let v=parseFloat(valInput.value);
    if(isNaN(v))v=min;
    v=Math.max(min,Math.min(max,v));
    obj[key]=v;
    slider.value=v;
    valInput.value=v;
    rebuildAll();
  };

  valWrap.appendChild(valInput);
  row.appendChild(lbl);
  row.appendChild(slider);
  row.appendChild(valWrap);
  row.appendChild(unitSpan);
  parent.appendChild(row);
}

function buildLotPanel(){
  const bd=document.getElementById('sec-lot-bd');
  bd.innerHTML='';

  // Lot dimensions come ONLY from the site map polygon
  if(P.lot.polyVerts && P.lot.polyVerts.length>=3){
    const vts=P.lot.polyVerts;
    const area=lotArea();

    // Source badge
    const badge=document.createElement('div');
    badge.style.cssText='background:#AEBC46;color:#111;padding:4px 8px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:1px;margin-bottom:8px;text-align:center';
    badge.textContent='FROM SITE MAP — '+vts.length+' VERTICES';
    bd.appendChild(badge);

    // Area summary
    const areaDiv=document.createElement('div');
    areaDiv.style.cssText='text-align:center;margin-bottom:8px;padding:6px;background:#1A1A1A;border-radius:4px';
    const areaM=Math.round(area*0.0929);
    areaDiv.innerHTML=`<div style="font-size:18px;font-weight:700;color:#AEBC46">${Math.round(area).toLocaleString()} sq ft</div>
      <div style="font-size:10px;color:#777">${areaM.toLocaleString()} sq m / ${(area/43560).toFixed(2)} acres</div>`;
    bd.appendChild(areaDiv);

    // Edge dimensions (read-only, sourced from site map)
    for(let i=0;i<vts.length;i++){
      const j=(i+1)%vts.length;
      const dx=vts[j][0]-vts[i][0], dz=vts[j][1]-vts[i][1];
      const len=Math.round(Math.sqrt(dx*dx+dz*dz));
      const lenM=(len*0.3048).toFixed(1);
      const bearing=Math.atan2(dx,dz)*180/Math.PI;
      const dirs=['N','NE','E','SE','S','SW','W','NW'];
      const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];

      const row=document.createElement('div');
      row.style.cssText='display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#1A1A1A;border-radius:4px;border-left:3px solid #AEBC46;margin-bottom:4px';
      row.innerHTML=`<div><span style="font-size:10px;color:#777">Edge ${String.fromCharCode(65+i)}</span><br><span style="font-size:9px;color:#445">${compass}</span></div>
        <div style="text-align:right"><span style="font-size:14px;font-weight:600;color:#AEBC46">${len}'</span><br><span style="font-size:9px;color:#777">${lenM}m</span></div>`;
      bd.appendChild(row);
    }

    // Link back to site map to edit
    const editBtn=document.createElement('button');
    editBtn.className='btn-add';
    editBtn.style.cssText='background:#444444;color:#AEBC46;margin-top:8px;width:100%';
    editBtn.textContent='Edit Lot in Site Map';
    editBtn.onclick=()=>{switchTab('sitemap');};
    bd.appendChild(editBtn);

  } else {
    // No polygon yet — prompt user to go to site map
    const msg=document.createElement('div');
    msg.style.cssText='text-align:center;padding:20px 12px;color:#777';
    msg.innerHTML=`<div style="font-size:32px;margin-bottom:8px">📍</div>
      <div style="font-size:13px;font-weight:600;color:#aaa;margin-bottom:6px">No lot defined yet</div>
      <div style="font-size:11px;color:#777;margin-bottom:12px">Draw your lot polygon on the Site Map tab first. The lot dimensions will automatically appear here.</div>`;
    bd.appendChild(msg);

    const goBtn=document.createElement('button');
    goBtn.className='btn-add';
    goBtn.style.cssText='background:#AEBC46;color:#111;font-weight:700;width:100%;padding:10px';
    goBtn.textContent='Go to Site Map';
    goBtn.onclick=()=>{switchTab('sitemap');};
    bd.appendChild(goBtn);
  }
}

function buildSetbackPanel(){
  const bd=document.getElementById('sec-set-bd');
  bd.innerHTML='';
  makeRow(bd,'Front (North)',P.set,'front',0,30,1);
  makeRow(bd,'Stepback @13.5m',P.set,'stepback',0,20,1);
  makeRow(bd,'Side (East)',P.set,'sideE',0,30,1);
  makeRow(bd,'Side (West)',P.set,'sideW',0,30,1);
  makeRow(bd,'Rear (South)',P.set,'rear',0,50,1);
}

if(typeof P._showRoads==='undefined') P._showRoads=false;

function buildRoadsPanel(){
  if(!Array.isArray(P.roads)) P.roads=[];
  const bd=document.getElementById('sec-roads-bd');
  bd.innerHTML='';

  // Toggle roads visibility
  const togRow=document.createElement('div');
  togRow.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;background:#1A1A1A;border-radius:6px';
  const togCb=document.createElement('input');togCb.type='checkbox';
  togCb.checked=P._showRoads;
  togCb.style.cssText='accent-color:#AEBC46;width:16px;height:16px;cursor:pointer';
  togCb.onchange=()=>{P._showRoads=togCb.checked;rebuildAll();};
  const togLbl=document.createElement('span');
  togLbl.style.cssText='font-size:12px;font-weight:600;color:#AEBC46';
  togLbl.textContent=P._showRoads?'Roads Visible':'Roads Hidden';
  togRow.appendChild(togCb);togRow.appendChild(togLbl);
  bd.appendChild(togRow);

  P.roads.forEach((rd,i)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #444444;border-radius:6px;margin-bottom:8px;overflow:hidden';

    const hd=document.createElement('div');
    hd.style.cssText='padding:5px 8px;background:#2D2D2D;display:flex;justify-content:space-between;align-items:center';
    const nm=document.createElement('span');nm.style.cssText='font-size:10px;font-weight:600;color:#AEBC46';
    nm.textContent='Road '+(i+1)+' — '+rd.label;
    const del=document.createElement('button');del.className='btn-del';del.textContent='X';
    del.onclick=()=>{ if(!confirm('Delete this road?')) return; P.roads.splice(i,1);buildRoadsPanel();rebuildAll()};
    hd.appendChild(nm);hd.appendChild(del);card.appendChild(hd);

    const body=document.createElement('div');body.style.cssText='padding:6px 8px';

    // Label
    const lr=document.createElement('div');lr.className='row';
    lr.innerHTML='<label style="flex:0 0 110px;font-size:11px;color:#aaa">Label</label>';
    const li=document.createElement('input');li.type='text';li.value=rd.label;
    li.style.cssText='flex:1;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;padding:4px 6px;border-radius:3px;font-size:11px;font-family:inherit';
    li.onchange=()=>{rd.label=li.value;buildRoadsPanel();rebuildAll()};
    lr.appendChild(li);body.appendChild(lr);

    // Side dropdown
    const sr=document.createElement('div');sr.className='row';
    sr.innerHTML='<label style="flex:0 0 110px;font-size:11px;color:#aaa">Side</label>';
    const sel=document.createElement('select');
    sel.style.cssText='flex:1;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;padding:4px;border-radius:3px;font-size:11px;font-family:inherit';
    ['north','south','east','west'].forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s.charAt(0).toUpperCase()+s.slice(1);if(rd.side===s)o.selected=true;sel.appendChild(o)});
    sel.onchange=()=>{rd.side=sel.value;rebuildAll()};
    sr.appendChild(sel);body.appendChild(sr);

    makeRow(body,'Offset',rd,'offZ',-80,80,1);
    makeRow(body,'Angle (°)',rd,'angle',-45,45,1,'°');
    makeRow(body,'Width',rd,'width',15,120,1);
    makeRow(body,'Label Size',rd,'fontSize',6,30,1,'px');

    card.appendChild(body);bd.appendChild(card);
  });

  const addBtn=document.createElement('button');addBtn.className='btn-add';addBtn.textContent='+ Add Road';
  addBtn.onclick=()=>{
    P.roads.push({label:'NEW ROAD',offZ:0,angle:0,width:40,fontSize:14,side:'east'});
    buildRoadsPanel();rebuildAll();
  };
  bd.appendChild(addBtn);
}

function buildLandscapePanel(){
  if(!Array.isArray(P.landscape)) P.landscape=[];
  const bd=document.getElementById('sec-landscape-bd');
  bd.innerHTML='';

  // Quick-add buttons
  const btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px';
  [{label:'🌳 Tree',type:'tree'},{label:'🌿 Bush',type:'bush'},{label:'🌳🌳 Tree Row',type:'tree-row'},{label:'🌿🌿 Bush Row',type:'bush-row'}].forEach(opt=>{
    const b=document.createElement('button');b.className='btn-add';
    b.style.cssText='flex:1;min-width:80px;padding:5px 8px;font-size:10px';
    b.textContent=opt.label;
    b.onclick=()=>{
      // Place at lot center with slight random offset
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]),allZ=vts.map(v=>v[1]);
      const cx=(Math.min(...allX)+Math.max(...allX))/2;
      const cz=(Math.min(...allZ)+Math.max(...allZ))/2;
      const item={type:opt.type,x:Math.round(cx+Math.random()*20-10),z:Math.round(cz+Math.random()*20-10)};
      if(opt.type.includes('row')){item.count=6;item.spacing=8;item.angle=90;}
      P.landscape.push(item);
      buildLandscapePanel();rebuildAll();
    };
    btnRow.appendChild(b);
  });
  bd.appendChild(btnRow);

  // List existing items
  P.landscape.forEach((item,i)=>{
    const card=document.createElement('div');
    card.style.cssText='border:1px solid #444444;border-radius:4px;margin-bottom:6px;padding:6px 8px;background:#1A1A1A';

    const hdr=document.createElement('div');
    hdr.style.cssText='display:flex;justify-content:space-between;align-items:center;margin-bottom:4px';
    const icon=item.type==='tree'?'🌳':item.type==='bush'?'🌿':item.type==='tree-row'?'🌳🌳':'🌿🌿';
    const lbl=document.createElement('span');lbl.style.cssText='font-size:11px;font-weight:600;color:#AEBC46';
    lbl.textContent=icon+' '+item.type.replace('-',' ').toUpperCase();
    const del=document.createElement('button');del.className='btn-del';del.textContent='X';del.style.cssText='padding:1px 6px;font-size:10px';
    del.onclick=()=>{ if(!confirm('Delete this landscape feature?')) return; P.landscape.splice(i,1);buildLandscapePanel();rebuildAll()};
    hdr.appendChild(lbl);hdr.appendChild(del);card.appendChild(hdr);

    makeRow(card,'X Position',item,'x',-100,300,1);
    makeRow(card,'Z Position',item,'z',-100,300,1);
    if(item.type.includes('row')){
      makeRow(card,'Count',item,'count',2,20,1);
      makeRow(card,'Spacing',item,'spacing',3,20,1);
      makeRow(card,'Angle (°)',item,'angle',0,360,5,'°');
    }
    bd.appendChild(card);
  });

  if(P.landscape.length===0){
    const empty=document.createElement('div');
    empty.style.cssText='font-size:10px;color:#777;text-align:center;padding:8px';
    empty.textContent='No landscape items. Click a button above to add.';
    bd.appendChild(empty);
  }
}

function buildFloorPanel(){
  const bd=document.getElementById('sec-flr-bd');
  bd.innerHTML='';
  makeRow(bd,'Ground (Comm.)',P.flr,'gf',12,25,0.5);
  makeRow(bd,'Typical Res.',P.flr,'typ',8,15,0.5);
}

function buildVolPanel(){
  const list=document.getElementById('vol-list');
  list.innerHTML='';
  P.vols.forEach((vol,i)=>{
    const card=document.createElement('div');
    card.className='vol-card';
    card.style.borderColor=vol.color;

    const hd=document.createElement('div');
    hd.className='vol-hd';
    hd.style.background=vol.color+'33';

    const nameSpan=document.createElement('span');
    nameSpan.textContent='VOLUME '+vol.name;
    nameSpan.style.color=vol.color;

    const delBtn=document.createElement('button');
    delBtn.className='btn-del';
    delBtn.textContent='X';
    delBtn.onclick=()=>{ if(!confirm('Delete Volume "'+(P.vols[i]&&P.vols[i].name||'')+'"? This removes the entire building mass.')) return; P.vols.splice(i,1);buildVolPanel();rebuildAll()};

    hd.appendChild(nameSpan);
    hd.appendChild(delBtn);
    card.appendChild(hd);

    const bd=document.createElement('div');
    bd.className='vol-bd';

    // ── GEOMETRY ──
    const geoTitle=document.createElement('div');
    geoTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin-bottom:4px;letter-spacing:1px';
    geoTitle.textContent='GEOMETRY';
    bd.appendChild(geoTitle);

      // Residential/mixed-use controls
      makeRow(bd,'Storeys',vol,'storeys',1,40,1,'fl');
      makeRow(bd,'Position (N→S)',vol,'startEg',-50,400,1);
      makeRow(bd,'Depth',vol,'depth',5,400,1);
      makeRow(bd,'Width',vol,'width',5,400,1);
      makeRow(bd,'Offset East',vol,'offEast',-200,200,1);
      if(vol.offWest===undefined) vol.offWest=0;
      makeRow(bd,'Offset West',vol,'offWest',-50,150,1);
      if(vol.angle===undefined) vol.angle=0;
      makeRow(bd,'Rotation (°)',vol,'angle',0,359,1,'°');

      // ── PODIUM / TOWER ──
      const ptTitle=document.createElement('div');
      ptTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
      ptTitle.textContent='PODIUM / TOWER';
      bd.appendChild(ptTitle);
      if(vol.podiumStoreys===undefined) vol.podiumStoreys=0;
      if(vol.stepbackAmt===undefined) vol.stepbackAmt=5;
      makeRow(bd,'Podium Storeys',vol,'podiumStoreys',0,10,1,'fl');
      if(vol.podiumStoreys>0) makeRow(bd,'Tower Step-back',vol,'stepbackAmt',0,30,1);

      // ── GROUND FLOOR ──
      const gfTitle=document.createElement('div');
      gfTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
      gfTitle.textContent='GROUND FLOOR';
      bd.appendChild(gfTitle);

      const commRow=document.createElement('div');
      commRow.className='row';
      const commLbl=document.createElement('label');
      commLbl.textContent='Commercial GF';
      const commCb=document.createElement('input');
      commCb.type='checkbox';
      commCb.checked=!!vol.commGF;
      commCb.style.cssText='accent-color:#AEBC46;width:18px;height:18px;cursor:pointer';
      commCb.onchange=()=>{vol.commGF=commCb.checked?1:0;rebuildAll();buildVolPanel()};
      const commNote=document.createElement('span');
      commNote.style.cssText='font-size:10px;color:#888;margin-left:6px';
      commNote.textContent=vol.commGF?`${P.flr.gf}' GF height`:`${P.flr.typ}' GF height`;
      commRow.appendChild(commLbl);
      commRow.appendChild(commCb);
      commRow.appendChild(commNote);
      bd.appendChild(commRow);
      if(vol.gfHeight===undefined) vol.gfHeight=0;
      makeRow(bd,'GF Height Override',vol,'gfHeight',0,25,0.5,'ft');
      const gfNote=document.createElement('div');
      gfNote.style.cssText='font-size:9px;color:#777;margin:-4px 0 4px 136px';
      gfNote.textContent=vol.gfHeight>0?`Using ${vol.gfHeight}' custom`:'Using global default';
      bd.appendChild(gfNote);

    // ── ACTIONS ──
    const actTitle=document.createElement('div');
    actTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin:8px 0 4px;letter-spacing:1px';
    actTitle.textContent='ACTIONS';
    bd.appendChild(actTitle);
    const actRow=document.createElement('div');
    actRow.style.cssText='display:flex;gap:4px;margin-bottom:6px';

    const dupBtn=document.createElement('button');
    dupBtn.className='btn-add';dupBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    dupBtn.textContent='📋 Duplicate';
    dupBtn.onclick=()=>{
      const copy=JSON.parse(JSON.stringify(vol));
      copy.name=String.fromCharCode(65+P.vols.length);
      copy.startEg=vol.startEg+10;
      copy.color=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'][P.vols.length%6];
      P.vols.push(copy);buildVolPanel();rebuildAll();
    };
    actRow.appendChild(dupBtn);

    const mirBtn=document.createElement('button');
    mirBtn.className='btn-add';mirBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    mirBtn.textContent='🪞 Mirror';
    mirBtn.onclick=()=>{
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]);
      const lotW=Math.max(...allX)-Math.min(...allX);
      const copy=JSON.parse(JSON.stringify(vol));
      copy.name=String.fromCharCode(65+P.vols.length);
      // Mirror: swap east/west offsets relative to lot center
      copy.offEast=lotW-vol.offEast-vol.width;
      if(copy.offEast<0) copy.offEast=0;
      copy.angle=-vol.angle;
      copy.color=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'][P.vols.length%6];
      P.vols.push(copy);buildVolPanel();rebuildAll();
    };
    actRow.appendChild(mirBtn);

    const snapBtn=document.createElement('button');
    snapBtn.className='btn-add';snapBtn.style.cssText='flex:1;padding:4px;font-size:9px;background:#444444;color:#AEBC46';
    snapBtn.textContent='📐 Snap Edge';
    snapBtn.onclick=()=>{
      const side=prompt('Snap to which lot edge?\n\nType: north, south, east, or west');
      if(!side) return;
      const vts=lotVerts();
      const allX=vts.map(v=>v[0]),allZ=vts.map(v=>v[1]);
      const lotMinX=Math.min(...allX),lotMaxX=Math.max(...allX);
      const lotMinZ=Math.min(...allZ),lotMaxZ=Math.max(...allZ);
      if(side==='north') vol.startEg=Math.round(lotMinZ);
      else if(side==='south') vol.startEg=Math.round(lotMaxZ-vol.depth);
      else if(side==='east') vol.offEast=0;
      else if(side==='west') vol.offEast=Math.round(lotMaxX-lotMinX-vol.width);
      buildVolPanel();rebuildAll();
    };
    actRow.appendChild(snapBtn);
    bd.appendChild(actRow);

    // ── FACADE CUSTOMIZATION ──
    {
    const facSec=document.createElement('div');
    facSec.style.cssText='margin-top:8px;padding-top:8px;border-top:1px solid #333333';
    const facTitle=document.createElement('div');
    facTitle.style.cssText='font-size:10px;font-weight:700;color:#AEBC46;margin-bottom:4px;letter-spacing:1px';
    facTitle.textContent='FACADE';
    facSec.appendChild(facTitle);

    // Cladding material dropdown
    if(vol.cladding===undefined) vol.cladding=(vol.storeys<=4?'brick':'brick');
    const cladRow=document.createElement('div');cladRow.className='row';
    const cladLbl=document.createElement('label');cladLbl.textContent='Cladding';
    const cladSel=document.createElement('select');
    cladSel.style.cssText='background:#1a1a1a;border:1px solid #444;color:#AEBC46;padding:3px 6px;border-radius:3px;font-size:11px;flex:1';
    [{v:'brick',t:'Brick'},{v:'cedar',t:'Cedar Slat'},{v:'metal',t:'Metal Panel'},{v:'precast',t:'Precast Concrete'},{v:'stone',t:'Stone'}].forEach(function(o){
      var opt=document.createElement('option');opt.value=o.v;opt.textContent=o.t;
      if(vol.cladding===o.v) opt.selected=true;
      cladSel.appendChild(opt);
    });
    cladSel.onchange=function(){vol.cladding=cladSel.value;rebuildAll()};
    cladRow.appendChild(cladLbl);cladRow.appendChild(cladSel);
    facSec.appendChild(cladRow);

    // Frontages (per-face storefront toggles)
    const sfTitle=document.createElement('div');
    sfTitle.style.cssText='font-size:9px;font-weight:600;color:#aaa;margin:6px 0 3px;letter-spacing:0.5px';
    sfTitle.textContent='GROUND FLOOR FRONTAGES';
    facSec.appendChild(sfTitle);
    if(vol.storefrontN===undefined) vol.storefrontN=1;
    if(vol.storefrontS===undefined) vol.storefrontS=0;
    if(vol.storefrontE===undefined) vol.storefrontE=0;
    if(vol.storefrontW===undefined) vol.storefrontW=0;
    const sfGrid=document.createElement('div');
    sfGrid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:2px 0 6px';
    [{key:'storefrontN',label:'North'},{key:'storefrontS',label:'South'},{key:'storefrontE',label:'East'},{key:'storefrontW',label:'West'}].forEach(function(s){
      var sRow=document.createElement('div');
      sRow.style.cssText='display:flex;align-items:center;gap:5px';
      var cb=document.createElement('input');cb.type='checkbox';
      cb.checked=!!vol[s.key];
      cb.style.cssText='accent-color:#AEBC46;width:14px;height:14px;cursor:pointer';
      cb.onchange=function(){vol[s.key]=cb.checked?1:0;rebuildAll()};
      var lb2=document.createElement('span');
      lb2.style.cssText='font-size:11px;color:#aaa';
      lb2.textContent='Storefront '+s.label;
      sRow.appendChild(cb);sRow.appendChild(lb2);
      sfGrid.appendChild(sRow);
    });
    facSec.appendChild(sfGrid);
    // Ensure defaults exist (for older saved projects)
    if(vol.windows===undefined) vol.windows=1;
    if(vol.winSpacing===undefined) vol.winSpacing=3;
    if(vol.balconies===undefined) vol.balconies=1;
    if(vol.balcEvery===undefined) vol.balcEvery=2;
    if(vol.balcDepth===undefined) vol.balcDepth=4;
    // Init per-side balcony flags (default: N+S on if master on, E+W off)
    if(vol.balcN===undefined) vol.balcN=vol.balconies?1:0;
    if(vol.balcS===undefined) vol.balcS=vol.balconies?1:0;
    if(vol.balcE===undefined) vol.balcE=0;
    if(vol.balcW===undefined) vol.balcW=0;
    // Windows toggle
    const winRow=document.createElement('div');winRow.className='row';
    const winLbl=document.createElement('label');winLbl.textContent='Windows';
    const winCb=document.createElement('input');winCb.type='checkbox';
    winCb.checked=!!vol.windows;
    winCb.style.cssText='accent-color:#AEBC46;width:16px;height:16px;cursor:pointer';
    winCb.onchange=()=>{vol.windows=winCb.checked?1:0;rebuildAll()};
    winRow.appendChild(winLbl);winRow.appendChild(winCb);
    facSec.appendChild(winRow);
    if(vol.windows) makeRow(facSec,'Win. Spacing',vol,'winSpacing',1,8,0.5,'m');

    // Balcony settings
    makeRow(facSec,'Balc. Every N Floors',vol,'balcEvery',1,5,1,'fl');
    makeRow(facSec,'Balc. Depth',vol,'balcDepth',2,8,0.5,'ft');

    // Per-side balcony toggles in a compact grid
    const balGrid=document.createElement('div');
    balGrid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:2px 8px;margin:4px 0';
    const sides=[
      {key:'balcN',label:'North'},
      {key:'balcS',label:'South'},
      {key:'balcE',label:'East'},
      {key:'balcW',label:'West'}
    ];
    sides.forEach(s=>{
      const sRow=document.createElement('div');
      sRow.style.cssText='display:flex;align-items:center;gap:5px';
      const cb=document.createElement('input');cb.type='checkbox';
      cb.checked=!!vol[s.key];
      cb.style.cssText='accent-color:#AEBC46;width:14px;height:14px;cursor:pointer';
      cb.onchange=()=>{vol[s.key]=cb.checked?1:0;rebuildAll()};
      const lb=document.createElement('span');
      lb.style.cssText='font-size:11px;color:#aaa';
      lb.textContent=`Balc. ${s.label}`;
      sRow.appendChild(cb);sRow.appendChild(lb);
      balGrid.appendChild(sRow);
    });
    facSec.appendChild(balGrid);

    // All-on / All-off quick buttons
    const balBtns=document.createElement('div');
    balBtns.style.cssText='display:flex;gap:4px;margin:2px 0 4px';
    const allOnBtn=document.createElement('button');
    allOnBtn.className='btn-add';allOnBtn.style.cssText='flex:1;padding:2px 4px;font-size:9px;background:#444444;color:#AEBC46';
    allOnBtn.textContent='All Sides On';
    allOnBtn.onclick=()=>{vol.balcN=vol.balcS=vol.balcE=vol.balcW=1;buildVolPanel();rebuildAll()};
    const allOffBtn=document.createElement('button');
    allOffBtn.className='btn-add';allOffBtn.style.cssText='flex:1;padding:2px 4px;font-size:9px;background:#444444;color:#ff6644';
    allOffBtn.textContent='All Sides Off';
    allOffBtn.onclick=()=>{vol.balcN=vol.balcS=vol.balcE=vol.balcW=0;buildVolPanel();rebuildAll()};
    balBtns.appendChild(allOnBtn);balBtns.appendChild(allOffBtn);
    facSec.appendChild(balBtns);
    bd.appendChild(facSec);
    } // end facade section

    // Live-updating info div (refreshed by updateVolInfo on every change)
    const info=document.createElement('div');
    info.id='vol-info-'+i;
    info.style.cssText='font-size:11px;color:#888;margin-top:6px;padding-top:6px;border-top:1px solid #333333';
    bd.appendChild(info);

    card.appendChild(bd);
    list.appendChild(card);
  });
}

// ── Live-update per-volume info (overlap, floor plate, height) ──
function updateVolInfo(){
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMaxX=Math.max(...allX);

  P.vols.forEach((vol,i)=>{
    const el=document.getElementById('vol-info-'+i);
    if(!el)return;

    const fp=vol.width*vol.depth;
    const hasComm=vol.commGF?true:false;
    const gfH=hasComm?f2m(P.flr.gf):f2m(P.flr.typ);
    const totalH=gfH+(vol.storeys-1)*f2m(P.flr.typ);

    // Check overlap with every other volume
    let overlapArea=0;
    P.vols.forEach((other,j)=>{
      if(j===i)return;
      const ax1=lotMaxX-vol.offEast, ax0=ax1-vol.width;
      const az0=vol.startEg, az1=vol.startEg+vol.depth;
      const bx1=lotMaxX-other.offEast, bx0=bx1-other.width;
      const bz0=other.startEg, bz1=other.startEg+other.depth;
      const ox=Math.max(0,Math.min(ax1,bx1)-Math.max(ax0,bx0));
      const oz=Math.max(0,Math.min(az1,bz1)-Math.max(az0,bz0));
      const commonStoreys=Math.min(vol.storeys,other.storeys);
      if(ox>0&&oz>0&&commonStoreys>0) overlapArea+=ox*oz*commonStoreys;
    });

    const hasAngle=Math.abs(vol.angle||0)>0.5;
    const overlapNote=overlapArea>1
      ? `<br><span style="color:#ff6644;font-weight:600">⚠ ~${Math.round(overlapArea).toLocaleString()} sf overlaps${hasAngle?' (approx. — rotated)':''}</span>`
      : '<br><span style="color:#4a8">✓ No overlap</span>';
    const angleNote=hasAngle?` · <span style="color:#d4a">⟳ ${vol.angle}°</span>`:'';

    el.innerHTML=`Floor plate: <b style="color:#AEBC46">${fp.toLocaleString()} sq ft</b> · `
      +`Height: <b style="color:#AEBC46">${(totalH*3.281).toFixed(0)} ft (${totalH.toFixed(1)}m)</b>`
      +angleNote+overlapNote;
  });
}

// ── Click-to-place mode for new volumes ──
let _placeMode={active:false,preview:null};

/**
 * Activates placement mode so the user can click on the lot to add a new building volume.
 */
function addVolume(){
  // Enter placement mode — next click on the lot sets the position
  _placeMode.active=true;
  // Show placement banner
  let banner=document.getElementById('place-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='place-banner';
    banner.style.cssText='position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:100;background:#AEBC46;color:#1A1A1A;padding:8px 20px;border-radius:6px;font-weight:700;font-size:13px;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.4)';
    document.getElementById('canvas-wrap').appendChild(banner);
  }
  banner.textContent='CLICK ON THE LOT TO PLACE NEW VOLUME';
  banner.style.display='block';

  // Change cursor
  const cv=document.getElementById('c3d');
  if(cv) cv.style.cursor='crosshair';
}

function _handlePlaceClick(e){
  if(!_placeMode.active)return false;
  const cv=document.getElementById('c3d');
  if(!cv)return false;
  const rect=cv.getBoundingClientRect();
  _mouse.x=((e.clientX-rect.left)/rect.width)*2-1;
  _mouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
  _ray.setFromCamera(_mouse,camera);
  const hitPt=new THREE.Vector3();
  const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  if(!_ray.ray.intersectPlane(plane,hitPt))return false;

  // Convert world coords (metres) to lot coords (feet)
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const maxZ=lotBounds().maxZ;

  const clickXft=hitPt.x/FT; // world X in feet
  const clickZft=hitPt.z/FT; // world Z in feet (= startEg)

  // Check if click is within lot bounds (with tolerance)
  if(clickXft<lotMinX-10||clickXft>lotMaxX+10||clickZft<-10||clickZft>maxZ+10){
    // Clicked outside lot — cancel
    _cancelPlace();
    return true;
  }

  // Create the volume centered on the click point
  const defW=50, defD=40;
  const offEast=Math.max(-50,Math.min(150,Math.round(lotMaxX-clickXft-defW/2)));
  const startEg=Math.max(0,Math.min(maxZ-defD,Math.round(clickZft-defD/2)));

  const colors=['#b8c4d0','#8899aa','#99aabb','#aabbcc','#7788aa','#bbccdd'];
  const c=colors[P.vols.length%colors.length];
  const letter=String.fromCharCode(65+P.vols.length);
  P.vols.push({name:letter,storeys:4,startEg:startEg,depth:defD,width:defW,offEast:offEast,offWest:0,
    angle:0,podiumStoreys:0,stepbackAmt:5,gfHeight:0,
    color:c,commGF:0,windows:1,winSpacing:3,balconies:1,balcEvery:2,balcDepth:4,
    balcN:1,balcS:1,balcE:0,balcW:0});

  _cancelPlace();
  buildVolPanel();
  rebuildAll();
  return true;
}

function _cancelPlace(){
  _placeMode.active=false;
  const banner=document.getElementById('place-banner');
  if(banner)banner.style.display='none';
  const cv=document.getElementById('c3d');
  if(cv)cv.style.cursor='';
}

// ── Overlap-aware GFA: rasterize volumes per storey onto a 1ft grid ──
function computeGFA(){
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMinX=Math.min(...allX), lotMaxX=Math.max(...allX);
  const maxZ=lotBounds().maxZ;

  // Helper: get bounds for any volume (freeform or rectangular)
  function getBounds(vol){
    if(vol.customPolyLocal&&vol.customPolyLocal.length>=4){
      const xs=vol.customPolyLocal.map(p=>p[0]), zs=vol.customPolyLocal.map(p=>p[1]);
      return {minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)};
    }
    const x1=(lotMaxX||0)-(vol.offEast||0);
    const x0=x1-vol.width;
    return {minX:x0,maxX:x1,minZ:vol.startEg,maxZ:vol.startEg+vol.depth};
  }

  // Check if any volumes are freeform polygons — if so, use per-volume actual areas
  const hasCustom=P.vols.some(v=>v.customPolyLocal&&v.customPolyLocal.length>=4);

  if(hasCustom){
    // ── Step 1: Compute total GFA per storey using UNION (not sum) ──
    // For each storey, collect all volumes active at that storey,
    // then compute union = largest footprint at that level (no double-count)
    const maxStorey=P.vols.reduce((m,v)=>Math.max(m,v.storeys),0);
    if(maxStorey===0) return {totalGFA:0,commGFA:0,resGFA:0,overlap:0,perStorey:[]};

    // Pre-compute each volume's footprint area (podium vs tower)
    // When a volume has podiumStoreys > 0 and stepbackAmt, tower floors above the podium
    // use a reduced footprint area matching the visual stepback in the renderer.
    const volFPs=P.vols.map((vol,vi)=>{
      const isCustom=vol.customPolyLocal&&vol.customPolyLocal.length>=4;
      const baseFP=isCustom?(vol.customAreaSF||0):(vol.width*vol.depth);
      let towerFP=baseFP; // default: same as podium
      const podFloors=vol.podiumStoreys||0;

      // Compute tower plate area after stepback (same centroid-shrink as renderer)
      if(podFloors>0 && (vol.stepbackAmt||0)>0){
        if(isCustom && vol.customPolyLocal && vol.customPolyLocal.length>=4){
          // Shrink polygon toward centroid by stepbackAmt feet, compute area
          const poly=vol.customPolyLocal;
          const n=poly[0][0]===poly[poly.length-1][0]&&poly[0][1]===poly[poly.length-1][1]?poly.length-1:poly.length;
          let cx=0,cz=0;
          for(let i=0;i<n;i++){cx+=poly[i][0];cz+=poly[i][1];}
          cx/=n; cz/=n;
          const stepFt=vol.stepbackAmt;
          // Compute scale factor for each vertex (same as renderer's centroid shrink)
          let towerArea=0;
          const shrunk=[];
          for(let i=0;i<n;i++){
            const dx=poly[i][0]-cx, dz=poly[i][1]-cz;
            const dist=Math.sqrt(dx*dx+dz*dz);
            const scale=dist>0.01?Math.max(0.3,(dist-stepFt)/dist):1;
            shrunk.push([cx+dx*scale, cz+dz*scale]);
          }
          // Shoelace area of shrunk polygon
          for(let i=0;i<shrunk.length;i++){
            const j=(i+1)%shrunk.length;
            towerArea+=shrunk[i][0]*shrunk[j][1]-shrunk[j][0]*shrunk[i][1];
          }
          towerFP=Math.abs(towerArea)/2;
        } else {
          // Rectangle: reduce width and depth by stepback on each side
          const tw=Math.max(20, vol.width - vol.stepbackAmt*2);
          const td=Math.max(20, vol.depth - vol.stepbackAmt*2);
          towerFP=tw*td;
        }
      }

      return {
        fpArea:baseFP, towerFpArea:towerFP, podiumStoreys:podFloors,
        storeys:vol.storeys, commGF:!!vol.commGF, bounds:getBounds(vol), name:vol.name||('Vol'+vi)
      };
    }).filter(v=>v.fpArea>0&&v.storeys>0);

    let totalGFA=0;
    let naiveSum=volFPs.reduce((s,v)=>{
      // podiumStoreys = upper floors at full lot (not counting GF), so GF+podium = podiumStoreys+1
      const podTotal=Math.min(v.podiumStoreys+1,v.storeys); // GF + podium upper floors
      const twr=Math.max(0,v.storeys-podTotal);
      return s+v.fpArea*podTotal+v.towerFpArea*twr;
    },0);
    const perStorey=[];

    // For each storey, compute the UNION area of all active volumes
    // Using inclusion-exclusion on bounding box overlaps
    // Storey 1 = ground floor, storeys 2..podiumStoreys = podium, above = tower (smaller plate)
    for(let s=1;s<=maxStorey;s++){
      const active=volFPs.filter(v=>s<=v.storeys);
      if(active.length===0){perStorey.push({storey:s,area:0,volumes:[]});continue;}

      let storeyArea;
      if(active.length===1){
        const v=active[0];
        // Use tower plate area for floors above podium
        storeyArea=(v.podiumStoreys>0 && s>v.podiumStoreys+1) ? v.towerFpArea : v.fpArea;
      } else {
        storeyArea=active.reduce((sum,v)=>{
          return sum+((v.podiumStoreys>0 && s>v.podiumStoreys+1) ? v.towerFpArea : v.fpArea);
        },0);
        for(let i=0;i<active.length;i++){
          for(let j=i+1;j<active.length;j++){
            const a=active[i].bounds, b=active[j].bounds;
            if(!a||!b)continue;
            const ox=Math.max(0,Math.min(a.maxX,b.maxX)-Math.max(a.minX,b.minX));
            const oz=Math.max(0,Math.min(a.maxZ,b.maxZ)-Math.max(a.minZ,b.minZ));
            if(ox>0&&oz>0) storeyArea-=ox*oz;
          }
        }
        storeyArea=Math.max(0,storeyArea);
      }
      totalGFA+=storeyArea;
      perStorey.push({storey:s,area:storeyArea,volumes:active.map(v=>v.name)});
    }

    // ── Step 2: Commercial GFA = ONLY the first volume (Building A) footprint ──
    // Other volumes may have commGF checked solely to get the taller GF ceiling height,
    // but they do NOT contribute additional commercial area — Building A is the main GF.
    let commGFA=0;
    if(volFPs.length>0 && volFPs[0].commGF){
      commGFA=volFPs[0].fpArea;
    }

    const overlap=naiveSum-totalGFA;
    const resGFA=Math.max(0,totalGFA-commGFA);
    return {totalGFA, commGFA, resGFA, overlap, perStorey};
  }

  // ── Rectangular mode (original coordinate compression) ──
  const resolved=P.vols.map((vol,vi)=>{
    const x1ft=(lotMaxX||0)-(vol.offEast||0);
    const x0ft=x1ft-vol.width;
    return {
      x0:x0ft, x1:x1ft,
      z0:vol.startEg, z1:vol.startEg+vol.depth,
      storeys:vol.storeys, startEg:vol.startEg, commGF:vol.commGF?true:false,
      fpArea:(x1ft-x0ft)*(vol.depth), name:vol.name||('Vol'+vi)
    };
  }).filter(r=>r.x1>r.x0 && r.z1>r.z0 && r.storeys>0);

  // Find max storey across all volumes
  const maxStorey=resolved.reduce((m,r)=>Math.max(m,r.storeys),0);
  if(maxStorey===0) return {totalGFA:0,commGFA:0,resGFA:0,overlap:0,perStorey:[]};

  // For each storey, compute the UNION area of all volumes present at that storey
  let totalGFA=0, commGFA=0, overlap=0;
  const perStorey=[];

  // Also compute naive sum for overlap detection
  let naiveSum=0;
  resolved.forEach(r=>{naiveSum+=r.fpArea*r.storeys});

  for(let s=1;s<=maxStorey;s++){
    // Collect all volume rectangles active at this storey
    const rects=resolved.filter(r=>s<=r.storeys);
    if(rects.length===0)continue;

    // Compute union area using coordinate compression (exact, no grid needed)
    // Collect all unique X breakpoints
    const xs=new Set();
    rects.forEach(r=>{xs.add(r.x0);xs.add(r.x1)});
    const sortedX=[...xs].sort((a,b)=>a-b);

    let storeyArea=0;
    for(let i=0;i<sortedX.length-1;i++){
      const sx0=sortedX[i], sx1=sortedX[i+1];
      const sliceW=sx1-sx0;
      if(sliceW<=0)continue;

      // For this X slice, collect all Z intervals from active rects
      const zIntervals=[];
      rects.forEach(r=>{
        if(r.x0<sx1 && r.x1>sx0){
          zIntervals.push([r.z0, r.z1]);
        }
      });

      // Merge Z intervals
      zIntervals.sort((a,b)=>a[0]-b[0]);
      let mergedLen=0, curStart=-Infinity, curEnd=-Infinity;
      zIntervals.forEach(([a,b])=>{
        if(a>curEnd){
          if(curEnd>curStart) mergedLen+=curEnd-curStart;
          curStart=a;curEnd=b;
        } else {
          curEnd=Math.max(curEnd,b);
        }
      });
      if(curEnd>curStart) mergedLen+=curEnd-curStart;

      storeyArea+=sliceW*mergedLen;
    }

    totalGFA+=storeyArea;
    perStorey.push({storey:s,area:storeyArea,volumes:rects.map(r=>r.name)});

    // Storey 1 — commercial area = ONLY the first volume (Building A) footprint
    // Other volumes with commGF checked only get the taller GF height, not additional commercial area
    if(s===1){
      if(resolved.length>0 && resolved[0].commGF){
        commGFA=resolved[0].fpArea;
      }
    }
  }

  overlap=naiveSum-totalGFA;
  const resGFA=totalGFA-commGFA;
  return {totalGFA, commGFA, resGFA, overlap, perStorey};
}

function updateStats(){
  const grid=document.getElementById('stats-grid');
  const area=lotArea();
  const gfa=computeGFA();
  const fsi=gfa.totalGFA/area;
  const pfd=pfData();
  const fmt0=n=>n.toLocaleString(undefined,{maximumFractionDigits:0});

  const overlapWarn=gfa.overlap>1 ? `<div class="stat-item" style="grid-column:span 2;color:#ff6644;font-weight:700">
    ⚠ ${fmt0(gfa.overlap)} sf overlap removed from GFA</div>` : '';

  const units=pfd.totalUnits||0;
  grid.innerHTML=`
    <div class="stat-item">Lot Area<br><span class="stat-val">${fmt0(area)} sf</span></div>
    <div class="stat-item">Total GFA<br><span class="stat-val">${fmt0(gfa.totalGFA)} sf</span></div>
    <div class="stat-item">FSI<br><span class="stat-val">${fsi.toFixed(2)}x</span></div>
    <div class="stat-item">Units<br><span class="stat-val">${units}</span></div>
    <div class="stat-item">Res. GFA<br><span class="stat-val">${fmt0(gfa.resGFA)} sf</span></div>
    <div class="stat-item">Comm. GFA<br><span class="stat-val">${fmt0(gfa.commGFA)} sf</span></div>
    <div class="stat-item">Max Height<br><span class="stat-val">${getMaxHeight().toFixed(0)} ft</span></div>
    <div class="stat-item">Rear (derived)<br><span class="stat-val">${derivedRearFrontage().toFixed(0)} ft</span></div>
    ${overlapWarn}
  `;
}

function getMaxHeight(){
  let max=0;
  P.vols.forEach(v=>{
    const h=(v.commGF?P.flr.gf:P.flr.typ)+(v.storeys-1)*P.flr.typ;
    if(h>max)max=h;
  });
  return max;
}

function derivedRearFrontage(){
  const vts=lotVerts();
  if(vts.length<6){
    // For polygon lots without the L-shape parametric model, find the longest south-facing edge
    let maxLen=0;
    for(let i=0;i<vts.length;i++){
      const j=(i+1)%vts.length;
      const len=Math.sqrt(Math.pow(vts[j][0]-vts[i][0],2)+Math.pow(vts[j][1]-vts[i][1],2));
      if(len>maxLen) maxLen=len;
    }
    return maxLen;
  }
  return Math.sqrt(Math.pow(vts[4][0]-vts[5][0],2)+Math.pow(vts[4][1]-vts[5][1],2));
}

function updateInfoBar(){
  document.getElementById('info-bar').textContent=
    `LOT — ${P.lot.front}' × ${P.lot.rear}' — ${lotArea().toLocaleString(undefined,{maximumFractionDigits:0})} SF`;
}

