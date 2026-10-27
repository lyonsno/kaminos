import {createWanderPath} from './wander-path.mjs';
import {sessionMotions,skeletonMotionKey} from './motion-collection.mjs';
import {mountMotionWorkspace} from './motion-workspace.mjs';
import {createEngagement} from './engagement.mjs';
import {createPoseOverlay} from './pose-overlay.mjs';
import {createRestMotion} from './rest-motion.mjs';
import {loadCreatureFlesh,createCreatureFleshDeformer,validateCreatureFleshPoses} from '../creature-flesh/creature.mjs';
import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {givenSourceSoleHeight} from './given-motion-source.mjs';
import {createWalkingPoseAdapter} from './walking-pose.mjs';
import {createWorkbenchSceneHost} from '../../workbench-scene-host.mjs';
import {createSkinCaseSelection,validateSkinCaseChoices} from './skin-case-selection.mjs';
import {loadFullBodySkin} from './full-body-source.mjs';
import {mountCreatureProperties} from './creature-properties.mjs';
import {createWanderMotion,wanderAreaInPlacement} from './wander-motion.mjs';
import {createLiveActorRoot} from './live-actor-root.mjs';
import {registerSceneObjectPoseHistory} from '../../scene-object-pose-history.mjs';
import {createCreatureAttention,deriveHeadProfile,sceneObjectInterests,flameInterests,lightSamplePoints} from './creature-attention.mjs';

function checkAuthoredTransform(t){
 if(t!==undefined&&(t?.position?.length!==3||t?.quaternion?.length!==4||t?.scale?.length!==3||![...t.position,...t.quaternion,...t.scale].every(Number.isFinite)||t.scale.some(v=>v<=0)||Math.abs(Math.hypot(...t.quaternion)-1)>1e-5))throw Error('Invalid authored creature transform or scale');
}
function checkRecipeInputs(inputs){
 checkAuthoredTransform(inputs.transform);
 if(inputs.actor_root!==undefined&&!['spawn','live'].includes(inputs.actor_root))throw Error('Unknown creature scene-root mode');
 if(inputs.label!==undefined&&(typeof inputs.label!=='string'||!inputs.label.trim()))throw Error('Creature label must be nonempty');
 if(inputs.deformation!==undefined&&!['cpu','gpu'].includes(inputs.deformation))throw Error('Unknown creature deformation backend');
 if(inputs.flesh!==undefined){if(!inputs.flesh||!Array.isArray(inputs.flesh.preparations)||inputs.flesh.enabled!==undefined&&typeof inputs.flesh.enabled!=='boolean'||inputs.flesh.interpolation!==undefined&&!['smooth','linear'].includes(inputs.flesh.interpolation)||inputs.deformation==='cpu')throw Error('Physical creature requires GPU deformation and explicit preparations');const scale=inputs.transform?.scale;if(scale&&Math.max(...scale)-Math.min(...scale)>1e-5)throw Error('Physical creature requires uniform positive scale');}
 if(inputs.action!==undefined&&!['preview','wander'].includes(inputs.action))throw Error('Unknown initial creature action');
 if(inputs.wander_travel!==undefined&&!['source','stance'].includes(inputs.wander_travel))throw Error('Unknown wander travel policy');
 if(inputs.wander!==undefined){checkAuthoredTransform(inputs.wander?.area);if(!inputs.wander?.area||!inputs.wander?.motion)throw Error('Wander setup requires the actual area transform and motion state');}
 if(inputs.attention!==undefined){const a=inputs.attention;if(!a||typeof a!=='object'||!Array.isArray(a.interests))throw Error('Attention setup requires an interests array');if(a.engage!==undefined&&typeof a.engage!=='boolean')throw Error('Attention engagement must be boolean');if(a.enabled!==undefined&&typeof a.enabled!=='boolean')throw Error('Attention enabled must be boolean');if(a.flame!==undefined&&(!a.flame||typeof a.flame!=='object'||a.flame.interest!==undefined&&(!Number.isFinite(a.flame.interest)||a.flame.interest<0)))throw Error('Attention flame setup must be an object with a finite nonnegative interest');}
 if(inputs.choices!==undefined){if(!Array.isArray(inputs.choices))throw Error('Skin choices must be an array');if(inputs.choices.length)validateSkinCaseChoices({choices:inputs.choices,currentCaseSha256:inputs.case_sha256});}
 if(inputs.rate!==undefined&&(!Number.isFinite(inputs.rate)||inputs.rate<=0))throw Error('Playback rate must be finite and positive');
 if(inputs.mode!==undefined&&!['source','cycle','path'].includes(inputs.mode))throw Error('Unknown walking mode');
 if(inputs.cycle!==undefined&&(!Number.isSafeInteger(inputs.cycle)||inputs.cycle<0))throw Error('Invalid authored repeat cycle');
 if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial playback must be boolean');
 if(inputs.rest!==undefined){const r=inputs.rest;if(!r||typeof r.motion!=='string'||!r.motion.trim()||!/^[a-f0-9]{64}$/i.test(r.motion_sha256??'')||r.blend_seconds!==undefined&&(!Number.isFinite(r.blend_seconds)||r.blend_seconds<=0))throw Error('Rest requires a retained motion URL, digest and positive blend duration');}
 if(inputs.gizmos!==undefined&&typeof inputs.gizmos!=='boolean')throw Error('Gizmo visibility must be boolean');
 if(inputs.ground==='source-start'){const size=inputs.floor_size??5*(inputs.radius??10);if(!Number.isFinite(size)||size<=0)throw Error('Reference floor size must be positive');}
 const choices=inputs.motions??[];if(!Array.isArray(choices))throw Error('Motion choices must be an array');
 const ids=new Set();for(const choice of choices){
  if(typeof choice?.id!=='string'||!choice.id.trim()||typeof choice.label!=='string'||!choice.label.trim()||typeof choice.motion!=='string'||!choice.motion.trim()||!/^[a-f0-9]{64}$/i.test(choice.motion_sha256??''))throw Error('Motion choice requires id, label, source URL and digest');
  if(ids.has(choice.id))throw Error('Duplicate motion choice id');ids.add(choice.id);
 }
 return choices;
}
async function checkRecipeView(view,current){
 if(!view)return;
 // Exercise the shared view validator on an isolated camera, never the current
 // authored camera. This keeps host projection rules authoritative at preflight.
 const camera=new THREE.PerspectiveCamera(),controls={target:new THREE.Vector3(),update(){}};camera.position.z=1;
 const checker=createWorkbenchSceneHost({camera,controls,removeObject(){},redraw(){},onFrame:()=>()=>{}}).open();
 try{if(current&&Object.keys(current).length)checker.setView(current);checker.setView(view);}finally{await checker.dispose();}
}

// Validate every source consumed by construction before Open disposes the
// current scene. The room and selected-object file controls share this path.
async function prepareRestSetup(inputs,data,loadSources){
 if(!inputs.rest)return null;
 const rest=await loadSources({...inputs,motion:inputs.rest.motion,motion_sha256:inputs.rest.motion_sha256,motion_data:inputs.rest.motion_data,prefix:inputs.rest.prefix,prefix_sha256:inputs.rest.prefix_sha256});
 if(rest.source.caseSha256!==data.source.caseSha256||rest.source.frameSha256!==data.source.frameSha256||rest.motion.assetCondSha256!==data.motion.assetCondSha256)throw Error('Rest motion body, bind frame or conditioning differs');
 const adapter=createGivenPaletteMotion({THREE,motion:rest.motion,rigFrame:data.frame});
 const motion=createRestMotion({THREE,adapter,blendSeconds:inputs.rest.blend_seconds??.3});
 return {motion,source:rest.source};
}
export async function prepareWalkingSetup(recipe,{loadSources=loadFullBodySources}={}){
 checkRecipeInputs(recipe);
 const loaded=await loadCreatureFlesh(recipe.flesh,await loadSources(recipe)),check=createGivenPaletteMotion({THREE,motion:loaded.motion,rigFrame:loaded.frame});
 await prepareRestSetup(recipe,loaded,loadSources);
 const walking=createWalkingPoseAdapter({THREE,adapter:check,radius:recipe.radius??10,blendFrames:recipe.blend_frames??6});if(recipe.sample!==undefined)check.frame(recipe.sample);
 const wander=recipe.wander?createWanderMotion({THREE,adapter:check,walking,travel:recipe.wander_travel??'source',sourceKey:loaded.source.motionSha256+':'+loaded.source.frameSha256,snapshot:recipe.wander.motion}):null;
 validateCreatureFleshPoses(loaded,[check.frame(0),wander?wander.frame(wander.read().frame):walking.frame(recipe.sample??0,{mode:recipe.action==='wander'?'cycle':recipe.mode??'source',cycle:recipe.cycle??0})]);
 return loaded;
}

export async function createWalkingCreature({host,inputs={},record=()=>{}},{loadSources=loadFullBodySources,loadSkin=loadFullBodySkin,publishInspector=true,mountProperties=mountCreatureProperties,zoneProvider=null,encounterContext=null,steering=null,loadGpuDeformer=async()=>(await import('./gpu-skin-deformer.mjs')).createGpuSkinDeformer}={}) {
 if(typeof host?.scene?.open!=='function'||!host.controls?.document)throw Error('Walking creature requires the actual shared Workbench host');
 if(steering!==null&&(typeof steering.update!=='function'||typeof steering.read!=='function'))throw Error('Game steering requires update and read');
 const choices=[...checkRecipeInputs(inputs)];
 const data=await loadCreatureFlesh(inputs.flesh,await loadSources(inputs)),document=host.controls.document;
 const restSetup=await prepareRestSetup(inputs,data,loadSources),restMotion=restSetup?.motion;
 let workspace=null,assigned=null;const sessionChoices=new Map();
 const deformation=inputs.deformation??(inputs.flesh?'gpu':'cpu'),deformerFactory=inputs.flesh?createCreatureFleshDeformer(inputs.flesh):deformation==='gpu'?await loadGpuDeformer():null;
 if(deformation==='gpu'&&typeof deformerFactory!=='function')throw Error('GPU deformation factory is unavailable');
 let adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame});
 let walking=createWalkingPoseAdapter({THREE,adapter,radius:inputs.radius??10,blendFrames:inputs.blend_frames??6});
 const source={...data.source,prompt:data.motion.prompt??null,seed:data.motion.seed??null,presentation:{mode:'source',...walking.identity}};
 let chosen=choices.find(c=>c.motion===inputs.motion&&c.motion_sha256===data.source.motionSha256)??null,chosenInputs={...inputs,deformation};
 const placement=new THREE.Group();placement.name='Creature · authored placement';placement.userData.kaminosFrameContentOnly=true;
 if(inputs.transform!==undefined){
  const t=inputs.transform;
  checkAuthoredTransform(t);
  placement.position.fromArray(t.position);placement.quaternion.fromArray(t.quaternion);placement.scale.fromArray(t.scale);
 }
 let session,runtime,asset,floor,floorAsset,pathGuide,player,attention=null,attentionSkin=null,flames=null,lightTimer=null,lightBusy=false,skinSelection,presentation,seating,stop=null,clock=0,cycle=0,mode='source',rate=inputs.rate??1,disposed=false,disposal,motionRequest=0,restoreGround=()=>{},restoreGizmos=()=>{},refresh=()=>{};
 const liveRoot=inputs.actor_root==='live'?createLiveActorRoot({THREE,placement,getGuide:()=>pathGuide}):null;
 const releaseHistory=liveRoot?registerSceneObjectPoseHistory(placement,liveRoot.history):()=>{};
 const authoredTransform=()=>liveRoot?liveRoot.read():transformOf(placement);
 const authoredPlacement=()=>liveRoot?liveRoot.sync():placement;
 const makeWander=options=>createWanderMotion({THREE,adapter,walking,travel:chosenInputs.wander_travel??'source',sourceKey:source.motionSha256+':'+source.frameSha256,...options});
 const engagement=createEngagement();
 let wander=inputs.wander?makeWander({snapshot:inputs.wander.motion}):null;
 let heldWander=inputs.held_wander?makeWander({snapshot:inputs.held_wander}):null;
 let areaRoot=null,areaAsset=null,areaKey='',actionError=null,guideSegment=-1,motionClock=0;
 const relatedAssets=[];
 const transformOf=root=>({position:root.position.toArray(),quaternion:root.quaternion.toArray(),scale:root.scale.toArray()});
 if(!Number.isFinite(rate)||rate<=0)throw Error('Playback rate must be finite and positive');
 const instruments=document.createElement('div');
 let releaseEncounter=()=>{},frameStamp=0;
 const poseOverlay=createPoseOverlay({THREE});let resolvedOverlay=null;
 const restingPose=pose=>restMotion&&wander?restMotion.frame(pose,walking.frame(pose.frame,{mode:'cycle',cycle:0})):pose;
 const composedPose=pose=>{const body=restingPose(pose);return resolvedOverlay?resolvedOverlay(body):body;};
 const poseObservers=new Set();
 let readingZoneState=false;
 const unsubscribe=()=>{const previous=stop;stop=null;previous?.();runtime?.flesh.setRunning(false);};
 function read(){
  // Authored regions can change while all domain clocks are held. Resolve that
  // edit before publishing a state/recipe, never on a later preview or reopen.
  // syncArea refreshes presentation, so guard its nested state reads.
  if(zoneProvider&&wander&&!readingZoneState){readingZoneState=true;try{syncArea();}finally{readingZoneState=false;}}
  const playback=player.read();return {mode,cycle,rate,currentSkin:skinSelection?.read()??null,source:structuredClone(source),host:{id:playback.status==='removed'?null:asset.id,route:'shared-owner-scene',scene:globalThis.window?.kaminosWorkbenchSceneState?.()??null},
  motionWorkspace:workspace?.read()??null,restMotion:restMotion?{...restMotion.read(),source:structuredClone(restSetup.source)}:null,assignedMotion:assigned?{id:assigned.id,sha256:assigned.motion_sha256}:null,skin:runtime.read(),deformation:{requested:deformation,effective:runtime.read().deformation.backend},playback,view:session.readView(),motion:chosen?Object.fromEntries(Object.entries(chosen).filter(([k])=>k!=='motion_data')):null,motions:choices.map(({motion_data,...c})=>c),
  transform:transformOf(placement),actorRoot:{requested:inputs.actor_root??'spawn',effective:liveRoot?'live-pelvis':'authored-spawn',authoredTransform:authoredTransform()},
  action:{time:clock/1000,steering:steering?.read()??null,engagement:{...engagement.read(),enabled:!steering&&chosenInputs.attention?.engage===true},kind:wander?'wander':'preview',error:actionError,motion:wander?.read()??null,area:areaRoot?{id:areaAsset?.id,transform:transformOf(areaRoot),mounted:Boolean(areaRoot.parent)}:null,support:'authored flat plane; no foot/contact solver'},
  recipe:{...structuredClone(Object.fromEntries(Object.entries(chosenInputs).filter(([k])=>k!=='motion_data'))),motions:choices.map(({motion_data,...c})=>c),transform:authoredTransform(),mode,cycle,rate,sample:player.read().frame??0,play:player.read().status==='playing',view:session.readView(),action:wander?'wander':'preview',wander:wander?{area:transformOf(areaRoot),motion:wander.snapshot()}:undefined,held_wander:heldWander?.snapshot(),held_wander_area:heldWander&&areaRoot?transformOf(areaRoot):inputs.held_wander_area},


  display:{castsShadows:runtime.mesh.castShadow,receivesShadows:runtime.mesh.receiveShadow,boneMarkers:[...runtime.bones.values()].flatMap(b=>b.children.filter(c=>c.userData.kaminosHelperKind==='bones')).map(c=>({visible:c.visible}))},
  attention:attention?{...attention.read(),interests:structuredClone(chosenInputs.attention.interests),profileCaseSha256:attentionSkin}:null,flesh:runtime.flesh.read(),
  pathGuide:pathGuide?{mode,kind:wander?'wander-current-segment':mode==='path'?'complete-circular-rail':'source-root-travel',visible:pathGuide.visible,points:pathGuide.geometry.attributes.position.count,bounds:{min:pathGuide.geometry.boundingBox.min.toArray(),max:pathGuide.geometry.boundingBox.max.toArray()},radius:walking.identity.radius,sourceDistance:walking.identity.sourceDistance,sourceUnitsPerSecond:walking.identity.sourceDistance/((adapter.frames-1)/adapter.fps)}:null,
  referenceFloor:floor?{id:floorAsset.id,visible:floor.visible,size:floor.geometry.parameters.width,height:floor.position.y,contactSolver:false}:null};}
 function refreshGuide(){
  const y=(floor?.position.y??runtime.mesh.geometry.boundingBox?.min.y??0)+.025;
  let points=walking.guidePoints(mode);
  if(wander){const [a,b,c]=wander.snapshot().path.points;points=Array.from({length:65},(_,i)=>{const t=i/64,u=1-t;return [u*u*a[0]+2*u*t*b[0]+t*t*c[0],y,u*u*a[1]+2*u*t*b[1]+t*t*c[1]];});guideSegment=wander.read().path.segments;}
  const geometry=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(p[0],y,p[2])));
  geometry.computeBoundingBox();
  if(!pathGuide){pathGuide=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x55cbd7,depthTest:true}));pathGuide.name='Creature motion path';Object.assign(pathGuide.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosHelperKind:'paths'});pathGuide.visible=false;placement.add(pathGuide);}
  else{const old=pathGuide.geometry;pathGuide.geometry=geometry;old.dispose();}
  liveRoot?.guide();
 }
 async function ensureArea(transform){
  if(zoneProvider){const row=zoneProvider.roots()[0];if(row){areaRoot=row.root;areaAsset=row.asset;return;}if(areaRoot)return;
   // Reconstruct a held journey even if every membership is disabled. This
   // transform is retained data, not a mounted or implicitly enabled zone.
   if(transform){checkAuthoredTransform(transform);areaRoot=new THREE.Group();areaRoot.position.fromArray(transform.position);areaRoot.quaternion.fromArray(transform.quaternion);areaRoot.scale.fromArray(transform.scale);return;}
   throw Error('No active Wander zone');}
  if(areaRoot?.parent)return;
  areaRoot=new THREE.Group();areaRoot.name='Wander area';areaRoot.userData.kaminosEditorOnly=true;
  const disk=new THREE.Mesh(new THREE.CircleGeometry(1,64).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x4bc9d8,side:THREE.DoubleSide,transparent:true,opacity:.09,depthWrite:false}));
  const edge=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:64},(_,i)=>new THREE.Vector3(Math.cos(i/64*Math.PI*2),.002,Math.sin(i/64*Math.PI*2)))),new THREE.LineBasicMaterial({color:0x55cbd7}));areaRoot.add(disk,edge);
  if(transform){checkAuthoredTransform(transform);areaRoot.position.fromArray(transform.position);areaRoot.quaternion.fromArray(transform.quaternion);areaRoot.scale.fromArray(transform.scale);}
  else{placement.updateMatrixWorld(true);runtime.group.updateMatrixWorld(true);const root=[...runtime.bones.values()].find(b=>!b.parent?.isBone),p=root.getWorldPosition(new THREE.Vector3());areaRoot.position.set(p.x,(floor?.position.y??runtime.mesh.geometry.boundingBox?.min.y??0)+.03,p.z);areaRoot.scale.set(inputs.radius??10,1,inputs.radius??10);}
  areaAsset=await session.attach(areaRoot,{owned:true,metadata:{fileName:'Wander area',source:null,label:'Wander area'}});relatedAssets.push(areaAsset);
 }
 function syncArea(){
  if(!wander)return true;
  if(zoneProvider){try{
   const frame=authoredPlacement(),rows=zoneProvider.roots();if(!rows.length){actionError=null;unsubscribe();player.pause();return false;}
   const areas=rows.map(row=>({id:row.id,preference:row.preference,area:wanderAreaInPlacement({THREE,areaRoot:row.root,placement:frame})})),key=JSON.stringify(areas);
   const prior=areaKey?JSON.parse(areaKey):null,same=Array.isArray(prior)&&prior.length===areas.length&&areas.every((row,i)=>row.id===prior[i].id&&row.preference===prior[i].preference&&[...row.area.center,...row.area.radii,row.area.yaw].every((v,j)=>Math.abs(v-[...prior[i].area.center,...prior[i].area.radii,prior[i].area.yaw][j])<=1e-9*Math.max(1,Math.abs(v))));
   if(!same){wander.setAreas(areas);areaKey=key;refreshGuide();}
   const selected=rows.find(row=>row.id===wander.read().path.zoneId)??rows[0];areaRoot=selected.root;areaAsset=selected.asset;actionError=null;return true;
  }catch(error){actionError=error.message;unsubscribe();player.pause();refresh();return false;}}
  if(!areaRoot?.parent){actionError='Wander area was removed; current pose is held';unsubscribe();player.pause();refresh();return false;}
  try{const area=wanderAreaInPlacement({THREE,areaRoot,placement:authoredPlacement()}),key=JSON.stringify(area),prior=areaKey?JSON.parse(areaKey):null;
   const same=prior&&[...area.center,...area.radii,area.yaw].every((v,i)=>Math.abs(v-[...prior.center,...prior.radii,prior.yaw][i])<=1e-9*Math.max(1,Math.abs(v)));
   if(!same){wander.setArea(area);areaKey=key;refreshGuide();}actionError=null;return true;}
  catch(error){actionError=error.message;unsubscribe();player.pause();refresh();return false;}
 }
 function presentWander(delta,playing,from=clock/1000-delta,physicalSeconds=delta){
  if(!syncArea())return read();
  let moving=delta,resting=false;
  if(steering){
   const frame=authoredPlacement();frame.updateMatrixWorld(true);
   const path=wander.read().path,position=new THREE.Vector3(path.position[0],0,path.position[1]).applyMatrix4(frame.matrixWorld).toArray();
   const intent=steering.update({time:clock/1000,from,deltaSeconds:delta,position,arrived:path.status==='arrived',attention:attention?.read()??null});
   if(!intent||typeof intent.source!=='string'||!intent.source||typeof intent.hold!=='boolean'||intent.destination!==null&&(!Array.isArray(intent.destination)||intent.destination.length!==3||!intent.destination.every(Number.isFinite)))throw Error('Invalid game steering intent');
   if(intent.motionStart!==undefined){
    if(!Number.isFinite(intent.motionStart)||intent.motionStart<from||intent.motionStart>clock/1000)throw Error('Invalid game steering motion interval');
    moving=attention?.motionSeconds(intent.motionStart,clock/1000)??clock/1000-intent.motionStart;
   }
   const local=intent.destination===null?null:frame.worldToLocal(new THREE.Vector3(...intent.destination));
   const next=local?[local.x,local.z]:null,prior=wander.snapshot().path,old=prior.destination??null;
   if(next===null?old!==null:!old||prior.constrainDestination!==false||next.some((v,i)=>Math.abs(v-old[i])>1e-8))wander.setDestination(next,{constrainToArea:false});
   if(intent.hold){moving=0;resting=true;}
  }else if(attention&&chosenInputs.attention.engage===true){
   const a=attention.read(),frame=authoredPlacement();frame.updateMatrixWorld(true);
   const path=wander.read().path,position=new THREE.Vector3(path.position[0],0,path.position[1]).applyMatrix4(frame.matrixWorld).toArray();
   const prior=engagement.read();
   const intent=a.enabled?engagement.update({time:clock/1000,position,observed:a.perceived,focus:a.focus,alarm:a.startle,interrupted:Boolean(a.interruption),arrived:prior.phase==='approaching'&&path.status==='arrived'}):engagement.reset();
   attention.setEngagement(['approaching','inspecting','cautious'].includes(intent.phase)?intent.id:null);
   if(intent.destination){
    const local=frame.worldToLocal(new THREE.Vector3(...intent.destination)),next=[local.x,local.z],old=wander.snapshot().path.destination;
    if(!old||Math.hypot(...next.map((v,i)=>v-old[i]))>.25)wander.setDestination(next);
   }else if(intent.phase!=='inspecting')wander.setDestination(null);
   if(intent.hold){moving=0;resting=true;}
  }
  restMotion?.advance(clock/1000-from,resting);
  if(attention&&encounterContext){
   const frame=authoredPlacement();frame.updateMatrixWorld(true);
   resolvedOverlay=poseOverlay.resolve(restingPose(wander.frame(wander.read().frame)),frame.matrixWorld,state=>attention.modify({...state,time:clock/1000,placement}));
  }
  let constraint;
  if(encounterContext&&moving>0){const frame=authoredPlacement(),path=wander.read().path;frame.updateMatrixWorld(true);const direction=new THREE.Vector3(path.direction[0],0,path.direction[1]).transformDirection(frame.matrixWorld),scale=frame.getWorldScale(new THREE.Vector3()).x;
   constraint=encounterContext.steer({time:frameStamp,seconds:physicalSeconds,direction:[direction.x,direction.z],speed:wander.read().travel.unitsPerSecond*scale});
   const local=new THREE.Vector3(constraint.direction[0],0,constraint.direction[1]).transformDirection(frame.matrixWorld.clone().invert());constraint={...constraint,direction:[local.x,local.z]};
  }
  if(encounterContext&&encounterContext.response!=='physical'){
   const body=contactState(),frame=authoredPlacement();frame.updateMatrixWorld(true);const matrix=frame.matrixWorld.clone();
   const point=p=>new THREE.Vector3(p[0],0,p[1]).applyMatrix4(matrix),axis=new THREE.Vector3(0,-1,0).transformDirection(matrix).toArray();
   constraint={...constraint,admit:({from,to,turnOnly})=>{const pivot=point(from.position),end=point(to.position),a=from.direction,b=to.direction,angle=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
    let nextBody=null;
    if(body.movementCores?.length)nextBody=contactState(wander.frame(wander.read().frame,to));
    return encounterContext.limit({time:frameStamp,body,nextBody,turnOnly,motion:{pivot:pivot.toArray(),translation:end.sub(pivot).toArray(),angle,axis}}).fraction;}};
  }
  if(encounterContext?.response==='physical')constraint={...constraint,gaitScale:wander.read().contactRate};
  const before=wander.snapshot();let state;
  try{state=wander.advance(moving,constraint);}catch(error){resolvedOverlay=null;wander=makeWander({snapshot:before});player.seek(wander.read().frame);throw error;}
  const present=()=>{try{cycle=state.cycle;source.presentation.cycle=cycle;player.seek(state.frame);attention?.positionReticle(placement);if(playing)player.play();}finally{resolvedOverlay=null;}};
  const after=()=>{stepFlesh(physicalSeconds);if(guideSegment!==state.path.segments)refreshGuide();refresh();};
  if(encounterContext?.response==='physical'&&physicalSeconds>0){
   const frame=authoredPlacement();frame.updateMatrixWorld(true);const matrix=frame.matrixWorld.clone(),inverse=matrix.clone().invert(),from=createWanderPath({snapshot:before.path}).read(),to=state.path;
   const point=p=>new THREE.Vector3(p[0],0,p[1]).applyMatrix4(matrix),pivot=point(from.position),end=point(to.position),axis=new THREE.Vector3(0,-1,0).transformDirection(matrix).toArray();
   const a=from.direction,b=to.direction,angle=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
   encounterContext.stage({time:frameStamp,seconds:physicalSeconds,nextBody:contactState(wander.frame(state.frame)),motion:{pivot:pivot.toArray(),translation:end.sub(pivot).toArray(),angle,axis},accept:motion=>{
    const position=pivot.clone().add(new THREE.Vector3(...motion.translation)).applyMatrix4(inverse),worldDirection=new THREE.Vector3(from.direction[0],0,from.direction[1]).transformDirection(matrix).applyAxisAngle(new THREE.Vector3(0,-1,0),motion.angle).transformDirection(inverse);
    state=wander.contact(before,{position:[position.x,position.z],direction:[worldDirection.x,worldDirection.z]});present();
   },after});return read();
  }
  present();encounterContext?.commit(frameStamp,contactState());after();return read();
 }
 function startClock(){
  if(stop)return;
  runtime.flesh.setRunning(true);
  stop=session.onFrame(({deltaSeconds,timestampMs,observation})=>{
   if(disposed||!stop)return;
   if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Walking clock requires a finite nonnegative host delta');
   frameStamp=observation??(Number.isFinite(timestampMs)?timestampMs:clock+deltaSeconds*1000);const from=clock/1000;clock+=deltaSeconds*1000*rate;
   const motionDelta=attention?.motionSeconds(from,clock/1000)??deltaSeconds*rate;
   motionClock+=motionDelta*1000;
   try{
    if(wander){
     if(player.read().status==='removed'){unsubscribe();return;}
     presentWander(motionDelta,true,from,deltaSeconds);return;
    }
    if(motionDelta===0)player.represent();else player.tick(motionClock);
    stepFlesh(deltaSeconds);
    if(player.read().status==='held'&&mode!=='source'){cycle++;source.presentation.cycle=cycle;player.replay();}
    else if(player.read().status!=='playing'){unsubscribe();if(player.read().status!=='removed')host.scene.refreshPresentation?.(asset);}
    refresh();
   }catch(error){unsubscribe();try{player.pause();}catch{}record({kind:'walking.frame',phase:'failed',error:error.message});throw error;}
  });
 }
 async function dispose(){
  if(disposal)return disposal;disposed=true;motionRequest++;
  disposal=Promise.resolve().then(async()=>{
   const errors=[],attempt=action=>{try{action();}catch(e){errors.push(e);}};
   poseObservers.clear();attempt(()=>workspace?.dispose());attempt(unsubscribe);attempt(releaseEncounter);refresh=()=>{};attempt(()=>seating?.dispose());attempt(()=>presentation?.dispose());attempt(()=>skinSelection?.dispose());attempt(()=>player?.dispose());attempt(()=>clearInterval(lightTimer));attempt(()=>attention?.dispose());attempt(()=>flames?.dispose());attempt(releaseHistory);attempt(()=>instruments.remove());attempt(restoreGround);attempt(restoreGizmos);
   try{if(session)await session.dispose();}catch(e){errors.push(e);}attempt(()=>{if(runtime&&!asset)runtime.dispose();});attempt(()=>{if(floor&&!floorAsset){floor.geometry.dispose();floor.material.dispose();}});
   if(globalThis.window?.kaminosWalkingCreature===inspect)delete globalThis.window.kaminosWalkingCreature;
   if(errors.length)throw new AggregateError(errors,'Walking creature cleanup failed');
  });return disposal;
 }
 function inspect({geometry=true}={}){
  if(!geometry)return read();
  if(geometry==='gpu')return runtime.readGpuGeometry();
  placement.updateMatrixWorld(true);
  const vertices=Array.from(runtime.syncCpuGeometry().attributes.position.array);
  return {...read(),geometrySource:'cpu-current-pose',placementMatrix:placement.matrixWorld.toArray(),rootMatrix:runtime.group.matrixWorld.toArray(),vertices,boneWorld:[...runtime.bones].map(([name,bone])=>({name,matrix:bone.matrixWorld.toArray()}))};
 }
 function pose({bones=[]}={}){
  if(disposed||!placement.parent)throw Error('Creature pose is no longer mounted');
  if(!Array.isArray(bones)||bones.some(name=>!runtime.bones.has(name)))throw Error('Unknown live creature Bone');
  placement.updateMatrixWorld(true);
  return {hostId:asset.id,space:'scene-world',source:structuredClone(source),rootMatrix:placement.matrixWorld.toArray(),bodyMatrix:runtime.group.matrixWorld.toArray(),bones:bones.map(name=>({name,matrix:runtime.bones.get(name).matrixWorld.toArray()}))};
 }
 function makePlayer(){
  runtime.group.position.set(0,0,0);runtime.group.quaternion.identity();runtime.group.scale.set(1,1,1);
  const derivedAdapter={...adapter,frame:index=>composedPose(wander?wander.frame(index):walking.frame(index,{mode,cycle}))};
  return attachGivenPalettePlayback({THREE,runtime,adapter:derivedAdapter,source,document,mountRoot:instruments,mountControls:false,posePresentation:liveRoot,now:()=>motionClock,
   poseModifier:attention?state=>{if(!resolvedOverlay)attention.modify({...state,time:clock/1000,placement});}:null,dirty:()=>{for(const observer of poseObservers)observer();session.redraw();},isMounted:()=>Boolean(placement.parent)});
 }
 function contactState(pose=null){
  if(pose)pose=composedPose(pose);
  placement.updateMatrixWorld(true);const projected=pose?runtime.flesh.project(pose):null,matrix=pose?authoredPlacement().matrixWorld.clone().multiply(new THREE.Matrix4().fromArray(pose.actorMatrix)):runtime.group.matrixWorld,scale=new THREE.Vector3().setFromMatrixScale(matrix);
  if(inputs.flesh&&(!(scale.x>0)||Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-5))throw Error('Physical creature requires positive uniform world scale');
  let capsules=(projected?.capsules??runtime.flesh.capsules()).map(c=>({a:new THREE.Vector3(...c.a).applyMatrix4(matrix).toArray(),b:new THREE.Vector3(...c.b).applyMatrix4(matrix).toArray(),radius:c.radius*scale.x}));
  if(!capsules.length){const a=runtime.bones.get('pelvis'),b=runtime.bones.get('spine-chest');if(!a||!b)return {mounted:false};capsules=[{a:a.getWorldPosition(new THREE.Vector3()).toArray(),b:b.getWorldPosition(new THREE.Vector3()).toArray(),radius:.4*scale.x}];}
  const c=capsules[0],position=[(c.a[0]+c.b[0])*.5,(c.a[2]+c.b[2])*.5],radius=c.radius+Math.hypot(c.b[0]-c.a[0],c.b[2]-c.a[2])*.35,path=wander?.read(),frame=authoredPlacement(),dir=path?new THREE.Vector3(path.path.direction[0],0,path.path.direction[1]).transformDirection(frame.matrixWorld):new THREE.Vector3(0,0,1);
  const nodes=(projected?.nodes??runtime.flesh.contactNodes()).map(p=>new THREE.Vector3(...p).applyMatrix4(matrix).toArray());
  const movementCores=(projected?.movementCores??runtime.flesh.movementCores()).map(c=>({...c,a:new THREE.Vector3(...c.a).applyMatrix4(matrix).toArray(),b:new THREE.Vector3(...c.b).applyMatrix4(matrix).toArray(),radius:c.radius*scale.x}));
  return {mounted:Boolean(placement.parent),position,radius,direction:[dir.x,dir.z],speed:player?.read().status==='playing'&&path?path.travel.unitsPerSecond*scale.x:0,capsules,nodes,movementCores};
 }
 function stepFlesh(seconds){
  if(!inputs.flesh)return;
  runtime.group.updateWorldMatrix(true,false);const scale=runtime.group.getWorldScale(new THREE.Vector3());if(!(scale.x>0)||Math.max(scale.x,scale.y,scale.z)-Math.min(scale.x,scale.y,scale.z)>1e-5)throw Error('Physical creature requires positive uniform world scale');
  const inverse=runtime.group.matrixWorld.clone().invert(),contacts=encounterContext?.contacts(frameStamp)??[];
  runtime.flesh.setContacts(contacts.map(c=>({a:new THREE.Vector3(...c.a).applyMatrix4(inverse).toArray(),b:new THREE.Vector3(...c.b).applyMatrix4(inverse).toArray(),radius:c.radius/scale.x})));runtime.flesh.advance(seconds);session.redraw();
 }
 try{
  session=await host.scene.open();runtime=createFullBodyRuntime({THREE,...data,deformerFactory});
  placement.add(runtime.group);
  if(inputs.attention){
   // Interests resolve from the live scene this creature stands in; the
   // muzzle is measured from the current cast's own skin.
   const sceneRoot=()=>{let node=placement;while(node.parent)node=node.parent;return node;};
   const props=sceneObjectInterests({THREE,root:sceneRoot,specs:inputs.attention.interests});
   // The scene's flame, when asked for, through the shared flame workbench.
   if(inputs.attention.flame)Promise.resolve(globalThis.window?.kaminosFlameWorkbench?.open?.()).then(workbench=>{if(workbench&&!disposed)flames=flameInterests({THREE,root:sceneRoot,workbench,interest:inputs.attention.flame.interest??1.5});}).catch(error=>record({kind:'attention.flame',phase:'unavailable',error:error.message}));
   attention=createCreatureAttention({THREE,rigFrame:data.frame,profile:deriveHeadProfile({skin:data,frame:data.frame}),interests:()=>[...props(),...(flames?.read()??[])],
    // Each creature's idle glances replay identically but differ from its neighbours'.
    options:{document,seed:[...(inputs.label??inputs.case??'creature')].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619)>>>0,2166136261),onEvent:event=>record({...event,kind:`attention.${event.kind}`})}});
   attentionSkin=data.source.caseSha256;placement.add(attention.reticle);
   if(inputs.attention.enabled===false)attention.setEnabled(false);
   // Light sense: while moving, sample the fire's light at a ring of ground
   // points around the creature (world space, independent of any camera).
   const senseLight=async()=>{
    const probe=globalThis.window?.kaminosFireLightProbe;
    if(disposed||lightBusy||!attention||player?.read().status!=='playing')return;
    if(!probe){attention.sense({time:clock/1000,status:'unavailable',samples:null});return;}
    lightBusy=true;
    try{
     runtime.group.updateMatrixWorld(true);
     const at=name=>new THREE.Vector3().setFromMatrixPosition(runtime.bones.get(name).matrixWorld),head=at('head'),chest=at('spine-chest');
     // Sample in the air at chest height, snapped like the ground grid, so a
     // point sampled again is exactly the same point (toe height bobs with the
     // gait and dips into uneven terrain, which reads as false shadow).
     const height=Math.round(chest.y/.25)*.25;
     const center=head.clone().add(chest).multiplyScalar(.5),radius=Math.max(.3,head.distanceTo(chest)*1.5);
     const points=lightSamplePoints({center:center.toArray(),radius,ground:height}).map(position=>({position,normal:[0,1,0]}));
     const result=await probe.sample(points);
     if(disposed||!attention)return;
     const flame=flames?.read()?.[0]??null;
     attention.sense({time:clock/1000,status:result.status,sourcePower:result.source?.power??null,sourceVisual:result.source?.visual??null,samples:result.values?.map((v,i)=>({point:points[i].position,luminance:v.luminance}))??null,source:flame?{id:flame.id,label:flame.label,point:flame.point}:null});
    }catch(error){if(!disposed&&attention)attention.sense({time:clock/1000,status:'unavailable',samples:null});record({kind:'attention.light',phase:'failed',error:error.message});}
    finally{lightBusy=false;}
   };
   lightTimer=setInterval(senseLight,250);
  }
  placement.name=inputs.label??'Creature';
  asset=await session.attach(placement,{owned:true,metadata:{fileName:placement.name,source:inputs.case,label:placement.name}});
  player=makePlayer();
  if(encounterContext)releaseEncounter=encounterContext.register(contactState);
  // Keep each loaded skin with its own request so a superseded load that
  // finishes late cannot supply the muzzle profile for the applied cast.
  const loadedSkins=new Map();
  if(inputs.choices?.length)skinSelection=createSkinCaseSelection({runtime,choices:inputs.choices,currentCaseSha256:data.source.caseSha256,loadCase:async input=>{const loaded=await loadCreatureFlesh(chosenInputs.flesh,await loadSkin(input));loadedSkins.set(input.case_sha256,loaded);return loaded;},onApplied:state=>{
   const applied=loadedSkins.get(state.current.case_sha256);loadedSkins.clear();
   if(attention&&applied){attention.setProfile(deriveHeadProfile({skin:applied,frame:data.frame}));attentionSkin=applied.source.caseSha256;}
   chosenInputs={...chosenInputs,case:state.current.case,case_sha256:state.current.case_sha256};source.caseSha256=state.current.case_sha256;
   host.scene.refreshPresentation?.(asset);session.redraw();refresh();
  }});
  if(inputs.ground==='source-start'){
   const height=document.getElementById('composition-ground-height'),visible=document.getElementById('composition-ground-visible');
   if(!height||!visible)throw Error('Shared Workbench ground controls are unavailable');
   const previous={height:height.value,visible:visible.checked};runtime.group.updateMatrixWorld(true);
   const value=String(givenSourceSoleHeight(runtime.syncCpuGeometry().attributes.position.array,runtime.mesh.matrixWorld.elements));
   source.groundReference={kind:'source-start-surface-minimum',height:Number(value),animated:false,contactSolver:false};
   const size=inputs.floor_size??5*walking.identity.radius;if(!Number.isFinite(size)||size<=0)throw Error('Reference floor size must be positive');
   floor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({color:0x808080,roughness:.65}));floor.name='Walking reference floor · not contact';floor.rotation.x=-Math.PI/2;floor.position.y=Number(value);floor.receiveShadow=true;
   floorAsset=await session.attach(floor,{owned:true,metadata:{fileName:floor.name,source:null,label:floor.name}});
   height.value=value;height.dispatchEvent(new Event('change'));visible.checked=false;visible.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(height.value===value&&!visible.checked){height.value=previous.height;height.dispatchEvent(new Event('change'));visible.checked=previous.visible;visible.dispatchEvent(new Event('change'));}};
  }
  if(inputs.view)session.setView(inputs.view);
  if(wander){await ensureArea(inputs.wander.area);areaKey=JSON.stringify(zoneProvider?wander.snapshot().path.areas??null:wander.read().path.area);if(!syncArea()&&actionError)throw Error(actionError);mode='cycle';cycle=wander.read().cycle;source.presentation.mode=mode;source.presentation.action='wander';player.seek(wander.read().frame);}
  refreshGuide();
  if(inputs.gizmos!==undefined){
   if(typeof inputs.gizmos!=='boolean')throw Error('Gizmo visibility must be boolean');
   const toggle=document.getElementById('viewport-show-gizmos');if(!toggle)throw Error('Shared viewport gizmo control is unavailable');
   const previous=toggle.checked;toggle.checked=inputs.gizmos;toggle.dispatchEvent(new Event('change'));
   restoreGizmos=()=>{if(toggle.checked===inputs.gizmos){toggle.checked=previous;toggle.dispatchEvent(new Event('change'));}};
  }
  globalThis.window?.selectSceneObject?.(asset.id);
  const active=()=>{if(disposed)throw Error('Walking creature experiment is disposed');if(!placement.parent)throw Error('Walking creature has been removed');};
  const operation=(name,action)=>input=>{
   active();record({kind:`walking.${name}`,phase:'requested',requested:input??null});
   const applied=result=>{refresh();record({kind:`walking.${name}`,phase:result?.status==='superseded'?'superseded':'applied',mode,cycle,frame:player.read().frame,motionSha256:source.motionSha256});return result;};
   const failed=error=>{record({kind:`walking.${name}`,phase:'failed',error:error.message,motionSha256:source.motionSha256});throw error;};
   try{const result=action(input);return result?.then?result.then(applied,failed):applied(result);}catch(error){return failed(error);}
  };
  const operations={
   action:operation('action',async input=>{
    if(!['preview','wander'].includes(input?.kind))throw Error('Unknown creature action');
    unsubscribe();player.pause();
    if(input.kind==='preview'){if(wander)heldWander=wander;wander=null;actionError=null;mode='source';cycle=0;source.presentation.mode=mode;source.presentation.action='preview';player.seek(0);refreshGuide();host.scene.refreshPresentation?.(asset);return read();}
    await ensureArea(inputs.wander?.area??inputs.held_wander_area);active();
    if(heldWander){wander=heldWander;heldWander=null;}
    const frame=authoredPlacement(),area=wanderAreaInPlacement({THREE,areaRoot,placement:frame});
    if(!wander){
     placement.updateMatrixWorld(true);const root=[...runtime.bones.values()].find(b=>!b.parent?.isBone),point=frame.worldToLocal(root.getWorldPosition(new THREE.Vector3()));
     const first=adapter.frame(0).bones.find(b=>b.parent===null).worldMatrix,last=adapter.frame(adapter.frames-1).bones.find(b=>b.parent===null).worldMatrix;
     wander=makeWander({area,position:[point.x,point.z],direction:[last[12]-first[12],last[14]-first[14]],seed:input.seed??1});wander.seek(player.read().frame??0);
    }
    areaKey=zoneProvider?JSON.stringify(wander.snapshot().path.areas??null):JSON.stringify(area);actionError=null;mode='cycle';source.presentation.mode=mode;source.presentation.action='wander';const canRun=!zoneProvider||syncArea();refreshGuide();player.seek(wander.read().frame);if(canRun){player.play();startClock();}host.scene.refreshPresentation?.(asset);return read();
   }),
   selectArea:operation('selectArea',()=>{if(!areaAsset||!areaRoot.parent)throw Error('No wander area is mounted');globalThis.window?.selectSceneObject?.(areaAsset.id);return read();}),
   advance:operation('advance',input=>{if(!wander)throw Error('Exact action advance requires Wander here');if(!Number.isFinite(input?.seconds)||input.seconds<0)throw Error('Action advance requires finite nonnegative seconds');unsubscribe();player.pause();const from=clock/1000;clock+=input.seconds*1000;frameStamp=input.observation??clock;const delta=attention?.motionSeconds(from,clock/1000)??input.seconds;motionClock+=delta*1000;presentWander(delta,false,from,input.seconds);if(!input.observation)encounterContext?.finishStep?.();host.scene.refreshPresentation?.(asset);return read();}),
   flesh:operation('flesh',input=>{if(!chosenInputs.flesh||typeof input?.enabled!=='boolean')throw Error('Physical creature and boolean response required');runtime.flesh.setEnabled(input.enabled);chosenInputs={...chosenInputs,flesh:{...chosenInputs.flesh,enabled:input.enabled}};session.redraw();return read();}),
   physicalSnapshot:operation('physicalSnapshot',async()=>{if(player.read().status==='playing')throw Error('Pause the creature before capturing exact physical geometry');await runtime.flesh.snapshot();return read();}),
   encounterBody:()=>contactState(),
   rate:operation('rate',input=>{if(!Number.isFinite(input?.rate)||input.rate<=0)throw Error('Playback rate must be finite and positive');rate=input.rate;return read();}),
   skin:operation('skin',input=>{if(!skinSelection)throw Error('This creature has no registered cast choices');return skinSelection.select(input);}),
   play:operation('play',()=>{if(wander){if(!syncArea())return read();presentWander(0,true);}else player.play();if(player.read().status==='playing')startClock();return read();}),
   pause:operation('pause',()=>{unsubscribe();player.pause();host.scene.refreshPresentation?.(asset);return read();}),
   replay:operation('replay',()=>{unsubscribe();if(wander){if(!syncArea())return read();wander.seek(0);}cycle=wander?.read().cycle??0;source.presentation.cycle=cycle;player.replay();host.scene.refreshPresentation?.(asset);startClock();return read();}),
   seek:operation('seek',input=>{unsubscribe();if(wander)wander.seek(input?.frame);player.seek(input?.frame);host.scene.refreshPresentation?.(asset);return read();}),
   mode:operation('mode',input=>{if(!['source','cycle','path'].includes(input?.mode))throw Error('Unknown walking mode');unsubscribe();player.pause();wander=null;actionError=null;mode=input.mode;cycle=0;source.presentation.mode=mode;source.presentation.action='preview';source.presentation.cycle=0;player.seek(0);refreshGuide();host.scene.refreshPresentation?.(asset);return read();}),
   motion:operation('motion',async input=>{
    const requestId=++motionRequest;
    const next=choices.find(c=>c.id===input?.id);if(!next)throw Error('Unknown retained motion');
    const request={...chosenInputs,motion:next.motion,motion_sha256:next.motion_sha256,motion_data:next.motion_data,prefix:next.prefix,prefix_sha256:next.prefix_sha256};
    let loaded;try{loaded=await loadSources(request);}catch(error){active();if(requestId!==motionRequest)return {status:'superseded',effective:read()};throw error;}
    active();if(requestId!==motionRequest)return {status:'superseded',effective:read()};
    if(loaded.source.motionSha256!==next.motion_sha256||loaded.source.caseSha256!==source.caseSha256||loaded.source.frameSha256!==data.source.frameSha256||loaded.motion.assetCondSha256!==data.motion.assetCondSha256)throw Error('Motion choice changed the source, body, bind frame or rig conditioning');
    if(next.prompt!==undefined&&next.prompt!==loaded.motion.prompt||next.seed!==undefined&&next.seed!==loaded.motion.seed)throw Error('Motion choice prompt or seed differs from retained source');
    const nextAdapter=createGivenPaletteMotion({THREE,motion:loaded.motion,rigFrame:data.frame}),nextWalking=createWalkingPoseAdapter({THREE,adapter:nextAdapter,radius:inputs.radius??10,blendFrames:inputs.blend_frames??6});
    const prior={adapter,walking,wander,heldWander,source:structuredClone(source),chosen,chosenInputs,assigned,cycle,frame:player.read().frame,status:player.read().status};
    const replaceSource=value=>{for(const key of Object.keys(source))delete source[key];Object.assign(source,value);};
    try{
     unsubscribe();player.dispose();adapter=nextAdapter;walking=nextWalking;cycle=0;
     replaceSource({...loaded.source,prompt:loaded.motion.prompt??null,seed:loaded.motion.seed??null,groundReference:prior.source.groundReference,presentation:{mode,cycle,...walking.identity}});
     if(wander)wander=makeWander({pathSnapshot:prior.wander.snapshot().path});
     if(heldWander)heldWander=makeWander({pathSnapshot:prior.heldWander.snapshot().path});
     player=makePlayer();chosen=next;chosenInputs=request;refreshGuide();if(prior.status==='playing'){player.play();startClock();}host.scene.refreshPresentation?.(asset);if(assigned&&!input.preview)assigned=next;return read();
    }
    catch(error){
     try{player?.dispose();adapter=prior.adapter;walking=prior.walking;wander=prior.wander;heldWander=prior.heldWander;chosen=prior.chosen;chosenInputs=prior.chosenInputs;assigned=prior.assigned;cycle=prior.cycle;replaceSource(prior.source);player=makePlayer();if(prior.frame!==null)player.seek(prior.frame);refreshGuide();if(prior.status==='playing'){player.play();startClock();}host.scene.refreshPresentation?.(asset);}
     catch(rollback){throw new AggregateError([error,rollback],'Motion switch and prior-state restoration failed');}
     throw error;
    }
   }),
   engagement:operation('engagement',input=>{if(!attention)throw Error('This creature has no attention setup');if(typeof input?.enabled!=='boolean')throw Error('Engagement enabled must be boolean');chosenInputs={...chosenInputs,attention:{...chosenInputs.attention,engage:input.enabled}};
    if(!input.enabled){engagement.reset();attention.setEngagement(null);wander?.setDestination(null);refreshGuide();}host.scene.refreshPresentation?.(asset);return read();}),
   attention:operation('attention',input=>{if(!attention)throw Error('This creature has no attention setup');if(typeof input?.enabled!=='boolean')throw Error('Attention enabled must be boolean');attention.setEnabled(input.enabled);if(!input.enabled){engagement.reset();wander?.setDestination(null);}chosenInputs={...chosenInputs,attention:{...chosenInputs.attention,enabled:input.enabled}};
    // While not playing no frame will come to clear or apply the turn: show
    // the displayed source frame again without moving time.
    if(player.read().status!=='playing'){player.represent();host.scene.refreshPresentation?.(asset);}
    return read();}),
   floor:operation('floor',input=>{if(!floor)throw Error('No walking reference floor is mounted');if(typeof input?.visible!=='boolean')throw Error('Reference floor visibility must be boolean');floor.visible=input.visible;session.redraw();return read();}),
  };
  if(inputs.motion_generation){
   const initialChoice=chosen??{id:'initial',label:data.motion.prompt??'Initial motion',motion:inputs.motion,motion_sha256:inputs.motion_sha256,motion_data:inputs.motion_data};
   if(!chosen){choices.push(initialChoice);chosen=initialChoice;}assigned=initialChoice;
   await sessionMotions.add(data.motion);
   const applyRow=async(row,preview)=>{
    if(row.skeletonKey!==skeletonMotionKey(data.motion))throw Error('Motion belongs to another skeleton');
    let choice=choices.find(c=>c.motion_sha256===row.id);
    if(!choice){choice={id:row.id,label:row.motion.prompt??'Session motion',motion:'session:'+row.id,motion_sha256:row.id,motion_data:row.text,prompt:row.motion.prompt,seed:row.motion.seed};choices.push(choice);sessionChoices.set(row.id,choice);}
    const requestId=motionRequest+1,result=await operations.motion({id:choice.id,preview});
    if(result.status==='superseded'||requestId!==motionRequest)return {status:'superseded',effective:read()};
    operations.mode({mode:'source'});operations.replay();return read();
   };
   operations.previewMotion=operation('previewMotion',async({id})=>{const row=sessionMotions.get(id);if(!row)throw Error('Unknown session motion');return applyRow(row,true);});
   operations.assignMotion=operation('assignMotion',async({id})=>{const row=sessionMotions.get(id);if(!row)throw Error('Unknown session motion');return applyRow(row,false);});
   operations.restoreMotion=operation('restoreMotion',async()=>{return operations.motion({id:assigned.id,preview:true});});
  }
  if(inputs.mode!==undefined&&!wander)operations.mode({mode:inputs.mode});
  if(inputs.cycle!==undefined&&!wander){if(!Number.isSafeInteger(inputs.cycle)||inputs.cycle<0)throw Error('Invalid authored repeat cycle');cycle=inputs.cycle;source.presentation.cycle=cycle;player.seek(0);}
  if(inputs.sample!==undefined&&!wander)operations.seek({frame:inputs.sample});
  if(inputs.action==='wander'&&!wander){await operations.action({kind:'wander'});if(inputs.play===false)operations.pause();}
  if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial playback must be boolean');
  if(inputs.play===true)operations.play();
  host.scene.refreshPresentation?.(asset);
  if(publishInspector&&globalThis.window)window.kaminosWalkingCreature=inspect;
  return {read,inspect,pose,observePose(observer){active();if(typeof observer!=='function')throw Error('Pose observer must be a function');poseObservers.add(observer);return ()=>poseObservers.delete(observer);},operations,dispose,mount({root,invoke,reopen=recipe=>{
   const entry=globalThis.window?.kaminosWorkbenchExperiments;if(typeof entry?.open!=='function')throw Error('Shared creature setup entry is unavailable');return entry.open('marionette/walking-creature',recipe);
  }}){
   seating?.dispose();presentation?.dispose();
   presentation=mountProperties({document,read,invoke,
    save(recipe){if(assigned)recipe={...recipe,motion:assigned.motion,motion_sha256:assigned.motion_sha256,motion_data:assigned.motion_data,motions:choices,sample:0,play:false};const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='creature.setup.json';link.click();URL.revokeObjectURL(url);},
    async open(recipe){
     await checkRecipeView(recipe.view,session.readView());await prepareWalkingSetup(recipe,{loadSources});
     active();await reopen(recipe);
    }});
   refresh=presentation.update;
   if(inputs.motion_generation){
    workspace?.dispose();workspace=mountMotionWorkspace({document,reference:data.motion,spec:inputs.motion_generation,options:inputs.motion_generation.options??{},onFrame:fn=>session.onFrame(fn),onPreview:row=>operations.previewMotion({id:row.id}),onApply:row=>operations.assignMotion({id:row.id}),onRestore:()=>operations.restoreMotion()});
    const button=document.createElement('button');button.type='button';button.textContent='Make motion…';button.onclick=()=>workspace.open();presentation.properties.append(button);
    const dock=document.createElement('div');dock.className='creature-motion-dock';const css=document.createElement('style');css.textContent='.creature-motion-dock>.playback-controls{position:relative}.creature-motion-dock{display:flex;flex-direction:column}';dock.append(css,workspace.node);if(presentation.playback)dock.append(presentation.playback);presentation.playback=dock;
    operations.openMotionWorkspace=()=>workspace.open();operations.generateMotion=input=>workspace.generate(input);operations.stopMotionGeneration=()=>workspace.stop();
   }
   if(host.controls.mountObject)seating=host.controls.mountObject({asset,relatedAssets,properties:presentation.properties,playback:presentation.playback,onSelected:refresh});
   else {root.append(presentation.properties);if(presentation.playback)root.append(presentation.playback);}
   refresh();return {dispose(){workspace?.dispose();seating?.dispose();presentation?.dispose();refresh=()=>{};}};
  }};
 }catch(error){await dispose();throw error;}
}

export default {id:'marionette/walking-creature',title:'Creature · walking around',create:createWalkingCreature};
