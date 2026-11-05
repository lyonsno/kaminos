// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  withKaminosGpu,
  AdapterIdentityError,
  ShaderCompileError,
  GpuValidationError,
} from '../tools/shader-herder.mjs';

test('withKaminosGpu validates Apple Metal-3 adapter identity and rejects non-matching vendor in both hardware and Seatbelt modes', async () => {
  const evidence = [];
  const res = await withKaminosGpu(
    async (ctx) => ctx.adapterInfo,
    {
      onEvidence: (record) => evidence.push(record),
      wgslSources: [
        {
          label: 'bridge-smoke',
          code: '@compute @workgroup_size(1) fn main() { while (false) {} }',
          entryPoint: 'main',
          instrumentLoops: true,
        },
      ],
    }
  );
  const observedAdapter = res?.metalAdapterInfo ?? res;
  assert.equal(observedAdapter.vendor, 'apple');
  assert.equal(observedAdapter.architecture, 'metal-3');
  assert.equal(observedAdapter.isFallbackAdapter, false);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].route, res?.seatbeltFallback ? 'compiler-only' : 'hardware');
  assert.equal(evidence[0].source.requested, 'installed-package');

  await assert.rejects(
    () => withKaminosGpu(async () => {}, { requiredVendor: 'nvidia-nonexistent' }),
    (err) => {
      assert.ok(err instanceof AdapterIdentityError);
      assert.match(err.message, /vendor mismatch/);
      return true;
    }
  );
});

test('withKaminosGpu Seatbelt fallback compiles and validates pipelines on backend=null and fails loud on invalid WGSL, bad entryPoint, or strict mode', async () => {
  const prevForce = process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK;
  const prevStrict = process.env.SHADER_HERDER_STRICT_METAL;
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK = '1';
    delete process.env.SHADER_HERDER_STRICT_METAL;

    let fallbackHookRan = false;
    const evidence = [];
    const validRes = await withKaminosGpu(
      async () => {
        throw new Error('Should not execute hardware body when Seatbelt fallback triggers');
      },
      {
        onEvidence: (record) => evidence.push(record),
        wgslSources: [
          {
            label: 'seatbelt-valid-pipeline',
            code: '@compute @workgroup_size(1) fn main() { for (var i = 0u; i < 2u; i++) {} }',
            entryPoint: 'main',
            instrumentLoops: true,
          },
        ],
        async onSeatbeltFallback(nullCtx) {
          assert.equal(nullCtx.seatbeltFallback, true);
          assert.equal(nullCtx.metalAdapterInfo?.vendor, 'apple');
          fallbackHookRan = true;
        },
      }
    );
    assert.equal(validRes.seatbeltFallback, true);
    assert.equal(fallbackHookRan, true);
    assert.equal(evidence.length, 1);
    assert.equal(evidence[0].route, 'compiler-only');
    assert.equal(evidence[0].authority, 'compile-and-pipeline-validation-only');
    assert.ok(warnings.some((w) => w.includes('kaminos-test-warning:')));

    await assert.rejects(
      () =>
        withKaminosGpu(async () => {}, {
          wgslSources: ['@compute @workgroup_size(1) fn main() { let x: f32 = "bad"; }'],
        }),
      (err) => {
        assert.ok(err instanceof ShaderCompileError);
        return true;
      }
    );

    await assert.rejects(
      () =>
        withKaminosGpu(async () => {}, {
          wgslSources: [
            {
              label: 'seatbelt-bad-entrypoint',
              code: '@compute @workgroup_size(1) fn main() {}',
              entryPoint: 'nonExistentEntry',
            },
          ],
        }),
      (err) => {
        assert.ok(err instanceof GpuValidationError);
        return true;
      }
    );

    process.env.SHADER_HERDER_STRICT_METAL = '1';
    await assert.rejects(
      () =>
        withKaminosGpu(async () => {}, {
          wgslSources: ['@compute @workgroup_size(1) fn main() {}'],
        }),
      (err) => {
        assert.ok(err instanceof AdapterIdentityError);
        assert.equal(err.code, 'ERR_METAL_SANDBOX_SHARED_EVENT');
        return true;
      }
    );
  } finally {
    console.warn = origWarn;
    if (prevForce === undefined) delete process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK;
    else process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK = prevForce;
    if (prevStrict === undefined) delete process.env.SHADER_HERDER_STRICT_METAL;
    else process.env.SHADER_HERDER_STRICT_METAL = prevStrict;
  }
});
