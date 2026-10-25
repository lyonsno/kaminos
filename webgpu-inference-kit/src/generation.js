// Optional generation primitives; model loading and inference remain port-owned.
export { generateTokens } from './autoregressive-generation.js';
export { sampleToken, createSeededRandom } from './token-sampling.js';
