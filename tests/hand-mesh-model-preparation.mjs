// kaminos-test: node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareLocalModels } from '../demos/hand-mesh/prepare-local-models.mjs';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hand-model-prep-'));
try {
  const dirs = {};
  for (const [kind, schema] of [['mobrecon', 'mobrecon.browser-weight-package.v0'], ['detector', 'wilor-hand-detector.browser-weight-package.v0']]) {
    const dir = path.join(root, kind); dirs[kind] = dir; await fs.mkdir(dir);
    const bytes = Buffer.from([1, 2, 3, 4]);
    await fs.writeFile(path.join(dir, `${kind}.bin`), bytes);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ schema, status: 'succeeded', provenance: { sourceRoot: '/private/source', sourceRevision: 'original' }, resources: [{ file: `${kind}.bin`, manifest: { bundle: { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } } }] }));
  }
  const out = path.join(root, 'prepared');
  await prepareLocalModels({ ...dirs, out });
  assert.equal((await fs.readdir(out)).length, 4);
  const metadata = JSON.parse(await fs.readFile(path.join(out, 'mobrecon.package.json')));
  assert.equal(metadata.provenance.sourceRoot, undefined);
  assert.equal(metadata.provenance.sourceRevision, 'original');
  await assert.rejects(prepareLocalModels({ ...dirs, out }), /EEXIST/);
  await fs.writeFile(path.join(dirs.mobrecon, 'mobrecon.bin'), Buffer.from([9, 2, 3, 4]));
  const invalid = path.join(root, 'invalid');
  await assert.rejects(prepareLocalModels({ ...dirs, out: invalid }), /hash\/size mismatch/);
  await assert.rejects(fs.stat(invalid), /ENOENT/, 'failed verification must not create an import folder');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('hand model preparation contracts passed');
