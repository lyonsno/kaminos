// Stationary two-level finite-volume prototype. Not wired into the live flame.
// Each fluid cell owns its volume exactly once. Each shared face owns ONE flux,
// including fine subfaces abutting a coarse cell. No donor overwrite/blend.
// Positions: local distance; flux: volume/reference tick; pressure: impulse.
// The symmetric two-point interface gradient is first-order at T junctions;
// this is not a second-order nonorthogonal-pressure reconstruction.
export const COMPOSITE_GRID_ID='stationary-composite-finite-volume-v0';
const key=q=>q.join(',');
const product=q=>q.reduce((a,b)=>a*b,1);
const finite=(v,label)=>{if(!Number.isFinite(v))throw new Error(`${label} must be finite`);return v;};
function vector(v,n,label){
  if(!v||v.length!==n)throw new Error(`${label} length must be ${n}`);
  for(const x of v)finite(x,label);
}
export function createCompositeGrid({shape,min=[0,0,0],cellWidth,fine,solid=()=>false,boundary=()=> 'open'}){
  vector(shape,3,'shape');vector(min,3,'min');finite(cellWidth,'cellWidth');
  if(shape.some(x=>!Number.isInteger(x)||x<1)||cellWidth<=0)throw new Error('positive integer shape and cellWidth required');
  vector(fine?.min,3,'fine min');vector(fine?.max,3,'fine max');
  const ratio=fine.ratio;
  if(!Number.isInteger(ratio)||ratio<1)throw new Error('integer refinement ratio >= 1 required');
  const h=cellWidth/ratio;
  const start=fine.min.map((v,a)=>(v-min[a])/cellWidth),end=fine.max.map((v,a)=>(v-min[a])/cellWidth);
  if([...start,...end].some(v=>Math.abs(v-Math.round(v))>1e-9))throw new Error('fine box must be coarse-cell aligned');
  start.forEach((v,a)=>{start[a]=Math.round(v);end[a]=Math.round(end[a]);});
  if(start.some((v,a)=>v<0||end[a]>shape[a]||end[a]<=v))throw new Error('fine box must be nonempty and inside outer domain');
  const cells=[],owners=new Map(),children=new Map(),faces=[];
  const refined=q=>q.every((v,a)=>v>=start[a]&&v<end[a]);
  function add(q,width,level,coarse){
    const center=q.map((v,a)=>min[a]+(v+.5)*width);
    const id=solid(center,width)?-1:cells.length;
    if(id>=0)cells.push({center,width,volume:width**3,level,index:q,coarse});
    return id;
  }
  for(let z=0;z<shape[2];z++)for(let y=0;y<shape[1];y++)for(let x=0;x<shape[0];x++){
    const q=[x,y,z];
    if(!refined(q)){owners.set(key(q),add(q,cellWidth,0,q));continue;}
    for(let k=0;k<ratio;k++)for(let j=0;j<ratio;j++)for(let i=0;i<ratio;i++){
      const f=[x*ratio+i,y*ratio+j,z*ratio+k];children.set(key(f),add(f,h,1,q));
    }
  }
  const lookup=p=>{
    const q=p.map((v,a)=>Math.floor((v-min[a])/cellWidth));
    if(q.some((v,a)=>v<0||v>=shape[a]))return -2; // ambient, distinct from solid
    return refined(q)?children.get(key(p.map((v,a)=>Math.floor((v-min[a])/h)))):owners.get(key(q));
  };
  for(let id=0;id<cells.length;id++){
    const c=cells[id];
    for(let axis=0;axis<3;axis++)for(const side of [-1,1]){
      const center=[...c.center];center[axis]+=side*c.width/2;
      const probe=[...center];probe[axis]+=side*h*1e-5;
      const neighbor=lookup(probe);
      // A coarse face next to the fine box is tiled; all others remain whole.
      const q=probe.map((v,a)=>Math.floor((v-min[a])/cellWidth));
      const tiles=c.level===0&&refined(q)?ratio:1;
      const b=(axis+1)%3,d=(axis+2)%3,w=c.width/tiles;
      for(let j=0;j<tiles;j++)for(let i=0;i<tiles;i++){
        const fc=[...center];fc[b]+=(i+.5)*w-c.width/2;fc[d]+=(j+.5)*w-c.width/2;
        const fp=[...fc];fp[axis]+=side*h*1e-5;
        const n=tiles===1?neighbor:lookup(fp);
        if(n===undefined)throw new Error('missing composite owner');
        if(n===-1)continue; // solid face has exact zero flux, no pressure edge
        if(n>=0&&side<0)continue; // the lower-position owner emits the edge
        if(n===-2){
          const law=boundary(axis,side,fc);
          if(law==='wall')continue;
          if(law!=='open')throw new Error('boundary must be open or wall');
        }
        faces.push({a:id,b:n<0?-1:n,axis,side:n<0?side:1,center:fc,area:w*w,
          distance:n<0?c.width/2:(c.width+cells[n].width)/2});
      }
    }
  }
  // Connected components identify incompatible sealed pressure problems.
  const adjacency=Array.from({length:cells.length},()=>[]),diagonal=new Float64Array(cells.length);
  const open=new Uint8Array(cells.length);
  for(const f of faces){const k=f.area/f.distance;diagonal[f.a]+=k;
    if(f.b>=0){diagonal[f.b]+=k;adjacency[f.a].push(f.b);adjacency[f.b].push(f.a);}else open[f.a]=1;
  }
  const seen=new Uint8Array(cells.length),components=[];
  for(let seed=0;seed<cells.length;seed++)if(!seen[seed]){
    const ids=[seed];seen[seed]=1;let grounded=false;
    for(let j=0;j<ids.length;j++){const id=ids[j];grounded||=!!open[id];for(const n of adjacency[id])if(!seen[n]){seen[n]=1;ids.push(n);}}
    components.push({ids,grounded});
  }
  return {identity:COMPOSITE_GRID_ID,cells,faces,diagonal,components,
    geometry:{shape:[...shape],min:[...min],cellWidth,fine:{min:[...fine.min],max:[...fine.max],ratio}},
    domainVolume:product(shape)*cellWidth**3};
}

export function compositeDivergence(grid,flux){
  vector(flux,grid.faces.length,'flux');const out=new Float64Array(grid.cells.length);
  grid.faces.forEach((f,i)=>{out[f.a]+=flux[i];if(f.b>=0)out[f.b]-=flux[i];});
  return out.map((v,i)=>v/grid.cells[i].volume);
}
export function applyCompositePressure(grid,p){
  vector(p,grid.cells.length,'pressure');const out=new Float64Array(p.length);
  for(const f of grid.faces){const q=f.area/f.distance*(p[f.a]-(f.b<0?0:p[f.b]));out[f.a]+=q;if(f.b>=0)out[f.b]-=q;}
  return out;
}
export function projectComposite(grid,input,{target=new Float64Array(grid.cells.length),tolerance=1e-6,maxIterations=grid.cells.length}={}){
  vector(input,grid.faces.length,'flux');vector(target,grid.cells.length,'target');finite(tolerance,'tolerance');
  if(tolerance<=0||!Number.isInteger(maxIterations)||maxIterations<0)throw new Error('positive tolerance and nonnegative integer iteration budget required');
  const n=grid.cells.length,div=compositeDivergence(grid,input);
  const rhs=Float64Array.from(div,(v,i)=>(target[i]-v)*grid.cells[i].volume);
  for(const c of grid.components)if(!c.grounded){
    const sum=c.ids.reduce((s,i)=>s+rhs[i],0),volume=c.ids.reduce((s,i)=>s+grid.cells[i].volume,0);
    if(Math.abs(sum)>tolerance*volume)throw new Error('sealed component has incompatible net source/flux');
  }
  const pressure=new Float64Array(n);let r=rhs.slice();
  const precondition=r=>r.map((v,i)=>v/(grid.diagonal[i]||1));
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const error=r=>r.reduce((m,v,i)=>Math.max(m,Math.abs(v)/grid.cells[i].volume),0);
  let z=precondition(r),direction=z.slice(),rz=dot(r,z),iterations=0,peak=error(r);
  while(peak>tolerance&&iterations<maxIterations){
    const ad=applyCompositePressure(grid,direction),denom=dot(direction,ad);
    if(!(denom>0))break;
    const alpha=rz/denom;
    for(let i=0;i<n;i++){pressure[i]+=alpha*direction[i];r[i]-=alpha*ad[i];}
    iterations++;peak=error(r);
    // Check actual residual before accepting; recursive CG error can drift.
    if(peak<=tolerance){const ap=applyCompositePressure(grid,pressure);r=rhs.map((v,i)=>v-ap[i]);peak=error(r);if(peak<=tolerance)break;
      z=precondition(r);direction=z.slice();rz=dot(r,z);continue;
    }
    z=precondition(r);const next=dot(r,z),beta=next/rz;
    for(let i=0;i<n;i++)direction[i]=z[i]+beta*direction[i];rz=next;
  }
  const flux=Float64Array.from(input,(q,i)=>{const f=grid.faces[i];return q+f.area/f.distance*(pressure[f.a]-(f.b<0?0:pressure[f.b]));});
  const final=compositeDivergence(grid,flux);
  const maxDivergenceError=final.reduce((m,v,i)=>Math.max(m,Math.abs(v-target[i])),0);
  const converged=Number.isFinite(maxDivergenceError)&&maxDivergenceError<=tolerance;
  return {flux,pressure,converged,receipt:{identity:COMPOSITE_GRID_ID,route:'cpu-reference',iterations,maxIterations,tolerance,maxDivergenceError,
    converged,cells:n,faces:grid.faces.length,innerFeedback:true,pressure:'symmetric-area-over-normal-distance',liveFlame:false}};
}

// First-order donor-cell transport is a conservative baseline, not a replacement
// for the fine flame's MacCormack reconstruction. Caller chooses dt/substeps;
// rejection reports a CFL violation instead of silently clipping material.
export function transportComposite(grid,density,flux,{dt,ambient=0}={}){
  vector(density,grid.cells.length,'density');vector(flux,grid.faces.length,'flux');finite(dt,'dt');finite(ambient,'ambient');
  if(dt<0||ambient<0||density.some(v=>v<0))throw new Error('nonnegative dt and material required');
  const outgoing=new Float64Array(density.length),mass=density.map((v,i)=>v*grid.cells[i].volume);
  const massBefore=mass.reduce((s,v)=>s+v,0);
  grid.faces.forEach((f,i)=>{const q=flux[i];if(q>=0)outgoing[f.a]+=q;else if(f.b>=0)outgoing[f.b]-=q;});
  const maxCFL=outgoing.reduce((m,q,i)=>Math.max(m,dt*q/grid.cells[i].volume),0);
  if(maxCFL>1+1e-12)throw new Error(`transport CFL ${maxCFL} exceeds 1; reduce dt or substep`);
  let boundaryMassOut=0;
  grid.faces.forEach((f,i)=>{const q=flux[i],rho=q>=0?density[f.a]:(f.b>=0?density[f.b]:ambient),amount=dt*q*rho;
    mass[f.a]-=amount;if(f.b>=0)mass[f.b]+=amount;else boundaryMassOut+=amount;
  });
  return {values:mass.map((v,i)=>v/grid.cells[i].volume),massBefore,massAfter:mass.reduce((s,v)=>s+v,0),boundaryMassOut,maxCFL};
}
