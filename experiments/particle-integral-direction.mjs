import {Group,ArrowHelper,Vector3,Matrix4} from '../lib/three.core.js';
import {checkedParticleInspectionView} from '../volume-particle-inspection.mjs';
export async function createParticleIntegralDirection({session,select,runtime,view,onChange=()=>{}}){
 const initial=checkedParticleInspectionView(view),root=new Group();root.name='Integral direction';
 const distance=new Vector3(...initial.position).distanceTo(new Vector3(...initial.target));
 root.position.fromArray(initial.target);root.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(...initial.position),new Vector3(...initial.target),new Vector3(...initial.up)));
 const arrow=new ArrowHelper(new Vector3(0,0,-1),new Vector3(),distance*.12,0xffb347);root.add(arrow);
 root.traverse(o=>{o.userData.kaminosEditorHelper=true;o.userData.kaminosEditorOnly=true;if(o.material){o.material.depthTest=false;o.renderOrder=100;}});
 const asset=await session.attach(root,{owned:true,metadata:{label:'Integral direction',source:'optical-particles:integral-direction',type:'experiment'}});
 let enabled=true,last='',lastRuntime=null;
 function currentView(){root.updateWorldMatrix(true,false);const q=root.getWorldQuaternion(root.quaternion.clone()),target=root.getWorldPosition(new Vector3());return checkedParticleInspectionView({...initial,target:target.toArray(),position:target.clone().add(new Vector3(0,0,distance).applyQuaternion(q)).toArray(),up:new Vector3(0,1,0).applyQuaternion(q).toArray()});}
 function sync(){if(!enabled)return;const value=currentView(),key=JSON.stringify(value),owner=runtime();if(key===last&&owner===lastRuntime)return;owner.setOpticalParticleView(value);const changed=key!==last;last=key;lastRuntime=owner;session.redraw();if(changed)onChange(value);}
 return {
  asset,root,sync,view:()=>enabled?currentView():null,
  enable(){enabled=true;root.visible=true;sync();select(asset.id);},
  disable(){enabled=false;root.visible=false;runtime().setOpticalParticleView(null);lastRuntime=null;session.redraw();onChange(null);},
 };
}
