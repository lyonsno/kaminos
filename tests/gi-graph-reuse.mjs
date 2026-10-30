// kaminos-test: node
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='three/webgpu')return {url:new URL('../lib/three.webgpu.js',import.meta.url).href,shortCircuit:true};
 if(specifier==='three/tsl')return {url:new URL('../lib/three.tsl.js',import.meta.url).href,shortCircuit:true};
 return next(specifier,context);
}});
const {default:History}=await import('../scene-gi-history.mjs');
const {default:Filter}=await import('../scene-lighting-filter.mjs');
const {default:SSGI}=await import('../lib/addons/tsl/display/SSGINode.js');
const {PerspectiveCamera,TSL}=await import('../lib/three.webgpu.js');
for(const Type of [History,Filter,SSGI]) {
 const camera=new PerspectiveCamera(),input=TSL.texture();input.build=()=>{};
 const node=Type===SSGI?new Type(input,input,input,camera):new Type(input,input,input,input,camera);
 const renderer={logarithmicDepthBuffer:false},shared={sceneSurfaceLighting:{}};
 const builder=()=>({renderer,getSharedContext:()=>({...shared})});
 node.setup(builder());const material=node.material??node._material,version=material.version,graph=material.colorNode;
 Object.assign(shared,{setupNormal:()=>{},setupPositionView:()=>{},setupModelViewProjection:()=>{},position:{},clipSpace:{}});
 node.setup(builder());
 assert.equal(material.version,version,`${Type.name} must reuse its unchanged fullscreen graph across receiving material builds`);
 assert.equal(material.colorNode,graph);
 node.needsUpdate=true;node.setup(builder());assert(material.version>version,'explicit node invalidation must rebuild');
 const afterVersion=material.version;shared.sceneSurfaceLighting={};node.setup(builder());assert(material.version>afterVersion,'changed shared shader context must rebuild');
 const afterContext=material.version;renderer.logarithmicDepthBuffer=true;node.setup(builder());assert(material.version>afterContext,'changed depth encoding must rebuild');
 node.dispose();
}
console.log('PASS GI fullscreen graph reuse and invalidation');
