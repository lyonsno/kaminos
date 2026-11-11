// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {measureTrellisFit} from '../trellis-fit-metrics.mjs';
test('transparent RGB is unobserved while false opacity remains a visible error',()=>{
 const target=new Float32Array([0,0,0,0]);const empty=measureTrellisFit(new Float32Array([100,50,25,0]),target,{coverage:true});assert.equal(empty.mse,0);assert.equal(empty.conditionalRgbMse,null);assert.equal(empty.premultipliedRgbMse,0);
 const falseHit=measureTrellisFit(new Float32Array([1,1,1,.5]),target,{coverage:true});assert.equal(falseHit.coverageMse,.25);assert.equal(falseHit.premultipliedRgbMse,.25);
 assert.equal(measureTrellisFit(new Float32Array([1,2,3]),new Float32Array([0,0,0])).mse,14/3);
});
