// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {createSceneEdits} from '../scene-edit-session.mjs';import {checkedObjectCollision,canCollideWithFire} from '../scene-collider.mjs';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const grab=name=>{const at=source.indexOf(`function ${name}(`);return source.slice(at,source.indexOf('\n}',at)+2);};
test('the actual collision history target admits a first edit from absent membership and restores it on undo',()=>{
 const entry={id:'baffle',type:'procedural-mesh',collision:null,object:{userData:{kaminosSceneObject:{}}}},edits=createSceneEdits({read(){},write(){}});
 const context={checkedObjectCollision,canCollideWithFire,structuredClone,sceneObjects:[entry],sceneMembershipRetainedObjects:new Map(),scenePlacementTools:{edits},colliderEditTargets:new Set(),syncSceneDataInspector(){},window:{}};
 sceneContext(context);vm.runInContext(grab('writeObjectCollision')+grab('ensureObjectCollisionTarget'),context);
 const id=context.ensureObjectCollisionTarget(entry.id);edits.apply(id,{domainId:'flame-field',enabled:true});
 assert.equal(entry.collision.enabled,true);assert.equal(edits.state().undoCount,1);assert.equal(edits.state().active,null);
 edits.undo();assert.equal(entry.collision,null);edits.redo();assert.equal(entry.collision.enabled,true);assert.equal(edits.state().undoCount,1);
});
