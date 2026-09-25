// Reuse a witnessed SF3D GLB without rerunning inference: import it through
// the cockpit, Save As, and reopen the authored kiln with ordinary flame.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { judgeSf3dSmoke } from './sf3d-host-device.mjs';
import { verifyAuthoringServer } from './scene-authoring-witness-identity.mjs';

const args = process.argv.slice(2);
const arg = name => args[args.indexOf(name) + 1];
for (const flag of ['--url', '--out', '--puppeteer', '--inference-report']) {
  if (!args.includes(flag)) throw new Error(`required ${flag}`);
}
const out = path.resolve(arg('--out'));
fs.mkdirSync(out, { recursive: true });
const report = { schema: 'kaminos.sf3d-kiln-save-reopen.v0', ok: false, phase: 'prior-report',
  requestedUrl: arg('--url'), inferenceReport: path.resolve(arg('--inference-report')), events: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
let browser;
let page;
save();
try {
  const prior = JSON.parse(fs.readFileSync(report.inferenceReport, 'utf8'));
  if (prior.ok !== true || prior.phase !== 'terminal' || !prior.output?.result?.presentation?.source) {
    throw new Error('save/reopen requires a successful witnessed generated-mesh presentation');
  }
  const generatedSource = prior.output.result.presentation.source;
  const requestedUrl = new URL(report.requestedUrl);
  const sourceSceneFile = new URLSearchParams(requestedUrl.hash.slice(1)).get('scene');
  if (!sourceSceneFile || requestedUrl.searchParams.get('preset') !== prior.expectedScene.presetId) {
    throw new Error('save/reopen route does not match the inference witness basin');
  }
  report.generatedSource = generatedSource;
  report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  report.phase = 'serving-identity'; save();
  report.serving = await verifyAuthoringServer({ origin: requestedUrl.origin, repoRoot: process.cwd() });
  const sourceSceneUrl = new URL(`/api/read?${new URLSearchParams({ root: 'scenes', path: sourceSceneFile })}`, requestedUrl.origin);
  const sourceSceneResponse = await fetch(sourceSceneUrl, { cache: 'no-store' });
  if (!sourceSceneResponse.ok) throw new Error(`source scene HTTP ${sourceSceneResponse.status}`);
  const sourceSceneBytes = Buffer.from(await sourceSceneResponse.arrayBuffer());
  const sourceSceneHash = createHash('sha256').update(sourceSceneBytes).digest('hex');
  const sourceDocument = JSON.parse(sourceSceneBytes.toString('utf8'));
  const original = { file: sourceSceneFile, presetId: prior.expectedScene.presetId, modelSource: sourceDocument.model?.source };
  if (!original.modelSource || sourceDocument.composition?.flame?.presetId !== original.presetId ||
      !sourceDocument.objects?.some(row => row.source === original.modelSource)) {
    throw new Error('source scene lacks the authored kiln or witnessed flame basin');
  }
  const kilnResponse = await fetch(new URL(original.modelSource, requestedUrl.origin), { cache: 'no-store' });
  const priorKilnResponse = await fetch(new URL(prior.expectedScene.modelSource, requestedUrl.origin), { cache: 'no-store' });
  if (!kilnResponse.ok || !priorKilnResponse.ok) throw new Error('kiln source bytes unavailable');
  const kilnHash = createHash('sha256').update(Buffer.from(await kilnResponse.arrayBuffer())).digest('hex');
  const priorKilnHash = createHash('sha256').update(Buffer.from(await priorKilnResponse.arrayBuffer())).digest('hex');
  if (kilnHash !== priorKilnHash) throw new Error('kiln source differs from the inference witness');
  report.original = original;
  report.sourceSceneSha256 = sourceSceneHash;
  report.kilnSha256 = kilnHash;
  const generatedResponse = await fetch(new URL(generatedSource, requestedUrl.origin), { cache: 'no-store' });
  if (!generatedResponse.ok) throw new Error(`generated GLB HTTP ${generatedResponse.status}`);
  const generatedBytes = Buffer.from(await generatedResponse.arrayBuffer());
  if (createHash('sha256').update(generatedBytes).digest('hex') !== prior.output.result.glbSha256) {
    throw new Error('generated GLB bytes differ from the inference witness');
  }
  report.generatedBytes = generatedBytes.byteLength; save();
  const { default: puppeteer } = await import(pathToFileURL(path.resolve(arg('--puppeteer'))).href);
  report.phase = 'browser-launch'; save();
  browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: false, protocolTimeout: 0,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-first-run',
      '--no-default-browser-check', '--window-size=1400,1000'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(0);
  page.on('pageerror', error => { report.events.push({ kind: 'pageerror', message: error.message }); save(); });
  page.on('response', response => {
    if (response.status() >= 500) { report.events.push({ kind: 'http-error', status: response.status(), url: response.url() }); save(); }
  });
  report.phase = 'original-scene-load'; save();
  await page.goto(requestedUrl.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(source => window.kaminosSceneObjectDebugState?.().some(row => row.source === source), {}, original.modelSource);
  await page.waitForFunction(() => window.__kaminosVolumePrototype?.debugState?.().active &&
    window.__kaminosVolumePrototype.debugState().frameCount >= 3);
  report.originalObjects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
  await page.screenshot({ path: path.join(out, 'before-import.png') });
  report.phase = 'generated-mesh-import'; save();
  await page.evaluate(() => document.querySelectorAll('[data-tab="greenroom"]')[0]?.click());
  await page.waitForSelector('#greenroom-root-buttons .env-btn');
  const rootSelected = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#greenroom-root-buttons .env-btn')]
      .find(candidate => candidate.textContent.trim() === 'generated-meshes');
    button?.click();
    return Boolean(button);
  });
  if (!rootSelected) throw new Error('generated-meshes root missing from cockpit');
  const generatedName = new URL(generatedSource, requestedUrl.origin).searchParams.get('path');
  await page.waitForFunction(name => [...document.querySelectorAll('#greenroom-list .gr-entry')]
    .some(row => row.textContent.includes(name) && [...row.querySelectorAll('button')].some(button => button.textContent === 'Import')),
  {}, generatedName);
  const imported = await page.evaluate(name => {
    const row = [...document.querySelectorAll('#greenroom-list .gr-entry')].find(candidate => candidate.textContent.includes(name));
    const button = [...row.querySelectorAll('button')].find(candidate => candidate.textContent === 'Import');
    button.click();
    return Boolean(button);
  }, generatedName);
  if (!imported) throw new Error('generated-mesh Import action missing');
  await page.waitForFunction(source => window.kaminosSceneObjectDebugState?.().some(row => row.source === source), {}, generatedSource);
  report.importedObjects = await page.evaluate(() => window.kaminosSceneObjectDebugState());
  const editedObject = await page.evaluate(source => {
    const row = window.kaminosSceneObjectDebugState().find(candidate => candidate.source === source);
    if (!row) throw new Error('generated object absent after import');
    const before = row.transform.position;
    const after = [before[0] + 0.25, before[1], before[2]];
    const edited = window.kaminosSetSceneObjectTransform(row.id, { position: after });
    return { originalPosition: before, editedPosition: edited.transform.position };
  }, generatedSource);
  report.editedObject = editedObject;
  await page.screenshot({ path: path.join(out, 'after-import.png') });
  report.phase = 'save-as'; save();
  let saveResponse = null;
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/save-scene') saveResponse = response; });
  const saveSucceeded = await page.evaluate(() => window.saveSceneAs());
  if (!saveSucceeded || !saveResponse) throw new Error('cockpit Save As did not return a scene receipt');
  const saved = await saveResponse.json();
  if (!saveResponse.ok() || !saved.saved || saved.saved === original.file) throw new Error(`invalid Save As receipt: ${JSON.stringify(saved)}`);
  report.savedSceneFile = saved.saved; save();
  const sourceAfterResponse = await fetch(sourceSceneUrl, { cache: 'no-store' });
  if (!sourceAfterResponse.ok) throw new Error(`source scene after Save As HTTP ${sourceAfterResponse.status}`);
  const sourceAfterHash = createHash('sha256').update(Buffer.from(await sourceAfterResponse.arrayBuffer())).digest('hex');
  report.sourceSceneSha256After = sourceAfterHash;
  if (sourceAfterHash !== sourceSceneHash) throw new Error('Save As mutated the source scene');
  const savedResponse = await fetch(new URL(`/api/read?${new URLSearchParams({ root: 'scenes', path: saved.saved })}`, requestedUrl.origin), { cache: 'no-store' });
  if (!savedResponse.ok) throw new Error(`saved scene HTTP ${savedResponse.status}`);
  const savedDocument = await savedResponse.json();
  const savedSources = savedDocument.objects?.map(row => row.source) || [];
  const savedPresetId = savedDocument.composition?.flame?.presetId;
  if (!savedPresetId || !savedSources.includes(original.modelSource) || !savedSources.includes(generatedSource)) {
    throw new Error('saved scene lost the kiln, generated mesh, or flame basin');
  }
  report.phase = 'reopen'; save();
  const reopenUrl = new URL(requestedUrl.href);
  reopenUrl.searchParams.set('preset', savedPresetId);
  const hash = new URLSearchParams(reopenUrl.hash.slice(1));
  hash.set('scene', saved.saved);
  reopenUrl.hash = hash.toString();
  report.reopenUrl = reopenUrl.href; save();
  await page.goto(reopenUrl.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(sources => {
    const actual = window.kaminosSceneObjectDebugState?.().map(row => row.source) || [];
    return sources.every(source => actual.includes(source));
  }, {}, [original.modelSource, generatedSource]);
  await page.waitForFunction(() => window.__kaminosVolumePrototype?.debugState?.().active &&
    window.__kaminosVolumePrototype.debugState().frameCount >= 3);
  const flameBefore = await page.evaluate(() => window.__kaminosVolumePrototype.debugState().frameCount);
  await new Promise(resolve => setTimeout(resolve, 1500));
  const flameAfter = await page.evaluate(() => window.__kaminosVolumePrototype.debugState().frameCount);
  report.reopenEvidence = await page.evaluate(() => ({
    reopenedSources: window.kaminosSceneObjectDebugState?.().map(row => row.source) || [],
    reopenedPresetId: window.__kaminosVolumeSettingsPresetReceipt?.presetId || null,
    reopenedStatus: document.getElementById('composition-status')?.textContent || null,
  }));
  const reopenedPosition = await page.evaluate(source => window.kaminosSceneObjectDebugState?.()
    .find(row => row.source === source)?.transform.position || null, generatedSource);
  Object.assign(report.reopenEvidence, { savedSceneFile: saved.saved, savedSources, savedPresetId, flameBefore, flameAfter,
    sourceUnchanged: true, ...editedObject, reopenedPosition });
  await page.screenshot({ path: path.join(out, 'reopened.png') });
  report.errors = judgeSf3dSmoke({ ...prior.output.result, sceneEvidence: prior.sceneEvidence,
    reopenEvidence: report.reopenEvidence }, { expectedScene: prior.expectedScene,
      expectedReopen: { generatedSource, kilnSource: original.modelSource } });
  if (report.events.some(event => event.kind === 'pageerror')) report.errors.push('browser page error');
  report.ok = report.errors.length === 0;
  report.phase = 'terminal'; save();
  if (!report.ok) process.exitCode = 1;
} catch (error) {
  report.error = { message: error.message, stack: error.stack };
  report.failurePhase = report.phase;
  process.exitCode = 1;
  save();
  if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
} finally {
  if (browser) await browser.close().catch(error => { report.closeError = String(error); process.exitCode = 1; });
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ ok: report.ok, phase: report.phase, error: report.error, report: path.join(out, 'report.json') }, null, 2));
}
