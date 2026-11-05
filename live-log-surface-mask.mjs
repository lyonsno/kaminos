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
    const i0=indices?indices.getX(offset):offset,i1=indices?indices.getX(offset+1):offset+1,i2=indices?indices.getX(offset+2):offset+2;
    localTriangle.a.fromBufferAttribute(position,i0);
    localTriangle.b.fromBufferAttribute(position,i1);
    localTriangle.c.fromBufferAttribute(position,i2);
    triangle.a.copy(localTriangle.a).sub(bounds.min).multiply(scale);
    triangle.b.copy(localTriangle.b).sub(bounds.min).multiply(scale);
    triangle.c.copy(localTriangle.c).sub(bounds.min).multiply(scale);
    if(!Number.isFinite(triangle.a.x+triangle.a.y+triangle.a.z+triangle.b.x+triangle.b.y+triangle.b.z+triangle.c.x+triangle.c.y+triangle.c.z))throw Error('Nonfinite log triangle');
    localTriangle.getNormal(normal);if(normal.lengthSq()===0)continue;
    const lMinX=Math.min(localTriangle.a.x,localTriangle.b.x,localTriangle.c.x),lMinY=Math.min(localTriangle.a.y,localTriangle.b.y,localTriangle.c.y),lMinZ=Math.min(localTriangle.a.z,localTriangle.b.z,localTriangle.c.z);
    const lMaxX=Math.max(localTriangle.a.x,localTriangle.b.x,localTriangle.c.x),lMaxY=Math.max(localTriangle.a.y,localTriangle.b.y,localTriangle.c.y),lMaxZ=Math.max(localTriangle.a.z,localTriangle.b.z,localTriangle.c.z);
    lo.copy(triangle.a).min(triangle.b).min(triangle.c);hi.copy(triangle.a).max(triangle.b).max(triangle.c);
    const z0=clamp(Math.floor(lo.z-1e-6)),z1=clamp(Math.floor(hi.z+1e-6)),y0=clamp(Math.floor(lo.y-1e-6)),y1=clamp(Math.floor(hi.y+1e-6)),x0=clamp(Math.floor(lo.x-1e-6)),x1=clamp(Math.floor(hi.x+1e-6));
    for(let z=z0;z<=z1;z++){
      const cz=(z+.5)/scale.z+bounds.min.z,dz=cz<lMinZ?lMinZ-cz:cz>lMaxZ?cz-lMaxZ:0;
      for(let y=y0;y<=y1;y++){
        const cy=(y+.5)/scale.y+bounds.min.y,dy=cy<lMinY?lMinY-cy:cy>lMaxY?cy-lMaxY:0,dyz2=dy*dy+dz*dz;
        for(let x=x0;x<=x1;x++){
          const index=x+grid*(y+grid*z),cx=(x+.5)/scale.x+bounds.min.x,dx=cx<lMinX?lMinX-cx:cx>lMaxX?cx-lMaxX:0;
          if(mask[index]&&(dx*dx+dyz2)*(1-1e-12)>=distances[index]*(1+1e-12))continue;
          box.min.set(x,y,z);box.max.set(x+1,y+1,z+1);
          if(!box.intersectsTriangle(triangle))continue;
          mask[index]=1;
          centre.set(cx,cy,cz);
          localTriangle.closestPointToPoint(centre,point);
          const distance=point.distanceToSquared(centre);
          if(distance<distances[index]){
            distances[index]=distance;
            const base=index*8;
            samples[base]=point.x;samples[base+1]=point.y;samples[base+2]=point.z;samples[base+3]=1;
            samples[base+4]=normal.x;samples[base+5]=normal.y;samples[base+6]=normal.z;samples[base+7]=0;
          }
        }
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
