// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {styleHelperLines} from '../scene-helper-lines.mjs';

// Exercise the actual host draw callback against the editor's actual wide-line
// carrier. Replacing its specialized vertex shader draws an unrelated solid
// triangle, so it must never become an opaque scene-depth contributor.
const source=readFileSync(new URL('../local-liquid-host.mjs',import.meta.url),'utf8');
const start=source.indexOf('      renderer.setRenderObjectFunction((...args)=>{');
const end=source.indexOf('      renderer.setClearColor',start);
assert.ok(start>=0&&end>start);
const draws=[],depthMaterial={side:THREE.DoubleSide};let draw;
const renderer={setRenderObjectFunction(fn){draw=fn;},renderObject(...args){draws.push({object:args[0],side:depthMaterial.side});}};
runInNewContext(source.slice(start,end),{renderer,depthMaterial});
const depth=(object,material=object.material)=>draw(object,{}, {},object.geometry,material);
const guide=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-1,-1,-1),new THREE.Vector3(1,3,1)));
guide.userData.kaminosEditorHelper=true;
styleHelperLines(guide,{width:2,opacity:.82});
const carrier=guide.userData.kaminosWideLine;
assert.equal(carrier.geometry.type,'LineSegmentsGeometry');
depth(carrier);
assert.equal(draws.length,0,'editor wide-line triangle carrier must not cut water or flame');
const helperParent=new THREE.Group();helperParent.userData.kaminosEditorHelper=true;
const marker=new THREE.Mesh(new THREE.SphereGeometry(.045),new THREE.MeshBasicMaterial());helperParent.add(marker);
depth(marker);assert.equal(draws.length,0,'helper ownership applies through ancestors');
const presentation=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({depthWrite:false}));
depth(presentation);assert.equal(draws.length,0,'non-depth-writing presentation must not turn opaque under override');
const body=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({side:THREE.BackSide}));
depth(body);assert.equal(draws.length,1,'ordinary solid scene geometry still occludes');
assert.equal(draws[0].object,body);assert.equal(draws[0].side,THREE.BackSide);
const solidPart=new THREE.MeshBasicMaterial({side:THREE.FrontSide});
depth(presentation,solidPart);assert.equal(draws.length,2,'use the actual material group supplied by the renderer');
console.log('local liquid opaque depth excludes editor presentation and retains solid geometry');
