// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createPatchPlaneGeometry,rawBundleSiblingUrl} from '../trellis-patch-comparison.mjs';
import {supportFrame} from '../trellis-local-support.mjs';
test('patch carrier faces the trained hemisphere while preserving its physical UV axes',()=>{
 const region={origin:[.12,.095,.48],normal:[0,1,1],tangent:[1,0,0],radius:.04,depth:.05},f=supportFrame(region),g=createPatchPlaneGeometry(region,.04,.01),p=g.attributes.position;
 try{for(let i=0;i<p.count;i+=3){const a=[p.getX(i),p.getY(i),p.getZ(i)],u=[p.getX(i+1)-a[0],p.getY(i+1)-a[1],p.getZ(i+1)-a[2]],v=[p.getX(i+2)-a[0],p.getY(i+2)-a[1],p.getZ(i+2)-a[2]],cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];assert.ok(cross.reduce((s,x,k)=>s+x*f.n[k],0)>0,'winding must face the same hemisphere as the supplied normal and training rays');}
 assert.equal(g.attributes.tangent.itemSize,4);for(let i=0;i<p.count;i++)assert.equal(g.attributes.tangent.getW(i),-1,'UV V follows -frame.v, so its tangent basis has negative handedness');
 }finally{g.dispose();}
});

test('raw source bundle siblings preserve the asset read route',()=>{
 const input='http://127.0.0.1:8799/api/read?root=image-inbox&path=trellis-patch-comparison%2Fraw-panel%2Freport.json';
 const out=new URL(rawBundleSiblingUrl(input,'surfels.f32'));
 assert.equal(out.pathname,'/api/read');assert.equal(out.searchParams.get('root'),'image-inbox');assert.equal(out.searchParams.get('path'),'trellis-patch-comparison/raw-panel/surfels.f32');
 assert.equal(rawBundleSiblingUrl('http://localhost/assets/report.json','triangles.u32'),'http://localhost/assets/triangles.u32');
 assert.throws(()=>rawBundleSiblingUrl(input,'../outside'),/Invalid raw bundle sibling/);
});
