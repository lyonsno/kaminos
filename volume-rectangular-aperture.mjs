// A slab-local rectangle in units of the source's enclosing radius. Cell overlap
// integrates a thin slot exactly instead of losing it between supersamples.
export function checkedRectangularAperture(value) {
 if(value?.kind!=='rectangle'||![value.halfLength,value.halfWidth].every(n=>Number.isFinite(n)&&n>=0&&n<=1)||Math.hypot(value.halfLength,value.halfWidth)>1+1e-10)throw Error('Invalid rectangular source aperture');
 return {kind:'rectangle',halfLength:value.halfLength,halfWidth:value.halfWidth};
}
export function rectangularCoverageMap(grid,radiusCells,aperture) {
 const a=checkedRectangularAperture(aperture),cells=new Float32Array(grid*grid),hx=radiusCells*a.halfLength,hz=radiusCells*a.halfWidth;
 let totalCoverage=0,coveredCells=0,peak=0;
 const overlap=(i,h)=>Math.max(0,Math.min(i+1-grid/2,h)-Math.max(i-grid/2,-h));
 for(let z=0;z<grid;z++)for(let x=0;x<grid;x++){
  const w=overlap(x,hx)*overlap(z,hz);cells[z*grid+x]=w;totalCoverage+=w;if(w>0)coveredCells++;peak=Math.max(peak,w);
 }
 return {identity:'kaminos.volume.rectangular-aperture-map.v1',grid,kind:'rectangle',pattern:'rectangle',cells,totalCoverage,coveredCells,peak};
}
export function rectangularSlabBasis(direction,axis) {
 if(!axis?.every(Number.isFinite)||axis.length!==3)throw Error('Rectangular source needs its authored tangent');
 const dot=axis.reduce((s,v,i)=>s+v*direction[i],0),v=axis.map((n,i)=>n-dot*direction[i]),length=Math.hypot(...v);
 if(length<1e-10)throw Error('Rectangular source tangent is parallel to its aim');
 const e1=v.map(n=>n/length),n=direction;
 return {e1,e2:[e1[1]*n[2]-e1[2]*n[1],e1[2]*n[0]-e1[0]*n[2],e1[0]*n[1]-e1[1]*n[0]]};
}
