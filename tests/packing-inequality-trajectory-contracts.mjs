import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('invalid authored variant leaves current failure report rather than stale success',async()=>{
  const out=await mkdtemp(path.join(tmpdir(),'packing-trajectory-failure-'));
  await writeFile(path.join(out,'result.json'),JSON.stringify({status:'complete',runId:'stale'}));
  const proc=spawnSync(process.execPath,['tools/packing-inequality-trajectory.mjs',out,'unused-python','not-a-variant','8'],{encoding:'utf8'});
  assert.notEqual(proc.status,0);
  const report=JSON.parse(await readFile(path.join(out,'result.json'),'utf8'));
  assert.equal(report.status,'failed');
  assert.equal(report.phase,'validate-invocation');
  assert.match(report.error,/variant/);
  assert.notEqual(report.runId,'stale');
});
