import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  buildCrossFamilyHybridContactSheetManifest,
  writeCrossFamilyHybridContactSheet,
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
  output: { sha256: `sha256:${candidateId}-${stance}` },
  durableOutput: {
    path: `imagegen-outputs/${candidateId}-${stance}.png`,
    sha256: `sha256:${candidateId}-${stance}`,
  },
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
assert.ok(manifest.cells.every(cell => cell.sourceSha256 === cells.find(item => item.cellId === cell.cellId).durableOutput.sha256));
assert.throws(
  () => buildCrossFamilyHybridContactSheetManifest({ accepted: cells.slice(0, 5), artifactRoot: '/tmp/hybrid' }),
  /requires 6 accepted outputs/,
);
assert.throws(
  () => buildCrossFamilyHybridContactSheetManifest({ accepted: [...cells.slice(0, 5), cells[0]], artifactRoot: '/tmp/hybrid' }),
  /duplicate or missing stance pair|requires three candidate pairs/,
);

const repoArtifactRoot = new URL(
  '../artifacts/lirm-cross-family-hybrid-pressure-assay-v0/',
  import.meta.url,
).pathname;
const durableCollection = JSON.parse(await readFile(join(repoArtifactRoot, 'imagegen-collection.json'), 'utf8'));
const mutatedRoot = await mkdtemp(join(tmpdir(), 'lirm-cross-family-contact-sheet-drift-'));
const mutatedOutputs = join(mutatedRoot, 'imagegen-outputs');
await mkdir(mutatedOutputs, { recursive: true });
for (const cell of durableCollection.accepted) {
  const sourceBytes = await readFile(join(repoArtifactRoot, cell.durableOutput.path));
  await writeFile(join(mutatedOutputs, basename(cell.durableOutput.path)), sourceBytes);
}
await writeFile(
  join(mutatedOutputs, basename(durableCollection.accepted[0].durableOutput.path)),
  Buffer.from('swapped-after-collection'),
);
await writeFile(
  join(mutatedRoot, 'imagegen-collection.json'),
  `${JSON.stringify(durableCollection, null, 2)}\n`,
);
await assert.rejects(
  writeCrossFamilyHybridContactSheet({ root: mutatedRoot }),
  /contact sheet source hash drift/,
);

console.log('LIRM cross-family hybrid imagegen contact sheet contracts passed');
