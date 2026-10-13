// kaminos-test: browser - exercises the actual SAM and workspace styles without GPU inference.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = process.env.KAMINOS_SAM_LAYOUT_OUTPUT;
assert.ok(out, 'KAMINOS_SAM_LAYOUT_OUTPUT is required');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'static host-layout contract; no GPU or segmentation claim', status: 'running', phase: 'environment', startedAt: new Date().toISOString(), source: {}, requestedBrowser: process.env.CHROME_PATH || null, requestedPlaywright: process.env.PLAYWRIGHT_MODULE || null, cases: [] };
const saveReport = () => fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
saveReport();
let browser;
try {
  assert.ok(process.env.PLAYWRIGHT_MODULE, 'PLAYWRIGHT_MODULE is required');
  assert.ok(process.env.CHROME_PATH && !process.env.CHROME_PATH.includes('/Google Chrome.app/'), 'independent CHROME_PATH is required');
  report.phase = 'source'; saveReport();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const samCss = fs.readFileSync(path.join(root, 'sam-image-tools.css'), 'utf8');
  const workspaceCss = fs.readFileSync(path.join(root, 'authoring-workspace.css'), 'utf8');
  report.source = Object.fromEntries(['index.html', 'sam-image-tools.css', 'authoring-workspace.css'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  report.phase = 'import-playwright'; saveReport();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE);
  report.phase = 'browser-launch'; saveReport();
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, timeout: 0 });
  report.effectiveBrowser = { executablePath: fs.realpathSync(process.env.CHROME_PATH), version: browser.version(), headless: true };
  report.phase = 'fixture'; saveReport();
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  const markup = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return { baseline: document.querySelector('style').textContent, panel: document.getElementById('tab-masks').outerHTML };
  }, html);
  for (const width of [390, 700, 1440]) {
    report.phase = `layout-${width}`; saveReport();
    await page.setViewportSize({ width, height: 960 });
    await page.setContent(`<style>${samCss}</style><style>${markup.baseline}</style><style>${workspaceCss}</style><body class="has-authoring-workspace sam-image-active" data-workspace="workbench"><header id="authoring-header">Kaminos</header><aside id="sidebar">${markup.panel}</aside><main id="viewport"><section id="sam-image-viewport"><div class="sam-image-viewbar"><span id="sam-image-name">${'a'.repeat(245)}.jpg</span><div class="sam-image-modes"><button>Source</button><button>Overlay</button><button>Mask</button></div></div><div class="sam-image-stage"><canvas id="sam-image-canvas" width="1800" height="1200"></canvas></div><div id="sam-image-dimensions">1800 x 1200</div></section></main><aside id="volume-authored-mix-panel" ${width > 700 ? 'hidden' : ''}>Material controls</aside></body>`);
    await page.evaluate(() => {
      const panel = document.getElementById('tab-masks'); panel.style.display = 'block';
      const context = document.getElementById('sam-image-canvas').getContext('2d');
      context.fillStyle = '#478789'; context.fillRect(0, 0, 1800, 1200);
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const measurements = await page.evaluate(() => {
      const rect = id => document.getElementById(id).getBoundingClientRect().toJSON();
      const viewport = rect('viewport'), sidebar = rect('sidebar');
      const buttons = [...document.querySelectorAll('.sam-image-modes button')].map(button => {
        const box = button.getBoundingClientRect();
        return { text: button.textContent, hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
      });
      return { viewport, sidebar, canvas: rect('sam-image-canvas'), buttons, documentWidth: document.documentElement.scrollWidth, width: innerWidth };
    });
    const screenshot = path.join(out, `layout-${width}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.cases.push({ width, measurements, screenshot });
    saveReport();
    assert.ok(measurements.viewport.width >= (width <= 700 ? width - 1 : width - 381), `mask viewport crushed at ${width}: ${measurements.viewport.width}px`);
    assert.ok(measurements.canvas.width > 200, 'mask image has no useful visible area');
    assert.ok(measurements.buttons.every(button => button.hit), 'mode buttons are occluded');
    assert.ok(measurements.documentWidth <= width, 'mask layout overflows the viewport');
    if (width <= 700) assert.ok(measurements.viewport.top >= measurements.sidebar.bottom - 1, 'mask controls and image must stack on mobile');
    else assert.ok(measurements.viewport.left >= measurements.sidebar.right - 1, 'desktop must keep side-by-side layout');
  }
  report.status = 'passed'; report.phase = 'complete';
} catch (error) {
  report.status = 'failed'; report.error = String(error.stack || error); process.exitCode = 1;
} finally {
  try { if (browser) await browser.close(); report.browserCleanup = browser ? 'closed' : 'not-launched'; }
  catch (error) { report.status = 'failed'; report.cleanupError = String(error); process.exitCode = 1; }
  report.finishedAt = new Date().toISOString(); saveReport();
}
console.log(JSON.stringify({ status: report.status, error: report.error, report: path.join(out, 'report.json') }));
