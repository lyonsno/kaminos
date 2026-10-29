// kaminos-test: node
import assert from 'node:assert/strict';
import {createInferenceKiln} from '../inference-kiln.mjs';
import {resolveBurnableTarget} from '../burnable-target.mjs';
import {Raycaster,Vector3} from '../lib/three.core.js';
const canvas={getContext:()=>ctx},ctx={measureText:s=>({width:s.length*45}),clearRect(){},fillText(){},getImageData(){
 const {width,height}=canvas,data=new Uint8ClampedArray(width*height*4);
 for(let y=50;y<150;y++)for(let x=300;x<724;x++)if(!(x>430&&x<594&&y>75&&y<125))data[(y*width+x)*4+3]=255;
 return {data,width,height};
}};
const kiln=createInferenceKiln({document:{createElement:()=>canvas},prompt:'O',representation:'relief'});
const prompt=kiln.root.getObjectByName('Prompt');prompt.geometry.computeBoundingBox();
assert.ok(prompt.geometry.boundingBox.max.z>prompt.geometry.boundingBox.min.z,'thermal target must have real thickness');
assert.equal(resolveBurnableTarget([{id:'prompt',object:prompt}],'prompt').object,prompt);
assert.equal(prompt.material.transparent,false,'solid glyphs use the opaque lighting path');
prompt.position.set(0,0,0);prompt.updateMatrixWorld(true);
assert.equal(new Raycaster(new Vector3(0,0,1),new Vector3(0,0,-1)).intersectObject(prompt).length,0,'letter counters remain real geometric holes');
assert.ok(new Raycaster(new Vector3(.3,0,1),new Vector3(0,0,-1)).intersectObject(prompt).length>0,'glyph strokes remain solid');
assert.equal(kiln.read().burnAuthority,'scene-owned-thermal');
kiln.dispose();

// A saved asset is borrowed by the study, preserving its exact geometry/pose.
const saved=createInferenceKiln({document:{createElement:()=>canvas},prompt:'SAVED',representation:'relief'});
saved.text.position.set(1,2,3);const geometry=saved.text.geometry;let released=false;geometry.addEventListener('dispose',()=>released=true);
saved.text.removeFromParent();const adopted=createInferenceKiln({document:{createElement:()=>canvas},prompt:'SAVED',representation:'relief',promptMesh:saved.text});
assert.equal(adopted.text,saved.text);assert.equal(adopted.text.geometry,geometry);assert.deepEqual(adopted.text.position.toArray(),[1,2,3]);adopted.dispose();assert.equal(released,false,'closing the study must not dispose a saved scene asset');saved.dispose();
