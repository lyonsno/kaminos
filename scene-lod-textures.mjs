// Geometry-independent texture selection and owned appearance residency. Byte
// costs describe RGBA8 mip chains for the supported PNG products, not total
// renderer/device memory (render targets, environments and other owners differ).
import {sceneRadianceMaterialChain} from './scene-radiance.mjs';
import {digestBytes,geometrySignature,textureInfo} from './lod-textures.mjs';
const MAPS=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','bumpMap','displacementMap','lightMap'];
const meshes=(root,includeRepetitions=false)=>{const out=[];function visit(m){if(m!==root&&(m.userData?.kaminosBeautyLodProxy||(!includeRepetitions&&m.userData?.kaminosRepetitionCopy)||m.userData?.kaminosEditorHelper||m.userData?.kaminosEditorOnly))return;if(m.isMesh)out.push(m);for(const child of m.children??[])visit(child);}visit(root);return out;};
const materials=m=>Array.isArray(m)?m:[m];
const textureSet=bindings=>new Set(bindings.flat(2).flatMap(m=>MAPS.map(k=>m?.[k])).filter(t=>t?.isTexture));
const releaseTextures=(textures,{close=false}={})=>{const images=new Set();for(const t of textures){t.dispose?.();if(close&&t.source?.data)images.add(t.source.data);}for(const image of images)image.close?.();};

export function allocateTextureLods(candidates=[],{textureBudgetBytes=Infinity,maxTexelPixels=1.5,hysteresis=.15}={}){
  const items=candidates.filter(c=>c.inFrustum!==false).map(c=>{
    const choices=[...(c.variants??[])].filter(v=>v.known!==false&&v.gpuBytes>=0&&v.relativeTexelSize>=0).sort((a,b)=>b.textureSize-a.textureSize)
      .map(v=>({...v,texelPixels:v.relativeTexelSize*(c.worldDiag??1)*(c.pixelsPerUnit??1)*Math.max(1,c.texelStretch??1)}));
    let chosen=0;
    for(let i=choices.length-1;i>=0;i--)if(choices[i].texelPixels<=maxTexelPixels){chosen=i;break;}
    const old=choices.findIndex(v=>v.sha256===c.activeSha);
    if(old>=0){
      if(chosen>old&&choices[chosen].texelPixels>maxTexelPixels*(1-hysteresis))chosen=old;
      else if(chosen<old&&choices[old].texelPixels<=maxTexelPixels*(1+hysteresis))chosen=old;
    }
    return {id:c.id,choices,chosen,demoted:false};
  });
  let totalBytes=items.reduce((n,c)=>n+(c.choices[c.chosen]?.gpuBytes??0),0);
  while(totalBytes>textureBudgetBytes){
    let best=null,cost=Infinity;
    for(const item of items){const a=item.choices[item.chosen],b=item.choices[item.chosen+1];if(!b||a.gpuBytes<=b.gpuBytes)continue;
      const error=Math.max(0,b.texelPixels-a.texelPixels)/(a.gpuBytes-b.gpuBytes);
      if(error<cost){cost=error;best=item;}}
    if(!best)break;const before=best.choices[best.chosen].gpuBytes;best.chosen++;best.demoted=true;totalBytes-=before-best.choices[best.chosen].gpuBytes;
  }
  const allocations={};for(const item of items)allocations[item.id]={...(item.choices[item.chosen]??{}),known:item.choices.length>0,demotedByTextureBudget:item.demoted};
  const unknown=items.filter(i=>!i.choices.length).map(i=>i.id);
  return {allocations,totalBytes,textureBudgetBytes,budgetMode:Number.isFinite(textureBudgetBytes)?'explicit':'unlimited',unknown,withinBudget:unknown.length===0&&totalBytes<=textureBudgetBytes};
}

function bindings(root){return meshes(root).map(m=>materials(m.userData?.kaminosOriginalMaterial??m.material).map(mat=>Object.fromEntries(MAPS.map(k=>[k,mat?.[k]??null]))));}
function applyBindings(root,maps){
  const targets=meshes(root);
  if(targets.length!==maps.length)throw Error('Appearance mesh layout does not match the displayed geometry');
  const groups=targets.map(target=>[materials(target.userData?.kaminosOriginalMaterial??target.material),materials(target.material)]);
  // Validate the entire binding operation before changing any live material.
  for(let i=0;i<groups.length;i++)for(const group of groups[i])if(group.length!==maps[i].length)throw Error('Appearance material slots do not match the displayed geometry');
  const owners=new Map();
  const assign=(material,values)=>{
    for(const owner of sceneRadianceMaterialChain(material)){
      for(const key of MAPS)owner[key]=values[key];
      owner.needsUpdate=true;owners.set(owner,values);
    }
  };
  for(let i=0;i<groups.length;i++)for(const group of groups[i])for(let j=0;j<group.length;j++)if(group[j])assign(group[j],maps[i][j]);
  // Ordinary hero repetitions can hold separate lighting clones. Their source
  // chain identifies the corresponding primary material without replacing the
  // clone or assuming that a stable material UUID means its maps are unchanged.
  const primary=new Set(targets);
  for(const mesh of meshes(root,true))if(!primary.has(mesh)){
    for(const material of [...materials(mesh.userData?.kaminosOriginalMaterial),...materials(mesh.material)]){
      const values=sceneRadianceMaterialChain(material).map(owner=>owners.get(owner)).find(Boolean);
      if(values)assign(material,values);
    }
  }
}
export function inspectRootTextures(root){
  const textures=textureSet(bindings(root));let gpuBytes=0,textureSize=0,known=true;
  for(const texture of textures){
    const image=texture.source?.data??texture.image;let w=image?.width,h=image?.height;
    if(!(w>0&&h>0)||texture.isCompressedTexture){known=false;continue;}
    textureSize=Math.max(textureSize,w,h);
    for(;;){gpuBytes+=w*h*4;if(!texture.generateMipmaps||w===1&&h===1)break;w=Math.max(1,Math.floor(w/2));h=Math.max(1,Math.floor(h/2));}
  }
  return {gpuBytes,textureSize,known};
}
export function createTextureResidency({fetchBytes,parseGlb,digest=digestBytes,onChange=()=>{}}){
  const records=new Map(),pending=new Set();let disposed=false;
  const restore=record=>{if(record.owned){applyBindings(record.root,record.original);const old=record.owned;record.owned=null;record.displayedSha=record.geometry;record.info=record.baseInfo;onChange(record.root);releaseTextures(old,{close:true});}};
  return {
    register(root,{geometry,signature,textureSet:catalog=null,info=null}={}){
      let r=records.get(root);if(r){if(signature&&signature!==r.signature){r.signature=signature;r.failedSha=null;r.wanted=null;}return r;}
      r={root,geometry,signature,catalog,original:bindings(root),baseInfo:info??inspectRootTextures(root),owned:null,version:0,active:false,error:null,failedSha:null};
      r.info=r.baseInfo;r.displayedSha=geometry;records.set(root,r);return r;
    },
    request(root,variant,catalog){
      const r=records.get(root);if(!r||!variant?.sha256)return;
      r.active=true;
      if(r.catalog!==catalog){r.catalog=catalog;r.failedSha=null;}
      if(r.wanted===variant.sha256&&(r.loading||r.displayedSha===variant.sha256||r.failedSha===variant.sha256))return;
      r.wanted=variant.sha256;const version=++r.version;
      if(variant.sha256===r.geometry){restore(r);r.error=null;return;}
      r.loading=true;
      const task=Promise.resolve().then(async()=>{
        let template=null,kept=false;
        try{
          const bytes=await fetchBytes(variant.source??`/api/read?root=generated-meshes&path=${variant.sha256}.glb`);
          if(await digest(bytes)!==variant.sha256)throw Error('Appearance content identity mismatch');
          if(await geometrySignature(bytes)!==r.signature)throw Error('Appearance geometry/UV identity mismatch');
          const actual=textureInfo(bytes);
          if(actual.gpuBytes!==variant.gpuBytes||actual.textureSize!==variant.textureSize)throw Error('Appearance size/cost metadata mismatch');
          template=await parseGlb(bytes);
          if(disposed||records.get(root)!==r||r.version!==version||!r.active)return;
          const maps=bindings(template),next=textureSet(maps),old=r.owned;
          applyBindings(root,maps);r.owned=next;kept=true;r.displayedSha=variant.sha256;r.info={...actual,known:true};r.error=null;r.failedSha=null;
          onChange(root);
          releaseTextures(old??textureSet(r.original),{close:!!old});
        }catch(error){if(records.get(root)===r&&r.version===version){r.error=String(error?.message??error);r.failedSha=variant.sha256;}}
        finally{
          if(template){const seen=new Set();template.traverse(m=>{if(!m.isMesh)return;m.geometry?.dispose?.();for(const mat of materials(m.material)){if(!mat||seen.has(mat))continue;seen.add(mat);mat.dispose?.();}});if(!kept)releaseTextures(textureSet(bindings(template)),{close:true});}
          if(records.get(root)===r&&r.version===version){r.loading=false;onChange(null);}
          pending.delete(task);
        }
      });pending.add(task);
    },
    retain(activeRoots){
      for(const r of records.values())if(!activeRoots.has(r.root)&&r.active){r.active=false;r.version++;r.loading=false;r.wanted=null;restore(r);releaseTextures(textureSet(r.original));}
    },
    state(root){const r=records.get(root);return r?{displayedSha:r.displayedSha,requestedSha:r.wanted,loading:!!r.loading,error:r.error,textureSize:r.info.textureSize,gpuBytes:r.active?r.info.gpuBytes:0,known:r.info.known!==false}:null;},
    totalBytes(){return [...records.values()].reduce((n,r)=>n+(r.active?r.info.gpuBytes:0),0);},
    release(root){const r=records.get(root);if(!r)return;r.version++;r.active=false;restore(r);records.delete(root);},
    hasPending:()=>pending.size>0,
    async whenIdle(){while(pending.size)await Promise.all([...pending]);},
    dispose(){disposed=true;for(const r of records.values()){r.version++;restore(r);}records.clear();},
  };
}
