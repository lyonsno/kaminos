import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as evidence from '../tools/fluid-discriminator-evidence.mjs';
test('served source admission includes changed imports and re-exported dependencies',async()=>{
  assert.equal(typeof evidence.collectDiscriminatorSources,'function');
  const root=mkdtempSync(join(tmpdir(),'fluid-discriminator-source-'));
  const files={'view.html':'<script type="module" src="./view.mjs"></script>','view.mjs':"import {x} from './core.mjs';\nexport {y} from './controls.mjs';",'core.mjs':"import './controls.mjs';\nexport const x=1;",'controls.mjs':'export const y=2;'};
  for(const [name,body] of Object.entries(files))writeFileSync(join(root,name),body);
  const closure=evidence.collectDiscriminatorSources(root,['view.html']);assert.deepEqual(closure.map(x=>x.name).sort(),Object.keys(files).sort());
  const response=async url=>new Response(files[new URL(url).pathname.slice(1)]);
  await evidence.verifyDiscriminatorServedSources(closure,'http://localhost',response);
  files['controls.mjs']='export const y=999;';
  await assert.rejects(evidence.verifyDiscriminatorServedSources(closure,'http://localhost',response),/Served source differs: controls.mjs/);
});
test('cleanup preserves the primary failure and records the secondary failure',async()=>{
  assert.equal(typeof evidence.withDiscriminatorCleanup,'function');const report={};
  await assert.rejects(evidence.withDiscriminatorCleanup(async()=>{throw Error('primary native failure');},async()=>{throw Error('secondary browser close');},report),/primary native failure/);
  assert.match(report.cleanupErrors[0],/secondary browser close/);
});
