// kaminos-test: node
import test from'node:test';import assert from'node:assert/strict';
import{coatingCorner,minimizeSheetEnergy,sampleSheetObstacle,minimumContactSlope}from'../coating-finite-sheet.mjs';
import{createCorrosionState,advanceCorrosion}from'../coating-corrosion.mjs';
test('zero-resolvable Armijo decrease refuses rather than repeating a plateau',()=>{
 const evaluate=x=>({energy:1+Math.abs(x[0]-.5)+x[1]**2+1e-12*x[1],gradient:new Float64Array([x[0]>=.5?1:-1,2*x[1]+1e-12])});
 // Observe the existing production optimizer's accepted steps. A rounded
 // equality must not be accepted as evidence of descent.
 assert.throws(()=>minimizeSheetEnergy(new Float64Array([.5,0]),evaluate,1e-10,(before,after)=>assert.ok(after.energy<before.energy,'accepted-non-decreasing-step')),/floating.precision|resolvable|stagnation/);
});
test('surviving rim attachment excludes the open pit floor',()=>{
 const n=4,field=new Float64Array(n*n),opening=new Float64Array(n*n);field[0]=1;opening[0]=1;
 assert.equal(coatingCorner(field,n,1,1,opening),0);
});
test('an isolated open pit cannot drag an otherwise bonded uncorroded rim downward',()=>{
 const s=createCorrosionState({resolution:4,mechanics:'finite-shell',corrosionRate:0,precipitationRate:0,defects:[]});s.opening[0]=1;s.bond[0]=0;s.metalLoss[0]=.01;advanceCorrosion(s,.01);
 for(let i=0;i<16;i++)assert.ok(s.filmDisplacement[i*3+1]>=-1e-8,`node ${i} follows open pit`);
});

test('contact at a grid crease uses the minimum-norm active-face gradient without changing height',()=>{
 const n=4,h=new Float64Array(16);for(let z=0;z<n;z++)for(let x=0;x<n;x++)h[z*n+x]=x===0?0:1;
 const sample=sampleSheetObstacle(h,n,0,.375);assert.equal(sample.height,0);assert.deepEqual(minimumContactSlope(sample,[0,0]),[0,0]);
 const slope=minimumContactSlope(sample,[2,3]);assert.ok(Math.abs(slope[0]-2)<1e-12);assert.equal(slope[1],0);
 const interior=sampleSheetObstacle(h,n,.125,.375);assert.deepEqual(minimumContactSlope(interior,[0,0]),[4,0]);
});
