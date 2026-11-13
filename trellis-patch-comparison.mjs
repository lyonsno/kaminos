import {BufferGeometry,BufferAttribute,Mesh,Group,Vector3,MeshStandardMaterial,LineSegments,LineBasicMaterial} from './lib/three.core.js';
import {MeshStandardNodeMaterial} from './lib/three.webgpu.js';
import {attribute,wgslFn,normalFlat,positionViewDirection,transformNormalToView} from './lib/three.tsl.js';
import {TRELLIS_SOURCE_NORMAL_WGSL} from './trellis-source-normal.mjs';
import {prepareSupportVolume,materializeFragments,supportFrame} from './trellis-local-support.mjs';
import {clipSupportVolume} from './trellis-support-gpu.mjs';
import {loadNeumipModel} from './neumip-model.mjs';
import {createNeumipMaterial} from './neumip-material.mjs';
import {loadRawFieldBundle} from './trellis-raw-bundle.mjs';
const linear=x=>{x=Math.max(0,Math.min(1,x));return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;};
const gFrom=part=>{const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(part.positions,3));if(part.normals)g.setAttribute('normal',new BufferAttribute(part.normals,3));else g.computeVertexNormals();if(part.uvs)g.setAttribute('uv',new BufferAttribute(part.uvs,2));return g;};
class DirectSourceMaterial extends MeshStandardNodeMaterial{
 setupLightingModel(builder){const lighting=super.setupLightingModel(builder);lighting.indirect=()=>{};return lighting;}
}
export function createPatchPlaneGeometry(region,tileSize,height){
 if(!Number.isFinite(tileSize)||tileSize<=0||!Number.isFinite(height))throw Error('Finite physical patch size and reference height required');
 const f=supportFrame(region),positions=[],normals=[],uvs=[];
 for(const [u,v]of [[0,0],[1,1],[1,0],[0,0],[0,1],[1,1]]){positions.push(...f.origin.map((x,k)=>x+(u-.5)*tileSize*f.u[k]-(v-.5)*tileSize*f.v[k]+height*f.n[k]));normals.push(...f.n);uvs.push(u,v);}
 const g=gFrom({positions:Float32Array.from(positions),normals:Float32Array.from(normals),uvs:Float32Array.from(uvs)});g.setAttribute('tangent',new BufferAttribute(Float32Array.from(Array.from({length:6},()=>[...f.u,-1]).flat()),4));return g;
}
function rawPatch(source,candidate){
 const g=gFrom(materializeFragments(source,candidate.patch,candidate.frame)),colors=[],roughness=[],metalness=[];
 for(const t of candidate.patch)for(const v of t.vertices){
  for(let c=0;c<3;c++)colors.push(v.b.reduce((sum,w,k)=>sum+w*linear(source.materialRows[source.indices[t.sourceTriangle*3+k]*6+c]),0));
  for(const [channel,out]of [[4,roughness],[3,metalness]])out.push(v.b.reduce((sum,w,k)=>sum+w*source.materialRows[source.indices[t.sourceTriangle*3+k]*6+channel],0));
 }
 g.setAttribute('rawLinearColor',new BufferAttribute(Float32Array.from(colors),3));g.setAttribute('rawRoughness',new BufferAttribute(Float32Array.from(roughness),1));g.setAttribute('rawMetalness',new BufferAttribute(Float32Array.from(metalness),1));
 const material=new DirectSourceMaterial();const rawNormal=transformNormalToView(attribute('normal','vec3')).toVarying('v_trellisRawNormalView'),geometric=normalFlat.dot(positionViewDirection).lessThan(0).select(normalFlat.negate(),normalFlat);material.normalNode=wgslFn(TRELLIS_SOURCE_NORMAL_WGSL)(rawNormal,geometric,positionViewDirection);material.colorNode=attribute('rawLinearColor','vec3');material.roughnessNode=attribute('rawRoughness','float').clamp(0,1);material.metalnessNode=attribute('rawMetalness','float').clamp(0,1);material.side=2;material.isMeshStandardNodeMaterial=false;
 return new Mesh(g,material);
}
export function rawBundleSiblingUrl(manifest,name){
 if(!['surfels.f32','triangles.u32','source-triangle-ids.u32','source-vertex-ids.u32'].includes(name))throw Error('Invalid raw bundle sibling');
 const url=new URL(manifest);if(url.pathname==='/api/read'&&url.searchParams.has('path')){const file=url.searchParams.get('path');url.searchParams.set('path',file.slice(0,file.lastIndexOf('/')+1)+name);return url.href;}return new URL(name,new URL('.',url)).href;
}
const digest=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
export async function createTrellisPatchComparison({device,source,sourceMesh,entry,contextSourceUrl,contextHash}){
 if(entry.contextSource!==contextSourceUrl||entry.contextSha256!==contextHash)throw Error('Checkpoint context source does not match this mesh');
 const waiting=entry.trainingPending===true&&entry.model==null&&['raw-fields','glb'].includes(entry.teacher?.kind);
 if((!waiting&&!entry.model?.sha256)||!entry.region||!Number.isFinite(entry.samplingPlaneHeight)||!(entry.tileSize>0&&entry.tileSize<=2*entry.region.radius)||entry.lod!==0)throw Error('Checkpoint requires exact source, region, reference plane and trained LOD0');
 const owned=[];let root,model,sourcePatch,studentPatch,disposed=false;
 try{
  if(!waiting)model=await loadNeumipModel(entry.model.url,{sha256:entry.model.sha256});
  const recipe={...entry.region,radius:entry.tileSize/2},prepared=prepareSupportVolume(source,recipe),candidate={...prepared,...await clipSupportVolume(device,prepared)};
  let rawSource;
  if(entry.teacher?.kind==='raw-fields'){
   const response=await fetch(entry.teacher.url);if(!response.ok)throw Error('Raw source manifest unavailable');const bytes=new Uint8Array(await response.arrayBuffer());if(await digest(bytes)!==entry.teacher.sha256)throw Error('Raw source manifest hash mismatch');
   rawSource=await loadRawFieldBundle(bytes,async name=>{const r=await fetch(rawBundleSiblingUrl(response.url,name));if(!r.ok)throw Error('Missing raw source '+name);return new Uint8Array(await r.arrayBuffer());});
   if(JSON.stringify(supportFrame(rawSource.provenance.region))!==JSON.stringify(supportFrame(entry.region))||(rawSource.provenance.region.top??.01)!==(entry.region.top??.01))throw Error('Raw comparison region does not match source bundle');
   const p=prepareSupportVolume(rawSource,recipe),rawCandidate={...p,...await clipSupportVolume(device,p)};sourcePatch=rawPatch(rawSource,rawCandidate);
  }else{
   const material=new DirectSourceMaterial();MeshStandardMaterial.prototype.copy.call(material,sourceMesh.material);material.isMeshStandardNodeMaterial=false;sourcePatch=new Mesh(gFrom(materializeFragments(source,candidate.patch,candidate.frame)),material);
  }
  owned.push(sourcePatch.geometry,sourcePatch.material);
  const untouched=sourceMesh.geometry.clone();untouched.setIndex(new BufferAttribute(Uint32Array.from(Array.from(candidate.untouched).flatMap(t=>[source.indices[t*3],source.indices[t*3+1],source.indices[t*3+2]])),1));
  const retained=gFrom(materializeFragments(source,candidate.retained,candidate.frame));owned.push(untouched,retained);
  const plane=createPatchPlaneGeometry(entry.region,entry.tileSize,entry.samplingPlaneHeight);owned.push(plane);if(model){const neural=createNeumipMaterial(model,{uvScale:1,gain:1,lod:0});owned.push(neural.material);studentPatch=new Mesh(plane,neural.material);}
  root=new Group();root.name='Source / learned section in original PBR surroundings';root.matrixAutoUpdate=false;sourceMesh.updateMatrix();root.matrix.copy(sourceMesh.matrix);
  root.add(new Mesh(untouched,sourceMesh.material),new Mesh(retained,sourceMesh.material),sourcePatch);if(studentPatch)root.add(studentPatch);for(const o of root.children){o.castShadow=true;o.receiveShadow=true;}sourcePatch.receiveShadow=false;if(studentPatch)studentPatch.receiveShadow=false;
  const borderGeometry=new BufferGeometry();const point=plane.attributes.position;const borderPositions=[0,2,2,1,1,4,4,0].flatMap(i=>[point.getX(i),point.getY(i),point.getZ(i)]);borderGeometry.setAttribute('position',new BufferAttribute(Float32Array.from(borderPositions),3));const borderMaterial=new LineBasicMaterial({color:0x63d6cc,transparent:true,opacity:.8,depthTest:false,depthWrite:false}),border=new LineSegments(borderGeometry,borderMaterial);border.name='Section chart boundary';border.renderOrder=3;root.add(border);owned.push(borderGeometry,borderMaterial);
  sourceMesh.parent.add(root);root.visible=false;
  let requested='source',effective='source';
  const set=(value,cameraPosition)=>{
   if(disposed)throw Error('Patch comparison is disposed');if(!['source','learned'].includes(value))throw Error('Unknown section appearance');if(value==='learned'&&!model)throw Error('Training pending: no learned checkpoint exists for this source section');requested=value;
   const frame=supportFrame(entry.region),p=cameraPosition?.clone();if(p){sourceMesh.updateWorldMatrix(true,false);sourceMesh.worldToLocal(p);p.sub(new Vector3().fromArray(frame.origin)).normalize();}
   const cosine=p?p.dot(new Vector3().fromArray(frame.n)):1;effective=value==='learned'&&cosine<.1?'source-outside-trained-hemisphere':value;
   sourcePatch.visible=effective!=='learned';if(studentPatch)studentPatch.visible=effective==='learned';sourceMesh.updateMatrix();root.matrix.copy(sourceMesh.matrix);
  };
  set('source');
  return {root,sourcePatch,studentPatch,set,setOutline(value){if(typeof value!=='boolean')throw Error('Section outline must be boolean');border.visible=value;},read:()=>({available:true,learnedAvailable:!!model,trainingPending:waiting,requested,effective,lod:0,outline:border.visible,checkpoint:{id:entry.id,label:entry.label,sha256:entry.model?.sha256??null,url:model?.source.url??null,bytes:model?.source.bytes??0,resolution:model?.mips[0].width??null,coverage:!!model?.coverage},sourceIdentity:entry.teacher?.sha256??contextHash,contextIdentity:contextHash,region:entry.region,tileSize:entry.tileSize,samplingPlaneHeight:entry.samplingPlaneHeight,lighting:'Source section and learner use native direct lights, no indirect/environment response; surrounding PBR unchanged',geometry:'Source section uses exact selected triangles; learner uses one planar tile with learned offset and optional coverage. No learned depth buffer or external shadow reconstruction.',worldCenter:sourceMesh.localToWorld(new Vector3().fromArray(entry.region.origin).addScaledVector(new Vector3().fromArray(supportFrame(entry.region).n),entry.samplingPlaneHeight)).toArray(),sourceTriangles:sourcePatch.geometry.attributes.position.count/3,renderState:[sourcePatch,studentPatch].filter(Boolean).map(m=>({visible:m.visible,parentVisible:m.parent.visible,type:m.material.type,lights:m.material.lights,opacity:m.material.opacity,side:m.material.side,depthTest:m.material.depthTest,positionCount:m.geometry.attributes.position.count,worldPosition:m.getWorldPosition(new Vector3()).toArray(),normal:Array.from(m.geometry.attributes.normal.array.slice(0,3)),emissive:m.material.emissive?.toArray(),ancestors:(()=>{const a=[];for(let o=m;o;o=o.parent)a.push({name:o.name,type:o.type,visible:o.visible});return a;})()}))}),dispose(){if(disposed)return;disposed=true;root.removeFromParent();for(const resource of owned)resource.dispose();}};
 }catch(e){root?.removeFromParent();for(const resource of owned)resource.dispose();throw e;}
}
