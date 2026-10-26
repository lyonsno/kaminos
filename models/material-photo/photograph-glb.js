import { encodeGlb } from '../../poly-glb-io.mjs';

function rgba(map) {
  if (!Number.isInteger(map?.width) || map.width < 1 || !Number.isInteger(map.height) || map.height < 1 ||
      !(map.data instanceof Uint8Array || map.data instanceof Uint8ClampedArray) || map.data.length !== map.width * map.height * 4) throw Error('Expected an RGBA byte image');
  return map;
}
const alphaAt = (image, u, v) => image ? image.data[(Math.min(image.height - 1, Math.floor(v * image.height)) * image.width + Math.min(image.width - 1, Math.floor(u * image.width))) * 4 + 3] : 255;

// MoGe points are already metric-scaled, in x-right/y-down/z-forward coordinates.
export function photographGeometry(depth, { image, depthEdge = .08 } = {}) {
  const { width, height, points, normals } = depth ?? {};
  if (!Number.isInteger(width) || width < 2 || !Number.isInteger(height) || height < 2 || points?.length !== width * height * 3) throw Error('Photograph requires the MoGe points grid');
  if (!Number.isFinite(depthEdge) || depthEdge <= 0) throw Error('Invalid photograph depth edge');
  if (image) rgba(image);
  const count = width * height, valid = new Uint8Array(count), faces = [];
  for (let i = 0; i < count; i++) valid[i] = Number.isFinite(points[3*i]) && Number.isFinite(points[3*i+1]) &&
    Number.isFinite(points[3*i+2]) && points[3*i+2] > 0 && alphaAt(image, (i%width+.5)/width, (Math.floor(i/width)+.5)/height) >= 128;
  const triangle = (a,b,c) => {
    if (!valid[a] || !valid[b] || !valid[c]) return;
    const lo = Math.min(points[3*a+2], points[3*b+2], points[3*c+2]), hi = Math.max(points[3*a+2], points[3*b+2], points[3*c+2]);
    if ((hi-lo)/lo <= depthEdge) faces.push(a,b,c);
  };
  for (let y=0; y<height-1; y++) for (let x=0; x<width-1; x++) {
    const a=y*width+x, b=a+1, c=a+width, d=c+1;
    triangle(a,c,b); triangle(b,c,d);
  }
  if (!faces.length) throw Error('Photograph has no usable triangles');
  const used=new Uint8Array(count); for (const i of faces) used[i]=1;
  const remap=new Uint32Array(count), size=used.reduce((a,b)=>a+b,0);
  const positions=new Float32Array(size*3), vertexNormals=new Float32Array(size*3), uvs=new Float32Array(size*2);
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity]; let n=0;
  for (let i=0; i<count; i++) if (used[i]) {
    remap[i]=n;
    for (let k=0; k<3; k++) { const value=points[3*i+k]*(k ? -1 : 1); positions[3*n+k]=value; min[k]=Math.min(min[k],value); max[k]=Math.max(max[k],value); }
    const len=normals?.length===points.length ? Math.hypot(normals[3*i],normals[3*i+1],normals[3*i+2]) : 0;
    if (Number.isFinite(len) && len>0) for (let k=0; k<3; k++) vertexNormals[3*n+k]=normals[3*i+k]*(k ? -1 : 1)/len;
    uvs[2*n]=(i%width+.5)/width; uvs[2*n+1]=(Math.floor(i/width)+.5)/height; n++;
  }
  const indices=Uint32Array.from(faces,i=>remap[i]);
  // Missing/zero predicted normals use the adjacent geometry, never a guessed camera normal.
  const geometric=new Float32Array(positions.length);
  for (let f=0; f<indices.length; f+=3) {
    const a=indices[f]*3,b=indices[f+1]*3,c=indices[f+2]*3;
    const u=[0,1,2].map(k=>positions[b+k]-positions[a+k]),v=[0,1,2].map(k=>positions[c+k]-positions[a+k]);
    const cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    for (const i of [a,b,c]) for (let k=0;k<3;k++) geometric[i+k]+=cross[k];
  }
  for(let i=0;i<vertexNormals.length;i+=3) if(!Math.hypot(...vertexNormals.subarray(i,i+3))) {
    const length=Math.hypot(...geometric.subarray(i,i+3));
    if(!length)throw Error('Photograph contains degenerate surface normals');
    for(let k=0;k<3;k++)vertexNormals[i+k]=geometric[i+k]/length;
  }
  return {positions,normals:vertexNormals,uvs,indices,min,max};
}

export async function encodePhotographPng(map) {
  rgba(map);
  const canvas=new OffscreenCanvas(map.width,map.height);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.data),map.width,map.height),0,0);
  return new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
}

export async function photographGlb({depth,maps,image}, {name='Material photograph',receipt=null,depthEdge=.08,encodePng=encodePhotographPng}={}) {
  const geometry=photographGeometry(depth,{image,depthEdge});
  rgba(maps?.albedo); rgba(maps?.orm);
  const albedo={...maps.albedo,data:new Uint8ClampedArray(maps.albedo.data)};
  const masked=image&&image.data.some((value,index)=>index%4===3&&value<255);
  for(let y=0;y<albedo.height;y++)for(let x=0;x<albedo.width;x++)albedo.data[(y*albedo.width+x)*4+3]=alphaAt(image,(x+.5)/albedo.width,(y+.5)/albedo.height);
  const chunks=[],bufferViews=[],accessors=[]; let length=0;
  const append=(bytes,target)=>{const byteOffset=(length+3)&~3; chunks.push([byteOffset,bytes]); length=byteOffset+bytes.length;
    bufferViews.push({buffer:0,byteOffset,byteLength:bytes.length,...(target?{target}:{})});return bufferViews.length-1;};
  const accessor=(array,type,width,componentType,target,extra={})=>{accessors.push({bufferView:append(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),target),componentType,count:array.length/width,type,...extra});return accessors.length-1;};
  const attributes={POSITION:accessor(geometry.positions,'VEC3',3,5126,34962,{min:geometry.min,max:geometry.max}),
    NORMAL:accessor(geometry.normals,'VEC3',3,5126,34962),TEXCOORD_0:accessor(geometry.uvs,'VEC2',2,5126,34962)};
  const indices=accessor(geometry.indices,'SCALAR',1,5125,34963);
  const images=[];for(const map of [albedo,maps.orm])images.push({bufferView:append(await encodePng(map)),mimeType:'image/png'});
  const bin=new Uint8Array((length+3)&~3);for(const [offset,bytes] of chunks)bin.set(bytes,offset);
  const sourceCenter=geometry.min.map((value,k)=>(value+geometry.max[k])/2);
  return encodeGlb({asset:{version:'2.0',generator:'Kaminos Material Photograph',extras:{photograph:{...receipt,frame:'moge-x-negative-y-negative-z',sourceCenter,depthEdge,representation:'open-surface'}}},
    scene:0,scenes:[{nodes:[0]}],nodes:[{name,mesh:0,translation:sourceCenter.map(v=>-v)}],meshes:[{name,primitives:[{attributes,indices,material:0}]}],
    materials:[{name:'Inferred materials',doubleSided:true,alphaMode:masked?'MASK':'OPAQUE',...(masked?{alphaCutoff:.5}:{}),
      pbrMetallicRoughness:{baseColorTexture:{index:0},metallicRoughnessTexture:{index:1},metallicFactor:1,roughnessFactor:1}}],
    textures:[{sampler:0,source:0},{sampler:0,source:1}],samplers:[{wrapS:33071,wrapT:33071,magFilter:9729,minFilter:9987}],
    images,accessors,bufferViews,buffers:[{byteLength:bin.length}]},bin).buffer;
}
