import path from 'node:path';
import { pathToFileURL } from 'node:url';

const entry = process.env.SHADER_HERDER_ROOT
  ? pathToFileURL(path.resolve(process.env.SHADER_HERDER_ROOT, 'src/index.mjs')).href
  : import.meta.resolve('@kaminos/shader-herder');
export const shaderHerderSource = Object.freeze({
  requested: process.env.SHADER_HERDER_ROOT || 'installed-package',
  entry,
});
const shaderHerder = await import(entry);

export const {
  createGpuTestContext,
  withGpuErrorScopes,
  AdapterIdentityError,
  ShaderCompileError,
  GpuValidationError,
  instrumentWgslLoops,
  runInstrumentedCompute,
  ShaderLoopTripwireError,
  extractWgslFunction,
  extractWgslBlock,
  stripWgslBlock,
  evalWgslBatch,
  WatchdogCliffError,
} = shaderHerder;

function attachWebGpuGlobals(ctx) {
  ctx.GPUBufferUsage = globalThis.GPUBufferUsage;
  ctx.GPUMapMode = globalThis.GPUMapMode;
  ctx.GPUTextureUsage = globalThis.GPUTextureUsage;
  ctx.GPUShaderStage = globalThis.GPUShaderStage;
  return ctx;
}

/**
 * Runs `fn(ctx)` against a native Apple WebGPU context and ensures
 * deterministic device destruction.
 *
 * When invoked inside an external macOS Seatbelt `--sandbox` where
 * `MTLSharedEvent` creation returns `nil` (`ERR_METAL_SANDBOX_SHARED_EVENT`)
 * after adapter vendor verification succeeds, falls back to Dawn's
 * `backend=null` Tint compiler + WebGPU pipeline validation scopes on
 * `wgslSources` and `onSeatbeltFallback(nullCtx)` (unless
 * `SHADER_HERDER_STRICT_METAL=1` is set) while emitting an explicit
 * `kaminos-test-warning` lowering evidence authority to compile/pipeline
 * validation. Fallback requires nonblank WGSL and an explicit compute entry
 * point whose pipeline is actually validated. All other adapter/vendor/fallback failures throw loud
 * unconditionally.
 */
export async function withKaminosGpu(
  fn,
  {
    wgslSources = [],
    onSeatbeltFallback = null,
    requiredVendor = 'apple',
    onEvidence = null,
    ...options
  } = {}
) {
  async function recordEvidence(context, route, validation = null) {
    const record = {
      source: shaderHerderSource,
      route,
      authority: route === 'hardware' ? 'hardware-execution' : 'compile-and-pipeline-validation-only',
      adapterInfo: context.adapterInfo,
      ...(validation ? { validation } : {}),
      ...(context.metalAdapterInfo ? { metalAdapterInfo: context.metalAdapterInfo } : {}),
    };
    console.log(`shader-herder-evidence: ${JSON.stringify(record)}`);
    if (onEvidence) await onEvidence(record);
  }
  let ctx = null;
  try {
    ctx = await createGpuTestContext({ requiredVendor, ...options });
  } catch (err) {
    if (
      err?.code === 'ERR_METAL_SANDBOX_SHARED_EVENT' &&
      process.env.SHADER_HERDER_STRICT_METAL !== '1'
    ) {
      if (!Array.isArray(wgslSources) || wgslSources.length === 0 ||
          wgslSources.some((item) => {
            const code = typeof item === 'string' ? item : item?.code;
            return typeof code !== 'string' || code.trim().length === 0;
          })) {
        throw new GpuValidationError('Compiler-only fallback requires declared nonblank WGSL validation work; hardware callback was not run.');
      }
      console.warn(
        'kaminos-test-warning: Metal MTLSharedEvent blocked by external Seatbelt sandbox (authority=compile-and-pipeline-validation-only); verifying WGSL and pipelines via Dawn backend=null'
      );
      const nullCtx = attachWebGpuGlobals(
        await createGpuTestContext({
          allowFallbackAdapter: true,
          requiredVendor: null,
          dawnFlags: ['backend=null'],
        })
      );
      nullCtx.seatbeltFallback = true;
      nullCtx.metalAdapterInfo = err?.details?.adapterInfo ?? null;
      const validation = { shaderModules: 0, computePipelines: 0 };
      try {
        for (let i = 0; i < wgslSources.length; i++) {
          const item = wgslSources[i];
          const code = typeof item === 'string' ? item : item.code;
          const label = typeof item === 'string' ? `seatbelt-wgsl-${i}` : item.label || `seatbelt-wgsl-${i}`;
          const entryPoint = typeof item === 'object' && item !== null ? item.entryPoint : null;
          const constants = typeof item === 'object' && item !== null ? item.constants : undefined;
          const checkInstrumented = typeof item === 'object' && item !== null ? Boolean(item.instrumentLoops) : false;

          const mod = await nullCtx.compileShaderModule({ label, code });
          validation.shaderModules++;
          if (entryPoint) {
            await withGpuErrorScopes(nullCtx.device, `${label}-pipeline`, async () => {
              nullCtx.device.createComputePipeline({
                label: `${label}-pipeline`,
                layout: 'auto',
                compute: {
                  module: mod,
                  entryPoint,
                  ...(constants ? { constants } : {}),
                },
              });
            });
            validation.computePipelines++;
          }
          if (checkInstrumented) {
            const inst = instrumentWgslLoops(code, { maxIterations: 512 });
            const instMod = await nullCtx.compileShaderModule({
              label: `${label}-instrumented`,
              code: inst.code,
            });
            validation.shaderModules++;
            if (entryPoint) {
              await withGpuErrorScopes(nullCtx.device, `${label}-instrumented-pipeline`, async () => {
                nullCtx.device.createComputePipeline({
                  label: `${label}-instrumented-pipeline`,
                  layout: 'auto',
                  compute: {
                    module: instMod,
                    entryPoint,
                    ...(constants ? { constants } : {}),
                  },
                });
              });
              validation.computePipelines++;
            }
          }
        }
        if (validation.computePipelines === 0) {
          throw new GpuValidationError('Compiler-only fallback validation requires an explicit compute entryPoint; hardware callback was not run.');
        }
        if (typeof onSeatbeltFallback === 'function') {
          await onSeatbeltFallback(nullCtx);
        }
        await recordEvidence(nullCtx, 'compiler-only', validation);
        return {
          seatbeltFallback: true,
          adapterInfo: nullCtx.adapterInfo,
          metalAdapterInfo: nullCtx.metalAdapterInfo,
        };
      } finally {
        nullCtx.destroy();
      }
    }
    throw err;
  }

  try {
    if (ctx.adapterInfo.vendor !== 'apple' || ctx.adapterInfo.isFallbackAdapter) {
      throw new AdapterIdentityError('withKaminosGpu requires an Apple hardware adapter before invoking its hardware callback.', {
        code: 'ERR_KAMINOS_HARDWARE_REQUIRED', adapterInfo: ctx.adapterInfo,
      });
    }
    attachWebGpuGlobals(ctx);
    const result = await fn(ctx);
    await recordEvidence(ctx, 'hardware');
    return result;
  } finally {
    ctx.destroy();
  }
}
