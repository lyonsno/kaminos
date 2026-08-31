import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [basis, runtime, core, index] = await Promise.all([
  readFile(new URL('../volume-emitter-basis.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-emitter-runtime.mjs', import.meta.url), 'utf8'),
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
]);

assert.match(basis, /kaminos-volume-analytic-emitter-basis-v1/);
for (const family of ['wick', 'nozzle', 'ribbon', 'ring']) {
  assert.match(basis, new RegExp(`['\"]${family}['\"]`));
}
assert.match(runtime, /analytic-fixed/);
assert.match(core, /export function analyticEmitterInjectionDispatch/);
assert.match(core, /kaminos bounded \$\{dispatch\.family\} emitter injection/);
assert.match(core, /analyticEmitterInjectionCompilationErrors/);
assert.match(index, /volume_emitter_family/);
assert.match(index, /volumeEmitterRuntimeFrame/);
assert.match(index, /id="emitter-assay-family"/);

console.log('wake kiln analytic emitter composition contracts passed');
