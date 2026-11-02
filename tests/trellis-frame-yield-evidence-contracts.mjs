// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {validateFrameYieldState}from '../models/trellis2/frame-yield-checks.js';
const expected={shape:[4,2],frameBudgetMs:8};
const fixture=()=>({status:'completed',phase:'complete',backend:{vendor:'apple',architecture:'metal-3',isFallbackAdapter:false},effectiveRoute:'trellis2.image-generation.webgpu.v0',release:{status:'released'},errors:[],
 runs:['warmup','baseline','frame-aware'].map(mode=>({mode,startMs:0,endMs:100,wallMs:100,frames:[10,30,50],sceneFramesBefore:2,sceneFramesAfter:4,policy:{frameBudgetMs:8,frameYields:2,gpuDrains:2},output:{shape:[4,2],byteLength:32,sha256:'a'.repeat(64)}})),
 stop:{requestedAt:300,observedAt:302,status:'failed',failure:{name:'AbortError'}}});
test('complete paired evidence admits additive diagnostics',()=>{const s=fixture();s.future={field:1};assert.equal(validateFrameYieldState(s,expected),true);});
for(const [name,change]of [
 ['failed primary',s=>s.status='failed'],['fallback',s=>s.backend.isFallbackAdapter=true],['wrong route',s=>s.effectiveRoute='isolated'],
 ['missing pair',s=>s.runs.pop()],['partial output',s=>s.runs[1].output.byteLength--],['different output',s=>s.runs[2].output.sha256='b'.repeat(64)],
 ['changed policy',s=>s.runs[2].policy.frameBudgetMs=40],['missing frame wait',s=>s.runs[2].policy.frameYields=0],
 ['missing drain',s=>s.runs[2].policy.gpuDrains=0],['no frames',s=>s.runs[2].frames=[]],['no foreground renders',s=>s.runs[2].sceneFramesAfter=2],
 ['stale frame',s=>s.runs[2].frames=[-5]],['Stop not observed',s=>s.stop.status='succeeded'],['unreleased',s=>s.release.status='held']
])test('false closure rejected: '+name,()=>{const s=fixture();change(s);assert.throws(()=>validateFrameYieldState(s,expected));});
