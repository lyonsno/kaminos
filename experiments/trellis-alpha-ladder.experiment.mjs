import {Group,Box3,Vector3} from '../lib/three.webgpu.js';
import {loadAlphaSource,loadAlphaLevel,createAlphaObject,createAlphaReference} from '../alpha-carrier-scene.mjs';

export default {
  id:'trellis-alpha-ladder',title:'TRELLIS alpha carriers',
  async create({host,inputs,record}){
    const assets=inputs.assets;if(!assets||!Object.keys(assets).length)throw Error('Source and prepared ladder asset URLs required');
    let assetKey=inputs.asset??Object.keys(assets)[0],count=inputs.count??4000,mode=inputs.mode??'learned',object,receipt,generation=0,disposed=false;
    const levels=new Map(),sources=new Map(),root=new Group();root.name='Alpha-only surface carrier ladder';
    const session=await host.scene.open();
    const read=()=>({asset:assetKey,count,mode,objectId:receipt?.id,...object?.read(),view:session.readView(),availableCounts:[2000,4000,16000],sourceRoot:assets[assetKey],newRepresentation:'alpha only; no learned depth/appearance or ray marching'});
    let sync=()=>{};
    const show=async(requested={})=>{
      const key=requested.asset??assetKey,nextCount=Number(requested.count??count),nextMode=requested.mode??mode;
      if(!assets[key]||![2000,4000,16000].includes(nextCount)||!['reference','analytic','baked','learned'].includes(nextMode))throw Error('Unknown asset/count/representation');
      if(nextCount===16000&&!['reference','analytic'].includes(nextMode))throw Error('16k is the denser analytical control');
      const token=++generation;let next;
      if(nextMode==='reference'){
        if(!sources.has(key))sources.set(key,loadAlphaSource(assets[key].source));
        next=createAlphaReference(await sources.get(key));
      }else{
        const cacheKey=`${key}:${nextCount}`;if(!levels.has(cacheKey))levels.set(cacheKey,loadAlphaLevel(assets[key].ladder,nextCount));
        next=createAlphaObject(await levels.get(cacheKey),nextMode);
      }
      if(token!==generation||disposed){next.dispose();return read();}
      if(object){root.remove(object.root);object.dispose();}object=next;root.add(next.root);assetKey=key;count=nextCount;mode=nextMode;
      if(receipt)host.scene.refreshPresentation(receipt);session.redraw();sync();
      const effective=read();record({kind:'trellis-alpha.representation',phase:'applied',requested,effective});return effective;
    };
    const frame=()=>{
      const box=new Box3().setFromObject(object.root),center=box.getCenter(new Vector3()),span=box.getSize(new Vector3()).length();
      return session.setView({position:[center.x+span*.9,center.y+span*.55,center.z+span],target:center.toArray()});
    };
    try{await show();root.position.y=.2;receipt=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:assets[assetKey].ladder}});frame();}
    catch(error){object?.dispose();await session.dispose();throw error;}
    return {read,operations:{show,frame},mount({root:panel,document,invoke}){
      const asset=document.createElement('select'),representation=document.createElement('select'),density=document.createElement('input'),status=document.createElement('output');
      asset.setAttribute('aria-label','TRELLIS asset');representation.setAttribute('aria-label','Alpha representation');density.type='range';density.min=0;density.max=2;density.step=1;density.setAttribute('aria-label','Carrier density');
      for(const key of Object.keys(assets)){const o=document.createElement('option');o.value=key;o.textContent=key;asset.append(o);}
      for(const [value,label]of [['reference','Dense source'],['analytic','Analytical support'],['baked','Baked alpha'],['learned','Learned alpha']]){const o=document.createElement('option');o.value=value;o.textContent=label;representation.append(o);}
      const row=(name,control)=>{const label=document.createElement('label');label.textContent=name+' ';label.append(control);panel.append(label);};
      const failed=e=>{status.textContent=e.message;sync();};
      asset.addEventListener('change',()=>invoke('show',{asset:asset.value}).catch(failed));
      representation.addEventListener('change',()=>invoke('show',{mode:representation.value}).catch(failed));
      density.addEventListener('change',()=>{const n=[2000,4000,16000][Number(density.value)];invoke('show',{count:n,mode:n===16000?'analytic':mode}).catch(failed);});
      sync=()=>{asset.value=assetKey;representation.value=mode;density.value=[2000,4000,16000].indexOf(count);for(const o of representation.options)o.disabled=count===16000&&['baked','learned'].includes(o.value);status.textContent=`${object.read().count.toLocaleString()} ${mode==='reference'?'source discs':'carriers'} · ${mode}`;};
      row('Asset',asset);row('Surface',representation);row('Density',density);panel.append(status);sync();
    },async dispose(){disposed=true;generation++;object?.dispose();await session.dispose();}};
  },
};
