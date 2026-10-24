// FLUX.3 Klein text-to-image in the browser: tokenizer -> Qwen3-VL text encoder (FLUX.2 Klein's
// encoder, layers 0-31) -> 16-step flow-map transformer -> FLUX.2's VAE decoder (FLUX.3 ships the
// same decoder at higher precision; FLUX.2 Klein's f16 pack is it at bf16). Everything but the model
// hooks (transformer class, prompt framing, RoPE ids, schedule) is KleinPipeline's: weight caching
// and progress, lean residency, pipeline precompile, prompt-embedding reuse, live previews (the
// latent space is the same) and decoding. Noise comes from KleinPipeline's seeded Gaussian.
import { KleinPipeline } from '../flux2-klein/klein-pipeline.js';
import { Flux3Transformer, flux3ImageIds, flux3TextIds } from './flux3-transformer.js';
import { flux3Schedule } from './flux3-schedule.js';
import { transformerTime } from '../flux2-klein/klein-schedule.js';
import { flux3PromptIds, FLUX3_PAD_MULTIPLE } from './flux3-prompt.js';

export const FLUX3_DEFAULT_STEPS = 16;

export class Flux3Pipeline extends KleinPipeline {
  // Weight roots are required until a hosted FLUX.3 set exists: textEncoderUrl (pack-text-encoder.py
  // with the FLUX.3 layout), transformerUrl (pack-flux3-transformer.py), vaeUrl (FLUX.2 Klein's VAE).
  constructor(device, { textEncoderUrl, transformerUrl, vaeUrl, encoderUrl, ...options } = {}) {
    if (!textEncoderUrl || !transformerUrl || !vaeUrl) throw new Error('Flux3Pipeline needs textEncoderUrl, transformerUrl and vaeUrl');
    super(device, { textEncoderUrl, transformerUrl, vaeUrl, ...options });
    this.encoderUrl = encoderUrl ?? `${vaeUrl.replace(/\/$/, '').replace(/[^/]+$/, '')}encoder`;
  }

  async encodeReference({rgb,width,height}) {
    if (this.ditManifest.mode !== 'text-and-image') throw Error('This FLUX.3 weight package omits reference conditioning; mount a package built with --include-reference');
    return super.encodeReference({rgb,width,height});
  }

  referenceIds(height,width) {return flux3ImageIds(height,width,-1);}

  createTransformer(manifest) { return new Flux3Transformer(this.device, manifest); }

  // FLUX.3 pads to the next multiple of 80 and attends to the padding, so the length is the model's,
  // not the caller's; textLength is ignored.
  requestedTextTokens(prompt) {
    return Math.ceil(this.framePrompt(prompt).length / FLUX3_PAD_MULTIPLE) * FLUX3_PAD_MULTIPLE;
  }

  framePrompt(prompt, maxLength = undefined) { return flux3PromptIds(this.tokenizer, prompt, maxLength ? { maxLength } : {}); }

  tokenIds(latH, latW, txtTokens) { return { imgIds: flux3ImageIds(latH, latW), txtIds: flux3TextIds(txtTokens) }; }

  // The packed weights record their sampling recipe: the distilled flow map at shift 6.93 and 16
  // steps, the base with the 4-step distill LoRA merged at shift 3 and 4 steps.
  get sampling() { return this.ditManifest?.sampling ?? { shift: 6.93, steps: FLUX3_DEFAULT_STEPS }; }

  denoiseSchedule(imgTokens, steps) {
    const s = flux3Schedule(steps, this.sampling.shift);
    // The pipeline hands the transformer t / 1000 and the transformer multiplies by 1000, both in f32.
    return { sigmas: s.sigmas, forwardArgs: i => ({ tModel: transformerTime(s.timesteps[i]), targetModel: transformerTime(Math.fround(s.targets[i] * 1000)) }) };
  }

  generate(options) { return super.generate({ steps: this.sampling.steps, ...options }); }
}
