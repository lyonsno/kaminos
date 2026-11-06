// kaminos-test: node
import assert from 'node:assert/strict';
import {summarizeGiCostFrame,installGiCostDeviceCapture} from '../tools/gi-cost-floor-contracts.mjs';
const expected={resolutionScale:.2,slices:1,steps:4,denoise:2,mipSampling:true,temporal:true};
const fixture=()=>({backend:'webgpu',before:{sceneFrames:10,frames:10,history:{frames:10},filterFrames:{ao:10},optimizations:{mipSampling:{effective:true,frames:10}}},after:{sceneFrames:11,frames:11,history:{frames:11},filterFrames:{ao:11},optimizations:{mipSampling:{effective:true,frames:11}},...expected,resolution:[200,100],estimator:{mipSampling:true}},frame:{drawn:true,sceneFrameCount:11,frame:100},passes:[{kind:'render',label:'source',timestamps:['1000000','3000000'],ms:2},{kind:'render',label:'resolve',timestamps:['2000000','4000000'],ms:2}]});
// A scene draw can advance while its FRAME estimator still reuses old output.
const stale=fixture();stale.after.frames=stale.before.frames;
assert.throws(()=>summarizeGiCostFrame(stale,expected),/estimator|fresh/);
const wrong=fixture();wrong.after.resolutionScale=.5;assert.throws(()=>summarizeGiCostFrame(wrong,expected),/resolutionScale/);
const fallback=fixture();fallback.backend='webgl';assert.throws(()=>summarizeGiCostFrame(fallback,expected),/WebGPU/);
const blank=fixture();blank.passes=[];assert.throws(()=>summarizeGiCostFrame(blank,expected),/pass/);
const invalid=fixture();invalid.passes[0].timestamps=['3000000','1000000'];assert.throws(()=>summarizeGiCostFrame(invalid,expected),/timestamp/);
const history=fixture();history.after.history.frames=10;assert.throws(()=>summarizeGiCostFrame(history,expected),/history/);
const filter=fixture();filter.after.filterFrames.ao=10;assert.throws(()=>summarizeGiCostFrame(filter,expected),/filter/i);
const noDraw=fixture();noDraw.frame.drawn=false;assert.throws(()=>summarizeGiCostFrame(noDraw,expected),/draw/);
const result=summarizeGiCostFrame(fixture(),expected);assert.equal(result.gpuSpanMs,3);assert.equal(result.gpuUnionMs,3);assert.equal(result.passDurationSumMs,4);
assert.notEqual(result.gpuSpanMs,result.passDurationSumMs,'Overlapping Metal intervals must not be summed into frame cost');
console.log('GI cost evidence rejects stale/fallback/wrong-settings/partial draws and distinguishes interval union from pass sum');

assert.equal(installGiCostDeviceCapture({}),false,"about:blank must not create an uncaught GPUAdapter error");
