import * as THREE from './lib/three.core.js';
import {checkedProceduralMesh,createProceduralMesh} from './scene-geometry.mjs';
import {classifyClaims,solidDistance} from './registration-claims.mjs';

const palette=['#36d6cf','#f0bb4b','#9a8eff','#eb739c','#9fda62','#72a7ff'];
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(`${name} needs three finite values`);return [...v];};
const unit=(v,name)=>{if(!Number.isFinite(v)||v<0||v>1)throw Error(`${name} must be in [0,1]`);return v;};

/** Build source ghosts from an authored carrier, without installing its simulator. */
export function sourceParts(scene) {
 const roles=scene.provenance?.analyticalCarrier?.parts;
 if(!roles||!Object.keys(roles).length)throw Error('Source scene has no analytical carrier part identities');
 const byId=new Map(scene.objects.map(o=>[o.id,o]));
 return Object.entries(roles).map(([id,ids],i)=>{
  const primitives=ids.map(key=>{const o=byId.get(key);if(!o)throw Error(`Missing source object ${key}`);return o;})
   .filter(o=>o.type==='procedural-mesh').map(checkedProceduralMesh);
  if(!primitives.length)throw Error(`Part ${id} has no primitive geometry`);
  for(const p of primitives){
   if(!['box','cylinder'].includes(p.geometry.kind))throw Error(`Unsupported claim primitive: ${p.geometry.kind}`);
   if(p.transform.scale.some(x=>x<=0))throw Error('Source primitive scale must be positive');
  }
  const group=scene.groups?.find(g=>g.objectIds?.some(key=>ids.includes(key)));
  if(group?.transform && (group.transform.position.some(x=>x!==0)||group.transform.rotation.some(x=>x!==0)||group.transform.scale.some(x=>x!==1)))throw Error('Carrier group transforms must be baked into primitive transforms');
  return {id,label:id[0].toUpperCase()+id.slice(1),color:palette[i%palette.length],primitives};
 });
}

/** No DOM, renderer or application singleton. Owns only its diagnostic resources. */
export function createRegistrationViewer({target,parts,redraw=()=>{},onChange=()=>{}}) {
 const ghost=new THREE.Group();ghost.name='Registration reference';
 const diagnostic=new THREE.Group();diagnostic.name='Independent part claims';
 const layers=parts.map(p=>{
  const root=new THREE.Group();root.name=p.label;ghost.add(root);
  const nodes=p.primitives.map(record=>{
   const mesh=createProceduralMesh(THREE,null,record.geometry).group;
   mesh.material.dispose();mesh.material=new THREE.MeshBasicMaterial({color:p.color,transparent:true,opacity:.32,depthWrite:false,side:THREE.DoubleSide});
   mesh.position.fromArray(record.transform.position);mesh.rotation.fromArray([...record.transform.rotation,'XYZ']);mesh.scale.fromArray(record.transform.scale);
   mesh.castShadow=false;mesh.receiveShadow=false;root.add(mesh);return {mesh,record};
  });
  return {...p,root,nodes};
 });
 const targetMaterials=[];
 target.traverse(node=>{if(node.isSkinnedMesh||node.morphTargetInfluences?.length)throw Error('Registration viewer currently consumes static meshes');if(node.isMesh)targetMaterials.push({node,original:node.material});});
 if(!targetMaterials.length)throw Error('Target contains no mesh surfaces');
 const materialCopies=new Map();
 for(const {node,original}of targetMaterials)node.material=Array.isArray(original)?original.map(copyMaterial):copyMaterial(original);
 function copyMaterial(mat){if(!materialCopies.has(mat))materialCopies.set(mat,mat.clone());return materialCopies.get(mat);}
 const state={alignment:{position:[0,0,0],rotation:[0,Math.PI/2,0],scale:1},parts:Object.fromEntries(parts.map(p=>[p.id,{visible:true,color:p.color}])),solo:null,reference:true,referenceOpacity:.32,wireframe:false,xray:false,target:true,targetOpacity:1,claims:false,claimOpacity:.85,mode:'claims',threshold:.5,falloff:.035};
 let disposed=false,generation=0,field=null,status='not computed',progress=0,mesh=null,summary=null,computedSignature=null;
 const originalTargetVisible=target.visible;
 const active=id=>state.parts[id].visible&&(!state.solo||state.solo===id);
 const signature=()=>{
  ghost.updateMatrixWorld(true);target.updateWorldMatrix(true,true);
  const surfaces=[];
  target.traverse(node=>{if(node.isMesh){const g=node.geometry,p=g.attributes.position,i=g.index;surfaces.push([node.uuid,node.matrixWorld.elements,g.uuid,p?.version,p?.count,i?.version,i?.count]);}});
  return JSON.stringify([ghost.matrixWorld.elements,surfaces]);
 };
 function invalidate(){generation++;field=null;summary=null;computedSignature=null;status='not computed';progress=0;diagnostic.visible=false;}
 function apply(){
  const a=state.alignment;ghost.position.fromArray(a.position);ghost.rotation.set(...a.rotation);ghost.scale.setScalar(a.scale);
  ghost.visible=state.reference;
  for(const p of layers){p.root.visible=active(p.id);for(const {mesh:m}of p.nodes){m.material.color.set(state.parts[p.id].color);m.material.opacity=state.referenceOpacity;m.material.wireframe=state.wireframe;m.material.depthTest=!state.xray;m.renderOrder=state.xray?20:1;}}
  target.visible=state.target;
  for(const [original,mat]of materialCopies){mat.opacity=original.opacity*state.targetOpacity;mat.transparent=original.transparent||state.targetOpacity<1;mat.depthWrite=state.targetOpacity<1?false:original.depthWrite;mat.needsUpdate=true;}
  diagnostic.visible=Boolean(field&&state.claims);redraw();onChange(read());
 }
 function read(){return {schema:'kaminos.registration-view.v1',...structuredClone(state),status,progress,summary:summary&&structuredClone(summary),method:'independent primitive-solid distance at every target triangle centroid; score exp(-outsideDistance/falloff); not semantic registration',partsSource:parts.map(p=>({id:p.id,primitiveIds:p.primitives.map(o=>o.id)}))};}
 function check(){if(disposed)throw Error('Registration viewer disposed');}
 function configure(patch){
  check();const next=structuredClone(state);
  for(const [key,value]of Object.entries(patch)){
   if(['reference','wireframe','xray','target','claims'].includes(key)){if(typeof value!=='boolean')throw Error(`${key} must be boolean`);next[key]=value;}
   else if(['referenceOpacity','targetOpacity','claimOpacity'].includes(key))next[key]=unit(value,key);
   else if(key==='threshold'){if(!Number.isFinite(value)||value<=0||value>1)throw Error('threshold must be in (0,1]');next[key]=value;}
   else if(key==='falloff'){if(!Number.isFinite(value)||value<=0)throw Error('falloff must be positive');next[key]=value;}
   else if(key==='mode'){if(!['claims','overlap','residual'].includes(value))throw Error('Unknown display mode');next.mode=value;}
   else if(key==='solo'){if(value!==null&&!next.parts[value])throw Error('Unknown solo part');next.solo=value;}
   else if(key==='parts')for(const [id,settings]of Object.entries(value)){if(!next.parts[id])throw Error(`Unknown part ${id}`);for(const [k,v]of Object.entries(settings)){if(k==='visible'&&typeof v==='boolean')next.parts[id].visible=v;else if(k==='color'&&/^#[0-9a-f]{6}$/i.test(v))next.parts[id].color=v;else throw Error('Invalid part setting');}}
   else if(key==='alignment'){
    if(value.position!==undefined)next.alignment.position=vector(value.position,'Position');
    if(value.rotation!==undefined)next.alignment.rotation=vector(value.rotation,'Rotation');
    if(value.scale!==undefined){if(!Number.isFinite(value.scale)||value.scale<=0)throw Error('Scale must be positive');next.alignment.scale=value.scale;}
   }else throw Error(`Unknown registration setting ${key}`);
  }
  if(JSON.stringify(next.alignment)!==JSON.stringify(state.alignment)||next.falloff!==state.falloff)invalidate();
  Object.assign(state,next);apply();if(field)paint();return read();
 }
 function fitBounds(){
  check(); // Coarse similarity proposal, not an optimized registration.
  configure({alignment:{position:[0,0,0],scale:1}});ghost.updateMatrixWorld(true);target.updateWorldMatrix(true,true);
  const sourceBox=new THREE.Box3().setFromObject(ghost),targetBox=new THREE.Box3().setFromObject(target),s=sourceBox.getSize(new THREE.Vector3()),t=targetBox.getSize(new THREE.Vector3());
  const scale=Math.max(t.x,t.y,t.z)/Math.max(s.x,s.y,s.z);
  const offset=targetBox.getCenter(new THREE.Vector3()).sub(sourceBox.getCenter(new THREE.Vector3()).multiplyScalar(scale));
  return configure({alignment:{position:offset.toArray(),scale}});
 }
 function paint(){
  if(!field)return;
  const colors=mesh.geometry.attributes.color.array,counts={single:0,overlap:0,unclaimed:0},perPart=Object.fromEntries(parts.map(p=>[p.id,0]));
  const tint=parts.map(p=>new THREE.Color(state.parts[p.id].color)),scores=new Array(parts.length);
  for(let f=0;f<field.count;f++){
   for(let p=0;p<parts.length;p++)scores[p]=field.scores[f*parts.length+p];
   const c=classifyClaims(scores,state.threshold);counts[c.kind]++;for(const i of c.owners)perPart[parts[i].id]++;
   const visible=c.owners.filter(i=>active(parts[i].id));let color=new THREE.Color(0),alpha=0;
   if(state.mode==='residual'&&c.kind==='unclaimed'){color.set('#ff783b');alpha=state.claimOpacity;}
   else if(state.mode==='overlap'&&c.kind==='overlap'){color.set('#ff39e8');alpha=state.claimOpacity;}
   else if(state.mode==='claims'&&visible.length){for(const i of visible)color.add(tint[i]);color.multiplyScalar(1/visible.length);alpha=state.claimOpacity;}
   for(let v=0;v<3;v++){const k=(f*3+v)*4;colors[k]=color.r;colors[k+1]=color.g;colors[k+2]=color.b;colors[k+3]=alpha;}
  }
  mesh.geometry.attributes.color.needsUpdate=true;summary={triangles:field.count,...counts,perPart};apply();
 }
 async function compute(){
  check();invalidate();const token=generation;status='computing';progress=0;apply();const startSignature=signature();
  try{
  const current=[];target.traverse(n=>{if(n.isMesh)current.push(n);});
  if(current.length!==targetMaterials.length||current.some((n,i)=>n!==targetMaterials[i].node))throw Error('Target mesh hierarchy changed; reopen the viewer to register its surfaces');
  const prepared=layers.map(p=>p.nodes.map(({mesh:m,record})=>({inverse:m.matrixWorld.clone().invert(),geometry:record.geometry,scale:Math.min(...m.getWorldScale(new THREE.Vector3()).toArray())})));
  const surfaces=targetMaterials.map(({node})=>({node,position:node.geometry.attributes.position,index:node.geometry.index}));
  const count=surfaces.reduce((n,s)=>n+(s.index?s.index.count:s.position.count)/3,0);
  if(!Number.isInteger(count)||count===0)throw Error('Target must contain complete triangles');
  const positions=new Float32Array(count*9),scores=new Float32Array(count*parts.length),point=new THREE.Vector3(),center=new THREE.Vector3(),local=new THREE.Vector3();let face=0;
   for(const {node,position,index}of surfaces){
    const length=index?index.count:position.count;
    for(let j=0;j<length;j+=3,face++){
     if(disposed||token!==generation)return read();
     center.set(0,0,0);
     for(let v=0;v<3;v++){point.fromBufferAttribute(position,index?index.getX(j+v):j+v).applyMatrix4(node.matrixWorld);point.toArray(positions,face*9+v*3);center.add(point);}
     center.multiplyScalar(1/3);
     for(let p=0;p<parts.length;p++){
      let distance=Infinity;
      for(const primitive of prepared[p]){local.copy(center).applyMatrix4(primitive.inverse);distance=Math.min(distance,solidDistance(primitive.geometry,[local.x,local.y,local.z])*primitive.scale);}
      scores[face*parts.length+p]=Math.exp(-distance/state.falloff);
     }
     // Yield only; never sample or truncate the target surface.
     if(face%2048===0){progress=face/count;onChange(read());await new Promise(resolve=>setTimeout(resolve,0));}
    }
   }
   if(token!==generation||disposed)return read();
   if(signature()!==startSignature){invalidate();apply();return read();}
   if(mesh){diagnostic.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(count*12),4));
   mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
   mesh.renderOrder=5;diagnostic.add(mesh);field={count,scores};computedSignature=startSignature;status='computed';progress=1;state.claims=true;paint();return read();
  }catch(error){if(token===generation){invalidate();status='failed: '+error.message;apply();}throw error;}
 }
 const refresh=()=>{if(field&&signature()!==computedSignature){invalidate();apply();}};
 function dispose(){if(disposed)return;disposed=true;generation++;for(const {node,original}of targetMaterials)node.material=original;target.visible=originalTargetVisible;for(const m of materialCopies.values())m.dispose();ghost.traverse(n=>{n.geometry?.dispose();n.material?.dispose();});if(mesh){mesh.geometry.dispose();mesh.material.dispose();}ghost.removeFromParent();diagnostic.removeFromParent();}
 apply();return {ghost,diagnostic,read,configure,fitBounds,compute,refresh,dispose};
}
