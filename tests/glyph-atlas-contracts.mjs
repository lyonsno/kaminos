import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  ATLAS_SCHEMA,
  buildAtlasModel,
  parseFontconfigRows,
  renderAtlasHtml,
} from '../tools/glyph-atlas/core.mjs';
const smokeSource = await readFile(new URL('../tools/glyph-atlas/smoke.mjs', import.meta.url), 'utf8');

const FIELD = '\u001f';
const ROW = '\u001e';
const syntheticRows = Array.from({ length: 301 }, (_, index) => [
  `/fonts/face-${index}.otf`,
  '0',
  `Family ${index}`,
  index % 2 ? 'Bold' : 'Regular',
  `Family ${index} ${index % 2 ? 'Bold' : 'Regular'}`,
  `Family${index}-${index % 2 ? 'Bold' : 'Regular'}`,
  'CFF',
  'TEST',
  'False',
].join(FIELD)).join(ROW);

const parsed = parseFontconfigRows(syntheticRows, {
  id: 'synthetic-corpus',
  kind: 'directory',
  root: '/fonts',
  license: {
    status: 'verified-open',
    id: 'OFL-1.1',
    url: 'https://openfontlicense.org/',
  },
});

assert.equal(parsed.length, 301, 'the atlas must not silently cap a large source population');
assert.equal(parsed[300].source.id, 'synthetic-corpus', 'each face preserves its effective source identity');
assert.equal(parsed[300].license.id, 'OFL-1.1', 'each face preserves source-level license identity');
assert.match(parsed[0].id, /^[a-f0-9]{16}-0$/, 'face ids are deterministic and address the collection index');

const model = buildAtlasModel({
  configIdentity: 'contract-config-sha256',
  requestedSources: ['synthetic-corpus'],
  effectiveSources: [{
    id: 'synthetic-corpus',
    kind: 'directory',
    root: '/fonts',
    status: 'loaded',
    faceCount: parsed.length,
  }],
  faces: parsed,
  warnings: [],
});

assert.equal(model.schema, ATLAS_SCHEMA);
assert.equal(model.accounting.discoveredFaces, 301);
assert.equal(model.accounting.emittedFaces, 301);
assert.equal(model.accounting.silentlyDroppedFaces, 0);
assert.equal(model.route.requestedSources[0], 'synthetic-corpus');
assert.equal(model.route.effectiveSources[0].faceCount, 301);

const html = renderAtlasHtml(model);
assert.match(html, /data-atlas-schema="kaminos\.glyph-atlas\.v0"/);
assert.match(html, /data-face-id="[a-f0-9]{16}-0"/);
assert.match(html, /data-glyph="K"/);
assert.match(html, /data-glyph="S"/);
assert.match(html, /contract-config-sha256/, 'human-visible atlas preserves effective config identity');
assert.match(html, /301 faces/, 'human-visible atlas reports the complete emitted population');
assert.doesNotMatch(html, /slice\(\s*0\s*,/, 'rendering must not hide an arbitrary first-N cap');
assert.match(html, /dataset\.effectiveUrl/, 'atlas exposes effective route identity to its browser witness');
assert.match(html, /requestedSelection/, 'atlas supports deep-linked glyph selection for repeatable conditioning plates');

const hiddenFirst = parseFontconfigRows([
  '/fonts/.hidden.otf', '0', '.Hidden', 'Regular', '.Hidden Regular', 'Hidden-Regular', 'CFF', 'TEST', 'False',
].join(FIELD) + ROW, {
  id: 'synthetic-corpus',
  kind: 'directory',
  root: '/fonts',
  license: { status: 'verified-open', id: 'OFL-1.1' },
})[0];
const sorted = buildAtlasModel({
  configIdentity: 'sort-contract',
  requestedSources: ['synthetic-corpus'],
  effectiveSources: [],
  faces: [hiddenFirst, parsed[0]],
  warnings: [],
});
assert.equal(sorted.faces[0].family, 'Family 0', 'hidden system families remain present but do not occupy the opening scan order');
assert.equal(sorted.faces[1].family, '.Hidden');

assert.match(smokeSource, /effective URL mismatch/, 'smoke fails loud on requested/effective route disagreement');
assert.match(smokeSource, /missing-or-blank-output/, 'smoke rejects absent or implausibly small screenshots');
assert.match(smokeSource, /primaryOutputWritten/, 'smoke records whether its primary visual artifact exists');
assert.match(smokeSource, /failurePhase/, 'smoke preserves the exact failure phase');

const root = await mkdtemp(join(tmpdir(), 'kaminos-glyph-atlas-contract-'));
const configPath = join(root, 'sources.json');
const outputPath = join(root, 'atlas');
const reportPath = join(root, 'failure.json');
await writeFile(configPath, `${JSON.stringify({
  schema: 'kaminos.glyph-atlas.sources.v0',
  sources: [{
    id: 'missing-required-source',
    kind: 'directory',
    root: join(root, 'does-not-exist'),
    required: true,
    license: { status: 'unknown', id: null, url: null },
  }],
})}\n`);

const failed = spawnSync(process.execPath, [
  new URL('../tools/glyph-atlas/build.mjs', import.meta.url).pathname,
  '--config', configPath,
  '--out', outputPath,
  '--report', reportPath,
], { encoding: 'utf8' });

assert.equal(failed.status, 2, failed.stderr || failed.stdout);
const failure = JSON.parse(await readFile(reportPath, 'utf8'));
assert.equal(failure.schema, 'kaminos.glyph-atlas.build-report.v0');
assert.equal(failure.status, 'failed');
assert.equal(failure.failurePhase, 'source-discovery');
assert.equal(failure.primaryOutputWritten, false);
assert.equal(failure.route.requestedConfig, configPath);
assert.equal(failure.route.effectiveConfig, configPath);
assert.match(failure.error, /missing-required-source/);
assert.deepEqual(failure.lastTrustworthyEvidence.requestedSources, ['missing-required-source']);

console.log('glyph atlas contracts passed');
