// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sam-image-tools.js', import.meta.url), 'utf8');
const start = source.indexOf('  function createRuntime() {');
const end = source.indexOf('  async function run()', start);
assert.ok(start >= 0 && end > start, 'runtime construction boundary must exist');
const factory = source.slice(start, end);
const commit = '48677912ba6981462a54a39ca8df773136be5702';
for (const [href, expected] of [[`http://localhost/?sam=1&commit=${commit}`, commit], ['http://localhost/?sam=1', null]]) {
  let observed;
  const foregroundService = { identity: 'application-service-fixture' };
  const context = {
    window: { location: { href } }, URL, inferenceSession: {},
    createSam3BrowserImageRuntime(options) { observed = options; return {}; },
    foreground: {}, foregroundService, failure: null, status() {},
  };
  vm.runInNewContext(`${factory}\ncreateRuntime()`, context);
  assert.equal(observed.commit, expected, 'the host must pass its explicit build locator; missing remains unverified');
  assert.equal(observed.baseUrl, href);
  assert.equal(observed.foregroundService, foregroundService, 'build-locator caller keeps the exact application service');
}
console.log('SAM host explicit build locator contracts passed; this does not authenticate served source bytes');
