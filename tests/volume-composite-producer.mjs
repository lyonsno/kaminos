import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';

const url=new URL('../volume-composite-producer.mjs',import.meta.url);
async function implementation(){
  assert.ok(existsSync(url),'composite producer target/solid intake is absent');
  return import(url);
}
const index=(p,s)=>p[0]+s[0]*(p[1]+s[1]*p[2]);
function fixture(h=.25){
  const shape=[4,5,4],min=[-2,3,-1],H=2*h;
  const fine={min:min.map(v=>v+H),max:min.map((v,a)=>v+H*[3,4,2][a]),ratio:2};
  const fineShape=[4,6,2],fineCells=new Uint8Array(48),coarseCells=new Uint8Array(80);
  fineCells[index([1,2,0],fineShape)]=1;
  coarseCells[index([0,1,1],shape)]=1;
  // Coarse occupancy covered by fine MUST NOT occlude the refined cells.
  coarseCells[index([1,1,1],shape)]=1;
  return {geometry:{shape,min,cellWidth:H,fine},fineSolids:{cells:fineCells,shape:fineShape,revision:'fine-A'},
    coarseSolids:{cells:coarseCells,shape,revision:'coarse-A'}};
}
test('effective masks select one owner; shifted unequal XYZ target is not rescaled',async()=>{
  const {createCompositeProducerLayout,gatherCompositeTarget}=await implementation();
  for(const h of [.0625,.25,1]){
    const args=fixture(h),layout=createCompositeProducerLayout(args);
    assert.deepEqual(layout.fineShape,[4,6,2]);
    assert.equal(layout.grid.cells.filter(c=>c.level===1).length,47);
    assert.equal(layout.grid.cells.filter(c=>c.level===0).length,73);
    const target=Float32Array.from({length:48},(_,i)=>(i+1)/128);
    const output=gatherCompositeTarget(layout,target);
    for(let i=0;i<output.length;i++){
      const c=layout.grid.cells[i],q=c.center.map((v,a)=>Math.round((v-args.geometry.fine.min[a])/h-.5));
      assert.equal(output[i],c.level===1?target[index(q,layout.fineShape)]:0);
    }
    assert.equal(layout.grid.domainVolume-layout.grid.cells.reduce((s,c)=>s+c.volume,0),9*h**3);
    const omitted=[args.geometry.fine.min.map((v,a)=>v+([1,2,0][a]+.5)*h),args.geometry.min.map((v,a)=>v+([0,1,1][a]+.5)*2*h)];
    for(const f of layout.grid.faces)for(const p of omitted){
      // No pressure edge may terminate in either omitted solid center.
      if(f.b>=0)assert.notDeepEqual(layout.grid.cells[f.b].center,p);
    }
  }
});
test('partial masks, wrong XYZ and stale solid revisions refuse explicitly',async()=>{
  const {createCompositeProducerLayout,gatherCompositeTarget,assertCompositeSolidRevisions}=await implementation();
  const args=fixture(),layout=createCompositeProducerLayout(args);
  assert.throws(()=>createCompositeProducerLayout({...args,fineSolids:{...args.fineSolids,shape:[4,2,6]}}),/shape/);
  assert.throws(()=>createCompositeProducerLayout({...args,coarseSolids:{...args.coarseSolids,cells:new Uint8Array(79)}}),/coverage/);
  assert.throws(()=>createCompositeProducerLayout({...args,fineSolids:{...args.fineSolids,revision:null}}),/revision/);
  assert.throws(()=>gatherCompositeTarget(layout,new Float32Array(47)),/coverage/);
  const bad=new Float32Array(48);bad[2]=NaN;assert.throws(()=>gatherCompositeTarget(layout,bad),/finite/);
  assert.doesNotThrow(()=>assertCompositeSolidRevisions(layout,{fine:'fine-A',coarse:'coarse-A'}));
  assert.throws(()=>assertCompositeSolidRevisions(layout,{fine:'fine-B',coarse:'coarse-A'}),/rebuild/);
  assert.throws(()=>assertCompositeSolidRevisions(layout),/revision/);
});
