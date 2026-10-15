// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
let module={};try{module=await import('../experiments/creature-motion/comparison.experiment.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(module.default?.id,'marionette/motion-comparison','simultaneous comparison must be a discoverable ordinary Workbench tool');
assert.equal(typeof module.loadComparisonRecipe,'function','caller-owned recipe file must resolve without embedding six full sources in a URL');
const recipeBytes=new TextEncoder().encode(JSON.stringify({entries:[{id:'retained',label:'retained',position:[0,0,0],source:{}}]}));
const recipeHash=Buffer.from(await crypto.subtle.digest('SHA-256',recipeBytes)).toString('hex');
const recipeFetch=async()=>({ok:true,arrayBuffer:async()=>recipeBytes.buffer});
assert.equal((await module.loadComparisonRecipe({recipe:'/caller/scene.json',recipe_sha256:recipeHash},{fetchImpl:recipeFetch})).inputs.entries[0].id,'retained');
await assert.rejects(module.loadComparisonRecipe({recipe:'/caller/scene.json',recipe_sha256:'0'.repeat(64)},{fetchImpl:recipeFetch}),/digest mismatch/);
await assert.rejects(module.loadComparisonRecipe({entries:[],recipe:'/caller/scene.json',recipe_sha256:recipeHash},{fetchImpl:recipeFetch}),/one input/);
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],bones=[{name:'pelvis',parent:null,restMatrix:I,tail:[0,1,0]}];
const data={manifest:{bones,channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),frame:{canonicalWorldToSourceNormalized:I,bones},motion:{frames:3,joints:1,skeleton:{fps:30,jointNames:['pelvis'],parents:[-1]},positions:[0,.2,0,0,.3,1,0,.2,2],localRotations:[1,0,0,0,1,0,0,0,1,0,0,0]},source:{motionSha256:'a'.repeat(64),frameSha256:'b'.repeat(64),caseSha256:'c'.repeat(64)}};
class Element{constructor(){this.children=[];this.style={};}append(...x){this.children.push(...x);}prepend(...x){this.children.unshift(...x);}setAttribute(){}remove(){this.removed=true;}}
const document={createElement:()=>new Element(),getElementById:()=>null};
function fixture(){const scene=new THREE.Scene();let callback=null,closed=0,refreshes=0;
 const session={async attach(root){scene.add(root);return {id:root.uuid,root,owned:true};},onFrame(fn){assert.equal(callback,null,'comparison borrows one app clock, not six private clocks');callback=fn;return ()=>callback=null;},redraw(){},setView(){},readView:()=>({}),async dispose(){closed++;scene.clear();callback=null;}};
 return {scene,host:{controls:{document},scene:{open:async()=>session,refreshPresentation(){refreshes++;}}},tick:deltaSeconds=>callback?.({deltaSeconds}),state:()=>({active:callback!==null,closed,refreshes})};}
const inputs={blend_frames:0,ground:false,play:true,entries:Array.from({length:6},(_,i)=>({id:'body-'+i,label:'Pair '+Math.floor(i/2)+' / '+i%2,position:[i%2?3:-3,0,Math.floor(i/2)*6],source:{}}))};
const f=fixture(),entry=await module.createCreatureComparison({host:f.host,inputs},{loadSources:async()=>structuredClone(data),makeLabel:()=>new THREE.Group()});
assert.equal(f.scene.children.length,6);assert.equal(entry.read().entries.length,6);assert.equal(f.state().active,true);
assert.ok(entry.read().entries.every(e=>e.skin.poseCache?.enabled),'comparison must reuse its finite repeated poses');
f.tick(1/30);assert.deepEqual(entry.read().entries.map(e=>e.frame),[1,1,1,1,1,1]);
const after=entry.read().entries;for(let i=0;i<6;i++){assert.equal(after[i].rootMatrix[12],inputs.entries[i].position[0]);assert.equal(after[i].rootMatrix[14],inputs.entries[i].position[2]);}
assert.ok(after.every(e=>Math.abs(e.rootMatrix[13]-.3)<1e-6),'in-place presentation preserves vertical motion');
entry.operations.pause();assert.equal(f.state().active,false);const t=entry.read().seconds;f.tick(1);assert.equal(entry.read().seconds,t);
entry.operations.presentation({mode:'travel'});entry.operations.seek({seconds:1/30});assert.equal(entry.read().entries[0].rootMatrix[14],1);
assert.ok(entry.read().entries.every(e=>!e.skin.poseCache.enabled&&e.skin.poseCache.entries===0),'accumulating travel cannot grow a pose cache');
entry.operations.presentation({mode:'raw'});entry.operations.restart();f.tick(2);assert.equal(entry.read().status,'held');assert.equal(f.state().active,false);assert.ok(entry.read().entries.every(e=>e.frame===2));
const controlRoot=new Element();entry.mount({root:controlRoot,invoke:(name,input)=>entry.operations[name](input)});
const seekControl=controlRoot.children[0].children.find(e=>e.type==='range');
assert.equal(Number(seekControl.value),Number(seekControl.max),'raw endpoint must display the last source time, not wrap the slider to zero');
entry.operations.presentation({mode:'in-place'});entry.operations.restart();f.tick(2/30);
assert.equal(Number(seekControl.value),2/30,'loop display must use the actual frame period, not the last-sample timestamp');
entry.operations.presentation({mode:'in-place'});entry.operations.restart();const removed=f.scene.children[0];f.scene.remove(removed);f.tick(1/30);
assert.equal(entry.read().entries[0].status,'removed');assert.equal(entry.read().entries[0].id,null);assert.ok(entry.read().entries.slice(1).every(e=>e.frame===1));
await entry.dispose();assert.equal(f.state().active,false);assert.equal(f.state().closed,1);assert.equal(f.scene.children.length,0);
const bad=fixture();await assert.rejects(module.createCreatureComparison({host:bad.host,inputs},{loadSources:async source=>{throw Error('source digest mismatch');},makeLabel:()=>new THREE.Group()}),/digest mismatch/);assert.equal(bad.scene.children.length,0);assert.equal(bad.state().active,false);
await assert.rejects(module.createCreatureComparison({host:bad.host,inputs:{...inputs,entries:[inputs.entries[0],inputs.entries[0]]}},{loadSources:async()=>data}),/unique/);
assert.throws(()=>entry.operations.play(),/disposed/);
console.log('Comparison keeps six independent sources/placements on one clock, preserves vertical action, exposes travel/raw, and closes/removes honestly');
