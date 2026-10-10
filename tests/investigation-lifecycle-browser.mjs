import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {mountFluidInvestigation} from '../fluid-investigation.mjs';

const {PLAYWRIGHT_MODULE, BROWSER_EXECUTABLE, EVIDENCE_OUT} = process.env;
assert.ok(PLAYWRIGHT_MODULE && BROWSER_EXECUTABLE && EVIDENCE_OUT,
  'Set PLAYWRIGHT_MODULE, independent BROWSER_EXECUTABLE and caller-owned EVIDENCE_OUT');
const executable = await fs.realpath(BROWSER_EXECUTABLE);
assert.ok(!executable.includes('/Applications/Google Chrome.app/'), 'Use an independent browser');
const {chromium} = await import(pathToFileURL(PLAYWRIGHT_MODULE));
const source = {route: 'synthetic-owner-native-browser-lifecycle', executable};
const guide = {question: 'Lifecycle fixture', tryThis: 'Capture', whyThisMatters: 'Preserve a handback through failures'};
const fixture = `<!doctype html><main id="slot"></main><script>
window.kaminosFluidWorkbenchSetInvestigation = node => document.querySelector('#slot').replaceChildren(node);
window.__presentationResumeCount = 0;
window.kaminosFingerFluidBenchResumeAfterWitness = () => {window.__presentationResumeCount++;};
window.kaminosFingerFluidBenchSessionState = () => ({generation:1,step:47,available:true,paused:true,running:window.__presentationResumeCount > 0});
window.kaminosFingerFluidPressureCockpitState = () => ({requested:{cohesion:12},effective:{cohesion:12}});
window.kaminosNavigationState = () => ({position:[1,2,3],target:[0,0,0],up:[0,1,0]});
window.kaminosSceneAuthoring = {read:() => ({objects:[]})};
window.kaminosSceneEdits = {state:() => ({undoCount:0,redoCount:0,active:null})};
</script>`;
let server, browser, url;
before(async () => {
  await fs.mkdir(EVIDENCE_OUT, {recursive: true});
  await fs.writeFile(path.join(EVIDENCE_OUT, 'source.json'), JSON.stringify(source, null, 2), {flag: 'wx'});
  server = http.createServer(async (req, res) => {
    if (req.url.split('?')[0] === '/index.html') {res.setHeader('content-type', 'text/html'); return res.end(fixture);}
    if (!['/investigation-recording.mjs', '/investigation-guide.mjs'].includes(req.url)) {
      res.writeHead(404); return res.end();
    }
    res.setHeader('content-type', 'text/javascript');
    res.end(await fs.readFile(new URL(`..${req.url}`, import.meta.url)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}/index.html`;
  browser = await chromium.launch({executablePath: executable, headless: true});
});
after(async () => {await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));});
async function mount(t, name) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.goto(url);
  const out = path.join(EVIDENCE_OUT, name);
  const handle = await mountFluidInvestigation({page, out, source, guide});
  return {page, out, handle, report: async () => JSON.parse(await fs.readFile(handle.reportPath))};
}

test('mount restores held-water presentation once without advancing water or redrawing at capture', async t => {
  const f = await mount(t, 'presentation');
  const state = await f.page.evaluate(() => window.kaminosFingerFluidBenchSessionState());
  assert.deepEqual(state, {generation:1,step:47,available:true,paused:true,running:true});
  await f.handle.capture('original displayed frame');
  assert.equal(await f.page.evaluate(() => window.__presentationResumeCount), 1);
  await f.handle.finish('done');
});

test('failed final write freezes visibly, rejects new captures and permits honest retry of the frozen recording', async t => {
  const f = await mount(t, 'write-failure');
  await fs.mkdir(path.join(f.out, 'recording.v8'));
  await assert.rejects(f.handle.finish('keep the detour'), /EEXIST/);
  assert.equal((await f.report()).status, 'finish-failed');
  assert.equal(await f.page.getByRole('button', {name: 'Capture', exact: true}).isDisabled(), true);
  assert.equal(await f.page.getByRole('button', {name: 'Retry Save', exact: true}).isEnabled(), true);
  await assert.rejects(f.handle.capture('later'), /not recording/);
  await f.page.evaluate(async () => {
    const {investigationOperations} = await import('./investigation-recording.mjs');
    investigationOperations.emit({kind: 'camera.pose', phase: 'changed', target: 'camera', effective: [1, 2, 3]});
  });
  await fs.rmdir(path.join(f.out, 'recording.v8'));
  await f.page.getByRole('button', {name: 'Retry Save', exact: true}).click();
  assert.equal((await f.handle.finished).status, 'finished');
  assert.equal((await f.report()).captures.length, 0);
});

test('reload terminates the lost investigation while same-document control URL changes preserve it', async t => {
  const f = await mount(t, 'reload');
  await f.page.evaluate(() => history.replaceState(null, '', '?cohesion=10'));
  await f.handle.capture('before reload');
  assert.equal((await f.report()).status, 'recording');
  await f.page.reload();
  await assert.rejects(f.handle.finished, /replaced|lost/);
  assert.equal((await f.report()).status, 'disconnected');
  assert.equal((await f.report()).captures[0].status, 'retained');
});

test('browser loss during failed final metadata persistence settles the handback and preserves prior captures', async t => {
  const f = await mount(t, 'final-save-loss');
  await f.handle.capture('keep this observation');
  const write = fs.writeFile;
  let injected = false;
  fs.writeFile = async (destination, data, ...rest) => {
    if (destination === `${f.handle.reportPath}.next` && typeof data === 'string'
      && JSON.parse(data).status === 'finished' && !injected) {
      injected = true;
      await browser.close();
      await fs.mkdir(destination);
      try {return await write(destination, data, ...rest);}
      finally {await fs.rmdir(destination);}
    }
    return write(destination, data, ...rest);
  };
  try {await assert.rejects(f.handle.finish('lost during save'));}
  finally {fs.writeFile = write;}
  assert.equal(injected, true);
  assert.equal(f.page.isClosed(), true);
  assert.notEqual((await f.report()).status, 'finish-failed', 'a lost browser cannot offer a live retry');
  await assert.rejects(f.handle.finished, /lost/);
  assert.equal((await f.report()).status, 'disconnected');
  assert.equal((await f.report()).captures[0].status, 'retained');
});
