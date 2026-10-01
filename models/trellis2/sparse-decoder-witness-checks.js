import {buildSparseDecoderPlan,sparseDecoderWeightShapes} from './sparse-decoder.js';
import {compareSamplerTensor} from './sparse-sampler-witness-checks.js';
export const DECODER_REFERENCE_ROUTE='pinned-MLX-GPU-source-sparse-decoder/F32';
export const compareDecoderTensor=(actual,expected)=>compareSamplerTensor('sample',actual,expected);
export function decoderObservationShapes(plan){
  return{...Object.fromEntries(plan.channels.map((c,i)=>[`level${i}`,[(plan.resolution*2**i)**3,c]])),logits:plan.outputShape};
}
export function validateDecoderFixture(manifest){
  if(manifest?.schema!=='trellis2.sparse-decoder-reference.v0'||manifest.status!=='succeeded'||manifest.referenceRoute!==DECODER_REFERENCE_ROUTE)
    throw new Error('complete observed source decoder reference required');
  for(const name of ['source','producer'])if(!/^[a-f0-9]{40}$/.test(manifest[name]?.commit)||manifest[name].dirty!=='')throw new Error('clean source/producer required');
  const plan=buildSparseDecoderPlan(manifest.config),shapes=sparseDecoderWeightShapes(plan);
  if(!['synthetic-operation-conformance','checkpoint-decoder'].includes(manifest.fixtureKind))throw new Error('explicit decoder input class required');
  if(manifest.fixtureKind==='checkpoint-decoder'){
    const full=buildSparseDecoderPlan();
    for(const key of ['resolution','latentChannels','outChannels','numResBlocks','numResBlocksMiddle'])if(plan[key]!==full[key])throw new Error('complete checkpoint geometry required');
    if(JSON.stringify(plan.channels)!==JSON.stringify(full.channels))throw new Error('complete checkpoint channels required');
    if(!/^[a-f0-9]{64}$/.test(manifest.checkpoint?.sha256)||!/^[a-f0-9]{64}$/.test(manifest.checkpointConfig?.sha256)||
      !/^[a-f0-9]{64}$/.test(manifest.input?.manifestSha256)||!/^[a-f0-9]{64}$/.test(manifest.input?.sha256))throw new Error('checkpoint/input authority required');
  }
  const b=manifest.effectiveBackend;
  if(manifest.modelCalls!==1||manifest.convolutionsExecuted!==plan.convolutions||
    manifest.parameterCount!==Object.values(shapes).reduce((n,s)=>n+s.reduce((a,b)=>a*b,1),0)||
    b?.device!=='Device(gpu, 0)'||b.arithmetic!==plan.arithmetic||b.normEpsilon!==plan.normEpsilon||b.weightLayout!==plan.weightLayout)
    throw new Error('actual complete GPU/F32 decoder graph required');
  const expectedShapes={sample:plan.inputShape,...Object.fromEntries(Object.entries(shapes).map(([k,s])=>['weight.'+k,s])),
    ...Object.fromEntries(Object.entries(decoderObservationShapes(plan)).map(([k,s])=>['expected.'+k,s]))};
  for(const [name,shape] of Object.entries(expectedShapes)){
    const row=manifest.tensors?.[name];
    if(!row||JSON.stringify(row.shape)!==JSON.stringify(shape)||row.dtype!=='float32'||row.byteLength!==shape.reduce((a,b)=>a*b,4)||
      !/^[a-f0-9]{64}$/.test(row.sha256)||!/^[\w.-]+$/.test(row.file))throw new Error('partial/wrong decoder tensor '+name);
  }
  return plan;
}
