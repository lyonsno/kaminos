import assert from 'node:assert/strict';
import * as checks from '../slat-decoder-witness-checks.js';
import {buildSLatDecoderPlan,slatDecoderWeightShapes} from '../slat-decoder.js';
assert.equal(typeof checks.validateSLatProjectionFixture,'function',
  'The first decoder operation needs an admitted same-input reference without another complete decode.');
const config={tokenRows:3,latentChannels:2,resolution:2,channels:[16,8],numBlocks:[1,0],mode:'shape'},
  p=buildSLatDecoderPlan(config),weights=slatDecoderWeightShapes(p),
  row=(name,shape,integer=false,half=false)=>({file:name+(integer?'.i32':'.f32'),shape,
    dtype:integer?'int32':'float32',sourceDtype:integer?'int32':half?'float16':'float32',
    byteLength:shape.reduce((a,b)=>a*b,4),sha256:'a'.repeat(64)}),
  identity={commit:'b'.repeat(40),dirty:''},parent={schema:'trellis2.slat-decoder-reference.v0',status:'succeeded',
    referenceRoute:checks.SLAT_DECODER_REFERENCE_ROUTE,config,modelCalls:1,convolutionsExecuted:3,
    parameterCount:Object.values(weights).reduce((n,s)=>n+s.reduce((a,b)=>a*b,1),0),
    fixtureKind:'synthetic-operation-conformance',outputRows:12,outputResolution:4,subdivisionRows:[[3,8]],
    source:identity,sourceAfter:identity,producer:identity,producerAfter:identity,
    effectiveBackend:{device:'Device(gpu, 0)',arithmetic:p.arithmetic,weightLayout:p.weightLayout,normEpsilon:1e-6,
      terminalNormEpsilon:1e-5,sourceModel:'actual SLatDecoder.__call__',route:{decoder_linear_backend:'native',
        sparse_conv_matmul_backend:'native',decoder_silu:{backend:'mlx-native'},decoder_layernorm:{backend:'mlx-fast-layer-norm'}}},
    tensors:{sample:row('sample',[3,2]),coordinates:row('coordinates',[3,3],true),silu:row('silu',[65536],false,true),
      halfInputs:row('halfInputs',[65536]),'expected.features':row('expected.features',[12,7]),
      'expected.coordinates':row('expected.coordinates',[12,3],true),'expected.subdivision0':row('expected.subdivision0',[3,8],false,true),
      ...Object.fromEntries(Object.entries(weights).map(([n,s])=>['weight.'+n,row('weight.'+n,s,false,n.startsWith('blocks.'))]))}};
const m={schema:'trellis2.slat-projection-reference.v0',status:'succeeded',referenceRoute:'pinned-MLX-GPU-SLat-from_latent/F32-then-F16',
  source:identity,sourceAfter:identity,producer:identity,producerAfter:identity,operationCalls:1,fullDecoderCalls:0,
  parentReference:{file:'parent-manifest.json',sha256:'c'.repeat(64)},
  effectiveBackend:{device:'Device(gpu, 0)',operation:'actual SLatDecoder.from_latent + astype(float16)',
    arithmetic:'F32-addmm-then-F16-cast',mlxVersion:'observed-version'},
  tensors:{...Object.fromEntries(['sample','weight.from_latent.weight','weight.from_latent.bias'].map(n=>[n,parent.tensors[n]])),
    'expected.f32':row('expected.f32',[3,16]),'expected.f16':row('expected.f16',[3,16],false,true)}};
const plan=checks.validateSLatProjectionFixture(m,parent);
assert.deepEqual(plan,{rows:3,ci:2,co:16});
checks.validateSLatProjectionFixture({...m,additiveFutureField:true},parent);
for(const change of [a=>a.referenceRoute='cpu-fallback',a=>a.operationCalls=0,a=>a.fullDecoderCalls=1,
  a=>a.effectiveBackend.arithmetic='silent-fp16',a=>a.sourceAfter.commit='d'.repeat(40),
  a=>a.tensors.sample.sha256='d'.repeat(64),a=>a.tensors.sample.shape=[2,2],
  a=>a.tensors['expected.f16'].sourceDtype='float32',a=>a.tensors['expected.f32'].byteLength-=4,
  a=>a.parentReference.file='../parent.json']){
  const changed=structuredClone(m);change(changed);assert.throws(()=>checks.validateSLatProjectionFixture(changed,parent));
}
assert.equal(typeof checks.validateSLatProjectionResult,'function');
const result={requestedRoute:checks.SLAT_PROJECTION_ROUTE,effectiveRoute:checks.SLAT_PROJECTION_ROUTE,numericalStatus:'passed',profileStatus:'passed',
  backend:{vendor:'apple',isFallbackAdapter:false},
  composition:{rows:3,ci:2,co:16,operationKernelRuns:2,fullDecoderCalls:0},
  outputs:Object.fromEntries(['f32','f16'].map(n=>[n,{shape:[3,16],dtype:'f32',sha256:'e'.repeat(64),comparison:{passed:true,count:48}}]))};
checks.validateSLatProjectionResult(result,plan);
for(const change of [a=>a.effectiveRoute='fallback',a=>a.profileStatus='failed',a=>a.composition.rows=2,
  a=>a.composition.operationKernelRuns=1,a=>delete a.outputs.f16,a=>a.outputs.f32.comparison.passed=false,
  a=>a.outputs.f16.comparison.count=0,a=>a.outputs.f32.shape=[2,16],a=>delete a.backend,a=>a.backend.isFallbackAdapter=true]){
  const changed=structuredClone(result);change(changed);assert.throws(()=>checks.validateSLatProjectionResult(changed,plan));
}
console.log('Projection-only evidence rejects changed input/route/precision, hidden row loss, absent or blank output and full-decoder substitution.');
