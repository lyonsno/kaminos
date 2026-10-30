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

// Local monotone Hermite uses repeated end samples, not spline coefficients.
for(const samples of [[2],[1,4],[0,1,0],[0,0,1,0,0],[3,3,3,3],[0,2,1,0,5,0],[-4,-2,-3,1],
  [0,1e-8,1000,1000,2]]) {
  const sample=(q,amount=1)=>display.sampleDisplayLine(samples,null,q,'monotone',amount);
  samples.forEach((v,i)=>close(sample(i),v));
  close(sample(-.25),samples[0]);
  close(sample(samples.length-.75),samples.at(-1));
  for(let i=0;i<samples.length-1;i++) {
    let previous=samples[i];
    for(let step=1;step<=32;step++) {
      const f=step/32, value=sample(i+f), a=samples[i],b=samples[i+1];
      assert.ok(value>=Math.min(a,b)-1e-11 && value<=Math.max(a,b)+1e-11,'no new segment extremum');
      assert.ok((value-previous)*Math.sign(b-a)>=-1e-11,'segment stays monotone');
      close(sample(i+f,0),a+(b-a)*f);
      close(sample(i+f,.5),.5*(value+a+(b-a)*f));
      previous=value;
    }
  }
}
for(const f of [.125,.5,.875])close(display.sampleDisplayLine([0,1,2,3],null,1+f,'monotone',1),1+f);
close(display.sampleDisplayLine([0,1,3,4],null,1.25,'monotone',1),1.4375);
close(display.sampleDisplayLine([0,1,0],null,.5,'monotone',1),.5);
assert.equal(display.resolveDisplayReconstruction({emissionInterpolation:'monotone',smokeInterpolation:'monotone'}).emissionInterpolation,'monotone');
console.log('display interpolation knots, coefficients and controls: pass');
