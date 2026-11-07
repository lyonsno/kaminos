// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefinementLayout,refinementCell,refinementIndex} from '../ash/refinement-plan.mjs';

const options=cellSize=>({cellSize,bounds:{min:[0,0,0],max:[.64,.64,.64]},refinement:{ratio:2,mode:'hierarchy',backgroundCellSize:.08,budgetMiB:4}});

test('local precision does not refine background or multiply the storage allowance',()=>{
 const a=createRefinementLayout(options(.01)),b=createRefinementLayout(options(.000625));
 assert.equal(a.hierarchy.depth,3);assert.equal(b.hierarchy.depth,7);
 assert.equal(a.regions[0].layout.cellSize,.08);assert.equal(b.regions[0].layout.count,512);
 assert.equal(a.count,b.count,'same pool budget at arbitrary depth');
 assert.equal(a.hierarchy.capacity,b.hierarchy.capacity);
 assert.ok(b.hierarchy.reservedBytes<=4*1048576);
 assert.equal(a.hierarchy.metadataWords,b.hierarchy.metadataWords,'deeper targets do not grow hypothetical page maps');
 assert.ok(b.hierarchy.metadataWords<(b.hierarchy.capacity+b.hierarchy.roots)*64);
 const c=refinementCell(b,0);assert.equal(c.size,128);assert.equal(refinementIndex(b,[1,1,1]),0);
});

test('hierarchical settings reject an impossible covering reservation instead of exceeding budget',()=>{
 assert.throws(()=>createRefinementLayout({...options(.001),refinement:{...options(.001).refinement,budgetMiB:.001}}),/budget.*cover|cover.*budget/i);
});


test('hierarchy parcels use local units and an explicit airborne storage allowance',async()=>{
 const {fallingLayout}=await import('../ash/fall-plan.mjs');
 const build=cellSize=>createRefinementLayout({...options(cellSize),refinement:{...options(cellSize).refinement,airBudgetMiB:1}});
 const a=fallingLayout(build(.01)),b=fallingLayout(build(.000625));
 assert.equal(a.parcelUnits,8);assert.equal(b.parcelUnits,8,'deeper cells cannot carry a background cube per impact');
 assert.equal(a.capacity,b.capacity,'air storage follows its allowance rather than hypothetical fine columns');
 assert.ok(b.capacity>1024);assert.ok(b.reservedBytes<=1048576);
});
