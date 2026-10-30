import {checkedPose} from './scene-edit-session.mjs';
import {normalizeBurner,createAnnularBurner} from './annular-burner.mjs';
export const PROCEDURAL_MESH_TYPE='procedural-mesh';
export const PROCEDURAL_MESH_SOURCE='kaminos:geometry';
export const proceduralMeshRecordDomain={type:PROCEDURAL_MESH_TYPE,check:checkedProceduralMesh,
 fields:r=>({geometry:r.geometry,surface:r.surface,...(r.waterCollision===false?{waterCollision:false}:{})}),
 reloadable:r=>{checkedProceduralMesh(r);return true;},load:(r,loaders,options)=>loaders.procedural(r,options)};
export const ANNULAR_SURFACE_KEYS=['bedColor','rimColor','glowColor','glow','coolingSeconds'];
export const GEOMETRY_DEFAULTS={box:{width:1,height:1,depth:1},plane:{width:2,depth:2},sphere:{radius:.5},bowl:{radius:.7,thickness:.08},cylinder:{radius:.5,height:1}};
export function checkedGeometry(value) {
 if(!value || typeof value!=='object')throw Error('Geometry data is required');
 if(value.kind==='annular'){const parameters=normalizeBurner(value.parameters);for(const key of [...ANNULAR_SURFACE_KEYS,'fieldBinding'])delete parameters[key];return {kind:'annular',parameters};}
 const defaults=GEOMETRY_DEFAULTS[value.kind];if(!defaults)throw Error('Unsupported procedural geometry');
 const parameters={...defaults,...value.parameters};
 for(const key of Object.keys(defaults))if(!(typeof parameters[key]==='number' && Number.isFinite(parameters[key]) && parameters[key]>0))throw Error(`Geometry ${key} must be positive`);
 if(value.kind==='bowl'&&parameters.thickness>=2*parameters.radius)throw Error('Bowl thickness must be less than its diameter');
 return {kind:value.kind,parameters};
}
export function checkedProceduralMesh(raw) {
 const legacy=raw.type==='burner-bed' && raw.source==='kaminos:annular-bed';
 if(!legacy && (raw.type!==PROCEDURAL_MESH_TYPE || raw.source!==PROCEDURAL_MESH_SOURCE))throw Error('Unsupported procedural mesh source');
 const input=legacy?{kind:'annular',parameters:raw.burner}:raw.geometry;
 const geometry=checkedGeometry(input);
 if(raw.waterCollision!==undefined&&typeof raw.waterCollision!=='boolean')throw Error('Water collision must be Boolean');
 let surface=raw.surface || {};
 if(geometry.kind==='annular'){const recipe=normalizeBurner({...input.parameters,...surface});surface={...Object.fromEntries(ANNULAR_SURFACE_KEYS.map(key=>[key,recipe[key]])),fieldBinding:raw.surface?.fieldBinding??(legacy?'flame-field':null)};if(![null,'flame-field'].includes(surface.fieldBinding))throw Error('Unknown material response field');}
 else {surface={color:'#92979c',roughness:.55,metalness:.05,...surface};if(!/^#[a-f0-9]{6}$/i.test(surface.color)||!Number.isFinite(surface.roughness)||surface.roughness<0||surface.roughness>1||!Number.isFinite(surface.metalness)||surface.metalness<0||surface.metalness>1)throw Error('Invalid mesh material');}
 const {burner,...record}=raw;
 return {...record,type:PROCEDURAL_MESH_TYPE,source:PROCEDURAL_MESH_SOURCE,geometry,surface,transform:checkedPose(raw.transform)};
}
export function createProceduralMesh(THREE,mergeGeometries,geometry,surface={}) {
 const {kind,parameters:p}=checkedGeometry(geometry);
 if(kind==='annular')return createAnnularBurner(THREE,mergeGeometries,{...p,...surface});
 let shape;
 if(kind==='box')shape=new THREE.BoxGeometry(p.width,p.height,p.depth);
 if(kind==='plane'){shape=new THREE.PlaneGeometry(p.width,p.depth);shape.rotateX(-Math.PI/2);}
 if(kind==='sphere')shape=new THREE.SphereGeometry(p.radius,32,16);
 if(kind==='bowl'){
  const outer=new THREE.SphereGeometry(p.radius+p.thickness/2,48,24,0,Math.PI*2,Math.PI/2,Math.PI/2);
  const inner=new THREE.SphereGeometry(p.radius-p.thickness/2,48,24,0,Math.PI*2,Math.PI/2,Math.PI/2);
  const indices=inner.index.array;for(let i=0;i<indices.length;i+=3){const a=indices[i];indices[i]=indices[i+2];indices[i+2]=a;}
  for(let i=0;i<inner.attributes.normal.count;i++)for(const axis of ['X','Y','Z'])inner.attributes.normal['set'+axis](i,-inner.attributes.normal['get'+axis](i));
  const rim=new THREE.RingGeometry(p.radius-p.thickness/2,p.radius+p.thickness/2,48);rim.rotateX(-Math.PI/2);
  shape=mergeGeometries([outer,inner,rim],false);outer.dispose();inner.dispose();rim.dispose();
 }
 if(kind==='cylinder')shape=new THREE.CylinderGeometry(p.radius,p.radius,p.height,32);
 const material=new THREE.MeshStandardMaterial({color:surface.color||'#92979c',roughness:surface.roughness??.55,metalness:surface.metalness??.05,side:kind==='plane'?THREE.DoubleSide:THREE.FrontSide});
 const mesh=new THREE.Mesh(shape,material);mesh.castShadow=true;mesh.receiveShadow=true;
 return {group:mesh,update(){},updateSurface(next){material.color.set(next.color);material.roughness=next.roughness;material.metalness=next.metalness;},dispose(){mesh.removeFromParent();shape.dispose();material.dispose();}};
}
