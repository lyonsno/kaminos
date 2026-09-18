import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BURNER_DEFAULTS, BURNER_SCHEMA, normalizeBurner } from '../annular-burner.mjs';
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
  const availableNumbers = ['radius', 'flow'].map(id => source.match(new RegExp('<input[^>]*id="burner-' + id + '-number"[^>]*>'))?.[0] || '').join('');
  await page.setContent(inputs + availableNumbers + '<script>' + handler + '</script>');
  const result = await page.evaluate(() => {
    const rows = [];
    for (const [id, canonical] of [['burner-radius', 'volume-input-radius'], ['burner-flow', 'volume-flow-rate']]) {
      const input = document.getElementById(id), target = document.getElementById(canonical);
      const samples = [];
      const min = Number(input.min), max = Number(input.max), step = Number(input.step);
      for (let i = 0; i <= Math.round((max - min) / step); i++) {
        input.value = String(min + i * step);
        input.dispatchEvent(new Event('input'));
        samples.push({ offered: input.value, effective: target.value, numeric: document.getElementById(`${id}-number`)?.value });
      }
      rows.push({ id, constraints: ['min', 'max', 'step'].map(key => [input[key], target[key]]), samples });
    }
    return { userAgent: navigator.userAgent, rows };
  });
  assert.deepEqual(errors, []);
  for (const row of result.rows) {
    for (const [offered, effective] of row.constraints) assert.equal(offered, effective, `${row.id} must offer canonical bounds and granularity`);
    assert.ok(row.samples.length > 1);
    for (const sample of row.samples) {
      assert.equal(sample.offered, sample.effective, `${row.id} sanitized a value offered by the burner`);
      if (sample.numeric !== undefined) assert.equal(sample.numeric, sample.effective, `${row.id} numeric partner must follow slider edits`);
    }
  }
  const numericRows = ['radius', 'flow'].map(id => {
    const match = source.match(new RegExp('<input[^>]*id="burner-' + id + '-number"[^>]*>'));
    assert.ok(match, `Burner ${id} needs numeric entry`);
    return match[0];
  }).join('');
  await page.setContent(inputs + numericRows + '<script>' + handler + '</script>');
  for (const [id, value] of [['radius', '0.32'], ['flow', '1.5']]) {
    await page.locator(`#burner-${id}-number`).fill(value);
    await page.locator(`#burner-${id}-number`).dispatchEvent('change');
    assert.equal(await page.locator(`#burner-${id}`).inputValue(), value);
    assert.equal(await page.locator(id === 'radius' ? '#volume-input-radius' : '#volume-flow-rate').inputValue(), value);
  }
  const fieldsStart = source.indexOf('const burnerFields = [');
  const fieldsEnd = source.indexOf('function setAnnularBurner(', fieldsStart);
  await page.setContent('<div id="burner-fields"></div><input id="burner-enabled" type="checkbox"><div id="burner-controls"></div><div id="burner-status"></div><script>' +
    `const BURNER_SCHEMA=${JSON.stringify(BURNER_SCHEMA)}, BURNER_DEFAULTS=${JSON.stringify(BURNER_DEFAULTS)}; ${normalizeBurner.toString()}\nlet burnerRecipe=BURNER_DEFAULTS, burnerError=null; function setAnnularBurner(value){burnerRecipe=normalizeBurner(value);syncBurnerControls();}\n` +
    source.slice(fieldsStart, fieldsEnd) + '\nsyncBurnerControls();</script>');
  for (const recipe of [BURNER_DEFAULTS, { ...BURNER_DEFAULTS, innerRadius: 0.0241, outerRadius: 0.8703, grooveDepth: 0.0002, thickness: 0.0008 }]) {
    const rows = await page.evaluate(recipe => {
      setAnnularBurner(recipe);
      return burnerFields.filter(row => row[2] === 'number').map(([key]) => ({ key,
        numeric: Number(document.getElementById(`burner-${key}`).value),
        range: Number(document.getElementById(`burner-${key}-slider`).value),
      }));
    }, recipe);
    for (const row of rows) assert.equal(row.range, row.numeric, `${row.key}: loading must not silently sanitize the slider`);
    await page.evaluate(recipe => {
      for (const [key, , type] of burnerFields) {
        if (type !== 'number') continue;
        for (const fraction of [0, 0.5, 1]) {
          setAnnularBurner(recipe);
          const range = document.getElementById(`burner-${key}-slider`);
          range.value = Number(range.min) + (Number(range.max) - Number(range.min)) * fraction;
          range.dispatchEvent(new Event('input'));
          if (burnerError) throw new Error(`${key}: ${burnerError}`);
          if (Number(range.value) !== burnerRecipe[key]) throw new Error(`${key}: visible value differs from recipe`);
        }
      }
    }, recipe);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', userAgent: result.userAgent, controls: result.rows.map(row => ({ id: row.id, valuesExercised: row.samples.length })) }));
} finally { await browser.close(); }
