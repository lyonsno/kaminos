import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('../../../',import.meta.url)));
const native=process.argv[2],source=process.argv[3],python=process.argv[4];
assert.ok(native&&source&&python,'explicit observed native report/source/environment required');
const n=JSON.parse(await fs.readFile(path.join(native,'report.json'),'utf8'));
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'','run refusal witness on exact clean source');
const folder=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-finish-refusal-'));
try{
  for(const [label,change]of [
    ['fallback',x=>x.result={...x.result,backend:{...x.result.backend,isFallbackAdapter:true}}],
    ['incomplete',x=>x.status='running'],
    ['stale-source',x=>x.commit='0'.repeat(40)],
    ['partial-field',x=>x.rawOutputs={...x.rawOutputs,'geometry.features':{...x.rawOutputs['geometry.features'],byteLength:4}}],
  ]){
    const input=path.join(folder,label,'native'),out=path.join(folder,label,'output');
    await fs.mkdir(input,{recursive:true});const changed={...n};change(changed);
    await fs.writeFile(path.join(input,'report.json'),JSON.stringify(changed));
    const result=spawnSync(process.execPath,[path.join(root,'models/trellis2/finalize-retained-generation.mjs'),
      '--repo-root',root,'--expected-commit',commit,'--input-root',input,'--expected-native-commit',n.commit,
      '--python',python,'--source-root',source,'--expected-source-commit','34a7a570d5d6d8b9c99bbddb1d52bd414600d5c6',
      '--target-faces','200000','--receiver','synthetic-refusal-test','--output',path.join(out,'asset.glb')],{encoding:'utf8'});
    const report=JSON.parse(await fs.readFile(path.join(out,'report.json'),'utf8'));
    assert.notEqual(result.status,0,label);assert.equal(report.status,'failed');
    assert.equal(report.phase,'native-field-admission',JSON.stringify(report.error));
    assert.match(report.error.message,label==='partial-field'?/conflicting retained field receipt/:/completed exact-source native/);
    await assert.rejects(fs.stat(path.join(out,'asset.glb')));
    assert.equal(report.postprocessCommand,undefined,'native admission refusal precedes any source finalizer execution');
  }
}finally{await fs.rm(folder,{recursive:true,force:true});}
console.log('Observed native report mutations expose fallback/incomplete/stale/partial false closure; each refusal retains its phase/error and emits no asset.');
