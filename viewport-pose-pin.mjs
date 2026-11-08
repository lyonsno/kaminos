import {Group,Mesh,TorusGeometry,CylinderGeometry,Vector3} from './lib/three.core.js';
import {MeshStandardNodeMaterial} from './lib/three.webgpu.js';

// A source-mounted eyelet, rendered in the native scene depth. The existing
// renderer's occlusion query controls the corresponding HTML hit target.
export function createViewportPosePin({asset,redraw=()=>{}}){
 const group=new Group();group.name='Pose anchor eyelet';group.userData.kaminosHelper=true;
 const material=new MeshStandardNodeMaterial({color:0x747875,metalness:.55,roughness:.66});
 const head=new Mesh(new TorusGeometry(.042,.009,6,16),material);head.position.y=.075;
 const stem=new Mesh(new CylinderGeometry(.009,.014,.055,6),material);stem.position.y=.0275;
 head.occlusionTest=true;head.renderOrder=stem.renderOrder=1000;
 // Pin geometry is interaction annotation, not part of the rock contact source.
 for(const mesh of [head,stem]){mesh.castShadow=true;mesh.receiveShadow=true;mesh.raycast=()=>{};group.add(mesh);}
 asset.root.add(group);let occluded=true,frames=0,disposed=false,lastHot=null,lastVisible=null;
 head.onAfterRender=renderer=>{frames++;occluded=Boolean(renderer.isOccluded(head));};
 return{
  update(record,{active=true,hot=false}={}){
   if(disposed)return;group.visible=active&&record.attached;if(lastHot!==hot||lastVisible!==group.visible){lastHot=hot;lastVisible=group.visible;redraw();}group.userData.anchorId=record.id;
   if(!group.visible)return;asset.root.updateMatrixWorld(true);const inv=asset.root.matrixWorld.clone().invert();
   const point=new Vector3(...record.worldPoint).applyMatrix4(inv),face=record.worldFace.map(p=>new Vector3(...p).applyMatrix4(inv));
   const normal=new Vector3().crossVectors(face[1].clone().sub(face[0]),face[2].clone().sub(face[0])).normalize();
   group.position.copy(point);group.quaternion.setFromUnitVectors(new Vector3(0,1,0),normal);
   material.color.setHex(hot?0xc5b98d:0x747875);material.roughness=hot?.45:.66;
  },
  // A fully covered eyelet never exposes a DOM hit target. Visibility follows
  // asynchronous hardware queries; it can trail a changed view by a frame.
  visible:()=>frames>1&&!occluded,
  worldPoint:()=>{group.updateWorldMatrix(true,true);return head.getWorldPosition(new Vector3()).toArray();},
  dispose(){if(disposed)return;disposed=true;group.removeFromParent();head.geometry.dispose();stem.geometry.dispose();material.dispose();redraw();}
 };
}
