// kaminos-test: node
import assert from 'node:assert/strict';
import {validateNormalizationDerivation} from '../experiments/creature-motion/pose-normalization-provenance.mjs';
const plan={path:'/plan.json',sha256:'a'.repeat(64)},source={path:'/original/manifest.json',sha256:'b'.repeat(64)},fit={path:'/fit.json',sha256:'c'.repeat(64)};
const input={plan,source,report:{inputs:[plan]},original:{sourceSha256:'d'.repeat(64)},
 corrected:{sourceSha256:'d'.repeat(64),provenance:{normalizationPlan:plan,normalizationFit:fit}},
 correction:{variant:'rig-proportions',sourceCase:source,sourceFit:fit}};
assert.throws(()=>validateNormalizationDerivation({...input,report:{inputs:[{...plan,sha256:'f'.repeat(64)}]}}),/plan digest/);
assert.throws(()=>validateNormalizationDerivation({...input,correction:{...input.correction,sourceCase:{...source,sha256:'f'.repeat(64)}}}),/original case/);
assert.throws(()=>validateNormalizationDerivation({...input,corrected:{...input.corrected,provenance:{...input.corrected.provenance,normalizationFit:{...fit,sha256:'f'.repeat(64)}}}}),/fit identity/);
assert.equal(validateNormalizationDerivation(input),input);
