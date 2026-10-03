import assert from 'node:assert/strict';
import { adapterFixture, profile } from './helpers/arch-gpu-adapter-fixture.mjs';

for (const fault of ['compilation', 'pipeline', 'readback']) {
  const test = await adapterFixture(fault);
  await assert.rejects(test.module.createGpuArchCollapse(profile, test.renderer, { gravityRampSeconds: 0 }), new RegExp(`injected ${fault} rejection`));
  assert.equal(test.buffers.length, 6, 'failure occurs after actual adapter-buffer acquisition');
  assert.ok(test.buffers.every(buffer => buffer.destroyed === 1), `${fault} must release all acquired adapter buffers exactly once`);
  assert.deepEqual(new Set(test.destroyedAttributes), new Set(test.attributes), `${fault} must release engine storage attributes`);
}
const test = await adapterFixture();
const model = await test.module.createGpuArchCollapse(profile, test.renderer, { gravityRampSeconds: 0 });
model.dispose(); model.dispose();
assert.ok(test.buffers.every(buffer => buffer.destroyed === 1), 'successful model disposal is idempotent');
await assert.rejects(model.step(), /disposed/);
console.log('GPU adapter releases partial acquisitions and disposes successful ownership exactly once');
