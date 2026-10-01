import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';

const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=source.indexOf('  // Ground plane (subtle reflective floor)');
const end=source.indexOf('  // Fire-light geometry witness set:',start);
function floor(distributed) {
  const context=vm.createContext({THREE,scene:new THREE.Scene(),groundPlane:null,
    fireLightFieldRouteParams:()=>new URLSearchParams(distributed?'volume_light_field_distributed=1':'')});
  vm.runInContext(source.slice(start,end),context);
  return context.groundPlane;
}
const mesh=floor(true),g=mesh.geometry,p=g.attributes.position;
let maxEdge=0;
for(let i=0;i<g.index.count;i+=3)for(let j=0;j<3;j++) {
  const a=new THREE.Vector3().fromBufferAttribute(p,g.index.getX(i+j));
  const b=new THREE.Vector3().fromBufferAttribute(p,g.index.getX(i+(j+1)%3));
  maxEdge=Math.max(maxEdge,a.distanceTo(b));
}
assert.ok(maxEdge<.3,`distributed floor must interpolate locally, not along radius-length fan edges: ${maxEdge}`);
assert.equal(mesh.position.y,-.85);assert.equal(mesh.material.color.getHex(),0x111111);
for(let i=0;i<p.count;i++)assert.ok(Math.hypot(p.getX(i),p.getY(i))<=5.000001);
assert.equal(floor(false).geometry.type,'CircleGeometry','ordinary route retains its floor');
console.log('floor receiver locality contracts passed', {maxEdge,vertices:p.count});
