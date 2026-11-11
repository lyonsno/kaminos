import {defaultDock} from '../stockroom-dock.mjs';
import {SPACE_SOURCE,defaultSpace} from '../stockroom-space.mjs';

export default {id:'stockroom-space',title:'Stockroom - Shaping a place',async create({host,inputs,record}){
 const session=await host.scene.open(),api=host.controls.document.defaultView.kaminosSceneAuthoring;
 let entry=host.scene.objects().find(e=>e.source===SPACE_SOURCE);
 if(!entry){
  const dock=await host.scene.addDock({...defaultDock(),width:6.4,depth:1.5,height:1.35,stairs:false});
  host.scene.setTransform(dock.id,{position:[-2.2,0,1.55]});
  const box=(label,size,position,color)=>{
   const id=host.scene.addMesh('box',{width:size[0],height:size[1],depth:size[2]});host.scene.setTransform(id,{position});api.setMaterial(id,{color,roughness:.88,metalness:0});
   host.controls.document.defaultView.renameSceneObject(id,label);return id;
  };
  box('Lower landing',[5.5,.12,2.1],[.55,.06,-1.5],'#72777a');
  box('Bank - unresolved',[6.8,.5,1.2],[-.3,.25,3],'#747969');
  box('Bank - unresolved',[3.8,.8,1.1],[2,.4,3.65],'#747969');
  box('Ceramic backing',[1.15,.07,.08],[-1.1,.155,-2.2],'#8a8d8b');
  const space=defaultSpace();space.claims[0]={...space.claims[0],center:[-.5,.25,.4],radii:[1.35,.8,1.1]};
  entry=await host.scene.addSpace(inputs.space??space);
  if(inputs.tiles!==false){
   const sha='0c57b96262b041ed2f2d578596a187d95ca31cf8072816ffb23048721ec9745f';
   const tile=await host.scene.loadAsset(`/api/read?root=generated-meshes&path=${sha}.glb`,{normalize:false,arrival:null});
   host.scene.setTransform(tile.id,{position:[-1.56,.153,-2.28],rotation:[0,Math.PI,0],scale:[.12,.12,.12]});host.controls.document.defaultView.renameSceneObject(tile.id,'Woven clay - 12 cm coves');
   api.setRepetition(tile.id,{mode:'line',count:8,step:[.12,0,0],space:'world'});
  }
  const ground=host.controls.document.getElementById('composition-ground-height');ground.value='0';ground.dispatchEvent(new Event('change',{bubbles:true}));
  session.setView({position:[6.7,4.3,-8.2],target:[-.4,.75,.1],up:[0,1,0]});
 }
 const asset=await session.attach(entry.object,{owned:false});host.scene.select(asset.id);
 return {read:()=>({...host.scene.spaces.read(asset.id),fixture:'authored timber/landing/concrete study; no automatic space discovery',source:SPACE_SOURCE,view:session.readView()}),
  operations:{frame(){return session.setView({position:[6.7,4.3,-8.2],target:[-.4,.75,.1],up:[0,1,0]});},pull({probe,amount,role}){const effective=host.scene.spaces.pull(asset.id,probe,amount,role);record({kind:'stockroom-space.pull',target:asset.id,requested:{probe,amount,role},effective});return effective;}},
  mount({root,document,invoke}){const frame=document.createElement('button');frame.type='button';frame.textContent='Frame place';frame.addEventListener('click',()=>invoke('frame'));root.append(frame);},dispose:()=>session.dispose()};
}};
