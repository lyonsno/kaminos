// kaminos-test: node
import assert from 'node:assert/strict';
import { readLocalModels } from '../demos/hand-mesh/model-files.js';
import { readModelPackage } from '../models/mobrecon/model-package-source.js';

const model = (kind, schema) => {
  const metadata = { schema, status: 'succeeded', resources: [{ file: `${kind}.bin`, manifest: { bundle: { byteLength: 4, sha256: '0'.repeat(64) } } }] };
  return [new File([JSON.stringify(metadata)], `${kind}.package.json`), new File([new Uint8Array(4)], `${kind}.bin`)];
};
const mesh = model('mobrecon', 'mobrecon.browser-weight-package.v0'), detector = model('detector', 'wilor-hand-detector.browser-weight-package.v0');
const files = [...mesh, ...detector];
const result = await readLocalModels(files);
assert.equal(result.mobrecon.bundle, mesh[1]);
assert.equal(result.detector.bundle, detector[1]);
await assert.rejects(readLocalModels(files.slice(1)), /missing mobrecon.package.json/);
await assert.rejects(readLocalModels([...files, mesh[0]]), /Duplicate/);
await assert.rejects(readLocalModels([new File(['broken'], 'mobrecon.package.json'), ...files.slice(1)]), /valid JSON/);
await assert.rejects(readLocalModels([mesh[0], new File(['too long'], 'mobrecon.bin'), ...detector]), /size/);
await assert.rejects(readModelPackage({ packageSource: result.mobrecon, packageUrl: 'https://example.invalid/', schema: result.mobrecon.metadata.schema }), /not both/);
const bad = structuredClone(result.mobrecon.metadata); bad.resources.push(bad.resources[0]);
await assert.rejects(readModelPackage({ packageSource: { metadata: bad, bundle: mesh[1] }, schema: bad.schema }), /exactly one/);
const failed = { ...result.mobrecon.metadata, status: 'failed' };
await assert.rejects(readModelPackage({ packageSource: { metadata: failed, bundle: mesh[1] }, schema: failed.schema }), /succeeded/);
console.log('local hand model inputs: passed (bundle SHA checked by kit acquisition)');
