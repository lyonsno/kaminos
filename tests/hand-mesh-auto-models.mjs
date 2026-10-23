// kaminos-test: node
import assert from 'node:assert/strict';
import * as inputs from '../demos/hand-mesh/model-files.js';
assert.equal(typeof inputs.readServedModels, 'function', 'one-command server must load models without folder selection');
const calls = [];
const fetcher = async url => {
  calls.push(url.href);
  const name = url.pathname.split('/').at(-1);
  if (name.endsWith('.json')) {
    const kind = name.split('.')[0];
    return new Response(JSON.stringify({ schema: kind === 'mobrecon' ? 'mobrecon.browser-weight-package.v0' : 'wilor-hand-detector.browser-weight-package.v0', status: 'succeeded', resources: [{ file: `${kind}.bin`, manifest: { bundle: { byteLength: 4, sha256: '0'.repeat(64) } } }] }));
  }
  return new Response(new Uint8Array(4));
};
const models = await inputs.readServedModels('/__hand-models/', 'http://127.0.0.1:8501/demos/hand-mesh/', fetcher);
assert.equal(models.mobrecon.bundle.size, 4);
assert.deepEqual(calls.map(x => new URL(x).pathname).sort(), ['/__hand-models/detector.bin', '/__hand-models/detector.package.json', '/__hand-models/mobrecon.bin', '/__hand-models/mobrecon.package.json']);
await assert.rejects(inputs.readServedModels('https://elsewhere.invalid/', 'http://127.0.0.1:8501/', fetcher), /same origin/);
await assert.rejects(inputs.readServedModels('/missing/', 'http://127.0.0.1:8501/', async () => new Response('missing', { status: 404 })), /404/);
await assert.rejects(inputs.readServedModels('/broken/', 'http://127.0.0.1:8501/', async () => new Response(JSON.stringify({ resources: [{ file: '../outside.bin' }] }))), /local bundle/);
console.log('one-command model loading: passed');
