// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {createWalkingCreature} from '../experiments/creature-motion/walking.experiment.mjs';
import {openExperiment} from '../workbench-experiments.mjs';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
class Element{constructor(){this.children=[];this.style={};this.value='';this.attributes={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(k,v){this.attributes[k]=v;}remove(){this.removed=true;}}
const document={createElement:()=>new Element(),getElementById:()=>null},scene=new THREE.Scene();
let tick=null,refreshes=0;
const session={async attach(root){scene.add(root);return {id:'body',root};},onFrame(fn){assert.equal(tick,null);tick=fn;return ()=>{tick=null;};},redraw(){},readView:()=>({}),setView(){},async dispose(){scene.clear();tick=null;}};
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const makeData=(sha,frames=3)=>({manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames,joints:1,assetCondSha256:'d'.repeat(64),prompt:'A cat walks forward.',seed:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:Array.from({length:frames},(_,i)=>[0,.2,i]).flat(),localRotations:Array.from({length:frames},()=>[1,0,0,0]).flat()},source:{motionSha256:sha,frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}});
const a=makeData('a'.repeat(64)),b=makeData('e'.repeat(64),5);
const choices=[{id:'walk',label:'Walk seed1',motion:'walk',motion_sha256:a.source.motionSha256},{id:'trot',label:'Trot seed2',motion:'trot',motion_sha256:b.source.motionSha256},{id:'bad',label:'Bad retained source',motion:'bad',motion_sha256:'f'.repeat(64)}];
const inputs={case:'same-body',motion:'walk',motion_sha256:a.source.motionSha256,motions:choices,blend_frames:0,radius:4};
const host={controls:{document},scene:{open:async()=>session,refreshPresentation(){refreshes++;}}};
const loadSources=async request=>{if(request.motion==='bad')throw Error('Source digest mismatch');return request.motion==='trot'?b:a;};
const entry=await createWalkingCreature({host,inputs},{loadSources});
entry.operations.play();
const placement=scene.children[0];placement.position.set(4,2,-3);placement.rotation.set(.1,.7,.2);placement.scale.set(1.3,.8,1.1);placement.updateMatrix();const authored=placement.matrix.toArray();
tick({deltaSeconds:1/30});placement.updateMatrix();
assert.deepEqual(placement.matrix.toArray(),authored,'Playback must preserve user placement rather than overwrite the selected scene object');
assert.equal(entry.read().playback.frame,1);assert.equal(entry.read().playback.editedSinceSourcePose,false);
assert.notEqual(placement.children[0].position.z,0,'animated actor must continue under authored placement');
entry.operations.pause();assert.equal(tick,null);
await entry.operations.motion({id:'trot'});
assert.deepEqual(placement.matrix.toArray(),authored,'motion selection retains authored placement');assert.equal(entry.read().playback.frames,5);assert.equal(entry.read().motion.id,'trot');assert.equal(entry.read().playback.status,'paused');
entry.operations.play();tick({deltaSeconds:1/30});assert.equal(entry.read().playback.frame,1);
const before=entry.read();await assert.rejects(entry.operations.motion({id:'bad'}),/digest/);assert.equal(entry.read().source.motionSha256,before.source.motionSha256);assert.equal(entry.read().playback.status,'playing');assert.equal(typeof tick,'function');
await assert.rejects(entry.operations.motion({id:'missing'}),/Unknown/);assert.equal(entry.read().source.motionSha256,before.source.motionSha256);
await entry.operations.motion({id:'walk'});assert.equal(entry.read().playback.frames,3);assert.equal(entry.read().playback.status,'playing');assert.equal(typeof tick,'function');
entry.operations.mode({mode:'cycle'});entry.operations.play();tick({deltaSeconds:2/30});assert.equal(entry.read().cycle,1);assert.deepEqual(placement.matrix.toArray(),authored);
const root=new Element();entry.mount({root,invoke:(name,input)=>entry.operations[name](input)});const nodes=n=>[n,...n.children.flatMap(nodes)];
assert.ok(nodes(root).some(n=>n.children.some(o=>o.value==='trot')),'retained motion choices are actual selector options');
const recipe=entry.read().recipe;assert.deepEqual(recipe.transform.position,[4,2,-3]);assert.equal(recipe.motion,'walk');assert.equal(recipe.motions.length,3);
await entry.dispose();assert.equal(scene.children.length,0);assert.equal(tick,null);
const reopened=await createWalkingCreature({host,inputs:recipe},{loadSources});assert.deepEqual(scene.children[0].position.toArray(),[4,2,-3]);await reopened.dispose();
await assert.rejects(createWalkingCreature({host,inputs:{...inputs,transform:{position:[0,0,0],quaternion:[0,0,0,1],scale:[1,0,1]}}},{loadSources}),/transform|scale/i);
await assert.rejects(createWalkingCreature({host,inputs:{...inputs,motions:[choices[0],choices[0]]}},{loadSources}),/duplicate/i);
const wrongBody=structuredClone(b);wrongBody.source.caseSha256='0'.repeat(64);
const sameBody=await createWalkingCreature({host,inputs},{loadSources:async request=>request.motion==='trot'?wrongBody:a});
await assert.rejects(sameBody.operations.motion({id:'trot'}),/body|bind/i);assert.equal(sameBody.read().source.motionSha256,a.source.motionSha256);await sameBody.dispose();
if(!process.argv.includes('--removal-only')){
 let initial=true;const pending=new Map();
 const delayed=request=>{if(initial){initial=false;return Promise.resolve(a);}return new Promise((resolve,reject)=>pending.set(request.motion,{resolve,reject}));};
 const mounted=await openExperiment({id:'creature-authoring-test',title:'Creature authoring',create:args=>createWalkingCreature(args,{loadSources:delayed})},{host,inputs});
 const mount=new Element();await mounted.mount({root:mount,document});const select=nodes(mount).find(n=>n.children.some(o=>o.value==='trot'));
 select.value='trot';const older=select.onchange();select.value='walk';const newer=select.onchange();
 pending.get('walk').resolve(a);await newer;pending.get('trot').resolve(b);await older;
 assert.equal((await mounted.read()).motion.id,'walk','visible selector must retain the later choice when older loading completes last');assert.equal(select.value,'walk');assert.equal((await mounted.read()).recipe.motion,'walk');
 select.value='trot';const stale=select.onchange();select.value='bad';const refusal=select.onchange();pending.get('bad').reject(Error('Source digest mismatch'));await refusal;pending.get('trot').resolve(b);await stale;
 assert.equal((await mounted.read()).motion.id,'walk','refusal retains previous usable choice, not an older pending completion');assert.equal(select.value,'walk');
 select.value='trot';const afterClose=select.onchange();await mounted.dispose();pending.get('trot').resolve(b);await afterClose;
 assert.equal(scene.children.length,0);assert.equal(tick,null);await assert.rejects(mounted.read(),/disposed/);
}
for(const mode of ['source','cycle','path']){
 const removed=await createWalkingCreature({host,inputs},{loadSources});removed.operations.mode({mode});removed.operations.play();
 tick({deltaSeconds:1/30});const beforeRemoval=removed.read(),callback=tick;scene.remove(scene.children[0]);callback({deltaSeconds:1/30});
 assert.equal(removed.read().playback.status,'removed','registered placement removal must stop the nested animated actor');assert.equal(tick,null,'removed creature releases the shared clock');assert.equal(removed.read().skin.updates,beforeRemoval.skin.updates);assert.equal(removed.read().cycle,beforeRemoval.cycle);
 assert.throws(()=>removed.operations.play(),/removed|mounted/i);assert.throws(()=>removed.operations.seek({frame:0}),/removed|mounted/i);await removed.dispose();
}
const importer=await createWalkingCreature({host,inputs},{loadSources});const importRoot=new Element();let imported=null;
importer.mount({root:importRoot,invoke:(name,input)=>importer.operations[name](input),reopen:async recipe=>{imported=recipe;}});
const fileInput=nodes(importRoot).find(n=>n.type==='file');assert.ok(fileInput,'saved setups must reopen through an actual file control, not a custom URL');
fileInput.files=[{text:async()=>JSON.stringify(recipe)}];await fileInput.onchange();assert.deepEqual(imported,JSON.parse(JSON.stringify(recipe)));
imported=null;fileInput.files=[{text:async()=>'{not json'}];await fileInput.onchange();assert.equal(imported,null,'invalid JSON must not replace the live creature');assert.equal(importer.read().motion.id,'walk');
fileInput.files=[{text:async()=>JSON.stringify({...recipe,motion:'bad'})}];await fileInput.onchange();assert.equal(imported,null,'invalid saved source must not replace the live creature');
fileInput.files=[{text:async()=>JSON.stringify({...recipe,transform:{position:[0,0,0],quaternion:[0,0,0,1],scale:[1,0,1]}})}];await fileInput.onchange();assert.equal(imported,null,'invalid placement must not replace the live creature');await importer.dispose();
if(!process.argv.includes('--import-refusal-only')){
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const refreshCode=html.slice(html.indexOf('function refreshWorkbenchAssetPresentation(handle) {'),html.indexOf('window.kaminosWorkbenchRefreshPresentation='));
 assert.ok(refreshCode.startsWith('function refreshWorkbenchAssetPresentation'),'exercise the actual application refresh contract');
 const actualRefresh=new Function('sceneObjects',refreshCode+'return refreshWorkbenchAssetPresentation;')([]);
 for(const mode of ['source','cycle','path']){
  const events=[],removed=await createWalkingCreature({host,inputs,record:e=>events.push(e)},{loadSources});
  const root=new Element();removed.mount({root,invoke:(name,input)=>removed.operations[name](input)});
  removed.operations.mode({mode});removed.operations.play();const before=removed.read(),callback=tick;
  scene.remove(scene.children[0]);host.scene.refreshPresentation=actualRefresh;
  assert.doesNotThrow(()=>callback({deltaSeconds:1/30}),'normal removal must not refresh an unregistered scene row');
  assert.equal(removed.read().playback.status,'removed');assert.equal(tick,null);assert.equal(removed.read().skin.updates,before.skin.updates);assert.equal(removed.read().cycle,before.cycle);
  assert.ok(nodes(root).some(n=>n.textContent?.includes('removed')),'visible instruments must report terminal removal');
  assert.equal(events.some(e=>e.kind==='walking.frame'&&e.phase==='failed'),false);
  host.scene.refreshPresentation=()=>{refreshes++;};await removed.dispose();
 }
}
// The real owner entry closes before creating a replacement; a callback stub
// cannot establish that an invalid imported recipe preserves the current owner.
Element.prototype.addEventListener=function(){};
Element.prototype.replaceChildren=function(...xs){this.children=xs;};
Object.defineProperty(Element.prototype,'innerHTML',{set(){this.parts={select:new Element(),button:new Element(),'[role=status]':new Element(),'.owner-experiment-content':new Element()};this.append(...Object.values(this.parts));}});
Element.prototype.querySelector=function(selector){return this.parts[selector];};
globalThis.Option=class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}};
globalThis._authoringTestCreate=args=>createWalkingCreature(args,{loadSources});
const definition='data:text/javascript,'+encodeURIComponent("export default {id:'marionette/walking-creature',title:'Creature',create:globalThis._authoringTestCreate}");
const ownerRoot=new Element(),owner=await installOwnerExperimentEntry({document,root:ownerRoot,host,discover:async()=>[definition]});
globalThis.window={kaminosWorkbenchExperiments:owner};
await owner.open('marionette/walking-creature',inputs);await owner.invoke('play');
const importRecipe=JSON.parse(JSON.stringify((await owner.read()).recipe));
for(const patch of [{play:'yes'},{mode:'bogus'},{cycle:-1},{motions:[choices[0],choices[0]]},{motions:'bad'},{gizmos:'yes'},{ground:'source-start',floor_size:0},{sample:99},{radius:0},{blend_frames:3},{view:{zoom:0}},{view:{position:[0,0,0],target:[0,0,0]}},{view:{near:10,far:1}}]){
 const before=await owner.read(),root=scene.children[0],subscription=tick,file=nodes(ownerRoot).find(n=>n.type==='file');
 file.files=[{text:async()=>JSON.stringify({...importRecipe,...patch})}];await file.onchange();
 assert.equal(owner.state().id,'marionette/walking-creature','invalid saved recipe must preserve actual owner');
 assert.equal(scene.children[0],root,'invalid saved recipe must not detach the current body');assert.equal(tick,subscription,'invalid saved recipe must preserve the current playback subscription');
 const after=await owner.read();assert.deepEqual(after.source,before.source);assert.deepEqual(after.transform,before.transform);assert.deepEqual(after.playback,before.playback);
 assert.ok(nodes(ownerRoot).some(n=>n.attributes.role==='alert'&&n.textContent),'refusal remains presented in the existing instrument');
}
const validFile=nodes(ownerRoot).find(n=>n.type==='file');validFile.files=[{text:async()=>JSON.stringify(importRecipe)}];await validFile.onchange();assert.equal(owner.state().id,'marionette/walking-creature');assert.deepEqual((await owner.read()).transform,importRecipe.transform);assert.equal((await owner.read()).playback.status,'playing');
await owner.close();delete globalThis.window;delete globalThis.Option;delete globalThis._authoringTestCreate;
console.log('Authored placement, live selection/refusal/removal and saved setup controls preserve the actual creature');
