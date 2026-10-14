export function buildGpuStoneFixture(prepared, options = {}) {
  if (prepared?.schema !== 'kaminos.imported-solid.grid-intersection.manifold-3.5.4.v0' || !/^[a-f0-9]{64}$/.test(prepared.sourceSha256) || !prepared.cells?.length || !prepared.bonds?.length) throw new Error('Verified geometry-derived solid preparation required');
  if (!prepared.spacing?.every(n => Number.isFinite(n) && n > 0) || Math.abs(prepared.volume - prepared.totalVolume) > prepared.volume * 1e-5) throw new Error('Invalid prepared volume or spacing');
  const actualVolume = prepared.cells.reduce((sum, cell) => sum + cell.volume, 0);
  if (!(prepared.volume > 0) || !Number.isFinite(actualVolume) || Math.abs(actualVolume - prepared.volume) > prepared.volume * 1e-5) throw new Error('Prepared region volume ledger disagrees');
  const config = { layers: prepared.grid[2], depth: prepared.size[2], scale: 1, density: 1, gravity: 9.81, timeStep: 1/60,
    solverIterations: 20, stiffness: 10000, strength: 200, friction: .65, gripStiffness: 250, gripRadius: .7,
    initialJointPenalty: 10000, gravityRampSeconds: .5, substeps: 1, preventPenetratingNormalDropout: true, ...options };
  for (const name of ['density', 'timeStep', 'stiffness', 'strength', 'gripStiffness']) if (!(config[name] > 0) || !Number.isFinite(config[name])) throw new Error(`Invalid ${name}`);
  for (const name of ['gravity', 'friction', 'gripRadius', 'gravityRampSeconds']) if (config[name] < 0 || !Number.isFinite(config[name])) throw new Error(`Invalid ${name}`);
  if (!Number.isInteger(config.solverIterations) || config.solverIterations < 1 || config.initialJointPenalty < 1 || config.initialJointPenalty > config.stiffness) throw new Error('Invalid solver configuration');
  const cells = prepared.cells.map((cell, index) => {
    if (cell.index !== index || !(cell.volume > 0) || !cell.position.every(Number.isFinite)) throw new Error('Invalid prepared region');
    const pinned = cell.column === 0;
    return { index, id: cell.id, column: cell.column, row: cell.row, layer: cell.layer, pinned, position: [...cell.position], quaternion: [0,0,0,1],
      halfExtents: prepared.spacing.map(n => n/2), mass: pinned ? 0 : cell.volume * config.density, volume: cell.volume };
  });
  const bonds = prepared.bonds.filter(b => !(cells[b.a]?.pinned && cells[b.b]?.pinned)).map(b => {
    if (!cells[b.a] || !cells[b.b] || !(b.area > 0) || !Number.isFinite(b.area)) throw new Error('Invalid prepared interface');
    return { ...b, normal: [...b.normal], anchorA: [...b.anchorA], anchorB: [...b.anchorB] };
  });
  return { cells, bonds, config, dimensions: Object.fromEntries(['dx','dy','dz'].map((key, i) => [key, prepared.spacing[i]])), floorY: -1.5 };
}

export function preparedContactNormal(surfaceNormal, exposed) {
  if(!Array.isArray(surfaceNormal)||surfaceNormal.length!==3||!surfaceNormal.every(Number.isFinite)||!Array.isArray(exposed))throw new Error('Finite triangle direction and exposed faces required');
  const ranked=exposed.map(normal=>({normal,dot:normal.reduce((sum,n,a)=>sum+n*surfaceNormal[a],0)})).sort((a,b)=>b.dot-a.dot);
  return ranked[0]?.dot>0?[...ranked[0].normal]:null;
}

export const AXIAL_CHUNK_FIXTURE_ROUTE='kaminos.stone.axial-chunk-fixture.v1';

export function packAxialChunkFixtureStrengths(arrays,body){
  if(body?.route!==AXIAL_CHUNK_FIXTURE_ROUTE||!(arrays.bonds instanceof Uint32Array)||arrays.bonds.length%4)throw Error('Explicit axial fixture bonds required');
  const words=new Uint32Array(new Float32Array([1,64]).buffer);
  for(let i=0;i<arrays.bonds.length;i+=4){const a=body.positions[arrays.bonds[i]],b=body.positions[arrays.bonds[i+1]];if(!a||!b)throw Error('Axial bond endpoint outside fixture');const crosses=(a[0]<body.neck.plane&&b[0]>body.neck.plane)||(b[0]<body.neck.plane&&a[0]>body.neck.plane);arrays.bonds[i+3]=words[crosses?0:1];}
  return{neckStrength:1,interiorStrength:64,claim:'Finite authored weak-neck control, not imported-stone calibration'};
}

export function buildAxialChunkFixture(){
  const spacing=.2,positions=[],tetrahedra=[],ids=new Map(),cells=[];
  const node=(x,y,z)=>{
    const key=`${x}:${y}:${z}`;
    if(!ids.has(key)){ids.set(key,positions.length);positions.push([x*spacing-.6,y*spacing-.3,z*spacing-.3]);}
    return ids.get(key);
  };
  // A conforming six-tetrahedron cube split shares the same face diagonals.
  const split=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
  for(let x=0;x<6;x++)for(let y=0;y<3;y++)for(let z=0;z<3;z++){
    if(x===2&&(y!==1||z!==1))continue;
    const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]].map(([a,b,c])=>node(x+a,y+b,z+c));
    cells.push([x,y,z]);for(const tet of split)tetrahedra.push(tet.map(i=>corners[i]));
  }
  const faces=new Map();
  for(const tet of tetrahedra)for(let opposite=0;opposite<4;opposite++){
    const face=tet.filter((_,i)=>i!==opposite),key=[...face].sort((a,b)=>a-b).join(':');
    if(faces.has(key))faces.delete(key);else faces.set(key,{face,opposite:tet[opposite]});
  }
  const properties=[],indices=[],exterior=[];
  for(const entry of faces.values()){
    let face=entry.face;const [a,b,c]=face.map(i=>positions[i]),u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]);
    let normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    if(normal.reduce((sum,n,k)=>sum+n*(positions[entry.opposite][k]-a[k]),0)>0){face=[face[0],face[2],face[1]];normal=normal.map(n=>-n);}
    const length=Math.hypot(...normal);normal=normal.map(n=>n/length);
    for(const id of face){const p=positions[id];indices.push(properties.length/12);properties.push(...p,...normal,(p[0]+.6)/1.2,(p[2]+.3)/.6,1,0,0,1);}
    exterior.push(true);
  }
  return{status:'passed',route:AXIAL_CHUNK_FIXTURE_ROUTE,provenance:'authored-procedural-control-not-imported-or-calibrated-stone',positions,tetrahedra,volume:cells.length*spacing**3,
    geometry:{numProp:12,properties,indices,exterior},bounds:{min:[-.6,-.3,-.3],max:[.6,.3,.3]},supports:positions.flatMap((p,i)=>p[0]===-.6?[i]:[]),
    neck:{plane:-.1,axis:[1,0,0],crossSection:[.2,.2]},firstInjury:{point:[.6,0,0],direction:[1,0,0]},secondInjury:{point:[.35,0,.3],direction:[0,1,0]},
    claim:'Axial detachment and secondary-injury control; not imported geometry, rigidity, fracture or performance evidence'};
}
