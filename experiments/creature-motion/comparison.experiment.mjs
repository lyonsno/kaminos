import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGpuSkinDeformer} from './gpu-skin-deformer.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {createWalkingPoseAdapter} from './walking-pose.mjs';
import {mountPlaybackControls} from '../../playback-controls.mjs';

function labelSprite(document,text){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=112;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Comparison label canvas unavailable');
 ctx.fillStyle='rgba(12,17,23,.88)';ctx.fillRect(0,0,768,112);ctx.font='bold 38px system-ui';ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,56);
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));
 // Sprite normally borrows one global geometry. A removable owned scene tree
 // must not dispose that buffer while the other five labels still draw it.
 sprite.geometry=sprite.geometry.clone();sprite.scale.set(3.3,.48,1);sprite.renderOrder=101;Object.assign(sprite.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true});return sprite;
}

export async function loadComparisonRecipe(input,{fetchImpl=globalThis.fetch}={}){
 if(!input.recipe)return {inputs:input,source:{kind:'inline'}};
 if(Object.hasOwn(input,'entries'))throw Error('Choose one input authority: inline entries or a recipe file');
 if(typeof input.recipe!=='string'||!/^[a-f0-9]{64}$/i.test(input.recipe_sha256??''))throw Error('Explicit comparison recipe URL and digest required');
 const response=await fetchImpl(input.recipe,{cache:'no-store'});if(!response.ok)throw Error('Comparison recipe HTTP '+response.status);
 const bytes=await response.arrayBuffer(),sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(sha!==input.recipe_sha256.toLowerCase())throw Error('Comparison recipe digest mismatch');
 return {inputs:JSON.parse(new TextDecoder().decode(bytes)),source:{kind:'authenticated-file',url:input.recipe,sha256:sha}};
}

// A caller-owned list of authenticated bodies and clips, composed in the ordinary
// scene. Placement is a base transform, not a rewrite of the model output.
export async function createCreatureComparison({host,inputs={},record=()=>{}},{loadSources=loadFullBodySources,makeLabel=labelSprite,fetchImpl=globalThis.fetch}={}){
 const recipe=await loadComparisonRecipe(inputs,{fetchImpl});inputs=recipe.inputs;
 const specs=inputs.entries,document=host?.controls?.document;
 if(!host?.scene?.open||!document)throw Error('Comparison requires the actual Workbench scene and controls');
 if(!Array.isArray(specs)||!specs.length)throw Error('Comparison requires explicit entries');
 if(specs.some(s=>!s||typeof s.id!=='string'||!s.id.trim()||typeof s.label!=='string'||!s.label.trim())||new Set(specs.map(s=>s.id)).size!==specs.length)throw Error('Comparison entry IDs must be unique and labelled');
 if(specs.some(s=>!Array.isArray(s.position)||s.position.length!==3||!s.position.every(Number.isFinite)))throw Error('Comparison requires three finite placement coordinates per entry');
 if(specs.some(s=>(s.quaternion!==undefined&&(s.quaternion.length!==4||!s.quaternion.every(Number.isFinite)||Math.abs(Math.hypot(...s.quaternion)-1)>1e-5))||(s.scale!==undefined&&(s.scale.length!==3||!s.scale.every(v=>Number.isFinite(v)&&v>0)))))throw Error('Invalid comparison authored transform');
 let mode=inputs.presentation??'in-place';if(!['in-place','travel','raw'].includes(mode))throw Error('Unknown comparison presentation');
 if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial comparison playback must be boolean');
 const data=await Promise.all(specs.map(s=>loadSources(s.source))); // authenticate every source before adding a body
 let session,stop=null,seconds=0,status='paused',disposed=false,disposal,restoreGround=()=>{},refresh=()=>{},rate=inputs.rate??1;
 if(!Number.isFinite(rate)||rate<=0)throw Error('Comparison playback rate must be positive');
 const seats=[],panels=[];
 const rows=[],unattached=[];let floor;
 const active=()=>{if(disposed)throw Error('Comparison is disposed');};
 const unsubscribe=()=>{const old=stop;stop=null;old?.();};
 const mounted=row=>Boolean(row.placement.parent);
 const duration=Math.max(...data.map(d=>(d.motion.frames-1)/d.motion.skeleton.fps));
 function apply(){
  let remaining=0;
  for(const row of rows){
   if(!mounted(row)){row.player.tick(0);row.removed=true;continue;}
   remaining++;const f=Math.floor(seconds*row.adapter.fps+1e-6);row.cycle=mode==='raw'?0:Math.floor(f/row.adapter.frames);
   const index=mode==='raw'?Math.min(row.adapter.frames-1,f):f%row.adapter.frames;
   if(row.last!==index||row.lastCycle!==row.cycle||row.lastMode!==mode){row.player.seek(index);row.last=index;row.lastCycle=row.cycle;row.lastMode=mode;}
   if(row.path&&(row.pathMode!==mode||row.pathCycle!==row.cycle)){
    const points=Array.from({length:row.adapter.frames},(_,i)=>{const m=row.walking.frame(i,{mode:mode==='raw'?'source':'cycle',cycle:mode==='travel'?row.cycle:0}).actorMatrix,first=row.adapter.frame(0).actorMatrix;return new THREE.Vector3(mode==='in-place'?first[12]:m[12],row.pathHeight,mode==='in-place'?first[14]:m[14]);});
    const old=row.path.geometry;row.path.geometry=new THREE.BufferGeometry().setFromPoints(points);old.dispose();row.pathMode=mode;row.pathCycle=row.cycle;
   }
  }
  if(!remaining){status='removed';unsubscribe();}
  session.redraw();refresh();
 }
 function present(){for(const row of rows)if(mounted(row)){row.runtime.syncCpuGeometry();host.scene.refreshPresentation?.(row.asset);}}
 function start(){if(stop||status!=='playing')return;stop=session.onFrame(({deltaSeconds})=>{
  try{if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid shared comparison clock delta');seconds+=deltaSeconds*rate;
   if(mode==='raw'&&seconds>=duration){seconds=duration;status='held';unsubscribe();}
   apply();if(status==='held')present();
  }catch(error){status='failed';unsubscribe();record({kind:'creature.comparison.frame',phase:'failed',error:error.message});throw error;}
 });}
 const timeline=data.reduce((a,b)=>a.motion.frames/a.motion.skeleton.fps>=b.motion.frames/b.motion.skeleton.fps?a:b).motion;
 const displayTime=()=>mode==='raw'?Math.min(seconds,duration):(Math.floor(seconds*timeline.skeleton.fps+1e-6)%timeline.frames)/timeline.skeleton.fps;
 function read(){return {status,seconds,rate,presentation:mode,recipe:recipe.source,sourceDuration:duration,activeSubscription:Boolean(stop),
  semantics:{rootTravel:mode==='in-place'?'horizontal actor translation held at first sample':'retained source travel',verticalAction:'retained',yaw:'retained',seam:mode==='raw'?'none':'derived pose crossfade',contactSolver:false},
  entries:rows.map(row=>{row.placement.updateWorldMatrix(true,true);return {key:row.spec.id,label:row.spec.label,id:row.removed?null:row.asset.id,status:row.removed?'removed':status,frame:row.last,cycle:row.cycle,source:row.source,skin:row.runtime.read(),rootMatrix:row.runtime.group.matrixWorld.toArray()};}),view:session?.readView()??null};}
 function inspect(){return {...read(),entries:read().entries.map((r,i)=>({...r,vertices:Array.from(rows[i].runtime.syncCpuGeometry().attributes.position.array),boneWorld:[...rows[i].runtime.bones].map(([name,bone])=>({name,matrix:bone.matrixWorld.toArray()}))}))};}
 async function dispose(){if(disposal)return disposal;disposed=true;unsubscribe();refresh=()=>{};disposal=Promise.resolve().then(async()=>{
  const errors=[];for(const seat of seats)seat.dispose();for(const panel of panels)panel.dispose();for(const row of rows)try{row.player.dispose();}catch(e){errors.push(e);}
  try{restoreGround();}catch(e){errors.push(e);}try{await session?.dispose();}catch(e){errors.push(e);}
  for(const row of rows)try{row.runtime.dispose();}catch(e){errors.push(e);}
  for(const runtime of unattached)try{runtime.dispose();}catch(e){errors.push(e);}
  if(globalThis.window?.kaminosCreatureComparison===inspect)delete window.kaminosCreatureComparison;
  if(errors.length)throw new AggregateError(errors,'Comparison cleanup failed');
 });return disposal;}
 try{
  session=await host.scene.open();
  for(let i=0;i<specs.length;i++){
   const spec=specs[i],runtime=createFullBodyRuntime({THREE,...data[i],deformerFactory:createGpuSkinDeformer});unattached.push(runtime);runtime.group.name=spec.label;
   const placement=new THREE.Group();placement.name=spec.label;placement.userData.kaminosFrameContentOnly=true;placement.position.fromArray(spec.position);if(spec.quaternion)placement.quaternion.fromArray(spec.quaternion);if(spec.scale)placement.scale.fromArray(spec.scale);placement.add(runtime.group);
   const adapter=createGivenPaletteMotion({THREE,motion:data[i].motion,rigFrame:data[i].frame});
   const walking=createWalkingPoseAdapter({THREE,adapter,blendFrames:inputs.blend_frames??6});
   const source={...data[i].source,prompt:data[i].motion.prompt,seed:data[i].motion.seed,cfgScale:data[i].motion.cfgScale,presentation:'caller-positioned simultaneous comparison'};
   const row={spec,runtime,placement,adapter,walking,source,cycle:0,last:null,lastMode:null,lastCycle:null,removed:false};
   row.asset=await session.attach(placement,{owned:true,metadata:{fileName:spec.label,source:spec.source.case,label:spec.label}});unattached.splice(unattached.indexOf(runtime),1);
   const first=adapter.frame(0).actorMatrix;
   const derived={...adapter,frame:index=>{const p=walking.frame(index,{mode:mode==='raw'?'source':'cycle',cycle:mode==='travel'?row.cycle:0});
    if(mode!=='in-place')return p;const actorMatrix=[...p.actorMatrix];actorMatrix[12]=first[12];actorMatrix[14]=first[14];return {...p,actorMatrix};}};
   row.player=attachGivenPalettePlayback({THREE,runtime,adapter:derived,source,document,mountRoot:document.createElement('div'),mountControls:false,isMounted:()=>mounted(row),dirty:()=>{}});rows.push(row);
   const label=makeLabel(document,spec.label);if(label){const box=runtime.syncCpuGeometry().boundingBox;label.position.set((box.min.x+box.max.x)/2,box.max.y+.5,(box.min.z+box.max.z)/2);runtime.group.add(label);}
  }
  if(inputs.ground!==false){
   const height=document.getElementById('composition-ground-height'),visible=document.getElementById('composition-ground-visible');if(!height||!visible)throw Error('Shared comparison ground controls unavailable');
   const boxes=rows.map(r=>new THREE.Box3().setFromObject(r.runtime.mesh));const y=Math.min(...boxes.map(b=>b.min.y)),value=String(y),previous={height:height.value,visible:visible.checked};
   floor=new THREE.Mesh(new THREE.PlaneGeometry(inputs.floor_size??60,inputs.floor_size??60),new THREE.MeshStandardMaterial({color:0x777777,roughness:.7}));floor.name='Comparison reference floor · no contact';floor.rotation.x=-Math.PI/2;floor.position.y=y;floor.receiveShadow=true;
   await session.attach(floor,{owned:true,metadata:{fileName:floor.name,source:null,label:floor.name}});
   height.value=value;height.dispatchEvent(new Event('change'));visible.checked=false;visible.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(height.value===value&&!visible.checked){height.value=previous.height;height.dispatchEvent(new Event('change'));visible.checked=previous.visible;visible.dispatchEvent(new Event('change'));}};
  }
  for(const row of rows){row.pathHeight=(floor?.position.y??0)+.025;row.path=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0x55cbd7}));row.path.name='Current-cycle root path';Object.assign(row.path.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosHelperKind:'paths'});row.path.visible=false;row.placement.add(row.path);}
  if(inputs.view)session.setView(inputs.view);
  const operations={
   async inspectGpu(){active();if(status==='playing')throw Error('Pause comparison before same-pose GPU readback');return Promise.all(rows.filter(mounted).map(async row=>{
    const gpu=await row.runtime.readGpuGeometry(),cpu=row.runtime.syncCpuGeometry();
    return {key:row.spec.id,frame:row.last,source:row.source,backend:gpu.backend,dispatches:gpu.dispatches,layout:gpu.layout,packedPositions:Array.from(gpu.packedPositions),packedNormals:Array.from(gpu.packedNormals),positions:Array.from(gpu.positions),normals:Array.from(gpu.normals),cpuPositions:Array.from(cpu.attributes.position.array),cpuNormals:Array.from(cpu.attributes.normal.array)};
   }));},
   play(){active();if(status==='removed')throw Error('All comparison bodies removed');status='playing';start();refresh();return read();},
   pause(){active();unsubscribe();status='paused';present();refresh();return read();},
   restart(){active();seconds=0;status='playing';apply();start();present();return read();},
   replay(){return operations.restart();},
   rate({rate:next}={}){active();if(!Number.isFinite(next)||next<=0)throw Error('Comparison playback rate must be positive');rate=next;refresh();return read();},
   step({direction}={}){if(direction!==1&&direction!==-1)throw Error('Step direction must be -1 or 1');return operations.seek({seconds:Math.min(duration,Math.max(0,displayTime()+direction/timeline.skeleton.fps))});},
   setup(){active();return {...structuredClone(inputs),entries:rows.filter(mounted).map(row=>({...structuredClone(row.spec),position:row.placement.position.toArray(),quaternion:row.placement.quaternion.toArray(),scale:row.placement.scale.toArray()})),presentation:mode,rate,seconds:displayTime(),play:status==='playing',view:session.readView()};},
   seek({seconds:next}={}){active();if(!Number.isFinite(next)||next<0||next>duration)throw Error('Comparison seek outside source duration');unsubscribe();seconds=next;status='paused';apply();present();return read();},
   presentation({mode:next}={}){active();if(!['in-place','travel','raw'].includes(next))throw Error('Unknown comparison presentation');unsubscribe();mode=next;for(const row of rows)row.runtime.setPoseRetention(mode!=='travel');seconds=0;status='paused';apply();present();return read();},
  };
  // GPU transport consumes the current bone palette in every presentation. No
  // finite-mesh cache, warmup traversal, private renderer or private frame loop.
  apply();if(inputs.seconds!==undefined)operations.seek({seconds:inputs.seconds});if(inputs.play!==false)operations.play();if(globalThis.window)window.kaminosCreatureComparison=inspect;
  return {read,operations,dispose,mount({root,invoke}){
   const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
   const updates=[];
   for(const row of rows){
    const properties=el('section');properties.className='creature-properties';
    properties.append(el('style','.scene-owner-playback{position:absolute;bottom:0;left:0;right:0;z-index:35}.creature-properties{display:grid;gap:10px;padding-top:12px;font:12px system-ui;color:#d9e2e5;overflow-wrap:anywhere}.creature-properties[hidden]{display:none}.creature-properties label{display:grid;gap:5px}.creature-properties select,.creature-properties button{background:#292e32;color:inherit;border:1px solid #505d64;padding:7px;border-radius:4px}'));
    const title=el('h3',row.spec.label),identity=el('p',`${row.source.prompt??'Retained motion'} · independent bind family`),source=el('details');
    source.append(el('summary','Source identity'),el('p',`Motion ${row.source.motionSha256}\nSkin ${row.source.caseSha256}\nFrame ${row.source.frameSha256}`));
    const label=el('label','Cohort playback'),select=el('select');select.setAttribute('aria-label','Comparison presentation');
    for(const [value,text]of [['in-place','In-place pairs'],['travel','Traveling pairs'],['raw','Raw once']]){const o=el('option',text);o.value=value;select.append(o);}label.append(select);
    const error=el('output');error.setAttribute('role','alert');
    select.onchange=()=>Promise.resolve(invoke('presentation',{mode:select.value})).catch(e=>error.textContent=e.message);
    const save=el('button','Save comparison setup');save.type='button';save.onclick=async()=>{const setup=await invoke('setup'),url=URL.createObjectURL(new Blob([JSON.stringify(setup,null,2)+'\n'],{type:'application/json'})),a=el('a');a.href=url;a.download='creature-comparison.setup.json';a.click();URL.revokeObjectURL(url);};
    properties.append(title,identity,label,el('p','One shared clock for every body. Placement is editable independently. Derived pose seam; no contact correction.'),source,save,error);
    const holder=el('div'),playback=mountPlaybackControls({document,root:holder,label:'Creature cohort playback',read:()=>({playing:status==='playing',time:displayTime(),duration,stepSeconds:1/timeline.skeleton.fps,rate,busy:row.removed,canSeek:!row.removed,canStep:!row.removed}),invoke});
    panels.push(playback);const update=()=>{select.value=mode;playback.update();};updates.push(update);
    if(host.controls.mountObject)seats.push(host.controls.mountObject({asset:row.asset,properties,playback:playback.node,onSelected:update}));else root.append(properties,playback.node);
   }
   refresh=()=>updates.forEach(update=>update());refresh();globalThis.window?.selectSceneObject?.(rows.find(mounted)?.asset.id);return {dispose(){for(const seat of seats)seat.dispose();for(const panel of panels)panel.dispose();refresh=()=>{};}};
  }};
 }catch(error){await dispose();throw error;}
}
export default {id:'marionette/motion-comparison',title:'Creature · paired parade',create:createCreatureComparison};
