// Content preparation is shared; editable roots and their resources remain owned.
const releaseKey=Symbol('prepared-asset-release');
export function releasePreparedRoot(root){const release=root?.[releaseKey];if(release){delete root[releaseKey];release();}}
const rootOf=asset=>asset?.scene??asset;
function copyImage(value){
  if(ArrayBuffer.isView(value))return value instanceof DataView?new DataView(value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)):value.slice();
  if(value instanceof ArrayBuffer)return value.slice(0);
  if(Array.isArray(value))return value.map(copyImage);
  if(value?.constructor===Object)return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,copyImage(v)]));
  return value; // ImageBitmap is immutable; each Texture gets its own Source.
}
function shareable(asset){
  if(asset?.animations?.length||asset?.scenes?.length>1)return false;
  const root=rootOf(asset);if(!root?.isObject3D)return false;
  let ok=true;root.traverse(node=>{
    if(node.isSurfaceSplatObject)ok=false;
    if(!['Scene','Group','Object3D','Mesh'].includes(node.type)||node.isSkinnedMesh||node.isInstancedMesh)ok=false;
    if(node.isMesh&&node.constructor.name!=='Mesh')ok=false;
    for(const material of [].concat(node.material??[])){
      if(material.isShaderMaterial||material.isNodeMaterial)ok=false;
      for(const value of Object.values(material))if(value?.isVideoTexture||value?.isCanvasTexture)ok=false;
    }
  });return ok;
}
export function disposePreparedAsset(asset){
  const root=rootOf(asset);if(!root?.traverse)return;releasePreparedRoot(root);
  const runtimes=[];root.traverse(node=>{if(node.isSurfaceSplatObject)runtimes.push(node);});
  for(const node of runtimes)node.dispose();
  const seen=new Set(),dispose=value=>{if(value&&!seen.has(value)){seen.add(value);value.dispose?.();}};
  root.traverse(node=>{dispose(node.geometry);for(const material of [].concat(node.material??[])){for(const value of Object.values(material))if(value?.isTexture)dispose(value);dispose(material);}});
}
function cloneAsset(asset){
  const root=rootOf(asset).clone(true),geometries=new Map(),materials=new Map(),textures=new Map(),created=[];
  const texture=value=>{
    if(!textures.has(value)){
      const copy=value.clone();created.push(copy);copy.source=new value.source.constructor(copyImage(value.source.data));
      copy.mipmaps=value.mipmaps.map(copyImage);textures.set(value,copy);
    }return textures.get(value);
  };
  try{
    root.traverse(node=>{
      if(node.geometry){if(!geometries.has(node.geometry)){const copy=node.geometry.clone();created.push(copy);geometries.set(node.geometry,copy);}node.geometry=geometries.get(node.geometry);}
      if(node.material){const clone=material=>{
        if(!materials.has(material)){const copy=material.clone();created.push(copy);for(const [key,value]of Object.entries(copy))if(value?.isTexture)copy[key]=texture(value);materials.set(material,copy);}return materials.get(material);
      };node.material=Array.isArray(node.material)?node.material.map(clone):clone(node.material);}
    });
  }catch(error){for(const resource of created)resource.dispose?.();throw error;}
  return asset?.scene?{...asset,scene:root,...(asset.scenes?{scenes:[root]}:{})}:root;
}
export function createPreparedAssetPool({load,dispose=disposePreparedAsset}={}){
  const entries=new Map();let preparations=0,instances=0;
  function release(key,entry){
    entry.users--;if(entry.users===0){if(entries.get(key)===entry)entries.delete(key);if(entry.asset&&!entry.transferred)dispose(entry.asset);}
  }
  return {
    async acquire(key,prepare=()=>load(key)){
      let entry=entries.get(key);
      if(!entry){entry={users:0,asset:null,transferred:false};entries.set(key,entry);preparations++;
        entry.promise=Promise.resolve().then(prepare).then(asset=>{entry.asset=asset;return asset;});
        entry.promise.catch(()=>{if(entries.get(key)===entry)entries.delete(key);});
      }
      entry.users++;let held=true;
      try{
        const asset=await entry.promise;
        if(!shareable(asset)){
          if(entries.get(key)===entry)entries.delete(key);
          if(!entry.transferred){entry.transferred=true;release(key,entry);return asset;}
          release(key,entry);held=false;preparations++;return await prepare();
        }
        const copy=cloneAsset(asset);instances++;rootOf(copy)[releaseKey]=()=>release(key,entry);return copy;
      }catch(error){if(held)release(key,entry);throw error;}
    },
    state:()=>({entries:entries.size,preparations,instances}),
  };
}

export async function prepareSceneAssetBatch(records,{acquire,isCurrent=()=>true,dispose=disposePreparedAsset}){
  const assets=new Map(),results=await Promise.allSettled(records.filter(row=>row.type==='glb').map(async row=>[row.id,await acquire(row.source)]));
  const failures=[];for(const result of results)if(result.status==='fulfilled')assets.set(...result.value);else failures.push(result.reason);
  if(failures.length||!isCurrent()){
    for(const asset of assets.values())dispose(asset);
    throw failures.length?new AggregateError(failures,'Scene asset preparation failed'):Error('Scene load superseded');
  }
  return {take(id){const asset=assets.get(id);assets.delete(id);return asset;},dispose(){for(const asset of assets.values())dispose(asset);assets.clear();}};
}
