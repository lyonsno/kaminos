// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry} from '../lib/three.core.js';
import {prepareWholeFracture,materialMeasure} from '../fracture-whole-prepare.mjs';

const geometry=new BoxGeometry(2,2,2),source={positions:geometry.attributes.position.array,
  normals:geometry.attributes.normal.array,uvs:geometry.attributes.uv.array,
  indices:Uint32Array.from(geometry.index.array),faceMaterial:new Uint8Array(12)};
const view={labels:new Uint32Array(12),boundaries:[]};

test('bounded finer cuts retain the whole solid and produce reproducible non-axis-aligned sections',()=>{
  const options={cellExtent:.75,targetPieces:12,cutVariation:1};
  const before=structuredClone(source),prepared=prepareWholeFracture(source,view,options);
  assert.equal(prepared.pieces.length,12,'Finer target extent cannot multiply rigid bodies beyond the geometric split target');
  assert.ok(prepared.bonds.some(b=>b.normal.filter(v=>Math.abs(v)>1e-4).length>1),'Refinement must change the actual closed sections, not only color');
  assert.ok(Math.abs(prepared.receipt.exteriorAreaAfter-24)<24e-5);
  const volume=prepared.pieces.reduce((sum,p)=>sum+materialMeasure(p.arrays).volume,0);
  assert.ok(Math.abs(volume-8)<8e-5,`Closed piece volume must be conserved, got ${volume}`);
  for(const p of prepared.pieces){
    assert.ok(p.arrays.positions.every(v=>Number.isFinite(v)&&v>=-1.000001&&v<=1.000001));
    for(let f=0;f<p.faceInterfaces.length;f++)if(p.faceInterfaces[f])assert.ok(p.faceBonds[f]>=0,'Every internal face retains a mechanical connection');
  }
  const repeated=prepareWholeFracture(source,view,options);
  assert.deepEqual(prepared.pieces.map(p=>p.arrays),repeated.pieces.map(p=>p.arrays));
  assert.deepEqual(prepared.bonds,repeated.bonds);
  assert.deepEqual(source,before,'Preparation does not deform or overwrite the authored exterior');
});

test('the accepted axis-aligned preparation remains the default',()=>{
  const prepared=prepareWholeFracture(source,view,{cellExtent:1});
  assert.equal(prepared.pieces.length,8);
  assert.ok(prepared.bonds.every(b=>b.normal.filter(v=>Math.abs(v)>1e-4).length===1));
});

test('invalid subdivision targets fail explicitly',()=>{
  for(const targetPieces of [0,-1,1.5,NaN,Infinity])assert.throws(()=>prepareWholeFracture(source,view,{targetPieces}),/piece target/i);
  for(const cutVariation of [-1,1.01,NaN,Infinity])assert.throws(()=>prepareWholeFracture(source,view,{cutVariation}),/cut variation/i);
});

test('a subdivision target never welds disconnected material to fit a body count',()=>{
  const a=new BoxGeometry(.25,.25,.25),b=new BoxGeometry(.25,.25,.25);a.translate(-2,0,0);b.translate(2,0,0);
  const join=(T,x,y)=>{const out=new T(x.length+y.length);out.set(x);out.set(y,x.length);return out;};
  const arrays={positions:join(Float32Array,a.attributes.position.array,b.attributes.position.array),
    normals:join(Float32Array,a.attributes.normal.array,b.attributes.normal.array),uvs:join(Float32Array,a.attributes.uv.array,b.attributes.uv.array),
    indices:join(Uint32Array,a.index.array,Uint32Array.from(b.index.array,i=>i+a.attributes.position.count)),faceMaterial:new Uint8Array(24)};
  const prepared=prepareWholeFracture(arrays,{labels:new Uint32Array(24),boundaries:[]},{targetPieces:1,cutVariation:1});
  assert.equal(prepared.pieces.length,2);assert.equal(prepared.bonds.length,0);
  assert.ok(Math.abs(prepared.receipt.exteriorAreaAfter-.75)<1e-6);
});

test('the real preparation worker admits an explicit detailed comparison without changing the default',async()=>{
  const previous=globalThis.self;let response;
  try{
    globalThis.self={postMessage:value=>response=value};await import('../burn-structure.worker.mjs');
    const material={bounds:{min:[-1,-1,-1],max:[1,1,1]},dimensions:[8,8,8],initial:new Uint32Array(512).fill(1)};
    self.onmessage({data:{source,material,detail:true}});
    assert.equal(response.error,undefined);assert.equal(response.prepared.pieces.length,80);
    assert.equal(response.prepared.receipt.targetPieces,80);assert.equal(response.prepared.receipt.cutVariation,1);
    self.onmessage({data:{source,material}});
    assert.equal(response.error,undefined);assert.equal(response.prepared.pieces.length,64);
    assert.equal(response.prepared.receipt.cutVariation,0);
  }finally{if(previous===undefined)delete globalThis.self;else globalThis.self=previous;}
});
