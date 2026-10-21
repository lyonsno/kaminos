// Draw the boundary of the installed occupancy mask, not a second voxelizer.
// Cell centres use volume-scene-solid's x-fastest indexing and [-1,1] X/Z,
// [-1,3] Y domain. Enclosed cells need no instance to show the solid surface.
export function collisionVoxelInstances({cells,dimensions,transform}) {
  const [nx,ny,nz]=dimensions??[];
  if(![nx,ny,nz].every(n=>Number.isInteger(n)&&n>0)||!(cells instanceof Uint8Array)||cells.length!==nx*ny*nz)throw Error('Invalid collision mask');
  const {translate,scale}=transform??{};
  if(!Array.isArray(translate)||translate.length!==3||!translate.every(Number.isFinite)||!Number.isFinite(scale)||scale<=0)throw Error('Invalid collision domain transform');
  const centres=[],size=2*scale/nx;
  const occupied=(x,y,z)=>x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz&&cells[x+nx*(y+ny*z)]!==0;
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    if(!occupied(x,y,z))continue;
    if(occupied(x-1,y,z)&&occupied(x+1,y,z)&&occupied(x,y-1,z)&&occupied(x,y+1,z)&&occupied(x,y,z-1)&&occupied(x,y,z+1))continue;
    centres.push([x,y,z].map((v,i)=>translate[i]-scale+(v+.5)*size));
  }
  return {centres,size};
}

export function createGpuCollisionVoxelMesh(THREE,renderer,{texture,dimensions,transform}) {
  const [nx,ny,nz]=dimensions,pitch=2*transform.scale/nx,T=THREE.TSL;
  const wrapper=new THREE.ExternalTexture(texture);wrapper.is3DTexture=true;wrapper.isData3DTexture=true;
  wrapper.image={width:nx,height:ny,depth:nz};wrapper.format=THREE.RedIntegerFormat;wrapper.type=THREE.UnsignedIntType;
  wrapper.minFilter=THREE.NearestFilter;wrapper.magFilter=THREE.NearestFilter;wrapper.generateMipmaps=false;
  const i=T.instanceIndex,c=T.uvec3(i.mod(nx),i.div(nx).mod(ny),i.div(nx*ny));
  const material=new THREE.MeshBasicNodeMaterial({color:0x46d7dd,transparent:true,opacity:.35,alphaTest:.01,depthWrite:false,depthTest:false});
  material.positionNode=T.positionLocal.add(T.vec3(c).add(.5).mul(pitch).add(T.vec3(...transform.translate.map(v=>v-transform.scale))));
  material.opacityNode=T.texture3DLoad(wrapper,c).r.toFloat().mul(.35);
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(pitch*.94,pitch*.94,pitch*.94),material,nx*ny*nz);
  mesh.frustumCulled=false;mesh.userData.kaminosEditorOnly=true;mesh.renderOrder=999;
  mesh.userData.gpuSolidTexture=texture;mesh.userData.gpuSolidFrame=JSON.stringify([dimensions,transform]);
  mesh.userData.disposeGpuSolid=()=>{delete renderer.backend.get(wrapper).texture;wrapper.dispose();};
  return mesh;
}
