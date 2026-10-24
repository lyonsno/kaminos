// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {AshDeposit} from '../ash/deposit.mjs';
import {ashBlockSurface} from '../ash/surface.mjs';
test('partial cells expose their actual height and hide shared/internal faces',()=>{
 const d=new AshDeposit();d.add([0,0,0],.5);
 const one=ashBlockSurface(d,'0,0,0');assert.equal(one.positions.length,5*6*3);
 assert.equal(Math.max(...one.positions.filter((_,i)=>i%3===1)),.5);
 d.add([1,0,0],.5);assert.equal(ashBlockSurface(d,'0,0,0').positions.length,8*6*3);
});
test('neighbor block contributes occlusion without being included in this mesh',()=>{
 const d=new AshDeposit({blockSize:1});d.add([0,0,0],1);d.add([1,0,0],1);
 assert.equal(ashBlockSurface(d,'0,0,0').positions.length,4*6*3);
 assert.equal(ashBlockSurface(d,'9,0,0').positions.length,0);
});
