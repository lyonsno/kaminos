// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {stoneHandoffQuads} from '../stone-handoff-geometry.mjs';
import {stoneTransitionDefaults} from '../stone-transition-source.mjs';
test('handoff geometry rejects an invalid material metric',()=>{
 assert.throws(()=>stoneHandoffQuads({...stoneTransitionDefaults,width:0}),/positive dimensions/);
 assert.throws(()=>stoneHandoffQuads(stoneTransitionDefaults,{collar:-.01}),/Nonnegative/);
});
test('neural support covers joints and leaves centers to native PBR',()=>{
 const narrow=stoneHandoffQuads(stoneTransitionDefaults,{collar:0});
 const wide=stoneHandoffQuads(stoneTransitionDefaults,{collar:.04});
 const contains=(p,quads)=>quads.some(([a,b,c,d])=>p[0]>a&&p[0]<c&&p[1]>b&&p[1]<d);
 assert.equal(contains([.25,.25],wide.quads),false);assert.equal(contains([.5001,.25],wide.quads),true);
 assert.ok(wide.areaFraction>narrow.areaFraction);assert.ok(wide.areaFraction<.5);
 for(const [a,b,c,d]of wide.quads)assert.ok(a>=0&&b>=0&&c<=1&&d<=1&&a<c&&b<d);
 for(let i=0;i<wide.quads.length;i++)for(let j=i+1;j<wide.quads.length;j++){
  const a=wide.quads[i],b=wide.quads[j];assert.ok(Math.min(a[2],b[2])<=Math.max(a[0],b[0])||Math.min(a[3],b[3])<=Math.max(a[1],b[1]));
 }
 assert.equal(stoneHandoffQuads(stoneTransitionDefaults,{collar:2}).areaFraction,1);
});
test('actual carrier geometry supplies a finite tangent frame for the neural lookup',async()=>{
 const experiment=(await import('../experiments/stone-handoff.experiment.mjs')).default;
 let attached;const session={redraw(){},setView(){},attach:async root=>{attached=root;return {id:'fixture-registration'};},dispose:async()=>{}};
 const instance=await experiment.create({host:{scene:{open:async()=>session}},inputs:{mode:'pbr',source:{cells:4}},record(){},updateInputs(){}});
 try{
  const g=attached.getObjectByName('Flat PBR endpoint').geometry;
  assert.ok(g.getAttribute('tangent'),'carrier tangent attribute missing');
  assert.ok([...g.getAttribute('tangent').array].every(Number.isFinite));
  assert.equal(g.getAttribute('normal').getY(0),1);assert.equal(g.getAttribute('tangent').getW(0),-1);
 }finally{await instance.dispose();}
});
