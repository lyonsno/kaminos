import assert from 'node:assert/strict';
import {buildOpticalHierarchy,refineOpticalHierarchy} from '../volume-optical-refinement.mjs';
import {regionalTransferError} from '../volume-optical-region.mjs';
import {constantTransfer,integrateProbes} from '../volume-optical-trace.mjs';

const probe=(sigma,e)=>({sigma,emission:[e,-e/4,0],scattered:[0,0,0],flags:[0,0]});
const hierarchy=probes=>buildOpticalHierarchy(probes,{length:1,rootSpan:32,probeCount:5});
// These envelopes bound a synthetic piecewise-linear coefficient field only.
// They are not bounds obtained from the flame's nonlinear material reconstruction.
const ranges=probes=>({start,end})=>{
  const values=probes.slice(start,end+1);
  return {start,end,authority:'synthetic-piecewise-linear',
    sigma:[Math.min(...values.map(p=>p.sigma)),Math.max(...values.map(p=>p.sigma))],
    source:[0,1,2].map(k=>{
      const channel=values.map(p=>p.emission[k]+p.scattered[k]);
      return [Math.min(...channel),Math.max(...channel)];
    })};
};
const tolerance=[0.001,0.001,0.001,0.001];
const flat=Array.from({length:65},()=>probe(0.03,2));
const flatResult=refineOpticalHierarchy(hierarchy(flat),{
  policy:'regional',tolerances:tolerance,regionBounds:ranges(flat)});
assert.deepEqual(flatResult.accepted.map(n=>[n.start,n.end]),[[0,32],[32,64]],
  'homogeneous nonzero material must not require an exact-zero region');
assert.equal(flatResult.unresolvedLeafCount,0);
assert.equal(flatResult.metadataQueryCount,2);
assert.equal(flatResult.uniqueProbeCount,2,'accepted region uses one material evaluation');
assert.deepEqual(flatResult.accepted[0].error,[0,0,0,0]);

const thin=Array.from({length:65},()=>probe(0,0));
thin[5]=probe(0,8);thin[6]=probe(0,16);thin[7]=probe(0,8);
const tree=hierarchy(thin);
const numerical=refineOpticalHierarchy(tree,{policy:'numerical',tolerances:tolerance});
const regional=refineOpticalHierarchy(tree,{
  policy:'regional',tolerances:tolerance,regionBounds:ranges(thin)});
assert.equal(numerical.transfer[0],0,'retain the known sparse-probe aliasing counterexample');
assert.ok(regional.transfer[0]>0,'regional evidence must force refinement of the missed sheet');
assert.ok(regional.error[0]<numerical.error[0]);
assert.ok(regional.unresolvedLeafCount>0,'minimum-step unresolved variation must remain visible');
assert.equal(regional.observedIndices.length,new Set(regional.observedIndices).size);
assert.equal(regional.accepted.at(-1).end,64,'no unrendered tail');
assert.equal(regional.accepted.reduce((h,n)=>h+n.h,0),1);
for(let i=1;i<regional.accepted.length;i++)assert.equal(regional.accepted[i-1].end,regional.accepted[i].start);

// Extinction can matter without local emission because it changes the background.
const fog=Array.from({length:65},(_,i)=>probe(0.01+(i/64)**2,0));
const fogTree=hierarchy(fog);
const fogTolerance=[0.001,0.001,0.001,1];
const dark=refineOpticalHierarchy(fogTree,{policy:'numerical',tolerances:fogTolerance});
const bright=refineOpticalHierarchy(fogTree,{
  policy:'numerical',tolerances:fogTolerance,suffixRadianceBound:[100,100,100]});
assert.ok(bright.uniqueProbeCount>dark.uniqueProbeCount,'bright suffix must influence attenuation refinement');

assert.throws(()=>refineOpticalHierarchy(tree,{policy:'regional',tolerances:tolerance}),/region bounds/);
for(const invalid of [undefined,{...ranges(thin)({start:0,end:32}),end:31},
  {...ranges(thin)({start:0,end:32}),authority:''},
  {...ranges(thin)({start:0,end:32}),sigma:[-1,1]},
  {...ranges(thin)({start:0,end:32}),source:[[0,NaN],[0,0],[0,0]]}]) {
  assert.throws(()=>refineOpticalHierarchy(tree,{
    policy:'regional',tolerances:tolerance,regionBounds:()=>invalid}),/region/);
}
assert.throws(()=>refineOpticalHierarchy(tree,{
  policy:'numerical',tolerances:tolerance,suffixRadianceBound:[-1,0,0]}),/suffix/);

assert.throws(()=>refineOpticalHierarchy(hierarchy(flat),{
  policy:'regional',tolerances:tolerance,regionBounds:n=>({
    ...ranges(flat)(n),source:[[0,1],[-1,0],[0,0]]})}),/contradicts/);
// Signed emission, independent emission with sigma=0, and scattering all
// participate in the envelope; comparison integrals are computed separately.
for(const sigma of [0,1e-10,0.01,1,100])for(const width of [0,1e-8,0.3,10]) {
  const field=Array.from({length:129},(_,i)=>{
    const u=i/128;
    return {sigma:sigma+width*u,emission:[Math.sin(u*7),-u*u,2*u],
      scattered:[0.2*u,0.1,0.5],flags:[0,0]};
  });
  const bounds=ranges(field)({start:0,end:128});
  for(const h of [1e-6,0.1,1,10]) {
    const envelope=regionalTransferError(bounds,h);
    const approximate=constantTransfer(field[64],h);
    const reference=integrateProbes(field,h);
    reference.forEach((v,i)=>assert.ok(Math.abs(v-approximate[i])<=envelope[i]+1e-12,
      `transfer envelope violated at sigma=${sigma}, width=${width}, h=${h}, channel=${i}`));
  }
}
console.log('regional refinement, nonzero smoke, missed sheets and bright-suffix contracts passed');
