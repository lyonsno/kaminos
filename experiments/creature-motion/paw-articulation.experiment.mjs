import * as THREE from '../../lib/three.core.js';
import {loadFullBodySkin} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';

const paws=['forelimb-left-toe','forelimb-right-toe','hindlimb-left-toe','hindlimb-right-toe'];

export default {
 id:'marionette/paw-articulation',title:'Creature paw articulation · retained skin',
 async create({host,inputs,record}) {
  if(!Array.isArray(inputs.casts)||!inputs.casts.length)throw Error('Explicit retained/corrected cast pairs required');
  const session=await host.scene.open(),root=new THREE.Group();root.name='Paw articulation · old left / corrected right';
  let runtimes=[],index=0,joint=paws[0],angle=0,asset,disposed=false,request=0,select,slider,output,status;
  const rest=new Map();
  function sync(){if(select)select.value=joint;if(slider)slider.value=String(angle);if(output)output.textContent=`${angle}°`;}
  function apply(){
   for(const [i,runtime] of runtimes.entries()){
    for(const name of paws)runtime.bones.get(name).quaternion.copy(rest.get(i+':'+name));
    runtime.bones.get(joint).quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle*Math.PI/180));
    runtime.update();
   }
   session.redraw();sync();
  }
  const active=()=>{if(disposed||asset&&!root.parent)throw Error('Paw study is disposed or removed');};
  function read(){return {cast:index,label:inputs.casts[index].label,joint,angle,objectId:root.parent?asset?.id:null,
   route:'shared-workbench-retained-field-paw-comparison',motionGenerated:false,
   bodies:runtimes.map((r,i)=>({...r.read(),side:i?'corrected32':'retained28',bindingRule:r===runtimes[1]?inputs.casts[index].candidatePolicy:'retained automatic skin',caseSha256:(i?inputs.casts[index].candidate:inputs.casts[index].original).case_sha256})),view:session.readView()};}
  async function cast(requested){
   if(!Number.isSafeInteger(requested)||requested<0||requested>=inputs.casts.length)throw Error('Unknown cast');
   const version=++request,pair=inputs.casts[requested],loaded=[];
   try{for(const source of [pair.original,pair.candidate])loaded.push(await loadFullBodySkin(source));
    active();if(version!==request)throw Error('Paw study cast request superseded');
    if(loaded[0].manifest.bones.length!==28||loaded[1].manifest.bones.length!==32)throw Error('Requested old28/corrected32 pair was not loaded');
    if(loaded[0].manifest.assets['rest.bin'].sha256!==loaded[1].manifest.assets['rest.bin'].sha256||loaded[0].manifest.assets['triangles.bin'].sha256!==loaded[1].manifest.assets['triangles.bin'].sha256)throw Error('Pair changed cast geometry');
    const next=[];
    try{for(const data of loaded)next.push(createFullBodyRuntime({THREE,...data}));}catch(error){next.forEach(r=>r.dispose());throw error;}
    for(const runtime of runtimes){root.remove(runtime.group);runtime.dispose();}
    runtimes=next;rest.clear();index=requested;
    for(const [i,runtime] of runtimes.entries()){
     runtime.group.name=i?'Corrected32 · feet forward':'Retained28 · previous feet';runtime.group.position.x=i?2.3:-2.3;
     for(const name of paws)rest.set(i+':'+name,runtime.bones.get(name).quaternion.clone());
     root.add(runtime.group);
    }
    apply();
   }catch(error){if(status)status.textContent=error.message;throw error;}
   return read();
  }
  try{
   await cast(inputs.cast??0);
   asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:JSON.stringify(inputs.casts),type:'experiment'}});
   session.setView(inputs.view??{position:[9,4,11],target:[0,-.6,-.3]});
   const operations={
    inspect(){active();return {...read(),geometry:runtimes.map(r=>Array.from(r.mesh.geometry.attributes.position.array)),registration:globalThis.window?.kaminosSceneObjectDebugState?.()??null};},
    pose(value){
     active();
     if(!paws.includes(value?.joint)||!Number.isFinite(value.angle))throw Error('Explicit paw and finite angle required');
     joint=value.joint;angle=value.angle;apply();const effective=read();record({kind:'creature.paw-pose',phase:'applied',effective});return effective;
    },
    cast:async value=>{active();const effective=await cast(value);record({kind:'creature.paw-cast',phase:'applied',effective});return effective;},
    frame(){active();session.setView({position:[8,3,10],target:[0,-.7,-.4]});return read();},
   };
   return {read,operations,
    mount({root:panel,document,invoke}){
     const description=document.createElement('p');description.textContent='Old feet on the left; corrected feet on the right. Same cast geometry. Corrected casts use paw-local influence refinement; an unchanged-weight Strong baseline is also retained. Rotate a toe joint, then return to Neutral. No generated motion here.';
     const casts=document.createElement('select');casts.setAttribute('aria-label','Paw study cast');
     inputs.casts.forEach((c,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=c.label;casts.append(option);});
     select=document.createElement('select');select.setAttribute('aria-label','Paw joint');
     paws.forEach(n=>{const option=document.createElement('option');option.value=n;option.textContent=n.replaceAll('-',' ');select.append(option);});
     slider=document.createElement('input');slider.type='number';slider.step='5';slider.setAttribute('aria-label','Toe rotation degrees');
     output=document.createElement('output');status=document.createElement('p');status.setAttribute('role','status');
     const neutral=document.createElement('button');neutral.textContent='Neutral';
     const frame=document.createElement('button');frame.textContent='Frame paw comparison';
     const failed=e=>{status.textContent=e.message;sync();};
     select.onchange=()=>invoke('pose',{joint:select.value,angle}).catch(failed);
     slider.onchange=()=>invoke('pose',{joint,angle:Number(slider.value)}).catch(failed);
     casts.onchange=()=>invoke('cast',Number(casts.value)).catch(failed);
     neutral.onclick=()=>invoke('pose',{joint,angle:0}).catch(failed);frame.onclick=()=>invoke('frame').catch(failed);
     panel.append(description,casts,select,slider,output,neutral,frame,status);sync();
    },
    async dispose(){disposed=true;request++;await session.dispose();runtimes.forEach(r=>r.dispose());},
   };
  }catch(error){await session.dispose();runtimes.forEach(r=>r.dispose());throw error;}
 },
};
