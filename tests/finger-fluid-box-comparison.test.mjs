import assert from 'node:assert/strict';
import {solverSpy} from './helpers/finger-fluid-solver-spy.mjs';
const count=4096,data=new Float32Array(count*16);
for(let i=0;i<count;i++)data.set([0,.5,0,1,0,.5,0,1,0,0,0,.3,0,0,0,24.3],i*16);
const box={schema:'kaminos.fluid-reference-box.v1',bounds:{min:[-1.5,-1,-.65],max:[1.5,2,.65]},collisionRadius:1/32,planes:[]};
for(let k=0;k<3;k++)for(const side of ['min','max']){const normal=[0,0,0];normal[k]=side==='min'?1:-1;box.planes.push({normal,offset:normal[k]*box.bounds[side][k]});}
const diagnosticPopulation={schema:'kaminos.fluid-discriminator-population.v1',particleCount:count,particleData:data,particleVolumeScale:1};
const s=await solverSpy({particleCount:count,diagnosticPopulation,diagnosticBox:box,viscosityScaling:'nominal_diffusion'});
try {
 assert.equal(s.solver.getDebugState().diagnosticBox?.schema,box.schema,'requested finite box must be effective, not silently replaced by playground');
 s.solver.step(1/120);
 const params=s.writes.find(w=>w.bytes.length===224);const v=new DataView(Uint8Array.from(params.bytes).buffer);
 assert.equal(v.getFloat32(204,true),.5,'half dt must halve viscosity mixing at reference spacing');
 assert.equal(v.getFloat32(32,true),-1.5);assert.equal(v.getFloat32(56,true),Math.fround(.65));
 const d=s.solver.getDebugState();assert.equal(d.simulatedTimeSeconds,1/120);assert.equal(d.lastStepSeconds,1/120);
 assert.throws(()=>s.solver.step(1/1000),/timestep/i,'comparison cannot silently clamp requested dt');
 for(let k=0;k<3;k++)assert.ok((box.bounds.max[k]-box.bounds.min[k])/v.getUint32(16+4*k,true)>=.185,'neighbor cells must cover full support');
 assert.ok(s.initialWrites.some(w=>w.bytes.length===data.byteLength&&Buffer.from(w.bytes).equals(Buffer.from(data.buffer))),'exact initial positions and finite tags must reach GPU');
} finally{s.close();}
console.log('Finite PBF box, exact clock, viscosity uniform and neighbor coverage pass');
