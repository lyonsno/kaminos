// Exploratory cost accounting, not a transport solver or accepted discretization.
export function geometryBudget(positions, pitches) {
  if (!positions.length || positions.length % 9 || !positions.every(Number.isFinite)) throw Error('invalid triangle positions');
  if (!pitches.length || pitches.some(h => !(h > 0 && Number.isFinite(h)))) throw Error('invalid pitches');
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  const rows=pitches.map(pitch=>({pitch,cells:new Map(),areaQuota:0}));
  let area=0,degenerate=0;
  for(let i=0;i<positions.length;i+=9){
    const p=positions.subarray(i,i+9);
    for(let j=0;j<9;j++){lo[j%3]=Math.min(lo[j%3],p[j]);hi[j%3]=Math.max(hi[j%3],p[j]);}
    const u=[p[3]-p[0],p[4]-p[1],p[5]-p[2]],v=[p[6]-p[0],p[7]-p[1],p[8]-p[2]];
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...n),a=length/2;area+=a;
    if(!length){degenerate++;continue;}
    const axis=n.map(Math.abs).indexOf(Math.max(...n.map(Math.abs))),bin=axis*2+(n[axis]<0?1:0);
    for(const row of rows){
      const key=[0,1,2].map(k=>Math.floor((p[k]+p[k+3]+p[k+6])/3/row.pitch)).join(',');
      const cell=row.cells.get(key)||{area:0,mask:0};cell.area+=a;cell.mask|=1<<bin;row.cells.set(key,cell);
    }
  }
  return {triangles:positions.length/9,degenerate,area,bounds:{min:lo,max:hi},
    assumptions:{units:'scene units, not meters',surface:'centroid-cell occupancy and area quotas; not a constructed patch mesh',probe:'full bounding-box lattice before inside-solid rejection; not optimized placement',visibility:'not evaluated',quality:'no pitch or angular resolution is accepted by these counts'},
    rows:rows.map(({pitch,cells})=>{
      const occupiedCells=cells.size,orientedCells=[...cells.values()].reduce((s,c)=>s+c.mask.toString(2).replaceAll('0','').length,0);
      const areaQuota=Math.ceil(area/(pitch*pitch));
      const latticeShape=hi.map((x,k)=>Math.ceil((x-lo[k])/pitch)+1),probes=latticeShape.reduce((a,b)=>a*b,1);
      return {pitch,occupiedCentroidCells:occupiedCells,orientedCentroidCells:orientedCells,
        cellsWithOpposingNormals:[...cells.values()].filter(c=>[3,12,48].some(mask=>(c.mask&mask)===mask)).length,
        areaQuota,denseAreaQuotaCoefficients:areaQuota**2,denseAreaQuotaFloat32Bytes:areaQuota**2*4,
        probeLatticeShape:latticeShape,probeCandidates:probes,
        probeHitBudgets:[128,512].map(directions=>({directions,hits:probes*directions,bytesAt32PerHit:probes*directions*32}))};
    })};
}
