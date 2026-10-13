// kaminos-test: node
// Synthetic local error handling only; this does not establish browser/GPU behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,execFileSync} from 'node:child_process';

test('listener rejection leaves a terminal source-identified report before browser launch',()=>{
  const root=mkdtempSync(join(tmpdir(),'kaminos-capture-listen-test-'));
  const source=join(root,'source'),out=join(root,'evidence');
  mkdirSync(join(source,'tools'),{recursive:true});
  for(const name of ['volume-core.js','volume-reactant-combustion.mjs','volume-outer-smoke.mjs','volume-passive-material.mjs','tools/joined-material-consumer-browser.mjs','tools/joined-material-consumer-capture.mjs'])writeFileSync(join(source,name),'// synthetic source identity fixture\n');
  execFileSync('git',['init','--quiet',source]);
  execFileSync('git',['-c','user.name=Capture Fixture','-c','user.email=capture-fixture@example.invalid','commit','--quiet','--allow-empty','-m','Synthetic identity fixture'],{cwd:source});
  const browser=join(root,'chromium-fixture');writeFileSync(browser,'not a browser; must never launch');
  const preload=join(root,'deny-listen.mjs');
  writeFileSync(preload,`import {Server} from 'node:http';
Server.prototype.listen=function(){queueMicrotask(()=>this.emit('error',Object.assign(new Error('synthetic listener denied'),{code:'EPERM'})));return this;};\n`);
  const runner=fileURLToPath(new URL('../tools/joined-material-consumer-capture.mjs',import.meta.url));
  const child=spawnSync(process.execPath,['--import',preload,runner,source,source,out,browser],{encoding:'utf8'});
  const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
  assert.equal(child.status,1,child.stderr);
  assert.equal(report.status,'failed','listener error must not strand the report as running');
  assert.equal(report.phase,'listener-start');
  assert.match(report.error,/synthetic listener denied/);
  assert.ok(report.finishedAt);
  assert.equal(report.sources.fine.root,source);
  assert.equal(report.browser.executable,realpathSync(browser));
  assert.equal(report.browser.pid,undefined,'no browser may launch after rejected listener');
});
