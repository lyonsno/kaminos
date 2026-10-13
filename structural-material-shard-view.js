import * as THREE from 'three/webgpu';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RotateCcw,Pause,Play,Hand,createElement} from 'https://cdn.jsdelivr.net/npm/lucide@0.468.0/+esm';
import {loadStoneAssets,disposeStoneAssets} from './structural-material-arch-stones.js';
import {createSolidResident,SOLID_RESIDENT_ROUTE} from './structural-material-solid-resident.js';
import {materialComponents} from './structural-material-solid-surface.mjs';
import {bindComponentAffineField,applyComponentAffineField} from './structural-material-component-affine.mjs';
import {bindComponentTransport,applyComponentTransport,componentTransportQuaternion,COMPONENT_TRANSPORT_ROUTE} from './structural-material-component-transport.mjs';
import {createGpuTransport} from './structural-material-component-gpu-transport.js';
import {contactPatch,selectStressRelease} from './structural-material-stress-release.mjs';
import {createShardGeometry} from './structural-material-shard-render.js';
import {splitMaterialInterior,transferContactPatch,INTERIOR_CUT_ROUTE} from './structural-material-interior-cut.mjs';
import {prepareSeparatedTopology,prepareSolidTopology,packSolidTopology} from './structural-material-solid-topology.mjs';
import {buildFixedCellShell,applyFixedCellShell,boundedCellAnchor,applyBoundedFragmentBinding,elasticSupportBonds,BOUNDED_FRAGMENT_ROUTE} from './structural-material-bounded-fragments.mjs';
import {createGpuBoundedSurface} from './structural-material-bounded-gpu.js';
import {configureStoneRegime} from './structural-material-stone-regime.mjs';
import {stoneObservationStamp} from './structural-material-observation-economics.mjs';
import {createBoundedResidentGrip} from './structural-material-bounded-grip.js';
import {createBoundedElasticSupport,ELASTIC_SUPPORT_ROUTE} from './structural-material-bounded-support.js';
import {validateStoneViewportHost} from './structural-material-viewport-host.mjs';
import {createFinitePlaneContact} from './structural-material-finite-plane-gpu.js';
import {FINITE_PLANE_ROUTE} from './structural-material-finite-plane.mjs';

export async function createStoneRuntime({host=null,ui=document,parameters=new URLSearchParams(location.search),onInput}={}){
if(host)validateStoneViewportHost(host);
const interiorSplit=parameters.get('interior')==='split';
const bounded=parameters.get('fracture')==='bounded';
const connectivity=parameters.get('connectivity')??'literal-edge';
const elasticSupport=connectivity==='elastic-support';
const energyKernel=parameters.get('energyKernel')??'auto';
const $=id=>ui.getElementById(id),route=bounded?'kaminos.picked-stone.bounded-shards.webgpu.v0':interiorSplit?'kaminos.picked-stone.interior-shards.webgpu.v0':'kaminos.picked-stone.stress-shards.webgpu.v0',inputs=[],events=[],timings=[];
for(const id of ['reset','pause','release','threshold','thresholdValue','route','stats','timing','failure',...(!host?['viewport']:[])])if(!$(id))throw Error(`Stone control ${id} is unavailable`);
const configuration={timeStep:1/60,iterations:12,lineSearchTrials:8,gravity:0,damping:.98,floor:-10,patchRadius:.28,stressRadius:.16,reconstructionRadius:.45,gripStiffness:200000,volumeBarrier:0};
const fallAndLand=bounded&&parameters.get('dynamics')!=='off';
const floorHeight=host?.floorHeight??(host?0:-.85),contactResponse={friction:.65,restitution:.08};
if(!Number.isFinite(floorHeight))throw Error('Finite shared-scene floor height required');
if(fallAndLand){configuration.gravity=9.81;configuration.floor=-1e20;}
const affineComparison=parameters.get('surface')==='affine';
let device,resident,surface,body,manifest,arrays,observed,components,volumes,pieces=[],gesture=null,paused=false,busy=false,pendingPick=false,finishing=false,pickTask=null,gestureGeneration=0,failure=null,lastPick=null,latestSelection=null,frames=0;
let initialBody,interiorState,materialRegime,surfaceObservation=null,lastPresentation=null,residentGrip=null,residentSupport=null,residentContact=null,pointerContact=null,interactionObservation=null,ownerExperiment=null,assets=[],closing=false,frameRequest=null,unsubscribeFrames=null,disposal=null;
let createPlaneFractureSurface;
const lifetime=new AbortController(),container=host?.scene??new THREE.Scene(),scene=new THREE.Group();scene.name='Stone fracture';container.add(scene);if(!host)container.background=new THREE.Color('#111718');
if(host?.position)scene.position.fromArray(host.position);
const camera=host?.camera??new THREE.PerspectiveCamera(36,innerWidth/innerHeight,.01,100);if(!host)camera.position.set(2.3,1.25,3.6).multiplyScalar(Math.max(1,1.2/camera.aspect));
const renderer=host?.renderer??new THREE.WebGPURenderer({antialias:true});if(!host){renderer.setPixelRatio(devicePixelRatio);renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;$('viewport').append(renderer.domElement);}
const controls=host?.controls??new OrbitControls(camera,renderer.domElement),previousControlsEnabled=controls.enabled;if(!host){controls.target.set(0,0,0);controls.enableDamping=false;controls.mouseButtons.LEFT=THREE.MOUSE.ROTATE;}
if(!host){scene.add(new THREE.HemisphereLight('#eef5f1','#414644',2.5));const key=new THREE.DirectionalLight('#ffffff',3.2);key.position.set(1,3,4);scene.add(key);const rim=new THREE.DirectionalLight('#abc7d0',1.3);rim.position.set(-2,1,-3);scene.add(rim);}
const support=new THREE.Mesh(new THREE.BoxGeometry(.12,.78,.72),new THREE.MeshStandardMaterial({color:'#657e89',roughness:.65,metalness:.35}));support.position.x=-1.26;scene.add(support);
const ground=fallAndLand?new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:'#505956',roughness:1,metalness:0,side:THREE.DoubleSide})):null;
if(ground){ground.name='Stone contact floor';ground.rotation.x=-Math.PI/2;ground.position.y=floorHeight;container.add(ground);}
const marker=new THREE.Mesh(new THREE.SphereGeometry(.026,16,12),new THREE.MeshBasicMaterial({color:'#ff805b'}));marker.visible=false;scene.add(marker);
const arrow=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:'#e9bb63'}));arrow.visible=false;scene.add(arrow);
const capMaterial=new THREE.MeshStandardMaterial({color:'#d3b999',roughness:1,side:THREE.DoubleSide});
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),normal=new THREE.Vector3(),plane=new THREE.Plane();let skinMaterial;
const icon=(id,shape)=>{$(id).replaceChildren(createElement(shape));};icon('reset',RotateCcw);icon('pause',Pause);icon('release',Hand);
const stamp=(kind,data)=>{inputs.push({kind,data,at:performance.now(),steps:observed?.steps,epoch:observed?.damageEpoch});ownerExperiment?.recordInput(kind,data,experimentStatus());onInput?.({kind,data,effective:experimentStatus()});};
const positions=state=>Array.from({length:state.model.points},(_,i)=>state.state.slice(i*16+4,i*16+7));
const cameraState=()=>{camera.updateMatrixWorld(true);return{position:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),near:camera.near,far:camera.far,fov:camera.fov};};
const fail=e=>{failure={message:e.message,stack:e.stack};$('failure').textContent=e.message;gesture=null;controls.enabled=closing?previousControlsEnabled:true;};
const settle=async(includeInput=false)=>{while(busy||includeInput&&(pendingPick||finishing)){if(failure)throw new Error(failure.message);await new Promise(r=>setTimeout(r,5));}};
function invalidateMaterialObservation(reason){if(!bounded||!observed)return;observed={...observed,observation:{kind:'submitted',stressCurrent:false,readbackBytes:0,reason}};surfaceObservation=null;interactionObservation=null;}
function experimentStatus(){
 const submitted=resident?.submittedState();
 return {route,backend:'webgpu',adapterFallback:false,connectivity:bounded?connectivity:null,runId:submitted?.runId,submittedSteps:submitted?.steps,
  observation:'submission-metadata-not-physical-observation',paused,busy,pendingPick,finishing,gripping:gesture?.phase??null,failure:closing?{message:'Stone runtime is disposed'}:failure&&{message:failure.message},
  threshold:Number($('threshold').value),configuration:{...configuration},contact:fallAndLand?{route:FINITE_PLANE_ROUTE,worldPlane:{normal:[0,1,0],offset:floorHeight},...contactResponse,representation:'live-local-cell-conservative-envelope',selfContact:false}:null,materialRegime:materialRegime&&{name:materialRegime.name},
  sourceSha256:manifest?.sourceSha256,preparationSha256:manifest?.preparationSha256,model:observed?.model&&{...observed.model},camera:cameraState()};
}
async function waitSubmitted({gpu=true}={}){if(typeof gpu!=='boolean')throw Error('Explicit GPU completion policy required');await settle(true);if(gpu)await device.queue.onSubmittedWorkDone();}
function inside(piece,p){return piece.halfspaces.every(h=>h.side*(h.normal.reduce((s,v,k)=>s+v*Math.fround(p[k]),0)-h.offset)>=0);}
function makeMeshes(sourcePieces=surface.witness().pieces,surfaceResident=resident){
 const staged=[],current=positions(observed);
 try{for(const piece of sourcePieces){
  const nodes=body.positions.flatMap((p,i)=>(interiorSplit?interiorState.nodeDomains[i]===piece.id:inside(piece,p))?[i]:[]),membership=new Set(nodes.map(i=>components[i]));if(membership.size!==1)throw new Error('Visible piece must identify one surviving material component');const component=[...membership][0];
  const g=piece.geometry,vertices=Array.from({length:g.properties.length/g.numProp},(_,i)=>g.properties.slice(i*g.numProp,i*g.numProp+3)),binding=(affineComparison?bindComponentAffineField:bindComponentTransport)(body.positions,vertices,{components,component,volumes,radius:configuration.reconstructionRadius});
  const geometry=createShardGeometry(g),mesh=new THREE.Mesh(geometry,[skinMaterial,capMaterial]);mesh.userData.pieceId=piece.id;mesh.frustumCulled=false;const candidate={...piece,nodes,component,binding,mesh};staged.push(candidate);deformPiece(candidate,current);if(!affineComparison){candidate.gpu=createGpuTransport(renderer,surfaceResident,binding,g.indices,[skinMaterial,capMaterial]);mesh.material=candidate.gpu.materials;candidate.gpu.setQuaternion(componentTransportQuaternion(binding,current,{components}));}
 }}catch(error){for(const p of staged){p.gpu?.dispose();p.mesh.geometry.dispose();}throw error;}
 // No asynchronous boundary or rest-pose mesh is exposed during replacement.
 for(const p of pieces){scene.remove(p.mesh);p.gpu?.dispose();p.mesh.geometry.dispose();}pieces=staged;pieces[0]?.gpu?.captureState();for(const p of pieces)scene.add(p.mesh);
}
async function makeBoundedMesh(){
 const piece=buildFixedCellShell({...body,bonds:observed.bonds}),geometry=createShardGeometry(piece.geometry),mesh=new THREE.Mesh(geometry,[skinMaterial,capMaterial]),candidate={...piece,mesh};mesh.userData.pieceId=0;mesh.frustumCulled=false;
 try{deformPiece(candidate,positions(observed));candidate.gpu=await createGpuBoundedSurface(renderer,resident,piece.binding,piece.geometry.indices,[skinMaterial,capMaterial],residentSupport?{connectionBuffer:residentSupport.buffer}:{});mesh.material=candidate.gpu.materials;candidate.gpu.captureState();}catch(e){candidate.gpu?.dispose();geometry.dispose();throw e;}
 for(const p of pieces){scene.remove(p.mesh);p.gpu?.dispose();p.mesh.geometry.dispose();}pieces=[candidate];scene.add(mesh);
 if(fallAndLand){residentContact=await createFinitePlaneContact(resident,piece.binding,{ownershipBuffer:candidate.gpu.ownershipBuffer,connectionBuffer:residentSupport?.buffer??resident.bondBuffer()});applyFloorContact();await resident.enableFiniteFloor(true);}
}
function applyFloorContact(){
 if(!residentContact)return;scene.updateWorldMatrix(true,false);
 const localPlane=new THREE.Plane(new THREE.Vector3(0,1,0),-floorHeight).applyMatrix4(new THREE.Matrix4().copy(scene.matrixWorld).invert());
 const up=new THREE.Vector3(0,1,0).transformDirection(scene.matrixWorld);if(up.distanceTo(new THREE.Vector3(0,1,0))>1e-6)throw Error('Current gravity requires an upright stone material frame');
 residentContact.apply({normal:localPlane.normal.toArray(),offset:-localPlane.constant,...contactResponse});
}
function acquiredConnections(){return elasticSupport?elasticSupportBonds(body.tetrahedra,observed.bonds,observed.stresses):observed.bonds;}
function deformPiece(p,current){const apply=p.binding.route===BOUNDED_FRAGMENT_ROUTE?applyBoundedFragmentBinding:p.binding.route===COMPONENT_TRANSPORT_ROUTE?applyComponentTransport:applyComponentAffineField,deformed=p.binding.fixedCellShell?applyFixedCellShell(p.binding,current,acquiredConnections()):apply(p.binding,current,{components});const a=p.mesh.geometry.attributes.position;for(let i=0;i<p.geometry.indices.length;i++)a.setXYZ(i,...deformed[p.geometry.indices[i]]);a.needsUpdate=true;p.mesh.geometry.computeVertexNormals();p.mesh.geometry.computeBoundingSphere();p.mesh.geometry.computeBoundingBox();}
function synchronizePicking(){if(!observed)return;const current=positions(observed);for(const p of pieces)deformPiece(p,current);}
async function observeInteraction(){
 if(!residentGrip)return;interactionObservation={...await residentGrip.read(),runId:observed.runId,steps:observed.steps,source:'explicit-native-grip-readback'};
 const groups=new Map();for(const entry of interactionObservation.fractureHistory){if(entry.step===null)continue;const key=`${entry.step}:${entry.threshold}`;if(!groups.has(key))groups.set(key,{id:`${observed.runId}:${key}`,kind:'resident-edge-normal-tensile-release-v0',released:[],runId:observed.runId,steps:entry.step,threshold:entry.threshold,mechanicalPoints:observed.model.points,mechanicalElements:observed.model.elements});groups.get(key).released.push(entry.edge);}
 events.splice(0,events.length,...[...groups.values()].sort((a,b)=>a.steps-b.steps));
}
async function observeSurface(){surfaceObservation=null;interactionObservation=null;if(affineComparison)return;synchronizePicking();const records=[];for(const p of pieces)records.push({pieceId:p.id,route:p.gpu.route,runId:observed.runId,step:observed.steps,gpu:await p.gpu.readPositions(),reference:Array.from(p.mesh.geometry.attributes.position.array)});surfaceObservation={source:'native-webgpu-transport-compute-readback',runId:observed.runId,steps:observed.steps,pieces:records};await observeInteraction();}
function present(){if(!observed)return;const current=bounded?null:positions(observed);for(const p of pieces){if(p.gpu&&!bounded)p.gpu.setQuaternion(componentTransportQuaternion(p.binding,current,{components}));else if(!p.gpu)deformPiece(p,current);}pieces[0]?.gpu?.captureState();
 $('stats').textContent=bounded&&observed.observation?.kind==='submitted'?`GPU-resident material | submitted step ${observed.steps}`:`${bounded?new Set(components).size:pieces.length} ${bounded?'components':'pieces'} | ${interiorSplit?`${interiorState.epoch} interior cuts`:observed.bonds.filter((v,i)=>i%4===2&&v===0).length+' released bonds'} | step ${interiorSplit?(interiorState.stepOffset??0)+observed.steps:observed.steps}`;
}
async function loadVerified(url,expected){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`Input ${url}: HTTP ${r.status}`);const bytes=await r.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(expected&&digest!==expected)throw new Error(`Input drift: ${url}`);return bytes;}
async function reset(){pendingPick=true;pointerContact=null;gestureGeneration++;await settle();busy=true;try{
 gesture=null;controls.enabled=true;residentContact?.dispose();residentContact=null;residentGrip?.dispose();residentGrip=null;residentSupport?.dispose();residentSupport=null;resident?.dispose();surface?.dispose();let initialArrays=arrays,initialModel=manifest.model;
 if(interiorSplit){body=initialBody;const configured=configureStoneRegime(manifest,arrays,new URLSearchParams(location.search).get('material')??'stiff-brittle-v1');materialRegime=configured.profile;configuration.volumeBarrier=materialRegime.volumeBarrier;initialArrays=configured.arrays;initialModel=configured.model;}
 if(bounded){const model=prepareSolidTopology({status:'passed',route:'ftetwild-cpu-wildmeshing-0.4.1',positions:body.positions,tetrahedra:body.tetrahedra,volume:manifest.model.volume},{...manifest.material,kind:'graph',young:100000,damageLaw:'event-frozen-isotropic-degradation-v1'});initialArrays=packSolidTopology(model);initialModel={kind:'graph',constitutiveLayout:model.constitutiveLayout,bufferLayout:model.bufferLayout,points:model.positions.length,elements:model.elements.length,bonds:model.bonds.length,colorCount:model.colorCount};materialRegime={name:'bounded-stiff-brittle-v1',material:model.material,threshold:180,volumeBarrier:0,claim:'Provisional homogeneous brittle stone, not calibrated material'};}
 resident=await createSolidResident(device,initialModel,initialArrays,{energyKernel});const min=Math.min(...body.positions.map(p=>p[0]));await resident.pin(body.positions.flatMap((p,i)=>p[0]<min+.035?[i]:[]));observed=await resident.read();
 if(elasticSupport){residentSupport=await createBoundedElasticSupport(resident);residentSupport.update();materialRegime={...materialRegime,name:'bounded-stiff-brittle-elastic-support-v1',connectivity:ELASTIC_SUPPORT_ROUTE};}
 surface=bounded?{dispose(){}}:await createPlaneFractureSurface(body.geometry,{sourceSha256:manifest.sourceSha256});components=materialComponents(observed.model.points,acquiredConnections());volumes=body.positions.map((_,i)=>observed.state[i*16+3]/manifest.material.density);if(interiorSplit)interiorState={route:INTERIOR_CUT_ROUTE,law:'stvk-log-volume-barrier-v0',epoch:0,mesh:{positions:body.positions,tetrahedra:body.tetrahedra,domains:body.tetrahedra.map(()=>0)},nodeDomains:body.positions.map(()=>0),transfers:[],materialRuns:[observed.runId]};events.length=0;latestSelection=null;marker.visible=false;arrow.visible=false;if(bounded)await makeBoundedMesh();else makeMeshes();present();failure=null;$('failure').textContent='';stamp('reset',{});
 if(bounded)residentGrip=await createBoundedResidentGrip(resident,observed.bonds,residentSupport?{connectionBuffer:residentSupport.buffer,supportAware:true}:{});
 }finally{busy=false;pendingPick=false;}}
async function beginPick(pieceId,point,faceIndex){
 if(failure)throw new Error('Material is unavailable for a new grip');const original=pieces.find(p=>p.id===pieceId);if(!original)throw new Error('Picked piece no longer exists');
 if(bounded){
  if(!residentGrip)throw new Error('Resident bounded contact unavailable during reset');
  const cellAnchor=boundedCellAnchor(original.binding,original.geometry.indices,faceIndex),generation=++gestureGeneration;
  const held={generation,phase:'capturing',pieceId,faceIndex,cellAnchor,point:[...point],displacement:[0,0,0],baselineDisplacement:[0,0,0],patchOwner:'resident-connectivity'};
  gesture=held;pendingPick=true;controls.enabled=false;marker.position.fromArray(point);marker.visible=true;await settle();if(generation!==gestureGeneration)return{status:'cancelled',generation};busy=true;
  try{invalidateMaterialObservation('resident-grip-capture');await residentGrip.begin(cellAnchor,point,configuration.patchRadius,configuration.gripStiffness);if(generation!==gestureGeneration)return{status:'cancelled',generation};held.phase='active';lastPick={requestedPieceId:pieceId,pieceId,cellAnchor,point:[...point],patchOwner:residentGrip.route};stamp('pick',lastPick);}finally{busy=false;if(generation===gestureGeneration)pendingPick=false;}return{status:'applied',generation,cellAnchor};
 }
 const cellAnchor=bounded?boundedCellAnchor(original.binding,original.geometry.indices,faceIndex):null;if(bounded)original.component=components[cellAnchor];
 let patchAtDown=contactPatch(positions(observed),point,{components,component:original.component,radius:configuration.patchRadius,pinned:body.positions.map((_,i)=>observed.state[i*16+11]===1)});const downEpoch=interiorSplit?interiorState.epoch:0;
 if(!patchAtDown.length)throw new Error('Picked material cell has no unpinned contact');
 const generation=++gestureGeneration,held={generation,phase:'capturing',pieceId,faceIndex,cellAnchor,component:original.component,point:[...point],displacement:[0,0,0],baselineDisplacement:[0,0,0],patch:patchAtDown};gesture=held;pendingPick=true;controls.enabled=false;marker.position.fromArray(point);marker.visible=true;
 await settle();if(generation!==gestureGeneration)return;if(interiorSplit)for(const migration of interiorState.transfers.slice(downEpoch))patchAtDown=transferContactPatch(patchAtDown,migration);const anchor=bounded?held.cellAnchor:patchAtDown.reduce((a,b)=>a.weight>b.weight?a:b).index,component=components[anchor],owner=pieces.find(p=>(bounded||p.component===component)&&p.nodes.includes(anchor));if(!owner)throw new Error('Picked material contact has no current visible owner');
 const surviving=patchAtDown.filter(p=>components[p.index]===component);if(!surviving.length){await release();stamp('grip-cell-support-lost',{cellAnchor,generation});return;}const sum=surviving.reduce((s,p)=>s+p.weight,0),patch=surviving.map(p=>({...p,weight:p.weight/sum}));held.pieceId=owner.id;held.component=component;busy=true;
 try{await resident.capturePatch(patch,configuration.gripStiffness);if(generation!==gestureGeneration)return;held.patch=patch;held.phase='active';lastPick={requestedPieceId:pieceId,pieceId:owner.id,component,point:[...point],patch};stamp('pick',lastPick);}finally{busy=false;if(generation===gestureGeneration)pendingPick=false;}
}
async function finishGesture(){const generation=gestureGeneration,shouldFlush=!paused,held=gesture;if(held)held.inputClosed=true;finishing=true;stamp('gesture-finish-request',{generation,shouldFlush,finalDisplacement:held?.displacement?[...held.displacement]:null});try{await pickTask;await settle();if(generation!==gestureGeneration)return;if(gesture?.phase==='active'&&shouldFlush)await advance(bounded?{evidence:false}:{});if(generation!==gestureGeneration)return;await release();}finally{finishing=false;}}
async function release(){gestureGeneration++;pendingPick=false;pointerContact=null;gesture=null;controls.enabled=true;arrow.visible=false;marker.visible=false;if(resident){invalidateMaterialObservation('resident-grip-release');await resident.release();}stamp('release',{});}
async function cutInterior(active,applied,selection){
 const target=pieces.find(p=>p.id===active.pieceId),held=active,beforeMesh=interiorState.mesh,beforeFields={positions:positions(observed),velocities:body.positions.map((_,i)=>observed.state.slice(i*16+8,i*16+11)),pinned:body.positions.map((_,i)=>observed.state[i*16+11]===1)},normal=selection.normal.map(Math.fround),offset=Math.fround(selection.offset),start=performance.now();
 const cut=splitMaterialInterior(beforeMesh,beforeFields,{targetDomain:target.id,normal,offset,children:surface.interiorChildren()}),model=prepareSeparatedTopology(cut.mesh,{...(materialRegime?.material??manifest.material),volumeBarrier:configuration.volumeBarrier}),packed=packSolidTopology(model),descriptor={kind:'graph',constitutiveLayout:model.constitutiveLayout,volumeBarrier:configuration.volumeBarrier,bufferLayout:model.bufferLayout,points:model.positions.length,elements:model.elements.length,bonds:model.bonds.length,colorCount:model.colorCount};
 for(let i=0;i<model.positions.length;i++){packed.state.set(cut.fields.positions[i],i*16+4);packed.state.set(cut.fields.velocities[i],i*16+8);packed.state[i*16+11]=Number(cut.fields.pinned[i]);packed.state.set(cut.fields.positions[i],i*16+12);}
 const prepared=performance.now();let next,transaction,previous,candidateObserved,supportRefused=false;
 try{
  next=await createSolidResident(device,descriptor,packed,{energyKernel});const nextObserved=candidateObserved=await next.read();if(nextObserved.stresses.some(s=>!s.active||s.invalid)){supportRefused=true;throw new Error('Remeshed material has invalid or absent elastic support');}
  for(let i=0;i<packed.state.length;i++)if(nextObserved.state[i]!==packed.state[i])throw new Error('Remeshed GPU state did not retain the transferred field');
  const event={...selection,id:crypto.randomUUID(),kind:'component-tensile-interior-cut-v0',normal,offset,targetPieceId:target.id,targetNodes:[...target.nodes],route:SOLID_RESIDENT_ROUTE,material:{runId:nextObserved.runId,kind:'graph',sourceSha256:manifest.sourceSha256},interior:cut.receipt,beforeRunId:observed.runId};
  transaction=surface.stageInteriorCut({...event,cut});previous={body,observed,components,volumes,interiorState,resident};
  body={...cut.mesh,geometry:initialBody.geometry};observed=nextObserved;components=materialComponents(descriptor.points,observed.bonds);volumes=body.positions.map((_,i)=>observed.state[i*16+3]/manifest.material.density);interiorState={...interiorState,epoch:interiorState.epoch+1,mesh:cut.mesh,nodeDomains:cut.nodeDomains,materialRuns:[...interiorState.materialRuns,nextObserved.runId],transfers:[...interiorState.transfers,{...cut.receipt,oldToNew:cut.oldToNew,parents:cut.parents,beforeMesh,beforeFields}],stepOffset:(interiorState.stepOffset??0)+previous.observed.steps};
  makeMeshes(transaction.pieces,next);transaction.commit();resident=next;next=null;events.push(event);previous.resident.dispose();previous=null;
  if(gesture===held){held.patch=transferContactPatch(held.patch,cut);const anchor=held.patch.reduce((a,b)=>a.weight>b.weight?a:b).index;held.component=components[anchor];held.pieceId=pieces.find(p=>p.nodes.includes(anchor)).id;held.baselineDisplacement=[...applied];await resident.capturePatch(held.patch,configuration.gripStiffness);observed=await resident.read();stamp('fracture-grip-continuation',{event:event.id,component:held.component,pieceId:held.pieceId,patch:held.patch,appliedDisplacement:applied});}
  stamp('interior-cut',{event:event.id,receipt:cut.receipt,preparationMilliseconds:prepared-start,totalMilliseconds:performance.now()-start});
 }catch(error){if(previous){({body,observed,components,volumes,interiorState,resident}=previous);}interiorState.lastFailedCut={receipt:cut.receipt,mesh:cut.mesh,fields:cut.fields,candidateState:candidateObserved??null,error:error.message};transaction?.abort();next?.dispose();
  if(supportRefused&&observed.stresses.every(s=>s.active&&!s.invalid)&&observed.state.every(Number.isFinite)){
   // A failed proposal is not a failed resident. Retain physics and grip ownership.
   held.fractureDeclined=true;interiorState.lastFailedCut.disposition='retained-material-continue';stamp('interior-cut-declined',{generation:held.generation,pieceId:target.id,epoch:interiorState.epoch,error:error.message});$('failure').textContent='Cut declined: candidate interior has invalid elastic support';return false;
  }throw error;}
}
async function advance({fracture=true,evidence=true}={}){
 if(closing)return;
 if(busy||failure)return;busy=true;try{if(bounded){await advanceBounded({fracture,evidence});return;}const active=gesture?.phase==='active'?gesture:null,applied=active&&[...active.displacement],select=Boolean(active&&fracture&&!active.fractureDeclined);if(active)await resident.movePatch(applied.map((v,k)=>v-active.baselineDisplacement[k]));const start=performance.now(),timing=await resident.step(configuration,{wait:evidence});observed=evidence?await resident.read():await resident.readFrame({stress:select});components=materialComponents(observed.model.points,observed.bonds);latestSelection=select&&gesture===active?selectStressRelease({rest:body.positions,elements:body.tetrahedra,samples:observed.stresses,components,bonds:observed.bonds,component:active.component,radius:configuration.stressRadius,threshold:Number($('threshold').value)}):null;
  // Picking must use the pose published before asynchronous cut preparation.
  if(latestSelection)present();
  if(latestSelection&&interiorSplit)await cutInterior(active,applied,latestSelection);
  else if(latestSelection){const target=pieces.find(p=>p.id===active.pieceId),before=observed.bonds,held=active;await resident.damagePlane(latestSelection.normal,latestSelection.offset,target.nodes);const after=await resident.read();const event={...latestSelection,id:crypto.randomUUID(),rest:body.positions,before,after:after.bonds,targetPieceId:target.id,targetNodes:target.nodes,route:SOLID_RESIDENT_ROUTE,material:{runId:observed.runId,kind:'graph',sourceSha256:manifest.sourceSha256}};surface.cut(event);events.push({...event,stresses:observed.stresses});observed=after;components=materialComponents(observed.model.points,observed.bonds);makeMeshes();if(gesture===held){const anchor=held.patch.reduce((a,b)=>a.weight>b.weight?a:b).index,component=components[anchor],owner=pieces.find(p=>p.component===component),patch=held.patch.filter(p=>components[p.index]===component),sum=patch.reduce((s,p)=>s+p.weight,0);held.patch=patch.map(p=>({...p,weight:p.weight/sum}));held.component=component;held.pieceId=owner.id;held.baselineDisplacement=[...applied];await resident.capturePatch(held.patch,configuration.gripStiffness);observed=await resident.read();stamp('fracture-grip-continuation',{event:event.id,component,pieceId:owner.id,patch:held.patch,appliedDisplacement:applied});}}
  present();surfaceObservation=null;if(evidence)await observeSurface();timings.push({...timing,totalConsumerMilliseconds:performance.now()-start});$('timing').textContent=`${timing.completion==='submitted'?'submit':'solve'} ${timing.totalMilliseconds.toFixed(1)} ms | frame ${(performance.now()-start).toFixed(1)} ms`;
 }catch(e){fail(e);throw e;}finally{busy=false;}
}
async function advanceBounded({fracture,evidence}){
 if(!evidence||typeof residentGrip!=='undefined'&&residentGrip){
  const active=gesture?.phase==='active'?gesture:null,applied=active&&[...active.displacement],start=performance.now();
  if(active)await resident.movePatch(applied);
  const timing=await resident.step(configuration,{wait:false});if(active&&fracture){const threshold=Number($('threshold').value);await resident.fractureStress(threshold);residentSupport?.update();residentGrip.update(applied,threshold);}
  applyFloorContact();
  observed={...observed,...resident.submittedState(),observation:{kind:'submitted',stressCurrent:false,readbackBytes:0}};surfaceObservation=null;present();
  if(evidence){observed=await resident.read();components=materialComponents(observed.model.points,acquiredConnections());present();await observeSurface();}
  timings.push({...timing,geometryMilliseconds:0,totalConsumerMilliseconds:performance.now()-start});$('timing').textContent=`submit ${timing.totalMilliseconds.toFixed(1)} ms`;return;
 }
 const active=gesture?.phase==='active'?gesture:null,applied=active&&[...active.displacement],before=observed.bonds,start=performance.now();
 if(active)await resident.movePatch(applied.map((v,k)=>v-active.baselineDisplacement[k]));
 const timing=await resident.step(configuration,{wait:evidence});if(active&&fracture)await resident.fractureStress(Number($('threshold').value));
 observed=evidence?await resident.read():await resident.readFrame();components=materialComponents(observed.model.points,observed.bonds);
 const released=[];for(let i=0;i<before.length;i+=4)if(before[i+2]===1&&observed.bonds[i+2]===0)released.push(i/4);
 let geometryMilliseconds=0;
 if(released.length){events.push({id:crypto.randomUUID(),kind:'resident-edge-normal-tensile-release-v0',released,runId:observed.runId,steps:observed.steps,threshold:Number($('threshold').value),mechanicalPoints:observed.model.points,mechanicalElements:observed.model.elements});
  if(gesture===active){const anchor=active.cellAnchor,component=components[anchor],patch=active.patch.filter(p=>components[p.index]===component);if(!patch.length){await release();stamp('grip-cell-support-lost',{cellAnchor:anchor,generation:active.generation});}else{const sum=patch.reduce((s,p)=>s+p.weight,0);active.patch=patch.map(p=>({...p,weight:p.weight/sum}));active.component=component;active.pieceId=0;active.baselineDisplacement=[...applied];await resident.capturePatch(active.patch,configuration.gripStiffness);}}
 }
 present();surfaceObservation=null;if(evidence)await observeSurface();timings.push({...timing,geometryMilliseconds,totalConsumerMilliseconds:performance.now()-start});$('timing').textContent=`solve ${timing.totalMilliseconds.toFixed(1)} ms | cells ${geometryMilliseconds.toFixed(1)} ms | frame ${(performance.now()-start).toFixed(1)} ms`;
}
function ray(event){const bounds=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-bounds.left)/bounds.width*2-1,-(event.clientY-bounds.top)/bounds.height*2+1);camera.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);return raycaster.ray;}
const pointerRecord=event=>({type:event.type,pointerId:event.pointerId,pointerType:event.pointerType,clientX:event.clientX,clientY:event.clientY,button:event.button,buttons:event.buttons,ctrlKey:event.ctrlKey,shiftKey:event.shiftKey,altKey:event.altKey,metaKey:event.metaKey,isPrimary:event.isPrimary});
function movePointer(event){if(!gesture||gesture.inputClosed)return;const point=ray(event).intersectPlane(plane,new THREE.Vector3());if(!point)return;scene.worldToLocal(point);gesture.displacement=point.clone().sub(new THREE.Vector3(...gesture.point)).toArray();stamp('move',{displacement:gesture.displacement,generation:gesture.generation,camera:cameraState()});marker.position.copy(point);arrow.geometry.setFromPoints([new THREE.Vector3(...gesture.point),point]);arrow.visible=true;}
function replayCameraPointer(held){
 const canvas=renderer.domElement,saved=['setPointerCapture','releasePointerCapture'].map(name=>[name,Object.getOwnPropertyDescriptor(canvas,name)]);
 // A completed stroke still drives OrbitControls, but its pointer is inactive.
 if(held.closed)for(const [name] of saved)Object.defineProperty(canvas,name,{configurable:true,value(){}});
 try{for(const e of held.events){const replay=new PointerEvent(e.type,{...e,bubbles:true,cancelable:true});Object.defineProperty(replay,'stoneOrbitReplay',{value:true});canvas.dispatchEvent(replay);}}
 finally{if(held.closed)for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(canvas,name,descriptor);else delete canvas[name];}}
}
function beginResidentPointer(event){
 const query=ray(event).clone();scene.updateWorldMatrix(true,false);scene.worldToLocal(query.origin);query.direction.transformDirection(new THREE.Matrix4().copy(scene.matrixWorld).invert());const generation=++gestureGeneration,held={generation,events:[pointerRecord(event)],latest:pointerRecord(event),closed:false,normal:camera.getWorldDirection(new THREE.Vector3())};gesture=null;invalidateMaterialObservation('resident-pointer-release');resident.release().catch(fail);pointerContact=held;pendingPick=true;controls.enabled=false;
 pickTask=(async()=>{const piece=pieces[0],runId=resident.submittedState().runId,hit=await piece.gpu.pick(query.origin.toArray(),query.direction.toArray());if(pointerContact!==held||generation!==gestureGeneration||resident.submittedState().runId!==runId)return;
  if(!hit){pointerContact=null;pendingPick=false;controls.enabled=true;replayCameraPointer(held);return;}
  plane.setFromNormalAndCoplanarPoint(held.normal,scene.localToWorld(new THREE.Vector3(...hit.point)));stamp('resident-ray-pick',hit);await beginPick(piece.id,hit.point,hit.faceIndex);if(pointerContact!==held)return;pointerContact=null;movePointer(held.latest);const captured=gesture;if(held.closed)queueMicrotask(()=>{if(gesture===captured)finishGesture().catch(fail);});
 })();pickTask.catch(error=>{if(pointerContact!==held)return;pointerContact=null;pendingPick=false;fail(error);});
}
renderer.domElement.addEventListener('pointerdown',event=>{if(event.stoneOrbitReplay||event.button!==0||failure)return;if(bounded){event.stopImmediatePropagation();renderer.domElement.setPointerCapture(event.pointerId);beginResidentPointer(event);return;}synchronizePicking();ray(event);const hit=raycaster.intersectObjects(pieces.map(p=>p.mesh),false)[0];if(!hit)return;event.stopImmediatePropagation();renderer.domElement.setPointerCapture(event.pointerId);camera.getWorldDirection(normal);plane.setFromNormalAndCoplanarPoint(normal,hit.point);pickTask=beginPick(hit.object.userData.pieceId,scene.worldToLocal(hit.point.clone()).toArray(),hit.faceIndex);pickTask.catch(fail);},{capture:true,signal:lifetime.signal});
renderer.domElement.addEventListener('pointermove',event=>{if(event.stoneOrbitReplay)return;if(pointerContact){event.stopImmediatePropagation();pointerContact.latest=pointerRecord(event);pointerContact.events.push(pointerRecord(event));return;}if(!gesture||gesture.inputClosed)return;event.stopImmediatePropagation();movePointer(event);},{capture:true,signal:lifetime.signal});
renderer.domElement.addEventListener('pointerup',event=>{if(event.stoneOrbitReplay)return;if(pointerContact){event.stopImmediatePropagation();pointerContact.closed=true;pointerContact.latest=pointerRecord(event);pointerContact.events.push(pointerRecord(event));return;}if(gesture||pendingPick){event.stopImmediatePropagation();finishGesture().catch(fail);}},{capture:true,signal:lifetime.signal});renderer.domElement.addEventListener('pointercancel',()=>release().catch(fail),{signal:lifetime.signal});
$('reset').onclick=()=>reset().catch(fail);$('release').onclick=()=>release().catch(fail);$('pause').onclick=()=>{paused=!paused;$('pause').setAttribute('aria-pressed',String(paused));icon('pause',paused?Play:Pause);};$('threshold').oninput=()=>{$('thresholdValue').value=$('threshold').value;stamp('threshold',Number($('threshold').value));};
if(!host)window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);},{signal:lifetime.signal});
function presented(){if(closing)return;frames++;lastPresentation={frame:frames,camera:cameraState(),materialBusy:busy};}
function frame(){if(closing)return false;if(!paused&&resident&&!busy&&!pendingPick&&!finishing&&!failure)advance({evidence:false}).catch(()=>{});return !paused&&!failure||busy||pendingPick||finishing;}
function draw(){if(closing)return;if(!host)frameRequest=requestAnimationFrame(draw);controls.update();renderer.render(container,camera);presented();frame();}
try{
 if(!bounded)({createPlaneFractureSurface}=await import('./structural-material-solid-fragments.mjs'));
 if(!['literal-edge','elastic-support'].includes(connectivity)||elasticSupport&&!bounded)throw new Error('Explicit supported bounded connectivity required');
 if(bounded&&(interiorSplit||affineComparison))throw new Error('Bounded fracture cannot silently compose with growing interior cuts or affine transport');if(!navigator.gpu)throw new Error('WebGPU is unavailable');const adapter=host?.adapter??await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter||adapter.info.isFallbackAdapter)throw new Error('Native GPU adapter required');device=host?.device??await adapter.requestDevice();device.lost.then(info=>{if(!closing)fail(new Error(`GPU lost: ${info.reason}: ${info.message}`));});if(!host){renderer.backend.parameters.device=device;await renderer.init();}if(!renderer.backend.isWebGPUBackend||renderer.backend.device!==device)throw new Error('Native shared-device surface renderer required');
 const root=new URL(parameters.get('inputs')??'./scratch/shard-live-inputs',import.meta.url).href;const r=await fetch(`${root}/manifest.json`,{cache:'no-store'});if(!r.ok)throw new Error(`Material manifest HTTP ${r.status}`);manifest=await r.json();if(manifest.status!=='passed'||manifest.model.kind!=='graph'||manifest.sourceSha256!=='33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011')throw new Error('Exact admitted stone graph manifest required');
 body=JSON.parse(new TextDecoder().decode(await loadVerified(`${root}/${manifest.body.filename}`,manifest.body.sha256)));arrays={};if(!bounded)for(const [name,b] of Object.entries(manifest.model.buffers)){const bytes=await loadVerified(`${root}/${b.filename}`,b.sha256);if(bytes.byteLength!==b.byteLength)throw new Error('Material buffer shape changed');arrays[name]=b.type==='Float32Array'?new Float32Array(bytes):new Uint32Array(bytes);}
 initialBody=body;assets=await loadStoneAssets('500-normal');skinMaterial=assets[0].material;skinMaterial.side=THREE.DoubleSide;await reset();if(interiorSplit||bounded){$('threshold').max=String(Math.max(Number($('threshold').max),materialRegime.threshold*4));$('threshold').value=String(materialRegime.threshold);$('thresholdValue').value=String(materialRegime.threshold);}$('route').textContent=`WebGPU ${adapter.info.description||adapter.info.vendor} | ${interiorSplit||bounded?materialRegime.name:'live graph'}`;
 const api={
  route,reset,release,advance,
  experimentStatus,waitSubmitted,reportFailure:fail,
  pause(value=true){if(typeof value!=='boolean')throw new Error('Explicit boolean pause required');paused=value;$('pause').setAttribute('aria-pressed',String(paused));icon('pause',paused?Play:Pause);},
  pick:beginPick,
  move(displacement){if(!gesture)throw new Error('No active picked patch');if(gesture.inputClosed)throw new Error('Picked patch input is closed');gesture.displacement=[...displacement];stamp('move',{displacement,generation:gesture.generation});},
  threshold(value){if(!(Number.isFinite(value)&&value>0))throw new Error('Positive tension threshold required');const input=$('threshold');input.min=String(Math.min(Number(input.min),value));input.max=String(Math.max(Number(input.max),value));input.step='any';input.value=String(value);$('thresholdValue').value=String(value);stamp('threshold',value);},
  contacts(){synchronizePicking();container.updateMatrixWorld(true);return pieces.map(p=>{const box=p.mesh.geometry.boundingBox??(p.mesh.geometry.computeBoundingBox(),p.mesh.geometry.boundingBox);let point=box.getCenter(new THREE.Vector3()),faceIndex;point.z=box.max.z;p.mesh.localToWorld(point);if(bounded){raycaster.set(camera.position,point.clone().sub(camera.position).normalize());const hit=raycaster.intersectObject(p.mesh,false)[0];if(!hit)throw new Error('No visible bounded material contact');point=hit.point;faceIndex=hit.faceIndex;}const screen=point.clone().project(camera),bounds=renderer.domElement.getBoundingClientRect();return{pieceId:p.id,faceIndex,point:scene.worldToLocal(point.clone()).toArray(),screen:{x:bounds.left+(screen.x+1)*bounds.width/2,y:bounds.top+(1-screen.y)*bounds.height/2}};});},
  camera(request){if(request){camera.position.fromArray(request.position);controls.target.fromArray(request.target);camera.lookAt(controls.target);}return cameraState();},
  presentation(){return structuredClone(lastPresentation);},
  async rayPick(origin,direction){if(!bounded)throw new Error('Resident bounded picking required');return pieces[0].gpu.pick(origin,direction);},
  async surfacePositions(){if(!paused)throw new Error('Pause before explicit surface readback');await settle(true);busy=true;try{if(observed.observation?.kind==='submitted'){observed=await resident.read();components=materialComponents(observed.model.points,acquiredConnections());present();}await observeSurface();if(!surfaceObservation)throw new Error('Resident surface readback requires transport route');return structuredClone(surfaceObservation.pieces);}finally{busy=false;}},
  observationResources(){if(!bounded)throw new Error('Fixed bounded resources required');return{schema:'stone-observation-resource-v1',version:observed.runId,...(elasticSupport?{elasticSupport:{route:ELASTIC_SUPPORT_ROUTE,elements:body.tetrahedra}}:{}),pieces:pieces.map(p=>({id:p.id,geometry:p.geometry,binding:p.binding}))};},
  observationStamp(){if(!bounded)throw new Error('Bounded observation stamp required');return stoneObservationStamp({route,state:observed,resourceVersion:observed.runId,configuration,materialRegime,threshold:Number($('threshold').value),camera:cameraState(),viewport:{width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio},gesture,lastPick,events,inputs,timings,paused,busy,pendingPick,finishing,gestureGeneration,failure});},
  witness({resources=true}={}){synchronizePicking();return{route,phase:failure?'failed':observed.observation?.kind==='submitted'?'unverified':'interactive',identity:{backend:'webgpu',adapterFallback:false,adapter:adapter.info,renderer:'three-webgpu-visual-consumer',interaction:bounded?'gpu-resident-connectivity':'cpu-component',connectivity:bounded?connectivity:null,surface:affineComparison?'cpu-affine-comparison':'resident-vertex-transport',surfaceState:affineComparison?'cpu-geometry':'published-gpu-copy'},surfaceObservation:surfaceObservation&&surfaceObservation.runId===observed.runId&&surfaceObservation.steps===observed.steps?structuredClone(surfaceObservation):null,residentInteraction:interactionObservation&&structuredClone(interactionObservation),sourceSha256:manifest.sourceSha256,preparationSha256:manifest.preparationSha256,materialRegime:materialRegime?structuredClone(materialRegime):null,...(resources&&elasticSupport?{elasticSupport:{route:ELASTIC_SUPPORT_ROUTE,elements:body.tetrahedra}}:{}),configuration,threshold:Number($('threshold').value),runId:observed.runId,state:structuredClone(observed),interior:interiorSplit?structuredClone(interiorState):null,totalSteps:interiorSplit?(interiorState.stepOffset??0)+observed.steps:observed.steps,camera:cameraState(),gesture:gesture&&structuredClone(gesture),lastPick:structuredClone(lastPick),events:structuredClone(events),pieces:pieces.map(p=>({id:p.id,component:p.component,nodes:p.nodes,volume:p.volume,...(resources?{geometry:p.geometry,binding:p.binding}:{}),renderedPositions:Array.from(p.mesh.geometry.attributes.position.array),renderedPositionsSource:p.gpu?'cpu-transport-reference-for-picking':'cpu-geometry',surfaceRoute:p.gpu?.route??p.binding.route})),inputs:structuredClone(inputs),timings:structuredClone(timings),frames,failure,paused};},
  pixels(){if(host)throw Error('Use the shared host capture operation');renderer.render(container,camera);const canvas=document.createElement('canvas');canvas.width=renderer.domElement.width;canvas.height=renderer.domElement.height;const context=canvas.getContext('2d');context.drawImage(renderer.domElement,0,0);const pixels=context.getImageData(0,0,canvas.width,canvas.height).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>60)count++;return{source:'actual-webgpu-visual-consumer',width:canvas.width,height:canvas.height,fraction:count/(pixels.length/4)};}
 };
 api.settle=async({surface:includeSurface=true}={})=>{if(typeof includeSurface!=='boolean')throw new Error('Explicit surface acquisition policy required');await settle(true);busy=true;try{observed=await resident.read();components=materialComponents(observed.model.points,acquiredConnections());present();if(includeSurface)await observeSurface();else await observeInteraction();}finally{busy=false;}};
 if(parameters.get('smoke')==='1')api.diagnoseFailure=message=>{stamp('diagnostic-failure-fixture',{message});fail(new Error(message));};
 if(!host)window.__stoneShards=api;
 const experimentId=parameters.get('experiment');
 if(!host&&experimentId){
  if(experimentId!=='stone/fracture')throw Error(`Unsupported stone experiment ${experimentId}`);
  const {openStoneOwnerExperiment}=await import('./structural-material-owner-entry.mjs');
  ownerExperiment=await openStoneOwnerExperiment(window.__stoneShards,{document,source:{route,url:location.href,entry:'owner-contribution',mount:'existing-stone-producer-not-shared-workbench',sharedEntryRevision:'8ccad75147dc9cd226953c07c2a65d62fc45024b'},inputs:{}});
  window.__stoneExperiment=ownerExperiment;$('route').textContent+=` | ${ownerExperiment.id}`;
 }
 api.object=scene;
 api.viewport={ownership:host?'borrowed-native':'producer-native',threeRevision:THREE.REVISION,canvas:renderer.domElement.id||null,scene:container.uuid,object:scene.uuid,deviceMatches:!host||host.device===device};
 api.dispose=()=>{if(!disposal){
  const status={complete:false,errors:[]};api.disposalStatus=()=>({...status,errors:status.errors.map(({phase,message})=>({phase,message}))});
  closing=true;paused=true;lifetime.abort();unsubscribeFrames?.();if(frameRequest!==null)cancelAnimationFrame(frameRequest);gestureGeneration++;pointerContact=null;pendingPick=false;gesture=null;
  disposal=(async()=>{
   const errors=[],attempt=async(phase,action)=>{try{await action();}catch(error){errors.push(error);status.errors.push({phase,message:error.message});}};
   await attempt('pending-pick',()=>pickTask);await attempt('settle',()=>settle());await attempt('release',()=>resident?.release());await attempt('completion',()=>device?.queue.onSubmittedWorkDone());
   const drainErrors=errors.length,cleanup=[];
   for(const p of pieces)cleanup.push(()=>p.gpu?.dispose(),()=>p.mesh.geometry.dispose());
   cleanup.push(()=>residentContact?.dispose(),()=>residentGrip?.dispose(),()=>residentSupport?.dispose(),()=>resident?.dispose(),()=>surface?.dispose());
   for(const object of [support,marker,arrow,...(ground?[ground]:[])])cleanup.push(()=>object.geometry.dispose(),()=>object.material.dispose());
   if(ground)cleanup.push(()=>container.remove(ground));
   cleanup.push(()=>capMaterial.dispose(),()=>disposeStoneAssets(assets),()=>container.remove(scene),()=>{controls.enabled=previousControlsEnabled;});
   if(!host)cleanup.push(()=>controls.dispose(),()=>renderer.dispose(),()=>device?.destroy());
   for(const action of cleanup)await attempt('cleanup',action);
   status.complete=errors.length===drainErrors;
   if(errors.length)throw new AggregateError(errors,`Stone disposal: ${errors[0].message}`,{cause:errors[0]});
  })();
 }return disposal;};
 if(host){unsubscribeFrames=host.subscribeFrame({before:frame,after:presented});if(typeof unsubscribeFrames!=='function')throw Error('Host frame subscription must return an unsubscribe function');}else draw();
 return api;
}catch(e){closing=true;lifetime.abort();unsubscribeFrames?.();fail(e);container.remove(scene);if(ground)container.remove(ground);residentContact?.dispose();for(const p of pieces){p.gpu?.dispose();p.mesh.geometry.dispose();}residentGrip?.dispose();residentSupport?.dispose();resident?.dispose();surface?.dispose();for(const object of [support,marker,arrow,...(ground?[ground]:[])]){object.geometry.dispose();object.material.dispose();}capMaterial.dispose();disposeStoneAssets(assets);controls.enabled=previousControlsEnabled;if(!host){controls.dispose();renderer.dispose();device?.destroy();}throw e;}
}

if(typeof location!=='undefined'&&location.pathname.endsWith('/structural-material-shard.html'))createStoneRuntime().catch(()=>{});
