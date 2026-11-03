// kaminos-test: node
import assert from 'node:assert/strict';
import {createSectionWinding} from '../section-winding-field.mjs';
const square=[[[0,0],[1,0]],[[1,0],[1,1]],[[1,1],[0,1]],[[0,1],[0,0]]];
const direct=(edges,x,y)=>edges.reduce((sum,[a,b])=>{const ax=a[0]-x,ay=a[1]-y,bx=b[0]-x,by=b[1]-y;return sum+Math.atan2(ax*by-ay*bx,ax*bx+ay*by);},0)/(2*Math.PI);
const fixtures=[square,square.map(([a,b])=>[b,a]),square.slice(0,3),[...square,...square],square.concat([[[.2,.2],[.8,.2]],[[.8,.2],[.5,.6]]]),[[[-2,0],[2,0]]],[[[0,0],[0,0]]]];
for(const edges of fixtures){const field=createSectionWinding(edges);for(let j=-4;j<=12;j++)for(let i=-4;i<=12;i++){const x=i/8,y=j/8;assert.ok(Math.abs(field(x,y)-direct(edges,x,y))<1e-12,JSON.stringify({edges,x,y,got:field(x,y),expected:direct(edges,x,y)}));}}
let state=7;const random=()=>((state=Math.imul(state,1664525)+1013904223>>>0)/2**32)*4-2;
for(let trial=0;trial<30;trial++){const points=Array.from({length:20},()=>[random(),random()]),edges=points.map((p,i)=>[p,points[(i+1)%points.length]]);if(trial%2)edges.pop();const field=createSectionWinding(edges);for(let i=0;i<100;i++){const x=random(),y=random();assert.ok(Math.abs(field(x,y)-direct(edges,x,y))<1e-12);}}
console.log('Winding agrees for open, closed, reversed, overlapping and boundary samples');
