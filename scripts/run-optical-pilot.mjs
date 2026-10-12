import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';

const [root,input,out,port='18641']=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'optical-state-view-pilot-v0',status:'running',phase:'inputs',root,input,
  claim:'Three scanlines per approved state/view; preliminary prediction comparison, not full-image coverage',cases:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await save();
try {
  report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'','pilot requires a clean source tree');
  for(const step of [151,173,197,229])for(const yaw of [0,-15,15]) {
    const split=step===229?'test':step===197?'validation':yaw===15?'view-test':'train';
    const target=path.join(out,`step${step}-yaw${yaw}`);
    const entry={step,yaw,split,path:target,status:'running'};
    report.cases.push(entry);report.phase=`capture-${step}-${yaw}`;await save();
    const child=spawn(process.execPath,[path.join(root,'scripts/capture-optical-trace.mjs'),root,input,target,port,'576',String(step),String(yaw)],{cwd:root,stdio:'inherit'});
    const [code,signal]=await once(child,'exit');
    entry.exitCode=code;entry.signal=signal;
    const capture=JSON.parse(await fs.readFile(path.join(target,'report.json'),'utf8'));
    assert.equal(code,0,`capture failed: ${target}`);assert.equal(capture.status,'observed');
    assert.equal(capture.source,report.source);assert.equal(capture.diff,'');
    assert.deepEqual(capture.requested,{heldStep:step,yaw,subdivisions:576});
    entry.status='observed';await save();
  }
  report.phase='complete';report.status='observed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await save();}
