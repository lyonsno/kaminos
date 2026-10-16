// Where Klein's weights live: the hosted copy on Hugging Face by default, or any base URL laid out the
// same way (te/, one transformer folder per jank level, vae/), for example a mirror or a local server.
// The levels pick the transformer: mint is int4, weathered 3-bit and off-the-rails 2-bit; they share
// the text encoder and decoder.
export const KLEIN_HOSTED_WEIGHTS = 'https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu/resolve/main';
export const KLEIN_LEVELS = Object.freeze({ mint: 'dit', weathered: 'dit-q3', 'off-the-rails': 'dit-q2' });

export function kleinWeightUrls({ base = KLEIN_HOSTED_WEIGHTS, level = 'mint' } = {}) {
  if (!Object.hasOwn(KLEIN_LEVELS, level)) {
    throw new Error(`unknown Klein level "${level}"; expected mint, weathered or off-the-rails`);
  }
  const root = String(base).replace(/\/$/, '');
  return { textEncoderUrl: `${root}/te`, transformerUrl: `${root}/${KLEIN_LEVELS[level]}`, vaeUrl: `${root}/vae` };
}
