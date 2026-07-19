import assert from 'node:assert/strict';

import {
  buildCrossFamilyHybridContactSheetManifest,
} from '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/contact-sheet.mjs';

const candidates = [
  'crown-halo-pendant-tripod',
  'offset-keyhole-canopy-strider',
  'wide-portal-saddle-canopy',
];
const cells = candidates.flatMap(candidateId => [
  'anatomical-completion',
  'prior-led-invention',
].map(stance => ({
  cellId: `${candidateId}-clay-depth-normal-${stance}-seed718401`,
  candidateId,
  stance,
  durableOutput: { path: `imagegen-outputs/${candidateId}-${stance}.png` },
})));
const manifest = buildCrossFamilyHybridContactSheetManifest({ accepted: cells, artifactRoot: '/tmp/hybrid' });
assert.equal(manifest.columns, 2);
assert.equal(manifest.rows, 3);
assert.equal(manifest.cells.length, 6);
assert.equal(new Set(manifest.cells.map(cell => cell.candidateId)).size, 3);
for (let index = 0; index < manifest.cells.length; index += 2) {
  assert.equal(manifest.cells[index].stance, 'anatomical-completion');
  assert.equal(manifest.cells[index + 1].stance, 'prior-led-invention');
  assert.equal(manifest.cells[index].candidateId, manifest.cells[index + 1].candidateId);
}
assert.throws(
  () => buildCrossFamilyHybridContactSheetManifest({ accepted: cells.slice(0, 5), artifactRoot: '/tmp/hybrid' }),
  /requires 6 accepted outputs/,
);
assert.throws(
  () => buildCrossFamilyHybridContactSheetManifest({ accepted: [...cells.slice(0, 5), cells[0]], artifactRoot: '/tmp/hybrid' }),
  /duplicate or missing stance pair|requires three candidate pairs/,
);

console.log('LIRM cross-family hybrid imagegen contact sheet contracts passed');
