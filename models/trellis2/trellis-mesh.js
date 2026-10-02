// Geometry consumer, not another model or CPU inference fallback. The learned
// decoder owns its GPU tensors; mesh extraction reads them after completion.
import { WEBGPU_BUFFER_USAGE as U } from '../../webgpu-inference-kit/src/core.js';
const offsets = [ [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] ];
const splits = [[0,1,2,0,2,3],[0,1,3,3,1,2]], f = Math.fround;
const sigmoid = x => f(1 / f(1 + f(Math.exp(-x))));
const softplus = x => x > 20 ? x : f(Math.log1p(f(Math.exp(x))));

export function extractTrellisDualGridMesh({ features, coordinates, resolution, voxelMargin = .5 }) {
  if (!(features instanceof Float32Array) || !(coordinates instanceof Int32Array) || coordinates.length % 3 ||
    features.length !== coordinates.length / 3 * 7) throw TypeError('complete F32[N,7] features and Int32[N,3] coordinates required');
  if (!Number.isSafeInteger(resolution) || resolution < 1 || !Number.isSafeInteger(resolution ** 3) ||
    !Number.isFinite(voxelMargin) || voxelMargin < 0) throw RangeError('finite dual-grid geometry required');
  if (!features.every(Number.isFinite)) throw TypeError('finite learned geometry channels required');
  const rows = coordinates.length / 3, map = new Map(), weights = new Float32Array(rows);
  const key = (z,y,x) => (z * resolution + y) * resolution + x;
  for (let row=0;row<rows;row++) {
    const [z,y,x] = coordinates.subarray(row*3,row*3+3);
    if ([z,y,x].some(v => v < 0 || v >= resolution)) throw RangeError('learned coordinate outside decoder grid');
    const code = key(z,y,x);if (map.has(code)) throw Error('duplicate learned geometry coordinate');
    map.set(code,row);weights[row]=softplus(features[row*7+6]);
  }
  const quads=[];let intersectedEdges=0;
  for (let row=0;row<rows;row++) for (let direction=0;direction<3;direction++) {
    if (!(features[row*7+3+direction] > 0)) continue;intersectedEdges++;
    const indices=[];
    for (const delta of offsets[direction]) {
      const z=coordinates[row*3]+delta[0], y=coordinates[row*3+1]+delta[1], x=coordinates[row*3+2]+delta[2];
      const neighbor = z < resolution && y < resolution && x < resolution ? map.get(key(z,y,x)) : undefined;
      if (neighbor === undefined) break;indices.push(neighbor);
    }
    if (indices.length === 4) quads.push(...indices);
  }
  const quadCount=quads.length/4, metadata={ resolution,voxelMargin,coordinateOrder:'source-z-y-x-as-position-components',
    topology:'source-row-edge-direction-order/strict-positive-flags/strict-greater-F32-weight-product',
    pointwiseRoute:'javascript-exp-log1p-with-source-F32-operation-boundaries',
    pointwiseLimit:'Not bit-exact source CUDA exponential; matched-input mesh comparison required.' };
  if (!quadCount) return {status:'no-surface',vertices:new Float32Array(),triangles:new Uint32Array(),quadCount,intersectedEdges,metadata};
  const vertices=new Float32Array(rows*3),triangles=new Uint32Array(quadCount*6),size=f(1/resolution),scale=f(1+2*voxelMargin);
  for (let row=0;row<rows;row++) for (let axis=0;axis<3;axis++) {
    const offset=f(f(scale*sigmoid(features[row*7+axis]))-voxelMargin);
    vertices[row*3+axis]=f(f(f(coordinates[row*3+axis]+offset)*size)-.5);
  }
  for (let q=0;q<quadCount;q++) {
    const a=quads[q*4],b=quads[q*4+1],c=quads[q*4+2],d=quads[q*4+3],
      split=splits[f(weights[a]*weights[c]) > f(weights[b]*weights[d]) ? 0 : 1];
    for (let i=0;i<6;i++) triangles[q*6+i]=quads[q*4+split[i]];
  }
  return {status:'surface',vertices,triangles,quadCount,intersectedEdges,metadata};
}

export function createTrellisMeshAdapter({ runtime, decoded }) {
  if (!runtime?.readTensor) throw TypeError('actual decoder runtime required');
  const a=decoded?.features,b=decoded?.coordinates,n=a?.shape?.[0];
  if (!a?.buffer || !b?.buffer || a.dtype !== 'f32' || b.dtype !== 'i32' || !(a.usage & U.storage) || !(b.usage & U.storage) ||
    !Number.isSafeInteger(n) || n < 1 || JSON.stringify(a.shape)!==JSON.stringify([n,7]) || JSON.stringify(b.shape)!==JSON.stringify([n,3]) ||
    a.byteLength!==n*28 || b.byteLength!==n*12 || !Number.isSafeInteger(decoded.resolution)) throw TypeError('complete borrowed learned geometry tensors required');
  let status='new',output;
  return Object.freeze({ inputs:Object.freeze({features:a,coordinates:b}),
    async run() {
      if (status !== 'new') throw Error('mesh consumer is '+status);status='running';
      try {
        await runtime.device?.queue?.onSubmittedWorkDone?.();
        const features=await runtime.readTensor(a),coordinates=await runtime.readTensor(b);
        if (!(features instanceof ArrayBuffer) || !(coordinates instanceof ArrayBuffer) || features.byteLength!==a.byteLength ||
          coordinates.byteLength!==b.byteLength) throw Error('complete post-decoder geometry readback required');
        output=extractTrellisDualGridMesh({features:new Float32Array(features),coordinates:new Int32Array(coordinates),resolution:decoded.resolution});
        output.handoff={phase:'post-decoder-geometry-consumer',featureBytesToCPU:a.byteLength,coordinateBytesToCPU:b.byteLength,
          input:'exact borrowed decoder tensors; no NPZ or fixture replacement'};status='completed';return output;
      } catch(error) { status='failed';throw error; }
    },get output(){return output;},dispose(){if(status==='running')throw Error('mesh consumer is running');status='disposed';}
  });
}

// Offline matched-input conversion predicate, not a decoder tolerance waiver.
// 1.2e-7 is two F32 world-position ULPs near the source half-unit AABB.
export function compareTrellisMeshes(actual, expected) {
  const report={passed:false,vertexAbsoluteTolerance:1.2e-7,topology:'exact source triangle indices/order',vertexFailures:0,triangleFailures:0,maxVertexAbsoluteError:0};
  for(const name of ['vertices','triangles']) {
    const type=name==='vertices'?Float32Array:Uint32Array;
    if(!(actual?.[name] instanceof type)||!(expected?.[name] instanceof type)||!actual[name].length||
      actual[name].length!==expected[name].length||actual[name].length%3) return {...report,error:'complete same-support '+name+' required'};
  }
  for(let i=0;i<actual.vertices.length;i++) {
    const error=Math.abs(actual.vertices[i]-expected.vertices[i]);
    if(!Number.isFinite(error)||error>report.vertexAbsoluteTolerance) report.vertexFailures++;
    report.maxVertexAbsoluteError=Math.max(report.maxVertexAbsoluteError,error);
  }
  for(let i=0;i<actual.triangles.length;i++) if(actual.triangles[i]!==expected.triangles[i]) report.triangleFailures++;
  return {...report,passed:report.vertexFailures===0&&report.triangleFailures===0,
    vertexCount:actual.vertices.length/3,triangleCount:actual.triangles.length/3};
}

export function encodeTrellisGeometryGLB(mesh,{provenance={}}={}) {
  const {vertices,triangles}=mesh??{},n=vertices?.length/3;
  if (!(vertices instanceof Float32Array) || !(triangles instanceof Uint32Array) || !n || vertices.length%3 ||
    !triangles.length || triangles.length%3) throw Error('nonempty triangle surface required for geometry GLB');
  if (!vertices.every(Number.isFinite) || !triangles.every(i=>i<n)) throw Error('invalid surface coordinates or triangle indices');
  const normals=new Float32Array(vertices.length),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i++){min[i%3]=Math.min(min[i%3],vertices[i]);max[i%3]=Math.max(max[i%3],vertices[i]);}
  for(let i=0;i<triangles.length;i+=3){
    const a=triangles[i]*3,b=triangles[i+1]*3,c=triangles[i+2]*3,
      u=[vertices[b]-vertices[a],vertices[b+1]-vertices[a+1],vertices[b+2]-vertices[a+2]],
      v=[vertices[c]-vertices[a],vertices[c+1]-vertices[a+1],vertices[c+2]-vertices[a+2]],
      cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    for(const base of [a,b,c])for(let axis=0;axis<3;axis++)normals[base+axis]+=cross[axis];
  }
  for(let i=0;i<normals.length;i+=3){const length=Math.hypot(normals[i],normals[i+1],normals[i+2]);
    if(length)for(let axis=0;axis<3;axis++)normals[i+axis]/=length;
    else normals[i+2]=1; // Unit fallback only where topology supplies no normal; preserve all source vertices/indices.
  }
  const views=[{buffer:0,byteOffset:0,byteLength:vertices.byteLength,target:34962},
    {buffer:0,byteOffset:vertices.byteLength,byteLength:triangles.byteLength,target:34963},
    {buffer:0,byteOffset:vertices.byteLength+triangles.byteLength,byteLength:normals.byteLength,target:34962}],
    binLength=vertices.byteLength+triangles.byteLength+normals.byteLength,
    document={asset:{version:'2.0',generator:'Kaminos TRELLIS2 geometry consumer'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],
      meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:2},indices:1,material:0,mode:4}]}],
      materials:[{name:'Geometry diagnostic — no learned material',pbrMetallicRoughness:{baseColorFactor:[.65,.65,.65,1],metallicFactor:0,roughnessFactor:1}}],
      buffers:[{byteLength:binLength}],bufferViews:views,accessors:[{bufferView:0,componentType:5126,count:n,type:'VEC3',min,max},
        {bufferView:1,componentType:5125,count:triangles.length,type:'SCALAR'},{bufferView:2,componentType:5126,count:n,type:'VEC3'}],
      extras:{trellis:{stage:'learned-geometry-only',material:'diagnostic neutral; not texture-decoder/PBR evidence',
        normals:'area-weighted unit; +Z only for zero accumulated area',provenance,geometry:mesh.metadata}}},
    json=new TextEncoder().encode(JSON.stringify(document)),jsonLength=Math.ceil(json.byteLength/4)*4,
    buffer=new ArrayBuffer(12+8+jsonLength+8+binLength),header=new DataView(buffer),bytes=new Uint8Array(buffer),binStart=28+jsonLength;
  header.setUint32(0,0x46546c67,true);header.setUint32(4,2,true);header.setUint32(8,buffer.byteLength,true);
  header.setUint32(12,jsonLength,true);header.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);
  header.setUint32(20+jsonLength,binLength,true);header.setUint32(24+jsonLength,0x004e4942,true);
  bytes.set(new Uint8Array(vertices.buffer,vertices.byteOffset,vertices.byteLength),binStart);
  bytes.set(new Uint8Array(triangles.buffer,triangles.byteOffset,triangles.byteLength),binStart+vertices.byteLength);
  bytes.set(new Uint8Array(normals.buffer),binStart+vertices.byteLength+triangles.byteLength);
  return buffer;
}
