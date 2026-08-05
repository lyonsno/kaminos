import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  renderMuscleCompartmentRingCageContactHtml,
} from '../muscle-compartment-ring-cage-contact-witness.mjs';
import {
  measureMuscleCompartmentRingCageContactState,
} from '../muscle-compartment-ring-cage-contact-core.mjs';

const REPO_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const ASSAY = path.join(
  REPO_ROOT,
  'artifacts/current-k4-ring-cage-longitudinal-volume-assay-v0',
);

async function json(relative) {
  return JSON.parse(await readFile(path.join(ASSAY, relative), 'utf8'));
}

test('the ring-cage witness honors an explicit contact-region camera without changing carrier state', async () => {
  const [sourceCarrier, packedCarrier, source, residualLedger, report] = await Promise.all([
    json('selected-carrier.json'),
    json('packed-carrier.json'),
    json('../current-k4-fixed-contact-assay-v0/contact-admitted-source.json'),
    json('residual-ledger.json'),
    json('run-report.json'),
  ]);
  const focus = {
    point: [8.396755744615195, -1.7105116328208096, 8.383702852785943],
    radius: 2.2,
  };
  const initial = measureMuscleCompartmentRingCageContactState(sourceCarrier, source);
  const packed = measureMuscleCompartmentRingCageContactState(packedCarrier, source);
  const html = renderMuscleCompartmentRingCageContactHtml({
    sourceCarrier,
    result: {
      status: 'test-focus',
      fixedNodeMaximumDrift: 0,
      termination: { reason: 'test' },
      metrics: { initial, packed },
      packedCarrier,
    },
    source,
    route: report.visual.route,
    bundleIdentity: report.visual.bundleIdentity,
    residualLedger,
    presentation: { focus },
  });

  assert.match(html, /viewMode==='contact'/);
  assert.match(html, /presentationFocus/);
  assert.ok(html.includes(JSON.stringify(focus.point)));
  assert.ok(html.includes(String(focus.radius)));
});

test('the ring-cage witness rejects malformed contact-region camera inputs', async () => {
  const [sourceCarrier, packedCarrier, source, residualLedger, report] = await Promise.all([
    json('selected-carrier.json'),
    json('packed-carrier.json'),
    json('../current-k4-fixed-contact-assay-v0/contact-admitted-source.json'),
    json('residual-ledger.json'),
    json('run-report.json'),
  ]);
  const initial = measureMuscleCompartmentRingCageContactState(sourceCarrier, source);
  const packed = measureMuscleCompartmentRingCageContactState(packedCarrier, source);
  assert.throws(() => renderMuscleCompartmentRingCageContactHtml({
    sourceCarrier,
    result: {
      status: 'test-focus',
      fixedNodeMaximumDrift: 0,
      termination: { reason: 'test' },
      metrics: { initial, packed },
      packedCarrier,
    },
    source,
    route: report.visual.route,
    bundleIdentity: report.visual.bundleIdentity,
    residualLedger,
    presentation: { focus: { point: [1, 2], radius: 0 } },
  }), /presentation focus/i);
});
