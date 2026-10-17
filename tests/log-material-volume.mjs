// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLogSurfaceMask} from '../live-log-surface-mask.mjs';
const geometry=new THREE.BoxGeometry(1,1,1);geometry.computeBoundingBox();
const surface=createLogSurfaceMask(geometry,geometry.boundingBox,8);
const volume=createLogSurfaceMask(geometry,geometry.boundingBox,8,{filled:true});
assert.equal(surface[4+8*(4+8*4)],0,'Existing surface fixture must distinguish the interior');
assert.equal(volume[4+8*(4+8*4)],1,'Consumable wood must include its enclosed interior');
assert.equal(volume.samples[(4+8*(4+8*4))*8+3],2,'Interior samples carry a distinct initial face class');
assert.equal(volume.surface[4+8*(4+8*4)],0);
assert.equal(volume.reduce((a,b)=>a+b,0),512);
const open=new THREE.PlaneGeometry(1,1);open.rotateY(.2);open.computeBoundingBox();
const lo=open.boundingBox.clone();lo.min.z-=.1;lo.max.z+=.1;
const sheet=createLogSurfaceMask(open,lo,8,{filled:true});
assert.ok(sheet.reduce((a,b)=>a+b,0)<512,'Open geometry must not become a bounding-box solid');
console.log('Closed material interior and open-sheet admission pass');
