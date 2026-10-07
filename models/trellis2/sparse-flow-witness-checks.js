import { buildSparseFlowPlan } from './sparse-flow.js';
import { sparseBlockWeightShapes } from './sparse-block.js';
import { compareBlockTensor } from './sparse-block-witness-checks.js';
import { buildSLatFlowPlan } from './slat-flow.js';

export const FLOW_REFERENCE_ROUTE = 'pinned-MLX-GPU-full-sparse-flow/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU/F32-terminal';
export const SLAT_REFERENCE_ROUTE = 'pinned-MLX-GPU-full-SLat/fast-SDPA/two-pass-LN/mlx-sum-QK/real-RoPE/source-BF16-GELU/F32-terminal';

export function slatWitnessRequiredLimits(plan, adapterLimits) {
  const { block: b, prefix: p } = plan.flow, c = b.channels;
  // Actual storage shapes in the prefix, shared block workspace, terminal
  // head and coordinate producer. Heads serialize over one score buffer.
  const shapes = [plan.inputShape, plan.outputShape, plan.coordinateShape, plan.phasesShape,
    p.inputShape, p.projectedShape, p.modulationShape, [p.frequencyDim], [p.channels],
    [c, p.inChannels], [c, p.frequencyDim], [c, c], [6 * c, c],
    [b.rows, 3 * c], [b.rows, b.hidden], [b.rows, Math.max(b.rows, b.contextRows)],
    [b.contextRows, b.contextChannels], [b.contextRows, 2 * c], [65536],
    [plan.flow.outChannels, c], ...Object.values(sparseBlockWeightShapes(b)),
    [64 ** 3], [32 ** 3, 3]];
  const bytes = shapes.map(shape => shape.reduce((a, n) => a * n, 4));
  if (!bytes.every(n => Number.isSafeInteger(n) && n > 0)) throw RangeError('invalid SLat storage geometry');
  const largest = Math.max(...bytes);
  const required = { maxStorageBufferBindingSize: Math.max(134217728, largest),
    maxBufferSize: Math.max(268435456, largest) };
  for (const [field, label] of [['maxStorageBufferBindingSize', 'storage binding'], ['maxBufferSize', 'buffer']]) {
    if (!Number.isSafeInteger(adapterLimits?.[field]) || required[field] > adapterLimits[field])
      throw RangeError(`complete source geometry exceeds actual adapter ${label} capacity`);
  }
  return required;
}

export function validateSLatFlowFixture(m) {
  if(m?.schema!=='trellis2.slat-flow-reference.v0'||m.status!=='succeeded')throw Error('complete SLat reference required');
  const p=buildSLatFlowPlan(m.config),f=p.flow,c=f.block.channels,r=p.tokenRows,hash=x=>/^[a-f0-9]{64}$/.test(x);
  if(f.numBlocks!==30||c!==1536||f.block.heads!==12||f.block.hidden!==8192||f.block.contextRows!==1029||f.block.contextChannels!==1024||f.prefix.frequencyDim!==256)
    throw Error('complete source SLat configuration required');
  if(!/^[a-f0-9]{40}$/.test(m.source?.commit)||m.source.dirty!==''||!/^[a-f0-9]{40}$/.test(m.producer?.commit)||m.producer.dirty!==''||
    ![m.checkpoint?.sha256,m.conditioning?.sha256,m.sample?.sha256,m.coordinates?.manifestSha256].every(hash)||
    m.coordinates?.sourceCommit!==m.source.commit||m.coordinates?.coordinateOrder!=='z-y-x-lexicographic'||
    m.sample?.generator!=='numpy-PCG64-standard-normal-f32'||!Number.isSafeInteger(m.sample?.seed))throw Error('SLat source/input identity mismatch');
  const b=m.effectiveBackend,t=m.timeConvention;
  if(m.referenceRoute!==SLAT_REFERENCE_ROUTE||m.fullModelExecutions!==1||m.blocksExecuted!==30||b?.device!=='Device(gpu, 0)'||b.attention!=='fast'||
    b.qk?.backend!=='mlx-sum'||b.layernorm?.backend!=='mlx-two-pass'||b.rope?.backend!=='mlx-real'||b.terminal?.backend!=='mlx-native-linear')throw Error('SLat effective source route mismatch');
  if(t?.captureSpace!=='normalized-sampler-time'||t.captureValue!==1||t.modelMultiplier!==1000||t.modelValue!==1000||t.modelDtype!=='float32')throw Error('source SLat first model clock1000 required');
  const shapes={sample:[r,32],coordinates:[r,3],logits:[1,1,64,64,64],timestep:[1],conditioning:[1029,1024],
    'rope.frequencies':[21],gelu:[65536],'terminal.weight':[32,c],'terminal.bias':[32],
    'prefix.input.weight':[c,p.mode==='texture'?64:32],'prefix.input.bias':[c],'prefix.time0.weight':[c,256],'prefix.time0.bias':[c],
    'prefix.time2.weight':[c,c],'prefix.time2.bias':[c],'prefix.mod.weight':[6*c,c],'prefix.mod.bias':[6*c],
    'expected.phases':[r,64,2],'expected.projected':[r,c],'expected.modulation':[1,6*c],'expected.hidden':[r,c],'expected.normalized':[r,c],'expected.prediction':[r,32]};
  if(p.mode==='texture'){
    shapes.concatConditioning=[r,32];
    if(!hash(m.concatConditioning?.sha256)||m.concatConditioning?.arithmetic!=='normalized-shape-latent-f32'||
      m.concatConditioning?.coordinateTensorSha256!==m.coordinates.tensorSha256)throw Error('texture must condition on normalized shape with identical coordinates');
  }
  for(let i=0;i<30;i++)for(const [key,shape]of Object.entries(sparseBlockWeightShapes(f.block))){
    const name=`block${i}.${key}`,row=m.tensors?.[name];shapes[name]=shape;
    if(row?.checkpointKey!==`blocks.${i}.${FLOW_BLOCK_KEYS[key]}`||!['BF16','F32'].includes(row.checkpointDtype)||!hash(row.checkpointTensorSha256))throw Error('wrong SLat block weight '+name);
  }
  for(const [name,shape]of Object.entries(shapes)){
    const row=m.tensors?.[name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify(shape)||row.dtype!==(name==='coordinates'?'int32':'float32')||
      row.byteLength!==shape.reduce((a,b)=>a*b,4)||!hash(row.sha256)||!/^[\w.-]+$/.test(row.file))throw Error('partial/incompatible SLat tensor '+name);
  }
  if(m.coordinates.tensorSha256!==m.tensors.coordinates.sha256||m.coordinates.logitsSha256!==m.tensors.logits.sha256||m.sample.sha256!==m.tensors.sample.sha256||
    (p.mode==='texture'&&m.concatConditioning.sha256!==m.tensors.concatConditioning.sha256))throw Error('SLat input bytes disagree with identity');
  return p;
}

export const FLOW_BLOCK_KEYS = Object.freeze({ modulation:'modulation','norm2.weight':'norm2.weight','norm2.bias':'norm2.bias',
  'self.qkv.weight':'self_attn.to_qkv.weight','self.qkv.bias':'self_attn.to_qkv.bias',
  'self.out.weight':'self_attn.to_out.weight','self.out.bias':'self_attn.to_out.bias',
  'self.q.gamma':'self_attn.q_rms_norm.gamma','self.k.gamma':'self_attn.k_rms_norm.gamma',
  'cross.q.weight':'cross_attn.to_q.weight','cross.q.bias':'cross_attn.to_q.bias',
  'cross.kv.weight':'cross_attn.to_kv.weight','cross.kv.bias':'cross_attn.to_kv.bias',
  'cross.out.weight':'cross_attn.to_out.weight','cross.out.bias':'cross_attn.to_out.bias',
  'cross.q.gamma':'cross_attn.q_rms_norm.gamma','cross.k.gamma':'cross_attn.k_rms_norm.gamma',
  'mlp.in.weight':'mlp.mlp.0.weight','mlp.in.bias':'mlp.mlp.0.bias','mlp.out.weight':'mlp.mlp.2.weight','mlp.out.bias':'mlp.mlp.2.bias' });

export function compareFlowTensor(actual,expected){return compareBlockTensor(actual,expected);}

export function validateFlowFixture(manifest){
  if(manifest?.schema!=='trellis2.sparse-flow-reference.v0'||manifest.status!=='succeeded')throw new Error('complete sparse flow reference required');
  const p=buildSparseFlowPlan(manifest.config),c=p.block.channels,r=p.block.rows;
  if(p.numBlocks!==30||r!==4096||c!==1536||p.block.heads!==12||p.block.hidden!==8192||
    p.block.contextRows!==1029||p.block.contextChannels!==1024||p.prefix.inChannels!==8||p.outChannels!==8||p.prefix.frequencyDim!==256)
    throw new Error('real complete sparse model configuration required');
  if(!/^[a-f0-9]{40}$/.test(manifest.source?.commit)||manifest.source.dirty!==''||
    ![manifest.checkpoint?.sha256,manifest.sample?.sha256,manifest.conditioning?.sha256].every(s=>/^[a-f0-9]{64}$/.test(s)))
    throw new Error('full flow source/input identity mismatch');
  const b=manifest.effectiveBackend,t=manifest.timeConvention;
  if(manifest.referenceRoute!==FLOW_REFERENCE_ROUTE||manifest.fullModelExecutions!==1||manifest.blocksExecuted!==30||
    b?.device!=='Device(gpu, 0)'||b.attention!=='fast'||b.qk?.backend!=='mlx-sum'||b.layernorm?.backend!=='mlx-two-pass'||
    b.rope?.backend!=='inherit'||b.terminal?.backend!=='mlx-native-linear')throw new Error('full flow effective reference route mismatch');
  if(t?.captureSpace!=='normalized-sampler-time'||t.captureValue!==1||t.modelMultiplier!==1000||t.modelValue!==1000||t.modelDtype!=='float32')
    throw new Error('first sampler capture must use model timestep1000');
  const shapes={sample:p.prefix.inputShape,timestep:[1],conditioning:[1029,1024],phases:[r,64,2],gelu:[65536],
    'terminal.weight':[8,c],'terminal.bias':[8],'expected.projected':[r,c],'expected.modulation':[1,6*c],
    'expected.hidden':[r,c],'expected.normalized':[r,c],'expected.prediction':p.outputShape,
    'prefix.input.weight':[c,8],'prefix.input.bias':[c],'prefix.time0.weight':[c,256],'prefix.time0.bias':[c],
    'prefix.time2.weight':[c,c],'prefix.time2.bias':[c],'prefix.mod.weight':[6*c,c],'prefix.mod.bias':[6*c]};
  for(let i=0;i<p.numBlocks;i++)for(const [name,shape] of Object.entries(sparseBlockWeightShapes(p.block))){
    const key=`block${i}.${name}`,row=manifest.tensors?.[key];shapes[key]=shape;
    if(row?.checkpointKey!==`blocks.${i}.${FLOW_BLOCK_KEYS[name]}`||!['BF16','F32'].includes(row.checkpointDtype)||
      !/^[a-f0-9]{64}$/.test(row.checkpointTensorSha256))throw new Error(`wrong source block weight:${key}`);
  }
  for(const [name,shape] of Object.entries(shapes)){
    const row=manifest.tensors?.[name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify(shape)||row.dtype!=='float32'||
      row.byteLength!==shape.reduce((a,b)=>a*b,4)||!/^[a-f0-9]{64}$/.test(row.sha256)||!/^[\w.-]+$/.test(row.file))
      throw new Error(`partial or incompatible flow tensor:${name}`);
  }
  return p;
}
