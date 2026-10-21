// Test: node --test tests/visual-work-scheduling.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWater,checkOverlap} from '../examples/visual-work/scheduling-evidence.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const state=()=>({mounted:true,backend:'WebGPUBackend',failure:null,
  effectiveRoute:'kaminos/finger-fluid/local-analytic-host-frame-v0',
  setup:{particleCount:12288,densityIterations:1},
  solver:{particleCount:12288,densityIterationsPerStep:1,stepCount:190},
  lastFrame:{submittedByHost:true,presentedByHost:true},paused:true});
const evidence=()=>({requestedSteps:180,startStep:10,state:state(),samples:[{step:11,at:100},{step:190,at:200}]});
test('scheduling evidence rejects fallback, wrong work and incomplete stepping',()=>{
  assert.doesNotThrow(()=>checkWater(evidence()));
  for(const mutate of [e=>e.state.backend='WebGLBackend',e=>e.state.solver.particleCount=49152,
    e=>e.state.solver.densityIterationsPerStep=3,e=>e.state.solver.stepCount=189,
    e=>e.state.effectiveRoute='fallback',e=>e.state.lastFrame.presentedByHost=false,
    e=>e.state.paused=false,e=>e.samples=[]]) {
    const bad=evidence();mutate(bad);assert.throws(()=>checkWater(bad));
  }
});
test('an overlap claim requires water progress during the actual preview interval',()=>{
  const arm={preview:{start:90,end:210,activeStart:120,activeEnd:180},water:[{samples:[{at:130,step:11},{at:160,step:12}]}]};
  assert.doesNotThrow(()=>checkOverlap(arm));
  for(const samples of [[],[{at:100,step:11},{at:190,step:12}], [{at:130,step:11},{at:160,step:11}]])
    assert.throws(()=>checkOverlap({...arm,water:[{samples}]}));
});

test('argument failures replace stale success with the current failed attempt',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'scheduling-arguments-'));
  try {
    for(const args of [['--browser','missing-browser'],['--misspelled-option','value']]){
      await fs.writeFile(path.join(out,'report.json'),JSON.stringify({status:'passed',sentinel:'earlier-attempt'}));
      const run=spawnSync(process.execPath,[fileURLToPath(new URL('../examples/visual-work/scheduling-assay.mjs',import.meta.url)),
        '--out',out,...args],{encoding:'utf8'});
      assert.equal(run.status,1);
      const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
      assert.equal(report.status,'failed');
      assert.equal(report.phase,'arguments');
      assert.match(report.failure,/playwright required|Unknown option/);
      assert.equal(report.sentinel,undefined);
      assert.equal(report.server,undefined);
      assert.equal(report.closed,true);
    }
  }finally{await fs.rm(out,{recursive:true,force:true});}
});
