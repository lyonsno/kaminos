import fs from 'node:fs/promises';
import {openSync, closeSync} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {fluidBrowserLaunch} from './finger-fluid-browser-launch.mjs';
import {bindFluidWorkingSession} from './fluid-working-session.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['index.html', 'fluid-working-session.mjs', 'finger-fluid-webgpu-core.js',
  'fluid-viewport-host.mjs', 'finger-fluid-pressure-controls.mjs', 'finger-fluid-pressure-cockpit.mjs'];
async function json(url) {
  const response = await fetch(url);
  assert.ok(response.ok, `HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function fluidSourceIdentity(url, repo) {
  const origin = new URL(url).origin;
  const config = await json(`${origin}/api/runtime-config`);
  assert.equal(await fs.realpath(config.source.repoRoot), await fs.realpath(repo), 'Fluid server checkout mismatch');
  const bodies = {};
  for (const file of sources) {
    const response = await fetch(`${origin}/${file}`);
    assert.ok(response.ok, `Missing fluid source: ${file}`);
    const hash = sha(Buffer.from(await response.arrayBuffer()));
    assert.equal(hash, sha(await fs.readFile(path.join(repo, file))), `Fluid served source mismatch: ${file}`);
    bodies[file] = hash;
  }
  return {repo: await fs.realpath(repo), source: config.source, bodies,
    stores: Object.fromEntries(Object.entries(config).filter(([key]) => key.endsWith('Store')))};
}

// The browser itself is the continuing runtime. This file is its caller-owned
// attachment descriptor; no extra daemon or scene store is introduced.
export async function openFluidBrowser({sessionFile, url, repo, executable, playwrightModule, viewport = {width: 1440, height: 900}}) {
  sessionFile = path.resolve(sessionFile);
  await fs.mkdir(path.dirname(sessionFile), {recursive: true});
  const lock = await fs.open(sessionFile, 'wx'); await lock.close();
  const descriptor = {schema: 'kaminos.fluid-working-session.v1', status: 'starting', url, repo,
    playwrightModule, viewport, createdAt: new Date().toISOString()};
  const save = () => fs.writeFile(sessionFile, JSON.stringify(descriptor, null, 2));
  let child, browser;
  try {
    await save();
    descriptor.source = await fluidSourceIdentity(url, repo);
    descriptor.profile = await fs.mkdtemp(path.join(path.dirname(sessionFile), 'fluid-browser-'));
    const launch = fluidBrowserLaunch({executable, debugPort: 0, userDataDir: descriptor.profile, ...viewport});
    descriptor.executable = launch.executable;
    const stderr = openSync(path.join(descriptor.profile, 'stderr.log'), 'a');
    try {
      child = spawn(launch.executable, [...launch.args, '--headless=new', '--enable-unsafe-webgpu', '--use-angle=metal'],
        {detached: true, stdio: ['ignore', stderr, stderr]});
    } finally {closeSync(stderr);}
    let launchError;
    child.on('error', error => {launchError = error;});
    descriptor.pid = child.pid; await save();
    let active;
    while (!active) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode) throw Error('Owned fluid browser exited during launch');
      try {active = await fs.readFile(path.join(descriptor.profile, 'DevToolsActivePort'), 'utf8');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
      if (!active) await delay(100);
    }
    const [port, endpoint] = active.trim().split('\n');
    descriptor.endpoint = `http://127.0.0.1:${port}`;
    descriptor.browserEndpoint = endpoint;
    await save();
    const version = await json(`${descriptor.endpoint}/json/version`);
    assert.ok(version.webSocketDebuggerUrl.endsWith(endpoint), 'Owned browser endpoint mismatch');
    const {chromium} = await import(pathToFileURL(path.resolve(playwrightModule)));
    browser = await chromium.connectOverCDP(descriptor.endpoint, {timeout: 0});
    descriptor.browserVersion = browser.version();
    const context = browser.contexts()[0];
    const page = context.pages().find(page => page.url() === 'about:blank');
    assert.ok(page, 'Owned initial page missing');
    page.setDefaultTimeout(0); page.setDefaultNavigationTimeout(0);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__fluidSessionErrors = [];
      window.addEventListener('error', event => window.__fluidSessionErrors.push(event.message));
      window.addEventListener('unhandledrejection', event => window.__fluidSessionErrors.push(String(event.reason)));
    });
    await page.goto(url);
    await page.waitForFunction(() => window.kaminosFingerFluidBenchSessionState?.().available
      || window.kaminosFingerFluidBenchDebugState?.().status === 'error'
      || window.__fluidSessionErrors?.length);
    const errors = await page.evaluate(() => window.__fluidSessionErrors);
    assert.deepEqual(errors, [], 'Fluid startup errors');
    const session = await bindFluidWorkingSession(page);
    await session.hold();
    descriptor.binding = session.id;
    descriptor.url = page.url();
    descriptor.status = 'held';
    await save();
    child.unref();
    return {browser, page, session, descriptor};
  } catch (error) {
    descriptor.status = 'failed'; descriptor.failure = String(error.stack || error);
    await save();
    await browser?.close();
    if (child && child.exitCode === null && !child.signalCode) {
      await new Promise(resolve => {child.once('exit', resolve); child.kill('SIGTERM');});
    }
    throw error;
  }
}

async function ownedBrowser(sessionFile) {
  const descriptor = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
  assert.equal(descriptor.status, 'held', 'Fluid session is not attachable');
  const active = (await fs.readFile(path.join(descriptor.profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  assert.equal(descriptor.endpoint, `http://127.0.0.1:${active[0]}`);
  assert.equal(descriptor.browserEndpoint, active[1]);
  const version = await json(`${descriptor.endpoint}/json/version`);
  assert.ok(version.webSocketDebuggerUrl.endsWith(descriptor.browserEndpoint), 'Fluid browser was replaced');
  const {chromium} = await import(pathToFileURL(path.resolve(descriptor.playwrightModule)));
  const browser = await chromium.connectOverCDP(descriptor.endpoint, {timeout: 0});
  return {browser, descriptor};
}

export async function attachFluidBrowser(sessionFile) {
  const {browser, descriptor} = await ownedBrowser(sessionFile);
  try {
    const identity = await fluidSourceIdentity(descriptor.url, descriptor.repo);
    assert.deepEqual(identity, descriptor.source, 'Fluid source/store identity changed; attach requires the original source');
    let selected;
    for (const page of browser.contexts().flatMap(context => context.pages())) {
      if (new URL(page.url()).origin !== new URL(descriptor.url).origin) continue;
      if (await page.evaluate(id => window.__kaminosFluidWorkingSessions?.has(id) === true, descriptor.binding)) {
        assert.ok(!selected, 'Fluid session page identity is ambiguous'); selected = page;
      }
    }
    assert.ok(selected, 'Held fluid page expired; a new page would be different water');
    selected.setDefaultTimeout(0); selected.setDefaultNavigationTimeout(0);
    await selected.setViewportSize(descriptor.viewport);
    const session = await bindFluidWorkingSession(selected, {id: descriptor.binding});
    descriptor.currentUrl = selected.url();
    return {browser, page: selected, session, descriptor};
  } catch (error) {await browser.close(); throw error;}
}

export async function closeFluidBrowser(sessionFile) {
  const connection = await ownedBrowser(sessionFile);
  const cdp = await connection.browser.newBrowserCDPSession();
  try {await cdp.send('Browser.close');}
  catch (error) {if (!/closed|disconnect/i.test(String(error))) throw error;}
  await connection.browser.close();
  connection.descriptor.status = 'closed';
  connection.descriptor.closedAt = new Date().toISOString();
  await fs.writeFile(sessionFile, JSON.stringify(connection.descriptor, null, 2));
}
