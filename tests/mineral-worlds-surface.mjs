// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,checkpoint,advance} from '../mineral-worlds/state.mjs';
import {createSurface} from '../mineral-worlds/surface.mjs';

test('evolved surface patches meet without internal open edges or overlaps',()=>{
 const s=createWorld({size:8});advance(s,12);
 const surface=createSurface(s,{samples:8,extent:4});
 try{
  const geometry=surface.root.children[0].geometry,p=geometry.attributes.position.array,idx=geometry.index.array;
  const vertices=new Map(),ids=[],edges=new Map();
  for(let i=0;i<p.length;i+=3){const key=[p[i],p[i+1],p[i+2]].join(',');if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key));}
  for(let i=0;i<idx.length;i+=3)for(let k=0;k<3;k++){
   const a=ids[idx[i+k]],b=ids[idx[i+(k+1)%3]],key=a<b?a+','+b:b+','+a;
   edges.set(key,(edges.get(key)??0)+1);
  }
  assert.equal([...edges.values()].filter(n=>n===1).length,4*8,'only the outer perimeter may have open triangle edges');
  assert.ok([...edges.values()].every(n=>n===1||n===2),'no overlapping triangle ownership');
 }finally{surface.dispose();}
});
test('close mineral detail has geometric relief and rendering preserves material state',()=>{
 const s=createWorld({kind:'salt',size:8});s.bed.fill(0);const before=checkpoint(s),surface=createSurface(s,{samples:32,extent:1});
 try{const p=surface.root.children[0].geometry.attributes.position.array,heights=[];for(let i=1;i<p.length;i+=3)heights.push(p[i]);assert.ok(Math.max(...heights)-Math.min(...heights)>.001);assert.deepEqual(checkpoint(s),before);surface.update(s);assert.equal(surface.read().uploads,1);}finally{surface.dispose();}
});
