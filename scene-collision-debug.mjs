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
