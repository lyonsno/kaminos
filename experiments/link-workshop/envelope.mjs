import * as T from '../../lib/three.core.js';
import {constructBodies} from './bodies.mjs';
import {frames} from './model.mjs';

// A source-owned design guide. Primitive outer boxes fill holes and may reserve
// extra space. Temporal padding encloses continuous motion between samples.
export function motionSpace(recipe,{cellSize=.12,tolerance=.04}={}){
 if(![cellSize,tolerance].every(x=>Number.isFinite(x)&&x>0))throw Error('Cell size and tolerance must be finite and positive');
 const construction=constructBodies(recipe),cells=new Set(),bodies=[],speeds=[];
 try{
  recipe.nodes.forEach((n,i)=>{const p=speeds[n.parent];speeds[i]=n.parent===null?{v:0,w:0}:{w:p.w+Math.abs(n.angles[1]-n.angles[0]),v:p.v+n.length*(p.w+Math.abs(n.angles[1]-n.angles[0]))};});
  for(const def of construction.defs){
   def.object.updateMatrixWorld(true);const boxes=[];
   def.object.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();boxes.push(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}});
   const radius=Math.max(...boxes.map(b=>Math.hypot(Math.max(Math.abs(b.min.x),Math.abs(b.max.x)),Math.max(Math.abs(b.min.y),Math.abs(b.max.y)),Math.max(Math.abs(b.min.z),Math.abs(b.max.z)))));
   const index=Number(def.id.split(':')[1]);let v,w;
   if(def.kind==='barrel'||def.kind==='rod'){
    const p=recipe.pistons[index],range=construction.travels[index];
    if(range.min<=1e-8)throw Error(`Piston ${index+1}: positive attachment separation required for a continuous envelope; coincident mounts make its direction undefined`);
    v=speeds[def.kind==='barrel'?p.a:p.b].v;w=(speeds[p.a].v+speeds[p.b].v)/range.min;
   }else{const origin=def.kind==='link'?recipe.nodes[index].parent:index;v=speeds[origin].v;w=def.kind==='anchor'?0:speeds[index].w;}
   const speed=v+radius*w;
   if(!Number.isFinite(speed))throw Error('Motion-space bound exceeds numeric range');
   const intervals=Math.max(1,Math.ceil(speed/(2*tolerance))),padding=speed/(2*intervals);
   if(!Number.isSafeInteger(intervals))throw Error('Motion-space resolution exceeds numeric range');
   bodies.push({id:def.id,geometryKey:def.geometryKey,intervals,padding,speedBound:speed});
   for(let k=0;k<intervals;k++){
    const pose=def.pose(frames(recipe,(k+.5)/intervals)),c=Math.cos(pose.angle),s=Math.sin(pose.angle),[px,py,pz]=pose.position;
    const m=new T.Matrix4().makeRotationZ(pose.angle);m.setPosition(px,py,pz);
    const inflate=padding+Math.sqrt(3)*cellSize/2;
    for(const box of boxes){
     const world=box.clone().applyMatrix4(m).expandByScalar(padding+cellSize/2),lo=world.min.toArray().map(x=>Math.floor(x/cellSize)),hi=world.max.toArray().map(x=>Math.floor(x/cellSize));
     for(let x=lo[0];x<=hi[0];x++)for(let y=lo[1];y<=hi[1];y++)for(let z=lo[2];z<=hi[2];z++){
      const dx=(x+.5)*cellSize-px,dy=(y+.5)*cellSize-py,lx=c*dx+s*dy,ly=-s*dx+c*dy,lz=(z+.5)*cellSize-pz;
      if(lx>=box.min.x-inflate&&lx<=box.max.x+inflate&&ly>=box.min.y-inflate&&ly<=box.max.y+inflate&&lz>=box.min.z-inflate&&lz<=box.max.z+inflate)cells.add(`${x},${y},${z}`);
     }
    }
   }
  }
  return {schema:'kaminos.motion-space.v1',method:'continuous outer-box enclosure',frame:'assembly-local',geometrySource:'constructed analytical bodies',recipe:structuredClone(recipe),cellSize,tolerance,bodies,cells:[...cells].map(s=>s.split(',').map(Number)),legend:{violet:'Reserved space for the entire authored motion; do not fill with housing'},limits:'Outer boxes fill bores and concavities. Covers the analytical construction, not replacement meshes. Does not establish collision freedom between moving bodies or generated geometry.'};
 }finally{for(const d of construction.defs)d.object.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();});}
}

export function motionSpaceMesh(packet){
 const occupied=new Set(packet.cells.map(c=>c.join(','))),positions=[];
 const faces=[[[1,0,0],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]]],[[-1,0,0],[[0,0,1],[0,1,1],[0,1,0],[0,0,0]]],[[0,1,0],[[0,1,1],[1,1,1],[1,1,0],[0,1,0]]],[[0,-1,0],[[0,0,0],[1,0,0],[1,0,1],[0,0,1]]],[[0,0,1],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]],[[0,0,-1],[[0,1,0],[1,1,0],[1,0,0],[0,0,0]]]];
 for(const cell of packet.cells)for(const [n,corners]of faces){if(occupied.has(cell.map((x,i)=>x+n[i]).join(',')))continue;for(const j of [0,1,2,0,2,3])positions.push(...cell.map((x,i)=>(x+corners[j][i])*packet.cellSize));}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.computeVertexNormals();
 const mesh=new T.Mesh(g,new T.MeshBasicMaterial({color:0xbd69d6,transparent:true,opacity:.24,depthWrite:false,side:T.DoubleSide}));mesh.name='Reserved motion space';mesh.userData.motionSpace=packet;return mesh;
}
