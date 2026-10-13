import test from 'node:test';
import assert from 'node:assert/strict';
let create;
try{({createFluidRenderHistory:create}=await import('../fluid-render-history.mjs'));}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('render history copies every renderer input without replacing live buffers',()=>{
 assert.equal(typeof create,'function','Render history unavailable');const copies=[],destroyed=[];
 const device={createBuffer:o=>({...o,destroy(){destroyed.push(this);}}),createCommandEncoder:()=>({copyBufferToBuffer(...args){copies.push(args);},finish(){return {};}}),queue:{submit(){}}};
 const sources={particles:{buffer:{label:'live-particles'},bytes:64},topology:{buffer:{label:'live-topology'},bytes:144},tracers:{buffer:{label:'live-tracers'},bytes:80}};
 const h=create({device,sources,usage:7}),a=h.capture({step:0}),b=h.capture({step:1});
 assert.equal(copies.length,6);assert.deepEqual(copies.map(c=>c[4]),[64,144,80,64,144,80]);
 assert.equal(h.buffers(a).particles.label,'retained-fluid-particles-0');assert.notEqual(h.buffers(a).particles,h.buffers(b).particles);
 assert.equal(sources.particles.buffer.label,'live-particles');assert.equal(h.state().bytes,576);
 assert.throws(()=>h.buffers({...a}),/Unknown/);a.release();assert.throws(()=>h.buffers(a),/released/);assert.equal(destroyed.length,3);
 h.dispose();assert.equal(destroyed.length,6);assert.throws(()=>h.capture({step:2}),/disposed/);
});
