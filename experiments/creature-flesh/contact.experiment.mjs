import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from '../creature-motion/full-body-source.mjs';
import {createGivenPaletteMotion} from '../creature-motion/given-palette-motion.mjs';
import {createGpuSkinDeformer} from '../creature-motion/gpu-skin-deformer.mjs';
import {skinTransport} from '../../hindquarter-live-core.mjs';
import {registerExportGeometrySnapshot} from '../../scene-export-geometry.mjs';
import {createFleshVolume} from './volume.mjs';
import {addFleshOffsets} from './torso.mjs';

async function loadPrepared(inputs,caseSha){
 if(typeof inputs.prepared!=='string'||!/^[a-f0-9]{64}$/.test(inputs.prepared_sha256??''))throw Error('Explicit physical preparation and SHA256 required');
 const response=await fetch(inputs.prepared,{cache:'no-store'});if(!response.ok)throw Error('Physical preparation HTTP '+response.status);
 const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 if(sha!==inputs.prepared_sha256)throw Error('Physical preparation hash mismatch');
 const p=JSON.parse(new TextDecoder().decode(bytes));if(p.schema!=='kaminos.creature-flesh.torso-proxy.v0'||p.source.caseSha256!==caseSha)throw Error('Physical proxy belongs to another source case');return p;
}

export default {
 id:'creature-flesh/contact',title:'Creature · contact and recovery',
 async create({host,inputs,record}){
  const data=await loadFullBodySources(inputs),prepared=await loadPrepared(inputs,data.source.caseSha256);
  if(prepared.source.vertices!==data.manifest.vertices||prepared.source.channels!==data.manifest.channels.length)throw Error('Physical embedding differs from the detailed skin');
  const adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame}),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.rest,3));geometry.setIndex(new THREE.BufferAttribute(data.triangles,1));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const placement=new THREE.Group();placement.name='Creature · physical flank';placement.userData.kaminosFrameContentOnly=true;
  const root=new THREE.Group();root.name='Retained rig motion';placement.add(root);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xd6b17c,roughness:.72,side:THREE.DoubleSide}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.kaminosDynamicGeometry=true;root.add(mesh);
  const deformer=createGpuSkinDeformer({geometry,...data,channels:data.manifest.channels.length,physical:prepared});mesh.onBeforeRender=renderer=>deformer.flush(renderer);
  const probe=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x497f9b,roughness:.6,transparent:true,opacity:.35}));probe.name='Contact sphere · move into flank';probe.castShadow=true;probe.receiveShadow=true;
  const guideGeometry=new THREE.BufferGeometry(),guide=new THREE.LineSegments(guideGeometry,new THREE.LineBasicMaterial({color:0x30ced4,transparent:true,opacity:.55,depthTest:false}));
  guide.name='Physical volume · provisional proxy';Object.assign(guide.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true});guide.visible=false;root.add(guide);
  const edges=new Set();for(const t of prepared.tetrahedra)for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){const pair=[t[a],t[b]].sort((x,y)=>x-y);edges.add(pair.join(','));}
  const edgeIds=[...edges].map(s=>s.split(',').map(Number));guideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edgeIds.length*6),3));
  const nodeRest=Float32Array.from(prepared.positions.flat()),nodeWeights=Float32Array.from(prepared.nodeWeights),identity=new THREE.Matrix4().toArray();
  const parameters={young:inputs.young??30,bulk:inputs.bulk??100};let volume=createFleshVolume(prepared,parameters),session,bodyAsset,probeAsset,unsubscribe,disposed=false,playing=false,motion=false,physical=true,frame=0,stepCount=0,poseKey='',palette,offsets=volume.offsets(),mirror=null,mirrorKey='',stroke=null,error=null,groundHeight=null,restoreGround=()=>{},refresh=()=>{};
  const dt=1/60,profile=prepared.construction.profile[Math.floor(prepared.construction.sections/2)],radius=profile.radius[0]*.5;
  probe.scale.setScalar(radius);
  let localStart,pressDirection;
  function seatStroke(){
   const c=prepared.construction.crossSection,m=(c-1)/2,k=Math.floor(prepared.construction.sections/2),points=volume.points(),surface=points[(k*c+m)*c+c-1],center=points[(k*c+m)*c+m],delta=surface.map((v,a)=>v-center[a]),length=Math.hypot(...delta);
   if(!(length>0))throw Error('Posed flank has no outward contact direction');
   pressDirection=delta.map(v=>v/length);localStart=surface.map((v,a)=>v+pressDirection[a]*radius*1.1);
  }
  function setPose(index){
   if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Source frame outside retained clip');
   const pose=adapter.frame(index),byName=new Map(pose.bones.map(b=>[b.name,b.skinMatrix])),next=[identity,...data.manifest.channels.slice(1).map(name=>byName.get(name))];
   const key=next.flat().join(',');if(key!==poseKey){const points=skinTransport(nodeRest,nodeWeights,next);volume.setTargets(Array.from({length:prepared.positions.length},(_,i)=>Array.from(points.subarray(i*3,i*3+3))));deformer.update(next);palette=next;poseKey=key;}
   root.matrixAutoUpdate=false;root.matrix.fromArray(pose.actorMatrix);root.matrixWorldNeedsUpdate=true;frame=index;placement.updateMatrixWorld(true);
  }
  function putProbe(local){probe.position.copy(root.localToWorld(new THREE.Vector3(...local)));probe.updateMatrixWorld(true);}
  function publish(){offsets=volume.offsets();deformer.setOffsets(offsets);const points=volume.points(),attribute=guideGeometry.attributes.position;edgeIds.forEach((edge,i)=>edge.forEach((node,k)=>attribute.array.set(points[node],i*6+k*3)));attribute.needsUpdate=true;guideGeometry.computeBoundingSphere();session?.redraw();}
  function currentGeometry(){
   const key=poseKey+':'+volume.read().epoch;if(mirror&&key===mirrorKey)return mirror;
   const next=new THREE.BufferGeometry(),points=addFleshOffsets(skinTransport(data.rest,data.weights,palette),prepared,offsets);
   next.setAttribute('position',new THREE.BufferAttribute(points,3));next.setIndex(new THREE.BufferAttribute(data.triangles,1));next.computeVertexNormals();next.computeBoundingBox();next.computeBoundingSphere();mirror?.dispose();mirror=next;mirrorKey=key;return next;
  }
  const raycast=mesh.raycast;mesh.raycast=function(...args){const draw=mesh.geometry;try{mesh.geometry=currentGeometry();return raycast.apply(this,args);}finally{mesh.geometry=draw;}};
  registerExportGeometrySnapshot(mesh,currentGeometry);
  function read({geometry:includeGeometry=false}={}){
   const result={route:'accepted-all-influences-dq-plus-torso-elastic-reference',source:data.source,preparedSha256:inputs.prepared_sha256,frame,steps:stepCount,physical,motion,playing,clock:{kind:'fixed-step-preview-not-wall-clock-performance',timeStep:dt,seconds:stepCount*dt},volume:volume.read(),deformer:deformer.read(),sphere:{id:probeAsset?.id,position:probe.position.toArray(),radius:probe.scale.x},body:{id:bodyAsset?.id,vertices:data.manifest.vertices,triangles:data.manifest.triangles},groundReference:{height:groundHeight,contactSolver:false},stroke:stroke&&{seconds:stroke.time},error,view:session?.readView()};
   if(includeGeometry){result.physicalPoints=volume.points();result.offsets=volume.offsets();result.vertices=Array.from(currentGeometry().attributes.position.array);}return result;
  }
  function advance(count=1){
   if(!Number.isSafeInteger(count)||count<1)throw Error('Positive whole physical step count required');
   if(disposed)throw Error('Contact experiment disposed');
   for(let i=0;i<count;i++){
    if(motion)setPose(Math.min(adapter.frames-1,Math.floor((stepCount+1)*dt*adapter.fps)));
    if(stroke){stroke.time=++stroke.steps*dt;const t=stroke.time,amount=t<1?t:t<2?1:t<3?3-t:0;putProbe(localStart.map((v,a)=>v-pressDirection[a]*radius*.75*amount));if(t>=3){stroke=null;playing=false;}}
    placement.updateMatrixWorld(true);probe.updateMatrixWorld(true);const center=root.worldToLocal(probe.getWorldPosition(new THREE.Vector3())).toArray(),scale=probe.getWorldScale(new THREE.Vector3()),bodyScale=root.getWorldScale(new THREE.Vector3());
    if(Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-5)throw Error('Contact primitive requires a uniformly scaled sphere');
    if(!(bodyScale.x>0)||Math.max(bodyScale.x,bodyScale.y,bodyScale.z)-Math.min(bodyScale.x,bodyScale.y,bodyScale.z)>1e-5)throw Error('Physical body requires positive uniform authored scale');
    volume.setSphere({center,radius:scale.x/bodyScale.x});volume.step(dt);stepCount++;
   }
   publish();refresh();return read();
  }
  function reset(){volume=createFleshVolume(prepared,parameters);volume.setEnabled(physical);poseKey='';stepCount=0;stroke=null;setPose(0);seatStroke();putProbe(localStart);publish();return read();}
  async function dispose(){if(disposed)return;disposed=true;unsubscribe?.();restoreGround();refresh=()=>{};mirror?.dispose();deformer.dispose();if(session)await session.dispose();else{geometry.dispose();mesh.material.dispose();probe.geometry.dispose();probe.material.dispose();guideGeometry.dispose();guide.material.dispose();}if(globalThis.window?.kaminosCreatureFlesh===diagnostic)delete globalThis.window.kaminosCreatureFlesh;}
  const diagnostic={read,advance,geometry:currentGeometry,physicalState:()=>({points:volume.points(),offsets:volume.offsets()}),gpu:()=>deformer.readback()};
  try{
   session=await host.scene.open();setPose(0);seatStroke();putProbe(localStart);publish();
   bodyAsset=await session.attach(placement,{owned:true,metadata:{label:placement.name,type:'glb',source:{...data.source,physicalPreparation:inputs.prepared_sha256}}});
   probeAsset=await session.attach(probe,{owned:true,metadata:{label:probe.name,type:'mesh',source:'kinematic-sphere-contact-control'}});
   const ground=host.controls.document.getElementById('composition-ground-height');if(!ground)throw Error('Shared reference-ground control unavailable');
   const previousGround=ground.value;groundHeight=currentGeometry().boundingBox.clone().applyMatrix4(mesh.matrixWorld).min.y-.01;const presentedGround=String(groundHeight);ground.value=presentedGround;ground.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(ground.value===presentedGround){ground.value=previousGround;ground.dispatchEvent(new Event('change'));}};
   const center=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()),direction=new THREE.Vector3(...prepared.construction.right).multiplyScalar(5).add(new THREE.Vector3(0,1.4,2));session.setView(inputs.view??{position:center.clone().add(direction).toArray(),target:center.toArray()});if(!inputs.view)host.scene.frame([placement,probe]);
   unsubscribe=session.onFrame(()=>{if(!playing)return;try{advance();}catch(e){error=e.message;playing=false;record({kind:'creature-flesh.step',phase:'failed',message:e.message,state:read()});refresh();}});
   if(globalThis.window)globalThis.window.kaminosCreatureFlesh=diagnostic;
  }catch(e){await dispose();throw e;}
  const action=(kind,fn)=>(...args)=>{const result=fn(...args);session.redraw();refresh();record({kind:'creature-flesh.'+kind,phase:'applied',state:read()});return result??read();};
  return{read,dispose,operations:{
   advance:action('advance',advance),reset:action('reset',reset),frame:action('frame',setPose),view:action('view',value=>session.setView(value)),
   play:action('play',value=>{if(typeof value!=='boolean')throw Error('Boolean playback required');playing=value;}),
   motion:action('motion',value=>{if(typeof value!=='boolean')throw Error('Boolean motion required');motion=value;}),
   physical:action('physical',value=>{if(typeof value!=='boolean')throw Error('Boolean physical response required');physical=value;volume.setEnabled(value);publish();}),
   volume:action('volume',value=>{if(typeof value!=='boolean')throw Error('Boolean proxy visibility required');guide.visible=value;}),
   sphere:action('sphere',p=>{if(p?.length!==3||!p.every(Number.isFinite))throw Error('Finite sphere position required');probe.position.fromArray(p);host.scene.refreshPresentation?.(probeAsset);}),
   replay:action('replay',()=>{reset();stroke={time:0,steps:0};playing=true;}),
   material:action('material',p=>{if(!p||!['young','bulk'].every(k=>Number.isFinite(p[k]))||p.young<=0||p.bulk<0)throw Error('Positive stiffness and nonnegative bulk resistance required');Object.assign(parameters,p);reset();}),
  },mount({root:panel,document,invoke}){
   const status=document.createElement('div'),failure=e=>{status.textContent=e.message;};
   const checkbox=(label,operation,initial)=>{const line=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=initial;input.addEventListener('change',()=>invoke(operation,input.checked).catch(failure));line.append(input,document.createTextNode(label));panel.append(line);return input;};
   const physicalInput=checkbox(' Physical response','physical',physical),motionInput=checkbox(' Retained clip · holds at end','motion',motion),playInput=checkbox(' Simulate','play',playing);checkbox(' Show provisional volume','volume',false);
   for(const [title,op] of [['Replay press / release','replay'],['Reset','reset']]){const b=document.createElement('button');b.textContent=title;b.onclick=()=>invoke(op).catch(failure);panel.append(b);}
   const help=document.createElement('p');help.textContent='Move the blue sphere with the scene gizmo. Physics off is the unchanged skinning control. This is a fixed-step material preview, not real-time performance evidence.';panel.append(help,status);
   refresh=()=>{playInput.checked=playing;motionInput.checked=motion;physicalInput.checked=physical;status.textContent=error??`Frame ${frame} · step ${stepCount} · volume ${(volume.read().volumeRatio*100).toFixed(1)}%`;};refresh();
  }};
 },
};
