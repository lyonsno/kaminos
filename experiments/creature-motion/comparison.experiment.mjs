import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {createWalkingPoseAdapter} from './walking-pose.mjs';

function labelSprite(document,text){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=112;
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Comparison label canvas unavailable');
 ctx.fillStyle='rgba(12,17,23,.88)';ctx.fillRect(0,0,768,112);ctx.font='bold 38px system-ui';ctx.fillStyle='#ffffff';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,384,56);
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));sprite.scale.set(3.3,.48,1);sprite.renderOrder=101;return sprite;
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
export async function createCreatureComparison({host,inputs={},record=()=>{}},{loadSources=loadFullBodySources,makeLabel=labelSprite,fetchImpl=globalThis.fetch,yieldWork=()=>new Promise(resolve=>setTimeout(resolve,0))}={}){
 const recipe=await loadComparisonRecipe(inputs,{fetchImpl});inputs=recipe.inputs;
 const specs=inputs.entries,document=host?.controls?.document;
 if(!host?.scene?.open||!document)throw Error('Comparison requires the actual Workbench scene and controls');
 if(!Array.isArray(specs)||!specs.length)throw Error('Comparison requires explicit entries');
 if(specs.some(s=>!s||typeof s.id!=='string'||!s.id.trim()||typeof s.label!=='string'||!s.label.trim())||new Set(specs.map(s=>s.id)).size!==specs.length)throw Error('Comparison entry IDs must be unique and labelled');
 if(specs.some(s=>!Array.isArray(s.position)||s.position.length!==3||!s.position.every(Number.isFinite)))throw Error('Comparison requires three finite placement coordinates per entry');
 let mode=inputs.presentation??'in-place';if(!['in-place','travel','raw'].includes(mode))throw Error('Unknown comparison presentation');
 if(inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Initial comparison playback must be boolean');
 const data=await Promise.all(specs.map(s=>loadSources(s.source))); // authenticate every source before adding a body
 let session,stop=null,seconds=0,status='paused',disposed=false,disposal,restoreGround=()=>{},refresh=()=>{};
 const rows=[],unattached=[];let floor;
 const active=()=>{if(disposed)throw Error('Comparison is disposed');};
 const unsubscribe=()=>{const old=stop;stop=null;old?.();};
 const mounted=row=>Boolean(row.runtime.group.parent);
 const duration=Math.max(...data.map(d=>(d.motion.frames-1)/d.motion.skeleton.fps));
 function apply(){
  let remaining=0;
  for(const row of rows){
   if(!mounted(row)){row.player.tick(0);row.removed=true;continue;}
   remaining++;const f=Math.floor(seconds*row.adapter.fps+1e-6);row.cycle=mode==='raw'?0:Math.floor(f/row.adapter.frames);
   const index=mode==='raw'?Math.min(row.adapter.frames-1,f):f%row.adapter.frames;
   if(row.last!==index||row.lastCycle!==row.cycle||row.lastMode!==mode){row.player.seek(index);row.last=index;row.lastCycle=row.cycle;row.lastMode=mode;}
  }
  if(!remaining){status='removed';unsubscribe();}
  session.redraw();refresh();
 }
 function present(){for(const row of rows)if(mounted(row))host.scene.refreshPresentation?.(row.asset);}
 function start(){if(stop||status!=='playing')return;stop=session.onFrame(({deltaSeconds})=>{
  try{if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid shared comparison clock delta');seconds+=deltaSeconds;
   if(mode==='raw'&&seconds>=duration){seconds=duration;status='held';unsubscribe();}
   apply();if(status==='held')present();
  }catch(error){status='failed';unsubscribe();record({kind:'creature.comparison.frame',phase:'failed',error:error.message});throw error;}
 });}
 function read(){return {status,seconds,presentation:mode,recipe:recipe.source,sourceDuration:duration,activeSubscription:Boolean(stop),
  semantics:{rootTravel:mode==='in-place'?'horizontal actor translation held at first sample':'retained source travel',verticalAction:'retained',yaw:'retained',seam:mode==='raw'?'none':'derived pose crossfade',contactSolver:false},
  entries:rows.map(row=>{row.runtime.group.updateMatrixWorld(true);return {key:row.spec.id,label:row.spec.label,id:row.removed?null:row.asset.id,status:row.removed?'removed':status,frame:row.last,cycle:row.cycle,source:row.source,skin:row.runtime.read(),rootMatrix:row.runtime.group.matrixWorld.toArray()};}),view:session?.readView()??null};}
 function inspect(){return {...read(),entries:read().entries.map((r,i)=>({...r,vertices:Array.from(rows[i].runtime.mesh.geometry.attributes.position.array),boneWorld:[...rows[i].runtime.bones].map(([name,bone])=>({name,matrix:bone.matrixWorld.toArray()}))}))};}
 async function dispose(){if(disposal)return disposal;disposed=true;unsubscribe();refresh=()=>{};disposal=Promise.resolve().then(async()=>{
  const errors=[];for(const row of rows)try{row.player.dispose();}catch(e){errors.push(e);}
  try{restoreGround();}catch(e){errors.push(e);}try{await session?.dispose();}catch(e){errors.push(e);}
  for(const runtime of unattached)try{runtime.dispose();}catch(e){errors.push(e);}
  if(globalThis.window?.kaminosCreatureComparison===inspect)delete window.kaminosCreatureComparison;
  if(errors.length)throw new AggregateError(errors,'Comparison cleanup failed');
 });return disposal;}
 try{
  session=await host.scene.open();
  for(let i=0;i<specs.length;i++){
   const spec=specs[i],runtime=createFullBodyRuntime({THREE,...data[i],retainPoses:mode!=='travel'});unattached.push(runtime);runtime.group.position.fromArray(spec.position);runtime.group.name=spec.label;
   const adapter=createGivenPaletteMotion({THREE,motion:data[i].motion,rigFrame:data[i].frame});
   const walking=createWalkingPoseAdapter({THREE,adapter,blendFrames:inputs.blend_frames??6});
   const source={...data[i].source,prompt:data[i].motion.prompt,seed:data[i].motion.seed,cfgScale:data[i].motion.cfgScale,presentation:'caller-positioned simultaneous comparison'};
   const row={spec,runtime,adapter,source,cycle:0,last:null,lastMode:null,lastCycle:null,removed:false};
   row.asset=await session.attach(runtime.group,{owned:true,metadata:{fileName:spec.label,source:spec.source.case,label:spec.label}});unattached.splice(unattached.indexOf(runtime),1);
   const first=adapter.frame(0).actorMatrix;
   const derived={...adapter,frame:index=>{const p=walking.frame(index,{mode:mode==='raw'?'source':'cycle',cycle:mode==='travel'?row.cycle:0});
    if(mode!=='in-place')return p;const actorMatrix=[...p.actorMatrix];actorMatrix[12]=first[12];actorMatrix[14]=first[14];return {...p,actorMatrix};}};
   row.player=attachGivenPalettePlayback({THREE,runtime,adapter:derived,source,document,mountRoot:document.createElement('div'),dirty:()=>{}});rows.push(row);
   const label=makeLabel(document,spec.label);if(label){runtime.mesh.geometry.computeBoundingBox();const box=runtime.mesh.geometry.boundingBox;label.position.set((box.min.x+box.max.x)/2,box.max.y+.5,(box.min.z+box.max.z)/2);runtime.group.add(label);}
  }
  if(inputs.ground!==false){
   const height=document.getElementById('composition-ground-height'),visible=document.getElementById('composition-ground-visible');if(!height||!visible)throw Error('Shared comparison ground controls unavailable');
   const boxes=rows.map(r=>new THREE.Box3().setFromObject(r.runtime.mesh));const y=Math.min(...boxes.map(b=>b.min.y)),value=String(y),previous={height:height.value,visible:visible.checked};
   floor=new THREE.Mesh(new THREE.PlaneGeometry(inputs.floor_size??60,inputs.floor_size??60),new THREE.MeshStandardMaterial({color:0x777777,roughness:.7}));floor.name='Comparison reference floor · no contact';floor.rotation.x=-Math.PI/2;floor.position.y=y;floor.receiveShadow=true;
   await session.attach(floor,{owned:true,metadata:{fileName:floor.name,source:null,label:floor.name}});
   height.value=value;height.dispatchEvent(new Event('change'));visible.checked=false;visible.dispatchEvent(new Event('change'));
   restoreGround=()=>{if(height.value===value&&!visible.checked){height.value=previous.height;height.dispatchEvent(new Event('change'));visible.checked=previous.visible;visible.dispatchEvent(new Event('change'));}};
  }
  if(inputs.view)session.setView(inputs.view);
  const operations={
   play(){active();if(status==='removed')throw Error('All comparison bodies removed');status='playing';start();refresh();return read();},
   pause(){active();unsubscribe();status='paused';present();refresh();return read();},
   restart(){active();seconds=0;status='playing';apply();start();present();return read();},
   seek({seconds:next}={}){active();if(!Number.isFinite(next)||next<0||next>duration)throw Error('Comparison seek outside source duration');unsubscribe();seconds=next;status='paused';apply();present();return read();},
   presentation({mode:next}={}){active();if(!['in-place','travel','raw'].includes(next))throw Error('Unknown comparison presentation');unsubscribe();mode=next;for(const row of rows)row.runtime.setPoseRetention(mode!=='travel');seconds=0;status='paused';apply();present();return read();},
  };
  // The default comparison repeats a finite set of exact source-derived poses.
  // Compute them once, yielding to the app between poses, rather than repeating
  // six dense CPU skin solves on every live frame. Traveling remains uncached.
  if(mode==='in-place')for(const row of rows){
   for(let index=0;index<row.adapter.frames;index++){row.player.seek(index);await yieldWork();}
   row.player.seek(0);record({kind:'creature.comparison.pose-retention',phase:'prepared',entry:row.spec.id,...row.runtime.read().poseCache});
  }
  apply();if(inputs.play!==false)operations.play();if(globalThis.window)window.kaminosCreatureComparison=inspect;
  return {read,operations,dispose,mount({root,invoke}){
   const timeline=data.reduce((a,b)=>a.motion.frames/a.motion.skeleton.fps>=b.motion.frames/b.motion.skeleton.fps?a:b).motion;
   const panel=document.createElement('section'),title=document.createElement('h3'),note=document.createElement('p'),output=document.createElement('output');title.textContent='Creature motion · paired parade';
   note.textContent='One shared clock. In-place holds horizontal root travel; vertical action and yaw remain. Loops use a derived pose seam; no foot/contact correction.';panel.append(title,note,output);
   const call=(name,input)=>Promise.resolve().then(()=>invoke(name,input)).catch(e=>{output.textContent=e.message;});
   for(const [label,name,input] of [['Play all','play'],['Pause all','pause'],['Restart all','restart'],['In-place pairs','presentation',{mode:'in-place'}],['Traveling pairs','presentation',{mode:'travel'}],['Raw once','presentation',{mode:'raw'}]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>call(name,input);panel.append(b);}
   const range=document.createElement('input');range.type='range';range.min='0';range.max=String(duration);range.step=String(1/30);range.setAttribute('aria-label','Comparison source seconds');range.oninput=()=>call('seek',{seconds:Number(range.value)});panel.append(range);
   const list=document.createElement('ol');for(const row of rows){const item=document.createElement('li');item.textContent=row.spec.label+' · '+(row.source.prompt??'source motion');list.append(item);}panel.append(list);
   refresh=()=>{output.textContent=mode+' · '+status+' · '+seconds.toFixed(2)+' s';range.value=String(mode==='raw'?Math.min(seconds,duration):(Math.floor(seconds*timeline.skeleton.fps+1e-6)%timeline.frames)/timeline.skeleton.fps);};root.append(panel);refresh();return {dispose(){panel.remove();}};
  }};
 }catch(error){await dispose();throw error;}
}
export default {id:'marionette/motion-comparison',title:'Creature · paired parade',create:createCreatureComparison};
