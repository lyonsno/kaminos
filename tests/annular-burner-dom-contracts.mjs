import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
assert.ok(process.argv[2], 'provide an installed Playwright module path');
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ids = ['burner-radius', 'burner-flow', 'volume-input-radius', 'volume-flow-rate'];
const inputs = ids.map(id => {
  const match = source.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
  assert.ok(match, `missing actual input ${id}`);
  return match[0];
}).join('');
const start = source.indexOf("for (const [id, sourceId] of [['radius', 'volume-input-radius'], ['flow', 'volume-flow-rate']]) {", source.indexOf("document.getElementById('burner-enabled').onchange"));
assert.ok(start > 0);
const end = source.indexOf('window.kaminosBurnerState', start);
assert.ok(end > start);
const handler = source.slice(start, end);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--disable-software-rasterizer'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(inputs + '<script>' + handler + '</script>');
  const result = await page.evaluate(() => {
    const rows = [];
    for (const [id, canonical] of [['burner-radius', 'volume-input-radius'], ['burner-flow', 'volume-flow-rate']]) {
      const input = document.getElementById(id), target = document.getElementById(canonical);
      const samples = [];
      const min = Number(input.min), max = Number(input.max), step = Number(input.step);
      for (let i = 0; i <= Math.round((max - min) / step); i++) {
        input.value = String(min + i * step);
        input.dispatchEvent(new Event('input'));
        samples.push({ offered: input.value, effective: target.value });
      }
      rows.push({ id, constraints: ['min', 'max', 'step'].map(key => [input[key], target[key]]), samples });
    }
    return { userAgent: navigator.userAgent, rows };
  });
  assert.deepEqual(errors, []);
  for (const row of result.rows) {
    for (const [offered, effective] of row.constraints) assert.equal(offered, effective, `${row.id} must offer canonical bounds and granularity`);
    assert.ok(row.samples.length > 1);
    for (const sample of row.samples) assert.equal(sample.offered, sample.effective, `${row.id} sanitized a value offered by the burner`);
  }
  console.log(JSON.stringify({ status: 'passed', userAgent: result.userAgent, controls: result.rows.map(row => ({ id: row.id, valuesExercised: row.samples.length })) }));
} finally { await browser.close(); }
