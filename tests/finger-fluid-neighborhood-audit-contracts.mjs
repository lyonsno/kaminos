import assert from 'node:assert/strict';
import {auditNeighborhood} from '../tools/finger-fluid-neighborhood-audit.mjs';
const config={boundsMin:[-1,-1,-1],boundsMax:[1,1,1],gridDimensions:[4,4,4],radius:.6};
const points=[[0,0,0],[.55,0,0],[-.55,0,0],[0,.2,0],[0,0,.2],[4,0,0],[4.1,0,0]];
let expected=0;
for(let i=0;i<points.length;i++)for(let j=0;j<points.length;j++)
 if(i!==j&&Math.hypot(...points[i].map((p,a)=>p-points[j][a]))<config.radius)expected++;
const result=auditNeighborhood(points,config);
assert.equal(result.acceptedPairs,expected,'complete dynamic stencil must match all-pairs, including clamped edge cells');
assert.equal(result.acceptedAfterCellRejection,expected);
assert.deepEqual(result.searchRadius,[2,2,2]);
assert.equal(result.packedParticleCount,points.length);
assert.equal(result.packedOrderMatchesLinked,true);
assert.equal(result.memoryBytes.neighborIds,expected*4);
assert.throws(()=>auditNeighborhood([[NaN,0,0]],config),/finite/);
assert.throws(()=>auditNeighborhood(points,{...config,radius:0}),/radius/);
assert.throws(()=>auditNeighborhood(points,{...config,gridDimensions:[0,4,4]}),/dimensions/);
const dense=Array.from({length:300},(_,i)=>[i*1e-5,0,0]);
const d=auditNeighborhood(dense,{...config,radius:.1});
assert.equal(d.acceptedPairs,300*299,'no per-particle or per-cell truncation');
assert.equal(d.maxAcceptedNeighbors,299);
console.log('neighborhood audit contracts passed');
const {decodeParticleReadback}=await import('../tools/finger-fluid-neighborhood-audit.mjs');
// Canonical Particle layout in COMPUTE_SHADER and native diagnostic consumer:
// position vec4, predicted vec4, velocity vec4, delta vec4.
const raw=Buffer.alloc(128);
[1,2,3,0,1,2,3,.5,9,8,7,1,0,0,0,1].forEach((v,i)=>raw.writeFloatLE(v,i*4));
raw.writeFloatLE(-1,64+44);
const decoded=decodeParticleReadback(raw);
assert.equal(decoded.inactive,1,'velocity.w is the active flag');
assert.equal(decoded.positionPredictionMismatches,0,'predicted starts at byte16');
assert.equal(decoded.interfaceParticles,1,'predicted.w stores surface factor');
assert.deepEqual(decoded.points,[[1,2,3]]);
