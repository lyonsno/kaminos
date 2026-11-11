// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const path=new URL('../tools/build-scene-worker.mjs',import.meta.url);
const api=await import(path).catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND'&&error.url===path.href)return {};throw error;});
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
test('actual worker entry bundles scene, fire and serving owners against one page-matching Three namespace',async t=>{
 assert.equal(typeof api.buildSceneWorkerBundle,'function','selected page worker needs its actual built entry');
 const dir=await mkdtemp(join(tmpdir(),'scene-worker-build-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const out=join(dir,'scene-worker.entry.bundle.mjs'),reportPath=join(dir,'report.json');
 const report=await api.buildSceneWorkerBundle({repoRoot:root,out,reportPath});
 assert.equal(report.status,'built');assert.equal(report.repoRoot,root);assert.equal(report.out,out);assert.ok((await readFile(out)).byteLength>0);
 for(const module of ['scene-worker-runtime.mjs','scene-worker-scene-resources.mjs','scene-worker-fire-resources.mjs','volume-core.js','authoring-image-serving.mjs'])assert.ok(report.inputs.some(path=>path.endsWith(module)),module+' must be the actual bundle input');
 assert.ok(report.inputs.some(path=>path.endsWith('lib/three.webgpu.js')));assert.ok(!report.inputs.some(path=>/node_modules\/three\/(src|build)\//.test(path)));
 assert.equal(JSON.parse(await readFile(reportPath,'utf8')).outputSha256,report.outputSha256);
});
test('a source-missing build writes its failure report and cannot substitute another entry',async t=>{
 assert.equal(typeof api.buildSceneWorkerBundle,'function');const dir=await mkdtemp(join(tmpdir(),'scene-worker-build-failed-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const repoRoot=join(dir,'empty'),out=join(dir,'out.mjs'),reportPath=join(dir,'report.json');await mkdir(repoRoot);
 await assert.rejects(api.buildSceneWorkerBundle({repoRoot,out,reportPath}),/scene-worker.entry.mjs|ENOENT/);
 const report=JSON.parse(await readFile(reportPath,'utf8'));assert.equal(report.status,'failed');assert.equal(report.repoRoot,repoRoot);assert.ok(report.failurePhase);assert.equal(report.outputSha256,null);
 await assert.rejects(readFile(out),/ENOENT/);
});
