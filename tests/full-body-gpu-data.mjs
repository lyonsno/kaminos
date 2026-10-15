// kaminos-test: node
import assert from 'node:assert/strict';
let api={};try{api=await import('../experiments/creature-motion/gpu-skin-data.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
assert.equal(typeof api.prepareGpuSkin,'function','GPU transport must retain every dense influence and deterministic incident-face order');
const rest=new Float32Array([0,0,0,1,0,0,0,1,0,1,1,0]),triangles=new Uint32Array([0,1,2,1,3,2]);
const weights=new Float32Array([.5,.5,.2,.8,.9,.1,.4,.6]);
const p=api.prepareGpuSkin({rest,triangles,weights,channels:2});
assert.deepEqual(p.weights,weights);assert.notEqual(p.weights,weights,'GPU payload owns a static copy');
assert.deepEqual([...p.dominant],[0,1,0,1],'ties use the first maximum, matching the CPU');
assert.deepEqual([...p.offsets],[0,1,3,5,6]);assert.deepEqual([...p.faces],[0,0,1,0,1,1]);
for(const edit of [x=>x.weights[0]=NaN,x=>x.weights[0]=-.1,x=>x.weights[0]=.4,x=>x.triangles[0]=4,x=>x.rest[0]=Infinity]){
 const bad={rest:rest.slice(),triangles:triangles.slice(),weights:weights.slice(),channels:2};edit(bad);assert.throws(()=>api.prepareGpuSkin(bad));
}
console.log('Dense GPU payload preserves every influence, dominant-anchor ties, all incident faces and rejects invalid partitions/geometry');
