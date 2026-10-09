import assert from 'node:assert/strict';
import {bindComponentTransport,applyComponentTransport} from '../structural-material-component-transport.mjs';
const imported=await import('../structural-material-component-gpu-transport.js').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.equal(typeof imported?.packGpuTransport,'function','The visual consumer needs complete positive support bindings for GPU transport');
const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],vertices=[[.2,.2,.2],[.8,.1,.1]],components=[0,0,0,0],binding=bindComponentTransport(rest,vertices,{components,component:0,volumes:[1,1,1,1],radius:2}),indices=[1,0,1];
const packed=imported.packGpuTransport(binding,indices);
assert.equal(packed.offsets.length,12);assert.equal(packed.ranges.length,6);assert.equal(packed.ids.length,binding.entries[1].ids.length*2+binding.entries[0].ids.length);
const current=rest.map(([x,y,z])=>[3-y,2+x,1+z]),q=[0,0,Math.SQRT1_2,Math.SQRT1_2],expected=applyComponentTransport(binding,current,{components});
for(let i=0;i<indices.length;i++){
 const [start,end]=packed.ranges.slice(i*2,i*2+2),o=packed.offsets.slice(i*4,i*4+3),rotated=[-o[1],o[0],o[2]];
 for(let j=start;j<end;j++)current[packed.ids[j]].forEach((x,k)=>rotated[k]+=x*packed.weights[j]);
 rotated.forEach((x,k)=>assert.ok(Math.abs(x-expected[indices[i]][k])<1e-6));
}
assert.throws(()=>imported.packGpuTransport(binding,[2]),/vertex/);
const crossed=structuredClone(binding);crossed.entries[0].weights[0]=-1;assert.throws(()=>imported.packGpuTransport(crossed,[0]),/positive/);
console.log('GPU support packing reproduces the existing positive corotated transport without dropping supports. Native shader parity remains a browser check.');
