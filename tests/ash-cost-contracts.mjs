// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {validateAshCostReport} from '../tools/ash-cost-contracts.mjs';
const valid=()=>({requested:{mode:'cells',width:7.68},effective:{mode:'cells',width:7.68},status:'passed',route:'shared-webgpu-pass-timestamps',sourceBefore:'abc',sourceAfter:'abc',browserClosed:true,errors:[],consoleErrors:[],cases:Object.fromEntries(['settled','moving'].map(k=>[k,{samples:[{compute:{passes:[{timestamps:['100','110']}]},render:{frame:{frame:1,drawn:true},passes:[{timestamps:['120','130'],colorAttachments:4}]}}]}]))});
test('complete pass evidence admitted',()=>assert.equal(validateAshCostReport(valid()).status,'passed'));
test('partial, fallback, stale and missing timing cannot close',()=>{for(const mutate of [r=>r.status='running',r=>r.route='wall-clock',r=>r.sourceAfter='def',r=>r.browserClosed=false,r=>r.cases.moving.samples=[],r=>r.cases.settled.samples[0].render.passes=[],r=>r.cases.moving.samples[0].compute.passes[0].timestamps=['0','0']]){const r=valid();mutate(r);assert.throws(()=>validateAshCostReport(r));}});
test('requested surface mode and area must equal effective configuration',()=>{const r=valid();r.requested={mode:'runs',width:15.36};r.effective={mode:'cells',width:7.68};assert.throws(()=>validateAshCostReport(r),/configuration/);});

test('cached presentation cannot stand in for a full scene render',()=>{const r=valid();r.cases.settled.samples[0].render.passes[0].colorAttachments=1;assert.throws(()=>validateAshCostReport(r),/scene render/);});
