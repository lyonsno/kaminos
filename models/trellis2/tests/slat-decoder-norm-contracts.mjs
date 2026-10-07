import assert from 'node:assert/strict';
import {slatDecoderNormShader} from '../slat-decoder-ops.js';

// Canonical external law: MLX v0.32.3 layer_norm.metal casts the normalized
// scalar to T before its affine expression; float16 instantiates T as half.
// https://github.com/ml-explore/mlx/blob/v0.32.3/mlx/backend/metal/kernels/layer_norm.metal
// Observed fixture: block0-retained-1004-r1/source/manifest.json, source34a7a570,
// actual MLX0.32.3 GPU native operations. expected.norm first value is below.
// The pre-affine scalar is a binary64 row-statistics diagnostic rounded to F32,
// NOT an observed MLX intermediate or a replacement numerical reference.
// This unit test executes only the generated scalar assignment sequence;
// reduction/compiler/backend conformance requires the complete live witness.
const fixture={normalized:-0.4429148733615875,weight:0.85302734375,bias:0.072509765625,
  expected:-0.30517578125};

function half(value){
  value=Math.fround(value);
  if(value===0)return value;
  assert.ok(Number.isFinite(value)&&Math.abs(value)<65504,'finite fixture domain');
  const step=2**Math.max(-24,Math.floor(Math.log2(Math.abs(value)))-10),
    magnitude=Math.abs(value)/step,low=Math.floor(magnitude),fraction=magnitude-low,
    nearest=fraction>0.5||fraction===0.5&&low%2?low+1:low;
  return Math.sign(value)*nearest*step;
}
assert.equal(half(1+2**-11),1,'ties round to even');
assert.equal(half(1+3*2**-11),1+2**-9,'odd half-way mantissa rounds up');

function scalarFromGeneratedShader({affine=true,f16=true}={}){
  const code=slatDecoderNormShader(1,1024,affine,f16);
  const body=code.match(/var value=\(input\[row\*1024u\+c\]-mean\)\*inverse;([\s\S]*?)output\[row\*1024u\+c\]=([^;]+);/);
  assert.ok(body,'actual generated output assignment must remain inspectable');
  return Function('value','weight','bias','c','round_f16',body[1]+'return '+body[2]+';');
}
const run=scalarFromGeneratedShader();
assert.equal(run(fixture.normalized,[fixture.weight],[fixture.bias],0,half),fixture.expected,
  'Source semantic-F16 normalization rounds before affine, not only after it.');
assert.notEqual(half(fixture.normalized*fixture.weight+fixture.bias),fixture.expected,
  'The retained observed scalar distinguishes the pre-fix expression.');
const f32=scalarFromGeneratedShader({f16:false});
assert.equal(f32(fixture.normalized,[1],[0],0,half),fixture.normalized,
  'F32 endpoint normalization must not inherit torso half rounding.');
const noAffine=scalarFromGeneratedShader({affine:false});
assert.equal(noAffine(fixture.normalized,[],[],0,half),half(fixture.normalized));
console.log('Generated affine-F16 normalize-before-affine law, non-affine half output and unchanged F32 endpoint scalar contracts pass; this is not GPU conformance.');
