import {Vector3} from '../lib/three.core.js';
import {createDeferredSurfaceSplats} from '../deferred-surface-splats.mjs';

export async function loadSurfaceFields(base, fetcher=fetch) {
 const get=async name=>{const r=await fetcher(new URL(name,base));if(!r.ok)throw Error(`Surface field unavailable: ${name} (${r.status})`);return r;};
 const meta=await (await get('report.json')).json();
 if(!meta.ok||meta.stride!==12||!Number.isSafeInteger(meta.count)||meta.count<1||meta.footprints?.stride!==8)throw Error('Incomplete surface field metadata');
 const bytes=await (await get('surfels.f32')).arrayBuffer(), footprintBytes=await (await get(meta.footprints.file)).arrayBuffer();
 const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),v=>v.toString(16).padStart(2,'0')).join('');
 if(await hash(bytes)!==meta.dataSHA256||await hash(footprintBytes)!==meta.footprints.sha256)throw Error('Surface field payload hash mismatch');
 if(bytes.byteLength!==meta.count*48||footprintBytes.byteLength!==meta.count*32)throw Error('Surface field count mismatch');
 const data=new Float32Array(bytes),footprints=new Float32Array(footprintBytes);
 if(!data.every(Number.isFinite)||!footprints.every(Number.isFinite))throw Error('Nonfinite surface fields');
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<data.length;i+=12)for(let j=0;j<3;j++){lo[j]=Math.min(lo[j],data[i+j]);hi[j]=Math.max(hi[j],data[i+j]);}
 return {data,footprints,meta,bounds:[lo,hi]};
}

export default {
 id:'surface-fields',title:'Generated surface',
 async create({host,inputs,record}) {
  if(!inputs.base)throw Error('Choose a surface field directory');
  const base=new URL(inputs.base,host.controls.document.location.href).href;
  const field=await loadSurfaceFields(base), session=await host.scene.open();let splats,asset;
  try {
   splats=createDeferredSurfaceSplats(field.data,field.meta,field.footprints);
   splats.set({mode:inputs.mode??'opaque'});
   asset=await session.attach(splats.root,{owned:true,metadata:{label:inputs.label??'Generated surface',source:base,type:'experiment'}});
   const low=new Vector3().fromArray(field.bounds[0]),high=new Vector3().fromArray(field.bounds[1]);
   const center=low.clone().add(high).multiplyScalar(.5),span=high.clone().sub(low),distance=span.length()*1.2;
   const frame=()=>session.setView({position:center.clone().add(new Vector3(distance*.8,distance*.65,distance)).toArray(),target:center.toArray()});
   frame();
   const read=()=>({source:base,objectId:asset.id,representation:'splats',sourceHashes:field.meta.sourceHashes,gridSize:field.meta.gridSize,bounds:field.bounds,...splats.read()});
   return {read,operations:{frame(){const view=frame();record({kind:'surface-fields.frame',view});return view;},setMode(mode){splats.set({mode});session.redraw();record({kind:'surface-fields.mode',mode});return read();}},
    mount({root,document,invoke}){const label=document.createElement('label');label.textContent='Surface appearance ';const select=document.createElement('select');select.setAttribute('aria-label','Surface appearance');for(const [value,text]of [['opaque','Decoded materials'],['plain','Neutral surface'],['normals','Surface normals']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=inputs.mode??'opaque';select.addEventListener('change',()=>invoke('setMode',select.value));label.append(select);root.append(label);const button=document.createElement('button');button.textContent='Frame room';button.addEventListener('click',()=>invoke('frame'));root.append(button);},
    async dispose(){splats.dispose();await session.dispose();}};
  }catch(error){splats?.dispose();await session.dispose();throw error;}
 }
};
