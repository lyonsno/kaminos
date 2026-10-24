// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import definition from '../experiments/fracture-shape.experiment.mjs';
import {buildShapeGraph,partitionShape,geodesicNeckPartition} from '../fracture-shape-partition.mjs';

function setup(){
 const source=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());source.add(mesh);
 const scene=new THREE.Scene();scene.add(source);let terminated=false,removed=false;
 class Worker{
  postMessage(data){queueMicrotask(()=>{if(terminated)return;try{if(data.geometry)this.graph=buildShapeGraph(data.geometry);this.onmessage({data:{id:data.id,result:geodesicNeckPartition(this.graph,data.settings)}});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}});}
  terminate(){terminated=true;}
 }
 const session={async loadAsset(){return {id:'source',root:source};},setView(v){return v;},redraw(){assert.equal(removed,false);},async dispose(){removed=true;source.removeFromParent();}};
 return {Worker,host:{scene:{open:async()=>session}},source,mesh,events:[],get terminated(){return terminated;},get removed(){return removed;}};
}

test('experiment compares exact source, retains all triangles and closes its worker',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=f.Worker;
 try{
  const api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record:e=>f.events.push(e)});
  assert.equal(api.read().triangleCount,12);assert.equal(api.read().partition.parts.reduce((s,p)=>s+p.triangles,0),12);
  assert.equal(f.mesh.visible,false);api.operations.view('original');assert.equal(f.mesh.visible,true);
  api.operations.view('regions');assert.equal(f.mesh.visible,false);
  const exported=api.operations.export();assert.equal(exported.labels.length,12);
  await assert.rejects(api.operations.partition({minReachFraction:NaN,minAreaFraction:0}),/finite/);
  assert.equal(api.read().partition.parts.length,1);
  await api.dispose();assert.equal(f.terminated,true);assert.equal(f.removed,true);
 }finally{globalThis.Worker=old;}
});

test('a failed setup disposes the acquired scene and never presents an empty success',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=class{constructor(){throw Error('worker unavailable');}};
 try{await assert.rejects(definition.create({host:f.host,inputs:{source:'/source.glb'},record(){}}),/worker unavailable/);assert.equal(f.removed,true);}
 finally{globalThis.Worker=old;}
});

test('hierarchy detail, parent selection and hidden cuts share the agent operation path',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=f.Worker;
 try{
  const api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record:e=>f.events.push(e)});
  assert.equal(typeof api.operations.detail,'function');
  assert.equal(typeof api.operations.hiddenCuts,'function');
  const initial=api.read();assert.equal(initial.showHiddenCuts,false);assert.equal(initial.settings.cleanupAreaFraction,.0001);
  assert.ok(initial.hierarchy.nodes.length>0);
  api.operations.detail(0);assert.equal(api.read().partition.parts.length,initial.partition.sourceComponents);
  api.operations.select(0);api.operations.parent();assert.equal(api.read().selected,-1);
  api.operations.hiddenCuts(true);assert.equal(api.read().showHiddenCuts,true);
  const visible=f.source.children.find(n=>n.name==='Visible candidate cut boundaries');
  const hidden=f.source.children.find(n=>n.name==='Hidden candidate cut boundaries');
  assert.equal(visible.material.depthTest,true);assert.equal(hidden.material.depthTest,true);assert.notEqual(hidden.material.depthFunc,visible.material.depthFunc);
  assert.equal(hidden.material.isLineDashedMaterial,true);
  const exported=api.operations.export();assert.equal(exported.hierarchy.faceOwners.length,12);
  await api.dispose();
 }finally{globalThis.Worker=old;}
});

test('surface picking and keep-together use recorded, reconstructable piece operations',async()=>{
 const f=setup(),old=globalThis.Worker;globalThis.Worker=f.Worker;let pick,retained;
 f.host.scene.open=async()=>({async loadAsset(){return {id:'source',root:f.source};},setView:v=>v,redraw(){},onPick:callback=>{pick=callback;return ()=>{};},async dispose(){}});
 try{
  const api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record:e=>f.events.push(e),updateInputs:s=>{retained=s;}});
  assert.equal(typeof pick,'function','experiment must subscribe to actual scene picking');
  const regions=f.source.children.find(n=>n.name==='Candidate shape regions');
  pick({id:'source',object:regions,faceIndex:0});
  assert.equal(api.read().selected,0);
  assert.equal(typeof api.operations.keepTogether,'function');
  api.operations.keepTogether();
  assert.deepEqual(retained.localDetail,{'0':0});assert.equal(retained.selected,0);
  assert.equal(api.read().analysis.builds,1);
  const sourceLabels=api.operations.export().labels;
  await api.operations.partition({minReachFraction:.01,minAreaFraction:0,cleanupAreaFraction:.001});
  assert.equal(api.read().analysis.cacheHit,true);assert.deepEqual(api.read().setup.localDetail,{});
  assert.equal(api.operations.export().labels.length,sourceLabels.length);
  assert.ok(f.events.some(e=>e.kind==='fracture-shape.selection'));
  await api.dispose();
 }finally{globalThis.Worker=old;}
});

for(const counts of [[1,3,4,2,2],[1,0,7,2,2]])test(`descendant refinement inherits detail, including an empty parent remainder (${counts[1]})`,async()=>{
 const f=setup(),old=globalThis.Worker;
 // A small explicit ownership tree tests local controls, not geometry detection.
 const nodes=counts.map((ownTriangles,id)=>({id,parent:id? id-1:null,kind:id?'branch':'component',depth:id,children:id<4?[id+1]:[],ownTriangles,triangles:counts.slice(id).reduce((a,b)=>a+b,0),area:counts.slice(id).reduce((a,b)=>a+b,0)}));
 const faceOwners=Uint32Array.from(counts.flatMap((count,id)=>Array(count).fill(id)));
 const parts=counts.map((triangles,id)=>({id,nodeId:id,triangles,area:triangles,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}})).filter(p=>p.triangles);parts.forEach((p,id)=>{p.id=id;});
 const result={hierarchy:{schema:'kaminos.fracture.part-hierarchy.v1',nodes,faceOwners,maxDepth:4},labels:Uint32Array.from(faceOwners,node=>parts.findIndex(p=>p.nodeId===node)),parts,boundaries:[],attachments:[],sourceComponents:1,triangleCount:12};
 globalThis.Worker=class {postMessage({id}){queueMicrotask(()=>this.onmessage({data:{id,result:structuredClone(result)}}));}terminate(){}};
 try{
  const api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record(){}});
  api.operations.select(0);api.operations.refine();api.operations.refine();
  const previous=api.operations.export();api.operations.select(1);const before=api.operations.export();assert.deepEqual(before.labels,previous.labels,'selection of an already-visible subtree must not coarsen it');api.operations.refine();const after=api.operations.export();
  const owners=r=>r.labels.map(id=>r.partition.parts[id].nodeId);
  assert.equal(after.localDetail[1],4,'refinement must advance the inherited level3 to4');
  assert.ok(after.partition.parts.length>before.partition.parts.length);
  assert.equal(owners(after)[0],owners(before)[0],'outside root remainder stays unchanged');
  const provenance=new Map();for(let i=0;i<after.labels.length;i++){const id=after.labels[i];if(provenance.has(id))assert.equal(provenance.get(id),before.labels[i],'refinement cannot merge old groups');else provenance.set(id,before.labels[i]);}
  api.operations.refine();assert.deepEqual(api.operations.export().labels,after.labels,'finest detail is stable');await api.dispose();
 }finally{globalThis.Worker=old;}
});

function controlTree(){
 const counts=[1,3,4,2,2],nodes=counts.map((ownTriangles,id)=>({id,parent:id?id-1:null,kind:id?'branch':'component',depth:id,children:id<4?[id+1]:[],ownTriangles,triangles:counts.slice(id).reduce((a,b)=>a+b,0),area:counts.slice(id).reduce((a,b)=>a+b,0)}));
 const faceOwners=Uint32Array.from(counts.flatMap((count,id)=>Array(count).fill(id)));
 const parts=counts.map((triangles,id)=>({id,nodeId:id,triangles,area:triangles,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}}));
 return {hierarchy:{schema:'kaminos.fracture.part-hierarchy.v1',nodes,faceOwners,maxDepth:4},labels:faceOwners.slice(),parts,boundaries:[],attachments:[],sourceComponents:1,triangleCount:12};
}
async function withControlTree(run){
 const old=globalThis.Worker,tree=controlTree();
 globalThis.Worker=class{postMessage({id,settings}){const result=structuredClone(tree);if(settings.minAreaFraction===1){result.hierarchy={...result.hierarchy,nodes:[{...tree.hierarchy.nodes[0],children:[],ownTriangles:12}],faceOwners:new Uint32Array(12),maxDepth:0};result.parts=[{...tree.parts[0],triangles:12,area:12}];result.labels=new Uint32Array(12);}queueMicrotask(()=>this.onmessage({data:{id,result}}));}terminate(){}};
 const apis=[];try{await run(async inputs=>{const f=setup(),api=await definition.create({host:f.host,inputs:{source:'/source.glb',...inputs},record(){}});apis.push(api);return api;});}finally{for(const api of apis)await api.dispose();globalThis.Worker=old;}
}
const faceOwnership=api=>{const r=api.operations.export();return r.labels.map(id=>r.partition.parts[id].nodeId);};
test('selecting hidden descendants and reopening that selection never changes grouping',()=>withControlTree(async create=>{
 const api=await create(),before=faceOwnership(api);api.operations.select(4);api.operations.select(-1);
 assert.deepEqual(faceOwnership(api),before,'browsing hierarchy must not create cuts');
 api.operations.select(4);const reopened=await create(api.read().setup);
 assert.deepEqual(faceOwnership(reopened),before,'saved highlight must not create cuts on reopen');
}));
test('keep-together then refinement cannot resurrect old descendant overrides',()=>withControlTree(async create=>{
 const a=await create({detailLevel:4}),b=await create({detailLevel:4});
 a.operations.select(2);a.operations.keepTogether();
 for(const api of [a,b]){api.operations.select(1);api.operations.keepTogether();api.operations.refine();api.operations.refine();}
 assert.deepEqual(faceOwnership(a),faceOwnership(b),'same parent edit must discard previous child grouping');
 assert.deepEqual(a.read().localDetail,b.read().localDetail);
}));
test('threshold round trips preserve requested detail and reproduce direct grouping',()=>withControlTree(async create=>{
 const a=await create({detailLevel:4}),before=faceOwnership(a),settings=a.read().settings;
 await a.operations.partition({...settings,minAreaFraction:1});assert.equal(a.read().partition.parts.length,1);
 await a.operations.partition(settings);
 assert.equal(a.read().detailLevel,4,'temporary shallow hierarchy must not overwrite requested detail');
 assert.deepEqual(faceOwnership(a),before,'returning to initial thresholds must restore grouping');
}));
test('reapplying identical thresholds preserves explicit local grouping',()=>withControlTree(async create=>{
 const api=await create({detailLevel:4});api.operations.select(1);api.operations.keepTogether();const before=faceOwnership(api),setup=api.read().setup;
 await api.operations.partition(api.read().settings);
 assert.deepEqual(faceOwnership(api),before);assert.deepEqual(api.read().setup,setup);
}));
