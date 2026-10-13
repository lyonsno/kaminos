// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';
import * as sources from '../experiments/creature-motion/full-body-source.mjs';
let module={};try{module=await import('../experiments/creature-motion/skin-case-selection.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('skin-case-selection.mjs'))throw error;}
assert.equal(typeof sources.loadFullBodySkin,'function','case selection has no authenticated skin-only loader independent of motion');
assert.equal(typeof module.createSkinCaseSelection,'function','the shared creature has no explicit cast/attachment selector');
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const fixture=digest=>({manifest:{bones:[{name:'pelvis',parent:null,restMatrix:I}],channels:['fixed','pelvis'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,1,0,1,0,1]),source:{caseSha256:digest}});
const choices=[
 {cast:'strong',label:'Strong cast',attachment:'point',attachmentLabel:'Original',case:'scratch/strong-original',case_sha256:'a'.repeat(64)},
 {cast:'strong',label:'Strong cast',attachment:'distributed',attachmentLabel:'Improved trunk',case:'scratch/strong-improved',case_sha256:'b'.repeat(64)},
 {cast:'lean',label:'Lean cast',attachment:'distributed',attachmentLabel:'Improved trunk',case:'scratch/lean-improved',case_sha256:'c'.repeat(64)},
];
const runtime=createFullBodyRuntime({THREE,...fixture(choices[0].case_sha256)}),scene=new THREE.Scene();scene.add(runtime.group);
runtime.bones.get('pelvis').position.x=.4;runtime.update();
let requested=[],applied=[],nextLoad=async input=>fixture(input.case_sha256);
const selection=module.createSkinCaseSelection({runtime,choices,currentCaseSha256:choices[0].case_sha256,loadCase:async input=>{requested.push(input);return nextLoad(input);},onApplied:state=>applied.push(state)});
const before=runtime.bones.get('pelvis').matrix.toArray();
await selection.select({cast:'strong',attachment:'distributed'});
assert.equal(selection.read().current.case_sha256,'b'.repeat(64));assert.equal(applied.length,1);
assert.deepEqual(requested[0],{case:'scratch/strong-improved',case_sha256:'b'.repeat(64)},'skin fetch cannot silently change motion or source identity');
assert.deepEqual(runtime.bones.get('pelvis').matrix.toArray(),before);
const unchanged=()=>({geometry:runtime.mesh.geometry,vertices:[...runtime.mesh.geometry.attributes.position.array],revision:runtime.read().skinRevision,current:selection.read().current});
for(const request of [{cast:'unregistered',attachment:'distributed'},{cast:'lean',attachment:'point'}]){
 const saved=unchanged();await assert.rejects(selection.select(request),/choice|registered/i);assert.deepEqual(unchanged(),saved,'no hidden fallback choice');
}
let saved=unchanged();nextLoad=async()=>fixture('a'.repeat(64));
await assert.rejects(selection.select({cast:'lean',attachment:'distributed'}),/digest|identity/i);assert.deepEqual(unchanged(),saved,'a stale loader result cannot become the selected case');
nextLoad=async input=>{const result=fixture(input.case_sha256);result.manifest.bones[0].restMatrix=structuredClone(I);result.manifest.bones[0].restMatrix[0][3]=1;return result;};
await assert.rejects(selection.select({cast:'lean',attachment:'distributed'}),/rig|frame/i);assert.deepEqual(unchanged(),saved,'incompatible registration cannot change the displayed skin');
nextLoad=async()=>{throw Error('source HTTP 404');};
await assert.rejects(selection.select({cast:'lean',attachment:'distributed'}),/404/);assert.deepEqual(unchanged(),saved);assert.match(selection.read().error,/404/);
let resolveSlow;nextLoad=input=>input.case_sha256==='c'.repeat(64)?new Promise(resolve=>{resolveSlow=()=>resolve(fixture(input.case_sha256));}):Promise.resolve(fixture(input.case_sha256));
const slow=selection.select({cast:'lean',attachment:'distributed'});await selection.select({cast:'strong',attachment:'point'});resolveSlow();
assert.equal((await slow).status,'superseded');assert.equal(selection.read().current.cast,'strong');assert.equal(selection.read().current.attachment,'point');
nextLoad=async input=>fixture(input.case_sha256);

class Element{constructor(tag){this.tag=tag;this.children=[];this.value='';this.disabled=false;this.listeners={};}append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=[...nodes];}setAttribute(key,value){this[key]=value;}remove(){this.removed=true;}}
const document={createElement:tag=>new Element(tag)},root=new Element('root'),calls=[];
const mounted=selection.mount({document,root,invoke:async(name,input)=>{calls.push({name,input});return selection.select(input);}});
const nodes=node=>[node,...node.children.flatMap(nodes)],cast=nodes(root).find(node=>node['aria-label']==='Creature cast'),attachment=nodes(root).find(node=>node['aria-label']==='Skin attachment');
assert.ok(cast&&attachment,'native selectors must be usable by the shared room');
cast.value='lean';await cast.onchange();assert.deepEqual(calls.at(-1),{name:'skin',input:{cast:'lean',attachment:'distributed'}});
assert.equal(selection.read().current.cast,'lean');assert.equal(attachment.value,'distributed');
mounted.dispose();assert.equal(root.children[0].removed,true);
nextLoad=input=>new Promise(resolve=>{resolveSlow=()=>resolve(fixture(input.case_sha256));});
saved=unchanged();const pending=selection.select({cast:'lean',attachment:'distributed'});selection.dispose();resolveSlow();
assert.equal((await pending).status,'disposed');assert.deepEqual(unchanged(),saved,'late fetch completion cannot mutate a released selector');
await assert.rejects(selection.select({cast:'strong',attachment:'point'}),/disposed/i);
assert.throws(()=>module.createSkinCaseSelection({runtime,choices:[...choices,choices[0]],currentCaseSha256:'a'.repeat(64)}),/duplicate/i);
assert.throws(()=>module.createSkinCaseSelection({runtime,choices,currentCaseSha256:'f'.repeat(64)}),/current|identity/i);
runtime.dispose();
console.log('Authenticated cast/attachment selection rejects stale/fallback/incompatible loads and exposes ordinary selectors without replacing the rig or clock');
