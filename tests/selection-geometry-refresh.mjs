// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../lib/three.core.js';
// Exercise the actual selection/proxy algorithm; only the unused shader graph
// is inert here. Expose its private pairs to inspect exact geometry identity.
const graph=new Proxy(()=>graph,{get:()=>graph,apply:()=>graph});
const code=readFileSync(new URL('../scene-selection-feedback.mjs',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace('export function','function').replace('return{update,','return{inspectPairs:()=>pairs,update,');
const c={THREE:{...THREE,MeshBasicNodeMaterial:class{}},pass:()=>({getTextureNode:()=>graph}),vec2:graph,vec4:graph,mix:graph,textureSize:graph,screenUV:graph,uniform:value=>({value})};
vm.createContext(c);vm.runInContext(code,c);
const feedback=c.createSelectionFeedback(new THREE.PerspectiveCamera()),root=new THREE.Group(),oldGeometry=new THREE.BoxGeometry(),mesh=new THREE.Mesh(oldGeometry);root.add(mesh);
const rows=[{id:'creature',object:root}];feedback.update(rows,['creature']);const proxy=feedback.inspectPairs()[0].proxy;assert.equal(proxy.geometry,oldGeometry);
const replacement=new THREE.SphereGeometry();mesh.geometry=replacement;feedback.update(rows,['creature']);
assert.ok(proxy.geometry===replacement,'Selected creature outline still uses the previous cast geometry');
assert.equal(feedback.inspectPairs()[0].proxy,proxy,'Geometry exchange must preserve the selected scene/proxy identity');
assert.equal(mesh.geometry,replacement);assert.equal(root.children.length,1);
console.log('Selection feedback follows replacement geometry without duplicate bodies or selection changes');
