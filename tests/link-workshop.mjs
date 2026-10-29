// kaminos-test: node
import assert from 'node:assert/strict';
import {emptyMechanism,appendJoint,evaluate,moveJoint,connectPiston,checkedMechanism} from '../experiments/link-workshop/model.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
let m=emptyMechanism();
m=appendJoint(m,null,[0,0]);m=appendJoint(m,0,[2,0]);m=appendJoint(m,1,[2,3]);m=appendJoint(m,1,[4,0]);
assert.equal(m.nodes.length,4);near(m.nodes[1].length,2);near(m.nodes[2].length,3);
m=moveJoint(m,1,[0,2],'B');
let p=evaluate(m,1);near(p[1][0],0);near(p[1][1],2);near(p[2][0],-3);near(p[2][1],2);near(p[3][0],0);near(p[3][1],4);
for(const t of [0,.13,.5,.89,1]){p=evaluate(m,t);for(let i=1;i<m.nodes.length;i++){const n=m.nodes[i],a=p[n.parent],b=p[i];near(Math.hypot(b[0]-a[0],b[1]-a[1]),n.length);}}
m=moveJoint(m,2,[2,5],'build');near(m.nodes[2].length,5);
m=connectPiston(m,0,2);assert.deepEqual(m.pistons,[{a:0,b:2}]);
assert.throws(()=>connectPiston(m,0,0),/distinct/);assert.throws(()=>connectPiston(m,0,2),/already/);
assert.throws(()=>appendJoint(m,1,[2,0]),/length/);
assert.throws(()=>checkedMechanism({...m,nodes:[{parent:0,length:1,angles:[0,0]}]}),/parent/);
assert.throws(()=>checkedMechanism({...m,period:0}),/period/);
assert.deepEqual(checkedMechanism(JSON.parse(JSON.stringify(m))),m);
let chain=emptyMechanism();chain=appendJoint(chain,null,[-4,1]);for(let i=1;i<=12;i++)chain=appendJoint(chain,i-1,[i-4,1+i*.25]);assert.equal(evaluate(chain,.5).length,13);
console.log('links: branched construction, rigid pose propagation, length edits, piston identities, rejection and round trip passed');
