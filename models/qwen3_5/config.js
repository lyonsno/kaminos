function positive(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}
function tensor(shape, dtype) {
  const elements = shape.reduce((a, b) => a * b, 1);
  const byteLength = elements * (dtype === 'f16' ? 2 : 4);
  positive(byteLength, 'tensor byte length');
  return { shape, dtype, byteLength };
}

// Configuration support is not model execution support. Preserve per-layer
// kinds explicitly; never reinterpret a recurrent layer as ordinary attention.
export function readQwen35Config(source) {
  if (!['qwen3_5', 'qwen3_5_text'].includes(source?.model_type)) throw new Error('expected dense Qwen3.5 configuration');
  const raw = source.text_config ?? source;
  const names = {
    hiddenSize: 'hidden_size', intermediateSize: 'intermediate_size', vocabSize: 'vocab_size',
    numLayers: 'num_hidden_layers', queryHeads: 'num_attention_heads', kvHeads: 'num_key_value_heads',
    headDim: 'head_dim', linearKeyHeads: 'linear_num_key_heads', linearValueHeads: 'linear_num_value_heads',
    linearKeyDim: 'linear_key_head_dim', linearValueDim: 'linear_value_head_dim',
    convKernel: 'linear_conv_kernel_dim', maxPositions: 'max_position_embeddings',
  };
  const config = Object.fromEntries(Object.entries(names).map(([name, key]) => [name, positive(raw[key], key)]));
  if (!Array.isArray(raw.layer_types) || raw.layer_types.length !== config.numLayers || raw.layer_types.some(type => !['linear_attention', 'full_attention'].includes(type))) {
    throw new Error('layer_types must declare every supported layer');
  }
  if (config.queryHeads % config.kvHeads || config.linearValueHeads % config.linearKeyHeads) throw new Error('query/value heads must divide into their key-head groups');
  const rope = raw.rope_parameters;
  if (!rope || !Number.isFinite(rope.rope_theta) || rope.rope_theta <= 0) throw new Error('rope_parameters.rope_theta is required');
  const rotaryDim = config.headDim * (rope.partial_rotary_factor ?? raw.partial_rotary_factor);
  if (!Number.isInteger(rotaryDim) || rotaryDim < 2 || rotaryDim > config.headDim || rotaryDim % 2) throw new Error('partial rotary dimension must be even and lie within head_dim');
  if (raw.mamba_ssm_dtype !== 'float32') throw new Error('only float32 recurrent state is supported');
  return Object.freeze({ ...config, layers: Object.freeze([...raw.layer_types]), rotaryDim, ropeTheta: rope.rope_theta });
}

export function planQwen35State(config, { capacity, kvDtype = 'f16' } = {}) {
  positive(capacity, 'capacity');
  if (capacity > config.maxPositions) throw new RangeError('capacity exceeds model positions');
  if (!['f16', 'f32'].includes(kvDtype)) throw new Error('KV dtype must be f16 or f32');
  let kvBytes = 0, recurrentBytes = 0, convolutionBytes = 0;
  const layers = config.layers.map((type, index) => {
    if (type === 'full_attention') {
      const kv = tensor([2, capacity, config.kvHeads, config.headDim], kvDtype);
      kvBytes += kv.byteLength; return { index, type, kv };
    }
    const recurrent = tensor([config.linearValueHeads, config.linearKeyDim, config.linearValueDim], 'f32');
    const channels = 2 * config.linearKeyHeads * config.linearKeyDim + config.linearValueHeads * config.linearValueDim;
    const convolution = tensor([channels, config.convKernel], 'f32');
    recurrentBytes += recurrent.byteLength; convolutionBytes += convolution.byteLength;
    return { index, type, recurrent, convolution };
  });
  const totalBytes = kvBytes + recurrentBytes + convolutionBytes;
  positive(totalBytes, 'total state byte length');
  return { capacity, layers, kvBytes, recurrentBytes, convolutionBytes, totalBytes };
}
