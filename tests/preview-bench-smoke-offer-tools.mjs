import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const toolsPath = join(root, 'preview-bench-smoke-offer-tools.mjs');

assert.ok(existsSync(toolsPath), 'producer-facing Preview Bench smoke-offer lint tool must exist');

const {
  buildPreviewBenchSmokeUrl,
  lintPreviewBenchSmokeOffer,
  previewBenchCoincidentMarkerGroups,
} = await import(toolsPath);

const neutralSmokeOffer = {
  schema: 'kaminos.forge-host.smoke-offer.v0',
  source: {
    authority: 'fixture',
    producerDiaulos: 'neutral-producer',
    sourceRef: 'neutral-source-ref',
  },
  freshness: {
    observedAt: '2026-06-29T12:00:00.000Z',
    budgetMs: 60000,
  },
  targetSurface: {
    id: 'forge-host-smoke-offer',
  },
  acceptanceSurface: {
    id: 'preview-bench-smoke-offer-contract',
  },
  offers: [
    {
      id: 'neutral-coincident-marker-offer',
      label: 'Neutral coincident marker offer',
      schema: 'neutral.preview-bench-payload.v0',
      route: 'neutral/preview-bench-payload',
      downgrades: ['fixture-not-source-truth'],
      rejectedDebugSurfaces: [
        { id: 'neutral-debug-surface', reason: 'debug surface is not acceptance' },
      ],
      benchHints: {
        objectMarkers: [
          { id: 'marker-a', kind: 'neutral_a', label: 'Neutral A', world: [1, 2, 3], authority: 'fixture' },
          { id: 'marker-b', kind: 'neutral_b', label: 'Neutral B', world: [1, 2, 3], authority: 'fixture' },
          { id: 'marker-c', kind: 'neutral_c', label: 'Neutral C', world: [1.00001, 2, 3], authority: 'fixture' },
          { id: 'marker-d', kind: 'neutral_d', label: 'Neutral D', world: [-1, 0, 0], authority: 'fixture' },
        ],
      },
    },
  ],
};

const lint = lintPreviewBenchSmokeOffer(neutralSmokeOffer, {
  root: 'scratch',
  path: 'neutral-coincident-marker-offer.json',
  baseUrl: 'http://127.0.0.1:18137/',
});

assert.equal(lint.schema, 'kaminos.preview-bench.smoke-offer-lint.v0');
assert.equal(lint.ok, true);
assert.equal(lint.offerCount, 1);
assert.equal(lint.visualHints.markerCount, 4);
assert.equal(lint.visualHints.source, 'producer-bench-hints');
assert.equal(lint.visualHints.coincidentMarkerGroups.length, 1);
assert.deepEqual(lint.visualHints.coincidentMarkerGroups[0].markerIds, ['marker-a', 'marker-b', 'marker-c']);
assert.match(lint.smokeUrl, /^http:\/\/127\.0\.0\.1:18137\/\?smoke_offer_root=scratch&smoke_offer_path=neutral-coincident-marker-offer\.json$/);
assert.equal(lint.witnessExpectation.visualState.visible, true);
assert.equal(lint.witnessExpectation.visualState.markerCount, 4);
assert.equal(lint.witnessExpectation.visualState.coincidentMarkerGroupCount, 1);

const url = buildPreviewBenchSmokeUrl({
  baseUrl: 'http://127.0.0.1:18137/',
  root: 'scratch',
  path: 'neutral file.json',
});
assert.equal(url, 'http://127.0.0.1:18137/?smoke_offer_root=scratch&smoke_offer_path=neutral+file.json');

const coincident = previewBenchCoincidentMarkerGroups(neutralSmokeOffer.offers[0].benchHints.objectMarkers);
assert.equal(coincident.length, 1);
assert.deepEqual(coincident[0].markerKinds, ['neutral_a', 'neutral_b', 'neutral_c']);
