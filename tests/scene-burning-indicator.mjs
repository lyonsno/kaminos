// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createLogBurnIndicator} from '../live-log-indicator.mjs';
const object=new THREE.Mesh(new THREE.BoxGeometry(.2,.2,.2),new THREE.MeshStandardMaterial());
const document={createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})};
const indicator=createLogBurnIndicator({object,document,fields:[{summaryNode:THREE.TSL.vec3(0)}],fitObject:true});
const group=object.children[0];
assert.ok(group.children[0].scale.x<=.3,'A small object must not acquire a log-sized overlapping label');
assert.ok(group.position.y<.3,'The label must not include itself in object bounds');
indicator.dispose();assert.equal(object.children.length,0);
