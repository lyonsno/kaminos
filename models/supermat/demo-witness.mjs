// Open the SuperMat demo URL in an independent headless Chrome for Testing,
// wait for the page's own terminal state, and capture what it shows.
// Writes a report on every path; an errored or unfinished page fails.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { launchChrome, openPage } from './chrome-cdp.mjs';

const { values } = parseArgs({ options: Object.fromEntries(
  ['url', 'chrome', 'report', 'screenshot', 'timeout-ms', 'mid-screenshot', 'mid-delay-ms'].map(name => [name, { type: 'string' }])) });
const output = path.resolve(values.report ?? 'supermat-demo-report.json');
const report = { schema: 'supermat.demo-witness.v0', status: 'failed', phase: 'arguments', requestedUrl: values.url ?? null,
  command: process.argv };
const persist = async () => {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
};
let browser;
try {
  await persist();
  for (const name of ['url', 'chrome', 'report', 'screenshot']) if (!values[name]) throw new Error(`--${name} is required`);
  const timeoutMs = Number(values['timeout-ms'] ?? 600000);
  report.phase = 'browser-launch';
  browser = await launchChrome({ chrome: values.chrome, onExit: exit => { report.ownedBrowserExit = exit; } });
  report.browser = { executable: browser.executable, product: browser.version.product, pid: browser.child.pid };
  report.phase = 'page-load';
  const sessionId = await openPage(browser.cdp, values.url);
  report.phase = 'page-terminal-state';
  const started = Date.now();
  let state, midTaken = !values['mid-screenshot'];
  for (;;) {
    const evaluation = await browser.cdp.call('Runtime.evaluate',
      { expression: 'JSON.stringify(window.__supermatDemo ?? null)', returnByValue: true }, sessionId);
    state = JSON.parse(evaluation.result.value ?? 'null');
    if (!midTaken && state?.status === 'running' && Date.now() - started >= Number(values['mid-delay-ms'] ?? 0)) {
      const mid = await browser.cdp.call('Page.captureScreenshot', { format: 'png' }, sessionId);
      await fs.writeFile(path.resolve(values['mid-screenshot']), Buffer.from(mid.data, 'base64'));
      report.midScreenshot = { path: path.resolve(values['mid-screenshot']), atMs: Date.now() - started };
      midTaken = true;
    }
    if (['done', 'error', 'stopped'].includes(state?.status)) break;
    if (Date.now() - started > timeoutMs) throw new Error(`demo did not finish within ${timeoutMs} ms (status ${state?.status})`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  report.pageState = state;
  report.effectiveUrl = (await browser.cdp.call('Runtime.evaluate', { expression: 'location.href', returnByValue: true },
    sessionId)).result.value;
  report.phase = 'screenshot';
  await new Promise(resolve => setTimeout(resolve, 300));
  const shot = await browser.cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }, sessionId);
  const screenshot = path.resolve(values.screenshot);
  await fs.writeFile(screenshot, Buffer.from(shot.data, 'base64'));
  report.screenshot = screenshot;
  report.phase = 'complete';
  report.status = state.status === 'done' ? 'passed' : state.status === 'stopped' ? 'stopped' : 'page-error';
} catch (error) {
  report.error = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}`;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await persist();
  console.log(JSON.stringify({ status: report.status, phase: report.phase, error: report.error ?? report.pageState?.error ?? null,
    report: output }));
}
