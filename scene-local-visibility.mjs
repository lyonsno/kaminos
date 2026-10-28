import * as THREE from './lib/three.webgpu.js';
import {staticSceneGeometryRevision} from './scene-light-geometry.mjs';
import {buildTriangleVisibility} from './scene-light-visibility.mjs';
import {residentLightCoverage,validateResidentLightCoverage,residentCellTriangles} from './scene-resident-coverage.mjs';

// Independent local-space BVHs form a stackless forest. A root's escape
// points at the next root, so existing closest-hit traversals visit every mesh.
// Transforms are deliberately absent from topology identity.
export function createLocalSceneVisibility({readCoverage=residentLightCoverage}={}) {
  const cache=new WeakMap(),ids=new WeakMap();let serial=0,previous='',packed=null,builds=0;
  const id=value=>{if(!value)return null;if(!ids.has(value))ids.set(value,++serial);return ids.get(value);};
  return {snapshot(scene){
    staticSceneGeometryRevision(scene,{exclude:m=>!!readCoverage(m)});
    const meshes=[],coverageByMesh=new Map();
    scene.traverseVisible(m=>{if(m.isMesh&&m.castShadow){const binding=readCoverage(m);if(binding){const value=validateResidentLightCoverage(m,binding);if(binding.owner!==m)return;coverageByMesh.set(m,value);}meshes.push(m);}});
    const coverage=[...coverageByMesh.values()][0]??null;
    const keys=meshes.map(m=>{const c=coverageByMesh.get(m);if(c)return JSON.stringify(['resident',id(c.texture),id(c.initial),c.dimensions,c.bounds.min.toArray(),c.bounds.max.toArray()]);const g=m.geometry,p=g.attributes.position,i=g.index;return JSON.stringify([id(g),g.version,id(p),p.version,p.count,id(i),i?.version,i?.count]);});
    const revision=JSON.stringify(meshes.map((m,i)=>[m.uuid,keys[i]]));
    const matrices=new Float32Array(Math.max(1,meshes.length)*16);
    if(!meshes.length)matrices.set(new THREE.Matrix4().elements);
    meshes.forEach((m,i)=>{
      if(!m.matrixWorld.elements.every(Number.isFinite)||m.matrixWorld.determinant()===0)throw Error('local visibility needs finite invertible mesh transforms');
      matrices.set(m.matrixWorld.elements,i*16);
    });
    if(revision!==previous||!packed){
      const parts=meshes.map((mesh,i)=>{
        const g=mesh.geometry,prior=cache.get(g);if(prior?.key===keys[i])return prior.packed;
        const coverage=coverageByMesh.get(mesh);
        if(coverage){const records=residentCellTriangles(coverage),result=buildTriangleVisibility(records).packGpu();for(let j=0;j<result.triangleCount;j++)result.triangles[j*12+3]=records[result.triangleIndices[j]].cell+1;cache.set(g,{key:keys[i],packed:result});builds++;return result;}
        const p=g.attributes.position,index=g.index,count=index?.count??p.count,records=[];
        if(count%3)throw Error('local visibility requires complete triangles');
        const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),cross=new THREE.Vector3(),edge=new THREE.Vector3();
        for(let j=0;j<count;j+=3){
          a.fromBufferAttribute(p,index?index.getX(j):j);b.fromBufferAttribute(p,index?index.getX(j+1):j+1);c.fromBufferAttribute(p,index?index.getX(j+2):j+2);
          const points=[a.toArray(),b.toArray(),c.toArray()];
          if(!points.flat().every(Number.isFinite))throw Error('local visibility has nonfinite vertices');
          if(cross.subVectors(b,a).cross(edge.subVectors(c,a)).lengthSq()===0)continue;
          records.push({a:points[0],b:points[1],c:points[2]});
        }
        const result=buildTriangleVisibility(records).packGpu();cache.set(g,{key:keys[i],packed:result});builds++;return result;
      });
      const nodeCount=parts.reduce((s,p)=>s+p.nodeCount,0),triangleCount=parts.reduce((s,p)=>s+p.triangleCount,0);
      const nodes=new Float32Array(Math.max(1,nodeCount)*12),triangles=new Float32Array(Math.max(1,triangleCount)*12),owners=new Uint32Array(Math.max(1,nodeCount+triangleCount)),words=new Uint32Array(nodes.buffer);
      const coverageRanges=[];
      let n=0,t=0;parts.forEach((p,owner)=>{
        if(coverageByMesh.has(meshes[owner]))coverageRanges.push({owner,triangleStart:t,triangleCount:p.triangleCount});
        nodes.set(p.nodes.subarray(0,p.nodeCount*12),n*12);triangles.set(p.triangles.subarray(0,p.triangleCount*12),t*12);
        for(let j=0;j<p.nodeCount;j++){words[(n+j)*12+8]+=n;words[(n+j)*12+9]+=t;owners[n+j]=owner;}
        owners.fill(owner,nodeCount+t,nodeCount+t+p.triangleCount);n+=p.nodeCount;t+=p.triangleCount;
      });
      packed={nodes,triangles,nodeCount,triangleCount,owners,matrices,coverage,coverageRanges};previous=revision;
    }else packed.matrices=matrices;
    packed.coverage=coverage;
    packed.coverages=packed.coverageRanges.map(({owner,...range})=>({...coverageByMesh.get(meshes[owner]),...range}));
    return {geometry:packed,revision,localBuilds:builds,meshCount:meshes.length};
  }};
}
