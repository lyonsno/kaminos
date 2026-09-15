import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { createNBodyActiveRowTrustRegionConfig, solveNBodyActiveRowTrustRegionStep } from '../nbody-packing-restoration.mjs';

const legacy = process.env.PACKER_BASELINE === '1';
const candidate = legacy ? null : await import('../packing-inequality-step.mjs');
function evaluator(gaps, bone) {
  return ({vector}) => {
    const rows = gaps(vector);
    const metrics = {pairwisePenetration:Math.max(0, ...rows.filter(r=>r.kind==='pairwise-clearance').map(r=>-r.signedGap)), skeletalPenetration:bone(vector), compartmentEscape:0,endpointDrift:0,maximumRelativeVolumeError:0};
    return {rows, metrics, maximumPhysicalResidual:Math.max(...Object.values(metrics)), muscles:[]};
  };
}
async function solve(stateEvaluator, n=2) {
  const problem={identity:{sha256:'synthetic-inequality-step-contract'},variables:Array.from({length:n},(_,i)=>({key:String(i)})),carrier:{degreesOfFreedomPerMember:n},stateEvaluatorRoute:{requested:'synthetic',effective:'synthetic',fallbackUsed:false}};
  const config={...createNBodyActiveRowTrustRegionConfig({activeSetPolicy:'family-maximum-relative-band',guardRowPolicy:'candidate-crossing-clear-rows'}),translationBounds:[-2,2],trustRegionRadii:[1,.5,.1]};
  return legacy ? solveNBodyActiveRowTrustRegionStep({problem,startVector:Array(n).fill(0),requestedConfig:config,stateEvaluator}) : candidate.solvePackingInequalityStep({problem,startVector:Array(n).fill(0),stateEvaluator,config:{radius:1,finiteDifferenceStep:1e-5,translationBounds:[-2,2],backtrackingScales:[1,.5,.1],python:process.env.PACKER_SCIPY_PYTHON}});
}
test('a tangent move may solve penetration without strictly improving touching guards',async()=>{
  const evalState=evaluator(([x,y])=>[{key:'pair',kind:'pairwise-clearance',signedGap:x-1},{key:'upper',kind:'skeletal-clearance',signedGap:-y},{key:'lower',kind:'skeletal-clearance',signedGap:y}],([,y])=>Math.abs(y));
  const result=await solve(evalState);
  assert.ok(result.selected.metrics.pairwisePenetration<1e-7, 'known feasible forward move must not be rejected because guard derivatives are zero');
  assert.ok(Math.abs(result.selected.vector[1])<1e-8);
});
test('minimum-displacement complete restoration uses available guard slack',async()=>{
  const evalState=evaluator(([x,y])=>[{key:'pair',kind:'pairwise-clearance',signedGap:x+y-1},{key:'upper',kind:'skeletal-clearance',signedGap:.2-y}],([,y])=>Math.max(0,y-.2));
  const result=await solve(evalState);
  assert.ok(result.selected.metrics.pairwisePenetration<1e-7);
  assert.ok(result.selected.vector[1]>.19 && result.selected.vector[1]<=.2+1e-8);
  assert.ok(Math.abs(result.selected.vector[0]-.8)<1e-7, 'lexicographic minimum norm among zero-residual points');
});
test('opposed contact demands return no improvement rather than an infeasibility claim',async()=>{
  const evalState=evaluator(([x])=>[{key:'right',kind:'pairwise-clearance',signedGap:x-1},{key:'left',kind:'pairwise-clearance',signedGap:-x-1}],()=>0);
  const result=await solve(evalState,1);
  assert.equal(result.selected.metrics.pairwisePenetration,1);
  if(!legacy) assert.equal(result.status,'no-admissible-improvement');
});
test('nonlinear evaluation vetoes a misleading linear guard prediction',async()=>{
  const evalState=evaluator(([x])=>[{key:'pair',kind:'pairwise-clearance',signedGap:x-1},{key:'curved',kind:'skeletal-clearance',signedGap:-x*x}],([x])=>x*x);
  const result=await solve(evalState,1);
  assert.deepEqual(result.selected.vector,[0]);
  assert.equal(result.selected.metrics.skeletalPenetration,0);
});

test('candidate missing contact rows fails instead of claiming improvement',{skip:legacy},async()=>{
  const base=evaluator(([x])=>[{key:'pair',kind:'pairwise-clearance',signedGap:x-1}],()=>0);
  await assert.rejects(()=>solve(args=>{
    const state=base(args); if(args.vector[0]>.5) state.rows=[]; return state;
  },1),/contact row identity/);
});

test('negative penetration metric is invalid evaluator output',{skip:legacy},async()=>{
  const base=evaluator(([x])=>[{key:'pair',kind:'pairwise-clearance',signedGap:x-1}],()=>0);
  await assert.rejects(()=>solve(args=>{
    const state=base(args);if(args.vector[0]>.5)state.metrics.pairwisePenetration=-1;return state;
  },1),/invalid physical metric/);
});

test('failed reinvocation replaces stale successful result with current failure',{skip:legacy},async()=>{
  const output=await mkdtemp(path.join(tmpdir(),'packing-run-report-test-'));
  await writeFile(path.join(output,'result.json'),JSON.stringify({status:'comparison-completed',runId:'old'}));
  const child=spawnSync(process.execPath,['tools/packing-inequality-comparison.mjs',output,'unused-python','invalid-mode'],{encoding:'utf8'});
  assert.notEqual(child.status,0);
  const report=JSON.parse(await readFile(path.join(output,'result.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.notEqual(report.runId,'old');
});
