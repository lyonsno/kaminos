// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {gitSourceIdentity} from '../source-attestation.mjs';
test('real Node Git admission excludes only untracked metadata and retains rename/code evidence',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'trellis-node-source-'));
  const git=(...argv)=>execFileSync('git',argv,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git('init','-q');git('config','user.name','Local contract test');git('config','user.email','test@example.invalid');
  git('config','core.excludesFile','/dev/null');
  fs.writeFileSync(path.join(root,'model.py'),'source=1');git('add','model.py');git('commit','-qm','fixture');
  const before=gitSourceIdentity(root);
  fs.mkdirSync(path.join(root,'nested space'));fs.writeFileSync(path.join(root,'nested space','.DS_Store'),'metadata');
  fs.writeFileSync(path.join(root,'.DS_Store'),'metadata');
  const metadata=gitSourceIdentity(root);
  assert.equal(metadata.commit,before.commit);assert.equal(metadata.dirty,'');
  assert.deepEqual(metadata.ignoredUntrackedMetadata,['.DS_Store','nested space/.DS_Store']);
  assert.match(metadata.statusPorcelain,/\.DS_Store/,'the discarded metadata signal must remain in the receipt');
  fs.writeFileSync(path.join(root,'nested space','weights.bin'),'unknown bytes');
  assert.match(gitSourceIdentity(root).dirty,/weights.bin/);fs.unlinkSync(path.join(root,'nested space','weights.bin'));
  fs.writeFileSync(path.join(root,'model.py'),'changed code');assert.match(gitSourceIdentity(root).dirty,/model.py/);
  git('add','model.py');git('commit','-qm','accepted new fixture');
  // The old pathname is a second NUL-delimited field. Do not mistake it for
  // another status row or hide a tracked rename into a metadata filename.
  fs.unlinkSync(path.join(root,'.DS_Store'));git('mv','model.py','.DS_Store');
  const renamed=gitSourceIdentity(root);
  assert.match(renamed.dirty,/\.DS_Store/);assert.match(renamed.dirty,/model.py/);
});
