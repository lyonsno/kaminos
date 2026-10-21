// Binary glTF reading and writing for polygon editing: triangle primitives
// with their attributes and node placement, without a renderer.
const MAGIC=0x46546c67,JSON_CHUNK=0x4e4f534a,BIN_CHUNK=0x004e4942;
const COMPONENT={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array};
const NORMALIZE={5120:v=>Math.max(v/127,-1),5121:v=>v/255,5122:v=>Math.max(v/32767,-1),5123:v=>v/65535};
const WIDTH={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16};
const LITTLE_ENDIAN=new Uint8Array(new Uint16Array([1]).buffer)[0]===1;
const GETTER={5120:'getInt8',5121:'getUint8',5122:'getInt16',5123:'getUint16',5125:'getUint32',5126:'getFloat32'};

export function encodeGlb(json,bin=new Uint8Array()) {
  const text=new TextEncoder().encode(JSON.stringify(json)),jsonLength=text.length+3&~3,binLength=bin.length+3&~3;
  const total=20+jsonLength+(bin.length?8+binLength:0),out=new Uint8Array(total),view=new DataView(out.buffer);
  view.setUint32(0,MAGIC,true);view.setUint32(4,2,true);view.setUint32(8,total,true);
  view.setUint32(12,jsonLength,true);view.setUint32(16,JSON_CHUNK,true);out.set(text,20);out.fill(0x20,20+text.length,20+jsonLength);
  if(bin.length){const o=20+jsonLength;view.setUint32(o,binLength,true);view.setUint32(o+4,BIN_CHUNK,true);out.set(bin,o+8);}
  return out;
}

export function parseGlb(bytes) {
  const data=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes);
  const view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(data.length<12||view.getUint32(0,true)!==MAGIC)throw Error('Not a binary glTF file');
  if(view.getUint32(4,true)!==2)throw Error('Only glTF 2.0 binaries are supported');
  const length=view.getUint32(8,true);if(length>data.length)throw Error('Binary glTF is truncated');
  let offset=12,json=null,bin=null;
  while(offset+8<=length){
    const size=view.getUint32(offset,true),type=view.getUint32(offset+4,true),start=offset+8;
    if(start+size>length)throw Error('Binary glTF chunk is truncated');
    if(type===JSON_CHUNK&&!json)json=JSON.parse(new TextDecoder().decode(data.subarray(start,start+size)));
    else if(type===BIN_CHUNK&&!bin)bin=data.subarray(start,start+size);
    offset=start+size;
  }
  if(!json)throw Error('Binary glTF has no JSON chunk');
  return {json,bin:bin??new Uint8Array()};
}

export function readAccessor(json,bin,index) {
  const accessor=json.accessors?.[index];
  if(!accessor)throw Error(`glTF accessor ${index} is missing`);
  if(accessor.sparse)throw Error('Sparse glTF accessors are not supported');
  const Type=COMPONENT[accessor.componentType],width=WIDTH[accessor.type];
  if(!Type||!width)throw Error(`glTF accessor ${index} has an unsupported layout`);
  const normalized=accessor.normalized&&NORMALIZE[accessor.componentType],out=new (normalized?Float32Array:Type)(accessor.count*width);
  if(accessor.bufferView===undefined)return out;
  const view=json.bufferViews?.[accessor.bufferView];
  if(!view||view.buffer!==0)throw Error('Only the embedded glTF binary buffer is supported');
  const size=Type.BYTES_PER_ELEMENT,stride=view.byteStride||size*width,base=(view.byteOffset??0)+(accessor.byteOffset??0);
  if(accessor.count&&base+stride*(accessor.count-1)+size*width>(view.byteOffset??0)+view.byteLength)throw Error(`glTF accessor ${index} overruns its buffer view`);
  // Packed, aligned, unnormalized data on a little-endian platform copies as it lies.
  if(LITTLE_ENDIAN&&!normalized&&stride===size*width&&(bin.byteOffset+base)%size===0){out.set(new Type(bin.buffer,bin.byteOffset+base,accessor.count*width));return out;}
  const data=new DataView(bin.buffer,bin.byteOffset,bin.byteLength),get=data[GETTER[accessor.componentType]].bind(data);
  for(let i=0;i<accessor.count;i++)for(let k=0;k<width;k++){const v=get(base+i*stride+k*size,true);out[i*width+k]=normalized?normalized(v):v;}
  return out;
}

function multiply(a,b){const out=new Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[4*c+r]+=a[4*k+r]*b[4*c+k];return out;}
function localMatrix(node){
  if(node.matrix)return [...node.matrix];
  const [x,y,z,w]=node.rotation??[0,0,0,1],[sx,sy,sz]=node.scale??[1,1,1],[tx,ty,tz]=node.translation??[0,0,0];
  return [(1-2*(y*y+z*z))*sx,2*(x*y+z*w)*sx,2*(x*z-y*w)*sx,0, 2*(x*y-z*w)*sy,(1-2*(x*x+z*z))*sy,2*(y*z+x*w)*sy,0, 2*(x*z+y*w)*sz,2*(y*z-x*w)*sz,(1-2*(x*x+y*y))*sz,0, tx,ty,tz,1];
}
export function nodeWorldMatrices(json) {
  const nodes=json.nodes??[],parent=new Map(),world=new Map();
  nodes.forEach((node,i)=>(node.children??[]).forEach(child=>parent.set(child,i)));
  const resolve=(i,seen=new Set())=>{
    if(world.has(i))return world.get(i);
    if(seen.has(i))throw Error('glTF node hierarchy has a cycle');seen.add(i);
    const local=localMatrix(nodes[i]),m=parent.has(i)?multiply(resolve(parent.get(i),seen),local):local;
    world.set(i,m);return m;
  };
  return nodes.map((_,i)=>resolve(i));
}

export function readTrianglePrimitives(bytes) {
  const {json,bin}=parseGlb(bytes),worlds=nodeWorldMatrices(json),out=[];
  (json.meshes??[]).forEach((mesh,m)=>mesh.primitives.forEach((primitive,p)=>{
    if((primitive.mode??4)!==4)return;
    const {POSITION,NORMAL,TEXCOORD_0}=primitive.attributes;
    if(POSITION===undefined)throw Error(`glTF mesh ${m} primitive ${p} has no positions`);
    const nodes=(json.nodes??[]).flatMap((node,i)=>node.mesh===m?[i]:[]);
    out.push({mesh:m,primitive:p,material:primitive.material??null,nodes,worldMatrices:nodes.map(i=>worlds[i]),
      positions:Float32Array.from(readAccessor(json,bin,POSITION)),
      normals:NORMAL===undefined?null:Float32Array.from(readAccessor(json,bin,NORMAL)),
      uvs:TEXCOORD_0===undefined?null:Float32Array.from(readAccessor(json,bin,TEXCOORD_0)),
      indices:primitive.indices===undefined?null:Uint32Array.from(readAccessor(json,bin,primitive.indices))});
  }));
  return out;
}

export const CUT_CAP_MATERIAL=Object.freeze({name:'Cut cap',pbrMetallicRoughness:{baseColorFactor:[.42,.4,.38,1],metallicFactor:.6,roughnessFactor:.55},doubleSided:true});

// A part derived from a source GLB: the source material, textures, samplers and
// embedded images carry over byte for byte, so preserved UVs keep sampling the
// same atlas. Faces with material 1 use an explicit cap material. The receipt
// travels in asset.extras so the file says what it was cut from.
export function writeDerivedGlb(sourceBytes,part,{name='Part',receipt=null,nodeMatrix=null,sourceMaterial=0,capMaterial=CUT_CAP_MATERIAL}={}) {
  const {json:src,bin:srcBin}=parseGlb(sourceBytes),faceCount=part.indices.length/3,slots=part.faceMaterial??new Uint8Array(faceCount);
  for(const slot of slots)if(slot>1)throw Error(`Derived part face material ${slot} has no slot; use 0 for the source material and 1 for caps`);
  const chunks=[],bufferViews=[],accessors=[];let length=0;
  const append=(bytes,target)=>{const byteOffset=length+3&~3;chunks.push([byteOffset,bytes]);length=byteOffset+bytes.length;bufferViews.push({buffer:0,byteOffset,byteLength:bytes.length,...(target?{target}:{})});return bufferViews.length-1;};
  const images=(src.images??[]).map(image=>{
    if(image.bufferView===undefined)return {...image};
    const view=src.bufferViews[image.bufferView],start=view.byteOffset??0;
    return {...image,bufferView:append(srcBin.subarray(start,start+view.byteLength))};
  });
  const accessor=(array,type,componentType,target,extra={})=>{accessors.push({bufferView:append(new Uint8Array(array.buffer,array.byteOffset,array.byteLength),target),componentType,count:array.length/WIDTH[type],type,...extra});return accessors.length-1;};
  const P=part.positions,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<P.length;i++){min[i%3]=Math.min(min[i%3],P[i]);max[i%3]=Math.max(max[i%3],P[i]);}
  const attributes={POSITION:accessor(Float32Array.from(P),'VEC3',5126,34962,{min,max})};
  if(part.normals)attributes.NORMAL=accessor(Float32Array.from(part.normals),'VEC3',5126,34962);
  if(part.uvs)attributes.TEXCOORD_0=accessor(Float32Array.from(part.uvs),'VEC2',5126,34962);
  const primitives=[0,1].flatMap(slot=>{
    const faces=[];for(let f=0;f<faceCount;f++)if(slots[f]===slot)faces.push(f);
    if(!faces.length)return [];
    const indices=new Uint32Array(faces.length*3);faces.forEach((f,j)=>indices.set(part.indices.subarray(3*f,3*f+3),3*j));
    return [{attributes,indices:accessor(indices,'SCALAR',5125,34963),material:slot}];
  });
  const bin=new Uint8Array(length+3&~3);for(const [offset,bytes] of chunks)bin.set(bytes,offset);
  const json={asset:{version:'2.0',generator:'Kaminos polygon tools',...(receipt?{extras:{kaminosDerivation:receipt}}:{})},scene:0,scenes:[{nodes:[0]}],
    nodes:[{name,mesh:0,...(nodeMatrix?{matrix:[...nodeMatrix]}:{})}],meshes:[{name,primitives}],
    materials:[src.materials?.[sourceMaterial]??{name:'Source'},capMaterial],
    ...(src.textures?{textures:src.textures}:{}),...(src.samplers?{samplers:src.samplers}:{}),...(images.length?{images}:{}),
    accessors,bufferViews,buffers:[{byteLength:bin.length}]};
  return encodeGlb(json,bin);
}
