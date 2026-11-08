// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {fitSurfaceFootprints} from '../surface-splat-footprints.mjs';
const row=(x,y,n=[0,0,1])=>[x,y,0,...n,1,.5,0,0,.3,1];
test('source support fits tangent ellipses without shifting the retained surface centre',()=>{
 const src=new Float32Array([...row(-.03,0),...row(.03,0),...row(0,-.002),...row(0,.002)]),r=new Float32Array(row(0,0));
 const f=fitSurfaceFootprints(src,r,new Uint32Array(4),.002);
 assert.equal(f.length,8);assert.ok(f[3]>f[7]*3,'elongated source support needs an elongated ellipse');
 assert.ok(Math.abs(f[0])>.99);assert.ok(Math.abs(f[6])<1e-6,'tangent axes remain perpendicular to normal');
 assert.deepEqual([...r],row(0,0).map(Math.fround));
 assert.throws(()=>fitSurfaceFootprints(src,r,new Uint32Array([0,0,0,1]),.002));
});

const grid=(xs,ys)=>{
 const data=new Float32Array(ys.flatMap(y=>xs.flatMap(x=>row(x,y)))),triangles=[];
 for(let y=0;y<ys.length-1;y++)for(let x=0;x<xs.length-1;x++){
  const a=y*xs.length+x,b=a+1,c=a+xs.length,d=c+1;triangles.push(a,b,d,a,d,c);
 }
 return {data,triangles:new Uint32Array(triangles),parent:Uint32Array.from({length:data.length/12},(_,i)=>i)};
};
function covers(f,data,x,y){
 for(let i=0;i<data.length/12;i++){
  const k=i*8,dx=x-data[i*12],dy=y-data[i*12+1];
  if(((dx*f[k]+dy*f[k+1])/(3*f[k+3]))**2+((dx*f[k+4]+dy*f[k+5])/(3*f[k+7]))**2<=1.00001)return true;
 }
 return false;
}
test('triangle support gives singleton blade samples a narrow footprint without changing rows',()=>{
 const {data,triangles,parent}=grid([-.04,0,.04],[-.001,.001]),before=data.slice();
 const f=fitSurfaceFootprints(data,data,parent,.01,triangles),k=8;
 assert.ok(Math.abs(f[k])>.99,'long axis follows the blade');
 assert.ok(f[k+3]>f[k+7]*8,'a singleton must retain surface anisotropy');
 assert.ok(3*f[k+7]<.003,'support width must follow the blade, not the voxel-radius floor');
 for(let x=-.039;x<.04;x+=.0013)for(let y=-.0009;y<.001;y+=.0003)assert.ok(covers(f,data,x,y),'blade must remain connected');
 assert.deepEqual(data,before);assert.equal(f.length,parent.length*8);
});
test('locally fitted support covers an irregularly sampled planar surface',()=>{
 const {data,triangles,parent}=grid([-.04,-.01,.006,.04],[-.03,-.008,.01,.03]);
 const f=fitSurfaceFootprints(data,data,parent,.01,triangles);
 for(let x=-.039;x<.04;x+=.0017)for(let y=-.029;y<.03;y+=.0013)assert.ok(covers(f,data,x,y),`hole at ${x},${y}`);
 assert.ok([...f].every(Number.isFinite));
});
test('triangle adjacency does not borrow support from a nearby disconnected surface',()=>{
 const a=grid([-.04,0,.04],[-.001,.001]),b=grid([-.04,0,.04],[.002,.04]);
 const combined=new Float32Array([...a.data,...b.data]),parent=Uint32Array.from({length:combined.length/12},(_,i)=>i);
 const triangles=new Uint32Array([...a.triangles,...b.triangles.map(i=>i+a.parent.length)]);
 assert.deepEqual(fitSurfaceFootprints(combined,combined,parent,.01,triangles).slice(0,a.parent.length*8),fitSurfaceFootprints(a.data,a.data,a.parent,.01,a.triangles));
 assert.throws(()=>fitSurfaceFootprints(a.data,a.data,a.parent,.01,new Uint32Array([0,1,99])),/triangle/i);
});

test('boundary-only triangle fitting leaves interior support bit-for-bit unchanged',()=>{
 const {data,triangles,parent}=grid([-.04,0,.04],[-.04,0,.04]),before=data.slice();
 const baseline=fitSurfaceFootprints(data,data,parent,.01);
 const fitted=fitSurfaceFootprints(data,data,parent,.01,triangles,{boundaryOnly:true});
 assert.deepEqual(fitted.slice(4*8,5*8),baseline.slice(4*8,5*8),'the interior group must keep its original coverage');
 assert.notDeepEqual(fitted.slice(0,8),baseline.slice(0,8),'a boundary group must use its incident triangle support');
 assert.deepEqual(data,before,'fitting must preserve source positions and material channels');
});
test('closed triangle surfaces and isolated samples retain their original footprints',()=>{
 const data=new Float32Array([row(0,0),row(.03,0),row(0,.03),[0,0,.03,0,0,1,1,.5,0,0,.3,1],row(.2,.2)].flat());
 const parent=new Uint32Array([0,1,2,3,4]),triangles=new Uint32Array([0,2,1,0,1,3,1,2,3,2,0,3]);
 assert.deepEqual(fitSurfaceFootprints(data,data,parent,.01,triangles,{boundaryOnly:true}),fitSurfaceFootprints(data,data,parent,.01));
});
test('boundary fitting follows source connectivity rather than proximity to another sheet',()=>{
 const a=grid([-.04,0,.04],[-.001,.001]),b=grid([-.04,0,.04],[.002,.04]);
 const data=new Float32Array([...a.data,...b.data]),parent=Uint32Array.from({length:data.length/12},(_,i)=>i);
 const triangles=new Uint32Array([...a.triangles,...b.triangles.map(i=>i+a.parent.length)]);
 assert.deepEqual(fitSurfaceFootprints(data,data,parent,.01,triangles,{boundaryOnly:true}).slice(0,a.parent.length*8),fitSurfaceFootprints(a.data,a.data,a.parent,.01,a.triangles,{boundaryOnly:true}));
});
test('shared boundary mask excludes unrelated open edges from the refit',()=>{
 const {data,triangles,parent}=grid([-.04,0,.04],[-.04,0,.04]);
 const baseline=fitSurfaceFootprints(data,data,parent,.01),boundaryVertices=new Uint8Array([1,1,1,0,0,0,0,0,0]);
 const fitted=fitSurfaceFootprints(data,data,parent,.01,triangles,{boundaryOnly:true,boundaryVertices});
 assert.notDeepEqual(fitted.slice(8,16),baseline.slice(8,16),'shared edge must be refitted');
 assert.deepEqual(fitted.slice(3*8),baseline.slice(3*8),'unrelated open edges and interior must retain coverage');
 assert.throws(()=>fitSurfaceFootprints(data,data,parent,.01,triangles,{boundaryOnly:true,boundaryVertices:new Uint8Array(2)}),/boundary/i);
});
