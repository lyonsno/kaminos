// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as controls from '../masonry-controls.mjs';

test('spatial authoring uses millimeters and zero has a real source meaning',()=>{
 assert.equal(controls.controlValue('relief',-5),0);
 assert.equal(controls.controlValue('relief',25),.025);
 assert.equal(controls.controlValue('cells',0),2);
 assert.equal(controls.controlValue('cells',31.8),32);
 assert.equal(controls.displayValue('margin',.13),130);
});
test('live editing coalesces keys without starving updates during a continuous drag',async()=>{
 let callback,cleared=0;const applied=[];
 const edits=controls.createLiveMasonryEdits({apply:async p=>applied.push(p),setTimer:fn=>{assert.equal(callback,undefined);callback=fn;return 1;},clearTimer:()=>{callback=undefined;cleared++;}});
 edits.schedule({relief:.01});edits.schedule({relief:.02});edits.schedule({margin:.15});
 const tick=callback;callback=undefined;await tick();assert.deepEqual(applied,[{relief:.02,margin:.15}]);
 edits.schedule({relief:.03});assert.ok(callback);await edits.flush();assert.deepEqual(applied[1],{relief:.03});assert.ok(cleared);
 edits.schedule({seed:3});edits.dispose();assert.equal(callback,undefined);assert.equal(applied.length,2);
});
