/**
 * WebGPU initialization and device management.
 */

let activeBufferAllocationSink = null;

function recordBufferAllocation(buffer, size, label) {
  if (activeBufferAllocationSink) {
    activeBufferAllocationSink.push({
      buffer,
      size: Math.ceil(size / 4) * 4,
      label: label || buffer.label || '',
    });
  }
  return buffer;
}

/**
 * Capture buffers allocated synchronously through this module while `fn` runs.
 * The caller owns retirement; nested scopes restore the outer sink afterward.
 */
function captureGpuBufferAllocations(fn) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  const previous = activeBufferAllocationSink;
  const allocations = [];
  activeBufferAllocationSink = allocations;
  try {
    return { value: fn(), allocations };
  } catch (error) {
    const cleanupErrors = [];
    for (const allocation of allocations) {
      try {
        allocation.buffer.destroy();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError.message);
      }
    }
    const cleanup = Object.freeze({
      retiredCount: allocations.length - cleanupErrors.length,
      cleanupErrors: Object.freeze(cleanupErrors),
    });
    if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
      try {
        Object.defineProperty(error, 'gpuAllocationCleanup', {
          configurable: true,
          enumerable: true,
          value: cleanup,
        });
      } catch {
        // Cleanup remains complete even when the thrown object is immutable.
      }
    }
    throw error;
  } finally {
    activeBufferAllocationSink = previous;
  }
}

/**
 * Acquire the GPU for SF3D.
 *
 * A host that already owns a live GPUDevice (the Kaminos kiln, whose renderer
 * must share one device and queue with inference) injects it:
 *   initGPU({ device, adapter })  → { device, adapter, injected: true }
 * SF3D then never requests its own device, so its cooperative duties and the
 * host's frames interleave on the same queue. Without injection SF3D requests
 * a high-performance adapter/device as before.
 */
async function initGPU({ device: injectedDevice, adapter: injectedAdapter = null } = {}) {
  if (injectedDevice != null) {
    if (typeof injectedDevice !== 'object' || typeof injectedDevice.queue?.submit !== 'function') {
      throw new Error('injected device must expose queue.submit (a live GPUDevice)');
    }
    return { adapter: injectedAdapter, device: injectedDevice, injected: true };
  }
  if (!globalThis.navigator?.gpu) {
    throw new Error('WebGPU is not supported in this browser. Try Chrome 113+ or Edge 113+.');
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) {
    throw new Error('No WebGPU adapter found. Your GPU may not support WebGPU.');
  }

  // Request max limits for large model inference
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup: adapter.limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupSizeX: adapter.limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: adapter.limits.maxComputeWorkgroupSizeY,
    },
  });

  device.lost.then((info) => {
    console.error('WebGPU device lost:', info.message);
    if (info.reason !== 'destroyed') ;
  });

  return { adapter, device, injected: false };
}

/**
 * Create a storage buffer initialized with data.
 */
function createStorageBuffer(device, data, usage = 0, label = '') {
  if (data.byteLength % 4 !== 0) {
    console.warn(`createStorageBuffer: non-4-aligned size ${data.byteLength} (label: ${label})`);
  }
  const size = Math.ceil(data.byteLength / 4) * 4;
  const buffer = device.createBuffer({
    size, // ensure 4-byte alignment
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | usage,
    mappedAtCreation: true,
    label: label || `storage_${data.byteLength}`,
  });
  new (data.constructor)(buffer.getMappedRange()).set(data);
  buffer.unmap();
  return recordBufferAllocation(buffer, size, label);
}

/**
 * Create an empty storage buffer.
 */
function createEmptyBuffer(device, size, usage = 0, label = '') {
  if (size % 4 !== 0) {
    console.warn(`createEmptyBuffer: non-4-aligned size ${size} (label: ${label})`);
  }
  const alignedSize = Math.ceil(size / 4) * 4;
  const buffer = device.createBuffer({
    size: alignedSize,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | usage,
    mappedAtCreation: false,
    label: label || `empty_${size}`,
  });
  return recordBufferAllocation(buffer, alignedSize, label);
}

/**
 * Read back buffer contents to CPU.
 */
async function readBuffer(device, buffer, size) {
  const staging = device.createBuffer({
    size,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(buffer, 0, staging, 0, size);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const result = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return result;
}

/**
 * weights.js — Load SF3D weights from flat binary format.
 *
 * Binary format (from convert_weights.py):
 *   Header: 4 (magic) + 4 (version) + 4 (num_tensors) + 4 (header_size) = 16 bytes
 *   Tensor table: num_tensors × 160 bytes each
 *     128 bytes: name (null-padded ASCII)
 *     4 bytes: dtype (0=fp32, 1=fp16)
 *     4 bytes: ndim
 *     16 bytes: shape (4 x u32)
 *     4 bytes: offset
 *     4 bytes: size
 *   Weight data: packed tensors
 */


const MAGIC = 0x33445346; // "SF3D" in little-endian
const ENTRY_SIZE = 160;

function parseHeader(buffer) {
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid weight file magic: 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`);
  }
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`Unsupported weight file version: ${version}`);

  const numTensors = view.getUint32(8, true);
  const headerSize = view.getUint32(12, true);

  const tensors = new Map();
  for (let i = 0; i < numTensors; i++) {
    const off = 16 + i * ENTRY_SIZE;
    const nameBytes = new Uint8Array(buffer, off, 128);
    let nameEnd = nameBytes.indexOf(0);
    if (nameEnd === -1) nameEnd = 128;
    const name = new TextDecoder().decode(nameBytes.slice(0, nameEnd));

    const dtype = view.getUint32(off + 128, true);
    const ndim = view.getUint32(off + 132, true);
    const shape = [];
    for (let d = 0; d < ndim; d++) {
      shape.push(view.getUint32(off + 136 + d * 4, true));
    }
    const dataOffset = view.getUint32(off + 152, true);
    const size = view.getUint32(off + 156, true);
    tensors.set(name, { dtype, shape, offset: dataOffset + headerSize, size });
  }

  return { tensors, headerSize };
}

function fp16ToFp32(h) {
  const sign = (h >> 15) & 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) {
    if (mant === 0) return sign ? -0 : 0.0;
    let val = mant / 1024.0 * Math.pow(2, -14);
    return sign ? -val : val;
  }
  if (exp === 31) return mant === 0 ? (sign ? -Infinity : Infinity) : NaN;
  const val = Math.pow(2, exp - 15) * (1 + mant / 1024.0);
  return sign ? -val : val;
}

function extractTensor(device, buffer, info) {
  const { dtype, offset, size } = info;
  const raw = extractBytes(buffer, offset, size);
  if (dtype === 0) {
    // fp32 — raw bytes are already float32
    const fp32 = new Float32Array(raw.buffer, raw.byteOffset, size / 4);
    return createStorageBuffer(device, fp32);
  } else {
    const fp16 = new Uint16Array(raw.buffer, raw.byteOffset, size / 2);
    const fp32 = new Float32Array(fp16.length);
    for (let i = 0; i < fp16.length; i++) fp32[i] = fp16ToFp32(fp16[i]);
    return createStorageBuffer(device, fp32);
  }
}

function extractTensorCPU(buffer, info) {
  const { dtype, offset, size } = info;
  const raw = extractBytes(buffer, offset, size);
  if (dtype === 0) {
    const fp32 = new Float32Array(raw.buffer, raw.byteOffset, size / 4);
    return new Float32Array(fp32); // copy to decouple from chunk
  }
  const fp16 = new Uint16Array(raw.buffer, raw.byteOffset, size / 2);
  const fp32 = new Float32Array(fp16.length);
  for (let i = 0; i < fp16.length; i++) fp32[i] = fp16ToFp32(fp16[i]);
  return fp32;
}

/**
 * Extract a byte range from the chunked buffer.
 * Returns a Uint8Array view if the range falls within a single chunk,
 * otherwise copies into a new buffer (only for tensors that span chunk boundaries).
 */
/** Families read lazily through the raw accessors after load (CLIP estimator, CPU heads). */
const LAZILY_READ_TENSOR_PREFIXES = Object.freeze(['image_estimator.']);

/**
 * After the eager builders have uploaded their tensors, copy out only the
 * tensors that will still be read lazily (retainPrefixes) or were never
 * consumed, then release the streamed chunks so ~2 GB of JS heap can go.
 * Returns { retained: Map<name, Uint8Array copy>, rawBytes(name), retainedBytes, droppedBytes }.
 */
function compactRetainedTensors(tensors, chunkedBuffer, consumed, retainPrefixes = LAZILY_READ_TENSOR_PREFIXES) {
  const retained = new Map();
  let retainedBytes = 0;
  let droppedBytes = 0;
  for (const [name, info] of tensors) {
    const keep = !consumed.has(name) || retainPrefixes.some(prefix => name.startsWith(prefix));
    if (keep) {
      retained.set(name, extractBytes(chunkedBuffer, info.offset, info.size).slice());
      retainedBytes += info.size;
    } else {
      droppedBytes += info.size;
    }
  }
  if (Array.isArray(chunkedBuffer?.chunks)) { chunkedBuffer.chunks.length = 0; chunkedBuffer.offsets.length = 0; }
  const rawBytes = (name) => {
    const bytes = retained.get(name);
    if (!bytes) {
      throw new Error(tensors.has(name)
        ? `tensor ${name} was uploaded at load and its raw bytes were released; lazy raw access covers ${retainPrefixes.join(', ')}`
        : `Missing weight: ${name}`);
    }
    return bytes;
  };
  return { retained, rawBytes, retainedBytes, droppedBytes };
}

function extractBytes(chunkedBuffer, offset, size) {
  if (chunkedBuffer instanceof ArrayBuffer) {
    // Legacy single-buffer path
    return new Uint8Array(chunkedBuffer, offset, size);
  }
  // chunkedBuffer is { chunks, offsets, totalSize }
  const { chunks, offsets } = chunkedBuffer;

  // Find the first chunk that contains the start
  let startChunk = -1;
  for (let i = 0; i < offsets.length; i++) {
    if (offsets[i] + chunks[i].length > offset) { startChunk = i; break; }
  }
  if (startChunk === -1) {
    throw new Error(`Weight data offset ${offset} (size ${size}) is beyond end of file (${chunkedBuffer.totalSize} bytes)`);
  }

  const localOffset = offset - offsets[startChunk];
  // Check if entirely within this chunk
  if (localOffset + size <= chunks[startChunk].length) {
    // Ensure 4-byte alignment for typed array views (Float32Array, Uint16Array)
    const chunkBaseOffset = chunks[startChunk].byteOffset + localOffset;
    if (chunkBaseOffset % 4 !== 0) {
      const copy = new Uint8Array(size);
      copy.set(chunks[startChunk].subarray(localOffset, localOffset + size));
      return copy;
    }
    return chunks[startChunk].subarray(localOffset, localOffset + size);
  }

  // Spans multiple chunks — copy into aligned buffer
  const result = new Uint8Array(size);
  let written = 0;
  for (let i = startChunk; i < chunks.length && written < size; i++) {
    const chunkStart = Math.max(0, offset + written - offsets[i]);
    const avail = chunks[i].length - chunkStart;
    const take = Math.min(avail, size - written);
    result.set(chunks[i].subarray(chunkStart, chunkStart + take), written);
    written += take;
  }
  return result;
}

/**
 * Load SF3D weights and organize into component structure.
 */
async function loadWeights(device, url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch weights: ${response.status}`);

  const contentLength = parseInt(response.headers.get('content-length') || '0');
  const reader = response.body.getReader();
  const chunks = [];
  const chunkOffsets = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunkOffsets.push(received);
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, contentLength);
  }

  // Build a chunked buffer that avoids a single >2GB ArrayBuffer
  const chunkedBuffer = { chunks, offsets: chunkOffsets, totalSize: received };

  // Parse header from the first chunk(s) — header is always small (<1MB)
  // Always copy to get a clean ArrayBuffer for DataView
  const headerBytes = extractBytes(chunkedBuffer, 0, Math.min(received, 1024 * 1024));
  const headerBuf = headerBytes.slice().buffer;
  const { tensors } = parseHeader(headerBuf);

  const consumed = new Set();
  const get = (name) => {
    const info = tensors.get(name);
    if (!info) throw new Error(`Missing weight: ${name}`);
    consumed.add(name);
    return extractTensor(device, chunkedBuffer, info);
  };

  const tryGet = (name) => {
    const info = tensors.get(name);
    if (!info) return null;
    consumed.add(name);
    return extractTensor(device, chunkedBuffer, info);
  };

  // === Image Tokenizer (DINOv2 ViT-Large with modulation) ===
  const imageTokenizer = {
    imageMean: get('image_tokenizer.image_mean'),
    imageStd: get('image_tokenizer.image_std'),
    patchEmbed: {
      weight: get('image_tokenizer.model.embeddings.patch_embeddings.projection.weight'),
      bias: get('image_tokenizer.model.embeddings.patch_embeddings.projection.bias'),
    },
    clsToken: get('image_tokenizer.model.embeddings.cls_token'),
    posEmbed: get('image_tokenizer.model.embeddings.position_embeddings'),
    layernorm: {
      weight: get('image_tokenizer.model.layernorm.weight'),
      bias: get('image_tokenizer.model.layernorm.bias'),
    },
    blocks: [],
  };

  // 24 DINOv2 transformer blocks with AdaNorm modulation
  for (let l = 0; l < 24; l++) {
    const p = `image_tokenizer.model.encoder.layer.${l}`;
    imageTokenizer.blocks.push({
      norm1: { weight: get(`${p}.norm1.weight`), bias: get(`${p}.norm1.bias`) },
      attn: {
        q: { weight: get(`${p}.attention.attention.query.weight`), bias: get(`${p}.attention.attention.query.bias`) },
        k: { weight: get(`${p}.attention.attention.key.weight`), bias: get(`${p}.attention.attention.key.bias`) },
        v: { weight: get(`${p}.attention.attention.value.weight`), bias: get(`${p}.attention.attention.value.bias`) },
        proj: { weight: get(`${p}.attention.output.dense.weight`), bias: get(`${p}.attention.output.dense.bias`) },
      },
      layerScale1: get(`${p}.layer_scale1.lambda1`),
      norm2: { weight: get(`${p}.norm2.weight`), bias: get(`${p}.norm2.bias`) },
      mlp: {
        fc1: { weight: get(`${p}.mlp.fc1.weight`), bias: get(`${p}.mlp.fc1.bias`) },
        fc2: { weight: get(`${p}.mlp.fc2.weight`), bias: get(`${p}.mlp.fc2.bias`) },
      },
      layerScale2: get(`${p}.layer_scale2.lambda1`),
      // AdaNorm modulation from camera embeddings
      norm1Mod: { weight: get(`${p}.norm1_modulation.linear2.weight`), bias: get(`${p}.norm1_modulation.linear2.bias`) },
      norm2Mod: { weight: get(`${p}.norm2_modulation.linear2.weight`), bias: get(`${p}.norm2_modulation.linear2.bias`) },
    });
  }

  // === Camera Embedder ===
  const cameraEmbedder = {
    weight: get('camera_embedder.linear.weight'),
    bias: get('camera_embedder.linear.bias'),
  };

  // === Triplane Tokenizer ===
  const tokenizer = {
    embeddings: get('tokenizer.embeddings'), // [3, 1024, 96, 96]
  };

  // === Two-Stream Backbone ===
  const backbone = {
    latentInit: get('backbone.latent_init'),         // [1, 1792, 1024]
    normTriplane: { weight: get('backbone.norm_triplane.weight'), bias: get('backbone.norm_triplane.bias') },
    projTriplane: { weight: get('backbone.proj_triplane.weight'), bias: get('backbone.proj_triplane.bias') },
    normImage: { weight: get('backbone.norm_image.weight'), bias: get('backbone.norm_image.bias') },
    projImage: { weight: get('backbone.proj_image.weight'), bias: get('backbone.proj_image.bias') },
    normLatent: { weight: get('backbone.norm_latent.weight'), bias: get('backbone.norm_latent.bias') },
    projLatent: { weight: get('backbone.proj_latent.weight'), bias: get('backbone.proj_latent.bias') },
    projOut: { weight: get('backbone.proj_out.weight'), bias: get('backbone.proj_out.bias') },
    mainBlocks: [],
  };

  // 4 TwoStreamBlocks, each with fuse_block_in, 3 transformer_blocks, fuse_block_out
  for (let b = 0; b < 4; b++) {
    const bp = `backbone.main_blocks.${b}`;

    // Helper to load a FuseBlock
    function loadFuseBlock(prefix) {
      return {
        attn: {
          wq: get(`${prefix}.attn.wq.weight`),
          wk: get(`${prefix}.attn.wk.weight`),
          wv: get(`${prefix}.attn.wv.weight`),
          proj: { weight: get(`${prefix}.attn.proj.weight`), bias: get(`${prefix}.attn.proj.bias`) },
        },
        normZ1: { weight: get(`${prefix}.norm_z1.weight`), bias: get(`${prefix}.norm_z1.bias`) },
        normX: tryGet(`${prefix}.norm_x.weight`) ? {
          weight: get(`${prefix}.norm_x.weight`), bias: get(`${prefix}.norm_x.bias`),
        } : null,
        normZ2: { weight: get(`${prefix}.norm_z2.weight`), bias: get(`${prefix}.norm_z2.bias`) },
        ff: {
          geglu: { weight: get(`${prefix}.ff.net.0.proj.weight`), bias: get(`${prefix}.ff.net.0.proj.bias`) },
          proj: { weight: get(`${prefix}.ff.net.2.weight`), bias: get(`${prefix}.ff.net.2.bias`) },
        },
      };
    }

    // Helper to load a BasicBlock
    function loadBasicBlock(prefix) {
      return {
        norm1: { weight: get(`${prefix}.norm1.weight`), bias: get(`${prefix}.norm1.bias`) },
        attn1: {  // self-attention
          wq: get(`${prefix}.attn1.wq.weight`),
          wk: get(`${prefix}.attn1.wk.weight`),
          wv: get(`${prefix}.attn1.wv.weight`),
          proj: { weight: get(`${prefix}.attn1.proj.weight`), bias: get(`${prefix}.attn1.proj.bias`) },
        },
        norm2: { weight: get(`${prefix}.norm2.weight`), bias: get(`${prefix}.norm2.bias`) },
        attn2: {  // cross-attention (or self if no encoder_hidden_states)
          wq: get(`${prefix}.attn2.wq.weight`),
          wk: get(`${prefix}.attn2.wk.weight`),
          wv: get(`${prefix}.attn2.wv.weight`),
          proj: { weight: get(`${prefix}.attn2.proj.weight`), bias: get(`${prefix}.attn2.proj.bias`) },
        },
        norm3: { weight: get(`${prefix}.norm3.weight`), bias: get(`${prefix}.norm3.bias`) },
        ff: {
          geglu: { weight: get(`${prefix}.ff.net.0.proj.weight`), bias: get(`${prefix}.ff.net.0.proj.bias`) },
          proj: { weight: get(`${prefix}.ff.net.2.weight`), bias: get(`${prefix}.ff.net.2.bias`) },
        },
      };
    }

    backbone.mainBlocks.push({
      fuseBlockIn: loadFuseBlock(`${bp}.fuse_block_in`),
      transformerBlocks: [0, 1, 2].map(i => loadBasicBlock(`${bp}.transformer_block.${i}`)),
      fuseBlockOut: loadFuseBlock(`${bp}.fuse_block_out`),
    });
  }

  // === Post-Processor (PixelShuffle) ===
  const postProcessor = {
    convLayers: [
      { weight: get('post_processor.upsample.0.weight'), bias: get('post_processor.upsample.0.bias') },
      { weight: get('post_processor.upsample.2.weight'), bias: get('post_processor.upsample.2.bias') },
      { weight: get('post_processor.upsample.4.weight'), bias: get('post_processor.upsample.4.bias') },
      { weight: get('post_processor.upsample.6.weight'), bias: get('post_processor.upsample.6.bias') },
    ],
  };

  // === Decoder (MaterialMLP) ===
  const decoder = {
    heads: {},
  };
  for (const headName of ['density', 'features', 'perturb_normal', 'vertex_offset']) {
    const layers = [];
    for (let i = 0; ; i += 2) {
      const w = tryGet(`decoder.heads.${headName}.${i}.weight`);
      const b = tryGet(`decoder.heads.${headName}.${i}.bias`);
      if (!w) break;
      layers.push({ weight: w, bias: b });
    }
    decoder.heads[headName] = layers;
  }

  // === Image Estimator (CLIP for roughness/metallic) ===
  // For v1, we can run this on CPU or skip and use defaults.
  // Load the estimation heads at minimum.
  const imageEstimator = {
    // CLIP visual encoder weights would go here
    // For now, just load the roughness/metallic prediction heads
    heads: {},
  };
  for (const headName of ['roughness', 'metallic']) {
    const subLayers = [];
    for (let sub = 0; sub < 3; sub++) {
      const layers = [];
      for (let i = 0; ; i += 2) {
        const w = tryGet(`image_estimator.heads.${headName}.${sub}.${i}.weight`);
        const b = tryGet(`image_estimator.heads.${headName}.${sub}.${i}.bias`);
        if (!w) break;
        layers.push({ weight: w, bias: b });
      }
      if (layers.length > 0) subLayers.push(layers);
    }
    imageEstimator.heads[headName] = subLayers;
  }

  console.log(`Loaded ${tensors.size} SF3D tensors from weight file`);

  // Raw tensor access for modules that read weights lazily by name (the CLIP
  // visual encoder and CPU heads in clip_estimator.js). Only those families
  // (and anything the builders above did not consume) are kept, as standalone
  // copies; the streamed chunks are released so the page does not carry the
  // whole weight file in JS heap for the producer's lifetime.
  const compact = compactRetainedTensors(tensors, chunkedBuffer, consumed);
  console.log(`Retained ${(compact.retainedBytes / 1048576).toFixed(0)} MB of raw tensor bytes for lazy readers; released ${(compact.droppedBytes / 1048576).toFixed(0)} MB of streamed chunks`);
  const rawInfo = (name) => {
    const info = tensors.get(name);
    if (!info) throw new Error(`Missing weight: ${name}`);
    return { dtype: info.dtype, offset: 0, size: info.size };
  };
  const _rawGet = (name) => extractTensor(device, compact.rawBytes(name).buffer, rawInfo(name));
  const _rawGetCPU = (name) => extractTensorCPU(compact.rawBytes(name).buffer, rawInfo(name));
  const _rawTryGet = (name) => (tensors.has(name) ? _rawGet(name) : null);
  const _rawHas = (name) => tensors.has(name);

  return {
    imageTokenizer,
    cameraEmbedder,
    tokenizer,
    backbone,
    postProcessor,
    decoder,
    imageEstimator,
    _rawGet,
    _rawGetCPU,
    _rawTryGet,
    _rawHas,
  };
}

/**
 * Pure validators for Web Worker replies at SF3D's fail-loud worker
 * boundaries (preprocess, UV unwrap). A malformed reply throws here and never
 * reaches the GPU or the texture baker as an apparently successful offload;
 * the caller (callWorker) rejects and no main-thread retry is attempted.
 *
 * Review 2026-09-16 (HIGH): length-correct non-finite preprocessing output and
 * truncated / non-finite / out-of-range UV geometry were previously accepted.
 */

/**
 * unwrapUV returns faceAssignment as an Int32Array of atlas slots per face:
 * 0-5 primary box-projection charts, 6-11 first overlap tier, 12 remaining
 * (sub-cell grid). Valid values are 0..12 inclusive.
 */
const UV_ATLAS_SLOT_COUNT = 13;

function requireBuffer(reply, key, label) {
  if (!(reply?.[key] instanceof ArrayBuffer)) throw new Error(`${label} reply must carry ${key} ArrayBuffer`);
  return reply[key];
}

function requireFinite(arr, label) {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${label} value non-finite at ${i}`);
  }
}

/** Preprocess worker reply → Float32Array CHW of exactly expectedLen finite values. */
function validatePreprocessReply(reply, expectedLen) {
  const chw = new Float32Array(requireBuffer(reply, 'chwBuffer', 'preprocess'));
  if (chw.length !== expectedLen) throw new Error(`CHW length ${chw.length} != expected ${expectedLen}`);
  requireFinite(chw, 'preprocess CHW');
  return chw;
}

/**
 * UV-unwrap worker reply → { uvs, newVertices, newNormals, newFaces,
 * faceAssignment, newNumVertices, newNumFaces } with every array at its
 * declared length, finite floats, in-range face indices and chart ids.
 */
function validateUvUnwrapReply(reply) {
  const nv = reply?.newNumVertices;
  const nf = reply?.newNumFaces;
  if (!Number.isSafeInteger(nv) || nv <= 0) throw new Error(`uv-unwrap newNumVertices invalid: ${nv}`);
  if (!Number.isSafeInteger(nf) || nf <= 0) throw new Error(`uv-unwrap newNumFaces invalid: ${nf}`);
  const assignmentBuffer = requireBuffer(reply, 'faceAssignment', 'uv-unwrap');
  if (assignmentBuffer.byteLength % 4 !== 0) {
    throw new Error(`uv-unwrap faceAssignment byte length ${assignmentBuffer.byteLength} is not a multiple of 4 (expected Int32 atlas slots)`);
  }
  const r = {
    uvs: new Float32Array(requireBuffer(reply, 'uvs', 'uv-unwrap')),
    newVertices: new Float32Array(requireBuffer(reply, 'newVertices', 'uv-unwrap')),
    newNormals: new Float32Array(requireBuffer(reply, 'newNormals', 'uv-unwrap')),
    newFaces: new Uint32Array(requireBuffer(reply, 'newFaces', 'uv-unwrap')),
    faceAssignment: new Int32Array(assignmentBuffer),
    newNumVertices: nv,
    newNumFaces: nf,
  };
  const expectLen = (arr, expected, label) => {
    if (arr.length !== expected) throw new Error(`uv-unwrap ${label} length ${arr.length} != ${expected}`);
  };
  expectLen(r.newVertices, nv * 3, 'newVertices');
  expectLen(r.newNormals, nv * 3, 'newNormals');
  expectLen(r.uvs, nv * 2, 'uvs');
  expectLen(r.newFaces, nf * 3, 'newFaces');
  expectLen(r.faceAssignment, nf, 'faceAssignment');
  requireFinite(r.newVertices, 'uv-unwrap newVertices');
  requireFinite(r.newNormals, 'uv-unwrap newNormals');
  requireFinite(r.uvs, 'uv-unwrap uvs');
  for (let i = 0; i < r.newFaces.length; i++) {
    if (r.newFaces[i] >= nv) throw new Error(`uv-unwrap face index ${r.newFaces[i]} out of range (${nv} vertices) at ${i}`);
  }
  for (let i = 0; i < r.faceAssignment.length; i++) {
    const v = r.faceAssignment[i];
    if (v < 0 || v >= UV_ATLAS_SLOT_COUNT) {
      throw new Error(`uv-unwrap faceAssignment value ${v} out of range (${UV_ATLAS_SLOT_COUNT} atlas slots) at ${i}`);
    }
  }
  return r;
}

/**
 * preprocess_core.js — pure, DOM-free image-preprocess math.
 *
 * Extracted from inference.js so the exact same Lanczos-3 resize + alpha-blend +
 * ImageNet-normalize runs on either the main thread OR a Web Worker, guaranteeing
 * byte-identical output. No canvas/DOM here: the caller supplies raw float32 RGBA
 * source pixels (from getImageData) and gets back the CHW float32 tensor.
 *
 * This is the tail-collapse target: image-preprocess is the largest foreground
 * gap (~700ms, main-thread Lanczos), and it has ZERO GPU sync — moving it to a
 * worker removes it from the main thread entirely with no per-duty fence floor.
 */

function lanczosKernel(x, a = 3) {
  if (x === 0) return 1;
  if (Math.abs(x) >= a) return 0;
  const px = Math.PI * x;
  return (a * Math.sin(px) * Math.sin(px / a)) / (px * px);
}

function lanczosResize(src, srcW, srcH, dstW, dstH) {
  // src is Float32Array [srcH, srcW, 4] RGBA
  const a = 3; // Lanczos-3
  const dst = new Float32Array(dstH * dstW * 4);
  const tmp = new Float32Array(dstW * srcH * 4);

  // Horizontal pass
  const xScale = srcW / dstW;
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < dstW; x++) {
      const center = (x + 0.5) * xScale - 0.5;
      const left = Math.ceil(center - a);
      const right = Math.floor(center + a);
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, sumW = 0;
      for (let i = left; i <= right; i++) {
        const si = Math.min(Math.max(i, 0), srcW - 1);
        const w = lanczosKernel(center - i, a);
        const off = (y * srcW + si) * 4;
        sumR += src[off] * w;
        sumG += src[off + 1] * w;
        sumB += src[off + 2] * w;
        sumA += src[off + 3] * w;
        sumW += w;
      }
      const off = (y * dstW + x) * 4;
      tmp[off] = sumR / sumW;
      tmp[off + 1] = sumG / sumW;
      tmp[off + 2] = sumB / sumW;
      tmp[off + 3] = sumA / sumW;
    }
  }

  // Vertical pass
  const yScale = srcH / dstH;
  for (let y = 0; y < dstH; y++) {
    const center = (y + 0.5) * yScale - 0.5;
    const top = Math.ceil(center - a);
    const bottom = Math.floor(center + a);
    for (let x = 0; x < dstW; x++) {
      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, sumW = 0;
      for (let j = top; j <= bottom; j++) {
        const sj = Math.min(Math.max(j, 0), srcH - 1);
        const w = lanczosKernel(center - j, a);
        const off = (sj * dstW + x) * 4;
        sumR += tmp[off] * w;
        sumG += tmp[off + 1] * w;
        sumB += tmp[off + 2] * w;
        sumA += tmp[off + 3] * w;
        sumW += w;
      }
      const off = (y * dstW + x) * 4;
      dst[off] = sumR / sumW;
      dst[off + 1] = sumG / sumW;
      dst[off + 2] = sumB / sumW;
      dst[off + 3] = sumA / sumW;
    }
  }
  return dst;
}

/**
 * Resize + alpha-blend + ImageNet-normalize raw float32 RGBA source pixels into
 * a CHW float32 tensor. Pure — identical on main thread and worker.
 *
 * @param {Float32Array} srcFloat  [srcH*srcW*4] float32 RGBA in [0,1]
 * @param {number} srcW
 * @param {number} srcH
 * @param {number} size            output size (512)
 * @param {number[]} bg            background color [r,g,b]
 * @param {number[]} imageMean
 * @param {number[]} imageStd
 * @returns {Float32Array} CHW [3*size*size]
 */
function resizeBlendNormalize(srcFloat, srcW, srcH, size, bg, imageMean, imageStd) {
  const resized = lanczosResize(srcFloat, srcW, srcH, size, size);
  const chw = new Float32Array(3 * size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const off = (y * size + x) * 4;
      const r = resized[off];
      const g = resized[off + 1];
      const b = resized[off + 2];
      const a = Math.max(0, Math.min(1, resized[off + 3]));
      const blendR = bg[0] * (1 - a) + r * a;
      const blendG = bg[1] * (1 - a) + g * a;
      const blendB = bg[2] * (1 - a) + b * a;
      chw[0 * size * size + y * size + x] = (blendR - imageMean[0]) / imageStd[0];
      chw[1 * size * size + y * size + x] = (blendG - imageMean[1]) / imageStd[1];
      chw[2 * size * size + y * size + x] = (blendB - imageMean[2]) / imageStd[2];
    }
  }
  return chw;
}

/**
 * worker_call.js — fail-loud request/response over a Web Worker.
 *
 * Productionizes the CPU-offload workers' failure lifecycle. Every failure path
 * rejects loudly and never hangs or silently falls back:
 *   - worker posts { ok:false, error }        → reject with the error
 *   - worker posts { ok:true } but malformed   → reject (output validation)
 *   - worker top-level throw (onerror)         → reject
 *   - message deserialization fails (onmessageerror) → reject
 *   - worker wedged / never replies            → reject after timeoutMs
 * Listeners are always torn down (success, failure, timeout). The caller decides
 * whether to fall back to a main-thread path — this helper never does so
 * silently.
 *
 * @param {Worker} worker
 * @param {object} message           postMessage payload (must carry a unique id)
 * @param {Transferable[]} transfer  transfer list
 * @param {object} opts
 * @param {number} [opts.timeoutMs=30000]
 * @param {(data:any)=>any} opts.onResult   maps a validated { ok:true } reply to
 *   the resolved value; THROW inside to reject on malformed output.
 * @returns {Promise<any>}
 */
function callWorker(worker, message, transfer, { timeoutMs = 30000, onResult }) {
  const id = message.id;
  if (!id) throw new Error('callWorker: message.id is required');
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onMessageError);
      clearTimeout(timer);
    };
    const done = (fn, arg) => { if (settled) return; settled = true; cleanup(); fn(arg); };

    const onMessage = (e) => {
      if (e.data?.id !== id) return; // not our reply
      if (e.data.ok) {
        try { done(resolve, onResult(e.data)); }
        catch (err) { done(reject, new Error(`worker output invalid: ${err?.message || err}`)); }
      } else {
        done(reject, new Error(`worker failed: ${e.data?.error || 'unknown error'}`));
      }
    };
    const onError = (e) => done(reject, new Error(`worker error: ${e?.message || 'top-level worker exception'}`));
    const onMessageError = () => done(reject, new Error('worker messageerror: reply could not be deserialized'));

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onMessageError);
    const timer = setTimeout(() => done(reject, new Error(`worker timed out after ${timeoutMs}ms`)), timeoutMs);

    try {
      worker.postMessage(message, transfer);
    } catch (err) {
      done(reject, new Error(`worker postMessage failed: ${err?.message || err}`));
    }
  });
}

const patchEmbedWGSL = "// DINOv2 patch embedding compute shader.\n// Takes an image [3, H, W] and produces (N+1, D) token embeddings:\n//   N patches (tokenH x tokenW grid of 14x14 patches) + 1 CLS token.\n//   Each patch is flattened (14*14*3 = 588) then linearly projected to D.\n//   Position embeddings are interpolated from the pretrained (1+370, D) table.\n//\n// DINOv2 differences from DeiT:\n//   - 14x14 patches (not 16x16)\n//   - Variable spatial dimensions (not fixed 224x224)\n//   - Position embedding interpolation for arbitrary token counts\n\nstruct Params {\n  imgH: u32,      // image height (tokenH * 14)\n  imgW: u32,      // image width (tokenW * 14)\n  patchSize: u32,  // 14\n  tokenH: u32,\n  tokenW: u32,\n  channels: u32,   // 3\n  D: u32,          // model dim (1024)\n  numTokens: u32,  // tokenH * tokenW + 1 (including CLS)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> image: array<f32>;       // [3, imgH, imgW] CHW\n@group(0) @binding(2) var<storage, read> projWeight: array<f32>;  // [D, 3, 14, 14] = [D, 588]\n@group(0) @binding(3) var<storage, read> projBias: array<f32>;    // [D]\n@group(0) @binding(4) var<storage, read> clsToken: array<f32>;    // [1, 1, D]\n@group(0) @binding(5) var<storage, read> posEmbed: array<f32>;    // [1, 1+numPatchesPretrained, D]\n@group(0) @binding(6) var<storage, read_write> output: array<f32>; // [numTokens, D]\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  let totalElements = params.numTokens * params.D;\n\n  if (idx >= totalElements) { return; }\n\n  let token = idx / params.D;\n  let d = idx % params.D;\n\n  var val = 0.0;\n\n  if (token == 0u) {\n    // CLS token\n    val = clsToken[d];\n  } else {\n    // Patch embedding\n    let patchIdx = token - 1u;\n    let patchRow = patchIdx / params.tokenW;\n    let patchCol = patchIdx % params.tokenW;\n    let startY = patchRow * params.patchSize;\n    let startX = patchCol * params.patchSize;\n\n    // Conv2d-style patch projection: weight is [D, 3, 14, 14]\n    val = projBias[d];\n    for (var c = 0u; c < params.channels; c++) {\n      for (var py = 0u; py < params.patchSize; py++) {\n        for (var px = 0u; px < params.patchSize; px++) {\n          let imgY = startY + py;\n          let imgX = startX + px;\n          // Image is CHW\n          let pixelVal = image[c * params.imgH * params.imgW + imgY * params.imgW + imgX];\n          // Weight is [D, C, pH, pW] → index [d, c, py, px]\n          let wIdx = d * params.channels * params.patchSize * params.patchSize\n                   + c * params.patchSize * params.patchSize\n                   + py * params.patchSize + px;\n          val += pixelVal * projWeight[wIdx];\n        }\n      }\n    }\n  }\n\n  // Add position embedding (CLS pos is at index 0, patch pos follow)\n  // For now: use position embedding directly if token count matches,\n  // otherwise skip (interpolation would need a separate pass)\n  val += posEmbed[idx];\n\n  output[idx] = val;\n}\n";

const layerNormWGSL = "// Layer normalization for ViT backbone.\n// Each workgroup normalizes one row (token).\n// Thread 0 computes mean/variance serially, then all threads normalize in parallel.\n// Adapted from webgpu-samples visionTransformer with 2D dispatch support.\n\nstruct Params {\n  N: u32,       // number of rows (tokens)\n  D: u32,       // dimension per row\n  eps: f32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> gamma: array<f32>;\n@group(0) @binding(3) var<storage, read> beta: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nvar<workgroup> shared_mean: f32;\nvar<workgroup> shared_inv_std: f32;\n\n@compute @workgroup_size(256)\nfn main(\n  @builtin(workgroup_id) wg_id: vec3u,\n  @builtin(local_invocation_id) local_id: vec3u,\n) {\n  let row = wg_id.x;\n  let tid = local_id.x;\n  let D = params.D;\n  let base = row * D;\n\n  if (row >= params.N) { return; }\n\n  // Thread 0 computes mean and variance (two-pass for numerical stability).\n  // The one-pass formula E[x²]-E[x]² suffers catastrophic cancellation when\n  // values are large (±20 common in ViT), losing significant precision.\n  if (tid == 0u) {\n    var sum = 0.0;\n    for (var i = 0u; i < D; i++) {\n      sum += input[base + i];\n    }\n    let mean = sum / f32(D);\n    var var_sum = 0.0;\n    for (var i = 0u; i < D; i++) {\n      let diff = input[base + i] - mean;\n      var_sum += diff * diff;\n    }\n    let variance = var_sum / f32(D);\n    shared_mean = mean;\n    shared_inv_std = 1.0 / sqrt(variance + params.eps);\n  }\n  workgroupBarrier();\n\n  let mean = shared_mean;\n  let inv_std = shared_inv_std;\n\n  // All threads normalize and apply affine transform in parallel\n  for (var i = tid; i < D; i += 256u) {\n    let val = input[base + i];\n    output[base + i] = (val - mean) * inv_std * gamma[i] + beta[i];\n  }\n}\n";

const attentionWGSL = "// Multi-head self-attention compute shaders for DINOv2 ViT.\n// Adapted from webgpu-samples visionTransformer with 2D dispatch.\n//\n// Three entry points:\n//   computeScores: Q·K^T scaled dot product → scores\n//   softmax: row-wise numerically stable softmax\n//   applyAttn: scores @ V → output\n\nstruct ScoreParams {\n  N: u32,        // number of tokens\n  D: u32,        // model dimension\n  numHeads: u32,\n  headDim: u32,\n  scale: f32,\n  numWorkgroupsX: u32,\n}\n\nstruct SoftmaxParams {\n  N: u32,\n  numHeads: u32,\n  numWorkgroupsX: u32,\n}\n\nstruct ApplyParams {\n  N: u32,\n  D: u32,\n  numHeads: u32,\n  headDim: u32,\n  numWorkgroupsX: u32,\n}\n\n// --- Attention scores ---\n@group(0) @binding(0) var<uniform> scoreParams: ScoreParams;\n@group(0) @binding(1) var<storage, read> qBuf: array<f32>;\n@group(0) @binding(2) var<storage, read> kBuf: array<f32>;\n@group(0) @binding(3) var<storage, read_write> scoreBuf: array<f32>;\n\n@compute @workgroup_size(256)\nfn computeScores(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * scoreParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = scoreParams.N;\n  let numHeads = scoreParams.numHeads;\n  let headDim = scoreParams.headDim;\n  let D = scoreParams.D;\n  let totalScores = numHeads * N * N;\n\n  if (idx >= totalScores) { return; }\n\n  let head = idx / (N * N);\n  let remainder = idx % (N * N);\n  let qi = remainder / N;\n  let ki = remainder % N;\n  let headOffset = head * headDim;\n\n  // headDim is 64, so 4-way split gives 16-element chains.\n  var d0 = 0.0;\n  var d1 = 0.0;\n  var d2 = 0.0;\n  var d3 = 0.0;\n  let qBase = qi * D + headOffset;\n  let kBase = ki * D + headOffset;\n  let hd4 = (headDim / 4u) * 4u;\n  for (var d = 0u; d < hd4; d += 4u) {\n    d0 += qBuf[qBase + d]      * kBuf[kBase + d];\n    d1 += qBuf[qBase + d + 1u] * kBuf[kBase + d + 1u];\n    d2 += qBuf[qBase + d + 2u] * kBuf[kBase + d + 2u];\n    d3 += qBuf[qBase + d + 3u] * kBuf[kBase + d + 3u];\n  }\n  for (var d = hd4; d < headDim; d++) {\n    d0 += qBuf[qBase + d] * kBuf[kBase + d];\n  }\n\n  scoreBuf[idx] = ((d0 + d1) + (d2 + d3)) * scoreParams.scale;\n}\n\n// --- Softmax ---\n// Uses separate bind group with SoftmaxParams\n@group(0) @binding(0) var<uniform> softmaxParams: SoftmaxParams;\n@group(0) @binding(1) var<storage, read_write> softmaxScoreBuf: array<f32>;\n\n@compute @workgroup_size(256)\nfn softmax(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * softmaxParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = softmaxParams.N;\n  let totalRows = softmaxParams.numHeads * N;\n\n  if (idx >= totalRows) { return; }\n\n  let base = idx * N;\n\n  // Find max\n  var m = -1e30;\n  for (var i = 0u; i < N; i++) {\n    m = max(m, softmaxScoreBuf[base + i]);\n  }\n\n  // Exp and sum\n  var s = 0.0;\n  for (var i = 0u; i < N; i++) {\n    let e = exp(softmaxScoreBuf[base + i] - m);\n    softmaxScoreBuf[base + i] = e;\n    s += e;\n  }\n\n  // Normalize\n  for (var i = 0u; i < N; i++) {\n    softmaxScoreBuf[base + i] = softmaxScoreBuf[base + i] / s;\n  }\n}\n\n// --- Apply attention ---\n@group(0) @binding(0) var<uniform> applyParams: ApplyParams;\n@group(0) @binding(1) var<storage, read> applyScoreBuf: array<f32>;\n@group(0) @binding(2) var<storage, read> vBuf: array<f32>;\n@group(0) @binding(3) var<storage, read_write> attnOutput: array<f32>;\n\n@compute @workgroup_size(256)\nfn applyAttn(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * applyParams.numWorkgroupsX;\n  let idx = linearWG * 256u + lid.x;\n\n  let N = applyParams.N;\n  let D = applyParams.D;\n  let numHeads = applyParams.numHeads;\n  let headDim = applyParams.headDim;\n\n  if (idx >= N * D) { return; }\n\n  let row = idx / D;\n  let col = idx % D;\n  let head = col / headDim;\n  let d = col % headDim;\n\n  // N is ~1370 tokens, 4-way split gives ~342-element chains.\n  var v0 = 0.0;\n  var v1 = 0.0;\n  var v2 = 0.0;\n  var v3 = 0.0;\n  let scoreBase = head * N * N + row * N;\n  let vCol = head * headDim + d;\n  let n4 = (N / 4u) * 4u;\n  for (var j = 0u; j < n4; j += 4u) {\n    v0 += applyScoreBuf[scoreBase + j]      * vBuf[(j)      * D + vCol];\n    v1 += applyScoreBuf[scoreBase + j + 1u] * vBuf[(j + 1u) * D + vCol];\n    v2 += applyScoreBuf[scoreBase + j + 2u] * vBuf[(j + 2u) * D + vCol];\n    v3 += applyScoreBuf[scoreBase + j + 3u] * vBuf[(j + 3u) * D + vCol];\n  }\n  for (var j = n4; j < N; j++) {\n    v0 += applyScoreBuf[scoreBase + j] * vBuf[j * D + vCol];\n  }\n  attnOutput[idx] = (v0 + v1) + (v2 + v3);\n}\n";

const linearWGSL = "// Linear projection: output = input @ weight + bias\n// Adapted from webgpu-samples visionTransformer mlp.wgsl with 2D dispatch.\n//\n// Weight layout controlled by params.transposed:\n//   transposed=1 (default): weight is [inDim, outDim], access weight[k * outDim + col]\n//   transposed=0: weight is [outDim, inDim] (PyTorch native), access weight[col * inDim + k]\n\nstruct Params {\n  numRows: u32,\n  inDim: u32,\n  outDim: u32,\n  numWorkgroupsX: u32,\n  transposed: u32,  // 1=transposed [inDim, outDim], 0=native [outDim, inDim]\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.numRows * params.outDim) { return; }\n\n  let row = idx / params.outDim;\n  let col = idx % params.outDim;\n\n  // 4-way split accumulation for better fp32 precision on large dot products.\n  var s0 = 0.0;\n  var s1 = 0.0;\n  var s2 = 0.0;\n  var s3 = 0.0;\n  let inBase = row * params.inDim;\n  let len4 = (params.inDim / 4u) * 4u;\n\n  if (params.transposed == 1u) {\n    // Transposed layout: weight[k, col] = weight[k * outDim + col]\n    let wBase = col;\n    let stride = params.outDim;\n    for (var k = 0u; k < len4; k += 4u) {\n      s0 += input[inBase + k]      * weight[(k)      * stride + wBase];\n      s1 += input[inBase + k + 1u] * weight[(k + 1u) * stride + wBase];\n      s2 += input[inBase + k + 2u] * weight[(k + 2u) * stride + wBase];\n      s3 += input[inBase + k + 3u] * weight[(k + 3u) * stride + wBase];\n    }\n    for (var k = len4; k < params.inDim; k++) {\n      s0 += input[inBase + k] * weight[k * stride + wBase];\n    }\n  } else {\n    // Native layout: weight[col, k] = weight[col * inDim + k]\n    let wBase = col * params.inDim;\n    for (var k = 0u; k < len4; k += 4u) {\n      s0 += input[inBase + k]      * weight[wBase + k];\n      s1 += input[inBase + k + 1u] * weight[wBase + k + 1u];\n      s2 += input[inBase + k + 2u] * weight[wBase + k + 2u];\n      s3 += input[inBase + k + 3u] * weight[wBase + k + 3u];\n    }\n    for (var k = len4; k < params.inDim; k++) {\n      s0 += input[inBase + k] * weight[wBase + k];\n    }\n  }\n  output[idx] = (s0 + s1) + (s2 + s3) + bias[col];\n}\n";

const linearGeluWGSL = "// Linear projection + GELU activation: output = GELU(input @ weight + bias)\n// Used for MLP fc1 in DINOv2 ViT blocks.\n// NaN guard: Apple Metal may produce NaN from finite accumulations; sanitized via bitcast.\n\nstruct Params {\n  numRows: u32,\n  inDim: u32,\n  outDim: u32,\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\nfn gelu(x: f32) -> f32 {\n  // GELU via erf approximation (Abramowitz & Stegun 7.1.26, max error ~1.5e-7).\n  // Avoids tanh() which has precision issues on Apple Metal fast-math.\n  if (x > 10.0) { return x; }\n  if (x < -10.0) { return 0.0; }\n  let a = x * 0.7071067811865476; // x / sqrt(2)\n  let s = sign(a);\n  let t_abs = abs(a);\n  let p = 0.3275911;\n  let t = 1.0 / (1.0 + p * t_abs);\n  let t2 = t * t;\n  let t3 = t2 * t;\n  let t4 = t3 * t;\n  let t5 = t4 * t;\n  let erf_abs = 1.0 - (0.254829592 * t - 0.284496736 * t2 + 1.421413741 * t3 - 1.453152027 * t4 + 1.061405429 * t5) * exp(-t_abs * t_abs);\n  let erf_val = s * erf_abs;\n  return 0.5 * x * (1.0 + erf_val);\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.numRows * params.outDim) { return; }\n\n  let row = idx / params.outDim;\n  let col = idx % params.outDim;\n\n  // Split accumulation (see linear.wgsl for rationale).\n  var s0 = 0.0;\n  var s1 = 0.0;\n  var s2 = 0.0;\n  var s3 = 0.0;\n  let inBase = row * params.inDim;\n  let wBase = col;\n  let stride = params.outDim;\n  let len4 = (params.inDim / 4u) * 4u;\n  for (var k = 0u; k < len4; k += 4u) {\n    s0 += input[inBase + k]      * weight[(k)      * stride + wBase];\n    s1 += input[inBase + k + 1u] * weight[(k + 1u) * stride + wBase];\n    s2 += input[inBase + k + 2u] * weight[(k + 2u) * stride + wBase];\n    s3 += input[inBase + k + 3u] * weight[(k + 3u) * stride + wBase];\n  }\n  for (var k = len4; k < params.inDim; k++) {\n    s0 += input[inBase + k] * weight[k * stride + wBase];\n  }\n  output[idx] = gelu((s0 + s1) + (s2 + s3) + bias[col]);\n}\n";

const layerscaleWGSL = "// LayerScale: element-wise multiply by learned gamma, then add residual.\n// DINOv2 applies this after attention and after FFN:\n//   x = x + gamma * sublayer(norm(x))\n//\n// This shader does: output[i] = residual[i] + gamma[i % D] * input[i]\n\nstruct Params {\n  count: u32,   // total elements (N * D)\n  D: u32,       // model dim (for gamma indexing)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;      // sublayer output\n@group(0) @binding(2) var<storage, read> gamma: array<f32>;       // [D] learned scale\n@group(0) @binding(3) var<storage, read> residual: array<f32>;    // pre-sublayer x\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= params.count) { return; }\n\n  let d = idx % params.D;\n  output[idx] = residual[idx] + gamma[d] * input[idx];\n}\n";

const activationsWGSL = "// activations.wgsl — Element-wise activation functions\n//\n// ReLU, SiLU, and element-wise add (for skip connections).\n// Each function operates in-place or writes to a separate output buffer.\n\nstruct ActivationParams {\n  count: u32,     // total number of elements\n  op: u32,        // 0=relu, 1=silu, 2=add, 3=add_relu, 4=sigmoid\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ActivationParams;\n@group(0) @binding(1) var<storage, read> input_a: array<f32>;\n@group(0) @binding(2) var<storage, read> input_b: array<f32>;  // used for add ops\n@group(0) @binding(3) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn activation_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  if (idx >= params.count) {\n    return;\n  }\n\n  let a = input_a[idx];\n\n  switch params.op {\n    case 0u: { // ReLU\n      output[idx] = max(a, 0.0);\n    }\n    case 1u: { // SiLU (x * sigmoid(x))\n      output[idx] = a / (1.0 + exp(-a));\n    }\n    case 2u: { // Add (skip connection)\n      output[idx] = a + input_b[idx];\n    }\n    case 3u: { // Add + ReLU\n      output[idx] = max(a + input_b[idx], 0.0);\n    }\n    case 4u: { // Sigmoid\n      output[idx] = 1.0 / (1.0 + exp(-a));\n    }\n    default: {\n      output[idx] = a;\n    }\n  }\n}\n";

/**
 * sf3d_backbone.js — DINOv2 ViT-Large backbone adapted for SF3D.
 *
 * Key differences from MOGE's DINOv2:
 *   - Separate Q/K/V projections (not fused QKV)
 *   - AdaNorm modulation: each layer has norm1_modulation and norm2_modulation
 *     that take camera embeddings and produce scale/shift for LayerNorm outputs
 *   - Standard GELU MLP (verified from checkpoint config: use_swiglu_ffn=False)
 *   - Final layernorm after encoder
 *   - Output is last_hidden_state permuted to [N_v, C, N_t] tokens (no intermediate extraction)
 *
 * Produces: [N_tokens, dim] image features for the two-stream backbone
 */


const MAX_WG$2 = 65535;
const WG_SIZE$3 = 256;
function splitWG$3(total) {
  if (total <= MAX_WG$2) return [total, 1];
  return [MAX_WG$2, Math.ceil(total / MAX_WG$2)];
}
function ceilDiv$3(a, b) { return Math.ceil(a / b); }

function makeUniform(device, data) {
  const buf = device.createBuffer({
    size: Math.max(data.byteLength, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(new Uint8Array(data.buffer || data));
  buf.unmap();
  return buf;
}

const VIT_CONFIG = {
  dim: 1024,
  numHeads: 16,
  headDim: 64,
  numLayers: 24,
  patchSize: 14,
  // Standard GELU MLP (not SwiGLU — verified from checkpoint config)
  mlpHiddenDim: 4096,
  scale: 1.0 / Math.sqrt(64),
  eps: 1e-6,
};

class SF3DImageTokenizer {
  constructor(device) {
    this.device = device;
    this.pipelines = {};
    this._uniformCache = new Map();
  }

  init() {
    const device = this.device;
    const make = (code, entry) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });

    this.pipelines.patchEmbed = make(patchEmbedWGSL, 'main');
    this.pipelines.layerNorm = make(layerNormWGSL, 'main');
    this.pipelines.attnScores = make(attentionWGSL, 'computeScores');
    this.pipelines.attnSoftmax = make(attentionWGSL, 'softmax');
    this.pipelines.attnApply = make(attentionWGSL, 'applyAttn');
    this.pipelines.linear = make(linearWGSL, 'main');
    this.pipelines.linearGelu = make(linearGeluWGSL, 'main');
    this.pipelines.layerScale = make(layerscaleWGSL, 'main');
    this.pipelines.activation = make(activationsWGSL, 'activation_main');

    // Inline add shader
    this.pipelines.add = make(`
      @group(0) @binding(0) var<storage, read_write> dst: array<f32>;
      @group(0) @binding(1) var<storage, read> src: array<f32>;
      struct P { count: u32, numWgX: u32 }
      @group(0) @binding(2) var<uniform> p: P;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.count) { return; }
        dst[idx] = dst[idx] + src[idx];
      }
    `, 'main');

    // Modulated LayerNorm: output = (1 + scale) * LN(input) + shift
    // scale, shift come from linear(cameraEmbed) → [2*D], split into scale and shift
    this.pipelines.modulatedLN = make(`
      struct P { N: u32, D: u32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read> input: array<f32>;
      @group(0) @binding(2) var<storage, read> gamma: array<f32>;
      @group(0) @binding(3) var<storage, read> beta: array<f32>;
      @group(0) @binding(4) var<storage, read> modulation: array<f32>;
      @group(0) @binding(5) var<storage, read_write> output: array<f32>;

      @compute @workgroup_size(1)
      fn main(@builtin(global_invocation_id) gid: vec3u) {
        let row = gid.x;
        if (row >= p.N) { return; }
        let D = p.D;
        let base = row * D;
        var sum: f32 = 0.0;
        for (var d: u32 = 0; d < D; d++) { sum += input[base + d]; }
        let mean = sum / f32(D);
        var varSum: f32 = 0.0;
        for (var d: u32 = 0; d < D; d++) { let diff = input[base + d] - mean; varSum += diff * diff; }
        let invStd = 1.0 / sqrt(varSum / f32(D) + 1e-6);
        for (var d: u32 = 0; d < D; d++) {
          let normalized = (input[base + d] - mean) * invStd;
          let ln_out = gamma[d] * normalized + beta[d];
          let scale = modulation[d];
          let shift = modulation[D + d];
          output[base + d] = (1.0 + scale) * ln_out + shift;
        }
      }
    `, 'main');

    this.pipelines.linearGelu = make(linearGeluWGSL, 'main');
  }

  _cachedUniform(data) {
    const bytes = new Uint8Array(data.buffer || data);
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
    const key = `u_${bytes.length}_${h}`;
    if (this._uniformCache.has(key)) return this._uniformCache.get(key);
    const buf = makeUniform(this.device, data);
    this._uniformCache.set(key, buf);
    return buf;
  }

  /**
   * Run the SF3D DINOv2 image tokenizer.
   *
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBuffer} imageBuf - [3, 512, 512] normalized image
   * @param {GPUBuffer} cameraEmbedBuf - [768] camera embedding
   * @param {Object} weights - imageTokenizer weights from loadWeights
   * @returns {GPUBuffer} - [N_tokens, 1024] image token features (permuted for backbone)
   */
  /**
   * Legacy single-command-buffer encode. Records patch embed, all 24 ViT
   * blocks, and the final LayerNorm into the caller-supplied `encoder`; the
   * caller submits it once. Behavior-preserving over the pre-cooperative port.
   */
  encode(encoder, imageBuf, cameraEmbedBuf, weights) {
    const ctx = this._setupEncode(encoder, imageBuf, cameraEmbedBuf, weights);
    for (let l = 0; l < VIT_CONFIG.numLayers; l++) {
      this._encodeBlock(encoder, l, ctx, weights);
    }
    return this._finalizeEncode(encoder, ctx, weights);
  }

  /**
   * Cooperative encode driven by the Kaminos cooperative porting spine.
   *
   * Numerically identical to encode(): the exact same dispatch sequence over
   * the exact same device-owned work buffers (tokenBufA/tokenBufB ping-pong
   * persists across chunks because buffers are device-owned, not encoder-owned).
   * The only difference is command-buffer granularity — each fixed chunk of
   * `chunkBlocks` blocks is recorded into its own encoder and handed to the
   * driver to submit + yield, instead of all 24 blocks in one command buffer.
   *
   * Setup (patch embed + SiLU) rides in the first chunk's encoder; the final
   * LayerNorm rides in the last chunk's encoder. Every dispatch executes in the
   * same queue order it would under encode(), so GPU results are byte-identical.
   *
   * @param {object} o
   * @param {GPUBuffer} o.imageBuf
   * @param {GPUBuffer} o.cameraEmbedBuf
   * @param {object} o.weights
   * @param {number} o.numBlocks
   * @param {number} o.chunkBlocks
   * @param {(blockStart:number, blockEnd:number, encodeChunk:(enc:GPUCommandEncoder)=>void)=>Promise<void>} o.driver
   */
  async encodeCooperative({ imageBuf, cameraEmbedBuf, weights, numBlocks, chunkBlocks, driver }) {
    if (numBlocks !== VIT_CONFIG.numLayers) {
      throw new Error(
        `encodeCooperative numBlocks ${numBlocks} must equal VIT_CONFIG.numLayers ${VIT_CONFIG.numLayers}`,
      );
    }
    // ctx (work buffers + currentTokens ping-pong pointer) is created once and
    // survives every chunk. Setup dispatches are deferred into the first chunk.
    let ctx = null;
    let result = null;

    for (let start = 0; start < numBlocks; start += chunkBlocks) {
      const end = Math.min(start + chunkBlocks, numBlocks);
      const isFirst = start === 0;
      const isLast = end === numBlocks;
      // eslint-disable-next-line no-await-in-loop
      await driver(start, end, encoder => {
        if (isFirst) {
          ctx = this._setupEncode(encoder, imageBuf, cameraEmbedBuf, weights);
        }
        for (let l = start; l < end; l++) {
          this._encodeBlock(encoder, l, ctx, weights);
        }
        if (isLast) {
          result = this._finalizeEncode(encoder, ctx, weights);
        }
      });
    }

    if (!result) throw new Error('encodeCooperative produced no result');
    return result;
  }

  /**
   * Allocate work buffers and record patch embedding + SiLU(cameraEmbed) into
   * `encoder`. Returns the mutable context (work buffers + currentTokens
   * pointer) shared across the block loop.
   */
  _setupEncode(encoder, imageBuf, cameraEmbedBuf, weights) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const ps = VIT_CONFIG.patchSize;
    const imgSize = 512;
    const tokenH = Math.floor(imgSize / ps); // 36 (512/14 = 36.57, DINOv2 uses floor)
    const tokenW = Math.floor(imgSize / ps);
    // numPatches = 36*36 = 1296, N = 1297 (with CLS)
    const numPatches = tokenH * tokenW;
    const N = numPatches + 1;
    const T = N * D;

    // Work buffers (device-owned; persist across all command buffers)
    const tokenBufA = createEmptyBuffer(device, T * 4);
    const tokenBufB = createEmptyBuffer(device, T * 4);
    const normBuf = createEmptyBuffer(device, T * 4);
    const qBuf = createEmptyBuffer(device, T * 4);
    const kBuf = createEmptyBuffer(device, T * 4);
    const vBuf = createEmptyBuffer(device, T * 4);
    const scoreBuf = createEmptyBuffer(device, VIT_CONFIG.numHeads * N * N * 4);
    const attnOutBuf = createEmptyBuffer(device, T * 4);
    const projBuf = createEmptyBuffer(device, T * 4);
    const hiddenBuf = createEmptyBuffer(device, N * VIT_CONFIG.mlpHiddenDim * 4);
    const ffnOutBuf = createEmptyBuffer(device, T * 4);
    const modBuf = createEmptyBuffer(device, 2 * D * 4); // modulation output [2*D]

    // 1. Patch embedding
    this._dispatchPatchEmbed(encoder, imageBuf, weights, tokenBufA, tokenH, tokenW);

    // Save patch embedding output for diagnostics
    {
      if (!this._dinov2Diag) this._dinov2Diag = {};
      const diagBuf = createEmptyBuffer(device, T * 4);
      encoder.copyBufferToBuffer(tokenBufA, 0, diagBuf, 0, T * 4);
      this._dinov2Diag['patchEmbed'] = diagBuf;
    }

    // Compute SiLU(cameraEmbed) once — PyTorch: linear2(silu(condition))
    const siluCameraEmbedBuf = createEmptyBuffer(device, 768 * 4);
    this._dispatchSiLU(encoder, cameraEmbedBuf, siluCameraEmbedBuf, 768);

    return {
      D, N, T, tokenH, tokenW,
      tokenBufA, tokenBufB, normBuf, qBuf, kBuf, vBuf, scoreBuf,
      attnOutBuf, projBuf, hiddenBuf, ffnOutBuf, modBuf, siluCameraEmbedBuf,
      currentTokens: tokenBufA,
    };
  }

  /**
   * Record one transformer block's dispatches into `encoder`, advancing
   * ctx.currentTokens through the ping-pong. Exact per-block body from the
   * pre-cooperative port; must remain byte-identical between encode() and
   * encodeCooperative().
   */
  _encodeBlock(encoder, l, ctx, weights) {
    const device = this.device;
    const { D, N, T, tokenBufA, tokenBufB, normBuf, qBuf, kBuf, vBuf, scoreBuf,
      attnOutBuf, projBuf, hiddenBuf, ffnOutBuf, modBuf, siluCameraEmbedBuf } = ctx;
    const block = weights.blocks[l];

    // Compute modulation for norm1: linear(silu(cameraEmbed)) → [2*D]
    this._dispatchLinear(encoder, siluCameraEmbedBuf, modBuf, block.norm1Mod.weight, block.norm1Mod.bias, 1, 768, 2 * D);

    // Modulated LayerNorm1
    this._dispatchModulatedLN(encoder, ctx.currentTokens, normBuf, block.norm1, modBuf, N);

    // Self-attention with separate Q/K/V projections
    this._dispatchLinear(encoder, normBuf, qBuf, block.attn.q.weight, block.attn.q.bias, N, D, D);
    this._dispatchLinear(encoder, normBuf, kBuf, block.attn.k.weight, block.attn.k.bias, N, D, D);
    this._dispatchLinear(encoder, normBuf, vBuf, block.attn.v.weight, block.attn.v.bias, N, D, D);

    // Attention
    this._dispatchAttnScores(encoder, qBuf, kBuf, scoreBuf, N);
    this._dispatchAttnSoftmax(encoder, scoreBuf, N);
    this._dispatchAttnApply(encoder, scoreBuf, vBuf, attnOutBuf, N);

    // Output projection
    this._dispatchLinear(encoder, attnOutBuf, projBuf, block.attn.proj.weight, block.attn.proj.bias, N, D, D);

    // LayerScale1 + residual
    const attnOut = (ctx.currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
    this._dispatchLayerScaleResidual(encoder, projBuf, ctx.currentTokens, attnOut, block.layerScale1, T, D);
    ctx.currentTokens = attnOut;

    // Compute modulation for norm2: linear(silu(cameraEmbed)) → [2*D]
    this._dispatchLinear(encoder, siluCameraEmbedBuf, modBuf, block.norm2Mod.weight, block.norm2Mod.bias, 1, 768, 2 * D);

    // Modulated LayerNorm2
    this._dispatchModulatedLN(encoder, ctx.currentTokens, normBuf, block.norm2, modBuf, N);

    // GELU MLP: fc1 (linear + GELU) → fc2 (linear)
    this._dispatchLinearGelu(encoder, normBuf, hiddenBuf,
      block.mlp.fc1.weight, block.mlp.fc1.bias, N, D, VIT_CONFIG.mlpHiddenDim);
    this._dispatchLinear(encoder, hiddenBuf, ffnOutBuf,
      block.mlp.fc2.weight, block.mlp.fc2.bias, N, VIT_CONFIG.mlpHiddenDim, D);

    // LayerScale2 + residual
    const ffnOut = (ctx.currentTokens === tokenBufA) ? tokenBufB : tokenBufA;
    this._dispatchLayerScaleResidual(encoder, ffnOutBuf, ctx.currentTokens, ffnOut, block.layerScale2, T, D);
    ctx.currentTokens = ffnOut;

    // Save diagnostic refs for first few blocks
    if (l < 3 || l === 23) {
      if (!this._dinov2Diag) this._dinov2Diag = {};
      // Copy current state to a persistent buffer for readback
      const diagBuf = createEmptyBuffer(device, T * 4);
      encoder.copyBufferToBuffer(ctx.currentTokens, 0, diagBuf, 0, T * 4);
      this._dinov2Diag[`block${l}`] = diagBuf;
    }
  }

  /** Final LayerNorm + return the DINOv2 token output. */
  _finalizeEncode(encoder, ctx, weights) {
    const { N, normBuf, tokenH, tokenW } = ctx;

    // 3. Final LayerNorm
    this._dispatchLayerNorm(encoder, ctx.currentTokens, normBuf, weights.layernorm, N);

    // Output: normBuf contains [N, D] where N = 1297 (CLS + 1296 patches)
    // The backbone expects [N_tokens, D] — we return all tokens including CLS
    // The two-stream backbone will use this via permute to [C, N_t]
    return {
      tokensBuf: normBuf,
      N,
      tokenH,
      tokenW,
    };
  }

  // --- Dispatch helpers ---

  _dispatchPatchEmbed(encoder, imageBuf, weights, outputBuf, tokenH, tokenW) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const ps = VIT_CONFIG.patchSize;
    const numTokens = tokenH * tokenW + 1;
    const totalWG = ceilDiv$3(numTokens * D, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);

    // imgH/imgW must be the ACTUAL image size (512), not tokenH*ps (504)
    // because the image buffer is [3, 512, 512] and channel offsets use imgH*imgW
    const imgSize = 512 ; // TODO: pass actual image size
    const params = this._cachedUniform(new Uint32Array([
      imgSize, imgSize, ps, tokenH, tokenW, 3, D, numTokens, wgX,
    ]));

    const bg = device.createBindGroup({
      layout: this.pipelines.patchEmbed.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: imageBuf } },
        { binding: 2, resource: { buffer: weights.patchEmbed.weight } },
        { binding: 3, resource: { buffer: weights.patchEmbed.bias } },
        { binding: 4, resource: { buffer: weights.clsToken } },
        { binding: 5, resource: { buffer: weights.posEmbed } },
        { binding: 6, resource: { buffer: outputBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.patchEmbed);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLinear(encoder, input, output, weight, bias, rows, inDim, outDim) {
    const device = this.device;
    const totalWG = ceilDiv$3(rows * outDim, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([rows, inDim, outDim, wgX, 1]));

    const bg = device.createBindGroup({
      layout: this.pipelines.linear.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: weight } },
        { binding: 3, resource: { buffer: bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLayerNorm(encoder, input, output, norm, N) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const paramsData = new ArrayBuffer(16);
    const v = new DataView(paramsData);
    v.setUint32(0, N, true);
    v.setUint32(4, D, true);
    v.setFloat32(8, VIT_CONFIG.eps, true);
    const params = this._cachedUniform(new Uint8Array(paramsData));

    const bg = device.createBindGroup({
      layout: this.pipelines.layerNorm.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: norm.weight } },
        { binding: 3, resource: { buffer: norm.bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.layerNorm);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(N);
    pass.end();
  }

  _dispatchModulatedLN(encoder, input, output, norm, modBuf, N) {
    const device = this.device;
    const D = VIT_CONFIG.dim;
    const params = this._cachedUniform(new Uint32Array([N, D, 0]));

    const bg = device.createBindGroup({
      layout: this.pipelines.modulatedLN.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: norm.weight } },
        { binding: 3, resource: { buffer: norm.bias } },
        { binding: 4, resource: { buffer: modBuf } },
        { binding: 5, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.modulatedLN);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(N);
    pass.end();
  }

  _dispatchAttnScores(encoder, qBuf, kBuf, scoreBuf, N) {
    const device = this.device;
    const { numHeads, dim, headDim, scale } = VIT_CONFIG;
    const total = numHeads * N * N;
    const totalWG = ceilDiv$3(total, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);

    const paramsData = new ArrayBuffer(24);
    const v = new DataView(paramsData);
    v.setUint32(0, N, true);
    v.setUint32(4, dim, true);
    v.setUint32(8, numHeads, true);
    v.setUint32(12, headDim, true);
    v.setFloat32(16, scale, true);
    v.setUint32(20, wgX, true);
    const params = this._cachedUniform(new Uint8Array(paramsData));

    const bg = device.createBindGroup({
      layout: this.pipelines.attnScores.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: qBuf } },
        { binding: 2, resource: { buffer: kBuf } },
        { binding: 3, resource: { buffer: scoreBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.attnScores);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchAttnSoftmax(encoder, scoreBuf, N) {
    const totalRows = VIT_CONFIG.numHeads * N;
    const totalWG = ceilDiv$3(totalRows, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([N, VIT_CONFIG.numHeads, wgX]));

    const bg = this.device.createBindGroup({
      layout: this.pipelines.attnSoftmax.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: scoreBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.attnSoftmax);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchAttnApply(encoder, scoreBuf, vBuf, output, N) {
    const D = VIT_CONFIG.dim;
    const totalWG = ceilDiv$3(N * D, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([N, D, VIT_CONFIG.numHeads, VIT_CONFIG.headDim, wgX]));

    const bg = this.device.createBindGroup({
      layout: this.pipelines.attnApply.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: scoreBuf } },
        { binding: 2, resource: { buffer: vBuf } },
        { binding: 3, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.attnApply);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLayerScaleResidual(encoder, input, residual, output, gamma, count, D) {
    const totalWG = ceilDiv$3(count, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, D, wgX]));

    const bg = this.device.createBindGroup({
      layout: this.pipelines.layerScale.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: gamma } },
        { binding: 3, resource: { buffer: residual } },
        { binding: 4, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.layerScale);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLinearGelu(encoder, input, output, weight, bias, rows, inDim, outDim) {
    const totalWG = ceilDiv$3(rows * outDim, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([rows, inDim, outDim, wgX, 1]));

    const bg = this.device.createBindGroup({
      layout: this.pipelines.linearGelu.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: weight } },
        { binding: 3, resource: { buffer: bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.linearGelu);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }
  _dispatchSiLU(encoder, input, output, count) {
    const totalWG = ceilDiv$3(count, WG_SIZE$3);
    const [wgX, wgY] = splitWG$3(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, 1, wgX])); // op=1 is SiLU
    const dummyBuf = createEmptyBuffer(this.device, 4);

    const bg = this.device.createBindGroup({
      layout: this.pipelines.activation.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: dummyBuf } },
        { binding: 3, resource: { buffer: output } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.activation);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }
}

const WEBGPU_ROUTE_RECEIPT_SCHEMA = 'kaminos.webgpu-route-receipt.v0';

function clone$5(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNonEmptyString$a(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNonNegative(value) {
  return Number.isFinite(value) && value >= 0;
}

function requireString(errors, value, path) {
  if (!isNonEmptyString$a(value)) errors.push(`${path} must be a non-empty string`);
}

function requireArray(errors, value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
  }
}

function createWebGpuLocalRouteReceipt(input) {
  const status = input.status || (input.fallbackReason ? 'fallback' : 'real');
  return {
    schema: WEBGPU_ROUTE_RECEIPT_SCHEMA,
    requestedRouteId: input.requestedRouteId,
    effectiveRouteId: input.effectiveRouteId,
    status,
    fallbackReason: input.fallbackReason || null,
    backend: clone$5(input.backend),
    model: clone$5(input.model),
    kernel: clone$5(input.kernel),
    inputs: clone$5(input.inputs || []),
    outputs: clone$5(input.outputs || []),
    timings: clone$5(input.timings),
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function validateRouteReceipt(receipt) {
  const errors = [];

  if (!receipt || typeof receipt !== 'object') {
    return { ok: false, errors: ['receipt must be an object'] };
  }

  if (receipt.schema !== WEBGPU_ROUTE_RECEIPT_SCHEMA) {
    errors.push(`schema must be ${WEBGPU_ROUTE_RECEIPT_SCHEMA}`);
  }

  requireString(errors, receipt.requestedRouteId, 'requestedRouteId');
  requireString(errors, receipt.effectiveRouteId, 'effectiveRouteId');
  requireString(errors, receipt.status, 'status');

  if (!receipt.backend || typeof receipt.backend !== 'object') {
    errors.push('backend must be an object');
  } else {
    if (receipt.backend.kind !== 'webgpu-local') {
      errors.push('backend.kind must be webgpu-local');
    }
    requireString(errors, receipt.backend.runtime, 'backend.runtime');
  }

  if (!receipt.model || typeof receipt.model !== 'object') {
    errors.push('model must be an object');
  } else {
    requireString(errors, receipt.model.id, 'model.id');
    requireString(errors, receipt.model.revision, 'model.revision');
    requireString(errors, receipt.model.weightsHash, 'model.weightsHash');
    requireString(errors, receipt.model.dtype, 'model.dtype');
  }

  if (!receipt.kernel || typeof receipt.kernel !== 'object') {
    errors.push('kernel must be an object');
  } else {
    requireString(errors, receipt.kernel.kitVersion, 'kernel.kitVersion');
    requireString(errors, receipt.kernel.profile, 'kernel.profile');
  }

  requireArray(errors, receipt.inputs, 'inputs');
  if (Array.isArray(receipt.inputs)) {
    receipt.inputs.forEach((input, index) => {
      requireString(errors, input?.role, `inputs[${index}].role`);
      requireString(errors, input?.artifactId, `inputs[${index}].artifactId`);
      requireString(errors, input?.sha256, `inputs[${index}].sha256`);
    });
  }

  requireArray(errors, receipt.outputs, 'outputs');
  if (Array.isArray(receipt.outputs)) {
    receipt.outputs.forEach((output, index) => {
      requireString(errors, output?.role, `outputs[${index}].role`);
      requireString(errors, output?.artifactId, `outputs[${index}].artifactId`);
      requireString(errors, output?.sha256, `outputs[${index}].sha256`);
      requireString(errors, output?.status, `outputs[${index}].status`);
      if (!Array.isArray(output?.shape) || output.shape.length === 0 || !output.shape.every(Number.isInteger)) {
        errors.push(`outputs[${index}].shape must be a non-empty integer array`);
      }
    });
  }

  if (!receipt.timings || typeof receipt.timings !== 'object') {
    errors.push('timings must be an object');
  } else {
    requireString(errors, receipt.timings.source, 'timings.source');
    if (!isFiniteNonNegative(receipt.timings.totalMs)) {
      errors.push('timings.totalMs must be a finite non-negative number');
    }
    if (receipt.timings.stages != null && !Array.isArray(receipt.timings.stages)) {
      errors.push('timings.stages must be an array when present');
    }
  }

  if (receipt.status === 'fallback' && !isNonEmptyString$a(receipt.fallbackReason)) {
    errors.push('fallback receipts must include fallbackReason');
  }

  return { ok: errors.length === 0, errors };
}

const WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA = 'kaminos.webgpu-phase-resource-plan.v0';
const WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA = 'kaminos.webgpu-phase-resource-working-set.v0';
const WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA = 'kaminos.webgpu-phase-resource-transition.v0';

function isNonEmptyString$9(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function deepFreeze$4(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze$4(child);
  return Object.freeze(value);
}

function cloneJson(value, label, path = label, ancestors = new Set()) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`${label} must be JSON-compatible; invalid number at ${path}`);
    }
    return value;
  }
  if (typeof value !== 'object') {
    throw new Error(`${label} must be JSON-compatible; unsupported ${typeof value} at ${path}`);
  }
  if (ancestors.has(value)) throw new Error(`${label} must be JSON-compatible; cycle at ${path}`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new Error(`${label} must be JSON-compatible; invalid array element at ${path}[${index}]`);
        }
        clone[index] = cloneJson(descriptor.value, label, `${path}[${index}]`, ancestors);
      }
      const namedKeys = Reflect.ownKeys(value).filter(key => (
        key !== 'length' && (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key))
      ));
      if (namedKeys.length > 0) {
        throw new Error(`${label} must be JSON-compatible; named array property at ${path}`);
      }
      return clone;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must be JSON-compatible; non-plain object at ${path}`);
    }
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw new Error(`${label} must be JSON-compatible; symbol key at ${path}`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new Error(`${label} must be JSON-compatible; invalid property at ${path}.${key}`);
      }
      clone[key] = cloneJson(descriptor.value, label, `${path}.${key}`, ancestors);
    }
    return clone;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value != null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedResourceIds(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const ids = [];
  const seen = new Set();
  for (const resourceId of value) {
    if (!isNonEmptyString$9(resourceId)) throw new Error(`${label} entries must be non-empty strings`);
    if (seen.has(resourceId)) throw new Error(`${label} contains duplicate resource ${resourceId}`);
    seen.add(resourceId);
    ids.push(resourceId);
  }
  return ids;
}

function sumDeclaredBytes(resources) {
  let total = 0;
  for (const resource of resources) {
    total += resource.declaredBytes;
    if (!Number.isSafeInteger(total)) throw new Error('phase resource declared bytes exceed the safe integer range');
  }
  return total;
}

function defineWebGpuPhaseResourcePlan(input = {}) {
  if (
    input.maxResources != null
    || input.maxPhases != null
    || input.maxDeclaredBytes != null
    || input.retentionLimit != null
  ) {
    throw new Error('phase resource plans are uncapped; maxResources, maxPhases, maxDeclaredBytes, and retentionLimit are not supported');
  }
  if (!isNonEmptyString$9(input.planId)) throw new Error('phase resource planId must be a non-empty string');
  if (!Array.isArray(input.resources) || input.resources.length === 0) {
    throw new Error('phase resource plan resources must be a non-empty array');
  }
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    throw new Error('phase resource plan phases must be a non-empty array');
  }

  const resourceIds = new Set();
  const resources = input.resources.map((resource, index) => {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error(`phase resource plan resources[${index}] must be an object`);
    }
    if (!isNonEmptyString$9(resource.resourceId)) {
      throw new Error(`phase resource plan resources[${index}].resourceId must be a non-empty string`);
    }
    if (resourceIds.has(resource.resourceId)) {
      throw new Error(`duplicate phase resource ${resource.resourceId}`);
    }
    if (!Number.isSafeInteger(resource.declaredBytes) || resource.declaredBytes < 0) {
      throw new Error(`phase resource ${resource.resourceId} declaredBytes must be a non-negative safe integer`);
    }
    resourceIds.add(resource.resourceId);
    return {
      resourceId: resource.resourceId,
      declaredBytes: resource.declaredBytes,
      metadata: cloneJson(resource.metadata ?? null, `phase resource ${resource.resourceId} metadata`),
    };
  });

  const phaseIds = new Set();
  const phases = input.phases.map((phase, index) => {
    if (!phase || typeof phase !== 'object' || Array.isArray(phase)) {
      throw new Error(`phase resource plan phases[${index}] must be an object`);
    }
    if (!isNonEmptyString$9(phase.phaseId)) {
      throw new Error(`phase resource plan phases[${index}].phaseId must be a non-empty string`);
    }
    if (phaseIds.has(phase.phaseId)) throw new Error(`duplicate phase ${phase.phaseId}`);
    phaseIds.add(phase.phaseId);
    const requiredResourceIds = normalizedResourceIds(
      phase.requiredResourceIds,
      `phase ${phase.phaseId} requiredResourceIds`,
    );
    const prefetchResourceIds = normalizedResourceIds(
      phase.prefetchResourceIds,
      `phase ${phase.phaseId} prefetchResourceIds`,
    );
    for (const resourceId of [...requiredResourceIds, ...prefetchResourceIds]) {
      if (!resourceIds.has(resourceId)) {
        throw new Error(`phase ${phase.phaseId} references unknown resource ${resourceId}`);
      }
    }
    const holdResourceIds = [...requiredResourceIds];
    const held = new Set(holdResourceIds);
    for (const resourceId of prefetchResourceIds) {
      if (!held.has(resourceId)) {
        held.add(resourceId);
        holdResourceIds.push(resourceId);
      }
    }
    return {
      phaseId: phase.phaseId,
      requiredResourceIds,
      prefetchResourceIds,
      holdResourceIds,
      metadata: cloneJson(phase.metadata ?? null, `phase ${phase.phaseId} metadata`),
    };
  });

  const identityInput = {
    planId: input.planId,
    resources,
    phases,
    metadata: cloneJson(input.metadata ?? null, 'phase resource plan metadata'),
  };
  const plan = {
    schema: WEBGPU_PHASE_RESOURCE_PLAN_SCHEMA,
    ...identityInput,
    resourceIds: resources.map(resource => resource.resourceId),
    phaseIds: phases.map(phase => phase.phaseId),
    totalDeclaredBytes: sumDeclaredBytes(resources),
    identity: `${encodeURIComponent(input.planId)}#${encodeURIComponent(canonicalJson(identityInput))}`,
  };
  return deepFreeze$4(plan);
}

function abortError(signal) {
  const error = new Error(String(signal?.reason || 'phase resource transition aborted'));
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError(signal);
}

function errorWithWorkingSetReport(cause, report) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (!Object.hasOwn(error, 'workingSetReport')) {
    try {
      error.workingSetReport = report;
      if (error.workingSetReport === report) return error;
    } catch {}
  }
  const wrapped = new Error(error.message);
  wrapped.name = error.name;
  wrapped.cause = error;
  wrapped.workingSetReport = report;
  return wrapped;
}

function releaseLease(entry) {
  const result = entry.lease.release();
  if (result != null && typeof result.then === 'function') {
    throw new Error(`phase resource ${entry.resource.resourceId} lease release must complete synchronously`);
  }
  const releaseStatus = result?.status ?? 'released';
  if (releaseStatus === 'release-failed') {
    throw new Error(`phase resource ${entry.resource.resourceId} lease release failed`);
  }
  if (releaseStatus === 'invalidated') {
    return { outcome: 'invalidated', releaseStatus };
  }
  if (releaseStatus !== 'released' && releaseStatus !== 'already-released') {
    throw new Error(
      `phase resource ${entry.resource.resourceId} lease release returned unsupported status ${releaseStatus}`,
    );
  }
  return { outcome: 'released', releaseStatus };
}

function cleanupEntries(entries) {
  const releasedResourceIds = [];
  const invalidatedResourceIds = [];
  const releaseResults = [];
  const failures = [];
  for (const entry of [...entries].reverse()) {
    try {
      const release = releaseLease(entry);
      releaseResults.push({
        resourceId: entry.resource.resourceId,
        status: release.releaseStatus,
      });
      if (release.outcome === 'invalidated') {
        invalidatedResourceIds.push(entry.resource.resourceId);
      } else {
        releasedResourceIds.push(entry.resource.resourceId);
      }
    } catch (error) {
      failures.push({
        resourceId: entry.resource.resourceId,
        message: String(error?.message || error),
      });
    }
  }
  return deepFreeze$4({
    status: failures.length > 0
      ? 'release-failed'
      : (invalidatedResourceIds.length > 0 ? 'invalidated' : 'released'),
    releasedResourceIds,
    invalidatedResourceIds,
    releaseResults,
    failures,
  });
}

function failedReleaseResourceIds(cleanup) {
  return new Set(cleanup.failures.map(failure => failure.resourceId));
}

function createWebGpuPhaseResourceWorkingSet(input = {}) {
  if (
    input.maxHeldResources != null
    || input.maxHeldBytes != null
    || input.maxTransitions != null
    || input.retentionLimit != null
  ) {
    throw new Error('phase resource working sets are uncapped; maxHeldResources, maxHeldBytes, maxTransitions, and retentionLimit are not supported');
  }
  if (!isNonEmptyString$9(input.controllerId)) throw new Error('phase resource controllerId must be a non-empty string');
  if (typeof input.acquireResource !== 'function') throw new Error('phase resource acquireResource must be a function');
  if (input.residencySnapshot != null && typeof input.residencySnapshot !== 'function') {
    throw new Error('phase resource residencySnapshot must be a function');
  }
  const plan = defineWebGpuPhaseResourcePlan(input.plan);
  const now = input.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  if (typeof now !== 'function') throw new Error('phase resource now must be a function');

  const resourceById = new Map(plan.resources.map(resource => [resource.resourceId, resource]));
  const phaseById = new Map(plan.phases.map(phase => [phase.phaseId, phase]));
  const state = {
    status: 'active',
    currentPhaseId: null,
    held: new Map(),
    transitionCount: 0,
    activeTransition: null,
    closedAtMs: null,
  };

  function readResidencyReport() {
    if (!input.residencySnapshot) return { residency: null, residencyError: null };
    try {
      return {
        residency: cloneJson(input.residencySnapshot(), 'phase resource residency snapshot'),
        residencyError: null,
      };
    } catch (error) {
      return {
        residency: null,
        residencyError: {
          name: error?.name || 'Error',
          message: String(error?.message || error),
        },
      };
    }
  }

  function heldResourceIds() {
    return [...state.held.keys()];
  }

  function heldDeclaredBytes() {
    return sumDeclaredBytes([...state.held.values()].map(entry => entry.resource));
  }

  function snapshot() {
    const residencyReport = readResidencyReport();
    return deepFreeze$4({
      schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
      controllerId: input.controllerId,
      planIdentity: plan.identity,
      status: state.status,
      currentPhaseId: state.currentPhaseId,
      heldResourceIds: heldResourceIds(),
      heldDeclaredBytes: heldDeclaredBytes(),
      transitionCount: state.transitionCount,
      activeTransition: state.activeTransition ? { ...state.activeTransition } : null,
      ...residencyReport,
      closedAtMs: state.closedAtMs,
    });
  }

  async function transitionToPhase(phaseId, options = {}) {
    if (state.status !== 'active') throw new Error(`phase resource working set is ${state.status}`);
    if (state.activeTransition) throw new Error('phase resource transition is already in progress');
    const phase = phaseById.get(phaseId);
    if (!phase) throw new Error(`unknown phase resource phase ${phaseId || '<missing>'}`);
    throwIfAborted(options.signal);

    const startedAtMs = now();
    const fromPhaseId = state.currentPhaseId;
    const retainedResourceIds = phase.holdResourceIds.filter(resourceId => state.held.has(resourceId));
    const acquired = [];
    let failedResourceId = null;
    state.activeTransition = {
      fromPhaseId,
      toPhaseId: phaseId,
      startedAtMs,
    };

    try {
      for (const resourceId of phase.holdResourceIds) {
        if (state.held.has(resourceId)) continue;
        throwIfAborted(options.signal);
        failedResourceId = resourceId;
        const resource = resourceById.get(resourceId);
        const purpose = phase.requiredResourceIds.includes(resourceId) ? 'required' : 'prefetch';
        const lease = await input.acquireResource({
          controllerId: input.controllerId,
          plan,
          phaseId,
          purpose,
          resource,
          signal: options.signal,
        });
        if (!lease || typeof lease !== 'object' || typeof lease.release !== 'function') {
          throw new Error(`phase resource ${resourceId} acquisition must return a lease with release()`);
        }
        const entry = { resource, lease, purpose };
        acquired.push(entry);
        if (lease.resourceId != null && lease.resourceId !== resourceId) {
          throw new Error(`phase resource ${resourceId} acquisition returned lease for ${lease.resourceId}`);
        }
        throwIfAborted(options.signal);
      }

      const target = new Set(phase.holdResourceIds);
      const departed = [...state.held.values()].filter(entry => !target.has(entry.resource.resourceId));
      const release = cleanupEntries(departed);
      if (release.status === 'release-failed') {
        const acquiredCleanup = cleanupEntries(acquired);
        const settledDeparted = new Set([
          ...release.releasedResourceIds,
          ...release.invalidatedResourceIds,
        ]);
        const unresolvedAcquired = failedReleaseResourceIds(acquiredCleanup);
        const degradedHeld = new Map(
          [...state.held].filter(([resourceId]) => !settledDeparted.has(resourceId)),
        );
        for (const entry of acquired) {
          if (unresolvedAcquired.has(entry.resource.resourceId)) {
            degradedHeld.set(entry.resource.resourceId, entry);
          }
        }
        state.held = degradedHeld;
        state.currentPhaseId = null;
        state.status = 'release-failed';
        throw errorWithWorkingSetReport(new Error('phase resource transition could not release departed resources'), deepFreeze$4({
          schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
          status: 'release-failed',
          controllerId: input.controllerId,
          planIdentity: plan.identity,
          fromPhaseId,
          toPhaseId: phaseId,
          startedAtMs,
          settledAtMs: now(),
          failedResourceId: null,
          failure: { name: 'Error', message: 'phase resource transition could not release departed resources' },
          acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
          retainedResourceIds,
          releasedResourceIds: release.releasedResourceIds,
          invalidatedResourceIds: release.invalidatedResourceIds,
          heldResourceIds: heldResourceIds(),
          heldDeclaredBytes: heldDeclaredBytes(),
          ...readResidencyReport(),
          cleanup: acquiredCleanup,
          releaseFailures: release.failures,
        }));
      }

      const nextHeld = new Map();
      for (const resourceId of phase.holdResourceIds) {
        const entry = state.held.get(resourceId)
          || acquired.find(candidate => candidate.resource.resourceId === resourceId);
        nextHeld.set(resourceId, entry);
      }
      state.held = nextHeld;
      state.currentPhaseId = phaseId;
      state.transitionCount += 1;
      failedResourceId = null;
      return deepFreeze$4({
        schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
        status: release.status === 'invalidated' ? 'prepared-after-invalidation' : 'prepared',
        controllerId: input.controllerId,
        planIdentity: plan.identity,
        transitionSequence: state.transitionCount,
        fromPhaseId,
        toPhaseId: phaseId,
        startedAtMs,
        settledAtMs: now(),
        failedResourceId: null,
        failure: null,
        acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
        retainedResourceIds,
        releasedResourceIds: release.releasedResourceIds,
        invalidatedResourceIds: release.invalidatedResourceIds,
        heldResourceIds: heldResourceIds(),
        heldDeclaredBytes: heldDeclaredBytes(),
        ...readResidencyReport(),
        cleanup: null,
      });
    } catch (cause) {
      if (cause?.workingSetReport) throw cause;
      const cleanup = cleanupEntries(acquired);
      if (cleanup.status === 'release-failed') {
        const unresolvedAcquired = failedReleaseResourceIds(cleanup);
        for (const entry of acquired) {
          if (unresolvedAcquired.has(entry.resource.resourceId)) {
            state.held.set(entry.resource.resourceId, entry);
          }
        }
        state.currentPhaseId = null;
        state.status = 'release-failed';
      }
      const canceled = cause?.name === 'AbortError' || options.signal?.aborted === true;
      const error = canceled && cause?.name !== 'AbortError' ? abortError(options.signal) : cause;
      const report = deepFreeze$4({
        schema: WEBGPU_PHASE_RESOURCE_TRANSITION_SCHEMA,
        status: canceled ? 'canceled' : 'failed',
        controllerId: input.controllerId,
        planIdentity: plan.identity,
        transitionSequence: state.transitionCount + 1,
        fromPhaseId,
        toPhaseId: phaseId,
        startedAtMs,
        settledAtMs: now(),
        failedResourceId,
        failure: { name: error?.name || 'Error', message: String(error?.message || error) },
        acquiredResourceIds: acquired.map(entry => entry.resource.resourceId),
        retainedResourceIds,
        releasedResourceIds: [],
        invalidatedResourceIds: cleanup.invalidatedResourceIds,
        heldResourceIds: heldResourceIds(),
        heldDeclaredBytes: heldDeclaredBytes(),
        ...readResidencyReport(),
        cleanup,
        workingSetStatus: state.status,
      });
      throw errorWithWorkingSetReport(error, report);
    } finally {
      state.activeTransition = null;
    }
  }

  function close() {
    if (state.activeTransition) throw new Error('phase resource working set cannot close during an active transition');
    if (state.status === 'closed' || state.status === 'closed-after-invalidation') {
      return deepFreeze$4({
        schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
        controllerId: input.controllerId,
        status: 'already-closed',
        releasedResourceIds: [],
      });
    }
    const cleanup = cleanupEntries([...state.held.values()]);
    const unresolved = failedReleaseResourceIds(cleanup);
    state.held = new Map(
      [...state.held].filter(([resourceId]) => unresolved.has(resourceId)),
    );
    state.currentPhaseId = null;
    state.status = cleanup.status === 'release-failed'
      ? 'close-failed'
      : (cleanup.status === 'invalidated' ? 'closed-after-invalidation' : 'closed');
    state.closedAtMs = now();
    return deepFreeze$4({
      schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
      controllerId: input.controllerId,
      status: state.status,
      releasedResourceIds: cleanup.releasedResourceIds,
      invalidatedResourceIds: cleanup.invalidatedResourceIds,
      failures: cleanup.failures,
      heldResourceIds: heldResourceIds(),
      heldDeclaredBytes: heldDeclaredBytes(),
      ...readResidencyReport(),
      closedAtMs: state.closedAtMs,
    });
  }

  return Object.freeze({
    schema: WEBGPU_PHASE_RESOURCE_WORKING_SET_SCHEMA,
    controllerId: input.controllerId,
    plan,
    transitionToPhase,
    snapshot,
    close,
  });
}

const LIMIT_KEYS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
];

function featureList(features) {
  if (!features) return [];
  return Array.from(features).map(String).sort();
}

function isNonEmptyString$8(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function copyLimits(limits = {}) {
  const out = {};
  for (const key of LIMIT_KEYS) {
    if (Number.isFinite(limits[key])) out[key] = limits[key];
  }
  return out;
}

function createWebGpuBackendIdentity(input) {
  return {
    kind: 'webgpu-local',
    runtime: 'browser',
    adapterName: input.adapterName || null,
    browser: input.browser || null,
    requestedFeatures: featureList(input.requestedFeatures),
    features: featureList(input.effectiveFeatures || input.features),
    limits: copyLimits(input.limits),
    timestampQuery: input.timestampQuery || 'unavailable',
  };
}

function validateWebGpuBackendIdentity(identity) {
  const errors = [];

  if (!identity || typeof identity !== 'object') {
    return { ok: false, errors: ['identity must be an object'] };
  }
  if (identity.kind !== 'webgpu-local') errors.push('kind must be webgpu-local');
  if (identity.runtime !== 'browser') errors.push('runtime must be browser');
  if (!isNonEmptyString$8(identity.adapterName)) errors.push('adapterName must be a non-empty string');
  if (!Array.isArray(identity.features) || identity.features.length === 0) {
    errors.push('features must be a non-empty array');
  }
  if (!identity.limits || typeof identity.limits !== 'object' || Object.keys(identity.limits).length === 0) {
    errors.push('limits must be a non-empty object');
  }

  const timestampStates = new Set(['requested', 'available', 'unavailable', 'disabled']);
  if (!timestampStates.has(identity.timestampQuery)) {
    errors.push('timestampQuery has unsupported state');
  }

  if (identity.timestampQuery === 'requested') {
    const requested = featureList(identity.requestedFeatures);
    const effective = featureList(identity.features);
    if (!requested.includes('timestamp-query')) {
      errors.push('timestamp-query requested state must include timestamp-query in requestedFeatures');
    }
    if (!effective.includes('timestamp-query')) {
      errors.push('timestamp-query requested state must include timestamp-query in features');
    }
  }

  return { ok: errors.length === 0, errors };
}

const WEBGPU_INFERENCE_KIT_VERSION = '0.1.48';
const DEFAULT_KIT_VERSION = WEBGPU_INFERENCE_KIT_VERSION;

function isNonEmptyString$7(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeSource(input) {
  return input && typeof input === 'object' ? input : {};
}

function stringOrDefault(value, fallback) {
  return isNonEmptyString$7(value) ? value : fallback;
}

function validateKernelProfileMetadata(kernel) {
  const errors = [];

  if (!kernel || typeof kernel !== 'object') {
    return { ok: false, errors: ['kernel must be an object'] };
  }

  if (!isNonEmptyString$7(kernel.kitVersion)) errors.push('kernel.kitVersion must be a non-empty string');
  if (!isNonEmptyString$7(kernel.profile)) errors.push('kernel.profile must be a non-empty string');
  if (kernel.commit != null && typeof kernel.commit !== 'string') {
    errors.push('kernel.commit must be a string or null');
  }

  return { ok: errors.length === 0, errors };
}

function createKernelProfileMetadata(input = {}, options = {}) {
  const source = normalizeSource(input);
  const kernel = {
    kitVersion: stringOrDefault(source.kitVersion, options.defaultKitVersion || DEFAULT_KIT_VERSION),
    profile: stringOrDefault(source.profile, options.defaultProfile),
    commit: source.commit || null,
  };

  if (options.requireProfile === true || options.validate === true) {
    const result = validateKernelProfileMetadata(kernel);
    if (!result.ok) throw new Error(result.errors.join('; '));
  }

  return kernel;
}

const WEBGPU_HOST_PHASE = Object.freeze({
  cpuPreprocess: 'cpu-preprocess',
  commandEncoding: 'command-encoding',
  queueSubmission: 'queue-submission',
  readback: 'readback',
  presentation: 'presentation',
  other: 'other',
});

new Set(Object.values(WEBGPU_HOST_PHASE));

const PROFILE_SCHEMA = 'kaminos.webgpu-staged-profile.v0';

function isNonEmptyString$6(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

function createStagedSubmitProfile(input = {}) {
  return {
    schema: PROFILE_SCHEMA,
    route: input.route || 'staged-submits',
    timingSource: input.timingSource || 'queue-submit-wait',
    timestampQueryValidatedAgainstStaged: !!input.timestampQueryValidatedAgainstStaged,
    requiredStages: Array.isArray(input.requiredStages) ? [...input.requiredStages] : [],
    stages: [],
  };
}

function addStagedSubmitStage(profile, stage) {
  if (!profile || typeof profile !== 'object') throw new Error('profile must be an object');
  if (!isNonEmptyString$6(stage?.name)) throw new Error('stage.name must be a non-empty string');
  if (!Number.isFinite(stage.ms) || stage.ms < 0) throw new Error('stage.ms must be a finite non-negative number');
  if (!Array.isArray(profile.stages)) profile.stages = [];

  profile.stages.push({
    name: stage.name,
    ms: roundMs(stage.ms),
    shape: Array.isArray(stage.shape) ? [...stage.shape] : undefined,
    metadata: stage.metadata ? JSON.parse(JSON.stringify(stage.metadata)) : undefined,
  });
  return profile;
}

function finishStagedSubmitProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('profile must be an object');
  const stages = Array.isArray(profile.stages) ? profile.stages : [];
  const totalMs = roundMs(stages.reduce((sum, stage) => sum + (Number.isFinite(stage.ms) ? stage.ms : 0), 0));

  return {
    ...profile,
    schema: profile.schema || PROFILE_SCHEMA,
    stages,
    stageNames: stages.map(stage => stage.name),
    totalMs,
  };
}

function validateStagedSubmitProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile must be an object'] };
  }
  if (profile.schema !== PROFILE_SCHEMA) errors.push(`schema must be ${PROFILE_SCHEMA}`);
  if (!isNonEmptyString$6(profile.route)) errors.push('route must be a non-empty string');
  if (!isNonEmptyString$6(profile.timingSource)) errors.push('timingSource must be a non-empty string');
  if (!Array.isArray(profile.stages) || profile.stages.length === 0) {
    errors.push('stages must be a non-empty array');
  }
  if (!Number.isFinite(profile.totalMs) || profile.totalMs < 0) {
    errors.push('totalMs must be a finite non-negative number');
  }

  const stageNames = new Set();
  if (Array.isArray(profile.stages)) {
    profile.stages.forEach((stage, index) => {
      if (!isNonEmptyString$6(stage.name)) errors.push(`stages[${index}].name must be a non-empty string`);
      if (!Number.isFinite(stage.ms) || stage.ms < 0) errors.push(`stages[${index}].ms must be a finite non-negative number`);
      if (isNonEmptyString$6(stage.name)) stageNames.add(stage.name);
    });
  }

  if (Array.isArray(profile.requiredStages)) {
    for (const required of profile.requiredStages) {
      if (!stageNames.has(required)) errors.push(`missing required stage ${required}`);
    }
  }

  if (profile.timingSource === 'timestamp-query' && profile.timestampQueryValidatedAgainstStaged !== true) {
    errors.push('timestamp-query profile must be validated against staged-submit timings');
  }

  return { ok: errors.length === 0, errors };
}

function validateRouteReceiptArtifact(value, name) {
  if (!value || typeof value !== 'object') throw new Error(`${name} output must be an object`);
  if (typeof value.artifactId !== 'string' || value.artifactId.length === 0) {
    throw new Error(`${name} output must include artifactId`);
  }
  if (typeof value.sha256 !== 'string' || value.sha256.length === 0) {
    throw new Error(`${name} output must include sha256`);
  }
  if (!Array.isArray(value.shape) || value.shape.length === 0) {
    throw new Error(`${name} output must include shape`);
  }
}

function createRouteReceiptInputArtifact(role, artifact) {
  return {
    role,
    artifactId: artifact.artifactId,
    sha256: artifact.sha256,
    shape: Array.isArray(artifact.shape) ? [...artifact.shape] : undefined,
  };
}

function createRouteReceiptArtifacts({ artifacts, roles }) {
  if (!artifacts || typeof artifacts !== 'object') throw new Error('artifacts must be an object');
  if (!Array.isArray(roles) || roles.length === 0) throw new Error('roles must be a non-empty array');

  const outputs = [];
  for (const role of roles) {
    const key = role.key;
    const artifact = artifacts[key];
    if (!artifact) {
      if (role.required !== false) throw new Error(`${key} output is required`);
      continue;
    }

    validateRouteReceiptArtifact(artifact, key);
    outputs.push({
      role: role.role,
      artifactId: artifact.artifactId,
      sha256: artifact.sha256,
      shape: [...artifact.shape],
      status: artifact.status || 'real',
    });
  }
  return outputs;
}

function finishAndValidateRouteProfile(profile) {
  const finished = finishStagedSubmitProfile(profile);
  const result = validateStagedSubmitProfile(finished);
  if (!result.ok) throw new Error(`invalid staged profile: ${result.errors.join('; ')}`);
  return finished;
}

function validateRouteReceiptBackendIdentity(backend) {
  const result = validateWebGpuBackendIdentity(backend);
  if (!result.ok) throw new Error(`invalid WebGPU backend identity: ${result.errors.join('; ')}`);
  return backend;
}

function createWebGpuRouteReceiptFromArtifacts(input) {
  validateRouteReceiptBackendIdentity(input.backend);
  const profile = finishAndValidateRouteProfile(input.profile);

  return createWebGpuLocalRouteReceipt({
    requestedRouteId: input.requestedRouteId,
    effectiveRouteId: input.effectiveRouteId || input.requestedRouteId,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: input.model,
    kernel: input.kernel,
    inputs: input.inputs,
    outputs: input.outputs,
    timings: {
      source: profile.timingSource,
      totalMs: profile.totalMs,
      stages: profile.stages,
      profile,
    },
  });
}

const WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA = 'kaminos.webgpu-foreground-opportunity-interlock.v0';
const WEBGPU_FOREGROUND_OPPORTUNITY_PRESSURE_SCHEMA = 'kaminos.webgpu-foreground-opportunity-pressure.v0';
const WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA = 'kaminos.webgpu-foreground-opportunity-receipt.v0';
const WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA = 'kaminos.webgpu-foreground-opportunity-service.v0';

function isPlainObject$4(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString$5(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone$4(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze$3(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze$3(child);
  return Object.freeze(value);
}

function normalizeError$3(error) {
  return {
    name: isNonEmptyString$5(error?.name) ? error.name : 'Error',
    message: isNonEmptyString$5(error?.message) ? error.message : String(error),
  };
}

function validateBoundary(input) {
  if (!isPlainObject$4(input)) throw new Error('foreground opportunity boundary must be an object');
  for (const key of ['invocationId', 'boundaryId', 'dutyId', 'phase']) {
    if (!isNonEmptyString$5(input[key])) throw new Error(`${key} must be a non-empty string`);
  }
  if (input.position !== 'before-encode') {
    throw new Error('foreground opportunities are serviced only at position before-encode');
  }
  if (input.metadata != null && !isPlainObject$4(input.metadata)) {
    throw new Error('foreground opportunity boundary metadata must be an object when provided');
  }
  return deepFreeze$3({
    invocationId: input.invocationId,
    boundaryId: input.boundaryId,
    dutyId: input.dutyId,
    phase: input.phase,
    position: input.position,
    metadata: clone$4(input.metadata || {}),
  });
}

function createWebGpuForegroundOpportunityInterlock(input = {}) {
  if (!isNonEmptyString$5(input.routeId)) throw new Error('routeId must be a non-empty string');
  if (!isNonEmptyString$5(input.runId)) throw new Error('runId must be a non-empty caller-owned identity');
  if (!input.device || typeof input.device !== 'object') throw new Error('device must be an object');
  if (!input.queue || typeof input.queue !== 'object') throw new Error('queue must be an object');
  if (input.maxRequests != null || input.maxReceipts != null || input.retention != null && input.retention !== 'uncapped') {
    throw new Error('foreground opportunity retention is uncapped; capped retention is not supported');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const state = {
    routeId: input.routeId,
    runId: input.runId,
    sequence: 0,
    serviceSequence: 0,
    pending: [],
    requests: new Map(),
    receipts: [],
    services: [],
    activeRequestCount: 0,
    activeServiceCount: 0,
    queuedServiceCount: 0,
    serviceTail: Promise.resolve(),
    noDemandBoundaryCount: 0,
  };

  function finishRequest(requestState, receiptInput) {
    if (requestState.receipt) return requestState.receipt;
    const receipt = deepFreeze$3({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_RECEIPT_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      requestId: requestState.requestId,
      requestSequence: requestState.sequence,
      status: receiptInput.status,
      requestedAtMs: requestState.requestedAtMs,
      startedAtMs: receiptInput.startedAtMs ?? null,
      settledAtMs: receiptInput.settledAtMs,
      elapsedMs: receiptInput.startedAtMs == null
        ? 0
        : Math.max(0, receiptInput.settledAtMs - receiptInput.startedAtMs),
      boundary: clone$4(receiptInput.boundary || null),
      metadata: clone$4(requestState.metadata),
      result: clone$4(receiptInput.result ?? null),
      submissionCount: receiptInput.submissions?.filter(row => row.submissionStatus === 'queue-submit-returned').length || 0,
      submissions: clone$4(receiptInput.submissions || []),
      cancellation: clone$4(receiptInput.cancellation || null),
      failure: clone$4(receiptInput.failure || null),
      authority: 'foreground-callback-and-queue-submission-observed-no-gpu-completion-or-presentation-claim',
    });
    requestState.status = receipt.status;
    requestState.receipt = receipt;
    state.receipts.push(clone$4(receipt));
    requestState.resolveCompletion(receipt);
    return receipt;
  }

  function request(requestInput = {}) {
    if (!isPlainObject$4(requestInput)) throw new Error('foreground opportunity request must be an object');
    if (!isNonEmptyString$5(requestInput.requestId)) throw new Error('requestId must be a non-empty string');
    if (state.requests.has(requestInput.requestId)) {
      throw new Error(`duplicate foreground opportunity request ${requestInput.requestId}`);
    }
    if (typeof requestInput.run !== 'function') throw new Error('foreground opportunity run must be a function');
    if (requestInput.metadata != null && !isPlainObject$4(requestInput.metadata)) {
      throw new Error('foreground opportunity metadata must be an object when provided');
    }
    state.sequence += 1;
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const abortController = new AbortController();
    const requestState = {
      requestId: requestInput.requestId,
      sequence: state.sequence,
      requestedAtMs: now(),
      metadata: clone$4(requestInput.metadata || {}),
      run: requestInput.run,
      status: 'pending',
      receipt: null,
      resolveCompletion,
      abortController,
      cancellationReason: null,
    };
    state.requests.set(requestState.requestId, requestState);
    state.pending.push(requestState);

    return Object.freeze({
      requestId: requestState.requestId,
      completion,
      cancel(reason = 'foreground-opportunity-canceled') {
        if (requestState.status === 'active') {
          requestState.cancellationReason = String(reason);
          requestState.abortController.abort(requestState.cancellationReason);
          return deepFreeze$3({
            status: 'cancellation-requested',
            requestId: requestState.requestId,
            reason: requestState.cancellationReason,
          });
        }
        if (requestState.status !== 'pending') {
          return requestState.receipt || deepFreeze$3({
            status: requestState.status,
            requestId: requestState.requestId,
          });
        }
        requestState.abortController.abort(reason);
        const receipt = finishRequest(requestState, {
          status: 'canceled-before-service',
          settledAtMs: now(),
          cancellation: { reason: String(reason) },
        });
        state.pending = state.pending.filter(candidate => candidate !== requestState);
        return receipt;
      },
    });
  }

  async function serviceBoundaryTurn(boundary) {
    const captured = state.pending.filter(requestState => requestState.status === 'pending');
    if (captured.length === 0) {
      state.noDemandBoundaryCount += 1;
      return deepFreeze$3({
        schema: WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA,
        status: 'no-demand',
        routeId: state.routeId,
        runId: state.runId,
        boundary,
        capturedRequestCount: 0,
        servicedRequestCount: 0,
        failures: [],
        authority: 'no-foreground-demand-observed-at-safe-boundary',
      });
    }
    const capturedSet = new Set(captured);
    state.pending = state.pending.filter(requestState => !capturedSet.has(requestState));
    state.serviceSequence += 1;
    const serviceStartedAtMs = now();
    const receipts = [];
    const failures = [];

    for (const requestState of captured) {
      if (requestState.status !== 'pending') continue;
      requestState.status = 'active';
      state.activeRequestCount += 1;
      const startedAtMs = now();
      const submissions = [];
      let result = null;
      let failure = null;
      try {
        result = await requestState.run(Object.freeze({
          schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
          routeId: state.routeId,
          runId: state.runId,
          requestId: requestState.requestId,
          boundary,
          device: input.device,
          queue: input.queue,
          signal: requestState.abortController.signal,
          submit(commandBuffers, submissionInput = {}) {
            if (requestState.status !== 'active') {
              throw new Error('foreground opportunity submission lease is not active');
            }
            if (requestState.abortController.signal.aborted) {
              throw new Error('foreground opportunity was canceled before submission');
            }
            if (!Array.isArray(commandBuffers) || commandBuffers.length === 0) {
              throw new Error('foreground opportunity submit requires a non-empty command buffer array');
            }
            if (!isPlainObject$4(submissionInput)) throw new Error('foreground submission input must be an object');
            const submissionId = submissionInput.submissionId
              || `${requestState.requestId}:submission:${submissions.length + 1}`;
            if (!isNonEmptyString$5(submissionId)) throw new Error('submissionId must be a non-empty string');
            if (submissions.some(row => row.submissionId === submissionId)) {
              throw new Error(`duplicate foreground submission ${submissionId}`);
            }
            if (typeof input.queue.submit !== 'function') throw new Error('queue.submit must be available');
            let submissionMetadata;
            try {
              submissionMetadata = clone$4(submissionInput.metadata || {});
            } catch (error) {
              throw new Error(`foreground submission metadata must be JSON-serializable: ${error.message}`);
            }
            const submittedAtMs = now();
            try {
              input.queue.submit(commandBuffers);
              const row = deepFreeze$3({
                submissionId,
                submissionSequence: submissions.length + 1,
                commandBufferCount: commandBuffers.length,
                submittedAtMs,
                returnedAtMs: now(),
                submissionStatus: 'queue-submit-returned',
                metadata: submissionMetadata,
                authority: 'queue-submit-call-returned-no-gpu-completion-or-presentation-claim',
              });
              submissions.push(row);
              return row;
            } catch (error) {
              submissions.push(deepFreeze$3({
                submissionId,
                submissionSequence: submissions.length + 1,
                commandBufferCount: commandBuffers.length,
                submittedAtMs,
                returnedAtMs: now(),
                submissionStatus: 'queue-submit-threw',
                metadata: submissionMetadata,
                failure: normalizeError$3(error),
                authority: 'queue-submit-call-failed-no-gpu-submission-claim',
              }));
              throw error;
            }
          },
        }));
      } catch (error) {
        failure = {
          phase: 'foreground-callback',
          error: normalizeError$3(error),
        };
      } finally {
        state.activeRequestCount -= 1;
      }
      const successfulSubmissionCount = submissions
        .filter(row => row.submissionStatus === 'queue-submit-returned').length;
      const canceledDuringService = requestState.abortController.signal.aborted;
      let receiptResult = null;
      if (!failure && !canceledDuringService) {
        try {
          receiptResult = clone$4(result ?? null);
        } catch (error) {
          failure = {
            phase: 'foreground-result-serialization',
            error: normalizeError$3(error),
          };
        }
      }
      const receipt = finishRequest(requestState, {
        status: canceledDuringService
          ? 'canceled-during-service'
          : (failure
            ? (successfulSubmissionCount > 0 ? 'failed-after-submission' : 'failed-before-submission')
            : 'completed'),
        startedAtMs,
        settledAtMs: now(),
        boundary,
        result: receiptResult,
        submissions,
        cancellation: canceledDuringService
          ? {
              reason: requestState.cancellationReason
                || String(requestState.abortController.signal.reason || 'foreground-opportunity-canceled'),
              callbackError: failure ? clone$4(failure.error) : null,
            }
          : null,
        failure: canceledDuringService ? null : failure,
      });
      receipts.push(receipt);
      if (failure && !canceledDuringService) failures.push({
        requestId: requestState.requestId,
        status: receipt.status,
        failure: clone$4(failure),
      });
    }

    const service = deepFreeze$3({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SERVICE_SCHEMA,
      status: failures.length > 0 ? 'failed' : 'serviced',
      routeId: state.routeId,
      runId: state.runId,
      serviceSequence: state.serviceSequence,
      boundary,
      startedAtMs: serviceStartedAtMs,
      settledAtMs: now(),
      capturedRequestCount: captured.length,
      servicedRequestCount: receipts.length,
      receiptIds: receipts.map(receipt => receipt.requestId),
      failures,
      authority: 'foreground-callbacks-settled-before-next-inference-encode-no-gpu-completion-or-presentation-claim',
    });
    state.services.push(clone$4(service));
    return service;
  }

  async function serviceAtBoundary(boundaryInput = {}) {
    const boundary = validateBoundary(boundaryInput);
    const precedingTurn = state.serviceTail;
    let releaseTurn;
    state.serviceTail = new Promise(resolve => { releaseTurn = resolve; });
    state.queuedServiceCount += 1;
    await precedingTurn;
    state.queuedServiceCount -= 1;
    state.activeServiceCount += 1;
    try {
      return await serviceBoundaryTurn(boundary);
    } finally {
      state.activeServiceCount -= 1;
      releaseTurn();
    }
  }

  function pressureSnapshot() {
    return Object.freeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_PRESSURE_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      pendingRequestCount: state.pending.length,
      activeRequestCount: state.activeRequestCount,
      activeServiceCount: state.activeServiceCount,
      queuedServiceCount: state.queuedServiceCount,
      authority: 'live-foreground-opportunity-counters-no-history-clone',
    });
  }

  function snapshot() {
    const pressure = pressureSnapshot();
    return deepFreeze$3({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
      routeId: state.routeId,
      runId: state.runId,
      retention: 'uncapped',
      requestCount: state.requests.size,
      pendingRequestCount: pressure.pendingRequestCount,
      activeRequestCount: pressure.activeRequestCount,
      activeServiceCount: pressure.activeServiceCount,
      queuedServiceCount: pressure.queuedServiceCount,
      receiptCount: state.receipts.length,
      receipts: clone$4(state.receipts),
      serviceCount: state.services.length,
      services: clone$4(state.services),
      noDemandBoundaryCount: state.noDemandBoundaryCount,
      authority: 'foreground-opportunity-request-and-queue-submit-observation-no-presentation-claim',
    });
  }

  function finish() {
    const report = snapshot();
    return deepFreeze$3({
      ...report,
      status: report.pendingRequestCount === 0
          && report.activeRequestCount === 0
          && report.activeServiceCount === 0
          && report.queuedServiceCount === 0
        ? 'succeeded'
        : 'incomplete',
    });
  }

  return Object.freeze({
    schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
    request,
    serviceAtBoundary,
    pressureSnapshot,
    snapshot,
    finish,
  });
}

function isNonEmptyString$4(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const GPU_OBJECT_IDENTITY_KEYS = new Set(['module', 'layout']);

function createObjectIdentityTracker() {
  const objectIds = new WeakMap();
  let nextObjectId = 1;

  return function getObjectId(value) {
    if (!objectIds.has(value)) {
      objectIds.set(value, nextObjectId);
      nextObjectId += 1;
    }
    return objectIds.get(value);
  };
}

function pipelineDescriptorKey(descriptor, getObjectId) {
  const seen = new WeakSet();
  return JSON.stringify(descriptor, (key, inner) => {
    if (typeof inner === 'function') return `[Function:${inner.name || 'anonymous'}]`;
    if (!inner || typeof inner !== 'object') return inner;
    if (GPU_OBJECT_IDENTITY_KEYS.has(key)) {
      return { __gpuObjectId: getObjectId(inner) };
    }
    if (seen.has(inner)) return '[Circular]';
    seen.add(inner);
    if (Array.isArray(inner)) return inner;
    const keys = Object.keys(inner);
    if (keys.length === 0) return { __objectId: getObjectId(inner) };
    const out = {};
    for (const objectKey of keys.sort()) out[objectKey] = inner[objectKey];
    return out;
  });
}

function createWebGpuResourceCaches(device) {
  if (!device || typeof device !== 'object') throw new Error('device must be an object');

  const shaderModules = new Map();
  const computePipelines = new Map();
  const getObjectId = createObjectIdentityTracker();

  return {
    getShaderModule(label, code, descriptor = {}) {
      if (!isNonEmptyString$4(label)) throw new Error('shader module label must be a non-empty string');
      if (!isNonEmptyString$4(code)) throw new Error('shader module code must be a non-empty string');
      if (typeof device.createShaderModule !== 'function') throw new Error('device.createShaderModule must be available');

      const key = `${label}\u0000${code}`;
      if (!shaderModules.has(key)) {
        shaderModules.set(key, device.createShaderModule({
          ...descriptor,
          label,
          code,
        }));
      }
      return shaderModules.get(key);
    },

    getComputePipeline(label, descriptor) {
      if (!isNonEmptyString$4(label)) throw new Error('compute pipeline label must be a non-empty string');
      if (!descriptor || typeof descriptor !== 'object') throw new Error('compute pipeline descriptor must be an object');
      if (typeof device.createComputePipeline !== 'function') throw new Error('device.createComputePipeline must be available');

      const key = `${label}\u0000${pipelineDescriptorKey(descriptor, getObjectId)}`;
      if (!computePipelines.has(key)) {
        computePipelines.set(key, device.createComputePipeline({
          ...descriptor,
          label,
        }));
      }
      return computePipelines.get(key);
    },

    clear() {
      shaderModules.clear();
      computePipelines.clear();
    },

    sizes() {
      return {
        shaderModules: shaderModules.size,
        computePipelines: computePipelines.size,
      };
    },
  };
}

const WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA =
  'kaminos.webgpu-cooperative-boundary-manifest.v0';

const BOUNDARY_KINDS = new Set(['gpu-command', 'cpu-work']);
const COMMAND_DUTY_KINDS = new Set(['compute', 'copy', 'render', 'mixed']);
const HOST_PHASES = new Set([
  'cpu-preprocess',
  'command-encoding',
  'queue-submission',
  'readback',
  'presentation',
  'other',
]);
const YIELD_POLICIES = new Set(['after-duty', 'none']);
const TOP_LEVEL_KEYS = new Set(['manifestId', 'routeId', 'phases', 'metadata']);
const PHASE_KEYS = new Set(['phaseId', 'boundaries', 'metadata']);
const BOUNDARY_KEYS = new Set([
  'boundaryId',
  'kind',
  'unit',
  'totalItems',
  'progressWeight',
  'commandDutyKind',
  'hostPhase',
  'chunking',
  'yieldPolicy',
  'resources',
  'metadata',
]);

function isPlainObject$3(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString$3(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireIdentity(name, value) {
  if (!isNonEmptyString$3(value)) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function requirePositiveSafeInteger$2(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function clone$3(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze$2(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze$2(child);
  return Object.freeze(value);
}

function rejectUnsupportedKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} has unsupported field ${key}`);
  }
}

function normalizeMetadata(value, name) {
  if (value == null) return {};
  if (!isPlainObject$3(value)) throw new TypeError(`${name} must be an object when provided`);
  return clone$3(value);
}

function normalizeResourceList(value, name) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  const resources = value.map((resource, index) => requireIdentity(`${name}[${index}]`, resource));
  if (new Set(resources).size !== resources.length) {
    throw new TypeError(`${name} must not contain duplicate resource identities`);
  }
  return resources;
}

function normalizeResources(value, name) {
  if (value == null) return { retain: [], produce: [], release: [] };
  if (!isPlainObject$3(value)) throw new TypeError(`${name} must be an object when provided`);
  rejectUnsupportedKeys(value, new Set(['retain', 'produce', 'release']), name);
  return {
    retain: normalizeResourceList(value.retain, `${name}.retain`),
    produce: normalizeResourceList(value.produce, `${name}.produce`),
    release: normalizeResourceList(value.release, `${name}.release`),
  };
}

function normalizeChunking(value, kind, name) {
  if (!isPlainObject$3(value)) throw new TypeError(`${name} must be an object`);
  if (value.mode === 'fixed') {
    rejectUnsupportedKeys(value, new Set(['mode', 'chunkItems']), name);
    return {
      mode: 'fixed',
      chunkItems: requirePositiveSafeInteger$2(`${name}.chunkItems`, value.chunkItems),
    };
  }
  if (value.mode !== 'adaptive') {
    throw new TypeError(`${name}.mode must be fixed or adaptive`);
  }
  if (kind !== 'gpu-command') {
    throw new TypeError(`${name}.mode adaptive is supported only for gpu-command boundaries`);
  }
  rejectUnsupportedKeys(
    value,
    new Set(['mode', 'initialItems', 'minItems', 'maxItems', 'targetDurationMs', 'adjustmentGain']),
    name,
  );
  const initialItems = requirePositiveSafeInteger$2(`${name}.initialItems`, value.initialItems);
  const minItems = requirePositiveSafeInteger$2(`${name}.minItems`, value.minItems);
  const maxItems = requirePositiveSafeInteger$2(`${name}.maxItems`, value.maxItems);
  if (maxItems < minItems) throw new TypeError(`${name}.maxItems must be at least minItems`);
  if (initialItems < minItems || initialItems > maxItems) {
    throw new TypeError(`${name}.initialItems must be within minItems and maxItems`);
  }
  if (!Number.isFinite(value.targetDurationMs) || value.targetDurationMs <= 0) {
    throw new TypeError(`${name}.targetDurationMs must be finite and greater than zero`);
  }
  const adjustmentGain = value.adjustmentGain === undefined ? 1 : value.adjustmentGain;
  if (!Number.isFinite(adjustmentGain) || adjustmentGain <= 0 || adjustmentGain > 1) {
    throw new TypeError(`${name}.adjustmentGain must be finite, greater than zero, and at most one`);
  }
  return {
    mode: 'adaptive',
    initialItems,
    minItems,
    maxItems,
    targetDurationMs: value.targetDurationMs,
    adjustmentGain,
  };
}

function normalizeBoundary(value, phaseId, boundaryIds, index) {
  const name = `phases.${phaseId}.boundaries[${index}]`;
  if (!isPlainObject$3(value)) throw new TypeError(`${name} must be an object`);
  rejectUnsupportedKeys(value, BOUNDARY_KEYS, name);
  const boundaryId = requireIdentity(`${name}.boundaryId`, value.boundaryId);
  if (boundaryIds.has(boundaryId)) throw new TypeError(`duplicate boundaryId: ${boundaryId}`);
  boundaryIds.add(boundaryId);

  if (!BOUNDARY_KINDS.has(value.kind)) {
    throw new TypeError(`${name}.kind must be gpu-command or cpu-work`);
  }
  const totalItems = value.totalItems == null
    ? null
    : requirePositiveSafeInteger$2(`${name}.totalItems`, value.totalItems);
  if (!Number.isFinite(value.progressWeight) || value.progressWeight <= 0) {
    throw new TypeError(`${name}.progressWeight must be finite and greater than zero`);
  }
  const yieldPolicy = value.yieldPolicy || 'after-duty';
  if (!YIELD_POLICIES.has(yieldPolicy)) {
    throw new TypeError(`${name}.yieldPolicy must be after-duty or none`);
  }

  let commandDutyKind = null;
  let hostPhase = null;
  if (value.kind === 'gpu-command') {
    commandDutyKind = value.commandDutyKind || 'compute';
    if (!COMMAND_DUTY_KINDS.has(commandDutyKind)) {
      throw new TypeError(`${name}.commandDutyKind is unsupported`);
    }
    if (value.hostPhase != null) throw new TypeError(`${name}.hostPhase belongs only to cpu-work boundaries`);
  } else {
    hostPhase = value.hostPhase || 'other';
    if (!HOST_PHASES.has(hostPhase)) throw new TypeError(`${name}.hostPhase is unsupported`);
    if (value.commandDutyKind != null) {
      throw new TypeError(`${name}.commandDutyKind belongs only to gpu-command boundaries`);
    }
  }

  return {
    boundaryId,
    kind: value.kind,
    unit: requireIdentity(`${name}.unit`, value.unit),
    totalItems,
    progressWeight: value.progressWeight,
    commandDutyKind,
    hostPhase,
    chunking: normalizeChunking(value.chunking, value.kind, `${name}.chunking`),
    yieldPolicy,
    resources: normalizeResources(value.resources, `${name}.resources`),
    metadata: normalizeMetadata(value.metadata, `${name}.metadata`),
  };
}

function defineWebGpuCooperativeBoundaryManifest(input = {}) {
  if (!isPlainObject$3(input)) throw new TypeError('cooperative boundary manifest input must be an object');
  rejectUnsupportedKeys(input, TOP_LEVEL_KEYS, 'cooperative boundary manifest');
  const manifestId = requireIdentity('manifestId', input.manifestId);
  const routeId = requireIdentity('routeId', input.routeId);
  if (!Array.isArray(input.phases) || input.phases.length === 0) {
    throw new TypeError('phases must be a non-empty array');
  }

  const phaseIds = new Set();
  const boundaryIds = new Set();
  const phases = input.phases.map((phase, phaseIndex) => {
    const name = `phases[${phaseIndex}]`;
    if (!isPlainObject$3(phase)) throw new TypeError(`${name} must be an object`);
    rejectUnsupportedKeys(phase, PHASE_KEYS, name);
    const phaseId = requireIdentity(`${name}.phaseId`, phase.phaseId);
    if (phaseIds.has(phaseId)) throw new TypeError(`duplicate phaseId: ${phaseId}`);
    phaseIds.add(phaseId);
    if (!Array.isArray(phase.boundaries) || phase.boundaries.length === 0) {
      throw new TypeError(`${name}.boundaries must be a non-empty array`);
    }
    const boundaries = phase.boundaries.map((boundary, boundaryIndex) => (
      normalizeBoundary(boundary, phaseId, boundaryIds, boundaryIndex)
    ));
    return {
      phaseId,
      progressWeight: boundaries.reduce((sum, boundary) => sum + boundary.progressWeight, 0),
      boundaries,
      metadata: normalizeMetadata(phase.metadata, `${name}.metadata`),
    };
  });

  return deepFreeze$2({
    schema: WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA,
    manifestId,
    routeId,
    progressWeight: phases.reduce((sum, phase) => sum + phase.progressWeight, 0),
    phases,
    metadata: normalizeMetadata(input.metadata, 'metadata'),
  });
}

const WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-planner.v0';
const WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-range.v0';
const WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA = 'kaminos.webgpu-adaptive-command-duty-observation.v0';

const ADAPTIVE_TIMING_AUTHORITIES = new Set([
  'queue-work-done',
  'gpu-timestamp-query',
]);

function isPlainObject$2(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString$2(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requirePositiveSafeInteger$1(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}

function clone$2(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze$1(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze$1(child);
  return Object.freeze(value);
}

function normalizeError$2(error) {
  return {
    name: isNonEmptyString$2(error?.name) ? error.name : 'Error',
    message: isNonEmptyString$2(error?.message) ? error.message : String(error),
  };
}

function normalizeInput(input) {
  if (!isPlainObject$2(input)) throw new Error('adaptive command duty planner input must be an object');
  if (!isNonEmptyString$2(input.plannerId)) throw new Error('plannerId must be a non-empty string');
  if (!isNonEmptyString$2(input.unit)) throw new Error('unit must be a non-empty string');
  requirePositiveSafeInteger$1(input.totalItems, 'totalItems');
  requirePositiveSafeInteger$1(input.initialChunkItems, 'initialChunkItems');
  if (!Number.isFinite(input.targetDurationMs) || input.targetDurationMs <= 0) {
    throw new Error('targetDurationMs must be finite and greater than zero');
  }
  const adjustmentGain = input.adjustmentGain === undefined ? 1 : input.adjustmentGain;
  if (!Number.isFinite(adjustmentGain) || adjustmentGain <= 0 || adjustmentGain > 1) {
    throw new Error('adjustmentGain must be finite, greater than zero, and at most one');
  }
  if (!isPlainObject$2(input.bounds)) throw new Error('bounds must be a caller-declared object');
  const { minChunkItems, maxChunkItems } = input.bounds;
  requirePositiveSafeInteger$1(minChunkItems, 'bounds.minChunkItems');
  requirePositiveSafeInteger$1(maxChunkItems, 'bounds.maxChunkItems');
  if (maxChunkItems < minChunkItems) {
    throw new Error('bounds.maxChunkItems must be greater than or equal to bounds.minChunkItems');
  }
  if (input.initialChunkItems < minChunkItems || input.initialChunkItems > maxChunkItems) {
    throw new Error('initialChunkItems must be within caller-declared bounds');
  }
  if (input.metadata != null && !isPlainObject$2(input.metadata)) {
    throw new Error('metadata must be an object when provided');
  }
  if (input.retention != null && input.retention !== 'uncapped') {
    throw new Error('adaptive command duty history retention is uncapped');
  }
  return {
    plannerId: input.plannerId,
    unit: input.unit,
    totalItems: input.totalItems,
    initialChunkItems: input.initialChunkItems,
    targetDurationMs: input.targetDurationMs,
    requestedAdjustmentGain: adjustmentGain,
    effectiveAdjustmentGain: adjustmentGain,
    bounds: { minChunkItems, maxChunkItems },
    metadata: clone$2(input.metadata || {}),
  };
}

function nextChunkFromObservation({
  range,
  observedDurationMs,
  targetDurationMs,
  adjustmentGain,
  bounds,
}) {
  let fullGainCorrectionRatio;
  if (observedDurationMs === 0) {
    fullGainCorrectionRatio = Number.POSITIVE_INFINITY;
  } else {
    fullGainCorrectionRatio = targetDurationMs / observedDurationMs;
  }
  const effectiveCorrectionRatio = fullGainCorrectionRatio ** adjustmentGain;
  const rawChunkItems = range.itemCount * fullGainCorrectionRatio;
  const effectiveRawChunkItems = range.itemCount * effectiveCorrectionRatio;

  let nextChunkItems;
  let boundApplication = null;
  if (effectiveRawChunkItems < bounds.minChunkItems) {
    nextChunkItems = bounds.minChunkItems;
    boundApplication = 'minChunkItems';
  } else if (effectiveRawChunkItems > bounds.maxChunkItems) {
    nextChunkItems = bounds.maxChunkItems;
    boundApplication = 'maxChunkItems';
  } else {
    nextChunkItems = Math.max(
      bounds.minChunkItems,
      Math.min(bounds.maxChunkItems, Math.round(effectiveRawChunkItems)),
    );
  }

  return {
    fullGainCorrectionRatio: Number.isFinite(fullGainCorrectionRatio)
      ? fullGainCorrectionRatio
      : null,
    effectiveCorrectionRatio: Number.isFinite(effectiveCorrectionRatio)
      ? effectiveCorrectionRatio
      : null,
    rawChunkItems: Number.isFinite(rawChunkItems) ? rawChunkItems : null,
    effectiveRawChunkItems: Number.isFinite(effectiveRawChunkItems)
      ? effectiveRawChunkItems
      : null,
    nextChunkItems,
    boundApplication,
    adjustment: nextChunkItems < range.plannedChunkItems
      ? 'decrease'
      : nextChunkItems > range.plannedChunkItems
        ? 'increase'
        : 'maintain',
  };
}

function createWebGpuAdaptiveCommandDutyPlanner(input = {}) {
  const config = normalizeInput(input);
  const state = {
    status: 'active',
    completedItems: 0,
    currentChunkItems: config.initialChunkItems,
    pendingRange: null,
    ranges: [],
    observations: [],
    failure: null,
  };

  function snapshot() {
    return clone$2({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
      plannerId: config.plannerId,
      unit: config.unit,
      status: state.status,
      totalItems: config.totalItems,
      completedItems: state.completedItems,
      progress: state.completedItems / config.totalItems,
      initialChunkItems: config.initialChunkItems,
      currentChunkItems: state.currentChunkItems,
      targetDurationMs: config.targetDurationMs,
      requestedAdjustmentGain: config.requestedAdjustmentGain,
      effectiveAdjustmentGain: config.effectiveAdjustmentGain,
      bounds: config.bounds,
      metadata: config.metadata,
      retention: 'uncapped',
      pendingRangeId: state.pendingRange?.rangeId || null,
      rangeCount: state.ranges.length,
      actualRangeCount: state.status === 'complete' ? state.ranges.length : null,
      rangeCountAuthority: state.status === 'complete' ? 'actual' : 'open-until-completion',
      ranges: state.ranges,
      observations: state.observations,
      failure: state.failure,
    });
  }

  function nextRange() {
    if (state.status === 'failed') throw new Error('failed planner cannot produce another range');
    if (state.status === 'complete') return null;
    if (state.pendingRange) throw new Error(`pending range ${state.pendingRange.rangeId} must be observed or failed first`);

    const itemStart = state.completedItems;
    const itemCount = Math.min(state.currentChunkItems, config.totalItems - itemStart);
    const itemEnd = itemStart + itemCount;
    const rangeIndex = state.ranges.length;
    const range = deepFreeze$1({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_RANGE_SCHEMA,
      plannerId: config.plannerId,
      rangeId: `${config.plannerId}:${rangeIndex}`,
      rangeIndex,
      rangeTotal: null,
      rangeCountAuthority: 'actual-after-completion',
      unit: config.unit,
      itemStart,
      itemEnd,
      itemCount,
      totalItems: config.totalItems,
      completedItemsBefore: itemStart,
      completedItemsAfter: itemEnd,
      progressBefore: itemStart / config.totalItems,
      progressAfter: itemEnd / config.totalItems,
      plannedChunkItems: state.currentChunkItems,
      targetDurationMs: config.targetDurationMs,
      requestedAdjustmentGain: config.requestedAdjustmentGain,
      effectiveAdjustmentGain: config.effectiveAdjustmentGain,
      bounds: clone$2(config.bounds),
      metadata: clone$2(config.metadata),
    });
    state.pendingRange = range;
    state.ranges.push({ ...clone$2(range), status: 'pending-observation' });
    return range;
  }

  function requirePendingRange(rangeId) {
    if (!state.pendingRange) throw new Error('adaptive command duty planner has no pending range');
    if (rangeId !== state.pendingRange.rangeId) {
      throw new Error(`rangeId ${rangeId || '<missing>'} does not match pending range ${state.pendingRange.rangeId}`);
    }
    return state.pendingRange;
  }

  function observeRange(observation = {}) {
    if (state.status !== 'active') throw new Error(`${state.status} planner cannot accept range observations`);
    if (!isPlainObject$2(observation)) throw new Error('range observation must be an object');
    const range = requirePendingRange(observation.rangeId);
    if (!ADAPTIVE_TIMING_AUTHORITIES.has(observation.timingAuthority)) {
      throw new Error('timingAuthority must be queue-work-done or gpu-timestamp-query');
    }
    if (!Number.isFinite(observation.observedDurationMs) || observation.observedDurationMs < 0) {
      throw new Error('observedDurationMs must be finite and non-negative');
    }
    if (observation.timingAuthority === 'gpu-timestamp-query'
        && observation.observedDurationMs <= 0) {
      throw new Error('gpu-timestamp-query observedDurationMs must be greater than zero');
    }

    state.completedItems = range.itemEnd;
    const complete = state.completedItems === config.totalItems;
    const adjustment = complete
      ? {
          fullGainCorrectionRatio: null,
          effectiveCorrectionRatio: null,
          rawChunkItems: null,
          effectiveRawChunkItems: null,
          nextChunkItems: null,
          boundApplication: null,
          adjustment: 'complete',
        }
      : nextChunkFromObservation({
          range,
          observedDurationMs: observation.observedDurationMs,
          targetDurationMs: config.targetDurationMs,
          adjustmentGain: config.effectiveAdjustmentGain,
          bounds: config.bounds,
        });
    if (!complete) state.currentChunkItems = adjustment.nextChunkItems;
    state.status = complete ? 'complete' : 'active';
    state.pendingRange = null;

    const receipt = deepFreeze$1({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA,
      plannerId: config.plannerId,
      status: complete ? 'planner-complete' : 'range-observed',
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      timingAuthority: observation.timingAuthority,
      observedDurationMs: observation.observedDurationMs,
      targetDurationMs: config.targetDurationMs,
      requestedAdjustmentGain: config.requestedAdjustmentGain,
      effectiveAdjustmentGain: config.effectiveAdjustmentGain,
      fullGainCorrectionRatio: adjustment.fullGainCorrectionRatio,
      effectiveCorrectionRatio: adjustment.effectiveCorrectionRatio,
      observedChunkItems: range.itemCount,
      rawNextChunkItems: adjustment.rawChunkItems,
      effectiveRawNextChunkItems: adjustment.effectiveRawChunkItems,
      nextChunkItems: adjustment.nextChunkItems,
      adjustment: adjustment.adjustment,
      boundApplication: adjustment.boundApplication,
      completedItems: state.completedItems,
      totalItems: config.totalItems,
      progress: state.completedItems / config.totalItems,
      actualRangeCount: complete ? state.ranges.length : null,
      rangeCountAuthority: complete ? 'actual' : 'open-until-completion',
      metadata: clone$2(config.metadata),
    });
    state.ranges[range.rangeIndex] = {
      ...state.ranges[range.rangeIndex],
      status: 'observed',
      observedDurationMs: observation.observedDurationMs,
      timingAuthority: observation.timingAuthority,
    };
    state.observations.push(clone$2(receipt));
    return receipt;
  }

  function failRange(failureInput = {}) {
    if (state.status !== 'active') throw new Error(`${state.status} planner cannot fail a range`);
    if (!isPlainObject$2(failureInput)) throw new Error('range failure must be an object');
    const range = requirePendingRange(failureInput.rangeId);
    if (!isNonEmptyString$2(failureInput.phase)) throw new Error('range failure phase must be a non-empty string');
    const failure = deepFreeze$1({
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      phase: failureInput.phase,
      error: normalizeError$2(failureInput.error),
    });
    state.status = 'failed';
    state.failure = clone$2(failure);
    state.pendingRange = null;
    state.ranges[range.rangeIndex] = {
      ...state.ranges[range.rangeIndex],
      status: 'failed',
      failure: clone$2(failure),
    };
    return deepFreeze$1({
      schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_OBSERVATION_SCHEMA,
      plannerId: config.plannerId,
      status: 'failed',
      completedItems: state.completedItems,
      totalItems: config.totalItems,
      requestedAdjustmentGain: config.requestedAdjustmentGain,
      effectiveAdjustmentGain: config.effectiveAdjustmentGain,
      rangeCountAuthority: 'open-at-failure',
      actualRangeCount: null,
      failure,
      metadata: clone$2(config.metadata),
    });
  }

  return Object.freeze({
    schema: WEBGPU_ADAPTIVE_COMMAND_DUTY_PLANNER_SCHEMA,
    plannerId: config.plannerId,
    unit: config.unit,
    nextRange,
    observeRange,
    failRange,
    snapshot,
  });
}

const WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA =
  'kaminos.webgpu-cooperative-execution-report.v0';
const WEBGPU_COOPERATIVE_PROGRESS_SCHEMA =
  'kaminos.webgpu-cooperative-progress.v0';
const WEBGPU_COOPERATIVE_RANGE_SCHEMA =
  'kaminos.webgpu-cooperative-range.v0';

const SCHEDULING_MODES = new Set(['cooperative', 'disabled']);
const COMPLETION_POLICIES = new Set(['strict-prefix', 'bounded-prefix']);

function isPlainObject$1(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString$1(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function clone$1(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requirePositiveSafeInteger(name, value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function normalizeError$1(error) {
  return {
    name: isNonEmptyString$1(error?.name) ? error.name : 'Error',
    message: isNonEmptyString$1(error?.message) ? error.message : String(error),
  };
}

function readNow(now) {
  const value = now();
  if (!Number.isFinite(value)) throw new TypeError('cooperative execution clock returned a non-finite value');
  return value;
}

function createAbortError(signal) {
  const reason = signal?.reason;
  const error = new Error(
    isNonEmptyString$1(reason?.message)
      ? reason.message
      : isNonEmptyString$1(reason)
        ? reason
        : 'cooperative execution was cancelled',
  );
  error.name = 'AbortError';
  return error;
}

function createFixedRangePlanner({
  plannerId,
  unit,
  totalItems,
  chunkItems,
  metadata,
  maxPendingRanges = 1,
}) {
  const ranges = [];
  let status = 'active';
  let issuedItems = 0;
  let completedItems = 0;
  let pendingRanges = [];
  let failure = null;

  function snapshot() {
    return clone$1({
      status,
      plannerId,
      unit,
      totalItems,
      issuedItems,
      completedItems,
      progress: completedItems / totalItems,
      maxPendingRanges,
      pendingRangeId: pendingRanges[0]?.rangeId || null,
      pendingRangeIds: pendingRanges.map(range => range.rangeId),
      pendingRangeCount: pendingRanges.length,
      rangeCount: ranges.length,
      actualRangeCount: status === 'complete' ? ranges.length : null,
      rangeCountAuthority: status === 'complete' ? 'actual' : 'open-until-completion',
      ranges,
      failure,
    });
  }

  return Object.freeze({
    nextRange() {
      if (status === 'failed') throw new Error('failed planner cannot produce another range');
      if (status === 'complete') return null;
      if (pendingRanges.length >= maxPendingRanges) {
        throw new Error(
          `pending range capacity ${maxPendingRanges} must retire before another range is issued`,
        );
      }
      if (issuedItems === totalItems) return null;
      const itemStart = issuedItems;
      const itemCount = Math.min(chunkItems, totalItems - itemStart);
      const rangeIndex = ranges.length;
      const pendingRange = deepFreeze({
        schema: WEBGPU_COOPERATIVE_RANGE_SCHEMA,
        plannerId,
        rangeId: `${plannerId}:${rangeIndex}`,
        rangeIndex,
        rangeTotal: null,
        rangeCountAuthority: 'actual-after-completion',
        unit,
        itemStart,
        itemEnd: itemStart + itemCount,
        itemCount,
        totalItems,
        completedItemsBefore: itemStart,
        completedItemsAfter: itemStart + itemCount,
        progressBefore: itemStart / totalItems,
        progressAfter: (itemStart + itemCount) / totalItems,
        plannedChunkItems: chunkItems,
        metadata: clone$1(metadata),
      });
      issuedItems = pendingRange.itemEnd;
      pendingRanges.push(pendingRange);
      ranges.push({ ...clone$1(pendingRange), status: 'pending-completion' });
      return pendingRange;
    },

    completeRange(rangeId, detail = {}) {
      if (status !== 'active' || pendingRanges.length === 0) {
        throw new Error('planner has no active range to complete');
      }
      const range = pendingRanges[0];
      if (range.rangeId !== rangeId) {
        throw new Error('range does not match the oldest pending planner range');
      }
      completedItems = range.itemEnd;
      status = completedItems === totalItems ? 'complete' : 'active';
      pendingRanges.shift();
      ranges[range.rangeIndex] = {
        ...ranges[range.rangeIndex],
        ...clone$1(detail),
        status: 'completed',
      };
      return snapshot();
    },

    failRange(rangeId, phase, error) {
      if (status !== 'active' || pendingRanges.length === 0) return snapshot();
      const pendingRange = pendingRanges.find(range => range.rangeId === rangeId);
      if (!pendingRange) throw new Error('range does not match a pending planner range');
      failure = {
        rangeId,
        rangeIndex: pendingRange.rangeIndex,
        phase,
        error: normalizeError$1(error),
      };
      ranges[pendingRange.rangeIndex] = {
        ...ranges[pendingRange.rangeIndex],
        status: 'failed',
        failure: clone$1(failure),
      };
      pendingRanges = [];
      status = 'failed';
      return snapshot();
    },

    snapshot,
  });
}

function decorateError(error, report) {
  const decorated = error instanceof Error ? error : new Error(String(error));
  try {
    Object.defineProperty(decorated, 'cooperativeExecutionReport', {
      value: report,
      configurable: true,
      enumerable: false,
    });
  } catch {
    decorated.cooperativeExecutionReport = report;
  }
  return decorated;
}

function createWebGpuCooperativeExecution(input = {}) {
  if (!isPlainObject$1(input)) throw new TypeError('cooperative execution input must be an object');
  const runtime = input.runtime;
  const manifest = input.manifest;
  if (!runtime || typeof runtime !== 'object') throw new TypeError('runtime must be an object');
  if (manifest?.schema !== WEBGPU_COOPERATIVE_BOUNDARY_MANIFEST_SCHEMA) {
    throw new TypeError('a cooperative boundary manifest is required');
  }
  if (runtime.routeId !== manifest.routeId) throw new Error('cooperative execution runtime route mismatch');
  if (typeof runtime.runInvocation !== 'function') {
    throw new TypeError('runtime.runInvocation must be available');
  }
  if (!runtime.queue || typeof runtime.queue !== 'object') {
    throw new TypeError('runtime.queue must be available');
  }
  if (!isNonEmptyString$1(input.invocationId)) {
    throw new TypeError('invocationId must be a non-empty caller-owned identity');
  }
  const schedulingMode = input.schedulingMode || 'cooperative';
  if (!SCHEDULING_MODES.has(schedulingMode)) {
    throw new TypeError('schedulingMode must be cooperative or disabled');
  }
  const completionPolicy = input.completionPolicy || 'strict-prefix';
  if (!COMPLETION_POLICIES.has(completionPolicy)) {
    throw new TypeError('completionPolicy must be strict-prefix or bounded-prefix');
  }
  if (completionPolicy === 'bounded-prefix' && schedulingMode !== 'cooperative') {
    throw new TypeError('bounded-prefix completion requires cooperative scheduling');
  }
  if (completionPolicy === 'bounded-prefix') {
    requirePositiveSafeInteger('maxInFlightGpuDuties', input.maxInFlightGpuDuties);
    const adaptiveGpuBoundary = manifest.phases
      .flatMap(phase => phase.boundaries)
      .find(boundary => boundary.kind === 'gpu-command' && boundary.chunking.mode === 'adaptive');
    if (adaptiveGpuBoundary) {
      throw new TypeError(
        `bounded-prefix completion supports fixed GPU boundaries only; ${adaptiveGpuBoundary.boundaryId} is adaptive`,
      );
    }
  } else if (input.maxInFlightGpuDuties != null) {
    throw new TypeError('maxInFlightGpuDuties is available only with bounded-prefix completion');
  }
  const maxInFlightGpuDuties = completionPolicy === 'bounded-prefix'
    ? input.maxInFlightGpuDuties
    : 1;
  if (input.onProgress != null && typeof input.onProgress !== 'function') {
    throw new TypeError('onProgress must be a function when provided');
  }
  if (input.now != null && typeof input.now !== 'function') {
    throw new TypeError('now must be a function when provided');
  }
  const now = input.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const signal = input.signal || null;
  if (signal != null && typeof signal.aborted !== 'boolean') {
    throw new TypeError('signal must be an AbortSignal when provided');
  }

  const definitions = new Map();
  const boundaryStates = new Map();
  for (const phase of manifest.phases) {
    for (const boundary of phase.boundaries) {
      definitions.set(boundary.boundaryId, { phase, boundary });
      boundaryStates.set(boundary.boundaryId, {
        phaseId: phase.phaseId,
        boundaryId: boundary.boundaryId,
        kind: boundary.kind,
        unit: boundary.unit,
        status: 'pending',
        totalItems: boundary.totalItems,
        completedItems: 0,
        progressWeight: boundary.progressWeight,
        planner: null,
        controller: null,
        ranges: [],
        failure: null,
      });
    }
  }

  const state = {
    status: 'pending',
    startedAtMs: null,
    endedAtMs: null,
    failure: null,
    currentPhaseId: null,
    currentBoundaryId: null,
    schedulerRevision: null,
    invocationScheduler: null,
    runCalled: false,
    terminalQueueFenceObserved: false,
    submittedGpuDutyCount: 0,
    observedPrefixFenceCount: 0,
    unfencedSubmittedGpuDutyCount: 0,
    gpuDuties: [],
    inFlightGpuDuties: [],
    maxObservedInFlightGpuDuties: 0,
  };

  function checkCancellation() {
    if (signal?.aborted) throw createAbortError(signal);
  }

  function boundaryProgress(boundaryState) {
    if (boundaryState.totalItems == null) return null;
    return boundaryState.completedItems / boundaryState.totalItems;
  }

  function createProgress() {
    const phases = manifest.phases.map(phase => {
      const states = phase.boundaries.map(boundary => boundaryStates.get(boundary.boundaryId));
      const allTotalsKnown = states.every(boundary => boundary.totalItems != null);
      const totalItems = allTotalsKnown
        ? states.reduce((sum, boundary) => sum + boundary.totalItems, 0)
        : null;
      const completedItems = states.reduce((sum, boundary) => sum + boundary.completedItems, 0);
      const completedWeight = allTotalsKnown
        ? states.reduce(
            (sum, boundary) => sum + boundary.progressWeight * boundaryProgress(boundary),
            0,
          )
        : null;
      const progress = completedWeight == null ? null : completedWeight / phase.progressWeight;
      const statuses = new Set(states.map(boundary => boundary.status));
      const phaseStatus = statuses.has('failed')
        ? 'failed'
        : statuses.has('cancelled')
          ? 'cancelled'
          : states.every(boundary => boundary.status === 'complete')
            ? 'complete'
            : states.some(boundary => boundary.status === 'active')
              ? 'active'
              : 'pending';
      return {
        phaseId: phase.phaseId,
        status: phaseStatus,
        completedItems,
        totalItems,
        progress,
        percent: progress == null ? null : progress * 100,
        completedWeight,
        totalWeight: phase.progressWeight,
      };
    });
    const allTotalsKnown = [...boundaryStates.values()].every(boundary => boundary.totalItems != null);
    const completedItems = [...boundaryStates.values()]
      .reduce((sum, boundary) => sum + boundary.completedItems, 0);
    const totalItems = allTotalsKnown
      ? [...boundaryStates.values()].reduce((sum, boundary) => sum + boundary.totalItems, 0)
      : null;
    const completedWeight = allTotalsKnown
      ? [...boundaryStates.values()].reduce(
          (sum, boundary) => sum + boundary.progressWeight * boundaryProgress(boundary),
          0,
        )
      : null;
    const progress = completedWeight == null ? null : completedWeight / manifest.progressWeight;
    return deepFreeze({
      schema: WEBGPU_COOPERATIVE_PROGRESS_SCHEMA,
      routeId: manifest.routeId,
      invocationId: input.invocationId,
      status: state.status,
      completedItems,
      totalItems,
      progress,
      percent: progress == null ? null : progress * 100,
      completedWeight,
      totalWeight: manifest.progressWeight,
      currentPhaseId: state.currentPhaseId,
      currentBoundaryId: state.currentBoundaryId,
      phases,
    });
  }

  function emitProgress(boundaryState) {
    const progress = createProgress();
    if (input.onProgress) {
      try {
        input.onProgress(progress);
      } catch (error) {
        throw failExecution(error, 'progress-callback', boundaryState);
      }
    }
    return progress;
  }

  function createReport() {
    const gpuBoundaryCount = [...definitions.values()]
      .filter(definition => definition.boundary.kind === 'gpu-command').length;
    const queueCompletionAuthority = gpuBoundaryCount === 0
      ? 'not-applicable'
      : state.submittedGpuDutyCount === 0
        ? 'no-gpu-duty-submitted'
        : state.unfencedSubmittedGpuDutyCount > 0
          ? 'incomplete-prefix-fence-authority'
          : schedulingMode === 'cooperative'
        ? completionPolicy === 'bounded-prefix'
          ? 'bounded-per-gpu-duty-prefix-fence'
          : 'per-gpu-duty-prefix-fence'
        : state.terminalQueueFenceObserved
          ? 'one-terminal-prefix-fence'
          : state.observedPrefixFenceCount === state.submittedGpuDutyCount
            ? 'exceptional-per-duty-prefix-fence'
            : 'terminal-prefix-fence-pending';
    return deepFreeze({
      schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
      status: state.status,
      routeId: manifest.routeId,
      manifestId: manifest.manifestId,
      invocationId: input.invocationId,
      schedulingMode,
      completionPolicy,
      maxInFlightGpuDuties,
      maxObservedInFlightGpuDuties: state.maxObservedInFlightGpuDuties,
      issuedGpuDutyCount: state.gpuDuties.length,
      retiredGpuDutyCount: state.gpuDuties.filter(duty => duty.status === 'retired').length,
      inFlightGpuDutyCount: state.inFlightGpuDuties.length,
      inFlightGpuDutyIds: state.inFlightGpuDuties.map(entry => entry.dutyId),
      gpuDuties: clone$1(state.gpuDuties),
      schedulerRevision: state.schedulerRevision,
      invocationScheduler: clone$1(state.invocationScheduler),
      queueCompletionAuthority,
      submittedGpuDutyCount: state.submittedGpuDutyCount,
      observedPrefixFenceCount: state.observedPrefixFenceCount,
      unfencedSubmittedGpuDutyCount: state.unfencedSubmittedGpuDutyCount,
      retention: 'uncapped',
      startedAtMs: state.startedAtMs,
      endedAtMs: state.endedAtMs,
      durationMs: state.startedAtMs == null || state.endedAtMs == null
        ? null
        : state.endedAtMs - state.startedAtMs,
      progress: createProgress(),
      boundaries: manifest.phases.flatMap(phase => phase.boundaries.map(boundary => {
        const boundaryState = boundaryStates.get(boundary.boundaryId);
        const plannerSnapshot = boundaryState.planner?.snapshot() || null;
        return {
          phaseId: phase.phaseId,
          boundaryId: boundary.boundaryId,
          kind: boundary.kind,
          unit: boundary.unit,
          status: boundaryState.status,
          completedItems: boundaryState.completedItems,
          totalItems: boundaryState.totalItems,
          progress: boundaryProgress(boundaryState),
          progressWeight: boundary.progressWeight,
          rangeCount: boundaryState.ranges.length,
          actualRangeCount: boundaryState.status === 'complete'
            ? boundaryState.ranges.length
            : null,
          rangeCountAuthority: boundaryState.status === 'complete'
            ? 'actual'
            : 'open-until-completion',
          ranges: clone$1(boundaryState.ranges),
          planner: clone$1(plannerSnapshot),
          resources: clone$1(boundary.resources),
          failure: clone$1(boundaryState.failure),
        };
      })),
      runtimeTelemetry: {
        commandDuties: runtime.commandDuties?.snapshot?.() || null,
        hostPhases: runtime.hostPhases?.snapshot?.() || null,
      },
      failure: clone$1(state.failure),
      lastTrustworthyBoundary: clone$1(
        [...boundaryStates.values()].findLast(boundary => boundary.ranges.length > 0) || null,
      ),
    });
  }

  function failExecution(error, phase, boundaryState = null, diagnostics = {}) {
    const cancelled = error?.name === 'AbortError';
    const status = cancelled ? 'cancelled' : 'failed';
    const secondaryFailures = clone$1(diagnostics.secondaryFailures || []);
    if (boundaryState) {
      boundaryState.status = status;
      boundaryState.failure = {
        phase: cancelled ? 'cancellation' : phase,
        error: normalizeError$1(error),
        secondaryFailures,
      };
    }
    state.status = status;
    state.failure = {
      phase: cancelled ? 'cancellation' : phase,
      boundaryId: boundaryState?.boundaryId || null,
      error: normalizeError$1(error),
      secondaryFailures,
    };
    state.endedAtMs = readNow(now);
    return decorateError(error, createReport());
  }

  function requirePendingRange(boundaryState, range) {
    if (!range || typeof range !== 'object') throw new TypeError('range must be an object');
    const plannerSnapshot = boundaryState.planner?.snapshot();
    const pendingRangeIds = plannerSnapshot?.pendingRangeIds
      || (plannerSnapshot?.pendingRangeId ? [plannerSnapshot.pendingRangeId] : []);
    if (!pendingRangeIds.includes(range.rangeId)) {
      throw new Error(`range ${range.rangeId || '<missing>'} is not pending for ${boundaryState.boundaryId}`);
    }
  }

  function completeFixedRange(boundaryState, range, detail) {
    boundaryState.planner.completeRange(range.rangeId, detail);
    const plannerSnapshot = boundaryState.planner.snapshot();
    boundaryState.completedItems = plannerSnapshot.completedItems;
    boundaryState.ranges = plannerSnapshot.ranges;
    boundaryState.status = plannerSnapshot.status === 'complete' ? 'complete' : 'active';
  }

  function completeAdaptiveRange(boundaryState, range, observedDurationMs) {
    boundaryState.planner.observeRange({
      rangeId: range.rangeId,
      timingAuthority: 'queue-work-done',
      observedDurationMs,
    });
    const plannerSnapshot = boundaryState.planner.snapshot();
    boundaryState.completedItems = plannerSnapshot.completedItems;
    boundaryState.ranges = plannerSnapshot.ranges;
    boundaryState.status = plannerSnapshot.status === 'complete' ? 'complete' : 'active';
  }

  function failRange(boundaryState, range, phase, error) {
    const plannerSnapshot = boundaryState.planner?.snapshot();
    const pendingRangeIds = plannerSnapshot?.pendingRangeIds
      || (plannerSnapshot?.pendingRangeId ? [plannerSnapshot.pendingRangeId] : []);
    if (pendingRangeIds.includes(range?.rangeId)) {
      if (boundaryState.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
        boundaryState.planner.failRange({ rangeId: range.rangeId, phase, error });
      } else {
        boundaryState.planner.failRange(range.rangeId, phase, error);
      }
      boundaryState.ranges = boundaryState.planner.snapshot().ranges;
    }
  }

  function createPlanner(definition, boundaryState, totalItems) {
    const plannerId = `${input.invocationId}:${definition.boundary.boundaryId}:range`;
    if (definition.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
      return createWebGpuAdaptiveCommandDutyPlanner({
        plannerId,
        unit: definition.boundary.unit,
        totalItems,
        initialChunkItems: definition.boundary.chunking.initialItems,
        targetDurationMs: definition.boundary.chunking.targetDurationMs,
        adjustmentGain: definition.boundary.chunking.adjustmentGain,
        bounds: {
          minChunkItems: definition.boundary.chunking.minItems,
          maxChunkItems: definition.boundary.chunking.maxItems,
        },
        metadata: {
          manifestId: manifest.manifestId,
          routeId: manifest.routeId,
          phaseId: definition.phase.phaseId,
          boundaryId: definition.boundary.boundaryId,
        },
      });
    }
    const chunkItems = definition.boundary.chunking.mode === 'adaptive'
      ? definition.boundary.chunking.initialItems
      : definition.boundary.chunking.chunkItems;
    return createFixedRangePlanner({
      plannerId,
      unit: definition.boundary.unit,
      totalItems,
      chunkItems,
      maxPendingRanges: completionPolicy === 'bounded-prefix'
        && definition.boundary.kind === 'gpu-command'
        ? maxInFlightGpuDuties
        : 1,
      metadata: {
        manifestId: manifest.manifestId,
        routeId: manifest.routeId,
        phaseId: definition.phase.phaseId,
        boundaryId: definition.boundary.boundaryId,
      },
    });
  }

  function updateGpuDuty(entry, detail) {
    state.gpuDuties[entry.dutyIndex] = {
      ...state.gpuDuties[entry.dutyIndex],
      ...clone$1(detail),
    };
  }

  function registerBoundedGpuDuty({
    boundaryId,
    boundaryState,
    range,
    encoded,
    submittedAtMs,
    prefixFence,
  }) {
    const dutyIndex = state.gpuDuties.length;
    const entry = {
      dutyId: range.rangeId,
      dutyIndex,
      boundaryState,
      range,
      encoded,
      submittedAtMs,
      fenceOutcome: Promise.resolve(prefixFence).then(
        () => ({ ok: true, completedAtMs: readNow(now) }),
        error => ({ ok: false, error, completedAtMs: readNow(now) }),
      ),
    };
    state.gpuDuties.push({
      dutyId: entry.dutyId,
      rangeId: range.rangeId,
      rangeIndex: range.rangeIndex,
      boundaryId,
      status: 'issued',
      submittedAtMs,
      retiredAtMs: null,
      rawQueueDurationMs: null,
      timingAuthority: 'queue-work-done-prefix-fence-pending',
      failure: null,
    });
    state.inFlightGpuDuties.push(entry);
    state.maxObservedInFlightGpuDuties = Math.max(
      state.maxObservedInFlightGpuDuties,
      state.inFlightGpuDuties.length,
    );
    return entry;
  }

  async function drainGpuDutiesAfterFailure() {
    const secondaryFailures = [];
    while (state.inFlightGpuDuties.length > 0) {
      const entry = state.inFlightGpuDuties[0];
      const outcome = await entry.fenceOutcome;
      state.inFlightGpuDuties.shift();
      if (outcome.ok) {
        updateGpuDuty(entry, {
          status: 'retired-after-failure',
          retiredAtMs: outcome.completedAtMs,
          rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
          timingAuthority: 'queue-work-done',
        });
      } else {
        updateGpuDuty(entry, {
          status: 'failed',
          retiredAtMs: outcome.completedAtMs,
          rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
          timingAuthority: 'queue-work-done-prefix-fence-rejected',
          failure: normalizeError$1(outcome.error),
        });
        secondaryFailures.push({
          phase: 'queue-completion',
          dutyId: entry.dutyId,
          error: normalizeError$1(outcome.error),
        });
      }
    }
    return secondaryFailures;
  }

  async function retireOldestGpuDuty() {
    const entry = state.inFlightGpuDuties[0];
    if (!entry) return null;
    const outcome = await entry.fenceOutcome;
    state.inFlightGpuDuties.shift();
    if (!outcome.ok) {
      updateGpuDuty(entry, {
        status: 'failed',
        retiredAtMs: outcome.completedAtMs,
        rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
        timingAuthority: 'queue-work-done-prefix-fence-rejected',
        failure: normalizeError$1(outcome.error),
      });
      failRange(entry.boundaryState, entry.range, 'queue-completion', outcome.error);
      const secondaryFailures = await drainGpuDutiesAfterFailure();
      throw failExecution(
        outcome.error,
        'queue-completion',
        entry.boundaryState,
        { secondaryFailures },
      );
    }
    completeFixedRange(entry.boundaryState, entry.range, {
      timingAuthority: 'queue-work-done',
      observedDurationMs: outcome.completedAtMs - entry.submittedAtMs,
    });
    updateGpuDuty(entry, {
      status: 'retired',
      retiredAtMs: outcome.completedAtMs,
      rawQueueDurationMs: outcome.completedAtMs - entry.submittedAtMs,
      timingAuthority: 'queue-work-done',
    });
    emitProgress(entry.boundaryState);
    return entry;
  }

  async function drainGpuDuties() {
    while (state.inFlightGpuDuties.length > 0) {
      await retireOldestGpuDuty();
    }
  }

  function startBoundary(boundaryId, options = {}, schedulerInvocation) {
    checkCancellation();
    const definition = definitions.get(boundaryId);
    if (!definition) throw new Error(`unknown cooperative boundary: ${boundaryId}`);
    const boundaryState = boundaryStates.get(boundaryId);
    if (boundaryState.controller) throw new Error(`cooperative boundary ${boundaryId} was already started`);
    const declaredTotal = definition.boundary.totalItems;
    const totalItems = options.totalItems ?? declaredTotal;
    requirePositiveSafeInteger(`${boundaryId}.totalItems`, totalItems);
    if (declaredTotal != null && options.totalItems != null && options.totalItems !== declaredTotal) {
      throw new Error(`${boundaryId}.totalItems does not match the boundary manifest`);
    }
    boundaryState.totalItems = totalItems;
    boundaryState.status = 'active';
    boundaryState.boundary = definition.boundary;
    boundaryState.planner = createPlanner(definition, boundaryState, totalItems);

    async function yieldAfterDuty(range) {
      if (schedulingMode !== 'cooperative' || definition.boundary.yieldPolicy !== 'after-duty') return null;
      return schedulerInvocation.yieldToBrowser({
        reason: completionPolicy === 'bounded-prefix'
          && definition.boundary.kind === 'gpu-command'
          ? 'cooperative-boundary-duty-issued'
          : 'cooperative-boundary-duty-complete',
        metadata: {
          manifestId: manifest.manifestId,
          phaseId: definition.phase.phaseId,
          boundaryId,
          rangeId: range.rangeId,
          rangeIndex: range.rangeIndex,
        },
      });
    }

    let gpuDutyAdmissionTail = Promise.resolve();
    async function acquireGpuDutyAdmission() {
      const predecessor = gpuDutyAdmissionTail;
      let release;
      gpuDutyAdmissionTail = new Promise(resolve => {
        release = resolve;
      });
      await predecessor;
      return release;
    }

    const controller = Object.freeze({
      boundaryId,
      kind: definition.boundary.kind,
      unit: definition.boundary.unit,

      nextRange() {
        checkCancellation();
        const range = boundaryState.planner.nextRange();
        if (range) {
          boundaryState.ranges = boundaryState.planner.snapshot().ranges;
          state.currentPhaseId = definition.phase.phaseId;
          state.currentBoundaryId = boundaryId;
        }
        return range;
      },

      async runGpuDuty(range, handlers = {}) {
        const releaseAdmission = await acquireGpuDutyAdmission();
        try {
          checkCancellation();
          if (completionPolicy === 'bounded-prefix'
              && state.inFlightGpuDuties.some(entry => entry.boundaryState !== boundaryState)) {
            await drainGpuDuties();
          }
          if (definition.boundary.kind !== 'gpu-command') {
            throw new Error(`${boundaryId} is not a gpu-command boundary`);
          }
          requirePendingRange(boundaryState, range);
          if (typeof handlers.encode !== 'function') {
            const error = new TypeError('GPU duty encode must be a function');
            failRange(boundaryState, range, 'command-encoding', error);
            throw failExecution(error, 'command-encoding', boundaryState);
          }
          if (handlers.submit != null) {
            const error = new TypeError(
              'GPU duty submit callbacks are unsupported; encode must return command buffers',
            );
            failRange(boundaryState, range, 'command-encoding', error);
            throw failExecution(error, 'command-encoding', boundaryState);
          }

        let descriptor = {
          phase: definition.phase.phaseId,
          kind: definition.boundary.commandDutyKind,
          metadata: {
            ...clone$1(definition.boundary.metadata),
            manifestId: manifest.manifestId,
            boundaryId,
            rangeId: range.rangeId,
            rangeIndex: range.rangeIndex,
            itemStart: range.itemStart,
            itemEnd: range.itemEnd,
            itemCount: range.itemCount,
            totalItems: range.totalItems,
            unit: range.unit,
          },
        };
        let prepared = false;
        let encoded;
        try {
          if (schedulingMode === 'cooperative') {
            if (typeof runtime.prepareCommandDutyAtBoundary !== 'function') {
              throw new Error('cooperative GPU duties require runtime.prepareCommandDutyAtBoundary');
            }
            descriptor = await runtime.prepareCommandDutyAtBoundary(descriptor, schedulerInvocation);
            prepared = true;
            checkCancellation();
          }
          encoded = await handlers.encode({
            range,
            commandDuty: deepFreeze(clone$1(descriptor)),
            schedulerInvocation,
          });
        } catch (error) {
          const secondaryFailures = [];
          if (prepared && typeof runtime.settleCommandDuty === 'function') {
            try {
              runtime.settleCommandDuty(descriptor, {
                status: 'failed-before-encode',
                phase: 'command-encoding',
                error,
              });
            } catch (settlementError) {
              secondaryFailures.push({
                phase: 'scheduler-settlement',
                error: normalizeError$1(settlementError),
              });
            }
          }
          failRange(boundaryState, range, 'command-encoding', error);
          throw failExecution(error, 'command-encoding', boundaryState, { secondaryFailures });
        }

        if (prepared && typeof runtime.settleCommandDuty === 'function') {
          try {
            runtime.settleCommandDuty(descriptor, { status: 'encoded' });
          } catch (error) {
            failRange(boundaryState, range, 'scheduler-settlement', error);
            throw failExecution(error, 'scheduler-settlement', boundaryState);
          }
        }

        const commandBuffers = Array.isArray(encoded) ? [...encoded] : [encoded];
        if (commandBuffers.length === 0 || commandBuffers.some(buffer => buffer == null)) {
          const error = new TypeError('GPU duty encode must return command buffers');
          failRange(boundaryState, range, 'command-encoding', error);
          throw failExecution(error, 'command-encoding', boundaryState);
        }

        const submitStartMs = readNow(now);
        let prefixFence = null;
        let submitted = false;
        let queueSubmittedAtMs = null;
        let boundedEntry = null;
        const capturePrefixFence = () => {
          if (typeof runtime.queue.onSubmittedWorkDone !== 'function') {
            throw new Error('GPU duties require queue.onSubmittedWorkDone');
          }
          const fence = runtime.queue.onSubmittedWorkDone();
          if (fence == null || typeof fence.then !== 'function') {
            throw new TypeError('queue onSubmittedWorkDone must return a Promise');
          }
          state.observedPrefixFenceCount += 1;
          return fence;
        };
        try {
          const submit = () => {
            if (submitted) {
              throw new Error('command duty recorder attempted duplicate GPU submission');
            }
            queueSubmittedAtMs = submitStartMs;
            runtime.queue.submit(commandBuffers);
            submitted = true;
            state.submittedGpuDutyCount += 1;
            queueSubmittedAtMs = readNow(now);
            if (schedulingMode === 'cooperative') {
              prefixFence = capturePrefixFence();
            }
            if (completionPolicy === 'bounded-prefix') {
              boundedEntry = registerBoundedGpuDuty({
                boundaryId,
                boundaryState,
                range,
                encoded,
                submittedAtMs: queueSubmittedAtMs,
                prefixFence,
              });
            }
          };
          if (runtime.commandDuties?.measureSubmission) {
            await runtime.commandDuties.measureSubmission(descriptor, submit);
          } else {
            submit();
          }
          if (!submitted) throw new Error('command duty recorder did not submit GPU work');
          if (schedulingMode === 'cooperative' && completionPolicy === 'strict-prefix') {
            await prefixFence;
          }
        } catch (error) {
          const secondaryFailures = [];
          if (submitted && completionPolicy === 'bounded-prefix') {
            if (!boundedEntry) {
              try {
                if (!prefixFence) prefixFence = capturePrefixFence();
                boundedEntry = registerBoundedGpuDuty({
                  boundaryId,
                  boundaryState,
                  range,
                  encoded,
                  submittedAtMs: queueSubmittedAtMs,
                  prefixFence,
                });
              } catch (fenceError) {
                state.unfencedSubmittedGpuDutyCount += 1;
                secondaryFailures.push({
                  phase: 'queue-prefix-drain',
                  error: normalizeError$1(fenceError),
                });
              }
            }
            failRange(boundaryState, range, 'queue-submission', error);
            if (boundedEntry) {
              secondaryFailures.push(...await drainGpuDutiesAfterFailure());
            }
            throw failExecution(error, 'queue-submission', boundaryState, { secondaryFailures });
          }
          if (submitted) {
            try {
              if (!prefixFence) prefixFence = capturePrefixFence();
              await prefixFence;
            } catch (fenceError) {
              state.unfencedSubmittedGpuDutyCount += 1;
              secondaryFailures.push({
                phase: 'queue-prefix-drain',
                error: normalizeError$1(fenceError),
              });
            }
          }
          failRange(boundaryState, range, 'queue-submission', error);
          throw failExecution(error, 'queue-submission', boundaryState, { secondaryFailures });
        }

        if (completionPolicy === 'bounded-prefix') {
          try {
            await yieldAfterDuty(range);
          } catch (error) {
            failRange(boundaryState, range, 'browser-yield', error);
            const secondaryFailures = await drainGpuDutiesAfterFailure();
            throw failExecution(error, 'browser-yield', boundaryState, { secondaryFailures });
          }
          const retired = state.inFlightGpuDuties.length >= maxInFlightGpuDuties
            ? await retireOldestGpuDuty()
            : null;
          return {
            range,
            encoded,
            queueCompletionAuthority: 'bounded-prefix-fence',
            settledRangeId: retired?.range.rangeId || null,
          };
        }

        const completedAtMs = readNow(now);

        if (definition.boundary.chunking.mode === 'adaptive' && schedulingMode === 'cooperative') {
          completeAdaptiveRange(boundaryState, range, completedAtMs - submitStartMs);
        } else {
          completeFixedRange(boundaryState, range, {
            timingAuthority: schedulingMode === 'cooperative'
              ? 'queue-work-done'
              : 'host-submit-call-only',
            observedDurationMs: completedAtMs - submitStartMs,
          });
        }
        try {
          await yieldAfterDuty(range);
        } catch (error) {
          throw failExecution(error, 'browser-yield', boundaryState);
        }
        emitProgress(boundaryState);
          return {
            range,
            encoded,
            queueCompletionAuthority: prefixFence
              ? 'immediate-prefix-fence'
              : 'terminal-prefix-fence-pending',
          };
        } finally {
          releaseAdmission();
        }
      },

      async runCpuDuty(range, handlers = {}) {
        checkCancellation();
        if (definition.boundary.kind !== 'cpu-work') {
          throw new Error(`${boundaryId} is not a cpu-work boundary`);
        }
        if (typeof handlers.work !== 'function') throw new TypeError('CPU duty work must be a function');
        requirePendingRange(boundaryState, range);
        if (completionPolicy === 'bounded-prefix') {
          await drainGpuDuties();
          checkCancellation();
        }
        const startedAtMs = readNow(now);
        try {
          const work = () => handlers.work({ range, schedulerInvocation });
          if (runtime.hostPhases && typeof runtime.runHostPhase === 'function') {
            await runtime.runHostPhase(definition.boundary.hostPhase, work, {
              detail: {
                manifestId: manifest.manifestId,
                boundaryId,
                rangeId: range.rangeId,
                rangeIndex: range.rangeIndex,
                itemStart: range.itemStart,
                itemEnd: range.itemEnd,
                totalItems: range.totalItems,
                unit: range.unit,
              },
            });
          } else {
            await work();
          }
        } catch (error) {
          failRange(boundaryState, range, 'cpu-work', error);
          throw failExecution(error, 'cpu-work', boundaryState);
        }
        completeFixedRange(boundaryState, range, {
          timingAuthority: 'host-work-call',
          observedDurationMs: readNow(now) - startedAtMs,
        });
        try {
          await yieldAfterDuty(range);
        } catch (error) {
          throw failExecution(error, 'browser-yield', boundaryState);
        }
        emitProgress(boundaryState);
        return { range };
      },

      snapshot() {
        return deepFreeze(clone$1({
          phaseId: definition.phase.phaseId,
          boundaryId,
          status: boundaryState.status,
          totalItems: boundaryState.totalItems,
          completedItems: boundaryState.completedItems,
          progress: boundaryProgress(boundaryState),
          ranges: boundaryState.ranges,
        }));
      },
    });
    boundaryState.controller = controller;
    return controller;
  }

  async function run(fn) {
    if (typeof fn !== 'function') throw new TypeError('cooperative execution run requires a function');
    if (state.runCalled) throw new Error('cooperative execution can run only once');
    state.runCalled = true;
    state.status = 'running';
    state.startedAtMs = readNow(now);
    try {
      checkCancellation();
      const output = await runtime.runInvocation({ invocationId: input.invocationId }, async invocation => {
        state.schedulerRevision = invocation.schedulerRevision ?? null;
        state.invocationScheduler = clone$1(invocation.scheduler || null);
        return fn(Object.freeze({
          invocationId: input.invocationId,
          schedulingMode,
          schedulerInvocation: invocation,
          startBoundary(boundaryId, options = {}) {
            return startBoundary(boundaryId, options, invocation);
          },
          progress: createProgress,
          throwIfCancelled: checkCancellation,
        }));
      });
      if (completionPolicy === 'bounded-prefix') {
        await drainGpuDuties();
      }
      checkCancellation();
      const incomplete = [...boundaryStates.values()]
        .filter(boundary => boundary.status !== 'complete')
        .map(boundary => boundary.boundaryId);
      if (incomplete.length > 0) {
        throw new Error(`incomplete cooperative boundaries: ${incomplete.join(', ')}`);
      }
      if (schedulingMode === 'disabled'
        && [...definitions.values()].some(definition => definition.boundary.kind === 'gpu-command')) {
        if (typeof runtime.queue.onSubmittedWorkDone !== 'function') {
          throw new Error('disabled scheduling A/B requires a terminal queue.onSubmittedWorkDone fence');
        }
        const terminalFence = runtime.queue.onSubmittedWorkDone();
        if (terminalFence == null || typeof terminalFence.then !== 'function') {
          throw new TypeError('queue onSubmittedWorkDone must return a Promise');
        }
        await terminalFence;
        state.terminalQueueFenceObserved = true;
      }
      state.status = 'succeeded';
      state.currentPhaseId = null;
      state.currentBoundaryId = null;
      state.endedAtMs = readNow(now);
      return output;
    } catch (error) {
      if (completionPolicy === 'bounded-prefix' && state.inFlightGpuDuties.length > 0) {
        const priorReport = error?.cooperativeExecutionReport || null;
        const phase = priorReport?.failure?.phase
          || (error?.name === 'AbortError' ? 'cancellation' : 'completion');
        const boundaryState = boundaryStates.get(priorReport?.failure?.boundaryId)
          || state.inFlightGpuDuties[0]?.boundaryState
          || null;
        const oldestPending = state.inFlightGpuDuties[0];
        if (boundaryState && oldestPending) {
          failRange(boundaryState, oldestPending.range, phase, error);
        }
        const secondaryFailures = [
          ...(priorReport?.failure?.secondaryFailures || []),
          ...await drainGpuDutiesAfterFailure(),
        ];
        throw failExecution(error, phase, boundaryState, { secondaryFailures });
      }
      if (error?.cooperativeExecutionReport) throw error;
      throw failExecution(
        error,
        error?.name === 'AbortError' ? 'cancellation' : 'completion',
      );
    }
  }

  return Object.freeze({
    schema: WEBGPU_COOPERATIVE_EXECUTION_REPORT_SCHEMA,
    routeId: manifest.routeId,
    manifestId: manifest.manifestId,
    invocationId: input.invocationId,
    schedulingMode,
    completionPolicy,
    maxInFlightGpuDuties,
    run,
    progress: createProgress,
    snapshot: createReport,
    finish() {
      if (state.status !== 'succeeded' && state.status !== 'failed' && state.status !== 'cancelled') {
        throw new Error('cooperative execution cannot finish before run settles');
      }
      return createReport();
    },
  });
}

const SF3D_IMAGE_TO_MESH_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
const SF3D_MODEL_ID = 'stabilityai/stable-fast-3d';
const OUTPUT_ROLES = [
  { key: 'meshGlb', role: 'mesh-glb', required: true },
  { key: 'albedoTexture', role: 'albedo-texture', required: true },
  { key: 'normalMap', role: 'normal-map', required: true },
  { key: 'meshObj', role: 'mesh-obj', required: false },
];

function createSf3dImageToMeshRouteReceipt(input) {
  if (!input || typeof input !== 'object') throw new Error('input must be an object');
  if (!input.input?.artifactId || !input.input?.sha256) {
    throw new Error('input image artifactId and sha256 are required');
  }
  if (!input.outputs?.meshGlb) throw new Error('meshGlb output is required');
  if (!input.outputs?.albedoTexture) throw new Error('albedoTexture output is required');
  if (!input.outputs?.normalMap) throw new Error('normalMap output is required');

  return createWebGpuRouteReceiptFromArtifacts({
    requestedRouteId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    effectiveRouteId: input.effectiveRouteId || SF3D_IMAGE_TO_MESH_ROUTE_ID,
    status: input.status || (input.fallbackReason ? 'fallback' : 'real'),
    fallbackReason: input.fallbackReason || null,
    backend: input.backend,
    model: {
      id: SF3D_MODEL_ID,
      revision: input.model?.revision,
      weightsHash: input.model?.weightsHash,
      dtype: input.model?.dtype || 'fp16',
    },
    kernel: createKernelProfileMetadata(input.kernel, { requireProfile: true }),
    inputs: [
      createRouteReceiptInputArtifact('source-image', input.input),
    ],
    outputs: createRouteReceiptArtifacts({ artifacts: input.outputs, roles: OUTPUT_ROLES }),
    profile: input.profile,
  });
}

/**
 * Cooperative DINO encoder boundary — first uptake of the Kaminos WebGPU
 * Inference Kit cooperative porting spine (@kaminos/webgpu-inference-kit@^0.1.36)
 * in the sf3d.image-to-mesh.webgpu-local.v0 route.
 *
 * Scope (session 7, cranial-depth-enema directive
 * `adopt-cooperative-porting-spine-0136-in-sf3d`): wire ONLY the DINOv2 ViT
 * encoder — a strictly sequential 24-block loop in sf3d_backbone.js — through
 * the kit's cooperative execution facade as one gpu-command boundary
 * (unit: vit-block, totalItems: 24). This is a scheduling-granularity change,
 * NOT a numerical change: the exact per-block dispatch sequence and tokenBufA/
 * tokenBufB ping-pong are preserved; the only difference from the legacy path
 * is that each block (or fixed chunk of blocks) is submitted as its own command
 * buffer with a browser yield between duties, instead of all 24 blocks landing
 * in one command buffer with one submit.
 *
 * The runtime here is adapter-owned and thin: it wraps the real GPUDevice.queue
 * and exposes exactly the surface createWebGpuCooperativeExecution() consumes
 * (routeId, queue.submit/onSubmittedWorkDone, runInvocation, commandDuties
 * .measureSubmission, hostPhases, yieldToBrowser). No kit inference-runtime,
 * session, or resource-residency machinery is pulled in for this first slice —
 * those are separate pending directives, deliberately kept out to avoid
 * ambiguous parity/perf regression attribution.
 */


const SF3D_ROUTE_ID = 'sf3d.image-to-mesh.webgpu-local.v0';
const DINO_COOPERATIVE_MANIFEST_ID = 'sf3d.dino-encoder-cooperative-boundaries.v0';
const DINO_BOUNDARY_ID = 'dino-vit-blocks';

/**
 * Declare the DINO encoder cooperative boundary manifest.
 *
 * One phase, one gpu-command boundary over the 24 ViT blocks. Fixed chunking
 * by default (chunkBlocks blocks per submitted duty). progressWeight equals the
 * block count so denominator-bearing progress reads as fraction-of-blocks; no
 * hidden cap — totalItems is exactly the declared block count.
 *
 * @param {number} numBlocks   total ViT blocks (24 for SF3D DINOv2-large)
 * @param {number} chunkBlocks blocks per submitted GPU duty (>=1)
 */
function defineDinoEncoderManifest(numBlocks, chunkBlocks = 1) {
  if (!Number.isSafeInteger(numBlocks) || numBlocks <= 0) {
    throw new TypeError('numBlocks must be a positive safe integer');
  }
  if (!Number.isSafeInteger(chunkBlocks) || chunkBlocks <= 0) {
    throw new TypeError('chunkBlocks must be a positive safe integer');
  }
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: DINO_COOPERATIVE_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'dinov2-tokenizer',
        boundaries: [
          {
            boundaryId: DINO_BOUNDARY_ID,
            kind: 'gpu-command',
            unit: 'vit-block',
            totalItems: numBlocks,
            progressWeight: numBlocks,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: chunkBlocks },
            yieldPolicy: 'after-duty',
            resources: {
              retain: ['dinov2.weights'],
              produce: ['dinov2.tokens'],
              release: [],
            },
          },
        ],
      },
    ],
    metadata: { source: 'sf3d-webgpu-cooperative-dino-uptake' },
  });
}

/**
 * Adapter-owned thin runtime over the real GPUDevice.queue.
 *
 * `yieldToBrowser` is a real macrotask yield (MessageChannel) so the browser
 * event loop can service a frame between submitted block duties — this is the
 * cooperative behavior the operator smoke measures. In scheduling-disabled A/B
 * the facade never calls yieldToBrowser, so both arms declare identical work
 * but only the cooperative arm actually cedes the main thread per duty.
 */
function createSf3dCooperativeRuntime(device, hooks = {}) {
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  // Optional kit foreground-opportunity interlock (the shape returned by
  // createWebGpuForegroundOpportunityInterlock). When present, pending host
  // demand — e.g. the kiln's flame frame — is serviced at every cooperative
  // pre-encode boundary exactly as the kit's own runtime does, so the host's
  // command buffers reach the shared queue ahead of the next inference duty.
  const foregroundOpportunities = hooks.foregroundOpportunities ?? null;
  if (foregroundOpportunities != null) {
    for (const method of ['serviceAtBoundary', 'snapshot']) {
      if (typeof foregroundOpportunities[method] !== 'function') {
        throw new Error(`foregroundOpportunities must expose ${method}()`);
      }
    }
  }
  let foregroundBoundarySequence = 0;
  const hasForegroundPressure = (snapshot) => snapshot.pendingRequestCount > 0
    || snapshot.activeRequestCount > 0
    || snapshot.activeServiceCount > 0
    || snapshot.queuedServiceCount > 0;
  const queue = {
    submit(commandBuffers) {
      device.queue.submit(commandBuffers);
    },
    async onSubmittedWorkDone() {
      const startedAtMs = now();
      const result = await device.queue.onSubmittedWorkDone();
      const completedAtMs = now();
      if (typeof hooks.onQueueFenceResolved === 'function') {
        await hooks.onQueueFenceResolved({
          startedAtMs,
          completedAtMs,
          queueWaitMs: completedAtMs - startedAtMs,
        });
      }
      return result;
    },
  };

  return {
    routeId: SF3D_ROUTE_ID,
    runtimeLabel: 'sf3d-webgpu-cooperative-dino',
    queue,
    hostPhases: {
      snapshot() {
        return { status: 'not-instrumented', phase: 'dinov2-tokenizer' };
      },
    },
    commandDuties: {
      // Observe/route the submission only — do NOT impose our own queue fence
      // here. The facade owns fence policy: in cooperative mode it fences the
      // queue prefix per duty (per-gpu-duty-prefix-fence); in disabled mode it
      // takes exactly one terminal fence. Fencing here would double-fence the
      // cooperative arm and, worse, force per-duty fences onto the disabled arm,
      // destroying the scheduling A/B over identical declared work.
      async measureSubmission(descriptor, submit) {
        return submit();
      },
    },
    foregroundOpportunities,
    // The facade awaits this hook before each cooperative GPU encode. Without
    // an interlock it is an honest pass-through (cooperation is the post-duty
    // browser yield + per-duty queue fence). With an interlock, pending host
    // demand is serviced here, before the next inference duty is encoded,
    // mirroring the kit runtime: no demand → no synthetic service turn; a
    // failed service refuses the encode; demand without an invocation
    // identity refuses.
    async prepareCommandDutyAtBoundary(descriptor, schedulerInvocation = null) {
      if (!foregroundOpportunities) return descriptor;
      const pressure = typeof foregroundOpportunities.pressureSnapshot === 'function'
        ? foregroundOpportunities.pressureSnapshot()
        : foregroundOpportunities.snapshot();
      if (!hasForegroundPressure(pressure)) return descriptor;
      const invocationId = schedulerInvocation?.invocationId;
      if (typeof invocationId !== 'string' || !invocationId.trim()) {
        throw new Error('foreground opportunity service requires an active invocation identity');
      }
      foregroundBoundarySequence += 1;
      const service = await foregroundOpportunities.serviceAtBoundary({
        invocationId,
        boundaryId: `${invocationId}:foreground-boundary:${foregroundBoundarySequence}`,
        dutyId: descriptor?.dutyId || `${invocationId}:command-duty:${foregroundBoundarySequence}`,
        phase: descriptor?.phase || 'sf3d-cooperative-duty',
        position: 'before-encode',
        metadata: {
          runtimeLabel: 'sf3d-webgpu-cooperative',
          schedulerRevision: schedulerInvocation.schedulerRevision ?? null,
        },
      });
      const prepared = {
        ...descriptor,
        metadata: { ...(descriptor?.metadata || {}), foregroundOpportunityService: service },
      };
      if (service.status === 'failed') {
        const first = service.failures?.[0];
        throw new Error(first?.failure?.error?.message || 'foreground opportunity failed');
      }
      return prepared;
    },
    settleCommandDuty() {
      // No scheduler-owned duty ledger in this slice; settlement is a no-op.
    },
    async runInvocation({ invocationId }, fn) {
      return fn({
        invocationId,
        schedulerRevision: null,
        scheduler: {
          mode: 'cooperative',
          yieldMs: 0,
          waitForSubmittedWorkDone: true,
          phaseChunkSize: {},
        },
        async yieldToBrowser() {
          const start = now();
          await macrotaskYield();
          const end = now();
          const result = { reason: 'cooperative-boundary-duty-complete', elapsedMs: end - start };
          if (typeof hooks.onBrowserYield === 'function') {
            await hooks.onBrowserYield({
              startedAtMs: start,
              completedAtMs: end,
              elapsedMs: end - start,
            });
          }
          return result;
        },
      });
    },
  };
}

/**
 * Yield to the browser macrotask queue so a foreground frame can run.
 * MessageChannel gives a true macrotask (unlike microtask await), which is
 * what lets the compositor paint between block duties.
 */
function macrotaskYield() {
  if (typeof MessageChannel === 'function') {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Run the DINO encoder cooperatively.
 *
 * @param {object}   opts
 * @param {GPUDevice} opts.device
 * @param {object}   opts.tokenizer            SF3DImageTokenizer instance
 * @param {GPUBuffer} opts.imageBuf
 * @param {GPUBuffer} opts.cameraEmbedBuf
 * @param {object}   opts.weights              weights.imageTokenizer
 * @param {number}   opts.numBlocks            24 for SF3D
 * @param {number}  [opts.chunkBlocks=1]       blocks per submitted duty
 * @param {'cooperative'|'disabled'} [opts.schedulingMode='cooperative']
 * @param {(progress:object)=>void} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @param {string}   [opts.invocationId]
 * @returns {Promise<{ result: object, report: object }>}
 *          result is the tokenizer.encode() output ({ tokensBuf, N, tokenH, tokenW });
 *          report is the kit cooperative execution report.
 */
async function runCooperativeDino(opts) {
  const {
    device,
    tokenizer,
    imageBuf,
    cameraEmbedBuf,
    weights,
    numBlocks,
    chunkBlocks = 1,
    schedulingMode = 'cooperative',
    onProgress,
    signal,
    invocationId = `sf3d:dino:${schedulingMode}`,
  } = opts;

  const manifest = defineDinoEncoderManifest(numBlocks, chunkBlocks);
  const runtime = createSf3dCooperativeRuntime(device, {
    foregroundOpportunities: opts.foregroundOpportunities ?? null,
  });
  const execution = createWebGpuCooperativeExecution({
    runtime,
    manifest,
    invocationId,
    schedulingMode,
    onProgress,
    signal,
  });

  let result = null;

  // Production run: create a real execution and drive the SHARED boundary
  // driver against the facade the execution hands to run(). The driver's
  // encode/submit produce real WebGPU command buffers on the real device queue.
  await execution.run(async cooperative => {
    result = await driveDinoCooperativeBoundary(cooperative, {
      encodeChunk: ({ blockStart, blockEnd, encodeInto }) => {
        const encoder = device.createCommandEncoder({
          label: `dino-blocks-${blockStart}-${blockEnd}`,
        });
        encodeInto(encoder);
        return encoder.finish();
      },
      // kit >=0.1.41: encode() returns the command buffer and the kit owns
      // queue.submit; no producer-side submit callback.
      encodeTokenizer: (driver) => tokenizer.encodeCooperative({
        imageBuf, cameraEmbedBuf, weights, numBlocks, chunkBlocks, driver,
      }),
    });
  });

  return { result, report: execution.finish() };
}

/**
 * SHARED cooperative-DINO boundary driver.
 *
 * Consumes the supplied cooperative facade DIRECTLY (the object passed to
 * `execution.run`'s callback — with `startBoundary`). It does NOT create a
 * nested cooperative execution: production and conformance both hand this driver
 * a facade whose runtime they own, so all declared work, cancellation, failure
 * injection, progress, and settlement stay inside that one facade's authority.
 *
 * The driver decides WHERE the command buffer is cut (per fixed chunk of blocks)
 * and delegates HOW a chunk is encoded/submitted to the caller via injected
 * `encodeChunk`/`submitChunk`. This is the only seam that differs between:
 *   - production: real GPUCommandEncoder + real device.queue.submit;
 *   - conformance: deterministic instrumented encode/submit tokens (no GPU).
 *
 * Block order, chunk boundaries, and the tokenizer's ping-pong are identical on
 * both paths, so the canonical orchestration trace (and its fingerprint) match.
 *
 * @param {object} cooperative                 facade from execution.run callback
 * @param {object} o
 * @param {number} o.numBlocks
 * @param {number} o.chunkBlocks
 * @param {(ctx:{blockStart:number,blockEnd:number,encodeInto:(enc:any)=>void})=>any} o.encodeChunk
 *        returns the "command buffer" (real GPUCommandBuffer or a deterministic token)
 * @param {(driver:Function)=>Promise<any>} o.encodeTokenizer
 *        invokes tokenizer.encodeCooperative with the per-chunk driver we build
 * @returns {Promise<any>} the tokenizer.encode() output ({ tokensBuf, N, tokenH, tokenW })
 */
async function driveDinoCooperativeBoundary(cooperative, o) {
  const { encodeChunk, encodeTokenizer } = o;
  const gpu = cooperative.startBoundary(DINO_BOUNDARY_ID);

  // The tokenizer calls this once per fixed chunk of blocks, in order. We map
  // each chunk to exactly one cooperative range + gpu duty.
  const perChunkDriver = async (blockStart, blockEnd, encodeInto) => {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(`cooperative DINO boundary exhausted ranges before block ${blockStart}`);
    }
    await gpu.runGpuDuty(range, {
      encode() {
        return encodeChunk({ blockStart, blockEnd, encodeInto });
      },
    });
  };

  const result = await encodeTokenizer(perChunkDriver);

  // Boundary must be fully consumed for the facade to accept completion.
  if (gpu.nextRange() != null) {
    throw new Error('cooperative DINO boundary left ranges unconsumed');
  }
  return result;
}

const linearRangeWGSL = "// Row-range linear projection: output[row] = input[row] @ weight + bias.\n// The accumulation order and weight layout match linear.wgsl exactly.\n\nstruct Params {\n  totalRows: u32,\n  inDim: u32,\n  outDim: u32,\n  rowStart: u32,\n  rowCount: u32,\n  numWorkgroupsX: u32,\n  transposed: u32,\n  _padding: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let localIdx = linearWG * WG_SIZE + lid.x;\n  if (localIdx >= params.rowCount * params.outDim) { return; }\n\n  let localRow = localIdx / params.outDim;\n  let col = localIdx % params.outDim;\n  let row = params.rowStart + localRow;\n  if (row >= params.totalRows) { return; }\n  let idx = row * params.outDim + col;\n\n  var s0 = 0.0;\n  var s1 = 0.0;\n  var s2 = 0.0;\n  var s3 = 0.0;\n  let inBase = row * params.inDim;\n  let len4 = (params.inDim / 4u) * 4u;\n\n  if (params.transposed == 1u) {\n    let wBase = col;\n    let stride = params.outDim;\n    for (var k = 0u; k < len4; k += 4u) {\n      s0 += input[inBase + k]      * weight[(k)      * stride + wBase];\n      s1 += input[inBase + k + 1u] * weight[(k + 1u) * stride + wBase];\n      s2 += input[inBase + k + 2u] * weight[(k + 2u) * stride + wBase];\n      s3 += input[inBase + k + 3u] * weight[(k + 3u) * stride + wBase];\n    }\n    for (var k = len4; k < params.inDim; k++) {\n      s0 += input[inBase + k] * weight[k * stride + wBase];\n    }\n  } else {\n    let wBase = col * params.inDim;\n    for (var k = 0u; k < len4; k += 4u) {\n      s0 += input[inBase + k]      * weight[wBase + k];\n      s1 += input[inBase + k + 1u] * weight[wBase + k + 1u];\n      s2 += input[inBase + k + 2u] * weight[wBase + k + 2u];\n      s3 += input[inBase + k + 3u] * weight[wBase + k + 3u];\n    }\n    for (var k = len4; k < params.inDim; k++) {\n      s0 += input[inBase + k] * weight[wBase + k];\n    }\n  }\n  output[idx] = (s0 + s1) + (s2 + s3) + bias[col];\n}\n";

const crossAttentionWGSL = "/**\n * Cross-attention compute shader.\n *\n * Computes attention where Q comes from one sequence and K,V from another.\n * Used in SF3D's FuseBlock (fuse triplane ↔ image tokens) and\n * BasicBlock's attn2 (cross-attend latents to encoder hidden states).\n *\n * Three entry points matching the self-attention pattern:\n *   - computeCrossScores: Q·K^T with scaling\n *   - softmaxCross: row-wise softmax (same as self-attention)\n *   - applyCrossAttn: scores @ V\n */\n\nstruct Params {\n  N_q: u32,     // query sequence length\n  N_kv: u32,    // key/value sequence length\n  D: u32,       // head dimension\n  numHeads: u32,\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> Q: array<f32>;       // [N_q, numHeads, D]\n@group(0) @binding(2) var<storage, read> K: array<f32>;       // [N_kv, numHeads, D]\n@group(0) @binding(3) var<storage, read> V: array<f32>;       // [N_kv, numHeads, D]\n@group(0) @binding(4) var<storage, read_write> scores: array<f32>; // [numHeads, N_q, N_kv]\n@group(0) @binding(5) var<storage, read_write> output: array<f32>; // [N_q, numHeads, D]\n\nconst WG_SIZE: u32 = 256;\n\n/**\n * Compute cross-attention scores: score[h, qi, ki] = Q[qi, h, :] · K[ki, h, :] / sqrt(D)\n */\n@compute @workgroup_size(WG_SIZE)\nfn computeCrossScores(@builtin(global_invocation_id) gid: vec3<u32>,\n                      @builtin(workgroup_id) wgid: vec3<u32>,\n                      @builtin(local_invocation_id) lid: vec3<u32>) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  let totalScores = params.numHeads * params.N_q * params.N_kv;\n  if (idx >= totalScores) { return; }\n\n  let h = idx / (params.N_q * params.N_kv);\n  let rem = idx % (params.N_q * params.N_kv);\n  let qi = rem / params.N_kv;\n  let ki = rem % params.N_kv;\n\n  let D = params.D;\n  let scale = 1.0 / sqrt(f32(D));\n\n  // Q layout: [N_q, numHeads, D] → Q[qi * numHeads * D + h * D + d]\n  // K layout: [N_kv, numHeads, D] → K[ki * numHeads * D + h * D + d]\n  let qBase = qi * params.numHeads * D + h * D;\n  let kBase = ki * params.numHeads * D + h * D;\n\n  // 4-way split accumulation\n  var s0: f32 = 0.0; var s1: f32 = 0.0;\n  var s2: f32 = 0.0; var s3: f32 = 0.0;\n  let steps = D / 4u;\n  for (var i: u32 = 0u; i < steps; i++) {\n    let d = i * 4u;\n    s0 += Q[qBase + d]     * K[kBase + d];\n    s1 += Q[qBase + d + 1] * K[kBase + d + 1];\n    s2 += Q[qBase + d + 2] * K[kBase + d + 2];\n    s3 += Q[qBase + d + 3] * K[kBase + d + 3];\n  }\n  // Handle remainder\n  let rem_start = steps * 4u;\n  var s_rem: f32 = 0.0;\n  for (var d = rem_start; d < D; d++) {\n    s_rem += Q[qBase + d] * K[kBase + d];\n  }\n\n  let dot = ((s0 + s1) + (s2 + s3)) + s_rem;\n\n  // scores layout: [numHeads, N_q, N_kv]\n  scores[h * params.N_q * params.N_kv + qi * params.N_kv + ki] = dot * scale;\n}\n\n/**\n * Row-wise softmax over KV dimension.\n * One thread per (head, query) row.\n */\n@compute @workgroup_size(WG_SIZE)\nfn softmaxCross(@builtin(global_invocation_id) gid: vec3<u32>,\n                @builtin(workgroup_id) wgid: vec3<u32>,\n                @builtin(local_invocation_id) lid: vec3<u32>) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  let totalRows = params.numHeads * params.N_q;\n  if (idx >= totalRows) { return; }\n\n  let base = idx * params.N_kv;\n\n  // Find max\n  var maxVal: f32 = scores[base];\n  for (var i: u32 = 1u; i < params.N_kv; i++) {\n    maxVal = max(maxVal, scores[base + i]);\n  }\n\n  // Exp and sum\n  var sumExp: f32 = 0.0;\n  for (var i: u32 = 0u; i < params.N_kv; i++) {\n    let e = exp(scores[base + i] - maxVal);\n    scores[base + i] = e;\n    sumExp += e;\n  }\n\n  // Normalize\n  let invSum = 1.0 / sumExp;\n  for (var i: u32 = 0u; i < params.N_kv; i++) {\n    scores[base + i] *= invSum;\n  }\n}\n\n/**\n * Apply cross-attention: output[qi, h, d] = sum_ki scores[h, qi, ki] * V[ki, h, d]\n */\n@compute @workgroup_size(WG_SIZE)\nfn applyCrossAttn(@builtin(global_invocation_id) gid: vec3<u32>,\n                  @builtin(workgroup_id) wgid: vec3<u32>,\n                  @builtin(local_invocation_id) lid: vec3<u32>) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  let totalOut = params.N_q * params.numHeads * params.D;\n  if (idx >= totalOut) { return; }\n\n  let qi = idx / (params.numHeads * params.D);\n  let rem = idx % (params.numHeads * params.D);\n  let h = rem / params.D;\n  let d = rem % params.D;\n\n  let scoreBase = h * params.N_q * params.N_kv + qi * params.N_kv;\n\n  // 4-way accumulation over KV positions\n  var s0: f32 = 0.0; var s1: f32 = 0.0;\n  var s2: f32 = 0.0; var s3: f32 = 0.0;\n  let steps = params.N_kv / 4u;\n  for (var i: u32 = 0u; i < steps; i++) {\n    let ki = i * 4u;\n    // V layout: [N_kv, numHeads, D]\n    s0 += scores[scoreBase + ki]     * V[(ki)     * params.numHeads * params.D + h * params.D + d];\n    s1 += scores[scoreBase + ki + 1] * V[(ki + 1) * params.numHeads * params.D + h * params.D + d];\n    s2 += scores[scoreBase + ki + 2] * V[(ki + 2) * params.numHeads * params.D + h * params.D + d];\n    s3 += scores[scoreBase + ki + 3] * V[(ki + 3) * params.numHeads * params.D + h * params.D + d];\n  }\n  let rem_start = steps * 4u;\n  var s_rem: f32 = 0.0;\n  for (var ki = rem_start; ki < params.N_kv; ki++) {\n    s_rem += scores[scoreBase + ki] * V[ki * params.numHeads * params.D + h * params.D + d];\n  }\n\n  output[qi * params.numHeads * params.D + h * params.D + d] = ((s0 + s1) + (s2 + s3)) + s_rem;\n}\n";

const gegluWGSL = "/**\n * GEGLU activation shader.\n *\n * GEGLU(x, W) = chunk(x @ W, 2)[0] * GELU(chunk(x @ W, 2)[1])\n *\n * Input: result of linear projection [N, 2*innerDim]\n * Output: [N, innerDim]\n *\n * The projection produces two halves: hidden_states and gate.\n * Output = hidden_states * GELU(gate)\n */\n\nstruct Params {\n  N: u32,         // sequence length\n  innerDim: u32,  // output dimension (half of input)\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;  // [N, 2*innerDim]\n@group(0) @binding(2) var<storage, read_write> output: array<f32>; // [N, innerDim]\n\nconst WG_SIZE: u32 = 256;\n\nfn gelu(x: f32) -> f32 {\n  // Exact GELU via erf approximation (Abramowitz & Stegun 7.1.26)\n  if (x > 10.0) { return x; }\n  if (x < -10.0) { return 0.0; }\n  let a = x * 0.7071067811865476; // x / sqrt(2)\n  let abs_a = abs(a);\n  let t = 1.0 / (1.0 + 0.3275911 * abs_a);\n  let poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));\n  var erf_val = 1.0 - poly * exp(-abs_a * abs_a);\n  if (a < 0.0) { erf_val = -erf_val; }\n  return 0.5 * x * (1.0 + erf_val);\n}\n\n@compute @workgroup_size(WG_SIZE)\nfn geglu_main(@builtin(global_invocation_id) gid: vec3<u32>,\n              @builtin(workgroup_id) wgid: vec3<u32>,\n              @builtin(local_invocation_id) lid: vec3<u32>) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  let total = params.N * params.innerDim;\n  if (idx >= total) { return; }\n\n  let row = idx / params.innerDim;\n  let col = idx % params.innerDim;\n\n  let doubleInnerDim = params.innerDim * 2u;\n  // First half: hidden_states\n  let hidden = input[row * doubleInnerDim + col];\n  // Second half: gate\n  let gate = input[row * doubleInnerDim + params.innerDim + col];\n\n  output[idx] = hidden * gelu(gate);\n}\n";

const groupnormWGSL = "// groupnorm.wgsl — Group Normalization compute shader\n//\n// Implements nn.GroupNorm: divide channels into groups, normalize each group\n// independently over (C/num_groups, H, W), then apply learnable scale+bias.\n//\n// Special case: num_groups=1 → LayerNorm over spatial+channel\n// Special case: num_groups=C → InstanceNorm\n//\n// MoGe-2 uses:\n//   - GroupNorm(C//32, C) → 32 channels per group\n//   - GroupNorm(1, C) → \"layer norm\" mode (all channels in one group)\n//\n// Two-pass approach:\n//   Pass 1: compute mean and variance per group\n//   Pass 2: normalize and apply scale+bias\n//\n// Memory layout (CHW, row-major):\n//   input:   [C, H, W]      — f32\n//   scale:   [C]             — f32 (learnable gamma)\n//   bias:    [C]             — f32 (learnable beta)\n//   output:  [C, H, W]      — f32\n\nstruct GroupNormParams {\n  C: u32,\n  H: u32,\n  W: u32,\n  numGroups: u32,\n  eps: f32,\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: GroupNormParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> scale: array<f32>;\n@group(0) @binding(3) var<storage, read> gnbias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\n// Intermediate buffer for per-group mean and variance\n// Layout: [numGroups * 2] — first numGroups entries are means, next are vars\n@group(0) @binding(5) var<storage, read_write> stats: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n// Pass 1: Compute mean and variance for each group\n@compute @workgroup_size(WG_SIZE)\nfn groupnorm_stats(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n) {\n  let groupIdx = gid.x;\n  if (groupIdx >= params.numGroups) {\n    return;\n  }\n\n  let channelsPerGroup = params.C / params.numGroups;\n  let spatialSize = params.H * params.W;\n  let groupSize = channelsPerGroup * spatialSize;\n\n  let startCh = groupIdx * channelsPerGroup;\n\n  // Compute mean\n  var sum: f32 = 0.0;\n  for (var c: u32 = 0; c < channelsPerGroup; c++) {\n    let ch = startCh + c;\n    for (var sp: u32 = 0; sp < spatialSize; sp++) {\n      sum += input[ch * spatialSize + sp];\n    }\n  }\n  let mean = sum / f32(groupSize);\n  stats[groupIdx] = mean;\n\n  // Compute variance\n  var varSum: f32 = 0.0;\n  for (var c: u32 = 0; c < channelsPerGroup; c++) {\n    let ch = startCh + c;\n    for (var sp: u32 = 0; sp < spatialSize; sp++) {\n      let diff = input[ch * spatialSize + sp] - mean;\n      varSum += diff * diff;\n    }\n  }\n  stats[params.numGroups + groupIdx] = varSum / f32(groupSize);\n}\n\n// Pass 2: Normalize each element using group stats, apply scale+bias\n@compute @workgroup_size(WG_SIZE)\nfn groupnorm_normalize(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n  let totalSize = params.C * params.H * params.W;\n  if (idx >= totalSize) {\n    return;\n  }\n\n  let spatialSize = params.H * params.W;\n  let ch = idx / spatialSize;\n  let channelsPerGroup = params.C / params.numGroups;\n  let groupIdx = ch / channelsPerGroup;\n\n  let mean = stats[groupIdx];\n  let variance = stats[params.numGroups + groupIdx];\n  let invStd = 1.0 / sqrt(variance + params.eps);\n\n  let normalized = (input[idx] - mean) * invStd;\n  output[idx] = normalized * scale[ch] + gnbias[ch];\n}\n";

/**
 * two_stream.js — TwoStreamInterleaveTransformer dispatch for SF3D.
 *
 * Architecture (from backbone.py):
 *   Input:
 *     - triplane tokens [3*96*96, 1024] from tokenizer (GroupNorm → proj)
 *     - image tokens [N_img, 1024] from DINOv2 (LayerNorm → proj)
 *     - latent_init [1792, 1024] (learned, LayerNorm → proj)
 *     - latent = concat(image_tokens, latent_init) [N_img+1792, 1024]
 *
 *   4 TwoStreamBlocks, each:
 *     - fuse_block_in: fuse(latent ← triplane) via cross-attention + GEGLU FFN
 *     - 3 BasicBlocks: self-attention + cross-attention(latent ← encoder) + GEGLU FFN
 *     - fuse_block_out: fuse(triplane ← latent) via cross-attention + GEGLU FFN
 *
 *   Output: proj_out(triplane_tokens) + residual → [3*96*96, 1024]
 *
 * All attention uses separate Q/K/V (not fused QKV).
 * FFN uses GEGLU: linear → chunk → gate*GELU(hidden) → linear.
 */


const WG_SIZE$2 = 256;
const MAX_WG$1 = 65535;
function splitWG$2(total) {
  if (total <= MAX_WG$1) return [total, 1];
  return [MAX_WG$1, Math.ceil(total / MAX_WG$1)];
}
function ceilDiv$2(a, b) { return Math.ceil(a / b); }

const CONFIG$1 = {
  dim: 1024,         // latent/triplane dim
  numHeads: 16,
  headDim: 64,
  numBlocks: 4,
  numBasicBlocks: 3,
  numLatents: 1792,
  planeSize: 96,
  triplaneTokens: 3 * 96 * 96, // 27648
  gegluInnerDim: 4096,  // GEGLU inner = dim * mult = 1024 * 4 = 4096
  eps: 1e-5,
};

const TWO_STREAM_STAGE_IDS = Object.freeze([
  'setup',
  ...Array.from({ length: CONFIG$1.numBlocks }, (_, block) => [
    `block-${block}-fuse-in`,
    ...Array.from(
      { length: CONFIG$1.numBasicBlocks },
      (_, basic) => `block-${block}-basic-${basic}`,
    ),
    `block-${block}-fuse-out`,
  ]).flat(),
  'final',
]);

function normalizeLinearRowRange(totalRows, rowStart, rowCount) {
  if (!Number.isSafeInteger(totalRows) || totalRows <= 0) {
    throw new TypeError('totalRows must be a positive safe integer');
  }
  if (!Number.isSafeInteger(rowStart) || rowStart < 0) {
    throw new TypeError('rowStart must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(rowCount) || rowCount <= 0) {
    throw new TypeError('rowCount must be a positive safe integer');
  }
  const rowEnd = rowStart + rowCount;
  if (!Number.isSafeInteger(rowEnd) || rowEnd > totalRows) {
    throw new RangeError(
      `linear row range ${rowStart}-${rowEnd} exceeds totalRows ${totalRows}`,
    );
  }
  return Object.freeze({ totalRows, rowStart, rowCount, rowEnd });
}

function createLinearRowRanges(totalRows, rowsPerDuty) {
  if (!Number.isSafeInteger(rowsPerDuty) || rowsPerDuty <= 0) {
    throw new TypeError('rowsPerDuty must be a positive safe integer');
  }
  normalizeLinearRowRange(totalRows, 0, Math.min(totalRows, rowsPerDuty));
  const ranges = [];
  for (let rowStart = 0; rowStart < totalRows; rowStart += rowsPerDuty) {
    const range = normalizeLinearRowRange(
      totalRows,
      rowStart,
      Math.min(rowsPerDuty, totalRows - rowStart),
    );
    ranges.push(Object.freeze({ rangeIndex: ranges.length, ...range }));
  }
  return Object.freeze(ranges);
}

function createTwoStreamAttentionDutyPlan(N_img, options = {}) {
  if (!Number.isSafeInteger(N_img) || N_img <= 0) {
    throw new TypeError('N_img must be a positive safe integer');
  }
  const linearRowsPerDuty = options.linearRowsPerDuty ?? 128;
  if (!Number.isSafeInteger(linearRowsPerDuty) || linearRowsPerDuty <= 0) {
    throw new TypeError('linearRowsPerDuty must be a positive safe integer');
  }
  const duties = [];
  const append = duty => {
    duties.push(Object.freeze({
      dutyIndex: duties.length,
      dutyId: duty.dutyId,
      ...duty,
    }));
  };
  const appendAttention = (ownerId, tileCount) => {
    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      append({
        dutyId: `${ownerId}-tile-${tileIndex}`,
        kind: 'attention-tile',
        ownerId,
        tileIndex,
        tileCount,
      });
    }
  };
  const appendLinearRanges = (ownerId, kind, block, ranges) => {
    for (const range of ranges) {
      append({
        dutyId: `${ownerId}-range-${range.rangeIndex}`,
        kind,
        ownerId,
        block,
        direction: 'out',
        rangeIndex: range.rangeIndex,
        rangeCount: ranges.length,
        totalRows: range.totalRows,
        rowStart: range.rowStart,
        rowCount: range.rowCount,
        rowEnd: range.rowEnd,
      });
    }
  };
  const latentTiles = ceilDiv$2(N_img + CONFIG$1.numLatents, 128);
  const triplaneTiles = ceilDiv$2(CONFIG$1.triplaneTokens, 128);
  const triplaneRowRanges = createLinearRowRanges(
    CONFIG$1.triplaneTokens,
    linearRowsPerDuty,
  );

  append({ dutyId: 'setup', kind: 'setup' });
  for (let block = 0; block < CONFIG$1.numBlocks; block++) {
    const fuseIn = `block-${block}-fuse-in`;
    append({ dutyId: `${fuseIn}-prepare`, kind: 'fuse-prepare', block, direction: 'in' });
    appendAttention(fuseIn, latentTiles);
    append({ dutyId: `${fuseIn}-finish`, kind: 'fuse-finish', block, direction: 'in' });

    for (let basic = 0; basic < CONFIG$1.numBasicBlocks; basic++) {
      const ownerId = `block-${block}-basic-${basic}`;
      const selfOwner = `${ownerId}-self`;
      const crossOwner = `${ownerId}-cross`;
      append({
        dutyId: `${selfOwner}-prepare`,
        kind: 'basic-self-prepare',
        block,
        basic,
      });
      appendAttention(selfOwner, latentTiles);
      append({
        dutyId: `${crossOwner}-prepare`,
        kind: 'basic-cross-prepare',
        block,
        basic,
      });
      appendAttention(crossOwner, latentTiles);
      append({
        dutyId: `${ownerId}-finish`,
        kind: 'basic-finish',
        block,
        basic,
      });
    }

    const fuseOut = `block-${block}-fuse-out`;
    append({ dutyId: `${fuseOut}-prepare`, kind: 'fuse-prepare', block, direction: 'out' });
    appendAttention(fuseOut, triplaneTiles);
    appendLinearRanges(
      `${fuseOut}-attention-projection`,
      'fuse-attention-linear-range',
      block,
      triplaneRowRanges,
    );
    append({
      dutyId: `${fuseOut}-residual-norm`,
      kind: 'fuse-residual-norm',
      block,
      direction: 'out',
    });
    appendLinearRanges(
      `${fuseOut}-geglu-expansion`,
      'fuse-geglu-linear-range',
      block,
      triplaneRowRanges,
    );
    append({
      dutyId: `${fuseOut}-geglu-activate`,
      kind: 'fuse-geglu-activate',
      block,
      direction: 'out',
    });
    appendLinearRanges(
      `${fuseOut}-ffn-projection`,
      'fuse-ffn-linear-range',
      block,
      triplaneRowRanges,
    );
    append({
      dutyId: `${fuseOut}-final-residual`,
      kind: 'fuse-final-residual',
      block,
      direction: 'out',
    });
  }
  append({ dutyId: 'final', kind: 'final' });
  return Object.freeze(duties);
}

class TwoStreamBackbone {
  constructor(device) {
    this.device = device;
    this.pipelines = {};
    this._uniformCache = new Map();
  }

  init() {
    const device = this.device;
    const make = (code, entry) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });

    this.pipelines.linear = make(linearWGSL, 'main');
    this.pipelines.linearRange = make(linearRangeWGSL, 'main');
    this.pipelines.layerNorm = make(layerNormWGSL, 'main');
    // Cross-attention pipelines share an explicit layout so all 6 bindings are available
    // to all three entry points (auto-layout would omit unused bindings per entry point)
    const crossAttnLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const crossAttnPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [crossAttnLayout] });
    this._crossAttnLayout = crossAttnLayout;

    const crossAttnModule = device.createShaderModule({ code: crossAttentionWGSL });
    const makeCA = (entry) => device.createComputePipeline({
      layout: crossAttnPipelineLayout,
      compute: { module: crossAttnModule, entryPoint: entry },
    });
    this.pipelines.crossAttnScores = makeCA('computeCrossScores');
    this.pipelines.crossAttnSoftmax = makeCA('softmaxCross');
    this.pipelines.crossAttnApply = makeCA('applyCrossAttn');
    this.pipelines.geglu = make(gegluWGSL, 'geglu_main');

    // GroupNorm pipelines — explicit shared layout for both entry points
    const gnLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    const gnPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [gnLayout] });
    this._gnLayout = gnLayout;

    const gnModule = device.createShaderModule({ code: groupnormWGSL });
    this.pipelines.gnStats = device.createComputePipeline({
      layout: gnPipelineLayout,
      compute: { module: gnModule, entryPoint: 'groupnorm_stats' },
    });
    this.pipelines.gnNorm = device.createComputePipeline({
      layout: gnPipelineLayout,
      compute: { module: gnModule, entryPoint: 'groupnorm_normalize' },
    });

    // Element-wise add
    this.pipelines.add = make(`
      @group(0) @binding(0) var<storage, read_write> dst: array<f32>;
      @group(0) @binding(1) var<storage, read> src: array<f32>;
      struct P { count: u32, numWgX: u32 }
      @group(0) @binding(2) var<uniform> p: P;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.count) { return; }
        dst[idx] = dst[idx] + src[idx];
      }
    `, 'main');

    // Concat two buffers
    this.pipelines.concat = make(`
      @group(0) @binding(0) var<storage, read> a: array<f32>;
      @group(0) @binding(1) var<storage, read> b: array<f32>;
      @group(0) @binding(2) var<storage, read_write> out: array<f32>;
      struct P { sizeA: u32, sizeB: u32, numWgX: u32 }
      @group(0) @binding(3) var<uniform> p: P;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        let total = p.sizeA + p.sizeB;
        if (idx >= total) { return; }
        if (idx < p.sizeA) { out[idx] = a[idx]; }
        else { out[idx] = b[idx - p.sizeA]; }
      }
    `, 'main');
  }

  _cachedUniform(data) {
    const bytes = new Uint8Array(data.buffer || data);
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
    const key = `u_${bytes.length}_${h}`;
    if (this._uniformCache.has(key)) return this._uniformCache.get(key);
    const buf = this.device.createBuffer({
      size: Math.max(bytes.byteLength, 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(buf.getMappedRange()).set(bytes);
    buf.unmap();
    this._uniformCache.set(key, buf);
    return buf;
  }

  /**
   * Run the two-stream interleave transformer.
   *
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBuffer} imageTokensBuf - [N_img, 1024] from DINOv2
   * @param {GPUBuffer} triplaneEmbBuf - [3, 1024, 96, 96] triplane embeddings
   * @param {Object} weights - backbone weights from loadWeights
   * @param {number} N_img - number of image tokens
   * @returns {GPUBuffer} - [3*96*96, 1024] refined triplane tokens
   */
  forward(encoder, imageTokensBuf, N_img, weights) {
    const state = this.createForwardState(imageTokensBuf, N_img, weights);
    for (let stageIndex = 0; stageIndex < TWO_STREAM_STAGE_IDS.length; stageIndex++) {
      this.dispatchForwardStage(encoder, state, stageIndex);
    }
    return this.getForwardResult(state);
  }

  createForwardState(imageTokensBuf, N_img, weights) {
    if (!Number.isSafeInteger(N_img) || N_img <= 0) {
      throw new TypeError('N_img must be a positive safe integer');
    }
    this._diagnosticBuffers = {};
    return {
      imageTokensBuf,
      N_img,
      weights,
      N_latent: N_img + CONFIG$1.numLatents,
      currentLatent: null,
      currentTriplane: null,
      nextStageIndex: 0,
      finePlan: null,
      nextFineDutyIndex: 0,
      activeOperation: null,
      result: null,
    };
  }

  createAttentionForwardState(imageTokensBuf, N_img, weights, options = {}) {
    const state = this.createForwardState(imageTokensBuf, N_img, weights);
    state.finePlan = createTwoStreamAttentionDutyPlan(N_img, options);
    return state;
  }

  dispatchForwardStage(encoder, state, stageIndex) {
    if (!Number.isSafeInteger(stageIndex)
      || stageIndex < 0
      || stageIndex >= TWO_STREAM_STAGE_IDS.length) {
      throw new RangeError(`invalid two-stream stage index ${stageIndex}`);
    }
    if (stageIndex !== state.nextStageIndex) {
      throw new Error(
        `two-stream stage ${stageIndex} is out of order; expected ${state.nextStageIndex}`,
      );
    }

    if (stageIndex === 0) {
      this._dispatchForwardSetup(encoder, state);
    } else if (stageIndex === TWO_STREAM_STAGE_IDS.length - 1) {
      this._dispatchForwardFinal(encoder, state);
    } else {
      const blockStage = stageIndex - 1;
      const stagesPerBlock = CONFIG$1.numBasicBlocks + 2;
      const blockIndex = Math.floor(blockStage / stagesPerBlock);
      const stageInBlock = blockStage % stagesPerBlock;
      this._dispatchForwardBlockStage(
        encoder,
        state,
        blockIndex,
        stageInBlock,
      );
    }

    state.nextStageIndex++;
    return state;
  }

  getForwardResult(state) {
    const stageComplete = state.nextStageIndex === TWO_STREAM_STAGE_IDS.length;
    const fineComplete = state.finePlan != null
      && state.nextFineDutyIndex === state.finePlan.length;
    if ((!stageComplete && !fineComplete) || state.result == null) {
      const completed = state.finePlan == null
        ? `${state.nextStageIndex}/${TWO_STREAM_STAGE_IDS.length}`
        : `${state.nextFineDutyIndex}/${state.finePlan.length}`;
      throw new Error(
        `two-stream forward is incomplete at stage ${completed}`,
      );
    }
    return state.result;
  }

  dispatchAttentionForwardDuty(encoder, state, dutyIndex) {
    if (state.finePlan == null) {
      throw new Error('two-stream attention-duty state has no fine plan');
    }
    if (dutyIndex !== state.nextFineDutyIndex) {
      throw new Error(
        `two-stream attention duty ${dutyIndex} is out of order; `
        + `expected ${state.nextFineDutyIndex}`,
      );
    }
    const duty = state.finePlan[dutyIndex];
    if (!duty) {
      throw new RangeError(`invalid two-stream attention duty ${dutyIndex}`);
    }

    switch (duty.kind) {
      case 'setup':
        this._dispatchForwardSetup(encoder, state);
        break;
      case 'fuse-prepare':
        this._dispatchFineFusePrepare(encoder, state, duty);
        break;
      case 'attention-tile':
        this._dispatchFineAttentionTile(encoder, state, duty);
        break;
      case 'fuse-finish':
        this._dispatchFineFuseFinish(encoder, state, duty);
        break;
      case 'fuse-attention-linear-range':
        this._dispatchFineFuseAttentionLinearRange(encoder, state, duty);
        break;
      case 'fuse-residual-norm':
        this._dispatchFineFuseResidualNorm(encoder, state, duty);
        break;
      case 'fuse-geglu-linear-range':
        this._dispatchFineFuseGEGLULinearRange(encoder, state, duty);
        break;
      case 'fuse-geglu-activate':
        this._dispatchFineFuseGEGLUActivate(encoder, state, duty);
        break;
      case 'fuse-ffn-linear-range':
        this._dispatchFineFuseFFNLinearRange(encoder, state, duty);
        break;
      case 'fuse-final-residual':
        this._dispatchFineFuseFinalResidual(encoder, state, duty);
        break;
      case 'basic-self-prepare':
        this._dispatchFineBasicSelfPrepare(encoder, state, duty);
        break;
      case 'basic-cross-prepare':
        this._dispatchFineBasicCrossPrepare(encoder, state, duty);
        break;
      case 'basic-finish':
        this._dispatchFineBasicFinish(encoder, state, duty);
        break;
      case 'final':
        if (state.activeOperation != null) {
          throw new Error(`cannot finalize with active ${state.activeOperation.ownerId}`);
        }
        this._dispatchForwardFinal(encoder, state);
        break;
      default:
        throw new Error(`unknown two-stream attention duty kind ${duty.kind}`);
    }
    state.nextFineDutyIndex++;
    return duty;
  }

  _requireFineOperation(state, kind, ownerId) {
    const operation = state.activeOperation;
    if (operation?.kind !== kind || operation.ownerId !== ownerId) {
      throw new Error(
        `two-stream duty ${ownerId} requires active ${kind}; `
        + `got ${operation?.kind ?? 'none'}:${operation?.ownerId ?? 'none'}`,
      );
    }
    return operation;
  }

  _dispatchFineFusePrepare(encoder, state, duty) {
    if (state.activeOperation != null) {
      throw new Error(`cannot prepare ${duty.dutyId} with active ${state.activeOperation.ownerId}`);
    }
    const D = CONFIG$1.dim;
    const N_tri = CONFIG$1.triplaneTokens;
    const block = state.weights.mainBlocks[duty.block];
    const incoming = duty.direction === 'in';
    const zBuf = incoming ? state.currentLatent : state.currentTriplane;
    const xBuf = incoming ? state.currentTriplane : state.currentLatent;
    const N_z = incoming ? state.N_latent : N_tri;
    const N_x = incoming ? N_tri : state.N_latent;
    const weights = incoming ? block.fuseBlockIn : block.fuseBlockOut;
    const zNormBuf = createEmptyBuffer(this.device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, zBuf, zNormBuf, weights.normZ1, N_z, D);
    let xNormBuf = xBuf;
    if (weights.normX) {
      xNormBuf = createEmptyBuffer(this.device, N_x * D * 4);
      this._dispatchLayerNorm(encoder, xBuf, xNormBuf, weights.normX, N_x, D);
    }
    const ownerId = `block-${duty.block}-fuse-${duty.direction}`;
    state.activeOperation = {
      kind: 'fuse',
      ownerId,
      block: duty.block,
      direction: duty.direction,
      zBuf,
      weights,
      N_z,
      D,
      attention: this._createAttentionState(
        encoder,
        zNormBuf,
        xNormBuf,
        weights.attn,
        N_z,
        N_x,
        D,
      ),
    };
  }

  _dispatchFineAttentionTile(encoder, state, duty) {
    const operation = state.activeOperation;
    if (!operation || operation.ownerId !== duty.ownerId) {
      throw new Error(
        `attention tile ${duty.dutyId} requires active ${duty.ownerId}; `
        + `got ${operation?.ownerId ?? 'none'}`,
      );
    }
    if (operation.attention.tileCount !== duty.tileCount) {
      throw new Error(
        `attention tile count changed for ${duty.ownerId}: `
        + `${operation.attention.tileCount} != ${duty.tileCount}`,
      );
    }
    this._dispatchAttentionTile(encoder, operation.attention, duty.tileIndex);
  }

  _dispatchFineFuseFinish(encoder, state, duty) {
    const ownerId = `block-${duty.block}-fuse-${duty.direction}`;
    const operation = this._requireFineOperation(state, 'fuse', ownerId);
    const attnOutBuf = this._finishAttention(encoder, operation.attention);
    const z1Buf = createEmptyBuffer(this.device, operation.N_z * operation.D * 4);
    encoder.copyBufferToBuffer(
      operation.zBuf,
      0,
      z1Buf,
      0,
      operation.N_z * operation.D * 4,
    );
    this._dispatchAdd(encoder, z1Buf, attnOutBuf, operation.N_z * operation.D);
    const z2NormBuf = createEmptyBuffer(this.device, operation.N_z * operation.D * 4);
    this._dispatchLayerNorm(
      encoder,
      z1Buf,
      z2NormBuf,
      operation.weights.normZ2,
      operation.N_z,
      operation.D,
    );
    const ffnOutBuf = this._dispatchGEGLUFFN(
      encoder,
      z2NormBuf,
      operation.weights.ff,
      operation.N_z,
      operation.D,
    );
    const zOutBuf = createEmptyBuffer(this.device, operation.N_z * operation.D * 4);
    encoder.copyBufferToBuffer(
      z1Buf,
      0,
      zOutBuf,
      0,
      operation.N_z * operation.D * 4,
    );
    this._dispatchAdd(encoder, zOutBuf, ffnOutBuf, operation.N_z * operation.D);
    if (duty.direction === 'in') {
      state.currentLatent = zOutBuf;
    } else {
      state.currentTriplane = zOutBuf;
      this._diagnosticBuffers[`block${duty.block}_latent`] = state.currentLatent;
      this._diagnosticBuffers[`block${duty.block}_triplane`] = state.currentTriplane;
    }
    state.activeOperation = null;
  }

  _requireFineFuseOut(state, duty) {
    const ownerId = `block-${duty.block}-fuse-out`;
    return this._requireFineOperation(state, 'fuse', ownerId);
  }

  _dispatchFineLinearRange(
    encoder,
    operation,
    duty,
    phase,
    input,
    output,
    weight,
    bias,
    inDim,
    outDim,
  ) {
    if (duty.ownerId !== phase.ownerId) {
      throw new Error(
        `linear duty ${duty.dutyId} owner changed: `
        + `${duty.ownerId} != ${phase.ownerId}`,
      );
    }
    if (duty.rangeIndex !== phase.nextRangeIndex
      || duty.rangeCount !== phase.rangeCount
      || duty.totalRows !== operation.N_z) {
      throw new Error(
        `linear duty ${duty.dutyId} is out of range order; `
        + `expected ${phase.nextRangeIndex}/${phase.rangeCount} `
        + `over ${operation.N_z} rows`,
      );
    }
    const range = normalizeLinearRowRange(
      operation.N_z,
      duty.rowStart,
      duty.rowCount,
    );
    if (duty.rowStart !== phase.nextRowStart || duty.rowEnd !== range.rowEnd) {
      throw new Error(
        `linear duty ${duty.dutyId} is not contiguous; `
        + `expected row ${phase.nextRowStart}, got `
        + `${duty.rowStart}-${duty.rowEnd}`,
      );
    }
    this._dispatchLinearRange(
      encoder,
      input,
      output,
      weight,
      bias,
      operation.N_z,
      inDim,
      outDim,
      duty.rowStart,
      duty.rowCount,
    );
    phase.nextRangeIndex++;
    phase.nextRowStart = range.rowEnd;
  }

  _dispatchFineFuseAttentionLinearRange(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    if (operation.attention.nextTileIndex !== operation.attention.tileCount) {
      throw new Error(
        `attention projection started before all tiles completed for ${operation.ownerId}`,
      );
    }
    if (!operation.attentionProjection) {
      operation.attentionProjection = {
        ownerId: `${operation.ownerId}-attention-projection`,
        nextRangeIndex: 0,
        nextRowStart: 0,
        rangeCount: duty.rangeCount,
        output: createEmptyBuffer(this.device, operation.N_z * operation.D * 4),
      };
    }
    const phase = operation.attentionProjection;
    this._dispatchFineLinearRange(
      encoder,
      operation,
      duty,
      phase,
      operation.attention.attnOutBuf,
      phase.output,
      operation.attention.attnWeights.proj.weight,
      operation.attention.attnWeights.proj.bias,
      operation.D,
      operation.D,
    );
  }

  _dispatchFineFuseResidualNorm(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    const phase = operation.attentionProjection;
    if (!phase
      || phase.nextRangeIndex !== phase.rangeCount
      || phase.nextRowStart !== operation.N_z) {
      throw new Error(`attention projection is incomplete for ${operation.ownerId}`);
    }
    const byteLength = operation.N_z * operation.D * 4;
    operation.z1Buf = createEmptyBuffer(this.device, byteLength);
    encoder.copyBufferToBuffer(operation.zBuf, 0, operation.z1Buf, 0, byteLength);
    this._dispatchAdd(
      encoder,
      operation.z1Buf,
      phase.output,
      operation.N_z * operation.D,
    );
    operation.z2NormBuf = createEmptyBuffer(this.device, byteLength);
    this._dispatchLayerNorm(
      encoder,
      operation.z1Buf,
      operation.z2NormBuf,
      operation.weights.normZ2,
      operation.N_z,
      operation.D,
    );
  }

  _dispatchFineFuseGEGLULinearRange(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    if (!operation.z2NormBuf) {
      throw new Error(`GEGLU expansion started before residual norm for ${operation.ownerId}`);
    }
    const innerDim = CONFIG$1.gegluInnerDim;
    if (!operation.gegluExpansion) {
      operation.gegluExpansion = {
        ownerId: `${operation.ownerId}-geglu-expansion`,
        nextRangeIndex: 0,
        nextRowStart: 0,
        rangeCount: duty.rangeCount,
        output: createEmptyBuffer(this.device, operation.N_z * 2 * innerDim * 4),
      };
    }
    const phase = operation.gegluExpansion;
    this._dispatchFineLinearRange(
      encoder,
      operation,
      duty,
      phase,
      operation.z2NormBuf,
      phase.output,
      operation.weights.ff.geglu.weight,
      operation.weights.ff.geglu.bias,
      operation.D,
      2 * innerDim,
    );
  }

  _dispatchFineFuseGEGLUActivate(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    const phase = operation.gegluExpansion;
    if (!phase
      || phase.nextRangeIndex !== phase.rangeCount
      || phase.nextRowStart !== operation.N_z) {
      throw new Error(`GEGLU expansion is incomplete for ${operation.ownerId}`);
    }
    operation.gegluOutput = createEmptyBuffer(
      this.device,
      operation.N_z * CONFIG$1.gegluInnerDim * 4,
    );
    this._dispatchGEGLUActivation(
      encoder,
      phase.output,
      operation.gegluOutput,
      operation.N_z,
      CONFIG$1.gegluInnerDim,
    );
  }

  _dispatchFineFuseFFNLinearRange(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    if (!operation.gegluOutput) {
      throw new Error(`FFN projection started before GEGLU activation for ${operation.ownerId}`);
    }
    if (!operation.ffnProjection) {
      operation.ffnProjection = {
        ownerId: `${operation.ownerId}-ffn-projection`,
        nextRangeIndex: 0,
        nextRowStart: 0,
        rangeCount: duty.rangeCount,
        output: createEmptyBuffer(this.device, operation.N_z * operation.D * 4),
      };
    }
    const phase = operation.ffnProjection;
    this._dispatchFineLinearRange(
      encoder,
      operation,
      duty,
      phase,
      operation.gegluOutput,
      phase.output,
      operation.weights.ff.proj.weight,
      operation.weights.ff.proj.bias,
      CONFIG$1.gegluInnerDim,
      operation.D,
    );
  }

  _dispatchFineFuseFinalResidual(encoder, state, duty) {
    const operation = this._requireFineFuseOut(state, duty);
    const phase = operation.ffnProjection;
    if (!phase
      || phase.nextRangeIndex !== phase.rangeCount
      || phase.nextRowStart !== operation.N_z) {
      throw new Error(`FFN projection is incomplete for ${operation.ownerId}`);
    }
    const byteLength = operation.N_z * operation.D * 4;
    const zOutBuf = createEmptyBuffer(this.device, byteLength);
    encoder.copyBufferToBuffer(operation.z1Buf, 0, zOutBuf, 0, byteLength);
    this._dispatchAdd(
      encoder,
      zOutBuf,
      phase.output,
      operation.N_z * operation.D,
    );
    state.currentTriplane = zOutBuf;
    this._diagnosticBuffers[`block${duty.block}_latent`] = state.currentLatent;
    this._diagnosticBuffers[`block${duty.block}_triplane`] = state.currentTriplane;
    state.activeOperation = null;
  }

  _dispatchFineBasicSelfPrepare(encoder, state, duty) {
    if (state.activeOperation != null) {
      throw new Error(`cannot prepare ${duty.dutyId} with active ${state.activeOperation.ownerId}`);
    }
    const D = CONFIG$1.dim;
    const weights = state.weights.mainBlocks[duty.block].transformerBlocks[duty.basic];
    const norm1Buf = createEmptyBuffer(this.device, state.N_latent * D * 4);
    this._dispatchLayerNorm(
      encoder,
      state.currentLatent,
      norm1Buf,
      weights.norm1,
      state.N_latent,
      D,
    );
    state.activeOperation = {
      kind: 'basic-self',
      ownerId: `block-${duty.block}-basic-${duty.basic}-self`,
      block: duty.block,
      basic: duty.basic,
      zBuf: state.currentLatent,
      weights,
      D,
      attention: this._createAttentionState(
        encoder,
        norm1Buf,
        norm1Buf,
        weights.attn1,
        state.N_latent,
        state.N_latent,
        D,
      ),
    };
  }

  _dispatchFineBasicCrossPrepare(encoder, state, duty) {
    const selfOwner = `block-${duty.block}-basic-${duty.basic}-self`;
    const operation = this._requireFineOperation(state, 'basic-self', selfOwner);
    const selfAttnBuf = this._finishAttention(encoder, operation.attention);
    const z1Buf = createEmptyBuffer(this.device, state.N_latent * operation.D * 4);
    encoder.copyBufferToBuffer(
      operation.zBuf,
      0,
      z1Buf,
      0,
      state.N_latent * operation.D * 4,
    );
    this._dispatchAdd(encoder, z1Buf, selfAttnBuf, state.N_latent * operation.D);
    const norm2Buf = createEmptyBuffer(this.device, state.N_latent * operation.D * 4);
    this._dispatchLayerNorm(
      encoder,
      z1Buf,
      norm2Buf,
      operation.weights.norm2,
      state.N_latent,
      operation.D,
    );
    operation.kind = 'basic-cross';
    operation.ownerId = `block-${duty.block}-basic-${duty.basic}-cross`;
    operation.z1Buf = z1Buf;
    operation.attention = this._createAttentionState(
      encoder,
      norm2Buf,
      state.imageTokensBuf,
      operation.weights.attn2,
      state.N_latent,
      state.N_img,
      operation.D,
    );
  }

  _dispatchFineBasicFinish(encoder, state, duty) {
    const ownerId = `block-${duty.block}-basic-${duty.basic}-cross`;
    const operation = this._requireFineOperation(state, 'basic-cross', ownerId);
    const crossAttnBuf = this._finishAttention(encoder, operation.attention);
    const z2Buf = createEmptyBuffer(this.device, state.N_latent * operation.D * 4);
    encoder.copyBufferToBuffer(
      operation.z1Buf,
      0,
      z2Buf,
      0,
      state.N_latent * operation.D * 4,
    );
    this._dispatchAdd(encoder, z2Buf, crossAttnBuf, state.N_latent * operation.D);
    const norm3Buf = createEmptyBuffer(this.device, state.N_latent * operation.D * 4);
    this._dispatchLayerNorm(
      encoder,
      z2Buf,
      norm3Buf,
      operation.weights.norm3,
      state.N_latent,
      operation.D,
    );
    const ffnOutBuf = this._dispatchGEGLUFFN(
      encoder,
      norm3Buf,
      operation.weights.ff,
      state.N_latent,
      operation.D,
    );
    const zOutBuf = createEmptyBuffer(this.device, state.N_latent * operation.D * 4);
    encoder.copyBufferToBuffer(
      z2Buf,
      0,
      zOutBuf,
      0,
      state.N_latent * operation.D * 4,
    );
    this._dispatchAdd(encoder, zOutBuf, ffnOutBuf, state.N_latent * operation.D);
    state.currentLatent = zOutBuf;
    state.activeOperation = null;
  }

  _dispatchForwardSetup(encoder, state) {
    const device = this.device;
    const D = CONFIG$1.dim;
    const N_tri = CONFIG$1.triplaneTokens;
    const N_latent_init = CONFIG$1.numLatents;
    const { imageTokensBuf, N_img, weights } = state;

    const gnOutBuf = this._dispatchGroupNorm(encoder, weights.tokenizer_embeddings_buf,
      weights.normTriplane, D, N_tri, 32);
    const triPermBuf = createEmptyBuffer(device, N_tri * D * 4);
    this._dispatchTranspose(encoder, gnOutBuf, triPermBuf, D, N_tri);
    const triProjBuf = createEmptyBuffer(device, N_tri * D * 4);
    this._dispatchLinear(encoder, triPermBuf, triProjBuf,
      weights.projTriplane.weight, weights.projTriplane.bias, N_tri, D, D);

    const imgNormBuf = createEmptyBuffer(device, N_img * D * 4);
    this._dispatchLayerNorm(encoder, imageTokensBuf, imgNormBuf, weights.normImage, N_img, D);
    const imgProjBuf = createEmptyBuffer(device, N_img * D * 4);
    this._dispatchLinear(encoder, imgNormBuf, imgProjBuf,
      weights.projImage.weight, weights.projImage.bias, N_img, D, D);

    const latentNormBuf = createEmptyBuffer(device, N_latent_init * D * 4);
    this._dispatchLayerNorm(encoder, weights.latentInit, latentNormBuf,
      weights.normLatent, N_latent_init, D);
    const latentProjBuf = createEmptyBuffer(device, N_latent_init * D * 4);
    this._dispatchLinear(encoder, latentNormBuf, latentProjBuf,
      weights.projLatent.weight, weights.projLatent.bias, N_latent_init, D, D);

    const N_latent = state.N_latent;
    const latentBuf = createEmptyBuffer(device, N_latent * D * 4);
    this._dispatchConcat(encoder, imgProjBuf, latentProjBuf, latentBuf,
      N_img * D, N_latent_init * D);

    state.currentLatent = latentBuf;
    state.currentTriplane = triProjBuf;
    Object.assign(this._diagnosticBuffers, {
      gnOutBuf,
      triPermBuf,
      triProjBuf,
      imgProjBuf,
      latentProjBuf,
      latentBuf,
    });
  }

  _dispatchForwardBlockStage(encoder, state, blockIndex, stageInBlock) {
    const D = CONFIG$1.dim;
    const N_tri = CONFIG$1.triplaneTokens;
    const block = state.weights.mainBlocks[blockIndex];

    if (stageInBlock === 0) {
      state.currentLatent = this._dispatchFuseBlock(
        encoder,
        state.currentLatent,
        state.currentTriplane,
        block.fuseBlockIn,
        state.N_latent,
        N_tri,
        D,
      );
      return;
    }

    if (stageInBlock <= CONFIG$1.numBasicBlocks) {
      const basicIndex = stageInBlock - 1;
      state.currentLatent = this._dispatchBasicBlock(
        encoder,
        state.currentLatent,
        state.imageTokensBuf,
        block.transformerBlocks[basicIndex],
        state.N_latent,
        state.N_img,
        D,
      );
      return;
    }

    state.currentTriplane = this._dispatchFuseBlock(
      encoder,
      state.currentTriplane,
      state.currentLatent,
      block.fuseBlockOut,
      N_tri,
      state.N_latent,
      D,
    );
    this._diagnosticBuffers[`block${blockIndex}_latent`] = state.currentLatent;
    this._diagnosticBuffers[`block${blockIndex}_triplane`] = state.currentTriplane;
  }

  _dispatchForwardFinal(encoder, state) {
    const device = this.device;
    const D = CONFIG$1.dim;
    const N_tri = CONFIG$1.triplaneTokens;
    const projOutBuf = createEmptyBuffer(device, N_tri * D * 4);
    this._dispatchLinear(encoder, state.currentTriplane, projOutBuf,
      state.weights.projOut.weight, state.weights.projOut.bias, N_tri, D, D);
    const projOutPermBuf = createEmptyBuffer(device, D * N_tri * 4);
    this._dispatchTranspose(encoder, projOutBuf, projOutPermBuf, N_tri, D);
    this._dispatchAdd(
      encoder,
      projOutPermBuf,
      state.weights.tokenizer_embeddings_buf,
      D * N_tri,
    );

    this._diagnosticBuffers['projOutBuf'] = projOutBuf;
    this._diagnosticBuffers['projOutPermBuf'] = projOutPermBuf;
    this._diagnosticBuffers['rearrangedEmb'] = state.weights.tokenizer_embeddings_buf;
    state.result = {
      buffer: projOutPermBuf,
      C: D,
      N: N_tri,
      planeSize: CONFIG$1.planeSize,
    };
  }

  // --- FuseBlock: cross-attention fuse(z ← x) + GEGLU FFN ---
  _dispatchFuseBlock(encoder, zBuf, xBuf, weights, N_z, N_x, D) {
    const device = this.device;

    // norm_z1
    const zNormBuf = createEmptyBuffer(device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, zBuf, zNormBuf, weights.normZ1, N_z, D);

    // norm_x (if present)
    let xNormBuf = xBuf;
    if (weights.normX) {
      xNormBuf = createEmptyBuffer(device, N_x * D * 4);
      this._dispatchLayerNorm(encoder, xBuf, xNormBuf, weights.normX, N_x, D);
    }

    // Cross-attention: Q from z, KV from x
    const attnOutBuf = this._dispatchCrossAttention(encoder, zNormBuf, xNormBuf,
      weights.attn, N_z, N_x, D);

    // z = z + attn_out
    const z1Buf = createEmptyBuffer(device, N_z * D * 4);
    encoder.copyBufferToBuffer(zBuf, 0, z1Buf, 0, N_z * D * 4);
    this._dispatchAdd(encoder, z1Buf, attnOutBuf, N_z * D);

    // norm_z2 + GEGLU FFN
    const z2NormBuf = createEmptyBuffer(device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, z1Buf, z2NormBuf, weights.normZ2, N_z, D);

    const ffnOutBuf = this._dispatchGEGLUFFN(encoder, z2NormBuf, weights.ff, N_z, D);

    // z = z1 + ffn_out
    const zOutBuf = createEmptyBuffer(device, N_z * D * 4);
    encoder.copyBufferToBuffer(z1Buf, 0, zOutBuf, 0, N_z * D * 4);
    this._dispatchAdd(encoder, zOutBuf, ffnOutBuf, N_z * D);

    return zOutBuf;
  }

  // --- BasicBlock: self-attn + cross-attn + GEGLU FFN ---
  _dispatchBasicBlock(encoder, zBuf, xBuf, weights, N_z, N_x, D) {
    const device = this.device;

    // 1. Self-attention: norm1 → attn1(z, z)
    const norm1Buf = createEmptyBuffer(device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, zBuf, norm1Buf, weights.norm1, N_z, D);

    const selfAttnBuf = this._dispatchSelfAttention(encoder, norm1Buf,
      weights.attn1, N_z, D);

    const z1Buf = createEmptyBuffer(device, N_z * D * 4);
    encoder.copyBufferToBuffer(zBuf, 0, z1Buf, 0, N_z * D * 4);
    this._dispatchAdd(encoder, z1Buf, selfAttnBuf, N_z * D);

    // 2. Cross-attention: norm2 → attn2(z, x)
    const norm2Buf = createEmptyBuffer(device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, z1Buf, norm2Buf, weights.norm2, N_z, D);

    const crossAttnBuf = this._dispatchCrossAttention(encoder, norm2Buf,
      xBuf, weights.attn2, N_z, N_x, D);

    const z2Buf = createEmptyBuffer(device, N_z * D * 4);
    encoder.copyBufferToBuffer(z1Buf, 0, z2Buf, 0, N_z * D * 4);
    this._dispatchAdd(encoder, z2Buf, crossAttnBuf, N_z * D);

    // 3. GEGLU FFN: norm3 → geglu_ffn
    const norm3Buf = createEmptyBuffer(device, N_z * D * 4);
    this._dispatchLayerNorm(encoder, z2Buf, norm3Buf, weights.norm3, N_z, D);

    const ffnOutBuf = this._dispatchGEGLUFFN(encoder, norm3Buf, weights.ff, N_z, D);

    const zOutBuf = createEmptyBuffer(device, N_z * D * 4);
    encoder.copyBufferToBuffer(z2Buf, 0, zOutBuf, 0, N_z * D * 4);
    this._dispatchAdd(encoder, zOutBuf, ffnOutBuf, N_z * D);

    return zOutBuf;
  }

  _createAttentionState(encoder, qInputBuf, kvInputBuf, attnWeights, N_q, N_kv, D) {
    const device = this.device;
    const numHeads = CONFIG$1.numHeads;
    const qBuf = createEmptyBuffer(device, N_q * D * 4);
    const kBuf = createEmptyBuffer(device, N_kv * D * 4);
    const vBuf = createEmptyBuffer(device, N_kv * D * 4);
    this._dispatchLinearNoBias(encoder, qInputBuf, qBuf, attnWeights.wq, N_q, D, D);
    this._dispatchLinearNoBias(encoder, kvInputBuf, kBuf, attnWeights.wk, N_kv, D, D);
    this._dispatchLinearNoBias(encoder, kvInputBuf, vBuf, attnWeights.wv, N_kv, D, D);

    const tileQCapacity = 128;
    const scoreBufSize = numHeads * tileQCapacity * N_kv * 4;
    const scoreBuf = createEmptyBuffer(device, scoreBufSize);
    const tileAttnOutBuf = createEmptyBuffer(device, tileQCapacity * D * 4);
    const attnOutBuf = createEmptyBuffer(device, N_q * D * 4);

    return {
      attnWeights,
      N_q,
      N_kv,
      D,
      numHeads,
      headDim: CONFIG$1.headDim,
      tileQCapacity,
      tileCount: ceilDiv$2(N_q, tileQCapacity),
      nextTileIndex: 0,
      qBuf,
      kBuf,
      vBuf,
      scoreBuf,
      tileAttnOutBuf,
      attnOutBuf,
    };
  }

  _dispatchAttentionTile(encoder, state, tileIndex) {
    if (tileIndex !== state.nextTileIndex) {
      throw new Error(
        `attention tile ${tileIndex} is out of order; expected ${state.nextTileIndex}`,
      );
    }
    if (tileIndex < 0 || tileIndex >= state.tileCount) {
      throw new RangeError(`invalid attention tile ${tileIndex}/${state.tileCount}`);
    }

    const device = this.device;
    const {
      N_q,
      N_kv,
      D,
      numHeads,
      headDim,
      tileQCapacity,
      qBuf,
      kBuf,
      vBuf,
      scoreBuf,
      tileAttnOutBuf,
      attnOutBuf,
    } = state;
    const qStart = tileIndex * tileQCapacity;
    const tileQ = Math.min(tileQCapacity, N_q - qStart);
    const qOffsetBytes = qStart * D * 4;
    const scoreSize = numHeads * tileQ * N_kv * 4;
    const outputSize = tileQ * D * 4;

    {
      const totalWG = ceilDiv$2(numHeads * tileQ * N_kv, WG_SIZE$2);
      const [wgX, wgY] = splitWG$2(totalWG);
      const params = this._cachedUniform(
        new Uint32Array([tileQ, N_kv, headDim, numHeads, wgX]),
      );
      const bg = device.createBindGroup({
        layout: this._crossAttnLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: qBuf, offset: qOffsetBytes, size: outputSize } },
          { binding: 2, resource: { buffer: kBuf } },
          { binding: 3, resource: { buffer: vBuf } },
          { binding: 4, resource: { buffer: scoreBuf, size: scoreSize } },
          { binding: 5, resource: { buffer: tileAttnOutBuf, size: outputSize } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.crossAttnScores);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }

    {
      const totalWG = ceilDiv$2(numHeads * tileQ, WG_SIZE$2);
      const [wgX, wgY] = splitWG$2(totalWG);
      const params = this._cachedUniform(
        new Uint32Array([tileQ, N_kv, headDim, numHeads, wgX]),
      );
      const bg = device.createBindGroup({
        layout: this._crossAttnLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: qBuf, offset: qOffsetBytes, size: outputSize } },
          { binding: 2, resource: { buffer: kBuf } },
          { binding: 3, resource: { buffer: vBuf } },
          { binding: 4, resource: { buffer: scoreBuf, size: scoreSize } },
          { binding: 5, resource: { buffer: tileAttnOutBuf, size: outputSize } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.crossAttnSoftmax);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }

    {
      const totalWG = ceilDiv$2(tileQ * numHeads * headDim, WG_SIZE$2);
      const [wgX, wgY] = splitWG$2(totalWG);
      const params = this._cachedUniform(
        new Uint32Array([tileQ, N_kv, headDim, numHeads, wgX]),
      );
      const bg = device.createBindGroup({
        layout: this._crossAttnLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: qBuf, offset: qOffsetBytes, size: outputSize } },
          { binding: 2, resource: { buffer: kBuf } },
          { binding: 3, resource: { buffer: vBuf } },
          { binding: 4, resource: { buffer: scoreBuf, size: scoreSize } },
          { binding: 5, resource: { buffer: tileAttnOutBuf, size: outputSize } },
        ],
      });
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.pipelines.crossAttnApply);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }

    encoder.copyBufferToBuffer(tileAttnOutBuf, 0, attnOutBuf, qOffsetBytes, outputSize);
    state.nextTileIndex++;
  }

  _finishAttention(encoder, state) {
    if (state.nextTileIndex !== state.tileCount) {
      throw new Error(
        `attention is incomplete at tile ${state.nextTileIndex}/${state.tileCount}`,
      );
    }
    const projOutBuf = createEmptyBuffer(this.device, state.N_q * state.D * 4);
    this._dispatchLinear(
      encoder,
      state.attnOutBuf,
      projOutBuf,
      state.attnWeights.proj.weight,
      state.attnWeights.proj.bias,
      state.N_q,
      state.D,
      state.D,
    );
    return projOutBuf;
  }

  // --- Cross-attention dispatch (tiled over Q to fit WebGPU buffer limits) ---
  _dispatchCrossAttention(encoder, qInputBuf, kvInputBuf, attnWeights, N_q, N_kv, D) {
    const state = this._createAttentionState(
      encoder,
      qInputBuf,
      kvInputBuf,
      attnWeights,
      N_q,
      N_kv,
      D,
    );
    for (let tileIndex = 0; tileIndex < state.tileCount; tileIndex++) {
      this._dispatchAttentionTile(encoder, state, tileIndex);
    }
    return this._finishAttention(encoder, state);
  }

  _dispatchSelfAttention(encoder, inputBuf, attnWeights, N, D) {
    return this._dispatchCrossAttention(
      encoder,
      inputBuf,
      inputBuf,
      attnWeights,
      N,
      N,
      D,
    );
  }

  // --- GEGLU FFN ---
  _dispatchGEGLUFFN(encoder, inputBuf, ffWeights, N, D) {
    const device = this.device;
    const innerDim = CONFIG$1.gegluInnerDim;

    // Linear: [N, D] → [N, 2*innerDim] (GEGLU projection)
    const geGluProjBuf = createEmptyBuffer(device, N * 2 * innerDim * 4);
    this._dispatchLinear(encoder, inputBuf, geGluProjBuf,
      ffWeights.geglu.weight, ffWeights.geglu.bias, N, D, 2 * innerDim);

    // GEGLU activation: [N, 2*innerDim] → [N, innerDim]
    const geGluOutBuf = createEmptyBuffer(device, N * innerDim * 4);
    this._dispatchGEGLUActivation(encoder, geGluProjBuf, geGluOutBuf, N, innerDim);

    // Linear: [N, innerDim] → [N, D]
    const ffnOutBuf = createEmptyBuffer(device, N * D * 4);
    this._dispatchLinear(encoder, geGluOutBuf, ffnOutBuf,
      ffWeights.proj.weight, ffWeights.proj.bias, N, innerDim, D);

    return ffnOutBuf;
  }

  _dispatchGEGLUActivation(encoder, input, output, rows, innerDim) {
    const totalWG = ceilDiv$2(rows * innerDim, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(new Uint32Array([rows, innerDim, wgX]));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.geglu.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.geglu);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  // --- Low-level dispatch helpers ---

  _dispatchLinear(encoder, input, output, weight, bias, rows, inDim, outDim) {
    const totalWG = ceilDiv$2(rows * outDim, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(
      new Uint32Array([rows, inDim, outDim, wgX, 1]),
    );
    const bg = this.device.createBindGroup({
      layout: this.pipelines.linear.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: weight } },
        { binding: 3, resource: { buffer: bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLinearRange(
    encoder,
    input,
    output,
    weight,
    bias,
    totalRows,
    inDim,
    outDim,
    rowStart,
    rowCount,
  ) {
    const range = normalizeLinearRowRange(totalRows, rowStart, rowCount);
    const totalWG = ceilDiv$2(range.rowCount * outDim, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(new Uint32Array([
      range.totalRows,
      inDim,
      outDim,
      range.rowStart,
      range.rowCount,
      wgX,
      1,
      0,
    ]));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.linearRange.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: weight } },
        { binding: 3, resource: { buffer: bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.linearRange);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchLinearNoBias(encoder, input, output, weight, rows, inDim, outDim) {
    // Use a zero bias buffer, reallocating if a larger outDim is needed
    if (!this._zeroBias || this._zeroBiasSize < outDim) {
      this._zeroBiasSize = outDim;
      this._zeroBias = createStorageBuffer(this.device, new Float32Array(outDim));
    }
    this._dispatchLinear(encoder, input, output, weight, this._zeroBias, rows, inDim, outDim);
  }

  _dispatchLayerNorm(encoder, input, output, norm, N, D) {
    const paramsData = new ArrayBuffer(16);
    const v = new DataView(paramsData);
    v.setUint32(0, N, true); v.setUint32(4, D, true); v.setFloat32(8, CONFIG$1.eps, true);
    const params = this._cachedUniform(new Uint8Array(paramsData));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.layerNorm.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: norm.weight } },
        { binding: 3, resource: { buffer: norm.bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.layerNorm);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(N);
    pass.end();
  }

  _dispatchGroupNorm(encoder, input, norm, C, spatialSize, numGroups) {
    const device = this.device;
    const total = C * spatialSize;

    const normTotalWG = ceilDiv$2(total, WG_SIZE$2);
    const [normWgX, normWgY] = splitWG$2(normTotalWG);
    const uniformArr = new ArrayBuffer(24);
    const u32View = new Uint32Array(uniformArr);
    const f32View = new Float32Array(uniformArr);
    u32View[0] = C; u32View[1] = 1; u32View[2] = spatialSize; u32View[3] = numGroups;
    f32View[4] = CONFIG$1.eps; u32View[5] = normWgX;
    const uniformBuf = this._cachedUniform(new Uint8Array(uniformArr));

    const statsBuf = createEmptyBuffer(device, numGroups * 2 * 4);
    const outputBuf = createEmptyBuffer(device, total * 4);

    // Stats pass — all bindings via shared explicit layout
    const statsBG = device.createBindGroup({
      layout: this._gnLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: norm.weight } },
        { binding: 3, resource: { buffer: norm.bias } },
        { binding: 4, resource: { buffer: outputBuf } },
        { binding: 5, resource: { buffer: statsBuf } },
      ],
    });
    let pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.gnStats);
    pass.setBindGroup(0, statsBG);
    pass.dispatchWorkgroups(ceilDiv$2(numGroups, WG_SIZE$2));
    pass.end();

    // Normalize pass — all bindings via shared explicit layout
    const normBG = device.createBindGroup({
      layout: this._gnLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuf } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: norm.weight } },
        { binding: 3, resource: { buffer: norm.bias } },
        { binding: 4, resource: { buffer: outputBuf } },
        { binding: 5, resource: { buffer: statsBuf } },
      ],
    });
    pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.gnNorm);
    pass.setBindGroup(0, normBG);
    pass.dispatchWorkgroups(normWgX, normWgY);
    pass.end();

    return outputBuf;
  }

  _dispatchTranspose(encoder, input, output, rows, cols) {
    // Simple transpose: [rows, cols] → [cols, rows]
    // Use inline shader since transpose_nd.wgsl may have different binding layout
    if (!this.pipelines.transpose2d) {
      this.pipelines.transpose2d = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({
            code: `
              struct P { rows: u32, cols: u32, numWgX: u32 }
              @group(0) @binding(0) var<uniform> p: P;
              @group(0) @binding(1) var<storage, read> input: array<f32>;
              @group(0) @binding(2) var<storage, read_write> output: array<f32>;
              @compute @workgroup_size(256)
              fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
                let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
                if (idx >= p.rows * p.cols) { return; }
                let r = idx / p.cols;
                let c = idx % p.cols;
                output[c * p.rows + r] = input[r * p.cols + c];
              }
            `,
          }),
          entryPoint: 'main',
        },
      });
    }

    const total = rows * cols;
    const totalWG = ceilDiv$2(total, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(new Uint32Array([rows, cols, wgX]));

    const bg = this.device.createBindGroup({
      layout: this.pipelines.transpose2d.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.transpose2d);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchAdd(encoder, dst, src, count) {
    const totalWG = ceilDiv$2(count, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, wgX]));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.add.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dst } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: params } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.add);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchConcat(encoder, aBuf, bBuf, outBuf, sizeA, sizeB) {
    const total = sizeA + sizeB;
    const totalWG = ceilDiv$2(total, WG_SIZE$2);
    const [wgX, wgY] = splitWG$2(totalWG);
    const params = this._cachedUniform(new Uint32Array([sizeA, sizeB, wgX]));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.concat.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: aBuf } },
        { binding: 1, resource: { buffer: bBuf } },
        { binding: 2, resource: { buffer: outBuf } },
        { binding: 3, resource: { buffer: params } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.concat);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }
}

/**
 * Cooperative execution for the SF3D two-stream interleave transformer.
 *
 * The graph is cut only at dependency-safe stage boundaries. Legacy forward()
 * drives these same stages into one command encoder, so scheduling changes do
 * not create a second numerical implementation.
 */


const TWO_STREAM_MANIFEST_ID = 'sf3d.two-stream-cooperative-boundaries.v0';
const TWO_STREAM_BOUNDARY_ID = 'two-stream-stages';
const TWO_STREAM_ATTENTION_MANIFEST_ID =
  'sf3d.two-stream-attention-cooperative-boundaries.v0';
const TWO_STREAM_ATTENTION_BOUNDARY_ID = 'two-stream-attention-duties';
const TWO_STREAM_DUTY_COUNT = TWO_STREAM_STAGE_IDS.length;

function defineTwoStreamManifest(options = {}) {
  const {
    dutyGranularity = 'stage',
    N_img,
    linearRowsPerDuty = 128,
  } = options;
  if (!['stage', 'attention-tile'].includes(dutyGranularity)) {
    throw new RangeError(`unknown two-stream duty granularity ${dutyGranularity}`);
  }
  const attentionPlan = dutyGranularity === 'attention-tile'
    ? createTwoStreamAttentionDutyPlan(N_img, { linearRowsPerDuty })
    : null;
  const boundaryId = attentionPlan ? TWO_STREAM_ATTENTION_BOUNDARY_ID : TWO_STREAM_BOUNDARY_ID;
  const totalItems = attentionPlan?.length ?? TWO_STREAM_DUTY_COUNT;
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: attentionPlan ? TWO_STREAM_ATTENTION_MANIFEST_ID : TWO_STREAM_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'two-stream-backbone',
        boundaries: [
          {
            boundaryId,
            kind: 'gpu-command',
            unit: attentionPlan ? 'two-stream-attention-duty' : 'two-stream-stage',
            totalItems,
            progressWeight: totalItems,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: 1 },
            yieldPolicy: 'after-duty',
            resources: {
              retain: [
                'dinov2.tokens',
                'triplane.low-resolution',
                'two-stream.weights',
                'two-stream.intermediates',
              ],
              produce: ['two-stream.triplane-features'],
              release: [],
            },
          },
        ],
      },
    ],
    metadata: {
      source: 'sf3d-webgpu-cooperative-two-stream',
      dutyGranularity,
      linearRowsPerDuty: attentionPlan ? linearRowsPerDuty : null,
    },
  });
}

async function driveTwoStreamBoundary(cooperative, options) {
  const {
    encodeStage,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = options;
  if (options.submitStage != null) {
    throw new TypeError('submitStage is unsupported: the kit owns queue.submit (>=0.1.41); encodeStage must return the command buffer');
  }
  const gpu = cooperative.startBoundary(TWO_STREAM_BOUNDARY_ID);
  const telemetry = [];

  for (let stageIndex = 0; stageIndex < TWO_STREAM_DUTY_COUNT; stageIndex++) {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(`cooperative two-stream exhausted ranges before stage ${stageIndex}`);
    }
    if (range.itemStart !== stageIndex || range.itemEnd !== stageIndex + 1) {
      throw new Error(
        `cooperative two-stream range ${range.itemStart}-${range.itemEnd} `
        + `does not match stage ${stageIndex}`,
      );
    }

    const stageId = TWO_STREAM_STAGE_IDS[stageIndex];
    const timing = {
      stageIndex,
      stageId,
      dutyStartedAtMs: now(),
      encodeStartedAtMs: null,
      encodeCompletedAtMs: null,
      submitStartedAtMs: null,
      submitCompletedAtMs: null,
      dutyCompletedAtMs: null,
      encodeMs: null,
      submitMs: null,
      dutyMs: null,
    };

    // kit >=0.1.41: encode returns the command buffer; the kit submits it and
    // captures the queue-prefix fence. Submit timing stays null (kit-owned).
    await gpu.runGpuDuty(range, {
      encode() {
        timing.encodeStartedAtMs = now();
        const commandBuffer = encodeStage({ stageIndex, stageId, range });
        timing.encodeCompletedAtMs = now();
        timing.encodeMs = timing.encodeCompletedAtMs - timing.encodeStartedAtMs;
        return commandBuffer;
      },
    });

    timing.dutyCompletedAtMs = now();
    timing.dutyMs = timing.dutyCompletedAtMs - timing.dutyStartedAtMs;
    telemetry.push(Object.freeze(timing));
  }

  if (gpu.nextRange() != null) {
    throw new Error('cooperative two-stream left ranges unconsumed');
  }
  return {
    completedDuties: telemetry.length,
    totalDuties: TWO_STREAM_DUTY_COUNT,
    telemetry: Object.freeze(telemetry),
  };
}

async function driveTwoStreamAttentionBoundary(cooperative, options) {
  const {
    plan,
    encodeDuty,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = options;
  if (options.submitDuty != null) {
    throw new TypeError('submitDuty is unsupported: the kit owns queue.submit (>=0.1.41); encodeDuty must return the command buffer');
  }
  const gpu = cooperative.startBoundary(TWO_STREAM_ATTENTION_BOUNDARY_ID);
  const telemetry = [];

  for (const duty of plan) {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(
        `cooperative two-stream attention exhausted ranges before duty ${duty.dutyIndex}`,
      );
    }
    if (range.itemStart !== duty.dutyIndex || range.itemEnd !== duty.dutyIndex + 1) {
      throw new Error(
        `cooperative two-stream attention range ${range.itemStart}-${range.itemEnd} `
        + `does not match duty ${duty.dutyIndex}`,
      );
    }
    const timing = {
      dutyIndex: duty.dutyIndex,
      dutyId: duty.dutyId,
      kind: duty.kind,
      ownerId: duty.ownerId ?? null,
      tileIndex: duty.tileIndex ?? null,
      tileCount: duty.tileCount ?? null,
      rangeIndex: duty.rangeIndex ?? null,
      rangeCount: duty.rangeCount ?? null,
      rowStart: duty.rowStart ?? null,
      rowCount: duty.rowCount ?? null,
      rowEnd: duty.rowEnd ?? null,
      dutyStartedAtMs: now(),
      encodeStartedAtMs: null,
      encodeCompletedAtMs: null,
      submitStartedAtMs: null,
      submitCompletedAtMs: null,
      dutyCompletedAtMs: null,
      encodeMs: null,
      submitMs: null,
      dutyMs: null,
    };

    // kit >=0.1.41: encode returns the command buffer; the kit submits it.
    await gpu.runGpuDuty(range, {
      encode() {
        timing.encodeStartedAtMs = now();
        const commandBuffer = encodeDuty({ duty, range });
        timing.encodeCompletedAtMs = now();
        timing.encodeMs = timing.encodeCompletedAtMs - timing.encodeStartedAtMs;
        return commandBuffer;
      },
    });
    timing.dutyCompletedAtMs = now();
    timing.dutyMs = timing.dutyCompletedAtMs - timing.dutyStartedAtMs;
    telemetry.push(Object.freeze(timing));
  }

  if (gpu.nextRange() != null) {
    throw new Error('cooperative two-stream attention left ranges unconsumed');
  }
  return {
    completedDuties: telemetry.length,
    totalDuties: plan.length,
    telemetry: Object.freeze(telemetry),
  };
}

async function runCooperativeTwoStream(options) {
  const {
    device,
    backbone,
    imageTokensBuf,
    N_img,
    weights,
    schedulingMode = 'cooperative',
    dutyGranularity = 'stage',
    linearRowsPerDuty = 128,
    onProgress,
    signal,
    invocationId = `sf3d:two-stream:${schedulingMode}`,
  } = options;
  if (!['stage', 'attention-tile'].includes(dutyGranularity)) {
    throw new RangeError(`unknown two-stream duty granularity ${dutyGranularity}`);
  }
  const attentionPlan = dutyGranularity === 'attention-tile'
    ? createTwoStreamAttentionDutyPlan(N_img, { linearRowsPerDuty })
    : null;
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const queueFences = [];
  const browserYields = [];
  let activeStage = null;
  const runtime = createSf3dCooperativeRuntime(device, {
    foregroundOpportunities: options.foregroundOpportunities ?? null,
    onQueueFenceResolved(event) {
      queueFences.push(Object.freeze({ ...activeStage, ...event }));
    },
    onBrowserYield(event) {
      browserYields.push(Object.freeze({ ...activeStage, ...event }));
    },
  });
  const execution = createWebGpuCooperativeExecution({
    runtime,
    manifest: defineTwoStreamManifest({
      dutyGranularity,
      N_img,
      linearRowsPerDuty,
    }),
    invocationId,
    schedulingMode,
    onProgress,
    signal,
  });
  const state = attentionPlan
    ? backbone.createAttentionForwardState(
      imageTokensBuf,
      N_img,
      weights,
      { linearRowsPerDuty },
    )
    : backbone.createForwardState(imageTokensBuf, N_img, weights);
  let stageTelemetry = [];

  await execution.run(async cooperative => {
    const driven = attentionPlan
      ? await driveTwoStreamAttentionBoundary(cooperative, {
        plan: attentionPlan,
        now,
        encodeDuty({ duty }) {
          activeStage = {
            dutyIndex: duty.dutyIndex,
            dutyId: duty.dutyId,
            kind: duty.kind,
            ownerId: duty.ownerId ?? null,
            tileIndex: duty.tileIndex ?? null,
            tileCount: duty.tileCount ?? null,
            rangeIndex: duty.rangeIndex ?? null,
            rangeCount: duty.rangeCount ?? null,
            rowStart: duty.rowStart ?? null,
            rowCount: duty.rowCount ?? null,
            rowEnd: duty.rowEnd ?? null,
          };
          const encoder = device.createCommandEncoder({
            label: `two-stream-${duty.dutyIndex}-${duty.dutyId}`,
          });
          backbone.dispatchAttentionForwardDuty(encoder, state, duty.dutyIndex);
          return encoder.finish();
        },
      })
      : await driveTwoStreamBoundary(cooperative, {
        now,
        encodeStage({ stageIndex, stageId }) {
          activeStage = { stageIndex, stageId };
          const encoder = device.createCommandEncoder({
            label: `two-stream-${stageIndex}-${stageId}`,
          });
          backbone.dispatchForwardStage(encoder, state, stageIndex);
          return encoder.finish();
        },
      });
    stageTelemetry = driven.telemetry;
  });

  activeStage = null;
  const result = backbone.getForwardResult(state);
  return {
    result,
    report: Object.freeze({
      ...execution.finish(),
      adapterTelemetry: Object.freeze({
        dutyGranularity,
        declaredDutyCount: attentionPlan?.length ?? TWO_STREAM_DUTY_COUNT,
        stageDuties: Object.freeze(stageTelemetry),
        queueFences: Object.freeze(queueFences),
        browserYields: Object.freeze(browserYields),
      }),
    }),
  };
}

const conv2dWGSL = "// conv2d.wgsl — 2D convolution compute shader\n//\n// Standard conv2d with:\n//   - Arbitrary kernel size (1x1, 3x3, etc.)\n//   - Input tiling with halo in workgroup shared memory for 3x3\n//   - Replicate padding (matching PyTorch padding_mode='replicate')\n//   - Optional bias\n//   - Supports batched execution (one dispatch per output channel group)\n//\n// Memory layout (all NCHW, row-major):\n//   input:   [C_in, H, W]       — f32\n//   weight:  [C_out, C_in, kH, kW] — f32\n//   bias:    [C_out]             — f32\n//   output:  [C_out, H_out, W_out] — f32\n//\n// Uniforms:\n//   inC, inH, inW: input dimensions\n//   outC, outH, outW: output dimensions\n//   kH, kW: kernel size\n//   padH, padW: padding\n//   strideH, strideW: stride\n//   hasBias: 0 or 1\n\nstruct ConvParams {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  kH: u32,\n  kW: u32,\n  padH: u32,\n  padW: u32,\n  strideH: u32,\n  strideW: u32,\n  hasBias: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\n// Workgroup tile for output spatial positions\n// 16x16 output tile per workgroup\nconst TILE_W: u32 = 16;\nconst TILE_H: u32 = 16;\n\n@compute @workgroup_size(TILE_W, TILE_H, 1)\nfn conv2d_main(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n  @builtin(workgroup_id) wgid: vec3<u32>,\n) {\n  let outX = gid.x;\n  let outY = gid.y;\n  let outCh = wgid.z; // one output channel per z-workgroup\n\n  if (outX >= params.outW || outY >= params.outH || outCh >= params.outC) {\n    return;\n  }\n\n  var sum: f32 = 0.0;\n\n  // Loop over input channels and kernel\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    for (var ky: u32 = 0; ky < params.kH; ky++) {\n      for (var kx: u32 = 0; kx < params.kW; kx++) {\n        // Input coordinate with stride and padding\n        let inY_raw = i32(outY * params.strideH + ky) - i32(params.padH);\n        let inX_raw = i32(outX * params.strideW + kx) - i32(params.padW);\n\n        // Replicate padding: clamp to valid range\n        let inY = u32(clamp(inY_raw, 0, i32(params.inH) - 1));\n        let inX = u32(clamp(inX_raw, 0, i32(params.inW) - 1));\n\n        let inputIdx = ic * params.inH * params.inW + inY * params.inW + inX;\n        let weightIdx = outCh * params.inC * params.kH * params.kW\n                      + ic * params.kH * params.kW\n                      + ky * params.kW\n                      + kx;\n\n        sum += input[inputIdx] * weight[weightIdx];\n      }\n    }\n  }\n\n  // Add bias\n  if (params.hasBias != 0) {\n    sum += bias[outCh];\n  }\n\n  let outputIdx = outCh * params.outH * params.outW + outY * params.outW + outX;\n  output[outputIdx] = sum;\n}\n";

const conv2dChannelRangeWGSL = "// conv2d_channel_range.wgsl - exact output-channel range convolution\n\nstruct ConvRangeParams {\n  inC: u32,\n  inH: u32,\n  inW: u32,\n  outC: u32,\n  outH: u32,\n  outW: u32,\n  kH: u32,\n  kW: u32,\n  padH: u32,\n  padW: u32,\n  strideH: u32,\n  strideW: u32,\n  hasBias: u32,\n  channelStart: u32,\n  channelCount: u32,\n  applyRelu: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: ConvRangeParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read> weight: array<f32>;\n@group(0) @binding(3) var<storage, read> bias: array<f32>;\n@group(0) @binding(4) var<storage, read_write> output: array<f32>;\n\nconst TILE_W: u32 = 16;\nconst TILE_H: u32 = 16;\n\n@compute @workgroup_size(TILE_W, TILE_H, 1)\nfn conv2d_channel_range_main(\n  @builtin(global_invocation_id) gid: vec3<u32>,\n  @builtin(workgroup_id) wgid: vec3<u32>,\n) {\n  let outX = gid.x;\n  let outY = gid.y;\n  let localOutCh = wgid.z;\n  let outCh = params.channelStart + localOutCh;\n\n  if (\n    outX >= params.outW\n    || outY >= params.outH\n    || localOutCh >= params.channelCount\n    || outCh >= params.outC\n  ) {\n    return;\n  }\n\n  var sum: f32 = 0.0;\n  for (var ic: u32 = 0; ic < params.inC; ic++) {\n    for (var ky: u32 = 0; ky < params.kH; ky++) {\n      for (var kx: u32 = 0; kx < params.kW; kx++) {\n        let inYRaw = i32(outY * params.strideH + ky) - i32(params.padH);\n        let inXRaw = i32(outX * params.strideW + kx) - i32(params.padW);\n        let inY = u32(clamp(inYRaw, 0, i32(params.inH) - 1));\n        let inX = u32(clamp(inXRaw, 0, i32(params.inW) - 1));\n        let inputIndex = ic * params.inH * params.inW + inY * params.inW + inX;\n        let weightIndex = outCh * params.inC * params.kH * params.kW\n          + ic * params.kH * params.kW\n          + ky * params.kW\n          + kx;\n        sum += input[inputIndex] * weight[weightIndex];\n      }\n    }\n  }\n\n  if (params.hasBias != 0) {\n    sum += bias[outCh];\n  }\n  if (params.applyRelu != 0) {\n    sum = max(sum, 0.0);\n  }\n\n  let outputIndex = outCh * params.outH * params.outW + outY * params.outW + outX;\n  output[outputIndex] = sum;\n}\n";

const pixelshuffleWGSL = "// pixelshuffle.wgsl — PixelShuffle (sub-pixel convolution) compute shader\n//\n// Rearranges elements from [C*r*r, H, W] to [C, H*r, W*r]\n// where r is the upscale factor.\n//\n// This is the primary upsampling method in MoGe-2's ConvStack resamplers.\n// PyTorch: nn.PixelShuffle(scale_factor)\n//\n// Memory layout (CHW, row-major):\n//   input:   [C_in, H, W]          — where C_in = C_out * r * r\n//   output:  [C_out, H * r, W * r]\n\nstruct PixelShuffleParams {\n  inC: u32,      // C_in = C_out * r * r\n  inH: u32,\n  inW: u32,\n  outC: u32,     // C_out\n  scaleFactor: u32,  // r\n  numWorkgroupsX: u32,\n};\n\n@group(0) @binding(0) var<uniform> params: PixelShuffleParams;\n@group(0) @binding(1) var<storage, read> input: array<f32>;\n@group(0) @binding(2) var<storage, read_write> output: array<f32>;\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn pixelshuffle_main(\n  @builtin(workgroup_id) wgid: vec3<u32>,\n  @builtin(local_invocation_id) lid: vec3<u32>,\n) {\n  let outH = params.inH * params.scaleFactor;\n  let outW = params.inW * params.scaleFactor;\n  let totalOut = params.outC * outH * outW;\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  if (idx >= totalOut) {\n    return;\n  }\n\n  // Decompose output index\n  let outSpatial = outH * outW;\n  let oc = idx / outSpatial;\n  let rem = idx % outSpatial;\n  let oy = rem / outW;\n  let ox = rem % outW;\n\n  // Map to input coordinates\n  let r = params.scaleFactor;\n  let iy = oy / r;\n  let ix = ox / r;\n  let subY = oy % r;\n  let subX = ox % r;\n\n  // Input channel: oc * r * r + subY * r + subX\n  let ic = oc * r * r + subY * r + subX;\n  let inputIdx = ic * params.inH * params.inW + iy * params.inW + ix;\n\n  output[idx] = input[inputIdx];\n}\n";

/**
 * shader_ops.js — WebGPU compute dispatch wrappers for each shader.
 *
 * Each function creates a pipeline, binds buffers, and dispatches.
 * Pipelines are cached by device for reuse.
 */


const pipelineCache = new Map();
const uniformCache = new Map();
const MAX_WG_DIM = 65535;

function cachedUniform(device, data) {
  const bytes = new Uint8Array(data.buffer || data);
  let h = 0;
  for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
  const key = `u_${bytes.length}_${h}`;
  if (uniformCache.has(key)) return uniformCache.get(key);
  const buf = device.createBuffer({
    size: Math.max(bytes.byteLength, 16),
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint8Array(buf.getMappedRange()).set(bytes);
  buf.unmap();
  uniformCache.set(key, buf);
  return buf;
}

// Cache for dummy bias buffers (one per device)
let dummyBiasBuf = null;
function getDummyBias(device) {
  if (!dummyBiasBuf) {
    dummyBiasBuf = createStorageBuffer(device, new Float32Array([0]));
  }
  return dummyBiasBuf;
}

/**
 * Split a total workgroup count into 2D dispatch (x, y) to stay within limits.
 * Returns [wgX, wgY] where wgX * wgY >= totalWG and wgX <= MAX_WG_DIM.
 */
function splitWorkgroups(totalWG) {
  if (totalWG <= MAX_WG_DIM) return [totalWG, 1];
  const wgX = MAX_WG_DIM;
  const wgY = Math.ceil(totalWG / MAX_WG_DIM);
  return [wgX, wgY];
}

function getOrCreatePipeline(device, key, code, entryPoint) {
  if (pipelineCache.has(key)) return pipelineCache.get(key);
  const module = device.createShaderModule({ code });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint },
  });
  pipelineCache.set(key, pipeline);
  return pipeline;
}

function ceil(a, b) { return Math.ceil(a / b); }

/**
 * Dispatch conv2d (3x3 or arbitrary kernel).
 * Returns output buffer [outC, outH, outW].
 */
function dispatchConv2d(device, encoder, inputBuf, weightBuf, biasBuf, params) {
  const { inC, inH, inW, outC, kH, kW, padH, padW, strideH, strideW } = params;
  const outH = Math.floor((inH + 2 * padH - kH) / strideH) + 1;
  const outW = Math.floor((inW + 2 * padW - kW) / strideW) + 1;
  const hasBias = biasBuf ? 1 : 0;

  const pipeline = getOrCreatePipeline(device, 'conv2d', conv2dWGSL, 'conv2d_main');

  const uniformData = new Uint32Array([inC, inH, inW, outC, outH, outW, kH, kW, padH, padW, strideH, strideW, hasBias]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyBias = biasBuf || getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, outC * outH * outW * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(ceil(outW, 16), ceil(outH, 16), outC);
  pass.end();

  return { buffer: outputBuf, outC, outH, outW };
}

/**
 * Dispatch an exact output-channel range into a caller-owned Conv2d output.
 */
function dispatchConv2dChannelRange(
  device,
  encoder,
  inputBuf,
  weightBuf,
  biasBuf,
  outputBuf,
  params,
  range,
) {
  const {
    inC,
    inH,
    inW,
    outC,
    kH,
    kW,
    padH,
    padW,
    strideH,
    strideW,
  } = params;
  const { channelStart, channelCount } = range;
  if (!Number.isSafeInteger(channelStart) || channelStart < 0
      || !Number.isSafeInteger(channelCount) || channelCount <= 0
      || channelStart + channelCount > outC) {
    throw new RangeError(
      `invalid Conv2d output-channel range ${channelStart}+${channelCount}/${outC}`,
    );
  }
  const outH = Math.floor((inH + 2 * padH - kH) / strideH) + 1;
  const outW = Math.floor((inW + 2 * padW - kW) / strideW) + 1;
  const hasBias = biasBuf ? 1 : 0;
  const pipeline = getOrCreatePipeline(
    device,
    'conv2d-channel-range',
    conv2dChannelRangeWGSL,
    'conv2d_channel_range_main',
  );
  const uniformData = new Uint32Array([
    inC,
    inH,
    inW,
    outC,
    outH,
    outW,
    kH,
    kW,
    padH,
    padW,
    strideH,
    strideW,
    hasBias,
    channelStart,
    channelCount,
    params.applyRelu === true ? 1 : 0,
  ]);
  const uniformBuf = cachedUniform(device, uniformData);
  const dummyBias = biasBuf || getDummyBias(device);
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: weightBuf } },
      { binding: 3, resource: { buffer: dummyBias } },
      { binding: 4, resource: { buffer: outputBuf } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(ceil(outW, 16), ceil(outH, 16), channelCount);
  pass.end();
  return { buffer: outputBuf, outC, outH, outW };
}

/**
 * Dispatch element-wise activation.
 * op: 0=relu, 1=silu, 2=add, 3=add_relu, 4=sigmoid
 */
function dispatchActivation(device, encoder, inputA, inputB, count, op) {
  const pipeline = getOrCreatePipeline(device, 'activation', activationsWGSL, 'activation_main');

  const totalWG = ceil(count, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([count, op, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const dummyB = getDummyBias(device);
  const outputBuf = createEmptyBuffer(device, count * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputA } },
      { binding: 2, resource: { buffer: dummyB } },
      { binding: 3, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return outputBuf;
}

/**
 * Dispatch PixelShuffle.
 */
function dispatchPixelShuffle(device, encoder, inputBuf, params) {
  const { inC, inH, inW, scaleFactor } = params;
  const outC = inC / (scaleFactor * scaleFactor);
  const outH = inH * scaleFactor;
  const outW = inW * scaleFactor;

  const pipeline = getOrCreatePipeline(device, 'pixelshuffle', pixelshuffleWGSL, 'pixelshuffle_main');

  const totalWG = ceil(outC * outH * outW, 256);
  const [wgX, wgY] = splitWorkgroups(totalWG);
  const uniformData = new Uint32Array([inC, inH, inW, outC, scaleFactor, wgX]);
  const uniformBuf = cachedUniform(device, uniformData);

  const outputBuf = createEmptyBuffer(device, outC * outH * outW * 4);

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuf } },
      { binding: 1, resource: { buffer: inputBuf } },
      { binding: 2, resource: { buffer: outputBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();

  return { buffer: outputBuf, C: outC, H: outH, W: outW };
}

/**
 * post_processor.js — PixelShuffle upsampling network for SF3D triplane features.
 *
 * Architecture (from network.py PixelShuffleUpsampleNetwork):
 *   Input: [1024, 27648] channel-first triplane features from backbone
 *   Reshape to 3 planes: [3, 1024, 96, 96]
 *   Per-plane processing (shared weights):
 *     Conv2d(1024→1024, 3×3, pad=1) + ReLU  ×3
 *     Conv2d(1024→640, 3×3, pad=1)           (640 = 40 * 4²)
 *     PixelShuffle(4)                         → [40, 384, 384]
 *   Output: [3, 40, 384, 384] triplane feature planes
 */


const POST_CONFIG = {
  inChannels: 1024,
  outChannels: 40,
  scaleFactor: 4,
  convLayers: 4,
  planeSize: 96,
  // output_channels = out_channels * scale_factor² = 40 * 16 = 640
  lastConvOut: 640,
};

const POST_PROCESSOR_PLANE_STAGE_IDS = Object.freeze([
  'gather',
  'conv-0-relu',
  'conv-1-relu',
  'conv-2-relu',
  'conv-3',
  'pixel-shuffle-copy',
]);

const POST_PROCESSOR_CONV_OUTPUT_CHANNELS = Object.freeze([
  POST_CONFIG.inChannels,
  POST_CONFIG.inChannels,
  POST_CONFIG.inChannels,
  POST_CONFIG.lastConvOut,
]);

/**
 * Dispatch the post-processor for all 3 triplane planes.
 *
 * @param {GPUDevice} device
 * @param {GPUCommandEncoder} encoder
 * @param {GPUBuffer} triplanesBuf - [1024, 27648] channel-first backbone output
 * @param {Object} weights - post_processor weights from loadWeights
 * @returns {{ buffer: GPUBuffer, C: number, H: number, W: number }} - [3, 40, 384, 384]
 */
function createPostProcessorOutput(device) {
  const { outChannels, scaleFactor, planeSize } = POST_CONFIG;
  const outH = planeSize * scaleFactor; // 384
  const outW = planeSize * scaleFactor; // 384
  const outPlaneElements = outChannels * outH * outW;

  // Output buffer for all 3 planes: [3, 40, 384, 384]
  const outputBuf = createEmptyBuffer(device, 3 * outPlaneElements * 4);
  return {
    buffer: outputBuf,
    C: outChannels,
    H: outH,
    W: outW,
    numPlanes: 3,
  };
}

/**
 * Encode one dependency-independent triplane plane into a caller-owned output.
 *
 * The four convolutions inside a plane remain sequential and therefore stay in
 * one command buffer for this first cooperative cut. Different planes share
 * weights but no intermediate buffers, so command boundaries between planes do
 * not change numerical ordering or output layout.
 */
function dispatchPostProcessorPlane(
  device,
  encoder,
  triplanesBuf,
  weights,
  output,
  plane,
) {
  const state = createPostProcessorPlaneState(
    device,
    triplanesBuf,
    weights,
    output,
    plane,
  );
  for (let stageIndex = 0; stageIndex < POST_PROCESSOR_PLANE_STAGE_IDS.length; stageIndex++) {
    dispatchPostProcessorPlaneStage(device, encoder, state, stageIndex);
  }
}

/**
 * Create the persistent state that crosses command boundaries for one plane.
 *
 * Buffer allocation remains inside the stage that first produces each value,
 * so constructing state does not silently perform GPU work or front-load memory.
 */
function createPostProcessorPlaneState(
  device,
  triplanesBuf,
  weights,
  output,
  plane,
) {
  if (!Number.isSafeInteger(plane) || plane < 0 || plane >= 3) {
    throw new RangeError('postprocessor plane must be an integer in [0, 3)');
  }
  if (!device || !triplanesBuf || !weights || !output?.buffer) {
    throw new TypeError('postprocessor plane state requires device, input, weights, and output');
  }
  if (!Array.isArray(weights.convLayers) || weights.convLayers.length !== POST_CONFIG.convLayers) {
    throw new RangeError(`postprocessor requires exactly ${POST_CONFIG.convLayers} convolution layers`);
  }
  return {
    device,
    triplanesBuf,
    weights,
    output,
    plane,
    nextStageIndex: 0,
    channelStage: null,
    current: null,
    complete: false,
  };
}

/**
 * Encode one exact channel-plan duty for one plane.
 */
function dispatchPostProcessorChannelDuty(device, encoder, state, duty) {
  if (device !== state?.device) {
    throw new Error('postprocessor plane state belongs to a different GPUDevice');
  }
  if (!duty || duty.plane !== state.plane) {
    throw new Error(`postprocessor channel duty belongs to plane ${duty?.plane}`);
  }
  if (duty.kind === 'gather') {
    if (duty.stageIndex !== 0 || state.nextStageIndex !== 0 || state.channelStage) {
      throw new Error(`postprocessor plane ${state.plane} expected gather stage 0`);
    }
    return dispatchPostProcessorPlaneStage(device, encoder, state, 0);
  }
  if (duty.kind === 'pixel-shuffle-copy') {
    if (duty.stageIndex !== 5 || state.nextStageIndex !== 5 || state.channelStage) {
      throw new Error(`postprocessor plane ${state.plane} expected PixelShuffle stage 5`);
    }
    return dispatchPostProcessorPlaneStage(device, encoder, state, 5);
  }
  if (duty.kind !== 'conv-range') {
    throw new Error(`unsupported postprocessor channel duty kind ${duty.kind}`);
  }
  if (!Number.isSafeInteger(duty.stageIndex)
      || duty.stageIndex < 1
      || duty.stageIndex > 4
      || duty.stageIndex !== state.nextStageIndex) {
    throw new Error(
      `postprocessor plane ${state.plane} expected stage ${state.nextStageIndex}, `
      + `got ${duty.stageIndex}`,
    );
  }

  const layerIndex = duty.stageIndex - 1;
  const totalChannels = POST_PROCESSOR_CONV_OUTPUT_CHANNELS[layerIndex];
  const isLast = layerIndex === POST_CONFIG.convLayers - 1;
  if (duty.layerIndex !== layerIndex
      || duty.totalChannels !== totalChannels
      || !Number.isSafeInteger(duty.rangeIndex)
      || !Number.isSafeInteger(duty.rangeCount)
      || duty.rangeCount <= 0
      || !Number.isSafeInteger(duty.channelStart)
      || !Number.isSafeInteger(duty.channelCount)
      || duty.channelCount <= 0
      || duty.channelEnd !== duty.channelStart + duty.channelCount
      || duty.channelEnd > totalChannels) {
    throw new Error(`invalid postprocessor channel duty for ${duty.stageId}`);
  }

  if (!state.channelStage) {
    if (duty.rangeIndex !== 0 || duty.channelStart !== 0) {
      throw new Error(`postprocessor ${duty.stageId} must begin at output channel 0`);
    }
    const input = state.current;
    if (!input?.buffer) {
      throw new Error(`postprocessor ${duty.stageId} has no input buffer`);
    }
    const outH = Math.floor((input.outH + 2 - 3) / 1) + 1;
    const outW = Math.floor((input.outW + 2 - 3) / 1) + 1;
    const outputBuffer = createEmptyBuffer(device, totalChannels * outH * outW * 4);
    state.channelStage = {
      layerIndex,
      stageIndex: duty.stageIndex,
      stageId: duty.stageId,
      rangeCount: duty.rangeCount,
      nextRangeIndex: 0,
      nextChannelStart: 0,
      input,
      outputBuffer,
      outC: totalChannels,
      outH,
      outW,
    };
  }

  const active = state.channelStage;
  if (active.layerIndex !== layerIndex
      || active.stageIndex !== duty.stageIndex
      || active.stageId !== duty.stageId
      || active.rangeCount !== duty.rangeCount
      || duty.rangeIndex !== active.nextRangeIndex
      || duty.channelStart !== active.nextChannelStart) {
    throw new Error(
      `postprocessor ${duty.stageId} expected range ${active.nextRangeIndex} `
      + `at channel ${active.nextChannelStart}`,
    );
  }

  dispatchConv2dChannelRange(
    device,
    encoder,
    active.input.buffer,
    state.weights.convLayers[layerIndex].weight,
    state.weights.convLayers[layerIndex].bias,
    active.outputBuffer,
    {
      inC: active.input.outC,
      inH: active.input.outH,
      inW: active.input.outW,
      outC: totalChannels,
      kH: 3,
      kW: 3,
      padH: 1,
      padW: 1,
      strideH: 1,
      strideW: 1,
      applyRelu: !isLast,
    },
    {
      channelStart: duty.channelStart,
      channelCount: duty.channelCount,
    },
  );
  active.nextRangeIndex++;
  active.nextChannelStart = duty.channelEnd;
  const rangeComplete = active.nextRangeIndex === active.rangeCount;
  const channelsComplete = active.nextChannelStart === totalChannels;
  if (rangeComplete !== channelsComplete) {
    throw new Error(`postprocessor ${duty.stageId} range count disagrees with channel coverage`);
  }
  if (rangeComplete) {
    state.current = {
      buffer: active.outputBuffer,
      outC: totalChannels,
      outH: active.outH,
      outW: active.outW,
    };
    state.channelStage = null;
    state.nextStageIndex++;
  }
  return {
    plane: state.plane,
    stageIndex: duty.stageIndex,
    stageId: duty.stageId,
    rangeIndex: duty.rangeIndex,
    rangeCount: duty.rangeCount,
    channelStart: duty.channelStart,
    channelEnd: duty.channelEnd,
    complete: state.complete,
  };
}

/**
 * Encode one exact stage for one plane.
 *
 * The caller may invoke all stages into one encoder (legacy route) or finish
 * and submit after each stage (cooperative route). State enforces the dependency
 * order so skipped, repeated, or out-of-order command duties fail loud.
 */
function dispatchPostProcessorPlaneStage(device, encoder, state, stageIndex) {
  if (device !== state?.device) {
    throw new Error('postprocessor plane state belongs to a different GPUDevice');
  }
  if (!Number.isSafeInteger(stageIndex)
      || stageIndex < 0
      || stageIndex >= POST_PROCESSOR_PLANE_STAGE_IDS.length) {
    throw new RangeError(
      `postprocessor stage must be an integer in [0, ${POST_PROCESSOR_PLANE_STAGE_IDS.length})`,
    );
  }
  if (stageIndex !== state.nextStageIndex) {
    throw new Error(
      `postprocessor plane ${state.plane} expected stage ${state.nextStageIndex}, got ${stageIndex}`,
    );
  }

  const {
    inChannels,
    scaleFactor,
    planeSize,
    lastConvOut,
  } = POST_CONFIG;
  const planePixels = planeSize * planeSize;
  const planeElements = inChannels * planePixels;

  if (stageIndex === 0) {
    const planeBuf = createEmptyBuffer(device, planeElements * 4);
    _dispatchGatherPlane(
      device,
      encoder,
      state.triplanesBuf,
      planeBuf,
      inChannels,
      planeSize * planeSize * 3,
      state.plane * planePixels,
      planePixels,
    );
    state.current = {
      buffer: planeBuf,
      outC: inChannels,
      outH: planeSize,
      outW: planeSize,
    };
  } else if (stageIndex <= 4) {
    const layerIndex = stageIndex - 1;
    const isLast = layerIndex === POST_CONFIG.convLayers - 1;
    const curOutC = isLast ? lastConvOut : inChannels;
    const convResult = dispatchConv2d(
      device,
      encoder,
      state.current.buffer,
      state.weights.convLayers[layerIndex].weight,
      state.weights.convLayers[layerIndex].bias,
      {
        inC: state.current.outC,
        inH: state.current.outH,
        inW: state.current.outW,
        outC: curOutC,
        kH: 3,
        kW: 3,
        padH: 1,
        padW: 1,
        strideH: 1,
        strideW: 1,
      },
    );
    if (isLast) {
      state.current = {
        buffer: convResult.buffer,
        outC: curOutC,
        outH: convResult.outH,
        outW: convResult.outW,
      };
    } else {
      const reluBuf = dispatchActivation(
        device,
        encoder,
        convResult.buffer,
        null,
        curOutC * convResult.outH * convResult.outW,
        0,
      );
      state.current = {
        buffer: reluBuf,
        outC: curOutC,
        outH: convResult.outH,
        outW: convResult.outW,
      };
    }
  } else {
    const psResult = dispatchPixelShuffle(device, encoder, state.current.buffer, {
      inC: lastConvOut,
      inH: planeSize,
      inW: planeSize,
      scaleFactor,
    });
    const outPlaneElements = state.output.C * state.output.H * state.output.W;
    const outOffset = state.plane * outPlaneElements * 4;
    encoder.copyBufferToBuffer(
      psResult.buffer,
      0,
      state.output.buffer,
      outOffset,
      outPlaneElements * 4,
    );
    state.complete = true;
  }

  state.nextStageIndex++;
  return {
    plane: state.plane,
    stageIndex,
    stageId: POST_PROCESSOR_PLANE_STAGE_IDS[stageIndex],
    complete: state.complete,
  };
}

function dispatchPostProcessor(device, encoder, triplanesBuf, weights) {
  const output = createPostProcessorOutput(device);

  // Preserve the legacy route exactly: all three planes are still encoded into
  // the caller's one command encoder and submitted by the caller as one buffer.
  for (let plane = 0; plane < output.numPlanes; plane++) {
    dispatchPostProcessorPlane(device, encoder, triplanesBuf, weights, output, plane);
  }

  return output;
}

// --- Internal: gather one triplane plane from strided layout ---

let _gatherPipeline = null;

function _dispatchGatherPlane(device, encoder, srcBuf, dstBuf, numChannels, totalSpatial, spatialOffset, spatialSize) {
  // Gather: for each channel c and spatial index s in [0, spatialSize):
  //   dst[c * spatialSize + s] = src[c * totalSpatial + spatialOffset + s]
  if (!_gatherPipeline) {
    _gatherPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {
        module: device.createShaderModule({
          code: `
            struct P { numChannels: u32, totalSpatial: u32, spatialOffset: u32, spatialSize: u32, numWgX: u32 }
            @group(0) @binding(0) var<uniform> p: P;
            @group(0) @binding(1) var<storage, read> src: array<f32>;
            @group(0) @binding(2) var<storage, read_write> dst: array<f32>;
            @compute @workgroup_size(256)
            fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
              let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
              let total = p.numChannels * p.spatialSize;
              if (idx >= total) { return; }
              let c = idx / p.spatialSize;
              let s = idx % p.spatialSize;
              dst[c * p.spatialSize + s] = src[c * p.totalSpatial + p.spatialOffset + s];
            }
          `,
        }),
        entryPoint: 'main',
      },
    });
  }

  const total = numChannels * spatialSize;
  const totalWG = Math.ceil(total / 256);
  const wgX = Math.min(totalWG, 65535);
  const wgY = Math.ceil(totalWG / 65535);

  const params = device.createBuffer({
    size: 20,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  });
  new Uint32Array(params.getMappedRange()).set([numChannels, totalSpatial, spatialOffset, spatialSize, wgX]);
  params.unmap();

  const bg = device.createBindGroup({
    layout: _gatherPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: srcBuf } },
      { binding: 2, resource: { buffer: dstBuf } },
    ],
  });

  const pass = encoder.beginComputePass();
  pass.setPipeline(_gatherPipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();
}

/**
 * Cooperative SF3D PixelShuffle postprocessor.
 *
 * Each of the three triplane planes is independent. This module cuts the legacy
 * one-command-buffer postprocessor at those dependency-safe boundaries and
 * drives the resulting duties through the Kaminos cooperative execution facade.
 * The convolutions within each plane stay ordered inside one command buffer.
 */


const POST_PROCESSOR_MANIFEST_ID = 'sf3d.post-processor-cooperative-boundaries.v0';
const POST_PROCESSOR_BOUNDARY_ID = 'post-processor-triplane-planes';
const POST_PROCESSOR_PLANE_COUNT = 3;
const POST_PROCESSOR_LAYER_MANIFEST_ID =
  'sf3d.post-processor-layer-cooperative-boundaries.v0';
const POST_PROCESSOR_LAYER_BOUNDARY_ID = 'post-processor-triplane-stages';
const POST_PROCESSOR_CHANNEL_MANIFEST_ID =
  'sf3d.post-processor-channel-cooperative-boundaries.v0';
const POST_PROCESSOR_CHANNEL_BOUNDARY_ID =
  'post-processor-triplane-channel-ranges';
const POST_PROCESSOR_LAYER_DUTY_COUNT =
  POST_PROCESSOR_PLANE_COUNT * POST_PROCESSOR_PLANE_STAGE_IDS.length;

function buildPostProcessorChannelDutyPlan(channelsPerDuty) {
  const duties = [];
  for (let plane = 0; plane < POST_PROCESSOR_PLANE_COUNT; plane++) {
    duties.push({
      plane,
      kind: 'gather',
      stageIndex: 0,
      stageId: POST_PROCESSOR_PLANE_STAGE_IDS[0],
    });
    for (let layerIndex = 0; layerIndex < POST_PROCESSOR_CONV_OUTPUT_CHANNELS.length; layerIndex++) {
      const totalChannels = POST_PROCESSOR_CONV_OUTPUT_CHANNELS[layerIndex];
      const rangeCount = Math.ceil(totalChannels / channelsPerDuty);
      for (let rangeIndex = 0; rangeIndex < rangeCount; rangeIndex++) {
        const channelStart = rangeIndex * channelsPerDuty;
        const channelEnd = Math.min(totalChannels, channelStart + channelsPerDuty);
        duties.push({
          plane,
          kind: 'conv-range',
          stageIndex: layerIndex + 1,
          stageId: POST_PROCESSOR_PLANE_STAGE_IDS[layerIndex + 1],
          layerIndex,
          rangeIndex,
          rangeCount,
          channelStart,
          channelCount: channelEnd - channelStart,
          channelEnd,
          totalChannels,
        });
      }
    }
    duties.push({
      plane,
      kind: 'pixel-shuffle-copy',
      stageIndex: POST_PROCESSOR_PLANE_STAGE_IDS.length - 1,
      stageId: POST_PROCESSOR_PLANE_STAGE_IDS.at(-1),
    });
  }
  const totalDuties = duties.length;
  return Object.freeze({
    channelsPerDuty,
    duties: Object.freeze(duties.map((duty, dutyIndex) => Object.freeze({
      ...duty,
      dutyIndex,
      totalDuties,
      channelsPerDuty,
    }))),
  });
}

function createPostProcessorChannelDutyPlan(channelsPerDuty) {
  if (!Number.isSafeInteger(channelsPerDuty) || channelsPerDuty <= 0) {
    throw new TypeError('channelsPerDuty must be a positive safe integer');
  }
  return buildPostProcessorChannelDutyPlan(channelsPerDuty);
}

function requireExactPostProcessorChannelDutyPlan(plan) {
  if (!plan || !Number.isSafeInteger(plan.channelsPerDuty) || plan.channelsPerDuty <= 0
      || !Array.isArray(plan.duties)) {
    throw new TypeError('invalid postprocessor channel duty plan');
  }
  const expected = buildPostProcessorChannelDutyPlan(plan.channelsPerDuty);
  if (plan.duties.length !== expected.duties.length) {
    throw new Error('postprocessor channel duty plan has the wrong duty count');
  }
  for (let index = 0; index < expected.duties.length; index++) {
    const actualDuty = plan.duties[index];
    const expectedDuty = expected.duties[index];
    for (const key of Object.keys(expectedDuty)) {
      if (actualDuty?.[key] !== expectedDuty[key]) {
        throw new Error(
          `postprocessor channel duty plan mismatch at duty ${index} field ${key}`,
        );
      }
    }
  }
  return expected;
}

function definePostProcessorManifest(numPlanes = POST_PROCESSOR_PLANE_COUNT) {
  if (!Number.isSafeInteger(numPlanes) || numPlanes <= 0) {
    throw new TypeError('numPlanes must be a positive safe integer');
  }
  if (numPlanes !== POST_PROCESSOR_PLANE_COUNT) {
    throw new RangeError(`SF3D postprocessor must declare exactly ${POST_PROCESSOR_PLANE_COUNT} planes`);
  }
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: POST_PROCESSOR_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'triplane-post-processor',
        boundaries: [
          {
            boundaryId: POST_PROCESSOR_BOUNDARY_ID,
            kind: 'gpu-command',
            unit: 'triplane-plane',
            totalItems: numPlanes,
            progressWeight: numPlanes,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: 1 },
            yieldPolicy: 'after-duty',
            resources: {
              retain: ['triplane.low-resolution', 'post-processor.weights'],
              produce: ['triplane.high-resolution'],
              release: [],
            },
          },
        ],
      },
    ],
    metadata: { source: 'sf3d-webgpu-cooperative-post-processor' },
  });
}

function definePostProcessorLayerManifest() {
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: POST_PROCESSOR_LAYER_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'triplane-post-processor',
        boundaries: [
          {
            boundaryId: POST_PROCESSOR_LAYER_BOUNDARY_ID,
            kind: 'gpu-command',
            unit: 'post-processor-stage',
            totalItems: POST_PROCESSOR_LAYER_DUTY_COUNT,
            progressWeight: POST_PROCESSOR_LAYER_DUTY_COUNT,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: 1 },
            yieldPolicy: 'after-duty',
            resources: {
              retain: [
                'triplane.low-resolution',
                'post-processor.weights',
                'post-processor.intermediates',
              ],
              produce: ['triplane.high-resolution'],
              release: [],
            },
          },
        ],
      },
    ],
    metadata: { source: 'sf3d-webgpu-cooperative-post-processor-layers' },
  });
}

function definePostProcessorChannelManifest(channelsPerDuty) {
  const plan = createPostProcessorChannelDutyPlan(channelsPerDuty);
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: POST_PROCESSOR_CHANNEL_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'triplane-post-processor',
        boundaries: [
          {
            boundaryId: POST_PROCESSOR_CHANNEL_BOUNDARY_ID,
            kind: 'gpu-command',
            unit: 'post-processor-channel-duty',
            totalItems: plan.duties.length,
            progressWeight: plan.duties.length,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: 1 },
            yieldPolicy: 'after-duty',
            resources: {
              retain: [
                'triplane.low-resolution',
                'post-processor.weights',
                'post-processor.intermediates',
              ],
              produce: ['triplane.high-resolution'],
              release: [],
            },
            metadata: { channelsPerDuty },
          },
        ],
      },
    ],
    metadata: {
      source: 'sf3d-webgpu-cooperative-post-processor-channels',
      channelsPerDuty,
    },
  });
}

/**
 * Shared boundary driver used by production and deterministic tests.
 */
async function drivePostProcessorCooperativeBoundary(cooperative, options) {
  const {
    numPlanes = POST_PROCESSOR_PLANE_COUNT,
    encodePlane,
  } = options;
  const gpu = cooperative.startBoundary(POST_PROCESSOR_BOUNDARY_ID);
  let completedPlanes = 0;

  for (let plane = 0; plane < numPlanes; plane++) {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(`cooperative postprocessor exhausted ranges before plane ${plane}`);
    }
    if (range.itemStart !== plane || range.itemEnd !== plane + 1) {
      throw new Error(
        `cooperative postprocessor range ${range.itemStart}-${range.itemEnd} does not match plane ${plane}`,
      );
    }
    // kit >=0.1.41: encode returns the command buffer(s); the kit owns queue
    // submission (submit callbacks are unsupported so bounded-prefix can track
    // in-flight duties). Byte-identical: same command buffer, same queue order.
    await gpu.runGpuDuty(range, {
      encode: () => encodePlane({ plane, range }),
    });
    completedPlanes++;
  }

  if (gpu.nextRange() != null) {
    throw new Error('cooperative postprocessor left ranges unconsumed');
  }
  return { completedPlanes, totalPlanes: numPlanes };
}

async function drivePostProcessorLayerBoundary(cooperative, options) {
  const {
    encodeStage,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = options;
  const gpu = cooperative.startBoundary(POST_PROCESSOR_LAYER_BOUNDARY_ID);
  const telemetry = [];

  for (let dutyIndex = 0; dutyIndex < POST_PROCESSOR_LAYER_DUTY_COUNT; dutyIndex++) {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(`cooperative postprocessor exhausted ranges before duty ${dutyIndex}`);
    }
    if (range.itemStart !== dutyIndex || range.itemEnd !== dutyIndex + 1) {
      throw new Error(
        `cooperative postprocessor range ${range.itemStart}-${range.itemEnd} `
        + `does not match duty ${dutyIndex}`,
      );
    }
    const plane = Math.floor(dutyIndex / POST_PROCESSOR_PLANE_STAGE_IDS.length);
    const stageIndex = dutyIndex % POST_PROCESSOR_PLANE_STAGE_IDS.length;
    const stageId = POST_PROCESSOR_PLANE_STAGE_IDS[stageIndex];
    const timing = {
      dutyIndex,
      plane,
      stageIndex,
      stageId,
      dutyStartedAtMs: now(),
      encodeStartedAtMs: null,
      encodeCompletedAtMs: null,
      submitStartedAtMs: null,
      submitCompletedAtMs: null,
      dutyCompletedAtMs: null,
      encodeMs: null,
      submitMs: null,
      dutyMs: null,
    };

    // kit >=0.1.41: encode returns the command buffer; the kit submits it. The
    // per-duty submit interval is now kit-owned (submit* timing stays null); the
    // trivial queue.submit call it previously measured is captured by the kit's
    // own settlement telemetry. encode + duty timing are preserved.
    await gpu.runGpuDuty(range, {
      encode: () => {
        timing.encodeStartedAtMs = now();
        const commandBuffer = encodeStage({
          dutyIndex,
          plane,
          stageIndex,
          stageId,
          range,
        });
        timing.encodeCompletedAtMs = now();
        timing.encodeMs = timing.encodeCompletedAtMs - timing.encodeStartedAtMs;
        return commandBuffer;
      },
    });
    timing.dutyCompletedAtMs = now();
    timing.dutyMs = timing.dutyCompletedAtMs - timing.dutyStartedAtMs;
    telemetry.push(Object.freeze(timing));
  }

  if (gpu.nextRange() != null) {
    throw new Error('cooperative postprocessor left ranges unconsumed');
  }
  return {
    completedDuties: telemetry.length,
    totalDuties: POST_PROCESSOR_LAYER_DUTY_COUNT,
    telemetry: Object.freeze(telemetry),
  };
}

async function drivePostProcessorChannelBoundary(cooperative, options) {
  const {
    plan: suppliedPlan,
    encodeDuty,
    now = () => globalThis.performance?.now?.() ?? Date.now(),
  } = options;
  const plan = requireExactPostProcessorChannelDutyPlan(suppliedPlan);
  const gpu = cooperative.startBoundary(POST_PROCESSOR_CHANNEL_BOUNDARY_ID);
  const telemetry = [];

  for (const duty of plan.duties) {
    const range = gpu.nextRange();
    if (!range) {
      throw new Error(
        `cooperative postprocessor exhausted ranges before channel duty ${duty.dutyIndex}`,
      );
    }
    if (range.itemStart !== duty.dutyIndex || range.itemEnd !== duty.dutyIndex + 1) {
      throw new Error(
        `cooperative postprocessor range ${range.itemStart}-${range.itemEnd} `
        + `does not match channel duty ${duty.dutyIndex}`,
      );
    }
    const timing = {
      ...duty,
      dutyStartedAtMs: now(),
      encodeStartedAtMs: null,
      encodeCompletedAtMs: null,
      submitStartedAtMs: null,
      submitCompletedAtMs: null,
      dutyCompletedAtMs: null,
      encodeMs: null,
      submitMs: null,
      dutyMs: null,
    };
    // kit >=0.1.41: encode returns the command buffer; the kit submits it (submit
    // callbacks unsupported so bounded-prefix can own in-flight tracking). This
    // is the boundary bounded-prefix actually applies to. Byte-identical output.
    await gpu.runGpuDuty(range, {
      encode: () => {
        timing.encodeStartedAtMs = now();
        const commandBuffer = encodeDuty(duty, range);
        timing.encodeCompletedAtMs = now();
        timing.encodeMs = timing.encodeCompletedAtMs - timing.encodeStartedAtMs;
        return commandBuffer;
      },
    });
    timing.dutyCompletedAtMs = now();
    timing.dutyMs = timing.dutyCompletedAtMs - timing.dutyStartedAtMs;
    telemetry.push(Object.freeze(timing));
  }
  if (gpu.nextRange() != null) {
    throw new Error('cooperative postprocessor left channel ranges unconsumed');
  }
  return {
    completedDuties: telemetry.length,
    totalDuties: plan.duties.length,
    telemetry: Object.freeze(telemetry),
  };
}

async function runCooperativePostProcessor(options) {
  const {
    device,
    triplanesBuf,
    weights,
    schedulingMode = 'cooperative',
    dutyGranularity = 'plane',
    channelsPerDuty = 16,
    onProgress,
    signal,
    invocationId = `sf3d:post-processor:${schedulingMode}`,
    // Bounded-prefix completion (kit >=0.1.41): allow up to maxInFlightGpuDuties
    // GPU duties to be in flight before the facade fences a prefix, instead of
    // strict per-duty prefix fencing. Default null → strict-prefix (unchanged).
    // Per Cranial's composition contract, bounded-prefix is opt-in ONLY on the
    // fixed postprocessor channel-range boundary; plane/layer/adaptive stay
    // strict. The kit itself also rejects bounded-prefix on adaptive boundaries
    // and outside cooperative scheduling.
    completionPolicy = 'strict-prefix',
    maxInFlightGpuDuties = null,
  } = options;
  if (!['plane', 'layer', 'channel-range'].includes(dutyGranularity)) {
    throw new RangeError(`unsupported postprocessor duty granularity: ${dutyGranularity}`);
  }
  if (!Number.isSafeInteger(channelsPerDuty) || channelsPerDuty <= 0) {
    throw new TypeError('channelsPerDuty must be a positive safe integer');
  }
  if (!['strict-prefix', 'bounded-prefix'].includes(completionPolicy)) {
    throw new RangeError(`completionPolicy must be strict-prefix or bounded-prefix; got ${completionPolicy}`);
  }
  if (completionPolicy === 'bounded-prefix') {
    // Bounded-prefix is only lawful on the fixed channel-range boundary under
    // cooperative scheduling (Cranial contract + kit constraint). Fail loud
    // rather than silently downgrade.
    if (dutyGranularity !== 'channel-range') {
      throw new RangeError(`bounded-prefix completion is only supported for channel-range duties; got ${dutyGranularity}`);
    }
    if (schedulingMode !== 'cooperative') {
      throw new RangeError('bounded-prefix completion requires cooperative scheduling');
    }
    if (!Number.isSafeInteger(maxInFlightGpuDuties) || maxInFlightGpuDuties <= 0) {
      throw new TypeError('bounded-prefix completion requires a positive maxInFlightGpuDuties');
    }
  } else if (maxInFlightGpuDuties != null) {
    throw new TypeError('maxInFlightGpuDuties is available only with bounded-prefix completion');
  }
  const channelPlan = dutyGranularity === 'channel-range'
    ? createPostProcessorChannelDutyPlan(channelsPerDuty)
    : null;
  const manifest = dutyGranularity === 'channel-range'
    ? definePostProcessorChannelManifest(channelsPerDuty)
    : dutyGranularity === 'layer'
      ? definePostProcessorLayerManifest()
      : definePostProcessorManifest();
  const queueFences = [];
  const browserYields = [];
  const runtime = createSf3dCooperativeRuntime(device, {
    foregroundOpportunities: options.foregroundOpportunities ?? null,
    onQueueFenceResolved: event => queueFences.push(Object.freeze({ ...event })),
    onBrowserYield: event => browserYields.push(Object.freeze({ ...event })),
  });
  const execution = createWebGpuCooperativeExecution({
    runtime,
    manifest,
    invocationId,
    schedulingMode,
    onProgress,
    signal,
    // Only the fixed channel-range boundary carries bounded-prefix; all other
    // granularities and the default keep strict-prefix (the kit rejects
    // bounded-prefix on adaptive boundaries regardless).
    completionPolicy,
    ...(completionPolicy === 'bounded-prefix' ? { maxInFlightGpuDuties } : {}),
  });
  const output = createPostProcessorOutput(device);
  let dutyTelemetry = [];

  await execution.run(async (cooperative) => {
    if (dutyGranularity === 'channel-range') {
      const planeStates = Array(output.numPlanes).fill(null);
      const driven = await drivePostProcessorChannelBoundary(cooperative, {
        plan: channelPlan,
        encodeDuty(duty) {
          if (!planeStates[duty.plane]) {
            planeStates[duty.plane] = createPostProcessorPlaneState(
              device,
              triplanesBuf,
              weights,
              output,
              duty.plane,
            );
          }
          const encoder = device.createCommandEncoder({
            label: `post-processor-plane-${duty.plane}-${duty.stageId}`
              + (duty.kind === 'conv-range' ? `-${duty.rangeIndex}` : ''),
          });
          dispatchPostProcessorChannelDuty(
            device,
            encoder,
            planeStates[duty.plane],
            duty,
          );
          return encoder.finish();
        },
      });
      dutyTelemetry = driven.telemetry;
      return;
    }
    if (dutyGranularity === 'layer') {
      const planeStates = Array(output.numPlanes).fill(null);
      const driven = await drivePostProcessorLayerBoundary(cooperative, {
        encodeStage({ plane, stageIndex, stageId }) {
          if (!planeStates[plane]) {
            planeStates[plane] = createPostProcessorPlaneState(
              device,
              triplanesBuf,
              weights,
              output,
              plane,
            );
          }
          const encoder = device.createCommandEncoder({
            label: `post-processor-plane-${plane}-${stageId}`,
          });
          dispatchPostProcessorPlaneStage(
            device,
            encoder,
            planeStates[plane],
            stageIndex,
          );
          return encoder.finish();
        },
      });
      dutyTelemetry = driven.telemetry;
      return;
    }

    await drivePostProcessorCooperativeBoundary(cooperative, {
      numPlanes: output.numPlanes,
      encodePlane({ plane }) {
        const encoder = device.createCommandEncoder({
          label: `post-processor-plane-${plane}`,
        });
        dispatchPostProcessorPlane(
          device,
          encoder,
          triplanesBuf,
          weights,
          output,
          plane,
        );
        return encoder.finish();
      },
    });
  });

  const report = execution.finish();
  return {
    result: output,
    report: Object.freeze({
      ...report,
      adapterTelemetry: Object.freeze({
        dutyGranularity,
        channelsPerDuty: dutyGranularity === 'channel-range' ? channelsPerDuty : null,
        stageDuties: Object.freeze(dutyTelemetry),
        queueFences: Object.freeze(queueFences),
        browserYields: Object.freeze(browserYields),
      }),
    }),
  };
}

const gridSampleWGSL = "/**\n * Grid sample (bilinear) compute shader.\n *\n * Implements torch.nn.functional.grid_sample with:\n *   - mode='bilinear'\n *   - align_corners=True\n *   - padding_mode='zeros' (out-of-bound → 0)\n *\n * Used for SF3D's triplane query: sample features from 3 planes at\n * arbitrary 2D coordinates derived from 3D positions.\n *\n * Input feature map: [C, H, W]\n * Grid coordinates: [N, 2] (normalized [-1, 1])\n * Output: [N, C]\n */\n\nstruct Params {\n  C: u32,    // channels\n  H: u32,    // input height\n  W: u32,    // input width\n  N: u32,    // number of sample points\n  numWorkgroupsX: u32,\n}\n\n@group(0) @binding(0) var<uniform> params: Params;\n@group(0) @binding(1) var<storage, read> input: array<f32>;   // [C, H, W]\n@group(0) @binding(2) var<storage, read> grid: array<f32>;    // [N, 2] (x, y in [-1, 1])\n@group(0) @binding(3) var<storage, read_write> output: array<f32>; // [N, C]\n\nconst WG_SIZE: u32 = 256;\n\n@compute @workgroup_size(WG_SIZE)\nfn grid_sample_main(@builtin(global_invocation_id) gid: vec3<u32>,\n                    @builtin(workgroup_id) wgid: vec3<u32>,\n                    @builtin(local_invocation_id) lid: vec3<u32>) {\n  let linearWG = wgid.x + wgid.y * params.numWorkgroupsX;\n  let idx = linearWG * WG_SIZE + lid.x;\n\n  let total = params.N * params.C;\n  if (idx >= total) { return; }\n\n  let n = idx / params.C;\n  let c = idx % params.C;\n\n  // Grid coordinates in [-1, 1], align_corners=True:\n  // pixel = (grid + 1) / 2 * (size - 1)\n  let gx = grid[n * 2];\n  let gy = grid[n * 2 + 1];\n\n  let px = (gx + 1.0) * 0.5 * f32(params.W - 1);\n  let py = (gy + 1.0) * 0.5 * f32(params.H - 1);\n\n  let x0 = i32(floor(px));\n  let y0 = i32(floor(py));\n  let x1 = x0 + 1;\n  let y1 = y0 + 1;\n\n  let fx = px - f32(x0);\n  let fy = py - f32(y0);\n\n  let H = i32(params.H);\n  let W = i32(params.W);\n\n  // Sample 4 corners with bounds checking (zeros padding)\n  var v00: f32 = 0.0;\n  var v01: f32 = 0.0;\n  var v10: f32 = 0.0;\n  var v11: f32 = 0.0;\n\n  if (x0 >= 0 && x0 < W && y0 >= 0 && y0 < H) {\n    v00 = input[c * params.H * params.W + u32(y0) * params.W + u32(x0)];\n  }\n  if (x1 >= 0 && x1 < W && y0 >= 0 && y0 < H) {\n    v01 = input[c * params.H * params.W + u32(y0) * params.W + u32(x1)];\n  }\n  if (x0 >= 0 && x0 < W && y1 >= 0 && y1 < H) {\n    v10 = input[c * params.H * params.W + u32(y1) * params.W + u32(x0)];\n  }\n  if (x1 >= 0 && x1 < W && y1 >= 0 && y1 < H) {\n    v11 = input[c * params.H * params.W + u32(y1) * params.W + u32(x1)];\n  }\n\n  // Bilinear interpolation\n  let top = v00 * (1.0 - fx) + v01 * fx;\n  let bot = v10 * (1.0 - fx) + v11 * fx;\n  let result = top * (1.0 - fy) + bot * fy;\n\n  // Output layout: [N, C]\n  output[n * params.C + c] = result;\n}\n";

/**
 * triplane_decoder.js — Triplane query and MaterialMLP decoder for SF3D.
 *
 * Triplane query (from system.py query_triplane):
 *   For each 3D point [x, y, z]:
 *     - Project onto XY plane → sample features[0] at (x, y) → [40]
 *     - Project onto XZ plane → sample features[1] at (x, z) → [40]
 *     - Project onto YZ plane → sample features[2] at (y, z) → [40]
 *     - Concatenate → [120]
 *
 * MaterialMLP decoder (from network.py MaterialMLP):
 *   in_channels: 120, n_neurons: 64, activation: silu
 *   Heads:
 *     density:        Linear(120→64)+SiLU, Linear(64→64)+SiLU, Linear(64→1)  + bias(-1) + trunc_exp
 *     features:       Linear(120→64)+SiLU, Linear(64→64)+SiLU, Linear(64→64)+SiLU, Linear(64→3) + sigmoid
 *     perturb_normal: Linear(120→64)+SiLU, Linear(64→64)+SiLU, Linear(64→64)+SiLU, Linear(64→3) + normalize
 *     vertex_offset:  Linear(120→64)+SiLU, Linear(64→64)+SiLU, Linear(64→3)
 */


const WG_SIZE$1 = 256;
const MAX_WG = 65535;
function splitWG$1(total) {
  if (total <= MAX_WG) return [total, 1];
  return [MAX_WG, Math.ceil(total / MAX_WG)];
}
function ceilDiv$1(a, b) { return Math.ceil(a / b); }

const DECODER_CONFIG = {
  inChannels: 120,   // 3 planes × 40 features
  nNeurons: 64,
  planeChannels: 40,
  radius: 0.87};

class TriplaneDecoder {
  constructor(device) {
    this.device = device;
    this.pipelines = {};
    this._uniformCache = new Map();
    // Optional scratch-slot provider. When set (during an arena-backed decode),
    // _alloc(slotKey, size) returns a reusable pre-allocated buffer bound to that
    // stable slot key instead of allocating a fresh transient buffer. Default
    // null → createEmptyBuffer (unchanged behavior). Slot keys are deterministic
    // per decode call site (+ plane/head/layer index), which is exactly the
    // reusable slot graph the arena is proven against.
    this._slotProvider = null;
  }

  /**
   * Allocate (or reuse) a scratch buffer for a decode dispatch.
   * @param {string} slotKey  stable slot identity (arena binding key)
   * @param {number} size     byte size needed for this range's N
   */
  _alloc(slotKey, size) {
    if (this._slotProvider) return this._slotProvider.acquire(slotKey, size);
    // Pass the slot key as the buffer label so allocation capture records slot
    // identity (the arena binding key), not just the byte size.
    return createEmptyBuffer(this.device, size, 0, slotKey);
  }

  init() {
    const device = this.device;
    const make = (code, entry) => device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code }), entryPoint: entry },
    });

    this.pipelines.gridSample = make(gridSampleWGSL, 'grid_sample_main');
    this.pipelines.linear = make(linearWGSL, 'main');
    this.pipelines.activation = make(activationsWGSL, 'activation_main');

    // Concat 3 sampled planes: [N, 40] × 3 → [N, 120]
    this.pipelines.concatPlanes = make(`
      struct P { N: u32, C: u32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read> plane0: array<f32>;
      @group(0) @binding(2) var<storage, read> plane1: array<f32>;
      @group(0) @binding(3) var<storage, read> plane2: array<f32>;
      @group(0) @binding(4) var<storage, read_write> output: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        let total = p.N * p.C * 3u;
        if (idx >= total) { return; }
        let n = idx / (p.C * 3u);
        let rem = idx % (p.C * 3u);
        let planeIdx = rem / p.C;
        let c = rem % p.C;
        let srcIdx = n * p.C + c;
        switch planeIdx {
          case 0u: { output[idx] = plane0[srcIdx]; }
          case 1u: { output[idx] = plane1[srcIdx]; }
          case 2u: { output[idx] = plane2[srcIdx]; }
          default: {}
        }
      }
    `, 'main');

    // trunc_exp: output = exp(input)
    // normalize_channel_last: output[n, :] = input[n, :] / ||input[n, :]||
    // These are small enough to use inline shaders
    this.pipelines.truncExp = make(`
      struct P { count: u32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read> input: array<f32>;
      @group(0) @binding(2) var<storage, read_write> output: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.count) { return; }
        output[idx] = exp(input[idx]);
      }
    `, 'main');

    this.pipelines.sigmoid = make(`
      struct P { count: u32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read> input: array<f32>;
      @group(0) @binding(2) var<storage, read_write> output: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.count) { return; }
        output[idx] = 1.0 / (1.0 + exp(-input[idx]));
      }
    `, 'main');

    this.pipelines.normalize3 = make(`
      struct P { N: u32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read> input: array<f32>;
      @group(0) @binding(2) var<storage, read_write> output: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.N) { return; }
        let base = idx * 3u;
        let x = input[base]; let y = input[base + 1]; let z = input[base + 2];
        let len = sqrt(x*x + y*y + z*z) + 1e-8;
        output[base] = x / len;
        output[base + 1] = y / len;
        output[base + 2] = z / len;
      }
    `, 'main');

    // Add bias (scalar broadcast to all elements)
    this.pipelines.addBias = make(`
      struct P { count: u32, bias: f32, numWgX: u32 }
      @group(0) @binding(0) var<uniform> p: P;
      @group(0) @binding(1) var<storage, read_write> data: array<f32>;
      @compute @workgroup_size(256)
      fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
        let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
        if (idx >= p.count) { return; }
        data[idx] = data[idx] + p.bias;
      }
    `, 'main');
  }

  _cachedUniform(data) {
    const bytes = new Uint8Array(data.buffer || data);
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (h * 31 + bytes[i]) | 0;
    const key = `td_${bytes.length}_${h}`;
    if (this._uniformCache.has(key)) return this._uniformCache.get(key);
    const buf = this.device.createBuffer({
      size: Math.max(bytes.byteLength, 16),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint8Array(buf.getMappedRange()).set(bytes);
    buf.unmap();
    this._uniformCache.set(key, buf);
    return buf;
  }

  /**
   * Query triplane features at 3D positions and decode with MaterialMLP.
   *
   * @param {GPUCommandEncoder} encoder
   * @param {GPUBuffer} positionsBuf - [N, 3] query positions in model space
   * @param {GPUBuffer} triplanesBuf - [3, 40, 384, 384] from post-processor
   * @param {number} N - number of query points
   * @param {Object} weights - decoder weights
   * @param {string[]} heads - which heads to run (default: all)
   * @returns {Object} - { density, features, perturb_normal, vertex_offset } buffers
   */
  decode(encoder, positionsBuf, triplanesBuf, N, weights, heads) {
    this.device;
    const C = DECODER_CONFIG.planeChannels; // 40
    const H = 384, W = 384;
    const radius = DECODER_CONFIG.radius;

    // 1. Scale positions from model space to [-1, 1] for grid_sample
    //    PyTorch: scale_tensor(positions, (-radius, radius), (-1, 1))
    //    → pos_norm = pos / radius
    const scaledPosBuf = this._dispatchScalePositions(encoder, positionsBuf, N, radius, 'scaledPos');

    // 2. Create grid coordinates for each plane
    //    XY plane: (x, y), XZ plane: (x, z), YZ plane: (y, z)
    const gridXY = this._dispatchExtractGrid(encoder, scaledPosBuf, N, 0, 1, 'grid:XY'); // x, y
    const gridXZ = this._dispatchExtractGrid(encoder, scaledPosBuf, N, 0, 2, 'grid:XZ'); // x, z
    const gridYZ = this._dispatchExtractGrid(encoder, scaledPosBuf, N, 1, 2, 'grid:YZ'); // y, z

    // 3. Grid sample each plane
    const planeSize = C * H * W * 4; // bytes per plane
    const sampledXY = this._dispatchGridSample(encoder, triplanesBuf, 0, gridXY, C, H, W, N, 'sampled:XY');
    const sampledXZ = this._dispatchGridSample(encoder, triplanesBuf, planeSize, gridXZ, C, H, W, N, 'sampled:XZ');
    const sampledYZ = this._dispatchGridSample(encoder, triplanesBuf, planeSize * 2, gridYZ, C, H, W, N, 'sampled:YZ');

    // 4. Concatenate: [N, 40] × 3 → [N, 120]
    const featuresBuf = this._dispatchConcatPlanes(encoder, sampledXY, sampledXZ, sampledYZ, N, C, 'concatFeatures');

    // 5. Run MLP heads
    const results = {};
    const headsToRun = heads || ['density', 'features', 'perturb_normal', 'vertex_offset'];

    for (const headName of headsToRun) {
      const headLayers = weights.heads[headName];
      results[headName] = this._dispatchMLPHead(encoder, featuresBuf, headLayers, N, headName);
    }

    return results;
  }

  // --- Scale positions: pos / radius ---
  _dispatchScalePositions(encoder, posBuf, N, radius, slotKey = 'scaledPos') {
    if (!this.pipelines.scalePos) {
      this.pipelines.scalePos = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({
            code: `
              struct P { count: u32, invRadius: f32, numWgX: u32 }
              @group(0) @binding(0) var<uniform> p: P;
              @group(0) @binding(1) var<storage, read> input: array<f32>;
              @group(0) @binding(2) var<storage, read_write> output: array<f32>;
              @compute @workgroup_size(256)
              fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
                let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
                if (idx >= p.count) { return; }
                output[idx] = input[idx] * p.invRadius;
              }
            `,
          }),
          entryPoint: 'main',
        },
      });
    }

    const count = N * 3;
    const totalWG = ceilDiv$1(count, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const paramsData = new ArrayBuffer(12);
    const u32 = new Uint32Array(paramsData);
    const f32 = new Float32Array(paramsData);
    u32[0] = count; f32[1] = 1.0 / radius; u32[2] = wgX;
    const params = this._cachedUniform(new Uint8Array(paramsData));

    const outBuf = this._alloc(slotKey, count * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.scalePos.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: posBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.scalePos);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  // --- Extract 2D grid from 3D positions ---
  _dispatchExtractGrid(encoder, posBuf, N, dim0, dim1, slotKey = 'grid') {
    if (!this.pipelines.extractGrid) {
      this.pipelines.extractGrid = this.device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: this.device.createShaderModule({
            code: `
              struct P { N: u32, dim0: u32, dim1: u32, numWgX: u32 }
              @group(0) @binding(0) var<uniform> p: P;
              @group(0) @binding(1) var<storage, read> positions: array<f32>;
              @group(0) @binding(2) var<storage, read_write> grid: array<f32>;
              @compute @workgroup_size(256)
              fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
                let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
                if (idx >= p.N) { return; }
                grid[idx * 2] = positions[idx * 3 + p.dim0];
                grid[idx * 2 + 1] = positions[idx * 3 + p.dim1];
              }
            `,
          }),
          entryPoint: 'main',
        },
      });
    }

    const totalWG = ceilDiv$1(N, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([N, dim0, dim1, wgX]));
    const gridBuf = this._alloc(slotKey, N * 2 * 4);

    const bg = this.device.createBindGroup({
      layout: this.pipelines.extractGrid.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: posBuf } },
        { binding: 2, resource: { buffer: gridBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.extractGrid);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return gridBuf;
  }

  // --- Grid sample from one triplane plane ---
  _dispatchGridSample(encoder, triplanesBuf, planeOffsetBytes, gridBuf, C, H, W, N, slotKey = 'sampled') {
    const totalWG = ceilDiv$1(N * C, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([C, H, W, N, wgX]));

    const outBuf = this._alloc(slotKey, N * C * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.gridSample.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: triplanesBuf, offset: planeOffsetBytes, size: C * H * W * 4 } },
        { binding: 2, resource: { buffer: gridBuf } },
        { binding: 3, resource: { buffer: outBuf } },
      ],
    });

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.gridSample);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  // --- Concat 3 planes → [N, 120] ---
  _dispatchConcatPlanes(encoder, plane0, plane1, plane2, N, C, slotKey = 'concatFeatures') {
    const total = N * C * 3;
    const totalWG = ceilDiv$1(total, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([N, C, wgX]));

    const outBuf = this._alloc(slotKey, total * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.concatPlanes.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: plane0 } },
        { binding: 2, resource: { buffer: plane1 } },
        { binding: 3, resource: { buffer: plane2 } },
        { binding: 4, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.concatPlanes);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  // --- Run one MLP head ---
  _dispatchMLPHead(encoder, inputBuf, headLayers, N, headName) {
    const { inChannels, nNeurons } = DECODER_CONFIG;

    // Head architecture: headLayers is an array of { weight, bias } from the weight loader.
    // All hidden layers output nNeurons (64), final layer outputs head-specific channels.
    const HEAD_OUT_CHANNELS = { density: 1, features: 3, perturb_normal: 3, vertex_offset: 3 };
    const outChannels = HEAD_OUT_CHANNELS[headName];

    let current = inputBuf;
    let currentDim = inChannels;

    // Hidden layers: Linear + SiLU (all but the last layer). Slot keys are
    // stable per head+layer so the arena reuses the same physical buffer for the
    // same layer across ranges.
    const hk = `head:${headName}`;
    for (let i = 0; i < headLayers.length - 1; i++) {
      const layer = headLayers[i];
      const outBuf = this._alloc(`${hk}:lin:${i}`, N * nNeurons * 4);
      this._dispatchLinear(encoder, current, outBuf, layer.weight, layer.bias, N, currentDim, nNeurons);

      // SiLU activation
      const siluBuf = this._dispatchSiLU(encoder, outBuf, N * nNeurons, `${hk}:silu:${i}`);
      current = siluBuf;
      currentDim = nNeurons;
    }

    // Final layer: Linear (no activation yet)
    const lastLayer = headLayers[headLayers.length - 1];
    const rawOutBuf = this._alloc(`${hk}:rawOut`, N * outChannels * 4);
    this._dispatchLinear(encoder, current, rawOutBuf, lastLayer.weight, lastLayer.bias, N, currentDim, outChannels);

    // Apply output bias and activation
    let resultBuf = rawOutBuf;

    if (headName === 'density') {
      // bias(-1.0) then trunc_exp
      this._dispatchAddBias(encoder, resultBuf, N * outChannels, -1);
      const expBuf = this._dispatchTruncExp(encoder, resultBuf, N * outChannels, `${hk}:truncExp`);
      resultBuf = expBuf;
    } else if (headName === 'features') {
      // sigmoid
      resultBuf = this._dispatchSigmoid(encoder, resultBuf, N * outChannels, `${hk}:sigmoid`);
    } else if (headName === 'perturb_normal') {
      // normalize per-vector (3 components)
      resultBuf = this._dispatchNormalize3(encoder, resultBuf, N, `${hk}:normalize3`);
    }
    // vertex_offset: no output activation

    return resultBuf;
  }

  // --- Low-level dispatchers ---

  _dispatchLinear(encoder, input, output, weight, bias, rows, inDim, outDim) {
    const totalWG = ceilDiv$1(rows * outDim, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([rows, inDim, outDim, wgX, 1]));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.linear.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: input } },
        { binding: 2, resource: { buffer: weight } },
        { binding: 3, resource: { buffer: bias } },
        { binding: 4, resource: { buffer: output } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.linear);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }

  _dispatchSiLU(encoder, inputBuf, count, slotKey = 'silu') {
    const totalWG = ceilDiv$1(count, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, 1, wgX])); // op=1 = SiLU
    const dummyBuf = this._alloc(slotKey + ':dummy', 4);
    const outBuf = this._alloc(slotKey, count * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.activation.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: inputBuf } },
        { binding: 2, resource: { buffer: dummyBuf } },
        { binding: 3, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.activation);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  _dispatchTruncExp(encoder, inputBuf, count, slotKey = 'truncExp') {
    const totalWG = ceilDiv$1(count, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, wgX]));
    const outBuf = this._alloc(slotKey, count * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.truncExp.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: inputBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.truncExp);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  _dispatchSigmoid(encoder, inputBuf, count, slotKey = 'sigmoid') {
    const totalWG = ceilDiv$1(count, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([count, wgX]));
    const outBuf = this._alloc(slotKey, count * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.sigmoid.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: inputBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.sigmoid);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  _dispatchNormalize3(encoder, inputBuf, N, slotKey = 'normalize3') {
    const totalWG = ceilDiv$1(N, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const params = this._cachedUniform(new Uint32Array([N, wgX]));
    const outBuf = this._alloc(slotKey, N * 3 * 4);
    const bg = this.device.createBindGroup({
      layout: this.pipelines.normalize3.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: inputBuf } },
        { binding: 2, resource: { buffer: outBuf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.normalize3);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    return outBuf;
  }

  _dispatchAddBias(encoder, buf, count, bias) {
    const totalWG = ceilDiv$1(count, WG_SIZE$1);
    const [wgX, wgY] = splitWG$1(totalWG);
    const paramsData = new ArrayBuffer(12);
    const u32 = new Uint32Array(paramsData);
    const f32 = new Float32Array(paramsData);
    u32[0] = count; f32[1] = bias; u32[2] = wgX;
    const params = this._cachedUniform(new Uint8Array(paramsData));
    const bg = this.device.createBindGroup({
      layout: this.pipelines.addBias.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: buf } },
      ],
    });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipelines.addBias);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
  }
}

const TRIANGLE_TABLE = [
  [-1, -1, -1, -1, -1, -1],
  [1, 0, 2, -1, -1, -1],
  [4, 0, 3, -1, -1, -1],
  [1, 4, 2, 1, 3, 4],
  [3, 1, 5, -1, -1, -1],
  [2, 3, 0, 2, 5, 3],
  [1, 4, 0, 1, 5, 4],
  [4, 2, 5, -1, -1, -1],
  [4, 5, 2, -1, -1, -1],
  [4, 1, 0, 4, 5, 1],
  [3, 2, 0, 3, 5, 2],
  [1, 3, 5, -1, -1, -1],
  [4, 1, 2, 4, 3, 1],
  [3, 0, 4, -1, -1, -1],
  [2, 0, 1, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1]
];
const NUM_TRIANGLES_TABLE = [0, 1, 1, 2, 1, 2, 2, 1, 1, 2, 2, 1, 2, 1, 1, 0];
const BASE_TET_EDGES = [0, 1, 0, 2, 0, 3, 1, 2, 1, 3, 2, 3];
const SOURCE_PUBLIC_BASE_PATH = "./";
const SOURCE_PUBLIC_BASE_URL = resolveSourcePublicBaseUrl(
  SOURCE_PUBLIC_BASE_PATH,
  import.meta.url,
  false
);
const DEFAULT_TET_BASE_PATH = new URL("tets/", SOURCE_PUBLIC_BASE_URL).href;
function resolveSourcePublicBaseUrl(basePath, moduleUrl, development = false) {
  const value = String(basePath);
  if (!value || value.startsWith(".")) {
    return new URL(development ? "/" : "../", moduleUrl);
  }
  return new URL(value, moduleUrl);
}
async function fetchTetArrayBuffer(url, bytesPerElement) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Tet asset fetch failed for ${url}: HTTP ${response.status} ${response.statusText}`.trim());
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml")) {
    throw new Error(`Tet asset ${url} returned non-binary content type ${contentType}`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength % bytesPerElement !== 0) {
    throw new Error(
      `Tet asset ${url} byte length ${buffer.byteLength} must be a non-zero multiple of ${bytesPerElement}`
    );
  }
  return buffer;
}
async function loadTetData(basePath = DEFAULT_TET_BASE_PATH) {
  const normalizedBase = String(basePath).endsWith("/") ? String(basePath) : `${basePath}/`;
  const resolvedBase = new URL(normalizedBase, SOURCE_PUBLIC_BASE_URL);
  const gridUrl = new URL("_grid_vertices.bin", resolvedBase).href;
  const indicesUrl = new URL("indices.bin", resolvedBase).href;
  const [vertsBuf, indicesBuf] = await Promise.all([
    fetchTetArrayBuffer(gridUrl, Float32Array.BYTES_PER_ELEMENT),
    fetchTetArrayBuffer(indicesUrl, Int32Array.BYTES_PER_ELEMENT)
  ]);
  const gridVertices = new Float32Array(vertsBuf);
  const indices = new Int32Array(indicesBuf);
  if (gridVertices.length % 3 !== 0) {
    throw new Error(`Tet vertex asset ${gridUrl} has ${gridVertices.length} values; expected xyz triples`);
  }
  if (indices.length % 4 !== 0) {
    throw new Error(`Tet index asset ${indicesUrl} has ${indices.length} values; expected tetrahedra quads`);
  }
  return {
    gridVertices,
    numVertices: gridVertices.length / 3,
    indices,
    numTets: indices.length / 4
  };
}
function marchingTetrahedra(gridVertices, sdf, tetIndices, vertexOffsets = null, resolution = 160) {
  const N_v = gridVertices.length / 3;
  const N_t = tetIndices.length / 4;
  let positions;
  if (vertexOffsets) {
    const scale = 1.74 / resolution;
    positions = new Float32Array(N_v * 3);
    for (let i = 0; i < N_v * 3; i++) {
      positions[i] = gridVertices[i] + scale * Math.tanh(vertexOffsets[i]);
    }
  } else {
    positions = gridVertices;
  }
  const occ = new Uint8Array(N_v);
  for (let i = 0; i < N_v; i++) {
    occ[i] = sdf[i] > 0 ? 1 : 0;
  }
  const validTets = [];
  for (let t = 0; t < N_t; t++) {
    const base = t * 4;
    const sum = occ[tetIndices[base]] + occ[tetIndices[base + 1]] + occ[tetIndices[base + 2]] + occ[tetIndices[base + 3]];
    if (sum > 0 && sum < 4) {
      validTets.push(t);
    }
  }
  const edgeMap = /* @__PURE__ */ new Map();
  const edgeList = [];
  const tetEdgeIndices = new Int32Array(validTets.length * 6);
  for (let vi = 0; vi < validTets.length; vi++) {
    const t = validTets[vi];
    const tetBase = t * 4;
    for (let e = 0; e < 6; e++) {
      let v0 = tetIndices[tetBase + BASE_TET_EDGES[e * 2]];
      let v1 = tetIndices[tetBase + BASE_TET_EDGES[e * 2 + 1]];
      if (v0 > v1) {
        const tmp = v0;
        v0 = v1;
        v1 = tmp;
      }
      const key = `${v0},${v1}`;
      let edgeIdx;
      if (edgeMap.has(key)) {
        edgeIdx = edgeMap.get(key);
      } else {
        edgeIdx = edgeList.length;
        edgeMap.set(key, edgeIdx);
        edgeList.push([v0, v1]);
      }
      tetEdgeIndices[vi * 6 + e] = edgeIdx;
    }
  }
  const crossingEdges = [];
  const edgeToVertex = new Int32Array(edgeList.length).fill(-1);
  let vertexCount = 0;
  for (let i = 0; i < edgeList.length; i++) {
    const [v0, v1] = edgeList[i];
    if (occ[v0] !== occ[v1]) {
      edgeToVertex[i] = vertexCount++;
      crossingEdges.push(i);
    }
  }
  const vertices = new Float32Array(vertexCount * 3);
  for (const edgeIdx of crossingEdges) {
    const [v0, v1] = edgeList[edgeIdx];
    const s0 = sdf[v0];
    const s1 = sdf[v1];
    const denom = s0 - s1;
    const t = denom !== 0 ? s0 / denom : 0.5;
    const outIdx = edgeToVertex[edgeIdx] * 3;
    for (let d = 0; d < 3; d++) {
      vertices[outIdx + d] = positions[v0 * 3 + d] * (1 - t) + positions[v1 * 3 + d] * t;
    }
  }
  const faceList = [];
  for (let vi = 0; vi < validTets.length; vi++) {
    const t = validTets[vi];
    const tetBase = t * 4;
    let tetindex = 0;
    for (let j = 0; j < 4; j++) {
      if (occ[tetIndices[tetBase + j]]) {
        tetindex |= 1 << j;
      }
    }
    const numTri = NUM_TRIANGLES_TABLE[tetindex];
    const triRow = TRIANGLE_TABLE[tetindex];
    for (let tri = 0; tri < numTri; tri++) {
      const i0 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3]]];
      const i1 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3 + 1]]];
      const i2 = edgeToVertex[tetEdgeIndices[vi * 6 + triRow[tri * 3 + 2]]];
      if (i0 >= 0 && i1 >= 0 && i2 >= 0) {
        faceList.push(i0, i1, i2);
      }
    }
  }
  const faces = new Uint32Array(faceList);
  return {
    vertices,
    faces,
    numVertices: vertexCount,
    numFaces: faces.length / 3
  };
}
function scaleTensor(data, fromRange, toRange) {
  const [fromMin, fromMax] = fromRange;
  const [toMin, toMax] = toRange;
  const scale = (toRange[1] - toRange[0]) / (fromMax - fromMin);
  const offset = toRange[0] - fromMin * scale;
  const result = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] * scale + offset;
  }
  return result;
}
function validateMarchingTetReply(d) {
  const numVertices = d?.numVertices;
  const numFaces = d?.numFaces;
  if (!Number.isSafeInteger(numVertices) || numVertices <= 0) throw new Error(`marching-tet reply numVertices invalid: ${numVertices}`);
  if (!Number.isSafeInteger(numFaces) || numFaces <= 0) throw new Error(`marching-tet reply numFaces invalid: ${numFaces}`);
  if (!(d.vertices instanceof ArrayBuffer) || !(d.faces instanceof ArrayBuffer)) {
    throw new Error("marching-tet reply must carry vertices and faces ArrayBuffers");
  }
  const vertices = new Float32Array(d.vertices);
  const faces = new Uint32Array(d.faces);
  if (vertices.length !== numVertices * 3) throw new Error(`marching-tet vertices length ${vertices.length} != ${numVertices * 3}`);
  if (faces.length !== numFaces * 3) throw new Error(`marching-tet faces length ${faces.length} != ${numFaces * 3}`);
  for (let i = 0; i < vertices.length; i++) {
    if (!Number.isFinite(vertices[i])) throw new Error(`marching-tet vertex value non-finite at ${i}`);
  }
  for (let i = 0; i < faces.length; i++) {
    if (faces[i] >= numVertices) throw new Error(`marching-tet face index ${faces[i]} out of range at ${i}`);
  }
  return { vertices, faces, numVertices, numFaces };
}
async function runMarchingTetOnWorker(worker, { sdf, vertexOffsets, bbox, resolution }, { timeoutMs = 3e4 } = {}) {
  if (!(sdf instanceof Float32Array)) throw new TypeError("sdf must be a Float32Array");
  if (vertexOffsets != null && !(vertexOffsets instanceof Float32Array)) throw new TypeError("vertexOffsets must be a Float32Array or null");
  const sdfBuf = sdf.slice().buffer;
  const offBuf = vertexOffsets ? vertexOffsets.slice().buffer : null;
  const transfer = offBuf ? [sdfBuf, offBuf] : [sdfBuf];
  return await callWorker(
    worker,
    { id: `marching-tet-${Math.random().toString(36).slice(2)}`, sdf: sdfBuf, vertexOffsets: offBuf, bbox, resolution },
    transfer,
    { timeoutMs, onResult: validateMarchingTetReply }
  );
}

/**
 * inference.js — SF3D WebGPU inference pipeline.
 *
 * Full forward pass:
 *   1. Image preprocessing (normalize, resize to 512×512)
 *   2. Camera embedding (linear projection)
 *   3. DINOv2 image tokenization (with AdaNorm modulation)
 *   4. Two-stream backbone (interleave transformer)
 *   5. PixelShuffle post-processing
 *   6. Triplane query + decoder MLP
 *   7. Marching tetrahedra mesh extraction (CPU)
 *
 * Steps 1 run on CPU. Steps 2-6 run on GPU. Step 7 runs on CPU.
 */


// SF3D model configuration
const CONFIG = {
  condImageSize: 512,
  numEncoderLayers: 24,
  isosurfaceResolution: 160,
  isosurfaceThreshold: 10.0,
  radius: 0.87,
  defaultFovDeg: 40.0,
  defaultDistance: 1.6,
  // ImageNet normalization for DINOv2
  imageMean: [0.485, 0.456, 0.406],
  imageStd: [0.229, 0.224, 0.225],
  // Background color
  bgColor: [0.5, 0.5, 0.5],
};

/**
 * Preprocess an image for SF3D input.
 * Returns Float32Array in CHW format, normalized with ImageNet stats.
 */

/**
 * Extract raw float32 RGBA source pixels from an image element via canvas.
 * Cheap (a getImageData copy); the expensive resize/blend/normalize is separate
 * so it can run on either the main thread or a worker.
 */
function extractSourcePixels(imageData) {
  const canvas = document.createElement('canvas');
  const srcW = imageData.naturalWidth || imageData.width;
  const srcH = imageData.naturalHeight || imageData.height;
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageData, 0, 0);
  const srcPixels = ctx.getImageData(0, 0, srcW, srcH).data;
  const srcFloat = new Float32Array(srcW * srcH * 4);
  for (let i = 0; i < srcPixels.length; i++) srcFloat[i] = srcPixels[i] / 255.0;
  return { srcFloat, srcW, srcH };
}

/**
 * Preprocess an image for SF3D input → CHW float32 tensor.
 *
 * @param {object} [options.preprocessWorker]  a live Worker running
 *   preprocess_worker.js; when supplied, the Lanczos resize + blend + normalize
 *   (the ~700ms main-thread gap) runs OFF the main thread. Output is
 *   byte-identical to the main-thread path (same preprocess_core math). Without
 *   it, behavior is unchanged.
 */
async function preprocessImage(imageData, width, height, options = {}) {
  const size = CONFIG.condImageSize;
  const { srcFloat, srcW, srcH } = extractSourcePixels(imageData);
  const bg = CONFIG.bgColor, imageMean = CONFIG.imageMean, imageStd = CONFIG.imageStd;

  const worker = options.preprocessWorker;
  if (worker) {
    const id = `pp-${Math.random().toString(36).slice(2)}`;
    const expectedLen = 3 * size * size;
    // Fail-loud: a worker crash / malformed reply / wedge rejects (never hangs,
    // never silently falls back). The caller owns any main-thread retry policy.
    return await callWorker(
      worker,
      { srcBuffer: srcFloat.buffer, srcW, srcH, size, bg, imageMean, imageStd, id },
      [srcFloat.buffer],
      {
        timeoutMs: options.workerTimeoutMs || 30000,
        // Shape + finiteness (worker_reply_validation.js): a length-correct
        // reply carrying NaN/Inf must not reach the GPU as a successful offload.
        onResult: (data) => validatePreprocessReply(data, expectedLen),
      },
    );
  }

  // Main-thread path (unchanged output).
  return resizeBlendNormalize(srcFloat, srcW, srcH, size, bg, imageMean, imageStd);
}

/**
 * Compute default camera embeddings input.
 * SF3D uses a fixed camera: c2w at distance 1.6, fov 40°.
 * Returns [25] float array: concat(c2w_4x4, intrinsic_normed_3x3).
 */
function computeCameraInput() {
  const c2w = new Float32Array([
    0, 0, 1, CONFIG.defaultDistance,
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  ]);

  const fov = CONFIG.defaultFovDeg * Math.PI / 180;
  const focal = 0.5 / Math.tan(fov / 2);
  const intrinsicNormed = new Float32Array([
    focal, 0, 0.5,
    0, focal, 0.5,
    0, 0, 1,
  ]);

  const embedInput = new Float32Array(25);
  embedInput.set(c2w, 0);
  embedInput.set(intrinsicNormed, 16);
  return embedInput;
}

/**
 * Initialize all GPU pipeline modules.
 */
function initPipelines(device) {
  const imageTokenizer = new SF3DImageTokenizer(device);
  imageTokenizer.init();

  const twoStream = new TwoStreamBackbone(device);
  twoStream.init();

  const triplaneDecoder = new TriplaneDecoder(device);
  triplaneDecoder.init();

  return { imageTokenizer, twoStream, triplaneDecoder };
}

/**
 * Run the full SF3D inference pipeline.
 *
 * @param {GPUDevice} device
 * @param {Object} pipelines - from initPipelines()
 * @param {Object} weights - from loadWeights()
 * @param {HTMLImageElement|HTMLCanvasElement} imageElement
 * @param {Function} onProgress - progress callback
 * @returns {{ vertices: Float32Array, faces: Uint32Array, numVertices: number, numFaces: number }}
 */
async function runInference(device, pipelines, weights, imageElement, onProgress, options = {}) {
  const report = (msg) => { if (onProgress) onProgress(msg); console.log(msg); };
  const _stageTimings = {};
  let _stageStart;

  // Cooperative DINO options (first uptake of @kaminos/webgpu-inference-kit
  // cooperative porting spine; see cooperative_dino.js). Defaults preserve the
  // legacy single-submit path exactly.
  const cooperativeDino = options.cooperativeDino === true;
  const dinoSchedulingMode = options.dinoSchedulingMode === 'disabled' ? 'disabled' : 'cooperative';
  const dinoChunkBlocks = Number.isSafeInteger(options.dinoChunkBlocks) && options.dinoChunkBlocks > 0
    ? options.dinoChunkBlocks
    : 1;
  const cooperativePostProcessor = options.cooperativePostProcessor === true;
  const cooperativeTwoStream = options.cooperativeTwoStream === true;
  const twoStreamSchedulingMode = options.twoStreamSchedulingMode === 'disabled'
    ? 'disabled'
    : 'cooperative';
  const twoStreamDutyGranularity = options.twoStreamDutyGranularity ?? 'stage';
  if (!['stage', 'attention-tile'].includes(twoStreamDutyGranularity)) {
    throw new RangeError(
      `twoStreamDutyGranularity must be stage or attention-tile, `
      + `got ${twoStreamDutyGranularity}`,
    );
  }
  const twoStreamLinearRowsPerDuty = options.twoStreamLinearRowsPerDuty ?? 128;
  if (!Number.isSafeInteger(twoStreamLinearRowsPerDuty)
    || twoStreamLinearRowsPerDuty <= 0) {
    throw new TypeError(
      `twoStreamLinearRowsPerDuty must be a positive safe integer, `
      + `got ${twoStreamLinearRowsPerDuty}`,
    );
  }
  const postProcessorSchedulingMode = options.postProcessorSchedulingMode === 'disabled'
    ? 'disabled'
    : 'cooperative';
  const postProcessorDutyGranularity = options.postProcessorDutyGranularity ?? 'plane';
  if (!['plane', 'layer', 'channel-range'].includes(postProcessorDutyGranularity)) {
    throw new RangeError(
      `postProcessorDutyGranularity must be plane, layer, or channel-range, `
      + `got ${postProcessorDutyGranularity}`,
    );
  }
  // Bounded-prefix completion for the fixed channel-range postprocessor boundary
  // (kit >=0.1.41). Default strict-prefix preserves prior behavior; validation
  // lives in runCooperativePostProcessor (channel-range + cooperative only).
  const postProcessorCompletionPolicy = options.postProcessorCompletionPolicy ?? 'strict-prefix';
  const postProcessorMaxInFlightGpuDuties = options.postProcessorMaxInFlightGpuDuties ?? null;
  const postProcessorChannelsPerDuty = options.postProcessorChannelsPerDuty ?? 16;
  if (!Number.isSafeInteger(postProcessorChannelsPerDuty)
      || postProcessorChannelsPerDuty <= 0) {
    throw new TypeError(
      `postProcessorChannelsPerDuty must be a positive safe integer, `
      + `got ${postProcessorChannelsPerDuty}`,
    );
  }
  // Surfaced back to the caller/smoke via the returned _cooperativeReports.
  const _cooperativeReports = {};
  // Exact DINO numerical payload (only when options.captureDinoPayload).
  let _dinoPayload = null;
  // Absolute-timestamp stage spans for foreground-tail attribution (opt-in).
  const _spans = Array.isArray(options.recordStageSpans) ? options.recordStageSpans : null;
  const _markSpan = (name, start) => { if (_spans) _spans.push({ name, start, end: performance.now() }); };

  // 1. Preprocess image (CPU)
  _stageStart = performance.now();
  report('Preprocessing image...');
  const imageData = await preprocessImage(imageElement,
    imageElement.naturalWidth || imageElement.width,
    imageElement.naturalHeight || imageElement.height,
    { preprocessWorker: options.preprocessWorker, workerTimeoutMs: options.workerTimeoutMs });
  const imageBuf = createStorageBuffer(device, imageData);

  // 2. Camera embedding (GPU) — counted as part of image-preprocess
  report('Computing camera embedding...');
  const cameraInput = computeCameraInput();
  const cameraInputBuf = createStorageBuffer(device, cameraInput);

  // Dispatch camera embedding: Linear(25 → 768)
  const encoder1 = device.createCommandEncoder();
  const cameraEmbedBuf = createEmptyBuffer(device, 768 * 4);
  _dispatchLinear$1(device, encoder1, pipelines, cameraInputBuf, cameraEmbedBuf,
    weights.cameraEmbedder.weight, weights.cameraEmbedder.bias, 1, 25, 768);
  device.queue.submit([encoder1.finish()]);

  _stageTimings['image-preprocess'] = performance.now() - _stageStart;
  _markSpan('image-preprocess', _stageStart);

  // 3. DINOv2 image tokenization (GPU)
  _stageStart = performance.now();
  let dinov2Result;
  if (cooperativeDino) {
    report(`Running DINOv2 backbone (cooperative, ${dinoSchedulingMode}, chunk=${dinoChunkBlocks})...`);
    const { result, report: coopReport } = await runCooperativeDino({
      device,
      foregroundOpportunities: options.foregroundOpportunities ?? null,
      tokenizer: pipelines.imageTokenizer,
      imageBuf,
      cameraEmbedBuf,
      weights: weights.imageTokenizer,
      numBlocks: CONFIG.numEncoderLayers,
      chunkBlocks: dinoChunkBlocks,
      schedulingMode: dinoSchedulingMode,
      onProgress: (p) => {
        if (p.percent != null) report(`DINOv2 blocks ${p.completedItems}/${p.totalItems} (${p.percent.toFixed(0)}%)`);
      },
    });
    dinov2Result = result;
    _cooperativeReports['dinov2-tokenizer'] = coopReport;
  } else {
    report('Running DINOv2 backbone...');
    const encoder2 = device.createCommandEncoder();
    dinov2Result = pipelines.imageTokenizer.encode(
      encoder2, imageBuf, cameraEmbedBuf, weights.imageTokenizer);
    device.queue.submit([encoder2.finish()]);
  }

  // Exact numerical payload capture (acceptance-capsule gate 5). Reads back the
  // complete DINOv2 token buffer — the canonical numerical output of the DINO
  // boundary being A/B'd — so control and candidate can be hashed and compared
  // field-by-field. Gated by option: normal runs pay no extra readback.
  if (options.captureDinoPayload) {
    const tokens = await readBuffer(device, dinov2Result.tokensBuf, dinov2Result.N * 1024 * 4);
    _dinoPayload = {
      shape: { N: dinov2Result.N, dim: 1024 },
      length: tokens.length,
      // Float32Array — the capsule hashes bytes and finds first differing index.
      tokens: Float32Array.from(tokens),
    };
  }

  _stageTimings['dinov2-tokenizer'] = performance.now() - _stageStart;
  _markSpan('dinov2-tokenizer', _stageStart);

  // 4. Two-stream backbone (GPU)
  _stageStart = performance.now();
  report('Running two-stream backbone...');

  // Rearrange tokenizer embeddings from [3, 1024, 96, 96] to [1024, 27648]
  // PyTorch does: rearrange("Np Ct Hp Wp -> Ct (Np Hp Wp)")
  // Source [p,c,h,w] at p*C*H*W + c*H*W + h*W + w
  // Dest [c, p*H*W + h*W + w] at c*3*H*W + p*H*W + h*W + w
  if (!weights.backbone._rearrangedEmbeddings) {
    const C = 1024, Np = 3, H = 96, W = 96;
    const total = Np * C * H * W;
    const rearrangeEncoder = device.createCommandEncoder();

    if (!pipelines._rearrangePipeline) {
      pipelines._rearrangePipeline = device.createComputePipeline({
        layout: 'auto',
        compute: {
          module: device.createShaderModule({
            code: `
              struct P { Np: u32, C: u32, H: u32, W: u32, numWgX: u32 }
              @group(0) @binding(0) var<uniform> p: P;
              @group(0) @binding(1) var<storage, read> src: array<f32>;
              @group(0) @binding(2) var<storage, read_write> dst: array<f32>;
              @compute @workgroup_size(256)
              fn main(@builtin(workgroup_id) wgid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
                let idx = (wgid.x + wgid.y * p.numWgX) * 256u + lid.x;
                let total = p.Np * p.C * p.H * p.W;
                if (idx >= total) { return; }
                // idx iterates over destination [C, Np*H*W]
                let c = idx / (p.Np * p.H * p.W);
                let s = idx % (p.Np * p.H * p.W);
                let plane = s / (p.H * p.W);
                let hw = s % (p.H * p.W);
                // source layout: [Np, C, H, W]
                let srcIdx = plane * p.C * p.H * p.W + c * p.H * p.W + hw;
                dst[idx] = src[srcIdx];
              }
            `,
          }),
          entryPoint: 'main',
        },
      });
    }

    const totalWG = Math.ceil(total / 256);
    const wgX = Math.min(totalWG, 65535);
    const wgY = Math.ceil(totalWG / 65535);
    const params = device.createBuffer({
      size: 20, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, mappedAtCreation: true,
    });
    new Uint32Array(params.getMappedRange()).set([Np, C, H, W, wgX]);
    params.unmap();

    const rearrangedBuf = createEmptyBuffer(device, total * 4);
    const bg = device.createBindGroup({
      layout: pipelines._rearrangePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: params } },
        { binding: 1, resource: { buffer: weights.tokenizer.embeddings } },
        { binding: 2, resource: { buffer: rearrangedBuf } },
      ],
    });
    const pass = rearrangeEncoder.beginComputePass();
    pass.setPipeline(pipelines._rearrangePipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(wgX, wgY);
    pass.end();
    device.queue.submit([rearrangeEncoder.finish()]);

    weights.backbone._rearrangedEmbeddings = rearrangedBuf;
  }
  weights.backbone.tokenizer_embeddings_buf = weights.backbone._rearrangedEmbeddings;

  let backboneResult;
  if (cooperativeTwoStream) {
    report(
      `Running two-stream backbone (cooperative, ${twoStreamSchedulingMode}, `
      + `${twoStreamDutyGranularity})...`,
    );
    const { result, report: twoStreamReport } = await runCooperativeTwoStream({
      device,
      foregroundOpportunities: options.foregroundOpportunities ?? null,
      backbone: pipelines.twoStream,
      imageTokensBuf: dinov2Result.tokensBuf,
      N_img: dinov2Result.N,
      weights: weights.backbone,
      schedulingMode: twoStreamSchedulingMode,
      dutyGranularity: twoStreamDutyGranularity,
      linearRowsPerDuty: twoStreamLinearRowsPerDuty,
      signal: options.signal,
      onProgress: (p) => {
        if (p.percent != null) {
          report(
            `Two-stream duties ${p.completedItems}/${p.totalItems} `
            + `(${p.percent.toFixed(0)}%)`,
          );
        }
      },
    });
    backboneResult = result;
    _cooperativeReports['two-stream-backbone'] = twoStreamReport;
  } else {
    const encoder3 = device.createCommandEncoder();
    backboneResult = pipelines.twoStream.forward(
      encoder3, dinov2Result.tokensBuf, dinov2Result.N, weights.backbone);
    device.queue.submit([encoder3.finish()]);
  }

  // Stage-by-stage backbone diagnostics (compare with PyTorch reference)
  // PyTorch reference (chair image):
  //   after GroupNorm:      min=-2.50, max=2.51, std=0.45
  //   after proj_triplane:  min=-6.64, max=6.94, std=0.43
  //   block 0 triplane:     min=-7.64, max=9.77, std=0.59
  //   block 3 triplane:     min=-10.09, max=16.46, std=0.85
  //   proj_out (permuted):  min=-5.68, max=5.44, std=0.36
  //   final (with residual): min=-5.67, max=5.45, std=0.36

  _stageTimings['two-stream-backbone'] = performance.now() - _stageStart;
  _markSpan('two-stream-backbone', _stageStart);

  // 5. PixelShuffle post-processing (counted as part of triplane-decode)
  _stageStart = performance.now();
  let triplaneResult;
  if (cooperativePostProcessor) {
    const progressUnit = postProcessorDutyGranularity === 'plane' ? 'planes' : 'duties';
    report(
      `Running post-processor (cooperative, ${postProcessorSchedulingMode}, `
      + `${postProcessorDutyGranularity})...`,
    );
    const { result, report: postProcessorReport } = await runCooperativePostProcessor({
      device,
      foregroundOpportunities: options.foregroundOpportunities ?? null,
      triplanesBuf: backboneResult.buffer,
      weights: weights.postProcessor,
      schedulingMode: postProcessorSchedulingMode,
      dutyGranularity: postProcessorDutyGranularity,
      channelsPerDuty: postProcessorChannelsPerDuty,
      completionPolicy: postProcessorCompletionPolicy,
      maxInFlightGpuDuties: postProcessorMaxInFlightGpuDuties,
      signal: options.signal,
      onProgress: (p) => {
        if (p.percent != null) {
          report(
            `Post-processor ${progressUnit} ${p.completedItems}/${p.totalItems} `
            + `(${p.percent.toFixed(0)}%)`,
          );
        }
      },
    });
    triplaneResult = result;
    _cooperativeReports['post-processor'] = postProcessorReport;
  } else {
    report('Running post-processor...');
    const encoder4 = device.createCommandEncoder();
    triplaneResult = dispatchPostProcessor(
      device, encoder4, backboneResult.buffer, weights.postProcessor);
    device.queue.submit([encoder4.finish()]);

    // Ensure GPU work is done before reading
    await device.queue.onSubmittedWorkDone();
  }
  _markSpan('post-processor', _stageStart);

  // 6. Triplane query + decoder (GPU) — still part of triplane-decode timing
  report('Querying triplane and decoding...');

  // Load tet grid data
  const tetData = await loadTetData();
  report(`Loaded tet grid: ${tetData.numVertices} vertices, ${tetData.numTets} tets`);

  // Scale grid vertices from [0, 1] to bbox
  const bbox = [-0.87, CONFIG.radius];
  const gridPositions = scaleTensor(tetData.gridVertices, [0, 1], bbox);
  const gridPosBuf = createStorageBuffer(device, gridPositions);

  // First pass: density + vertex_offset for mesh extraction
  const encoder5 = device.createCommandEncoder();
  const decoded = pipelines.triplaneDecoder.decode(
    encoder5, gridPosBuf, triplaneResult.buffer, tetData.numVertices,
    weights.decoder, ['density', 'vertex_offset']);
  device.queue.submit([encoder5.finish()]);

  // Read back density and vertex_offset to CPU
  report('Reading back SDF values...');
  const densityCPU = await readBuffer(device, decoded.density, tetData.numVertices * 4);
  const sdf = new Float32Array(densityCPU);

  // Subtract threshold: sdf = density - threshold
  for (let i = 0; i < sdf.length; i++) {
    sdf[i] -= CONFIG.isosurfaceThreshold;
  }

  const vertexOffsetCPU = await readBuffer(device, decoded.vertex_offset, tetData.numVertices * 3 * 4);
  const vertexOffsets = new Float32Array(vertexOffsetCPU);

  _stageTimings['triplane-decode'] = performance.now() - _stageStart;
  _markSpan('triplane-decode', _stageStart);

  // 7. Marching tetrahedra (CPU)
  _stageStart = performance.now();
  report('Extracting mesh...');
  // Grid vertices need to be in model space with deformation applied
  // The grid is in [0, 1], scale to bbox for the marching tet
  // Optionally offloaded to a Web Worker that owns the resident tet grid
  // (options.marchingTetWorker) — byte-identical output (same marchingTetrahedra
  // code); removes the ~30-40ms contiguous CPU stall from the main thread.
  const mesh = options.marchingTetWorker
    ? await runMarchingTetOnWorker(options.marchingTetWorker,
        { sdf, vertexOffsets, bbox, resolution: CONFIG.isosurfaceResolution },
        { timeoutMs: options.workerTimeoutMs })
    : marchingTetrahedra(
        gridPositions, sdf, tetData.indices, vertexOffsets, CONFIG.isosurfaceResolution);

  report(`Mesh extracted: ${mesh.numVertices} vertices, ${mesh.numFaces} faces`);

  _stageTimings['marching-tet'] = performance.now() - _stageStart;
  _markSpan('marching-tet', _stageStart);

  // Mesh vertices are already in bbox space (from gridPositions which was pre-scaled)
  return {
    vertices: mesh.vertices,
    faces: mesh.faces,
    numVertices: mesh.numVertices,
    numFaces: mesh.numFaces,
    // Expose for texture baking
    _triplanesBuf: triplaneResult.buffer,
    _triplaneDecoder: pipelines.triplaneDecoder,
    _decoderWeights: weights.decoder,
    _stageTimings,
    // Cooperative execution reports per phase (empty unless an opt-in boundary runs)
    _cooperativeReports,
    // Exact DINO numerical payload for A/B comparison (null unless captured).
    _dinoPayload,
    // Expose for parity verification (sdf = density - threshold; add threshold back for raw)
    _sdf: sdf,
    _isosurfaceThreshold: CONFIG.isosurfaceThreshold,
    // Raw decoder vertex offsets (pre tanh/scale, [N*3]), scaled grid positions
    // ([N*3]), and the camera-embedding GPU buffer ([768] f32) for element-wise
    // comparison against tools/dump_parity_reference.py (tools/smoke_parity.mjs).
    _vertexOffsets: vertexOffsets,
    _gridPositions: gridPositions,
    _cameraEmbedBuf: cameraEmbedBuf,
  };
}

// --- Helper: dispatch a single linear layer (for camera embedding) ---
function _dispatchLinear$1(device, encoder, pipelines, input, output, weight, bias, rows, inDim, outDim) {
  // Reuse the imageTokenizer's linear pipeline
  pipelines.imageTokenizer._dispatchLinear(encoder, input, output, weight, bias, rows, inDim, outDim);
}

/**
 * materialize_core.js — pure, DOM/GPU-free texture materialization.
 *
 * Extracted from bakeTexture so the exact same albedo build + normal-map
 * (default fill + TBN world→tangent transform) + dilation runs on either the
 * main thread OR a Web Worker, byte-identical. This is Cranial's assay's ~752ms
 * single-threaded CPU tail (albedo dilation ~375ms + normal dilation ~369ms);
 * moving it to a worker removes it from the main thread with no GPU sync and no
 * per-duty fence floor.
 *
 * Inputs are plain typed arrays; outputs are the albedo + normal Uint8Arrays.
 */

/**
 * Dilate texture to fill empty pixels by averaging nearest occupied neighbors.
 * Exact copy of bakeTexture's _dilateTexture (must stay byte-identical).
 */
function dilateTexture(texture, mask, resolution, iterations = 6) {
  const workMask = new Uint8Array(mask);

  for (let iter = 0; iter < iterations; iter++) {
    const newPixels = [];

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = y * resolution + x;
        if (workMask[idx]) continue;

        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= resolution || ny < 0 || ny >= resolution) continue;
          const nIdx = ny * resolution + nx;
          if (workMask[nIdx]) {
            sumR += texture[nIdx * 4];
            sumG += texture[nIdx * 4 + 1];
            sumB += texture[nIdx * 4 + 2];
            count++;
          }
        }

        if (count > 0) {
          newPixels.push({
            idx,
            r: Math.round(sumR / count),
            g: Math.round(sumG / count),
            b: Math.round(sumB / count),
          });
        }
      }
    }

    for (const p of newPixels) {
      texture[p.idx * 4] = p.r;
      texture[p.idx * 4 + 1] = p.g;
      texture[p.idx * 4 + 2] = p.b;
      texture[p.idx * 4 + 3] = 255;
      workMask[p.idx] = 1;
    }

    if (newPixels.length === 0) break;
  }
}

/**
 * Build albedo + normal-map textures from decoded features/normals, transform
 * normals to tangent space, and dilate. Byte-identical to bakeTexture's inline
 * materialization.
 *
 * @param {object} o
 * @param {Float32Array} o.featuresCPU     [numOccupied*3] decoded albedo features
 * @param {Float32Array} o.normalsCPU      [numOccupied*3] decoded world-space normals
 * @param {Uint32Array}  o.occupiedIndices [numOccupied] texel indices
 * @param {Float32Array} o.tbnData         [resolution^2 * 9] per-texel TBN basis
 * @param {Uint8Array}   o.mask            [resolution^2] occupancy mask
 * @param {number}       o.resolution
 * @param {number}       o.numOccupied
 * @returns {{ albedo: Uint8Array, normalMap: Uint8Array }}
 */
function materializeTextures({ featuresCPU, normalsCPU, occupiedIndices, tbnData, mask, resolution, numOccupied }) {
  // Build albedo RGBA texture
  const albedo = new Uint8Array(resolution * resolution * 4);
  for (let i = 0; i < numOccupied; i++) {
    const texIdx = occupiedIndices[i];
    albedo[texIdx * 4] = Math.max(0, Math.min(255, Math.round(featuresCPU[i * 3] * 255)));
    albedo[texIdx * 4 + 1] = Math.max(0, Math.min(255, Math.round(featuresCPU[i * 3 + 1] * 255)));
    albedo[texIdx * 4 + 2] = Math.max(0, Math.min(255, Math.round(featuresCPU[i * 3 + 2] * 255)));
    albedo[texIdx * 4 + 3] = 255;
  }

  // Build normal map: transform perturb_normal from world space to tangent space
  const normalMap = new Uint8Array(resolution * resolution * 4);
  // Default normal (pointing straight out): [0.5, 0.5, 1.0] in encoded space
  for (let i = 0; i < resolution * resolution; i++) {
    normalMap[i * 4 + 2] = 255; // blue channel = 1.0
    normalMap[i * 4 + 3] = 255;
  }

  for (let i = 0; i < numOccupied; i++) {
    const texIdx = occupiedIndices[i];
    const tbnBase = texIdx * 9;

    const nx = normalsCPU[i * 3];
    const ny = normalsCPU[i * 3 + 1];
    const nz = normalsCPU[i * 3 + 2];

    const tx = tbnData[tbnBase], ty = tbnData[tbnBase + 1], tz = tbnData[tbnBase + 2];
    const bx = tbnData[tbnBase + 3], by = tbnData[tbnBase + 4], bz = tbnData[tbnBase + 5];
    const fnx = tbnData[tbnBase + 6], fny = tbnData[tbnBase + 7], fnz = tbnData[tbnBase + 8];

    // Transform to tangent space: n_tangent = TBN^T * n_world
    const ntx = tx * nx + ty * ny + tz * nz;
    const nty = bx * nx + by * ny + bz * nz;
    const ntz = fnx * nx + fny * ny + fnz * nz;

    // Encode from [-1,1] to [0,1]
    const r = Math.max(0, Math.min(255, Math.round((ntx * 0.5 + 0.5) * 255)));
    const g = Math.max(0, Math.min(255, Math.round((nty * 0.5 + 0.5) * 255)));
    const b = Math.max(0, Math.min(255, Math.round((ntz * 0.5 + 0.5) * 255)));

    normalMap[texIdx * 4] = r;
    normalMap[texIdx * 4 + 1] = g;
    normalMap[texIdx * 4 + 2] = b;
    normalMap[texIdx * 4 + 3] = 255;
  }

  // Dilate both textures (matching PyTorch: resolution // 150 ≈ 7 at 1024)
  const dilateIters = Math.max(1, Math.round(resolution / 150));
  dilateTexture(albedo, mask, resolution, dilateIters);
  dilateTexture(normalMap, mask, resolution, dilateIters);

  return { albedo, normalMap };
}

/**
 * texture_baker.js — UV unwrapping + texture baking for SF3D WebGPU.
 *
 * Pipeline:
 *   1. Cube-projection UV unwrapping with bbox normalization
 *   2. CPU rasterization of UV space → 3D positions (with depth buffer)
 *   3. GPU triplane query + features decoder → RGB
 *   4. Texture dilation to fill seams
 *
 * The triplane query and decoder reuse triplane_decoder.js.
 */


/**
 * UV unwrap a mesh using cube projection with bounding-box normalization.
 *
 * Each triangle is assigned to one of 6 cube faces based on its face normal,
 * then projected onto that face's 2D plane using the mesh's actual bounding
 * box (not a fixed radius) for UV normalization. The 6 projections are packed
 * into a 3×2 grid in UV space.
 *
 * Vertices are duplicated per-face (no sharing across faces) to allow
 * per-face UVs without seam issues.
 *
 * @param {Float32Array} vertices - [N_v * 3] vertex positions
 * @param {Uint32Array} faces - [N_f * 3] triangle indices
 * @param {number} numVertices
 * @param {number} numFaces
 * @param {number} radius - model space radius (unused, kept for API compat)
 * @returns {{ uvs, newVertices, newNormals, newFaces, newNumVertices, newNumFaces, faceAssignment }}
 */
function unwrapUV(vertices, faces, numVertices, numFaces, radius = 0.87) {
  // --- PCA alignment: rotate vertex positions so principal axes align with
  // canonical X/Y/Z, matching PyTorch _align_mesh_with_main_axis.
  // ONLY used for UV generation; output newVertices remain unrotated. ---
  const rotMat = _computePCARotation(vertices, numVertices);
  const rotVerts = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    const x = vertices[i*3], y = vertices[i*3+1], z = vertices[i*3+2];
    rotVerts[i*3]   = rotMat[0]*x + rotMat[1]*y + rotMat[2]*z;
    rotVerts[i*3+1] = rotMat[3]*x + rotMat[4]*y + rotMat[5]*z;
    rotVerts[i*3+2] = rotMat[6]*x + rotMat[7]*y + rotMat[8]*z;
  }

  // Compute smooth vertex normals from ROTATED vertex positions.
  // Area-weighted: each face contributes its (unnormalized) cross product
  // to all 3 vertices. Larger faces contribute more. Then normalize.
  const smoothNormals = new Float32Array(numVertices * 3);
  const faceAssignment = new Uint8Array(numFaces);

  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];
    const v0x = rotVerts[i0*3], v0y = rotVerts[i0*3+1], v0z = rotVerts[i0*3+2];
    const v1x = rotVerts[i1*3], v1y = rotVerts[i1*3+1], v1z = rotVerts[i1*3+2];
    const v2x = rotVerts[i2*3], v2y = rotVerts[i2*3+1], v2z = rotVerts[i2*3+2];

    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;

    // Accumulate unnormalized face normal to each vertex (area-weighted)
    for (const idx of [i0, i1, i2]) {
      smoothNormals[idx * 3] += nx;
      smoothNormals[idx * 3 + 1] += ny;
      smoothNormals[idx * 3 + 2] += nz;
    }
  }

  // Normalize accumulated normals
  for (let i = 0; i < numVertices; i++) {
    const nx = smoothNormals[i*3], ny = smoothNormals[i*3+1], nz = smoothNormals[i*3+2];
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    smoothNormals[i*3] /= len;
    smoothNormals[i*3+1] /= len;
    smoothNormals[i*3+2] /= len;
  }

  // Assign face to cube face using mean vertex normal (matching PyTorch)
  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];
    const fnx = smoothNormals[i0*3] + smoothNormals[i1*3] + smoothNormals[i2*3];
    const fny = smoothNormals[i0*3+1] + smoothNormals[i1*3+1] + smoothNormals[i2*3+1];
    const fnz = smoothNormals[i0*3+2] + smoothNormals[i1*3+2] + smoothNormals[i2*3+2];
    const ax = Math.abs(fnx), ay = Math.abs(fny), az = Math.abs(fnz);
    if (ax >= ay && ax >= az) {
      faceAssignment[f] = fnx > 0 ? 0 : 1;
    } else if (ay >= ax && ay >= az) {
      faceAssignment[f] = fny > 0 ? 2 : 3;
    } else {
      faceAssignment[f] = fnz > 0 ? 4 : 5;
    }
  }

  // Compute bbox from ROTATED vertices for UV normalization
  let bboxMin = [Infinity, Infinity, Infinity];
  let bboxMax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < numVertices; i++) {
    for (let a = 0; a < 3; a++) {
      const v = rotVerts[i * 3 + a];
      if (v < bboxMin[a]) bboxMin[a] = v;
      if (v > bboxMax[a]) bboxMax[a] = v;
    }
  }
  const bboxRange = [
    (bboxMax[0] - bboxMin[0]) || 1,
    (bboxMax[1] - bboxMin[1]) || 1,
    (bboxMax[2] - bboxMin[2]) || 1,
  ];

  // Normalize ROTATED vertex positions to [-1, 1] matching PyTorch
  const vNorm = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    for (let a = 0; a < 3; a++) {
      vNorm[i * 3 + a] = (rotVerts[i * 3 + a] - bboxMin[a]) / bboxRange[a] * 2 - 1;
    }
  }

  // UV projection axes matching PyTorch exactly:
  //   +X (0): uc = y,  vc = -z
  //   -X (1): uc = y,  vc = -z
  //   +Y (2): uc = x,  vc = -z
  //   -Y (3): uc = x,  vc = -z
  //   +Z (4): uc = x,  vc = y
  //   -Z (5): uc = x,  vc = -y
  // abs_axis uses the corresponding position axis for max_dim_div
  // +X/-X use abs(x), +Y/-Y use abs(y), +Z/-Z use abs(z)

  // Depth axis per cube face (perpendicular to projection plane)
  const depthAxis = [0, 0, 1, 1, 2, 2];
  const depthKeepMax = [true, false, true, false, true, false];

  // --- Step 1: Compute raw [0,1] UVs and depth centroids ---
  // Matching PyTorch: project normalized positions, divide by max_dim_div per face, then to [0,1]
  const rawU = new Float32Array(numFaces * 3);
  const rawV = new Float32Array(numFaces * 3);
  const centroidDepth = new Float32Array(numFaces);

  for (let f = 0; f < numFaces; f++) {
    const cubeF = faceAssignment[f];
    const dAxis = depthAxis[cubeF];

    let depthSum = 0;
    for (let vi = 0; vi < 3; vi++) {
      const idx = faces[f * 3 + vi];
      let uc, vc;
      // Project matching PyTorch axes (positions already in [-1, 1])
      if (cubeF <= 1) {       // +X, -X: uc = y, vc = -z
        uc = vNorm[idx * 3 + 1];
        vc = -vNorm[idx * 3 + 2];
      } else if (cubeF <= 3) { // +Y, -Y: uc = x, vc = -z
        uc = vNorm[idx * 3];
        vc = -vNorm[idx * 3 + 2];
      } else if (cubeF === 4) { // +Z: uc = x, vc = y
        uc = vNorm[idx * 3];
        vc = vNorm[idx * 3 + 1];
      } else {                  // -Z: uc = x, vc = -y
        uc = vNorm[idx * 3];
        vc = -vNorm[idx * 3 + 1];
      }
      // Map from [-1, 1] to [0, 1] (max_dim_div is always 1.0 in PyTorch)
      rawU[f * 3 + vi] = Math.max(0, Math.min(1, (uc + 1) * 0.5));
      rawV[f * 3 + vi] = Math.max(0, Math.min(1, (vc + 1) * 0.5));
      depthSum += rotVerts[idx * 3 + dAxis];
    }
    centroidDepth[f] = depthSum / 3;
  }

  // --- Step 1b: Rotate UV slices to consistent tangent space ---
  // Uses ROTATED positions and normals (same coordinate space as UV projection).
  _rotateUVSlicesConsistentSpace(
    rotVerts, smoothNormals, faces, rawU, rawV, faceAssignment, numVertices, numFaces
  );

  // --- Step 2: Detect UV overlaps and assign atlas indices ---
  // 0-5 = primary, 6-11 = first overlap, 12 = remaining
  const atlasIndex = new Int32Array(numFaces);
  for (let f = 0; f < numFaces; f++) atlasIndex[f] = faceAssignment[f];

  _detectOverlapsBVH(numFaces, atlasIndex, rawU, rawV, centroidDepth, depthKeepMax, 0);
  _detectOverlapsBVH(numFaces, atlasIndex, rawU, rawV, centroidDepth, depthKeepMax, 6);

  // --- Step 2b: Per-island UV normalization for secondary tier (slots 6-11) ---
  // Matching PyTorch _handle_slice_uvs: rescale all faces in each secondary
  // slot so their UVs fill [0,1], with max 2x magnification (clip denom at 0.5).
  for (let slot = 6; slot < 12; slot++) {
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    let count = 0;
    for (let f = 0; f < numFaces; f++) {
      if (atlasIndex[f] !== slot) continue;
      count++;
      for (let vi = 0; vi < 3; vi++) {
        const u = rawU[f*3+vi], v = rawV[f*3+vi];
        if (u < minU) minU = u; if (u > maxU) maxU = u;
        if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
    }
    if (count === 0) continue;
    const rangeU = Math.max(maxU - minU, 0.5); // clip at 0.5 = max 2x magnification
    const rangeV = Math.max(maxV - minV, 0.5);
    for (let f = 0; f < numFaces; f++) {
      if (atlasIndex[f] !== slot) continue;
      for (let vi = 0; vi < 3; vi++) {
        rawU[f*3+vi] = (rawU[f*3+vi] - minU) / rangeU;
        rawV[f*3+vi] = (rawV[f*3+vi] - minV) / rangeV;
      }
    }
  }

  // --- Step 3: Build per-face-vertex arrays ---
  // Compute UNROTATED smooth normals for GLB export (from original vertices).
  const origNormals = new Float32Array(numVertices * 3);
  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];
    const e1x = vertices[i1*3] - vertices[i0*3];
    const e1y = vertices[i1*3+1] - vertices[i0*3+1];
    const e1z = vertices[i1*3+2] - vertices[i0*3+2];
    const e2x = vertices[i2*3] - vertices[i0*3];
    const e2y = vertices[i2*3+1] - vertices[i0*3+1];
    const e2z = vertices[i2*3+2] - vertices[i0*3+2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const idx of [i0, i1, i2]) {
      origNormals[idx*3] += nx; origNormals[idx*3+1] += ny; origNormals[idx*3+2] += nz;
    }
  }
  for (let i = 0; i < numVertices; i++) {
    const nx = origNormals[i*3], ny = origNormals[i*3+1], nz = origNormals[i*3+2];
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
    origNormals[i*3] /= len; origNormals[i*3+1] /= len; origNormals[i*3+2] /= len;
  }

  const newNumVertices = numFaces * 3;
  const newNumFaces = numFaces;
  const newVertices = new Float32Array(newNumVertices * 3);
  const newNormals = new Float32Array(newNumVertices * 3);
  const newFaces = new Uint32Array(newNumFaces * 3);
  const uvs = new Float32Array(newNumVertices * 2);

  for (let f = 0; f < numFaces; f++) {
    for (let vi = 0; vi < 3; vi++) {
      const origIdx = faces[f * 3 + vi];
      const newIdx = f * 3 + vi;
      // ORIGINAL unrotated vertices and normals for output (triplane queries + GLB export)
      newVertices[newIdx * 3] = vertices[origIdx * 3];
      newVertices[newIdx * 3 + 1] = vertices[origIdx * 3 + 1];
      newVertices[newIdx * 3 + 2] = vertices[origIdx * 3 + 2];
      newNormals[newIdx * 3] = origNormals[origIdx * 3];
      newNormals[newIdx * 3 + 1] = origNormals[origIdx * 3 + 1];
      newNormals[newIdx * 3 + 2] = origNormals[origIdx * 3 + 2];
      newFaces[f * 3 + vi] = newIdx;
    }
  }

  // --- Step 4: Pack UVs into atlas ---
  // Layout matching PyTorch _find_slice_offset_and_scale:
  //   Primary (0-5):   3×2 grid, cell=1/3×1/3, region [0,1]×[0,2/3]
  //   Secondary (6-11): 3×2 grid, cell=1/6×1/6, region [0,1/2]×[2/3,1]
  //   Remaining (12+):  sub-cell grid in region [1/2,1]×[2/3,1]
  const pad = 0.005;

  const slotCol = [0, 1, 2, 0, 1, 2];
  const slotRow = [0, 0, 0, 1, 1, 1];

  // Collect remaining faces (atlasIndex >= 12) and compute their sub-cell grid
  const remainingFaces = [];
  for (let f = 0; f < numFaces; f++) {
    if (atlasIndex[f] >= 12) remainingFaces.push(f);
  }
  // Sub-cell grid for remaining faces: pack into [0.5,1]×[2/3,1] = 0.5 × 1/3
  const remRegionW = 0.5, remRegionH = 1 / 3;
  const remRegionX = 0.5, remRegionY = 2 / 3;
  let remGridW = 1, remGridH = 1;
  if (remainingFaces.length > 0) {
    const ratio = remRegionW / remRegionH; // aspect ratio of remaining region
    const mult = Math.sqrt(remainingFaces.length / ratio);
    remGridW = Math.max(1, Math.ceil(ratio * mult));
    remGridH = Math.max(1, Math.ceil(remainingFaces.length / remGridW));
  }
  const remCellW = remRegionW / remGridW;
  const remCellH = remRegionH / remGridH;

  // Build a map from face index to remaining-grid position
  const remFaceGridIdx = new Map();
  for (let i = 0; i < remainingFaces.length; i++) {
    remFaceGridIdx.set(remainingFaces[i], i);
  }

  for (let f = 0; f < numFaces; f++) {
    const ai = atlasIndex[f];
    const tier = Math.floor(ai / 6);
    const slot = ai % 6;
    const sc = slotCol[slot], sr = slotRow[slot];

    let offX, offY, cellW, cellH;
    if (tier === 0) {
      cellW = 1/3; cellH = 1/3;
      offX = cellW * sc;
      offY = cellH * sr;
    } else if (tier === 1) {
      cellW = 1/6; cellH = 1/6;
      offX = cellW * sc;
      offY = 2/3 + cellH * sr;
    } else {
      // Remaining: each face gets its own sub-cell
      cellW = remCellW; cellH = remCellH;
      const gi = remFaceGridIdx.get(f) || 0;
      const gx = gi % remGridW;
      const gy = Math.floor(gi / remGridW);
      offX = remRegionX + gx * cellW;
      offY = remRegionY + gy * cellH;
    }

    for (let vi = 0; vi < 3; vi++) {
      const idx = f * 3 + vi;
      // Per-face UV normalization for remaining tier:
      // normalize each triangle's UVs to fill [0,1] within its sub-cell
      let u = rawU[idx], v = rawV[idx];
      if (tier >= 2) {
        // Normalize per-triangle: find min/max across this triangle's 3 verts
        const u0 = rawU[f*3], u1 = rawU[f*3+1], u2 = rawU[f*3+2];
        const v0 = rawV[f*3], v1 = rawV[f*3+1], v2 = rawV[f*3+2];
        const uMin = Math.min(u0, u1, u2), uMax = Math.max(u0, u1, u2);
        const vMin = Math.min(v0, v1, v2), vMax = Math.max(v0, v1, v2);
        const uRange = uMax - uMin || 1;
        const vRange = vMax - vMin || 1;
        // Clamp scale to prevent extreme magnification (match PyTorch clip_val)
        const clipVal = Math.min(cellW, cellH) * 1.5;
        u = (u - uMin) / Math.max(uRange, clipVal);
        v = (v - vMin) / Math.max(vRange, clipVal);
      }
      uvs[idx * 2] = offX + pad + u * (cellW - 2 * pad);
      uvs[idx * 2 + 1] = offY + pad + v * (cellH - 2 * pad);
    }
  }

  // Diagnostic: check for degenerate UVs and out-of-bounds
  let degenerateCount = 0, oobCount = 0;
  const degFaces = [];
  for (let f = 0; f < numFaces; f++) {
    const u0 = uvs[f*6], v0 = uvs[f*6+1];
    const u1 = uvs[f*6+2], v1 = uvs[f*6+3];
    const u2 = uvs[f*6+4], v2 = uvs[f*6+5];
    // UV triangle area via cross product
    const area = Math.abs((u1-u0)*(v2-v0) - (u2-u0)*(v1-v0)) * 0.5;
    if (area < 1e-10) {
      degenerateCount++;
      if (degFaces.length < 10) degFaces.push({ f, tier: Math.floor(atlasIndex[f]/6), ai: atlasIndex[f], area, u0, v0, u1, v1, u2, v2 });
    }
    // Check OOB
    if (u0 < 0 || u0 > 1 || v0 < 0 || v0 > 1 ||
        u1 < 0 || u1 > 1 || v1 < 0 || v1 > 1 ||
        u2 < 0 || u2 > 1 || v2 < 0 || v2 > 1) oobCount++;
  }
  console.log(`UV diagnostics: degenerate=${degenerateCount}, out-of-bounds=${oobCount}, total=${numFaces}`);
  if (degFaces.length > 0) console.log(`Sample degenerate faces: ${JSON.stringify(degFaces.slice(0, 5))}`);

  // Also check: faces where all 3 UV verts map to the same texel at 1024 res
  let sameTexelCount = 0;
  const sameTexelFaces = [];
  for (let f = 0; f < numFaces; f++) {
    const px0 = Math.floor(uvs[f*6] * 1024), py0 = Math.floor(uvs[f*6+1] * 1024);
    const px1 = Math.floor(uvs[f*6+2] * 1024), py1 = Math.floor(uvs[f*6+3] * 1024);
    const px2 = Math.floor(uvs[f*6+4] * 1024), py2 = Math.floor(uvs[f*6+5] * 1024);
    if (px0 === px1 && px1 === px2 && py0 === py1 && py1 === py2) {
      sameTexelCount++;
      if (sameTexelFaces.length < 5) sameTexelFaces.push({ f, tier: Math.floor(atlasIndex[f]/6), ai: atlasIndex[f] });
    }
  }
  console.log(`Faces mapping to single texel at 1024: ${sameTexelCount} (these get 0 rasterized texels)`);
  // Check: how many secondary/remaining faces have UV area < 1 texel at 1024?
  let subTexelSecondary = 0, subTexelRemaining = 0;
  for (let f = 0; f < numFaces; f++) {
    const tier = Math.floor(atlasIndex[f] / 6);
    if (tier === 0) continue;
    const u0 = uvs[f*6], v0 = uvs[f*6+1];
    const u1 = uvs[f*6+2], v1 = uvs[f*6+3];
    const u2 = uvs[f*6+4], v2 = uvs[f*6+5];
    const texelArea = Math.abs((u1-u0)*(v2-v0) - (u2-u0)*(v1-v0)) * 0.5 * 1024 * 1024;
    if (texelArea < 1.0) {
      if (tier === 1) subTexelSecondary++;
      else subTexelRemaining++;
    }
  }
  console.log(`Sub-texel faces: secondary=${subTexelSecondary}, remaining=${subTexelRemaining}`);
  if (sameTexelFaces.length > 0) console.log(`Sample same-texel faces: ${JSON.stringify(sameTexelFaces)}`);

  // Diagnostic: count faces per tier
  const tierCounts = [0, 0, 0];
  for (let f = 0; f < numFaces; f++) {
    const t = Math.min(Math.floor(atlasIndex[f] / 6), 2);
    tierCounts[t]++;
  }
  console.log(`Atlas tiers: primary=${tierCounts[0]}, secondary=${tierCounts[1]}, remaining=${tierCounts[2]}, total=${numFaces}`);

  return { uvs, newVertices, newNormals, newFaces, newNumVertices, newNumFaces, faceAssignment: atlasIndex };
}

/**
 * Detect UV overlaps using BVH-accelerated triangle-triangle intersection.
 * Matching PyTorch's BVH approach: build a BVH per cube face slot, test each
 * triangle against the BVH, bump the occluded face (by depth) to slot+6.
 */
function _detectOverlapsBVH(numFaces, atlasIndex, rawU, rawV, centroidDepth,
    depthKeepMax, slotOffset) {

  for (let slot = slotOffset; slot < slotOffset + 6; slot++) {
    const slotFaces = [];
    for (let f = 0; f < numFaces; f++) {
      if (atlasIndex[f] === slot) slotFaces.push(f);
    }
    if (slotFaces.length < 2) continue;

    const baseSlot = slot % 6;
    const keepMax = depthKeepMax[baseSlot];

    // Build BVH from triangles in this slot
    const tris = slotFaces.map(f => ({
      f,
      u0: rawU[f*3], v0: rawV[f*3],
      u1: rawU[f*3+1], v1: rawV[f*3+1],
      u2: rawU[f*3+2], v2: rawV[f*3+2],
      minU: Math.min(rawU[f*3], rawU[f*3+1], rawU[f*3+2]),
      maxU: Math.max(rawU[f*3], rawU[f*3+1], rawU[f*3+2]),
      minV: Math.min(rawV[f*3], rawV[f*3+1], rawV[f*3+2]),
      maxV: Math.max(rawV[f*3], rawV[f*3+1], rawV[f*3+2]),
    }));

    const bvh = _buildBVH2D(tris);

    // For each triangle, query the BVH for overlapping triangles
    const bumped = new Set();
    // Collect all unique intersection pairs first (matching PyTorch)
    const pairs = [];

    for (const tri of tris) {
      if (bumped.has(tri.f)) continue;
      const candidates = _queryBVH2D(bvh, tri);
      for (const other of candidates) {
        if (other.f === tri.f || bumped.has(other.f)) continue;
        if (_trianglesOverlap2D(tri, other)) {
          const a = Math.min(tri.f, other.f);
          const b = Math.max(tri.f, other.f);
          pairs.push([a, b]);
        }
      }
    }

    // Deduplicate pairs and determine which face to bump (by depth)
    const seen = new Set();
    const occludedSet = new Set();
    for (const [a, b] of pairs) {
      const key = a * numFaces + b;
      if (seen.has(key)) continue;
      seen.add(key);

      // Determine which is occluded based on depth along cube face axis
      let occluded;
      if (keepMax) {
        occluded = (centroidDepth[a] >= centroidDepth[b]) ? a : b;
      } else {
        occluded = (centroidDepth[a] <= centroidDepth[b]) ? a : b;
      }
      occludedSet.add(occluded);
    }

    // Bump all occluded faces
    for (const f of occludedSet) {
      atlasIndex[f] = Math.min(atlasIndex[f] + 6, 12);
      bumped.add(f);
    }
  }
}

/** Build a simple 2D AABB BVH over triangles. */
function _buildBVH2D(tris) {
  if (tris.length <= 4) return { tris, left: null, right: null };

  // Find split axis (longest extent)
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const t of tris) {
    if (t.minU < minU) minU = t.minU;
    if (t.maxU > maxU) maxU = t.maxU;
    if (t.minV < minV) minV = t.minV;
    if (t.maxV > maxV) maxV = t.maxV;
  }

  const extU = maxU - minU, extV = maxV - minV;
  const axis = extU >= extV ? 'u' : 'v';

  // Sort by centroid on split axis and split at median
  const sorted = tris.slice().sort((a, b) => {
    const ca = axis === 'u' ? (a.minU + a.maxU) : (a.minV + a.maxV);
    const cb = axis === 'u' ? (b.minU + b.maxU) : (b.minV + b.maxV);
    return ca - cb;
  });

  const mid = sorted.length >> 1;
  return {
    tris: null,
    minU, maxU, minV, maxV,
    left: _buildBVH2D(sorted.slice(0, mid)),
    right: _buildBVH2D(sorted.slice(mid)),
  };
}

/** Query a 2D BVH for triangles whose AABB overlaps the query triangle's AABB. */
function _queryBVH2D(node, tri) {
  if (node.tris) {
    // Leaf: return triangles whose AABBs overlap
    const result = [];
    for (const t of node.tris) {
      if (t.maxU >= tri.minU && t.minU <= tri.maxU &&
          t.maxV >= tri.minV && t.minV <= tri.maxV) {
        result.push(t);
      }
    }
    return result;
  }

  // Interior: check AABB overlap with node bounds
  if (node.maxU < tri.minU || node.minU > tri.maxU ||
      node.maxV < tri.minV || node.minV > tri.maxV) {
    return [];
  }

  const left = _queryBVH2D(node.left, tri);
  const right = _queryBVH2D(node.right, tri);
  return left.concat(right);
}

/**
 * 2D triangle-triangle overlap test with area threshold.
 * Matching PyTorch: two triangles "overlap" only if their intersection polygon
 * has area > 1e-10. This filters out edge-touching adjacent faces (zero area)
 * while catching true UV overlaps from different surfaces.
 */
function _trianglesOverlap2D(a, b) {
  // Compute intersection polygon via Sutherland-Hodgman clipping
  const area = _triangleIntersectionArea2D(
    a.u0, a.v0, a.u1, a.v1, a.u2, a.v2,
    b.u0, b.v0, b.u1, b.v1, b.u2, b.v2
  );
  return area > 1e-10;
}

/** Compute the area of intersection between two 2D triangles via polygon clipping. */
function _triangleIntersectionArea2D(
  au0,av0,au1,av1,au2,av2,
  bu0,bv0,bu1,bv1,bu2,bv2
) {
  // Sutherland-Hodgman: clip triangle B against all edges of triangle A
  let poly = [[bu0,bv0],[bu1,bv1],[bu2,bv2]];
  const clip = [[au0,av0],[au1,av1],[au2,av2]];

  for (let i = 0; i < 3; i++) {
    if (poly.length === 0) return 0;
    const [ex, ey] = clip[i];
    const [fx, fy] = clip[(i + 1) % 3];
    const output = [];

    for (let j = 0; j < poly.length; j++) {
      const [cx, cy] = poly[j];
      const [dx, dy] = poly[(j + 1) % poly.length];
      const cSide = (fx - ex) * (cy - ey) - (fy - ey) * (cx - ex);
      const dSide = (fx - ex) * (dy - ey) - (fy - ey) * (dx - ex);

      if (cSide >= 0) {
        output.push([cx, cy]);
        if (dSide < 0) {
          output.push(_lineIntersect2D(cx, cy, dx, dy, ex, ey, fx, fy));
        }
      } else if (dSide >= 0) {
        output.push(_lineIntersect2D(cx, cy, dx, dy, ex, ey, fx, fy));
      }
    }
    poly = output;
  }

  if (poly.length < 3) return 0;

  // Shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) * 0.5;
}

function _lineIntersect2D(ax, ay, bx, by, cx, cy, dx, dy) {
  const denom = (ax - bx) * (cy - dy) - (ay - by) * (cx - dx);
  if (Math.abs(denom) < 1e-15) return [(ax + bx) * 0.5, (ay + by) * 0.5];
  const t = ((ax - cx) * (cy - dy) - (ay - cy) * (cx - dx)) / denom;
  return [ax + t * (bx - ax), ay + t * (by - ay)];
}

/**
 * Rasterize UV space to get 3D positions and TBN basis at each texel.
 *
 * For each triangle in UV space, rasterize its bounding box and compute
 * barycentric interpolation of 3D positions. Also computes per-face
 * tangent/bitangent/normal basis from UV edges and position edges.
 *
 * @param {Float32Array} uvs - [N_v * 2] UV coordinates
 * @param {Float32Array} positions - [N_v * 3] vertex positions
 * @param {Uint32Array} faces - [N_f * 3] face indices
 * @param {number} numFaces
 * @param {number} resolution - texture resolution (default 1024)
 * @param {Uint8Array} [_faceAssignment] - unused, kept for API compat
 * @returns {{ positions3D: Float32Array, mask: Uint8Array, tbnData: Float32Array }}
 */
function rasterizeUV(uvs, positions, faces, numFaces, resolution = 1024, _faceAssignment = null) {
  const positions3D = new Float32Array(resolution * resolution * 3);
  const mask = new Uint8Array(resolution * resolution);
  // TBN: 9 floats per texel (tangent[3], bitangent[3], normal[3])
  const tbnData = new Float32Array(resolution * resolution * 9);

  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];

    const u0 = uvs[i0 * 2], v0 = uvs[i0 * 2 + 1];
    const u1 = uvs[i1 * 2], v1 = uvs[i1 * 2 + 1];
    const u2 = uvs[i2 * 2], v2 = uvs[i2 * 2 + 1];

    const p0x = positions[i0*3], p0y = positions[i0*3+1], p0z = positions[i0*3+2];
    const p1x = positions[i1*3], p1y = positions[i1*3+1], p1z = positions[i1*3+2];
    const p2x = positions[i2*3], p2y = positions[i2*3+1], p2z = positions[i2*3+2];

    // Compute face TBN from edges and UV deltas
    const e1x = p1x-p0x, e1y = p1y-p0y, e1z = p1z-p0z;
    const e2x = p2x-p0x, e2y = p2y-p0y, e2z = p2z-p0z;
    const duv1u = u1-u0, duv1v = v1-v0;
    const duv2u = u2-u0, duv2v = v2-v0;

    // Face normal
    let fnx = e1y*e2z - e1z*e2y;
    let fny = e1z*e2x - e1x*e2z;
    let fnz = e1x*e2y - e1y*e2x;
    let fnLen = Math.sqrt(fnx*fnx + fny*fny + fnz*fnz) || 1;
    fnx /= fnLen; fny /= fnLen; fnz /= fnLen;

    // Tangent from UV gradients: T = (e1 * duv2v - e2 * duv1v) / det
    const det = duv1u * duv2v - duv1v * duv2u;
    let tx, ty, tz, bx, by, bz;
    if (Math.abs(det) > 1e-10) {
      const invDet = 1.0 / det;
      tx = (e1x * duv2v - e2x * duv1v) * invDet;
      ty = (e1y * duv2v - e2y * duv1v) * invDet;
      tz = (e1z * duv2v - e2z * duv1v) * invDet;
    } else {
      // Degenerate UV: pick arbitrary tangent perpendicular to normal
      tx = 1; ty = 0; tz = 0;
      if (Math.abs(fnx) > 0.9) { tx = 0; ty = 1; }
    }

    // Orthogonalize tangent against normal (Gram-Schmidt)
    const tDotN = tx*fnx + ty*fny + tz*fnz;
    tx -= tDotN * fnx; ty -= tDotN * fny; tz -= tDotN * fnz;
    let tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;

    // Bitangent = cross(normal, tangent)
    bx = fny*tz - fnz*ty;
    by = fnz*tx - fnx*tz;
    bz = fnx*ty - fny*tx;
    let bLen = Math.sqrt(bx*bx + by*by + bz*bz) || 1;
    bx /= bLen; by /= bLen; bz /= bLen;

    // Bounding box in pixel coords
    const minPx = Math.max(0, Math.floor(Math.min(u0, u1, u2) * resolution));
    const maxPx = Math.min(resolution - 1, Math.ceil(Math.max(u0, u1, u2) * resolution));
    const minPy = Math.max(0, Math.floor(Math.min(v0, v1, v2) * resolution));
    const maxPy = Math.min(resolution - 1, Math.ceil(Math.max(v0, v1, v2) * resolution));

    const denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
    if (Math.abs(denom) < 1e-10) continue;
    const invDenom = 1.0 / denom;

    for (let py = minPy; py <= maxPy; py++) {
      for (let px = minPx; px <= maxPx; px++) {
        const u = (px + 0.5) / resolution;
        const v = (py + 0.5) / resolution;

        const w0 = ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) * invDenom;
        const w1 = ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) * invDenom;
        const w2 = 1 - w0 - w1;

        if (w0 >= -1e-3 && w1 >= -1e-3 && w2 >= -1e-3) {
          const pixIdx = py * resolution + px;
          mask[pixIdx] = 1;
          positions3D[pixIdx * 3] = w0 * p0x + w1 * p1x + w2 * p2x;
          positions3D[pixIdx * 3 + 1] = w0 * p0y + w1 * p1y + w2 * p2y;
          positions3D[pixIdx * 3 + 2] = w0 * p0z + w1 * p1z + w2 * p2z;
          // TBN is constant per face (vertices are duplicated per face)
          const tbnBase = pixIdx * 9;
          tbnData[tbnBase]   = tx; tbnData[tbnBase+1] = ty; tbnData[tbnBase+2] = tz;
          tbnData[tbnBase+3] = bx; tbnData[tbnBase+4] = by; tbnData[tbnBase+5] = bz;
          tbnData[tbnBase+6] = fnx; tbnData[tbnBase+7] = fny; tbnData[tbnBase+8] = fnz;
        }
      }
    }
  }

  // Sub-texel face coverage: for faces whose UV triangle is smaller than
  // 1 texel, write face centroid position to unoccupied texels only.
  // CONDITIONAL write: never overwrite texels already covered by the main
  // rasterization pass, to avoid corrupting larger faces' data.
  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];
    const u0 = uvs[i0*2], v0 = uvs[i0*2+1];
    const u1 = uvs[i1*2], v1 = uvs[i1*2+1];
    const u2 = uvs[i2*2], v2 = uvs[i2*2+1];

    // Check UV triangle area in texels
    const texelArea = Math.abs((u1-u0)*(v2-v0) - (u2-u0)*(v1-v0)) * 0.5 * resolution * resolution;
    if (texelArea >= 1.0) continue; // adequately rasterized, skip

    // Face centroid in 3D
    const p0x = positions[i0*3], p0y = positions[i0*3+1], p0z = positions[i0*3+2];
    const p1x = positions[i1*3], p1y = positions[i1*3+1], p1z = positions[i1*3+2];
    const p2x = positions[i2*3], p2y = positions[i2*3+1], p2z = positions[i2*3+2];
    const cx = (p0x + p1x + p2x) / 3;
    const cy = (p0y + p1y + p2y) / 3;
    const cz = (p0z + p1z + p2z) / 3;

    // Face TBN
    const e1x = p1x-p0x, e1y = p1y-p0y, e1z = p1z-p0z;
    const e2x = p2x-p0x, e2y = p2y-p0y, e2z = p2z-p0z;
    let fnx = e1y*e2z - e1z*e2y, fny = e1z*e2x - e1x*e2z, fnz = e1x*e2y - e1y*e2x;
    const fnLen = Math.sqrt(fnx*fnx + fny*fny + fnz*fnz) || 1;
    fnx /= fnLen; fny /= fnLen; fnz /= fnLen;
    let tx = 1, ty = 0, tz = 0;
    if (Math.abs(fnx) > 0.9) { tx = 0; ty = 1; }
    const tDotN = tx*fnx + ty*fny + tz*fnz;
    tx -= tDotN*fnx; ty -= tDotN*fny; tz -= tDotN*fnz;
    const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    tx /= tLen; ty /= tLen; tz /= tLen;
    const bx = fny*tz - fnz*ty, by = fnz*tx - fnx*tz, bz = fnx*ty - fny*tx;

    // Write to unoccupied texels at vertex and centroid positions
    const texels = new Set();
    for (const [pu, pv] of [[u0,v0],[u1,v1],[u2,v2],[(u0+u1+u2)/3,(v0+v1+v2)/3]]) {
      const px = Math.min(resolution-1, Math.max(0, Math.floor(pu * resolution)));
      const py = Math.min(resolution-1, Math.max(0, Math.floor(pv * resolution)));
      texels.add(py * resolution + px);
    }

    for (const pixIdx of texels) {
      if (mask[pixIdx]) continue; // don't overwrite correctly-rasterized texels
      mask[pixIdx] = 1;
      positions3D[pixIdx * 3] = cx;
      positions3D[pixIdx * 3 + 1] = cy;
      positions3D[pixIdx * 3 + 2] = cz;
      const tbnBase = pixIdx * 9;
      tbnData[tbnBase] = tx; tbnData[tbnBase+1] = ty; tbnData[tbnBase+2] = tz;
      tbnData[tbnBase+3] = bx; tbnData[tbnBase+4] = by; tbnData[tbnBase+5] = bz;
      tbnData[tbnBase+6] = fnx; tbnData[tbnBase+7] = fny; tbnData[tbnBase+8] = fnz;
    }
  }

  return { positions3D, mask, tbnData };
}

/**
 * Bake albedo texture and normal map by querying the triplane decoder.
 *
 * @param {GPUDevice} device
 * @param {Object} triplaneDecoder - TriplaneDecoder instance
 * @param {GPUBuffer} triplanesBuf - [3, 40, 384, 384] triplane features
 * @param {Object} decoderWeights - decoder weights
 * @param {Float32Array} positions3D - [res*res, 3] from rasterizeUV
 * @param {Uint8Array} mask - [res*res] from rasterizeUV
 * @param {Float32Array} tbnData - [res*res, 9] TBN basis from rasterizeUV
 * @param {number} resolution
 * @returns {{ albedo: Uint8Array, normalMap: Uint8Array }} - [res, res, 4] RGBA textures
 */
/**
 * Decode features + perturb_normal for numOccupied query positions.
 *
 * Monolithic by default (one decode dispatch + one fence + one readback).
 * When `options.cooperativeBatch(batchStart, batchEnd, decodeBatch)` is supplied,
 * the texels are split into fixed batches and each batch is decoded as its own
 * GPU command duty via the caller's cooperative driver — collapsing the single
 * ~231ms contiguous decode+readback into yieldable batches. Per-texel decode is
 * independent, so batch outputs concatenated in order are byte-identical to the
 * monolithic path.
 *
 * @returns {Promise<{featuresCPU: Float32Array, normalsCPU: Float32Array}>}
 */
async function decodeTexelFeatures(device, triplaneDecoder, triplanesBuf, decoderWeights,
                                          queryPositions, numOccupied, options = {}) {
  const decodeRange = async (start, end) => {
    const count = end - start;
    const sub = queryPositions.subarray(start * 3, end * 3);
    const startedAtMs = performance.now();
    const { value, allocations } = captureGpuBufferAllocations(() => {
      const posBuf = createStorageBuffer(device, sub);
      const encoder = device.createCommandEncoder({ label: `texel-decode-${start}-${end}` });
      const decoded = triplaneDecoder.decode(
        encoder, posBuf, triplanesBuf, count, decoderWeights, ['features', 'perturb_normal']);
      return { encoder, decoded, count };
    });
    return {
      ...value,
      hostEncodeMs: performance.now() - startedAtMs,
      scratchResources: allocations,
    };
  };

  const featuresCPU = new Float32Array(numOccupied * 3);
  const normalsCPU = new Float32Array(numOccupied * 3);

  if (typeof options.cooperativeBatch === 'function') {
    // Cooperative path: each batch's decode is a GPU duty (submit + facade
    // fence + browser yield). Crucially, batch outputs are copied into ONE
    // shared persistent buffer on the GPU (no per-batch readback) and read back
    // exactly ONCE at the end — otherwise a per-batch mapAsync forces a GPU sync
    // per batch and fine batching regresses badly (measured 1808ms at 61
    // batches). Coalesced readback keeps cooperation between decode duties only.
    //
    // Optional decoder scratch arena (options.arena): when present, the decoder
    // reuses one pre-allocated buffer per slot across all ranges instead of
    // rebuilding ~30 transient buffers per range (~1.015GB churn per Cranial's
    // assay). Arena slots bypass createEmptyBuffer, so captureGpuBufferAllocations
    // no longer records them — per-range scratchResources collapses to just the
    // small query-position buffer, and the existing per-prefix retire logic
    // still lawfully retires that. Exact per-range prefix completion is unchanged.
    const priorSlotProvider = triplaneDecoder._slotProvider;
    if (options.arena) triplaneDecoder._slotProvider = options.arena;
    const featuresAll = createEmptyBuffer(device, numOccupied * 3 * 4);
    const normalsAll = createEmptyBuffer(device, numOccupied * 3 * 4);
    try {
    await options.cooperativeBatch(numOccupied, async (start, end) => {
      const { encoder, decoded, count, hostEncodeMs, scratchResources } = await decodeRange(start, end);
      // Copy this batch's decode outputs into their slice of the shared buffers,
      // in the SAME command buffer, so no extra submit/sync is needed.
      encoder.copyBufferToBuffer(decoded.features, 0, featuresAll, start * 3 * 4, count * 3 * 4);
      encoder.copyBufferToBuffer(decoded.perturb_normal, 0, normalsAll, start * 3 * 4, count * 3 * 4);
      return {
        encode: () => encoder.finish(),
        submit: (cb) => device.queue.submit([cb]),
        hostEncodeMs,
        scratchResources,
      };
    });
    // Single coalesced readback of all batches.
    const readbackStartedAtMs = performance.now();
    let f;
    let n;
    try {
      f = await readBuffer(device, featuresAll, numOccupied * 3 * 4);
      n = await readBuffer(device, normalsAll, numOccupied * 3 * 4);
    } finally {
      featuresAll.destroy();
      normalsAll.destroy();
    }
    if (options.telemetry) {
      const readbackCompletedAtMs = performance.now();
      options.telemetry.readbackMs = readbackCompletedAtMs - readbackStartedAtMs;
      options.telemetry.readbackInterval = {
        startMs: readbackStartedAtMs,
        endMs: readbackCompletedAtMs,
      };
      options.telemetry.aggregateOutputBytes = numOccupied * 3 * 4 * 2;
      options.telemetry.aggregateOutputsRetired = true;
    }
    featuresCPU.set(f.subarray(0, numOccupied * 3));
    normalsCPU.set(n.subarray(0, numOccupied * 3));
    return { featuresCPU, normalsCPU };
    } finally {
      // Restore the decoder's slot provider so a non-arena decode later is
      // unaffected. The arena's own lifetime (allocation/retirement) is owned by
      // the phase-resource lease at the call site, not here.
      triplaneDecoder._slotProvider = priorSlotProvider;
    }
  }

  // Monolithic default (unchanged behavior).
  const { encoder, decoded } = await decodeRange(0, numOccupied);
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const f = await readBuffer(device, decoded.features, numOccupied * 3 * 4);
  const n = await readBuffer(device, decoded.perturb_normal, numOccupied * 3 * 4);
  featuresCPU.set(f.subarray(0, numOccupied * 3));
  normalsCPU.set(n.subarray(0, numOccupied * 3));
  return { featuresCPU, normalsCPU };
}

async function bakeTexture(device, triplaneDecoder, triplanesBuf, decoderWeights,
                                   positions3D, mask, tbnData, resolution = 1024, options = {}) {
  const cpuPrepStartedAtMs = performance.now();
  // Collect occupied texel positions
  const occupiedIndices = [];
  for (let i = 0; i < resolution * resolution; i++) {
    if (mask[i]) occupiedIndices.push(i);
  }

  const numOccupied = occupiedIndices.length;
  console.log(`Texture bake: ${numOccupied} occupied texels out of ${resolution * resolution}`);

  const emptyTex = new Uint8Array(resolution * resolution * 4);
  if (numOccupied === 0) {
    return { albedo: emptyTex, normalMap: new Uint8Array(emptyTex) };
  }

  // Pack occupied positions into a dense array
  const queryPositions = new Float32Array(numOccupied * 3);
  for (let i = 0; i < numOccupied; i++) {
    const idx = occupiedIndices[i];
    queryPositions[i * 3] = positions3D[idx * 3];
    queryPositions[i * 3 + 1] = positions3D[idx * 3 + 1];
    queryPositions[i * 3 + 2] = positions3D[idx * 3 + 2];
  }

  // Decode features + perturb_normal for every occupied texel. Per-texel decode
  // is fully independent, so this is monolithic by default but can be driven in
  // cooperative batches via options.cooperativeBatch (see decodeTexelFeatures).
  if (options.telemetry) {
    const cpuPrepCompletedAtMs = performance.now();
    options.telemetry.cpuPrepMs = cpuPrepCompletedAtMs - cpuPrepStartedAtMs;
    options.telemetry.cpuPrepInterval = {
      startMs: cpuPrepStartedAtMs,
      endMs: cpuPrepCompletedAtMs,
    };
  }
  const { featuresCPU, normalsCPU } = await decodeTexelFeatures(
    device, triplaneDecoder, triplanesBuf, decoderWeights, queryPositions, numOccupied, options);
  const materializationStartedAtMs = performance.now();

  // Materialize albedo + normal textures (+ dilation). Cranial's assay's ~752ms
  // single-threaded CPU tail. Optionally offloaded to a Web Worker
  // (options.materializeWorker) — byte-identical (same materialize_core math),
  // with no GPU sync and no per-duty fence floor. Main-thread path is the same
  // pure function.
  let albedo, normalMap, workerTransferMs = null;
  const matInput = { featuresCPU, normalsCPU, occupiedIndices, tbnData, mask, resolution, numOccupied };

  if (options.materializeWorker) {
    const worker = options.materializeWorker;
    const id = `mat-${Math.random().toString(36).slice(2)}`;
    // Copy the transferables so the caller's arrays stay intact; one copy each.
    const featuresBuf = featuresCPU.slice().buffer;
    const normalsBuf = normalsCPU.slice().buffer;
    const occupiedBuf = (occupiedIndices instanceof Uint32Array ? occupiedIndices : Uint32Array.from(occupiedIndices)).slice().buffer;
    const tbnBuf = tbnData.slice().buffer;
    const maskBuf = mask.slice().buffer;
    const transferStart = performance.now();
    const out = await callWorker(
      worker,
      { featuresBuf, normalsBuf, occupiedBuf, tbnBuf, maskBuf, resolution, numOccupied, id },
      [featuresBuf, normalsBuf, occupiedBuf, tbnBuf, maskBuf],
      {
        timeoutMs: options.workerTimeoutMs || 60000,
        onResult: (d) => {
          const a = new Uint8Array(d.albedo);
          const n = new Uint8Array(d.normalMap);
          const expected = resolution * resolution * 4;
          if (a.length !== expected || n.length !== expected) {
            throw new Error(`materialize output size ${a.length}/${n.length} != ${expected}`);
          }
          return { albedo: a, normalMap: n };
        },
      },
    );
    albedo = out.albedo; normalMap = out.normalMap;
    workerTransferMs = performance.now() - transferStart;
  } else {
    const m = materializeTextures(matInput);
    albedo = m.albedo; normalMap = m.normalMap;
  }
  const materializationCompletedAtMs = performance.now();

  if (options.telemetry) {
    options.telemetry.cpuMaterializationMs = materializationCompletedAtMs - materializationStartedAtMs;
    options.telemetry.cpuMaterializationInterval = {
      startMs: materializationStartedAtMs,
      endMs: materializationCompletedAtMs,
    };
    options.telemetry.materializationOffloaded = Boolean(options.materializeWorker);
    options.telemetry.materializationWorkerTransferMs = workerTransferMs;
  }
  return { albedo, normalMap };
}

/**
 * Export mesh as GLB (binary glTF 2.0).
 *
 * @param {Float32Array} vertices - [N_v * 3]
 * @param {Float32Array} vertexNormals - [N_v * 3] pre-computed smooth normals
 * @param {Uint32Array} faces - [N_f * 3]
 * @param {Float32Array} uvs - [N_v * 2]
 * @param {Uint8Array} albedoTexture - [res, res, 4] RGBA
 * @param {Uint8Array|null} normalMapTexture - [res, res, 4] RGBA or null
 * @param {number} numVertices
 * @param {number} numFaces
 * @param {number} textureResolution
 * @param {number} roughness
 * @param {number} metallic
 * @returns {ArrayBuffer} GLB binary
 */
async function exportGLB(vertices, vertexNormals, faces, uvs,
                                 albedoTexture, normalMapTexture,
                                 numVertices, numFaces, textureResolution = 1024,
                                 roughness = 0.5, metallic = 0.0) {
  if (numVertices === 0 || numFaces === 0) {
    throw new Error('Cannot export empty mesh as GLB');
  }

  // Apply coordinate transforms to match glTF conventions
  // Combined: rot(-90, X) then rot(+90, Y) gives (x,y,z) → (-y, z, -x)
  // Then invert face winding to match PyTorch's mesh.invert()
  const transformedVerts = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    const x = vertices[i * 3];
    const y = vertices[i * 3 + 1];
    const z = vertices[i * 3 + 2];
    const rx = x, ry = z, rz = -y;
    transformedVerts[i * 3] = rz;
    transformedVerts[i * 3 + 1] = ry;
    transformedVerts[i * 3 + 2] = -rx;
  }

  const invertedFaces = new Uint32Array(numFaces * 3);
  for (let f = 0; f < numFaces; f++) {
    invertedFaces[f * 3] = faces[f * 3];
    invertedFaces[f * 3 + 1] = faces[f * 3 + 2];
    invertedFaces[f * 3 + 2] = faces[f * 3 + 1];
  }

  // Apply same rotation to pre-computed smooth normals, then negate
  // for face inversion (winding flip makes outward normals point inward)
  // Rotation (x,y,z)→(-y,z,-x), then negate: (y,-z,x)
  const normals = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    const nx = vertexNormals[i * 3];
    const ny = vertexNormals[i * 3 + 1];
    const nz = vertexNormals[i * 3 + 2];
    normals[i * 3] = ny;
    normals[i * 3 + 1] = -nz;
    normals[i * 3 + 2] = nx;
  }

  // Encode textures as JPEG
  const albedoBlob = await _textureToJPEG(albedoTexture, textureResolution);
  if (!albedoBlob) throw new Error('Failed to encode albedo texture as JPEG');
  const albedoBytes = new Uint8Array(await albedoBlob.arrayBuffer());

  let normalBytes = null;
  if (normalMapTexture) {
    const normalBlob = await _textureToJPEG(normalMapTexture, textureResolution, 0.95);
    if (normalBlob) normalBytes = new Uint8Array(await normalBlob.arrayBuffer());
  }

  // Compute bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < numVertices; i++) {
    const x = transformedVerts[i*3], y = transformedVerts[i*3+1], z = transformedVerts[i*3+2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const pad4 = (n) => (n + 3) & -4;

  const vertexBytes = new Uint8Array(transformedVerts.buffer, transformedVerts.byteOffset, transformedVerts.byteLength);
  const vnormalBytes = new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength);
  const indexBytes = new Uint8Array(invertedFaces.buffer, invertedFaces.byteOffset, invertedFaces.byteLength);
  const uvBytes = new Uint8Array(uvs.buffer, uvs.byteOffset, uvs.byteLength);

  const vertexLen = pad4(vertexBytes.byteLength);
  const vnormalLen = pad4(vnormalBytes.byteLength);
  const indexLen = pad4(indexBytes.byteLength);
  const uvLen = pad4(uvBytes.byteLength);
  const albedoLen = pad4(albedoBytes.byteLength);
  const normalTexLen = normalBytes ? pad4(normalBytes.byteLength) : 0;
  const totalBinLen = vertexLen + vnormalLen + indexLen + uvLen + albedoLen + normalTexLen;

  let off = 0;
  const bufferViews = [
    { buffer: 0, byteOffset: (off), byteLength: vertexBytes.byteLength, target: 34962 },
    { buffer: 0, byteOffset: (off += vertexLen), byteLength: vnormalBytes.byteLength, target: 34962 },
    { buffer: 0, byteOffset: (off += vnormalLen), byteLength: indexBytes.byteLength, target: 34963 },
    { buffer: 0, byteOffset: (off += indexLen), byteLength: uvBytes.byteLength, target: 34962 },
    { buffer: 0, byteOffset: (off += uvLen), byteLength: albedoBytes.byteLength }, // albedo image
  ];
  const albedoImageBV = 4;
  let normalImageBV = -1;
  if (normalBytes) {
    normalImageBV = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: (off += albedoLen), byteLength: normalBytes.byteLength });
  }

  const accessors = [
    { bufferView: 0, componentType: 5126, count: numVertices, type: 'VEC3',
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
    { bufferView: 1, componentType: 5126, count: numVertices, type: 'VEC3' },
    { bufferView: 2, componentType: 5125, count: numFaces * 3, type: 'SCALAR' },
    { bufferView: 3, componentType: 5126, count: numVertices, type: 'VEC2' },
  ];

  const images = [{ bufferView: albedoImageBV, mimeType: 'image/jpeg' }];
  const textures = [{ source: 0, sampler: 0 }];
  if (normalBytes) {
    images.push({ bufferView: normalImageBV, mimeType: 'image/jpeg' });
    textures.push({ source: 1, sampler: 0 });
  }

  const material = {
    pbrMetallicRoughness: {
      baseColorTexture: { index: 0 },
      roughnessFactor: roughness,
      metallicFactor: metallic,
    },
  };
  if (normalBytes) {
    material.normalTexture = { index: 1 };
  }

  const gltf = {
    asset: { version: '2.0', generator: 'SF3D-WebGPU' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 3 },
        indices: 2,
        material: 0,
      }],
    }],
    materials: [material],
    textures,
    images,
    samplers: [{ magFilter: 9729, minFilter: 9729 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalBinLen }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const jsonPadLen = pad4(jsonBytes.byteLength);

  const glbLen = 12 + 8 + jsonPadLen + 8 + totalBinLen;
  const glb = new ArrayBuffer(glbLen); // zero-initialized per JS spec (BIN padding = 0x00)
  const view = new DataView(glb);
  const bytes = new Uint8Array(glb);

  view.setUint32(0, 0x46546C67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, glbLen, true);

  let offset = 12;
  view.setUint32(offset, jsonPadLen, true);
  view.setUint32(offset + 4, 0x4E4F534A, true); // "JSON"
  offset += 8;
  bytes.set(jsonBytes, offset);
  for (let i = jsonBytes.byteLength; i < jsonPadLen; i++) bytes[offset + i] = 0x20;
  offset += jsonPadLen;

  view.setUint32(offset, totalBinLen, true);
  view.setUint32(offset + 4, 0x004E4942, true); // "BIN\0"
  offset += 8;

  bytes.set(vertexBytes, offset); offset += vertexLen;
  bytes.set(vnormalBytes, offset); offset += vnormalLen;
  bytes.set(indexBytes, offset); offset += indexLen;
  bytes.set(uvBytes, offset); offset += uvLen;
  bytes.set(albedoBytes, offset); offset += albedoLen;
  if (normalBytes) { bytes.set(normalBytes, offset); }

  return glb;
}

/**
 * Compute PCA rotation matrix that aligns the mesh's principal axes
 * with canonical X/Y/Z. Matching PyTorch _align_mesh_with_main_axis.
 *
 * Returns a 9-element Float32Array representing a 3×3 row-major rotation matrix.
 */
function _computePCARotation(vertices, numVertices) {
  // Center vertices
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < numVertices; i++) {
    cx += vertices[i*3]; cy += vertices[i*3+1]; cz += vertices[i*3+2];
  }
  cx /= numVertices; cy /= numVertices; cz /= numVertices;

  // Compute 3×3 covariance matrix (symmetric)
  let c00 = 0, c01 = 0, c02 = 0, c11 = 0, c12 = 0, c22 = 0;
  for (let i = 0; i < numVertices; i++) {
    const dx = vertices[i*3] - cx, dy = vertices[i*3+1] - cy, dz = vertices[i*3+2] - cz;
    c00 += dx*dx; c01 += dx*dy; c02 += dx*dz;
    c11 += dy*dy; c12 += dy*dz; c22 += dz*dz;
  }

  // Jacobi eigendecomposition for symmetric 3×3 matrix.
  // Matrix A (symmetric, row-major): [c00, c01, c02, c01, c11, c12, c02, c12, c22]
  // Eigenvector matrix V starts as identity.
  const A = [c00, c01, c02, c01, c11, c12, c02, c12, c22];
  const V = [1,0,0, 0,1,0, 0,0,1]; // eigenvectors as columns

  for (let iter = 0; iter < 50; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const absVal = Math.abs(A[i*3+j]);
        if (absVal > maxVal) { maxVal = absVal; p = i; q = j; }
      }
    }
    if (maxVal < 1e-12) break; // converged

    // Compute Jacobi rotation
    const app = A[p*3+p], aqq = A[q*3+q], apq = A[p*3+q];
    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau*tau));
    const c = 1 / Math.sqrt(1 + t*t);
    const s = t * c;

    // Update A: rotate rows/cols p and q
    const newA = A.slice();
    newA[p*3+p] = c*c*app - 2*s*c*apq + s*s*aqq;
    newA[q*3+q] = s*s*app + 2*s*c*apq + c*c*aqq;
    newA[p*3+q] = 0; newA[q*3+p] = 0;
    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const arp = A[r*3+p], arq = A[r*3+q];
      newA[r*3+p] = c*arp - s*arq; newA[p*3+r] = newA[r*3+p];
      newA[r*3+q] = s*arp + c*arq; newA[q*3+r] = newA[r*3+q];
    }
    for (let i = 0; i < 9; i++) A[i] = newA[i];

    // Update V: rotate columns p and q
    for (let r = 0; r < 3; r++) {
      const vp = V[r*3+p], vq = V[r*3+q];
      V[r*3+p] = c*vp - s*vq;
      V[r*3+q] = s*vp + c*vq;
    }
  }

  // Eigenvalues are diagonal of A; eigenvectors are columns of V
  const eigenvalues = [A[0], A[4], A[8]];
  // Sort eigenvectors by descending eigenvalue (largest variance = main axis)
  const order = [0, 1, 2].sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  // Extract sorted eigenvectors
  let mainAxis = [V[0*3+order[0]], V[1*3+order[0]], V[2*3+order[0]]];
  let secAxis  = [V[0*3+order[1]], V[1*3+order[1]], V[2*3+order[1]]];

  // Normalize main axis
  let len = Math.sqrt(mainAxis[0]**2 + mainAxis[1]**2 + mainAxis[2]**2) || 1;
  mainAxis = mainAxis.map(v => v / len);

  // Orthogonalize secondary against main (Gram-Schmidt)
  const dot = secAxis[0]*mainAxis[0] + secAxis[1]*mainAxis[1] + secAxis[2]*mainAxis[2];
  secAxis = secAxis.map((v, i) => v - dot * mainAxis[i]);
  len = Math.sqrt(secAxis[0]**2 + secAxis[1]**2 + secAxis[2]**2) || 1;
  secAxis = secAxis.map(v => v / len);

  // Third axis = cross(main, secondary)
  let thirdAxis = [
    mainAxis[1]*secAxis[2] - mainAxis[2]*secAxis[1],
    mainAxis[2]*secAxis[0] - mainAxis[0]*secAxis[2],
    mainAxis[0]*secAxis[1] - mainAxis[1]*secAxis[0],
  ];
  len = Math.sqrt(thirdAxis[0]**2 + thirdAxis[1]**2 + thirdAxis[2]**2) || 1;
  thirdAxis = thirdAxis.map(v => v / len);

  // Assign each PCA axis to the canonical axis it's most aligned with
  let mainIdx = _argmaxAbs(mainAxis);
  let secIdx = _argmaxAbs(secAxis);
  let thirdIdx = _argmaxAbs(thirdAxis);

  // Resolve conflicts (matching PyTorch logic)
  const used = new Set([mainIdx, secIdx, thirdIdx]);
  if (used.size !== 3) {
    const all = new Set([0, 1, 2]);
    let curIndex = 1;
    while (new Set([mainIdx, secIdx, thirdIdx]).size !== 3) {
      const missing = [...all].filter(x => ![mainIdx, secIdx, thirdIdx].includes(x))[0];
      if (curIndex === 1) thirdIdx = missing;
      else if (curIndex === 2) secIdx = missing;
      curIndex++;
      if (curIndex > 3) break;
    }
  }

  // Build rotation matrix: place each PCA axis in the row of its canonical axis
  // rot_mat = stack(axes, dim=1).T → axes[canonicalIdx] = pcaAxis → row canonicalIdx = pcaAxis
  const rotMat = new Float32Array(9);
  const axes = [mainAxis, secAxis, thirdAxis];
  const indices = [mainIdx, secIdx, thirdIdx];
  for (let i = 0; i < 3; i++) {
    rotMat[indices[i]*3 + 0] = axes[i][0];
    rotMat[indices[i]*3 + 1] = axes[i][1];
    rotMat[indices[i]*3 + 2] = axes[i][2];
  }

  return rotMat;
}

function _argmaxAbs(v) {
  const a0 = Math.abs(v[0]), a1 = Math.abs(v[1]), a2 = Math.abs(v[2]);
  if (a0 >= a1 && a0 >= a2) return 0;
  if (a1 >= a0 && a1 >= a2) return 1;
  return 2;
}

/**
 * Rotate UV slices so adjacent cube faces have consistent texture flow.
 *
 * For each cube face, computes the mean UV-derived tangent direction and
 * compares it against a canonical "expected" tangent derived from world-space
 * position and normals. Rotates all UVs in that face by the angle between
 * actual and expected tangents, then renormalizes to [0,1].
 *
 * Matches PyTorch's _rotate_uv_slices_consistent_space.
 */
function _rotateUVSlicesConsistentSpace(
  vertices, smoothNormals, faces, rawU, rawV, faceAssignment, numVertices, numFaces
) {
  // Step 1: Compute per-vertex tangents from UV gradients (area-weighted)
  const tangents = new Float32Array(numVertices * 3);
  const tanCount = new Float32Array(numVertices * 3);

  for (let f = 0; f < numFaces; f++) {
    const i0 = faces[f * 3], i1 = faces[f * 3 + 1], i2 = faces[f * 3 + 2];

    // Position edges
    const dp1x = vertices[i1*3] - vertices[i0*3];
    const dp1y = vertices[i1*3+1] - vertices[i0*3+1];
    const dp1z = vertices[i1*3+2] - vertices[i0*3+2];
    const dp2x = vertices[i2*3] - vertices[i0*3];
    const dp2y = vertices[i2*3+1] - vertices[i0*3+1];
    const dp2z = vertices[i2*3+2] - vertices[i0*3+2];

    // UV edges
    const du1 = rawU[f*3+1] - rawU[f*3];
    const dv1 = rawV[f*3+1] - rawV[f*3];
    const du2 = rawU[f*3+2] - rawU[f*3];
    const dv2 = rawV[f*3+2] - rawV[f*3];

    // Tangent numerator: dpos1 * dv2 - dpos2 * dv1
    const tx = dp1x * dv2 - dp2x * dv1;
    const ty = dp1y * dv2 - dp2y * dv1;
    const tz = dp1z * dv2 - dp2z * dv1;

    // Denominator: du1 * dv2 - dv1 * du2
    const denom = Math.max(du1 * dv2 - dv1 * du2, 1e-6);
    const ttx = tx / denom, tty = ty / denom, ttz = tz / denom;

    // Accumulate to all 3 vertices
    for (const idx of [i0, i1, i2]) {
      tangents[idx*3] += ttx;
      tangents[idx*3+1] += tty;
      tangents[idx*3+2] += ttz;
      tanCount[idx*3] += 1;
      tanCount[idx*3+1] += 1;
      tanCount[idx*3+2] += 1;
    }
  }

  // Average, normalize, then Gram-Schmidt orthogonalize against normals
  for (let i = 0; i < numVertices; i++) {
    const c = tanCount[i*3] || 1;
    let tx = tangents[i*3] / c, ty = tangents[i*3+1] / c, tz = tangents[i*3+2] / c;

    // Normalize
    let len = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    tx /= len; ty /= len; tz /= len;

    // Gram-Schmidt: t = normalize(t - dot(t, n) * n)
    const nx = smoothNormals[i*3], ny = smoothNormals[i*3+1], nz = smoothNormals[i*3+2];
    const tdn = tx*nx + ty*ny + tz*nz;
    tx -= tdn * nx; ty -= tdn * ny; tz -= tdn * nz;
    len = Math.sqrt(tx*tx + ty*ty + tz*tz) || 1;
    tangents[i*3] = tx / len;
    tangents[i*3+1] = ty / len;
    tangents[i*3+2] = tz / len;
  }

  // Step 2: Compute expected tangents per vertex
  // expected = normalize(cross(normal, cross([-y, x, 0], normal)))
  const expectedTangents = new Float32Array(numVertices * 3);
  for (let i = 0; i < numVertices; i++) {
    const nx = smoothNormals[i*3], ny = smoothNormals[i*3+1], nz = smoothNormals[i*3+2];
    // pos_stack = [-y, x, 0]
    const px = -vertices[i*3+1], py = vertices[i*3], pz = 0;

    // inner = cross(pos_stack, normal)
    const ix = py * nz - pz * ny;
    const iy = pz * nx - px * nz;
    const iz = px * ny - py * nx;

    // outer = cross(normal, inner)
    let ex = ny * iz - nz * iy;
    let ey = nz * ix - nx * iz;
    let ez = nx * iy - ny * ix;

    // Normalize
    const len = Math.sqrt(ex*ex + ey*ey + ez*ez) || 1;
    expectedTangents[i*3] = ex / len;
    expectedTangents[i*3+1] = ey / len;
    expectedTangents[i*3+2] = ez / len;
  }

  // Step 3: Per cube face, compute mean actual and expected tangent (3D),
  // find 2D rotation angle, rotate UVs
  for (let slot = 0; slot < 6; slot++) {
    // Collect mean actual and expected tangents across all faces in this slot
    // (averaged over all 3 vertices of each face, matching PyTorch's mean(dim=(0,1)))
    let actSumX = 0, actSumY = 0, actSumZ = 0;
    let expSumX = 0, expSumY = 0, expSumZ = 0;
    let count = 0;

    for (let f = 0; f < numFaces; f++) {
      if (faceAssignment[f] !== slot) continue;
      for (let vi = 0; vi < 3; vi++) {
        const idx = faces[f * 3 + vi];
        actSumX += tangents[idx*3];
        actSumY += tangents[idx*3+1];
        actSumZ += tangents[idx*3+2];
        expSumX += expectedTangents[idx*3];
        expSumY += expectedTangents[idx*3+1];
        expSumZ += expectedTangents[idx*3+2];
        count++;
      }
    }

    if (count === 0) continue;

    // Mean tangent vectors (3D)
    const amx = actSumX / count, amy = actSumY / count, amz = actSumZ / count;
    const emx = expSumX / count, emy = expSumY / count, emz = expSumZ / count;

    // 2D angle between actual and expected: dot and cross of 3D vectors
    // PyTorch does dot and cross on the mean 3D tangent vectors directly
    const dot = amx * emx + amy * emy + amz * emz;
    const cross = amx * emy - amy * emx;
    const angle = Math.atan2(cross, dot);

    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    // Rotate all UVs in this slot:
    // Center to [-1, 1], rotate, then rescale to [0, 1]
    // First pass: rotate
    for (let f = 0; f < numFaces; f++) {
      if (faceAssignment[f] !== slot) continue;
      for (let vi = 0; vi < 3; vi++) {
        const idx = f * 3 + vi;
        const u = rawU[idx] * 2 - 1;
        const v = rawV[idx] * 2 - 1;
        rawU[idx] = cosA * u - sinA * v;
        rawV[idx] = sinA * u + cosA * v;
      }
    }

    // Second pass: rescale to [0, 1] using joint min/max across both U and V
    // (matching PyTorch: uv[mask] = (uv[mask] - uv[mask].min()) / (uv[mask].max() - uv[mask].min()))
    // This preserves aspect ratio after rotation.
    let jointMin = Infinity, jointMax = -Infinity;
    for (let f = 0; f < numFaces; f++) {
      if (faceAssignment[f] !== slot) continue;
      for (let vi = 0; vi < 3; vi++) {
        const idx = f * 3 + vi;
        if (rawU[idx] < jointMin) jointMin = rawU[idx];
        if (rawU[idx] > jointMax) jointMax = rawU[idx];
        if (rawV[idx] < jointMin) jointMin = rawV[idx];
        if (rawV[idx] > jointMax) jointMax = rawV[idx];
      }
    }
    const jointRange = jointMax - jointMin || 1;
    for (let f = 0; f < numFaces; f++) {
      if (faceAssignment[f] !== slot) continue;
      for (let vi = 0; vi < 3; vi++) {
        const idx = f * 3 + vi;
        rawU[idx] = (rawU[idx] - jointMin) / jointRange;
        rawV[idx] = (rawV[idx] - jointMin) / jointRange;
      }
    }
  }
}

function _textureToJPEG(texture, resolution, quality = 0.92) {
  const canvas = document.createElement('canvas');
  canvas.width = resolution;
  canvas.height = resolution;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(resolution, resolution);
  imgData.data.set(texture);
  ctx.putImageData(imgData, 0, 0);
  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', quality);
  });
}

/**
 * clip_prep_core.js — pure CPU preparation for the CLIP material estimator:
 * alpha-blend, 512→224 bilinear resize + normalize, and the 32×32 patch
 * embedding (49 patches × 3072 → 768, plus CLS and positional embeddings).
 *
 * This is the exact math that lived inline in main.js (blend) and
 * clip_estimator.js (_preprocessForCLIP / _patchEmbed), extracted unchanged so
 * it can run on a Web Worker (clip_prep_worker.js) with byte-identical output.
 * The patch embedding alone is ~115M multiply-adds in JavaScript — the largest
 * single contiguous main-thread stall in the route (~225ms) when run inline.
 *
 * No DOM, no GPU: typed arrays in, typed arrays out.
 */

const CLIP_HIDDEN_DIM = 768;
const CLIP_PATCH_SIZE = 32;
const CLIP_IMAGE_SIZE = 224;
const CLIP_NUM_PATCHES = (CLIP_IMAGE_SIZE / CLIP_PATCH_SIZE) ** 2; // 49
const CLIP_NUM_TOKENS = CLIP_NUM_PATCHES + 1; // 50
const CLIP_PATCH_DIM = 3 * CLIP_PATCH_SIZE * CLIP_PATCH_SIZE; // 3072

const CLIP_MEAN = Object.freeze([0.48145466, 0.4578275, 0.40821073]);
const CLIP_STD = Object.freeze([0.26862954, 0.26130258, 0.27577711]);

const CLIP_PREP_WEIGHT_NAMES = Object.freeze({
  conv1W: 'image_estimator.model.visual.conv1.weight',        // [768, 3, 32, 32]
  classEmb: 'image_estimator.model.visual.class_embedding',    // [768]
  posEmb: 'image_estimator.model.visual.positional_embedding', // [50, 768]
});

/**
 * Pull the three CPU-side prep tensors out of the loaded weight set.
 * @param {object} weights  the loaded SF3D weights (has _rawGetCPU)
 */
function clipPrepWeightsFrom(weights) {
  const conv1W = weights._rawGetCPU(CLIP_PREP_WEIGHT_NAMES.conv1W);
  const classEmb = weights._rawGetCPU(CLIP_PREP_WEIGHT_NAMES.classEmb);
  const posEmb = weights._rawGetCPU(CLIP_PREP_WEIGHT_NAMES.posEmb);
  return validateClipPrepWeights({ conv1W, classEmb, posEmb });
}

function validateClipPrepWeights({ conv1W, classEmb, posEmb }) {
  if (!(conv1W instanceof Float32Array) || conv1W.length !== CLIP_HIDDEN_DIM * CLIP_PATCH_DIM) {
    throw new Error(`clip conv1 weight must be Float32Array[${CLIP_HIDDEN_DIM * CLIP_PATCH_DIM}], got ${conv1W?.length}`);
  }
  if (!(classEmb instanceof Float32Array) || classEmb.length !== CLIP_HIDDEN_DIM) {
    throw new Error(`clip class embedding must be Float32Array[${CLIP_HIDDEN_DIM}], got ${classEmb?.length}`);
  }
  if (!(posEmb instanceof Float32Array) || posEmb.length !== CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM) {
    throw new Error(`clip positional embedding must be Float32Array[${CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM}], got ${posEmb?.length}`);
  }
  return { conv1W, classEmb, posEmb };
}

/**
 * Match the PyTorch preprocessing order exactly:
 *   1. (caller) PIL/canvas resize to cond_image_size on uint8 RGBA
 *   2. convert to float, alpha-blend with grey [0.5, 0.5, 0.5]
 *   3. multiply by mask (alpha)
 * Returns float32 RGBA (premultiplied by mask), same length as the input.
 * @param {Uint8ClampedArray|Uint8Array} rgba8  width*height*4 bytes
 */
function blendClipPixels(rgba8, width, height) {
  const count = width * height;
  if (rgba8.length !== count * 4) {
    throw new Error(`clip input must be ${count * 4} RGBA bytes for ${width}x${height}, got ${rgba8.length}`);
  }
  const clipPixels = new Float32Array(count * 4);
  for (let i = 0; i < rgba8.length; i++) clipPixels[i] = rgba8[i] / 255.0;
  for (let i = 0; i < count; i++) {
    const a = clipPixels[i * 4 + 3];
    clipPixels[i * 4]     = (clipPixels[i * 4] * a + 0.5 * (1 - a)) * a;
    clipPixels[i * 4 + 1] = (clipPixels[i * 4 + 1] * a + 0.5 * (1 - a)) * a;
    clipPixels[i * 4 + 2] = (clipPixels[i * 4 + 2] * a + 0.5 * (1 - a)) * a;
  }
  return clipPixels;
}

/**
 * Float RGBA (blended) → normalized CHW float32 [3, 224, 224].
 * First resizes to cond_image_size (512) if needed, then 512→224 bilinear
 * (F.interpolate, align_corners=False) and CLIP mean/std normalization.
 */
function preprocessForClip(pixels, width, height) {
  let img = pixels;
  let w = width, h = height;
  const S = CLIP_IMAGE_SIZE;
  const out = new Float32Array(3 * S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const srcX = Math.max(0, (x + 0.5) * (w / S) - 0.5);
      const srcY = Math.max(0, (y + 0.5) * (h / S) - 0.5);
      const x0 = Math.floor(srcX), y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
      const fx = srcX - x0, fy = srcY - y0;
      for (let c = 0; c < 3; c++) {
        const v = img[(y0 * w + x0) * 4 + c] * (1-fx)*(1-fy) +
                  img[(y0 * w + x1) * 4 + c] * fx*(1-fy) +
                  img[(y1 * w + x0) * 4 + c] * (1-fx)*fy +
                  img[(y1 * w + x1) * 4 + c] * fx*fy;
        out[c * S * S + y * S + x] = (v - CLIP_MEAN[c]) / CLIP_STD[c];
      }
    }
  }
  return out;
}

/**
 * CLIP ViT-B/32 patch embedding: CHW [3,224,224] → [50, 768] tokens
 * (CLS + 49 patches), positional embedding added.
 */
function patchEmbedClip(image, { conv1W, classEmb, posEmb }) {
  if (!(image instanceof Float32Array) || image.length !== 3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE) {
    throw new Error(`clip image must be Float32Array[${3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE}], got ${image?.length}`);
  }
  const D = CLIP_HIDDEN_DIM, P = CLIP_PATCH_SIZE, S = CLIP_IMAGE_SIZE;
  const patchDim = CLIP_PATCH_DIM;
  const result = new Float32Array(CLIP_NUM_TOKENS * D);

  for (let d = 0; d < D; d++) result[d] = classEmb[d];

  for (let py = 0; py < 7; py++) {
    for (let px = 0; px < 7; px++) {
      const patchIdx = py * 7 + px;
      for (let d = 0; d < D; d++) {
        let sum = 0;
        for (let c = 0; c < 3; c++) {
          for (let dy = 0; dy < P; dy++) {
            for (let dx = 0; dx < P; dx++) {
              sum += image[c * S * S + (py*P+dy) * S + (px*P+dx)]
                   * conv1W[d * patchDim + c * P * P + dy * P + dx];
            }
          }
        }
        result[(patchIdx + 1) * D + d] = sum;
      }
    }
  }

  for (let i = 0; i < CLIP_NUM_TOKENS * D; i++) result[i] += posEmb[i];
  return result;
}

/**
 * The complete CPU prep: uint8 RGBA (already resized to cond size by the
 * caller's canvas) → [50, 768] token embeddings ready for the transformer.
 */
function prepareClipEmbeddings(rgba8, width, height, prepWeights) {
  const w = validateClipPrepWeights(prepWeights);
  const blended = blendClipPixels(rgba8, width, height);
  const chw = preprocessForClip(blended, width, height);
  return patchEmbedClip(chw, w);
}

/** Shape check for a prep result (main thread or worker reply). */
function validateClipEmbeddings(embeddings) {
  if (!(embeddings instanceof Float32Array) || embeddings.length !== CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM) {
    throw new Error(`clip embeddings must be Float32Array[${CLIP_NUM_TOKENS * CLIP_HIDDEN_DIM}], got ${embeddings?.length}`);
  }
  for (let i = 0; i < embeddings.length; i++) {
    if (!Number.isFinite(embeddings[i])) throw new Error(`clip embeddings contain a non-finite value at ${i}`);
  }
  return embeddings;
}

/**
 * clip_estimator.js — CLIP-based material property estimator for SF3D.
 *
 * Runs CLIP ViT-B/32 visual encoder on the input image, then two small MLP
 * heads to predict roughness and metallic as beta distribution modes.
 *
 * Architecture:
 *   - Patch embedding: 32×32 stride-32 conv → 49 patches of 768d
 *   - CLS token prepend → 50 tokens
 *   - 12 transformer blocks: LN → fused QKV attention (12 heads) → LN → MLP (GELU)
 *   - LN → CLS token → visual projection (768→512)
 *   - Two MLP heads: shared 3-layer (512→512, ReLU) → two branches → beta params → mode
 */


const HIDDEN_DIM = 768;
const NUM_HEADS = 12;
const HEAD_DIM = 64;
const MLP_DIM = 3072;
const NUM_BLOCKS = 12;
const NUM_TOKENS = 50; // 49 patches + CLS
const PROJ_DIM = 512;
const WG_SIZE = 256;


let _pipelines = null;
let _weightBuffers = null;

const RUNTIME_CLIP_SHADER_URLS = Object.freeze({
  linear: new URL("data:text/wgsl;base64,Ly8gTGluZWFyIHByb2plY3Rpb246IG91dHB1dCA9IGlucHV0IEAgd2VpZ2h0ICsgYmlhcwovLyBBZGFwdGVkIGZyb20gd2ViZ3B1LXNhbXBsZXMgdmlzaW9uVHJhbnNmb3JtZXIgbWxwLndnc2wgd2l0aCAyRCBkaXNwYXRjaC4KLy8KLy8gV2VpZ2h0IGxheW91dCBjb250cm9sbGVkIGJ5IHBhcmFtcy50cmFuc3Bvc2VkOgovLyAgIHRyYW5zcG9zZWQ9MSAoZGVmYXVsdCk6IHdlaWdodCBpcyBbaW5EaW0sIG91dERpbV0sIGFjY2VzcyB3ZWlnaHRbayAqIG91dERpbSArIGNvbF0KLy8gICB0cmFuc3Bvc2VkPTA6IHdlaWdodCBpcyBbb3V0RGltLCBpbkRpbV0gKFB5VG9yY2ggbmF0aXZlKSwgYWNjZXNzIHdlaWdodFtjb2wgKiBpbkRpbSArIGtdCgpzdHJ1Y3QgUGFyYW1zIHsKICBudW1Sb3dzOiB1MzIsCiAgaW5EaW06IHUzMiwKICBvdXREaW06IHUzMiwKICBudW1Xb3JrZ3JvdXBzWDogdTMyLAogIHRyYW5zcG9zZWQ6IHUzMiwgIC8vIDE9dHJhbnNwb3NlZCBbaW5EaW0sIG91dERpbV0sIDA9bmF0aXZlIFtvdXREaW0sIGluRGltXQp9CgpAZ3JvdXAoMCkgQGJpbmRpbmcoMCkgdmFyPHVuaWZvcm0+IHBhcmFtczogUGFyYW1zOwpAZ3JvdXAoMCkgQGJpbmRpbmcoMSkgdmFyPHN0b3JhZ2UsIHJlYWQ+IGlucHV0OiBhcnJheTxmMzI+OwpAZ3JvdXAoMCkgQGJpbmRpbmcoMikgdmFyPHN0b3JhZ2UsIHJlYWQ+IHdlaWdodDogYXJyYXk8ZjMyPjsKQGdyb3VwKDApIEBiaW5kaW5nKDMpIHZhcjxzdG9yYWdlLCByZWFkPiBiaWFzOiBhcnJheTxmMzI+OwpAZ3JvdXAoMCkgQGJpbmRpbmcoNCkgdmFyPHN0b3JhZ2UsIHJlYWRfd3JpdGU+IG91dHB1dDogYXJyYXk8ZjMyPjsKCmNvbnN0IFdHX1NJWkU6IHUzMiA9IDI1NjsKCkBjb21wdXRlIEB3b3JrZ3JvdXBfc2l6ZShXR19TSVpFKQpmbiBtYWluKAogIEBidWlsdGluKHdvcmtncm91cF9pZCkgd2dpZDogdmVjMzx1MzI+LAogIEBidWlsdGluKGxvY2FsX2ludm9jYXRpb25faWQpIGxpZDogdmVjMzx1MzI+LAopIHsKICBsZXQgbGluZWFyV0cgPSB3Z2lkLnggKyB3Z2lkLnkgKiBwYXJhbXMubnVtV29ya2dyb3Vwc1g7CiAgbGV0IGlkeCA9IGxpbmVhcldHICogV0dfU0laRSArIGxpZC54OwoKICBpZiAoaWR4ID49IHBhcmFtcy5udW1Sb3dzICogcGFyYW1zLm91dERpbSkgeyByZXR1cm47IH0KCiAgbGV0IHJvdyA9IGlkeCAvIHBhcmFtcy5vdXREaW07CiAgbGV0IGNvbCA9IGlkeCAlIHBhcmFtcy5vdXREaW07CgogIC8vIDQtd2F5IHNwbGl0IGFjY3VtdWxhdGlvbiBmb3IgYmV0dGVyIGZwMzIgcHJlY2lzaW9uIG9uIGxhcmdlIGRvdCBwcm9kdWN0cy4KICB2YXIgczAgPSAwLjA7CiAgdmFyIHMxID0gMC4wOwogIHZhciBzMiA9IDAuMDsKICB2YXIgczMgPSAwLjA7CiAgbGV0IGluQmFzZSA9IHJvdyAqIHBhcmFtcy5pbkRpbTsKICBsZXQgbGVuNCA9IChwYXJhbXMuaW5EaW0gLyA0dSkgKiA0dTsKCiAgaWYgKHBhcmFtcy50cmFuc3Bvc2VkID09IDF1KSB7CiAgICAvLyBUcmFuc3Bvc2VkIGxheW91dDogd2VpZ2h0W2ssIGNvbF0gPSB3ZWlnaHRbayAqIG91dERpbSArIGNvbF0KICAgIGxldCB3QmFzZSA9IGNvbDsKICAgIGxldCBzdHJpZGUgPSBwYXJhbXMub3V0RGltOwogICAgZm9yICh2YXIgayA9IDB1OyBrIDwgbGVuNDsgayArPSA0dSkgewogICAgICBzMCArPSBpbnB1dFtpbkJhc2UgKyBrXSAgICAgICogd2VpZ2h0WyhrKSAgICAgICogc3RyaWRlICsgd0Jhc2VdOwogICAgICBzMSArPSBpbnB1dFtpbkJhc2UgKyBrICsgMXVdICogd2VpZ2h0WyhrICsgMXUpICogc3RyaWRlICsgd0Jhc2VdOwogICAgICBzMiArPSBpbnB1dFtpbkJhc2UgKyBrICsgMnVdICogd2VpZ2h0WyhrICsgMnUpICogc3RyaWRlICsgd0Jhc2VdOwogICAgICBzMyArPSBpbnB1dFtpbkJhc2UgKyBrICsgM3VdICogd2VpZ2h0WyhrICsgM3UpICogc3RyaWRlICsgd0Jhc2VdOwogICAgfQogICAgZm9yICh2YXIgayA9IGxlbjQ7IGsgPCBwYXJhbXMuaW5EaW07IGsrKykgewogICAgICBzMCArPSBpbnB1dFtpbkJhc2UgKyBrXSAqIHdlaWdodFtrICogc3RyaWRlICsgd0Jhc2VdOwogICAgfQogIH0gZWxzZSB7CiAgICAvLyBOYXRpdmUgbGF5b3V0OiB3ZWlnaHRbY29sLCBrXSA9IHdlaWdodFtjb2wgKiBpbkRpbSArIGtdCiAgICBsZXQgd0Jhc2UgPSBjb2wgKiBwYXJhbXMuaW5EaW07CiAgICBmb3IgKHZhciBrID0gMHU7IGsgPCBsZW40OyBrICs9IDR1KSB7CiAgICAgIHMwICs9IGlucHV0W2luQmFzZSArIGtdICAgICAgKiB3ZWlnaHRbd0Jhc2UgKyBrXTsKICAgICAgczEgKz0gaW5wdXRbaW5CYXNlICsgayArIDF1XSAqIHdlaWdodFt3QmFzZSArIGsgKyAxdV07CiAgICAgIHMyICs9IGlucHV0W2luQmFzZSArIGsgKyAydV0gKiB3ZWlnaHRbd0Jhc2UgKyBrICsgMnVdOwogICAgICBzMyArPSBpbnB1dFtpbkJhc2UgKyBrICsgM3VdICogd2VpZ2h0W3dCYXNlICsgayArIDN1XTsKICAgIH0KICAgIGZvciAodmFyIGsgPSBsZW40OyBrIDwgcGFyYW1zLmluRGltOyBrKyspIHsKICAgICAgczAgKz0gaW5wdXRbaW5CYXNlICsga10gKiB3ZWlnaHRbd0Jhc2UgKyBrXTsKICAgIH0KICB9CiAgb3V0cHV0W2lkeF0gPSAoczAgKyBzMSkgKyAoczIgKyBzMykgKyBiaWFzW2NvbF07Cn0K", import.meta.url).href,
  layernorm: new URL("data:text/wgsl;base64,Ly8gTGF5ZXIgbm9ybWFsaXphdGlvbiBmb3IgVmlUIGJhY2tib25lLgovLyBFYWNoIHdvcmtncm91cCBub3JtYWxpemVzIG9uZSByb3cgKHRva2VuKS4KLy8gVGhyZWFkIDAgY29tcHV0ZXMgbWVhbi92YXJpYW5jZSBzZXJpYWxseSwgdGhlbiBhbGwgdGhyZWFkcyBub3JtYWxpemUgaW4gcGFyYWxsZWwuCi8vIEFkYXB0ZWQgZnJvbSB3ZWJncHUtc2FtcGxlcyB2aXNpb25UcmFuc2Zvcm1lciB3aXRoIDJEIGRpc3BhdGNoIHN1cHBvcnQuCgpzdHJ1Y3QgUGFyYW1zIHsKICBOOiB1MzIsICAgICAgIC8vIG51bWJlciBvZiByb3dzICh0b2tlbnMpCiAgRDogdTMyLCAgICAgICAvLyBkaW1lbnNpb24gcGVyIHJvdwogIGVwczogZjMyLAp9CgpAZ3JvdXAoMCkgQGJpbmRpbmcoMCkgdmFyPHVuaWZvcm0+IHBhcmFtczogUGFyYW1zOwpAZ3JvdXAoMCkgQGJpbmRpbmcoMSkgdmFyPHN0b3JhZ2UsIHJlYWQ+IGlucHV0OiBhcnJheTxmMzI+OwpAZ3JvdXAoMCkgQGJpbmRpbmcoMikgdmFyPHN0b3JhZ2UsIHJlYWQ+IGdhbW1hOiBhcnJheTxmMzI+OwpAZ3JvdXAoMCkgQGJpbmRpbmcoMykgdmFyPHN0b3JhZ2UsIHJlYWQ+IGJldGE6IGFycmF5PGYzMj47CkBncm91cCgwKSBAYmluZGluZyg0KSB2YXI8c3RvcmFnZSwgcmVhZF93cml0ZT4gb3V0cHV0OiBhcnJheTxmMzI+OwoKdmFyPHdvcmtncm91cD4gc2hhcmVkX21lYW46IGYzMjsKdmFyPHdvcmtncm91cD4gc2hhcmVkX2ludl9zdGQ6IGYzMjsKCkBjb21wdXRlIEB3b3JrZ3JvdXBfc2l6ZSgyNTYpCmZuIG1haW4oCiAgQGJ1aWx0aW4od29ya2dyb3VwX2lkKSB3Z19pZDogdmVjM3UsCiAgQGJ1aWx0aW4obG9jYWxfaW52b2NhdGlvbl9pZCkgbG9jYWxfaWQ6IHZlYzN1LAopIHsKICBsZXQgcm93ID0gd2dfaWQueDsKICBsZXQgdGlkID0gbG9jYWxfaWQueDsKICBsZXQgRCA9IHBhcmFtcy5EOwogIGxldCBiYXNlID0gcm93ICogRDsKCiAgaWYgKHJvdyA+PSBwYXJhbXMuTikgeyByZXR1cm47IH0KCiAgLy8gVGhyZWFkIDAgY29tcHV0ZXMgbWVhbiBhbmQgdmFyaWFuY2UgKHR3by1wYXNzIGZvciBudW1lcmljYWwgc3RhYmlsaXR5KS4KICAvLyBUaGUgb25lLXBhc3MgZm9ybXVsYSBFW3jCsl0tRVt4XcKyIHN1ZmZlcnMgY2F0YXN0cm9waGljIGNhbmNlbGxhdGlvbiB3aGVuCiAgLy8gdmFsdWVzIGFyZSBsYXJnZSAowrEyMCBjb21tb24gaW4gVmlUKSwgbG9zaW5nIHNpZ25pZmljYW50IHByZWNpc2lvbi4KICBpZiAodGlkID09IDB1KSB7CiAgICB2YXIgc3VtID0gMC4wOwogICAgZm9yICh2YXIgaSA9IDB1OyBpIDwgRDsgaSsrKSB7CiAgICAgIHN1bSArPSBpbnB1dFtiYXNlICsgaV07CiAgICB9CiAgICBsZXQgbWVhbiA9IHN1bSAvIGYzMihEKTsKICAgIHZhciB2YXJfc3VtID0gMC4wOwogICAgZm9yICh2YXIgaSA9IDB1OyBpIDwgRDsgaSsrKSB7CiAgICAgIGxldCBkaWZmID0gaW5wdXRbYmFzZSArIGldIC0gbWVhbjsKICAgICAgdmFyX3N1bSArPSBkaWZmICogZGlmZjsKICAgIH0KICAgIGxldCB2YXJpYW5jZSA9IHZhcl9zdW0gLyBmMzIoRCk7CiAgICBzaGFyZWRfbWVhbiA9IG1lYW47CiAgICBzaGFyZWRfaW52X3N0ZCA9IDEuMCAvIHNxcnQodmFyaWFuY2UgKyBwYXJhbXMuZXBzKTsKICB9CiAgd29ya2dyb3VwQmFycmllcigpOwoKICBsZXQgbWVhbiA9IHNoYXJlZF9tZWFuOwogIGxldCBpbnZfc3RkID0gc2hhcmVkX2ludl9zdGQ7CgogIC8vIEFsbCB0aHJlYWRzIG5vcm1hbGl6ZSBhbmQgYXBwbHkgYWZmaW5lIHRyYW5zZm9ybSBpbiBwYXJhbGxlbAogIGZvciAodmFyIGkgPSB0aWQ7IGkgPCBEOyBpICs9IDI1NnUpIHsKICAgIGxldCB2YWwgPSBpbnB1dFtiYXNlICsgaV07CiAgICBvdXRwdXRbYmFzZSArIGldID0gKHZhbCAtIG1lYW4pICogaW52X3N0ZCAqIGdhbW1hW2ldICsgYmV0YVtpXTsKICB9Cn0K", import.meta.url).href,
});

function resolveClipShaderUrls(moduleUrl = import.meta.url) {
  if (moduleUrl === import.meta.url) return RUNTIME_CLIP_SHADER_URLS;
  return Object.freeze({
    linear: new URL('../shaders/linear.wgsl', moduleUrl).href,
    layernorm: new URL('../shaders/layernorm_vit.wgsl', moduleUrl).href,
  });
}

async function fetchClipShaderSource(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response?.ok) {
    throw new Error(
      `CLIP shader fetch failed: ${url} returned ${response?.status ?? 'unknown'} ${response?.statusText || ''}`.trim(),
    );
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    throw new Error(`CLIP shader ${url} returned invalid content type ${contentType}`);
  }
  const source = await response.text();
  if (
    !source.trim()
    || /^\s*</.test(source)
    || !/@compute\b/.test(source)
    || !/\bfn\s+main\s*\(/.test(source)
  ) {
    throw new Error(`CLIP shader ${url} is not valid WGSL source`);
  }
  return source;
}

async function loadClipShaderSources({
  moduleUrl = import.meta.url,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('CLIP shader fetch implementation is required');
  const urls = resolveClipShaderUrls(moduleUrl);
  const [linear, layernorm] = await Promise.all([
    fetchClipShaderSource(fetchImpl, urls.linear),
    fetchClipShaderSource(fetchImpl, urls.layernorm),
  ]);
  return Object.freeze({ linear, layernorm });
}

async function createValidatedClipPipeline(device, source, shaderUrl) {
  try {
    device.pushErrorScope('validation');
  } catch (error) {
    throw new Error(
      `CLIP shader validation scope setup failed for ${shaderUrl}: ${error?.message || error}`,
      { cause: error },
    );
  }

  let pipeline = null;
  let failure = null;
  try {
    const module = device.createShaderModule({
      code: source,
      label: `SF3D CLIP ${shaderUrl}`,
    });
    if (typeof module.getCompilationInfo === 'function') {
      const info = await module.getCompilationInfo();
      const errors = (info.messages || []).filter(message => message.type === 'error');
      if (errors.length) {
        const detail = errors.map(message => (
          `${message.lineNum || '?'}:${message.linePos || '?'} ${message.message}`
        )).join('; ');
        throw new Error(`CLIP shader compilation failed for ${shaderUrl}: ${detail}`);
      }
    }
    pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
  } catch (error) {
    failure = error;
  }

  let validationError = null;
  let scopeFailure = null;
  try {
    validationError = await device.popErrorScope();
  } catch (error) {
    scopeFailure = error;
  }

  if (failure || scopeFailure) {
    const detail = [
      failure ? `operation failed: ${failure.message || failure}` : null,
      scopeFailure ? `validation scope pop failed: ${scopeFailure.message || scopeFailure}` : null,
    ].filter(Boolean).join('; ');
    throw new Error(
      `CLIP shader pipeline failed for ${shaderUrl}: ${detail}`,
      { cause: failure || scopeFailure },
    );
  }
  if (validationError) {
    throw new Error(`CLIP shader validation failed for ${shaderUrl}: ${validationError.message || validationError}`);
  }
  return pipeline;
}

function ceilDiv(a, b) { return Math.ceil(a / b); }
function splitWG(total) {
  const maxX = 65535;
  if (total <= maxX) return [total, 1];
  return [maxX, ceilDiv(total, maxX)];
}

async function _ensurePipelines(device) {
  if (_pipelines) return;

  const urls = resolveClipShaderUrls();
  const sources = await loadClipShaderSources();

  _pipelines = {
    linear: await createValidatedClipPipeline(device, sources.linear, urls.linear),
    layernorm: await createValidatedClipPipeline(device, sources.layernorm, urls.layernorm),
  };
}

function _ensureWeightBuffers(device, weights) {
  if (_weightBuffers) return;
  _weightBuffers = {};

  const makeGPU = (name) => weights._rawGet(name);

  // Visual encoder weights
  _weightBuffers.lnPre = { weight: makeGPU('image_estimator.model.visual.ln_pre.weight'),
                           bias: makeGPU('image_estimator.model.visual.ln_pre.bias') };
  _weightBuffers.lnPost = { weight: makeGPU('image_estimator.model.visual.ln_post.weight'),
                            bias: makeGPU('image_estimator.model.visual.ln_post.bias') };

  _weightBuffers.blocks = [];
  for (let i = 0; i < NUM_BLOCKS; i++) {
    const p = `image_estimator.model.visual.transformer.resblocks.${i}`;
    _weightBuffers.blocks.push({
      ln1: { weight: makeGPU(`${p}.ln_1.weight`), bias: makeGPU(`${p}.ln_1.bias`) },
      ln2: { weight: makeGPU(`${p}.ln_2.weight`), bias: makeGPU(`${p}.ln_2.bias`) },
      qkv: { weight: makeGPU(`${p}.attn.in_proj_weight`), bias: makeGPU(`${p}.attn.in_proj_bias`) },
      outProj: { weight: makeGPU(`${p}.attn.out_proj.weight`), bias: makeGPU(`${p}.attn.out_proj.bias`) },
      fc: { weight: makeGPU(`${p}.mlp.c_fc.weight`), bias: makeGPU(`${p}.mlp.c_fc.bias`) },
      proj: { weight: makeGPU(`${p}.mlp.c_proj.weight`), bias: makeGPU(`${p}.mlp.c_proj.bias`) },
    });
  }
}

/**
 * Run CLIP material estimation on an image.
 *
 * @param {Uint8ClampedArray|Uint8Array} rgba8  cond-size (512×512) RGBA bytes
 *   straight from canvas getImageData — the alpha blend, 512→224 resize, and
 *   patch embedding happen in clip_prep_core (main thread) or, when
 *   options.clipPrepWorker is supplied, on that Worker with byte-identical
 *   output. The CPU prep is ~115M multiply-adds; inline it was the route's
 *   second-largest contiguous main-thread stall (~240ms).
 */
async function estimateMaterials(device, rgba8, imgWidth, imgHeight, weights, options = {}) {
  await _ensurePipelines(device);
  _ensureWeightBuffers(device, weights);

  // Step 1: CPU preprocessing — blend, resize to 224, normalize, patch embed
  const embeddings = options.clipPrepWorker
    ? await runClipPrep(options.clipPrepWorker, rgba8, imgWidth, imgHeight, weights,
        { timeoutMs: options.workerTimeoutMs })
    : validateClipEmbeddings(prepareClipEmbeddings(rgba8, imgWidth, imgHeight, clipPrepWeightsFrom(weights)));
  const features = await _runVisualTransformer(device, embeddings, weights);

  // Step 3: CPU heads (tiny)
  const roughness = _runHead(features, weights, 'roughness');
  const metallic = _runHead(features, weights, 'metallic');

  console.log(`CLIP material estimation: roughness=${roughness.toFixed(3)}, metallic=${metallic.toFixed(3)}`);
  return { roughness, metallic, prepOffloaded: Boolean(options.clipPrepWorker) };
}

// Per-worker one-time init (the 9.4MB conv1 weight + embeddings stay resident
// in the worker). A failed init is forgotten so a later call can retry.
const _clipPrepInit = new WeakMap();

/**
 * Run the CLIP CPU prep on a Worker (clip_prep_worker.js). Fail-loud through
 * callWorker: crash / malformed reply / wedge rejects; never falls back to the
 * main thread silently. The caller's rgba8 is copied, not detached.
 */
async function runClipPrep(worker, rgba8, width, height, weights, { timeoutMs = 30000 } = {}) {
  const prep = weights && typeof weights._rawGetCPU === 'function'
    ? clipPrepWeightsFrom(weights)
    : validateClipPrepWeights(weights);
  let init = _clipPrepInit.get(worker);
  if (!init) {
    const conv1W = prep.conv1W.slice().buffer;
    const classEmb = prep.classEmb.slice().buffer;
    const posEmb = prep.posEmb.slice().buffer;
    init = callWorker(
      worker,
      { type: 'init', id: `clip-init-${Math.random().toString(36).slice(2)}`, conv1W, classEmb, posEmb },
      [conv1W, classEmb, posEmb],
      { timeoutMs, onResult: (d) => { if (d.initialized !== true) throw new Error('clip prep init not acknowledged'); return true; } },
    );
    _clipPrepInit.set(worker, init);
    init.catch(() => { if (_clipPrepInit.get(worker) === init) _clipPrepInit.delete(worker); });
  }
  await init;
  const bytes = (rgba8 instanceof Uint8ClampedArray || rgba8 instanceof Uint8Array)
    ? rgba8 : new Uint8ClampedArray(rgba8);
  const rgba = bytes.slice().buffer;
  return await callWorker(
    worker,
    { id: `clip-prep-${Math.random().toString(36).slice(2)}`, rgba, width, height },
    [rgba],
    { timeoutMs, onResult: (d) => validateClipEmbeddings(new Float32Array(d.embeddings)) },
  );
}

// Inline CLIP shaders (add / GELU / fused attention) bake their sizes into the
// WGSL, so each is compiled once per device via the kit's resource caches
// instead of once per block per run (36+ synchronous pipeline compiles on the
// main thread per estimate).
const _clipCaches = new WeakMap();
function getClipInlinePipeline(device, label, code) {
  let caches = _clipCaches.get(device);
  if (!caches) {
    caches = createWebGpuResourceCaches(device);
    _clipCaches.set(device, caches);
  }
  const module = caches.getShaderModule(label, code);
  return caches.getComputePipeline(label, {
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
}

async function _runVisualTransformer(device, embeddings, weights) {
  const N = NUM_TOKENS, D = HIDDEN_DIM;

  let xBuf = createStorageBuffer(device, new Float32Array(embeddings));
  let encoder = device.createCommandEncoder();

  // Pre-LN
  xBuf = _dispatchLN(encoder, device, xBuf, N, D, _weightBuffers.lnPre);

  for (let b = 0; b < NUM_BLOCKS; b++) {
    const blk = _weightBuffers.blocks[b];

    // LN1 → fused QKV → attention → out proj → residual
    const ln1 = _dispatchLN(encoder, device, xBuf, N, D, blk.ln1);
    // in_proj_weight is NOT transposed (PyTorch native [outDim, inDim])
    const qkv = _dispatchLinear(encoder, device, ln1, N, D, 3*D, blk.qkv, false);
    const attn = _dispatchFusedAttn(encoder, device, qkv, N);
    const proj = _dispatchLinear(encoder, device, attn, N, D, D, blk.outProj, true);
    xBuf = _dispatchAdd(encoder, device, xBuf, proj, N * D);

    // LN2 → MLP (fc → GELU → proj) → residual
    const ln2 = _dispatchLN(encoder, device, xBuf, N, D, blk.ln2);
    const fc = _dispatchLinear(encoder, device, ln2, N, D, MLP_DIM, blk.fc, true);
    const gelu = _dispatchGelu(encoder, device, fc, N * MLP_DIM);
    const mlp = _dispatchLinear(encoder, device, gelu, N, MLP_DIM, D, blk.proj, true);
    xBuf = _dispatchAdd(encoder, device, xBuf, mlp, N * D);

  }

  // Post-LN
  xBuf = _dispatchLN(encoder, device, xBuf, N, D, _weightBuffers.lnPost);

  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();

  // Read CLS token, project to 512d on CPU
  const allTokens = await readBuffer(device, xBuf, N * D * 4);
  const cls = allTokens.slice(0, D);

  // visual.proj: PyTorch [768, 512], converter transposed to [512, 768]
  // output[d] = sum_k cls[k] * proj_transposed[d * 768 + k]
  const projW = weights._rawGetCPU('image_estimator.model.visual.proj');
  const features = new Float32Array(PROJ_DIM);
  for (let d = 0; d < PROJ_DIM; d++) {
    let sum = 0;
    for (let k = 0; k < D; k++) sum += cls[k] * projW[d * D + k];
    features[d] = sum;
  }
  return features;
}

// --- GPU dispatch helpers ---

function _dispatchLinear(encoder, device, input, rows, inDim, outDim, w, transposed = true) {
  const totalWG = ceilDiv(rows * outDim, WG_SIZE);
  const [wgX, wgY] = splitWG(totalWG);
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(params, 0, new Uint32Array([rows, inDim, outDim, wgX, transposed ? 1 : 0]));
  const output = createEmptyBuffer(device, rows * outDim * 4);
  const bg = device.createBindGroup({
    layout: _pipelines.linear.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: w.weight } },
      { binding: 3, resource: { buffer: w.bias } },
      { binding: 4, resource: { buffer: output } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(_pipelines.linear);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(wgX, wgY);
  pass.end();
  return output;
}

function _dispatchLN(encoder, device, input, N, D, norm) {
  const paramsData = new ArrayBuffer(16);
  const v = new DataView(paramsData);
  v.setUint32(0, N, true);
  v.setUint32(4, D, true);
  v.setFloat32(8, 1e-5, true);
  const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(params, 0, new Uint8Array(paramsData));
  const output = createEmptyBuffer(device, N * D * 4);
  const bg = device.createBindGroup({
    layout: _pipelines.layernorm.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: params } },
      { binding: 1, resource: { buffer: input } },
      { binding: 2, resource: { buffer: norm.weight } },
      { binding: 3, resource: { buffer: norm.bias } },
      { binding: 4, resource: { buffer: output } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(_pipelines.layernorm);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(N);
  pass.end();
  return output;
}

function _dispatchAdd(encoder, device, a, b, count) {
  const shaderCode = `
    @group(0) @binding(0) var<storage, read> a: array<f32>;
    @group(0) @binding(1) var<storage, read> b: array<f32>;
    @group(0) @binding(2) var<storage, read_write> out: array<f32>;
    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let i = gid.x;
      if (i >= ${count}u) { return; }
      out[i] = a[i] + b[i];
    }
  `;
  const pipeline = getClipInlinePipeline(device, 'sf3d.clip.add', shaderCode);
  const output = createEmptyBuffer(device, count * 4);
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: a } },
      { binding: 1, resource: { buffer: b } },
      { binding: 2, resource: { buffer: output } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(ceilDiv(count, 256));
  pass.end();
  return output;
}

function _dispatchGelu(encoder, device, input, count) {
  const shaderCode = `
    @group(0) @binding(0) var<storage, read> inp: array<f32>;
    @group(0) @binding(1) var<storage, read_write> out: array<f32>;
    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let i = gid.x;
      if (i >= ${count}u) { return; }
      let x = inp[i];
      // Exact GELU: x * 0.5 * (1 + erf(x / sqrt(2)))
      // WGSL doesn't have erf, use Abramowitz & Stegun approximation
      let t = 1.0 / (1.0 + 0.3275911 * abs(x * 0.7071067811865476));
      let erf_approx = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x * 0.5);
      let erf_val = select(-erf_approx, erf_approx, x >= 0.0);
      out[i] = x * 0.5 * (1.0 + erf_val);
    }
  `;
  const pipeline = getClipInlinePipeline(device, 'sf3d.clip.gelu', shaderCode);
  const output = createEmptyBuffer(device, count * 4);
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: input } },
      { binding: 1, resource: { buffer: output } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(ceilDiv(count, 256));
  pass.end();
  return output;
}

function _dispatchFusedAttn(encoder, device, qkvBuf, N) {
  const D = HIDDEN_DIM;
  const scale = 1.0 / Math.sqrt(HEAD_DIM);
  const shaderCode = `
    @group(0) @binding(0) var<storage, read> qkv: array<f32>;
    @group(0) @binding(1) var<storage, read_write> output: array<f32>;
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let idx = gid.x;
      if (idx >= ${N * NUM_HEADS}u) { return; }
      let qi = idx / ${NUM_HEADS}u;
      let h = idx % ${NUM_HEADS}u;
      var scores: array<f32, ${N}>;
      var maxS: f32 = -1e30;
      for (var ki: u32 = 0u; ki < ${N}u; ki++) {
        var s: f32 = 0.0;
        for (var d: u32 = 0u; d < ${HEAD_DIM}u; d++) {
          s += qkv[qi * ${3*D}u + h * ${HEAD_DIM}u + d]
             * qkv[ki * ${3*D}u + ${D}u + h * ${HEAD_DIM}u + d];
        }
        s *= ${scale};
        scores[ki] = s;
        maxS = max(maxS, s);
      }
      var sumE: f32 = 0.0;
      for (var ki: u32 = 0u; ki < ${N}u; ki++) {
        scores[ki] = exp(scores[ki] - maxS);
        sumE += scores[ki];
      }
      let inv = 1.0 / sumE;
      for (var d: u32 = 0u; d < ${HEAD_DIM}u; d++) {
        var val: f32 = 0.0;
        for (var ki: u32 = 0u; ki < ${N}u; ki++) {
          val += scores[ki] * inv * qkv[ki * ${3*D}u + ${2*D}u + h * ${HEAD_DIM}u + d];
        }
        output[qi * ${D}u + h * ${HEAD_DIM}u + d] = val;
      }
    }
  `;
  const pipeline = getClipInlinePipeline(device, 'sf3d.clip.fused-attention', shaderCode);
  const output = createEmptyBuffer(device, N * D * 4);
  const bg = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: qkvBuf } },
      { binding: 1, resource: { buffer: output } },
    ],
  });
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bg);
  pass.dispatchWorkgroups(ceilDiv(N * NUM_HEADS, 64));
  pass.end();
  return output;
}

// --- CPU head computation ---

function _runHead(features, weights, headName) {
  const p = `image_estimator.heads.${headName}`;
  const bias = 1.0;
  const g = (n) => weights._rawGetCPU(n);
  let x = new Float32Array(features);
  for (const l of ['0.0', '0.2', '0.4']) x = _cpuLinearReLU(x, g(`${p}.${l}.weight`), g(`${p}.${l}.bias`));
  let d1 = _cpuLinear(_cpuLinearReLU(x, g(`${p}.1.0.weight`), g(`${p}.1.0.bias`)),
                       g(`${p}.1.2.weight`), g(`${p}.1.2.bias`));
  let d2 = _cpuLinear(_cpuLinearReLU(x, g(`${p}.2.0.weight`), g(`${p}.2.0.bias`)),
                       g(`${p}.2.2.weight`), g(`${p}.2.2.bias`));
  const alpha = _softplus(d1[0] + bias), beta = _softplus(d2[0] + bias);
  if (alpha <= 1 || beta <= 1) return alpha / (alpha + beta);
  return Math.max(0, Math.min(1, (alpha - 1) / (alpha + beta - 2)));
}

function _cpuLinear(x, weight, bias) {
  // Head weights are transposed by converter: [inDim, outDim]
  // output[o] = sum_i x[i] * weight[i * outDim + o] + bias[o]
  const inDim = x.length, outDim = bias.length;
  const out = new Float32Array(outDim);
  for (let o = 0; o < outDim; o++) {
    let s = bias[o];
    for (let i = 0; i < inDim; i++) s += x[i] * weight[i * outDim + o];
    out[o] = s;
  }
  return out;
}

function _cpuLinearReLU(x, w, b) {
  const out = _cpuLinear(x, w, b);
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
  return out;
}

function _softplus(x) { return x > 20 ? x : Math.log(1 + Math.exp(x)); }

/**
 * decoder_scratch_arena.js — one capacity-bound reusable scratch arena for the
 * triplane decoder, held under the kit's phase-resource working-set lease.
 *
 * Cranial's reviewed assay (b7809c7) proved the texture-bake residual is
 * allocation churn: the decoder rebuilds ~30 transient scratch buffers PER range
 * (~1.015GB cumulative across a route), then a single-threaded CPU
 * materialization tail. This arena removes the churn: it pre-allocates one buffer
 * per proven decoder slot, sized for the maximum batch N, and every range reuses
 * the same physical buffers via TriplaneDecoder's _slotProvider.acquire(slotKey).
 *
 * Exact per-range prefix completion (the facade's per-duty queue fence) is
 * RETAINED — the arena only removes allocation, it does not change scheduling or
 * fence semantics. A slot reused across ranges is safe because each range's GPU
 * work completes (prefix fence) before the next range's dispatch overwrites it.
 *
 * The slot graph is the proven output of tools/prove_decoder_slot_graph.mjs:
 * 30 slots for heads [features, perturb_normal], each size = perTexelBytes * N
 * (all bases 0 except the 4-byte SiLU :dummy workspace). Capacity at maxBatch:
 * ~16.9MB @ 4096, ~67.4MB @ 16384 — replacing ~1.015GB churn.
 */


/**
 * Proven decoder scratch slot graph (bake heads [features, perturb_normal]).
 * Each entry: { slotKey, perTexelBytes, baseBytes }. Source of truth:
 * tools/prove_decoder_slot_graph.mjs against the composed head.
 */
const DECODER_BAKE_SLOT_GRAPH = Object.freeze([
  { slotKey: 'scaledPos', perTexelBytes: 12, baseBytes: 0 },
  { slotKey: 'grid:XY', perTexelBytes: 8, baseBytes: 0 },
  { slotKey: 'grid:XZ', perTexelBytes: 8, baseBytes: 0 },
  { slotKey: 'grid:YZ', perTexelBytes: 8, baseBytes: 0 },
  { slotKey: 'sampled:XY', perTexelBytes: 160, baseBytes: 0 },
  { slotKey: 'sampled:XZ', perTexelBytes: 160, baseBytes: 0 },
  { slotKey: 'sampled:YZ', perTexelBytes: 160, baseBytes: 0 },
  { slotKey: 'concatFeatures', perTexelBytes: 480, baseBytes: 0 },
  { slotKey: 'head:features:lin:0', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:silu:0:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:features:silu:0', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:lin:1', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:silu:1:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:features:silu:1', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:lin:2', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:silu:2:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:features:silu:2', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:features:rawOut', perTexelBytes: 12, baseBytes: 0 },
  { slotKey: 'head:features:sigmoid', perTexelBytes: 12, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:lin:0', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:silu:0:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:perturb_normal:silu:0', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:lin:1', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:silu:1:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:perturb_normal:silu:1', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:lin:2', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:silu:2:dummy', perTexelBytes: 0, baseBytes: 4 },
  { slotKey: 'head:perturb_normal:silu:2', perTexelBytes: 256, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:rawOut', perTexelBytes: 12, baseBytes: 0 },
  { slotKey: 'head:perturb_normal:normalize3', perTexelBytes: 12, baseBytes: 0 },
]);

const align4 = (n) => Math.ceil(n / 4) * 4;
const slotCapacityBytes = (slot, maxBatch) => align4(slot.baseBytes + slot.perTexelBytes * maxBatch);

/**
 * Compute the total arena byte capacity for a given max batch and slot graph.
 */
function decoderArenaCapacityBytes(maxBatch, slotGraph = DECODER_BAKE_SLOT_GRAPH) {
  return slotGraph.reduce((sum, s) => sum + slotCapacityBytes(s, maxBatch), 0);
}

/**
 * Create the decoder scratch arena.
 *
 * @param {GPUDevice} device
 * @param {object} o
 * @param {number} o.maxBatch   maximum texels any range will decode
 * @param {Array}  [o.slotGraph=DECODER_BAKE_SLOT_GRAPH]
 * @returns a provider with acquire(slotKey, size), plus telemetry + destroy.
 */
function createDecoderScratchArena(device, { maxBatch, slotGraph = DECODER_BAKE_SLOT_GRAPH }) {
  if (!Number.isSafeInteger(maxBatch) || maxBatch <= 0) {
    throw new TypeError('maxBatch must be a positive safe integer');
  }
  const slots = new Map();
  let totalBytes = 0;
  for (const slot of slotGraph) {
    const capacity = slotCapacityBytes(slot, maxBatch);
    const buffer = createEmptyBuffer(device, capacity, 0, `arena:${slot.slotKey}`);
    slots.set(slot.slotKey, { buffer, capacity, perTexelBytes: slot.perTexelBytes, baseBytes: slot.baseBytes });
    totalBytes += capacity;
  }
  let destroyed = false;
  let acquireCount = 0;

  return {
    slotCount: slots.size,
    totalBytes,
    maxBatch,

    /**
     * TriplaneDecoder._slotProvider.acquire(slotKey, size) — return the
     * pre-allocated slot buffer. Fail loud on an unknown slot or an overflow
     * (size exceeding the slot's max-batch capacity), never silently truncate.
     */
    acquire(slotKey, size) {
      if (destroyed) throw new Error('decoder scratch arena is destroyed');
      const slot = slots.get(slotKey);
      if (!slot) throw new Error(`decoder arena has no slot "${slotKey}" (slot graph mismatch)`);
      if (size > slot.capacity) {
        throw new Error(`decoder arena slot "${slotKey}" overflow: need ${size} > capacity ${slot.capacity} (maxBatch ${maxBatch})`);
      }
      acquireCount++;
      return slot.buffer;
    },

    snapshot() {
      return {
        slotCount: slots.size,
        totalBytes,
        maxBatch,
        acquireCount,
        destroyed,
      };
    },

    destroy() {
      if (destroyed) return { retired: 0 };
      let retired = 0;
      for (const slot of slots.values()) {
        try { slot.buffer.destroy(); retired++; } catch { /* best-effort */ }
      }
      slots.clear();
      destroyed = true;
      return { retired };
    },
  };
}

/**
 * Cooperative texture-bake boundary — second SF3D cooperative uptake of the
 * Kaminos cooperative porting spine.
 *
 * Profiling (foreground-tail-stage-attribution_2026-07-24) showed the texture
 * bake's single monolithic triplane-decode dispatch + readback owns a ~231ms
 * contiguous foreground gap — the largest GPU gap in the pipeline. Per-texel
 * decode is fully independent, so we split the occupied texels into fixed
 * batches and decode each as its own GPU command duty through the cooperative
 * facade (submit + queue-prefix fence + browser yield between batches),
 * collapsing the one big gap into yieldable pieces while preserving byte-
 * identical texture output.
 *
 * Reuses the exact command-duty pattern proven at the DINO boundary: the
 * adapter-owned thin runtime (createSf3dCooperativeRuntime) and the boundary/
 * duty facade. This is the GPU cooperative mechanism, not a CPU worker offload.
 */


const TEXTURE_BAKE_MANIFEST_ID = 'sf3d.texture-bake-cooperative-boundaries.v0';
const TEXTURE_BAKE_BOUNDARY_ID = 'texture-bake-texel-batches';
const DECODER_ARENA_RESOURCE_ID = 'sf3d.decoder-scratch-arena';

/**
 * Run `fn(arena)` with a decoder scratch arena held under the kit's phase-
 * resource working-set lease (Cranial's constraint: one managed resource, no
 * competing manager). The working set acquires the arena when transitioning into
 * the texture-bake phase and retires it on close — giving the arena lawful
 * lease-owned lifetime, cancellation, and terminal retirement.
 *
 * @param {GPUDevice} device
 * @param {object} o { maxBatch, signal }
 * @param {(arena, workingSetSnapshot)=>Promise<any>} fn
 */
async function withDecoderArenaLease(device, { maxBatch, signal }, fn) {
  const declaredBytes = decoderArenaCapacityBytes(maxBatch);
  let arena = null;
  const workingSet = createWebGpuPhaseResourceWorkingSet({
    controllerId: 'sf3d.texture-bake.decoder-arena',
    plan: {
      planId: 'sf3d.texture-bake.decoder-arena.v0',
      resources: [{ resourceId: DECODER_ARENA_RESOURCE_ID, declaredBytes }],
      phases: [{ phaseId: 'texture-bake', requiredResourceIds: [DECODER_ARENA_RESOURCE_ID] }],
    },
    acquireResource: ({ resource }) => {
      arena = createDecoderScratchArena(device, { maxBatch });
      return {
        resourceId: resource.resourceId,
        value: arena,
        release: () => {
          const r = arena.destroy();
          return r.retired >= 0 ? 'released' : 'released';
        },
      };
    },
    residencySnapshot: () => (arena ? arena.snapshot() : { slotCount: 0, totalBytes: 0 }),
  });
  try {
    await workingSet.transitionToPhase('texture-bake', { signal });
    return await fn(arena, workingSet.snapshot());
  } finally {
    workingSet.close();
  }
}

/**
 * Declare the texture-bake cooperative boundary manifest: one gpu-command
 * boundary over the occupied texels, fixed chunking by batchTexels.
 */
function defineTextureBakeManifest(numOccupied, batchTexels) {
  if (!Number.isSafeInteger(numOccupied) || numOccupied <= 0) {
    throw new TypeError('numOccupied must be a positive safe integer');
  }
  if (!Number.isSafeInteger(batchTexels) || batchTexels <= 0) {
    throw new TypeError('batchTexels must be a positive safe integer');
  }
  return defineWebGpuCooperativeBoundaryManifest({
    manifestId: TEXTURE_BAKE_MANIFEST_ID,
    routeId: SF3D_ROUTE_ID,
    phases: [
      {
        phaseId: 'texture-bake',
        boundaries: [
          {
            boundaryId: TEXTURE_BAKE_BOUNDARY_ID,
            kind: 'gpu-command',
            unit: 'texel-batch',
            totalItems: numOccupied,
            progressWeight: numOccupied,
            commandDutyKind: 'compute',
            chunking: { mode: 'fixed', chunkItems: batchTexels },
            yieldPolicy: 'after-duty',
            resources: {
              retain: ['triplane.features', 'decoder.weights'],
              produce: ['texture.albedo', 'texture.normal'],
              release: [],
            },
          },
        ],
      },
    ],
    metadata: { source: 'sf3d-webgpu-cooperative-texture-bake' },
  });
}

/**
 * Build the `cooperativeBatch` callback that bakeTexture/decodeTexelFeatures
 * consumes. It runs a real cooperative execution over the texel boundary and,
 * for each batch, encodes+submits the decode duty (facade fences the queue
 * prefix) and then reads back that batch's outputs.
 *
 * @param {GPUDevice} device
 * @param {object} opts { batchTexels, schedulingMode, onProgress, signal, invocationId }
 * @returns {(numOccupied:number, makeBatch:(start,end)=>Promise<{encode,submit,readback}>)=>Promise<object>}
 *   The returned function resolves to the cooperative execution report.
 */
function makeCooperativeTextureBake(device, opts = {}) {
  const {
    batchTexels = 16384,
    schedulingMode = 'cooperative',
    onProgress,
    signal,
    invocationId = `sf3d:texture-bake:${schedulingMode}`,
    onBrowserYield,
  } = opts;

  return async function cooperativeBatch(numOccupied, makeBatch) {
    const now = () => globalThis.performance?.now?.() ?? Date.now();
    const batch = Math.min(batchTexels, numOccupied);
    const manifest = defineTextureBakeManifest(numOccupied, batch);
    const ranges = [];
    const queueFences = [];
    const cleanupEvents = [];
    const scratch = {
      allocatedCount: 0,
      allocatedBytes: 0,
      retiredCount: 0,
      retiredBytes: 0,
      activeCount: 0,
      activeBytes: 0,
    };
    let activeRange = null;
    const unsubmittedScratch = [];
    const submittedScratch = [];

    const retireScratch = (resources, reason) => {
      const startedAtMs = now();
      let retiredBytes = 0;
      let retiredCount = 0;
      while (resources.length > 0) {
        const resource = resources[0];
        if (!resource || typeof resource.buffer?.destroy !== 'function') {
          throw new TypeError('scratch resource must expose buffer.destroy()');
        }
        resource.buffer.destroy();
        resources.shift();
        retiredBytes += resource.size;
        retiredCount += 1;
        scratch.retiredCount += 1;
        scratch.retiredBytes += resource.size;
        scratch.activeCount -= 1;
        scratch.activeBytes -= resource.size;
      }
      const completedAtMs = now();
      cleanupEvents.push({
        reason,
        retiredCount,
        retiredBytes,
        interval: { startMs: startedAtMs, endMs: completedAtMs },
      });
      return {
        retiredCount,
        retiredBytes,
        interval: { startMs: startedAtMs, endMs: completedAtMs },
      };
    };

    const runtime = createSf3dCooperativeRuntime(device, {
      foregroundOpportunities: opts.foregroundOpportunities ?? null,
      async onQueueFenceResolved(fence) {
        const retirement = retireScratch(submittedScratch, 'queue-prefix-resolved');
        queueFences.push({
          rangeIndex: activeRange?.rangeIndex ?? null,
          itemStart: activeRange?.itemStart ?? null,
          itemEnd: activeRange?.itemEnd ?? null,
          queueWaitMs: fence.queueWaitMs,
          queueInterval: {
            startMs: fence.startedAtMs,
            endMs: fence.completedAtMs,
          },
          retirementMs: retirement.interval.endMs - retirement.interval.startMs,
          retirementInterval: retirement.interval,
          retiredCount: retirement.retiredCount,
          retiredBytes: retirement.retiredBytes,
        });
      },
      async onBrowserYield(yieldEvent) {
        if (activeRange) {
          activeRange.browserYieldMs += yieldEvent.elapsedMs;
          activeRange.browserYieldIntervals.push({
            startMs: yieldEvent.startedAtMs,
            endMs: yieldEvent.completedAtMs,
          });
        }
        if (typeof onBrowserYield === 'function') await onBrowserYield(yieldEvent);
      },
    });
    const execution = createWebGpuCooperativeExecution({
      runtime, manifest, invocationId, schedulingMode, onProgress, signal,
    });

    try {
      await execution.run(async (cooperative) => {
        const gpu = cooperative.startBoundary(TEXTURE_BAKE_BOUNDARY_ID);
        let range;
        while ((range = gpu.nextRange()) != null) {
          const start = range.itemStart, end = range.itemEnd;
          const prepareEncodeStartedAtMs = now();
          const b = await makeBatch(start, end);
          const resources = Array.isArray(b.scratchResources) ? b.scratchResources : [];
          for (const resource of resources) {
            if (!Number.isFinite(resource?.size) || resource.size < 0) {
              throw new TypeError('scratch resource size must be a non-negative finite number');
            }
          }
          const allocatedBytes = resources.reduce((sum, resource) => sum + resource.size, 0);
          unsubmittedScratch.push(...resources);
          scratch.allocatedCount += resources.length;
          scratch.allocatedBytes += allocatedBytes;
          scratch.activeCount += resources.length;
          scratch.activeBytes += allocatedBytes;

          const rangeTelemetry = {
            rangeIndex: range.rangeIndex,
            itemStart: start,
            itemEnd: end,
            itemCount: range.itemCount,
            modelEncodeMs: Number.isFinite(b.hostEncodeMs) ? b.hostEncodeMs : null,
            hostEncodeMs: 0,
            dutyLifecycleMs: 0,
            dutyWallMs: 0,
            browserYieldMs: 0,
            prepareEncodeInterval: {
              startMs: prepareEncodeStartedAtMs,
              endMs: prepareEncodeStartedAtMs,
            },
            submitInterval: null,
            dutyLifecycleInterval: {
              startMs: 0,
              endMs: 0,
            },
            browserYieldIntervals: [],
            scratchAllocatedCount: resources.length,
            scratchAllocatedBytes: allocatedBytes,
          };
          activeRange = rangeTelemetry;
          const dutyStartedAtMs = now();
          rangeTelemetry.dutyLifecycleInterval.startMs = dutyStartedAtMs;
          try {
            // kit >=0.1.41: encode returns the command buffer; the kit submits it
            // (submit callbacks unsupported). The scratch-lifetime bookkeeping
            // that previously lived in the submit callback (marking this range's
            // scratch as submitted so the per-prefix retire can destroy it once
            // the queue prefix fences) moves into encode, right after the command
            // buffer is built — at which point the kit is about to submit it, so
            // the scratch is committed to queued work before onQueueFenceResolved.
            await gpu.runGpuDuty(range, {
              encode: () => {
                const submitStartedAtMs = now();
                try {
                  const commandBuffer = b.encode();
                  submittedScratch.push(...unsubmittedScratch);
                  unsubmittedScratch.length = 0;
                  return commandBuffer;
                } finally {
                  rangeTelemetry.prepareEncodeInterval.endMs = now();
                  rangeTelemetry.hostEncodeMs = (
                    rangeTelemetry.prepareEncodeInterval.endMs
                    - rangeTelemetry.prepareEncodeInterval.startMs
                  );
                  rangeTelemetry.submitInterval = {
                    startMs: submitStartedAtMs,
                    endMs: now(),
                  };
                }
              },
            });
          } finally {
            rangeTelemetry.dutyLifecycleInterval.endMs = now();
            rangeTelemetry.dutyLifecycleMs = (
              rangeTelemetry.dutyLifecycleInterval.endMs
              - rangeTelemetry.dutyLifecycleInterval.startMs
            );
            rangeTelemetry.dutyWallMs = rangeTelemetry.dutyLifecycleMs;
            ranges.push(rangeTelemetry);
            activeRange = null;
          }
          // No per-batch readback: each batch copies its decode into a shared GPU
          // buffer and the whole texture is read back once after the boundary.
        }
      });
    } catch (error) {
      const cleanup = {
        unsubmitted: null,
        recoveryFence: null,
        submitted: null,
      };
      try {
        if (unsubmittedScratch.length > 0) {
          cleanup.unsubmitted = retireScratch(unsubmittedScratch, 'failure-before-submit');
        }
        if (submittedScratch.length > 0) {
          const startedAtMs = now();
          let fenceError = null;
          try {
            await device.queue.onSubmittedWorkDone();
          } catch (recoveryError) {
            fenceError = recoveryError;
          }
          cleanup.recoveryFence = {
            startMs: startedAtMs,
            endMs: now(),
            status: fenceError ? 'rejected-device-unavailable' : 'resolved',
            error: fenceError?.message ?? null,
          };
          cleanup.submitted = retireScratch(
            submittedScratch,
            fenceError ? 'device-unavailable-after-recovery-fence' : 'terminal-recovery-fence',
          );
        }
      } catch (cleanupError) {
        cleanup.error = cleanupError.message;
      }
      error.textureBakeCleanup = Object.freeze(cleanup);
      throw error;
    }

    if (
      unsubmittedScratch.length !== 0
      || submittedScratch.length !== 0
      || scratch.activeCount !== 0
      || scratch.activeBytes !== 0
    ) {
      throw new Error('texture-bake scratch resources remained active after queue completion');
    }
    return Object.freeze({
      ...execution.finish(),
      textureBakeTelemetry: Object.freeze({
        schema: 'sf3d.texture-bake-duty-telemetry.v1',
        ranges: Object.freeze(ranges.map(range => Object.freeze({ ...range }))),
        queueFences: Object.freeze(queueFences.map(fence => Object.freeze({ ...fence }))),
        cleanupEvents: Object.freeze(cleanupEvents.map(event => Object.freeze({ ...event }))),
        scratch: Object.freeze({ ...scratch }),
      }),
    });
  };
}

/**
 * full_pipeline.js — single-image → textured GLB, the complete
 * sf3d.image-to-mesh.webgpu-local.v0 route as one callable.
 *
 * This is the exact step 1–6 sequence main.js runs (inference → CLIP materials →
 * UV unwrap → rasterize → texture bake → GLB export), extracted so the
 * acceptance capsule exercises the SAME route the app does, for both the control
 * (kit 0.1.36) and candidate (kit 0.1.38) arms, without duplicating the sequence
 * inside a browser-eval string.
 *
 * `options` is forwarded to runInference (e.g. { cooperativeDino,
 * dinoSchedulingMode, dinoChunkBlocks, cooperativePostProcessor,
 * postProcessorSchedulingMode, postProcessorDutyGranularity,
 * postProcessorChannelsPerDuty,
 * captureDinoPayload }), so a capsule can select cooperative execution per arm
 * while the rest of the route stays identical.
 */


const COND_SIZE = 512;
const TEX_RESOLUTION$1 = 1024;

/**
 * Run UV unwrap on the main thread, or on a Web Worker when one is supplied.
 * Byte-identical output either way (same unwrapUV code). Vertices/faces are
 * transferred zero-copy to the worker; outputs transferred back.
 */
async function runUvUnwrap(vertices, faces, numVertices, numFaces, worker, workerTimeoutMs) {
  if (!worker) return unwrapUV(vertices, faces, numVertices, numFaces);
  // Transfer sliced copies (one copy) so the caller's arrays stay intact while
  // the worker gets zero-copy ownership.
  const vBuf = vertices.slice().buffer, fBuf = faces.slice().buffer;
  const id = `uv-${Math.random().toString(36).slice(2)}`;
  // Fail-loud lifecycle (crash / malformed / wedge) via callWorker.
  return await callWorker(
    worker,
    { vertices: vBuf, faces: fBuf, numVertices, numFaces, id },
    [vBuf, fBuf],
    {
      timeoutMs: workerTimeoutMs || 30000,
      // Every array at its declared length, finite floats, in-range face
      // indices and chart ids (worker_reply_validation.js); malformed replies
      // throw here rather than reach rasterization / the texture baker.
      onResult: (d) => validateUvUnwrapReply(d),
    },
  );
}

async function runFullPipelineToGlb(device, pipelines, weights, inputImage, options = {}, onProgress) {
  const report = (msg) => { if (onProgress) onProgress(msg); };
  const t0 = performance.now();

  // Absolute-timestamp stage spans on the same performance.now() clock as any
  // caller-side rAF probe, so each foreground frame gap can be attributed to the
  // stage executing during it. Inference substages (dinov2/two-stream/triplane/
  // marching) come back from runInference; the outer steps are marked here.
  const spans = [];
  const mark = (name, start, end) => spans.push({ name, start, end });
  const timed = async (name, fn) => { const s = performance.now(); const r = await fn(); mark(name, s, performance.now()); return r; };

  // Step 1: inference → untextured mesh + triplane data (+ optional DINO payload)
  const meshResult = await runInference(
    device, pipelines, weights, inputImage, report,
    { ...options, recordStageSpans: spans });

  // Step 2: CLIP material estimation (exact PyTorch preprocessing order)
  const clipStart = performance.now();
  const clipCanvas = document.createElement('canvas');
  clipCanvas.width = COND_SIZE;
  clipCanvas.height = COND_SIZE;
  const clipCtx = clipCanvas.getContext('2d');
  clipCtx.drawImage(inputImage, 0, 0, COND_SIZE, COND_SIZE);
  const clipRaw = clipCtx.getImageData(0, 0, COND_SIZE, COND_SIZE).data;
  // Blend / resize / patch-embed run in clip_prep_core — on the main thread, or
  // on options.clipPrepWorker with byte-identical output.
  const { roughness, metallic } = await estimateMaterials(
    device, clipRaw, COND_SIZE, COND_SIZE, weights,
    { clipPrepWorker: options.clipPrepWorker, workerTimeoutMs: options.workerTimeoutMs });
  mark('clip-material-estimate', clipStart, performance.now());

  // Step 3: UV unwrap (CPU). Optionally offloaded to a Web Worker
  // (options.uvUnwrapWorker) — the second-largest CPU foreground gap (~216ms);
  // byte-identical output (same unwrapUV code).
  const uvResult = await timed('uv-unwrap', () => runUvUnwrap(
    meshResult.vertices, meshResult.faces, meshResult.numVertices, meshResult.numFaces,
    options.uvUnwrapWorker, options.workerTimeoutMs));

  // Step 4: rasterize UV → per-texel 3D positions (CPU, synchronous)
  const rasterResult = await timed('uv-rasterize', async () => rasterizeUV(
    uvResult.uvs, uvResult.newVertices, uvResult.newFaces,
    uvResult.newNumFaces, TEX_RESOLUTION$1, uvResult.faceAssignment));

  // Step 5: texture bake (GPU triplane query). Optionally cooperative — batch
  // the per-texel decode into yieldable GPU duties (options.cooperativeBake).
  let bakeReport = null;
  const bakeOptions = {};
  if (options.cooperativeBake) {
    const bakeTelemetry = {};
    const cooperativeBatch = makeCooperativeTextureBake(device, {
      foregroundOpportunities: options.foregroundOpportunities ?? null,
      batchTexels: options.bakeBatchTexels || 16384,
      schedulingMode: options.bakeSchedulingMode === 'disabled' ? 'disabled' : 'cooperative',
      onProgress: (p) => { if (p.percent != null) report(`Texture bake ${p.completedItems}/${p.totalItems} (${p.percent.toFixed(0)}%)`); },
    });
    bakeOptions.cooperativeBatch = async (numOccupied, makeBatch) => { bakeReport = await cooperativeBatch(numOccupied, makeBatch); };
    bakeOptions.telemetry = bakeTelemetry;
    bakeOptions.finalizeTelemetry = () => bakeTelemetry;
  }
  // Optional worker materialization of albedo/normal/dilation (~752ms CPU tail).
  if (options.materializeWorker) {
    bakeOptions.materializeWorker = options.materializeWorker;
    bakeOptions.workerTimeoutMs = options.workerTimeoutMs;
  }
  // Optional decoder scratch arena (options.decoderArena): removes ~1.015GB
  // per-route decode allocation churn by reusing one buffer per slot across
  // ranges, held under the phase-resource working-set lease. maxBatch is the
  // cooperative batch size (the largest N any range decodes).
  const runBake = () => bakeTexture(
    device, meshResult._triplaneDecoder, meshResult._triplanesBuf,
    meshResult._decoderWeights, rasterResult.positions3D, rasterResult.mask,
    rasterResult.tbnData, TEX_RESOLUTION$1, bakeOptions);
  let arenaSnapshot = null;
  const bakeResult = await timed('texture-bake', async () => {
    if (options.decoderArena && options.cooperativeBake) {
      const maxBatch = options.bakeBatchTexels || 16384;
      return await withDecoderArenaLease(device, { maxBatch }, async (arena, snap) => {
        bakeOptions.arena = arena;
        arenaSnapshot = snap;
        const r = await runBake();
        arenaSnapshot = arena.snapshot();
        return r;
      });
    }
    return runBake();
  });
  if (bakeReport && bakeOptions.finalizeTelemetry) {
    bakeReport = Object.freeze({
      ...bakeReport,
      textureBakeTelemetry: Object.freeze({
        ...bakeReport.textureBakeTelemetry,
        phases: Object.freeze({ ...bakeOptions.finalizeTelemetry() }),
      }),
    });
  }

  // Step 6: GLB export
  const glb = await timed('glb-export', () => exportGLB(
    uvResult.newVertices, uvResult.newNormals, uvResult.newFaces, uvResult.uvs,
    bakeResult.albedo, bakeResult.normalMap,
    uvResult.newNumVertices, uvResult.newNumFaces, TEX_RESOLUTION$1,
    roughness, metallic));

  // Which CPU phases ran off the main thread. Every worker dispatcher is
  // fail-loud (callWorker never falls back silently), so a requested worker is
  // an effective worker or a thrown error — this is an effective-route record.
  const offloads = Object.freeze({
    preprocess: options.preprocessWorker ? 'worker' : 'main',
    clipPrep: options.clipPrepWorker ? 'worker' : 'main',
    marchingTet: options.marchingTetWorker ? 'worker' : 'main',
    uvUnwrap: options.uvUnwrapWorker ? 'worker' : 'main',
    materialize: options.materializeWorker ? 'worker' : 'main',
  });

  return {
    stageSpans: spans,
    glb,                                   // ArrayBuffer
    numVertices: meshResult.numVertices,
    numFaces: meshResult.numFaces,
    vertices: meshResult.vertices,         // Float32Array [numVertices*3]
    faces: meshResult.faces,               // Uint32Array [numFaces*3]
    offloads,
    uvNumVertices: uvResult.newNumVertices,
    uvNumFaces: uvResult.newNumFaces,
    roughness,
    metallic,
    cooperativeReports: { ...(meshResult._cooperativeReports || {}), ...(bakeReport ? { 'texture-bake': bakeReport } : {}) },
    arenaSnapshot,
    dinoPayload: meshResult._dinoPayload || null,   // { shape, length, tokens } or null
    sdf: meshResult._sdf,
    isosurfaceThreshold: meshResult._isosurfaceThreshold,
    stageTimings: meshResult._stageTimings || {},
    totalMs: performance.now() - t0,
  };
}

/**
 * product_route.js — the product default composition of the SF3D route.
 *
 * Every foreground-liveness mechanism the port has proven in isolation
 * (cooperative DINO / two-stream / post-processor GPU duties, decoder scratch
 * arena, and CPU worker offload for preprocess, CLIP prep, marching tet,
 * UV unwrap, and texture materialization) lived behind options in
 * full_pipeline.js and was only ever switched on by harness arms. This module
 * is the single place where the product path turns them all on with the
 * settings those harnesses measured, so main.js and the witness harnesses run
 * the same route.
 *
 * The defaults are frozen data so a contract test can pin them; the worker
 * factory is separate because Workers are browser objects that a Node contract
 * test cannot construct.
 */

// Settings measured green in the A/B harnesses:
//   DINO: 24 fixed one-block duties (capsule + conformance).
//   two-stream: attention-tile duties, 256 linear rows per duty — the Pareto
//     profile from the clean paired assay (2,922 duties, zero local gaps over
//     16.7ms, 1.7x wall); 128 rows (4,218 duties) was rejected as too slow.
//   post-processor: channel-range duties, 16 channels per duty, bounded-prefix
//     depth 2 (702 duties; validator-backed acceptance).
//   texture bake: 4096-texel cooperative batches + decoder scratch arena +
//     worker materialization (five-arm paired product comparison).
const PRODUCT_ROUTE_DEFAULTS = Object.freeze({
  cooperativeDino: true,
  dinoSchedulingMode: 'cooperative',
  dinoChunkBlocks: 1,

  cooperativeTwoStream: true,
  twoStreamSchedulingMode: 'cooperative',
  twoStreamDutyGranularity: 'attention-tile',
  twoStreamLinearRowsPerDuty: 256,

  cooperativePostProcessor: true,
  postProcessorSchedulingMode: 'cooperative',
  postProcessorDutyGranularity: 'channel-range',
  postProcessorChannelsPerDuty: 16,
  postProcessorCompletionPolicy: 'bounded-prefix',
  postProcessorMaxInFlightGpuDuties: 2,

  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,

  workerTimeoutMs: 120000,
});

/** Worker roles the product route offloads, keyed by the option name each one fills. */
const PRODUCT_ROUTE_WORKER_ROLES = Object.freeze({
  preprocessWorker: './preprocess_worker.js',
  clipPrepWorker: './clip_prep_worker.js',
  marchingTetWorker: './marching_tet_worker.js',
  uvUnwrapWorker: './uv_unwrap_worker.js',
  materializeWorker: './materialize_worker.js',
});

/**
 * Create one module Worker per role. Browser-only (needs `Worker`). Workers are
 * long-lived so weights / tet-grid state can stay resident across runs.
 *
 * Each `new Worker(new URL('./x.js', import.meta.url), { type: 'module' })` is
 * written out literally: Vite discovers and bundles worker modules by static
 * analysis of exactly that shape, so a table-driven loop would work in dev and
 * silently break the production build.
 */
/**
 * Resolved module URLs of the five workers, explicit for a host that mounts
 * the producer (Wake answer 4: worker module URLs must be visible and must
 * survive the built artifact). Literal `new URL('./x', import.meta.url)`
 * expressions so every bundler emits the chunks.
 */
function productRouteWorkerModuleUrls() {
  return Object.freeze({
    preprocessWorker: new URL("data:text/javascript;base64,LyoqCiAqIHByZXByb2Nlc3Nfd29ya2VyLmpzIOKAlCBXZWIgV29ya2VyIHRoYXQgcnVucyB0aGUgZXhwZW5zaXZlIGltYWdlLXByZXByb2Nlc3MKICogbWF0aCAoTGFuY3pvcy0zIHJlc2l6ZSArIGJsZW5kICsgbm9ybWFsaXplKSBvZmYgdGhlIG1haW4gdGhyZWFkLgogKgogKiBSZWNlaXZlcyByYXcgZmxvYXQzMiBSR0JBIHNvdXJjZSBwaXhlbHMgKHRyYW5zZmVycmVkLCB6ZXJvLWNvcHkpICsgcGFyYW1zLAogKiByZXR1cm5zIHRoZSBDSFcgZmxvYXQzMiB0ZW5zb3IgKHRyYW5zZmVycmVkIGJhY2spLiBUaGUgbWFpbiB0aHJlYWQgc3RheXMKICogcmVzcG9uc2l2ZSBkdXJpbmcgdGhlIH43MDBtcyB0aGF0IHRoaXMgd29yayB3b3VsZCBvdGhlcndpc2UgYmxvY2sgaXQuCiAqCiAqIFVzZXMgdGhlIFNBTUUgcHJlcHJvY2Vzc19jb3JlIG1hdGggYXMgdGhlIG1haW4tdGhyZWFkIHBhdGgsIHNvIG91dHB1dCBpcwogKiBieXRlLWlkZW50aWNhbC4KICovCmltcG9ydCB7IHJlc2l6ZUJsZW5kTm9ybWFsaXplIH0gZnJvbSAnLi9wcmVwcm9jZXNzX2NvcmUuanMnOwoKc2VsZi5vbm1lc3NhZ2UgPSAoZSkgPT4gewogIGNvbnN0IHsgc3JjQnVmZmVyLCBzcmNXLCBzcmNILCBzaXplLCBiZywgaW1hZ2VNZWFuLCBpbWFnZVN0ZCwgaWQgfSA9IGUuZGF0YTsKICB0cnkgewogICAgY29uc3Qgc3JjRmxvYXQgPSBuZXcgRmxvYXQzMkFycmF5KHNyY0J1ZmZlcik7CiAgICBjb25zdCBjaHcgPSByZXNpemVCbGVuZE5vcm1hbGl6ZShzcmNGbG9hdCwgc3JjVywgc3JjSCwgc2l6ZSwgYmcsIGltYWdlTWVhbiwgaW1hZ2VTdGQpOwogICAgc2VsZi5wb3N0TWVzc2FnZSh7IGlkLCBvazogdHJ1ZSwgY2h3QnVmZmVyOiBjaHcuYnVmZmVyIH0sIFtjaHcuYnVmZmVyXSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBzZWxmLnBvc3RNZXNzYWdlKHsgaWQsIG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZyhlcnI/LnN0YWNrIHx8IGVycikgfSk7CiAgfQp9Owo=", import.meta.url).href,
    clipPrepWorker: new URL("data:text/javascript;base64,LyoqCiAqIGNsaXBfcHJlcF93b3JrZXIuanMg4oCUIFdlYiBXb3JrZXIgcnVubmluZyB0aGUgQ0xJUCBDUFUgcHJlcCAoYWxwaGEtYmxlbmQsCiAqIDUxMuKGkjIyNCByZXNpemUgKyBub3JtYWxpemUsIDMyw5czMiBwYXRjaCBlbWJlZGRpbmcpIG9mZiB0aGUgbWFpbiB0aHJlYWQuCiAqCiAqIFByb3RvY29sIChyZXF1ZXN0L3Jlc3BvbnNlIGJ5IGlkLCBkcml2ZW4gdGhyb3VnaCB3b3JrZXJfY2FsbC5qcyk6CiAqICAgeyB0eXBlOiAnaW5pdCcsIGlkLCBjb252MVcsIGNsYXNzRW1iLCBwb3NFbWIgfSAgIEFycmF5QnVmZmVycyAoY29waWVkIGluCiAqICAgICAgIG9uY2U7IHRoZSB3b3JrZXIga2VlcHMgdGhlbSByZXNpZGVudCkgICAgICDihpIgeyBpZCwgb2s6IHRydWUsIGluaXRpYWxpemVkOiB0cnVlIH0KICogICB7IGlkLCByZ2JhLCB3aWR0aCwgaGVpZ2h0IH0gICAgICAgICAgICAgICAgICAgICByZ2JhIEFycmF5QnVmZmVyICh0cmFuc2ZlcnJlZCkKICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg4oaSIHsgaWQsIG9rOiB0cnVlLCBlbWJlZGRpbmdzIH0gICh0cmFuc2ZlcnJlZCkKICogVXNlcyB0aGUgU0FNRSBjbGlwX3ByZXBfY29yZSBtYXRoIGFzIHRoZSBtYWluLXRocmVhZCBwYXRoLCBzbyB0aGUKICogWzUwLCA3NjhdIGVtYmVkZGluZ3MgYXJlIGJ5dGUtaWRlbnRpY2FsLgogKi8KaW1wb3J0IHsgcHJlcGFyZUNsaXBFbWJlZGRpbmdzLCB2YWxpZGF0ZUNsaXBQcmVwV2VpZ2h0cyB9IGZyb20gJy4vY2xpcF9wcmVwX2NvcmUuanMnOwoKbGV0IHByZXBXZWlnaHRzID0gbnVsbDsKCnNlbGYub25tZXNzYWdlID0gKGUpID0+IHsKICBjb25zdCBkID0gZS5kYXRhOwogIGlmIChkPy50eXBlID09PSAnaW5pdCcpIHsKICAgIHRyeSB7CiAgICAgIHByZXBXZWlnaHRzID0gdmFsaWRhdGVDbGlwUHJlcFdlaWdodHMoewogICAgICAgIGNvbnYxVzogbmV3IEZsb2F0MzJBcnJheShkLmNvbnYxVyksCiAgICAgICAgY2xhc3NFbWI6IG5ldyBGbG9hdDMyQXJyYXkoZC5jbGFzc0VtYiksCiAgICAgICAgcG9zRW1iOiBuZXcgRmxvYXQzMkFycmF5KGQucG9zRW1iKSwKICAgICAgfSk7CiAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyBpZDogZC5pZCwgb2s6IHRydWUsIGluaXRpYWxpemVkOiB0cnVlIH0pOwogICAgfSBjYXRjaCAoZXJyKSB7CiAgICAgIHNlbGYucG9zdE1lc3NhZ2UoeyBpZDogZC5pZCwgb2s6IGZhbHNlLCBlcnJvcjogU3RyaW5nKGVycj8uc3RhY2sgfHwgZXJyKSB9KTsKICAgIH0KICAgIHJldHVybjsKICB9CiAgdHJ5IHsKICAgIGlmICghcHJlcFdlaWdodHMpIHRocm93IG5ldyBFcnJvcignY2xpcCBwcmVwIHdvcmtlciB1c2VkIGJlZm9yZSBpbml0Jyk7CiAgICBjb25zdCBlbWJlZGRpbmdzID0gcHJlcGFyZUNsaXBFbWJlZGRpbmdzKG5ldyBVaW50OENsYW1wZWRBcnJheShkLnJnYmEpLCBkLndpZHRoLCBkLmhlaWdodCwgcHJlcFdlaWdodHMpOwogICAgc2VsZi5wb3N0TWVzc2FnZSh7IGlkOiBkLmlkLCBvazogdHJ1ZSwgZW1iZWRkaW5nczogZW1iZWRkaW5ncy5idWZmZXIgfSwgW2VtYmVkZGluZ3MuYnVmZmVyXSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBzZWxmLnBvc3RNZXNzYWdlKHsgaWQ6IGQuaWQsIG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZyhlcnI/LnN0YWNrIHx8IGVycikgfSk7CiAgfQp9Owo=", import.meta.url).href,
    marchingTetWorker: new URL("data:text/javascript;base64,LyoqCiAqIG1hcmNoaW5nX3RldF93b3JrZXIuanMg4oCUIFdlYiBXb3JrZXIgcnVubmluZyBtYXJjaGluZyB0ZXRyYWhlZHJhIG9mZiB0aGUgbWFpbgogKiB0aHJlYWQuIFRoZSB0ZXQgZ3JpZCAoNTM1LDg4MiB2ZXJ0aWNlcyAvIDIuOTdNIHRldHMsIH40N01CIG9mIGluZGljZXMpIGlzCiAqIGxvYWRlZCBPTkNFIGJ5IHRoZSB3b3JrZXIgYXQgc3RhcnR1cCBhbmQgc3RheXMgcmVzaWRlbnQsIHNvIGEgcnVuIG9ubHkgc2hpcHMKICogdGhlIHBlci1ydW4gU0RGICgyTUIpIGFuZCB2ZXJ0ZXggb2Zmc2V0cyAoNi40TUIpIGluIGFuZCB0aGUgbWVzaCBvdXQuCiAqCiAqIFByb3RvY29sIChyZXF1ZXN0L3Jlc3BvbnNlIGJ5IGlkLCBkcml2ZW4gdGhyb3VnaCB3b3JrZXJfY2FsbC5qcyk6CiAqICAgeyBpZCwgc2RmLCB2ZXJ0ZXhPZmZzZXRzfG51bGwsIGJib3g6IFtsbywgaGldLCByZXNvbHV0aW9uIH0KICogICAgIHNkZiAvIHZlcnRleE9mZnNldHM6IEFycmF5QnVmZmVycyAodHJhbnNmZXJyZWQpCiAqICAg4oaSIHsgaWQsIG9rOiB0cnVlLCB2ZXJ0aWNlcywgZmFjZXMsIG51bVZlcnRpY2VzLCBudW1GYWNlcyB9ICAodHJhbnNmZXJyZWQpCiAqIFVzZXMgdGhlIFNBTUUgbWFyY2hpbmdfdGV0IG1hdGggYW5kIHRoZSBzYW1lIHNjYWxlVGVuc29yIGdyaWQgc2NhbGluZyBhcyB0aGUKICogbWFpbi10aHJlYWQgcGF0aCwgc28gdGhlIG1lc2ggaXMgYnl0ZS1pZGVudGljYWwuCiAqLwppbXBvcnQgeyBsb2FkVGV0RGF0YSwgbWFyY2hpbmdUZXRyYWhlZHJhLCBzY2FsZVRlbnNvciB9IGZyb20gJy4vbWFyY2hpbmdfdGV0LmpzJzsKCi8vIFN0YXJ0IGxvYWRpbmcgdGhlIGdyaWQgaW1tZWRpYXRlbHk7IHJlcXVlc3RzIGF3YWl0IGl0LiBBIGxvYWQgZmFpbHVyZSBpcwovLyByZXBvcnRlZCBvbiBldmVyeSByZXF1ZXN0IHJhdGhlciB0aGFuIHN3YWxsb3dlZC4KY29uc3QgdGV0UmVhZHkgPSBsb2FkVGV0RGF0YSgpOwoKc2VsZi5vbm1lc3NhZ2UgPSBhc3luYyAoZSkgPT4gewogIGNvbnN0IHsgaWQsIHNkZiwgdmVydGV4T2Zmc2V0cywgYmJveCwgcmVzb2x1dGlvbiB9ID0gZS5kYXRhOwogIHRyeSB7CiAgICBjb25zdCB0ZXQgPSBhd2FpdCB0ZXRSZWFkeTsKICAgIGlmICghQXJyYXkuaXNBcnJheShiYm94KSB8fCBiYm94Lmxlbmd0aCAhPT0gMiB8fCAhYmJveC5ldmVyeShOdW1iZXIuaXNGaW5pdGUpKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcignbWFyY2hpbmcgdGV0IHJlcXVlc3QgcmVxdWlyZXMgYSBmaW5pdGUgW2xvLCBoaV0gYmJveCcpOwogICAgfQogICAgY29uc3QgZ3JpZFBvc2l0aW9ucyA9IHNjYWxlVGVuc29yKHRldC5ncmlkVmVydGljZXMsIFswLCAxXSwgYmJveCk7CiAgICBjb25zdCBzZGZBcnIgPSBuZXcgRmxvYXQzMkFycmF5KHNkZik7CiAgICBpZiAoc2RmQXJyLmxlbmd0aCAhPT0gdGV0Lm51bVZlcnRpY2VzKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcihgc2RmIGxlbmd0aCAke3NkZkFyci5sZW5ndGh9ICE9IHRldCBncmlkIHZlcnRpY2VzICR7dGV0Lm51bVZlcnRpY2VzfWApOwogICAgfQogICAgY29uc3Qgb2Zmc2V0cyA9IHZlcnRleE9mZnNldHMgPyBuZXcgRmxvYXQzMkFycmF5KHZlcnRleE9mZnNldHMpIDogbnVsbDsKICAgIGlmIChvZmZzZXRzICYmIG9mZnNldHMubGVuZ3RoICE9PSB0ZXQubnVtVmVydGljZXMgKiAzKSB7CiAgICAgIHRocm93IG5ldyBFcnJvcihgdmVydGV4T2Zmc2V0cyBsZW5ndGggJHtvZmZzZXRzLmxlbmd0aH0gIT0gJHt0ZXQubnVtVmVydGljZXMgKiAzfWApOwogICAgfQogICAgY29uc3QgbWVzaCA9IG1hcmNoaW5nVGV0cmFoZWRyYShncmlkUG9zaXRpb25zLCBzZGZBcnIsIHRldC5pbmRpY2VzLCBvZmZzZXRzLCByZXNvbHV0aW9uKTsKICAgIHNlbGYucG9zdE1lc3NhZ2UoewogICAgICBpZCwgb2s6IHRydWUsCiAgICAgIHZlcnRpY2VzOiBtZXNoLnZlcnRpY2VzLmJ1ZmZlciwKICAgICAgZmFjZXM6IG1lc2guZmFjZXMuYnVmZmVyLAogICAgICBudW1WZXJ0aWNlczogbWVzaC5udW1WZXJ0aWNlcywKICAgICAgbnVtRmFjZXM6IG1lc2gubnVtRmFjZXMsCiAgICB9LCBbbWVzaC52ZXJ0aWNlcy5idWZmZXIsIG1lc2guZmFjZXMuYnVmZmVyXSk7CiAgfSBjYXRjaCAoZXJyKSB7CiAgICBzZWxmLnBvc3RNZXNzYWdlKHsgaWQsIG9rOiBmYWxzZSwgZXJyb3I6IFN0cmluZyhlcnI/LnN0YWNrIHx8IGVycikgfSk7CiAgfQp9Owo=", import.meta.url).href,
    uvUnwrapWorker: new URL("data:text/javascript;base64,LyoqCiAqIHV2X3Vud3JhcF93b3JrZXIuanMg4oCUIFdlYiBXb3JrZXIgcnVubmluZyB0aGUgQ1BVIFVWLXVud3JhcCBvZmYgdGhlIG1haW4gdGhyZWFkLgogKgogKiB1di11bndyYXAgaXMgdGhlIHNlY29uZC1sYXJnZXN0IENQVSBmb3JlZ3JvdW5kIGdhcCAofjIxNm1zKSBwcm9maWxpbmcgZm91bmQsCiAqIGFuZCB1bndyYXBVViBpcyBhbHJlYWR5IHB1cmUgKHR5cGVkIGFycmF5cyBpbi9vdXQsIG5vIERPTS9HUFUpLCBzbyB3ZSBpbXBvcnQgaXQKICogZGlyZWN0bHkgZnJvbSB0ZXh0dXJlX2Jha2VyLmpzLiBncHUuanMncyBHUFVCdWZmZXJVc2FnZSByZWZzIGFyZSBpbnNpZGUKICogZnVuY3Rpb25zIChub3QgbW9kdWxlIHRvcC1sZXZlbCksIHNvIGltcG9ydGluZyBoZXJlIGRvZXMgbm90IGNyYXNoIHRoZSB3b3JrZXI7CiAqIHdlIG5ldmVyIGNhbGwgdGhlIEdQVSBmdW5jdGlvbnMuCiAqCiAqIE91dHB1dCAobmV3VmVydGljZXMvbmV3Tm9ybWFscy9uZXdGYWNlcy91dnMvZmFjZUFzc2lnbm1lbnQpIGlzIGJ5dGUtaWRlbnRpY2FsCiAqIHRvIHRoZSBtYWluLXRocmVhZCBwYXRoIOKAlCBzYW1lIHVud3JhcFVWIGNvZGUuCiAqLwppbXBvcnQgeyB1bndyYXBVViB9IGZyb20gJy4vdGV4dHVyZV9iYWtlci5qcyc7CgpzZWxmLm9ubWVzc2FnZSA9IChlKSA9PiB7CiAgY29uc3QgeyB2ZXJ0aWNlcywgZmFjZXMsIG51bVZlcnRpY2VzLCBudW1GYWNlcywgaWQgfSA9IGUuZGF0YTsKICB0cnkgewogICAgY29uc3QgciA9IHVud3JhcFVWKG5ldyBGbG9hdDMyQXJyYXkodmVydGljZXMpLCBuZXcgVWludDMyQXJyYXkoZmFjZXMpLCBudW1WZXJ0aWNlcywgbnVtRmFjZXMpOwogICAgLy8gVHJhbnNmZXIgYWxsIG91dHB1dCBidWZmZXJzIGJhY2sgKHplcm8tY29weSkuCiAgICBjb25zdCB0cmFuc2ZlcnMgPSBbCiAgICAgIHIubmV3VmVydGljZXMuYnVmZmVyLCByLm5ld05vcm1hbHMuYnVmZmVyLCByLm5ld0ZhY2VzLmJ1ZmZlciwKICAgICAgci51dnMuYnVmZmVyLCByLmZhY2VBc3NpZ25tZW50LmJ1ZmZlciwKICAgIF07CiAgICBzZWxmLnBvc3RNZXNzYWdlKHsKICAgICAgaWQsIG9rOiB0cnVlLAogICAgICBuZXdWZXJ0aWNlczogci5uZXdWZXJ0aWNlcy5idWZmZXIsCiAgICAgIG5ld05vcm1hbHM6IHIubmV3Tm9ybWFscy5idWZmZXIsCiAgICAgIG5ld0ZhY2VzOiByLm5ld0ZhY2VzLmJ1ZmZlciwKICAgICAgdXZzOiByLnV2cy5idWZmZXIsCiAgICAgIGZhY2VBc3NpZ25tZW50OiByLmZhY2VBc3NpZ25tZW50LmJ1ZmZlciwKICAgICAgbmV3TnVtVmVydGljZXM6IHIubmV3TnVtVmVydGljZXMsCiAgICAgIG5ld051bUZhY2VzOiByLm5ld051bUZhY2VzLAogICAgfSwgdHJhbnNmZXJzKTsKICB9IGNhdGNoIChlcnIpIHsKICAgIHNlbGYucG9zdE1lc3NhZ2UoeyBpZCwgb2s6IGZhbHNlLCBlcnJvcjogU3RyaW5nKGVycj8uc3RhY2sgfHwgZXJyKSB9KTsKICB9Cn07Cg==", import.meta.url).href,
    materializeWorker: new URL("data:text/javascript;base64,LyoqCiAqIG1hdGVyaWFsaXplX3dvcmtlci5qcyDigJQgV2ViIFdvcmtlciBydW5uaW5nIHRoZSB0ZXh0dXJlIG1hdGVyaWFsaXphdGlvbgogKiAoYWxiZWRvICsgbm9ybWFsICsgZGlsYXRpb24pIG9mZiB0aGUgbWFpbiB0aHJlYWQuIENyYW5pYWwncyBhc3NheSdzIH43NTJtcwogKiBDUFUgdGFpbC4gVXNlcyB0aGUgU0FNRSBtYXRlcmlhbGl6ZV9jb3JlIG1hdGgsIHNvIG91dHB1dCBpcyBieXRlLWlkZW50aWNhbC4KICoKICogUmVjZWl2ZXMgdGhlIGRlY29kZWQgZmVhdHVyZS9ub3JtYWwgcGF5bG9hZHMgKyBUQk4vbWFzayAodHJhbnNmZXJyZWQgemVyby1jb3B5KQogKiBhbmQgcmV0dXJucyB0aGUgYWxiZWRvICsgbm9ybWFsIFVpbnQ4QXJyYXlzICh0cmFuc2ZlcnJlZCBiYWNrKS4KICovCmltcG9ydCB7IG1hdGVyaWFsaXplVGV4dHVyZXMgfSBmcm9tICcuL21hdGVyaWFsaXplX2NvcmUuanMnOwoKc2VsZi5vbm1lc3NhZ2UgPSAoZSkgPT4gewogIGNvbnN0IHsgZmVhdHVyZXNCdWYsIG5vcm1hbHNCdWYsIG9jY3VwaWVkQnVmLCB0Ym5CdWYsIG1hc2tCdWYsIHJlc29sdXRpb24sIG51bU9jY3VwaWVkLCBpZCB9ID0gZS5kYXRhOwogIHRyeSB7CiAgICBjb25zdCB7IGFsYmVkbywgbm9ybWFsTWFwIH0gPSBtYXRlcmlhbGl6ZVRleHR1cmVzKHsKICAgICAgZmVhdHVyZXNDUFU6IG5ldyBGbG9hdDMyQXJyYXkoZmVhdHVyZXNCdWYpLAogICAgICBub3JtYWxzQ1BVOiBuZXcgRmxvYXQzMkFycmF5KG5vcm1hbHNCdWYpLAogICAgICBvY2N1cGllZEluZGljZXM6IG5ldyBVaW50MzJBcnJheShvY2N1cGllZEJ1ZiksCiAgICAgIHRibkRhdGE6IG5ldyBGbG9hdDMyQXJyYXkodGJuQnVmKSwKICAgICAgbWFzazogbmV3IFVpbnQ4QXJyYXkobWFza0J1ZiksCiAgICAgIHJlc29sdXRpb24sCiAgICAgIG51bU9jY3VwaWVkLAogICAgfSk7CiAgICBzZWxmLnBvc3RNZXNzYWdlKAogICAgICB7IGlkLCBvazogdHJ1ZSwgYWxiZWRvOiBhbGJlZG8uYnVmZmVyLCBub3JtYWxNYXA6IG5vcm1hbE1hcC5idWZmZXIgfSwKICAgICAgW2FsYmVkby5idWZmZXIsIG5vcm1hbE1hcC5idWZmZXJdLAogICAgKTsKICB9IGNhdGNoIChlcnIpIHsKICAgIHNlbGYucG9zdE1lc3NhZ2UoeyBpZCwgb2s6IGZhbHNlLCBlcnJvcjogU3RyaW5nKGVycj8uc3RhY2sgfHwgZXJyKSB9KTsKICB9Cn07Cg==", import.meta.url).href,
  });
}

function createProductRouteWorkers() {
  if (typeof Worker !== 'function') {
    throw new Error('createProductRouteWorkers requires a browser Worker constructor');
  }
  return {
    preprocessWorker: new Worker(new URL(/* @vite-ignore */ ""+new URL('assets/preprocess_worker-bgjDsAyv.js', import.meta.url).href+"", import.meta.url), { type: 'module', name: 'sf3d-preprocess' }),
    clipPrepWorker: new Worker(new URL(/* @vite-ignore */ ""+new URL('assets/clip_prep_worker-BWfO1owo.js', import.meta.url).href+"", import.meta.url), { type: 'module', name: 'sf3d-clip-prep' }),
    marchingTetWorker: new Worker(new URL(/* @vite-ignore */ ""+new URL('assets/marching_tet_worker-UZQLtgqC.js', import.meta.url).href+"", import.meta.url), { type: 'module', name: 'sf3d-marching-tet' }),
    uvUnwrapWorker: new Worker(new URL(/* @vite-ignore */ ""+new URL('assets/uv_unwrap_worker-29CGZ7RB.js', import.meta.url).href+"", import.meta.url), { type: 'module', name: 'sf3d-uv-unwrap' }),
    materializeWorker: new Worker(new URL(/* @vite-ignore */ ""+new URL('assets/materialize_worker-DQccQ8JG.js', import.meta.url).href+"", import.meta.url), { type: 'module', name: 'sf3d-materialize' }),
  };
}

function terminateProductRouteWorkers(workers) {
  for (const worker of Object.values(workers || {})) {
    try { worker.terminate(); } catch { /* already gone */ }
  }
}

/**
 * Compose the options object runFullPipelineToGlb consumes. `workers` is the
 * object from createProductRouteWorkers (or a subset for A/B arms); `overrides`
 * is applied last so a harness can hold everything but one mechanism fixed.
 *
 * Fail-loud: unknown worker roles are rejected rather than silently ignored,
 * because a misspelled role would fall back to the main-thread path and quietly
 * reintroduce the foreground gap the worker exists to remove.
 */
function createProductRouteOptions({ workers = {}, overrides = {} } = {}) {
  for (const role of Object.keys(workers)) {
    if (!(role in PRODUCT_ROUTE_WORKER_ROLES)) {
      throw new Error(`unknown product route worker role: ${role}`);
    }
  }
  return Object.freeze({
    ...PRODUCT_ROUTE_DEFAULTS,
    ...workers,
    ...overrides,
  });
}

/**
 * Names of the mechanisms an options object enables, for effective-config
 * receipts (a witness must record what actually ran, not what was requested).
 */
function describeProductRouteOptions(options) {
  return Object.freeze({
    cooperativeDino: options.cooperativeDino === true && options.dinoSchedulingMode !== 'disabled',
    cooperativeTwoStream: options.cooperativeTwoStream === true && options.twoStreamSchedulingMode !== 'disabled',
    twoStreamDutyGranularity: options.cooperativeTwoStream === true ? options.twoStreamDutyGranularity ?? 'stage' : null,
    cooperativePostProcessor: options.cooperativePostProcessor === true && options.postProcessorSchedulingMode !== 'disabled',
    postProcessorDutyGranularity: options.cooperativePostProcessor === true ? options.postProcessorDutyGranularity ?? 'plane' : null,
    postProcessorCompletionPolicy: options.cooperativePostProcessor === true ? options.postProcessorCompletionPolicy ?? 'strict-prefix' : null,
    cooperativeBake: options.cooperativeBake === true && options.bakeSchedulingMode !== 'disabled',
    bakeBatchTexels: options.cooperativeBake === true ? options.bakeBatchTexels ?? 16384 : null,
    decoderArena: options.decoderArena === true && options.cooperativeBake === true,
    workers: Object.freeze(Object.fromEntries(
      Object.keys(PRODUCT_ROUTE_WORKER_ROLES).map(role => [role, Boolean(options[role])]),
    )),
  });
}

/**
 * Foreground-opportunity bridge — the SF3D producer's explicit integration of
 * the kit's foreground-opportunity interlock for a host that shares SF3D's
 * GPUDevice (the Kaminos kiln composition).
 *
 * Contract:
 *   - request({ requestId, run, metadata }) returns a kit-shaped handle
 *     { requestId, completion, cancel }. run(context) receives
 *     { device, queue, signal, submit(commandBuffers, { submissionId, metadata }) }
 *     exactly as the kit interlock hands it out.
 *   - While an SF3D run is active the request is queued on that run's kit
 *     interlock and serviced before the next SF3D GPU duty encodes (the
 *     cooperative runtime calls serviceAtBoundary from
 *     prepareCommandDutyAtBoundary). Nothing in that path is SF3D-owned
 *     scheduling; it is the kit's interlock verbatim.
 *   - Two holes a bare interlock leaves open are closed here:
 *       1. no run active → there is never a boundary; the request executes
 *          immediately on the device (receipt marked servicedOutsideRun);
 *       2. run active but SF3D is in a CPU-only stretch (UV unwrap, UV
 *          rasterize, GLB export, worker waits) → no scheduler boundary
 *          arrives; an idle drain services pending demand through a
 *          producer-owned before-encode boundary once no scheduler boundary
 *          has serviced demand for drainAfterMs (default one frame). When
 *          scheduler boundaries are frequent (every cooperative duty) the
 *          drain never fires; it is a liveness floor, not a cap.
 *   - finish() drains any still-pending demand through a final boundary
 *     (never cancels host frames) and returns the kit's finish report plus
 *     producer counters (scheduler / idle-drain / finish-drain services).
 *
 * Retention: the kit interlock retains every receipt of a run (uncapped, kit
 * policy). Outside-run receipts are delivered to their requester through
 * completion; the bridge keeps counters and the last receipt, not the history
 * (a host frame loop between runs would otherwise grow without bound).
 */

const SF3D_FOREGROUND_BRIDGE_SCHEMA = 'sf3d.foreground-opportunity-bridge.v0';
const SF3D_FOREGROUND_OUTSIDE_RUN_RECEIPT_SCHEMA = 'sf3d.foreground-opportunity-outside-run-receipt.v0';
const SF3D_FOREGROUND_IDLE_DRAIN_PHASE = 'sf3d-producer-idle-drain';
const SF3D_FOREGROUND_RUN_FINISH_PHASE = 'sf3d-producer-run-finish';

const isPlainObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const normalizeError = (e) => ({ name: e?.name ?? 'Error', message: e?.message ?? String(e) });
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const defaultNow = () => globalThis.performance?.now?.() ?? Date.now();

function createForegroundOpportunityBridge({
  routeId,
  device,
  queue = device?.queue,
  now = defaultNow,
  drainIntervalMs = 8,
  drainAfterMs = 16.7,
} = {}) {
  if (!isNonEmptyString(routeId)) throw new Error('routeId must be a non-empty string');
  if (!device || typeof device !== 'object') throw new Error('device must be an object');
  if (!queue || typeof queue.submit !== 'function') throw new Error('queue.submit must be a function');
  if (!(Number.isFinite(drainIntervalMs) && drainIntervalMs > 0)) throw new Error('drainIntervalMs must be > 0');
  if (!(Number.isFinite(drainAfterMs) && drainAfterMs >= 0)) throw new Error('drainAfterMs must be >= 0');

  const state = {
    activeRun: null,
    runCount: 0,
    outsideRun: { inFlight: new Map(), receiptCount: 0, completedCount: 0, failedCount: 0, lastReceipt: null },
  };

  function validateRequest(input) {
    if (!isPlainObject(input)) throw new Error('foreground opportunity request must be an object');
    if (!isNonEmptyString(input.requestId)) throw new Error('requestId must be a non-empty string');
    if (typeof input.run !== 'function') throw new Error('foreground opportunity run must be a function');
    if (input.metadata != null && !isPlainObject(input.metadata)) {
      throw new Error('foreground opportunity metadata must be an object when provided');
    }
  }

  // --- No active run: execute immediately on the device (kit-shaped context). ---
  function executeOutsideRun(input) {
    validateRequest(input);
    const { requestId } = input;
    if (state.outsideRun.inFlight.has(requestId)) {
      throw new Error(`duplicate foreground opportunity request ${requestId}`);
    }
    const metadata = clone(input.metadata || {});
    const abortController = new AbortController();
    const submissions = [];
    const requestedAtMs = now();
    // Reserve the id before the callback is invoked (the async body below runs
    // synchronously up to its first await, so a re-entrant duplicate must
    // already be visible), exactly as the kit reserves before service.
    let settledReceipt = null;
    let resolveReserved;
    state.outsideRun.inFlight.set(requestId, new Promise(resolve => { resolveReserved = resolve; }));
    const completion = (async () => {
      let result = null;
      let failure = null;
      const startedAtMs = now();
      try {
        result = await input.run(Object.freeze({
          schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
          routeId,
          runId: null,
          requestId,
          boundary: null,
          device,
          queue,
          signal: abortController.signal,
          submit(commandBuffers, submissionInput = {}) {
            if (abortController.signal.aborted) throw new Error('foreground opportunity was canceled before submission');
            if (!Array.isArray(commandBuffers) || commandBuffers.length === 0) {
              throw new Error('foreground opportunity submit requires a non-empty command buffer array');
            }
            if (!isPlainObject(submissionInput)) throw new Error('foreground submission input must be an object');
            const submissionId = submissionInput.submissionId || `${requestId}:submission:${submissions.length + 1}`;
            if (!isNonEmptyString(submissionId)) throw new Error('submissionId must be a non-empty string');
            if (submissions.some(row => row.submissionId === submissionId)) {
              throw new Error(`duplicate foreground submission ${submissionId}`);
            }
            let submissionMetadata;
            try { submissionMetadata = clone(submissionInput.metadata || {}); } catch (error) {
              throw new Error(`foreground submission metadata must be JSON-serializable: ${error.message}`);
            }
            const submittedAtMs = now();
            try {
              queue.submit(commandBuffers);
              const row = Object.freeze({
                submissionId, submissionSequence: submissions.length + 1, commandBufferCount: commandBuffers.length,
                submittedAtMs, returnedAtMs: now(), submissionStatus: 'queue-submit-returned', metadata: submissionMetadata,
                authority: 'queue-submit-call-returned-no-gpu-completion-or-presentation-claim',
              });
              submissions.push(row);
              return row;
            } catch (error) {
              submissions.push(Object.freeze({
                submissionId, submissionSequence: submissions.length + 1, commandBufferCount: commandBuffers.length,
                submittedAtMs, returnedAtMs: now(), submissionStatus: 'queue-submit-threw', metadata: submissionMetadata,
                failure: normalizeError(error), authority: 'queue-submit-call-failed-no-gpu-submission-claim',
              }));
              throw error;
            }
          },
        }));
      } catch (error) {
        failure = { phase: 'foreground-callback', error: normalizeError(error) };
      }
      let resultClone = null;
      if (!failure) {
        try { resultClone = clone(result ?? null); } catch (error) {
          failure = { phase: 'foreground-result-serialization', error: normalizeError(error) };
        }
      }
      const successfulSubmissionCount = submissions.filter(row => row.submissionStatus === 'queue-submit-returned').length;
      const canceled = abortController.signal.aborted;
      const receipt = Object.freeze({
        schema: SF3D_FOREGROUND_OUTSIDE_RUN_RECEIPT_SCHEMA,
        routeId,
        runId: null,
        requestId,
        status: canceled
          ? 'canceled-during-service'
          : (failure ? (successfulSubmissionCount > 0 ? 'failed-after-submission' : 'failed-before-submission') : 'completed'),
        servicedOutsideRun: true,
        requestedAtMs,
        startedAtMs,
        settledAtMs: now(),
        boundary: null,
        result: resultClone,
        submissions: Object.freeze(submissions.slice()),
        successfulSubmissionCount,
        failure,
        cancellation: canceled ? { reason: String(abortController.signal.reason || 'foreground-opportunity-canceled') } : null,
        metadata,
        authority: 'immediate-queue-submit-outside-sf3d-run-no-gpu-completion-or-presentation-claim',
      });
      settledReceipt = receipt;
      state.outsideRun.inFlight.delete(requestId);
      resolveReserved(receipt);
      state.outsideRun.receiptCount += 1;
      if (receipt.status === 'completed') state.outsideRun.completedCount += 1; else state.outsideRun.failedCount += 1;
      state.outsideRun.lastReceipt = receipt;
      return receipt;
    })();
    return Object.freeze({
      requestId,
      completion,
      cancel(reason = 'foreground-opportunity-canceled') {
        if (settledReceipt) return settledReceipt;   // kit handle shape: settled → the receipt
        abortController.abort(String(reason));
        return Object.freeze({ status: 'cancellation-requested', requestId, reason: String(reason) });
      },
    });
  }

  function request(input) {
    const run = state.activeRun;
    if (run && !run.finishing) {
      validateRequest(input);
      const handle = run.interlock.request(input);
      run.requestCount += 1;
      return handle;
    }
    // No run, or the run is finishing (its GPU work is over; only the final
    // drain of already-queued demand remains): execute immediately rather than
    // enter an interlock that will never see another boundary.
    return executeOutsideRun(input);
  }

  // --- Active run: kit interlock + idle drain. ---
  function beginRun(runId) {
    if (state.activeRun) {
      throw new Error(`sf3d foreground bridge already has an active run (${state.activeRun.runId})`);
    }
    if (!isNonEmptyString(runId)) throw new Error('runId must be a non-empty string');
    const interlock = createWebGpuForegroundOpportunityInterlock({ routeId, runId, device, queue, now });
    const run = {
      runId,
      interlock,
      active: true,
      finishing: false,
      requestCount: 0,
      lastServiceAtMs: now(),
      schedulerBoundaryServiceCount: 0,
      idleDrainBoundaryCount: 0,
      idleDrainServicedCount: 0,
      finishDrainServicedCount: 0,
      drainFailures: [],
      drainTimer: null,
      drainInFlight: null,
    };
    state.runCount += 1;
    state.activeRun = run;

    const foregroundOpportunities = Object.freeze({
      schema: WEBGPU_FOREGROUND_OPPORTUNITY_SCHEMA,
      routeId,
      runId,
      async serviceAtBoundary(boundary) {
        const service = await interlock.serviceAtBoundary(boundary);
        run.lastServiceAtMs = now();
        if (service.status !== 'no-demand') run.schedulerBoundaryServiceCount += 1;
        return service;
      },
      pressureSnapshot: () => interlock.pressureSnapshot(),
      snapshot: () => interlock.snapshot(),
    });

    const producerBoundary = (phase, sequence, reason) => ({
      invocationId: `${runId}:${phase}`,
      boundaryId: `${runId}:${phase}:${sequence}`,
      dutyId: `${phase}:${sequence}`,
      phase,
      position: 'before-encode',
      metadata: { runtimeLabel: 'sf3d-producer-foreground-bridge', reason, drainAfterMs, drainIntervalMs },
    });

    const drainTick = async () => {
      run.drainTimer = null;
      if (!run.active) return;
      const pressure = interlock.pressureSnapshot();
      if (pressure.pendingRequestCount > 0 && pressure.activeServiceCount === 0 && pressure.queuedServiceCount === 0
          && now() - run.lastServiceAtMs >= drainAfterMs) {
        run.idleDrainBoundaryCount += 1;
        run.drainInFlight = (async () => {
          try {
            const service = await interlock.serviceAtBoundary(
              producerBoundary(SF3D_FOREGROUND_IDLE_DRAIN_PHASE, run.idleDrainBoundaryCount, 'no-scheduler-boundary-within-budget'));
            run.idleDrainServicedCount += service.servicedRequestCount ?? 0;
          } catch (error) {
            run.drainFailures.push(normalizeError(error));
          } finally {
            run.lastServiceAtMs = now();
            run.drainInFlight = null;
          }
        })();
        await run.drainInFlight;
      }
      if (run.active) run.drainTimer = setTimeout(drainTick, drainIntervalMs);
    };
    run.drainTimer = setTimeout(drainTick, drainIntervalMs);

    async function finish() {
      if (!run.active) throw new Error(`sf3d foreground run ${runId} already finished`);
      // Atomic closing state: from here no request enters this interlock
      // (request() reroutes to immediate execution) while state.activeRun stays
      // set so a second run is still refused until the interlock has finished.
      run.finishing = true;
      run.active = false;
      if (run.drainTimer != null) { clearTimeout(run.drainTimer); run.drainTimer = null; }
      if (run.drainInFlight) await run.drainInFlight;
      let finishService = null;
      let finishBoundarySequence = 0;
      // Nothing new can enter after `finishing`. Drain what is still pending,
      // and wait for any scheduler service turn that is mid-flight (the kit
      // moves captured requests from pending to active before awaiting their
      // callbacks, so pending alone cannot see it): the kit's finish() report
      // is `succeeded` only when pending, active and service counters are all
      // zero. In-flight turns always settle, so this loop terminates.
      for (;;) {
        const p = interlock.pressureSnapshot();
        if (p.pendingRequestCount > 0) {
          finishBoundarySequence += 1;
          finishService = await interlock.serviceAtBoundary(
            producerBoundary(SF3D_FOREGROUND_RUN_FINISH_PHASE, finishBoundarySequence, 'run-finished-with-pending-foreground-demand'));
          run.finishDrainServicedCount += finishService.servicedRequestCount ?? 0;
          continue;
        }
        if (p.activeRequestCount > 0 || p.activeServiceCount > 0 || p.queuedServiceCount > 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          continue;
        }
        break;
      }
      const report = interlock.finish();
      state.activeRun = null;
      return Object.freeze({
        ...report,
        producer: Object.freeze({
          schema: SF3D_FOREGROUND_BRIDGE_SCHEMA,
          runId,
          requestCount: run.requestCount,
          schedulerBoundaryServiceCount: run.schedulerBoundaryServiceCount,
          idleDrainBoundaryCount: run.idleDrainBoundaryCount,
          idleDrainServicedCount: run.idleDrainServicedCount,
          finishDrainServicedCount: run.finishDrainServicedCount,
          finishDrainStatus: finishService?.status ?? null,
          drainFailures: Object.freeze(run.drainFailures.map(f => ({ ...f }))),
          drainAfterMs,
          drainIntervalMs,
          authority: 'producer-boundary-service-counters-no-presentation-claim',
        }),
      });
    }

    return Object.freeze({ runId, foregroundOpportunities, finish });
  }

  function snapshot() {
    const run = state.activeRun;
    return Object.freeze({
      schema: SF3D_FOREGROUND_BRIDGE_SCHEMA,
      routeId,
      runCount: state.runCount,
      activeRun: run ? Object.freeze({
        runId: run.runId,
        finishing: run.finishing,
        requestCount: run.requestCount,
        pressure: run.interlock.pressureSnapshot(),
        schedulerBoundaryServiceCount: run.schedulerBoundaryServiceCount,
        idleDrainBoundaryCount: run.idleDrainBoundaryCount,
      }) : null,
      outsideRunInFlightCount: state.outsideRun.inFlight.size,
      outsideRunReceiptCount: state.outsideRun.receiptCount,
      outsideRunCompletedCount: state.outsideRun.completedCount,
      outsideRunFailedCount: state.outsideRun.failedCount,
      lastOutsideRunReceipt: state.outsideRun.lastReceipt,
    });
  }

  return Object.freeze({ schema: SF3D_FOREGROUND_BRIDGE_SCHEMA, routeId, request, beginRun, snapshot });
}

/**
 * Producer lifecycle: one run at a time, and a dispose() that is safe to call
 * at any time. A host tearing down while a run is outstanding must not leak
 * the run (bridge run open, drain timer firing, second run refused forever) or
 * release buffers the run is still using; the release is deferred until that
 * run ends, and everything new is refused from the moment dispose is requested.
 * Pure (no GPU), so the contract is testable in Node.
 */
function createProducerLifecycle({ release }) {
  if (typeof release !== 'function') throw new Error('release must be a function');
  const state = { activeRunId: null, disposed: false, released: false };
  const doRelease = () => {
    if (state.released) return;
    state.released = true;
    release();
  };
  return Object.freeze({
    get activeRunId() { return state.activeRunId; },
    get disposed() { return state.disposed; },
    beginRun(runId) {
      if (state.disposed) throw new Error('sf3d producer is disposed');
      if (state.activeRunId != null) throw new Error(`sf3d producer already has an active run (${state.activeRunId})`);
      state.activeRunId = runId;
    },
    /** 'released' when a deferred dispose ran at this run's end, else 'idle'. */
    endRun(runId) {
      if (state.activeRunId !== runId) throw new Error(`${runId} is not the active run (${state.activeRunId ?? 'none'})`);
      state.activeRunId = null;
      if (state.disposed) { doRelease(); return 'released'; }
      return 'idle';
    },
    assertAcceptingRequests() {
      if (state.disposed) throw new Error('sf3d producer is disposed');
    },
    dispose() {
      if (state.disposed) return Object.freeze({ status: 'already-disposed' });
      state.disposed = true;
      if (state.activeRunId != null) return Object.freeze({ status: 'deferred-until-run-ends', runId: state.activeRunId });
      doRelease();
      return Object.freeze({ status: 'released' });
    },
  });
}

/**
 * Validate every fallible run input BEFORE acquiring lifecycle or bridge
 * state, then acquire both and hand back one exactly-once release boundary.
 * A rejected run therefore never leaves an active run behind (r2 HIGH,
 * 2026-09-16: an empty run id or a bad route override used to wedge the
 * producer after lifecycle.beginRun had already fired).
 *
 * buildOptions() must return the frozen route options WITHOUT the
 * foreground interlock; it is attached here from the bridge run.
 */
function prepareProducerRun({ lifecycle, bridge, runId, buildOptions }) {
  if (typeof runId !== 'string' || !runId.trim()) throw new Error('runId must be a non-empty string');
  if (typeof buildOptions !== 'function') throw new Error('buildOptions must be a function');
  const baseOptions = buildOptions();            // throws on unknown worker roles / bad overrides
  lifecycle.beginRun(runId);                       // refuses when disposed or a run is active
  let foregroundRun;
  try {
    foregroundRun = bridge.beginRun(runId);
  } catch (error) {
    lifecycle.endRun(runId);
    throw error;
  }
  const options = Object.freeze({ ...baseOptions, foregroundOpportunities: foregroundRun.foregroundOpportunities });
  let released = null;
  return Object.freeze({
    runId,
    options,
    foregroundRun,
    /** Finish the bridge run and end the lifecycle run exactly once; returns the foreground report. */
    async release() {
      if (released) return released;
      released = (async () => {
        try {
          return await foregroundRun.finish();
        } finally {
          lifecycle.endRun(runId);
        }
      })();
      return released;
    },
  });
}

/**
 * SF3D producer — the device/adapter-injected callable a Kaminos host composes
 * into its own route (the kiln composition: the host owns the GPUDevice, SF3D
 * runs on it, host frames are submitted through the kit's foreground-
 * opportunity interlock before each SF3D GPU duty).
 *
 *   const producer = await createSf3dProducer({ device, adapter, weightsUrl });
 *   const handle = producer.requestForegroundOpportunity({ requestId, run(ctx) { ... ctx.submit([cb]) } });
 *   const { glb, receipt, foregroundOpportunityReport } = await producer.run(image, { runId });
 *   producer.dispose();
 *
 * Without an injected device the producer requests its own (the standalone
 * app path). The route is the product route (every proven foreground-liveness
 * mechanism on by default: cooperative GPU duties, decoder arena, five CPU
 * offload workers); routeOverrides adjust it per run.
 *
 * Honest boundaries: one run at a time per producer (the pipelines and decoder
 * arena are not reentrant); `signal` is checked at run start only (no mid-run
 * cancellation of SF3D GPU work); the route receipt's artifact hashes are
 * 'not-computed' as in the app (the witness harness hashes the GLB).
 * `dispose()` terminates producer-created workers and releases producer-loaded
 * weight buffers; it never destroys an injected device or injected weights;
 * called during a run it defers the release until the run ends and refuses
 * new runs and requests meanwhile (returns the status).
 * A failed run throws with `error.sf3dRun` = { runId, lastProgress,
 * foregroundOpportunityReport, identity } so the host keeps the phase and the
 * last trustworthy evidence.
 */

const SF3D_PRODUCER_SCHEMA = 'sf3d.producer.v0';
const SF3D_PRODUCER_RUN_IDENTITY_SCHEMA = 'sf3d.producer-run-identity.v0';

/** Resolve the weights URL the way loadWeights will fetch it (absolute when a document location exists). */
function resolveWeightsUrl(weightsUrl, base = globalThis.location?.href ?? null) {
  if (typeof weightsUrl !== 'string' || !weightsUrl) throw new Error('weightsUrl must be a non-empty string');
  try { return new URL(weightsUrl, base ?? undefined).href; } catch { return weightsUrl; }
}

/** Producer-created GPU weight buffers are released on dispose; injected weights and the borrowed device never are. */
function releaseLoadedWeights(weights) {
  let released = 0;
  for (const value of Object.values(weights || {})) {
    if (value && typeof value.destroy === 'function') { value.destroy(); released += 1; }
  }
  return released;
}

/** Run/clock identity bound to a producer run (Wake answer 5: run/clock identity + effective topology). */
function buildRunIdentity({ runId, routeId, startedAtMs, finishedAtMs, deviceInjected, commit, kitVersion }) {
  return Object.freeze({
    schema: SF3D_PRODUCER_RUN_IDENTITY_SCHEMA,
    runId,
    routeId,
    timeOrigin: globalThis.performance?.timeOrigin ?? null,
    clock: 'performance.now',
    startedAtMs,
    finishedAtMs,
    durationMs: finishedAtMs - startedAtMs,
    deviceTopology: deviceInjected ? 'host-injected-device' : 'producer-owned-device',
    producerCommit: commit,
    kitVersion,
  });
}
const SF3D_REQUIRED_RECEIPT_STAGES = Object.freeze([
  'image-preprocess', 'dinov2-tokenizer', 'two-stream-backbone',
  'triplane-decode', 'marching-tet', 'texture-bake', 'glb-export',
]);
const TEX_RESOLUTION = 1024;

async function describeBackend(adapter, device) {
  let info = adapter?.info ?? device.adapterInfo ?? null;
  if (!info && adapter?.requestAdapterInfo) info = await adapter.requestAdapterInfo();
  info = info || {};
  const limits = adapter?.limits ?? device.limits;
  const features = [...(adapter?.features ?? device.features ?? [])];
  const identity = createWebGpuBackendIdentity({
    adapterName: info.description || info.device || 'unknown',
    browser: globalThis.navigator?.userAgent ?? 'unknown',
    requestedFeatures: features,
    effectiveFeatures: features,
    limits: {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
    },
    timestampQuery: features.includes('timestamp-query') ? 'available' : 'unavailable',
  });
  return { identity, info, limits, features };
}

function buildRouteReceipt({ backend, image, result, commit }) {
  const profile = createStagedSubmitProfile({
    route: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    timingSource: 'performance-now-wall-clock',
    requiredStages: [...SF3D_REQUIRED_RECEIPT_STAGES],
  });
  const stageTimings = result.stageTimings || {};
  for (const name of ['image-preprocess', 'dinov2-tokenizer', 'two-stream-backbone', 'triplane-decode', 'marching-tet']) {
    addStagedSubmitStage(profile, { name, ms: stageTimings[name] || 0 });
  }
  const spanMs = (name) => {
    const span = (result.stageSpans || []).find(s => s.name === name);
    return span ? span.end - span.start : 0;
  };
  addStagedSubmitStage(profile, { name: 'texture-bake', ms: spanMs('texture-bake') });
  addStagedSubmitStage(profile, { name: 'glb-export', ms: spanMs('glb-export') });

  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  return createSf3dImageToMeshRouteReceipt({
    input: { artifactId: `source-image:${width}x${height}`, sha256: 'not-computed', shape: [height, width, 4] },
    outputs: {
      meshGlb: { artifactId: `mesh-glb:${result.numVertices}v-${result.numFaces}f`, sha256: 'not-computed', shape: [result.glb.byteLength] },
      albedoTexture: { artifactId: `albedo-texture:${TEX_RESOLUTION}`, sha256: 'not-computed', shape: [TEX_RESOLUTION, TEX_RESOLUTION, 4] },
      normalMap: { artifactId: `normal-map:${TEX_RESOLUTION}`, sha256: 'not-computed', shape: [TEX_RESOLUTION, TEX_RESOLUTION, 4] },
    },
    backend: backend.identity,
    model: { revision: 'v1.0.0-webgpu', weightsHash: 'not-computed' },
    kernel: {
      kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
      profile: 'dinov2-two-stream-triplane-marching-tet-texture-bake',
      commit,
    },
    profile,
  });
}

async function createSf3dProducer({
  device = null,
  adapter = null,
  weights = null,
  weightsUrl = 'weights.bin',
  workers = null,
  onWeightsProgress = null,
  commit = (typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'),
} = {}) {
  const gpu = await initGPU(device ? { device, adapter } : {});
  const dev = gpu.device;
  const backend = await describeBackend(gpu.adapter, dev);
  const ownsWeights = weights == null;
  const modelWeights = weights ?? await loadWeights(dev, weightsUrl, onWeightsProgress || undefined);
  // Explicit resource identity for a mounting host: where the weights came
  // from and which worker module URLs must be reachable from the artifact.
  const resources = Object.freeze({
    weightsSource: ownsWeights ? 'loaded-by-producer' : 'injected-by-host',
    weightsUrl: ownsWeights ? resolveWeightsUrl(weightsUrl) : null,
    weightsSha256: 'not-computed',
    workerModuleUrls: productRouteWorkerModuleUrls(),
    workersSource: workers == null ? 'created-by-producer' : 'injected-by-host',
  });
  const pipelines = initPipelines(dev);
  const ownsWorkers = workers == null;
  const routeWorkers = workers ?? createProductRouteWorkers();
  const bridge = createForegroundOpportunityBridge({ routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID, device: dev, queue: dev.queue });

  let runSequence = 0;
  // One run at a time; dispose() during a run defers the release until the
  // run ends and refuses everything new meanwhile (producer_lifecycle.js).
  const lifecycle = createProducerLifecycle({
    release() {
      if (ownsWorkers) terminateProductRouteWorkers(routeWorkers);
      // Release what the producer created; never destroy an injected weight set
      // or the (possibly borrowed) device.
      if (ownsWeights) releaseLoadedWeights(modelWeights);
    },
  });

  return Object.freeze({
    schema: SF3D_PRODUCER_SCHEMA,
    routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID,
    kitVersion: WEBGPU_INFERENCE_KIT_VERSION,
    device: dev,
    adapter: gpu.adapter,
    deviceInjected: gpu.injected,
    weights: modelWeights,
    pipelines,
    workers: routeWorkers,
    backend: backend.identity,
    resources,
    adapterInfo: backend.info,
    adapterLimits: backend.limits,
    adapterFeatures: Object.freeze([...backend.features]),
    get activeRunId() { return lifecycle.activeRunId; },
    get disposed() { return lifecycle.disposed; },

    /** Host (kiln) frames: kit-shaped { requestId, run(ctx), metadata } → { requestId, completion, cancel }. */
    requestForegroundOpportunity(request) {
      lifecycle.assertAcceptingRequests();
      return bridge.request(request);
    },
    foregroundSnapshot() { return bridge.snapshot(); },

    async run(image, { runId = null, onProgress = null, routeOverrides = {}, signal = null } = {}) {
      if (image == null) throw new Error('sf3d run requires an image (HTMLImageElement/ImageBitmap-like)');
      if (signal?.aborted) throw new Error('sf3d run aborted before start');
      runSequence += 1;
      const id = runId ?? `sf3d-run-${runSequence}`;
      // Every fallible input is validated before any state is acquired, and
      // everything after acquisition sits under one exactly-once release
      // boundary (producer_lifecycle.js prepareProducerRun).
      const prepared = prepareProducerRun({
        lifecycle, bridge, runId: id,
        buildOptions: () => createProductRouteOptions({ workers: routeWorkers, overrides: routeOverrides }),
      });
      const { options } = prepared;
      let result;
      let foregroundOpportunityReport;
      let lastProgress = null;
      const startedAtMs = performance.now();
      const progress = (message) => { lastProgress = String(message); if (onProgress) onProgress(message); };
      try {
        result = await runFullPipelineToGlb(dev, pipelines, modelWeights, image, options, progress);
      } catch (error) {
        // Preserve the phase and the last trustworthy evidence on the error
        // (Wake answer 5): the host keeps it with its own episode receipts.
        foregroundOpportunityReport = await prepared.release();   // finishes the bridge run, ends the lifecycle run (deferred dispose if requested)
        try {
          error.sf3dRun = Object.freeze({
            runId: id,
            lastProgress,
            foregroundOpportunityReport,
            identity: buildRunIdentity({ runId: id, routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID, startedAtMs, finishedAtMs: performance.now(), deviceInjected: gpu.injected, commit, kitVersion: WEBGPU_INFERENCE_KIT_VERSION }),
          });
        } catch { /* error object not extensible; the throw still carries the message */ }
        throw error;
      }
      foregroundOpportunityReport = await prepared.release();       // finishes the bridge run, ends the lifecycle run (deferred dispose if requested)
      const finishedAtMs = performance.now();
      const receipt = buildRouteReceipt({ backend, image, result, commit });
      const receiptValidation = validateRouteReceipt(receipt);
      return Object.freeze({
        schema: 'sf3d.producer-run-result.v0',
        runId: id,
        identity: buildRunIdentity({ runId: id, routeId: SF3D_IMAGE_TO_MESH_ROUTE_ID, startedAtMs, finishedAtMs, deviceInjected: gpu.injected, commit, kitVersion: WEBGPU_INFERENCE_KIT_VERSION }),
        resources,
        glb: result.glb,
        receipt,
        receiptValidation,
        routeOptions: describeProductRouteOptions(options),
        offloads: result.offloads,
        cooperativeReports: result.cooperativeReports,
        stageSpans: result.stageSpans,
        stageTimings: result.stageTimings,
        totalMs: result.totalMs,
        foregroundOpportunityReport,
        numVertices: result.numVertices,
        numFaces: result.numFaces,
        vertices: result.vertices,
        faces: result.faces,
        roughness: result.roughness,
        metallic: result.metallic,
        sdf: result.sdf,
        isosurfaceThreshold: result.isosurfaceThreshold,
        arenaSnapshot: result.arenaSnapshot,
        dinoPayload: result.dinoPayload,
      });
    },

    /**
     * Safe at any time. With no run active: releases producer-created workers
     * and weight buffers now. During a run: refuses new runs/requests at once
     * and releases when the run ends (the run's own finish and receipts still
     * happen). Never destroys an injected device or injected weights.
     * Returns { status: 'released' | 'deferred-until-run-ends' | 'already-disposed' }.
     */
    dispose() {
      return lifecycle.dispose();
    },
  });
}

export { SF3D_PRODUCER_RUN_IDENTITY_SCHEMA, SF3D_PRODUCER_SCHEMA, SF3D_REQUIRED_RECEIPT_STAGES, buildRunIdentity, createSf3dProducer, releaseLoadedWeights, resolveWeightsUrl };
//# sourceMappingURL=sf3d-producer.js.map
