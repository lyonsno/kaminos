// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  withKaminosGpu,
  AdapterIdentityError,
  ShaderCompileError,
  GpuValidationError,
} from '../tools/shader-herder.mjs';

test('withKaminosGpu validates Apple adapter identity and rejects non-matching vendor in both hardware and Seatbelt modes', async () => {
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
  assert.equal(observedAdapter.isFallbackAdapter, false);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].route, res?.seatbeltFallback ? 'compiler-only' : 'hardware');
  assert.equal(evidence[0].source.requested, 'installed-package');
  assert.deepEqual(evidence[0].adapterInfo, res?.seatbeltFallback ? res.adapterInfo : observedAdapter);

  await assert.rejects(
    () => withKaminosGpu(async () => {}, { requiredVendor: 'nvidia-nonexistent' }),
    (err) => {
      assert.ok(err instanceof AdapterIdentityError);
      assert.match(err.message, /vendor mismatch/);
      return true;
    }
  );
});

test('explicit null backend cannot invoke the hardware callback or receive hardware authority, including strict mode', async () => {
  const previous = process.env.SHADER_HERDER_STRICT_METAL;
  try {
    for (const strict of ['0', '1']) {
      process.env.SHADER_HERDER_STRICT_METAL = strict;
      const evidence = [];
      let hardwareRan = false;
      await assert.rejects(() => withKaminosGpu(async () => { hardwareRan = true; }, {
        requiredVendor: null,
        allowFallbackAdapter: true,
        dawnFlags: ['backend=null'],
        onEvidence: (record) => evidence.push(record),
      }), (error) => error instanceof AdapterIdentityError && error.code === 'ERR_KAMINOS_HARDWARE_REQUIRED');
      assert.equal(hardwareRan, false);
      assert.deepEqual(evidence, []);
    }
  } finally {
    if (previous === undefined) delete process.env.SHADER_HERDER_STRICT_METAL;
    else process.env.SHADER_HERDER_STRICT_METAL = previous;
  }
});

test('fallback rejects missing, blank and unbound validation work without publishing authority', async () => {
  const previousForce = process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK;
  const previousStrict = process.env.SHADER_HERDER_STRICT_METAL;
  const previousWarn = console.warn;
  try {
    // These expected rejection cases deliberately simulate the sandbox restriction.
    console.warn = () => {};
    process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK = '1';
    delete process.env.SHADER_HERDER_STRICT_METAL;
    for (const sources of [undefined, [], [''], [' \n '], ['// placeholder'],
      ['@compute @workgroup_size(1) fn main() {}']]) {
      const evidence = [];
      let fallbackRan = false;
      await assert.rejects(() => withKaminosGpu(async () => {
        throw new Error('hardware callback must not run');
      }, {
        ...(sources === undefined ? {} : { wgslSources: sources }),
        onSeatbeltFallback: () => { fallbackRan = true; },
        onEvidence: (record) => evidence.push(record),
      }), (error) => error instanceof GpuValidationError && /fallback.*validation/i.test(error.message));
      assert.equal(fallbackRan, false);
      assert.deepEqual(evidence, []);
    }
  } finally {
    console.warn = previousWarn;
    if (previousForce === undefined) delete process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK;
    else process.env.SHADER_HERDER_FORCE_SEATBELT_FALLBACK = previousForce;
    if (previousStrict === undefined) delete process.env.SHADER_HERDER_STRICT_METAL;
    else process.env.SHADER_HERDER_STRICT_METAL = previousStrict;
  }
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
    assert.deepEqual(evidence[0].validation, { shaderModules: 2, computePipelines: 2 });
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
