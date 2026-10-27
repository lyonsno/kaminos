// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {tiledCheckpointLocal} from '../ash/witness-state.mjs';
test('tile witness consumes the observed cloud checkpoint envelope without flattening it',()=>{
 // Shape observed in first-look-r2/before.json, source recorded in the ash review.
 const state={schema:'kaminos.scene-wide-ash.v1',local:{schema:'kaminos.kiln-gpu-ash.v1',patch:{schema:'kaminos.tiled-ash.v1',values:[0]}},atmosphere:{},time:10,paused:true};
 assert.equal(tiledCheckpointLocal(state),state.local);assert.equal(tiledCheckpointLocal(state).patch,state.local.patch);assert.equal(state.patch,undefined);
 assert.throws(()=>tiledCheckpointLocal({...state,local:{...state.local,patch:undefined},patch:state.local.patch}),/local tiled physical/);
 assert.throws(()=>tiledCheckpointLocal({...state,local:{...state.local,patch:{...state.local.patch,schema:'kaminos.gpu-ash-patch.v1'}}}),/local tiled physical/);
});
