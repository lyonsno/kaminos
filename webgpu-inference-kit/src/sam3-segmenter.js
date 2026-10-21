import { createSam3BrowserImageRuntime } from './sam3-browser-image-runtime.js';
import { createSam3SourceMask } from './sam3-source-mask.js';

async function imageDimensions(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

export function createSam3Segmenter({ manifestUrl, baseUrl = globalThis.location?.href,
  inferenceSession, yield: yieldToBrowser, onProgress, crypto = globalThis.crypto, services = {} } = {}) {
  const model = new URL(manifestUrl, baseUrl);
  if (!manifestUrl || !['http:', 'https:'].includes(model.protocol)
      || model.origin !== new URL(baseUrl).origin) throw new Error('SAM manifest must be a same-origin HTTP URL');
  const decode = services.decodeImage || imageDimensions;
  const createUrl = services.createObjectURL || (blob => URL.createObjectURL(blob));
  const revokeUrl = services.revokeObjectURL || (url => URL.revokeObjectURL(url));
  const makeRuntime = services.createRuntime || createSam3BrowserImageRuntime;
  const hash = async bytes => `sha256:${Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    value => value.toString(16).padStart(2, '0')).join('')}`;
  let runtime, active = null, closing = null, closed = false, device = null, fatal = null;
  const gpuError = event => { fatal = new Error(`SAM WebGPU error: ${event.error.message}`); };
  function observeExecution(context) {
    if (device === context.device) return;
    device?.removeEventListener?.('uncapturederror', gpuError);
    device = context.device;
    const observed = device;
    device.addEventListener?.('uncapturederror', gpuError);
    device.lost.then(info => {
      if (device === observed) fatal = new Error(`SAM WebGPU device lost: ${info.reason}: ${info.message}`);
    });
  }
  async function segment(image, prompt) {
    if (closed) throw new Error('SAM segmenter is closed');
    if (fatal) throw fatal;
    if (active) throw new Error('SAM segmentation already in flight');
    if (!(image instanceof Blob) || !image.size) throw new Error('SAM image must be a non-empty Blob or File');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('SAM text prompt is required');
    const run = (async () => {
      const sha256 = await hash(await image.arrayBuffer());
      const url = createUrl(image);
      try {
        const { width, height } = await decode(url);
        if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('SAM image dimensions are invalid');
        const request = { invocationId: crypto.randomUUID(), promptText: prompt.trim(),
          promptSha256: await hash(new TextEncoder().encode(prompt.trim())), verificationMode: 'execution-only',
          sourceImage: { url, sha256, artifactId: `image:${sha256.slice(7)}`, encodedResolution: [width, height] } };
        if (fatal) throw fatal;
        runtime ||= makeRuntime({ baseUrl, inferenceSession, yield: yieldToBrowser,
          onStatus: onProgress, onExecutionContext: observeExecution });
        const output = await runtime.run(model.href, request);
        if (fatal) throw fatal;
        if (output?.invocationId !== request.invocationId) throw new Error('SAM output invocation mismatch');
        if (output.promptText !== request.promptText || output.promptSha256 !== request.promptSha256) {
          throw new Error('SAM output prompt mismatch');
        }
        if (output.sourceImage?.sha256 !== sha256 || output.sourceImage?.artifactId !== request.sourceImage.artifactId
            || JSON.stringify(output.sourceImage?.encodedResolution) !== JSON.stringify([width, height])) {
          throw new Error('SAM output image mismatch');
        }
        if (output.outputAuthority !== 'actual-webgpu-readback' || output.verificationState !== 'not-attached'
            || !output.requestedRouteId || output.requestedRouteId !== output.effectiveRouteId
            || !Array.isArray(output.instances)) throw new Error('SAM output route or authority mismatch');
        const indices = output.instances.map(instance => instance.index);
        if (new Set(indices).size !== indices.length || indices.some(n => !Number.isSafeInteger(n) || n < 0)) {
          throw new Error('SAM output instance identity mismatch');
        }
        for (const instance of output.instances) {
          if (!Number.isFinite(instance.score) || !Array.isArray(instance.box) || instance.box.length !== 4
              || instance.box.some(n => !Number.isFinite(n))) throw new Error('SAM output score or box is invalid');
        }
        // Validate even an empty result; no placeholder mask can stand in for inference.
        if (![output.width, output.height].every(n => Number.isSafeInteger(n) && n > 0)) {
          throw new Error('SAM output dimensions are invalid');
        }
        createSam3SourceMask(output, indices, width, height);
        return Object.freeze({ ...output, sourceSize: Object.freeze({ width, height }),
          mask: (selected = indices) => createSam3SourceMask(output, selected, width, height) });
      } finally { revokeUrl(url); }
    })();
    active = run;
    try { return await run; } finally { if (active === run) active = null; }
  }
  function close() {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      try { await active; } catch { /* The invocation keeps its own failure. */ }
      device?.removeEventListener?.('uncapturederror', gpuError);
      device = null;
      await runtime?.close();
    })();
    return closing;
  }
  return Object.freeze({ segment, close });
}
