// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneComponentEdit} from '../scene-component-edit.mjs';
test('Tab uses an owner component target, changes cancel gestures before switching, and selection loss exits',()=>{
 let selected='skeleton',cancelled=0,entered=0,exited=0;
 const edit=createSceneComponentEdit({selected:()=>selected,cancel:()=>cancelled++,refresh:()=>{}});
 const target={id:'@joints',object:{},read:()=>({position:[1,2,3]})};
 const seat=edit.register('skeleton',{target:()=>target,enter:()=>entered++,exit:()=>exited++});
 assert.equal(edit.active(),false);assert.equal(edit.toggle('other'),false);
 assert.equal(edit.toggle('skeleton'),true);assert.equal(entered,1);assert.equal(edit.target().ownerId,'skeleton');
 assert.equal(edit.resolve('@joints').read().position[1],2);
 seat.changed();assert.equal(cancelled,2);
 selected='reference';assert.equal(edit.active(),false);assert.equal(exited,1);assert.equal(edit.resolve('@joints'),null);
 selected='skeleton';edit.toggle('skeleton');seat.dispose();assert.equal(edit.active(),false);assert.equal(exited,2);
});

test('component deletion is owned by the active adapter and refreshes selection',()=>{
 let selected='mechanism',removed=0,refreshed=0;
 const edit=createSceneComponentEdit({selected:()=>selected,cancel(){},refresh:()=>refreshed++});
 edit.register('mechanism',{target:()=>null,enter(){},exit(){},remove(){removed++;return true;}});
 assert.equal(edit.remove(),false);edit.toggle('mechanism');const before=refreshed;
 assert.equal(edit.remove(),true);assert.equal(removed,1);assert.equal(refreshed,before+1);
 selected='elsewhere';assert.equal(edit.remove(),false);assert.equal(removed,1);
 edit.register('skeleton',{target:()=>null,enter(){},exit(){}});selected='skeleton';edit.toggle('skeleton');
 assert.equal(edit.remove(),false,'Owners without deletion keep their support boundary');
});

test('owner entry is idempotent and requires the native selected owner',()=>{
 let selected='a',enters=0,exits=0;const edit=createSceneComponentEdit({selected:()=>selected,cancel(){},refresh(){}});
 const seat=edit.register('a',{target:()=>null,enter(){enters++;},exit(){exits++;}});
 seat.enter();seat.enter();assert.equal(enters,1);assert.equal(edit.active(),true);
 selected='b';assert.throws(()=>seat.enter(),/Select/);assert.equal(edit.active(),false);assert.equal(exits,1);
 selected='a';seat.enter();seat.dispose();assert.throws(()=>seat.enter(),/disposed/);assert.equal(edit.active(),false);
});

test('Tab enters a selected child context, returns to its parent, and selection loss unwinds both',()=>{
 let selected='assembly',childSelected=true;const events=[];
 const edit=createSceneComponentEdit({selected:()=>selected,cancel:()=>events.push('cancel'),refresh(){}});
 const child={label:'Seating',target:()=>({id:'@seating'}),enter:()=>events.push('child enter'),exit:()=>events.push('child exit')};
 edit.register('assembly',{target:()=>null,child:()=>childSelected?child:null,enter:()=>events.push('parent enter'),exit:()=>events.push('parent exit')});
 edit.toggle('assembly');edit.toggle('assembly');
 assert.equal(edit.active(),true,'entering the selected connection must retain its parent editing context');
 assert.equal(edit.target().id,'@seating');assert.equal(edit.target().ownerId,'assembly');
 edit.toggle('assembly');assert.equal(edit.active(),true);assert.equal(edit.target(),null);assert.equal(events.at(-1),'child exit');
 edit.toggle('assembly');selected='elsewhere';assert.equal(edit.active(),false);assert.deepEqual(events.slice(-2),['child exit','parent exit']);
 selected='assembly';childSelected=false;edit.toggle('assembly');edit.toggle('assembly');assert.equal(edit.active(),false);
});
