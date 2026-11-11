// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import * as THREE from '../lib/three.core.js';
import {buildSurfelField,encodeSurfelGLB} from '../trellis-surfels.mjs';
import {registerHooks} from 'node:module';
// Match index.html's actual import map, including the vendored r185 namespace.
registerHooks({resolve(specifier,context,next){
 const local={'three':'../lib/three.webgpu.js','three/webgpu':'../lib/three.webgpu.js','three/tsl':'../lib/three.tsl.js'}[specifier];
 return local?{url:new URL(local,import.meta.url).href,shortCircuit:true}:next(specifier,context);
}});
const module=await import('../scene-gltf-loader.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND'||error.url!==new URL('../scene-gltf-loader.mjs',import.meta.url).href)throw error;return {};});
function factory(input){assert.equal(typeof module.createSceneGltfLoaderClass,'function','actual ordinary GLTF extension/texture setup must run in the worker too');return module.createSceneGltfLoaderClass(input);}
const renderer=()=>({isWebGPURenderer:true,hasFeature:()=>false});
test('ordinary loader reads the current renderer and shares its actual compression decoder across loads',()=>{
 let current=renderer();const Loader=factory({THREE,readRenderer:()=>current});const a=new Loader(),b=new Loader();
 assert.ok(a.ktx2Loader);assert.equal(a.ktx2Loader,b.ktx2Loader);current=renderer();assert.notEqual(new Loader().ktx2Loader,a.ktx2Loader);
 current=null;assert.throws(()=>new Loader(),/initialized renderer/);
});
test('actual GLTF parser preserves ordinary node pose and asset identity without page globals',async()=>{
 const Loader=factory({THREE,readRenderer:renderer}),loader=new Loader();
 const gltf=await loader.parseAsync(JSON.stringify({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Authored kiln',translation:[1,2,3]}]}),'');
 assert.equal(gltf.scene.children[0].name,'Authored_kiln');assert.deepEqual(gltf.scene.children[0].position.toArray(),[1,2,3]);assert.equal(gltf.asset.version,'2.0');
});
test('actual ordinary GLTF loader consumes the production TRELLIS extension instead of its coarse fallback',async()=>{
 const coords=new Int32Array([3,3,3,4,3,3,3,4,3]),vertices=new Float32Array([...coords].map(v=>(v+.5)/8-.5));
 const field=buildSurfelField({vertices,triangles:new Uint32Array([0,1,2]),geometryCoordinates:coords,material:{resolution:8,coordinates:coords,features:new Float32Array([1,0,0,-1,1,1,0,1,0,-1,1,1,0,0,1,-1,1,1])}});
 const Loader=factory({THREE,readRenderer:renderer}),gltf=await new Loader().parseAsync(encodeSurfelGLB(field),'');
 const roots=[];gltf.scene.traverse(node=>{if(node.isTrellisSurfelRoot)roots.push(node);});
 assert.equal(roots.length,1);assert.equal(roots[0].surfelField.count,field.count);assert.deepEqual(roots[0].surfelField.cells,field.cells);
});
