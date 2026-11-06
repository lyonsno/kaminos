// Sparse topology from TRELLIS.2 5565d240 / CuMesh's narrow-band DC route
// (MIT), as carried by TRELLIS2MLX's cumesh/metal_remeshing.py. Grid axes are
// source xyz; no display-coordinate conversion belongs in reconstruction.
const f=Math.fround;
export const CORNERS=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
const NEIGHBORS=[[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,0,0],[0,1,0],[1,1,0],[1,0,0]]];
const SPLITS=[[[0,1,2,0,2,3],[0,2,1,0,3,2]],[[0,1,3,3,1,2],[0,3,1,3,2,1]]];
export function remeshSettings({resolution=512,band=1,projectBack=0,center=[0,0,0]}={}){
  if(!Number.isSafeInteger(resolution)||resolution<1||!Number.isSafeInteger((resolution+1)**3))throw RangeError('exact finite remesh grid required');
  let base=resolution;while(base>32){if(base%2)throw RangeError('source remesh grid must halve exactly to at most 32');base/=2;}
  if(!Number.isFinite(band)||band<=0||!Number.isFinite(projectBack)||projectBack<0||projectBack>1||
    center.length!==3||!Array.from(center).every(Number.isFinite))throw RangeError('finite remesh band, center and projectBack in [0,1] required');
  const scale=(resolution+3*band)/resolution;
  return {resolution,base,band,projectBack,center:Array.from(center),scale,epsilon:f(band*scale/resolution)};
}
const key=(x,y,z,width)=>(x*width+y)*width+z;
function unique(values){values.sort();if(!values.length)return values;let n=1;for(let i=1;i<values.length;i++)if(values[i]!==values[n-1])values[n++]=values[i];return values.slice(0,n);}
function xyz(k,width){return [Math.floor(k/(width*width)),Math.floor(k/width)%width,k%width];}
export function initialCells(base){const a=new Uint32Array(base**3*3);let p=0;for(let x=0;x<base;x++)for(let y=0;y<base;y++)for(let z=0;z<base;z++)a.set([x,y,z],p++*3);return a;}
export function gridPoints(coords,level,settings,centers=false){
  const out=new Float32Array(coords.length),shift=centers?.5:0;
  for(let i=0;i<out.length;i++)out[i]=f(f(f(f(f(coords[i]+shift)/level)-.5)*f(settings.scale))+f(settings.center[i%3]));
  return out;
}
export function refineCells(coords,distances,level,settings){
  if(distances.length!==coords.length/3||!distances.every(Number.isFinite))throw Error('complete finite distance query required');
  const threshold=f(.87*settings.scale/level),selected=[];
  for(let i=0;i<distances.length;i++)if(Math.abs(f(distances[i]-settings.epsilon))<threshold)selected.push(i);
  if(!selected.length)throw Error('original remesh narrow band contains no active cells');
  if(level===settings.resolution){const out=new Uint32Array(selected.length*3);selected.forEach((v,i)=>out.set(coords.subarray(v*3,v*3+3),i*3));return out;}
  const width=level*2,keys=new Float64Array(selected.length*8);let p=0;
  for(const i of selected)for(const [x,y,z] of CORNERS)keys[p++]=key(coords[i*3]*2+x,coords[i*3+1]*2+y,coords[i*3+2]*2+z,width);
  const sorted=unique(keys),out=new Uint32Array(sorted.length*3);
  for(let i=0;i<sorted.length;i++)out.set(xyz(sorted[i],width),i*3);
  return out;
}
function lowerBound(sorted,k){let lo=0,hi=sorted.length;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(sorted[mid]<k)lo=mid+1;else hi=mid;}return sorted[lo]===k?lo:-1;}
export function cornerTable(coords,resolution){
  const width=resolution+1,keys=new Float64Array(coords.length/3*8);let p=0;
  for(let i=0;i<coords.length;i+=3)for(const [x,y,z] of CORNERS)keys[p++]=key(coords[i]+x,coords[i+1]+y,coords[i+2]+z,width);
  const sorted=unique(keys),corners=new Uint32Array(sorted.length*3),indices=new Uint32Array(coords.length/3*8);
  for(let i=0;i<sorted.length;i++)corners.set(xyz(sorted[i],width),i*3);
  p=0;for(let i=0;i<coords.length;i+=3)for(const [x,y,z] of CORNERS){const row=lowerBound(sorted,key(coords[i]+x,coords[i+1]+y,coords[i+2]+z,width));if(row<0)throw Error('missing active grid corner');indices[p++]=row;}
  return {corners,indices};
}
function alignment(vertices,ids){
  const sub=(a,b)=>[0,1,2].map(k=>f(vertices[a*3+k]-vertices[b*3+k]));
  const cross=(a,b)=>[f(f(a[1]*b[2])-f(a[2]*b[1])),f(f(a[2]*b[0])-f(a[0]*b[2])),f(f(a[0]*b[1])-f(a[1]*b[0]))];
  const a=cross(sub(ids[1],ids[0]),sub(ids[2],ids[0])),b=cross(sub(ids[2],ids[1]),sub(ids[3],ids[1]));
  return Math.abs(f(f(f(a[0]*b[0])+f(a[1]*b[1]))+f(a[2]*b[2])));
}
export function contourTopology(coords,dual,intersections,settings){
  if(dual.length!==coords.length||intersections.length!==coords.length||!dual.every(Number.isFinite)||
    !intersections.every(v=>v===-1||v===0||v===1))throw Error('complete finite dual contour output required');
  const keys=new Float64Array(coords.length/3);for(let i=0;i<keys.length;i++)keys[i]=key(coords[i*3],coords[i*3+1],coords[i*3+2],settings.resolution);
  const quads=[],directions=[],used=new Uint8Array(keys.length);
  for(let i=0;i<keys.length;i++)for(let axis=0;axis<3;axis++){
    const direction=intersections[i*3+axis];if(!direction)continue;
    const ids=NEIGHBORS[axis].map(([x,y,z])=>{
      x+=coords[i*3];y+=coords[i*3+1];z+=coords[i*3+2];
      return x>=settings.resolution||y>=settings.resolution||z>=settings.resolution?-1:lowerBound(keys,key(x,y,z,settings.resolution));
    });
    if(ids.some(v=>v<0))continue;quads.push(ids);directions.push(direction);ids.forEach(v=>used[v]=1);
  }
  const map=new Uint32Array(keys.length);let n=0;for(let i=0;i<used.length;i++)if(used[i])map[i]=n++;
  if(!n)throw Error('original remesh produced no connected surface');
  const vertices=new Float32Array(n*3),triangles=new Uint32Array(quads.length*6);
  for(let i=0;i<used.length;i++)if(used[i])for(let axis=0;axis<3;axis++)vertices[map[i]*3+axis]=f(f(f(f(dual[i*3+axis]/settings.resolution)-.5)*f(settings.scale))+f(settings.center[axis]));
  for(let i=0;i<quads.length;i++){
    const q=quads[i].map(v=>map[v]),positive=directions[i]===1?1:0,candidates=SPLITS.map(s=>s[positive].map(j=>q[j]));
    // Source's comparison intentionally uses the first four entries of each
    // six-index candidate, including a repeated vertex in the first split.
    const selected=alignment(vertices,candidates[0])>alignment(vertices,candidates[1])?candidates[0]:candidates[1];
    triangles.set(selected,i*6);
  }
  return {vertices,triangles};
}
