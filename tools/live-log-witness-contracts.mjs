import assert from 'node:assert/strict';

export function checkColdLogEntryCollision(entry,collision) {
  assert.equal(collision?.enabled,true,'Scene collision request must be enabled');
  assert.equal(collision.runtime?.effective,'mesh-voxel-solid','Effective collision mask must be installed');
  assert.ok(collision.runtime.solidCellCount>0,'Collision mask must contain solid cells');
  assert.ok(typeof entry?.objectId==='string' && collision.runtime.members?.some(member=>member.id===entry.objectId&&member.solidCellCount>0),'Collision mask must contain the mounted log');
}

export function checkRestoredLogSource({source,experiment,info}) {
  assert.ok(info?.startsWith('Scene loaded:'),'Saved scene must finish loading');
  assert.equal(experiment?.id,null,'Experiment setup must not mask restored source state');
  assert.equal(source?.registered,true,'Restored source must be registered');
  assert.equal(source.authoredPresent,true);
  assert.equal(source.emissionEnabled,false,'Restored source must remain disabled');
}
