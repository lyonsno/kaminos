// Authored frozen microgeometry, not a soil-evolution simulation. X/Z are U/V;
// Y is the outward normal. A finite halo repeats the source around the unit tile.
export function createGroundTeacherSource(options={}){
 const config={seed:41,cells:24,grains:64,tileSize:1,relief:.028,halo:1,...options};
 const {seed,cells,grains,tileSize,relief,halo}=config;
 if(!Number.isSafeInteger(seed)||!Number.isSafeInteger(cells)||cells<2||!Number.isSafeInteger(grains)||grains<0||!Number.isSafeInteger(halo)||halo<0||!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(relief)||relief<0)throw Error('Invalid ground source controls');
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return (state+.5)/4294967296;};
 const phases=Array.from({length:5},()=>random()*Math.PI*2);
 const height=(u,v)=>relief*(.45*Math.sin(2*Math.PI*(u+v)+phases[0])+.28*Math.cos(2*Math.PI*(3*u-v)+phases[1])+.15*Math.sin(2*Math.PI*(7*u+5*v)+phases[2])+.12*Math.cos(2*Math.PI*(11*u-9*v)+phases[3]));
 const materials=[
  {name:'fine earth matrix',color:[.24,.153,.075],roughness:.95,metalness:0},
  {name:'dark angular grit',color:[.12,.105,.078],roughness:.65,metalness:0},
  {name:'pale mineral grit',color:[.43,.36,.24],roughness:.76,metalness:0},
  {name:'broken earthy clods',color:[.29,.185,.085],roughness:.96,metalness:0},
 ];
 const triangles=[],grainRecords=[];
 const add=(a,b,c,materialIndex,kind,identity)=>triangles.push({a,b,c,materialIndex,kind,identity});
 const point=(u,v)=>[(u-.5)*tileSize,height(u,v)*tileSize,(v-.5)*tileSize];
 for(let y=0;y<cells;y++)for(let x=0;x<cells;x++){
  const a=point(x/cells,y/cells),b=point((x+1)/cells,y/cells),c=point((x+1)/cells,(y+1)/cells),d=point(x/cells,(y+1)/cells);
  add(a,c,b,0,'matrix',`matrix-${x}-${y}`);add(a,d,c,0,'matrix',`matrix-${x}-${y}`);
 }
 // Closed irregular bipyramids: the equatorial outline makes real facets,
 // crevices and shadows; the bottom lies beneath the continuous matrix.
 for(let i=0;i<grains;i++){
  const u=random(),v=random(),r=(.015+.05*random()**2)*tileSize,cy=height(u,v)*tileSize;
  const cx=(u-.5)*tileSize,cz=(v-.5)*tileSize,turn=random()*2*Math.PI,sy=.45+random()*.5;
  const top=[cx+(random()-.5)*r*.4,cy+r*sy,cz+(random()-.5)*r*.4],bottom=[cx,cy-r*.7,cz];
  const ring=Array.from({length:7},(_,j)=>{const angle=turn+j*2*Math.PI/7,radius=r*(.7+random()*.45);return [cx+Math.cos(angle)*radius,cy-r*.08,cz+Math.sin(angle)*radius];});
  const materialIndex=i%5===0?3:1+i%2,identity=`grain-${i}`;
  for(let j=0;j<ring.length;j++){const a=ring[j],b=ring[(j+1)%ring.length];add(top,b,a,materialIndex,'grain',identity);add(bottom,a,b,materialIndex,'grain',identity);}
  grainRecords.push({identity,materialIndex,matrixHeight:cy,bottom:bottom[1],top:top[1]});
 }
 const central=triangles.slice();
 for(let z=-halo;z<=halo;z++)for(let x=-halo;x<=halo;x++)if(x||z)for(const t of central){const shift=p=>[p[0]+x*tileSize,p[1],p[2]+z*tileSize];triangles.push({...t,a:shift(t.a),b:shift(t.b),c:shift(t.c),kind:`halo-${t.kind}`,identity:`${t.identity}@${x},${z}`});}
 const top=Math.max(...central.flatMap(t=>[t.a[1],t.b[1],t.c[1]]));
 return {schema:'kaminos.authored-ground-source.v1',config,triangles,materials,grains:grainRecords,referenceHeight:top+.002*tileSize,
  boundary:'periodic source with finite repeated halo; infinite periodic transport is not claimed',unit:'one square material tile'};
}
