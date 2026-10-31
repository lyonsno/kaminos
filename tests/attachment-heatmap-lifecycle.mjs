// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as THREE from '../lib/three.webgpu.js';
import {createFullBodyRuntime} from '../experiments/creature-motion/full-body-runtime.mjs';

// Exercise the shipped renderer's allocation/disposal contract, not a copy of
// it. Only device allocation and shader attribute discovery are instrumented.
const source=readFileSync(new URL('../lib/three.webgpu.js',import.meta.url),'utf8');
function declaration(prefix){const start=source.indexOf(prefix);assert(start>=0);const end=source.indexOf('\n}',start);assert(end>start);return source.slice(start,end+2);}
const {Attributes,Geometries,RenderObject,AttributeType}=runInNewContext([
 'let _id$a=0;',declaration('const AttributeType ='),
 ...['DataMap','Attributes','Geometries','RenderObject'].map(name=>declaration('class '+name+' ')),
 '({Attributes,Geometries,RenderObject,AttributeType});',
].join('\n'),{DynamicDrawUsage:THREE.DynamicDrawUsage});
const I=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
const data={manifest:{bones:[{name:'torso',parent:null,semanticRole:'spine-chest',restMatrix:I},{name:'arm',parent:'torso',semanticRole:'forelimb-left-shoulder',restMatrix:I}],channels:['fixed','torso','arm'],vertices:3,triangles:1},rest:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),weights:new Float32Array([0,.5,.5,0,1,0,0,0,1])};
for(const firstDraw of ['body','shadow','heatmap']){
 const live=new Set(),destroyed=new Map();
 const backend={createAttribute(a){live.add(a);},destroyAttribute(a){assert(live.delete(a),'destroy only allocated buffers');destroyed.set(a,(destroyed.get(a)??0)+1);}};
 const info={memory:{geometries:0},createAttribute(){},destroyAttribute(){}};
 const attributes=new Attributes(backend,info),geometries=new Geometries(attributes,info);
 const renderer={_attributes:attributes,_currentSourceMaterial:null};
 const runtime=createFullBodyRuntime({THREE,...data}),material=runtime.mesh.material;
 class Draw extends RenderObject{getDynamicCacheKey(){return 0;}getCacheKey(){return 0;}}
 const draws=[],shadow=new THREE.MeshBasicMaterial();
 function draw(names,override=null){
  runtime.mesh.onBeforeRender(renderer);
  const ro=new Draw(null,geometries,renderer,runtime.mesh,override??runtime.mesh.material,null,null,null,null,null);
  ro.getNodeBuilderState=()=>({nodeAttributes:names.map(name=>({name}))});ro.onDispose=()=>{};draws.push(ro);
  if(!geometries.has(ro))geometries.initGeometry(ro);
  for(const attribute of ro.getAttributes())attributes.update(attribute,AttributeType.VERTEX);
 }
 if(firstDraw!=='heatmap')draw(firstDraw==='shadow'?['position']:['position','normal'],firstDraw==='shadow'?shadow:null);
 const colors=[];
 function show(){runtime.setAttachmentHeatmap(true);draw(['position','color']);const color=runtime.mesh.geometry.getAttribute('color');assert(live.has(color));colors.push(color);return color;}
 const initial=show();runtime.setAttachmentHeatmap(false);
 assert.equal(runtime.mesh.material,material);assert(!live.has(initial),firstDraw+': hiding releases the uploaded color buffer');
 const second=show();runtime.setLimbAttachmentReach(.5);
 assert(!live.has(second),firstDraw+': retiring skin releases its color buffer');
 draw(['position','color']);colors.push(runtime.mesh.geometry.getAttribute('color'));
 runtime.dispose();runtime.dispose();
 for(const color of colors){assert(!live.has(color));assert.equal(destroyed.get(color),1,'each color allocation is destroyed once');}
 for(const ro of draws)ro.dispose();shadow.dispose();
}
// An overlay that never drew owns no GPU allocation and still disposes cleanly.
const unseen=createFullBodyRuntime({THREE,...data});unseen.setAttachmentHeatmap(true);unseen.setAttachmentHeatmap(false);unseen.setAttachmentHeatmap(true);unseen.dispose();
console.log('Shipped renderer releases heatmap buffers on hide, repeated activation, skin retirement and disposal after body/shadow/heatmap first draw');
