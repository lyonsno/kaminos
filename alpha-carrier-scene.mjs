import {TSL,InstancedMesh,PlaneGeometry,MeshPhongNodeMaterial,MeshBasicNodeMaterial,Matrix4,Vector3,DataTexture,RGBAFormat,RedFormat,HalfFloatType,UnsignedByteType,LinearFilter,ClampToEdgeWrapping,InstancedBufferAttribute,DoubleSide} from './lib/three.webgpu.js';
import {alphaAtlas,alphaDecodeWGSL,validateAlphaModel} from './alpha-carrier-model.mjs';
const {texture,uv,attribute,varying,vec2,vec4,float,wgslFn,positionView}=TSL;

export function childUrl(base,name){
  const value=new URL(base,globalThis.location?.href??'http://localhost/');
  if(value.pathname==='/api/read'){value.searchParams.set('path',(value.searchParams.get('path')??'')+name);return value;}
  return new URL(name,value);
}
async function bytes(url,sha){
  const response=await fetch(url);if(!response.ok)throw Error(`${url}: HTTP ${response.status}`);
  const value=await response.arrayBuffer();
  const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),v=>v.toString(16).padStart(2,'0')).join('');
  if(actual!==sha)throw Error('Alpha source bytes differ from declared digest');return value;
}
async function json(url){const r=await fetch(url);if(!r.ok)throw Error(`${url}: HTTP ${r.status}`);return r.json();}
export async function loadAlphaLevel(base,count){
  const dir=childUrl(base,`${count}/`),meta=await json(childUrl(dir,'report.json'));
  if(meta.count!==count||meta.patchStride!==16)throw Error('Alpha level count/layout differs');
  const headers=new Float32Array(await bytes(childUrl(dir,'patches.f32'),meta.patchesSHA256));
  if(headers.length!==count*16||!headers.every(Number.isFinite))throw Error('Invalid patch headers');
  const result={meta,headers};
  if(meta.maskResolution){
    result.mask=new Uint8Array(await bytes(childUrl(dir,'alpha.u8'),meta.maskSHA256));
    if(result.mask.length!==count*meta.maskResolution**2)throw Error('Mask shape differs');
    const model=await json(childUrl(dir,'model.json'));validateAlphaModel(model,meta);
    const arrays={};
    for(const [name,descriptor]of Object.entries(model.files)){
      const buffer=await bytes(childUrl(dir,descriptor.file),descriptor.sha256);
      if(buffer.byteLength!==descriptor.bytes)throw Error('Alpha model size differs');
      arrays[name]=name==='grid'?new Uint16Array(buffer):new Float32Array(buffer);
    }
    if(arrays.grid.length!==count*model.gridSize**2*4)throw Error('Feature grid shape differs');
    const keys=['layers.0.weight','layers.0.bias','layers.1.weight','layers.1.bias','layers.2.weight','layers.2.bias'];
    const lengths=[32,8,64,8,8,1];
    for(let i=0;i<keys.length;i++)if(!(arrays[keys[i]] instanceof Float32Array)||arrays[keys[i]].length!==lengths[i]||!arrays[keys[i]].every(Number.isFinite))throw Error('Alpha parameters differ');
    result.model={meta:model,grid:arrays.grid,parameters:Float32Array.from(keys.flatMap(k=>Array.from(arrays[k])))};
  }
  return result;
}
export async function loadAlphaSource(base){
  const meta=await json(childUrl(base,'report.json'));if(meta.ok!==true)throw Error('Successful source required');
  const cropped=meta.schema==='kaminos.microstructure-control.v1',name=cropped?'rows.f32':'surfels.f32',sha=cropped?meta.files[name].sha256:meta.dataSHA256;
  const rows=new Float32Array(await bytes(childUrl(base,name),sha));
  if(rows.length!==meta.count*12||!rows.every(Number.isFinite))throw Error('Dense source shape differs');
  return {meta,rows,sha};
}
function atlasTexture(atlas,features){
  const tex=new DataTexture(atlas.data,atlas.width,atlas.height,features?RGBAFormat:RedFormat,features?HalfFloatType:UnsignedByteType);
  tex.minFilter=tex.magFilter=LinearFilter;tex.wrapS=tex.wrapT=ClampToEdgeWrapping;tex.generateMipmaps=false;tex.needsUpdate=true;return tex;
}
export function createAlphaObject(level,mode){
  if(!['analytic','baked','learned'].includes(mode))throw Error('Unknown alpha representation');
  if(mode!=='analytic'&&(!level.mask||!level.model))throw Error('This level has analytical support only');
  const {meta,headers}=level,geometry=new PlaneGeometry(2,2),textures=[];
  let coverage;
  if(mode==='analytic')coverage=uv().sub(.5).mul(2).length().lessThanEqual(1).select(1,0);
  else{
    const learned=mode==='learned',size=learned?level.model.meta.gridSize:meta.maskResolution;
    const atlas=alphaAtlas(learned?level.model.grid:level.mask,meta.count,size,learned?4:1);
    const tiles=new Float32Array(meta.count*4);
    for(let i=0;i<meta.count;i++)tiles.set([(i%atlas.columns*atlas.pitch+1.5)/atlas.width,(Math.floor(i/atlas.columns)*atlas.pitch+1.5)/atlas.height,(size-1)/atlas.width,(size-1)/atlas.height],i*4);
    geometry.setAttribute('alphaTile',new InstancedBufferAttribute(tiles,4));
    const tile=varying(attribute('alphaTile','vec4')).setInterpolation('flat'),map=atlasTexture(atlas,learned);textures.push(map);
    const features=texture(map,tile.xy.add(uv().mul(tile.zw)));
    coverage=learned?wgslFn(alphaDecodeWGSL(level.model.parameters))({features}):features.r;
  }
  const material=new MeshPhongNodeMaterial({color:0xb7bec4,specular:0x151515,shininess:24,side:DoubleSide,alphaTest:.5});
  material.opacityNode=coverage;material.alphaToCoverage=true;
  const ao=new MeshBasicNodeMaterial({side:DoubleSide,alphaTest:.5});ao.opacityNode=coverage;ao.colorNode=vec4(positionView.z.negate(),0,0,1);ao.toneMapped=false;
  const mesh=new InstancedMesh(geometry,material,meta.count),matrix=new Matrix4(),x=new Vector3(),y=new Vector3(),z=new Vector3();
  for(let i=0;i<meta.count;i++){
    const h=headers.subarray(i*16,i*16+16);if(!(h[12]>0&&h[13]>0))throw Error('Nonpositive patch support');
    x.fromArray(h,3).multiplyScalar(h[12]);y.fromArray(h,6).multiplyScalar(h[13]);z.fromArray(h,9);
    matrix.makeBasis(x,y,z).setPosition(h[0],h[1],h[2]);mesh.setMatrixAt(i,matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.name=`${meta.count.toLocaleString()} ${mode} alpha patches`;mesh.userData.kaminosAODepthMaterial=ao;
  return {root:mesh,read:()=>({mode,count:meta.count,sourceCount:meta.sourceCount,sourceSHA256:meta.sourceSHA256,patchesSHA256:meta.patchesSHA256,decoderCallsPerShadedFragment:mode==='learned'?1:0,learnedDepth:false,shading:'fixed clay Phong; one geometric normal per carrier',coverage:'alpha-test with native alpha-to-coverage where the active pass supports it; no coverage mip claim',picking:'native carrier plane, not alpha-aware holes'}),dispose(){geometry.dispose();material.dispose();ao.dispose();for(const t of textures)t.dispose();mesh.dispose();}};
}
export function createAlphaReference(source){
  const {rows,meta}=source,geometry=new PlaneGeometry(2,2),material=new MeshPhongNodeMaterial({color:0xb7bec4,specular:0x151515,shininess:24,side:DoubleSide});
  const support=uv().sub(.5).mul(2).length().lessThanEqual(1);material.maskNode=support;
  const ao=new MeshBasicNodeMaterial({side:DoubleSide});ao.maskNode=support;ao.colorNode=vec4(positionView.z.negate(),0,0,1);ao.toneMapped=false;
  const mesh=new InstancedMesh(geometry,material,meta.count),m=new Matrix4(),n=new Vector3(),u=new Vector3(),v=new Vector3();
  for(let i=0;i<meta.count;i++){
    const h=rows.subarray(i*12,i*12+12);n.fromArray(h,3).normalize();u.set(0,Math.abs(n.z)<.9?0:1,Math.abs(n.z)<.9?1:0).cross(n).normalize();v.crossVectors(n,u);
    m.makeBasis(u.multiplyScalar(meta.radius),v.multiplyScalar(meta.radius),n).setPosition(h[0],h[1],h[2]);mesh.setMatrixAt(i,m);
  }
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.name='Dense source disc reference';mesh.userData.kaminosAODepthMaterial=ao;
  return {root:mesh,read:()=>({mode:'reference',count:meta.count,sourceSHA256:source.sha,source:'retained finite source discs, not original mesh'}),dispose(){geometry.dispose();material.dispose();ao.dispose();mesh.dispose();}};
}
