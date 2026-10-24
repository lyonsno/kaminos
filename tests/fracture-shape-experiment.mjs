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
 return {Worker,host:{scene:{open:async()=>session},controls:{installNumberDrag:({input})=>{input.sharedDrag=true;return {dispose(){input.dragDisposed=true;}};}}},source,mesh,events:[],get terminated(){return terminated;},get removed(){return removed;}};
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
 const nodes=counts.map((ownTriangles,id)=>({id,key:`node:${id}`,parent:id? id-1:null,kind:id?'branch':'component',depth:id,children:id<4?[id+1]:[],ownTriangles,triangles:counts.slice(id).reduce((a,b)=>a+b,0),area:counts.slice(id).reduce((a,b)=>a+b,0)}));
 const faceOwners=Uint32Array.from(counts.flatMap((count,id)=>Array(count).fill(id)));
 const parts=counts.map((triangles,id)=>({id,nodeId:id,triangles,area:triangles,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}})).filter(p=>p.triangles);parts.forEach((p,id)=>{p.id=id;});
 const result={candidateBranches:[],hierarchy:{schema:'kaminos.fracture.part-hierarchy.v1',nodes,faceOwners,maxDepth:4},labels:Uint32Array.from(faceOwners,node=>parts.findIndex(p=>p.nodeId===node)),parts,boundaries:[],attachments:[],sourceComponents:1,triangleCount:12};
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
 const counts=[1,3,4,2,2],nodes=counts.map((ownTriangles,id)=>({id,key:`node:${id}`,parent:id?id-1:null,kind:id?'branch':'component',depth:id,children:id<4?[id+1]:[],ownTriangles,triangles:counts.slice(id).reduce((a,b)=>a+b,0),area:counts.slice(id).reduce((a,b)=>a+b,0)}));
 const faceOwners=Uint32Array.from(counts.flatMap((count,id)=>Array(count).fill(id)));
 const parts=counts.map((triangles,id)=>({id,nodeId:id,triangles,area:triangles,center:[0,0,0],bounds:{min:[0,0,0],max:[1,1,1]}}));
 return {candidateBranches:[],hierarchy:{schema:'kaminos.fracture.part-hierarchy.v1',nodes,faceOwners,maxDepth:4},labels:faceOwners.slice(),parts,boundaries:[],attachments:[],sourceComponents:1,triangleCount:12};
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

test('Finer here on a parent preserves a more detailed child',()=>withControlTree(async create=>{
 const api=await create({detailLevel:2});api.operations.select(2);api.operations.pieceDetail(4);const before=api.operations.export();api.operations.select(1);api.operations.refine();const after=api.operations.export(),prior=new Map();
 for(let f=0;f<after.labels.length;f++){const id=after.labels[f];if(prior.has(id))assert.equal(prior.get(id),before.labels[f],'Finer here must not merge a previously refined child');else prior.set(id,before.labels[f]);}
}));

test('mounted parent refinement remains available above a kept-together child',()=>withControlTree(async create=>{
 const api=await create({detailLevel:4}),elements=[];
 const document={createElement(tag){const e={tag,style:{},dataset:{},children:[],handlers:{},append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(){},addEventListener(n,f){this.handlers[n]=f;}};elements.push(e);return e;}};
 api.mount({root:document.createElement('div'),document,invoke:async(n,v)=>api.operations[n](v)});
 const button=elements.find(e=>e.textContent==='Finer here');
 api.operations.select(2);api.operations.keepTogether();api.operations.select(1);
 const before=api.operations.export();
 assert.equal(button.disabled,false,'parent must expose the coarser child through its mounted button');
 button.handlers.click();const after=api.operations.export();
 assert.ok(after.partition.parts.length>before.partition.parts.length);
 const prior=new Map();for(let f=0;f<after.labels.length;f++){const id=after.labels[f];if(prior.has(id))assert.equal(prior.get(id),before.labels[f]);else prior.set(id,before.labels[f]);}
 assert.equal(button.disabled,true,'fully exposed subtree has no further grouping to reveal');
}));

function mounted(api){
 const elements=[],document={activeElement:null,createElement(tag){
  const e=new EventTarget();Object.assign(e,{tag,style:{},dataset:{},children:[],attributes:{},value:'',append(...c){this.children.push(...c);},replaceChildren(...c){this.children=c;},setAttribute(k,v){this.attributes[k]=v;},focus(){document.activeElement=this;this.dispatchEvent(new Event('focus'));},blur(){document.activeElement=null;this.dispatchEvent(new Event('blur'));}});elements.push(e);return e;
 }};
 api.mount({root:document.createElement('div'),document,invoke:async(n,v)=>api.operations[n](v)});
 return {elements,field:name=>elements.find(e=>e.attributes['aria-label']===name)??elements.find(e=>e.tag==='label'&&e.children[0]?.textContent===name)?.children[1],edit(input,value){input.value=value;input.dispatchEvent(new Event('input'));}};
}
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('all seven tuning controls use shared number drags and automatic thresholds coalesce',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 await withControlTree(async create=>{
  const api=await create(),ui=mounted(api),fields=ui.elements.filter(e=>e.tag==='input'&&e.type!=='checkbox');
  assert.equal(fields.length,7);assert.ok(fields.every(e=>e.type==='number'&&e.sharedDrag),'every numeric control must use the shared number drag');
  assert.ok(!ui.elements.some(e=>e.textContent==='Apply global thresholds'));
  const reach=ui.field('Minimum branch reach (% object extent)'),area=ui.field('Minimum branch area (% surface)');
  ui.edit(reach,'0.2');ui.edit(reach,'0.3');ui.edit(area,'0.02');
  assert.equal(api.read().settings.minReachFraction,.001,'pending edits must not masquerade as applied');
  assert.equal(api.read().busy,true);assert.equal(api.read().pendingSettings.minReachFraction,.003);
  t.mock.timers.tick(200);await drain();
  assert.equal(api.read().settings.minReachFraction,.003);assert.equal(api.read().settings.minAreaFraction,.0002);assert.equal(api.read().busy,false);
  ui.edit(area,'');t.mock.timers.tick(200);await drain();assert.equal(api.read().settings.minAreaFraction,.0002,'incomplete typing must not apply zero');
  area.blur();assert.equal(Number(area.value),.02);
  ui.edit(reach,'0.4');await api.dispose();t.mock.timers.tick(200);await drain();assert.ok(fields.every(e=>e.dragDisposed));
 });
});
test('pending typed thresholds survive an older result and the latest edit wins',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=setup(),old=globalThis.Worker,requests=[];
 globalThis.Worker=class{postMessage(message){const reply=()=>this.onmessage({data:{id:message.id,result:structuredClone(controlTree())}});if(message.geometry)queueMicrotask(reply);else requests.push({message,reply});}terminate(){}};
 let api;try{
  api=await definition.create({host:f.host,inputs:{source:'/source.glb'},record(){}});const ui=mounted(api),reach=ui.field('Minimum branch reach (% object extent)');
  ui.edit(reach,'0.2');t.mock.timers.tick(200);await drain();assert.equal(requests.length,1);
  reach.focus();ui.edit(reach,'0.3');t.mock.timers.tick(200);await drain();assert.equal(requests.length,1,'one worker filter at a time');
  requests[0].reply();await drain();assert.equal(reach.value,'0.3');assert.equal(api.read().settings.minReachFraction,.001,'obsolete result must not replace current preview');
  assert.equal(requests.length,2);requests[1].reply();await drain();assert.equal(api.read().settings.minReachFraction,.003);assert.equal(api.read().busy,false);
 }finally{await api?.dispose();globalThis.Worker=old;}
});

test('local boundary movement preserves neighbors, survives global tuning and reconstructs exactly',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const {createShapeProcessor}=await import('../fracture-shape-worker-core.mjs');
 const f=setup(),old=globalThis.Worker,positions=[],indices=[];
 for(let x=0;x<=12;x++)positions.push(x,0,0,x,1,0);
 for(let x=0;x<12;x++){const i=x*2;indices.push(i,i+2,i+1,i+1,i+2,i+3);}
 f.mesh.geometry=new THREE.BufferGeometry();f.mesh.geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));f.mesh.geometry.setIndex(indices);
 globalThis.Worker=class{constructor(){this.process=createShapeProcessor();}postMessage(data){queueMicrotask(()=>{try{this.onmessage({data:this.process(data)});}catch(e){this.onmessage({data:{id:data.id,error:e.message}});}});}terminate(){}};
 const familyCuts=[{key:'fitting',faces:Array.from({length:8},(_,i)=>i+16)},{key:'neighbor',faces:[0,1]}],apis=[];
 const create=async inputs=>{const fresh=setup();fresh.mesh.geometry=f.mesh.geometry.clone();const api=await definition.create({host:fresh.host,inputs:{source:'/strip.glb',familyCuts,...inputs},record(){}});apis.push(api);return api;};
 const owners=api=>{const r=api.operations.export();return r.hierarchy.faceOwners.map(id=>r.hierarchy.nodes[id].key);};
 try{
  const api=await create(),ui=mounted(api);api.operations.select(api.read().hierarchy.nodes.find(n=>n.key==='fitting').id);api.operations.keepTogether();
  const before=owners(api),field=ui.field('Cut position (% object extent)');assert.ok(field.sharedDrag&&!field.disabled);
  ui.edit(field,'12');t.mock.timers.tick(200);await drain();
  const grown=owners(api);assert.notDeepEqual(grown,before);assert.deepEqual(grown.slice(0,2),before.slice(0,2));assert.equal(api.read().fixedCuts.length,1);
  await api.operations.boundary(0);assert.deepEqual(owners(api),before);
  await api.operations.boundary(.12);assert.deepEqual(owners(api),grown,'absolute cut setting is independent of traversal');
  const saved=api.read().setup,reopened=await create(saved);assert.deepEqual(owners(reopened),grown,'reopening preserves the whole chosen family');assert.deepEqual(reopened.read().localDetail,api.read().localDetail);
  await api.operations.partition({...api.read().settings,minReachFraction:1,minAreaFraction:1});
  assert.equal(api.read().fixedCuts[0].key,'fitting');assert.equal(api.read().selected,api.read().hierarchy.nodes.find(n=>n.key==='fitting').id);
  const editedFaces=api.operations.export().candidateBranches.find(c=>c.key==='fitting').faces;
  assert.deepEqual(Array.from(editedFaces),saved.fixedCuts[0].faces,'global detection cannot erase the edited cut');
 }finally{for(const api of apis)await api.dispose();globalThis.Worker=old;}
});
