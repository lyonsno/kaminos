// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {ashMembershipEntry} from '../ash/history-record.mjs';
test('membership history keeps the live root without copying saved material; saving keeps its full checkpoint',()=>{
 const checkpoint={schema:'kaminos.tiled-ash.v1',values:[.1,.2]},root={};
 const entry={type:'retained-ash',object:root,ash:{cellSize:.02,checkpoint}};
 const compact=ashMembershipEntry(entry);assert.equal(compact.ash.checkpoint,null);assert.equal(compact.object,root);
 assert.equal(entry.ash.checkpoint,checkpoint);assert.equal(compact.ash.cellSize,.02);
 const mesh={type:'glb'};assert.equal(ashMembershipEntry(mesh),mesh);
});
