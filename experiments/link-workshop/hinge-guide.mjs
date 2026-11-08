import * as T from '../../lib/three.core.js';
import {frameMatrix} from './mounts.mjs';
// One selected hinge: small mounting patches and its actual axle, all in the
// hardware's frame. No contact-plane torus impersonates the rotation axis.
export function createHingeGuide(parent,id,document){
 const group=new T.Group();group.userData.kaminosEditorOnly=true;group.userData.mechanismOverlay=true;parent.add(group);
 const patch=new T.PlaneGeometry(1,1),edges=new T.EdgesGeometry(patch),tube=new T.CylinderGeometry(.012,.012,1,12),cone=new T.ConeGeometry(.035,.1,12),materials=[],labels=[];
 const makeLabel=(text,color,owner)=>{
  const canvas=document?.createElement?.('canvas');if(!canvas?.getContext)return;
  canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d');if(!ctx)return;
  ctx.font='bold 32px sans-serif';ctx.textAlign='center';ctx.fillStyle=color;ctx.fillText(text,128,44);
  const texture=new T.CanvasTexture(canvas),material=new T.SpriteMaterial({map:texture,depthTest:false,depthWrite:false,toneMapped:false}),sprite=new T.Sprite(material);sprite.scale.set(.34,.085,1);sprite.position.y=.16;sprite.renderOrder=120;sprite.raycast=()=>{};owner.add(sprite);labels.push({texture,material});
 };
 const mounts=[0x6ee4dc,0xffc36b].map((color,i)=>{const g=new T.Group();g.name=i?'Moving hinge mount':'Fixed hinge mount';g.userData.hingeMount=i?'moving':'fixed';group.add(g);const m=new T.MeshBasicMaterial({color,transparent:true,opacity:.16,side:T.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}),line=new T.LineBasicMaterial({color,transparent:true,opacity:.8,depthTest:false,depthWrite:false,toneMapped:false});materials.push(m,line);const face=new T.Mesh(patch,m),outline=new T.LineSegments(edges,line);face.scale.setScalar(.18);outline.scale.setScalar(.18);outline.raycast=()=>{};if(i){face.userData.connection=id;face.userData.hingeSeating=true;face.userData.kaminosOverlayPick=true;}else face.raycast=()=>{};face.renderOrder=outline.renderOrder=116;g.add(face,outline);makeLabel(i?'Moving':'Fixed',i?'#ffc36b':'#6ee4dc',g);return g;});
 const axis=new T.Group();axis.name='Hinge axle guide';group.add(axis);const violet=new T.MeshBasicMaterial({color:0xbca0ff,depthTest:false,depthWrite:false,toneMapped:false,transparent:true,opacity:.85});materials.push(violet);
 const shaft=new T.Mesh(tube,violet),tip=new T.Mesh(cone,violet);shaft.rotation.x=tip.rotation.x=Math.PI/2;tip.position.z=.55;
 for(const o of [shaft,tip]){o.userData.connection=id;o.userData.hingeAxle=true;o.userData.kaminosOverlayPick=true;o.renderOrder=117;}axis.add(shaft,tip);makeLabel('Axle','#cbb8ff',axis);
 return {targets:()=>({axle:axis,seating:mounts[1]}),update(axle,frames,angle,size,visible){group.visible=visible;if(!visible)return;axle.decompose(axis.position,axis.quaternion,axis.scale);axis.scale.setScalar(size);for(const [i,key]of ['fixed','moving'].entries()){const m=axle.clone();if(i)m.multiply(new T.Matrix4().makeRotationZ(angle));m.multiply(frameMatrix(frames[key]));m.decompose(mounts[i].position,mounts[i].quaternion,mounts[i].scale);mounts[i].scale.setScalar(size);}group.updateMatrixWorld(true);},dispose(){group.removeFromParent();for(const g of [patch,edges,tube,cone])g.dispose();materials.forEach(m=>m.dispose());for(const l of labels){l.texture.dispose();l.material.dispose();}}};
}
