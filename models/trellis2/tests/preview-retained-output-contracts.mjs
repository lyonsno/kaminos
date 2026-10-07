import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as checks from '../sparse-generation-witness-checks.js';
const native=process.argv[2];assert.ok(native,'explicit observed completed-model/failed-export report root required');
const n=JSON.parse(fs.readFileSync(native+'/report.json')),
  m=JSON.parse(fs.readFileSync(n.fixtureRoot+'/manifest.json'));
assert.equal(n.status,'failed');assert.equal(n.result.status,'succeeded');assert.ok(n.finishedAt);
checks.validateGenerationResult(n.result,m);
const source=fs.readFileSync(new URL('../run-sparse-prefix-witness.mjs',import.meta.url),'utf8'),
  expression=source.match(/const requiredOutputs = ([^;]+);/);
assert.ok(expression,'actual runner required-output expression must be exercised');
const selected=new Function('generationManifest','GENERATION_FIELDS','generationFields','return ('+expression[1]+');')
  (m,checks.GENERATION_FIELDS,checks.generationFields);
assert.deepEqual(selected,checks.generationFields(m),
  'actual no-cascade runner must require only its active outputs, not nonexistent HR noise');
assert.equal(typeof checks.admitRetainedGenerationCompletion,'function',
  'successful retained learned fields need explicit admission independent of a later export failure');
const options={expectedNativeCommit:n.commit,inputMode:'completed-model-fields'};
assert.equal(checks.admitRetainedGenerationCompletion(n,m,options).commandStatus,'failed');
assert.throws(()=>checks.admitRetainedGenerationCompletion(n,m,{...options,inputMode:'completed-command'}));
for(const mutate of [x=>x.status='running',x=>delete x.finishedAt,x=>x.result.status='failed',
  x=>x.result.backend.isFallbackAdapter=true,x=>delete x.rawOutputs['material.features'],
  x=>delete x.rawOutputs['noise.texture'],x=>x.rawOutputs['geometry.features'].sha256='0'.repeat(64),
  x=>x.commit='0'.repeat(40)]){
  const bad=structuredClone(n);mutate(bad);assert.throws(()=>checks.admitRetainedGenerationCompletion(bad,m,options));
}
console.log('Actual preview output selection and explicit terminal completed-model admission preserve failed command truth and reject incomplete/fallback/stale/partial fields.');
