// TRELLIS output drawn as surfels: one small oriented triangle per surface voxel of the decoded field,
// coloured from the material voxels. The field is kept compactly (about 14 bytes a surfel) and travels
// as a GLB in the ordinary mesh store; a GLTFLoader plugin turns it back into a scene object.
//
// Space: "source space" is the space of TRELLIS's raw extracted mesh, cells of size 1/resolution
// spanning [-0.5, 0.5] on each axis, components in the decoder's coordinate order. Surfel GLBs
// carry the same node matrix as TRELLIS mesh GLBs, so the two line up exactly; the extension's `frame`
// names this space and that matrix, for consumers that place derived geometry (GI proxies) beside surfels.
//
// Per surfel: cell (u32: 9 bits per axis), offset from the cell centre (3 x i8, units of 1/127 voxel,
// within +-1 voxel as the dual-grid vertex is), octahedral normal (2 x u8), sRGB colour (3 x u8),
// metallic and roughness (2 x u8). Alpha is recorded as a range only. The cells are the decoded field's
// surface shell (TRELLIS decodes no interior), declared as occupancy 'surface' so no consumer reads them as mass.

export const SURFEL_EXTENSION='KAMINOS_trellis_surfels';
const MESH_NODE_MATRIX=[1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1]; // as encodeTrellisGeometryGLB: (x,y,z) -> (x,z,-y)
const MAX_RESOLUTION=512;
const pack=(a,b,c)=>(a|(b<<9)|(c<<18))>>>0;
const unpack=k=>[k&511,(k>>>9)&511,(k>>>18)&511];
const byte=v=>Math.max(0,Math.min(255,Math.round(v*255)));

function octEncode(x,y,z,out,i){
  const s=Math.abs(x)+Math.abs(y)+Math.abs(z)||1;let u=x/s,v=y/s;
  if(z<0){const pu=u,pv=v;u=(1-Math.abs(pv))*Math.sign(pu||1);v=(1-Math.abs(pu))*Math.sign(pv||1);}
  out[i]=Math.round((u*.5+.5)*255);out[i+1]=Math.round((v*.5+.5)*255);
}
function octDecode(a,b,out,i){
  let u=a/255*2-1,v=b/255*2-1;const z=1-Math.abs(u)-Math.abs(v);
  if(z<0){const pu=u,pv=v;u=(1-Math.abs(pv))*Math.sign(pu||1);v=(1-Math.abs(pu))*Math.sign(pv||1);}
  const l=Math.hypot(u,v,z)||1;out[i]=u/l;out[i+1]=v/l;out[i+2]=z/l;
}

// vertices/triangles: TRELLIS's raw dual-grid mesh (vertex i belongs to geometry row i).
// geometryCoordinates: Int32[N,3], the decoder rows the vertices came from.
// material: {features: F32[M,6] r,g,b,metallic,roughness,alpha; coordinates: Int32[M,3]; resolution}.
// materialEncoding: 'signed' for the page decoder's [-1,1] channels, 'unit' for already-mapped [0,1].
export function buildSurfelField({vertices,triangles,geometryCoordinates,material,materialEncoding='signed'}){
  const n=geometryCoordinates?.length/3,res=material?.resolution;
  if(!(vertices instanceof Float32Array)||!(geometryCoordinates instanceof Int32Array)||!Number.isSafeInteger(n)||n<1||vertices.length!==n*3)
    throw TypeError('one raw vertex per geometry row required');
  if(!(triangles instanceof Uint32Array)||triangles.length%3)throw TypeError('Uint32 triangles required');
  if(!Number.isSafeInteger(res)||res<1||res>MAX_RESOLUTION)throw RangeError(`resolution 1..${MAX_RESOLUTION} required`);
  const mc=material.coordinates,mf=material.features,m=mc?.length/3;
  if(!(mc instanceof Int32Array)||!(mf instanceof Float32Array)||!Number.isSafeInteger(m)||mf.length!==m*6)
    throw TypeError('complete Int32[M,3] material coordinates and F32[M,6] features required');
  if(!['signed','unit'].includes(materialEncoding))throw TypeError('materialEncoding is signed or unit');
  const materialRow=new Map();
  for(let r=0;r<m;r++)materialRow.set(pack(mc[r*3],mc[r*3+1],mc[r*3+2]),r);
  // area-weighted vertex normals over the raw triangles (winding is not guaranteed; drawn double-sided)
  const acc=new Float64Array(n*3);
  for(let t=0;t<triangles.length;t+=3){
    const a=triangles[t]*3,b=triangles[t+1]*3,c=triangles[t+2]*3;
    const ux=vertices[b]-vertices[a],uy=vertices[b+1]-vertices[a+1],uz=vertices[b+2]-vertices[a+2];
    const vx=vertices[c]-vertices[a],vy=vertices[c+1]-vertices[a+1],vz=vertices[c+2]-vertices[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const i of [a,b,c]){acc[i]+=nx;acc[i+1]+=ny;acc[i+2]+=nz;}
  }
  const cells=new Uint32Array(n),offsets=new Int8Array(n*3),normals=new Uint8Array(n*2),color=new Uint8Array(n*3),metalRough=new Uint8Array(n*2);
  const map=materialEncoding==='signed'?v=>v*.5+.5:v=>v;let aMin=Infinity,aMax=-Infinity;
  for(let i=0;i<n;i++){
    const c0=geometryCoordinates[i*3],c1=geometryCoordinates[i*3+1],c2=geometryCoordinates[i*3+2];
    if([c0,c1,c2].some(v=>v<0||v>=res))throw RangeError('geometry coordinate outside the grid');
    const key=pack(c0,c1,c2),row=materialRow.get(key);
    if(row===undefined)throw Error(`surface voxel ${c0},${c1},${c2} has no material voxel`);
    cells[i]=key;
    for(let a=0;a<3;a++){const o=(vertices[i*3+a]+.5)*res-([c0,c1,c2][a]+.5);offsets[i*3+a]=Math.max(-127,Math.min(127,Math.round(o*127)));}
    const nx=acc[i*3],ny=acc[i*3+1],nz=acc[i*3+2];
    if(nx||ny||nz)octEncode(nx,ny,nz,normals,i*2);else octEncode(0,0,1,normals,i*2);
    for(let k=0;k<3;k++)color[i*3+k]=byte(map(mf[row*6+k]));
    metalRough[i*2]=byte(map(mf[row*6+3]));metalRough[i*2+1]=byte(map(mf[row*6+4]));
    const al=map(mf[row*6+5]);aMin=Math.min(aMin,al);aMax=Math.max(aMax,al);
  }
  return {resolution:res,count:n,cells,offsets,normals,color,metalRough,alpha:{min:aMin,max:aMax},radiusVoxels:.8};
}

export function surfelPositions(field){
  const {count,cells,offsets,resolution:res}=field,out=new Float32Array(count*3);
  for(let i=0;i<count;i++){const c=unpack(cells[i]);for(let a=0;a<3;a++)out[i*3+a]=(c[a]+.5+offsets[i*3+a]/127)/res-.5;}
  return out;
}
export function surfelNormals(field){
  const out=new Float32Array(field.count*3);
  for(let i=0;i<field.count;i++)octDecode(field.normals[i*2],field.normals[i*2+1],out,i*3);
  return out;
}

// Average each k-cube of surfels into one. parent[i] is the merged surfel source surfel i belongs to.
export function mergeSurfelLevel(field,factor){
  if(!Number.isSafeInteger(factor)||factor<1)throw RangeError('integer merge factor required');
  const res=Math.ceil(field.resolution/factor),pos=surfelPositions(field),nor=surfelNormals(field);
  const index=new Map(),parent=new Uint32Array(field.count),sums=[];
  for(let i=0;i<field.count;i++){
    const c=unpack(field.cells[i]),key=pack(Math.floor(c[0]/factor),Math.floor(c[1]/factor),Math.floor(c[2]/factor));
    let j=index.get(key);if(j===undefined){j=sums.length;index.set(key,j);sums.push({key,n:0,p:[0,0,0],nv:[0,0,0],col:[0,0,0],mr:[0,0]});}
    const s=sums[j];parent[i]=j;s.n++;
    for(let a=0;a<3;a++){s.p[a]+=pos[i*3+a];s.nv[a]+=nor[i*3+a];s.col[a]+=field.color[i*3+a];}
    s.mr[0]+=field.metalRough[i*2];s.mr[1]+=field.metalRough[i*2+1];
  }
  const count=sums.length,out={resolution:res,count,cells:new Uint32Array(count),offsets:new Int8Array(count*3),normals:new Uint8Array(count*2),
    color:new Uint8Array(count*3),metalRough:new Uint8Array(count*2),alpha:field.alpha,radiusVoxels:field.radiusVoxels};
  for(let j=0;j<count;j++){
    const s=sums[j],c=unpack(s.key);out.cells[j]=s.key;
    for(let a=0;a<3;a++){const o=((s.p[a]/s.n)+.5)*res-(c[a]+.5);out.offsets[j*3+a]=Math.max(-127,Math.min(127,Math.round(o*127)));
      out.color[j*3+a]=Math.round(s.col[a]/s.n);}
    octEncode(s.nv[0]||0,s.nv[1]||0,(s.nv[0]||s.nv[1]||s.nv[2])?s.nv[2]:1,out.normals,j*2);
    out.metalRough[j*2]=Math.round(s.mr[0]/s.n);out.metalRough[j*2+1]=Math.round(s.mr[1]/s.n);
  }
  return {field:out,parent};
}

// First occupied cell along a source-space ray (Amanatides-Woo walk through the voxel grid).
export function pickSurfelField(field,origin,direction,occupancy=occupancyOf(field)){
  const res=field.resolution,size=1/res,o=origin.map(v=>(v+.5)*res),d=direction;
  let t0=0,t1=Infinity;
  for(let a=0;a<3;a++){
    if(Math.abs(d[a])<1e-12){if(o[a]<0||o[a]>res)return null;continue;}
    let ta=(0-o[a])/d[a],tb=(res-o[a])/d[a];if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb);
  }
  if(t0>t1)return null;
  const p=[0,1,2].map(a=>o[a]+d[a]*t0),cell=p.map(v=>Math.min(res-1,Math.max(0,Math.floor(v))));
  const step=d.map(v=>v>0?1:v<0?-1:0),next=[0,1,2].map(a=>step[a]?((cell[a]+(step[a]>0?1:0))-o[a])/d[a]:Infinity);
  const delta=d.map(v=>v?Math.abs(1/v):Infinity);let t=t0;
  for(let guard=0;guard<res*3+3;guard++){
    if(occupancy.has(pack(cell[0],cell[1],cell[2])))return {t:t*size,cell:cell.slice()};
    const a=next[0]<next[1]?(next[0]<next[2]?0:2):(next[1]<next[2]?1:2);
    t=next[a];next[a]+=delta[a];cell[a]+=step[a];if(cell[a]<0||cell[a]>=res)return null;
  }
  return null;
}
function occupancyOf(field){const s=new Set();for(const k of field.cells)s.add(k);return s;}

// ---------- GLB container ----------
const FIELD_ARRAYS=[['cells',Uint32Array,5125,1],['offsets',Int8Array,5120,3],['normals',Uint8Array,5121,2],['color',Uint8Array,5121,3],['metalRough',Uint8Array,5121,2]];

export function encodeSurfelGLB(field,{provenance={},fallbackFactor=4}={}){
  const chunks=[],views=[],accessors=[];let length=0;
  const add=(bytes,{target}={})=>{const pad=(4-length%4)%4;if(pad){chunks.push(new Uint8Array(pad));length+=pad;}
    views.push({buffer:0,byteOffset:length,byteLength:bytes.byteLength,...(target?{target}:{})});chunks.push(new Uint8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength));length+=bytes.byteLength;return views.length-1;};
  const ext={version:1,frame:{name:'trellis-source',extent:[-.5,.5],cellSize:1/field.resolution,nodeMatrix:MESH_NODE_MATRIX},occupancy:'surface',resolution:field.resolution,count:field.count,radiusVoxels:field.radiusVoxels,alpha:field.alpha,arrays:{}};
  for(const [name] of FIELD_ARRAYS)ext.arrays[name]=add(field[name]);
  // fallback for viewers without the extension: the coarse merged level as plain coloured triangles
  const {field:coarse}=mergeSurfelLevel(field,fallbackFactor),tri=surfelTriangles(coarse);
  const pv=add(tri.positions,{target:34962}),cv=add(tri.colors,{target:34962});
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<tri.positions.length;i++){const a=i%3;min[a]=Math.min(min[a],tri.positions[i]);max[a]=Math.max(max[a],tri.positions[i]);}
  accessors.push({bufferView:pv,componentType:5126,count:tri.positions.length/3,type:'VEC3',min,max});
  accessors.push({bufferView:cv,componentType:5121,normalized:true,count:tri.colors.length/4,type:'VEC4'});
  const json={asset:{version:'2.0',generator:'kaminos trellis-surfels'},extensionsUsed:[SURFEL_EXTENSION],scene:0,scenes:[{nodes:[0]}],
    nodes:[{name:'trellis-surfels',mesh:0,matrix:MESH_NODE_MATRIX,extensions:{[SURFEL_EXTENSION]:ext},extras:{provenance}}],
    meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},material:0}]}],
    materials:[{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.9},doubleSided:true}],
    buffers:[{byteLength:length+((4-length%4)%4)}],bufferViews:views,accessors};
  return glbBytes(json,chunks,length);
}
function glbBytes(json,chunks,length){
  const enc=new TextEncoder().encode(JSON.stringify(json)),jl=enc.length+((4-enc.length%4)%4),bl=length+((4-length%4)%4);
  const out=new Uint8Array(12+8+jl+8+bl),view=new DataView(out.buffer);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,out.length,true);
  view.setUint32(12,jl,true);view.setUint32(16,0x4e4f534a,true);out.fill(0x20,20,20+jl);out.set(enc,20);
  view.setUint32(20+jl,bl,true);view.setUint32(24+jl,0x004e4942,true);
  let o=28+jl;for(const c of chunks){out.set(c,o);o+=c.byteLength;}
  return out.buffer;
}
export function readSurfelGLBExtension(glb){
  const view=new DataView(glb),jl=view.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jl)));
  const bin=28+jl,node=json.nodes.find(n=>n.extensions?.[SURFEL_EXTENSION]);if(!node)throw Error('no surfel extension in this GLB');
  const extension=node.extensions[SURFEL_EXTENSION];
  return {json,extension,field:fieldFromViews(extension,i=>{const v=json.bufferViews[i];return glb.slice(bin+(v.byteOffset||0),bin+(v.byteOffset||0)+v.byteLength);})};
}
function fieldFromViews(extension,viewBytes){
  if(extension?.version!==1)throw Error('unsupported surfel extension version');
  const field={resolution:extension.resolution,count:extension.count,radiusVoxels:extension.radiusVoxels??.8,alpha:extension.alpha};
  for(const [name,T,,size] of FIELD_ARRAYS){const bytes=viewBytes(extension.arrays[name]);field[name]=new T(bytes);
    if(field[name].length!==field.count*size)throw Error(`surfel ${name} does not match the surfel count`);}
  return field;
}

// one triangle per surfel with the area of a disc of radius r (side 2.45 r), turned to face the normal
function surfelTriangles(field){
  const pos=surfelPositions(field),nor=surfelNormals(field),r=field.radiusVoxels/field.resolution,R=2.45*r/Math.sqrt(3);
  const positions=new Float32Array(field.count*9),colors=new Uint8Array(field.count*12);
  for(let i=0;i<field.count;i++){
    const [tx,ty,tz]=tangentFrame(nor[i*3],nor[i*3+1],nor[i*3+2],i);
    for(let k=0;k<3;k++){const a=Math.PI/2+k*2*Math.PI/3,cu=Math.cos(a)*R,su=Math.sin(a)*R;
      for(let ax=0;ax<3;ax++)positions[i*9+k*3+ax]=pos[i*3+ax]+tx[ax]*cu+ty[ax]*su;
      colors.set([linearByte(field.color[i*3]),linearByte(field.color[i*3+1]),linearByte(field.color[i*3+2]),255],i*12+k*4);}
  }
  return {positions,colors};
}
// glTF COLOR_0 is linear; the field stores sRGB bytes.
function linearByte(srgb){const c=srgb/255;return Math.round((c<=.04045?c/12.92:((c+.055)/1.055)**2.4)*255);}
function tangentFrame(nx,ny,nz,seed){
  const ref=Math.abs(nz)<.9?[0,0,1]:[1,0,0];
  let t=[ny*ref[2]-nz*ref[1],nz*ref[0]-nx*ref[2],nx*ref[1]-ny*ref[0]];const l=Math.hypot(...t)||1;t=t.map(v=>v/l);
  const b=[ny*t[2]-nz*t[1],nz*t[0]-nx*t[2],nx*t[1]-ny*t[0]];
  const roll=hashAngle(seed),c=Math.cos(roll),s=Math.sin(roll);
  return [t.map((v,i)=>v*c+b[i]*s),b.map((v,i)=>v*c-t[i]*s)];
}
function hashAngle(i){let x=(i+1)*2654435761>>>0;x^=x>>>15;x=Math.imul(x,2246822519)>>>0;x^=x>>>13;return (x/4294967296)*Math.PI*2;}

// ---------- scene object ----------
// A surfel root (a Group in source space) holds spatial chunks; each chunk is a LOD whose levels are
// InstancedMeshes of one triangle per surfel (level k merges k-cubes). Behaviour lives on classes so a
// clone (SkeletonUtils.clone) keeps it:
// - the root raycasts by walking its voxel grid (userData.raycastsAsWhole tells navigation to use it);
// - chunk LODs and chunk meshes never raycast;
// - each chunk draws the coarsest level whose surfels project to at most targetPixels, from its world
//   scale, the camera and the viewport height in drawing-buffer pixels (configureSurfelRendering).
// root.sceneGeometry offers plain triangles (the x2 merged surfels) to framing and grounding.
let viewportHeightSource=null;
export function configureSurfelRendering({viewportHeight}={}){viewportHeightSource=typeof viewportHeight==='function'?viewportHeight:null;}

const classCache=new WeakMap();
function surfelClasses(THREE){
  let c=classCache.get(THREE);if(c)return c;
  const inv=new THREE.Matrix4(),local=new THREE.Ray(),wp=new THREE.Vector3(),cp=new THREE.Vector3(),ws=new THREE.Vector3();
  class SurfelRoot extends THREE.Group{
    constructor(){super();this.isTrellisSurfelRoot=true;this.surfelField=null;this.surfelOccupancy=null;this.surfelOptions=null;this.sceneGeometry=null;}
    copy(source,recursive){super.copy(source,recursive);this.surfelField=source.surfelField;this.surfelOccupancy=source.surfelOccupancy;
      this.surfelOptions=source.surfelOptions;this.sceneGeometry=source.sceneGeometry;return this;}
    raycast(raycaster,intersects){
      if(!this.surfelField)return;
      inv.copy(this.matrixWorld).invert();local.copy(raycaster.ray).applyMatrix4(inv);
      const hit=pickSurfelField(this.surfelField,local.origin.toArray(),local.direction.toArray(),this.surfelOccupancy);if(!hit)return;
      const point=local.at(hit.t,new THREE.Vector3()).applyMatrix4(this.matrixWorld),distance=raycaster.ray.origin.distanceTo(point);
      if(distance<raycaster.near||distance>raycaster.far)return;
      intersects.push({distance,point,object:this,surfelCell:hit.cell});
    }
  }
  class SurfelChunk extends THREE.LOD{
    constructor(){super();this.surfelFactors=[];}
    copy(source,recursive){super.copy(source,recursive);this.surfelFactors=source.surfelFactors.slice();return this;}
    raycast(){}
    update(camera){
      const factors=this.surfelFactors;if(!factors.length)return;
      let root=this.parent;while(root&&!root.isTrellisSurfelRoot)root=root.parent;if(!root?.surfelField)return;
      const options=root.surfelOptions;
      this.getWorldPosition(wp);camera.getWorldPosition(cp);this.getWorldScale(ws);
      const voxel=Math.max(ws.x,ws.y,ws.z)/root.surfelField.resolution;
      const height=viewportHeightSource?.()||root.userData.viewportHeight||options.viewportHeight;
      const pixelsPerUnit=camera.isOrthographicCamera?height*camera.zoom/(camera.top-camera.bottom):
        height/2*camera.projectionMatrix.elements[5]/Math.max(wp.distanceTo(cp),1e-6);
      // the coarsest level whose surfels stay within targetPixels; the finest if none do
      let chosen=0;for(let i=factors.length-1;i>=0;i--)if(factors[i]*voxel*pixelsPerUnit<=options.targetPixels){chosen=i;break;}
      this.levels.forEach((l,i)=>{l.object.visible=i===chosen;});this._currentLevel=chosen;
    }
  }
  class SurfelChunkMesh extends THREE.InstancedMesh{raycast(){}}
  c={SurfelRoot,SurfelChunk,SurfelChunkMesh};classCache.set(THREE,c);return c;
}

export function createSurfelObject(THREE,field,{levels=[1,2,4],chunkVoxels=64,viewportHeight=1080,targetPixels=1.5,proxyFactor=2}={}){
  const {SurfelRoot,SurfelChunk,SurfelChunkMesh}=surfelClasses(THREE);
  const root=new SurfelRoot();root.name='trellis-surfels';
  root.surfelField=field;root.surfelOccupancy=occupancyOf(field);root.surfelOptions={levels,chunkVoxels,viewportHeight,targetPixels};
  root.userData.raycastsAsWhole=true;
  const merged=levels.map(k=>k===1?field:mergeSurfelLevel(field,k).field);
  const geometry=new THREE.BufferGeometry(),R=2.45/Math.sqrt(3);
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,R,0,-Math.sin(Math.PI/3)*R,-.5*R,0,Math.sin(Math.PI/3)*R,-.5*R,0],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  let mr=[0,0];for(let i=0;i<field.count;i++){mr[0]+=field.metalRough[i*2];mr[1]+=field.metalRough[i*2+1];}
  const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide,metalness:mr[0]/field.count/255,roughness:mr[1]/field.count/255});
  const chunks=new Map();
  merged.forEach((f,level)=>{
    const k=levels[level],per=chunkVoxels/k,pos=surfelPositions(f),nor=surfelNormals(f);
    const groups=new Map();
    for(let i=0;i<f.count;i++){const c=unpack(f.cells[i]),key=[0,1,2].map(a=>Math.floor(c[a]/per)).join(',');
      (groups.get(key)??groups.set(key,[]).get(key)).push(i);}
    const m=new THREE.Matrix4(),q=new THREE.Quaternion(),s=new THREE.Vector3(),p=new THREE.Vector3(),z=new THREE.Vector3(0,0,1),n=new THREE.Vector3(),roll=new THREE.Quaternion(),col=new THREE.Color();
    const r=f.radiusVoxels/f.resolution;
    for(const [key,idx] of groups){
      const mesh=new SurfelChunkMesh(geometry,material,idx.length);mesh.castShadow=true;mesh.receiveShadow=true;
      idx.forEach((i,j)=>{p.set(pos[i*3],pos[i*3+1],pos[i*3+2]);n.set(nor[i*3],nor[i*3+1],nor[i*3+2]);
        q.setFromUnitVectors(z,n).multiply(roll.setFromAxisAngle(z,hashAngle(i)));s.setScalar(r);m.compose(p,q,s);mesh.setMatrixAt(j,m);
        col.setRGB(f.color[i*3]/255,f.color[i*3+1]/255,f.color[i*3+2]/255,THREE.SRGBColorSpace);mesh.setColorAt(j,col);});
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
      let lod=chunks.get(key);
      if(!lod){lod=new SurfelChunk();lod.name=`surfel-chunk-${key}`;chunks.set(key,lod);root.add(lod);}
      lod.addLevel(mesh,level);lod.surfelFactors.push(k);
    }
  });
  const proxy=new THREE.BufferGeometry();
  proxy.setAttribute('position',new THREE.BufferAttribute(surfelTriangles(proxyFactor>1?mergeSurfelLevel(field,proxyFactor).field:field).positions,3));
  root.sceneGeometry=proxy;
  root.userData.viewportHeight=viewportHeight;
  root.userData.trellisSurfels={count:field.count,resolution:field.resolution,levels,chunkVoxels,chunks:chunks.size,proxyFactor};
  return root;
}

// GLTFLoader plugin: a node carrying the surfel extension becomes the surfel scene object.
export function trellisSurfelsGLTFPlugin(THREE,options={}){
  return parser=>({
    name:SURFEL_EXTENSION,
    createNodeMesh(nodeIndex){
      const ext=parser.json.nodes[nodeIndex]?.extensions?.[SURFEL_EXTENSION];if(!ext)return null;
      const names=FIELD_ARRAYS.map(([n])=>n);
      return Promise.all(names.map(n=>parser.getDependency('bufferView',ext.arrays[n]))).then(buffers=>{
        const byView=new Map(names.map((n,i)=>[ext.arrays[n],buffers[i]]));
        return createSurfelObject(THREE,fieldFromViews(ext,i=>byView.get(i)),options);
      });
    },
  });
}
