import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { loadFrozenCrawlerBasinManifest } from '../lirm-crawler-basin-robustness-core.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const manifestPath = resolve(
  repoRoot,
  'artifacts/lirm-upright-macrocephalic-basin-robustness-assay-v0/manifest.json',
);

const frozen = await loadFrozenCrawlerBasinManifest({ manifestPath, repoRoot });
assert.equal(frozen.familyId, 'upright-macrocephalic-low-multicontact-v0');
assert.equal(frozen.donors.length, 4);
assert.equal(frozen.sourceWitnesses.length, 2);
assert.ok(frozen.sourceWitnesses.every(witness => witness.absolutePath.startsWith(repoRoot)));
assert.ok(frozen.sourceWitnesses.every(witness => witness.mapping.absolutePath.startsWith(repoRoot)));

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const temporaryRoot = await mkdtemp(join(tmpdir(), 'kaminos-upright-basin-contract-'));

const mappingLie = structuredClone(manifest);
mappingLie.sourceWitnesses[0].mapping.sha256 = `sha256:${'0'.repeat(64)}`;
const mappingLiePath = join(temporaryRoot, 'mapping-lie.json');
await writeFile(mappingLiePath, `${JSON.stringify(mappingLie, null, 2)}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: mappingLiePath, repoRoot }),
  /source witness .*mapping hash mismatch/,
  'selection mapping substitution must fail before fitting',
);

const witnessEscape = structuredClone(manifest);
witnessEscape.sourceWitnesses[0].path = '../outside-selection-witness.png';
const witnessEscapePath = join(temporaryRoot, 'witness-escape.json');
await writeFile(witnessEscapePath, `${JSON.stringify(witnessEscape, null, 2)}\n`);
await assert.rejects(
  () => loadFrozenCrawlerBasinManifest({ manifestPath: witnessEscapePath, repoRoot }),
  /source witness .*escapes repo root/,
);

console.log('lirm upright macrocephalic basin robustness contracts passed');
