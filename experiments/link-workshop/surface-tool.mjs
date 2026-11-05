import * as T from '../../lib/three.core.js';
import {frames,pistonMountPoint} from './model.mjs';
import {surfaceBounds} from './surface.mjs';

// Guides are ordinary selectable Kaminos objects; the same transforms feed API calls.
export function createSurfaceTool({root,view,host,win,session,relatedAssets,ensure,getModel,getFraction,getSelected}){
 let draft=null,closed=false,anatomy=true,lastOverlay=null;const overlay=new T.Group();overlay.userData.kaminosEditorOnly=true;overlay.userData.mechanismOverlay=true;root.add(overlay);
 const lines=new Map(),labels=new Map(),edges=new Map();
 function release(object){if(!object)return;if(!object.isSprite)object.geometry?.dispose();object.material?.map?.dispose();object.material?.dispose();object.removeFromParent();}
 function prune(pool,keep){for(const [key,value]of pool)if(!keep.has(key)){release(value?.object??value);pool.delete(key);}}
 const worldOf=id=>{root.updateWorldMatrix(true,true);const b=view.bodyManifest().bodies.find(b=>b.id===id);if(!b)throw Error('Body no longer exists');return root.matrixWorld.clone().multiply(new T.Matrix4().compose(new T.Vector3(...b.position),new T.Quaternion(...b.quaternion),new T.Vector3(1,1,1)));};
 async function clear(){const old=draft;draft=null;if(old){for(const a of old.guides){const i=relatedAssets.indexOf(a.asset);if(i>=0)relatedAssets.splice(i,1);}await old.session.dispose();}session.redraw();}
 async function preview(joint){ensure();if(getModel().nodes[joint]?.parent===null||!getModel().nodes[joint])throw Error('Select a movable surface first');await clear();const id=`link:${joint}`,geometry=view.exportBodies(),bounds=surfaceBounds(geometry,id),length=bounds.max.x,world=worldOf(id),owned=await host.scene.open(),guides=[];
  try{for(const [i,f]of [.4,.7].entries()){const mesh=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({color:i?0xf1bd65:0x63e4dc,transparent:true,opacity:.25,side:T.DoubleSide,depthWrite:false}));mesh.name=`Seam ${i+1} · G moves across surface`;mesh.userData.kaminosEditorOnly=true;const local=new T.Matrix4().compose(new T.Vector3(length*f,(bounds.min.y+bounds.max.y)/2,(bounds.min.z+bounds.max.z)/2),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2),new T.Vector3(Math.max(bounds.max.z-bounds.min.z,.4)*1.15,Math.max(bounds.max.y-bounds.min.y,.4)*1.5,1));world.clone().multiply(local).decompose(mesh.position,mesh.quaternion,mesh.scale);const asset=await owned.attach(mesh,{owned:true,metadata:{label:mesh.name,type:'experiment',source:'experiment:surface-seam'}});guides.push({asset,mesh});relatedAssets.push(asset);}
   ensure();if(closed)throw Error('Surface tool closed');draft={joint,id,session:owned,guides,identity:JSON.stringify(getModel()),sourceWorld:world,meshes:view.bodyMeshes(id).map(o=>o.uuid).join('|')};win.kaminosSelection.set([guides[0].asset.id],guides[0].asset.id);session.redraw();return state();
  }catch(e){for(const g of guides){const i=relatedAssets.indexOf(g.asset);if(i>=0)relatedAssets.splice(i,1);}await owned.dispose();throw e;}
 }
 function state(){if(!draft)return null;const inverse=draft.sourceWorld.clone().invert();return {joint:draft.joint,body:draft.id,current:JSON.stringify(getModel())===draft.identity&&worldOf(draft.id).equals(draft.sourceWorld)&&view.bodyMeshes(draft.id).map(o=>o.uuid).join('|')===draft.meshes&&draft.guides.every(g=>!!g.mesh.parent),guides:draft.guides.map(g=>({id:g.asset.id,position:g.mesh.position.toArray()})),cuts:draft.guides.map(g=>{g.mesh.updateWorldMatrix(true,false);return new T.Vector3().setFromMatrixPosition(g.mesh.matrixWorld).applyMatrix4(inverse).x;})};}
 function values(){const s=state();if(!s||!s.current)throw Error('Prepare seams again after changing the mechanism');for(const g of draft.guides){g.mesh.updateWorldMatrix(true,false);const n=new T.Vector3(0,0,1).applyNormalMatrix(new T.Matrix3().getNormalMatrix(draft.sourceWorld.clone().invert().multiply(g.mesh.matrixWorld)));if(Math.abs(n.x)<1-1e-5)throw Error('This cutter uses parallel seams; keep the guides across the surface');}return s;}
 function setCut(index,value){if(!draft||!draft.guides[index]||!Number.isFinite(value))throw Error('Choose a seam and finite position');const g=draft.guides[index],p=g.mesh.position.clone().applyMatrix4(draft.sourceWorld.clone().invert());p.x=value;g.mesh.position.copy(p.applyMatrix4(draft.sourceWorld));host.scene.refreshPresentation?.(g.asset);session.redraw();return state();}
 function refresh(show=anatomy){
  anatomy=show;overlay.visible=show;if(!show)return;
  const model=getModel(),t=getFraction(),selected=getSelected(),key=JSON.stringify([model.nodes,model.pistons,t,selected]);
  // Pose updates write tiny retained buffers. Labels and extracted mesh edges
  // are construction resources, not animation frames.
  if(key!==lastOverlay){
   lastOverlay=key;const f=frames(model,t),keepLines=new Set(),keepLabels=new Set();
   function line(id,points,color,dashed=false){
    keepLines.add(id);let o=lines.get(id);
    if(!o){const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(6),3));if(dashed)g.setAttribute('lineDistance',new T.BufferAttribute(new Float32Array(2),1));const material=dashed?new T.LineDashedMaterial({color,depthTest:false,dashSize:.09,gapSize:.05,transparent:true,opacity:.8}):new T.LineBasicMaterial({color,depthTest:false});o=new T.Line(g,material);o.frustumCulled=false;o.raycast=()=>{};lines.set(id,o);overlay.add(o);}
    const p=o.geometry.attributes.position;let changed=false;for(let i=0;i<6;i++){const v=Math.fround(points[Math.floor(i/3)][i%3]);if(p.array[i]!==v){p.array[i]=v;changed=true;}}if(changed)p.needsUpdate=true;
    if(dashed){const d=o.geometry.attributes.lineDistance,length=Math.fround(Math.hypot(...points[1].map((v,i)=>v-points[0][i])));if(d.array[1]!==length){d.array[1]=length;d.needsUpdate=true;}}
    o.material.color.setHex(color);
   }
   for(const [i,n]of model.nodes.entries()){const p=f[n.parent??i].point,z=n.layer??.22;line(`axis:${i}`,[[...p,z-.3],[...p,z+.5]],0x61e0db);if(n.parent!==null)line(`bone:${i}`,[[...p,z],[...f[i].point,z]],i===selected?0xffd385:0x73c2cf,true);}
   for(const [i,p]of model.pistons.entries()){const a=pistonMountPoint(model,f,p.a,p.aOffset),b=pistonMountPoint(model,f,p.b,p.bOffset),z=p.z??.5;line(`piston:${i}`,[[...a,z],[...b,z]],0xf0ac65);}
   for(const [i,n]of model.nodes.entries())if(n.surfacePanel){
    keepLabels.add(i);let sprite=labels.get(i);const text=`Panel ${n.surfacePanel.index+1}`;
    if(sprite&&sprite.userData.label!==text){release(sprite);labels.delete(i);sprite=null;}
    if(!labels.has(i)){const canvas=win.document?.createElement?.('canvas'),ctx=canvas?.getContext?.('2d');if(ctx){canvas.width=384;canvas.height=80;ctx.fillStyle='#10242ce6';ctx.fillRect(0,0,384,80);ctx.font='bold 40px sans-serif';ctx.fillStyle='#ffdb9a';ctx.fillText(text,20,54);sprite=new T.Sprite(new T.SpriteMaterial({map:new T.CanvasTexture(canvas),depthTest:false}));sprite.userData.label=text;sprite.scale.set(.65,.14,1);sprite.raycast=()=>{};overlay.add(sprite);}labels.set(i,sprite??null);}
    if(sprite){const p=f[n.parent].point,angle=f[i].angle;sprite.position.set(p[0]+Math.cos(angle)*n.length*.5-Math.sin(angle)*.35,p[1]+Math.sin(angle)*n.length*.5+Math.cos(angle)*.35,.65);}
   }
   prune(lines,keepLines);prune(labels,keepLabels);
  }
  const meshes=selected>=0?view.bodyMeshes(`link:${selected}`):[];prune(edges,new Set(meshes));root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert();
  for(const mesh of meshes){const g=mesh.geometry,revision=[g.attributes.position,g.attributes.position.version,g.index,g.index?.version],prior=edges.get(mesh);let record=prior;
   if(!record||record.geometry!==g||record.revision.some((v,i)=>v!==revision[i])){release(record?.object);const object=new T.LineSegments(new T.EdgesGeometry(g,30),new T.LineBasicMaterial({color:0xffd385,transparent:true,opacity:.65,depthTest:false}));object.matrixAutoUpdate=false;object.raycast=()=>{};overlay.add(object);record={object,geometry:g,revision};edges.set(mesh,record);}
   record.object.matrix.copy(inverse).multiply(mesh.matrixWorld);
  }
 }
 return {preview,clear,state,values,setCut,refresh,async dispose(){closed=true;await clear();prune(lines,new Set());prune(labels,new Set());prune(edges,new Set());overlay.removeFromParent();}};
}
