import {Group,Mesh,BoxGeometry,CylinderGeometry,MeshStandardMaterial} from '../lib/three.core.js';
// Authored rigid obstacles; their actual triangles enter the shared voxel producer.
export function createAshLandscapeFixture(groundY){
 const root=new Group();root.name='Ash landscape — static supports';
 const stone=new MeshStandardMaterial({color:0x66665d,roughness:1});
 const timber=new MeshStandardMaterial({color:0x554439,roughness:1});
 const add=(name,geometry,material,position,angle=0)=>{const mesh=new Mesh(geometry,material);mesh.name=name;mesh.position.fromArray(position);mesh.position.y+=groundY;mesh.rotation.y=angle;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);return mesh;};
 add('Low stone plinth',new BoxGeometry(1.25,.44,.9),stone,[-2,.22,-1.5],-.15);
 add('Fallen timber',new BoxGeometry(1.65,.25,.3),timber,[2,.125,1.8],.35);
 add('Stone drum',new CylinderGeometry(.44,.49,1.05,32),stone,[2.15,.525,-1.45]);
 add('Bridge left foot',new BoxGeometry(.25,.75,.7),stone,[-2.65,.375,1.65]);
 add('Bridge right foot',new BoxGeometry(.25,.75,.7),stone,[-1.35,.375,1.65]);
 add('Bridge lintel',new BoxGeometry(1.65,.22,.8),stone,[-2,.86,1.65]);
 return root;
}
