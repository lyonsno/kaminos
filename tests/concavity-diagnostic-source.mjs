// kaminos-test: node
import assert from 'node:assert/strict';
import {validateConcavityDiagnostic} from '../experiments/creature-motion/concavity-diagnostic-source.mjs';
const source='a'.repeat(64),candidate='b'.repeat(64),other='c'.repeat(64),values=new Float32Array(12),descriptor={sourceManifestSha256:source,candidateManifestSha256:candidate,sha256:'d'.repeat(64),shape:[2,6],fields:['concavityCostPerLength','originalForelimbShare','candidateForelimbShare','transferredToChest','leftCostDistance','rightCostDistance']};
assert.equal(validateConcavityDiagnostic({descriptor,caseSha256:source,values}),descriptor);
assert.equal(validateConcavityDiagnostic({descriptor,caseSha256:candidate,values}),descriptor);
assert.throws(()=>validateConcavityDiagnostic({descriptor,caseSha256:other,values}),/binding/, 'Same-count diagnostic from a different binding must fail');
assert.throws(()=>validateConcavityDiagnostic({descriptor:{...descriptor,shape:[3,6]},caseSha256:source,values}),/shape/);
console.log('concavity diagnostic pair identity passes');
