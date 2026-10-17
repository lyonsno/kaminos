// kaminos-test: node
// Klein loads the hosted weights unless told otherwise: kleinWeightUrls() maps a base URL and a jank
// level to the three weight roots, and KleinPipeline takes the hosted defaults, a custom base and
// level, or explicit roots (which win).
import assert from 'node:assert/strict';

import { KLEIN_HOSTED_WEIGHTS, KLEIN_LEVELS, kleinWeightUrls } from '../models/flux2-klein/klein-weights.js';
import { KleinPipeline } from '../models/flux2-klein/klein-pipeline.js';

const hosted = 'https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu/resolve/main';
assert.equal(KLEIN_HOSTED_WEIGHTS, hosted);
assert.deepEqual(Object.keys(KLEIN_LEVELS), ['mint', 'weathered', 'off-the-rails']);
assert.deepEqual(kleinWeightUrls(), { textEncoderUrl: `${hosted}/te`, transformerUrl: `${hosted}/dit`, vaeUrl: `${hosted}/vae` });
assert.deepEqual(kleinWeightUrls({ base: 'https://example.com/klein/', level: 'off-the-rails' }),
  { textEncoderUrl: 'https://example.com/klein/te', transformerUrl: 'https://example.com/klein/dit-q2', vaeUrl: 'https://example.com/klein/vae' });
assert.throws(() => kleinWeightUrls({ level: 'pristine' }), /unknown Klein level "pristine"; expected mint, weathered or off-the-rails/);

const device = { queue: {}, limits: {} };
assert.deepEqual(new KleinPipeline(device).urls, kleinWeightUrls());
assert.deepEqual(new KleinPipeline(device, { weightsBase: 'http://127.0.0.1:9000', level: 'weathered' }).urls,
  kleinWeightUrls({ base: 'http://127.0.0.1:9000', level: 'weathered' }));
assert.deepEqual(new KleinPipeline(device, { textEncoderUrl: '/a', transformerUrl: '/b', vaeUrl: '/c' }).urls,
  { textEncoderUrl: '/a', transformerUrl: '/b', vaeUrl: '/c' });

// A load that cannot reach its weights names the URL it tried, even when the browser reports only
// a network failure (a missing file without CORS headers surfaces as "Failed to fetch").
{
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try {
    const pipeline = new KleinPipeline(device, { weightsBase: 'https://example.com/no-weights-here' });
    await assert.rejects(() => pipeline.load(), /https:\/\/example\.com\/no-weights-here\/te\/manifest\.json: Failed to fetch/);
  } finally { globalThis.fetch = realFetch; }
}

console.log('klein weights contracts passed');
