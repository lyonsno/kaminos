// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
test('fit admission failures retain a terminal report before importing GPU or reading source inputs',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-fit-admission-'));
 try{const env={...process.env};delete env.GREENROOM_JOB_ID;const run=spawnSync(process.execPath,[new URL('../tools/trellis-material-fit.mjs',import.meta.url).pathname,'missing-config.json',dir],{encoding:'utf8',env});assert.equal(run.status,1);const r=JSON.parse(await fs.readFile(path.join(dir,'report.json')));assert.equal(r.status,'failed');assert.equal(r.phase,'admission');assert.match(r.error,/Greenroom admission/);assert.equal(r.checkpoints.length,0);}
 finally{await fs.rm(dir,{recursive:true,force:true});}
});

import {materialFrameVector} from '../trellis-training-source.mjs';
import {supportFrame,worldPoint} from '../trellis-local-support.mjs';
test('material frame preserves handedness and source positions on an oblique support',()=>{
 const f=supportFrame({origin:[2,3,4],normal:[0,1,1],tangent:[1,0,0],radius:.25,depth:.1});
 const close=(a,b)=>a.forEach((v,k)=>assert.ok(Math.abs(v-b[k])<1e-12));
 close(materialFrameVector(worldPoint([.2,.3,.4],f),f,{point:true}),[.05,.1,-.075]);
 close(materialFrameVector(f.u,f),[1,0,0]);close(materialFrameVector(f.n,f),[0,1,0]);close(materialFrameVector(f.v.map(x=>-x),f),[0,0,1]);
});
