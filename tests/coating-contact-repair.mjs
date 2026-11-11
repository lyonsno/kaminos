// kaminos-test: node
import test from'node:test';import assert from'node:assert/strict';
import{coatingCorner,minimizeSheetEnergy,sampleSheetObstacle,minimumContactSlope,sheetContactBreakpoint}from'../coating-finite-sheet.mjs';
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

test('a displaced point can land exactly on an asymmetric crease before energy underflows',()=>{
 const evaluate=x=>({energy:1+(x[0]<0?-3*x[0]:x[0])+.5*x[1]**2,gradient:new Float64Array([x[0]===0?0:x[0]<0?-3:1,x[1]])});
 const breakpoint=(x,d,step)=>{const t=-x[0]/d[0];if(!(t>0&&t<=step))return null;const candidate=Float64Array.from(x,(v,i)=>v+t*d[i]);candidate[0]=0;return {step:t,candidate};};
 const solved=minimizeSheetEnergy(new Float64Array([.04,.01]),evaluate,1e-10,()=>{},breakpoint);
 assert.equal(solved.x[0],0);assert.ok(Math.abs(solved.x[1])<=1e-10);
});

test('production contact events reach axis and diagonal creases without retriggering active faces',()=>{
 const n=4,u=new Float64Array(3*n*n),d=new Float64Array(u.length),weights=new Float64Array(n*n);weights[0]=1;
 u[0]=.04;u[2]=.1;d[0]=-1;
 const axis=sheetContactBreakpoint(u,d,1,n,weights);assert.equal(axis.step,.04);assert.equal(axis.candidate[0],0);
 u[0]=.1;u[2]=.04;d[0]=-1;const diagonal=sheetContactBreakpoint(u,d,1,n,weights);assert.ok(Math.abs(diagonal.step-.06)<1e-15);assert.equal(diagonal.candidate[0],diagonal.candidate[2]);
 u[0]=1e-16;u[2]=.1;const active=sheetContactBreakpoint(u,d,1,n,weights);assert.ok(active.step>.1,'already active grid crease does not cause near-zero event');
});
test('production obstacle gradient and exact event converge from a displaced asymmetric crease side',()=>{
 const n=4,h=new Float64Array(16);for(let z=0;z<n;z++)for(let x=0;x<n;x++)h[z*n+x]=x===0?0:x===3?3:1;
 const weights=new Float64Array(16);weights[0]=1;const initial=new Float64Array(48);initial[0]=.04;initial[2]=.375;
 const evaluate=u=>{const sample=sampleSheetObstacle(h,n,u[0],u[2]),slope=minimumContactSlope(sample,[0,0]),gradient=new Float64Array(48);gradient[0]=slope[0];gradient[2]=slope[1];return {energy:1+sample.height,gradient};};
 const result=minimizeSheetEnergy(initial,evaluate,1e-10,()=>{},(x,d,step)=>sheetContactBreakpoint(x,d,step,n,weights));assert.ok(Math.abs(result.x[0])<=32*Number.EPSILON);assert.ok(result.residual<=1e-10);
});
