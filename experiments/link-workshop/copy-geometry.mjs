import * as T from '../../lib/three.core.js';
import {bodyLayout,constructBodies} from './bodies.mjs';
import {frames} from './model.mjs';

// Reflect geometry across an assembly-local plane parallel to the linkage XY
// plane. This reflection commutes with every authored planar body motion, so
// copies remain in their original body slots and share that body's actuation.
export function mirrorBodyGeometry(packet,{planeZ,selections,positions}){
 if(!Number.isFinite(planeZ))throw Error('Finite mirror plane required');
 if(packet?.schema!=='kaminos.assembly-geometry.v1'||!Array.isArray(packet.bodies)||!Array.isArray(selections)||!selections.length)throw Error('Choose body geometry to mirror');
 const result=structuredClone(packet),byId=new Map(result.bodies.map(b=>[b.id,b])),seen=new Set();
 for(const selection of selections){
  const item=byId.get(selection.id);if(!item||seen.has(selection.id))throw Error('Unknown or repeated body selection');seen.add(selection.id);
  const z=positions?.[selection.id];if(!Number.isFinite(z))throw Error('Body position required for mirror plane');
  const object=new T.ObjectLoader().parse(item.object);object.updateMatrixWorld(true);
  const chosen=[];object.traverse(o=>{if(o.isMesh&&(!selection.names||selection.names.includes(o.name)))chosen.push(o);});
  if(!chosen.length||selection.names?.some(name=>!chosen.some(o=>o.name===name)))throw Error('Empty or missing shape selection');
  const reflection=new T.Matrix4().makeScale(1,1,-1);reflection.setPosition(0,0,2*(planeZ-z));
  const group=new T.Group();group.name='Mirrored shapes';
  for(const source of chosen){
   const geometry=source.geometry.clone();geometry.applyMatrix4(reflection.clone().multiply(source.matrixWorld));
   // Bake the reflection, including winding, so consumers need no negative-scale support.
   const index=geometry.index;if(index){for(let i=0;i<index.count;i+=3){const b=index.getX(i+1);index.setX(i+1,index.getX(i+2));index.setX(i+2,b);}index.needsUpdate=true;}
   else {const indices=[];for(let i=0;i<geometry.attributes.position.count;i+=3)indices.push(i,i+2,i+1);geometry.setIndex(indices);}
   const tangent=geometry.attributes.tangent;if(tangent)for(let i=0;i<tangent.count;i++)tangent.setW(i,-tangent.getW(i));
   const mesh=new T.Mesh(geometry,source.material);mesh.name='Mirror: '+(source.name||source.uuid);mesh.castShadow=source.castShadow;mesh.receiveShadow=source.receiveShadow;mesh.userData={...source.userData,mirrorSource:source.name||source.uuid};group.add(mesh);
  }
  for(const mesh of group.children)if(mesh.userData.copyPart)mesh.userData.copyPart=group.uuid+':'+mesh.userData.copyPart;
  object.add(group);object.updateMatrixWorld(true);item.object=object.toJSON();
  const gs=new Set(),ms=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();
 }
 return result;
}

export function bodySpanLength(packet,id,fallback=0){
 const item=packet?.bodies?.find(b=>b.id===id);if(!item)return fallback;
 const object=new T.ObjectLoader().parse(item.object);object.updateMatrixWorld(true);
 const box=new T.Box3().setFromObject(object);
 const gs=new Set(),ms=new Set();object.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)ms.add(m);});for(const g of gs)g.dispose();for(const m of ms)m.dispose();
 if(box.isEmpty())return fallback;
 const span=Number(Math.max(fallback,box.max.x-0.02).toFixed(4));
 return span>fallback*1.15?span:fallback;
}

function refreshClevisMeshes(obj,def){
 for(const child of [...obj.children]){
  if(child.userData?.copyPart==='clevis-lug')obj.remove(child);
  else if(child.name==='Mirrored shapes'){
   for(const m of [...child.children])if(m.userData?.mirrorSource==='Clevis bracket'||m.userData?.mirrorSource==='Clevis pin eye')child.remove(m);
   if(!child.children.length)obj.remove(child);
  }
 }
 const names=[];
 for(const child of def.object.children)if(child.userData?.copyPart==='clevis-lug'){const c=child.clone(true);obj.add(c);if(c.name)names.push(c.name);}
 return [...new Set(names)];
}

export function sectionBodyGeometry(packet,{oldRecipe,nextRecipe,joint,destinationJoint=joint,count,nodeMap=null,mirrorPlaneZ=-1.3}){
 if(!packet?.bodies?.length)return {schema:'kaminos.assembly-geometry.v1',bodies:[]};
 const extra=count-1,mapNode=nodeMap??(i=>i>joint?i+extra:i);
 const oldLayout=bodyLayout(oldRecipe),freshLayout=bodyLayout(nextRecipe);
 const fresh=constructBodies(nextRecipe),freshById=new Map(fresh.defs.map(d=>[d.id,d]));
 const oldById=new Map(packet.bodies.map(b=>[b.id,b]));
 const hasMirror=packet.bodies.some(b=>JSON.stringify(b.object).includes('Mirrored shapes'));
 const out=new Map(),mirrorSelections=[];
 const serialize=object=>{object.position.set(0,0,0);object.quaternion.identity();object.scale.set(1,1,1);object.updateMatrixWorld(true);return object.toJSON();};

 // 1. Carry over non-sectioned anchors and links (remapping node indices and syncing clevis lugs)
 for(const item of packet.bodies){
  const mAnchor=item.id.match(/^anchor:(\d+)$/),mLink=item.id.match(/^link:(\d+)$/),mPin=item.id.match(/^pin:(\d+)$/);
  if(mAnchor){
   const mapped=mapNode(Number(mAnchor[1]));if(mapped===null||mapped===undefined)continue;
   const newId=`anchor:${mapped}`,def=freshById.get(newId);
   if(def){
    const obj=new T.ObjectLoader().parse(item.object),clevisNames=refreshClevisMeshes(obj,def);
    out.set(newId,{id:newId,geometryKey:def.geometryKey,object:serialize(obj)});
    if(hasMirror&&clevisNames.length)mirrorSelections.push({id:newId,names:clevisNames});
   }
  }else if(mLink&&Number(mLink[1])!==joint){
   const mapped=mapNode(Number(mLink[1]));if(mapped===null||mapped===undefined)continue;
   const newId=`link:${mapped}`,def=freshById.get(newId);
   if(def){
    const obj=new T.ObjectLoader().parse(item.object),clevisNames=refreshClevisMeshes(obj,def);
    out.set(newId,{id:newId,geometryKey:def.geometryKey,object:serialize(obj)});
    if(hasMirror&&clevisNames.length)mirrorSelections.push({id:newId,names:clevisNames});
   }
  }else if(mPin&&Number(mPin[1])!==joint){
   const mapped=mapNode(Number(mPin[1]));if(mapped===null||mapped===undefined)continue;
   const newId=`pin:${mapped}`,def=freshById.get(newId);
   if(def)out.set(newId,{id:newId,geometryKey:def.geometryKey,object:item.object});
  }
 }

 // 2. Split replacement geometry on link:${joint} across link:${joint .. joint+count-1}
 const sourceLink=oldById.get(`link:${joint}`);
 if(sourceLink){
  const srcObj=new T.ObjectLoader().parse(sourceLink.object);srcObj.updateMatrixWorld(true);
  const bronze=new T.MeshStandardMaterial({color:0xb28a52,metalness:.6,roughness:.42});
  const panelTemplates=[],hingeTemplates=[];
  for(const child of srcObj.children){
   if(child.name==='Mirrored shapes'||child.userData?.copyPart==='operating-lever'||child.userData?.copyPart==='clevis-lug')continue;
   const b=new T.Box3().setFromObject(child),size=b.getSize(new T.Vector3()),center=b.getCenter(new T.Vector3());
   if(size.x>nextRecipe.nodes[destinationJoint].length*1.05)panelTemplates.push({child,size,center});
   else if(center.x<nextRecipe.nodes[destinationJoint].length*0.6)hingeTemplates.push(child);
  }
  for(let s=0;s<count;s++){
   const nodeId=destinationJoint+s,newId=`link:${nodeId}`,def=freshById.get(newId),segLen=nextRecipe.nodes[nodeId].length;
   const dz=(oldLayout.layers[joint]??0)-(freshLayout.layers[nodeId]??0);
   const group=def.object.clone(true);group.name=`Door section ${s+1}`;
   const copyNames=[];
   for(const child of group.children){
    if(!child.userData?.copyPart){child.name='Side operating lever';child.userData.copyPart='operating-lever';child.material=bronze;}
    if(child.name)copyNames.push(child.name);
   }
   for(const h of hingeTemplates){const hc=h.clone(true);hc.position.z+=dz;group.add(hc);}
   for(const {child,size,center}of panelTemplates){
    const m=new T.Mesh(new T.BoxGeometry(Math.max(0.08,segLen-0.025),size.y,size.z),child.material.clone());
    m.name=`${child.name} (section ${s+1})`;
    m.position.set(segLen/2,center.y,center.z+dz);
    m.castShadow=child.castShadow;m.receiveShadow=child.receiveShadow;
    group.add(m);
   }
   out.set(newId,{id:newId,geometryKey:def.geometryKey,object:serialize(group)});
   if(hasMirror&&copyNames.length)mirrorSelections.push({id:newId,names:[...new Set(copyNames)]});
  }
 }

 // 3. Update pins and clevis-solved pistons (and mirror them if the assembly was mirrored)
 if(hasMirror){
  for(let s=0;s<count;s++){
   const pinId=`pin:${destinationJoint+s}`,def=freshById.get(pinId);
   if(def){out.set(pinId,{id:pinId,geometryKey:def.geometryKey,object:serialize(def.object.clone(true))});mirrorSelections.push({id:pinId});}
  }
  nextRecipe.pistons.forEach((_,j)=>{
   for(const part of ['barrel','rod']){
    const pid=`piston:${j}:${part}`,def=freshById.get(pid);
    if(def){out.set(pid,{id:pid,geometryKey:def.geometryKey,object:serialize(def.object.clone(true))});mirrorSelections.push({id:pid});}
   }
  });
 }

 let result={schema:'kaminos.assembly-geometry.v1',bodies:[...out.values()]};
 if(hasMirror&&mirrorSelections.length){
  const f0=frames(nextRecipe,0),positions=Object.fromEntries(fresh.defs.map(d=>[d.id,d.pose(f0).position[2]]));
  result=mirrorBodyGeometry(result,{planeZ:mirrorPlaneZ,selections:mirrorSelections,positions});
 }
 for(const d of fresh.defs)d.object.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});
 return result;
}

const baseGeometryKey=key=>{try{const [kind,params]=JSON.parse(key);return JSON.stringify([kind,kind==='link'?params.slice(0,5):params.slice(0,3)]);}catch{return key;}};

export function resyncBodyGeometry(packet,nextRecipe,mirrorPlaneZ=-1.3){
 if(!packet?.bodies?.length)return packet;
 const fresh=constructBodies(nextRecipe),freshById=new Map(fresh.defs.map(d=>[d.id,d]));
 const hasMirror=packet.bodies.some(b=>JSON.stringify(b.object).includes('Mirrored shapes'));
 const out=new Map(),mirrorSelections=[];
 const serialize=object=>{object.position.set(0,0,0);object.quaternion.identity();object.scale.set(1,1,1);object.updateMatrixWorld(true);return object.toJSON();};
 for(const item of packet.bodies){
  const def=freshById.get(item.id);if(!def)continue;
  if(item.id.startsWith('anchor:')||item.id.startsWith('link:')){
   if(baseGeometryKey(item.geometryKey)!==baseGeometryKey(def.geometryKey)){out.set(item.id,item);continue;}
   const obj=new T.ObjectLoader().parse(item.object),clevisNames=refreshClevisMeshes(obj,def);
   out.set(item.id,{id:item.id,geometryKey:def.geometryKey,object:serialize(obj)});
   if(hasMirror&&clevisNames.length)mirrorSelections.push({id:item.id,names:clevisNames});
  }else if(item.id.startsWith('pin:')){
   out.set(item.id,{id:item.id,geometryKey:def.geometryKey,object:item.object});
  }else if(!hasMirror){
   out.set(item.id,item);
  }
 }
 if(hasMirror){
  nextRecipe.pistons.forEach((_,j)=>{
   for(const part of ['barrel','rod']){
    const pid=`piston:${j}:${part}`,def=freshById.get(pid);
    if(def){out.set(pid,{id:pid,geometryKey:def.geometryKey,object:serialize(def.object.clone(true))});mirrorSelections.push({id:pid});}
   }
  });
 }
 let result={schema:'kaminos.assembly-geometry.v1',bodies:[...out.values()]};
 if(hasMirror&&mirrorSelections.length){
  const f0=frames(nextRecipe,0),positions=Object.fromEntries(fresh.defs.map(d=>[d.id,d.pose(f0).position[2]]));
  result=mirrorBodyGeometry(result,{planeZ:mirrorPlaneZ,selections:mirrorSelections,positions});
 }
 for(const d of fresh.defs)d.object.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});
 return result;
}
