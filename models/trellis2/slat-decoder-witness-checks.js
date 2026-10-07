import { buildSLatDecoderPlan, slatDecoderWeightShapes } from './slat-decoder.js';
import { compareDecoderTensor } from './sparse-decoder-witness-checks.js';
import { compareOccupancyCoordinates } from './occupancy-coordinate-witness-checks.js';
import { validateNativePrefixBackend } from './sparse-prefix-witness-checks.js';
export const SLAT_DECODER_REFERENCE_ROUTE = 'pinned-MLX-GPU-source-SLat-decoder/native-FP16-torso-F32-endpoints';
const sha = v => /^[a-f0-9]{64}$/.test(v ?? '');
export function slatDecoderObservationShapes(manifest) {
  const p = buildSLatDecoderPlan(manifest.config);
  return { features: [manifest.outputRows, p.outChannels], coordinates: [manifest.outputRows, 3], halfRoundTrip: [65536],
    ...Object.fromEntries(manifest.subdivisionRows.map((shape, i) => ['subdivision' + i, shape])) };
}
export function validateSLatDecoderFixture(m) {
  if (m?.schema !== 'trellis2.slat-decoder-reference.v0' || m.status !== 'succeeded' || m.referenceRoute !== SLAT_DECODER_REFERENCE_ROUTE) throw Error('complete actual source learned-decoder reference required');
  for (const name of ['source', 'producer']) if (!/^[a-f0-9]{40}$/.test(m[name]?.commit ?? '') || m[name].dirty !== '' ||
    m[name + 'After']?.commit !== m[name].commit || m[name + 'After'].dirty !== '') throw Error('clean unchanged source/producer required');
  const plan = buildSLatDecoderPlan(m.config), shapes = slatDecoderWeightShapes(plan), b = m.effectiveBackend, r = b?.route;
  if (!['synthetic-operation-conformance', 'checkpoint-decoder'].includes(m.fixtureKind)) throw Error('explicit learned-decoder input class required');
  if (m.fixtureKind === 'checkpoint-decoder') {
    if (JSON.stringify(plan.channels) !== '[1024,512,256,128,64]' || JSON.stringify(plan.numBlocks) !== '[4,16,8,4,0]' ||
      plan.latentChannels !== 32 || !sha(m.checkpoint?.sha256) || !sha(m.checkpointConfig?.sha256) || !sha(m.input?.sha256)) throw Error('complete checkpoint geometry/provenance required');
    if (plan.mode === 'texture' && !sha(m.guide?.sha256)) throw Error('matching source shape guide provenance required');
  } else if (plan.mode !== 'shape' || plan.tokenRows !== 3 || plan.resolution !== 2 || plan.latentChannels !== 2 ||
    JSON.stringify(plan.channels) !== '[16,8]' || JSON.stringify(plan.numBlocks) !== '[1,0]') throw Error('synthetic fixture must retain its actual source operation comparison class');
  if (m.modelCalls !== 1 || m.convolutionsExecuted !== plan.numBlocks.reduce((a, b) => a + b, 0) + 2 * plan.subdivisionLevels ||
    m.parameterCount !== Object.values(shapes).reduce((n, s) => n + s.reduce((a, b) => a * b, 1), 0) ||
    b?.device !== 'Device(gpu, 0)' || b.arithmetic !== plan.arithmetic || b.weightLayout !== plan.weightLayout ||
    b.normEpsilon !== 1e-6 || b.terminalNormEpsilon !== 1e-5 || b.sourceModel !== 'actual SLatDecoder.__call__' ||
    r?.decoder_linear_backend !== 'native' || r.sparse_conv_matmul_backend !== 'native' ||
    r.decoder_silu?.backend !== 'mlx-native' || r.decoder_layernorm?.backend !== 'mlx-fast-layer-norm') throw Error('actual complete native FP16-source decoder graph required');
  if (!Number.isSafeInteger(m.outputRows) || m.outputRows < 1 || m.outputResolution !== plan.outputResolution ||
    !Array.isArray(m.subdivisionRows) || m.subdivisionRows.length !== plan.subdivisionLevels) throw Error('complete learned output/counts required');
  let rows = plan.tokenRows;
  for (const [i, shape] of m.subdivisionRows.entries()) {
    if (JSON.stringify(shape) !== JSON.stringify([rows, 8])) throw Error('matching learned subdivision parent rows required');
    const next = i + 1 < m.subdivisionRows.length ? m.subdivisionRows[i + 1]?.[0] : m.outputRows;
    if (!Number.isSafeInteger(next) || next < 1 || next > rows * 8) throw Error('complete source subdivision capacity required');rows = next;
  }
  const descriptors = { sample: [plan.tokenRows, plan.latentChannels], coordinates: [plan.tokenRows, 3], silu: [65536], halfInputs: [65536],
    ...Object.fromEntries(Object.entries(shapes).map(([name, shape]) => ['weight.' + name, shape])),
    ...Object.fromEntries(Object.entries(slatDecoderObservationShapes(m)).filter(([name]) => name !== 'halfRoundTrip').map(([name, shape]) => ['expected.' + name, shape])) };
  if (plan.mode === 'texture') for (let i = 0; i < plan.subdivisionLevels; i++) descriptors['guide' + i] = m.subdivisionRows[i];
  for (const [name, shape] of Object.entries(descriptors)) {
    const row = m.tensors?.[name], integer = name === 'coordinates' || name === 'expected.coordinates',
      half = name === 'silu' || name.startsWith('weight.blocks.') || name.startsWith('expected.subdivision');
    if (!row || JSON.stringify(row.shape) !== JSON.stringify(shape) || row.dtype !== (integer ? 'int32' : 'float32') ||
      row.sourceDtype !== (integer ? 'int32' : half ? 'float16' : 'float32') || row.byteLength !== shape.reduce((a, b) => a * b, 4) ||
      !sha(row.sha256) || !/^[\w.-]+$/.test(row.file)) throw Error('partial/wrong source learned decoder tensor ' + name);
  }
  return plan;
}
export function compareLearnedSubdivision(actual, expected) {
  const comparison = compareDecoderTensor(actual, expected);let signFailures = 0;
  if (actual instanceof Float32Array && expected instanceof Float32Array && actual.length === expected.length) {
    for (let i = 0; i < actual.length; i++) if ((actual[i] > 0) !== (expected[i] > 0)) signFailures++;
  } else signFailures = Math.max(actual?.length ?? 1, expected?.length ?? 1, 1);
  return { ...comparison, signFailures, passed: comparison.passed && signFailures === 0 };
}
export function compareHalfRoundTrip(actual, expected) {
  if (!(actual instanceof Float32Array) || !(expected instanceof Float32Array) || !actual.length || actual.length !== expected.length) return { passed: false, error: 'complete half round-trip observation required' };
  const a = new Uint32Array(actual.buffer, actual.byteOffset, actual.length), b = new Uint32Array(expected.buffer, expected.byteOffset, expected.length);let failures = 0;
  for (let i = 0; i < actual.length; i++) if (!(Number.isNaN(actual[i]) && Number.isNaN(expected[i])) && a[i] !== b[i]) failures++;
  return { passed: failures === 0, failures, count: actual.length, contract: 'exact finite/infinity/zero bits; NaN class, not payload' };
}

export function compareSLatDecoderObservation(name, actual, expected) {
  const compare = name === 'features' ? compareDecoderTensor : name === 'coordinates' ? compareOccupancyCoordinates :
    name === 'halfRoundTrip' ? compareHalfRoundTrip : /^subdivision\d+$/.test(name) ? compareLearnedSubdivision : null;
  if (!compare) throw Error('unknown learned decoder observation ' + name);
  try { return compare(actual, expected); }
  catch (error) {
    // A count/sign/numerical mismatch is negative evidence, not permission to
    // stop retaining the other post-serving outputs of this same execution.
    return { passed: false, error: error.message, actualCount: actual?.length, expectedCount: expected?.length };
  }
}

export const SLAT_PROJECTION_ROUTE='trellis2.slat-decoder.from-latent.webgpu.v0';
export const SLAT_PROJECTION_REFERENCE_ROUTE='pinned-MLX-GPU-SLat-from_latent/F32-then-F16';
export function validateSLatProjectionFixture(m,parent) {
  const p=validateSLatDecoderFixture(parent),plan={rows:p.tokenRows,ci:p.latentChannels,co:p.channels[0]};
  if(m?.schema!=='trellis2.slat-projection-reference.v0'||m.status!=='succeeded'||
    m.referenceRoute!==SLAT_PROJECTION_REFERENCE_ROUTE||m.operationCalls!==1||m.fullDecoderCalls!==0||
    !sha(m.parentReference?.sha256)||!/^[\w.-]+$/.test(m.parentReference?.file??''))throw Error('complete same-input projection reference required');
  for(const name of ['source','producer'])if(!/^[a-f0-9]{40}$/.test(m[name]?.commit??'')||m[name].dirty!==''||
    m[name+'After']?.commit!==m[name].commit||m[name+'After'].dirty!=='')throw Error('clean unchanged projection source/producer required');
  const b=m.effectiveBackend;
  if(m.source.commit!==parent.source.commit||b?.device!=='Device(gpu, 0)'||
    b.operation!=='actual SLatDecoder.from_latent + astype(float16)'||b.arithmetic!=='F32-addmm-then-F16-cast'||
    typeof b.mlxVersion!=='string'||!b.mlxVersion)throw Error('actual matching F32 source projection then F16 cast required');
  for(const name of ['sample','weight.from_latent.weight','weight.from_latent.bias']){
    const a=m.tensors?.[name],original=parent.tensors[name];
    for(const key of ['shape','dtype','sourceDtype','byteLength','sha256'])if(JSON.stringify(a?.[key])!==JSON.stringify(original[key]))
      throw Error('changed projection input '+name+'.'+key);
    if(!/^[\w.-]+$/.test(a?.file??''))throw Error('safe projection input file required');
  }
  for(const name of ['f32','f16']){
    const row=m.tensors?.['expected.'+name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify([plan.rows,plan.co])||row.dtype!=='float32'||
      row.sourceDtype!==(name==='f32'?'float32':'float16')||row.byteLength!==plan.rows*plan.co*4||
      !sha(row.sha256)||!/^[\w.-]+$/.test(row.file??''))throw Error('complete projection output '+name+' required');
  }
  return plan;
}
export function validateSLatProjectionResult(result,plan) {
  const c=result?.composition;
  if(result?.requestedRoute!==SLAT_PROJECTION_ROUTE||result.effectiveRoute!==SLAT_PROJECTION_ROUTE||
    result.numericalStatus!=='passed'||result.profileStatus!=='passed'||c?.rows!==plan.rows||c.ci!==plan.ci||
    c.co!==plan.co||c.operationKernelRuns!==2||c.fullDecoderCalls!==0)throw Error('complete production projection execution required');
  validateNativePrefixBackend(result.backend);
  if(result.backend.isFallbackAdapter!==false)throw Error('explicit observed nonfallback adapter required');
  for(const name of ['f32','f16']){
    const row=result.outputs?.[name];
    if(row?.dtype!=='f32'||JSON.stringify(row.shape)!==JSON.stringify([plan.rows,plan.co])||!sha(row.sha256)||
      row.comparison?.passed!==true||row.comparison.count!==plan.rows*plan.co)throw Error('complete compared projection output '+name+' required');
  }
}

export const SLAT_CONVOLUTION_ROUTE='trellis2.slat-decoder.first-convolution.webgpu.v0';
export const SLAT_CONVOLUTION_REFERENCE_ROUTE='pinned-MLX-GPU-SLat-first-convolution/F16-per-offset';
export function validateSLatConvolutionFixture(m,parent,projection) {
  const p=validateSLatDecoderFixture(parent);validateSLatProjectionFixture(projection,parent);
  const plan={rows:p.tokenRows,ci:p.channels[0],co:p.channels[0],resolution:p.resolution};
  if(m?.schema!=='trellis2.slat-convolution-reference.v0'||m.status!=='succeeded'||
    m.referenceRoute!==SLAT_CONVOLUTION_REFERENCE_ROUTE||m.operationCalls!==1||m.fullDecoderCalls!==0||
    m.parentReference?.sha256!==projection.parentReference.sha256||!sha(m.projectionReference?.sha256)||
    !/^[\w.-]+$/.test(m.parentReference?.file??'')||!/^[\w.-]+$/.test(m.projectionReference?.file??''))
    throw Error('complete same-input first-convolution reference required');
  for(const name of ['source','producer'])if(!/^[a-f0-9]{40}$/.test(m[name]?.commit??'')||m[name].dirty!==''||
    m[name+'After']?.commit!==m[name].commit||m[name+'After'].dirty!=='')throw Error('clean unchanged convolution source/producer required');
  const b=m.effectiveBackend;
  if(m.source.commit!==parent.source.commit||b?.device!=='Device(gpu, 0)'||
    b.operation!=='actual SparseConv3d.__call__'||b.neighborBuilder!=='actual build_neighbor_map'||
    b.arithmetic!=='source-F16-per-offset-matmul-scatter-add-bias'||b.sparseConvMatmulBackend!=='native'||
    typeof b.mlxVersion!=='string'||!b.mlxVersion)throw Error('actual matching native F16 convolution required');
  const originals={input:projection.tensors['expected.f16'],coordinates:parent.tensors.coordinates,
    'weight.blocks.0.0.conv.weight':parent.tensors['weight.blocks.0.0.conv.weight'],
    'weight.blocks.0.0.conv.bias':parent.tensors['weight.blocks.0.0.conv.bias']};
  for(const [name,original] of Object.entries(originals)){
    const a=m.tensors?.[name];
    for(const key of ['shape','dtype','sourceDtype','byteLength','sha256'])if(JSON.stringify(a?.[key])!==JSON.stringify(original[key]))
      throw Error('changed convolution input '+name+'.'+key);
    if(!/^[\w.-]+$/.test(a?.file??''))throw Error('safe convolution input file required');
  }
  for(const [name,shape,integer] of [['neighbors',[plan.rows,27],true],['convolution',[plan.rows,plan.co],false]]){
    const row=m.tensors?.['expected.'+name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify(shape)||row.dtype!==(integer?'int32':'float32')||
      row.sourceDtype!==(integer?'int32':'float16')||row.byteLength!==shape.reduce((a,b)=>a*b,4)||
      !sha(row.sha256)||!/^[\w.-]+$/.test(row.file??''))throw Error('complete convolution output '+name+' required');
  }
  return plan;
}
export function validateSLatConvolutionResult(result,plan) {
  const c=result?.composition;
  if(result?.requestedRoute!==SLAT_CONVOLUTION_ROUTE||result.effectiveRoute!==SLAT_CONVOLUTION_ROUTE||
    result.numericalStatus!=='passed'||result.profileStatus!=='passed'||c?.rows!==plan.rows||c.ci!==plan.ci||
    c.co!==plan.co||c.resolution!==plan.resolution||c.convolutionsExecuted!==1||c.fullDecoderCalls!==0||
    c.metadataReadbackBytes!==4)throw Error('complete production neighbor/convolution execution required');
  validateNativePrefixBackend(result.backend);
  if(result.backend.isFallbackAdapter!==false)throw Error('explicit observed nonfallback adapter required');
  for(const [name,columns,dtype] of [['neighbors',27,'i32'],['convolution',plan.co,'f32']]){
    const row=result.outputs?.[name];
    if(row?.dtype!==dtype||JSON.stringify(row.shape)!==JSON.stringify([plan.rows,columns])||!sha(row.sha256)||
      row.comparison?.passed!==true||row.comparison.count!==plan.rows*columns)throw Error('complete compared convolution output '+name+' required');
  }
}
