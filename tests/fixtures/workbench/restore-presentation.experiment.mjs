// Deterministic application integration fixture; no fluid or motion-quality claim.
import * as THREE from '../../../lib/three.core.js';
export default {id:'integration/main-scene-check',title:'Shared scene presentation check',async create({host}){
 const session=await host.scene.open();const root=new THREE.Mesh(new THREE.BoxGeometry(.4,.6,.3),new THREE.MeshStandardMaterial({color:0x88bb99}));
 const asset=await session.attach(root,{owned:true,metadata:{source:'fixture:restored-box',label:'Restored test object'}});
 const read=()=>({assetId:asset.id,position:root.position.toArray(),rotation:root.rotation.toArray().slice(0,3),scale:root.scale.toArray(),view:session.readView()});
 const restore=()=>{root.position.set(.08,.015,-.06);root.rotation.set(.05,.15,-.02);root.scale.set(1.05,.9,1.1);return host.scene.refreshPresentation(asset);};
 restore();session.setView({position:[1.5,1,2.2],target:[.08,.015,-.06],near:.01,far:100});
 return {read,operations:{restore},mount({root:panel,document}){const p=document.createElement('p');p.textContent='Deterministic restored-root integration fixture';panel.append(p);return {dispose:()=>p.remove()};},dispose:()=>session.dispose()};
}};
