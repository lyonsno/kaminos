import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const outputDir = path.resolve(value('--output-dir', '/private/tmp/kaminos-sf3d-learn-lifecycle'));
const baseUrl = value('--url', 'http://127.0.0.1:8179');
const puppeteerPath = value('--puppeteer', '');
const chromePath = value('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const width = Number(value('--width', '1440'));
const height = Number(value('--height', '900'));
const featureReplay = value('--feature-replay', '');
const constructionContinuity = args.includes('--construction-continuity');
const featureSample = featureReplay ? JSON.parse(fs.readFileSync(featureReplay, 'utf8')).observations.find(sample => sample.completedBlocks === 12) : null;
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'report.json');
const report = {
  schema: 'kaminos.sf3d-learn-lifecycle.v0', ok: false, phase: 'preflight',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  effective: { baseUrl, width, height, producerRoute: 'synthetic-response-intercept', featureReplay, constructionContinuity, puppeteerPath, chromePath },
  events: [],
};
const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
write();
const fakeProducer = `
let runCount = 0;
let previewCount = 0;
globalThis.__learnFake = { resumeSecond: null };
const mesh = { vertices: new Float32Array([-0.7, -0.5, 0, 0.7, -0.5, 0, 0, 0.7, 0.5]), faces: new Uint32Array([0, 1, 2]) };
export async function decodeSf3dPreviewMesh(...args) {
  if (${constructionContinuity} && runCount === 1) {
    previewCount++;
    await args[6].onSlab({ mesh: { vertices: new Float32Array(), faces: new Uint32Array(), numFaces: 0, numVertices: 0 },
      completedLayers: 6, totalLayers: 33, completedSamples: 6534, totalSamples: 35937, maxZ: -.6 });
    await new Promise(resolve => { globalThis.__learnFake.resumeConstruction = resolve; });
  }
  return { mesh };
}
export async function createSf3dProducer() {
  return {
    device: {},
    async run(_image, { routeOverrides }) {
      runCount += 1;
      if (runCount === 1 && ${JSON.stringify(!!featureSample)}) {
        await routeOverrides.onEncoderFeatures(${JSON.stringify(featureSample)});
        await new Promise(resolve => { globalThis.__learnFake.resumeFeatures = resolve; });
      }
      if (runCount === 2) {
        await new Promise(resolve => { globalThis.__learnFake.resumeSecond = resolve; });
        for (const stageId of routeOverrides.intermediateStageIds) routeOverrides.onIntermediatePreviewError({ stageId, error: new Error('injected preview failure') });
      } else {
        for (const stageId of routeOverrides.intermediateStageIds) await routeOverrides.onIntermediateTriplane({ stageId, triplanesBuf: {}, decoder: {}, decoderWeights: {} });
      }
      return { ...mesh, glb: new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]) };
    },
    dispose() { return { completion: Promise.reject(new Error('injected foreground drain failure')) }; },
  };
}
`;
let browser;
try {
  if (!puppeteerPath || !fs.existsSync(puppeteerPath)) throw new Error('missing Puppeteer module');
  if (!fs.existsSync(chromePath)) throw new Error('missing Chrome');
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  browser = await puppeteer.launch({ executablePath: chromePath, headless: false,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  page.on('pageerror', error => { report.events.push({ type: 'pageerror', message: error.message }); write(); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/lib/sf3d/sf3d-learn-producer.js') {
      request.respond({ status: 200, contentType: 'text/javascript', body: fakeProducer });
    } else request.continue();
  });
  report.phase = 'host-tab'; write();
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.click('[data-tab="learn"]');
  const frame = await (await page.waitForSelector('#learn-viewport-frame')).contentFrame();
  await frame.waitForSelector('#learn-viewer canvas');
  await frame.click('#learn-run');
  if (featureSample) {
    await frame.waitForFunction(() => globalThis.__learnFake?.resumeFeatures);
    if (width <= 760) await new Promise(resolve => setTimeout(resolve, 600));
    await page.screenshot({ path: path.join(outputDir, 'feature-replay.png') });
    report.featureView = await frame.evaluate(() => ({
      visible: !document.querySelector('#learn-features').hidden,
      block: document.querySelector('#learn-feature-step').textContent,
      pageWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    }));
    if (!report.featureView.visible || report.featureView.pageWidth > report.featureView.viewportWidth) throw new Error('feature replay is hidden or overflowing');
    await frame.evaluate(() => globalThis.__learnFake.resumeFeatures());
  }
  if (constructionContinuity) {
    if (!featureSample) throw new Error('construction continuity requires feature replay');
    report.retainedViews = [];
    for (let stage = 0; stage < 2; stage++) {
      await frame.waitForFunction(() => globalThis.__learnFake?.resumeConstruction);
      const retained = await frame.evaluate(() => ({
        featuresVisible: !document.querySelector('#learn-features').hidden,
        emptyVisible: !document.querySelector('#learn-view-empty').hidden,
        label: document.querySelector('#learn-view-label').textContent,
        count: document.querySelector('#learn-mesh-count').textContent,
      }));
      report.retainedViews.push(retained); write();
      if (retained.emptyVisible || (stage === 0 ? !retained.featuresVisible : retained.count === 'No geometry yet')) {
        throw new Error(`previous result erased before replacement at preview ${stage}`);
      }
      await page.screenshot({ path: path.join(outputDir, `retained-preview-${stage}.png`) });
      await frame.evaluate(() => { const resume = globalThis.__learnFake.resumeConstruction;
        globalThis.__learnFake.resumeConstruction = null; resume(); });
    }
  }
  await frame.waitForFunction(() => document.querySelector('#learn-stages [data-stage="final"]').dataset.state === 'done');
  report.first = await frame.evaluate(() => ({ label: document.querySelector('#learn-view-label').textContent, count: document.querySelector('#learn-mesh-count').textContent }));
  if (report.first.label !== 'Final mesh') throw new Error('first run did not show final geometry');
  report.phase = 'changed-input'; write();
  await (await frame.$('#learn-file')).uploadFile(path.resolve('fixtures/moge-live-flame-source.png'));
  await frame.waitForFunction(() => document.querySelector('#learn-source-name').textContent === 'moge-live-flame-source.png');
  await frame.click('#learn-run');
  await frame.waitForFunction(() => globalThis.__learnFake?.resumeSecond);
  if (width <= 760) await new Promise(resolve => setTimeout(resolve, 600));
  report.duringSecond = await frame.evaluate(() => ({
    label: document.querySelector('#learn-view-label').textContent,
    count: document.querySelector('#learn-mesh-count').textContent,
    emptyVisible: !document.querySelector('#learn-view-empty').hidden,
    firstStage: document.querySelector('#learn-stages [data-stage="block-0-fuse-out"]').dataset.state,
    viewerTop: document.querySelector('#learn-viewer').getBoundingClientRect().top,
    emptyText: document.querySelector('#learn-view-empty').textContent,
  }));
  if (report.duringSecond.label !== 'Awaiting first shape' || report.duringSecond.count !== 'No geometry yet' || !report.duringSecond.emptyVisible || report.duringSecond.firstStage !== 'waiting') {
    throw new Error('old mesh was presented as the new run');
  }
  if (width <= 760 && (report.duringSecond.viewerTop < -5 || report.duringSecond.viewerTop > 100 || report.duringSecond.emptyText !== 'Inferring shape')) {
    throw new Error('mobile viewer did not return to visible live progress');
  }
  if (width <= 760) await page.screenshot({ path: path.join(outputDir, 'mobile-inference.png') });
  await frame.evaluate(() => globalThis.__learnFake.resumeSecond());
  await frame.waitForFunction(() => document.querySelector('#learn-stages [data-stage="final"]').dataset.state === 'done');
  report.second = await frame.evaluate(() => ({
    firstStage: document.querySelector('#learn-stages [data-stage="block-0-fuse-out"]').dataset.state,
    finalStage: document.querySelector('#learn-stages [data-stage="final"]').dataset.state,
  }));
  if (report.second.firstStage !== 'skipped' || report.second.finalStage !== 'done') throw new Error('skipped preview replaced final outcome');
  report.phase = 'failed-release'; write();
  await page.click('[data-tab="assets"]');
  await frame.waitForFunction(() => !document.querySelector('#learn-reload').hidden);
  await page.click('[data-tab="learn"]');
  report.afterRelease = await frame.evaluate(() => ({
    runDisabled: document.querySelector('#learn-run').disabled,
    reloadVisible: !document.querySelector('#learn-reload').hidden,
    error: document.querySelector('#learn-error').textContent,
  }));
  await page.screenshot({ path: path.join(outputDir, 'failed-release.png') });
  if (!report.afterRelease.runDisabled || !report.afterRelease.reloadVisible || !report.afterRelease.error.includes('foreground drain failure')) {
    throw new Error('failed release permitted another producer load');
  }
  if (report.events.length) throw new Error('browser errors occurred in lifecycle witness');
  report.ok = true;
  report.phase = 'complete'; write();
} catch (error) {
  report.error = error?.stack || String(error);
  write();
  process.exitCode = 1;
} finally {
  await browser?.close();
}
