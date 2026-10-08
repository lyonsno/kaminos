import {BufferGeometry,Float32BufferAttribute} from 'three';
export function createShardGeometry(g){
 if(!Number.isInteger(g?.numProp)||g.numProp<12||!Array.isArray(g.properties)||!g.properties.length||g.properties.length%g.numProp||!g.properties.every(Number.isFinite)||!Array.isArray(g.indices)||!g.indices.length||g.indices.length%3||!g.indices.every(i=>Number.isInteger(i)&&i>=0&&i<g.properties.length/g.numProp)||!Array.isArray(g.exterior)||g.exterior.length!==g.indices.length/3||!g.exterior.every(v=>typeof v==='boolean'))throw new Error('Complete attributed shard geometry and material lineage required');
 const geometry=new BufferGeometry();for(const [name,start,size] of [['position',0,3],['normal',3,3],['uv',6,2],['tangent',8,4]])geometry.setAttribute(name,new Float32BufferAttribute(g.indices.flatMap(i=>g.properties.slice(i*g.numProp+start,i*g.numProp+start+size)),size));
 let material=-1,start=0;g.exterior.forEach((exterior,tri)=>{const next=exterior?0:1;if(next!==material){if(material>=0)geometry.addGroup(start,tri*3-start,material);start=tri*3;material=next;}});geometry.addGroup(start,g.indices.length-start,material);return geometry;
}
