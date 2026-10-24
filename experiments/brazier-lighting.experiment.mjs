import {Mesh,BufferGeometry,BufferAttribute,MeshBasicNodeMaterial,DoubleSide,TSL} from '../lib/three.webgpu.js';
import {loadSurfaceFields} from './surface-fields.experiment.mjs';
import {createDeferredSurfaceSplats} from '../deferred-surface-splats.mjs';

export default {id:'brazier-lighting',title:'Two braziers · corridor lighting',async create({host,inputs,record}){
 if(!inputs.base||!inputs.shadow||!inputs.presetId)throw Error('Room, shadow geometry and saved flame basin are required');
 const session=await host.scene.open();let splats,proxy,asset;const ids=[];
 const absolute=p=>new URL(p,host.controls.document.location.href).href;
 const read=()=>({representation:'splats',room:asset?.id,surface:splats?.read(),shadow:proxy?.userData.provenance,sources:globalThis.kaminosSceneAuthoring.read().objects.filter(o=>ids.includes(o.id)),lighting:globalThis.__kaminosSceneRadiance?.debugState(),gi:host.rendering.readGI(),runtime:host.volume.get()?.debugState()});
 const frame=()=>session.setView({position:[8.8,10.05,-12.8],target:[0,1.25,0]});
 try{
  const field=await loadSurfaceFields(absolute(inputs.base));splats=createDeferredSurfaceSplats(field.data,field.meta,field.footprints);splats.set({mode:'opaque'});splats.root.scale.setScalar(8);splats.root.position.y=1.25;
  const base=absolute(inputs.shadow),get=async name=>{const r=await fetch(new URL(name,base));if(!r.ok)throw Error('Missing shadow geometry '+name);return r;};
  const meta=await(await get('report.json')).json();if(!meta.ok)throw Error('Shadow proxy preparation failed');
  const buffers=await Promise.all(['positions.f32','triangles.u32'].map(async n=>{const b=await(await get(n)).arrayBuffer();const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');if(hash!==meta.files[n])throw Error('Shadow proxy hash mismatch');return b;}));
  const vertices=new Float32Array(buffers[0]),indices=new Uint32Array(buffers[1]);if(vertices.length!==meta.vertices*3||indices.length!==meta.triangles*3||!vertices.every(Number.isFinite)||indices.some(x=>x>=meta.vertices))throw Error('Invalid shadow proxy geometry');
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(vertices,3));geometry.setIndex(new BufferAttribute(indices,1));
  const material=new MeshBasicNodeMaterial({side:DoubleSide});material.maskNode=TSL.bool(false);
  proxy=new Mesh(geometry,material);proxy.name='Room shadow geometry';proxy.castShadow=true;proxy.userData.provenance={source:base,triangles:meta.triangles,sourceTriangles:meta.sourceTriangles,approximation:true,visible:false,hashes:meta.files};proxy.userData.kaminosAODepthMaterial=material;splats.root.add(proxy);
  asset=await session.attach(splats.root,{owned:true,metadata:{label:'Two-brazier corridor',source:absolute(inputs.base),type:'experiment'}});
  ids.push(await host.fire.add(inputs.presetId));const runtime=host.volume.get();runtime.setSimulationPaused(true);
  // Ordinary source authoring feeds both emitters into the shared simulation.
  globalThis.kaminosFlameDomain.set({position:[1.85,1.85,.60],rotation:[0,0,0],scale:[1.5,1.5,1.5]});
  const settings=host.fire.settings();
  for(const [id,value] of [['volume-steps',8],['volume-render-scale',.5],['volume-adaptive-rays',1],['volume-immersed-radius',.17]]){if(settings.domControls[id]){settings.domControls[id].value=value;settings.domControls[id].rawValue=String(value);}}
  await globalThis.kaminosFlameAuthoring.apply(settings,'Brazier assay preview');
  ids.push(await host.fire.add(inputs.presetId));
  for(const [i,id] of ids.entries())host.scene.setTransform(id,{position:i?[2.08,1.08,1.592]:[1.616,1.08,-.384],rotation:[0,0,0],scale:[1,1,1]});
  host.rendering.gi({mode:'combined',steps:6,slices:2});frame();runtime.setSimulationPaused(false);
  const operations={frame,read,selectSource(index){if(!ids[index])throw Error('Unknown source');return host.scene.select(ids[index]);},setSource({index,enabled}){if(!ids[index]||typeof enabled!=='boolean')throw Error('Unknown source or enabled state');globalThis.kaminosSceneAuthoring.setFireSettings(ids[index],'emission',{enabled});record({kind:'brazier-source',index,enabled});return read();},pause(value){runtime.setSimulationPaused(!!value);return read();},muteLighting(value){globalThis.__kaminosSceneRadiance.setSurfaceGain(value?0:1);return read();}};
  return {read,operations,mount({root,document,invoke}){for(let index=0;index<2;index++){const button=document.createElement('button');button.textContent=`Select brazier ${index+1}`;button.onclick=()=>invoke('selectSource',index);root.append(button);}const b=document.createElement('button');b.textContent='Frame room';b.onclick=()=>invoke('frame');root.append(b);},async dispose(){runtime.setSimulationPaused(true);for(const id of ids)globalThis.kaminosSceneAuthoring.setFireSettings(id,'emission',{enabled:false});proxy.geometry.dispose();proxy.material.dispose();splats.dispose();await session.dispose();}};
 }catch(error){host.volume.get()?.setSimulationPaused(true);proxy?.geometry.dispose();proxy?.material.dispose();splats?.dispose();await session.dispose();throw error;}
}};
