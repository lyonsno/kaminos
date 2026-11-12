// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {measureTrellisFit} from '../trellis-fit-metrics.mjs';
test('transparent RGB is unobserved while false opacity remains a visible error',()=>{
 const target=new Float32Array([0,0,0,0]);const empty=measureTrellisFit(new Float32Array([100,50,25,0]),target,{coverage:true});assert.equal(empty.mse,0);assert.equal(empty.conditionalRgbMse,null);assert.equal(empty.premultipliedRgbMse,0);
 const falseHit=measureTrellisFit(new Float32Array([1,1,1,.5]),target,{coverage:true});assert.equal(falseHit.coverageMse,.25);assert.equal(falseHit.premultipliedRgbMse,.25);
 assert.equal(measureTrellisFit(new Float32Array([1,2,3]),new Float32Array([0,0,0])).mse,14/3);
});
test('visible color and absent-footprint coverage remain separately observable',()=>{
 const target=new Float32Array([1,0,0,1, 99,99,99,0, 0,1,0,.5]);
 const prediction=new Float32Array([.8,0,0,.7, 9,8,7,.3, 0,.5,0,.4]);
 const bins=measureTrellisFit(prediction,target,{coverage:true}).visibility;
 assert.equal(bins.visible.count,1);assert.ok(Math.abs(bins.visible.conditionalRgbMse-.04/3)<1e-7);
 assert.equal(bins.absent.count,1);assert.equal(bins.absent.conditionalRgbMse,null);assert.ok(Math.abs(bins.absent.coverageMse-.09)<1e-7);
 assert.equal(bins.partial.count,1);assert.ok(Math.abs(bins.partial.conditionalRgbMse-.25/3)<1e-7);
});
