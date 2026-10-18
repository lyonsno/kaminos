import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync, realpathSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, i, all) => i % 2 ? rows : [...rows, [value.replace(/^--/, ''), all[i + 1]]], []));
const out = resolve(args.out); mkdirSync(out, {recursive: true});
const report = {status: 'running', phase: 'inputs', requested: args, captures: [], errors: []};
const persist = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
let context, page;
persist();
try {
  const {chromium} = await import(args.playwright);
  const executable = realpathSync(args.chrome);
  assert.ok(!executable.includes('/Applications/Google Chrome.app/'), 'Independent test browser required');
  report.executable = executable; report.profile = mkdtempSync(join(tmpdir(), 'minion-setup-browser-'));
  context = await chromium.launchPersistentContext(report.profile, {executablePath: executable, headless: true,
    viewport: {width: 1440, height: 1000}, args: ['--use-mock-keychain', '--password-store=basic', '--no-first-run']});
  page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
  report.consoleErrors=[];page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  const setup = JSON.parse(readFileSync(args.setup));
  report.input = setup;
  const url = new URL(args.base); url.searchParams.set('workspace', 'workbench'); url.searchParams.set('experiment', 'marionette/walking-creature'); url.searchParams.set('experiment_inputs', JSON.stringify(setup));
  report.phase = 'load'; await page.goto(url.href, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.kaminosWalkingSetup && window.kaminosWalkingCreature);
  report.route = page.url(); report.runtime = await page.evaluate(async () => (await fetch('/api/runtime-config')).json());
  assert.equal(report.runtime.source.repoRoot, realpathSync(args.root));
  report.sources = [];
  for (const file of ['index.html', 'retained-setup.mjs', 'retained-setup-controls.mjs', 'scene-setup-projection.mjs', 'experiments/creature-motion/setup-projection.mjs', 'experiments/creature-motion/walking.experiment.mjs']) {
    const response = await page.request.get(new URL(file, url).href); assert.equal(response.status(), 200);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const sha = hash(await response.body()); assert.equal(sha, hash(readFileSync(join(args.root, file)))); report.sources.push({file, sha});
  }
  const read = () => page.evaluate(() => window.kaminosWalkingCreature({geometry: false}));
  const capture = async name => {
    await page.screenshot({path: join(out, name + '.png')}); report.captures.push(name + '.png');
  };
  report.initial = await read();
  await page.getByRole('button',{name:'Full',exact:true}).click();
  report.lighting=await page.evaluate(()=>{
    const enabled=document.getElementById('rim-enabled');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));
    return window.kaminosSceneLightState();
  });
  report.phase = 'live-edits';
  await page.evaluate(async () => {
    await window.kaminosWorkbenchExperiments.invoke('rate', {rate: 2});
    await window.kaminosWorkbenchExperiments.invoke('seek', {frame: 20});
    window.kaminosFrameSelected();
  });
  report.observed = await read();
  report.observedBones=await page.evaluate(()=>window.kaminosWalkingCreature().boneWorld);
  await page.getByRole('button', {name: 'Keep in Setup', exact: true}).click();
  await page.getByLabel('Start at current location', {exact: true}).check();
  await capture('keep-desktop');
  await page.evaluate(() => window.kaminosWorkbenchExperiments.invoke('seek', {frame: 40}));
  await page.getByRole('button', {name: 'Keep', exact: true}).click();
  report.retained = await page.evaluate(() => window.kaminosWalkingSetup.read());
  assert.equal(report.retained.document.rate, 2); assert.equal(report.retained.document.sample, 0);
  assert.equal((await read()).playback.frame, 40, 'Keep changed the live frame');
  await page.locator('.creature-properties .retained-setup > details > summary').click();
  await page.getByRole('button', {name: 'Undo setup edit', exact: true}).click();
  assert.equal(await page.evaluate(() => window.kaminosWalkingSetup.read().document.rate), report.initial.rate);
  await page.getByRole('button', {name: 'Redo setup edit', exact: true}).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Download setup', exact: true}).click();
  await (await downloaded).saveAs(join(out, 'retained-creature.json'));
  assert.deepEqual(JSON.parse(readFileSync(join(out, 'retained-creature.json'))), report.retained.document);
  const beforeId = (await read()).host.id;
  report.phase = 'begin-again'; await page.getByRole('button', {name: 'Begin again', exact: true}).click();
  await page.waitForFunction(id => typeof window.kaminosWalkingCreature === 'function' && Boolean(window.kaminosWalkingCreature({geometry:false}).host.id) && window.kaminosWalkingCreature({geometry:false}).host.id !== id, beforeId);
  report.reopened = await read(); assert.equal(report.reopened.rate, 2); assert.equal(report.reopened.playback.frame, 0);
  report.reopenedBones=await page.evaluate(()=>window.kaminosWalkingCreature().boneWorld);
  const rootName=report.observedBones[0].name;
  const beforeRoot=report.observedBones[0].matrix,afterRoot=report.reopenedBones.find(b=>b.name===rootName).matrix;
  for(const i of [12,13,14])assert.ok(Math.abs(beforeRoot[i]-afterRoot[i])<1e-5,'Starting location changed');
  await capture('reopened-desktop');
  report.phase = 'mobile'; await page.setViewportSize({width: 390, height: 844});
  await page.getByRole('button', {name: 'Keep in Setup', exact: true}).click();
  const bounds = await page.getByRole('dialog').boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  await capture('keep-mobile'); await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[], 'Browser rendering errors invalidate visual acceptance');report.status = 'passed'; report.phase = 'complete';
} catch (e) {
  report.status = 'failed'; report.error = {message: e.message, stack: e.stack};
  if (page) { try { await page.screenshot({path: join(out, 'failure.png')}); report.failureText = await page.locator('body').innerText(); } catch {} }
  process.exitCode = 1;
} finally { if (context) { await context.close(); report.browserClosed = true; } persist(); }
