import * as THREE from '../lib/three.webgpu.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readSurfelGLBExtension,createSurfelObject} from '../trellis-surfels.mjs';
import {disposeOwnedSceneTree} from '../workbench-scene-host.mjs';

const assetURL=sha=>'/api/read?'+new URLSearchParams({root:'generated-meshes',path:sha+'.glb'});
const sha=value=>{if(!/^[a-f0-9]{64}$/.test(value??''))throw Error('A stored asset SHA256 is required');return value;};
const factor=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Surfel merge factor must be a positive integer');return value;};
const count=root=>{let n=0;root.traverse(o=>{if(o.isMesh)n+=(o.geometry.index?.count??o.geometry.attributes.position?.count??0)/3*(o.isInstancedMesh?o.count:1);});return n;};
const release=root=>{if(!root)return;root.traverse(o=>{if(o.isTrellisSurfelRoot)o.sceneGeometry?.dispose();});disposeOwnedSceneTree(root,[]);};

export default {
  id:'gi-source-study',title:'GI source geometry',
  async create({host,inputs,record,updateInputs}){
    const hero=sha(inputs.hero),surfelSHA=sha(inputs.surfels),session=await host.scene.open();
    const before=host.rendering.readGI(),abort=new AbortController(),candidates={};
    let comparison,asset,disposed=false,generation=0,mergeFactor=factor(inputs.mergeFactor??16),worker=null,rejectWorker=null;
    let selector,sourceView,mergeInput,status,numberDrag,lightingView;
    const fetchJSON=async url=>{const r=await fetch(url,{signal:abort.signal});if(!r.ok)throw Error(`Asset catalog HTTP ${r.status}`);return r.json();};
    const prepare=(field,k)=>new Promise((resolve,reject)=>{
      if(worker){worker.terminate();rejectWorker?.(Error('Surfel preparation superseded'));}
      const w=new Worker(new URL('../gi-source-preparation.worker.mjs',import.meta.url),{type:'module'});worker=w;rejectWorker=reject;
      const finish=()=>{w.terminate();if(worker===w){worker=null;rejectWorker=null;}};
      w.onmessage=({data})=>{finish();data.error?reject(Error(data.error)):resolve(data.field);};
      w.onerror=e=>{finish();reject(Error(e.message));};w.postMessage({field,factor:k});
    });
    let raw;
    const buildSurfels=async k=>{
      const token=++generation,coarse=await prepare(raw.field,k);
      if(disposed||token!==generation)throw Error('Surfel preparation superseded');
      const root=new THREE.Group(),patches=createSurfelObject(THREE,coarse,{levels:[1],proxyFactor:1});
      patches.applyMatrix4(new THREE.Matrix4().fromArray(raw.extension.frame.nodeMatrix));root.add(patches);
      return {root,identity:{kind:'surfels',sha256:surfelSHA,mergeFactor:k,primitives:coarse.count,
        radiusSourceUnits:coarse.radiusVoxels/coarse.resolution,frame:raw.extension.frame.name}};
    };
    const cleanup=async()=>{
      disposed=true;generation++;abort.abort();worker?.terminate();rejectWorker?.(Error('Comparison closed'));worker=null;rejectWorker=null;
      numberDrag?.dispose?.();comparison?.dispose();for(const item of Object.values(candidates))release(item.root);
      // Only restore the mode this experiment changed; retain the operator's
      // lighting edits made during the comparison.
      if(comparison&&before.mode!=='combined'&&host.rendering.readGI().mode==='combined')host.rendering.gi({...host.rendering.readGI(),mode:before.mode});
      await session.dispose();
    };
    try {
      const catalog=await fetchJSON('/api/mesh-lods?'+new URLSearchParams({source:hero}));
      if(catalog.source!==hero||!catalog.levels?.length)throw Error('No mesh proxy tiers registered for this hero');
      const response=await fetch(assetURL(surfelSHA),{signal:abort.signal});if(!response.ok)throw Error(`Surfel asset HTTP ${response.status}`);
      raw=readSurfelGLBExtension(await response.arrayBuffer());
      if(raw.extension.frame?.name!=='trellis-source'||raw.extension.frame?.nodeMatrix?.length!==16)throw Error('Surfel source frame unavailable');
      // Source association is explicit in experiment inputs and retained in read().
      // A matching native frame is preserved; no independent recentering of tiers.
      const loader=new GLTFLoader();
      for(const level of catalog.levels){
        const gltf=await loader.loadAsync(assetURL(sha(level.sha256)));
        const key='mesh:'+level.sha256;
        gltf.scene.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;}});
        candidates[key]={root:gltf.scene,identity:{kind:'mesh',sha256:level.sha256,primitives:count(gltf.scene),registeredFaces:level.faces,error:level.error??null}};
      }
      candidates.surfels=await buildSurfels(mergeFactor);
      asset=await session.loadAsset({url:assetURL(hero),normalize:false,metadata:{label:'Detailed GI receiver',source:assetURL(hero)}});
      const scale=inputs.scale??40;if(!Number.isFinite(scale)||scale<=0)throw Error('Positive scene scale required');
      asset.root.scale.setScalar(scale);asset.root.updateMatrixWorld(true);
      const bounds=new THREE.Box3().setFromObject(asset.root);asset.root.position.y-=bounds.min.y;
      host.scene.refreshPresentation(asset);
      comparison=host.rendering.openGISourceComparison(asset.root,candidates);
      host.rendering.gi({...before,mode:'combined'});
      if(inputs.view)session.setView(inputs.view);
      else session.setView({position:[scale*1.1,scale*.8,scale*1.2],target:[0,scale*.25,0]});
    }catch(error){await cleanup();throw error;}
    const read=()=>({hero,surfels:surfelSHA,detailedPrimitives:count(asset.root),mergeFactor,source:comparison.read(),
      lighting:host.rendering.readGI(),backend:host.scene.renderer().backend.constructor.name,view:session.readView(),receiverId:asset.id,
      continuation:'Inputs restore the asset pair and merge factor; camera accepts inputs.view. Scene lighting uses the ordinary shared controls.'});
    const sync=()=>{
      if(!status)return;const s=read(),selected=s.source.candidates[s.source.selection];
      selector.value=s.source.selection;sourceView.checked=s.source.showSource;mergeInput.value=String(mergeFactor);lightingView.value=s.lighting.view;
      if(s.lighting.mode!=='combined'){status.textContent='Combined GI is inactive. Choose Combined AO + GI in Rendering to use this comparison.';return;}
      status.textContent=`${selected?selected.primitives.toLocaleString()+' source '+(selected.kind==='mesh'?'triangles':'surfels'):s.detailedPrimitives.toLocaleString()+' detailed triangles'} · Detailed receiver stays fixed. ${s.source.enabled?'One additional source capture; this comparison does not yet measure a saving.':'Original GI source.'}`;
    };
    const applied=kind=>{session.redraw();sync();const state=read();record({kind:'gi-source.'+kind,phase:'applied',effective:state});return state;};
    return {read,
      operations:{
        select(value){comparison.select(value);return applied('select');},
        showSource(value){comparison.show(value);return applied('view');},
        lightingView(value){
          if(!['scene','ao','gi','incoming'].includes(value))throw Error('Unknown lighting view');
          comparison.show(false);host.rendering.gi({...host.rendering.readGI(),view:value});return applied('lighting-view');
        },
        async setMergeFactor(value){
          const k=factor(value),next=await buildSurfels(k),previous=candidates.surfels;
          try{comparison.replace('surfels',next);}catch(error){release(next.root);throw error;}
          mergeFactor=k;release(previous.root);updateInputs({...inputs,mergeFactor:k});return applied('surfel-merge');
        },
      },
      mount({root,document,invoke}){
        const label=document.createElement('label');label.textContent='AO + GI source geometry ';
        selector=document.createElement('select');
        for(const [key,text] of [['detailed','Detailed source'],...Object.entries(candidates).map(([key,item])=>[key,item.identity.kind==='mesh'?`Mesh · ${item.identity.primitives.toLocaleString()} triangles`:'Coarse surfels'])]){
          const option=document.createElement('option');option.value=key;option.textContent=text;selector.append(option);
        }
        const viewLabel=document.createElement('label');sourceView=document.createElement('input');sourceView.type='checkbox';viewLabel.append(sourceView,' Show the GI source');
        const lightingLabel=document.createElement('label');lightingLabel.textContent='Lighting view ';lightingView=document.createElement('select');
        for(const [value,text] of [['scene','Shaded scene'],['ao','Ambient occlusion'],['incoming','Incoming bounce'],['gi','Received bounce']]){const option=document.createElement('option');option.value=value;option.textContent=text;lightingView.append(option);}
        lightingLabel.append(lightingView);
        const mergeLabel=document.createElement('label'),grip=document.createElement('span');grip.textContent='Surfel merge factor ';
        mergeInput=document.createElement('input');mergeInput.type='number';mergeInput.min='1';mergeInput.step='1';mergeInput.className='transform-input';mergeLabel.append(grip,mergeInput);
        status=document.createElement('p');status.className='small';status.setAttribute('role','status');label.append(selector);root.append(label,lightingLabel,viewLabel,mergeLabel,status);
        const failed=error=>{sync();status.textContent=error.message;};
        selector.addEventListener('change',()=>invoke('select',selector.value).catch(failed));
        sourceView.addEventListener('change',()=>invoke('showSource',sourceView.checked).catch(failed));
        lightingView.addEventListener('change',()=>invoke('lightingView',lightingView.value).catch(failed));
        mergeInput.addEventListener('change',()=>{status.textContent='Preparing coarse surfels…';invoke('setMergeFactor',Number(mergeInput.value)).catch(failed);});
        numberDrag=host.controls.installNumberDrag({input:mergeInput,grip,step:1});sync();
      },dispose:cleanup,
    };
  },
};
