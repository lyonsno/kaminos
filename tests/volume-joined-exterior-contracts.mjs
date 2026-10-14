// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveJoinedExteriorGeometry,resolveJoinedExteriorWall,joinedExteriorSolids} from '../volume-joined-exterior.mjs';
test('independent cell counts preserve physical bounds',()=>{
 for(const n of [24,28,32,48])for(const coarseResolution of [24,28,32]){
  const g=resolveJoinedExteriorGeometry({fineDims:[n,2*n,n],pitch:2/n,coarseResolution,size:2});
  assert.equal(g.admitted,true,g.reason);
  assert.deepEqual(g.shape,[coarseResolution,2*coarseResolution,coarseResolution]);
  assert.deepEqual(g.geometry.min,[-2,-2,-2]);assert.deepEqual(g.geometry.fine.max,[1,3,1]);
  assert.equal(g.ghosts.cellWidthFine,g.cellWidth/(2/n));
  assert.deepEqual(g.ghosts.originFine,[-n/2,-n/2,-n/2]);
 }
});
test('unsupported aspect and unresolved donor are refused',()=>{
 assert.equal(resolveJoinedExteriorGeometry({fineDims:[32,48,32],pitch:2/32}).admitted,false);
 assert.equal(resolveJoinedExteriorGeometry({fineDims:[32,32,32],pitch:2/32,coarseResolution:2,size:4}).admitted,false);
});
test('side and roof slabs use physical fine bounds',()=>{
 const g=resolveJoinedExteriorGeometry({fineDims:[32,32,32],pitch:2/32,coarseResolution:32,size:2});
 assert.deepEqual(resolveJoinedExteriorWall({side:'+x',gap:2,thickness:2},g),{axis:0,at:26,thickness:2,side:'+x',gap:2,outside:false});
 assert.deepEqual(resolveJoinedExteriorWall({side:'-z',gap:2,thickness:2},g),{axis:2,at:4,thickness:2,side:'-z',gap:2,outside:false});
 assert.equal(resolveJoinedExteriorWall({side:'+x',gap:9,thickness:2},g).outside,true);
 const roof=resolveJoinedExteriorWall({side:'+y',gap:2,thickness:2},g),mask=joinedExteriorSolids(g.shape,roof);
 assert.equal(mask.cells.reduce((a,b)=>a+b,0),32*32*2);
 assert.equal(mask.cells[16+32*(26+64*16)],1);
 assert.equal(mask.cells[16+32*(25+64*16)],0);
});
