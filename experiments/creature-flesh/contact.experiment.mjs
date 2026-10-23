import * as THREE from '../../lib/three.core.js';
import {LineBasicNodeMaterial} from '../../lib/three.webgpu.js';
import {storage,attribute} from '../../lib/three.tsl.js';
import {loadFullBodySources} from '../creature-motion/full-body-source.mjs';
import {createGivenPaletteMotion} from '../creature-motion/given-palette-motion.mjs';
import {createGpuSkinDeformer} from '../creature-motion/gpu-skin-deformer.mjs';
import {skinTransport,transportDualQuaternions} from '../../hindquarter-live-core.mjs';
import {registerExportGeometrySnapshot} from '../../scene-export-geometry.mjs';
import {createGpuFleshVolume} from './gpu-volume.mjs';
import {addFleshOffsets,torsoNodeWeights} from './torso.mjs';
import {prepareSmoothFleshEmbedding} from './embedding.mjs';

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
  const adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame});
  const parameters={young:inputs.young??30,bulk:inputs.bulk??100},volume=createGpuFleshVolume(prepared,parameters),skins=new Map();
  let interpolation=inputs.interpolation??'linear';
  function skinFor(mode){
   if(!['linear','smooth'].includes(mode))throw Error('Skin transfer must be linear or smooth');
   if(skins.has(mode))return skins.get(mode);
   const embedding=mode==='smooth'?prepareSmoothFleshEmbedding(prepared):prepared,geometry=new THREE.BufferGeometry();
   geometry.setAttribute('position',new THREE.Float32BufferAttribute(data.rest,3));geometry.setIndex(new THREE.BufferAttribute(data.triangles,1));geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
   const deformer=createGpuSkinDeformer({geometry,...data,channels:data.manifest.channels.length,physical:embedding,physicalAttribute:volume.attribute}),entry={embedding,geometry,deformer};skins.set(mode,entry);return entry;
  }
  let {geometry,deformer,embedding}=skinFor(interpolation);
  const placement=new THREE.Group();placement.name='Creature · physical flank';placement.userData.kaminosFrameContentOnly=true;
  const root=new THREE.Group();root.name='Retained rig motion';placement.add(root);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:0xd6b17c,roughness:.72,side:THREE.DoubleSide}));mesh.castShadow=true;mesh.receiveShadow=true;mesh.frustumCulled=false;mesh.userData.kaminosDynamicGeometry=true;root.add(mesh);
  const probe=new THREE.Mesh(new THREE.SphereGeometry(1,24,16),new THREE.MeshStandardMaterial({color:0x497f9b,roughness:.6,transparent:true,opacity:.35}));probe.name='Contact sphere · move into flank';probe.castShadow=true;probe.receiveShadow=true;
  const guideGeometry=new THREE.BufferGeometry(),guideMaterial=new LineBasicNodeMaterial({color:0x30ced4,transparent:true,opacity:.55,depthTest:false}),guide=new THREE.LineSegments(guideGeometry,guideMaterial);guide.frustumCulled=false;
  guide.name='Physical volume · provisional proxy';Object.assign(guide.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true});guide.visible=false;root.add(guide);
  const edges=new Set();for(const t of prepared.tetrahedra)for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){const pair=[t[a],t[b]].sort((x,y)=>x-y);edges.add(pair.join(','));}
  const edgeIds=[...edges].map(s=>s.split(',').map(Number));guideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(new Float32Array(edgeIds.length*6),3));
  guideGeometry.setAttribute('physicalNode',new THREE.Uint32BufferAttribute(edgeIds.flat(),1));
  const guideNode=attribute('physicalNode','uint');guideMaterial.positionNode=storage(volume.targetAttribute,'vec4',prepared.positions.length).toReadOnly().element(guideNode).xyz.add(storage(volume.attribute,'vec4',prepared.positions.length*2+1).toReadOnly().element(guideNode).xyz);
  const nodeRest=Float32Array.from(prepared.positions.flat()),nodeWeights=torsoNodeWeights(prepared,data.manifest.channels),identity=new THREE.Matrix4().toArray();
  let session,bodyAsset,probeAsset,unsubscribe,disposed=false,playing=false,motion=false,physical=true,frame=0,stepCount=0,poseKey='',palette,offsets=prepared.positions.map(()=>[0,0,0]),mirror=null,mirrorKey='',stroke=null,error=null,groundHeight=null,restoreGround=()=>{},refresh=()=>{},gpuValidated=false,validationStarted=false,capturePending=null,snapshotEpoch=-1,accumulator=0,lastRotations=null,currentRotations=null;
  const dt=1/60,profile=prepared.construction.profile[Math.floor(prepared.construction.sections/2)],radius=profile.radius[0]*.5;
  probe.scale.setScalar(radius);
  let localStart,pressDirection;
  function seatStroke(){
   const c=prepared.construction.crossSection,m=(c-1)/2,k=Math.floor(prepared.construction.sections/2),points=volume.targets(),surface=points[(k*c+m)*c+c-1],center=points[(k*c+m)*c+m],delta=surface.map((v,a)=>v-center[a]),length=Math.hypot(...delta);
   if(!(length>0))throw Error('Posed flank has no outward contact direction');
   pressDirection=delta.map(v=>v/length);localStart=surface.map((v,a)=>v+pressDirection[a]*radius*1.1);
  }
  function setPose(index){
   if(!Number.isInteger(index)||index<0||index>=adapter.frames)throw Error('Source frame outside retained clip');
   const pose=adapter.frame(index),byName=new Map(pose.bones.map(b=>[b.name,b.skinMatrix])),next=[identity,...data.manifest.channels.slice(1).map(name=>byName.get(name))];
   const key=next.flat().join(',');if(key!==poseKey){
    const points=skinTransport(nodeRest,nodeWeights,next),{real}=transportDualQuaternions(next),C=next.length;
    currentRotations=prepared.positions.map((_,i)=>{let dominant=0;for(let j=1;j<C;j++)if(nodeWeights[i*C+j]>nodeWeights[i*C+dominant])dominant=j;const q=[0,0,0,0];for(let j=0;j<C;j++){const sign=real[j].reduce((s,x,k)=>s+x*real[dominant][k],0)<0?-1:1;for(let k=0;k<4;k++)q[k]+=sign*nodeWeights[i*C+j]*real[j][k];}const norm=Math.hypot(...q);return new THREE.Quaternion(q[1]/norm,q[2]/norm,q[3]/norm,q[0]/norm);});
    const delta=currentRotations.map((q,i)=>{const r=lastRotations?q.clone().multiply(lastRotations[i].clone().invert()):new THREE.Quaternion();return[r.w,r.x,r.y,r.z];});
    volume.setTargets(Array.from({length:prepared.positions.length},(_,i)=>Array.from(points.subarray(i*3,i*3+3))),delta);deformer.update(next);palette=next;poseKey=key;
   }
   root.matrixAutoUpdate=false;root.matrix.fromArray(pose.actorMatrix);root.matrixWorldNeedsUpdate=true;frame=index;placement.updateMatrixWorld(true);
  }
  function putProbe(local){probe.position.copy(root.localToWorld(new THREE.Vector3(...local)));probe.updateMatrixWorld(true);}
  function publish(){deformer.invalidate();session?.redraw();}
  async function capture(){
   const key=poseKey,result=await volume.snapshot();
   if(result.epoch===volume.read().epoch&&key===poseKey){offsets=result.offsets;snapshotEpoch=result.epoch;refresh();}
   return result;
  }
  mesh.onBeforeRender=renderer=>{
   volume.bind(renderer);deformer.flush(renderer);
   if(!validationStarted){validationStarted=true;volume.validate().then(()=>{gpuValidated=true;session?.redraw();}).catch(e=>{error=e.message;playing=false;refresh();});}
   if(gpuValidated&&!playing&&snapshotEpoch!==volume.read().epoch&&!capturePending){capturePending=capture().catch(e=>{error=e.message;playing=false;refresh();}).finally(()=>{capturePending=null;});}
  };
  function currentGeometry(){
   const key=poseKey+':'+volume.read().epoch;if(mirror&&key===mirrorKey)return mirror;
   if(stepCount>0&&snapshotEpoch!==volume.read().epoch)throw Error('Pause and capture the GPU body before a current-shape CPU export');
   const next=new THREE.BufferGeometry(),points=addFleshOffsets(skinTransport(data.rest,data.weights,palette),embedding,offsets);
   next.setAttribute('position',new THREE.BufferAttribute(points,3));next.setIndex(new THREE.BufferAttribute(data.triangles,1));next.computeVertexNormals();next.computeBoundingBox();next.computeBoundingSphere();mirror?.dispose();mirror=next;mirrorKey=key;return next;
  }
  const raycast=mesh.raycast;mesh.raycast=function(...args){if(stepCount>0&&snapshotEpoch!==volume.read().epoch)return;const draw=mesh.geometry;try{mesh.geometry=currentGeometry();return raycast.apply(this,args);}finally{mesh.geometry=draw;}};
  registerExportGeometrySnapshot(mesh,currentGeometry);
  function read({geometry:includeGeometry=false}={}){
   const result={route:'accepted-all-influences-dq-plus-gpu-torso-elastic',proxyAttachment:'section-shared-pelvis-lumbar-chest-v1',interpolation,source:data.source,preparedSha256:inputs.prepared_sha256,frame,steps:stepCount,clip:{fps:adapter.fps,frames:adapter.frames},physical,motion,playing,gpuValidated,clock:{kind:'host-time-fixed-step-gpu',timeStep:dt,seconds:stepCount*dt,pendingSeconds:accumulator},volume:volume.read(),deformer:deformer.read(),cpuShape:{snapshotEpoch,current:snapshotEpoch===volume.read().epoch,picking:playing?'pause-for-exact-physical-picking':'snapshot'},sphere:{id:probeAsset?.id,position:probe.position.toArray(),radius:probe.scale.x},body:{id:bodyAsset?.id,vertices:data.manifest.vertices,triangles:data.manifest.triangles},groundReference:{height:groundHeight,contactSolver:false},stroke:stroke&&{seconds:stroke.time},error,view:session?.readView()};
   if(includeGeometry){result.vertices=Array.from(currentGeometry().attributes.position.array);}return result;
  }
  function advance(count=1){
   if(!Number.isSafeInteger(count)||count<1)throw Error('Positive whole physical step count required');
   if(disposed)throw Error('Contact experiment disposed');
   for(let i=0;i<count;i++){
    if(motion){const phase=(stepCount+1)*dt*adapter.fps;setPose(Math.min(adapter.frames-1,Math.floor(phase+4*Number.EPSILON*Math.max(1,phase))));}
    if(stroke){stroke.time=++stroke.steps*dt;const t=stroke.time,amount=t<.3?t/.3:t<.45?1:t<.6?(.6-t)/.15:0;putProbe(localStart.map((v,a)=>v-pressDirection[a]*radius*.75*amount));if(t>=2){stroke=null;playing=false;}}
    placement.updateMatrixWorld(true);probe.updateMatrixWorld(true);const center=root.worldToLocal(probe.getWorldPosition(new THREE.Vector3())).toArray(),scale=probe.getWorldScale(new THREE.Vector3()),bodyScale=root.getWorldScale(new THREE.Vector3());
    if(Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-5)throw Error('Contact primitive requires a uniformly scaled sphere');
    if(!(bodyScale.x>0)||Math.max(bodyScale.x,bodyScale.y,bodyScale.z)-Math.min(bodyScale.x,bodyScale.y,bodyScale.z)>1e-5)throw Error('Physical body requires positive uniform authored scale');
    volume.setSphere({center,radius:scale.x/bodyScale.x});volume.step(dt);lastRotations=currentRotations.map(q=>q.clone());stepCount++;
   }
   publish();refresh();return read();
  }
  function reset(){volume.reset();volume.setEnabled(physical);poseKey='';stepCount=0;accumulator=0;stroke=null;lastRotations=null;offsets=prepared.positions.map(()=>[0,0,0]);snapshotEpoch=-1;setPose(0);seatStroke();putProbe(localStart);publish();return read();}
  async function dispose(){if(disposed)return;disposed=true;unsubscribe?.();restoreGround();refresh=()=>{};await capturePending;mirror?.dispose();for(const entry of skins.values()){entry.deformer.dispose();if(entry.geometry!==geometry)entry.geometry.dispose();}volume.dispose();if(session)await session.dispose();else{geometry.dispose();mesh.material.dispose();probe.geometry.dispose();probe.material.dispose();guideGeometry.dispose();guide.material.dispose();}if(globalThis.window?.kaminosCreatureFlesh===diagnostic)delete globalThis.window.kaminosCreatureFlesh;}
  const diagnostic={read,advance,geometry:currentGeometry,physicalState:capture,gpu:()=>deformer.readback()};
  try{
   session=await host.scene.open();setPose(0);seatStroke();putProbe(localStart);publish();
   bodyAsset=await session.attach(placement,{owned:true,metadata:{label:placement.name,type:'glb',source:{...data.source,physicalPreparation:inputs.prepared_sha256}}});
   probeAsset=await session.attach(probe,{owned:true,metadata:{label:probe.name,type:'mesh',source:'kinematic-sphere-contact-control'}});
   const ground=host.controls.document.getElementById('composition-ground-height');if(!ground)throw Error('Shared reference-ground control unavailable');
   const previousGround=ground.value;groundHeight=currentGeometry().boundingBox.clone().applyMatrix4(mesh.matrixWorld).min.y-.01;const presentedGround=String(groundHeight);ground.value=presentedGround;ground.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(ground.value===presentedGround){ground.value=previousGround;ground.dispatchEvent(new Event('change'));}};
   const center=new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3()),direction=new THREE.Vector3(...prepared.construction.right).multiplyScalar(5).add(new THREE.Vector3(0,1.4,2));session.setView(inputs.view??{position:center.clone().add(direction).toArray(),target:center.toArray()});if(!inputs.view)host.scene.frame([placement,probe]);
   unsubscribe=session.onFrame(({deltaSeconds})=>{if(!playing||!gpuValidated)return;try{accumulator+=deltaSeconds;while(accumulator>=dt&&playing){advance();accumulator-=dt;}}catch(e){error=e.message;playing=false;record({kind:'creature-flesh.step',phase:'failed',message:e.message,state:read()});refresh();}});
   if(globalThis.window)globalThis.window.kaminosCreatureFlesh=diagnostic;
  }catch(e){await dispose();throw e;}
  const action=(kind,fn)=>(...args)=>{const result=fn(...args);session.redraw();refresh();record({kind:'creature-flesh.'+kind,phase:'applied',state:read()});return result??read();};
  return{read,dispose,operations:{
   advance:action('advance',advance),reset:action('reset',reset),frame:action('frame',setPose),view:action('view',value=>session.setView(value)),
   play:action('play',value=>{if(typeof value!=='boolean')throw Error('Boolean playback required');playing=value;accumulator=0;}),
   motion:action('motion',value=>{if(typeof value!=='boolean')throw Error('Boolean motion required');motion=value;}),
   physical:action('physical',value=>{if(typeof value!=='boolean')throw Error('Boolean physical response required');physical=value;volume.setEnabled(value);publish();}),
   volume:action('volume',value=>{if(typeof value!=='boolean')throw Error('Boolean proxy visibility required');guide.visible=value;}),
   interpolation:action('interpolation',mode=>{const next=skinFor(mode);next.deformer.update(palette);({geometry,deformer,embedding}=next);mesh.geometry=geometry;interpolation=mode;mirrorKey='';publish();}),
   sphere:action('sphere',p=>{if(p?.length!==3||!p.every(Number.isFinite))throw Error('Finite sphere position required');probe.position.fromArray(p);host.scene.refreshPresentation?.(probeAsset);}),
   replay:action('replay',()=>{reset();stroke={time:0,steps:0};playing=true;}),
   material:action('material',p=>{if(!p||!['young','bulk'].every(k=>Number.isFinite(p[k]))||p.young<=0||p.bulk<0)throw Error('Positive stiffness and nonnegative bulk resistance required');Object.assign(parameters,p);volume.setMaterial(p);reset();}),
  },mount({root:panel,document,invoke}){
   const status=document.createElement('div'),failure=e=>{status.textContent=e.message;};
   const checkbox=(label,operation,initial)=>{const line=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=initial;input.addEventListener('change',()=>invoke(operation,input.checked).catch(failure));line.append(input,document.createTextNode(label));panel.append(line);return input;};
   const physicalInput=checkbox(' Physical response','physical',physical),motionInput=checkbox(' Retained clip · holds at end','motion',motion),playInput=checkbox(' Simulate','play',playing);checkbox(' Show provisional volume','volume',false);
   const transferLabel=document.createElement('label'),transfer=document.createElement('select');transferLabel.textContent='Skin transfer';transfer.setAttribute('aria-label','Skin transfer');for(const [value,title]of [['linear','Linear cage'],['smooth','Smooth cage']]){const option=document.createElement('option');option.value=value;option.textContent=title;transfer.append(option);}transfer.value=interpolation;transfer.onchange=()=>invoke('interpolation',transfer.value).catch(failure);transferLabel.append(transfer);panel.append(transferLabel);
   for(const [title,op] of [['Replay press / release','replay'],['Reset','reset']]){const b=document.createElement('button');b.textContent=title;b.onclick=()=>invoke(op).catch(failure);panel.append(b);}
   const help=document.createElement('p');help.textContent='Move the blue sphere with the scene gizmo. Physics off is the unchanged skinning control. Replay presses in 0.3 s, releases by 0.6 s, then lets the body settle. GPU physics follows host time. Pause for exact body selection/export.';panel.append(help,status);
   refresh=()=>{playInput.checked=playing;motionInput.checked=motion;physicalInput.checked=physical;transfer.value=interpolation;const snapshot=volume.read().snapshot;status.textContent=error??`GPU physics · frame ${frame} · step ${stepCount}${snapshot?.current?' · volume '+(snapshot.volumeRatio*100).toFixed(1)+'%':' · live GPU state'}`;};refresh();
  }};
 },
};
