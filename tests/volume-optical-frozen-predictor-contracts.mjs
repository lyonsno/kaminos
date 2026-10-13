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
