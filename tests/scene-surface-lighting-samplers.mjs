// kaminos-test: node
import assert from 'node:assert/strict';
import {Texture,MeshStandardNodeMaterial,NearestFilter,LinearFilter,TSL} from '../lib/three.webgpu.js';
import SceneSurfaceLighting from '../scene-surface-lighting.mjs';
const normal=new Texture(),capture=new Texture();normal.minFilter=normal.magFilter=LinearFilter;
const source={renderTarget:{dispose(){}},outputs:{},getMRT(){return {outputNodes:this.outputs};},setMRT(value){this.outputs=value.outputNodes;},getTextureNode(name){return {value:name==='normal'?normal:capture};}};
const lighting=new SceneSurfaceLighting(source,{});
lighting.bind(new MeshStandardNodeMaterial(),TSL.vec3(1));
assert.equal(capture.minFilter,NearestFilter,'same-pixel irradiance reuse must not consume a filtering sampler');
assert.equal(capture.magFilter,NearestFilter);
assert.equal(normal.minFilter,LinearFilter,'the estimator retains its authored normal filtering');
assert.equal(normal.magFilter,LinearFilter);
