// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {pathToFileURL} from 'node:url';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
test('external app imports the exported model and installed kit tarball without checkout imports',async()=>{
 const tool=path.join(root,'models/qwen3_5/export-browser.mjs');assert.ok(await fs.stat(tool).catch(()=>null),'portable browser exporter absent');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qwen-consumer-'));
 try{
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({private:true,type:'module'}));
  const {exportBrowserModule}=await import(pathToFileURL(tool));const result=await exportBrowserModule({out:dir});assert.equal(result.status,'exported');
  for(const output of Object.values(result.bundle.outputs))for(const dependency of output.imports)assert.ok(['@kaminos/webgpu-inference-kit/core','@kaminos/webgpu-inference-kit/generation'].includes(dependency.path),'external checkout import: '+dependency.path);
  const {stdout}=await exec('npm',['pack','--json','--ignore-scripts','--pack-destination',dir],{cwd:path.join(root,'webgpu-inference-kit')});const [packed]=JSON.parse(stdout);
  await exec('npm',['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false',path.join(dir,packed.filename)],{cwd:dir});
  const adapter=await import(pathToFileURL(path.join(dir,'qwen-text.js')));assert.equal(typeof adapter.Qwen35TextModel,'function');assert.equal(typeof adapter.QwenTokenizer,'function');
  const app=path.join(dir,'check.mjs');await fs.writeFile(app,`import {createGenerationSession,sampleToken} from '@kaminos/webgpu-inference-kit/generation';import {createWebGpuInferenceControl} from '@kaminos/webgpu-inference-kit/core';import {createQwenTextChat} from './qwen-text.js';if(typeof createGenerationSession!=='function'||typeof createQwenTextChat!=='function'||typeof createWebGpuInferenceControl!=='function'||sampleToken([1,2],{temperature:0})!==1)throw Error('installed API failed');console.log('installed consumer passed');`);
  assert.match((await exec(process.execPath,[app],{cwd:dir})).stdout,/installed consumer passed/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
