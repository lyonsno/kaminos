// Builds appearance choices for existing geometry; remeshing and unwrapping are
// deliberately absent. Used by both generation completion and the offline tool.
import {sourceTextureSizes,buildTextureVariants,publishTextureVariants,digestBytes,textureInfo} from './lod-textures.mjs';
import {readGLBLocalSurfaceAndMaterials,createGLBMeshMaterialBaker} from './lod-mesh-bake.mjs';
import {readGLBWorldMesh} from './mesh-lod-ladder.mjs';
import {createHeroNormalSampler} from './lod-normal-bake.mjs';

export async function prepareMeshTextureLevels({source,server='',fetch=globalThis.fetch,THREE,MeshBVH,heroGLB=null,geometries=null,sizes=null,report={},onPhase=()=>{}}){
  Object.assign(report,{schema:'kaminos.lod-appearance-report.v1',source,phase:'appearance-preflight',geometries:report.geometries??[]});
  const phase=name=>{report.phase=name;onPhase(report);};
  try{
    if(!/^[a-f0-9]{64}$/.test(source??''))throw Error('Stored source identity required');
    if(heroGLB&&textureInfo(heroGLB).textureSize===0){report.status='skipped';report.reason='source-has-no-textures';phase('done');return report;}
    const response=await fetch(`${server}/api/mesh-lods?${new URLSearchParams({source,prepare:'client',purpose:'beauty'})}`),set=await response.json();
    if(!response.ok||set.source!==source||!Array.isArray(set.levels))throw Error('Appearance catalog did not confirm source identity');
    if(!heroGLB){const response=await fetch(`${server}/api/read?root=generated-meshes&path=${source}.glb`);if(!response.ok)throw Error('Appearance source unavailable');heroGLB=await response.arrayBuffer();}
    sizes??=sourceTextureSizes(heroGLB);
    if(!sizes.length){report.status='skipped';report.reason='source-has-no-textures';phase('done');return report;}
    if(await digestBytes(heroGLB)!==source)throw Error('Appearance source bytes do not match its identity');
    const sourceSurface=await readGLBLocalSurfaceAndMaterials(heroGLB),bakeMaterial=createGLBMeshMaterialBaker(sourceSurface,{THREE,MeshBVH});
    let normalOptions=null;
    const hero=readGLBWorldMesh(heroGLB);
    if(hero.normals)normalOptions={sampleWorldNormal:createHeroNormalSampler({hero,THREE,MeshBVH,maxTexels:2,footprint:true}),source:{kind:'hero',sha256:source}};
    const available=[{sha256:source,isHero:true},...set.levels.filter(l=>!l.mergeFactor&&!l.representation)];
    const selected=geometries?geometries.map(sha=>{const l=available.find(l=>l.sha256===sha);if(!l)throw Error(`Appearance geometry is not registered: ${sha}`);return l;}):available;
    for(const level of selected){
      const existing=set.textureSets?.[level.sha256];
      if(sizes.every(size=>existing?.variants.some(v=>v.textureSize===size))){report.geometries.push({geometry:level.sha256,status:'existing',textureSet:existing});continue;}
      report.currentGeometry=level.sha256;phase('read-appearance-geometry');
      let baseGLB=heroGLB;
      if(!level.isHero){const response=await fetch(`${server}/api/read?root=generated-meshes&path=${level.sha256}.glb`);if(!response.ok)throw Error('Appearance geometry unavailable');baseGLB=await response.arrayBuffer();}
      if(await digestBytes(baseGLB)!==level.sha256)throw Error('Appearance base geometry content mismatch');
      const relative=level.normalMap?.texelSize>0&&level.error?.diagonal>0?level.normalMap.texelSize/level.error.diagonal:null;
      const variants=await buildTextureVariants({baseGLB,sizes,bakeMaterial:level.isHero?null:bakeMaterial,normalOptions:level.isHero?null:normalOptions,
        relativeTexelSize:relative,source,onPhase:phase});
      phase('publish-appearance');
      const textureSet=await publishTextureVariants({source,geometry:level.sha256,variants,server,fetch});
      report.geometries.push({geometry:level.sha256,status:'published',textureSet});onPhase(report);
    }
    report.status='complete';delete report.currentGeometry;phase('done');
  }catch(error){report.error={message:String(error?.message??error),stack:error?.stack};onPhase(report);}
  return report;
}
