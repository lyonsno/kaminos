import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fluidSourceIdentity, attachFluidBrowser, closeFluidBrowser} from '../fluid-session-browser.mjs';

// Local transport fixture; the separately retained native run establishes CDP behavior.
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fluid-attachment-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const repo = path.resolve('.'), id = 'held-water';
  let wrongSource = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/json/version') return res.end(JSON.stringify({webSocketDebuggerUrl: 'ws://local/devtools/browser/owned'}));
    if (req.url === '/api/runtime-config') return res.end(JSON.stringify({source: {repoRoot: wrongSource ? root : repo}}));
    try {res.end(await fs.readFile(path.join(repo, req.url.slice(1))));}
    catch {res.writeHead(404); res.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port, endpoint = `http://127.0.0.1:${port}`;
  const initialUrl = `${endpoint}/index.html?cohesion=20`;
  let viewport, closed = false, disconnected = false, expired = false;
  const page = {
    url: () => `${endpoint}/index.html?cohesion=10`,
    evaluate: async (fn, arg) => typeof arg === 'string' ? (expired ? false : arg) : undefined,
    setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
    setViewportSize: async value => {viewport = value;},
  };
  const browser = {contexts: () => [{pages: () => [page]}], close: async () => {disconnected = true;},
    newBrowserCDPSession: async () => ({send: async method => {assert.equal(method, 'Browser.close'); closed = true;}})};
  const key = `fluidFixture${port}`;
  globalThis[key] = browser;
  t.after(() => {delete globalThis[key];});
  const modulePath = path.join(root, 'transport.mjs');
  await fs.writeFile(modulePath, `export const chromium = {connectOverCDP: async () => globalThis[${JSON.stringify(key)}]};`);
  await fs.writeFile(path.join(root, 'DevToolsActivePort'), `${port}\n/devtools/browser/owned\n`);
  const descriptor = {status: 'held', profile: root, endpoint, browserEndpoint: '/devtools/browser/owned',
    url: initialUrl, repo, binding: id, playwrightModule: modulePath, viewport: {width: 1440, height: 900},
    source: await fluidSourceIdentity(initialUrl, repo)};
  const file = path.join(root, 'session.json');
  await fs.writeFile(file, JSON.stringify(descriptor));
  return {file, descriptor, get viewport() {return viewport;}, get closed() {return closed;},
    get disconnected() {return disconnected;}, expire() {expired = true;}, drift() {wrongSource = true;}};
}

test('reattachment follows binding across control URL edits and restores the capture viewport', async t => {
  const f = await fixture(t), connection = await attachFluidBrowser(f.file);
  assert.deepEqual(f.viewport, {width: 1440, height: 900});
  assert.match(connection.descriptor.currentUrl, /cohesion=10/);
  await connection.browser.close();
});

test('changed checkout rejects work but cannot prevent exact owned-browser cleanup', async t => {
  const f = await fixture(t); f.drift(); f.expire();
  await assert.rejects(attachFluidBrowser(f.file), /checkout mismatch/);
  await closeFluidBrowser(f.file);
  assert.equal(f.closed, true);
  assert.equal(JSON.parse(await fs.readFile(f.file)).status, 'closed');
});

test('expired binding rejects work and disconnects its transport', async t => {
  const f = await fixture(t); f.expire();
  await assert.rejects(attachFluidBrowser(f.file), /page expired/);
  assert.equal(f.disconnected, true);
});
