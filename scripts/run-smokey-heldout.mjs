import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';

const [root,input,out,port='18643',mode='baseline']=process.argv.slice(2);
await fs.mkdir(out,{recursive:true});
const report={identity:'smokey-heldout-capture-v1',status:'running',phase:'inputs',root,input,mode,cases:[]};
const save=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));
await save();
try {
  assert.ok(['baseline','sweep'].includes(mode));
  const fixtures=JSON.parse(await fs.readFile(path.join(input,'report.json'),'utf8'));
  assert.equal(fixtures.identity,'smokey-heldout-fixtures-v1');assert.equal(fixtures.status,'observed');
  assert.equal(fixtures.variants.length,9);
  report.source=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'','clean capture source required');
  const cases=mode==='baseline'?[{variant:fixtures.variants.find(v=>v.name==='baseline'),step:197,yaw:0}]
    :fixtures.variants.flatMap(variant=>[197,229].flatMap(step=>[0,-15].map(yaw=>({variant,step,yaw}))));
  for(const {variant,step,yaw} of cases) {
    const target=path.join(out,`${variant.name}-step${step}-yaw${yaw}`);
    const entry={variant:variant.name,presetId:variant.presetId,step,yaw,path:target,status:'running'};
    report.cases.push(entry);report.phase=path.basename(target);await save();
    const child=spawn(process.execPath,[path.join(root,'scripts/capture-optical-trace.mjs'),root,variant.path,target,port,'576',String(step),String(yaw)],{cwd:root,stdio:'inherit'});
    const [code,signal]=await once(child,'exit');entry.exitCode=code;entry.signal=signal;
    const captureBytes=await fs.readFile(path.join(target,'report.json'));
    const capture=JSON.parse(captureBytes);
    entry.status=code===0?'validating':'failed';
    assert.equal(code,0,`capture failed: ${target}`);assert.equal(capture.status,'observed');
    assert.equal(capture.source,report.source);assert.equal(capture.diff,'');
    assert.deepEqual(capture.requested,{heldStep:step,yaw,subdivisions:576});
    assert.equal(capture.chunks.length,9);entry.emitting=capture.emitting;
    entry.reportSha256=createHash('sha256').update(captureBytes).digest('hex');
    entry.status='observed';await save();
  }
  report.phase='complete';report.status='observed';
}catch(error){report.status='failed';report.error=String(error.stack||error);process.exitCode=1;}
finally{await save();}
