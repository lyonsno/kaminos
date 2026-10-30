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
test('owner hover and cancellation follow active selection and explicit entry',()=>{
 let selected='machine',moves=0,cancels=0;
 const edit=createSceneComponentEdit({selected:()=>selected,cancel(){},refresh(){}});
 const seat=edit.register('machine',{enter(){},exit(){},target(){return null;},hover(e,c){moves++;assert.equal(c.camera,'camera');},cancel(){cancels++;return true;}});
 assert.equal(edit.hover({},{}),false);seat.enter();assert.equal(edit.active(),true);
 edit.hover({},{camera:'camera'});assert.equal(moves,1);assert.equal(edit.cancel(),true);assert.equal(cancels,1);
 selected='elsewhere';assert.equal(edit.hover({},{}),false);assert.equal(edit.cancel(),false);seat.dispose();
});
