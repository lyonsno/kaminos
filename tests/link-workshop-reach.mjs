// kaminos-test: node
import assert from 'node:assert/strict';
import {appendJoint,emptyMechanism,evaluate,moveJoint,frames} from '../experiments/link-workshop/model.mjs';
const reach=(m,id,p,mode='A')=>moveJoint(m,id,p,mode,{reach:true});
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);
const pointNear=(a,b,tol=1e-9)=>a.forEach((x,i)=>near(x,b[i],tol));
let m=appendJoint(appendJoint(appendJoint(emptyMechanism(),null,[0,0]),0,[1,0]),1,[2,0]);
m=appendJoint(m,1,[1,2]);m=appendJoint(m,null,[-3,-2]);
m.nodes[1].angles[1]=.2;m.nodes[2].angles[1]=-.3;
const before=structuredClone(m),target=[0,1.5],posed=reach(m,2,target);
pointNear(evaluate(posed,0)[2],target);assert.deepEqual(m,before,'Reach is a pure edit');
assert.deepEqual(posed.nodes.map(n=>n.length),m.nodes.map(n=>n.length),'All authored rigid lengths stay exact');
assert.deepEqual(posed.nodes.map(n=>n.angles?.[1]),m.nodes.map(n=>n.angles?.[1]),'The other pose stays exact');
assert.deepEqual(posed.nodes[3],m.nodes[3],'An off-path branch keeps its authored local angles');assert.deepEqual(posed.nodes[4],m.nodes[4]);
assert.notEqual(posed.nodes[1].angles[0],m.nodes[1].angles[0],'Reaching a distal joint uses its ancestors');
for(const mode of ['A','B','build']){
 const n=reach(m,2,[1,.8],mode);pointNear(evaluate(n,mode==='B'?1:0)[2],[1,.8]);
 assert.deepEqual(n.nodes.map(x=>x.length),m.nodes.map(x=>x.length));
 if(mode!=='build')assert.deepEqual(n.nodes.map(x=>x.angles?.[mode==='B'?0:1]),m.nodes.map(x=>x.angles?.[mode==='B'?0:1]));
 if(mode==='build')for(let i=1;i<=2;i++)near(n.nodes[i].angles[1]-n.nodes[i].angles[0],m.nodes[i].angles[1]-m.nodes[i].angles[0]);
}
for(const p of [[0,0],[1,0],[2,0],[0,9],[-8,0]]){
 const n=reach(m,2,p),actual=evaluate(n,0)[2],d=Math.hypot(...p),wanted=d>2?p.map(x=>x*2/d):p;pointNear(actual,wanted);assert.deepEqual(n.nodes[0],m.nodes[0]);
}
let unequal=appendJoint(appendJoint(appendJoint(emptyMechanism(),null,[2,-1]),0,[5,-1]),1,[6,-1]);
pointNear(evaluate(reach(unequal,2,[2,-1]),0)[2],[4,-1]);
pointNear(evaluate(reach(unequal,2,[2,-.5]),0)[2],[2,1]);
// A reproducible family of chains and feasible targets exercises straight,
// branched, uneven and folded inputs without an iterative-solver oracle.
let state=2166136261;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32);
for(let count=1;count<=20;count++)for(let trial=0;trial<8;trial++){
 let chain=appendJoint(emptyMechanism(),null,[-2,3]);
 for(let i=1;i<=count;i++){const prev=evaluate(chain)[i-1],angle=(random()-.5)*6,len=.1+random()*2;chain=appendJoint(chain,i-1,[prev[0]+Math.cos(angle)*len,prev[1]+Math.sin(angle)*len]);}
 const desired=structuredClone(chain);for(const n of desired.nodes)if(n.parent!==null)n.angles=[(random()-.5)*6,n.angles[1]];
 const p=evaluate(desired,0)[count],result=reach(chain,count,p);pointNear(evaluate(result,0)[count],p,1e-8);
 assert.deepEqual(result.nodes.map(n=>n.length),chain.nodes.map(n=>n.length));assert.deepEqual(result.nodes[0],chain.nodes[0]);
 for(const n of result.nodes)if(n.parent!==null)assert.ok(n.angles.every(Number.isFinite));
}
assert.deepEqual(reach(m,2,evaluate(m,0)[2]),m,'An unchanged target preserves the exact recipe');
assert.throws(()=>reach(m,0,[1,1]),/Anchor is fixed/);
assert.deepEqual(reach(m,0,[1,1],'build').nodes[0].point,[1,1]);
assert.throws(()=>reach(m,2,[NaN,0]),/finite/);
// Preserve the explicit pre-existing construction API: callers choosing a
// length edit still get one; only native Move/new reach choose the chain solve.
const construction=moveJoint(m,2,[4,0],'build');near(construction.nodes[2].length,3);
console.log('Finite planar reach preserves lengths, poses, branches, anchor and nearest reachable endpoint');
