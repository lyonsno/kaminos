import {checkedPose} from './scene-edit-session.mjs';
import {normalizeBurner,createAnnularBurner} from './annular-burner.mjs';
export const PROCEDURAL_MESH_TYPE='procedural-mesh';
export const PROCEDURAL_MESH_SOURCE='kaminos:geometry';
export const ANNULAR_SURFACE_KEYS=['bedColor','rimColor','glowColor','glow','coolingSeconds'];
export const GEOMETRY_DEFAULTS={box:{width:1,height:1,depth:1},plane:{width:2,depth:2},sphere:{radius:.5},cylinder:{radius:.5,height:1}};
export function checkedGeometry(value) {
 if(!value || typeof value!=='object')throw Error('Geometry data is required');
 if(value.kind==='annular'){const parameters=normalizeBurner(value.parameters);for(const key of [...ANNULAR_SURFACE_KEYS,'fieldBinding'])delete parameters[key];return {kind:'annular',parameters};}
 const defaults=GEOMETRY_DEFAULTS[value.kind];if(!defaults)throw Error('Unsupported procedural geometry');
 const parameters={...defaults,...value.parameters};
 for(const key of Object.keys(defaults))if(!(typeof parameters[key]==='number' && Number.isFinite(parameters[key]) && parameters[key]>0))throw Error(`Geometry ${key} must be positive`);
 return {kind:value.kind,parameters};
}
export function checkedProceduralMesh(raw) {
 const legacy=raw.type==='burner-bed' && raw.source==='kaminos:annular-bed';
 if(!legacy && (raw.type!==PROCEDURAL_MESH_TYPE || raw.source!==PROCEDURAL_MESH_SOURCE))throw Error('Unsupported procedural mesh source');
 const input=legacy?{kind:'annular',parameters:raw.burner}:raw.geometry;
 const geometry=checkedGeometry(input);
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
 if(kind==='cylinder')shape=new THREE.CylinderGeometry(p.radius,p.radius,p.height,32);
 const material=new THREE.MeshStandardMaterial({color:surface.color||'#92979c',roughness:surface.roughness??.55,metalness:surface.metalness??.05,side:kind==='plane'?THREE.DoubleSide:THREE.FrontSide});
 const mesh=new THREE.Mesh(shape,material);mesh.castShadow=true;mesh.receiveShadow=true;
 return {group:mesh,update(){},dispose(){mesh.removeFromParent();shape.dispose();material.dispose();}};
}
