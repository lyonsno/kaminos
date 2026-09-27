import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const value = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || fallback;
};
const outputDir = path.resolve(value('--output-dir', '/private/tmp/kaminos-sf3d-learn-browser'));
const baseUrl = value('--url', 'http://127.0.0.1:8179');
const puppeteerPath = value('--puppeteer', '');
const chromePath = value('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
fs.mkdirSync(outputDir, { recursive: true });
const reportPath = path.join(outputDir, 'report.json');
const report = { schema: 'kaminos.sf3d-learn-browser.v0', phase: 'preflight', ok: false,
  requested: { baseUrl }, effective: { baseUrl, puppeteerPath, chromePath }, events: [] };
const write = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
write();
let browser;
try {
  if (!puppeteerPath || !fs.existsSync(puppeteerPath)) throw new Error('missing Puppeteer module');
  if (!fs.existsSync(chromePath)) throw new Error('missing Chrome');
  const { default: puppeteer } = await import(pathToFileURL(puppeteerPath).href);
  report.phase = 'browser'; write();
  browser = await puppeteer.launch({ executablePath: chromePath, headless: false,
    args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.events.push({ type: 'pageerror', message: error.message }));
  page.on('error', error => report.events.push({ type: 'page-crash', message: error.message }));
  page.on('requestfailed', request => report.events.push({ type: 'request-failed', url: request.url(), reason: request.failure()?.errorText }));
  page.on('response', response => { if (response.status() >= 400) report.events.push({ type: 'http-error', url: response.url(), status: response.status() }); });
  report.phase = 'host-tab'; write();
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-tab="learn"]');
  await page.click('[data-tab="learn"]');
  await page.waitForFunction(() => document.querySelector('#learn-viewport-frame')?.contentDocument?.querySelector('#learn-viewer canvas'));
  await new Promise(resolve => setTimeout(resolve, 1200));
  report.host = await page.evaluate(() => ({ activeTab: window.__kaminosActiveTab?.(),
    frameUrl: document.querySelector('#learn-viewport-frame').contentWindow?.location.href,
    panelVisible: !document.querySelector('#learn-operator-panel').hidden }));
  await page.screenshot({ path: path.join(outputDir, 'host.png') });
  if (report.host.activeTab !== 'learn' || !report.host.panelVisible || !report.host.frameUrl?.endsWith('/sf3d-learn.html')) {
    throw new Error('Kaminos Learn tab did not mount the live page');
  }
  await page.close();
  const directPage = await browser.newPage();
  await directPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  report.phase = 'direct-page'; write();
  await directPage.goto(`${baseUrl}/sf3d-learn.html`, { waitUntil: 'domcontentloaded' });
  await directPage.waitForSelector('#learn-viewer canvas');
  await new Promise(resolve => setTimeout(resolve, 1200));
  report.direct = await directPage.evaluate(() => ({ title: document.title, runEnabled: !document.querySelector('#learn-run').disabled,
    sourceLoaded: document.querySelector('#learn-source').naturalWidth > 0,
    canvas: { width: document.querySelector('#learn-viewer canvas').width, height: document.querySelector('#learn-viewer canvas').height },
    error: document.querySelector('#learn-error').hidden ? null : document.querySelector('#learn-error').textContent }));
  await directPage.screenshot({ path: path.join(outputDir, 'direct.png') });
  if (!report.direct.runEnabled || !report.direct.sourceLoaded || !report.direct.canvas.width || report.direct.error) {
    throw new Error('direct Learn page did not render a usable first screen');
  }
  report.ok = true;
  report.phase = 'complete'; write();
} catch (error) {
  report.error = error?.stack || String(error);
  write();
  process.exitCode = 1;
} finally {
  await browser?.close();
}
