import test from 'node:test';
import assert from 'node:assert/strict';
import * as controls from '../scene-control-history.mjs';
test('bounded value fill represents actual range position including negative intervals and limits',()=>{
 assert.equal(typeof controls.authoringRangeFraction,'function','numeric controls need range feedback');
 const fraction=controls.authoringRangeFraction;
 assert.equal(fraction('55.5','10','100'),45.5/90);
 assert.equal(fraction(0,-5,5),.5);
 assert.equal(fraction(100,10,100),1);
 assert.equal(fraction(-20,10,100),0);
 assert.equal(fraction(200,10,100),1);
});
test('unbounded, degenerate and temporarily blank fields do not fabricate a range',()=>{
 assert.equal(typeof controls.authoringRangeFraction,'function');
 for(const args of [[5,'',''],[5,0,''],['',0,1],[NaN,0,1],[1,1,1],[0,2,1]])assert.equal(controls.authoringRangeFraction(...args),null);
});
