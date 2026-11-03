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
test('an assembly scope keeps native member selection and exits to its owner with Tab',()=>{
 let selected='@group:burner',inside=false;
 const edit=createSceneComponentEdit({selected:()=>selected,cancel(){},refresh(){}});
 edit.register('@group:burner',{target:()=>null,scope:()=>({id:'burner',objectIds:['body','outlet']}),
  isCurrent:()=>inside&&['body','outlet',null].includes(selected),
  enter(){inside=true;selected='body';},exit(){inside=false;selected='@group:burner';}});
 assert.equal(edit.toggle(selected),true);
 assert.equal(edit.active(),true,'selection of a member must not leave assembly Edit Mode');
 assert.equal(edit.scope().id,'burner');assert.equal(edit.ownsTransforms(),false,'member transforms use ordinary scene history');
 selected='outlet';assert.equal(edit.active(),true);edit.toggle(selected);
 assert.equal(edit.active(),false);assert.equal(selected,'@group:burner');
});
