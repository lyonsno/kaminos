import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSceneDocument, planSceneRestore, isReloadableSceneObjectRecord } from '../scene-persistence-core.js';
import { createSceneEdits } from '../scene-edit-session.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('a placed flame source is an authored, reloadable scene object', () => {
  const source = { id: 'flame-emitter', type: 'flame-emitter', source: 'kaminos:analytic-flame',
    label: 'Flame source', transform: {position:[.3,-.45,.1],rotation:[0,0,.2],scale:[1,1,1]} };
  assert.equal(isReloadableSceneObjectRecord(source), true,
    'the built-in flame source must reopen without an external mesh asset');
  const composition = {schema:'kaminos.stationary-flame-composition.v1',
    flame:{presetId:'vsp-'+ 'a'.repeat(64),stationary:true},lightGainStops:0,route:{volume_light_field:'1'}};
  const plan = planSceneRestore(buildSceneDocument({objects:[source],activeObjectId:source.id,composition}));
  assert.deepEqual(plan.objects[0].transform, source.transform);
  assert.equal(plan.activeObjectId, source.id);
});

test('a rejected agent placement leaves no active transaction and preserves an existing gesture', () => {
  let pose={position:[0,-.76,0],rotation:[0,0,0],scale:[1,1,1]};
  const edits=createSceneEdits({read:()=>pose,write:(_id,next)=>{
    if(next.position[0]===99)throw Error('source out of bounds');
    pose=structuredClone(next);
  }});
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const start=html.indexOf('window.kaminosSetSceneObjectTransform =');
  const source=html.slice(start,html.indexOf('window.kaminosSetSplatCorrectionDebug',start));
  const context={scenePlacementTools:{edits},window:{kaminosSceneObjectDebugState:()=>[]}};
  vm.runInNewContext(source,context);
  const before=edits.state();
  assert.throws(()=>context.window.kaminosSetSceneObjectTransform('flame-emitter',{position:[99,0,0]}),/bounds/);
  assert.deepEqual(edits.state(),before,'failed source admission must roll back its own transaction');
  edits.begin('flame-emitter');const active=edits.state();
  assert.throws(()=>context.window.kaminosSetSceneObjectTransform('flame-emitter',{position:[.1,0,0]}),/active/);
  assert.deepEqual(edits.state(),active,'a competing agent edit must not cancel the human gesture');
});
