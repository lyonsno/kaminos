// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {parseAppHostArgs} from '../serve.mjs';

test('CLI requires the effective repo root and preserves explicit store/model paths',()=>{
  assert.throws(()=>parseAppHostArgs([]),/repo-root/);
  assert.throws(()=>parseAppHostArgs(['--repo-root','.','--mystery','value']),/Unknown/);
  const options=parseAppHostArgs(['--repo-root','/chosen/app','--state-root','/chosen/state','--sam3-packet-root','/chosen/sam','--port','0','--root','image-inbox=/chosen/images']);
  assert.equal(options.repoRoot,'/chosen/app');assert.equal(options.stateRoot,'/chosen/state');
  assert.equal(options.sam3PacketRoot,'/chosen/sam');assert.equal(options.port,0);
  assert.equal(options.roots['image-inbox'],'/chosen/images');
});

test('failure before listening retains its caller-selected report and cannot say listening',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'kaminos-node-cli-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const report=join(dir,'failure.json');
  await assert.rejects(promisify(execFile)(process.execPath,[fileURLToPath(new URL('../serve.mjs',import.meta.url)),'--repo-root',join(dir,'missing'),'--state-root',join(dir,'state'),'--startup-report',report]),error=>error.code===1);
  const result=JSON.parse(await readFile(report,'utf8'));
  assert.equal(result.status,'failed');assert.equal(result.failurePhase,'configuration');assert.match(result.error,/ENOENT/);
  assert.equal(result.requested.includes('--startup-report'),true);
});
