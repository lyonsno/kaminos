// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createReferenceBottle} from '../glass-reference-bottle.mjs';
test('reference bottle has a closed shell including inner wall, lip and bottom',()=>{
 const c=createReferenceBottle(),g=c.root.geometry,p=g.getAttribute('position'),edges=new Map(),ix=g.index.array;
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
 for(let i=0;i<ix.length;i+=3){const a=[key(ix[i]),key(ix[i+1]),key(ix[i+2])];if(new Set(a).size<3)continue;
  for(let j=0;j<3;j++){const u=a[j],v=a[(j+1)%3],k=[u,v].sort().join('/'),e=edges.get(k)??[0,0];e[0]++;e[1]+=u<v?1:-1;edges.set(k,e);}
 }
 assert.ok(edges.size>100);for(const [edge,[count,winding]] of edges){assert.equal(count,2,edge);assert.equal(winding,0,edge);}
 assert.equal(c.read().wallAtBody,.02);c.set({ior:1.6,thickness:.03});assert.equal(c.root.material.ior,1.6);assert.equal(c.read().thickness,.03);c.dispose();
});
