// Size-aware broad phase. All occupied size levels participate in every query;
// allocation and acceleration change no retained grain or collision predicate.
export function grainBounds(g){
 const co=Math.cos(g.angle),sn=Math.sin(g.angle),w=g.faces[0]-g.faces[1],d=g.faces[2]-g.faces[3],x=(g.faces[0]+g.faces[1])/2,z=(g.faces[2]+g.faces[3])/2,cx=g.x+co*x-sn*z,cz=g.z+sn*x+co*z;
 const rx=(Math.abs(co)*w+Math.abs(sn)*d)/2,rz=(Math.abs(sn)*w+Math.abs(co)*d)/2;
 return [cx-rx-1e-10,cx+rx+1e-10,g.faces[5]-1e-10,g.faces[4]+1e-10,cz-rz-1e-10,cz+rz+1e-10];
}
const intersects=(a,b)=>a[0]<=b[1]&&a[1]>=b[0]&&a[2]<=b[3]&&a[3]>=b[2]&&a[4]<=b[5]&&a[5]>=b[4];
export function createGrainIndex(grains){
 const levels=new Map(),members=new Map();let visits=0,entries=0;
 function update(g){
  const prior=members.get(g.id);if(prior){for(const key of prior.keys){const cell=prior.level.cells.get(key);if(cell.delete(g.id))entries--;if(!cell.size)prior.level.cells.delete(key);}if(!prior.level.cells.size)levels.delete(prior.exponent);}
  const bounds=grainBounds(g),exponent=Math.ceil(Math.log2(Math.max(bounds[1]-bounds[0],bounds[5]-bounds[4]))),size=2**exponent;
  let level=levels.get(exponent);if(!level)levels.set(exponent,level={size,cells:new Map()});
  const keys=[];for(let z=Math.floor(bounds[4]/size);z<=Math.floor(bounds[5]/size);z++)for(let x=Math.floor(bounds[0]/size);x<=Math.floor(bounds[1]/size);x++){
   const key=x+','+z;let cell=level.cells.get(key);if(!cell)level.cells.set(key,cell=new Map());cell.set(g.id,{grain:g,bounds});keys.push(key);entries++;
  }
  members.set(g.id,{exponent,level,keys});
 }
 function query(g){
  const bounds=grainBounds(g),found=new Map();
  const collect=cell=>{for(const [id,row]of cell??[]){visits++;if(id!==g.id&&intersects(bounds,row.bounds))found.set(id,row.grain);}};
  for(const level of levels.values()){
   const {size,cells}=level,loX=Math.floor(bounds[0]/size),hiX=Math.floor(bounds[1]/size),loZ=Math.floor(bounds[4]/size),hiZ=Math.floor(bounds[5]/size);
   if((hiX-loX+1)*(hiZ-loZ+1)<=cells.size){for(let z=loZ;z<=hiZ;z++)for(let x=loX;x<=hiX;x++)collect(cells.get(x+','+z));}
   else for(const [key,cell]of cells){const [x,z]=key.split(',').map(Number);if(x>=loX&&x<=hiX&&z>=loZ&&z<=hiZ)collect(cell);}
  }
  return new Set([...found].sort((a,b)=>a[0]-b[0]).map(row=>row[1]));
 }
 for(const g of grains)update(g);
 return {query,update,read:()=>({entries,grains:members.size,levels:levels.size,visits})};
}
