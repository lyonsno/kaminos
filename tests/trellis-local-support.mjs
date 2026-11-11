// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractLocalSupport,materializeFragments,supportMesh,supportFrame,chartPoint,prepareSupportVolume,supportVolumeMesh} from '../trellis-local-support.mjs';
import {fitLocalSupport,clipSupportVolume} from '../trellis-support-gpu.mjs';
import {withKaminosGpu} from '../tools/shader-herder.mjs';

function grid(){
  const positions=[],uvs=[],indices=[];const n=8;
  for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){const u=x/n*4-2,v=y/n*4-2;positions.push(u,v,.2+.5*Math.exp(-((u-.5)**2+v*v)/.15));uvs.push(x/n,y/n);}
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=y*(n+1)+x,b=a+1,c=a+n+1,d=c+1;indices.push(a,b,c,b,d,c);}
  return {positions:Float32Array.from(positions),uvs:Float32Array.from(uvs),indices:Uint32Array.from(indices)};
}
const recipe={origin:[0,0,0],normal:[0,0,1],tangent:[1,0,0],radius:1,depth:1};
test('source split preserves surface area, triangle address and UV interpolation',()=>{
  const source=grid(),c=extractLocalSupport(source,recipe),part=materializeFragments(source,c.patch,c.frame);
  assert.ok(c.patch.length);assert.equal(c.diagnostics.projectedArea,4);assert.equal(c.diagnostics.neighborhoodIsolation,'unverified');
  for(let i=0;i<part.sourceTriangle.length;i++){
    const t=part.sourceTriangle[i],b=part.barycentrics.subarray(i*3,i*3+3);assert.ok(Math.abs(b.reduce((a,x)=>a+x,0)-1)<1e-6);
    for(let k=0;k<3;k++){const v=b.reduce((sum,w,j)=>sum+w*source.positions[source.indices[t*3+j]*3+k],0);assert.ok(Math.abs(v-part.positions[i*3+k])<1e-6);}
    for(let k=0;k<2;k++)assert.ok(Math.abs(b.reduce((s,w,j)=>s+w*source.uvs[source.indices[t*3+j]*2+k],0)-part.uvs[i*2+k])<1e-6);
  }
  const area=ts=>ts.reduce((s,t)=>{const[a,b,c]=t.vertices.map(v=>v.p);return s+((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;},0);
  assert.equal(area(c.patch)+area(c.retained)+c.untouched.length*.125,16);
});
test('closed support clips all sheets on native WebGPU and preserves source interpolation',async()=>{
  const s=grid();const reversed=Uint32Array.from([...s.indices,...s.indices].map((x,i,a)=>i<s.indices.length?x:a[i-i%3+2-i%3]));
  const source={...s,indices:reversed},candidate=prepareSupportVolume(source,{...recipe,top:1});
  await withKaminosGpu(async({device})=>{
    const result=await clipSupportVolume(device,candidate);assert.equal(result.backend,'WebGPU');assert.ok(result.patch.length>0);
    let area=0;for(const t of result.patch){const[a,b,c]=t.vertices.map(v=>v.p);area+=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
      for(const v of t.vertices){for(let k=0;k<3;k++)assert.ok(v.p[k]>=candidate.lo[k]-1e-6&&v.p[k]<=candidate.hi[k]+1e-6);assert.ok(Math.abs(v.b.reduce((s,x)=>s+x,0)-1)<1e-6);}}
    assert.ok(Math.abs(area-8)<1e-6,'both coincident sheets must survive');
    const part=materializeFragments(source,result.patch,candidate.frame);assert.ok(part.uvs.every(Number.isFinite));
    const mesh=supportVolumeMesh(candidate);assert.equal(mesh.positions.length/9,12);assert.equal(new Set(mesh.supportFace).size,6);
    await assert.rejects(clipSupportVolume(device,{...candidate,candidates:[]}),/nonempty/);
  });
});
test('WebGPU clipping against depth and lateral planes conserves the slanted source surface',async()=>{
  const source={positions:Float32Array.from([-2,-2,-2,2,-2,2,0,2,0]),indices:Uint32Array.from([0,1,2]),uvs:Float32Array.from([0,0,1,0,.5,1])};
  const c=prepareSupportVolume(source,{...recipe,depth:.5,top:.5});
  const area=ts=>ts.reduce((sum,t)=>{const[a,b,c]=t.vertices.map(v=>v.p),u=b.map((x,i)=>x-a[i]),v=c.map((x,i)=>x-a[i]);return sum+Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])/2;},0);
  await withKaminosGpu(async({device})=>{
    const result=await clipSupportVolume(device,c);assert.ok(result.patch.length>1);
    assert.ok(Math.abs(area(result.patch)+area(c.retained)-Math.sqrt(512)/2)<1e-5);
    for(const t of result.patch)for(const v of t.vertices){for(let k=0;k<3;k++){
      assert.ok(v.p[k]>=c.lo[k]-1e-6&&v.p[k]<=c.hi[k]+1e-6);
      assert.ok(Math.abs(v.b.reduce((sum,w,j)=>sum+w*source.positions[j*3+k],0)-v.p[k])<1e-6);
    }}
    assert.equal(result.sourceTriangleIds[0],0);
  });
});
test('missing square coverage and duplicate layers fail instead of masquerading as a support',()=>{
  const s=grid();assert.throws(()=>extractLocalSupport({...s,indices:s.indices.slice(3)}, {...recipe,radius:3}),/cover|rim|surface/);
  assert.throws(()=>extractLocalSupport({...s,indices:Uint32Array.from([...s.indices,...s.indices])},recipe),/nonmanifold|rim|coverage/);
  assert.throws(()=>supportFrame({...recipe,radius:0}),/positive/);
});
test('WebGPU roof fit encloses an off-center peak, not only its central sample',async()=>{
  const source=grid(),c=extractLocalSupport(source,recipe);
  await withKaminosGpu(async({device})=>{
    const fit=await fitLocalSupport(device,c);assert.equal(fit.backend,'WebGPU');
    // At x=.5,y=0, the tent gives half its center height plus half rim height.
    assert.ok(fit.centerHeight>1.10,`off-center peak requires raised center; got ${fit.centerHeight}`);
    const mesh=supportMesh(c,fit.centerHeight);assert.equal(mesh.positions.length/9,c.rim.length);
    assert.ok(fit.intersectionCorners>c.patch.length*3);
    assert.ok(mesh.positions.every(Number.isFinite));
    assert.deepEqual(chartPoint([0,0,0],c.frame),[0,0,0]);
  });
});
