// kaminos-test: node
import assert from 'node:assert/strict';
import {createNeumipCarrier,NEUMIP_CARRIERS} from '../neumip-carrier.mjs';

const flat=createNeumipCarrier('flat');
assert.equal(flat.attributes.position.count,4,'flat carrier does not need hidden relief tessellation');
assert.deepEqual(Array.from(flat.attributes.uv.array),[0,1,1,1,0,0,1,0]);
for(let i=0;i<4;i++){
 assert.equal(flat.attributes.position.getZ(i),0,'flat reference has zero physical relief');
 assert.equal(flat.attributes.normal.getZ(i),1);
 assert.equal(flat.attributes.tangent.getX(i),1);
 assert.equal(flat.attributes.tangent.getW(i),1);
}
flat.dispose();
for(const kind of ['folded','sphere','sculpted','looped']){
 const g=createNeumipCarrier(kind);
 assert.ok(NEUMIP_CARRIERS.some(([key])=>key===kind),'all supported carriers are discoverable');
 for(const name of ['position','normal','uv','tangent']){
  assert.equal(g.attributes[name].count,g.attributes.position.count,name+' covers all vertices');
  assert.ok(g.attributes[name].array.every(Number.isFinite),name+' has finite coordinates');
 }
 g.computeBoundingBox();
 for(const axis of ['x','y','z'])assert.ok(g.boundingBox.max[axis]-g.boundingBox.min[axis]>.1,'curved carrier has extent on '+axis);
 for(let i=0;i<g.attributes.normal.count;i++){
  const n=g.attributes.normal,t=g.attributes.tangent;
  assert.ok(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-5);
  const length=Math.hypot(t.getX(i),t.getY(i),t.getZ(i));
  const pole=kind==='sphere'&&Math.abs(g.attributes.position.getY(i))>.999999;
  assert.ok(Math.abs(length-1)<1e-5||(pole&&length===0),kind+' tangent '+i);
  assert.ok(Math.abs(n.getX(i)*t.getX(i)+n.getY(i)*t.getY(i)+n.getZ(i)*t.getZ(i))<1e-5);
 }
 g.dispose();
}
// Physical path lengths provide an independent check of average UV density.
{
 const g=createNeumipCarrier('looped'),p=g.attributes.position,uv=g.attributes.uv;
 const n=g.parameters.tubularSegments,m=g.parameters.radialSegments;
 const distance=(a,b)=>Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
 let along=0,around=0;
 for(let i=0;i<n;i++)for(let j=0;j<=m;j++)along+=distance(i*(m+1)+j,(i+1)*(m+1)+j)/(m+1);
 for(let i=0;i<=n;i++)for(let j=0;j<m;j++)around+=distance(i*(m+1)+j,i*(m+1)+j+1)/(n+1);
 const uSpan=uv.getX(n*(m+1))-uv.getX(0),vSpan=uv.getY(m)-uv.getY(0);
 const ratio=along/uSpan/(around/vSpan);
 assert.ok(ratio>.9&&ratio<1.1,'Average longitudinal/circumferential UV density balanced within10%');
 assert.equal(uSpan,Math.round(uSpan),'Closed longitudinal seam keeps integer repeats');
 g.dispose();
}
assert.throws(()=>createNeumipCarrier('missing'),/Unknown neural material carrier/);
console.log('Neural carrier geometry, UV and tangent invariants pass');
