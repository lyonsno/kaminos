import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {startWitnessServer} from '../tools/witness-server.mjs';
test('capture-owned server starts at dispatch and closes only its exact child',async()=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-owned-server-'));
  const server=await startWitnessServer({repoRoot:path.resolve(import.meta.dirname,'..'),output,requestedUrl:'http://127.0.0.1:1/index.html?experiment=live-log-heat'});
  assert.equal(new URL(server.url).searchParams.get('experiment'),'live-log-heat');assert.notEqual(new URL(server.url).port,'1');
  assert.equal((await fetch(server.url)).status,200);assert.ok(server.evidence.pid);
  await server.stop();await assert.rejects(fetch(server.url));
});
test('server launch rejection leaves logs and never starts a browser',async()=>{
  const output=await fs.mkdtemp(path.join(os.tmpdir(),'sinter-server-failure-'));
  await assert.rejects(startWitnessServer({repoRoot:path.resolve(import.meta.dirname,'..'),output,python:'/missing-python'}),/before HTTP availability/);
  await fs.access(path.join(output,'server.stderr.log'));
});
