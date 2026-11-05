// kaminos-test: node
import {adaptiveView} from '../ash/adaptive-plan.mjs';
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementIndex,refinementCell} from '../ash/refinement-plan.mjs';
const p=createRefinementLayout({cellSize:.02,bounds:{min:[0,0,0],max:[.64,.32,.64]},tileSize:8,refinement:{ratio:2,mode:'adaptive',fineCapacity:8}});
assert.equal(p.adaptive,true,'automatic topology must use resident bricks, not authored boxes');
assert.equal(p.regions.length,1,'only the covering coarse grid is fixed');
assert.equal(p.pool.capacity,8);
assert.ok(p.count<32*16*32,'a local pool must avoid a full fine backing volume');
assert.equal(refinementCell(p,refinementIndex(p,[9,3,8])).size,2);
console.log('adaptive coarse covering and bounded resident storage pass');

const map=new Uint32Array(p.pool.pages),slots=new Uint32Array(p.pool.capacity);map[0]=1;slots[0]=1;
const v=adaptiveView(p,{map,slots});assert.equal(refinementCell(v,refinementIndex(v,[1,1,1])).size,1);assert.equal(refinementCell(v,0).owned,false);
map[1]=1;assert.throws(()=>adaptiveView(p,{map,slots}),/owner map/);map[1]=0;slots[1]=1;assert.throws(()=>adaptiveView(p,{map,slots}),/inverse map/);
assert.throws(()=>createRefinementLayout({cellSize:.02,bounds:p.bounds,refinement:{ratio:2,mode:'adaptive',fineFraction:0}}),/fraction/);
const partial=createRefinementLayout({cellSize:.02,bounds:{min:[0,0,0],max:[.4,.28,.4]},refinement:{ratio:2,mode:'adaptive'}});
assert.equal(partial.faceWords,partial.regions[0].layout.count*20+partial.pool.capacity*512*5,'partial coarse tiles must not reserve faces for nonexistent cells');
