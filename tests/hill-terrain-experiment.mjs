// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
const moduleURL=new URL('../experiments/hill-terrain.experiment.mjs',import.meta.url);
assert.ok(existsSync(moduleURL),'Hill must mount as a native Kaminos experiment');
const {default:definition}=await import(moduleURL);
const {exportCloneInWorld}=await import('../scene-export.mjs');
const {sceneContentBounds}=await import('../scene-frame-selected.mjs');
test('native lifetime and edits use the shared scene and effective operations',async()=>{
 const objects=new Set(),events=[];let callback,unsubscribed=false,view;
 const session={attach:async root=>{objects.add(root);return{id:root.uuid,root};},setView:v=>(view=v),readView:()=>view,redraw(){},onFrame:f=>(callback=f,()=>{unsubscribed=true;}),dispose:async()=>objects.clear()};
 const instance=await definition.create({host:{scene:{open:async()=>session}},inputs:{resolution:17},record:e=>events.push(e)});
 assert.equal(objects.size,1);const root=[...objects][0];assert.throws(()=>exportCloneInWorld(root),/GPU terrain export/);assert.equal(sceneContentBounds(root).isEmpty(),false);assert.equal(instance.read().simulator.kind,'terrain');assert.equal(instance.read().backend,'unbound');
 assert.throws(()=>instance.operations.advance(1),/mounted/);
 instance.operations.setMaterial({repose:27});assert.equal(instance.read().config.repose,27);
 instance.operations.regenerate({seed:91});assert.equal(instance.read().config.seed,91);assert.equal(events.at(-1).effective.config.seed,91);
 assert.throws(()=>instance.operations.play('yes'),/Boolean/);
 await instance.dispose();assert.equal(objects.size,0);assert.equal(unsubscribed,true);callback({deltaSeconds:1});
});
