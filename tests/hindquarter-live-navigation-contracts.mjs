// kaminos-test: node
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute,Mesh,MeshBasicMaterial} from '../lib/three.core.js';
import {prepareNavigationGeometry} from '../scene-navigation.mjs';
const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));geometry.setIndex([0,1,2]);
const mesh=new Mesh(geometry,new MeshBasicMaterial());mesh.userData.kaminosDynamicGeometry=true;
await prepareNavigationGeometry(mesh);
assert.equal(geometry.boundsTree,undefined,'live deformation must not acquire a stale static navigation index');
console.log('Live deformation remains on current-geometry raycasting');
