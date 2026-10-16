// kaminos-test: node
import assert from 'node:assert/strict';
import {createCompositeProducerLayout} from '../volume-composite-producer.mjs';
const geometry={shape:[4,4,4],cellWidth:1,fine:{min:[1,1,1],max:[3,3,3],ratio:2}};
const fineSolids={shape:[4,4,4],cells:new Uint8Array(64),revision:'empty'};
const coarseSolids={shape:[4,4,4],cells:new Uint8Array(64),revision:'empty'};
const empty=createCompositeProducerLayout({geometry,fineSolids,coarseSolids,fixedTopology:true});
fineSolids.cells[21]=1;fineSolids.revision='moved';coarseSolids.cells[0]=1;
const occupied=createCompositeProducerLayout({geometry,fineSolids,coarseSolids,fixedTopology:true});
assert.deepEqual(occupied.grid,empty.grid,'resident addresses must not depend on occupancy');
assert.equal(occupied.fixedTopology,true);
const compact=createCompositeProducerLayout({geometry,fineSolids,coarseSolids});
assert.equal(compact.grid.cells.length,empty.grid.cells.length-2,'legacy compact route is retained');
console.log('resident pressure layout contract passed');
