import * as THREE from './lib/three.webgpu.js';

// Static geometry classification only; no simulation values leave the GPU.
export function createLogSurfaceMask(geometry,bounds,grid,{filled=false}={}) {
  const position=geometry.getAttribute('position'),indices=geometry.getIndex();
  if(!position||!Number.isInteger(grid)||grid<=0)throw Error('Invalid log surface geometry or grid');
  const size=bounds.getSize(new THREE.Vector3());
  if(Math.min(size.x,size.y,size.z)<=0)throw Error('Log surface requires volumetric bounds');
  const scale=new THREE.Vector3(grid/size.x,grid/size.y,grid/size.z);
  const triangle=new THREE.Triangle(),localTriangle=new THREE.Triangle(),box=new THREE.Box3(),lo=new THREE.Vector3(),hi=new THREE.Vector3();
  const centre=new THREE.Vector3(),point=new THREE.Vector3(),normal=new THREE.Vector3();
  const mask=new Uint32Array(grid**3),count=indices?.count??position.count;
  const samples=new Float32Array(grid**3*8),distances=new Float64Array(grid**3).fill(Infinity);
  const start=geometry.drawRange.start,end=Math.min(count,start+geometry.drawRange.count);
  const clamp=value=>Math.max(0,Math.min(grid-1,value));
  for(let offset=start;offset+2<end;offset+=3){
    for(const [vertex,delta] of [[triangle.a,0],[triangle.b,1],[triangle.c,2]]){
      vertex.fromBufferAttribute(position,indices?indices.getX(offset+delta):offset+delta);
      [localTriangle.a,localTriangle.b,localTriangle.c][delta].copy(vertex);
      vertex.sub(bounds.min).multiply(scale);
      if(![vertex.x,vertex.y,vertex.z].every(Number.isFinite))throw Error('Nonfinite log triangle');
    }
    lo.copy(triangle.a).min(triangle.b).min(triangle.c);hi.copy(triangle.a).max(triangle.b).max(triangle.c);
    for(let z=clamp(Math.floor(lo.z-1e-6));z<=clamp(Math.floor(hi.z+1e-6));z++)
      for(let y=clamp(Math.floor(lo.y-1e-6));y<=clamp(Math.floor(hi.y+1e-6));y++)
        for(let x=clamp(Math.floor(lo.x-1e-6));x<=clamp(Math.floor(hi.x+1e-6));x++){
          const index=x+grid*(y+grid*z);
          box.min.set(x,y,z);box.max.set(x+1,y+1,z+1);
          if(!box.intersectsTriangle(triangle))continue;
          localTriangle.getNormal(normal);if(normal.lengthSq()===0)continue;
          mask[index]=1;
          centre.set(x+.5,y+.5,z+.5).divide(scale).add(bounds.min);
          localTriangle.closestPointToPoint(centre,point);
          const distance=point.distanceToSquared(centre);
          if(distance<distances[index]){
            distances[index]=distance;samples.set([...point.toArray(),1,...normal.toArray(),0],index*8);
          }
        }
  }
  if(!mask.some(Boolean))throw Error('Log surface has no intersecting thermal cells');
  if(filled){
    mask.surface=mask.slice();
    const exterior=new Uint8Array(mask.length),queue=new Uint32Array(mask.length);let head=0,tail=0;
    const add=i=>{if(!mask[i]&&!exterior[i]){exterior[i]=1;queue[tail++]=i;}};
    for(let z=0;z<grid;z++)for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)if(x===0||y===0||z===0||x===grid-1||y===grid-1||z===grid-1)add(x+grid*(y+grid*z));
    while(head<tail){const i=queue[head++],x=i%grid,y=Math.floor(i/grid)%grid,z=Math.floor(i/(grid*grid));
      if(x>0)add(i-1);if(x+1<grid)add(i+1);if(y>0)add(i-grid);if(y+1<grid)add(i+grid);if(z>0)add(i-grid*grid);if(z+1<grid)add(i+grid*grid);
    }
    for(let i=0;i<mask.length;i++)if(!mask[i]&&!exterior[i]){
      mask[i]=1;const x=i%grid,y=Math.floor(i/grid)%grid,z=Math.floor(i/(grid*grid));
      samples.set([bounds.min.x+(x+.5)*size.x/grid,bounds.min.y+(y+.5)*size.y/grid,bounds.min.z+(z+.5)*size.z/grid,2,0,0,0,0],i*8);
    }
  }
  mask.samples=samples;
  return mask;
}
