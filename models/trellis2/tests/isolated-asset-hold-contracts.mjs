// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {generateImage} from '../generate-image.mjs';
import {runTrellisAdapter} from '../../../scripts/run-trellis-greenroom-adapter.mjs';

test('isolated asset entry point refuses before configuration or model work and preserves a failure report',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-asset-hold-'));
  try{
    const report=path.join(root,'report.json');
    const result=await generateImage({config:path.join(root,'unused.json'),output:path.join(root,'asset.glb'),report});
    assert.equal(result.ok,false);
    assert.equal(result.phase,'route-policy');
    assert.match(result.error.message,/isolated.*held.*MLX/i);
    assert.equal(result.backend.runtime,null);
    assert.equal(result.commands.length,0);
    assert.equal(JSON.parse(await fs.readFile(report)).phase,'route-policy');
    await assert.rejects(fs.stat(path.join(root,'asset.glb')),/ENOENT/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('retained finishing remains accessible without launching new isolated inference',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-retained-allowed-'));
  try{
    const result=await generateImage({config:path.join(root,'missing.json'),output:path.join(root,'asset.glb'),report:path.join(root,'report.json'),'native-root':path.join(root,'native')});
    assert.equal(result.phase,'configuration');
    assert.match(result.error.message,/ENOENT/);
    assert.equal(result.commands.length,0);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('pipeline front door refuses before submitting an isolated asset to Greenroom',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'trellis-pipeline-hold-'));
  try{
    const report=path.join(root,'report.json');
    const result=await runTrellisAdapter({input:path.join(root,'image.png'),output:path.join(root,'asset.glb'),report});
    assert.equal(result.phase,'route-policy');
    assert.match(result.error.message,/isolated.*held.*MLX/i);
    assert.equal(result.job,undefined);
    assert.equal(result.backend.runtime,null);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
