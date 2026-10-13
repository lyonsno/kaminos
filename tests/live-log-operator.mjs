import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operatorColdState,runOperator} from '../tools/live-log-operator.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openExperiment} from '../workbench-experiments.mjs';
import {createInvestigationRecording} from '../investigation-recording.mjs';
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
test('operator publication is bound to its retained browser rather than only a URL',async()=>{
  const source=await fs.readFile(new URL('../tools/live-log-operator.mjs',import.meta.url),'utf8');
  assert.match(source,/createOwnedBrowserReveal/,'the operator needs a reveal service for its exact existing page');
  assert.match(source,/browser_reveal=/,'publication must include the current owner identity');
});
test('actual browser initialization awaits the shared async owner read before cloning',async()=>{
  const source=await fs.readFile(new URL('../tools/live-log-operator.mjs',import.meta.url),'utf8');
  const start=source.indexOf('await page.evaluate(async ({id,source})=>{');
  const end=source.indexOf('},{id:report.requestId',start);
  assert.ok(start>=0&&end>start);
  const callback=source.slice(start+'await page.evaluate('.length,end+1)
    .replace("await import('./investigation-recording.mjs')",'{createInvestigationRecording: injectedRecorder}');
  const api=await openExperiment({id:'log',title:'Log',create:async()=>({read:()=>cold(),operations:{},dispose(){}})},{host:{},record(){}});
  const buttons=[];const window={kaminosLiveLog:api};
  const document={createElement:()=>({}),getElementById:()=>({append:button=>buttons.push(button)})};
  await new Function('window','document','injectedRecorder','data',`return (${callback})(data);`)(window,document,createInvestigationRecording,{id:'test',source:{route:'actual-shared-api'}});
  assert.equal(window.__logOperatorRecording.snapshot().initial.status,'cold');
  assert.equal(buttons[0].id,'live-log-finish-session');window.__logOperatorRecording.finish();
});
