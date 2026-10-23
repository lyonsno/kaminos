// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('whole-object witness rejects a fallback backend and preserves the observed route',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'splat-route-'));
 try{
  const driver=path.join(dir,'driver.mjs');
  fs.writeFileSync(driver,`let representation='surfels';const inputs={url:'asset.glb',surfelFactor:4};const state=()=>({factor:4,representation,source:inputs.url,surfels:{count:111189,sourceCount:1428273},splats:{count:111189,sourceCount:1428273,route:'deferred-surface-splats',updates:1}});globalThis.window={kaminosWorkbenchExperiments:{read:state,invoke(op,arg){if(op==='setRepresentation')representation=arg;return state();}},kaminosWorkbenchSceneState:()=>({rendererBackend:'webgl',adapter:null})};const page={on(){},goto(){},waitForFunction(){},waitForTimeout(){},screenshot(){},getByLabel(){return {selectOption(){}}},request:{get:async()=>({json:async()=>({source:{commit:'fixture',dirty:false}})})},evaluate:async(fn,arg)=>fn(arg)};export const chromium={launch:async()=>({newPage:async()=>page,close(){}})};`);
  const out=path.join(dir,'out'),url='http://fixture.invalid/?experiment_inputs='+encodeURIComponent(JSON.stringify({url:'asset.glb'}));
  const run=spawnSync(process.execPath,['tools/deferred-glass-witness.mjs',url,out,'fixture','fixture-browser',driver,'--triage'],{encoding:'utf8'});
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  assert.equal(report.ok,false,'fallback captures must not satisfy the native witness');assert.equal(run.status,1);assert.equal(report.scene.rendererBackend,'webgl');assert.match(report.error,/webgpu|native/i);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
