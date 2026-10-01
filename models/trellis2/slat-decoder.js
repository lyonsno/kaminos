import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
import { createSLatDecoderKernelOps } from './slat-decoder-ops.js';
export const SLAT_DECODER_ROUTE = 'trellis2.slat-decoder.webgpu.v0';

export function buildSLatDecoderPlan({ tokenRows, resolution = 32, latentChannels = 32,
  channels = [1024, 512, 256, 128, 64], numBlocks = [4, 16, 8, 4, 0], mode = 'shape' } = {}) {
  for (const [name, value] of Object.entries({ tokenRows, resolution, latentChannels }))
    if (!Number.isSafeInteger(value) || value < 1) throw RangeError(`${name} must be a positive integer`);
  if (!['shape', 'texture'].includes(mode)) throw RangeError('shape or texture decoder mode required');
  if (!Array.isArray(channels) || !channels.length || channels.some(c => !Number.isSafeInteger(c) || c < 1)) throw RangeError('positive decoder channels required');
  if (!Array.isArray(numBlocks) || numBlocks.length !== channels.length || numBlocks.some(n => !Number.isSafeInteger(n) || n < 0)) throw RangeError('matching decoder blocks required');
  for (let i = 0; i < channels.length - 1; i++) if (channels[i] % 8 || channels[i + 1] % (channels[i] / 8)) throw RangeError('source channel-to-spatial repeat-interleave channels required');
  const outputResolution = resolution * 2 ** (channels.length - 1);
  if (!Number.isSafeInteger(outputResolution ** 3) || outputResolution ** 3 >= 2 ** 32 - 1 || tokenRows * latentChannels * 4 >= 2 ** 32 || tokenRows > resolution ** 3) throw RangeError('decoder coordinates/rows exceed u32 addressing');
  const stages = ['decoder-linear', 'decoder-hash-clear', 'decoder-hash-insert', 'decoder-neighbors', 'decoder-sparse-conv',
    'decoder-layernorm', 'decoder-silu', 'decoder-residual', 'decoder-child-counts', 'decoder-child-scan', 'decoder-child-scan-add', 'decoder-subdivision-scatter'];
  return Object.freeze({ tokenRows, resolution, latentChannels, channels: Object.freeze([...channels]), numBlocks: Object.freeze([...numBlocks]), mode,
    outChannels: mode === 'shape' ? 7 : 6, predSubdiv: mode === 'shape', outputResolution, subdivisionLevels: channels.length - 1,
    arithmetic: 'semantic-f16-torso-f32-endpoints', storage: 'f32-physical-with-explicit-half-rounding',
    weightLayout: 'source-Co-kD-kH-kW-Ci', coordinateOrder: 'parent-row-then-child-z-bit0-y-bit1-x-bit2',
    stages: Object.freeze(stages), normEpsilon: 1e-6, terminalNormEpsilon: 1e-5 });
}

export function slatDecoderWeightShapes(plan) {
  const shapes = {}, linear = (name, ci, co) => { shapes[`${name}.weight`] = [co, ci];shapes[`${name}.bias`] = [co]; },
    conv = (name, ci, co) => { shapes[`${name}.weight`] = [co, 3, 3, 3, ci];shapes[`${name}.bias`] = [co]; },
    norm = (name, c) => { shapes[`${name}.weight`] = [c];shapes[`${name}.bias`] = [c]; };
  linear('from_latent', plan.latentChannels, plan.channels[0]);
  for (let level = 0; level < plan.channels.length; level++) {
    const c = plan.channels[level];
    for (let block = 0; block < plan.numBlocks[level]; block++) {
      const key = `blocks.${level}.${block}`;conv(key + '.conv', c, c);norm(key + '.norm', c);
      linear(key + '.mlp_0', c, c * 4);linear(key + '.mlp_2', c * 4, c);
    }
    if (level < plan.channels.length - 1) {
      const key = `blocks.${level}.${plan.numBlocks[level]}`, co = plan.channels[level + 1];
      norm(key + '.norm1', c);conv(key + '.conv1', c, co * 8);conv(key + '.conv2', co, co);
      if (plan.predSubdiv) linear(key + '.to_subdiv', c, 8);
    }
  }
  linear('output_layer', plan.channels.at(-1), plan.outChannels);return shapes;
}

export function createTrellisSLatDecoderAdapter({ route, config, weights, siluTable, sampleTensor, coordinateTensor, guideSubdivisions }) {
  const runtime = route?.runtime, plan = buildSLatDecoderPlan(config), shapes = slatDecoderWeightShapes(plan);
  const admitted = (t, shape, dtype) => t?.buffer && t.dtype === dtype && (t.usage & U.storage) &&
    t.byteLength === shape.reduce((a, b) => a * b, 4) && JSON.stringify(t.shape) === JSON.stringify(shape);
  if (!admitted(sampleTensor, [plan.tokenRows, plan.latentChannels], 'f32')) throw TypeError('borrowed complete F32 shape/texture codes required');
  if (!admitted(coordinateTensor, [plan.tokenRows, 3], 'i32')) throw TypeError('borrowed complete Int32 sparse coordinates required');
  if (!(siluTable instanceof Float32Array) || siluTable.length !== 65536) throw TypeError('complete source-native FP16 SiLU table required');
  for (let i = 0; i < siluTable.length; i++) if ((i & 0x7c00) !== 0x7c00 && !Number.isFinite(siluTable[i])) throw TypeError('finite source-native SiLU outputs required for every finite half input');
  for (const [name, shape] of Object.entries(shapes)) {
    const value = weights?.[name];
    if (!(value instanceof Float32Array) || value.length !== shape.reduce((a, b) => a * b, 1) || !value.every(Number.isFinite)) throw TypeError('complete finite learned-decoder weight ' + name + ' required');
  }
  if (plan.mode === 'texture' && (!Array.isArray(guideSubdivisions) || guideSubdivisions.length !== plan.subdivisionLevels)) throw TypeError('resident complete learned shape subdivision guide required for texture');
  if (plan.mode === 'shape' && guideSubdivisions !== undefined) throw TypeError('shape uses learned subdivision, not replacement guide');
  const ops = createSLatDecoderKernelOps(runtime), parameters = {};let disposed = false, running = false, state = 'new', output, convNeXtBlocksExecuted = 0;
  const outputs = {};
  for (const name of ['features', 'coordinates', 'subdivisions']) Object.defineProperty(outputs, name, { enumerable: true, get: () => output?.[name] });
  try {
    for (const [name, shape] of Object.entries(shapes)) parameters[name] = ops.upload(name, shape, weights[name]);
    const table = ops.upload('source-half-silu', [65536], siluTable);
    const linear = (key, input, to, half, invocation) => ops.linear(input, parameters[key + '.weight'], parameters[key + '.bias'], to, half, invocation),
      conv = (key, input, neighbors, to, invocation) => ops.conv(input, neighbors, parameters[key + '.weight'], parameters[key + '.bias'], to, invocation),
      norm = (key, input, to, half, eps, invocation) => ops.norm(input, parameters[key + '.weight'], parameters[key + '.bias'], to, half, eps, invocation);
    return Object.freeze({ plan, runtime, routeId: route.routeId, inputs: Object.freeze({ sample: sampleTensor, coordinates: coordinateTensor }), outputs: Object.freeze(outputs),
      async run(invocation) {
        if (disposed) throw Error('learned decoder disposed');if (running) throw Error('learned decoder in use');
        if (state !== 'new') throw Error(state === 'failed' ? 'failed learned decoder is poisoned' : 'single learned decode already completed');
        running = true;state = 'running';
        try {
          let rows = plan.tokenRows, resolution = plan.resolution, coordinates = coordinateTensor,
            current = ops.allocate('initial-projected', [rows, plan.channels[0]]), neighbors;
          const subdivisions = [], levels = [];
          await linear('from_latent', sampleTensor, current, true, invocation);
          neighbors = await ops.neighbors(coordinates, resolution, invocation);
          for (let level = 0; level < plan.channels.length; level++) {
            const channels = plan.channels[level], blocks = plan.numBlocks[level],
              next = blocks ? ops.allocate('next-state', [rows, channels]) : undefined,
              normalized = (blocks || level < plan.subdivisionLevels) ? ops.allocate('normalized', [rows, channels]) : undefined,
              mlp = blocks ? ops.allocate('expanded-mlp', [rows, channels * 4]) : undefined;
            let other = next;
            for (let block = 0; block < blocks; block++) {
              const key = `blocks.${level}.${block}`;
              await conv(key + '.conv', current, neighbors, other, invocation);
              await norm(key + '.norm', other, normalized, true, 1e-6, invocation);
              await linear(key + '.mlp_0', normalized, mlp, true, invocation);
              await ops.silu(mlp, table, mlp, invocation);
              await linear(key + '.mlp_2', mlp, other, true, invocation);
              await ops.residual(current, other, invocation);
              [current, other] = [other, current];convNeXtBlocksExecuted++;
            }
            levels.push({ rows, resolution, channels, blocksExecuted: blocks });
            if (level === plan.subdivisionLevels) { await ops.settle();ops.release(other);ops.release(normalized);ops.release(mlp);break; }
            const key = `blocks.${level}.${blocks}`, co = plan.channels[level + 1],
              convolved = ops.allocate('pre-subdivision', [rows, co * 8]);
            let logits;
            if (plan.predSubdiv) { logits = ops.allocate('subdivision-logits', [rows, 8]);await linear(key + '.to_subdiv', current, logits, true, invocation); }
            else { logits = guideSubdivisions[level];if (!admitted(logits, [rows, 8], 'f32')) throw TypeError('matching resident shape subdivision rows required'); }
            subdivisions.push(logits);
            await norm(key + '.norm1', current, normalized, true, 1e-6, invocation);
            await ops.silu(normalized, table, normalized, invocation);
            await conv(key + '.conv1', normalized, neighbors, convolved, invocation);
            const { count, prefix } = await ops.subdivision(logits, invocation),
              expanded = ops.allocate('child-features', [count, co]), skip = ops.allocate('child-skip', [count, co]),
              nextCoordinates = ops.allocate('child-coordinates', [count, 3], 'i32');
            await ops.scatter(coordinates, current, convolved, logits, prefix, nextCoordinates, expanded, skip, invocation);
            const nextNeighbors = await ops.neighbors(nextCoordinates, resolution * 2, invocation),
              activated = ops.allocate('child-activated', [count, co]), result = ops.allocate('child-result', [count, co]);
            await ops.norm(expanded, undefined, undefined, activated, true, 1e-6, invocation);
            await ops.silu(activated, table, activated, invocation);
            await conv(key + '.conv2', activated, nextNeighbors, result, invocation);
            await ops.residual(skip, result, invocation);await ops.settle();
            for (const t of [current, other, normalized, mlp, neighbors, convolved, prefix, expanded, skip, activated]) ops.release(t);
            if (coordinates !== coordinateTensor) ops.release(coordinates);
            current = result;coordinates = nextCoordinates;neighbors = nextNeighbors;rows = count;resolution *= 2;
          }
          const normalized = ops.allocate('terminal-normalized', current.shape), features = ops.allocate('decoded-features', [rows, plan.outChannels]);
          await ops.norm(current, undefined, undefined, normalized, false, 1e-5, invocation);
          await linear('output_layer', normalized, features, false, invocation);await ops.settle();
          ops.release(current);ops.release(neighbors);ops.release(normalized);
          output = Object.freeze({ features, coordinates, subdivisions: Object.freeze(subdivisions), levels: Object.freeze(levels),
            convNeXtBlocksExecuted, convolutionsExecuted: ops.convolutionsExecuted, metadataReadbackBytes: ops.metadataReadbackBytes,
            featureBytesToCPUDuringServing: 0, coordinateBytesToCPUDuringServing: 0, arithmetic: plan.arithmetic, resolution });
          state = 'completed';return output;
        } catch (error) { state = 'failed';output = undefined;throw error; } finally { running = false; }
      },
      dispose() { if (running) throw Error('learned decoder in use');if (disposed) return;disposed = true;ops.dispose(); }
    });
  } catch (error) { ops.dispose();throw error; }
}
