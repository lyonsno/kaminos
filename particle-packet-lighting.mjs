import {createPacketNetwork,packetNetworkSettings} from './volume-packet-network.mjs';
import {createMaterialPacketNetwork} from './volume-material-packet-transport.mjs';
import {collectStaticSceneGeometry,staticSceneGeometryRevision} from './scene-light-geometry.mjs';

export function createParticlePacketLighting({runtime,scene,onChange=()=>{},createNetwork=createPacketNetwork,createCommonNetwork=createMaterialPacketNetwork}){
 let settings=packetNetworkSettings(),enabled=false,owner=null,device=null,network=null,networkMode=null,preparing=null,preparedKey=null,disposed=false,last=null,error=null,geometryKey=null,geometry=null,triangles=null,receipt=null,heldReceipt=null,revision=0;
 const retire=(buffer,ownDevice)=>{if(buffer)queueMicrotask(()=>ownDevice.queue.onSubmittedWorkDone().catch(()=>{}).then(()=>buffer.destroy()));};
 const targetKey=()=>network?.preparationKey?.(settings)??'default';
 const read=()=>({enabled,settings:{...settings},phase:disposed?'disposed':error?'failed':!enabled?'off':!network?'awaiting-current-material':preparedKey!==targetKey()?'preparing':last&&receipt?.available?(settings.mode==='material-packets'?'fresh-material-packets':'fresh-packet-network'):'awaiting-current-material',error,receipt});
 function clear(){if(owner)owner.setOpticalParticleIncident(null);last=null;receipt=null;heldReceipt=null;}
 function prepare(){if(preparing)return;const key=targetKey(),generation=revision,chosen=network;preparing=Promise.resolve(chosen.prepare({...settings})).then(()=>{if(disposed||generation!==revision)return;preparedKey=key;error=null;}).catch(e=>{if(generation===revision)error=e.message;}).finally(()=>{if(generation===revision){preparing=null;onChange(read());}});}
 function solids(frame){
  const transform=frame.domain.worldFromFine,key=JSON.stringify([staticSceneGeometryRevision(scene()),transform]);if(key===geometryKey)return;
  const current=collectStaticSceneGeometry(scene());const data=new Float32Array(Math.max(1,current.triangles.length)*12);
  current.triangles.forEach((tri,i)=>{for(const [j,name] of ['a','b','c'].entries())data.set([...tri[name].map((v,k)=>(v-transform.translate[k])/transform.scale),0],i*12+j*4);});
  const next=device.createBuffer({label:'current packet solid triangles in Fine coordinates',size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(next,0,data);
  retire(triangles,device);triangles=next;geometry=current;geometryKey=key;
 }
 function tick(){
  if(disposed||!enabled)return read();
  try{
   const next=runtime();if(next!==owner||(network&&networkMode!==settings.mode)){clear();network?.dispose();retire(triangles,device);owner=next;network=null;device=null;triangles=null;geometryKey=null;preparedKey=null;preparing=null;revision++;}
   if(!owner?.submitOpticalParticleMaterial)return read();
   if(network&&preparedKey!==targetKey()){prepare();return read();}
   let result=null;
   const submitted=owner.submitOpticalParticleMaterial((encoder,frame,currentDevice)=>{
    if(!network){device=currentDevice;networkMode=settings.mode;network=(settings.mode==='material-packets'?createCommonNetwork:createNetwork)(device);prepare();return;}
    const {view,...solveSettings}=settings;
    const identity=JSON.stringify([frame.identity.epoch,frame.identity.step,frame.identity.materialStamp??frame.identity.frame,solveSettings,staticSceneGeometryRevision(scene()),frame.domain.worldFromFine]);
    if(identity===last){receipt=heldReceipt;return;}
    solids(frame);result=network.encode(encoder,{material:frame,settings,triangles,triangleCount:geometry.triangles.length});last=identity;
   });
   if(!submitted.available){receipt={...receipt,available:false,reason:submitted.reason};return read();}
   if(result){owner.setOpticalParticleIncident(result);receipt={available:true,...result.receipt,worldVisibilityRevision:geometry.revision,borrowedMaterial:submitted.identity};heldReceipt=receipt;error=null;onChange(read());}
  }catch(e){error=e.message;clear();onChange(read());}
  return read();
 }
 return {
  read,tick,
  configure(patch){if(disposed)throw Error('Packet lighting is disposed');const {enabled:nextEnabled=enabled,...quality}=patch;if(typeof nextEnabled!=='boolean')throw Error('Packet lighting enabled must be boolean');settings=packetNetworkSettings({...settings,...quality});enabled=nextEnabled;error=null;
   const changed=Object.keys(quality).some(k=>k!=='view');if(changed)last=null;if(!enabled)clear();onChange(read());return read();},
  inspect:()=>network?.inspect?.()??Promise.resolve({available:false,reason:'Choose current material packets to inspect packet supports'}),
  get buffers(){return network?.buffers;},
  dispose(){disposed=true;revision++;clear();network?.dispose();retire(triangles,device);network=null;triangles=null;},
 };
}
