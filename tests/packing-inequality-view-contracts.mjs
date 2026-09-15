import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('trajectory view consumes selected carrier without requiring intercept diagnostic',async()=>{
  const input=await mkdtemp(path.join(tmpdir(),'packing-view-input-'));
  const output=await mkdtemp(path.join(tmpdir(),'packing-view-output-'));
  const archived='artifacts/packing-inequality-comparison-0915/raw-r2/';
  await copyFile(archived+'start.json',path.join(input,'start.json'));
  await copyFile(archived+'baseline-state.json',path.join(input,'selected.json'));
  const proc=spawnSync(process.execPath,['tools/render-packing-inequality-comparison.mjs',input,output,'trajectory'],{encoding:'utf8'});
  assert.equal(proc.status,0,proc.stderr);
  const data=JSON.parse(await readFile(path.join(output,'display-data.json'),'utf8'));
  const selected=JSON.parse(await readFile(path.join(input,'selected.json'),'utf8'));
  assert.equal(data.states.length,2);
  assert.equal(data.states[1].carrierSha256,selected.carrier.identity.sha256);
  assert.deepEqual(data.states[1].cages[0].positions,selected.carrier.cages[0].manifest.nodes.map(n=>n.currentPosition));
  assert.notEqual(data.route,'experimental-packing-inequality-comparison-v0');
});
