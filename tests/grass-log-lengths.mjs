// kaminos-test: node
import test from'node:test';import assert from'node:assert/strict';
import{createGrassMaterialSource as create}from'../grass-material-source.mjs';
const recipe={seed:31,blades:512,height:4.2,width:4.8,depth:4.8,bladeWidth:.35,bend:.45,segments:7,periodic:true,tufts:{centres:[[-1.2,-1.2],[1.2,-1.2],[-1.2,1.2],[1.2,1.2]],radius:.85,grading:'uniform',rimFraction:.2,cuts:[]}};
const tip=b=>b.centres.at(-1)[1];
test('log length spread has a deterministic median scale and zero-spread limit',()=>{
 const uniform=create({...recipe,lengthLogSigma:0});assert.ok(uniform.blades.every(b=>Math.abs(tip(b)-4.2)<1e-12));
 const varied=create({...recipe,lengthLogSigma:.35}),logs=varied.blades.map(b=>Math.log(tip(b)/4.2)),mean=logs.reduce((a,b)=>a+b)/logs.length,sd=Math.sqrt(logs.reduce((a,b)=>a+(b-mean)**2,0)/logs.length);
 assert.ok(Math.abs(mean)<.06,`log mean ${mean}`);assert.ok(Math.abs(sd-.35)<.06,`log spread ${sd}`);
 assert.ok(varied.blades.some(b=>tip(b)>4.2));assert.ok(varied.blades.some(b=>tip(b)<4.2));assert.deepEqual(varied,create(varied.config));
 assert.ok(varied.referenceHeight>Math.max(...varied.blades.map(tip)),'reference plane encloses long-tail stalks');
});
test('length variation preserves roots, widths and normalized stalk orientation',()=>{
 const a=create({...recipe,blades:64}),b=create({...recipe,blades:64,lengthLogSigma:.35});
 for(let i=0;i<64;i++){
  assert.deepEqual(a.blades[i].centres[0],b.blades[i].centres[0]);assert.deepEqual(a.blades[i].widths,b.blades[i].widths);
  for(const axis of [0,2]){const root=a.blades[i].centres[0][axis],u=(a.blades[i].centres.at(-1)[axis]-root)/tip(a.blades[i]),v=(b.blades[i].centres.at(-1)[axis]-root)/tip(b.blades[i]);assert.ok(Math.abs(u-v)<1e-12);}
 }
});
test('nonfinite or negative log spreads refuse explicitly',()=>{
 for(const lengthLogSigma of [-1,Infinity,NaN,null])assert.throws(()=>create({...recipe,blades:1,lengthLogSigma}),/lengthLogSigma/);
});
