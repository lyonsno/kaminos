import {Group,Mesh,PlaneGeometry,MeshBasicMaterial,TextureLoader,SRGBColorSpace,DoubleSide,
 BufferGeometry,Line,LineBasicMaterial,Vector3,Quaternion} from './lib/three.webgpu.js';

export const VIEW_FAN_SOURCE='kaminos:view-fan';
const vector=(a,name)=>{if(!Array.isArray(a)||a.length!==3||!a.every(Number.isFinite))throw Error(`Invalid fan ${name}`);return [...a];};
const positive=(x,name)=>{if(!Number.isFinite(x)||x<=0)throw Error(`Invalid fan ${name}`);return x;};
function checkedFanImage(v){
 if(typeof v.image!=='string'||!v.image.startsWith('data:image/png;base64,'))throw Error('Fan needs retained PNG pixels');
 let bytes;try{bytes=Uint8Array.from(atob(v.image.slice(22)),c=>c.charCodeAt(0));}catch{throw Error('Invalid fan PNG');}
 if(bytes.length<24||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw Error('Invalid fan PNG');
 const header=new DataView(bytes.buffer);if(header.getUint32(16)!==v.width||header.getUint32(20)!==v.height||!Number.isSafeInteger(v.width)||v.width<=0||!Number.isSafeInteger(v.height)||v.height<=0)throw Error('Fan pixels do not match their declared dimensions');
}
export function checkedFanView(v){
 if(!v)throw Error('Missing fan camera');
 const result={...v,position:vector(v.position,'camera position'),target:vector(v.target,'camera target'),up:vector(v.up,'camera up')};
 positive(v.near,'near');positive(v.far,'far');positive(v.fov,'field of view');
 if(v.far<=v.near||v.fov>=180||Math.hypot(...v.up)===0||v.position.every((x,i)=>x===v.target[i]))throw Error('Invalid fan camera geometry');
 return result;
}
export function checkedViewFan(raw){
 const f=structuredClone(raw);
 if(f?.schema!=='kaminos.view-fan.v1'||!f.context||!Array.isArray(f.context.objects)||!f.renderer?.route)throw Error('Fan needs its source scene and renderer context');
 if(typeof f.anchor?.objectId!=='string')throw Error('Fan needs a source object');
 vector(f.anchor.position,'anchor');vector(f.anchor.normal,'normal');checkedFanView(f.sourceView);
 for(const k of ['radius','cardWidth'])positive(f[k],k);
 if(!Number.isFinite(f.spread)||f.spread<0)throw Error('Invalid angular spread');
 if(!Array.isArray(f.views)||!f.views.length)throw Error('Fan needs evaluated views');
 for(const v of f.views){
  checkedFanView(v.view);if(!Number.isFinite(v.angle))throw Error('Invalid fan angle');
  checkedFanImage(v);
 }
 return f;
}

// Keep all temporary camera draws in one synchronous task. The ordinary view
// is restored and redrawn before the browser can present another frame.
export function captureViewFan({views,size,snapshot,begin,present,copy,restore}){
 if(!Array.isArray(views)||!views.length||!Number.isSafeInteger(size)||size<=0)throw Error('Choose fan views and a positive pixel size');
 for(const row of views)checkedFanView(row.view);
 const previous=snapshot(),result=[];let failure;
 try{
  begin(size);
  for(const row of views){present(row.view);const picture=copy();checkedFanImage(picture);result.push({...row,...picture});}
 }catch(error){failure=error;}
 try{restore(previous);}catch(error){failure=failure?new AggregateError([failure,error],`${failure.message}; ${error.message}`):error;}
 if(failure)throw failure;
 return result;
}

// Camera positions change around the same actual carrier neighborhood. Light
// and source state remain untouched. This does not infer microgeometry.
export function viewFanCameras({sourceView,anchor,radius,spread}){
 const view=checkedFanView(sourceView),target=new Vector3(...vector(anchor,'anchor'));
 positive(radius,'radius');if(!Number.isFinite(spread)||spread<0)throw Error('Invalid angular spread');
 const offset=new Vector3(...view.position).sub(target),distance=offset.length();positive(distance,'camera distance');
 const up=new Vector3(...view.up).normalize();
 return [-spread,0,spread].map(angle=>{
  const position=offset.clone().applyAxisAngle(up,angle*Math.PI/180).add(target);
  return {angle,view:{...view,position:position.toArray(),target:target.toArray(),up:up.toArray(),fov:Math.min(175,2*Math.atan(radius/distance)*180/Math.PI)}};
 });
}

export function sourceSceneWithoutFans(raw){
 const scene=structuredClone(raw),removed=new Set(scene.objects.filter(o=>o.source===VIEW_FAN_SOURCE).map(o=>o.id));
 scene.objects=scene.objects.filter(o=>!removed.has(o.id));
 scene.groups=(scene.groups??[]).map(g=>({...g,objectIds:g.objectIds.filter(id=>!removed.has(id))}));
 scene.selectionIds=(scene.selectionIds??[]).filter(id=>!removed.has(id));
 if(removed.has(scene.activeObjectId))scene.activeObjectId=null;
 if(scene.materialLibrary?.bindings)scene.materialLibrary.bindings=scene.materialLibrary.bindings.filter(b=>!removed.has(b.objectId));
 return scene;
}

export function createViewFan(record,{loadTexture=image=>new TextureLoader().load(image)}={}){
 const f=checkedViewFan(record.viewFan),root=new Group();root.name=record.label??'View fan';root.userData.kaminosViewFan=f;
 const geometry=new PlaneGeometry(1,1),width=f.cardWidth;
 for(const [i,v] of f.views.entries()){
  const panel=new Group(),x=(i-(f.views.length-1)/2)*width*1.13;
  panel.position.set(x,.11*width*(1-Math.cos(v.angle*Math.PI/180)),0);panel.rotation.y=-v.angle*Math.PI/540;
  const frame=new Mesh(geometry,new MeshBasicMaterial({color:Math.abs(v.angle)<1e-10?0x67c8dd:0x323e47,side:DoubleSide,toneMapped:false}));
  frame.scale.set(width*1.035,width*1.035,1);frame.position.z=-.002;panel.add(frame);
  const texture=loadTexture(v.image);texture.colorSpace=SRGBColorSpace;
  const card=new Mesh(geometry,new MeshBasicMaterial({map:texture,side:DoubleSide,toneMapped:false}));
  card.scale.set(width,width,1);card.name=`View ${v.angle>0?'+':''}${v.angle.toFixed(0)}°`;card.userData.viewFanIndex=i;panel.add(card);
  // Reticle denotes the actual selected carrier point, not an identified
  // apparent blade or stone. All camera targets share that anchor.
  const r=.022*width,mark=new BufferGeometry().setFromPoints([new Vector3(-r,0,.003),new Vector3(r,0,.003),new Vector3(0,0,.003),new Vector3(0,-r,.003),new Vector3(0,r,.003)]);
  panel.add(new Line(mark,new LineBasicMaterial({color:0xa3ebf4,transparent:true,opacity:.75,toneMapped:false})));
  root.add(panel);
  const stem=new Line(new BufferGeometry().setFromPoints([new Vector3(),new Vector3(x,-width*.53,0)]),new LineBasicMaterial({color:0x80a9b7,transparent:true,opacity:.5,toneMapped:false}));
  stem.userData.viewFanStem=true;root.add(stem);
 }
 updateViewFanAnchor(root);
 return root;
}
export function updateViewFanAnchor(root){
 root.updateWorldMatrix(true,false);
 const anchor=root.worldToLocal(new Vector3(...root.userData.kaminosViewFan.anchor.position));
 for(const node of root.children)if(node.userData.viewFanStem){node.geometry.attributes.position.setXYZ(0,...anchor.toArray());node.geometry.attributes.position.needsUpdate=true;node.geometry.computeBoundingSphere();}
}
export function viewFanPose(sourceView,position){
 const q=new Quaternion(),direction=new Vector3(...sourceView.position).sub(new Vector3(...sourceView.target)).normalize();
 // Quaternion from a camera gives a stable readable plane for the initial fan.
 q.setFromUnitVectors(new Vector3(0,0,1),direction);
 return {position:vector(position,'placement'),quaternion:q};
}
export const viewFanRecordDomain={type:'pbr',source:VIEW_FAN_SOURCE,
 check:r=>({...r,viewFan:checkedViewFan(r.viewFan)}),fields:r=>({viewFan:checkedViewFan(r.viewFan)}),
 recognize:object=>!!object.userData.kaminosViewFan,
 capture:entry=>({source:VIEW_FAN_SOURCE,viewFan:checkedViewFan(entry.object.userData.kaminosViewFan)}),
 reloadable:r=>{checkedViewFan(r.viewFan);return true;},
 load:(r,loaders,options)=>loaders.constructed(createViewFan(r),r,options)};
