import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const INDEX = new URL(
  '../artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/index.html',
  import.meta.url,
);
const REPORT = new URL(
  '../artifacts/source-shaped-k4-envelope-frame-binding-visual-v0/visual-report.json',
  import.meta.url,
);

test('K4 envelope overlay binds exact receipt, geometry, route, and provisional claim ceiling', async () => {
  const html = await readFile(INDEX, 'utf8');
  assert.match(html, /source-shaped-k4-envelope-frame-binding-visual-v0/);
  assert.match(html, /46c66c2bfc59a9d7f8a139a8c8117bf7b65762795a2cec103e1d58b023cc25fa/);
  assert.match(html, /533e4a6a63e658d86e841e0294bbecb4cd3f9be52b253c063282aa15b3596eb7/);
  assert.match(html, /cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e/);
  assert.match(html, /ba263ef00bc0e8533b7ce284853797ce01be04ea42ee01000897a5f7aaf4b46b/);
  assert.match(html, /muscle-34[\s\S]*muscle-13[\s\S]*muscle-12[\s\S]*muscle-45/);
  assert.match(html, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(html, /requested:\s*ROUTE_ID[\s\S]*effective:\s*ROUTE_ID[\s\S]*fallbackUsed:\s*false/);
  assert.match(html, /metric-mechanism-only[\s\S]*baseline-derived radii[\s\S]*no anatomical admission/i);
  assert.match(html, /window\.__K4_ENVELOPE_WITNESS__/);
});

test('inspected overlay report preserves exact captures and rejects the visually suppressed first frame', async () => {
  const report = JSON.parse(await readFile(REPORT, 'utf8'));
  assert.equal(report.status, 'agent-inspected-operator-inspection-open');
  assert.deepEqual(report.route, {
    requested: 'source-shaped-k4-envelope-frame-binding-visual-v0',
    effective: 'source-shaped-k4-envelope-frame-binding-visual-v0',
    fallbackUsed: false,
  });
  assert.deepEqual(report.captures.map(capture => capture.state), ['before', 'packed']);
  assert.ok(report.captures.every(capture => /^[0-9a-f]{64}$/.test(capture.sha256)));
  assert.ok(report.captures.every(capture => capture.domRouteAndIdentityVerified && capture.agentInspected));
  assert.equal(report.falseClosureIncident.observed, true);
  assert.match(report.falseClosureIncident.disposition, /rejected[\s\S]*recaptured/i);
  assert.match(report.visualVerdict.frameBinding, /plausible[\s\S]*no scale explosion[\s\S]*mirrored placement/i);
  assert.match(report.visualVerdict.packingResponse, /parallel capsule-like bodies[\s\S]*not an envelope-filling/i);
  assert.equal(report.operatorInspection.status, 'open');
});
