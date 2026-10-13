import assert from 'node:assert/strict';
import * as optical from '../volume-optical-refinement.mjs';

assert.equal(typeof optical.frozenOpticalPredictor,'function','frozen saved-weight inference must be available without fitting');
const n=35;
const layer=(input,output)=>({weights:Array.from({length:output},()=>Array(input).fill(0)),bias:Array(output).fill(0)});
const model={identity:'optical-error-mlp-v0',probeCount:3,architecture:[n,32,32,4],
  activations:['relu','relu','softplus'],mean:Array(n).fill(2),scale:Array(n).fill(2),
  targetScale:[1,2,3,4],layers:[layer(n,32),layer(32,32),layer(32,4)]};
model.layers[0].weights[0][0]=1;
model.layers[1].weights[0][0]=1;
model.layers[2].weights.forEach(row=>row[0]=1);
const predict=optical.frozenOpticalPredictor(model);
const x=Array(n).fill(2);x[0]=6;
assert.deepEqual(predict(x),model.targetScale.map(s=>Math.fround(Math.fround(Math.log1p(Math.exp(2)))*s)));
x[0]=-6;
assert.deepEqual(predict(x),model.targetScale.map(s=>Math.fround(Math.fround(Math.log(2))*s)));
model.layers[2].bias[0]=999;
assert.equal(predict(x)[0],Math.fround(Math.log(2)),'caller mutation must not change loaded weights');
assert.throws(()=>predict([1]),/feature/);
assert.throws(()=>predict(Array(n).fill(NaN)),/feature/);
for(const edit of [m=>m.scale[0]=0,m=>m.layers[0].weights[0].pop(),m=>m.layers[2].bias[0]=Infinity,
  m=>m.targetScale[0]=-1,m=>m.activations[2]='identity',m=>m.architecture[1]=64]) {
  const broken=structuredClone(model);edit(broken);assert.throws(()=>optical.frozenOpticalPredictor(broken));
}
const extreme=structuredClone(model);extreme.layers[2].bias=[1000,-1000,0,0];
assert.deepEqual(optical.frozenOpticalPredictor(extreme)(x),[1000,0,Math.fround(Math.fround(Math.log(2))*3),Math.fround(Math.fround(Math.log(2))*4)]);
console.log('frozen optical predictor contracts passed');

for(const probes of [3,5]) {
  const width=9*probes+8;
  const scaled={identity:'optical-error-mlp-v1',conditioning:'source-max-abs-v1',probeCount:probes,
    architecture:[width,32,32,4],activations:['relu','relu','softplus'],
    mean:Array(width).fill(0),scale:Array(width).fill(1),targetScale:[1,2,3,4],
    layers:[layer(width,32),layer(32,32),layer(32,4)]};
  scaled.layers[0].weights[0][2]=1;
  scaled.layers[1].weights[0][0]=1;
  scaled.layers[2].weights.forEach(row=>row[0]=1);
  const infer=optical.frozenOpticalPredictor(scaled),features=Array(width).fill(1);
  const indices=Array.from({length:probes},(_,j)=>Array.from({length:6},(_,k)=>9*j+k+1)).flat();
  features[1]=-8;features[2]=4;
  const base=infer(features);
  for(const factor of [.125,8]) {
    const changed=features.map((v,i)=>indices.includes(i)?v*factor:v);
    assert.deepEqual(infer(changed),base.map((v,i)=>i<3?Math.fround(v*factor):v));
  }
  const blind=features.map((v,i)=>indices.includes(i)?0:v);
  assert.deepEqual(infer(blind),scaled.targetScale.map(s=>Math.fround(Math.fround(Math.log(2))*s)),
    'unobserved emission must not be forced to zero');
  for(const bad of [{...scaled,conditioning:'unknown'},{...scaled,conditioning:undefined},
    {...scaled,identity:'optical-error-mlp-v0'}])assert.throws(()=>optical.frozenOpticalPredictor(bad),/model/);
  assert.throws(()=>infer(features.map(v=>v*1e100)),/feature|prediction/);
}
console.log('source-conditioned optical predictor contracts passed');
