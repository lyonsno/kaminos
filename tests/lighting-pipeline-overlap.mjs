// kaminos-test: node
import assert from 'node:assert/strict';
import {WebGPURenderer,Scene,PerspectiveCamera} from '../lib/three.webgpu.js';
// Exercise the shipped compiler itself: shader graph construction remains
// ordered, but independent native pipeline promises must overlap.
globalThis.requestAnimationFrame=callback=>setImmediate(callback);
const events=[],releases=[],rejects=[];
const objects=[0,1].map(id=>({id,geometry:{drawRange:{}}}));
const renderList={opaque:objects,transparent:[],transparentDoublePass:[],lightsNode:{},begin(){},finish(){}};
const renderer={_initialized:true,_renderTarget:null,_outputRenderTarget:null,_activeMipmapLevel:0,
 _nodes:{nodeFrame:{renderId:0,update(){}},async getForRenderAsync(o){events.push(['build',o.object.id]);},updateBefore(){},updateForRender(){},updateAfter(){}},
 _renderContexts:{get:()=>({})},_renderLists:{get:()=>renderList},_background:{update(){}},
 _updateCamera:c=>c,_projectObject(){},opaque:true,transparent:false,
 _renderObjects(items,camera,scene,lightsNode){for(const object of items)this._compilationPromises.push({object,camera,scene,lightsNode});},
 _objects:{get:object=>({object})},_geometries:{updateForRender(){}},_bindings:{updateForRender(){}},
 _pipelines:{getForRender(o,promises){events.push(['pipeline',o.object.id]);promises.push(new Promise((resolve,reject)=>{releases.push(resolve);rejects.push(reject);}));}},
};
const task=WebGPURenderer.prototype.compileAsync.call(renderer,new Scene(),new PerspectiveCamera());
// Chrome's cooperative yield has the same task semantics; Node fallback is RAF.

await new Promise(r=>setImmediate(()=>setImmediate(r)));
assert.deepEqual(events,[['build',0],['pipeline',0],['build',1],['pipeline',1]],'do not serialize independent native compilation waits');
let finished=false;task.then(()=>finished=true);
releases[0]();await Promise.resolve();assert.equal(finished,false,'the compiler must wait for every native pipeline');
releases[1]();await task;assert.equal(finished,true);
console.log('PASS cooperative graph order, overlapping native pipelines, complete settlement');

releases.length=rejects.length=0;
const rejected=WebGPURenderer.prototype.compileAsync.call(renderer,new Scene(),new PerspectiveCamera());
const rejection=assert.rejects(rejected,/native rejection/);
await new Promise(r=>setImmediate(()=>setImmediate(r)));
let rejectedFinished=false;rejected.catch(()=>rejectedFinished=true);
rejects[0](Error('native rejection'));await new Promise(r=>setImmediate(r));
assert.equal(rejectedFinished,false,'a failed pipeline must not release the pass while another native compile is pending');
releases[1]();await rejection;
releases.length=rejects.length=0;
renderer._nodes.getForRenderAsync=async o=>{if(o.object.id===1)throw Error('graph build rejection');};
const buildRejected=WebGPURenderer.prototype.compileAsync.call(renderer,new Scene(),new PerspectiveCamera());
const buildRejection=assert.rejects(buildRejected,/graph build rejection/);
await new Promise(r=>setImmediate(()=>setImmediate(r)));
let buildFinished=false;buildRejected.catch(()=>buildFinished=true);
await Promise.resolve();assert.equal(buildFinished,false,'graph failure also drains previously submitted pipelines');
releases[0]();await buildRejection;
console.log('PASS rejection drains outstanding native work before releasing caller state');
