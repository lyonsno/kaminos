import {createPacketBundleTransport, finitePacketBundle} from './volume-packet-bundle.mjs';

export function resolveDirectionalProfile(moments,{incoming=[0,0,0],native=true}={}) {
 if(!moments?.length||moments.length%4||!Array.from(moments).every((v,i)=>Number.isFinite(v)&&(i%4!==3||v>=0)))throw Error('Invalid optical moments');
 if(incoming.length!==3||!incoming.every(v=>Number.isFinite(v)&&v>=0))throw Error('Invalid incident source');
 let light=[...incoming],transmission=1;
 const result=[];
 for(let i=0;i<moments.length;i+=4){
  const tau=moments[i+3],t=Math.exp(-tau),factor=tau===0?1:-Math.expm1(-tau)/tau;
  const added=Array.from(moments.slice(i,i+3),v=>native?v*factor:0);
  light=light.map((v,c)=>added[c]+t*v);transmission*=t;
  result.push({light,added,tau,transmission});
 }
 return result;
}

function half(word){
 const exp=(word>>>10)&31,frac=word&1023,sign=word>>>15?-1:1;
 return sign*(exp===31?(frac?NaN:Infinity):exp===0?frac*2**-24:(1+frac/1024)*2**(exp-15));
}

export function readOpticalAtlas(bytes, layout, rowBytes,bundle=0){
 const {width,height,sections,columns,atlasWidth,atlasHeight,tiles=sections}=layout;
 if(!Number.isSafeInteger(bundle)||bundle<0||(bundle+1)*sections>tiles)throw Error('Absent optical atlas bundle');
 if(rowBytes%2||rowBytes<atlasWidth*8||bytes.byteLength<rowBytes*atlasHeight)throw Error('Incomplete optical atlas readback');
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return Array.from({length:width*height},(_,pixel)=>{
  const x=pixel%width,y=Math.floor(pixel/width),moments=[];
  for(let z=0;z<sections;z++){
   const tile=bundle*sections+z;
   const at=(y+Math.floor(tile/columns)*height)*rowBytes+(x+(tile%columns)*width)*8;
   for(let c=0;c<4;c++){
    const sample=half(data.getUint16(at+c*2,true));
    if(!Number.isFinite(sample)||(c===3&&sample<0)||Math.abs(sample)>=65504)throw Error('Optical atlas is nonfinite or saturated at ray '+pixel+', section '+z+', channel '+c+' ('+sample+')');
    moments.push(sample);
   }
  }
  return moments;
 });
}

export function createLightSliceProbe({runtime,onChange=()=>{},createTransport=createPacketBundleTransport}){
 let owner=null,device=null,transport=null,prepared=false,preparing=false,inFlight=false,disposed=false,generation=0,lastKey=null;
 let result=null,error=null,reason=null;
 const read=()=>({result,error,reason,inFlight,prepared});
 function resetTransport(){
  generation++;transport?.dispose();transport=null;device=null;prepared=false;preparing=false;
  lastKey=null;result=null;error=null;reason=null;
 }
 function tick({emitter,receiver,halfWidth,sections,width,refreshSteps,source,gain,carrier=null,bindSource=false}){
  if(disposed)return;
  const next=runtime();
  if(owner!==next){owner=next;resetTransport();}
  if(!owner?.submitOpticalParticleMaterial){reason='Current volume has no native particle material';return;}
  if(inFlight||preparing)return;
  const key=JSON.stringify([emitter,receiver,halfWidth,sections,width,source,gain]);
  let pending=null,submitted=null;
  try{
   submitted=owner.submitOpticalParticleMaterial((encoder,frame,currentDevice)=>{
    if(!transport){
     device=currentDevice;transport=createTransport(device);preparing=true;
     const token=generation;
     Promise.resolve(transport.prepare()).then(()=>{if(token===generation){prepared=true;error=null;}})
      .catch(e=>{if(token===generation){error=e.message;transport.dispose();transport=null;}})
      .finally(()=>{if(token===generation){preparing=false;onChange(read());}});
     return;
    }
    if(!prepared)return;
    const {step,epoch,materialStamp}=frame.identity;
    const attached=carrier?.state==='following'&&carrier.identity?.epoch===epoch&&carrier.identity.step===step&&carrier.identity.materialStamp===materialStamp;
    if(bindSource&&!attached)return;
    const needsIsolation=attached&&(!result?.isolatedCarrier||result.isolatedCarrier.slot!==carrier.slot||result.isolatedCarrier.birth!==carrier.birth);
    // The carrier readback and atlas may finish in either order. Upgrade a
    // current reference only when its exact carrier has arrived and refresh is on.
    const upgrade=needsIsolation&&(bindSource||(refreshSteps>0&&key===lastKey&&
      result?.identity.epoch===epoch&&result.identity.step===step&&result.identity.materialStamp===materialStamp));
    if(!upgrade&&result?.identity.epoch===epoch&&key===lastKey&&step>=result.identity.step&&
       ((step===result.identity.step&&materialStamp===result.identity.materialStamp)||
       (step>result.identity.step&&(refreshSteps===0||step-result.identity.step<refreshSteps))))return;
    const transform=frame.domain.worldFromFine;
    const toFine=p=>p.map((v,c)=>(v-transform.translate[c])/transform.scale);
    const origin=toFine(emitter),target=toFine(receiver),distance=Math.hypot(...target.map((v,c)=>v-origin[c]));
    const bundle=finitePacketBundle({origin,target,halfSize:[halfWidth/transform.scale,halfWidth/transform.scale],far:distance,weight:1});
    const bundles=attached?[bundle,{...bundle,sourceSlot:carrier.slot}]:[bundle];
    const encoded=transport.encode(encoder,{material:frame,bundles,width,height:width,sections,receivers:1});
    const layout=encoded.receipt,rowBytes=Math.ceil(layout.atlasWidth*8/256)*256;
    const bytes=rowBytes*layout.atlasHeight;if(bytes>device.limits.maxBufferSize)throw Error('Selected optical atlas exceeds readback capacity');
    const staging=device.createBuffer({label:'selected light slice optical sections',size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{encoder.copyTextureToBuffer({texture:transport.buffers.atlas},{buffer:staging,bytesPerRow:rowBytes},{width:layout.atlasWidth,height:layout.atlasHeight});}
    catch(e){staging.destroy();throw e;}
    pending={staging,layout,rowBytes,transform:structuredClone(transform),frameIdentity:{...frame.identity},isolatedCarrier:attached?{slot:carrier.slot,birth:carrier.birth}:null};
   });
   if(!submitted.available){reason=submitted.reason;pending?.staging.destroy();return;}
  }catch(e){pending?.staging.destroy();error=e.message;onChange(read());return;}
  reason=null;
  if(!pending)return;
  const {staging,layout,rowBytes,transform,frameIdentity,isolatedCarrier}=pending,token=generation;
  inFlight=true;
  staging.mapAsync(GPUMapMode.READ).then(()=>{
   if(disposed||token!==generation)return;
   const bytes=new Uint8Array(staging.getMappedRange());
   const moments=readOpticalAtlas(bytes,layout,rowBytes);
   const injection=source==='probe'?[gain,gain*.82,gain*.56]:[0,0,0];
   const profiles=moments.map(ray=>resolveDirectionalProfile(ray,{incoming:injection,native:source==='flame'}));
   const isolatedMoments=isolatedCarrier?readOpticalAtlas(bytes,layout,rowBytes,1):null;
   result={identity:frameIdentity,key,source,gain,transform,isolatedCarrier,isolatedMoments,emitter:[...emitter],receiver:[...receiver],halfWidth,sections,width,profiles,moments,
    route:'native-particle-bundle-ordered-deposition',model:'projected particle support, center-slice axial interval; no scene solids'};
   error=null;lastKey=key;
  }).catch(e=>{if(token===generation)error=e.message;}).finally(()=>{
   staging.destroy();inFlight=false;if(!disposed)onChange(read());
  });
 }
 return {tick,read,dispose(){disposed=true;resetTransport();}};
}

export function compareSliceSections(moments,{width,depthStride=4,acrossStride=2,correctionStart=0.25,correctionExtent=0.25,sharingRadius=0.25,source='probe',gain=1}){
 const count=moments.length,sections=moments[0]?.length/4;
 if(count!==width*width||!(sections>0)||moments.some(ray=>ray.length!==sections*4))throw Error('Inconsistent optical patch dimensions');
 if(![depthStride,acrossStride].every(n=>Number.isSafeInteger(n)&&n>0)||
    ![correctionStart,correctionExtent,sharingRadius].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Invalid optical patch range');
 const coarse=moments.map(()=>new Float64Array(sections*4));
 for(let y0=0;y0<width;y0+=acrossStride)for(let x0=0;x0<width;x0+=acrossStride)for(let z0=0;z0<sections;z0+=depthStride){
  const y1=Math.min(width,y0+acrossStride),x1=Math.min(width,x0+acrossStride),z1=Math.min(sections,z0+depthStride);
  const scale=1/((y1-y0)*(x1-x0)*(z1-z0)),mean=[0,0,0,0];
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let z=z0;z<z1;z++)for(let c=0;c<4;c++)mean[c]+=moments[y*width+x][4*z+c]*scale;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)for(let z=z0;z<z1;z++)coarse[y*width+x].set(mean,z*4);
 }
 const center=Math.floor(width/2),anchor=center*width+center;
 const depthMask=Array.from({length:sections},(_,z)=>(z+.5)/sections>=correctionStart&&(z+.5)/sections<correctionStart+correctionExtent);
 const affected=Array.from({length:count},(_,i)=>i===anchor||Math.hypot(i%width-center,Math.floor(i/width)-center)/Math.max(1,width-1)<=sharingRadius);
 const refined=coarse.map((ray,i)=>Float64Array.from(ray,(v,j)=>affected[i]&&depthMask[Math.floor(j/4)]?moments[anchor][j]:v));
 const opts={incoming:source==='probe'?[gain,gain*.82,gain*.56]:[0,0,0],native:source==='flame'};
 const apply=rays=>rays.map(ray=>resolveDirectionalProfile(ray,opts));
 return {fine:apply(moments),coarse:apply(coarse),shared:apply(refined),anchor,depthMask,affected};
}

export function packLightSliceView(snapshot,profiles,gain=1){
 const {transform,width,sections,identity}=snapshot;
 if(profiles.length!==width*width||profiles.some(ray=>ray.length!==sections))throw Error('Cannot display an incomplete light slice');
 const toFine=p=>p.map((v,c)=>(v-transform.translate[c])/transform.scale);
 const origin=toFine(snapshot.emitter),target=toFine(snapshot.receiver),half=snapshot.halfWidth/transform.scale;
 const length=Math.hypot(...target.map((v,c)=>v-origin[c]));
 const basis=finitePacketBundle({origin,target,halfSize:[half,half],far:length,weight:1});
 const axis=new Float32Array([...origin,half,...basis.forward,length,...basis.right,width,...basis.up,sections]);
 const values=new Float32Array(width*width*sections*4);
 for(let i=0;i<profiles.length;i++)for(let z=0;z<sections;z++)values.set(profiles[i][z].light.map(v=>Math.max(0,v)*gain),(i*sections+z)*4);
 return {identity,axis,values};
}
