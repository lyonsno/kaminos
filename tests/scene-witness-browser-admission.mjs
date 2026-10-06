import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
for(const [name,chrome] of [['missing independent browser',null],['installed operator browser','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']]) {
  test('witness rejects '+name+' before launch and preserves a failure report',()=>{
    const dir=mkdtempSync(join(tmpdir(),'bathtub-browser-admission-'));
    const env={...process.env};delete env.KAMINOS_CHROME;if(chrome)env.KAMINOS_CHROME=chrome;
    const report=join(dir,'report.json'),png=join(dir,'frame.png');
    const run=spawnSync(process.execPath,['scene-object-witness.mjs','--debug-port','9497','--report',report,'--out',png],{cwd:new URL('..',import.meta.url),env,encoding:'utf8'});
    assert.notEqual(run.status,0);
    const result=JSON.parse(readFileSync(report,'utf8'));
    assert.equal(result.ok,false);
    assert.equal(result.failurePhase,'validating-browser');
    assert.equal(result.screenshot,null);
    assert.equal(existsSync(png),false);
    assert.match(result.error,/independent/);
  });
}
