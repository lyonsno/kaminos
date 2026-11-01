// Optional generation primitives; model loading and inference remain port-owned.
export { generateTokens, createGenerationSession } from './autoregressive-generation.js';
export { sampleToken, createSeededRandom } from './token-sampling.js';
