import { buildSparseSamplerPlan, createTrellisSparseSamplerAdapter } from './sparse-sampler.js';
export {buildSLatScalePlan,createTrellisSLatScaleAdapter,SLAT_NORMALIZATION_SOURCE} from './slat-scale.js';

export const SLAT_SAMPLER_ROUTE = 'trellis2.slat-sampler.webgpu.v0';

export function slatSamplerConfig(config = {}) {
  const { mode = 'shape', tokenRows } = config;
  if (!Number.isSafeInteger(tokenRows) || tokenRows < 1) throw new RangeError('tokenRows must be a positive integer');
  if (!['shape', 'texture'].includes(mode)) throw new RangeError('SLat mode must be shape or texture');
  return { steps: 12, guidanceStrength: mode === 'texture' ? 1 : 7.5,
    guidanceRescale: mode === 'texture' ? 0 : 0.5, guidanceInterval: mode === 'texture' ? [0.6, 0.9] : [0.6, 1],
    rescaleT: 3, sigmaMin: 1e-5, ...config };
}

export function buildSLatSamplerPlan(config = {}) {
  return buildSparseSamplerPlan(slatSamplerConfig(config));
}

export function createTrellisSLatSamplerAdapter({ config = {}, flow, ...options }) {
  if (flow?.plan?.tokenRows !== config.tokenRows || flow?.plan?.mode !== (config.mode ?? 'shape')) {
    throw new TypeError('SLat model and sampler geometry/mode must match');
  }
  return createTrellisSparseSamplerAdapter({ ...options, flow, config: slatSamplerConfig(config) });
}
