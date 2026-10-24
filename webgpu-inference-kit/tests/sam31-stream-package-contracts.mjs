// kaminos-test: node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tool from '../tools/sam31-stream-model.mjs';
import { sha256 } from '../tools/sam-model.mjs';
import { canonicalSam3IdentityJson } from '../src/sam-browser-package-manifest.js';
assert.equal(typeof tool.prepareSam31StreamPackage, 'function', 'stream controls need their own authenticated package identity');
const directory = await mkdtemp(join(tmpdir(), 'sam31-stream-package-'));
try {
  const base = join(directory, 'base'), controls = join(directory, 'controls');
  await mkdir(base); await mkdir(controls);
  const bytes = new Uint8Array([0, 0, 128, 63]);
  await writeFile(join(base, 'weight.bin'), bytes);
  const artifact = { file: 'weight.bin', sha256: sha256(bytes), byteLength: 4 };
  const model = { schema: 'kaminos.sam31-browser-tracker-model-package.v0', packageId: 'fixture-base',
    model: { sha256: 'fixture-checkpoint' }, source: { commit: 'fixture-source' }, components: {}, staticArtifacts: [artifact], claims: {} };
  const { schema, packageId, ...identity } = model;
  model.packageId = 'sam31-tracker-model-package:' + sha256(canonicalSam3IdentityJson(identity));
  await writeFile(join(base, 'model.json'), JSON.stringify(model));
  const report = { schema: 'kaminos.sam31-stream-controls.v1', status: 'complete', checkpointSha256: 'fixture-checkpoint', controls: {} };
  for (const [name, count] of [['valid', 4096], ['invalid', 4096], ['noMemory', 256], ['positionMatrix', 256]]) {
    const data = new Uint8Array(new Float32Array(count).fill(count).buffer);
    await writeFile(join(controls, `${name}.bin`), data);
    report.controls[name] = { file: `${name}.bin`, role: name, dtype: 'float32', shape: [count], sha256: sha256(data), byteLength: data.byteLength };
  }
  await writeFile(join(controls, 'controls.json'), JSON.stringify(report));
  const result = await tool.prepareSam31StreamPackage({ modelPath: join(base, 'model.json'), controlsPath: join(controls, 'controls.json'), outDir: join(directory, 'output') });
  const projected = JSON.parse(await readFile(result.modelPath, 'utf8'));
  assert.equal(projected.components.stream.plan.maxObjectPointerFrames, 16);
  assert.equal(projected.components.stream.source.checkpointSha256, model.model.sha256);
  assert.notEqual(projected.packageId, model.packageId);
  assert.ok(projected.staticArtifacts.every(a => typeof a.sha256 === 'string'));
  for (const entry of Object.values(projected.components.stream.controls)) {
    const artifact = projected.staticArtifacts.find(a => a.sha256 === entry.sha256);
    assert.ok(artifact.aliases?.some(alias => alias.role === entry.role && alias.file === entry.file),
      'each control must resolve through the resident model alias contract');
  }
  assert.equal(JSON.parse(await readFile(join(base, 'model.json'), 'utf8')).components.stream, undefined);
  await writeFile(join(controls, 'valid.bin'), 'truncated');
  await assert.rejects(tool.prepareSam31StreamPackage({ modelPath: join(base, 'model.json'), controlsPath: join(controls, 'controls.json'), outDir: join(directory, 'bad') }), /control.*identity/i);
  assert.equal(JSON.parse(await readFile(join(directory, 'bad', 'prepare-report.json'), 'utf8')).status, 'failed');
  console.log('SAM3.1 stream package identity and failure contracts passed');
} finally { await rm(directory, { recursive: true, force: true }); }
