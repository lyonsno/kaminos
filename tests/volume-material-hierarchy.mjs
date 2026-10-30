// kaminos-test: node
import assert from 'node:assert/strict';
import {MaterialHierarchy, validateAllocation, detailUtility, materialImportance, restrictBrick, prolongBrick, predictDemand} from '../volume-material-hierarchy.mjs';
assert.equal(detailUtility(3,0),3);
assert.ok(detailUtility(3,2)<detailUtility(3,.2));
assert.throws(()=>validateAllocation({budget:-1}),/budget/);
assert.throws(()=>validateAllocation({weights:{reaction:NaN}}),/reaction/);
const h=new MaterialHierarchy({dims:[8,4,4],brick:4,options:{budget:4,maxDetail:3,persistence:0}});
const signals=new Map([['0:0:0:0',{reaction:1,mixing:0,thermal:0,smoke:0}],['0:1:0:0',{reaction:.1,mixing:0,thermal:0,smoke:0}]]);
const a=h.allocate(signals);
assert.ok(a.nodes.length<=h.capacity);assert.ok(a.nodes.some(n=>n.level>0));
assert.equal(new Set(a.nodes.map(n=>n.slot)).size,a.nodes.length);
assert.equal(a.leaves.reduce((sum,n)=>sum+2**(-3*n.level),0),2);
for(const n of a.nodes.filter(n=>n.children))assert.equal(n.children.length,8);
const first=new Map(a.nodes.map(n=>[n.key,n.slot]));
const b=h.allocate(signals);
for(const n of b.nodes)assert.equal(n.slot,first.get(n.key));
const c=h.configure({budget:0});assert.equal(c.leaves.length,2);assert.equal(c.nodes.length,2);
// Spread can favor coverage over a second level at a more important hotspot.
const choose=k=>new MaterialHierarchy({dims:[8,4,4],options:{budget:8,maxDetail:2,spread:k,persistence:0}}).allocate(new Map([['0:0:0:0',{reaction:20}],['0:1:0:0',{reaction:1}]]));
assert.ok(choose(8).nodes.some(n=>n.key==='1:2:0:0'));
assert.ok(choose(0).nodes.some(n=>n.level===2));
// Reallocation preserves all eight material channels, including thermal moments.
const original=Float32Array.from({length:64*8},(_,i)=>((i*37)%101)/31);
const children=prolongBrick(original,4,8);
assert.deepEqual(restrictBrick(children,4,8),original);
const arbitrary=children.map((a,c)=>Float32Array.from(a,(v,i)=>v+c*.01+(i%7)*.005));
const restricted=restrictBrick(arbitrary,4,8);
for(let ch=0;ch<8;ch++){
 const sum=x=>x.reduce((s,v,i)=>s+(i%8===ch?v:0),0);
 assert.ok(Math.abs(sum(restricted)-arbitrary.reduce((s,x)=>s+sum(x),0)/8)<1e-4);
}
assert.equal(materialImportance({reaction:2},{reaction:1,mixing:0,thermal:0,smoke:0}),2);
console.log('material hierarchy policy, coverage, stable slots and conservative transfer pass');

// A fast-moving hotspot asks for cells ahead of its measured support.
const moving=new MaterialHierarchy({dims:[12,4,4],options:{budget:0}}).allocate();
const predicted=predictDemand(moving.nodes,new Map([['0:0:0:0',{reaction:1,motion:[5,0,0]}]]),{dims:[12,4,4],basePitch:1,horizon:1});
assert.ok(predicted.get('0:1:0:0').reaction>0);
assert.ok(predicted.get('0:2:0:0').reaction>0);
// A stationary measured hotspot keeps priority over a partly covered neighbor.
// Otherwise a small budget can refine only its empty guard on the first update.
const startup=predictDemand(moving.nodes,new Map([['0:0:0:0',{reaction:1,motion:[0,0,0]}]]),{dims:[12,4,4],basePitch:1,horizon:0});
assert.ok(startup.get('0:0:0:0').reaction>startup.get('0:1:0:0').reaction,'measured fire must outrank its partial interpolation guard');
assert.ok(startup.get('0:1:0:0').reaction>0,'interpolation guard remains active');
assert.throws(()=>materialImportance({reaction:NaN}),/finite/);
// Partial edge bricks cover the physical grid without overweighting padding.
const partial=new MaterialHierarchy({dims:[7,5,3],options:{budget:2}}).allocate(new Map([['0:1:1:0',{reaction:1}]]));
const covered=partial.leaves.reduce((s,n)=>s+n.c.reduce((v,c,a)=>v*Math.max(0,Math.min(4/2**n.level,[7,5,3][a]-c*4/2**n.level)),1),0);
assert.equal(covered,7*5*3);

// Signed lookahead keeps the swept support and interpolation halo, without
// spending the same guard distance behind a one-way plume.
const directional=new MaterialHierarchy({dims:[20,4,4],options:{budget:0}}).allocate();
const guard=(motionMin,motionMax,horizon=1)=>predictDemand(directional.nodes,new Map([['0:2:0:0',{reaction:1,motionMin,motionMax}]]),{dims:[20,4,4],basePitch:1,horizon});
const forward=guard([5,0,0],[5,0,0]),backward=guard([-5,0,0],[-5,0,0]),opposing=guard([-5,0,0],[5,0,0]);
assert.ok(forward.get('0:4:0:0').reaction>0,'forward motion reaches downstream brick');
assert.equal(forward.get('0:0:0:0').reaction??0,0,'one-way motion does not expand upstream beyond interpolation');
assert.equal(forward.get('0:1:0:0').reaction,.25,'upstream interpolation halo is retained');
for(let x=0;x<5;x++)assert.equal(forward.get(`0:${x}:0:0`).reaction??0,backward.get(`0:${4-x}:0:0`).reaction??0,'signed prediction mirrors');
assert.ok(opposing.get('0:0:0:0').reaction>0&&opposing.get('0:4:0:0').reaction>0,'opposing velocities retain both guards');
const noLookahead=guard([-5,0,0],[5,0,0],0),stationary=guard([0,0,0],[0,0,0],0);
for(const n of directional.nodes)assert.equal(noLookahead.get(n.key).reaction,stationary.get(n.key).reaction,'zero lookahead keeps only the interpolation halo');
// Parent inputs cannot affect policy: the leaf measurements fully determine it.
const parentPlan=new MaterialHierarchy({dims:[8,4,4],options:{budget:8,maxDetail:2}}).allocate(signals),leafSignals=new Map(parentPlan.leaves.map(n=>[n.key,{reaction:n.slot+1}]));
assert.ok(parentPlan.nodes.some(n=>n.children));
const allSignals=new Map([...leafSignals,...parentPlan.nodes.filter(n=>n.children).map(n=>[n.key,{reaction:1e9}])]);
const opts={dims:[8,4,4],basePitch:1,horizon:0};
const fromLeaves=predictDemand(parentPlan.nodes,leafSignals,opts),fromAll=predictDemand(parentPlan.nodes,allSignals,opts);
for(const n of parentPlan.nodes)for(const field of ['reaction','mixing','thermal','smoke'])assert.equal(fromLeaves.get(n.key)[field],fromAll.get(n.key)[field]);
