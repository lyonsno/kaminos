// kaminos-test: node
import {test} from 'node:test';import assert from 'node:assert/strict';
import {minimumSurfaceCut} from '../fracture-boundary-search.mjs';
import * as partition from '../fracture-shape-partition.mjs';

// A rectangular plate joined to a larger body by two narrow tabs. A ragged
// distance-sweep proposal crosses the plate; the useful cut crosses the tabs.
function hingedPlate(){
 const positions=[],indices=[],faces=[],ids=new Map();
 const vertex=(x,y)=>{const key=x+':'+y;if(!ids.has(key)){ids.set(key,positions.length/3);positions.push(x,y,0);}return ids.get(key);};
 for(let x=0;x<22;x++)for(let y=0;y<14;y++){
  if(x>=8&&x<12&&y!==3&&y!==10)continue;
  const a=vertex(x,y),b=vertex(x+1,y),c=vertex(x,y+1),d=vertex(x+1,y+1);indices.push(a,b,c,b,d,c);faces.push([x,y],[x,y]);
 }
 return {graph:partition.buildShapeGraph({positions,indices}),faces,positions,indices};
}
test('automatic boundary search can recover a two-tab plate from a ragged proposal',()=>{
 assert.equal(typeof partition.refineAttachmentBoundary,'function','automatic candidates need a boundary search before narrow-cut rejection');
 const {graph,faces}=hingedPlate(),proposal=faces.flatMap(([x,y],f)=>x<7+(y%2)?[f]:[]),result=partition.refineAttachmentBoundary(graph,proposal,{reach:8});
 const chosen=new Set(result.faces);
 assert.ok(faces.every(([x],f)=>x>=8||chosen.has(f)),'retain the whole recognizable plate');
 assert.ok(faces.every(([x],f)=>x<12||!chosen.has(f)),'leave the main body outside');
 assert.ok(result.cutRatio<4,'judge the shortened attachment boundary, not the ragged input');
 assert.ok(result.perimeter<result.originalPerimeter);
 assert.deepEqual(partition.refineAttachmentBoundary(graph,proposal,{reach:8}).faces,result.faces,'repeat independent of history');
});
test('boundary search preserves coincident faces and cannot acquire disconnected surfaces',()=>{
 const fixture=hingedPlate(),n=fixture.positions.length/3,count=fixture.faces.length;
 const graph=partition.buildShapeGraph({positions:[...fixture.positions,100,100,0,101,100,0,100,101,0],indices:[...fixture.indices,...fixture.indices,n,n+1,n+2]});
 const p=fixture.faces.flatMap(([x,y],f)=>x<7+(y%2)?[f,f+count]:[]),r=partition.refineAttachmentBoundary(graph,p,{reach:8}),set=new Set(r.faces);
 assert.ok(r.faces.length>0);assert.equal(set.size,r.faces.length);
 for(let f=0;f<count;f++)assert.equal(set.has(f),set.has(f+count),'coincident faces keep the same owner');
 assert.ok(!set.has(count*2),'nearby or distant disconnected surfaces cannot join a part');
 assert.throws(()=>partition.refineAttachmentBoundary(graph,p,{reach:NaN}),/reach/);
});
test('minimum cut agrees with exhaustive partitions, including parallel and fractional edges',()=>{
 for(let seed=1;seed<=40;seed++){let s=seed;const random=()=>((s=Math.imul(s,1664525)+1013904223>>>0)/2**32),n=7,edges=[];
  for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)if(random()<.5){edges.push([a,b,(Math.floor(random()*9)+1)/8]);if(random()<.2)edges.push([a,b,.125]);}
  let expected=Infinity;
  for(let bits=0;bits<1<<n;bits++){if(!(bits&1)||(bits&(1<<1)))continue;expected=Math.min(expected,edges.reduce((sum,[a,b,w])=>sum+(((bits>>a)&1)!==((bits>>b)&1)?w:0),0));}
  const result=minimumSurfaceCut(n,edges);assert.equal(result.flow,expected);assert.equal(result.inside[0],1);assert.equal(result.inside[1],0);
  assert.equal(edges.reduce((sum,[a,b,w])=>sum+(result.inside[a]!==result.inside[b]?w:0),0),expected);
 }
});
