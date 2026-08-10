import assert from 'node:assert/strict';
import test from 'node:test';

import { createNBodyPackingGeneralizationSuite } from '../nbody-packing-assay-core.mjs';
import {
  compileNBodyUnifiedKktProblem,
  createNBodyUnifiedKktConfig,
  solveNBodyUnifiedKktCandidate,
} from '../nbody-packing-unified-kkt.mjs';
import {
  NBODY_PACKING_GENERALIZATION_WITNESS_ROUTE,
  renderNBodyPackingGeneralizationHtml,
} from '../nbody-packing-generalization-witness.mjs';

test('generalization viewer defaults to the hard crowded case and exposes direct A/B states', () => {
  const fixture = createNBodyPackingGeneralizationSuite()[0];
  const problem = compileNBodyUnifiedKktProblem(fixture);
  const candidate = solveNBodyUnifiedKktCandidate({
    problem,
    requestedConfig:createNBodyUnifiedKktConfig(),
  });
  const report = {
    route: {
      requested:NBODY_PACKING_GENERALIZATION_WITNESS_ROUTE,
      effective:NBODY_PACKING_GENERALIZATION_WITNESS_ROUTE,
      fallbackUsed:false,
    },
  };
  const html = renderNBodyPackingGeneralizationHtml({
    rows:[{ memberCount:4, fixture, problem, candidate }],
    report,
  });
  assert.match(html, /data-witness-state="crowded"/);
  assert.match(html, /data-member-count="4"/);
  assert.match(html, /<button data-state="crowded">Crowded input<\/button>/);
  assert.match(html, /<button data-state="packed">Unified packed<\/button>/);
  assert.match(html, /<button data-state="reference">Manufactured reference<\/button>/);
  assert.match(html, /opaque slice/);
  assert.match(html, /OrbitControls/);
  assert.match(html, /contact graph consumed<\/span><span class="value good">no<\/span>/);
  assert.doesNotMatch(html, /better|best|winner/i);
});
