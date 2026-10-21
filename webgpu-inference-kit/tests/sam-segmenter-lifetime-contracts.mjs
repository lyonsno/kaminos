// kaminos-test: node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createSam3Segmenter } from '../src/sam3-segmenter.js';

if (!globalThis.gc) {
  const child = spawnSync(process.execPath, ['--expose-gc', fileURLToPath(import.meta.url)], { encoding: 'utf8' });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
  console.log(child.stdout.trim());
} else {
  for (const failClose of [false, true]) {
    let weak, closes = 0;
    const segmenter = createSam3Segmenter({ manifestUrl: '/model.json', baseUrl: 'https://app.test/',
      services: { decodeImage: async () => ({ width: 2, height: 1 }),
        createObjectURL: () => 'blob:https://app.test/image', revokeObjectURL() {},
        createRuntime() {
          const runtime = { async run(_url, input) { return { invocationId: input.invocationId,
            promptText: input.promptText, promptSha256: input.promptSha256, sourceImage: input.sourceImage,
            outputAuthority: 'actual-webgpu-readback', verificationState: 'not-attached',
            requestedRouteId: 'fixture', effectiveRouteId: 'fixture', width: 1, height: 1, instances: [] }; },
          async close() { closes += 1; if (failClose) throw new Error('fixture teardown failed'); } };
          weak = new WeakRef(runtime);
          return runtime;
        } } });
    const result = await segmenter.segment(new Blob(['source']), 'wheel');
    if (failClose) await assert.rejects(segmenter.close(), /fixture teardown failed/);
    else await segmenter.close();
    // Weak references are kept alive for the current job; collect on later turns.
    await nextTurn(); globalThis.gc();
    await nextTurn(); globalThis.gc();
    assert.equal(weak.deref(), undefined, `closed segmenter retains runtime (teardown failure=${failClose})`);
    assert.deepEqual([...result.mask()], [0, 0], 'returned masks remain usable');
    await assert.rejects(segmenter.segment(new Blob(['source']), 'wheel'), /closed/);
    if (failClose) await assert.rejects(segmenter.close(), /fixture teardown failed/);
    else await segmenter.close();
    assert.equal(closes, 1, 'close remains idempotent after releasing the runtime reference');
  }
  console.log('SAM segmenter retained-wrapper lifetime contracts passed');
}
