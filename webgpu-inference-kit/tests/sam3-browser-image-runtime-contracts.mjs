import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const runtimeUrl = new URL('../src/sam3-browser-image-runtime.js', import.meta.url);
assert.ok(existsSync(runtimeUrl), 'the SAM image runtime must be usable by a host without creating a smoke iframe');
const { createSam3BrowserImageRuntime } = await import(runtimeUrl);
const first = createSam3BrowserImageRuntime({ baseUrl: 'http://localhost/' });
const second = createSam3BrowserImageRuntime({ baseUrl: 'http://localhost/' });
assert.equal(first.output(), null);
assert.equal(second.output(), null);
assert.notEqual(first, second);
await first.close();
assert.throws(() => first.run('/model.json', {}), /closed/);
assert.equal(second.progress().error, null, 'closing one caller must not close another');
await second.close();
let adapterOptions;
const window = { location: { href: 'http://localhost/', search: '?autorun=0' }, addEventListener() {} };
const adapter = readFileSync(new URL('../smokes/sam-mask-island-parity.js', import.meta.url), 'utf8');
vm.runInNewContext(adapter.replace(/^import .*;\n/m, ''), { window, URLSearchParams,
  document: { body: { dataset: {} }, getElementById() { return null; } },
  createSam3BrowserImageRuntime(options) { adapterOptions = options; return { close() {} }; },
});
assert.equal(adapterOptions.yield, undefined, 'without a host hook the route must retain its default cooperative yield');
const hostYield = () => {};
window.sam3CooperativeYield = hostYield;
assert.equal(adapterOptions.yield, hostYield, 'the compatibility page must observe a host hook installed after module load');
console.log('SAM host runtime lifecycle contracts passed');
