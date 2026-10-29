// kaminos-test: node
import assert from 'node:assert/strict';
import * as display from '../volume-display-reconstruction.mjs';

assert.deepEqual(display.displayReconstructionShapes([3,5,3],2,'aligned'),
  [[3,5,3],[5,5,3],[5,9,3],[5,9,5]],'aligned lattice retains original knots');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-11,`${a} != ${b}`);
for(const samples of [[2],[1,4],[0,1,0],[0,0,1,0,0],[3,3,3,3],[0,2,1,0,5,0]]) {
  const c=display.interpolatingSplineCoefficients(samples);
  assert.equal(c.length,samples.length);
  samples.forEach((value,i)=>close(display.sampleDisplayLine(samples,c,i,'interpolating',1),value));
  for(let i=0;i<samples.length-1;i++)for(const f of [.125,.5,.875]) {
    const q=i+f;
    close(display.sampleDisplayLine(samples,c,q,'interpolating',0),samples[i]*(1-f)+samples[i+1]*f);
    close(display.sampleDisplayLine(samples,c,q,'positive',.5),
      display.positiveCubicWeights(f,.5).reduce((s,w,j)=>s+w*samples[Math.max(0,Math.min(samples.length-1,i+j-1))],0));
  }
}
assert.ok(display.interpolatingSplineCoefficients([0,1,0]).some(v=>v<0),'signed coefficients are retained');
for(const scale of [1,2,4]) {
  for(const i of [0,1,2]) {
    close(display.displayAxisCoordinate(i*scale,3,scale,'aligned'),i);
    close(display.displayCameraCoordinate(i+.5,scale,'aligned'),i*scale);
  }
}
close(display.displayAxisCoordinate(0,3,2,'cell-centred'),-.25);
close(display.displayCameraCoordinate(1.5,2,'cell-centred'),2.5);
const config=display.resolveDisplayReconstruction({displayAlignment:'aligned',emissionInterpolation:'interpolating',smokeInterpolation:'positive'});
assert.equal(config.alignment,'aligned');
assert.equal(config.emissionInterpolation,'interpolating');
assert.equal(config.smokeInterpolation,'positive');
assert.throws(()=>display.resolveDisplayReconstruction({displayAlignment:'unknown'}),/alignment/);
assert.throws(()=>display.resolveDisplayReconstruction({smokeInterpolation:'unknown'}),/interpolation/);
console.log('display interpolation knots, coefficients and controls: pass');
