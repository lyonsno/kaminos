import assert from 'node:assert/strict';

export function checkRestoredLogSource({source,experiment,info}) {
  assert.ok(info?.startsWith('Scene loaded:'),'Saved scene must finish loading');
  assert.equal(experiment?.id,null,'Experiment setup must not mask restored source state');
  assert.equal(source?.registered,true,'Restored source must be registered');
  assert.equal(source.authoredPresent,true);
  assert.equal(source.emissionEnabled,false,'Restored source must remain disabled');
}
