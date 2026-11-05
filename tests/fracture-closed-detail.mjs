// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoxGeometry,TorusGeometry} from '../lib/three.core.js';
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

test('target termination keeps disjoint rods separate when every axis projection overlaps',()=>{
  const a=new BoxGeometry(2,.1,.1),b=new BoxGeometry(2,.1,.1);
  a.rotateZ(Math.PI/4);b.rotateZ(Math.PI/4);a.translate(.15,-.15,0);b.translate(-.15,.15,0);
  const join=(T,x,y)=>{const out=new T(x.length+y.length);out.set(x);out.set(y,x.length);return out;};
  const arrays={positions:join(Float32Array,a.attributes.position.array,b.attributes.position.array),
    normals:join(Float32Array,a.attributes.normal.array,b.attributes.normal.array),uvs:join(Float32Array,a.attributes.uv.array,b.attributes.uv.array),
    indices:join(Uint32Array,a.index.array,Uint32Array.from(b.index.array,i=>i+a.attributes.position.count)),faceMaterial:new Uint8Array(24)};
  const before=structuredClone(arrays);
  for(const cutVariation of [0,1]){
    const prepared=prepareWholeFracture(arrays,{labels:new Uint32Array(24),boundaries:[]},{cellExtent:.4,targetPieces:1,cutVariation});
    assert.equal(prepared.pieces.length,2,'A geometric target must not merge disconnected solid components');
    for(const piece of prepared.pieces){
      const signs=new Set(Array.from({length:piece.arrays.positions.length/3},(_,i)=>Math.sign(piece.arrays.positions[i*3]-piece.arrays.positions[i*3+1])));
      assert.equal(signs.size,1,'Each mechanical body contains material from only one rod');
    }
    const volume=prepared.pieces.reduce((sum,piece)=>sum+materialMeasure(piece.arrays).volume,0);
    assert.ok(Math.abs(volume-.04)<1e-6);
    assert.ok(Math.abs(prepared.receipt.exteriorAreaAfter-materialMeasure(arrays).area)<1e-6);
  }
  assert.deepEqual(arrays,before);
});

function pack(geometries){
  const positions=[],indices=[];
  for(const g of geometries){const base=positions.length/3;positions.push(...g.attributes.position.array);indices.push(...Array.from(g.index.array,i=>i+base));}
  return {positions:Float32Array.from(positions),indices:Uint32Array.from(indices),faceMaterial:new Uint8Array(indices.length/3)};
}

test('a cavity remains part of its surrounding material while a solid inside the cavity stays independent',()=>{
  const outer=new BoxGeometry(2,2,2),cavity=new BoxGeometry(1,1,1),inside=new BoxGeometry(.25,.25,.25);
  for(let i=0;i<cavity.index.array.length;i+=3)[cavity.index.array[i+1],cavity.index.array[i+2]]=[cavity.index.array[i+2],cavity.index.array[i+1]];
  for(const geometries of [[outer,cavity],[outer,cavity,inside]]){
    const arrays=pack(geometries),prepared=prepareWholeFracture(arrays,{labels:new Uint32Array(arrays.indices.length/3)},{targetPieces:1});
    assert.equal(prepared.pieces.length,geometries.length-1,'Boundary shells do not individually become solid bodies');
    const volume=prepared.pieces.reduce((sum,p)=>sum+materialMeasure(p.arrays).volume,0);
    assert.ok(Math.abs(volume-materialMeasure(arrays).volume)<1e-6,'The cavity cannot become extra solid volume');
  }
});

test('nested bounds do not join a separate solid in the empty center of a torus',()=>{
  const arrays=pack([new TorusGeometry(1,.25,8,16),new BoxGeometry(.1,.1,.1)]);
  const prepared=prepareWholeFracture(arrays,{labels:new Uint32Array(arrays.indices.length/3)},{targetPieces:1});
  assert.equal(prepared.pieces.length,2);
  assert.ok(Math.abs(prepared.pieces.reduce((sum,p)=>sum+materialMeasure(p.arrays).volume,0)-materialMeasure(arrays).volume)<1e-6);
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
