// kaminos-test: node
import assert from 'node:assert/strict';
import {packMicrostructure, intersectDisc, traceMicrostructure} from '../neural-microstructure-core.mjs';

const row = (p,n=[0,0,1],color=[1,0,0],alpha=1) => [...p,...n,...color,0,.8,alpha];
const data = new Float32Array([...row([.2,.5,.2]),...row([.8,.5,.4]),...row([.2,.5,.7],[0,0,1],[0,1,0])]);
const field=packMicrostructure(data,{radius:.08,cellSize:1});
assert.equal(field.count,3); assert.equal(field.carrierCount,1);
assert.deepEqual(Array.from(field.sourceIds),[0,1,2]);
assert.deepEqual(Array.from(field.rows),Array.from(data));
assert.equal(traceMicrostructure(field,[.5,.5,1],[0,0,-1]),null,'Empty space between patches must remain empty');
assert.ok(Math.abs(traceMicrostructure(field,[.2,.5,1],[0,0,-1]).t-.3)<1e-6,'Nearest local depth, not carrier depth');
assert.equal(traceMicrostructure(field,[.2,.5,1],[0,0,-1]).sourceId,2);
assert.equal(traceMicrostructure(field,[.2,.5,-1],[0,0,1]).sourceId,0,'Other side sees the other surface');
assert.equal(intersectDisc([.2,.5,1],[1,0,0],[.2,.5,.7],[0,0,1],.08),null);
assert.equal(intersectDisc([.2,.5,1],[0,0,1],[.2,.5,.7],[0,0,1],.08),null);
assert.ok(Math.abs(intersectDisc([0,0,1],[0,0,-2],[0,0,0],[0,0,2],.1)-.5)<1e-8);
const separated=packMicrostructure(data,{radius:.08,cellSize:.1});
assert.equal(separated.carrierCount,3);
for(const x of [.2,.5,.8]) for(const z of [-1,1]) {
  const origin=[x,.5,z],dir=[0,0,-Math.sign(z)];
  assert.deepEqual(traceMicrostructure(field,origin,dir),traceMicrostructure(separated,origin,dir),'Grouping cannot change the surface');
}
for(let c=0;c<field.carrierCount;c++) {
  const h=c*8,start=field.carriers[h+6],count=field.carriers[h+7];
  for(let j=start;j<start+count;j++) for(let a=0;a<3;a++) {
    assert.ok(field.rows[j*12+a]-.08>=field.carriers[h+a]-1e-6);
    assert.ok(field.rows[j*12+a]+.08<=field.carriers[h+3+a]+1e-6);
  }
}
assert.throws(()=>packMicrostructure(new Float32Array([1]),{radius:.1,cellSize:1}),/rows/);
assert.throws(()=>packMicrostructure(new Float32Array(row([0,0,0],[0,0,0])),{radius:.1,cellSize:1}),/normal/);
assert.throws(()=>packMicrostructure(data,{radius:0,cellSize:1}),/radius/);
assert.throws(()=>packMicrostructure(data,{radius:.1,cellSize:NaN}),/cell/);
const partial=packMicrostructure(new Float32Array(row([0,0,0],[0,0,1],[1,1,1],.25)),{radius:.1,cellSize:1});
assert.equal(partial.rows[11],.25,'Packing must not make partial alpha opaque');
console.log('microstructure: grouping preserves fine gaps, both-side depth, source rows and identity');
