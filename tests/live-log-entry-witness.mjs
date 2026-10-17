// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as contracts from '../tools/live-log-witness-contracts.mjs';

// Contract-bearing projection of observed native R5 at 9f5ec7f3e; full report
// and picture remain in sinter-log-current32-1014/ignition-entry-r5.
const entry={objectId:'glb-35c88f1e-9b65-4131-8b14-850b6502cf88',burner:false,paused:true,fields:[{steps:0}],gasSource:{enabled:true}};
const observed={enabled:true,runtime:{effective:'mesh-voxel-solid',solidCellCount:264,members:[{id:entry.objectId,solidCellCount:264}]}};
const source=fs.readFileSync(new URL('../tools/live-log-ignition-witness.mjs',import.meta.url),'utf8');
const start=source.indexOf('    report.entry=await read();'),end=source.indexOf('  }else{',start);
assert.ok(start>=0&&end>start,'cold-entry branch exists');
async function run(collision){
  const report={frames:[]},page={evaluate:async()=>collision,screenshot:async()=>{}};
  const context={...contracts,report,page,read:async()=>entry,assert,path:{join:()=>''},out:''};
  const execute=vm.runInNewContext('(async()=>{'+source.slice(start,end)+'report.status="passed";return report;})',context);
  return execute();
}
test('observed cold entry passes the actual witness branch',async()=>assert.equal((await run(observed)).status,'passed'));
for(const [name,collision] of [
  ['missing runtime',{enabled:true,runtime:null}],
  ['unavailable runtime',{enabled:true,runtime:{effective:'unavailable',solidCellCount:0}}],
  ['empty mask',{enabled:true,runtime:{...observed.runtime,solidCellCount:0,members:[]}}],
  ['another object mask',{enabled:true,runtime:{...observed.runtime,members:[{id:'other',solidCellCount:264}]}}],
  ['retyped solid count',{enabled:true,runtime:{...observed.runtime,solidCellCount:'264'}}],
])test('cold-entry report rejects '+name,async()=>assert.rejects(()=>run(collision),/collision|mask|mounted log/i));
