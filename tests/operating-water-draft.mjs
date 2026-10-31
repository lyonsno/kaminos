// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {waterControlsFixture} from './helpers/water-controls.mjs';
test('a gesture on another view commits pending native properties before its history begins',()=>{
 const f=waterControlsFixture();let settings={mode:'continuous',volumeRate:.008,baseRadius:.075,strength:.25,drop:{width:.5,samplesPerUnit:32}};
 f.api.read=()=>({selected:{id:'A',settings}});f.api.edit=(id,patch)=>{settings={...settings,...patch};f.controls.refresh();};f.controls.refresh();
 const radius=f.input('[data-radius]');radius.value='.12';radius.listeners.input();
 assert.equal(typeof f.controls.commitBeforeEdit,'function','native pending edits require synchronous gesture handoff');
 f.controls.commitBeforeEdit();assert.equal(settings.baseRadius,.12);assert.equal(settings.volumeRate,.008);
 radius.value='';radius.listeners.input();assert.throws(()=>f.controls.commitBeforeEdit(),/Complete/);assert.equal(settings.baseRadius,.12);
 f.controls.dispose();
});
