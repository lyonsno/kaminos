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

function checkAuthoredTransform(t){
 if(t!==undefined&&(t?.position?.length!==3||t?.quaternion?.length!==4||t?.scale?.length!==3||![...t.position,...t.quaternion,...t.scale].every(Number.isFinite)||t.scale.some(v=>v<=0)||Math.abs(Math.hypot(...t.quaternion)-1)>1e-5))throw Error('Invalid authored creature transform or scale');
}
function checkRecipeInputs(inputs){
 checkAuthoredTransform(inputs.transform);
 if(inputs.choices!==undefined){if(!Array.isArray(inputs.choices))throw Error('Skin choices must be an array');if(inputs.choices.length)validateSkinCaseChoices({choices:inputs.choices,currentCaseSha256:inputs.case_sha256});}
 if(inputs.rate!==undefined&&(!Number.isFinite(inputs.rate)||inputs.rate<=0))throw Error('Playback rate must be finite and positive');
 if(inputs.mode!==undefined&&!['source','cycle','path'].includes(inputs.mode))throw Error('Unknown walking mode');
 if(inputs.cycle!==undefined&&(!Number.isSafeInteger(inputs.cycle)||inputs.cycle<0))throw Error('Invalid authored repeat cycle');
 if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial playback must be boolean');
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

export async function createWalkingCreature({host,inputs={},record=()=>{}},{loadSources=loadFullBodySources,loadSkin=loadFullBodySkin}={}) {
 if(typeof host?.scene?.open!=='function'||!host.controls?.document)throw Error('Walking creature requires the actual shared Workbench host');
 const choices=checkRecipeInputs(inputs);
 const data=await loadSources(inputs),document=host.controls.document;
 let adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame});
 let walking=createWalkingPoseAdapter({THREE,adapter,radius:inputs.radius??10,blendFrames:inputs.blend_frames??6});
 const source={...data.source,prompt:data.motion.prompt??null,seed:data.motion.seed??null,presentation:{mode:'source',...walking.identity}};
 let chosen=choices.find(c=>c.motion===inputs.motion&&c.motion_sha256===data.source.motionSha256)??null,chosenInputs={...inputs};
 const placement=new THREE.Group();placement.name='Creature · authored placement';
 if(inputs.transform!==undefined){
  const t=inputs.transform;
  checkAuthoredTransform(t);
  placement.position.fromArray(t.position);placement.quaternion.fromArray(t.quaternion);placement.scale.fromArray(t.scale);
 }
 let session,runtime,asset,floor,floorAsset,pathGuide,player,skinSelection,presentation,seating,stop=null,clock=0,cycle=0,mode='source',rate=inputs.rate??1,disposed=false,disposal,motionRequest=0,restoreGround=()=>{},restoreGizmos=()=>{},refresh=()=>{};
 if(!Number.isFinite(rate)||rate<=0)throw Error('Playback rate must be finite and positive');
 const instruments=document.createElement('div');
 const unsubscribe=()=>{const previous=stop;stop=null;previous?.();};
 function read(){const playback=player.read();return {mode,cycle,rate,currentSkin:skinSelection?.read()??null,source:structuredClone(source),host:{id:playback.status==='removed'?null:asset.id,route:'shared-owner-scene',scene:globalThis.window?.kaminosWorkbenchSceneState?.()??null},
  skin:runtime.read(),playback,view:session.readView(),motion:chosen?structuredClone(chosen):null,motions:structuredClone(choices),
  transform:{position:placement.position.toArray(),quaternion:placement.quaternion.toArray(),scale:placement.scale.toArray()},
  recipe:{...structuredClone(chosenInputs),motions:structuredClone(choices),transform:{position:placement.position.toArray(),quaternion:placement.quaternion.toArray(),scale:placement.scale.toArray()},mode,cycle,rate,sample:player.read().frame??0,play:player.read().status==='playing',view:session.readView()},
  display:{castsShadows:runtime.mesh.castShadow,receivesShadows:runtime.mesh.receiveShadow,boneMarkers:[...runtime.bones.values()].flatMap(b=>b.children.filter(c=>c.userData.kaminosHelperKind==='bones')).map(c=>({visible:c.visible}))},
  pathGuide:pathGuide?{mode,kind:mode==='path'?'complete-circular-rail':'source-root-travel',visible:pathGuide.visible,points:pathGuide.geometry.attributes.position.count,bounds:{min:pathGuide.geometry.boundingBox.min.toArray(),max:pathGuide.geometry.boundingBox.max.toArray()},radius:walking.identity.radius,sourceDistance:walking.identity.sourceDistance,sourceUnitsPerSecond:walking.identity.sourceDistance/((adapter.frames-1)/adapter.fps)}:null,
  referenceFloor:floor?{id:floorAsset.id,visible:floor.visible,size:floor.geometry.parameters.width,height:floor.position.y,contactSolver:false}:null};}
 function refreshGuide(){
  const y=(floor?.position.y??runtime.mesh.geometry.boundingBox?.min.y??0)+.025;
  const geometry=new THREE.BufferGeometry().setFromPoints(walking.guidePoints(mode).map(p=>new THREE.Vector3(p[0],y,p[2])));
  geometry.computeBoundingBox();
  if(!pathGuide){pathGuide=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x55cbd7,depthTest:true}));pathGuide.name='Creature motion path';Object.assign(pathGuide.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosHelperKind:'paths'});pathGuide.visible=false;placement.add(pathGuide);}
  else{const old=pathGuide.geometry;pathGuide.geometry=geometry;old.dispose();}
 }
 function startClock(){
  if(stop)return;
  stop=session.onFrame(({deltaSeconds})=>{
   if(disposed)return;
   if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Walking clock requires a finite nonnegative host delta');
   clock+=deltaSeconds*1000*rate;
   try{
    player.tick(clock);
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
   attempt(unsubscribe);refresh=()=>{};attempt(()=>seating?.dispose());attempt(()=>presentation?.dispose());attempt(()=>skinSelection?.dispose());attempt(()=>player?.dispose());attempt(()=>instruments.remove());attempt(restoreGround);attempt(restoreGizmos);
   try{if(session)await session.dispose();}catch(e){errors.push(e);}attempt(()=>{if(runtime&&!asset)runtime.dispose();});attempt(()=>{if(floor&&!floorAsset){floor.geometry.dispose();floor.material.dispose();}});
   if(globalThis.window?.kaminosWalkingCreature===inspect)delete globalThis.window.kaminosWalkingCreature;
   if(errors.length)throw new AggregateError(errors,'Walking creature cleanup failed');
  });return disposal;
 }
 function inspect(){placement.updateMatrixWorld(true);return {...read(),placementMatrix:placement.matrixWorld.toArray(),rootMatrix:runtime.group.matrixWorld.toArray(),vertices:Array.from(runtime.mesh.geometry.attributes.position.array),boneWorld:[...runtime.bones].map(([name,bone])=>({name,matrix:bone.matrixWorld.toArray()}))};}
 function makePlayer(){
  runtime.group.position.set(0,0,0);runtime.group.quaternion.identity();runtime.group.scale.set(1,1,1);
  const derivedAdapter={...adapter,frame:index=>walking.frame(index,{mode,cycle})};
  return attachGivenPalettePlayback({THREE,runtime,adapter:derivedAdapter,source,document,mountRoot:instruments,mountControls:false,now:()=>clock,dirty:()=>session.redraw(),isMounted:()=>Boolean(placement.parent)});
 }
 try{
  session=await host.scene.open();runtime=createFullBodyRuntime({THREE,...data});
  placement.add(runtime.group);
  asset=await session.attach(placement,{owned:true,metadata:{fileName:'Creature',source:inputs.case,label:'Creature'}});
  player=makePlayer();
  if(inputs.choices?.length)skinSelection=createSkinCaseSelection({runtime,choices:inputs.choices,currentCaseSha256:data.source.caseSha256,loadCase:loadSkin,onApplied:state=>{
   chosenInputs={...chosenInputs,case:state.current.case,case_sha256:state.current.case_sha256};source.caseSha256=state.current.case_sha256;
   host.scene.refreshPresentation?.(asset);session.redraw();refresh();
  }});
  if(inputs.ground==='source-start'){
   const height=document.getElementById('composition-ground-height'),visible=document.getElementById('composition-ground-visible');
   if(!height||!visible)throw Error('Shared Workbench ground controls are unavailable');
   const previous={height:height.value,visible:visible.checked};runtime.group.updateMatrixWorld(true);
   const value=String(givenSourceSoleHeight(runtime.mesh.geometry.attributes.position.array,runtime.mesh.matrixWorld.elements));
   source.groundReference={kind:'source-start-surface-minimum',height:Number(value),animated:false,contactSolver:false};
   const size=inputs.floor_size??5*walking.identity.radius;if(!Number.isFinite(size)||size<=0)throw Error('Reference floor size must be positive');
   floor=new THREE.Mesh(new THREE.PlaneGeometry(size,size),new THREE.MeshStandardMaterial({color:0x808080,roughness:.65}));floor.name='Walking reference floor · not contact';floor.rotation.x=-Math.PI/2;floor.position.y=Number(value);floor.receiveShadow=true;
   floorAsset=await session.attach(floor,{owned:true,metadata:{fileName:floor.name,source:null,label:floor.name}});
   height.value=value;height.dispatchEvent(new Event('change'));visible.checked=false;visible.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(height.value===value&&!visible.checked){height.value=previous.height;height.dispatchEvent(new Event('change'));visible.checked=previous.visible;visible.dispatchEvent(new Event('change'));}};
  }
  if(inputs.view)session.setView(inputs.view);
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
   rate:operation('rate',input=>{if(!Number.isFinite(input?.rate)||input.rate<=0)throw Error('Playback rate must be finite and positive');rate=input.rate;return read();}),
   skin:operation('skin',input=>{if(!skinSelection)throw Error('This creature has no registered cast choices');return skinSelection.select(input);}),
   play:operation('play',()=>{player.play();if(player.read().status==='playing')startClock();return read();}),
   pause:operation('pause',()=>{unsubscribe();player.pause();host.scene.refreshPresentation?.(asset);return read();}),
   replay:operation('replay',()=>{unsubscribe();cycle=0;source.presentation.cycle=0;player.replay();host.scene.refreshPresentation?.(asset);startClock();return read();}),
   seek:operation('seek',input=>{unsubscribe();player.seek(input?.frame);host.scene.refreshPresentation?.(asset);return read();}),
   mode:operation('mode',input=>{if(!['source','cycle','path'].includes(input?.mode))throw Error('Unknown walking mode');unsubscribe();player.pause();mode=input.mode;cycle=0;source.presentation.mode=mode;source.presentation.cycle=0;player.seek(0);refreshGuide();host.scene.refreshPresentation?.(asset);return read();}),
   motion:operation('motion',async input=>{
    const requestId=++motionRequest;
    const next=choices.find(c=>c.id===input?.id);if(!next)throw Error('Unknown retained motion');
    const request={...chosenInputs,motion:next.motion,motion_sha256:next.motion_sha256,prefix:next.prefix,prefix_sha256:next.prefix_sha256};
    let loaded;try{loaded=await loadSources(request);}catch(error){active();if(requestId!==motionRequest)return {status:'superseded',effective:read()};throw error;}
    active();if(requestId!==motionRequest)return {status:'superseded',effective:read()};
    if(loaded.source.motionSha256!==next.motion_sha256||loaded.source.caseSha256!==source.caseSha256||loaded.source.frameSha256!==data.source.frameSha256||loaded.motion.assetCondSha256!==data.motion.assetCondSha256)throw Error('Motion choice changed the source, body, bind frame or rig conditioning');
    if(next.prompt!==undefined&&next.prompt!==loaded.motion.prompt||next.seed!==undefined&&next.seed!==loaded.motion.seed)throw Error('Motion choice prompt or seed differs from retained source');
    const nextAdapter=createGivenPaletteMotion({THREE,motion:loaded.motion,rigFrame:data.frame}),nextWalking=createWalkingPoseAdapter({THREE,adapter:nextAdapter,radius:inputs.radius??10,blendFrames:inputs.blend_frames??6});
    const prior={adapter,walking,source:structuredClone(source),chosen,chosenInputs,cycle,frame:player.read().frame,status:player.read().status};
    const replaceSource=value=>{for(const key of Object.keys(source))delete source[key];Object.assign(source,value);};
    try{
     unsubscribe();player.dispose();adapter=nextAdapter;walking=nextWalking;cycle=0;
     replaceSource({...loaded.source,prompt:loaded.motion.prompt??null,seed:loaded.motion.seed??null,groundReference:prior.source.groundReference,presentation:{mode,cycle,...walking.identity}});
     player=makePlayer();chosen=next;chosenInputs=request;refreshGuide();if(prior.status==='playing'){player.play();startClock();}host.scene.refreshPresentation?.(asset);return read();
    }
    catch(error){
     try{player?.dispose();adapter=prior.adapter;walking=prior.walking;chosen=prior.chosen;chosenInputs=prior.chosenInputs;cycle=prior.cycle;replaceSource(prior.source);player=makePlayer();if(prior.frame!==null)player.seek(prior.frame);refreshGuide();if(prior.status==='playing'){player.play();startClock();}host.scene.refreshPresentation?.(asset);}
     catch(rollback){throw new AggregateError([error,rollback],'Motion switch and prior-state restoration failed');}
     throw error;
    }
   }),
   floor:operation('floor',input=>{if(!floor)throw Error('No walking reference floor is mounted');if(typeof input?.visible!=='boolean')throw Error('Reference floor visibility must be boolean');floor.visible=input.visible;session.redraw();return read();}),
  };
  if(inputs.mode!==undefined)operations.mode({mode:inputs.mode});
  if(inputs.cycle!==undefined){if(!Number.isSafeInteger(inputs.cycle)||inputs.cycle<0)throw Error('Invalid authored repeat cycle');cycle=inputs.cycle;source.presentation.cycle=cycle;player.seek(0);}
  if(inputs.sample!==undefined)operations.seek({frame:inputs.sample});
  if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial playback must be boolean');
  if(inputs.play===true)operations.play();
  host.scene.refreshPresentation?.(asset);
  if(globalThis.window)window.kaminosWalkingCreature=inspect;
  return {read,operations,dispose,mount({root,invoke,reopen=recipe=>{
   const entry=globalThis.window?.kaminosWorkbenchExperiments;if(typeof entry?.open!=='function')throw Error('Shared creature setup entry is unavailable');return entry.open('marionette/walking-creature',recipe);
  }}){
   seating?.dispose();presentation?.dispose();
   presentation=mountCreatureProperties({document,read,invoke,
    save(recipe){const url=URL.createObjectURL(new Blob([JSON.stringify(recipe,null,2)+'\n'],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='creature.setup.json';link.click();URL.revokeObjectURL(url);},
    async open(recipe){
     checkRecipeInputs(recipe);await checkRecipeView(recipe.view,session.readView());
     const loaded=await loadSources(recipe),check=createGivenPaletteMotion({THREE,motion:loaded.motion,rigFrame:loaded.frame});
     createWalkingPoseAdapter({THREE,adapter:check,radius:recipe.radius??10,blendFrames:recipe.blend_frames??6});if(recipe.sample!==undefined)check.frame(recipe.sample);
     active();await reopen(recipe);
    }});
   refresh=presentation.update;
   if(host.controls.mountObject)seating=host.controls.mountObject({asset,properties:presentation.properties,playback:presentation.playback,onSelected:refresh});
   else root.append(presentation.properties,presentation.playback);
   refresh();return {dispose(){seating?.dispose();presentation?.dispose();refresh=()=>{};}};
  }};
 }catch(error){await dispose();throw error;}
}

export default {id:'marionette/walking-creature',title:'Creature · walking around',create:createWalkingCreature};
