// kaminos-test: node
import assert from 'node:assert/strict';import {BoxGeometry} from '../lib/three.core.js';import {sectionCap,extractFaces,bisectFaces} from '../poly-mesh-edit.mjs';import {materialMeasure} from '../fracture-whole-prepare.mjs';
const g=new BoxGeometry(2,2,2),a={positions:g.attributes.position.array,indices:Uint32Array.from(g.index.array),faceMaterial:new Uint8Array(12)};for(let i=0;i<a.indices.length;i+=3)[a.indices[i+1],a.indices[i+2]]=[a.indices[i+2],a.indices[i+1]];
const mask=new Uint8Array(12).fill(1),plane={point:[0,0,0],normal:[1,0,0]},cut=bisectFaces(a,mask,plane),part=extractFaces(cut.arrays,Uint8Array.from(cut.side,x=>Number(x<0))).part;
const cap=sectionCap(part,a,mask,plane,{side:-1,material:1,fill:'winding',absoluteWinding:true});
assert.ok(Math.abs(materialMeasure(cap.arrays,f=>cap.arrays.faceMaterial[f]===1).area-4)<1e-4,'Reverse source winding must retain the complete square material section');
