// sitemap-parcel-picker.js — Multi-parcel selection + merge
// ═══════════════════════════════════════════════════════════════════════════════════
function _snapDistM(a,b){
  const dLat=(b[1]-a[1])*Math.PI/180, dLng=(b[0]-a[0])*Math.PI/180;
  const s=Math.sin(dLat/2)**2+Math.cos(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.sin(dLng/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(s),Math.sqrt(1-s));
}

/**
 * Closest point on segment [p1,p2] to point pt, all [lng,lat].
 * Returns {point:[lng,lat], dist:metres, t:0-1 parametric}.
 */
function _closestPointOnSegment(pt,p1,p2){
  const dx=p2[0]-p1[0], dy=p2[1]-p1[1];
  const len2=dx*dx+dy*dy;
  if(len2<1e-20) return {point:[...p1],dist:_snapDistM(pt,p1),t:0};
  let t=((pt[0]-p1[0])*dx+(pt[1]-p1[1])*dy)/len2;
  t=Math.max(0,Math.min(1,t));
  const proj=[p1[0]+t*dx, p1[1]+t*dy];
  return {point:proj,dist:_snapDistM(pt,proj),t};
}

/**
 * Snap vertices of `newVerts` to nearby vertices/edges of all already-
 * selected parcels.  Mutates and returns the snapped array.
 *
 * Two-pass approach:
 *   Pass 1 — vertex-to-vertex: if a new vertex is within `tolM` of an
 *            existing vertex, snap it exactly onto that vertex.
 *   Pass 2 — vertex-to-edge:   if a new vertex is within `tolM` of an
 *            edge of an existing parcel (but not near a vertex), snap it
 *            onto the closest point on that edge AND insert the same
 *            point into the existing parcel's ring so both polygons
 *            share the vertex.  (This prevents turf.union slivers.)
 *
 * @param {Array} newVerts  — [[lng,lat], ...] open ring (no closing dup)
 * @param {number} tolM     — snap tolerance in metres (default 3 ≈ 10 ft)
 * @returns {Array}         — snapped newVerts (same length or reference)
 */
function _snapParcelVerts(newVerts, tolM){
  tolM=tolM||3;
  if(smSelectedParcels.length===0) return newVerts;

  // Collect all existing vertices across selected parcels
  const existVerts=[];
  smSelectedParcels.forEach(p=>{
    p.ringCoords.forEach(v=>existVerts.push(v));
  });

  // Pass 1 — vertex-to-vertex snap
  for(let i=0;i<newVerts.length;i++){
    let bestD=Infinity, bestV=null;
    for(const ev of existVerts){
      const d=_snapDistM(newVerts[i],ev);
      if(d<bestD){bestD=d;bestV=ev;}
    }
    if(bestD<tolM && bestV){
      newVerts[i]=[bestV[0],bestV[1]];
    }
  }

  // Pass 2 — vertex-to-edge snap (for vertices NOT already snapped)
  for(let i=0;i<newVerts.length;i++){
    // Skip if already coincident with an existing vertex
    const alreadySnapped=existVerts.some(ev=>
      Math.abs(ev[0]-newVerts[i][0])<1e-9 && Math.abs(ev[1]-newVerts[i][1])<1e-9
    );
    if(alreadySnapped) continue;

    let bestD=Infinity, bestPt=null, bestParcelIdx=-1, bestEdgeIdx=-1;
    smSelectedParcels.forEach((p,pi)=>{
      const ring=p.ringCoords;
      for(let j=0;j<ring.length;j++){
        const nj=(j+1)%ring.length;
        const cp=_closestPointOnSegment(newVerts[i],ring[j],ring[nj]);
        // Exclude endpoints (already handled by pass 1)
        if(cp.t<0.01||cp.t>0.99) continue;
        if(cp.dist<bestD){bestD=cp.dist;bestPt=cp.point;bestParcelIdx=pi;bestEdgeIdx=j;}
      }
    });
    if(bestD<tolM && bestPt){
      // Snap the new vertex onto the edge
      newVerts[i]=[bestPt[0],bestPt[1]];
      // Insert this point into the existing parcel's ring so both share it
      if(bestParcelIdx>=0){
        const ring=smSelectedParcels[bestParcelIdx].ringCoords;
        ring.splice(bestEdgeIdx+1,0,[bestPt[0],bestPt[1]]);
        // Rebuild that parcel's geojsonFeature with the updated ring
        const closed=[...ring,ring[0]];
        smSelectedParcels[bestParcelIdx].geojsonFeature=turf.polygon([closed]);
      }
    }
  }

  // Pass 3 — reverse: snap existing parcel vertices onto edges of the new parcel
  // This catches the case where an existing vertex falls near a new parcel's edge
  smSelectedParcels.forEach((p,pi)=>{
    const ring=p.ringCoords;
    for(let k=0;k<ring.length;k++){
      // Skip if already coincident with a new vertex
      const alreadyCoinc=newVerts.some(nv=>
        Math.abs(nv[0]-ring[k][0])<1e-9 && Math.abs(nv[1]-ring[k][1])<1e-9
      );
      if(alreadyCoinc) continue;

      let bestD=Infinity, bestPt=null, bestEdgeIdx=-1;
      for(let j=0;j<newVerts.length;j++){
        const nj=(j+1)%newVerts.length;
        const cp=_closestPointOnSegment(ring[k],newVerts[j],newVerts[nj]);
        if(cp.t<0.01||cp.t>0.99) continue;
        if(cp.dist<bestD){bestD=cp.dist;bestPt=cp.point;bestEdgeIdx=j;}
      }
      if(bestD<tolM && bestPt){
        // Snap existing vertex onto the new parcel's edge point
        ring[k]=[bestPt[0],bestPt[1]];
        // Insert this shared point into the new ring
        newVerts.splice(bestEdgeIdx+1,0,[bestPt[0],bestPt[1]]);
      }
    }
    // Rebuild geojsonFeature if ring was modified
    const closed=[...ring,ring[0]];
    p.geojsonFeature=turf.polygon([closed]);
  });

  return newVerts;
}

/**
 * After turf.union, simplify the merged ring to remove micro-edges
 * (remnants of near-coincident boundaries that didn't fully collapse).
 * Removes vertices that are within `tolM` of the line between their
 * neighbours (collinear within tolerance).
 */
function _cleanMergedRing(ring, tolM){
  tolM=tolM||1.5; // tighter tolerance for post-merge cleanup
  if(ring.length<4) return ring;
  let changed=true;
  while(changed){
    changed=false;
    const out=[];
    for(let i=0;i<ring.length;i++){
      const prev=i===0?ring[ring.length-1]:out[out.length-1]||ring[ring.length-1];
      const next=ring[(i+1)%ring.length];
      const cp=_closestPointOnSegment(ring[i],prev,next);
      if(cp.dist<tolM && ring.length-out.length+(ring.length-i-1)>=3){
        // This vertex is nearly collinear — skip it
        changed=true;
        continue;
      }
      out.push(ring[i]);
    }
    if(out.length<3) return ring; // safety: don't degenerate
    ring=out;
  }
  return ring;
}

/**
 * Remove duplicate consecutive vertices from a ring (within tolerance).
 */
function _dedupeRing(ring, tolM){
  tolM=tolM||0.5;
  if(ring.length<2) return ring;
  const out=[ring[0]];
  for(let i=1;i<ring.length;i++){
    if(_snapDistM(ring[i],out[out.length-1])>tolM) out.push(ring[i]);
  }
  return out;
}

/**
 * Toggles the multi-parcel picker mode on the map. When active, clicking
 * parcels selects them for merging into a single development lot.
 */
function smToggleParcelPicker(){
  if(!smMap){smShowToast('Initialize the map first (enter Mapbox token)','#c44');return;}
  if(smLotDrawing){smShowToast('Finish or cancel lot drawing first','#c44');return;}
  if(smBldgDrawing){smShowToast('Finish or cancel building drawing first','#c44');return;}
  if(smEditLotActive){smShowToast('Finish lot editing first','#c44');return;}

  smParcelPickerActive=!smParcelPickerActive;
  const btn=document.getElementById('btn-pick-parcel');

  if(smParcelPickerActive){
    // Turn OFF zoning click handler while parcel picker is active
    if(_zoningOverlayVisible){toggleZoningOverlay();}
    // Enter multi-parcel mode
    smMultiParcelMode=true;
    smSelectedParcels=[];
    smMap.on('click',smParcelClickHandler);
    smMap.getCanvas().style.cursor='crosshair';
    if(btn){btn.style.background='#AEBC46';btn.style.color='#111';}
    // Show multi-parcel bar
    const bar=document.getElementById('sm-multi-parcel-bar');
    if(bar) bar.style.display='block';
    smUpdateMultiParcelUI();
    // Clear any previous multi-parcel preview layers
    smClearMultiParcelLayers();
    const instrEl=document.getElementById('sitemap-instructions');
    if(instrEl) instrEl.innerHTML='<span style="color:#AEBC46;font-weight:700">PARCEL PICKER ACTIVE</span> — click parcels to select · pick multiple then merge';
    smShowToast('Click properties to select — pick multiple to merge','#AEBC46');
  } else {
    smCancelMultiParcel();
  }
}

function smCancelMultiParcel(){
  // Exit edit mode FIRST so its markers + state get cleaned up
  if(typeof smParcelEditMode !== 'undefined' && smParcelEditMode){
    if(typeof smExitParcelEditMode === 'function') smExitParcelEditMode();
  }
  smParcelPickerActive=false;
  smMultiParcelMode=false;
  smSelectedParcels=[];
  if(smMap){
    smMap.off('click',smParcelClickHandler);
    smMap.getCanvas().style.cursor='';
  }
  const btn=document.getElementById('btn-pick-parcel');
  if(btn){btn.style.background='#444444';btn.style.color='#AEBC46';}
  const bar=document.getElementById('sm-multi-parcel-bar');
  if(bar) bar.style.display='none';
  smClearMultiParcelLayers();
  const instrEl=document.getElementById('sitemap-instructions');
  if(instrEl) instrEl.innerHTML='Click <b style="color:#AEBC46">DRAW LOT</b> or <b style="color:#AEBC46">PICK PARCEL</b>';
}

function smClearMultiParcelLayers(){
  if(!smMap) return;
  // Remove preview layers for each selected parcel
  for(let i=0;i<20;i++){
    const lid='sm-multi-parcel-fill-'+i;
    const lid2='sm-multi-parcel-line-'+i;
    const sid='sm-multi-parcel-'+i;
    try{if(smMap.getLayer(lid)) smMap.removeLayer(lid);}catch(e){}
    try{if(smMap.getLayer(lid2)) smMap.removeLayer(lid2);}catch(e){}
    try{if(smMap.getSource(sid)) smMap.removeSource(sid);}catch(e){}
  }
}

function smUpdateMultiParcelUI(){
  const count=smSelectedParcels.length;
  const badge=document.getElementById('sm-parcel-badge');
  if(badge) badge.textContent=count;

  const countEl=document.getElementById('sm-multi-parcel-count');
  if(countEl){
    if(count===0) countEl.textContent='Click parcels to add them';
    else if(count===1) countEl.textContent='1 parcel selected — click more or apply';
    else countEl.textContent=count+' parcels selected — ready to merge';
  }

  // Enable/disable merge & undo buttons + dynamic label
  const mergeBtn=document.getElementById('btn-merge-parcels');
  const undoBtn=document.getElementById('btn-undo-parcel');
  const editBtn=document.getElementById('btn-edit-parcels');
  if(mergeBtn){
    if(count>=1){mergeBtn.style.opacity='1';mergeBtn.style.pointerEvents='auto';}
    else{mergeBtn.style.opacity='0.4';mergeBtn.style.pointerEvents='none';}
    mergeBtn.textContent=count>1?'🔗 MERGE & APPLY ('+count+')':'✅ APPLY PARCEL';
  }
  if(undoBtn){
    if(count>=1){undoBtn.style.opacity='1';undoBtn.style.pointerEvents='auto';}
    else{undoBtn.style.opacity='0.4';undoBtn.style.pointerEvents='none';}
  }
  if(editBtn){
    // Edit Parcels needs at least 1 selection
    if(count>=1){editBtn.style.opacity='1';editBtn.style.pointerEvents='auto';}
    else{editBtn.style.opacity='0.4';editBtn.style.pointerEvents='none';}
  }

  // Render selected parcels list
  const listEl=document.getElementById('sm-selected-parcels-list');
  if(!listEl) return;
  if(count===0){listEl.innerHTML='';return;}
  // Show combined area total
  const totalSf=smSelectedParcels.reduce((s,p)=>s+(p.areaSqFt||0),0);
  const colors=['#AEBC46','#4ecdc4','#ff9966','#b088cc','#e8c87a','#66bbff','#ff6b9d','#7bed9f'];
  listEl.innerHTML=smSelectedParcels.map((p,i)=>{
    const col=colors[i%colors.length];
    const addr=(p.attributes.address||'').trim();
    const label=addr&&addr.length>2?addr:'Parcel '+(i+1);
    const area=p.areaSqFt?Math.round(p.areaSqFt).toLocaleString()+' sf':'';
    return `<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border-radius:4px;background:#111;margin-bottom:3px;font-size:10px">
      <div style="width:10px;height:10px;border-radius:2px;background:${col};flex-shrink:0"></div>
      <div style="flex:1;color:#ccc;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${label}</div>
      <div style="color:#888;font-size:9px">${area}</div>
      <div onclick="smRemoveParcel(${i})" style="color:#c44;cursor:pointer;font-size:12px;padding:0 2px" title="Remove">✕</div>
    </div>`;
  }).join('')+(count>1?`<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 6px;border-top:1px solid #333;margin-top:3px;font-size:10px;font-weight:700">
    <span style="color:#888">COMBINED TOTAL</span><span style="color:#AEBC46">${Math.round(totalSf).toLocaleString()} sf</span>
  </div>`:'');
}

function smRenderMultiParcelPreview(){
  if(!smMap) return;
  smClearMultiParcelLayers();
  const colors=['#AEBC46','#4ecdc4','#ff9966','#b088cc','#e8c87a','#66bbff','#ff6b9d','#7bed9f'];
  smSelectedParcels.forEach((p,i)=>{
    const sid='sm-multi-parcel-'+i;
    const col=colors[i%colors.length];
    smMap.addSource(sid,{type:'geojson',data:p.geojsonFeature});
    smMap.addLayer({id:'sm-multi-parcel-fill-'+i,type:'fill',source:sid,paint:{'fill-color':col,'fill-opacity':0.18}});
    smMap.addLayer({id:'sm-multi-parcel-line-'+i,type:'line',source:sid,paint:{'line-color':col,'line-width':2.5,'line-dasharray':[3,2]}});
  });
  // Fit to all selected parcels
  if(smSelectedParcels.length>0){
    let allLngs=[],allLats=[];
    smSelectedParcels.forEach(p=>{
      p.ringCoords.forEach(c=>{allLngs.push(c[0]);allLats.push(c[1]);});
    });
    smMap.fitBounds([[Math.min(...allLngs),Math.min(...allLats)],[Math.max(...allLngs),Math.max(...allLats)]],{padding:80,duration:600});
  }
}

function smRemoveParcel(idx){
  smSelectedParcels.splice(idx,1);
  smUpdateMultiParcelUI();
  smRenderMultiParcelPreview();
  // If editing, refresh markers so they match the new parcel set
  if(typeof smParcelEditMode !== 'undefined' && smParcelEditMode){
    if(typeof smRenderParcelEditMarkers === 'function') smRenderParcelEditMarkers();
  }
}

function smUndoLastParcel(){
  if(smSelectedParcels.length>0){
    smSelectedParcels.pop();
    smUpdateMultiParcelUI();
    smRenderMultiParcelPreview();
    smShowToast('Last parcel removed','#888');
    if(typeof smParcelEditMode !== 'undefined' && smParcelEditMode){
      if(typeof smRenderParcelEditMarkers === 'function') smRenderParcelEditMarkers();
    }
  }
}

/**
 * Merges all selected parcels into a single polygon using turf.union and
 * applies the result as the active lot boundary on the site map.
 */
function smMergeAndApplyParcels(){
  if(smSelectedParcels.length===0){smShowToast('No parcels selected','#c44');return;}

  let mergedRing;
  if(smSelectedParcels.length===1){
    // Single parcel — just use its ring directly
    mergedRing=smSelectedParcels[0].ringCoords;
  } else {
    // Multiple parcels — union them with turf.union
    try{
      let merged=smSelectedParcels[0].geojsonFeature;
      for(let i=1;i<smSelectedParcels.length;i++){
        merged=turf.union(turf.featureCollection([merged,smSelectedParcels[i].geojsonFeature]));
        if(!merged){
          smShowToast('Parcels could not be merged (non-adjacent?)','#c44');
          return;
        }
      }
      // Extract the outer ring from the merged result
      if(merged.geometry.type==='MultiPolygon'){
        // Take the largest polygon from the multi-polygon
        let largestIdx=0,largestArea=0;
        merged.geometry.coordinates.forEach((poly,idx)=>{
          const a=turf.area(turf.polygon(poly));
          if(a>largestArea){largestArea=a;largestIdx=idx;}
        });
        mergedRing=merged.geometry.coordinates[largestIdx][0];
        smShowToast('Parcels not fully adjacent — using largest merged area','#e8c87a');
      } else {
        mergedRing=merged.geometry.coordinates[0];
      }
    }catch(err){
      console.error('Merge error:',err);
      smShowToast('Merge failed: '+err.message,'#c44');
      return;
    }
  }

  // ── Post-merge cleanup: remove micro-edges, dedupe, smooth zig-zags ──
  // Remove closing vertex if present (smApplyParcelAsLot expects open ring)
  if(mergedRing.length>1){
    const f=mergedRing[0],l=mergedRing[mergedRing.length-1];
    if(Math.abs(f[0]-l[0])<1e-8&&Math.abs(f[1]-l[1])<1e-8) mergedRing=mergedRing.slice(0,-1);
  }
  mergedRing=_dedupeRing(mergedRing,0.3);
  mergedRing=_cleanMergedRing(mergedRing,1.5);
  if(mergedRing.length<3){smShowToast('Merged polygon degenerated — try again','#c44');return;}

  // Build combined attributes
  const addrs=smSelectedParcels.map(p=>(p.attributes.address||'').trim()).filter(a=>a.length>2);
  const combinedAttrs={
    address:addrs.length>0?addrs.join(' + '):null,
    parcelId:smSelectedParcels.map(p=>p.attributes.parcelId).filter(Boolean).join('+'),
    areaSqM:null, owner:null, zoningCode:null
  };
  const svcName=smSelectedParcels[0].serviceName;

  // Clean up multi-parcel mode
  smClearMultiParcelLayers();
  smParcelPickerActive=false;
  smMultiParcelMode=false;
  smSelectedParcels=[];
  if(smMap){smMap.off('click',smParcelClickHandler);smMap.getCanvas().style.cursor='';}
  const btn=document.getElementById('btn-pick-parcel');
  if(btn){btn.style.background='#444444';btn.style.color='#AEBC46';}
  const bar=document.getElementById('sm-multi-parcel-bar');
  if(bar) bar.style.display='none';

  // Apply the merged polygon as the lot
  smApplyParcelAsLot(mergedRing, combinedAttrs, svcName);
}

async function smParcelClickHandler(e){
  if(!smParcelPickerActive)return;
  // Guard against concurrent clicks — reject if already processing
  if(_smParcelClickBusy){console.log('Parcel click ignored — still processing previous');return;}
  _smParcelClickBusy=true;
  const lng=e.lngLat.lng, lat=e.lngLat.lat;

  // Remove any stale loading popup from a previous click
  if(_smActivePopup){try{_smActivePopup.remove();}catch(ex){}_smActivePopup=null;}

  // Show loading popup with progress
  const popup=new mapboxgl.Popup({maxWidth:'280px',className:'zoning-popup',closeOnClick:false})
    .setLngLat([lng,lat])
    .setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#AEBC46;font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:4px">QUERYING PARCEL...</div><div style="color:#888;font-size:10px">Searching property boundaries...</div><div style="margin-top:6px;height:2px;background:#333;border-radius:1px;overflow:hidden"><div id="parcel-progress" style="width:10%;height:100%;background:#AEBC46;transition:width 0.5s"></div></div></div>')
    .addTo(smMap);
  _smActivePopup=popup;

  // Animate progress bar while waiting
  let progPct=10;
  const progInterval=setInterval(()=>{
    progPct=Math.min(progPct+8,90);
    const bar=document.getElementById('parcel-progress');
    if(bar) bar.style.width=progPct+'%';
  },1500);

  try{
    // Try up to 2 attempts (retry once on failure — server may be temporarily overloaded)
    let result=null;
    for(let attempt=0;attempt<2;attempt++){
      result=await queryParcelAtPoint(lat,lng);
      if(result) break;
      if(attempt===0){
        // First attempt failed — update popup and retry
        popup.setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#e8c87a;font-size:10px;font-weight:700;letter-spacing:1px;margin-bottom:4px">RETRYING...</div><div style="color:#888;font-size:10px">City server was slow — trying again...</div><div style="margin-top:6px;height:2px;background:#333;border-radius:1px;overflow:hidden"><div id="parcel-progress" style="width:30%;height:100%;background:#e8c87a;transition:width 0.5s"></div></div></div>');
        await new Promise(r=>setTimeout(r,1000)); // 1s pause before retry
      }
    }
    clearInterval(progInterval);

    if(!result){
      popup.setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#c44;font-size:10px;font-weight:700">NO PARCEL FOUND</div><div style="color:#888;font-size:10px;margin-top:4px">City GIS server is currently slow/unresponsive.<br>Try again in a few minutes, or use <b>DRAW LOT</b> to trace manually.</div></div>');
      setTimeout(()=>{try{popup.remove();}catch(ex){}_smActivePopup=null;},4000);
      _smParcelClickBusy=false;
      return;
    }
    popup.remove();_smActivePopup=null;

    // Convert ArcGIS rings to GeoJSON polygon coordinates
    const geojsonCoords=result.geometry.rings||result.geometry.coordinates;
    if(!geojsonCoords||geojsonCoords.length===0){
      smShowToast('Parcel found but has no geometry','#c44');
      _smParcelClickBusy=false;return;
    }

    const ring=geojsonCoords[0];
    // Remove duplicate closing vertex if present
    let verts=[...ring];
    if(verts.length>1){
      const first=verts[0], last=verts[verts.length-1];
      if(Math.abs(first[0]-last[0])<1e-8&&Math.abs(first[1]-last[1])<1e-8){
        verts=verts.slice(0,-1);
      }
    }

    // ── Snap vertices to already-selected parcels (within 3m ≈ ~10ft) ──
    // This ensures shared boundaries are exactly coincident so turf.union
    // merges cleanly without zig-zag slivers between adjacent parcels.
    verts=_snapParcelVerts(verts, 3);
    verts=_dedupeRing(verts, 0.3);

    // Check for duplicate parcel — use polygon overlap, not centroid distance
    // Two parcels are duplicates if >70% of the new parcel overlaps an existing one
    const newPoly=turf.polygon([[...verts,verts[0]]]);
    const newArea=turf.area(newPoly);
    const isDuplicate=smSelectedParcels.some(p=>{
      try{
        const inter=turf.intersect(turf.featureCollection([newPoly,p.geojsonFeature]));
        if(!inter) return false;
        const overlapArea=turf.area(inter);
        return overlapArea/newArea>0.7; // >70% overlap = same parcel
      }catch(e){return false;}
    });
    if(isDuplicate){
      smShowToast('This parcel is already selected','#e8c87a');
      _smParcelClickBusy=false;
      return;
    }

    // Build the GeoJSON feature for this parcel
    const closedRing=[...verts,verts[0]];
    const geojsonFeature=turf.polygon([closedRing]);
    const areaSqFt=turf.area(geojsonFeature)*10.7639;

    // Add to selected parcels
    smSelectedParcels.push({
      ringCoords:verts,
      attributes:result.attributes,
      serviceName:result.serviceName,
      geojsonFeature,
      areaSqFt
    });

    // Update UI
    smUpdateMultiParcelUI();
    smRenderMultiParcelPreview();

    const addr=(result.attributes.address||'').trim();
    const label=addr&&addr.length>2?addr:'Parcel '+smSelectedParcels.length;
    smShowToast('Added: '+label+' ('+Math.round(areaSqFt).toLocaleString()+' sf)','#AEBC46');

  }catch(err){
    clearInterval(progInterval);
    console.error('Parcel query error:',err);
    popup.setHTML('<div style="font-family:Outfit,DM Sans,sans-serif;padding:4px"><div style="color:#c44;font-size:10px;font-weight:700">QUERY FAILED</div><div style="color:#888;font-size:10px;margin-top:4px">'+err.message+'</div></div>');
    setTimeout(()=>{try{popup.remove();}catch(ex){}_smActivePopup=null;},4000);
  }finally{
    _smParcelClickBusy=false;
  }
}

// Pick the best feature from a multi-feature result set
function _pickBestFeature(features,lng,lat){
  let best=features[0];
  if(features.length>1){
    const clickPt=turf.point([lng,lat]);
    let foundContaining=false;
    let bestDist=Infinity;
    for(const feat of features){
      const rings=feat.geometry.rings||feat.geometry.coordinates;
      if(!rings||!rings[0]) continue;
      try{
        const ring=rings[0];
        const first=ring[0],last=ring[ring.length-1];
        const closed=(Math.abs(first[0]-last[0])<1e-8&&Math.abs(first[1]-last[1])<1e-8)?ring:[...ring,ring[0]];
        const poly=turf.polygon([closed]);
        if(turf.booleanPointInPolygon(clickPt,poly)){
          if(!foundContaining){best=feat;foundContaining=true;bestDist=0;}
          else{
            const bRings=best.geometry.rings||best.geometry.coordinates;
            const bRing=bRings[0];const bf=bRing[0],bl=bRing[bRing.length-1];
            const bClosed=(Math.abs(bf[0]-bl[0])<1e-8&&Math.abs(bf[1]-bl[1])<1e-8)?bRing:[...bRing,bRing[0]];
            if(turf.area(poly)<turf.area(turf.polygon([bClosed]))) best=feat;
          }
        } else if(!foundContaining){
          const c=turf.centroid(poly);
          const d=turf.distance(clickPt,c,{units:'meters'});
          if(d<bestDist){bestDist=d;best=feat;}
        }
      }catch(ex){/* skip malformed geometry */}
    }
  }
  return best;
}

// Query a single parcel service and return result or null
async function _queryOneService(svc,lat,lng,timeoutMs){
  const dist=svc.distance||5;
  const url=svc.url
    +'?geometry='+lng+','+lat
    +'&geometryType=esriGeometryPoint'
    +'&inSR=4326'
    +'&outSR=4326'
    +'&spatialRel=esriSpatialRelIntersects'
    +'&distance='+dist+'&units=esriSRUnit_Meter'
    +'&outFields='+(svc.fields||'*')
    +'&returnGeometry=true'
    +'&f=json';
  const resp=await fetch(url,{signal:AbortSignal.timeout(timeoutMs)});
  if(!resp.ok) return null;
  const data=await resp.json();
  if(!data.features||data.features.length===0) return null;
  // Filter out non-property features (roads, reserves) if service specifies a filter
  let features=data.features;
  if(svc.filterType){
    const filtered=features.filter(f=>f.attributes.FEATURE_TYPE===svc.filterType);
    if(filtered.length>0) features=filtered;
  }
  const best=_pickBestFeature(features,lng,lat);
  const attrs=svc.parse?svc.parse(best.attributes):best.attributes;
  return {geometry:best.geometry, attributes:attrs, serviceName:svc.name};
}

async function queryParcelAtPoint(lat,lng){
  // Find matching services based on the click location
  const matching=PARCEL_SERVICES.filter(s=>{
    const b=s.bounds;
    return lng>=b.minLng&&lng<=b.maxLng&&lat>=b.minLat&&lat<=b.maxLat;
  });
  const toTry=matching.length>0?matching:PARCEL_SERVICES;

  // Race all matching services in parallel — first valid result wins
  // This avoids the timeout cascade (25s × N services = minutes of waiting)
  const promises=toTry.map(svc=>
    _queryOneService(svc,lat,lng,20000).catch(e=>{
      console.warn('Parcel query failed for '+svc.name+':',e.message);
      return null;
    })
  );

  // Use Promise.any — resolves with first non-null result
  // Wrap each promise to reject on null so Promise.any skips it
  try{
    const result=await Promise.any(
      promises.map(p=>p.then(r=>{if(r)return r;throw new Error('no data');}))
    );
    return result;
  }catch(e){
    // All services returned null or timed out — fall back to sequential with last resort
    return null;
  }
}

function smApplyParcelAsLot(ringCoords, attributes, serviceName){
  // ringCoords = array of [lng, lat] from ArcGIS (already in WGS84)
  // Ensure the ring is not closed (remove duplicate closing vertex)
  let verts=[...ringCoords];
  if(verts.length>1){
    const first=verts[0], last=verts[verts.length-1];
    if(Math.abs(first[0]-last[0])<1e-8&&Math.abs(first[1]-last[1])<1e-8){
      verts=verts.slice(0,-1);
    }
  }
  if(verts.length<3){smShowToast('Invalid parcel polygon (< 3 vertices)','#c44');return;}

  // Turn off parcel picker
  smParcelPickerActive=false;
  if(smMap){smMap.off('click',smParcelClickHandler);smMap.getCanvas().style.cursor='';}
  const btn=document.getElementById('btn-pick-parcel');
  if(btn){btn.style.background='#444444';btn.style.color='#AEBC46';}

  // Build closed ring for GeoJSON
  const closedCoords=[...verts,verts[0]];

  // Render the parcel on the map (same layer system as manual lot drawing)
  const poly={type:'Feature',geometry:{type:'Polygon',coordinates:[closedCoords]},properties:{}};
  if(smMap){
    if(smMap.getSource('sm-custom-lot')){
      smMap.getSource('sm-custom-lot').setData(poly);
    } else {
      smMap.addSource('sm-custom-lot',{type:'geojson',data:poly});
      smMap.addLayer({id:'sm-custom-lot-fill',type:'fill',source:'sm-custom-lot',paint:{'fill-color':'#AEBC46','fill-opacity':0.12}});
      smMap.addLayer({id:'sm-custom-lot-line',type:'line',source:'sm-custom-lot',paint:{'line-color':'#AEBC46','line-width':2.5,'line-dasharray':[3,2]}});
    }
    // Also clear/update the saved-lot layers if they exist
    if(smMap.getSource('saved-lot')){
      smMap.getSource('saved-lot').setData(poly);
    }
    // Fit map to parcel bounds
    const lngs=verts.map(c=>c[0]), lats=verts.map(c=>c[1]);
    smMap.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:80,duration:600});
  }

  // Process lot data — reuse the same pipeline as smCloseLotPoly
  const areaSqM=turf.area(poly);
  const areaSqFt=areaSqM*10.7639;
  const perimM=turf.length(turf.polygonToLine(poly.geometry),{units:'meters'});
  const edges=[];
  for(let i=0;i<verts.length;i++){
    const a=verts[i],b=verts[(i+1)%verts.length];
    const dM=turf.distance(turf.point(a),turf.point(b),{units:'meters'});
    const dFt=dM*3.28084;
    const bearing=turf.bearing(turf.point(a),turf.point(b));
    const dirs=['N','NE','E','SE','S','SW','W','NW'];
    const compass=dirs[Math.round(((bearing%360+360)%360)/45)%8];
    edges.push({id:String.fromCharCode(65+i),from:a,to:b,lengthFt:dFt,lengthM:dM,compass});
  }
  smLotData={vertices:verts,geometry:poly.geometry,areaSqFt,areaSqM,perimFt:perimM*3.28084,edges,shape:verts.length+'pt polygon',vertexCount:verts.length};

  // Set GPS centroid
  const lotCentroid=turf.centroid(poly);
  P.siteCoords={lat:lotCentroid.geometry.coordinates[1],lng:lotCentroid.geometry.coordinates[0]};
  P.lot.gpsVerts=verts.map(v=>[v[0],v[1]]);

  // Convert GPS → local feet (same algorithm as smOnDraw)
  let originIdx=0, bestScore=Infinity;
  for(let i=0;i<verts.length;i++){
    const score=verts[i][0]*-1+verts[i][1]*-1; // southwestmost
    if(score<bestScore){bestScore=score;originIdx=i;}
  }
  const originLng=verts[originIdx][0], originLat=verts[originIdx][1];
  const polyVerts=verts.map(v=>{
    const xM=turf.distance(turf.point([originLng,originLat]),turf.point([v[0],originLat]),{units:'meters'});
    const xFt=xM*3.28084*(v[0]>originLng?1:-1);
    const zM=turf.distance(turf.point([originLng,originLat]),turf.point([originLng,v[1]]),{units:'meters'});
    const zFt=zM*3.28084*(v[1]<originLat?1:-1);
    return [Math.round(xFt),Math.round(zFt)];
  });
  let crossSum=0;
  for(let i=0;i<polyVerts.length;i++){
    const j=(i+1)%polyVerts.length;
    crossSum+=(polyVerts[j][0]-polyVerts[i][0])*(polyVerts[j][1]+polyVerts[i][1]);
  }
  if(crossSum<0) polyVerts.reverse();

  const allX=polyVerts.map(v=>v[0]), allZ=polyVerts.map(v=>v[1]);
  const lotWidth=Math.max(...allX)-Math.min(...allX);
  const lotDepth=Math.max(...allZ)-Math.min(...allZ);

  P.lot={
    polyVerts,
    front:lotWidth,
    upperRight:Math.round(lotDepth*0.5),
    stepEast:0,
    lowerRight:Math.round(lotDepth*0.5),
    upperLeft:Math.round(lotDepth*0.7),
    notchWest:0,
    lowerLeft:Math.round(lotDepth*0.3),
    rear:lotWidth,
    gpsVerts:verts.map(v=>[v[0],v[1]])
  };

  // Reset setbacks and volumes for new lot
  P.set={front:10,stepback:3,sideE:12,sideW:4,rear:10};
  P.flr={gf:15,typ:10};
  P.vols=[];

  // Set project name from parcel address (if available)
  const addrName=(attributes.address||'').trim();
  if(addrName&&addrName.length>2){
    P.projectName=addrName;
    P.siteAddress=addrName;
  } else {
    P.projectName='Site at '+P.siteCoords.lat.toFixed(4)+', '+P.siteCoords.lng.toFixed(4);
  }
  const titleEl=document.getElementById('project-title');
  if(titleEl) titleEl.textContent=P.projectName;
  const nameInput=document.getElementById('project-name');
  if(nameInput) nameInput.value=P.projectName;
  document.title='OleaDev — '+P.projectName;

  // Update lot info UI
  smUpdateLotInfo(smLotData);

  // Show attribution toast
  smShowToast('Parcel imported from '+serviceName+' · '+Math.round(areaSqFt).toLocaleString()+' sf','#AEBC46');

  // Auto-detect zoning at parcel centroid - use detectZoningAuto when
  // available so Mississauga (and any future jurisdiction) is supported.
  try{
    var _zoneFn = (typeof window.detectZoningAuto === 'function') ? window.detectZoningAuto : detectZoning;
    _zoneFn(P.siteCoords.lat,P.siteCoords.lng).then(zoning=>{
      P.zoning=zoning;
      if(zoning&&zoning.zone) smShowToast('Zoning detected: '+(zoning.zoneString||zoning.zone),'#4ecdc4');
      const zi=document.getElementById('zoning-info');
      if(zi&&zoning&&zoning.zone){
        zi.style.display='block';
        zi.innerHTML=`
          <div style="color:#4ecdc4;font-weight:700;font-size:11px;margin-bottom:6px">📋 ZONING DETECTED — By-law 569-2013</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
            <div><span style="color:#888">Zone:</span> <b style="color:#AEBC46">${zoning.zoneString||zoning.zone}</b></div>
            <div><span style="color:#888">Max FSI:</span> <b style="color:#AEBC46">${zoning.fsiLimit?zoning.fsiLimit+'×':'Site-specific'}</b></div>
          </div>`;
      }
      autoSave();try{renderReport();}catch(e){}
    }).catch(e=>{console.warn('Zoning detect error:',e);});
  }catch(e){}

  // Fetch comparables
  P.comparables=[];
  try{
    fetchNearbyComparables(P.siteCoords.lat,P.siteCoords.lng,addrName).then(()=>{
      smShowToast('Found '+P.comparables.length+' comparable'+(P.comparables.length!==1?'s':'')+' within 3km','#AEBC46');
      smUpdateCompCount();
    }).catch(e=>console.warn('Comparables error:',e));
  }catch(e){}

  // Reverse geocode for full address
  try{
    fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/'+P.siteCoords.lng+','+P.siteCoords.lat+'.json?access_token='+mapboxgl.accessToken)
      .then(r=>r.json()).then(data=>{
        if(data.features&&data.features.length>0){
          P.siteAddress=data.features[0].place_name||P.siteAddress;
          if(!addrName||addrName.length<3){
            P.projectName=P.siteAddress.split(',')[0]||P.projectName;
            const ti=document.getElementById('project-title');
            if(ti) ti.textContent=P.projectName;
            const ni=document.getElementById('project-name');
            if(ni) ni.value=P.projectName;
            document.title='OleaDev — '+P.projectName;
          }
          smShowAddressBanner(P.siteAddress,P.siteCoords);
          autoSave();try{renderReport();}catch(e){}
        }
      }).catch(()=>{});
  }catch(e){}

  // Rebuild all downstream tabs
  autoSave();
  _pfCache=null;
  try{rebuildAll();}catch(e){}

  const instrEl=document.getElementById('sitemap-instructions');
  if(instrEl) instrEl.innerHTML='Parcel imported from <span style="color:#AEBC46;font-weight:600">'+serviceName+'</span> · <span style="color:#AEBC46;font-weight:600">Draw buildings</span> or <span style="color:#AEBC46;font-weight:600">pick another parcel</span>';
}

// Fetch nearby comparables from multiple sources
async function fetchNearbyComparables(lat,lng,address){
  if(!lat||!lng){console.error('fetchNearbyComparables: no coords!',lat,lng);return;}
  console.log('fetchNearbyComparables START: lat='+lat+' lng='+lng);
  P.comparables=[];

  // ── NAD27 MTM Zone 10 conversion helpers ──
  // Use site coords as reference, fallback to GTA center for NAD27 approximation
  const refLat=lat||43.70, refLng=lng||-79.38, refX=309107+(((lng||-79.38)-(-79.4490))/((1.0/(111000*Math.cos(43.7*Math.PI/180))))), refY=4839363+((lat||43.70)-43.6929)*111000;
  const latPerY=1.0/111000, lngPerX=1.0/(111000*Math.cos(43.7*Math.PI/180));
  const toNAD=([ln,la])=>[refX+(ln-refLng)/lngPerX, refY+(la-refLat)/latPerY];
  const toLL=([x,y])=>[refLng+(x-refX)*lngPerX, refLat+(y-refY)*latPerY];

  // Convert site coords to NAD27 for bounding box search
  const [siteX,siteY]=toNAD([lng,lat]);
  const radiusM=3000; // 3km search radius

  // ── CORS proxies ──
  const corsProxies=['','https://api.allorigins.win/raw?url=','https://corsproxy.io/?'];
  const torontoAPI='https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search';
  const resourceId='8907d8ed-c515-4ce9-b674-9f8c6eefcf0d';

  // ── Helper: fetch one page of results from CKAN (text search + coord filter) ──
  const haversineDist=(lat1,lng1,lat2,lng2)=>{
    const dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
    const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
    return 6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  };
  const parseRecord=(r,existing)=>{
    if(!r.X||!r.Y||!r.DESCRIPTION)return null;
    const rLat=refLat+(parseFloat(r.Y)-refY)*latPerY;
    const rLng=refLng+(parseFloat(r.X)-refX)*lngPerX;
    const dist=haversineDist(lat,lng,rLat,rLng);
    if(dist>3)return null; // within 3km only
    const addr=((r.STREET_NUM||'')+' '+(r.STREET_NAME||'')+' '+(r.STREET_TYPE||'')+' '+(r.STREET_DIRECTION||'')).replace(/\s+/g,' ').trim();
    const addrKey=addr.toLowerCase();
    if(existing.has(addrKey))return null;
    existing.add(addrKey);
    const stMatch=(r.DESCRIPTION||'').match(/(\d+)[-\s]?stor/i);
    const unitMatch=(r.DESCRIPTION||'').match(/([\d,]+)\s*(?:units|dwelling|residential)/i);
    const storeys=stMatch?parseInt(stMatch[1]):0;
    const units=unitMatch?parseInt(unitMatch[1].replace(/,/g,'')):0;
    if(storeys<4&&units<10)return null; // skip small projects
    let status=r.STATUS||'Under Review';
    if(status==='Closed - Constructed'||status==='Complete')status='Built';
    else if(status==='Closed - Not Constructed'||status==='Refused')status='Cancelled';
    else if(status==='Closed')status='Built';
    else if(status==='Final Approval Completed')status='Approved';
    else if(status==='NOAC Issued')status='NOAC Issued';
    else if(status==='OMB Appeal'||status==='OLT Appeal')status='OLT Appeal';
    else if(status.startsWith('Under Review'))status='Under Review';
    let dev='';
    const embMatch=TORONTO_DEV_DB.find(e=>e.addr&&e.addr.toLowerCase()===addrKey);
    if(embMatch){dev=embMatch.dev||'';if(embMatch.arch&&embMatch.arch!=='—')dev+=(dev?' / ':'')+embMatch.arch;}
    return {addr,dev,storeys,units,fsi:'',status,dist:Math.round(dist*1000),desc:r.DESCRIPTION||''};
  };

  // ── Source 1: LIVE City of Toronto Open Data API (preferred) ──
  // Uses datastore_search (text search) since datastore_search_sql is disabled on this CKAN instance.
  // Strategy: Step 1 — determine the ward(s) from a proximity lookup.
  //           Step 2 — fetch records filtered by ward + "storey" text, then spatially filter.
  //           This is efficient because ward filtering narrows ~26k records to ~400-600 per ward.
  let liveResults=[];
  let apiSuccess=false;
  const existing=new Set();

  // Toronto 25-Ward adjacency map (2022 boundaries) — approximate neighbours within 3km reach
  const WARD_NEIGHBOURS={
    'Etobicoke North':['Etobicoke Centre','Humber River-Black Creek','York South-Weston'],
    'Etobicoke Centre':['Etobicoke North','Etobicoke-Lakeshore','York South-Weston','Parkdale-High Park'],
    'Etobicoke-Lakeshore':['Etobicoke Centre','Parkdale-High Park'],
    'Parkdale-High Park':['Etobicoke Centre','Etobicoke-Lakeshore','Davenport','Spadina-Fort York'],
    'York South-Weston':['Etobicoke North','Etobicoke Centre','Humber River-Black Creek','Davenport'],
    'Humber River-Black Creek':['Etobicoke North','York South-Weston','York Centre','Eglinton-Lawrence'],
    'York Centre':['Humber River-Black Creek','Eglinton-Lawrence','Willowdale'],
    'Eglinton-Lawrence':['York Centre','Humber River-Black Creek','Davenport','Toronto-St. Paul\'s'],
    'Davenport':['York South-Weston','Eglinton-Lawrence','Parkdale-High Park','Spadina-Fort York','University-Rosedale','Toronto-St. Paul\'s'],
    'Spadina-Fort York':['Parkdale-High Park','Davenport','University-Rosedale','Toronto Centre'],
    'University-Rosedale':['Davenport','Spadina-Fort York','Toronto Centre','Toronto-St. Paul\'s','Don Valley West'],
    'Toronto-St. Paul\'s':['Eglinton-Lawrence','Davenport','University-Rosedale','Don Valley West'],
    'Toronto Centre':['Spadina-Fort York','University-Rosedale','Toronto-Danforth','Don Valley West','Beaches-East York'],
    'Toronto-Danforth':['Toronto Centre','Don Valley West','Beaches-East York','Don Valley East'],
    'Don Valley West':['Toronto-St. Paul\'s','University-Rosedale','Toronto Centre','Toronto-Danforth','Don Valley North','Don Valley East'],
    'Don Valley East':['Don Valley West','Don Valley North','Toronto-Danforth','Beaches-East York','Scarborough North','Scarborough Centre'],
    'Don Valley North':['Willowdale','Don Valley West','Don Valley East','Scarborough North'],
    'Willowdale':['York Centre','Don Valley North','Scarborough North'],
    'Beaches-East York':['Toronto Centre','Toronto-Danforth','Don Valley East','Scarborough Southwest'],
    'Scarborough Southwest':['Beaches-East York','Don Valley East','Scarborough Centre','Scarborough-Guildwood'],
    'Scarborough Centre':['Don Valley East','Scarborough North','Scarborough Southwest','Scarborough-Guildwood','Scarborough-Agincourt','Scarborough-Rouge Park'],
    'Scarborough North':['Don Valley North','Don Valley East','Scarborough Centre','Scarborough-Agincourt','Willowdale'],
    'Scarborough-Agincourt':['Scarborough North','Scarborough Centre','Scarborough-Rouge Park'],
    'Scarborough-Guildwood':['Scarborough Southwest','Scarborough Centre','Scarborough-Rouge Park'],
    'Scarborough-Rouge Park':['Scarborough-Agincourt','Scarborough Centre','Scarborough-Guildwood']
  };

  // Helper: fetch a page from CKAN via CORS proxy
  const ckanFetch=async(proxy,params)=>{
    const rawUrl=torontoAPI+'?'+params.toString();
    const url=proxy?proxy+encodeURIComponent(rawUrl):rawUrl;
    const resp=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!resp.ok)return null;
    const data=await resp.json();
    return (data.result?data.result:{records:[],total:0});
  };

  for(const proxy of corsProxies){
    try{
      // Step 1: Determine ward from coordinates using Toronto 25-ward centroid lookup
      // Primary method: coordinate-based (reliable, no API call needed)
      // Each entry: [wardName, centroidLat, centroidLng]
      const WARD_CENTROIDS=[
        ['Etobicoke North',43.738,-79.566],['Etobicoke Centre',43.693,-79.537],
        ['Etobicoke-Lakeshore',43.625,-79.510],['Parkdale-High Park',43.646,-79.462],
        ['York South-Weston',43.690,-79.487],['Humber River-Black Creek',43.732,-79.492],
        ['York Centre',43.752,-79.439],['Eglinton-Lawrence',43.714,-79.415],
        ['Davenport',43.672,-79.433],['Spadina-Fort York',43.638,-79.397],
        ['University-Rosedale',43.670,-79.390],['Toronto-St. Paul\'s',43.697,-79.389],
        ['Toronto Centre',43.652,-79.367],['Toronto-Danforth',43.668,-79.340],
        ['Don Valley West',43.700,-79.355],['Don Valley East',43.720,-79.325],
        ['Don Valley North',43.770,-79.345],['Willowdale',43.775,-79.400],
        ['Beaches-East York',43.679,-79.298],['Scarborough Southwest',43.695,-79.260],
        ['Scarborough Centre',43.765,-79.248],['Scarborough North',43.795,-79.290],
        ['Scarborough-Agincourt',43.800,-79.270],['Scarborough-Guildwood',43.738,-79.195],
        ['Scarborough-Rouge Park',43.790,-79.195]
      ];
      let siteWard='',bestWardDist=Infinity;
      WARD_CENTROIDS.forEach(([name,wLat,wLng])=>{
        const d=haversineDist(lat,lng,wLat,wLng);
        if(d<bestWardDist){bestWardDist=d;siteWard=name;}
      });
      console.log('Detected ward:',siteWard,'('+bestWardDist.toFixed(1)+'km from centroid)');

      // Step 2: Build list of wards to search (site ward + neighbours)
      const wardsToSearch=[siteWard,...(WARD_NEIGHBOURS[siteWard]||[])];
      // Deduplicate
      const wardSet=new Set(wardsToSearch);
      let totalFetched=0;

      // Step 3: For each ward, fetch storey-related records and spatially filter
      for(const ward of wardSet){
        for(let offset=0;offset<500;offset+=100){
          const params=new URLSearchParams({
            resource_id:resourceId,limit:'100',offset:String(offset),
            q:'storey',filters:JSON.stringify({WARD_NAME:ward})
          });
          const result=await ckanFetch(proxy,params);
          if(!result||!result.records||result.records.length===0)break;
          totalFetched+=result.records.length;

          result.records.forEach(r=>{
            // Quick NAD27 bounding box pre-filter
            const rx=parseFloat(r.X||0),ry=parseFloat(r.Y||0);
            if(rx<siteX-radiusM||rx>siteX+radiusM||ry<siteY-radiusM||ry>siteY+radiusM)return;
            const parsed=parseRecord(r,existing);
            if(parsed)liveResults.push(parsed);
          });

          if(result.records.length<100)break;
        }
      }

      if(totalFetched>0){
        liveResults.sort((a,b)=>a.dist-b.dist);
        liveResults=liveResults.slice(0,15);
        apiSuccess=true;
        console.log('Toronto API: '+totalFetched+' records from '+wardSet.size+' wards → '+liveResults.length+' significant developments within 3km');
        break; // proxy worked
      }
    }catch(e){
      console.warn('CORS proxy failed:',proxy,e.message);
      continue;
    }
  }

  if(apiSuccess&&liveResults.length>0){
    // Use live data as primary source
    liveResults.forEach(r=>{
      P.comparables.push({
        addr:r.addr, dev:r.dev, storeys:r.storeys, units:r.units,
        fsi:r.fsi, status:r.status
      });
    });

    // Supplement with embedded DB entries not in live results (dev name + architect enrichment)
    const liveAddrs=new Set(P.comparables.map(c=>(c.addr||'').toLowerCase()));
    const embedded=findNearbyComparables(lat,lng,3,10);
    embedded.forEach(c=>{
      const addrKey=(c.addr||'').toLowerCase();
      if(liveAddrs.has(addrKey)){
        // Enrich live entry with embedded dev/arch data
        const liveEntry=P.comparables.find(p=>(p.addr||'').toLowerCase()===addrKey);
        if(liveEntry&&!liveEntry.dev&&c.dev)liveEntry.dev=c.dev;
      } else {
        // Add embedded entry not in live API (may be older/completed project)
        P.comparables.push({
          addr:c.addr, dev:c.dev||'', storeys:c.storeys||0, units:c.units||0,
          fsi:c.gfaM2?((c.gfaM2*10.7639/Math.max(1,lotArea())).toFixed(1)+'×'):'',
          status:c.st||'Under Review'
        });
      }
    });
  } else {
    // API failed — fall back to embedded database
    console.warn('Live API unavailable, using embedded database');
    const embedded=findNearbyComparables(lat,lng,3,12);
    embedded.forEach(c=>{
      P.comparables.push({
        addr:c.addr, dev:c.dev||'', storeys:c.storeys||0, units:c.units||0,
        fsi:c.gfaM2?((c.gfaM2*10.7639/Math.max(1,lotArea())).toFixed(1)+'×'):'',
        status:c.st||'Under Review'
      });
    });
  }

  // If still no comparables, try broader search
  if(P.comparables.length===0){
    const broader=findNearbyComparables(lat,lng,5,15);
    broader.forEach(c=>{
      P.comparables.push({
        addr:c.addr, dev:c.dev||'', storeys:c.storeys||0, units:c.units||0,
        fsi:'', status:c.st||'Under Review'
      });
    });
  }

  autoSave();
  try{renderReport();}catch(e){console.warn('renderReport error:',e);}
  console.log('Comparables search complete:',P.comparables.length,'entries'+(apiSuccess?' (LIVE DATA)':' (EMBEDDED FALLBACK)'));
  try{smUpdateCompCount();}catch(e){}
  try{
    const compBadge=document.getElementById('sm-address-banner');
    if(compBadge&&P.comparables.length>0){
      compBadge.innerHTML+='<div style="margin-top:6px;color:#AEBC46;font-size:11px;font-weight:600">✓ '+P.comparables.length+' comparable developments'+(apiSuccess?' (live data)':' (cached)')+'</div>';
    }
  }catch(e){}
  if(P.comparables.length===0){
    console.warn('NO COMPARABLES FOUND. lat='+lat+' lng='+lng);
  }
}

// ── Toast notification (independent of address banner) ──
function smShowToast(msg,color){
  color=color||'#AEBC46';
  let toast=document.getElementById('sm-toast');
  if(!toast){
    toast=document.createElement('div');
    toast.id='sm-toast';
    toast.style.cssText='position:fixed;bottom:24px;right:24px;z-index:99999;background:#1a1a1a;border:2px solid '+color+';border-radius:8px;padding:12px 20px;font-family:Outfit,DM Sans,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.6);max-width:400px;transition:opacity 0.3s;font-size:12px;color:#eee';
    document.body.appendChild(toast);
  }
  toast.style.borderColor=color;
  toast.style.display='block';
  toast.style.opacity='1';
  toast.innerHTML='<span style="color:'+color+';font-weight:700;margin-right:6px">●</span> '+msg;
  clearTimeout(toast._timer);
  toast._timer=setTimeout(()=>{toast.style.opacity='0';setTimeout(()=>{toast.style.display='none';},400);},5000);
}

// ── Update comparables count on Site Map panel ──
function smUpdateCompCount(){
  let el=document.getElementById('sm-comp-count');
  if(!el){
    const lotInfo=document.getElementById('sitemap-lot-info');
    if(!lotInfo)return;
    el=document.createElement('div');
    el.id='sm-comp-count';
    el.style.cssText='margin-top:8px;padding:8px 10px;background:#1a2a1a;border:1px solid #AEBC46;border-radius:6px;font-size:11px';
    lotInfo.appendChild(el);
  }
  const n=(P.comparables||[]).length;
  if(n>0){
    el.style.display='block';
    el.innerHTML='<span style="color:#AEBC46;font-weight:700">📊 '+n+' Comparable'+(n!==1?'s':'')+' Found</span><br><span style="color:#888;font-size:10px">View in REPORT tab · Auto-saved</span>';
  } else {
    el.style.display='block';
    el.innerHTML='<span style="color:#888">No comparables found nearby</span>';
  }
}

// Show detected address banner on the map
function smShowAddressBanner(address, coords){
  let banner=document.getElementById('sm-address-banner');
  if(!banner){
    banner=document.createElement('div');
    banner.id='sm-address-banner';
    banner.style.cssText='position:absolute;top:50px;left:10px;right:10px;z-index:100;background:#1a1a1a;border:2px solid #AEBC46;border-radius:8px;padding:12px 16px;font-family:Outfit,DM Sans,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
    const mapWrap=document.getElementById('sitemap-map');
    if(mapWrap) mapWrap.parentNode.style.position='relative';
    (mapWrap?mapWrap.parentNode:document.body).appendChild(banner);
  }
  banner.style.display='block';
  banner.innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="color:#AEBC46;font-size:9px;font-weight:700;letter-spacing:2px;margin-bottom:4px">📍 SITE LOCATION DETECTED</div>
        <div style="color:#eee;font-size:13px;font-weight:600">${address}</div>
        <div style="color:#888;font-size:10px;margin-top:2px">Lat: ${coords.lat.toFixed(5)} · Lng: ${coords.lng.toFixed(5)}</div>
        <div style="color:#4ecdc4;font-size:10px;margin-top:4px">✓ Coordinates locked — comparables will search near this location</div>
      </div>
      <button onclick="document.getElementById('sm-address-banner').style.display='none'" style="background:none;border:1px solid #555;color:#888;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:10px;flex-shrink:0;margin-left:12px">✕ Dismiss</button>
    </div>
  `;
  // Auto-dismiss after 8 seconds
  setTimeout(()=>{if(banner)banner.style.display='none';},8000);
}

// Auto-sync map volumes → 3D massing + pro-forma + report (debounced)
let _smSyncTimer=null;
function smAutoSync(){
  smUpdateVolStats();
  clearTimeout(_smSyncTimer);
  _smSyncTimer=setTimeout(()=>{
    if(!smLotData)return;
    // Sync lot polygon
    const verts=smLotData.vertices;
    let originIdx=0;
    verts.forEach((v,i)=>{ if(v[1]>verts[originIdx][1]) originIdx=i; });
    const originLng=verts[originIdx][0], originLat=verts[originIdx][1];
    const polyVerts=verts.map(v=>{
      const xM=turf.distance(turf.point([originLng,originLat]),turf.point([v[0],originLat]),{units:'meters'});
      const xFt=xM*3.28084*(v[0]>originLng?1:-1);
      const zM=turf.distance(turf.point([originLng,originLat]),turf.point([originLng,v[1]]),{units:'meters'});
      const zFt=zM*3.28084*(v[1]<originLat?1:-1);
      return [Math.round(xFt), Math.round(zFt)];
    });
    let crossSum=0;
    // ───────────────────────────────────────────────────────────────
    // NOTE: The original sitemap.js source was truncated here in the
    // middle of smAutoSync. Everything after `let crossSum=0;` — which
    // likely completed a signed-area / winding-order calculation, then
    // wrote normalised lot verts to P.lot.polyVerts and synced volume
    // positions from GPS back to local (feet) coords — was never present
    // in the committed source. This early return makes the file parse
    // so the rest of the app loads cleanly. TODO: restore the full body
    // from an uncorrupted copy of sitemap.js.
    // ───────────────────────────────────────────────────────────────
    void crossSum; // suppress unused-var in case of future linting
    return;
  }, 300);
}

// ═══════════════════════════════════════════════════════════════════════════════════
//  PARCEL EDIT MODE — drag vertices/edges, snap to neighbours, insert vertices
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Architecture:
//   • smParcelEditMode flag indicates edit mode is active
//   • smParcelEditMarkers — array of { type:'vertex'|'edge'|'insert', parcelIdx, vertexIdx, marker }
//   • smParcelEditHistory — undo stack: array of deep snapshots of all parcel ringCoords
//   • Snap distance: 5 ft (~1.524 m) — vertex moves snap to vertices/edges of OTHER selected
//     parcels and surrounding city parcels (whatever's queryable on the map)
//
// Workflow:
//   1. User clicks EDIT PARCELS — toggles smParcelEditMode on
//   2. For each selected parcel, render:
//        • Vertex handles (solid colored circles, draggable)
//        • Edge handles (smaller hollow squares at midpoints, draggable to translate edge)
//        • Insert handles (tiny "+" plus signs at edge midpoints — click to add vertex)
//   3. While dragging, snap to nearest vertex/edge of any other parcel within tolerance
//   4. On dragend, push to undo stack and refresh markers
//   5. User clicks EDIT PARCELS again (now reads "DONE EDITING") — exit edit mode
//   6. MERGE & APPLY uses the EDITED ringCoords (no extra step needed — the existing
//      merge logic already reads ringCoords)

let smParcelEditMode = false;
let smParcelEditMarkers = [];
let smParcelEditHistory = [];   // each entry: deep clone of all parcels' ringCoords
const SM_PARCEL_SNAP_FT = 5;    // snap if within this many feet
const SM_PARCEL_SNAP_M  = SM_PARCEL_SNAP_FT * 0.3048;
const SM_PARCEL_SNAP_PX = 15;   // pixel-based snap threshold (zoom-independent)

/** Pixel-distance between two [lng,lat] points using Mapbox project(). */
function _snapDistPx(a, b){
  if(!smMap) return Infinity;
  var sa = smMap.project(a);
  var sb = smMap.project(b);
  var dx = sa.x - sb.x, dy = sa.y - sb.y;
  return Math.sqrt(dx*dx + dy*dy);
}

/**
 * Toggle parcel-edit mode on/off. When ON: vertex + edge + insert handles
 * appear on every selected parcel; user can drag/click to reshape; edits
 * snap to neighbouring parcel boundaries within ~5 ft.
 */
function smToggleParcelEditMode(){
  if(!smMap){ smShowToast('Map not ready', '#c44'); return; }
  if(!smSelectedParcels || smSelectedParcels.length === 0){
    smShowToast('Pick at least one parcel first', '#c44'); return;
  }
  if(smParcelEditMode){ smExitParcelEditMode(); return; }

  smParcelEditMode = true;
  smParcelEditHistory = [];
  smPushParcelEditHistory(); // baseline snapshot for first undo

  const btn = document.getElementById('btn-edit-parcels');
  if(btn){
    btn.textContent = '✓ DONE EDITING';
    btn.style.background = '#AEBC46';
    btn.style.color = '#111';
  }
  const undoBtn = document.getElementById('btn-undo-parcel-edit');
  if(undoBtn){ undoBtn.style.display = 'inline-block'; }

  const instrEl = document.getElementById('sitemap-instructions');
  if(instrEl){
    instrEl.innerHTML = '<b style="color:#AEBC46">EDIT MODE</b> — drag vertices (circles) or edges (squares) · double-click a square to add a vertex · linked vertices move together';
  }

  smRenderParcelEditMarkers();
}

function smExitParcelEditMode(){
  smParcelEditMode = false;
  smClearParcelEditMarkers();
  smParcelEditHistory = [];

  const btn = document.getElementById('btn-edit-parcels');
  if(btn){
    btn.textContent = '✎ EDIT PARCELS';
    btn.style.background = '#444';
    btn.style.color = '#AEBC46';
  }
  const undoBtn = document.getElementById('btn-undo-parcel-edit');
  if(undoBtn){ undoBtn.style.display = 'none'; }

  const instrEl = document.getElementById('sitemap-instructions');
  if(instrEl){
    const c = smSelectedParcels.length;
    instrEl.innerHTML = c > 1 ? c + ' parcels selected — click <b style="color:#AEBC46">MERGE & APPLY</b> when ready' : '1 parcel selected — click <b style="color:#AEBC46">APPLY PARCEL</b>';
  }

  // Update the parcel area totals + preview after potentially-edited rings
  smRecalcParcelAreas();
  smRenderMultiParcelPreview();
  smUpdateMultiParcelUI();
}

function smClearParcelEditMarkers(){
  smParcelEditMarkers.forEach(m => { try { m.marker.remove(); } catch(e){} });
  smParcelEditMarkers = [];
}

function smPushParcelEditHistory(){
  // Snapshot current ringCoords of every selected parcel — for undo
  const snap = smSelectedParcels.map(p => p.ringCoords.map(v => [v[0], v[1]]));
  smParcelEditHistory.push(snap);
  // Cap history at 30 entries (memory)
  if(smParcelEditHistory.length > 30) smParcelEditHistory.shift();
}

function smUndoParcelEdit(){
  if(!smParcelEditMode){ smShowToast('Enter Edit mode first', '#c44'); return; }
  if(smParcelEditHistory.length <= 1){
    smShowToast('Nothing to undo', '#888');
    return;
  }
  smParcelEditHistory.pop(); // remove current state
  const prev = smParcelEditHistory[smParcelEditHistory.length - 1];
  prev.forEach((ring, i) => {
    if(smSelectedParcels[i]) smSelectedParcels[i].ringCoords = ring.map(v => [v[0], v[1]]);
  });
  smRefreshSelectedParcelGeoms();
  smRenderMultiParcelPreview();
  smRenderParcelEditMarkers();
}

/**
 * Re-build geojsonFeature from the (possibly edited) ringCoords for every
 * selected parcel. Called after any vertex/edge/insert edit.
 */
function smRefreshSelectedParcelGeoms(){
  smSelectedParcels.forEach(p => {
    if(!p.ringCoords || p.ringCoords.length < 3) return;
    const closed = p.ringCoords.slice();
    if(closed[0][0] !== closed[closed.length-1][0] || closed[0][1] !== closed[closed.length-1][1]){
      closed.push([closed[0][0], closed[0][1]]);
    }
    try { p.geojsonFeature = turf.polygon([closed]); } catch(e){}
  });
}

function smRecalcParcelAreas(){
  smSelectedParcels.forEach(p => {
    if(p.geojsonFeature){
      try { p.areaSqFt = turf.area(p.geojsonFeature) * 10.7639; } catch(e){}
    }
  });
}

/**
 * Snap a candidate point [lng,lat] to nearby parcel features. Returns the
 * snapped point (or original if nothing in range). Considers vertices and
 * edges of every OTHER selected parcel.
 *
 * @param {[number,number]} pt — candidate position in [lng,lat]
 * @param {number} excludeParcelIdx — index in smSelectedParcels to skip (the one being edited)
 * @returns {[number,number]} snapped or original point
 */
function smSnapToNeighbours(pt, excludeParcelIdx){
  let bestPt = pt;
  let bestD  = Infinity;

  // Pass 1 — vertex-to-vertex (pixel-based threshold for zoom independence)
  smSelectedParcels.forEach((p, pi) => {
    if(pi === excludeParcelIdx) return;
    p.ringCoords.forEach(v => {
      const d = _snapDistPx(pt, v);
      if(d < bestD && d < SM_PARCEL_SNAP_PX){
        bestD = d; bestPt = [v[0], v[1]];
      }
    });
  });
  if(bestPt !== pt) return bestPt; // prefer vertex snap over edge snap

  // Pass 2 — vertex-to-edge (pixel-based)
  smSelectedParcels.forEach((p, pi) => {
    if(pi === excludeParcelIdx) return;
    const ring = p.ringCoords;
    for(let j = 0; j < ring.length; j++){
      const nj = (j + 1) % ring.length;
      const cp = _closestPointOnSegment(pt, ring[j], ring[nj]);
      const dpx = _snapDistPx(pt, cp.point);
      if(dpx < bestD && dpx < SM_PARCEL_SNAP_PX){
        bestD = dpx; bestPt = cp.point;
      }
    }
  });
  return bestPt;
}

/**
 * Render all edit handles (vertex / edge-midpoint-drag / vertex-insert)
 * for every selected parcel. Removes any existing markers first.
 */
function smRenderParcelEditMarkers(){
  smClearParcelEditMarkers();
  if(!smParcelEditMode) return;

  const colors = ['#AEBC46','#4ecdc4','#ff9966','#b088cc','#e8c87a','#66bbff','#ff6b9d','#7bed9f'];

  smSelectedParcels.forEach((parcel, pi) => {
    const col = colors[pi % colors.length];
    const ring = parcel.ringCoords;

    // ── Vertex drag handles ──
    ring.forEach((v, vi) => {
      const el = document.createElement('div');
      el.style.cssText = 'width:14px;height:14px;background:'+col+';border:2.5px solid #fff;border-radius:50%;cursor:grab;box-shadow:0 1px 4px rgba(0,0,0,0.6);box-sizing:border-box';
      el.title = 'Drag vertex (linked vertices from adjacent parcels move together)';
      const m = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
        .setLngLat(v)
        .addTo(smMap);

      // Linked-vertex system: when dragging, coincident vertices from other parcels move together
      let linkedVerts = null; // [{parcelIdx, vertexIdx}] — detected on dragstart

      m.on('dragstart', () => {
        // Find all vertices from OTHER parcels at the same position (within snap pixel threshold)
        linkedVerts = [];
        const myPos = parcel.ringCoords[vi];
        smSelectedParcels.forEach((op, opi) => {
          if(opi === pi) return;
          op.ringCoords.forEach((ov, ovi) => {
            if(_snapDistPx(myPos, ov) < SM_PARCEL_SNAP_PX){
              linkedVerts.push({parcelIdx: opi, vertexIdx: ovi});
            }
          });
        });
      });

      m.on('drag', () => {
        const ll = m.getLngLat();
        // Snap to neighbour parcels (excluding own parcel AND linked parcels)
        const snapped = smSnapToNeighbours([ll.lng, ll.lat], pi);
        const didSnap = (snapped[0] !== ll.lng || snapped[1] !== ll.lat);
        const finalPos = didSnap ? snapped : [ll.lng, ll.lat];
        if(didSnap) m.setLngLat(snapped);

        // Update this vertex
        parcel.ringCoords[vi] = [finalPos[0], finalPos[1]];
        smLiveRedrawParcelOnly(pi);

        // Move all linked (coincident) vertices from other parcels
        if(linkedVerts && linkedVerts.length > 0){
          linkedVerts.forEach(lv => {
            smSelectedParcels[lv.parcelIdx].ringCoords[lv.vertexIdx] = [finalPos[0], finalPos[1]];
            smLiveRedrawParcelOnly(lv.parcelIdx);
          });
          // Also reposition their markers so they visually follow
          smParcelEditMarkers.forEach(em => {
            if(em.type !== 'vertex') return;
            for(let li = 0; li < linkedVerts.length; li++){
              if(em.parcelIdx === linkedVerts[li].parcelIdx && em.vertexIdx === linkedVerts[li].vertexIdx){
                em.marker.setLngLat(finalPos);
                break;
              }
            }
          });
        }
      });

      m.on('dragend', () => {
        linkedVerts = null;
        smPushParcelEditHistory();
        smRefreshSelectedParcelGeoms();
        smRecalcParcelAreas();
        smUpdateMultiParcelUI();
        // Re-render markers so edge midpoints update to new positions
        smRenderParcelEditMarkers();
      });

      smParcelEditMarkers.push({ type:'vertex', parcelIdx:pi, vertexIdx:vi, marker:m });
    });

    // ── Edge midpoint drag handles (translate entire edge) ──
    for(let i = 0; i < ring.length; i++){
      const j = (i + 1) % ring.length;
      const a = ring[i], b = ring[j];
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

      const el = document.createElement('div');
      el.style.cssText = 'width:11px;height:11px;background:transparent;border:2px solid '+col+';border-radius:2px;cursor:move;box-shadow:0 1px 3px rgba(0,0,0,0.6);box-sizing:border-box';
      el.title = 'Drag to move edge · Double-click to insert vertex here';
      const m = new mapboxgl.Marker({ element: el, draggable: true, anchor: 'center' })
        .setLngLat(mid)
        .addTo(smMap);

      // Capture starting positions of the two endpoints
      const startA = [a[0], a[1]];
      const startB = [b[0], b[1]];
      const startMid = [mid[0], mid[1]];

      m.on('drag', () => {
        const ll = m.getLngLat();
        // Compute delta from drag start
        let dLng = ll.lng - startMid[0];
        let dLat = ll.lat - startMid[1];
        // Tentative new endpoints
        let newA = [startA[0] + dLng, startA[1] + dLat];
        let newB = [startB[0] + dLng, startB[1] + dLat];
        // Snap each endpoint independently
        const snapA = smSnapToNeighbours(newA, pi);
        const snapB = smSnapToNeighbours(newB, pi);
        // If only A snapped, use A's snap delta and adjust B to maintain the original edge geometry
        // (preferring snap-A wins so the edge stays attached to the neighbour)
        const aSnapped = (snapA[0] !== newA[0] || snapA[1] !== newA[1]);
        const bSnapped = (snapB[0] !== newB[0] || snapB[1] !== newB[1]);
        if(aSnapped && !bSnapped){
          const adjLng = snapA[0] - startA[0];
          const adjLat = snapA[1] - startA[1];
          newA = snapA;
          newB = [startB[0] + adjLng, startB[1] + adjLat];
          dLng = adjLng; dLat = adjLat;
        } else if(bSnapped && !aSnapped){
          const adjLng = snapB[0] - startB[0];
          const adjLat = snapB[1] - startB[1];
          newB = snapB;
          newA = [startA[0] + adjLng, startA[1] + adjLat];
          dLng = adjLng; dLat = adjLat;
        } else if(aSnapped && bSnapped){
          // Both snapped — accept (edge may rotate slightly to align with neighbour vertices)
          newA = snapA; newB = snapB;
        }
        parcel.ringCoords[i] = newA;
        parcel.ringCoords[j] = newB;
        m.setLngLat([(newA[0] + newB[0])/2, (newA[1] + newB[1])/2]);
        smLiveRedrawParcelOnly(pi);
      });
      m.on('dragend', () => {
        smPushParcelEditHistory();
        smRefreshSelectedParcelGeoms();
        smRecalcParcelAreas();
        smUpdateMultiParcelUI();
        smRenderParcelEditMarkers();
      });

      // Double-click edge handle → insert a new vertex at the midpoint
      const insertIdx = i;
      el.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        const newMid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const snapped = smSnapToNeighbours(newMid, pi);
        parcel.ringCoords.splice(insertIdx + 1, 0, snapped);
        smPushParcelEditHistory();
        smRefreshSelectedParcelGeoms();
        smRecalcParcelAreas();
        smUpdateMultiParcelUI();
        smLiveRedrawParcelOnly(pi);
        smRenderParcelEditMarkers();
      });

      smParcelEditMarkers.push({ type:'edge', parcelIdx:pi, edgeIdx:i, marker:m });
    }
  });
}

/**
 * Update only one parcel's preview source (during drag, no flicker on others).
 * Called continuously during drag for smooth visual feedback.
 */
function smLiveRedrawParcelOnly(pi){
  if(!smMap) return;
  const p = smSelectedParcels[pi];
  if(!p) return;
  const ring = p.ringCoords.slice();
  if(ring.length < 3) return;
  if(ring[0][0] !== ring[ring.length-1][0] || ring[0][1] !== ring[ring.length-1][1]){
    ring.push([ring[0][0], ring[0][1]]);
  }
  const feat = { type:'Feature', geometry:{ type:'Polygon', coordinates:[ring] }, properties:{} };
  const sid = 'sm-multi-parcel-' + pi;
  try {
    if(smMap.getSource(sid)) smMap.getSource(sid).setData(feat);
  } catch(e){}
}
