import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const INDEX = new URL(
  '../artifacts/source-shaped-k4-packing-visual-v0/index.html',
  import.meta.url,
);
const REPORT = new URL(
  '../artifacts/source-shaped-k4-packing-visual-v0/visual-report.json',
  import.meta.url,
);

test('source-shaped K4 visual route binds exact result identity and all six comparison states', async () => {
  const html = await readFile(INDEX, 'utf8');
  assert.match(html, /source-shaped-k4-packing-visual-v0/);
  assert.match(html, /ba263ef00bc0e8533b7ce284853797ce01be04ea42ee01000897a5f7aaf4b46b/);
  assert.match(html, /source-shaped-k4-packing-perturbation-v0\/perturbation-result\.json/);
  assert.match(html, /muscle-34[\s\S]*muscle-13[\s\S]*muscle-12[\s\S]*muscle-45/);
  for (const condition of ['baseline', 'mild', 'moderate']) {
    assert.match(html, new RegExp(`data-condition="${condition}"`));
  }
  for (const state of ['before', 'packed']) {
    assert.match(html, new RegExp(`data-state="${state}"`));
  }
  assert.match(html, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(html, /requested:\s*ROUTE_ID[\s\S]*effective:\s*ROUTE_ID[\s\S]*fallbackUsed:\s*false/);
  assert.match(html, /experimental qualitative evidence[\s\S]*no anatomical admission/i);
});

test('source-shaped K4 visual report preserves six inspected states and the false-closure incident', async () => {
  const report = JSON.parse(await readFile(REPORT, 'utf8'));
  assert.equal(report.status, 'agent-inspected-operator-inspection-open');
  assert.deepEqual(report.route, {
    requested: 'source-shaped-k4-packing-visual-v0',
    effective: 'source-shaped-k4-packing-visual-v0',
    fallbackUsed: false,
  });
  assert.equal(report.sourceResult.sha256, 'ba263ef00bc0e8533b7ce284853797ce01be04ea42ee01000897a5f7aaf4b46b');
  assert.deepEqual(
    report.captures.map(({ condition, state }) => `${condition}:${state}`),
    ['baseline:before', 'baseline:packed', 'mild:before', 'mild:packed', 'moderate:before', 'moderate:packed'],
  );
  assert.ok(report.captures.every(capture => /^[0-9a-f]{64}$/.test(capture.sha256)));
  assert.equal(report.falseClosureIncident.observed, true);
  assert.match(report.falseClosureIncident.disposition, /rejected[\s\S]*recaptured/i);
  assert.match(report.visualVerdict.claim, /useful evidence[\s\S]*visual rejection/i);
});
