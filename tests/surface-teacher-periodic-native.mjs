// kaminos-test: node
// Tiny functional production-shader fixtures; no training or performance measurement.
import test from 'node:test';import assert from 'node:assert/strict';import{SurfaceTeacher}from'../surface-teacher.mjs';import{withKaminosGpu}from'../tools/shader-herder.mjs';
const ground=[{a:[-1,0,-1],b:[1,0,1],c:[1,0,-1],materialIndex:0},{a:[-1,0,-1],b:[-1,0,1],c:[1,0,1],materialIndex:0}];
const base={triangles:ground,materials:[{color:[.5,.3,.1],roughness:1,metalness:0}],lights:[{type:'directional',position:[0,1,0],color:[3,3,3]}],environment:0,bounces:1,periodic:{width:2,depth:2,minY:0,maxY:1}};
test('production periodic camera transport reaches distant tiles and is translation invariant',async()=>{await withKaminosGpu(async ctx=>{
 const t=new SurfaceTeacher(ctx.device,base);try{const rays=[{origin:[0,1,0],direction:[1,-.1,0]},{origin:[40,1,-26],direction:[1,-.1,0]}],a=await t.evaluate(rays);assert.ok(a[0][0]>.4,'grazing camera must reach repeated ground instead of black miss');assert.deepEqual(a[0],a[1]);assert.equal(t.state().periodic.width,2);}finally{t.dispose();}
});});
test('production periodic shadow transport sees a blocker in the neighboring tile',async()=>{await withKaminosGpu(async ctx=>{
 const wall=[{a:[-.5,0,-1],b:[-.5,1,-1],c:[-.5,1,1],materialIndex:0},{a:[-.5,0,-1],b:[-.5,1,1],c:[-.5,0,1],materialIndex:0}],t=new SurfaceTeacher(ctx.device,{...base,triangles:[...ground,...wall],lights:[{type:'directional',position:[1,1,0],color:[3,3,3]}]});
 try{const a=await t.evaluate([{origin:[.9,.1,0],direction:[0,-1,0]}]);assert.ok(a[0][0]<1e-6,'neighboring blocker must shadow central tile');}finally{t.dispose();}
});});

test('material queries repeat through actual grass with multibounce transport',async()=>{await withKaminosGpu(async ctx=>{
 const {SurfaceMaterialTeacher}=await import('../surface-material-teacher.mjs'),{createGrassMaterialSource}=await import('../grass-material-source.mjs');
 const source=createGrassMaterialSource({seed:31,blades:16,width:2,depth:2,height:.6,bladeWidth:.15,periodic:true}),t=new SurfaceMaterialTeacher(ctx.device,{...source,lights:[],environment:0,bounces:3});
 try{const config={tileSize:2,tileDepth:2,referenceHeight:.602,resolution:64,samples:16,seed:19},q=new Float32Array([.25,.5,.4,.2,-.3,.5,0,0]);const a=await t.evaluateMaterial(q,config);q[0]+=1;const b=await t.evaluateMaterial(q,config);assert.ok(a.every(v=>v>=0&&Number.isFinite(v)));assert.ok(a.some(v=>v>0));assert.ok(a.every((v,i)=>Math.abs(v-b[i])<1e-4));await assert.rejects(()=>t.evaluate([{origin:[0,.2,0],direction:[1,0,0]}]),/horizontal/);}finally{t.dispose();}
});});
