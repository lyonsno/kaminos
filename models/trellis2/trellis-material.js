// Post-model material/asset consumer. No CPU inference, replacement learned
// fields, model pruning or implicit fallback. Coordinates use source z-y-x
// as the three world-position components, like the existing mesh consumer.
import {createTrellisMeshAdapter,encodeTrellisGeometryGLB} from './trellis-mesh.js';
import {WEBGPU_BUFFER_USAGE as U} from '../../webgpu-inference-kit/src/core.js';
const f=Math.fround,align=n=>Math.ceil(n/4)*4;

function materialSampler({coordinates,features,resolution}) {
  const rows=coordinates?.length/3;
  if(!(coordinates instanceof Int32Array)||!(features instanceof Float32Array)||!Number.isSafeInteger(rows)||rows<1||
    features.length!==rows*6)throw TypeError('complete Int32[N,3] coordinates and F32[N,6] material features required');
  if(!Number.isSafeInteger(resolution)||resolution<1||!Number.isSafeInteger(resolution**3))throw RangeError('finite material grid required');
  if(!features.every(Number.isFinite))throw TypeError('finite material features required');
  const key=(z,y,x)=>(z*resolution+y)*resolution+x,map=new Map(),attrs=new Float32Array(features.length);
  for(let row=0;row<rows;row++){
    const z=coordinates[row*3],y=coordinates[row*3+1],x=coordinates[row*3+2];
    if(z<0||y<0||x<0||z>=resolution||y>=resolution||x>=resolution)throw RangeError('material coordinate outside grid');
    const k=key(z,y,x);if(map.has(k))throw Error('duplicate material coordinate');map.set(k,row);
  }
  for(let i=0;i<features.length;i++)attrs[i]=f(f(features[i]*.5)+.5);
  let tree;
  const center=(row,axis)=>f(f(f(coordinates[row*3+axis]+.5)/resolution)-.5);
  function buildTree(){
    tree=new Uint32Array(rows);for(let i=0;i<rows;i++)tree[i]=i;
    const less=(a,b,axis)=>coordinates[a*3+axis]!==coordinates[b*3+axis]?
      coordinates[a*3+axis]<coordinates[b*3+axis]:a<b;
    function split(lo,hi,depth){
      if(lo>=hi)return;const axis=depth%3,mid=Math.floor((lo+hi)/2);let left=lo,right=hi;
      while(left<right){
        const pivot=tree[Math.floor((left+right)/2)];let i=left,j=right;
        while(i<=j){while(less(tree[i],pivot,axis))i++;while(less(pivot,tree[j],axis))j--;
          if(i<=j){[tree[i],tree[j]]=[tree[j],tree[i]];i++;j--;}}
        if(mid<=j)right=j;else if(mid>=i)left=i;else break;
      }
      split(lo,mid-1,depth+1);split(mid+1,hi,depth+1);
    }
    split(0,rows-1,0);
  }
  function nearest(position){
    if(!tree)buildTree();let best=Infinity,bestRow=Infinity;
    function visit(lo,hi,depth){
      if(lo>hi)return;const mid=Math.floor((lo+hi)/2),row=tree[mid],axis=depth%3;
      let distance=0;for(let a=0;a<3;a++)distance+=(position[a]-center(row,a))**2;
      if(distance<best||(distance===best&&row<bestRow)){best=distance;bestRow=row;}
      const delta=position[axis]-center(row,axis);
      if(delta<=0){visit(lo,mid-1,depth+1);if(delta*delta<=best)visit(mid+1,hi,depth+1);}
      else {visit(mid+1,hi,depth+1);if(delta*delta<=best)visit(lo,mid-1,depth+1);}
    }
    visit(0,rows-1,0);return bestRow;
  }
  return positions=>{
    if(!(positions instanceof Float32Array)||!positions.length||positions.length%3)throw TypeError('complete F32[P,3] sample positions required');
    if(!positions.every(Number.isFinite))throw TypeError('finite material sample positions required');
    const result=new Float32Array(positions.length*2);
    for(let p=0;p<positions.length/3;p++){
      const voxel=[],base=[],frac=[];for(let a=0;a<3;a++){voxel[a]=f(f(f(positions[p*3+a]+.5)*resolution)-.5);
        base[a]=Math.floor(voxel[a]);frac[a]=f(voxel[a]-f(base[a]));}
      let total=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
        const z=base[0]+dz,y=base[1]+dy,x=base[2]+dx;
        if(z<0||y<0||x<0||z>=resolution||y>=resolution||x>=resolution)continue;
        const row=map.get(key(z,y,x));if(row===undefined)continue;
        const weight=f(f(f(dz?frac[0]:f(1-frac[0]))*(dy?frac[1]:f(1-frac[1])))*(dx?frac[2]:f(1-frac[2])));
        total=f(total+weight);for(let c=0;c<6;c++)result[p*6+c]=f(result[p*6+c]+f(weight*attrs[row*6+c]));
      }
      if(total>0)for(let c=0;c<6;c++)result[p*6+c]=f(result[p*6+c]/total);
      else {const row=nearest(positions.subarray(p*3,p*3+3));result.set(attrs.subarray(row*6,row*6+6),p*6);}
    }
    return result;
  };
}

export function sampleTrellisMaterial({positions,...input}){return materialSampler(input)(positions);}

function validateSurface({vertices,triangles,uvs},withUV=true){
  const n=vertices?.length/3;
  if(!(vertices instanceof Float32Array)||!Number.isSafeInteger(n)||n<1||
    !(triangles instanceof Uint32Array)||!triangles.length||triangles.length%3||
    (withUV&&(!(uvs instanceof Float32Array)||uvs.length!==n*2)))throw TypeError('complete triangle surface and UV coordinates required');
  if(!vertices.every(Number.isFinite)||!triangles.every(i=>i<n)||
    (withUV&&!uvs.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw RangeError('finite in-range surface/UV values required');
}

function faceCross({vertices,triangles},face){
  const a=triangles[face*3]*3,b=triangles[face*3+1]*3,c=triangles[face*3+2]*3,
    x=vertices[b]-vertices[a],y=vertices[b+1]-vertices[a+1],z=vertices[b+2]-vertices[a+2],
    u=vertices[c]-vertices[a],v=vertices[c+1]-vertices[a+1],w=vertices[c+2]-vertices[a+2];
  return [y*w-z*v,z*u-x*w,x*v-y*u];
}

function validateUVArea(mesh){
  const {triangles,uvs}=mesh;
  for(let face=0;face<triangles.length/3;face++){
    const a=triangles[face*3]*2,b=triangles[face*3+1]*2,c=triangles[face*3+2]*2,
      area=(uvs[b]-uvs[a])*(uvs[c+1]-uvs[a+1])-(uvs[c]-uvs[a])*(uvs[b+1]-uvs[a+1]);
    if(area===0&&faceCross(mesh,face).some(v=>v!==0))
      throw Error('collapsed UV face '+face+'; nondegenerate geometry requires nonzero UV area');
  }
}

// Model-owned packing of the shipped worker's remaining tier. Its fixed .005
// padding consumes dense cells. Keep primary/secondary charts unchanged, but
// project each remaining source face along its strongest geometric normal and
// fit padding to its cell. This is a declared postprocess route, not xatlas.
function repackRemainingUV(mesh){
  const {vertices,triangles,uvs,faceAssignment}=mesh,remaining=[];
  for(let face=0;face<faceAssignment.length;face++)if(faceAssignment[face]===12)remaining.push(face);
  if(!remaining.length)return {remainingFaces:0};
  const gridW=Math.ceil(Math.sqrt(remaining.length*1.5)),gridH=Math.ceil(remaining.length/gridW),
    cellW=.5/gridW,cellH=(1/3)/gridH,padding=Math.min(.005,cellW/4,cellH/4);
  for(let i=0;i<remaining.length;i++){
    const face=remaining[i],cross=faceCross(mesh,face);
    if(!cross.some(v=>v!==0))continue; // Do not manufacture a parameterization for zero-area geometry.
    let axis=0;for(let a=1;a<3;a++)if(Math.abs(cross[a])>Math.abs(cross[axis]))axis=a;
    const uAxis=(axis+1)%3,vAxis=(axis+2)%3,rows=[triangles[face*3],triangles[face*3+1],triangles[face*3+2]],
      u=rows.map(row=>vertices[row*3+uAxis]),v=rows.map(row=>vertices[row*3+vAxis]),
      uMin=Math.min(...u),vMin=Math.min(...v),uRange=Math.max(...u)-uMin,vRange=Math.max(...v)-vMin,
      offX=.5+(i%gridW)*cellW,offY=2/3+Math.floor(i/gridW)*cellH;
    for(let k=0;k<3;k++){
      uvs[rows[k]*2]=offX+padding+(u[k]-uMin)/uRange*(cellW-2*padding);
      uvs[rows[k]*2+1]=offY+padding+(v[k]-vMin)/vRange*(cellH-2*padding);
    }
  }
  return {remainingFaces:remaining.length,grid:[gridW,gridH],padding,
    route:'TRELLIS remaining-face dominant-plane charts/cell-compatible padding; shipped primary/secondary unchanged'};
}

export function rasterizeTrellisMaterialUV({vertices,triangles,uvs,textureSize=1024}){
  validateSurface({vertices,triangles,uvs});validateUVArea({vertices,triangles,uvs});
  if(!Number.isSafeInteger(textureSize)||textureSize<1||!Number.isSafeInteger(textureSize**2))throw RangeError('finite texture dimensions required');
  const faces=new Int32Array(textureSize**2).fill(-1),bary=new Float32Array(textureSize**2*3);
  for(let face=0;face<triangles.length/3;face++){
    const points=[];for(let k=0;k<3;k++){const row=triangles[face*3+k];points.push([f(uvs[row*2]*textureSize),f(uvs[row*2+1]*textureSize)]);}
    const a=points[0],e0=[f(points[1][0]-a[0]),f(points[1][1]-a[1])],e1=[f(points[2][0]-a[0]),f(points[2][1]-a[1])],
      dot=(u,v)=>f(f(u[0]*v[0])+f(u[1]*v[1])),d00=dot(e0,e0),d01=dot(e0,e1),d11=dot(e1,e1),
      inv=f(1/f(f(f(d00*d11)-f(d01*d01))+f(1e-10))),
      bound=(axis,fn,round)=>Math.max(0,Math.min(textureSize-1,round(fn(...points.map(p=>p[axis]))))),
      xmin=bound(0,Math.min,Math.floor),xmax=bound(0,Math.max,Math.ceil),ymin=bound(1,Math.min,Math.floor),ymax=bound(1,Math.max,Math.ceil);
    if(xmin===xmax||ymin===ymax)continue;
    for(let y=ymin;y<=ymax;y++)for(let x=xmin;x<=xmax;x++){
      const px=x+.5-a[0],py=y+.5-a[1],dp0=px*e0[0]+py*e0[1],dp1=px*e1[0]+py*e1[1],
        u=(d11*dp0-d01*dp1)*inv,v=(d00*dp1-d01*dp0)*inv;
      if(u>=0&&v>=0&&u+v<=1){const p=y*textureSize+x;faces[p]=face;bary.set([f(1-u-v),f(u),f(v)],p*3);}
    }
  }
  return {faces,bary};
}

// Exact Euclidean nearest-covered extension, not OpenCV Telea. Equal-distance
// ties choose the earlier row/column. Every pixel is filled; no radius/cap.
function nearestCovered(mask,size){
  const count=size*size,rowDistance=new Float64Array(count),rowSeed=new Int32Array(count),
    seeds=new Int32Array(count),v=new Int32Array(size),z=new Float64Array(size+1),
    cost=new Float64Array(size),distance=new Float64Array(size),arg=new Int32Array(size);
  function transform(){
    let k=-1;
    for(let q=0;q<size;q++){if(!Number.isFinite(cost[q]))continue;
      let s=-Infinity;while(k>=0){const p=v[k];s=(cost[q]+q*q-cost[p]-p*p)/(2*(q-p));if(s>z[k])break;k--;}
      k++;v[k]=q;z[k]=k===0?-Infinity:s;z[k+1]=Infinity;
    }
    if(k<0){distance.fill(Infinity);arg.fill(-1);return;}
    let active=0;for(let q=0;q<size;q++){while(active<k&&z[active+1]<q)active++;
      const p=v[active];distance[q]=(q-p)**2+cost[p];arg[q]=p;}
  }
  for(let y=0;y<size;y++){for(let x=0;x<size;x++)cost[x]=mask[y*size+x]?0:Infinity;transform();
    for(let x=0;x<size;x++){rowDistance[y*size+x]=distance[x];rowSeed[y*size+x]=arg[x];}}
  for(let x=0;x<size;x++){for(let y=0;y<size;y++)cost[y]=rowDistance[y*size+x];transform();
    for(let y=0;y<size;y++){const sy=arg[y];seeds[y*size+x]=sy<0?-1:sy*size+rowSeed[sy*size+x];}}
  return seeds;
}

export function bakeTrellisMaterialTextures({vertices,triangles,uvs,textureSize=1024,...material}){
  const sampler=materialSampler(material),{faces,bary}=rasterizeTrellisMaterialUV({vertices,triangles,uvs,textureSize}),
    mask=new Uint8Array(faces.length);let coveredPixels=0;
  for(let p=0;p<faces.length;p++)if(faces[p]>=0){mask[p]=1;coveredPixels++;}
  if(!coveredPixels)throw Error('no covered UV pixels; no learned texture evidence');
  const positions=new Float32Array(coveredPixels*3);let row=0;
  for(let p=0;p<faces.length;p++)if(mask[p]){
    const face=faces[p];for(let axis=0;axis<3;axis++)positions[row*3+axis]=f(f(f(bary[p*3]*vertices[triangles[face*3]*3+axis])+
      f(bary[p*3+1]*vertices[triangles[face*3+1]*3+axis]))+f(bary[p*3+2]*vertices[triangles[face*3+2]*3+axis]));row++;
  }
  const sampled=sampler(positions),baseColor=new Uint8Array(faces.length*4),metallicRoughness=new Uint8Array(faces.length*4),
    byte=v=>Math.trunc(Math.max(0,Math.min(255,f(v*255))));
  row=0;for(let p=0;p<faces.length;p++)if(mask[p]){
    for(let c=0;c<3;c++)baseColor[p*4+c]=byte(sampled[row*6+c]);
    baseColor[p*4+3]=byte(sampled[row*6+5]);metallicRoughness[p*4+1]=byte(sampled[row*6+4]);
    metallicRoughness[p*4+2]=byte(sampled[row*6+3]);metallicRoughness[p*4+3]=255;row++;
  }
  const seeds=nearestCovered(mask,textureSize);
  for(let p=0;p<faces.length;p++)if(!mask[p]){const source=seeds[p];if(source<0)throw Error('incomplete texture extension');
    baseColor.set(baseColor.subarray(source*4,source*4+4),p*4);metallicRoughness.set(metallicRoughness.subarray(source*4,source*4+4),p*4);}
  return {width:textureSize,height:textureSize,baseColor,metallicRoughness,coveredPixels,alphaMode:'OPAQUE',
    metadata:{channels:'source decoded*.5+.5: RGB,metallic,roughness,alpha',sampling:'sparse trilinear/source-F32 boundaries; renormalize existing corners; nearest voxel center if zero support',
      nearestTie:'lowest source row',raster:'source NumPy CPU pixel centers/barycentrics; later face wins',
      extension:'Euclidean nearest covered pixel; earlier row/column tie; not OpenCV Telea',
      qualityLimit:'Nearest extension can produce blocky seams; browser UV atlas differs from source xatlas.'}};
}

const crcTable=new Uint32Array(256);
for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
function pngChunk(type,payload){
  const bytes=new Uint8Array(payload.length+12),view=new DataView(bytes.buffer);
  view.setUint32(0,payload.length);bytes.set(new TextEncoder().encode(type),4);bytes.set(payload,8);
  let crc=0xffffffff;for(let i=4;i<bytes.length-4;i++)crc=crcTable[(crc^bytes[i])&255]^(crc>>>8);
  view.setUint32(bytes.length-4,(crc^0xffffffff)>>>0);return bytes;
}

export async function encodeTrellisTexturePNG({pixels,width,height}){
  if(!(pixels instanceof Uint8Array)||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||
    pixels.length!==width*height*4)throw TypeError('complete unpremultiplied RGBA texture required');
  if(typeof CompressionStream!=='function')throw Error('PNG deflate CompressionStream unavailable; no canvas premultiplication fallback');
  const raw=new Uint8Array((width*4+1)*height);for(let y=0;y<height;y++)raw.set(pixels.subarray(y*width*4,(y+1)*width*4),y*(width*4+1)+1);
  const data=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer()),
    header=new Uint8Array(13),hv=new DataView(header.buffer);hv.setUint32(0,width);hv.setUint32(4,height);header[8]=8;header[9]=6;
  const parts=[new Uint8Array([137,80,78,71,13,10,26,10]),pngChunk('IHDR',header),pngChunk('IDAT',data),pngChunk('IEND',new Uint8Array())],
    output=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){output.set(part,offset);offset+=part.length;}return output.buffer;
}

export async function encodeTrellisPbrGLB(mesh,{textures,provenance={}}={}){
  validateSurface(mesh);validateUVArea(mesh);
  if(textures?.alphaMode!=='OPAQUE')throw Error('source OPAQUE material contract required');
  const base=encodeTrellisGeometryGLB(mesh,{provenance}),view=new DataView(base),jsonLength=view.getUint32(12,true),
    document=JSON.parse(new TextDecoder().decode(new Uint8Array(base,20,jsonLength))),baseStart=28+jsonLength,
    baseLength=view.getUint32(20+jsonLength,true),parts=[new Uint8Array(base,baseStart,baseLength)],
    uv=new Uint8Array(mesh.uvs.buffer,mesh.uvs.byteOffset,mesh.uvs.byteLength);
  let offset=baseLength;
  function append(bytes,target){const padded=new Uint8Array(align(bytes.byteLength));padded.set(bytes);parts.push(padded);
    const index=document.bufferViews.length;document.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.byteLength,...(target?{target}:{})});offset+=padded.length;return index;}
  const uvView=append(uv,34962);document.accessors.push({bufferView:uvView,componentType:5126,count:mesh.vertices.length/3,type:'VEC2'});
  document.meshes[0].primitives[0].attributes.TEXCOORD_0=3;
  if(mesh.normals){
    if(!(mesh.normals instanceof Float32Array)||mesh.normals.length!==mesh.vertices.length||!mesh.normals.every(Number.isFinite))throw Error('complete finite unwrapped normals required');
    const normals=mesh.normals.slice();for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);
      if(length)for(let a=0;a<3;a++)normals[i+a]/=length;else normals[i+2]=1;}
    const normalView=document.bufferViews[2];parts[0]=parts[0].slice();parts[0].set(new Uint8Array(normals.buffer),normalView.byteOffset);
  }
  const basePNG=await encodeTrellisTexturePNG({pixels:textures.baseColor,width:textures.width,height:textures.height}),
    mrPNG=await encodeTrellisTexturePNG({pixels:textures.metallicRoughness,width:textures.width,height:textures.height});
  document.images=[{bufferView:append(new Uint8Array(basePNG)),mimeType:'image/png'},{bufferView:append(new Uint8Array(mrPNG)),mimeType:'image/png'}];
  document.samplers=[{magFilter:9729,minFilter:9987,wrapS:33071,wrapT:33071}];
  document.textures=[{source:0,sampler:0},{source:1,sampler:0}];
  document.materials=[{name:'TRELLIS2 learned PBR',alphaMode:'OPAQUE',doubleSided:true,pbrMetallicRoughness:{
    baseColorFactor:[1,1,1,1],metallicFactor:1,roughnessFactor:1,baseColorTexture:{index:0},metallicRoughnessTexture:{index:1}}}];
  document.asset.generator='Kaminos TRELLIS2 learned material consumer';document.buffers[0].byteLength=offset;
  document.extras.trellis={stage:'learned-geometry-and-material',material:'learned RGB/metallic/roughness/alpha textures',
    provenance,geometry:mesh.metadata,materialPostprocess:textures.metadata,uv:mesh.uvMetadata};
  const json=new TextEncoder().encode(JSON.stringify(document)),length=align(json.length),output=new ArrayBuffer(28+length+offset),
    header=new DataView(output),bytes=new Uint8Array(output);
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,output.byteLength,true);
  header.setUint32(12,length,true);header.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+length);bytes.set(json,20);
  header.setUint32(20+length,offset,true);header.setUint32(24+length,0x004e4942,true);
  let start=28+length;for(const part of parts){bytes.set(part,start);start+=part.length;}return output;
}

export async function unwrapTrellisMesh(mesh,{WorkerClass=globalThis.Worker}={}){
  validateSurface(mesh,false);if(typeof WorkerClass!=='function')throw Error('independent UV worker unavailable; no implicit unwrap fallback');
  const id=crypto.randomUUID(),vertices=mesh.vertices.slice(),faces=mesh.triangles.slice(),
    worker=new WorkerClass(new URL('../../lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',import.meta.url),{type:'module'});
  try{
    const reply=await new Promise((resolve,reject)=>{
      worker.onmessage=e=>{if(e.data?.id!==id){reject(Error('UV worker response identity mismatch'));return;}
        if(e.data.ok!==true){reject(Error('UV worker failed: '+e.data.error));return;}resolve(e.data);};
      worker.onerror=e=>reject(Error('UV worker error: '+e.message));
      worker.onmessageerror=()=>reject(Error('UV worker message decoding failed'));
      worker.postMessage({id,vertices:vertices.buffer,faces:faces.buffer,numVertices:vertices.length/3,numFaces:faces.length/3},[vertices.buffer,faces.buffer]);
    });
    if(!Number.isSafeInteger(reply.newNumVertices)||reply.newNumVertices<1||reply.newNumFaces!==mesh.triangles.length/3)throw Error('complete UV worker surface required');
    const read=(name,Type,count)=>{if(!(reply[name] instanceof ArrayBuffer)||reply[name].byteLength!==count*4)throw Error('complete UV worker '+name+' required');return new Type(reply[name]);};
    const n=reply.newNumVertices,output={vertices:read('newVertices',Float32Array,n*3),normals:read('newNormals',Float32Array,n*3),
      triangles:read('newFaces',Uint32Array,reply.newNumFaces*3),uvs:read('uvs',Float32Array,n*2),
      faceAssignment:read('faceAssignment',Int32Array,reply.newNumFaces),metadata:mesh.metadata,
      uvMetadata:{route:'shipped SF3D pure UV worker/box charts and overlap tiers',source:'lib/sf3d/assets/uv_unwrap_worker-29CGZ7RB.js',
        sourceComparison:'not source default xatlas',inputVertices:mesh.vertices.length/3,outputVertices:n,triangles:reply.newNumFaces}};
    // Observed dense remaining-tier replies can exceed the atlas bounds before
    // our owned repack. Admit finite source geometry/UVs here, then enforce all
    // final bounds and area after repacking; primary/secondary charts stay fixed.
    validateSurface(output,false);if(!output.uvs.every(Number.isFinite)||!output.normals.every(Number.isFinite)||
      !output.faceAssignment.every(v=>v>=0&&v<=12))throw Error('finite complete UV worker normal/chart output required');
    for(let i=0;i<mesh.triangles.length;i++)for(let axis=0;axis<3;axis++){
      if(output.vertices[output.triangles[i]*3+axis]!==mesh.vertices[mesh.triangles[i]*3+axis])
        throw Error('UV worker changed complete source triangle geometry');
    }
    output.uvMetadata.remainingPacking=repackRemainingUV(output);
    validateSurface(output);validateUVArea(output);
    return output;
  }finally{worker.terminate();}
}

// Shared by the live decoder consumer and retained-field finishing. A finishing
// provider owns copied CPU mesh arrays; a failed provider never becomes a raw
// geometry fallback. Its receipt stays attached to the emitted GLB geometry.
export async function finishTrellisMesh(mesh,{postprocessMesh,materialFields,textureSize=1024,
  WorkerClass,provenance={},onPhase=()=>{}}={}){
  validateSurface(mesh,false);
  if(postprocessMesh!==undefined&&typeof postprocessMesh!=='function')throw TypeError('mesh postprocess provider must be a function');
  if(postprocessMesh){
    await onPhase({phase:'post-model-mesh-postprocess'});
    const inputVertices=mesh.vertices.length/3,inputFaces=mesh.triangles.length/3;
    const processed=await postprocessMesh({...mesh,vertices:mesh.vertices.slice(),triangles:mesh.triangles.slice()});
    validateSurface(processed,false);
    const receipt=processed.metadata?.postprocess;
    if(receipt?.schema!=='trellis2.mesh-postprocess.v0'||receipt.status!=='succeeded'||!receipt.effectiveRoute||
      receipt.inputVertices!==inputVertices||receipt.inputFaces!==inputFaces||
      receipt.outputVertices!==processed.vertices.length/3||receipt.outputFaces!==processed.triangles.length/3)
      throw Error('complete matching mesh postprocess receipt required');
    mesh=processed;
  }
  await onPhase({phase:'post-model-uv-unwrap'});
  const unwrapped=await unwrapTrellisMesh(mesh,{WorkerClass});
  await onPhase({phase:'post-model-texture-bake'});
  const textures=bakeTrellisMaterialTextures({...unwrapped,...materialFields,textureSize});
  await onPhase({phase:'post-model-pbr-glb'});
  const glb=await encodeTrellisPbrGLB(unwrapped,{textures,provenance});
  return {glb,mesh:unwrapped,textures};
}

export function createTrellisAssetAdapter({runtime,geometry,material,textureSize=1024,WorkerClass,
  postprocessMesh,provenance={},onPhase=()=>{}}){
  if(postprocessMesh!==undefined&&typeof postprocessMesh!=='function')throw TypeError('mesh postprocess provider must be a function');
  const a=material?.features,b=material?.coordinates,n=a?.shape?.[0];
  if(!runtime?.readTensor||!a?.buffer||!b?.buffer||a.dtype!=='f32'||b.dtype!=='i32'||!(a.usage&U.storage)||!(b.usage&U.storage)||
    !Number.isSafeInteger(n)||n<1||JSON.stringify(a.shape)!==JSON.stringify([n,6])||JSON.stringify(b.shape)!==JSON.stringify([n,3])||
    a.byteLength!==n*24||b.byteLength!==n*12||n!==geometry?.features?.shape?.[0]||
    material.resolution!==geometry?.resolution)throw TypeError('complete borrowed guided material tensors required');
  const meshConsumer=createTrellisMeshAdapter({runtime,decoded:geometry});let status='new',phase='new',output;
  const enter=async name=>{phase=name;await onPhase({phase:name});};
  return Object.freeze({inputs:{geometry,material},
    async run(){
      if(status!=='new')throw Error('asset consumer is '+status);status='running';
      try{
        await enter('post-model-mesh-extraction');const mesh=await meshConsumer.run();
        if(mesh.status!=='surface')throw Error('learned geometry has no surface; no asset');
        await enter('post-model-material-readback');const raw=await runtime.readTensor(a),coords=await runtime.readTensor(b);
        if(!(raw instanceof ArrayBuffer)||!(coords instanceof ArrayBuffer)||raw.byteLength!==a.byteLength||coords.byteLength!==b.byteLength)throw Error('complete material readback required');
        const finished=await finishTrellisMesh(mesh,{postprocessMesh,WorkerClass,textureSize,provenance,
          materialFields:{features:new Float32Array(raw),coordinates:new Int32Array(coords),resolution:material.resolution},
          onPhase:e=>enter(e.phase)});
        output={...finished,handoff:{phase:'post-model-asset-consumer',input:'exact borrowed learned decoder tensors; no NPZ or fixture replacement',
          featureBytesToCPU:geometry.features.byteLength+a.byteLength,coordinateBytesToCPU:geometry.coordinates.byteLength+b.byteLength,
          inference:'WebGPU producer complete before CPU mesh/UV/texture postprocessing',placement:'GLB produced; Kaminos authoring exercise remains separate'}};
        status='completed';phase='completed';return output;
      }catch(error){status='failed';throw error;}
    },get phase(){return phase;},get output(){return output;},
    dispose(){if(status==='running')throw Error('asset consumer is running');meshConsumer.dispose();status='disposed';}
  });
}
