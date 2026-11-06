import {Group,Mesh,BoxGeometry,SphereGeometry,PlaneGeometry,MeshStandardMaterial} from '../lib/three.core.js';
const checked=value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('Roughness must be between zero and one');return value;};
export default{
 id:'reflection-study',title:'Glossy scene reflections',
 async create({host,inputs,record,updateInputs}){
  const session=await host.scene.open(),before=host.rendering.readReflections().settings,root=new Group();root.name='Glossy reflection study';
  const initial=checked(inputs.roughness??.22),surface=new MeshStandardMaterial({color:0x777d83,roughness:initial,metalness:.55});
  const floor=new Mesh(new PlaneGeometry(8,8),surface);floor.rotation.x=-Math.PI/2;floor.position.y=.01;floor.name='Reflective ground';floor.receiveShadow=true;root.add(floor);
  for(const [x,color]of [[-1,0xff4617],[1,0x16a8ff]]){
   const material=new MeshStandardMaterial({color,roughness:.25,emissive:color,emissiveIntensity:.7});
   const box=new Mesh(new BoxGeometry(.65,1.5,.65),material);box.position.set(x,.76,-.8);box.name=x<0?'Warm reflected block':'Cool reflected block';box.castShadow=box.receiveShadow=true;root.add(box);
  }
  const ball=new Mesh(new SphereGeometry(.65,48,32),new MeshStandardMaterial({color:0xd6e1e9,roughness:.12,metalness:.95}));ball.position.set(.15,.66,.65);ball.name='Curved silver receiver';ball.castShadow=ball.receiveShadow=true;root.add(ball);
  let asset,enabledInput,roughnessInput,drag;
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'experiment:reflection-study',type:'experiment'}});host.rendering.reflections({enabled:inputs.enabled??true});session.setView(inputs.view??{position:[4,3,5],target:[0,.5,0]});}
  catch(error){await session.dispose();throw error;}
  const read=()=>({objectId:asset.id,roughness:surface.roughness,reflections:host.rendering.readReflections(),view:session.readView()});
  const applied=kind=>{session.redraw();const state=read();record({kind:'reflection-study.'+kind,phase:'applied',effective:state});return state;};
  return{read,operations:{
   setEnabled(value){host.rendering.reflections({enabled:value});if(enabledInput)enabledInput.checked=value;updateInputs({...inputs,roughness:surface.roughness,enabled:value});return applied('enabled');},
   setRoughness(value){surface.roughness=checked(value);if(roughnessInput)roughnessInput.value=String(value);host.rendering.reflections({enabled:host.rendering.readReflections().enabled});updateInputs({...inputs,roughness:value,enabled:host.rendering.readReflections().enabled});return applied('roughness');},
  },mount({root:panel,document,invoke}){
   const enabled=enabledInput=document.createElement('input');enabled.type='checkbox';enabled.checked=host.rendering.readReflections().enabled;enabled.id='reflection-study-enabled';
   const toggle=document.createElement('label');toggle.append(enabled,' Screen reflections');
   const field=document.createElement('label'),grip=document.createElement('span');grip.textContent='Ground roughness ';const value=roughnessInput=document.createElement('input');value.type='number';value.min='0';value.max='1';value.step='any';value.className='transform-input';value.value=String(surface.roughness);field.append(grip,value);
   const status=document.createElement('p');status.className='small';status.textContent='Orbit and move the blocks using the scene editor. Compare the ground and curved silver receiver as you change roughness.';
   enabled.addEventListener('change',()=>invoke('setEnabled',enabled.checked).catch(e=>status.textContent=e.message));
   value.addEventListener('input',()=>{if(value.value!==''&&value.validity.valid)invoke('setRoughness',Number(value.value)).catch(e=>status.textContent=e.message);});
   drag=host.controls.installNumberDrag({input:value,grip,step:.01});panel.append(toggle,field,status);
  },async dispose(){drag?.dispose();host.rendering.reflections(before);await session.dispose();}};
 }
};
