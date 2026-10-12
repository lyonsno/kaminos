import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /async function sampleOpticalTraceChunk\(/,
  'mode-2 camera coefficients need an explicit held-state trace API');
const { constantTransfer, composeTransfers, integrateProbes, estimateProbeError,
  opticalProbeFeatures, traceChunkPlan, validateTraceRows } = await import('../volume-optical-trace.mjs');
const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-11, `${a} != ${b}`);
const p = (sigma, emission, scattered = [0,0,0]) => ({sigma, emission, scattered, flags:[0,0]});
for (const sigma of [0, 1e-12, 0.8, 90]) {
  const probe = p(sigma, [2,3,4]);
  const whole = constantTransfer(probe, 0.7);
  const split = composeTransfers(constantTransfer(probe, 0.3), constantTransfer(probe, 0.4));
  whole.forEach((v,i) => close(v, split[i]));
  close(whole[3], Math.exp(-sigma*0.7));
  close(whole[0], sigma === 0 ? 1.4 : 2*-Math.expm1(-sigma*0.7)/sigma);
  for (const n of [3,5]) {
    const probes = Array(n).fill(probe);
    integrateProbes(probes, 0.7).forEach((v,i) => close(v, whole[i]));
    estimateProbeError(probes, 0.7).error.forEach(v=>close(v,0));
    const features = opticalProbeFeatures(probes, {h:0.7, gridPitch:0.1, direction:[0,0,1], cellFraction:[0.2,0.3,0.4]});
    assert.equal(features.length, n===3 ? 35 : 53);
    close(features[0], 0.7*sigma);
    close(features[1], 1.4);
  }
}
assert.deepEqual(composeTransfers([1,2,3,0.5],[4,6,8,0.25]), [3,5,7,0.125]);
assert.notDeepEqual(composeTransfers([4,6,8,0.25],[1,2,3,0.5]), [3,5,7,0.125]);
assert.throws(()=>constantTransfer(p(-1,[1,1,1]),1), /nonnegative/);
assert.throws(()=>integrateProbes([p(0,[1,1,1])],1), /at least two/);
const plan=traceChunkPlan({firstRay:0,rayCount:4,sampleOffset:2,sampleCount:3,subdivisions:8,width:2,height:2,maxBytes:4*3*32*4});
assert.equal(plan.byteLength, 1536);
assert.throws(()=>traceChunkPlan({...plan, maxBytes:1535}), /device storage limit/);
assert.throws(()=>traceChunkPlan({...plan, sampleOffset:8}), /sample range/);
assert.throws(()=>validateTraceRows(new Float32Array(0),plan), /partial/);
assert.throws(()=>validateTraceRows(new Float32Array(plan.rowCount*32),plan), /unwritten/);
const values=new Float32Array(plan.rowCount*32);
for(let r=0;r<4;r++)for(let s=0;s<3;s++){
  const at=(r*3+s)*32;
  values[at]=r;values[at+1]=s+2;values[at+2]=0;values[at+3]=1;
}
assert.equal(validateTraceRows(values,plan).misses,12);
values[3]=0;
assert.throws(()=>validateTraceRows(values,plan), /unwritten/);
assert.match(core, /override OPTICAL_TRACE_CAPTURE: bool = false;/);
assert.match(core, /OPTICAL_TRACE_CAPTURE:Boolean\(options.opticalTrace\)/);
assert.match(core, /opticalTraceCaptureActive/,'capture must reject overlapping asynchronous calls');
console.log('optical transfer, input normalization, allocation and trace completeness contracts passed');
