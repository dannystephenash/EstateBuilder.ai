// section3d.js — 3D building section view (separate Three.js scene)
// ═══════════════════════════════════════════════════════════
let sec3d={scene:null,camera:null,renderer:null,controls:null,group:null,running:false};

function secCenter(){
  // Compute the center of the building for camera targeting
  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMaxX=Math.max(...allX), lotMinX=Math.min(...allX);
  const maxZ=lotBounds().maxZ;
  let cx=0,cz=0,maxH=0,n=0;
  // Auto-stack-aware so the camera frames towers sitting on podiums correctly,
  // even when baseElevFt isn't explicitly set on the tower volume.
  const _gfH_ft = (P.flr && P.flr.gf) || 15;
  const _typH_ft = (P.flr && P.flr.typ) || 10;
  function _polyAreaForCamera(vol){
    if(vol.customAreaSF) return vol.customAreaSF;
    if(vol.customPolyLocal && vol.customPolyLocal.length >= 3){
      const r = vol.customPolyLocal; let a = 0;
      for(let i = 0; i < r.length - 1; i++) a += r[i][0]*r[i+1][1] - r[i+1][0]*r[i][1];
      return Math.abs(a/2);
    }
    return (vol.width||0) * (vol.depth||0);
  }
  // Approximate auto-stack: if a smaller-storey, larger-area volume exists, this
  // volume is probably a tower stacked on it (matches buildSection3DModel logic).
  function _autoBaseFt(vol){
    if(vol.baseElevFt && vol.baseElevFt > 0.5) return vol.baseElevFt;
    const myArea = _polyAreaForCamera(vol);
    let podiumStoreys = 0;
    P.vols.forEach(other => {
      if(other === vol) return;
      if((other.storeys || 0) >= (vol.storeys || 0)) return;
      if(_polyAreaForCamera(other) <= myArea) return;
      if(other.storeys > podiumStoreys) podiumStoreys = other.storeys;
    });
    return podiumStoreys > 0 ? _gfH_ft + (podiumStoreys - 1) * _typH_ft : 0;
  }
  P.vols.forEach(vol=>{
    const oE=f2m(vol.offEast);
    const w=f2m(vol.width);
    const x1=f2m(lotMaxX)-oE, x0=x1-w;
    const z0=f2m(vol.startEg), z1=z0+f2m(vol.depth);
    cx+=(x0+x1)/2; cz+=(z0+z1)/2; n++;
    const gfH = vol.commGF ? f2m(P.flr.gf) : f2m(P.flr.typ);
    const yOffset = f2m(_autoBaseFt(vol));
    const h = yOffset + gfH + (vol.storeys - 1) * f2m(P.flr.typ);
    if(h>maxH) maxH=h;
  });
  if(n>0){cx/=n;cz/=n;}
  return {x:cx, y:maxH/2, z:cz, maxH};
}

function buildCoreControls(){
  const el=document.getElementById('core-controls');
  if(!el)return;
  const C=P.core;
  const maxX=Math.round(lotBounds().maxX+50);
  const maxZ=Math.round(lotBounds().maxZ+50);
  const minX=-50, minZ=-50;
  const btnStyle='padding:2px 8px;border-radius:3px;cursor:pointer;font-size:13px;font-weight:600';

  function sliderRow(label,getX,getZ,setX,setZ,getA,setA,color){
    const d=document.createElement('div');
    d.style.cssText='display:grid;grid-template-columns:90px 1fr 50px 1fr 50px;gap:4px;align-items:center;margin-bottom:4px;font-size:11px';
    d.innerHTML=`<span style="color:${color};font-weight:600">${label}</span>`;
    // X slider
    const sx=document.createElement('input');sx.type='range';sx.min=minX;sx.max=maxX;sx.step=1;sx.value=getX();
    sx.style.cssText='width:100%;accent-color:'+color;
    const vx=document.createElement('input');vx.type='number';vx.min=minX;vx.max=maxX;vx.step=1;vx.value=getX();
    vx.style.cssText='width:46px;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;font-size:11px;text-align:right;padding:2px;border-radius:3px';
    sx.oninput=()=>{setX(+sx.value);vx.value=sx.value;buildSection3DModel();updateSection3DStats();autoSave()};
    vx.onchange=()=>{let v=Math.max(minX,Math.min(maxX,+vx.value||0));setX(v);sx.value=v;vx.value=v;buildSection3DModel();updateSection3DStats();autoSave()};
    // Z slider
    const sz=document.createElement('input');sz.type='range';sz.min=minZ;sz.max=maxZ;sz.step=1;sz.value=getZ();
    sz.style.cssText='width:100%;accent-color:'+color;
    const vz=document.createElement('input');vz.type='number';vz.min=minZ;vz.max=maxZ;vz.step=1;vz.value=getZ();
    vz.style.cssText='width:46px;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;font-size:11px;text-align:right;padding:2px;border-radius:3px';
    sz.oninput=()=>{setZ(+sz.value);vz.value=sz.value;buildSection3DModel();updateSection3DStats();autoSave()};
    vz.onchange=()=>{let v=Math.max(minZ,Math.min(maxZ,+vz.value||0));setZ(v);sz.value=v;vz.value=v;buildSection3DModel();updateSection3DStats();autoSave()};
    d.appendChild(sx);d.appendChild(vx);d.appendChild(sz);d.appendChild(vz);
    el.appendChild(d);

    // Angle row
    if(getA){
      const ar=document.createElement('div');
      ar.style.cssText='display:grid;grid-template-columns:90px 1fr 50px;gap:4px;align-items:center;margin-bottom:8px;font-size:13px';
      ar.innerHTML=`<span style="color:#888;font-size:13px;padding-left:2px">↻ Angle</span>`;
      const sa=document.createElement('input');sa.type='range';sa.min=0;sa.max=359;sa.step=1;sa.value=getA();
      sa.style.cssText='width:100%;accent-color:'+color;
      const va=document.createElement('input');va.type='number';va.min=0;va.max=359;va.step=1;va.value=getA();
      va.style.cssText='width:46px;background:#1A1A1A;border:1px solid #444444;color:#AEBC46;font-size:11px;text-align:right;padding:2px;border-radius:3px';
      sa.oninput=()=>{setA(+sa.value);va.value=sa.value;buildSection3DModel();updateSection3DStats();autoSave()};
      va.onchange=()=>{let v=((+va.value||0)%360+360)%360;setA(v);sa.value=v;va.value=v;buildSection3DModel();updateSection3DStats();autoSave()};
      ar.appendChild(sa);ar.appendChild(va);
      el.appendChild(ar);
    }
  }

  // Header
  el.innerHTML='<div style="display:grid;grid-template-columns:90px 1fr 50px 1fr 50px;gap:4px;font-size:12px;color:#777;margin-bottom:4px"><span></span><span style="text-align:center">← X (East-West) →</span><span>ft</span><span style="text-align:center">← Z (Egl→Lnk) →</span><span>ft</span></div>';

  // ── ELEVATORS (clean header + add/remove, matches stairs pattern) ──
  const elevHeader=document.createElement('div');
  elevHeader.style.cssText='display:flex;justify-content:space-between;align-items:center;margin:6px 0 6px 0';
  elevHeader.innerHTML=`<span style="color:#c49ade;font-weight:700;font-size:11px;letter-spacing:0.5px">ELEVATORS (${C.numElevators||0})</span>`;
  const elevBtnRow=document.createElement('div');
  elevBtnRow.style.cssText='display:flex;gap:4px;align-items:center';
  if(C.numElevators>0){
    const removeElevBtn=document.createElement('button');
    removeElevBtn.textContent='− Remove';
    removeElevBtn.style.cssText=`${btnStyle};border:1px solid #663366;background:#33113388;color:#cc88dd`;
    removeElevBtn.onclick=()=>{C.numElevators=Math.max(0,C.numElevators-1);C._coreUserSet=true;buildCoreControls();buildSection3DModel();updateSection3DStats();autoSave()};
    elevBtnRow.appendChild(removeElevBtn);
  }
  if(C.numElevators<3){
    const addElevBtn=document.createElement('button');
    addElevBtn.textContent='+ Add Elevator';
    addElevBtn.style.cssText=`${btnStyle};border:1px solid #c49ade;background:#c49ade22;color:#c49ade`;
    addElevBtn.onclick=()=>{C.numElevators=Math.min(3,(C.numElevators||0)+1);C._coreUserSet=true;buildCoreControls();buildSection3DModel();updateSection3DStats();autoSave()};
    elevBtnRow.appendChild(addElevBtn);
  }
  elevHeader.appendChild(elevBtnRow);
  el.appendChild(elevHeader);

  // Only show position/direction controls when elevators exist
  if(C.numElevators>0){
    // Direction toggle row
    const dirRow=document.createElement('div');
    dirRow.style.cssText='display:flex;gap:6px;margin:0 0 4px 90px;font-size:13px';
    const dirLabel=document.createElement('span');
    dirLabel.style.cssText='color:#888;font-size:13px;line-height:22px';
    dirLabel.textContent='Direction:';
    dirRow.appendChild(dirLabel);
    ['ew','ns'].forEach(d=>{
      const btn=document.createElement('button');
      btn.textContent=d==='ew'?'Row E↔W':'Row N↔S';
      btn.style.cssText=`${btnStyle};border:1px solid ${C.elevDir===d?'#AEBC46':'#444444'};background:${C.elevDir===d?'#AEBC4622':'transparent'};color:${C.elevDir===d?'#AEBC46':'#889'}`;
      btn.onclick=()=>{C.elevDir=d;buildCoreControls();buildSection3DModel();autoSave()};
      dirRow.appendChild(btn);
    });
    el.appendChild(dirRow);

    // Position sliders
    sliderRow('Elevators',
      ()=>C.elevX, ()=>C.elevZ,
      v=>{C.elevX=v}, v=>{C.elevZ=v},
      ()=>C.elevAngle||0, v=>{C.elevAngle=v},
      '#c49ade');
  }

  // ── STAIRWELLS ──
  const stairHeader=document.createElement('div');
  stairHeader.style.cssText='display:flex;justify-content:space-between;align-items:center;margin:6px 0 6px 0';
  stairHeader.innerHTML=`<span style="color:#b06050;font-weight:700;font-size:11px;letter-spacing:0.5px">STAIRWELLS (${C.stairs.length})</span>`;
  const addStairBtn=document.createElement('button');
  addStairBtn.textContent='+ Add Stair';
  addStairBtn.style.cssText=`${btnStyle};border:1px solid #b06050;background:#b0605022;color:#b06050`;
  addStairBtn.onclick=()=>{
    C._coreUserSet=true;
    C.stairs.push({x:Math.round(maxX/2), z:Math.round(maxZ/2), angle:0, label:''});
    buildCoreControls();buildSection3DModel();updateSection3DStats();autoSave();
  };
  stairHeader.appendChild(addStairBtn);
  el.appendChild(stairHeader);

  C.stairs.forEach((stair,si)=>{
    // Stair label + delete button row
    const labelRow=document.createElement('div');
    labelRow.style.cssText='display:flex;align-items:center;gap:6px;margin-bottom:2px';
    const nameSpan=document.createElement('span');
    nameSpan.style.cssText='color:#b06050;font-weight:600;font-size:11px;width:90px';
    nameSpan.textContent=`Stair ${si+1}${stair.label?' ('+stair.label+')':''}`;
    labelRow.appendChild(nameSpan);
    if(C.stairs.length>1){
      const delBtn=document.createElement('button');
      delBtn.textContent='✕';
      delBtn.title='Remove this stairwell';
      delBtn.style.cssText='padding:1px 6px;border-radius:3px;border:1px solid #663333;background:#33111188;color:#ff6644;cursor:pointer;font-size:13px;font-weight:700;margin-left:auto';
      delBtn.onclick=()=>{
        C.stairs.splice(si,1);
        buildCoreControls();buildSection3DModel();updateSection3DStats();autoSave();
      };
      labelRow.appendChild(delBtn);
    }
    el.appendChild(labelRow);

    sliderRow(`Stair ${si+1}`,
      ()=>stair.x, ()=>stair.z,
      v=>{stair.x=v}, v=>{stair.z=v},
      ()=>stair.angle||0, v=>{stair.angle=v},
      '#b06050');
  });
}

/** Initializes the Section tab's separate Three.js scene, camera, renderer, and orbit controls. */
function initSection3D(){
  const wrap=document.getElementById('section3d-wrap');
  const cv=document.getElementById('section3d-canvas');
  if(!wrap||!cv)return;

  if(!sec3d.scene){
    // First-time setup
    sec3d.scene=new THREE.Scene();
    sec3d.scene.background=new THREE.Color('#1A1A1A');

    sec3d.camera=new THREE.PerspectiveCamera(45,wrap.clientWidth/wrap.clientHeight,0.1,1000);

    sec3d.renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,preserveDrawingBuffer:true});
    sec3d.renderer.shadowMap.enabled=true;

    // Compute initial center
    const c=secCenter();
    sec3d._orbit={isDragging:false,isRight:false,prev:{x:0,y:0},theta:-0.7,phi:0.8,dist:Math.max(40,c.maxH*2.5),target:new THREE.Vector3(c.x,c.y,c.z)};
    const orb=sec3d._orbit;

    // ── Drag & Rotate state for stairs/elevators ──
    const sec3dRay=new THREE.Raycaster();
    const sec3dMouse=new THREE.Vector2();
    const sec3dDrag={
      active:false, mode:null, coreType:null, coreIdx:-1,
      startWorld:{x:0,z:0}, startValues:{},
      groundPlane:new THREE.Plane(new THREE.Vector3(0,1,0),0),
      rebuildTimer:null,
      selected:null // {type, idx} of currently selected element for arrow-key rotation
    };

    function getCoreFromMesh(obj){
      let cur=obj;
      while(cur){if(cur._coreType)return{type:cur._coreType,idx:cur._coreIdx};cur=cur.parent;}
      return null;
    }
    function coreKeys(type,idx){
      if(type==='elev')return{x:'elevX',z:'elevZ',angle:'elevAngle'};
      // Stairs use array: P.core.stairs[idx].x/.z/.angle
      return{stairIdx:idx};
    }
    function getStairVal(idx,key){ return P.core.stairs[idx]?P.core.stairs[idx][key]||0:0; }
    function setStairVal(idx,key,v){ if(P.core.stairs[idx]) P.core.stairs[idx][key]=v; }
    function sec3dHitTest(e){
      const rect=cv.getBoundingClientRect();
      sec3dMouse.x=((e.clientX-rect.left)/rect.width)*2-1;
      sec3dMouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
      sec3dRay.setFromCamera(sec3dMouse,sec3d.camera);
      if(!sec3d.group)return null;
      const hits=sec3dRay.intersectObjects(sec3d.group.children,true);
      for(let i=0;i<hits.length;i++){
        const c=getCoreFromMesh(hits[i].object);
        if(c)return{core:c,point:hits[i].point};
      }
      return null;
    }
    function sec3dGroundHit(e){
      const rect=cv.getBoundingClientRect();
      sec3dMouse.x=((e.clientX-rect.left)/rect.width)*2-1;
      sec3dMouse.y=-((e.clientY-rect.top)/rect.height)*2+1;
      sec3dRay.setFromCamera(sec3dMouse,sec3d.camera);
      const pt=new THREE.Vector3();
      if(sec3dRay.ray.intersectPlane(sec3dDrag.groundPlane,pt))return pt;
      return null;
    }
    function sec3dThrottledRebuild(){
      if(!sec3dDrag.rebuildTimer){
        sec3dDrag.rebuildTimer=setTimeout(()=>{
          sec3dDrag.rebuildTimer=null;
          buildSection3DModel();updateSection3DStats();
        },50);
      }
    }

    // ── Selection indicator overlay ──
    const selIndicator=document.createElement('div');
    selIndicator.style.cssText='display:none;position:absolute;top:8px;left:50%;transform:translateX(-50%);background:rgba(174,188,70,0.9);color:#111;font-size:11px;font-weight:700;padding:6px 16px;border-radius:4px;z-index:10;letter-spacing:1px;pointer-events:none';
    wrap.appendChild(selIndicator);
    // Unified getters/setters for core elements (elevator or stair)
    function getCoreVal(type,idx,key){
      if(type==='elev') return P.core['elev'+key.charAt(0).toUpperCase()+key.slice(1)]||0;
      return P.core.stairs[idx]?P.core.stairs[idx][key]||0:0;
    }
    function setCoreVal(type,idx,key,v){
      if(type==='elev') P.core['elev'+key.charAt(0).toUpperCase()+key.slice(1)]=v;
      else if(P.core.stairs[idx]) P.core.stairs[idx][key]=v;
    }
    // Map short keys: x→elevX, z→elevZ, angle→elevAngle for elevators
    function getCoreX(type,idx){ return type==='elev'?P.core.elevX:getStairVal(idx,'x'); }
    function getCoreZ(type,idx){ return type==='elev'?P.core.elevZ:getStairVal(idx,'z'); }
    function getCoreAngle(type,idx){ return type==='elev'?(P.core.elevAngle||0):getStairVal(idx,'angle'); }
    function setCoreX(type,idx,v){ if(type==='elev')P.core.elevX=v;else setStairVal(idx,'x',v); }
    function setCoreZ(type,idx,v){ if(type==='elev')P.core.elevZ=v;else setStairVal(idx,'z',v); }
    function setCoreAngle(type,idx,v){ if(type==='elev')P.core.elevAngle=v;else setStairVal(idx,'angle',v); }

    function updateSelIndicator(){
      const s=sec3dDrag.selected;
      if(!s){selIndicator.style.display='none';return;}
      const angle=getCoreAngle(s.type,s.idx);
      const label=s.type==='elev'?'ELEVATORS':`STAIR ${s.idx+1}`;
      selIndicator.textContent=`${label} SELECTED — ← → Arrow Keys to Rotate (${angle}°) · Esc to Deselect`;
      selIndicator.style.display='block';
    }

    // ── Pointer events (drag intercepts orbit, click selects for arrow-key rotation) ──
    let pointerDownPos={x:0,y:0};
    let pointerWasDrag=false;

    cv.addEventListener('pointerdown',e=>{
      pointerDownPos={x:e.clientX,y:e.clientY};
      pointerWasDrag=false;
      // Left-click: check for stair/elevator hit to start drag
      if(e.button===0){
        const hit=sec3dHitTest(e);
        if(hit){
          sec3dDrag.active=true;sec3dDrag.mode='move';
          sec3dDrag.coreType=hit.core.type;sec3dDrag.coreIdx=hit.core.idx;
          sec3dDrag.startValues={x:getCoreX(hit.core.type,hit.core.idx),z:getCoreZ(hit.core.type,hit.core.idx),angle:getCoreAngle(hit.core.type,hit.core.idx)};
          // Set drag plane at ground level (y=0) for consistent dragging
          // Using ground level prevents drift when camera angle changes
          sec3dDrag.groundPlane.constant=0;
          const gp=sec3dGroundHit(e);
          if(gp){sec3dDrag.startWorld={x:gp.x,z:gp.z};}
          cv.setPointerCapture(e.pointerId);
          cv.style.cursor='grabbing';
          e.preventDefault();e.stopPropagation();return;
        }
      }
      // No hit → orbit
      orb.isDragging=true;
      orb.isRight=(e.button===2)||(e.pointerType==='touch'&&e.isPrimary===false);
      orb.prev={x:e.clientX,y:e.clientY};
      cv.setPointerCapture(e.pointerId);
      cv.style.cursor='grabbing';
    });

    cv.addEventListener('pointermove',e=>{
      // Track if pointer moved significantly (distinguish click from drag)
      const movedDist=Math.hypot(e.clientX-pointerDownPos.x,e.clientY-pointerDownPos.y);
      if(movedDist>5) pointerWasDrag=true;
      // ── Active move drag ──
      if(sec3dDrag.active && sec3dDrag.mode==='move'){
        const gp=sec3dGroundHit(e);
        if(gp){
          const dx=gp.x-sec3dDrag.startWorld.x;
          const dz=gp.z-sec3dDrag.startWorld.z;
          setCoreX(sec3dDrag.coreType,sec3dDrag.coreIdx,Math.round(sec3dDrag.startValues.x+dx/FT));
          setCoreZ(sec3dDrag.coreType,sec3dDrag.coreIdx,Math.round(sec3dDrag.startValues.z+dz/FT));
          sec3dThrottledRebuild();
        }
        return;
      }
      // ── Hover detection (no drag active) ──
      if(!orb.isDragging && !sec3dDrag.active){
        const hit=sec3dHitTest(e);
        cv.style.cursor=hit?'move':'grab';
        return;
      }
      // ── Orbit ──
      if(!orb.isDragging)return;
      const dx=e.clientX-orb.prev.x, dy=e.clientY-orb.prev.y;
      orb.prev={x:e.clientX,y:e.clientY};
      if(orb.isRight){
        const right=new THREE.Vector3();
        right.setFromMatrixColumn(sec3d.camera.matrix,0).multiplyScalar(-dx*0.05);
        const up=new THREE.Vector3(0,dy*0.05,0);
        orb.target.add(right).add(up);
      } else {
        orb.theta-=dx*0.006;
        orb.phi=Math.max(0.05,Math.min(Math.PI-0.05,orb.phi-dy*0.006));
      }
    });

    cv.addEventListener('pointerup',e=>{
      if(sec3dDrag.active && sec3dDrag.mode==='move'){
        const wasClick=!pointerWasDrag;
        sec3dDrag.active=false;sec3dDrag.mode=null;
        sec3dDrag.groundPlane.constant=0; // Reset drag plane
        cv.releasePointerCapture(e.pointerId);
        // If it was a click (not a drag), select the element for arrow-key rotation
        if(wasClick){
          sec3dDrag.selected={type:sec3dDrag.coreType,idx:sec3dDrag.coreIdx};
          updateSelIndicator();
          cv.style.cursor='move';
          cv.focus();
        } else {
          cv.style.cursor='grab';
        }
        buildCoreControls();buildSection3DModel();updateSection3DStats();autoSave();
        return;
      }
      // If clicking empty space, deselect
      if(!pointerWasDrag && sec3dDrag.selected){
        sec3dDrag.selected=null;
        updateSelIndicator();
      }
      orb.isDragging=false;
      cv.releasePointerCapture(e.pointerId);
      cv.style.cursor='grab';
    });
    cv.addEventListener('pointercancel',()=>{
      sec3dDrag.active=false;sec3dDrag.mode=null;
      sec3dDrag.groundPlane.constant=0;
      orb.isDragging=false;cv.style.cursor='grab';
    });
    cv.addEventListener('contextmenu',e=>e.preventDefault());

    // ── Arrow key rotation for selected element ──
    cv.setAttribute('tabindex','0');
    cv.style.outline='none';
    cv.addEventListener('keydown',e=>{
      if(!sec3dDrag.selected)return;
      const st=sec3dDrag.selected.type, si=sec3dDrag.selected.idx;
      // Check stair index still valid
      if(st==='stair' && si>=P.core.stairs.length){sec3dDrag.selected=null;updateSelIndicator();return;}
      let angle=getCoreAngle(st,si);
      const step=1; // 1° per press for precise control
      if(e.key==='ArrowLeft'||e.key==='ArrowDown'){
        angle=((angle-step)%360+360)%360;
        e.preventDefault();
      } else if(e.key==='ArrowRight'||e.key==='ArrowUp'){
        angle=(angle+step)%360;
        e.preventDefault();
      } else if(e.key==='Escape'){
        sec3dDrag.selected=null;
        updateSelIndicator();
        e.preventDefault();return;
      } else return;
      setCoreAngle(st,si,angle);
      buildSection3DModel();updateSection3DStats();buildCoreControls();autoSave();
      updateSelIndicator();
    });

    cv.addEventListener('wheel',e=>{e.preventDefault();orb.dist=Math.max(5,Math.min(200,orb.dist+e.deltaY*0.06))},{passive:false});
    // Touch: two-finger pan
    let lastTouchDist=0;
    cv.addEventListener('touchstart',e=>{if(e.touches.length===2){e.preventDefault();const t=e.touches;lastTouchDist=Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}},{passive:false});
    cv.addEventListener('touchmove',e=>{if(e.touches.length===2){e.preventDefault();const t=e.touches;const d=Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);orb.dist=Math.max(5,Math.min(200,orb.dist-(d-lastTouchDist)*0.15));lastTouchDist=d;}},{passive:false});

    // Lights
    const amb=new THREE.AmbientLight('#b0b8c8',0.5);
    sec3d.scene.add(amb);
    const dir=new THREE.DirectionalLight('#ffffff',0.8);
    dir.position.set(20,30,-15);dir.castShadow=true;
    sec3d.scene.add(dir);
    const fill=new THREE.DirectionalLight('#8899bb',0.3);
    fill.position.set(-15,10,20);
    sec3d.scene.add(fill);

    // Ground
    const gnd=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#1a1a2a',roughness:0.9}));
    gnd.rotation.x=-Math.PI/2;gnd.position.y=-0.05;gnd.receiveShadow=true;
    sec3d.scene.add(gnd);

    // Grid
    const grid=new THREE.GridHelper(100,50,'#333333','#2D2D2D');
    sec3d.scene.add(grid);

    sec3d.group=new THREE.Group();
    sec3d.scene.add(sec3d.group);
  }

  // Resize canvas to match container exactly
  const ww=wrap.clientWidth, wh=wrap.clientHeight;
  cv.style.width=ww+'px';
  cv.style.height=wh+'px';
  sec3d.renderer.setSize(ww,wh);
  sec3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  sec3d.camera.aspect=ww/wh;
  sec3d.camera.updateProjectionMatrix();

  // Re-center camera on current building
  const c=secCenter();
  sec3d._orbit.target.set(c.x,c.y,c.z);

  buildCoreControls();
  buildSection3DModel();
  updateSection3DStats();

  if(!sec3d.running){
    sec3d.running=true;
    (function animSec(){
      requestAnimationFrame(animSec);
      // Skip rendering when this canvas isn't visible (other tab active) or browser tab hidden.
      // Saves significant GPU time, especially since this loop renders even on the AI/Pro-Forma tabs.
      if(typeof document !== 'undefined' && document.hidden) return;
      var sw = (typeof document !== 'undefined') ? document.getElementById('section3d-wrap') : null;
      if(sw && sw.offsetParent === null) return; // not visible (display:none anywhere up the tree)
      const o=sec3d._orbit;
      sec3d.camera.position.set(
        o.target.x+o.dist*Math.sin(o.phi)*Math.sin(o.theta),
        o.target.y+o.dist*Math.cos(o.phi),
        o.target.z+o.dist*Math.sin(o.phi)*Math.cos(o.theta)
      );
      sec3d.camera.lookAt(o.target);
      sec3d.renderer.render(sec3d.scene,sec3d.camera);
    })();
    // ResizeObserver to handle sidebar expand/collapse and window resize
    if(!sec3d._resizeObserver){
      sec3d._resizeObserver=new ResizeObserver(()=>{
        const nw=wrap.clientWidth, nh=wrap.clientHeight;
        if(nw>0 && nh>0 && sec3d.renderer){
          cv.style.width=nw+'px';cv.style.height=nh+'px';
          sec3d.renderer.setSize(nw,nh);
          sec3d.camera.aspect=nw/nh;
          sec3d.camera.updateProjectionMatrix();
        }
      });
      sec3d._resizeObserver.observe(wrap);
    }
  }
}

/** Rebuilds the 3D section model — floor plates, elevator shafts, stairwells, color-coded by use. */
function buildSection3DModel(){
  if(!sec3d.group)return;
  // Dispose all children efficiently (avoids O(n²) of .remove one-by-one)
  disposeObject(sec3d.group);
  sec3d.group.clear();
  sec3d._floorLabels={}; // Reset unified labels for this rebuild

  const vts=lotVerts();
  const allX=vts.map(v=>v[0]);
  const lotMaxX=Math.max(...allX), lotMinX=Math.min(...allX);
  const maxZ=lotBounds().maxZ;

  // Colors
  const COL_COMM='#e8c87a';
  const COL_AMEN='#4ecdc4';
  const COL_RESI='#88aabb';
  const COL_MECH='#9b6db7';
  const COL_HALL='#556677';
  const COL_ELEV='#c49ade';
  const COL_STAIR='#b06050';

  // Helper: create a floor slab
  function makeSlab(x,z,w,d,y,h,color,opacity){
    const geo=new THREE.BoxGeometry(w,h,d);
    const mat=new THREE.MeshStandardMaterial({color,roughness:0.5,transparent:true,opacity,depthWrite:opacity>0.7,side:THREE.DoubleSide});
    const m=new THREE.Mesh(geo,mat);
    m.position.set(x+w/2, y+h/2, z+d/2);
    m.castShadow=opacity>0.7;m.receiveShadow=true;
    m.renderOrder=opacity>0.7?0:1; // transparent floors render after opaque cores
    return m;
  }

  // Helper: edge outline for a box
  function makeEdge(x,z,w,d,y,h,color){
    const geo=new THREE.BoxGeometry(w,h,d);
    const edges=new THREE.EdgesGeometry(geo);
    const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity:0.5});
    const line=new THREE.LineSegments(edges,mat);
    line.position.set(x+w/2,y+h/2,z+d/2);
    return line;
  }

  const gfH_m=f2m(P.flr.gf);
  const typH_m=f2m(P.flr.typ);

  // Elevator and stair dimensions (metres)
  const elevW=2.5, elevD=2.5;
  const stairW=3.5, stairD=5.0;
  const hallW=2.0; // corridor width

  // Helper: make a freeform floor slab from customPolyLocal
  function makeCustomSlab(pts,y,h,color,opacity){
    const shape=new THREE.Shape();
    shape.moveTo(f2m(pts[0][0]),-f2m(pts[0][1]));
    for(let i=1;i<pts.length-1;i++) shape.lineTo(f2m(pts[i][0]),-f2m(pts[i][1]));
    shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});
    geo.rotateX(-Math.PI/2);
    const mat=new THREE.MeshStandardMaterial({color,roughness:0.5,transparent:true,opacity,depthWrite:opacity>0.7,side:THREE.DoubleSide});
    const m=new THREE.Mesh(geo,mat);
    m.position.y=y;
    m.castShadow=opacity>0.7;m.receiveShadow=true;
    m.renderOrder=opacity>0.7?0:1;
    return m;
  }
  function makeCustomEdge(pts,y,h,color){
    const shape=new THREE.Shape();
    shape.moveTo(f2m(pts[0][0]),-f2m(pts[0][1]));
    for(let i=1;i<pts.length-1;i++) shape.lineTo(f2m(pts[i][0]),-f2m(pts[i][1]));
    shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false});
    geo.rotateX(-Math.PI/2);
    const edges=new THREE.EdgesGeometry(geo);
    const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity:0.5});
    const line=new THREE.LineSegments(edges,mat);
    line.position.y=y;
    return line;
  }

  // ── BASE-ELEV-AWARE storey range (matches computeGFA / unit-mix) ──
  // Without this, a Tower volume with baseElevFt=45 would be rendered starting
  // at floor 1 — overlapping the Podium and producing a single monolithic
  // block instead of the actual podium-on-bottom + tower-on-top massing.
  const _gfH_ft = (P.flr && P.flr.gf) || 15;
  const _typH_ft = (P.flr && P.flr.typ) || 10;
  function _startStoreyForVol(vol){
    if(!vol.baseElevFt || vol.baseElevFt <= 0.5) return 1;
    return Math.max(1, Math.round((vol.baseElevFt - _gfH_ft) / _typH_ft) + 2);
  }

  // No auto-stack inference. The Section view uses each volume's explicit
  // `baseElevFt` to determine its start storey — same rule as computeGFA and
  // pfData. If the user wants a tower to start above the podium, they set
  // baseElevFt explicitly. Otherwise both volumes start at storey 1 and overlap
  // correctly (the section drawing handles the visual stacking via storey
  // ranges + per-storey footprint width).
  function _startStoreyForVolAuto(vol){
    return _startStoreyForVol(vol);
  }

  P.vols.forEach((vol,vi)=>{
    const hasComm=!!vol.commGF;
    const floorH=hasComm?gfH_m:typH_m;
    const isCustom=vol.customPolyLocal&&vol.customPolyLocal.length>=4;

    // Rectangular fallback bounds
    const oE=f2m(vol.offEast||0);
    const w=f2m(vol.width);
    const x1=f2m(lotMaxX)-oE;
    const cx0=x1-w;
    const z0=f2m(vol.startEg);
    const bw=w, bd=f2m(vol.depth);
    if(!isCustom && (bw<=0||bd<=0))return;

    // Compute centroid for label placement
    let labelX, labelZ;
    if(isCustom){
      const cPts=vol.customPolyLocal.slice(0,-1);
      labelX=f2m(cPts.reduce((s,p)=>s+p[0],0)/cPts.length)-2;
      labelZ=f2m(cPts.reduce((s,p)=>s+p[1],0)/cPts.length);
    } else {
      labelX=cx0-2;
      labelZ=z0+bd/2;
    }

    // ── This volume's vertical offset from ground ──
    // Use AUTO-detected start storey (handles "tower inside podium with more
    // storeys" case even when baseElevFt isn't explicitly set).
    const volStartStorey = _startStoreyForVolAuto(vol);
    // Compute yOffset in metres from the start storey: floor 1 → 0, floor 2 → gfH,
    // floor N → gfH + (N-2)*typH.
    const yOffset_m = volStartStorey <= 1 ? 0 : (gfH_m + (volStartStorey - 2) * typH_m);

    for(let f=0;f<vol.storeys;f++){
      // f = local floor index within this volume (0-based)
      // globalStorey = absolute storey in the project (1-based)
      const globalStorey = volStartStorey + f;
      // GF treatment ONLY applies to volumes that actually start at storey 1
      // (a Tower starting at storey 5 does NOT have a "ground floor")
      const isGF = (volStartStorey === 1) && (f === 0);
      const flH = isGF ? floorH : typH_m;
      // Vertical position: stack from this volume's baseElevFt, then add floor heights
      const yBaseLocal = isGF ? 0 : (volStartStorey === 1 ? floorH + (f-1)*typH_m : f*typH_m);
      const yBase = yOffset_m + yBaseLocal;
      const floorGap=0.08;
      let isAmenityFloor=(f===1 && vol.storeys>3 && volStartStorey === 1);
      let color=COL_RESI;
      if(isGF && hasComm) color=COL_COMM;
      const slabThick=0.2;

      if(isCustom){
        // Freeform polygon floor
        const pts=vol.customPolyLocal;
        if(isGF && hasComm){
          sec3d.group.add(makeCustomSlab(pts,yBase,flH-floorGap,COL_COMM,0.65));
          sec3d.group.add(makeCustomEdge(pts,yBase,flH-floorGap,'#e8c87a'));
        } else if(isAmenityFloor){
          sec3d.group.add(makeCustomSlab(pts,yBase,slabThick,COL_AMEN,0.6));
          sec3d.group.add(makeCustomEdge(pts,yBase,flH-floorGap,'#4ecdc4'));
        } else {
          sec3d.group.add(makeCustomSlab(pts,yBase,slabThick,color,0.5));
          sec3d.group.add(makeCustomEdge(pts,yBase,flH-floorGap,color));
        }
      } else {
        // Rectangular floor
        if(isGF && hasComm){
          sec3d.group.add(makeSlab(cx0,z0,bw,bd,yBase,flH-floorGap,COL_COMM,0.65));
          sec3d.group.add(makeEdge(cx0,z0,bw,bd,yBase,flH-floorGap,'#e8c87a'));
        } else if(isAmenityFloor){
          const halfW=bw/2;
          sec3d.group.add(makeSlab(cx0,z0,halfW,bd,yBase,slabThick,COL_AMEN,0.6));
          sec3d.group.add(makeEdge(cx0,z0,halfW,bd,yBase,flH-floorGap,'#4ecdc4'));
          sec3d.group.add(makeSlab(cx0+halfW,z0,halfW,bd,yBase,slabThick,COL_RESI,0.6));
          sec3d.group.add(makeEdge(cx0+halfW,z0,halfW,bd,yBase,flH-floorGap,'#88aabb'));
        } else {
          sec3d.group.add(makeSlab(cx0,z0,bw,bd,yBase,slabThick,color,0.5));
          sec3d.group.add(makeEdge(cx0,z0,bw,bd,yBase,flH-floorGap,color));
        }
      }

      // Collect floor info for unified labels (rendered once after all volumes).
      // Key by GLOBAL storey so podium floor 4 + tower floor 1 don't collide
      // (tower's local f=0 is global storey 5 if podium is 4 storeys).
      if(!sec3d._floorLabels) sec3d._floorLabels={};
      const flKey = globalStorey;
      const taller = (volStartStorey + vol.storeys - 1);
      if(!sec3d._floorLabels[flKey] || taller >= sec3d._floorLabels[flKey].maxStoreys){
        const flLabel = isGF ? (hasComm?'GF Comm.':'GF')
                       : (isAmenityFloor?'F'+globalStorey+' Amen/Res':'F'+globalStorey);
        sec3d._floorLabels[flKey]={label:flLabel, yBase, flH, color, maxStoreys: taller};
      }
    }
  });

  // ── Unified floor labels — one label per floor, positioned outside the building ──
  if(sec3d._floorLabels){
    // Find the leftmost edge of all volumes for label placement
    let labelEdgeX=Infinity;
    P.vols.forEach(vol=>{
      const isCustom=vol.customPolyLocal&&vol.customPolyLocal.length>=4;
      if(isCustom){
        const cPts=vol.customPolyLocal.slice(0,-1);
        const minPx=Math.min(...cPts.map(p=>p[0]));
        labelEdgeX=Math.min(labelEdgeX,f2m(minPx));
      } else {
        const oE=f2m(vol.offEast||0);
        const w=f2m(vol.width);
        const x1=f2m(lotMaxX)-oE;
        labelEdgeX=Math.min(labelEdgeX,x1-w);
      }
    });
    // Place labels just left of the building
    const lx=labelEdgeX-3;
    // Find midpoint Z of the tallest volume for label Z
    let labelZ=0, bestStoreys=0;
    P.vols.forEach(vol=>{
      if(vol.storeys>bestStoreys){
        bestStoreys=vol.storeys;
        const z0=f2m(vol.startEg);
        const bd=f2m(vol.depth);
        labelZ=z0+bd/2;
      }
    });

    // Sort labels by yBase to detect overlap
    const sortedLabels=Object.values(sec3d._floorLabels).sort((a,b)=>a.yBase-b.yBase);
    const labelH=0.5; // sprite height in world units
    const minGap=0.6; // minimum gap between label centers
    let lastLabelY=-Infinity;
    // Only show every Nth label if floors are too close
    const floorStep=sortedLabels.length>20?3:sortedLabels.length>12?2:1;
    sortedLabels.forEach((fl,fi)=>{
      if(floorStep>1 && fi%floorStep!==0 && fi!==0 && fi!==sortedLabels.length-1) return;
      const labelCanvas=document.createElement('canvas');
      labelCanvas.width=256;labelCanvas.height=32;
      const lctx=labelCanvas.getContext('2d');
      lctx.fillStyle=fl.color;
      lctx.font='bold 14px Outfit,sans-serif';
      lctx.textAlign='right';
      lctx.fillText(fl.label,248,22);
      const tex=new THREE.CanvasTexture(labelCanvas);
      const spriteMat=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false});
      const sprite=new THREE.Sprite(spriteMat);
      const targetY=fl.yBase+fl.flH/2;
      // Offset if too close to previous label
      const actualY=Math.max(targetY,lastLabelY+minGap);
      lastLabelY=actualY;
      sprite.scale.set(5,labelH,1);
      sprite.position.set(lx, actualY, labelZ);
      sprite.renderOrder=999;
      sec3d.group.add(sprite);
    });
    delete sec3d._floorLabels;
  }

  // ── SHARED CORE: laid out to match L-shaped building ──
  // Compute the full bounding box across ALL volumes — and the GLOBAL top
  // storey (accounts for towers stacked on podiums via baseElevFt).
  let allCx0=Infinity,allCx1=-Infinity,allZ0=Infinity,allZ1=-Infinity;
  let maxStoreys=0, tallestHasComm=false;
  P.vols.forEach(vol=>{
    const oE=f2m(vol.offEast);
    const w=f2m(Math.min(vol.width,lotMaxX-lotMinX));
    const x1=f2m(lotMaxX)-oE, x0=x1-w;
    const cx0v=x0, cx1v=x1;
    const z0v=f2m(vol.startEg), z1v=z0v+f2m(vol.depth);
    if(cx0v<allCx0) allCx0=cx0v;
    if(cx1v>allCx1) allCx1=cx1v;
    if(z0v<allZ0) allZ0=z0v;
    if(z1v>allZ1) allZ1=z1v;
    // Global top storey for this volume (start + height - 1) — auto-detected
    const volStart = _startStoreyForVolAuto(vol);
    const volTop = volStart + (vol.storeys||0) - 1;
    if(volTop > maxStoreys){ maxStoreys = volTop; tallestHasComm = (volStart === 1) && !!vol.commGF; }
  });
  const fullW=allCx1-allCx0, fullD=allZ1-allZ0;

  if(fullW>3 && fullD>3 && maxStoreys>0){
    const COL_UNIT='#6a8090';
    const COL_UNIT2='#7a9080';

    // ── Layout positions based on the user's drawing ──
    // The narrow portion (primary frontage) is at low Z (top/north)
    // The wide portion (rear frontage) is at high Z (bottom/south)
    // The L-junction is roughly where the step occurs

    // Lot dimensions for reference
    const lb=lotBounds();
    const frontM=f2m(lb.width);
    const stepZ=f2m(lb.depth*0.5);

    // ── CORE ELEMENTS — user-positionable via P.core ──
    const C=P.core;
    const elevSpc=elevW+0.5;
    const isEW=(C.elevDir==='ew');

    // Stair positions from P.core.stairs array (feet → metres)
    const stairs=C.stairs.map(s=>({x:f2m(s.x), z:f2m(s.z), angle:(s.angle||0)}));
    const elevAngleRad=(C.elevAngle||0)*Math.PI/180;
    const numElev=C.numElevators||0;

    // Helper: create a rotated slab+edge group centered on (cx, cz) at angle
    function makeRotatedPair(cx,cz,w,d,yBase,h,slabColor,slabOpacity,edgeColor,angleRad){
      const grp=new THREE.Group();
      // Slab centered at origin
      const geo=new THREE.BoxGeometry(w,h,d);
      const mat=new THREE.MeshStandardMaterial({color:slabColor,roughness:0.5,transparent:true,opacity:slabOpacity,depthWrite:slabOpacity>0.7});
      const mesh=new THREE.Mesh(geo,mat);
      mesh.castShadow=slabOpacity>0.7;mesh.receiveShadow=true;
      mesh.renderOrder=slabOpacity>0.7?0:1;
      grp.add(mesh);
      // Edge
      const edgeGeo=new THREE.EdgesGeometry(geo);
      const edgeMat=new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:0.5});
      grp.add(new THREE.LineSegments(edgeGeo,edgeMat));
      // Position: center of the slab
      grp.position.set(cx+w/2, yBase+h/2, cz+d/2);
      grp.rotation.y=-angleRad;
      return grp;
    }

    for(let f=0;f<maxStoreys;f++){
      const isGF=(f===0);
      const flH=isGF?(tallestHasComm?gfH_m:typH_m):typH_m;
      const yBase=isGF?0:((tallestHasComm?gfH_m:typH_m)+(f-1)*typH_m);
      const fg=0.08;

      // Storey is "active" if any volume actually exists at this global storey.
      // f is 0-based here, global storey = f + 1. Use _startStoreyForVol to know
      // each volume's real storey range so towers above podiums count correctly.
      let floorActive=false;
      const _gs = f + 1;
      P.vols.forEach(vol=>{
        const ss = _startStoreyForVolAuto(vol);
        if(_gs >= ss && _gs <= ss + (vol.storeys||0) - 1) floorActive = true;
      });
      if(!floorActive) continue;

      // Elevator shafts — only render if numElev > 0
      if(numElev > 0){
        const eBaseX=f2m(C.elevX), eBaseZ=f2m(C.elevZ);
        const bankCX=isEW ? eBaseX+((numElev-1)*elevSpc+elevW)/2 : eBaseX+elevW/2;
        const bankCZ=isEW ? eBaseZ+elevD/2 : eBaseZ+((numElev-1)*elevSpc+elevD)/2;
        const elevBankGrp=new THREE.Group();
        elevBankGrp._coreType='elev';elevBankGrp._coreIdx=0;
        for(let e=0;e<numElev;e++){
          const ex=isEW ? eBaseX+e*elevSpc : eBaseX;
          const ez=isEW ? eBaseZ : eBaseZ+e*elevSpc;
          const geo=new THREE.BoxGeometry(elevW,flH-fg,elevD);
          const mat=new THREE.MeshStandardMaterial({color:COL_ELEV,roughness:0.5,transparent:true,opacity:0.95,depthWrite:true});
          const mesh=new THREE.Mesh(geo,mat);
          mesh.castShadow=true;mesh.receiveShadow=true;
          mesh.position.set(ex+elevW/2-bankCX, 0, ez+elevD/2-bankCZ);
          elevBankGrp.add(mesh);
          const edgeGeo=new THREE.EdgesGeometry(geo);
          const edgeMat=new THREE.LineBasicMaterial({color:'#e0c0ff',transparent:true,opacity:0.5});
          const edgeLine=new THREE.LineSegments(edgeGeo,edgeMat);
          edgeLine.position.copy(mesh.position);
          elevBankGrp.add(edgeLine);
        }
        elevBankGrp.position.set(bankCX, yBase+(flH-fg)/2, bankCZ);
        elevBankGrp.rotation.y=-elevAngleRad;
        sec3d.group.add(elevBankGrp);
      }

      // Stairwells — only render if stairs exist
      stairs.forEach((sp,si)=>{
        const aRad=sp.angle*Math.PI/180;
        const sg=makeRotatedPair(sp.x,sp.z,stairW,stairD,yBase,flH-fg,COL_STAIR,0.9,'#ff8870',aRad);
        sg._coreType='stair';sg._coreIdx=si;
        sec3d.group.add(sg);
      });
    }
  }

  // Lot outline on ground
  const lotShape=new THREE.Shape();
  const lv=lotVerts();
  lotShape.moveTo(f2m(lv[0][0]),f2m(lv[0][1]));
  for(let i=1;i<lv.length;i++) lotShape.lineTo(f2m(lv[i][0]),f2m(lv[i][1]));
  lotShape.lineTo(f2m(lv[0][0]),f2m(lv[0][1]));
  const lotGeo=new THREE.ShapeGeometry(lotShape);
  const lotMat=new THREE.MeshBasicMaterial({color:'#ff4444',transparent:true,opacity:0.1,side:THREE.DoubleSide});
  const lotMesh=new THREE.Mesh(lotGeo,lotMat);
  lotMesh.rotation.x=-Math.PI/2;lotMesh.position.y=0.02;
  sec3d.group.add(lotMesh);

  // Lot outline edges
  const lotPts=lv.map(v=>new THREE.Vector3(f2m(v[0]),0.05,f2m(v[1])));
  lotPts.push(lotPts[0].clone());
  const lotLineGeo=new THREE.BufferGeometry().setFromPoints(lotPts);
  const lotLine=new THREE.Line(lotLineGeo,new THREE.LineBasicMaterial({color:'#ff4444',linewidth:2}));
  sec3d.group.add(lotLine);
}

function updateSection3DStats(){
  const el=document.getElementById('section3d-stats');
  if(!el)return;
  // Use pfCalc as single source of truth
  const d=pfData();
  const commArea=d.commGFA;
  const resiArea=d.resiGFA;
  const amenArea=Math.min(5000,resiArea*0.04); // amenity estimate consistent with pfCalc

  el.innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:11px">
      <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid ${COL_COMM='#e8c87a'}">
        <div style="color:#888">Commercial</div>
        <div style="color:#e8c87a;font-weight:700;font-size:14px">${Math.round(commArea).toLocaleString()} sf</div>
      </div>
      <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #4ecdc4">
        <div style="color:#888">Amenity</div>
        <div style="color:#4ecdc4;font-weight:700;font-size:14px">${Math.round(amenArea).toLocaleString()} sf</div>
      </div>
      <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #88aabb">
        <div style="color:#888">Residential</div>
        <div style="color:#88aabb;font-weight:700;font-size:14px">${Math.round(resiArea).toLocaleString()} sf</div>
      </div>
      <div style="background:#2D2D2D;padding:8px;border-radius:4px;border-left:3px solid #AEBC46">
        <div style="color:#888">Total GFA</div>
        <div style="color:#AEBC46;font-weight:700;font-size:14px">${Math.round(d.totalGFA).toLocaleString()} sf</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:13px;margin-top:6px">
      <div style="background:#2D2D2D;padding:6px;border-radius:4px">
        <span style="color:#c49ade">■</span> ${P.core.numElevators||0} Elevator${(P.core.numElevators||0)!==1?'s':''}: <b>~${(P.core.numElevators||0)*70} sf/flr</b>
      </div>
      <div style="background:#2D2D2D;padding:6px;border-radius:4px">
        <span style="color:#b06050">■</span> ${P.core.stairs.length} Stairwell${P.core.stairs.length>1?'s':''}: <b>~${P.core.stairs.length*110} sf/flr</b>
      </div>
      <div style="background:#2D2D2D;padding:6px;border-radius:4px">
        <span style="color:#777677">■</span> Corridor: <b>~6.5' wide</b>
      </div>
    </div>
  `;
}

/**
 * Sets the section 3D camera to a named view.
 * @param {string} view - 'front'|'back'|'side'|'west'|'top'|'persp'
 */
function sec3dView(view){
  if(!sec3d._orbit)return;
  const o=sec3d._orbit;
  const c=secCenter();
  const d=Math.max(35,c.maxH*2.2);
  o.target.set(c.x,c.y,c.z);
  switch(view){
    case 'front': o.theta=0;o.phi=Math.PI/2;o.dist=d;break;
    case 'back': o.theta=Math.PI;o.phi=Math.PI/2;o.dist=d;break;
    case 'side': o.theta=Math.PI/2;o.phi=Math.PI/2;o.dist=d;break; // East side
    case 'west': o.theta=-Math.PI/2;o.phi=Math.PI/2;o.dist=d;break; // West side
    case 'top': o.theta=0;o.phi=0.1;o.dist=d*1.3;break; // bird's eye
    case 'persp': o.theta=-0.7;o.phi=0.8;o.dist=d;break; // 3/4 view
  }
}

