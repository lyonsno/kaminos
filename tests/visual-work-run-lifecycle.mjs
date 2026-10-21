// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = path.join(root, 'visual-work-run.mjs');
function start(args) {
  const child = spawn(process.execPath, [runner, ...args], {cwd:root, stdio:['ignore','pipe','pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({code, signal, stdout, stderr}));
  });
  return {child, done};
}

test('ordinary runner owns server startup failure and leaves a terminal receipt', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-work-owned-'));
  try {
    const {done} = start(['--repo',root,'--scene','scene.kaminos.json','--scenes',out,
      '--out',out,'--example',path.join(root,'examples/visual-work/pose-comparison.mjs'),
      '--browser','/unused','--playwright','/unused','--python',path.join(out,'missing-python')]);
    assert.equal((await done).code, 1);
    const launch = JSON.parse(await fs.readFile(path.join(out,'launch.json')));
    assert.equal(launch.phase, 'server-start');
    assert.equal(launch.status, 'failed');
    assert.match(launch.failure, /ENOENT/);
    assert.equal(launch.server.owned, true);
    assert.equal(launch.server.closed, true);
  } finally { await fs.rm(out,{recursive:true,force:true}); }
});

test('SIGTERM closes the owned server and browser and marks an unfinished observation cancelled', async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-work-cancel-'));
  let running;
  try {
    await fs.writeFile(path.join(out,'scene.kaminos.json'), JSON.stringify({objects:[]}));
    const fake = path.join(out,'playwright.mjs');
    await fs.writeFile(fake, `import fs from 'node:fs/promises';
      import {EventEmitter} from 'node:events';
      const page = new EventEmitter();
      page.goto = async () => { console.log('fixture-observation-start'); await new Promise(()=>{}); };
      page.screenshot = async () => { throw Error('fixture has no pixels'); };
      export const chromium = {launch:async()=>({version:()=> 'lifecycle-fixture',newPage:async()=>page,
        close:async()=>{await fs.writeFile(${JSON.stringify(path.join(out,'browser-closed'))},'closed');}})};`);
    running = start(['--repo',root,'--scene','scene.kaminos.json','--scenes',out,'--out',out,
      '--example',path.join(root,'examples/visual-work/pose-comparison.mjs'),
      '--browser',process.execPath,'--playwright',fake]);
    const reached = new Promise((resolve,reject) => {
      running.child.stdout.on('data', data => {if (String(data).includes('fixture-observation-start')) resolve();});
      running.done.then(result => reject(Error(`runner exited before observation: ${JSON.stringify(result)}`)));
    });
    await reached;
    running.child.kill('SIGTERM');
    const result = await running.done;
    assert.equal(result.code, 143);
    assert.equal(result.signal, null);
    const launch = JSON.parse(await fs.readFile(path.join(out,'launch.json')));
    assert.equal(launch.status,'cancelled');
    assert.equal(launch.signal,'SIGTERM');
    assert.equal(launch.browserClosed,true);
    assert.equal(launch.server.closed,true);
    assert.throws(()=>process.kill(launch.server.pid,0),{code:'ESRCH'});
    assert.equal(await fs.readFile(path.join(out,'browser-closed'),'utf8'),'closed');
    const report = JSON.parse(await fs.readFile(path.join(out,'report.json')));
    assert.equal(report.status,'cancelled');
    assert.equal(report.phase,'open');
    assert.deepEqual(report.observations,[]);
    assert.equal(report.failureCaptureError,undefined);
  } finally {
    if(running && running.child.exitCode===null && running.child.signalCode===null) {
      running.child.kill('SIGTERM'); await running.done;
    }
    await fs.rm(out,{recursive:true,force:true});
  }
});
