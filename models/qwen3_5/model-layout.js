import { readQwen35Config } from './config.js';

export function qwen35ModelLayout(manifest) {
  if (manifest?.schema !== 'kaminos.qwen35-text-weights.v1') throw new Error('expected Qwen text weight manifest');
  const quant = manifest.config?.quantization;
  if (quant?.bits !== 4 || quant.group_size !== 64 || quant.mode !== 'affine') throw new Error('unsupported source quantization');
  const config = readQwen35Config(manifest.config), raw = manifest.config.text_config ?? manifest.config;
  if (raw.attention_bias !== false || raw.tie_word_embeddings !== false || raw.hidden_act !== 'silu' || raw.attn_output_gate !== true) throw new Error('unsupported dense text-model variant');
  if (!Number.isFinite(raw.rms_norm_eps) || raw.rms_norm_eps <= 0) throw new Error('rms_norm_eps is required');
  const tensors = manifest.tensors, projections = new Map(), vectors = new Map();
  function tensor(name, shape, dtype) {
    const record = tensors?.[name];
    if (!record || record.dtype !== dtype || JSON.stringify(record.shape) !== JSON.stringify(shape)) throw new Error(`missing or incompatible tensor ${name}`);
    const bytes = shape.reduce((a, b) => a * b, 1) * (dtype === 'BF16' ? 2 : 4);
    if (record.bytes !== bytes || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error(`invalid tensor identity ${name}`);
    return record;
  }
  function linear(name, rows, columns) {
    if (columns % 64) throw new Error('projection width must be divisible by group64');
    projections.set(name, { name, rows, columns, group: 64, weight: tensor(name + '.weight', [rows, columns / 8], 'U32'),
      scales: tensor(name + '.scales', [rows, columns / 64], 'BF16'), biases: tensor(name + '.biases', [rows, columns / 64], 'BF16') });
  }
  function vector(name, shape) { vectors.set(name, tensor(name, shape, 'BF16')); }
  const c = config, deltaWidth = 2 * c.linearKeyHeads * c.linearKeyDim + c.linearValueHeads * c.linearValueDim;
  linear('model.embed_tokens', c.vocabSize, c.hiddenSize); linear('lm_head', c.vocabSize, c.hiddenSize);
  vector('model.norm.weight', [c.hiddenSize]);
  c.layers.forEach((type, i) => {
    const root = `model.layers.${i}`;
    vector(root + '.input_layernorm.weight', [c.hiddenSize]); vector(root + '.post_attention_layernorm.weight', [c.hiddenSize]);
    linear(root + '.mlp.gate_proj', c.intermediateSize, c.hiddenSize); linear(root + '.mlp.up_proj', c.intermediateSize, c.hiddenSize);
    linear(root + '.mlp.down_proj', c.hiddenSize, c.intermediateSize);
    if (type === 'linear_attention') {
      linear(root + '.linear_attn.in_proj_qkv', deltaWidth, c.hiddenSize);
      linear(root + '.linear_attn.in_proj_z', c.linearValueHeads * c.linearValueDim, c.hiddenSize);
      linear(root + '.linear_attn.in_proj_a', c.linearValueHeads, c.hiddenSize); linear(root + '.linear_attn.in_proj_b', c.linearValueHeads, c.hiddenSize);
      linear(root + '.linear_attn.out_proj', c.hiddenSize, c.linearValueHeads * c.linearValueDim);
      vector(root + '.linear_attn.conv1d.weight', [deltaWidth, c.convKernel, 1]);
      vector(root + '.linear_attn.A_log', [c.linearValueHeads]); vector(root + '.linear_attn.dt_bias', [c.linearValueHeads]);
      vector(root + '.linear_attn.norm.weight', [c.linearValueDim]);
    } else {
      linear(root + '.self_attn.q_proj', 2 * c.queryHeads * c.headDim, c.hiddenSize);
      linear(root + '.self_attn.k_proj', c.kvHeads * c.headDim, c.hiddenSize); linear(root + '.self_attn.v_proj', c.kvHeads * c.headDim, c.hiddenSize);
      linear(root + '.self_attn.o_proj', c.hiddenSize, c.queryHeads * c.headDim);
      vector(root + '.self_attn.q_norm.weight', [c.headDim]); vector(root + '.self_attn.k_norm.weight', [c.headDim]);
    }
  });
  return { config, epsilon: raw.rms_norm_eps, projections, vectors };
}
