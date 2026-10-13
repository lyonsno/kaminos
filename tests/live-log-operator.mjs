import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operatorColdState,runOperator} from '../tools/live-log-operator.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const cold=()=>({status:'cold',paused:true,burner:false,fluid:{active:true,backend:'WebGPU:apple',grid:48},fields:[{steps:0,runtimeReadbacks:0,lastSource:null}],asset:{sha256:'asset'}});
test('only the real cold native log can be published as usable',()=>{
  assert.equal(operatorColdState(cold(),'asset').status,'cold');
  for(const patch of [{status:'heating'},{paused:false},{burner:true},{fluid:{active:false,backend:'WebGPU:apple'}},{fluid:{active:true,backend:'fallback'}},{fields:[]},{fields:[{steps:1,runtimeReadbacks:0}]},{asset:{sha256:'wrong'}}]){
    assert.throws(()=>operatorColdState({...cold(),...patch},'asset'));
  }
  assert.throws(()=>operatorColdState({...cold(),fluid:{...cold().fluid,grid:96}},'asset'));
});
test('preflight failure leaves a durable failed report without GPU launch',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'log-operator-preflight-'));
  await assert.rejects(runOperator(out,{}),/CHROME_EXECUTABLE required/);
  const report=JSON.parse(await fs.readFile(path.join(out,'report.json')));
  assert.equal(report.status,'failed');assert.equal(report.phase,'preflight');
  assert.deepEqual(report.sources,[]);assert.equal(report.shutdownComplete,true);assert.equal(report.server,undefined);
});
