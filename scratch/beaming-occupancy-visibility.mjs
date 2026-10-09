// Experimental scene-covering visibility proxy. Display geometry is untouched.
import {voxelizeTriangleSolid} from '../volume-scene-solid.mjs';

export function buildSceneOccupancy(geometry,receivers,grid){
  if(!Number.isSafeInteger(grid)||grid<2||(grid&(grid-1)))throw Error('power-of-two occupancy grid required');
  if(!geometry.triangleCount)throw Error('visibility proxy requires geometry');
  const started=performance.now(),lo=[-1,-1,-1],hi=[1,3,1];
  for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],geometry.nodes[a]);hi[a]=Math.max(hi[a],geometry.nodes[a+4]);}
  for(const r of receivers)for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],r.position[a]);hi[a]=Math.max(hi[a],r.position[a]);}
  const pitch=Math.max(hi[0]-lo[0],(hi[1]-lo[1])/2,hi[2]-lo[2])/(grid-2*.01);
  for(let a=0;a<3;a++){lo[a]-=.01*pitch;hi[a]=lo[a]+pitch*grid*(a===1?2:1);}
  const tris=[],raw=geometry.triangles;
  for(let i=0;i<geometry.triangleCount;i++){
    const offset=i*12,tri=[];
    for(let v=0;v<3;v++)tri.push([0,1,2].map(a=>((raw[offset+a]+(v?raw[offset+v*4+a]:0)-lo[a])/pitch)*2/grid-1));
    tris.push(tri);
  }
  const raster=voxelizeTriangleSolid(tris,grid),levels=[{data:raster.cells,dims:[grid,2*grid,grid]}];
  // 0 empty, 1 completely occupied, 2 mixed. Full blocks collapse to one leaf.
  while(levels.at(-1).dims.some(x=>x>1)){
    const previous=levels.at(-1),dims=previous.dims.map(x=>Math.ceil(x/2)),data=new Uint8Array(dims[0]*dims[1]*dims[2]);
    for(let z=0;z<dims[2];z++)for(let y=0;y<dims[1];y++)for(let x=0;x<dims[0];x++){
      let occupied=0,full=true;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
        const p=[2*x+dx,2*y+dy,2*z+dz];
        const v=p.some((n,a)=>n>=previous.dims[a])?0:previous.data[p[0]+previous.dims[0]*(p[1]+previous.dims[1]*p[2])];
        occupied+=v>0?1:0;full&&=v===1;
      }
      data[x+dims[0]*(y+dims[1]*z)]=occupied?(full?1:2):0;
    }
    levels.push({data,dims});
  }
  const records=[];
  function write(level,x,y,z){
    const {data,dims}=levels[level];if(x>=dims[0]||y>=dims[1]||z>=dims[2])return;
    const value=data[x+dims[0]*(y+dims[1]*z)];if(!value)return;
    const at=records.length,scale=2**level;
    const min=[x,y,z].map((v,a)=>lo[a]+v*scale*pitch),max=min.map((v,a)=>Math.min(hi[a],v+scale*pitch));
    records.push({min,max,leaf:value===1,escape:0});
    if(value!==1)for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)write(level-1,2*x+dx,2*y+dy,2*z+dz);
    records[at].escape=records.length;
  }
  write(levels.length-1,0,0,0);
  const nodes=new Float32Array(Math.max(1,records.length)*12),words=new Uint32Array(nodes.buffer);
  records.forEach((r,i)=>{nodes.set(r.min,i*12);nodes.set(r.max,i*12+4);words[i*12+8]=r.escape;words[i*12+10]=r.leaf?1:0;});
  return {nodes,metadata:{grid,dimensions:[grid,2*grid,grid],lo,hi,pitch,localExactRadius:2*Math.sqrt(3)*pitch,nodeCount:records.length,bytes:nodes.byteLength,surfaceCellCount:raster.surfaceCellCount,interiorCellCount:raster.interiorCellCount,buildMs:performance.now()-started,representation:'scene-covering-conservative-solid-octree',nearPolicy:'exact triangles within two cell diagonals, conservative occupancy beyond'}};
}

export function occupancyDistance(proxy,origin,direction,{near=0,far=1e20}={}){
  const nodes=proxy.nodes,words=new Uint32Array(nodes.buffer);let closest=far,n=0;
  while(n<proxy.metadata.nodeCount){
    const at=n*12;let entry=near,exit=closest;
    for(let a=0;a<3;a++){
      if(Math.abs(direction[a])<1e-20){if(origin[a]<nodes[at+a]||origin[a]>nodes[at+4+a])exit=-1;}
      else{const a0=(nodes[at+a]-origin[a])/direction[a],a1=(nodes[at+4+a]-origin[a])/direction[a];entry=Math.max(entry,Math.min(a0,a1));exit=Math.min(exit,Math.max(a0,a1));}
    }
    if(exit<entry){n=words[at+8];continue;}
    if(words[at+10]){closest=entry;n=words[at+8];}else n++;
  }
  return closest;
}

// Browser witness owns this source rewrite. Native source copy is saved beside
// the executed copy; it is not installed in the production module or UI.
export function instrumentOccupancy(source,grid){
  const replace=(needle,replacement)=>{if(source.split(needle).length!==2)throw Error('occupancy instrumentation seam mismatch: '+needle);source=source.replace(needle,replacement);};
  source="import {buildSceneOccupancy} from './scratch/beaming-occupancy-visibility.mjs';\n"+source;
  replace("['unbounded','source-volume']","['unbounded','source-volume','occupancy']");
  replace("  const nodes=buffer('static kiln BVH nodes',geometry.nodes);",`  const proxy=buildSceneOccupancy(geometry,receivers,${grid});window.__beamingOccupancy=proxy.metadata;
  const occupancyNodes=buffer('experimental occupancy nodes',proxy.nodes);
  const nodes=buffer('static kiln BVH nodes',geometry.nodes);`);
  replace('constants+GATHER_WGSL_BODY',"constants+`const OCCUPANCY_NODE_COUNT:u32=${proxy.metadata.nodeCount}u;const LOCAL_EXACT_RADIUS:f32=${proxy.metadata.localExactRadius};`+GATHER_WGSL_BODY");
  replace('{binding:11,resource:{buffer:cacheRange}}]', '{binding:11,resource:{buffer:cacheRange}},{binding:12,resource:{buffer:occupancyNodes}}]');
  replace("visibilityBounds==='source-volume'?1:0","visibilityBounds==='occupancy'?2:visibilityBounds==='source-volume'?1:0");
  replace('@group(0) @binding(11) var<uniform> cacheRange:vec4<u32>;', '@group(0) @binding(11) var<uniform> cacheRange:vec4<u32>;\n@group(0) @binding(12) var<storage,read> occupancyNodes:array<Node>;');
  replace('if(cacheRange.z==1u){','if(cacheRange.z!=0u){');
  replace('  loop {\n    if(n>=NODE_COUNT)', '  let sourceLimit=closest;\n  if(cacheRange.z==2u){closest=min(closest,LOCAL_EXACT_RADIUS);}\n  let localLimit=closest;\n  loop {\n    if(n>=NODE_COUNT)');
  replace('  firstHits[address]=closest;\n}', `  if(cacheRange.z==2u&&closest==localLimit){
    closest=sourceLimit;n=0u;
    loop{
      if(n>=OCCUPANCY_NODE_COUNT){break;}
      let node=occupancyNodes[n];let span=interval(p,d,node.lo.xyz,node.hi.xyz,closest);
      let entry=max(span.x,LOCAL_EXACT_RADIUS);
      if(span.y<entry){n=node.range.x;continue;}
      if(node.range.z==0u){n++;continue;}
      closest=entry;n=node.range.x;
    }
  }
  firstHits[address]=closest;
}`);
  return source;
}
