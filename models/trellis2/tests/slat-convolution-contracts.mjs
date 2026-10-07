import assert from 'node:assert/strict';
import * as checks from '../slat-decoder-witness-checks.js';
import {parent,projectionFixture,row,identity} from './slat-projection-contracts.mjs';
assert.equal(typeof checks.validateSLatConvolutionFixture,'function',
  'Admit the first sparse convolution on the retained exact half projection, not another full decode.');
const m={schema:'trellis2.slat-convolution-reference.v0',status:'succeeded',
  referenceRoute:'pinned-MLX-GPU-SLat-first-convolution/F16-per-offset',operationCalls:1,fullDecoderCalls:0,
  source:identity,sourceAfter:identity,producer:identity,producerAfter:identity,
  parentReference:{file:'parent-manifest.json',sha256:projectionFixture.parentReference.sha256},
  projectionReference:{file:'projection-manifest.json',sha256:'f'.repeat(64)},
  effectiveBackend:{device:'Device(gpu, 0)',operation:'actual SparseConv3d.__call__',neighborBuilder:'actual build_neighbor_map',
    arithmetic:'source-F16-per-offset-matmul-scatter-add-bias',sparseConvMatmulBackend:'native',mlxVersion:'observed-version'},
  tensors:{input:structuredClone(projectionFixture.tensors['expected.f16']),coordinates:structuredClone(parent.tensors.coordinates),
    'weight.blocks.0.0.conv.weight':structuredClone(parent.tensors['weight.blocks.0.0.conv.weight']),
    'weight.blocks.0.0.conv.bias':structuredClone(parent.tensors['weight.blocks.0.0.conv.bias']),
    'expected.neighbors':row('expected.neighbors',[3,27],true),
    'expected.convolution':row('expected.convolution',[3,16],false,true)}};
const plan=checks.validateSLatConvolutionFixture(m,parent,projectionFixture);
assert.deepEqual(plan,{rows:3,ci:16,co:16,resolution:2});
checks.validateSLatConvolutionFixture({...m,additiveFutureField:true},parent,projectionFixture);
for(const change of [a=>a.referenceRoute='cpu-fallback',a=>a.fullDecoderCalls=1,a=>a.operationCalls=0,
  a=>a.effectiveBackend.sparseConvMatmulBackend='turing_fda',a=>a.effectiveBackend.device='Device(cpu, 0)',
  a=>a.sourceAfter.commit='e'.repeat(40),a=>a.parentReference.sha256='e'.repeat(64),
  a=>a.tensors.input.sha256='e'.repeat(64),a=>a.tensors.input.sourceDtype='float32',
  a=>a.tensors.coordinates.shape=[2,3],a=>a.tensors['expected.neighbors'].shape=[3,26],
  a=>a.tensors['expected.convolution'].byteLength-=4,a=>a.projectionReference.file='../wrong.json']){
  const changed=structuredClone(m);change(changed);assert.throws(()=>checks.validateSLatConvolutionFixture(changed,parent,projectionFixture));
}
assert.equal(typeof checks.validateSLatConvolutionResult,'function');
const result={requestedRoute:checks.SLAT_CONVOLUTION_ROUTE,effectiveRoute:checks.SLAT_CONVOLUTION_ROUTE,
  numericalStatus:'passed',profileStatus:'passed',backend:{vendor:'apple',isFallbackAdapter:false},
  composition:{...plan,convolutionsExecuted:1,fullDecoderCalls:0,metadataReadbackBytes:4},
  outputs:{neighbors:{shape:[3,27],dtype:'i32',sha256:'a'.repeat(64),comparison:{passed:true,count:81}},
    convolution:{shape:[3,16],dtype:'f32',sha256:'a'.repeat(64),comparison:{passed:true,count:48}}}};
checks.validateSLatConvolutionResult(result,plan);
for(const change of [a=>a.effectiveRoute='fallback',a=>a.backend.isFallbackAdapter=true,
  a=>a.numericalStatus='failed',a=>a.profileStatus='failed',a=>a.composition.convolutionsExecuted=0,
  a=>a.composition.rows=2,a=>a.composition.metadataReadbackBytes=0,a=>delete a.outputs.neighbors,
  a=>a.outputs.neighbors.comparison.passed=false,a=>a.outputs.convolution.comparison.count=0,
  a=>a.outputs.convolution.shape=[2,16]]){
  const changed=structuredClone(result);change(changed);assert.throws(()=>checks.validateSLatConvolutionResult(changed,plan));
}
export {m,plan,parent,projectionFixture};
console.log('Convolution localization rejects changed half inputs, neighbors, backend, counts and missing observations.');
