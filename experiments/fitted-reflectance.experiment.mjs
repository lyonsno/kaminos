import {Box3,CylinderGeometry,DirectionalLight,DoubleSide,Group,Mesh,MeshBasicMaterial,Vector3} from '../lib/three.webgpu.js';
import {loadFittedReflectance,loadFittedReflectanceManifest} from '../fitted-reflectance.mjs';
import {createFittedReflectanceMaterial,splitCarrierTangentFaces} from '../fitted-reflectance-material.mjs';
import {loadNeuralAppearanceBundle} from '../neural-appearance-bundle.mjs';
import {createNeuralAppearanceMaterial} from '../neural-appearance-material.mjs';
import {loadPatternedMetalMaterial,loadPatternedMetalManifest} from '../patterned-metal-reference-material.mjs';

const routes={source:'Source (native maps)',fitted:'Fitted anisotropic GGX',neural:'Neural decoder'};
const valid=x=>typeof x?.url==='string'&&/^[a-f0-9]{64}$/.test(x?.sha256??'');

export default {
 id:'fitted-reflectance',title:'Reflectance comparison',
 async create({host,inputs,record,updateInputs}){
  if(!valid(inputs.source)&&!valid(inputs.fitted))throw Error('Supply a verified source or fitted bundle');
  if(!host.scene.renderer().backend.isWebGPUBackend)throw Error('Reflectance comparison needs WebGPU');
  const uvScale=inputs.uvScale??1;
  if(!Number.isFinite(uvScale)||uvScale<=0)throw Error('Positive UV scale required');
  // Verify only the small manifests at startup; finish textures still load on selection.
  const [source,fitted]=await Promise.all([
   valid(inputs.source)?loadPatternedMetalManifest(inputs.source.url,inputs.source.sha256):null,
   valid(inputs.fitted)?loadFittedReflectanceManifest(inputs.fitted.url,{sha256:inputs.fitted.sha256}):null,
  ]);
  const comparisonSource=source?inputs.source.sha256:fitted.meta.sourceSha256;
  if(fitted&&fitted.meta.sourceSha256!==comparisonSource)throw Error('Fitted material was baked from a different source');
  const session=await host.scene.open(),materials=new Map(),meshes=[];
  const unresolved=new MeshBasicMaterial({color:0x3a3541,side:DoubleSide});
  const options={uvScale};
  let asset,lightId,mode=inputs.mode??(source?'source':'fitted'),issue=null,generation=0,closed=false,sync=()=>{};
  let lightAngle=inputs.lightAngle??-28;
  const studio=globalThis.kaminosArrivalLighting;
  const priorStudio=studio?.read().studioLightsEnabled;
  const isolate=inputs.isolateLight!==false&&priorStudio===true;
  const lightRig=new Group(),light=new DirectionalLight(0xffffff,2.3);lightRig.name='Neutral sweep light';lightRig.add(light,light.target);
  const target=new Vector3();
  const setLight=degrees=>{
   if(!Number.isFinite(degrees))throw Error('Light angle must be finite');
   lightAngle=degrees;
   const a=degrees*Math.PI/180;
   light.target.position.copy(target);
   light.position.copy(target).add(new Vector3(Math.sin(a)*4,1.6,Math.cos(a)*4));
   lightRig.updateMatrixWorld(true);session.redraw();
   return lightAngle;
  };
  function read(){
   const material=materials.get(mode);
   return {mode,carrier:asset?.id,carrierSource:inputs.asset?.url??'fixture:uv-cylinder',meshes:meshes.length,
    authoredTangents:meshes.filter(m=>!generatedTangents.has(m.geometry)).length,derivedTangentGeometries:generatedTangents.size,
    unresolvedFaces:[...partitions.values()].reduce((n,p)=>n+p.unresolvedFaces,0),
    activeMaterial:material?.material.name??null,lightId,lightAngle,uvScale,error:issue,
    source:inputs.source??null,fitted:inputs.fitted??null,neural:inputs.neural??null,
    fittedLevels:materials.get('fitted')?.levels??null,
    neuralLevels:materials.get('neural')?.levels??null,activeSourceSha256:material?.sourceSha256??null,view:session.readView()};
  }
  async function select(next){
   const input=inputs[next];
   if(!Object.hasOwn(routes,next)||!valid(input))throw Error('That comparison material is not available');
   const token=++generation;
   let material=materials.get(next);
   try{
    if(!material){
     if(next==='source'){
      material=await loadPatternedMetalMaterial(input.url,input.sha256,options);
      material.sourceSha256=input.sha256;
     }
     if(next==='fitted'){
      const bundle=await loadFittedReflectance(input.url,{sha256:input.sha256});
      if(bundle.sourceSha256!==comparisonSource)throw Error('Fitted material was baked from a different source');
      material=createFittedReflectanceMaterial(bundle,options);material.levels=bundle.levels.map(l=>l.size);
      material.sourceSha256=bundle.sourceSha256;
     }
     if(next==='neural'){
      const bundle=await loadNeuralAppearanceBundle(input.url,{sha256:input.sha256});
      const sourceSha256=bundle.provenance?.sourceHash;
      if(sourceSha256!==comparisonSource||
       (bundle.provenance?.teacher?.sourceHash!=null&&bundle.provenance.teacher.sourceHash!==comparisonSource)){
       throw Error('Neural material has no matching source provenance');
      }
      material=createNeuralAppearanceMaterial(bundle,options);
      material.sourceSha256=sourceSha256;
      material.levels=bundle.levels.map(l=>l.width);
      // Same direct-only illumination as the source and analytical fit.
      const setup=material.material.setupLightingModel;
      material.material.setupLightingModel=function(builder){const model=setup.call(this,builder);model.indirect=()=>{};return model;};
     }
     if(closed||token!==generation){material.dispose();return read();}
     materials.set(next,material);
    }
    for(const mesh of meshes)mesh.material=partitions.has(mesh)?[material.material,unresolved]:material.material;
    mode=next;issue=null;session.redraw();sync();
    updateInputs({...inputs,mode,lightAngle});
    record({kind:'reflectance-comparison.finish',phase:'applied',effective:read()});return read();
   }catch(error){if(token===generation){issue=String(error.message??error);sync();}throw error;}
  }
  const originals=new Map(), generatedTangents=new Set(),partitions=new Map();
  const cleanup=async()=>{
   closed=true;generation++;
   for(const [mesh,original] of originals){mesh.material=original.material;mesh.geometry=original.geometry;}
   for(const partition of partitions.values())partition.geometry.dispose();
   for(const geometry of generatedTangents)geometry.deleteAttribute('tangent');
   try {await session.dispose();}
   finally {
    for(const material of materials.values())material.dispose();
    unresolved.dispose();
    if(isolate&&studio.read().studioLightsEnabled===false)studio.setStudioLights(true);
   }
  };
  try{
   if(inputs.asset){
    if(typeof inputs.asset.url!=='string')throw Error('Carrier needs an asset URL');
    asset=await session.loadAsset(inputs.asset);
   }else{
    const geometry=new CylinderGeometry(.65,.65,1.6,96,4,true,0,Math.PI*2);
    geometry.computeTangents();
    const fixture=new Mesh(geometry);
    fixture.name='Curved finish control';fixture.position.y=.8;
    asset=await session.attach(fixture,{owned:true,metadata:{label:fixture.name,type:'experiment',source:'fixture:uv-cylinder'}});
   }
   asset.root.traverse(o=>{if(o.isMesh&&(!inputs.asset?.meshName||o.name===inputs.asset.meshName)){
    if(!o.geometry.hasAttribute('uv')||!o.geometry.hasAttribute('normal'))throw Error('Carrier requires UVs and surface normals');
    if(!o.geometry.hasAttribute('tangent')){
     if(!o.geometry.index)throw Error('Unindexed carrier needs authored tangents');
     o.geometry.computeTangents();
     generatedTangents.add(o.geometry);
    }
    const tangent=o.geometry.getAttribute('tangent');
    const invalid=new Set();
    for(let i=0;i<tangent.count;i++){
     const length=Math.hypot(tangent.getX(i),tangent.getY(i),tangent.getZ(i));
     if(!Number.isFinite(length)||length<.5||Math.abs(tangent.getW(i))!==1)invalid.add(i);
    }
    const partition=splitCarrierTangentFaces(o.geometry,invalid);
    meshes.push(o);originals.set(o,{material:o.material,geometry:o.geometry});
    if(partition){partitions.set(o,partition);o.geometry=partition.geometry;}
   }});
   if(!meshes.length)throw Error('No matching carrier mesh');
   const box=new Box3().setFromObject(asset.root),s=box.getSize(new Vector3()).length();
   if(!Number.isFinite(s)||s<=0)throw Error('Invalid carrier extent');
   box.getCenter(target);
   lightId=(await session.attach(lightRig,{owned:true,metadata:{label:lightRig.name,type:'experiment',source:'fixture:directional-light'}})).id;
   if(isolate)studio.setStudioLights(false);
   setLight(lightAngle);
   session.setView(inputs.view??{position:[target.x+s*.48,target.y+s*.18,target.z+s*1.58],target:target.toArray()});
   await select(mode);
  }catch(error){await cleanup();throw error;}
  return {read,operations:{
   selectFinish:select,
   setLightAngle(degrees){setLight(degrees);updateInputs({...inputs,mode,lightAngle});sync();
    record({kind:'reflectance-comparison.light',phase:'applied',effective:read()});return read();},
   setView(view){return session.setView(view);},
  },mount({root,document,invoke}){
   const select=document.createElement('select');select.setAttribute('aria-label','Compared finish');
   for(const [value,label] of Object.entries(routes)){
    const option=document.createElement('option');option.value=value;option.textContent=label;option.disabled=!valid(inputs[value]);select.append(option);
   }
   const angle=document.createElement('input');angle.type='range';angle.min='-180';angle.max='180';angle.step='1';angle.setAttribute('aria-label','Neutral light angle');
   const status=document.createElement('p');status.setAttribute('role','status');
   select.onchange=()=>invoke('selectFinish',select.value).catch(()=>sync());
   angle.oninput=()=>invoke('setLightAngle',Number(angle.value)).catch(()=>sync());
   root.append('Finish ',select,' Neutral light angle ',angle,status);
   sync=()=>{select.value=mode;angle.value=String(lightAngle);const missing=read().unresolvedFaces;
    status.textContent=issue??(missing?`${missing} faces without a usable UV frame use a neutral finish in every mode.`:'Direct light on the same mesh. Orbit or sweep the neutral light.');};sync();
  },dispose:cleanup};
 }
};
