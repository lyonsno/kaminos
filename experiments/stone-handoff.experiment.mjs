import * as THREE from '../lib/three.webgpu.js';
import {uv,wgslFn} from '../lib/three.tsl.js';
import {createStoneTransitionSource} from '../stone-transition-source.mjs';
import {stoneHandoffQuads} from '../stone-handoff-geometry.mjs';
import {loadNeumipModel} from '../neumip-model.mjs';
import {createNeumipMaterial} from '../neumip-material.mjs';

function geometry(quads,config){
 const positions=[],uvs=[];
 for(const [a,b,c,d]of quads)for(const [u,v]of [[a,b],[a,d],[c,d],[a,b],[c,d],[c,b]]){positions.push((u-.5)*config.width,0,(v-.5)*config.depth);uvs.push(u,v);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.computeVertexNormals();g.computeTangents();return g;
}
export default {
 id:'stone-handoff',title:'Stone PBR / neural handoff',
 async create({host,inputs={},record,updateInputs}){
  let mode=inputs.mode??'source',collar=inputs.collar??.04;
  const source=createStoneTransitionSource({...inputs.source,halo:0});
  const support=stoneHandoffQuads(source.config,{collar});
  if(!['source','pbr','neural','overlap-control'].includes(mode))throw Error('Unknown stone view');
  let model;if(inputs.modelURL)model=await loadNeumipModel(inputs.modelURL,{sha256:inputs.modelSHA});
  if(['neural','overlap-control'].includes(mode)&&!model)throw Error('This view requires an actual fitted model URL');
  const session=await host.scene.open(),root=new THREE.Group();root.name='Stone parallax handoff';
  const objects={},materials=[],geometries=[];
  const ownMesh=(name,g,m)=>{const mesh=new THREE.Mesh(g,m);mesh.name=name;mesh.receiveShadow=true;materials.push(m);geometries.push(g);return mesh;};
  const explicit=new THREE.Group();
  for(let index=0;index<source.materials.length;index++){
   const ts=source.triangles.filter(t=>t.materialIndex===index),g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(ts.flatMap(t=>[...t.a,...t.b,...t.c]),3));g.computeVertexNormals();
   const m=source.materials[index];explicit.add(ownMesh(m.name,g,new THREE.MeshStandardMaterial({color:new THREE.Color(...m.color),roughness:m.roughness,metalness:m.metalness,side:THREE.DoubleSide})));
  }
  objects.source=explicit;
  const pbr=()=>new THREE.MeshStandardNodeMaterial({color:new THREE.Color(...source.materials[0].color),roughness:source.materials[0].roughness,metalness:0,side:THREE.DoubleSide});
  const plane=()=>geometry([[0,0,1,1]],source.config);
  objects.pbr=ownMesh('Flat PBR endpoint',plane(),pbr());
  if(model){
   const full=createNeumipMaterial(model,{uvScale:1,gain:1});objects.neural=ownMesh('Full ordinary NeuMIP',plane(),full.material);
   const overlap=new THREE.Group();overlap.name='Output-fade control, not learned bridge';overlap.add(ownMesh('Native PBR underlay',plane(),pbr()));
   const rich=createNeumipMaterial(model,{uvScale:1,gain:1});rich.material.transparent=true;rich.material.depthWrite=false;rich.material.forceSinglePass=true;
   const width=source.config.width,depth=source.config.depth,inner=Math.max(source.config.margin,source.config.bevel),outer=inner+collar;
   const code=`fn stoneHandoffWeight(p:vec2<f32>)->f32{let f=fract(p*2.0);let d=min(f,vec2<f32>(1.0)-f)*vec2<f32>(${width},${depth})*0.5;let distance=min(d.x,d.y);${collar===0?`return select(0.0,1.0,distance<${inner});`:`let t=clamp((${outer}-distance)/${collar},0.0,1.0);return t*t*(3.0-2.0*t);`}}`;
   rich.material.opacityNode=wgslFn(code)(uv());
   const layer=ownMesh('Neural support and overlap',geometry(support.quads,source.config),rich.material);layer.renderOrder=1;overlap.add(layer);objects['overlap-control']=overlap;
  }
  for(const o of Object.values(objects))root.add(o);
  const apply=()=>{for(const [key,o]of Object.entries(objects))o.visible=key===mode;session.redraw();};
  let asset,selector,status;
  const read=()=>({schema:'kaminos.stone-handoff-comparison.v1',mode,source:source.config,sourceSchema:source.schema,model:model?.source??null,modelInstalled:!!model,objectId:asset?.id,collar,neuralAreaFraction:support.areaFraction,
   claim:mode==='overlap-control'?'Analytic output-fade control over an authored-source fit; no learned bridge or speedup established':mode==='neural'?'Ordinary NeuMIP fit of authored source':mode==='pbr'?'Native PBR plane, including the current scene renderer':'Explicit authored source in native raster lighting, not the traced teacher integral',view:session.readView()});
  try{apply();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:inputs.modelURL??'procedural:stone-transition-v1',type:'experiment'}});session.setView(inputs.view??{position:[4.3,3.4,4.6],target:[0,-.04,0],fov:42});}
  catch(e){if(!asset){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();}await session.dispose();throw e;}
  return {read,operations:{
   setMode(value){if(!objects[value])throw Error('View unavailable: fitted model not installed or unknown view');mode=value;apply();updateInputs({...inputs,source:source.config,mode,collar});if(selector)selector.value=mode;if(status)status.textContent=read().claim;record({kind:'stone-handoff.mode',phase:'applied',effective:read()});return read();},
   frame(){return session.setView({position:[4.3,3.4,4.6],target:[0,-.04,0],fov:42});},
  },mount({root:panel,document,invoke}){
   const label=document.createElement('label');label.textContent='Representation ';selector=document.createElement('select');
   for(const [value,text]of [['source','Explicit source'],['pbr','PBR endpoint'],['neural','Full learned parallax'],['overlap-control','PBR overlap — output-fade control']]){const option=document.createElement('option');option.value=value;option.textContent=text;option.disabled=!objects[value];selector.append(option);}selector.value=mode;selector.onchange=()=>invoke('setMode',selector.value).catch(e=>status.textContent=e.message);label.append(selector);panel.append(label);
   status=document.createElement('p');status.textContent=read().claim;panel.append(status);const modelState=document.createElement('p');modelState.textContent=model?'Actual fitted model loaded. Gain1, UVscale1.':'Fit pending; neural views remain unavailable.';panel.append(modelState);
  },async dispose(){await session.dispose();}};
 }
};
