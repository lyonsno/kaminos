import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {givenSourceSoleHeight} from './given-motion-source.mjs';
import {createWalkingPoseAdapter} from './walking-pose.mjs';

export async function createWalkingCreature({host,inputs={},record=()=>{}},{loadSources=loadFullBodySources}={}) {
 if(typeof host?.scene?.open!=='function'||!host.controls?.document)throw Error('Walking creature requires the actual shared Workbench host');
 const data=await loadSources(inputs),document=host.controls.document;
 const adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame});
 const walking=createWalkingPoseAdapter({THREE,adapter,radius:inputs.radius??10,blendFrames:inputs.blend_frames??6});
 const source={...data.source,presentation:{mode:'source',...walking.identity}};
 let session,runtime,asset,floor,floorAsset,player,stop=null,clock=0,cycle=0,mode='source',disposed=false,disposal,restoreGround=()=>{},refresh=()=>{};
 const instruments=document.createElement('div');
 const unsubscribe=()=>{const previous=stop;stop=null;previous?.();};
 function read(){return {mode,cycle,source:structuredClone(source),host:{id:asset.id,route:'shared-owner-scene',scene:globalThis.window?.kaminosWorkbenchSceneState?.()??null},
  skin:runtime.read(),playback:player.read(),view:session.readView(),referenceFloor:floor?{id:floorAsset.id,visible:floor.visible,size:floor.geometry.parameters.width,height:floor.position.y,contactSolver:false}:null};}
 function startClock(){
  if(stop)return;
  stop=session.onFrame(({deltaSeconds})=>{
   if(disposed)return;
   if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Walking clock requires a finite nonnegative host delta');
   clock+=deltaSeconds*1000;
   try{
    player.tick(clock);
    if(player.read().status==='held'&&mode!=='source'){cycle++;source.presentation.cycle=cycle;player.replay();}
    else if(player.read().status!=='playing')unsubscribe();
    refresh();
   }catch(error){unsubscribe();record({kind:'walking.frame',phase:'failed',error:error.message});throw error;}
  });
 }
 async function dispose(){
  if(disposal)return disposal;disposed=true;
  disposal=Promise.resolve().then(async()=>{
   unsubscribe();refresh=()=>{};player?.dispose();instruments.remove();restoreGround();
   if(session)await session.dispose();if(runtime&&!asset)runtime.dispose();if(floor&&!floorAsset){floor.geometry.dispose();floor.material.dispose();}
   if(globalThis.window?.kaminosWalkingCreature===inspect)delete globalThis.window.kaminosWalkingCreature;
  });return disposal;
 }
 function inspect(){runtime.group.updateMatrixWorld(true);return {...read(),rootMatrix:runtime.group.matrixWorld.toArray(),vertices:Array.from(runtime.mesh.geometry.attributes.position.array),boneWorld:[...runtime.bones].map(([name,bone])=>({name,matrix:bone.matrixWorld.toArray()}))};}
 try{
  session=await host.scene.open();runtime=createFullBodyRuntime({THREE,...data});
  asset=await session.attach(runtime.group,{owned:true,metadata:{fileName:'Walking creature',source:inputs.case,label:'Generated full-body motion · unchanged automatic skin'}});
  const derivedAdapter={...adapter,frame:index=>walking.frame(index,{mode,cycle})};
  player=attachGivenPalettePlayback({THREE,runtime,adapter:derivedAdapter,source,document,mountRoot:instruments,now:()=>clock,dirty:()=>session.redraw()});
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
  const active=()=>{if(disposed)throw Error('Walking creature experiment is disposed');};
  const operation=(name,action)=>input=>{active();record({kind:`walking.${name}`,phase:'requested',requested:input??null});try{const result=action(input);refresh();record({kind:`walking.${name}`,phase:'applied',mode,cycle,frame:player.read().frame});return result;}catch(error){record({kind:`walking.${name}`,phase:'failed',error:error.message});throw error;}};
  const operations={
   play:operation('play',()=>{player.play();if(player.read().status==='playing')startClock();return read();}),
   pause:operation('pause',()=>{unsubscribe();player.pause();return read();}),
   replay:operation('replay',()=>{unsubscribe();cycle=0;source.presentation.cycle=0;player.replay();startClock();return read();}),
   seek:operation('seek',input=>{unsubscribe();player.seek(input?.frame);return read();}),
   mode:operation('mode',input=>{if(!['source','cycle','path'].includes(input?.mode))throw Error('Unknown walking mode');unsubscribe();player.pause();mode=input.mode;cycle=0;source.presentation.mode=mode;source.presentation.cycle=0;player.seek(0);host.scene.refreshPresentation?.(asset);return read();}),
   floor:operation('floor',input=>{if(!floor)throw Error('No walking reference floor is mounted');if(typeof input?.visible!=='boolean')throw Error('Reference floor visibility must be boolean');floor.visible=input.visible;session.redraw();return read();}),
  };
  if(globalThis.window)window.kaminosWalkingCreature=inspect;
  return {read,operations,dispose,mount({root,invoke}){
   const panel=document.createElement('section');panel.className='walking-creature-instruments';
   const title=document.createElement('h3');title.textContent='Creature · walking around';panel.append(title);
   const note=document.createElement('p');note.textContent=`Same automatic full skin · source ${(adapter.frames/adapter.fps).toFixed(2)} s · repeat seam ${walking.identity.seam.frames} blended frames · curve radius ${walking.identity.radius}. No foot/contact correction.`;panel.append(note);
   const status=document.createElement('output'),error=document.createElement('output');error.setAttribute('role','alert');panel.append(status,error);
   const call=async(name,input)=>{try{error.textContent='';await invoke(name,input);}catch(e){error.textContent=e.message;}};
   for(const [label,next] of [['Raw source','source'],['Straight cycle','cycle'],['Walk the curve','path']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>call('mode',{mode:next});panel.append(button);}
   for(const [label,name] of [['Play motion','play'],['Pause motion','pause'],['Restart motion','replay']]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>call(name);panel.append(button);}
   if(floor){const label=document.createElement('label');label.textContent='Walking reference floor ';const input=document.createElement('input');input.type='checkbox';input.checked=floor.visible;input.onchange=()=>call('floor',{visible:input.checked});label.append(input);panel.append(label);}
   for(const [label,index] of [['First motion sample',0],['Middle motion sample',Math.floor((adapter.frames-1)/2)],['Last motion sample',adapter.frames-1]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>call('seek',{frame:index});panel.append(button);}
   if(source.prefixFrames){for(const [label,index] of [['Before continuation join',source.prefixFrames-1],['After continuation join',source.prefixFrames]]){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>call('seek',{frame:index});panel.append(button);}}
   const range=document.createElement('input');range.type='range';range.min='0';range.max=String(adapter.frames-1);range.step='1';range.setAttribute('aria-label','Walking source sample');range.oninput=()=>call('seek',{frame:Number(range.value)});panel.append(range);
   // The reused player's private controls stay detached. All visible controls
   // invoke the serialized owner entry and its shared clock.
   refresh=()=>{const p=player.read();status.textContent=`${mode==='source'?'Raw source':'Derived '+mode} · repeat ${cycle} · ${p.status} · sample ${p.frame==null?'rest':p.frame+1}/${adapter.frames}`;range.value=String(p.frame??0);};root.append(panel);refresh();return {dispose(){panel.remove();}};
  }};
 }catch(error){await dispose();throw error;}
}

export default {id:'marionette/walking-creature',title:'Creature · walking around',create:createWalkingCreature};
