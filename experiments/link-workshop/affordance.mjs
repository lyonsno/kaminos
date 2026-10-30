import * as T from '../../lib/three.core.js';
export function connectionGuide({model,editing,playing,mode,tool,start,hover}){
 const active=editing&&!playing&&mode==='build'&&tool==='piston';
 if(!active)return {active:false,targets:[],valid:false,message:''};
 const blocked=i=>start!==null&&(i===start||model.pistons.some(p=>(p.a===start&&p.b===i)||(p.b===start&&p.a===i)));
 const targets=model.nodes.map((_,i)=>i===start?'start':blocked(i)?'blocked':i===hover?'hover':'valid');
 const valid=Number.isInteger(hover)&&!!model.nodes[hover]&&!blocked(hover);
 const message=start===null?'CONNECT PISTON · Choose first joint · Esc exits':hover===start?'Choose a different joint · Esc cancels':hover!==null&&blocked(hover)?'Already connected · Choose another joint · Esc cancels':valid?`Click to connect joints ${start+1} and ${hover+1} · Esc cancels`:`CONNECT PISTON · Joint ${start+1} chosen · Choose second joint · Esc cancels`;
 return {active,targets,valid,message};
}
// Presentation only: shared geometry, no picking/selection owner and no recipe writes.
export function createConstructionGuide(root){
 const group=new T.Group();group.name='Construction targets';group.userData.kaminosEditorHelper=true;root.add(group);
 const ring=new T.TorusGeometry(.24,.025,8,32),box=new T.BoxGeometry(1,1,1);
 const colors={valid:0x50e3be,hover:0xffffff,start:0xffbf50,blocked:0xd75c6b};
 const materials=Object.fromEntries(Object.entries(colors).map(([k,color])=>[k,new T.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:k==='blocked'?.55:1})]));
 const line=new T.Mesh(box,new T.MeshBasicMaterial({color:colors.valid,transparent:true,opacity:.55,depthTest:false}));line.renderOrder=20;line.raycast=()=>{};group.add(line);
 let targets=[];
 return {update({active,states,markers,from,to,valid=true}){group.visible=active;if(!active)return;
  while(targets.length<markers.length){const m=new T.Mesh(ring,materials.valid);m.raycast=()=>{};m.renderOrder=21;targets.push(m);group.add(m);}
  targets.forEach((m,i)=>{m.visible=i<markers.length&&!!states[i];if(m.visible){m.position.copy(markers[i].position);m.material=materials[states[i]];m.scale.setScalar(states[i]==='hover'?1.2:1);}});
  line.visible=!!from&&!!to;if(line.visible){const a=new T.Vector3(...from),b=new T.Vector3(...to),delta=b.clone().sub(a);line.position.copy(a).add(b).multiplyScalar(.5);line.quaternion.setFromUnitVectors(new T.Vector3(1,0,0),delta.clone().normalize());line.scale.set(delta.length(),.075,.075);line.material.color.set(valid?colors.valid:colors.blocked);}
 },dispose(){group.removeFromParent();ring.dispose();box.dispose();line.material.dispose();Object.values(materials).forEach(m=>m.dispose());}};
}
