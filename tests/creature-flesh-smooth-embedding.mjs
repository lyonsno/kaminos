// kaminos-test: node
import assert from 'node:assert/strict';
import {prepareSmoothFleshEmbedding} from '../experiments/creature-flesh/embedding.mjs';
import {addFleshOffsets} from '../experiments/creature-flesh/torso.mjs';
const size=5,id=(i,j,k)=>(k*size+j)*size+i,positions=[];
for(let k=0;k<size;k++)for(let j=0;j<size;j++)for(let i=0;i<size;i++)positions.push([i,j,k]);
function prepared(point,strength=1){
 const q=point.map(v=>Math.min(size-2,Math.floor(v))),f=point.map((v,a)=>v-q[a]),order=[0,1,2].sort((a,b)=>f[b]-f[a]),ids=[id(...q)];for(const a of order){q[a]++;ids.push(id(...q));}
 const s=order.map(a=>f[a]);return {positions,bindings:ids,bindingWeights:[1-s[0],s[0]-s[1],s[1]-s[2],s[2]].map(w=>w*strength),construction:{crossSection:size,sections:size},source:{vertices:1}};
}
const field=fn=>positions.map(fn),sample=(p,fn,strength=1)=>addFleshOffsets(new Float32Array(3),prepareSmoothFleshEmbedding(prepared(p,strength)),field(fn));
const close=(actual,expected,tol=1e-6)=>assert.ok(Math.abs(actual-expected)<tol,`${actual} differs from ${expected}`);
// Linear tetrahedral transfer gives1.75 here; cubic transfer gives1.5625.
close(sample([1.25,2,2],p=>[p[0]**2,0,0])[0],1.5625);
for(const p of [[1.25,1.4,2.2],[0,0,0],[4,4,4],[2,1,3]]){
 const q=p,result=sample(q,x=>[x[0]+2*x[1],3-x[2],.5*x[0]-x[1]+x[2]],.4);
 [q[0]+2*q[1],3-q[2],.5*q[0]-q[1]+q[2]].forEach((v,a)=>close(result[a],v*.4));
}
const h=.001,fn=p=>[Math.sin(p[0]),0,0],left=(sample([2,2,2],fn)[0]-sample([2-h,2,2],fn)[0])/h,right=(sample([2+h,2,2],fn)[0]-sample([2,2,2],fn)[0])/h;
close(left,right,.004);
const empty=prepareSmoothFleshEmbedding(prepared([1.25,2,2],0));assert.deepEqual(Array.from(addFleshOffsets(new Float32Array([3,4,5]),empty,field(()=>[8,9,10]))),[3,4,5]);
console.log('Smooth field reproduces affine displacement, keeps strength, and has continuous cell slope');
