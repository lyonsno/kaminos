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
