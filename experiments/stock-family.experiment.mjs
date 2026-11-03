import {Group,Mesh,BufferGeometry,BufferAttribute,LineSegments,LineBasicMaterial,MeshStandardMaterial,Box3,Vector3} from '../lib/three.core.js';
import {DEFAULT_RECIPE,validateRecipe,validateParameters,validateProfile,replaceStockSource,deformStock,createStockWarp,bandPercent,bandsFromPercent} from './stock-family/model.mjs';
import {loadStockSource,stockDigest} from './stock-family/source.mjs';
import {validateFamilyAsset,readFamilyAsset,saveFamilyAsset} from './stock-family/library.mjs';
import {assetWithheld,assetSource} from '../authoring-assets.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';
import {cloneStockMaterial,disposeStockMaterial,stockHistoryReferences,stockRetirementIds} from './stock-family/lifecycle.mjs';

const pose=root=>({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});
const putPose=(root,p)=>{if(p){root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);}};

export default {id:'stock-family',title:'Stockroom - adaptable trough',async create({host,inputs={},record=()=>{}}){
  let library=inputs.asset?validateFamilyAsset(inputs.asset):inputs.assetSource?await readFamilyAsset(inputs.assetSource):null;
  let recipe=validateRecipe(library?.recipe??inputs.recipe??DEFAULT_RECIPE),saving=false;
  const session=await host.scene.open();
  const win=host.controls.document.defaultView,edits=win.kaminosSceneEdits,items=[],seats=[],drags=[],histories=[];
  let disposed=false,strainEnabled=false,refresh=()=>{},unsubscribe=()=>{},reference,sourceGeometry,sourceMaterial,sourceRequest=0,sourceBusy=false;
  const sourceTarget='@stock-source:'+crypto.randomUUID();
  const removals=[];
  const params=item=>({length:item.value.length,bend:item.value.bend,protect:item.value.protect});
  function assertLive(item){if(disposed||!item.asset.root.parent)throw Error('Stock removed; reopen the family');}
  function watchRemoval(asset,item){
    const removed=()=>{if(disposed)return;
      const ids=new Set([asset.id,...(item?[item.target]:[])]),groupId=asset.root.userData.kaminosSceneObject?.groupId;
      // Native membership prunes groups before detaching the root; its metadata
      // still identifies the former group, which may have surviving members.
      if(groupId&&!win.kaminosSceneAuthoring.read().groups.some(g=>g.id===groupId))ids.add('@group:'+groupId);
      edits.discard(entry=>stockHistoryReferences(entry,ids));
      if(item){item.removed=true;edits.unregister(item.target);if(item.mesh.material!==item.surfaceMaterial)disposeStockMaterial(item.surfaceMaterial);item.strainMaterial.dispose();}
      refresh();
    };
    asset.root.addEventListener('removed',removed);removals.push(()=>asset.root.removeEventListener('removed',removed));
  }
  function update(item,value){
    assertLive(item);item.value={...item.value,...validateParameters(value)};item.error=null;
    try{
      const result=deformStock(sourceGeometry.attributes.position.array,sourceGeometry.attributes.normal.array,recipe.source.profile,item.value);
      item.mesh.geometry.attributes.position.array.set(result.positions);item.mesh.geometry.attributes.normal.array.set(result.normals);
      item.mesh.geometry.attributes.position.needsUpdate=true;item.mesh.geometry.attributes.normal.needsUpdate=true;
      item.mesh.geometry.computeBoundingBox();item.mesh.geometry.computeBoundingSphere();item.metrics=result.metrics;item.mesh.visible=true;item.invalid.visible=false;
      const warp=createStockWarp(recipe.source.profile,item.value),colors=new Float32Array(result.positions.length);
      for(let i=0;i<colors.length;i+=3){const s=warp.point(Array.from(sourceGeometry.attributes.position.array.subarray(i,i+3))).axial;
        const magnitude=Math.min(1,Math.abs(Math.log2(s))/3);colors.set(s>=1?[.15+.85*magnitude,.65-.4*magnitude,.65-.55*magnitude]:[.15+.4*magnitude,.65-.4*magnitude,.65+.35*magnitude],i);}
      item.mesh.geometry.setAttribute('color',new BufferAttribute(colors,3));
    }catch(e){item.error=e.message;item.metrics=null;item.mesh.visible=false;item.invalid.visible=true;}
    item.root.name=item.value.label+(item.error?' (blocked)':'');
    host.scene.refreshPresentation(item.asset);session.redraw();refresh();
  }
  const intact=()=>reference?.root.parent&&items.every(i=>!i.removed);
  function exported(){if(!intact())throw Error('Family members were removed; reopen the family before saving');return validateRecipe({...recipe,variants:items.map(i=>({...i.value,pose:pose(i.root)})),view:session.readView(),referencePose:pose(reference.root)});}
  function read(){return {source:structuredClone(recipe.source),sources:structuredClone(recipe.sources??[recipe.source]),sourceBusy,referenceId:reference?.id,variants:items.map(i=>({id:i.value.id,label:i.value.label,objectId:i.asset.id,targetId:i.target,parameters:params(i),status:i.removed?'removed':i.error?'blocked':'deformed',error:i.error,metrics:i.metrics,pose:pose(i.root),materialMaps:Object.fromEntries(['map','roughnessMap','metalnessMap','normalMap'].map(key=>[key,!!i.mesh.material[key]]))})),recipe:intact()?exported():null};}
  const operations={
    read,export:exported,
    library:()=>library?{id:library.id,name:library.name,revision:library.revision}:null,
    async save({name,copy=false}){
      if(saving||sourceBusy||edits.state().active||edits.state().replaying)throw Error('Finish the current edit before saving');
      saving=true;
      try{const saved=await saveFamilyAsset({recipe:exported(),name,...(!copy&&library?{id:library.id,revision:library.revision}:{})});if(!disposed)library=saved;return saved;}
      finally{saving=false;}
    },
    async asset({entry,axis='z'}){
      if(entry?.kind!=='mesh'||assetWithheld(entry))throw Error('Choose an available mesh in Assets');
      const url=entry.source??assetSource(entry.root,entry.path),response=await fetch(url,{cache:'no-store'});
      if(!response.ok)throw Error('Stock source HTTP '+response.status);
      const sha256=await stockDigest(await response.arrayBuffer());
      return operations.source({source:{url,sha256,label:entry.label??entry.name,fit:{axis}},fit:true});
    },
    async source({source,fit=false}){
      if(!intact())throw Error('Reopen the complete family before replacing its source');
      const request=++sourceRequest;sourceBusy=true;refresh();let loaded;
      try{
        loaded=await loadStockSource(source,{fit});
        if(disposed||request!==sourceRequest)throw Error('Source request superseded');
        if(!intact()||edits.state().active||edits.state().replaying)throw Error('Finish the current edit before replacing its source');
        const next=replaceStockSource(recipe,loaded.source);
        const replacements=[reference,...items.map(i=>i.asset)].map(()=>({geometry:loaded.geometry.clone(),material:cloneStockMaterial(loaded.material)}));
        edits.discard(entry=>stockHistoryReferences(entry,new Set([sourceTarget,...items.map(i=>i.target)])));
        const oldGeometry=sourceGeometry,oldMaterial=sourceMaterial;
        recipe=next;sourceGeometry=loaded.geometry;sourceMaterial=loaded.material;loaded=null;
        for(const [index,asset]of [reference,...items.map(i=>i.asset)].entries()){
          const mesh=index===0?reference.root.children[0]:items[index-1].mesh,oldSurface=index===0?mesh.material:items[index-1].surfaceMaterial;
          mesh.geometry.dispose();disposeStockMaterial(oldSurface);mesh.geometry=replacements[index].geometry;
          if(index===0)mesh.material=replacements[index].material;
          else{items[index-1].surfaceMaterial=replacements[index].material;mesh.material=strainEnabled?items[index-1].strainMaterial:replacements[index].material;}
        }
        oldGeometry.dispose();disposeStockMaterial(oldMaterial);for(const item of items)update(item,params(item));
        record({kind:'stock-family.source',phase:'applied',effective:structuredClone(recipe.source)});return read();
      }finally{if(loaded){loaded.geometry.dispose();disposeStockMaterial(loaded.material);}if(request===sourceRequest){sourceBusy=false;refresh();}}
    },
    bands({locks}){const profile=validateProfile({...recipe.source.profile,locks:structuredClone(locks)});edits.apply(sourceTarget,profile,'Protect source bands');return read();},
    set({id,...change}){const item=items.find(i=>i.value.id===id);if(!item)throw Error('Unknown stock member');assertLive(item);
      const next=validateParameters({...params(item),...change});
      if(edits.state().active?.id===item.target)edits.preview(next);else edits.apply(item.target,next,'Shape '+item.value.label);
      record({kind:'stock-family.shape',phase:'applied',target:item.asset.id,effective:{...params(item),error:item.error}});return read();},
    select({id}){const item=items.find(i=>i.value.id===id);if(!item)throw Error('Unknown stock member');assertLive(item);win.kaminosSelection.set([item.asset.id],item.asset.id);return read();},
    strain({enabled}){if(typeof enabled!=='boolean')throw Error('Explicit strain display required');strainEnabled=enabled;for(const i of items)if(!i.removed)i.mesh.material=enabled?i.strainMaterial:i.surfaceMaterial;session.redraw();refresh();return {enabled};},
    frame(){const box=new Box3();for(const a of [reference,...items.map(i=>i.asset)])if(a.root.parent)box.expandByObject(a.root);if(box.isEmpty())return session.readView();const center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
      const canvas=[...host.controls.document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
      const aspect=canvas?canvas.clientWidth/Math.max(canvas.clientHeight,1):1,angle=Math.atan(Math.tan(Math.PI/8)*Math.min(1,aspect));
      const distance=size.length()*.56/Math.sin(angle);
      return session.setView({fov:45,zoom:1,target:center.toArray(),position:center.clone().add(new Vector3(.8,1.05,1.1).normalize().multiplyScalar(distance)).toArray()});},
  };
  try{
    if(!edits||!host.controls.mountObject)throw Error('Native object editing host required');
    const loaded=await loadStockSource(recipe.source);sourceGeometry=loaded.geometry;sourceMaterial=loaded.material;
    const root=new Group();root.name='Source reference';root.add(new Mesh(sourceGeometry.clone(),cloneStockMaterial(sourceMaterial)));root.position.set(-3,.15,-1.7);putPose(root,recipe.referencePose);
    reference=await session.attach(root,{owned:true,metadata:{label:root.name,source:'kaminos:stock-family'}});
    watchRemoval(reference);
    for(const [index,value] of recipe.variants.entries()){
      const root=new Group();root.name=value.label;const surfaceMaterial=cloneStockMaterial(sourceMaterial),mesh=new Mesh(sourceGeometry.clone(),surfaceMaterial);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
      const cross=new BufferGeometry();cross.setAttribute('position',new BufferAttribute(new Float32Array([-.25,0,-.25,.25,0,.25,-.25,0,.25,.25,0,-.25]),3));
      const invalid=new LineSegments(cross,new LineBasicMaterial({color:0xe85a56}));root.add(invalid);
      const slot=index+1;root.position.set(-3+(slot%4)*2,.15,Math.floor(slot/4)*3.4-1.7);putPose(root,value.pose);
      const asset=await session.attach(root,{owned:true,metadata:{label:value.label,source:'kaminos:stock-family'}});
      const item={root,mesh,invalid,asset,surfaceMaterial,value:structuredClone(value),target:'@stock-family:'+asset.id,strainMaterial:new MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0})};items.push(item);
      edits.register(item.target,{read:()=>params(item),check:validateParameters,write:v=>update(item,v)});update(item,params(item));
      watchRemoval(asset,item);
    }
    if(recipe.view)session.setView(recipe.view);else operations.frame();
    edits.register(sourceTarget,{read:()=>structuredClone(recipe.source.profile),check:validateProfile,write:profile=>{recipe=replaceStockSource(recipe,{...recipe.source,profile:structuredClone(profile)});for(const item of items)if(!item.removed)update(item,params(item));}});
    unsubscribe=edits.subscribe(()=>refresh());
  }catch(e){disposed=true;removals.forEach(remove=>remove());edits?.unregister(sourceTarget);for(const i of items){edits?.unregister(i.target);i.strainMaterial.dispose();}await session.dispose();sourceGeometry?.dispose();if(sourceMaterial)disposeStockMaterial(sourceMaterial);throw e;}
  return {read,operations,mount({root:panel,document,invoke}){
    document.body.classList.add('stock-family-active');
    const style=document.createElement('link');style.rel='stylesheet';style.href='/experiments/stock-family/controls.css';document.head.append(style);removals.push(()=>{style.remove();document.body.classList.remove('stock-family-active');});
    const common=document.createElement('section');common.className='stock-family-controls';panel.append(common);removals.push(()=>common.remove());
    const heading=document.createElement('h3');heading.textContent='Stock family';common.append(heading);
    const name=document.createElement('input');name.className='transform-input';name.type='text';name.setAttribute('aria-label','Family name');name.value=library?.name??'Workshop stock';common.append(name);
    const sourceSelect=document.createElement('select');sourceSelect.className='transform-input';sourceSelect.setAttribute('aria-label','Stock source');common.append(sourceSelect);
    const sourceStatus=document.createElement('output');sourceStatus.className='stock-source-status';
    async function chooseSource(source,fit=false){sourceStatus.textContent='Loading source...';try{await invoke('source',{source,fit});sourceStatus.textContent='';}catch(e){sourceStatus.textContent=e.message;refresh();}}
    const browse=document.createElement('button');browse.className='btn';browse.textContent='Choose from Assets...';browse.onclick=()=>{if(win.kaminosWorkspace.setMode('authoring')!==false)win.kaminosAssets.open('browse');};common.append(browse);
    const useAsset=document.createElement('button'),assetStatus=document.createElement('output');useAsset.className='btn';useAsset.textContent='Use as stock source';assetStatus.className='stock-source-status';
    document.querySelector('#authoring-assets .asset-selected-actions').append(useAsset,assetStatus);removals.push(()=>{useAsset.remove();assetStatus.remove();});
    const showSourceAction=state=>{useAsset.hidden=state.selected?.kind!=='mesh'||assetWithheld(state.selected);};showSourceAction(win.kaminosAssets.read());removals.push(win.kaminosAssets.subscribe(showSourceAction));
    useAsset.onclick=async()=>{useAsset.disabled=true;sourceStatus.textContent=assetStatus.textContent='Loading source...';try{await invoke('asset',{entry:win.kaminosAssets.read().selected,axis:axis.value});sourceStatus.textContent=assetStatus.textContent='';win.kaminosAssets.close();win.kaminosWorkspace.setMode('workbench');refresh();}catch(e){sourceStatus.textContent=assetStatus.textContent=e.message;}finally{useAsset.disabled=false;}};
    sourceSelect.onchange=()=>{sourceSelect.blur();chooseSource((recipe.sources??[recipe.source]).find(s=>s.sha256===sourceSelect.value));};
    const importButton=document.createElement('button'),meshFile=document.createElement('input');importButton.className='btn';importButton.textContent='Import source GLB...';meshFile.type='file';meshFile.accept='.glb';meshFile.hidden=true;meshFile.setAttribute('aria-label','Import stock source');importButton.onclick=()=>meshFile.click();
    meshFile.onchange=async()=>{const file=meshFile.files[0];if(!file)return;importButton.disabled=true;sourceStatus.textContent='Storing source...';try{
      const bytes=await file.arrayBuffer(),digest=await stockDigest(bytes),response=await fetch('/api/ingest-mesh',{method:'POST',headers:{'Content-Type':'model/gltf-binary'},body:bytes}),receipt=await response.json();
      if(!response.ok||receipt.schema!=='kaminos.generated-mesh.v0'||receipt.sha256!==digest||receipt.bytes!==bytes.byteLength||receipt.source!==`/api/read?root=generated-meshes&path=${digest}.glb`)throw Error('Source storage identity mismatch');
      if(disposed)return;await chooseSource({url:receipt.source,sha256:digest,label:file.name.replace(/\.glb$/i,''),fit:{axis:axis.value}},true);
    }catch(e){sourceStatus.textContent=e.message;}finally{meshFile.value='';importButton.disabled=false;}};
    common.append(importButton,meshFile,sourceStatus);
    const fitting=document.createElement('details'),fittingTitle=document.createElement('summary');fittingTitle.textContent='Source fitting';fitting.append(fittingTitle);common.append(fitting);
    const axisLabel=document.createElement('label'),axis=document.createElement('select');axisLabel.textContent='Length axis';axis.className='transform-input';axis.setAttribute('aria-label','Source length axis');
    for(const value of ['z','x','y','-z','-x','-y']){const option=document.createElement('option');option.value=value;option.textContent=value.toUpperCase();axis.append(option);}axisLabel.append(axis);fitting.append(axisLabel);
    axis.onchange=()=>{axis.blur();chooseSource({...recipe.source,fit:{axis:axis.value}},true);};
    const bandTitle=document.createElement('h4');bandTitle.textContent='Protected bands (%)';const bands=document.createElement('div');bands.className='stock-source-bands';fitting.append(bandTitle,bands);
    const addBand=document.createElement('button'),applyBands=document.createElement('button');addBand.className=applyBands.className='btn';addBand.textContent='Add protected band';applyBands.textContent='Apply bands';fitting.append(addBand,applyBands);
    const sourceIdentity=document.createElement('output');sourceIdentity.className='stock-source-identity';fitting.append(sourceIdentity);
    let sourceKey='',bandKey='',bandDraft=[];
    addBand.onclick=()=>{try{const p=recipe.source.profile,locks=bandsFromPercent(p,bandDraft),points=[p.min,...locks.flat(),p.max],gaps=[];for(let i=0;i<points.length;i+=2)if(points[i+1]>points[i])gaps.push([points[i],points[i+1]]);gaps.sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));const gap=gaps[0];if(!gap)return;bandDraft=[...locks,[gap[0],gap[0]+(gap[1]-gap[0])*.1]].sort((a,b)=>a[0]-b[0]).map(b=>b.map(v=>bandPercent(p,v)));renderBands();sourceStatus.textContent='';}catch(e){sourceStatus.textContent=e.message;}};
    applyBands.onclick=async()=>{try{await invoke('bands',{locks:bandsFromPercent(recipe.source.profile,bandDraft)});sourceStatus.textContent='';bandKey='';refresh();}catch(e){sourceStatus.textContent=e.message;}};
    function renderBands(){
      bands.replaceChildren();bandDraft.forEach((band,index)=>{const row=document.createElement('div');row.className='stock-band-row';
        for(let end=0;end<2;end++){const input=document.createElement('input');input.type='number';input.step='any';input.className='transform-input';input.value=band[end];input.setAttribute('aria-label',`Band ${index+1} ${end?'end':'start'} percent`);input.oninput=()=>{bandDraft[index][end]=input.value;};row.append(input);}
        const remove=document.createElement('button');remove.className='btn';remove.textContent='\u00d7';remove.title=`Remove band ${index+1}`;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{bandDraft.splice(index,1);renderBands();sourceStatus.textContent='';};row.append(remove);bands.append(row);
      });
    }
    function refreshSources(){
      const sources=recipe.sources??[recipe.source],key=JSON.stringify(sources.map(s=>[s.sha256,s.label]));
      if(key!==sourceKey){sourceKey=key;sourceSelect.replaceChildren();for(const s of sources){const option=document.createElement('option');option.value=s.sha256;option.textContent=s.label??(s.sha256===DEFAULT_RECIPE.source.sha256?'Steel trough':s.sha256.slice(0,12));sourceSelect.append(option);}}
      sourceSelect.value=recipe.source.sha256;sourceSelect.disabled=sourceBusy;importButton.disabled=sourceBusy;axis.disabled=sourceBusy;axis.value=recipe.source.fit?.axis??'z';
      sourceIdentity.textContent=recipe.source.sha256;sourceIdentity.title=recipe.source.url;
      const profile=recipe.source.profile,nextKey=JSON.stringify([recipe.source.sha256,profile]);if(nextKey===bandKey)return;bandKey=nextKey;bandDraft=profile.locks.map(b=>b.map(v=>bandPercent(profile,v)));renderBands();sourceStatus.textContent='';
    }
    const frame=document.createElement('button');frame.className='btn';frame.textContent='Frame family';frame.onclick=()=>invoke('frame');common.append(frame);
    const strainLabel=document.createElement('label'),strain=document.createElement('input');strain.type='checkbox';strain.onchange=()=>invoke('strain',{enabled:strain.checked});strainLabel.append(strain,' Axial strain');common.append(strainLabel);
    const fields=[];
    for(const item of items){
      const properties=document.createElement('section');properties.className='stock-shape-properties';const title=document.createElement('h4');title.textContent='Shape';properties.append(title);
      const inputs=[];const status=document.createElement('output');status.style.cssText='display:block;overflow-wrap:anywhere;margin:8px 0';
      for(const [key,label,step]of [['length','Length',.01],['bend','Bend degrees',1]]){
        const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label',item.value.label+' '+label);input.style.width='100%';row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0';
        row.append(grip,input);properties.append(row);fields.push({item,key,input});inputs.push(input);
        input.addEventListener('input',()=>{if(input.value.trim())invoke('set',{id:item.value.id,[key]:Number(input.value)}).catch(e=>{status.textContent=e.message;});});
        input.addEventListener('blur',()=>refresh());drags.push(host.controls.installNumberDrag({input,grip,step}));
      }
      histories.push(installSceneControlHistory({controls:inputs,edits,id:item.target,label:'Shape '+item.value.label,onError:e=>{status.textContent=e.message;}}));
      const label=document.createElement('label'),protect=document.createElement('input');protect.type='checkbox';protect.setAttribute('aria-label',item.value.label+' Protect source bands');protect.onchange=()=>invoke('set',{id:item.value.id,protect:protect.checked});label.append(protect,' Protect source bands');properties.append(label,status);
      item.ui={status,protect,properties};seats.push(host.controls.mountObject({asset:item.asset,properties}));
    }
    const fileStatus=document.createElement('output');fileStatus.style.display='block';
    const saveInternal=document.createElement('button');saveInternal.className='btn';saveInternal.textContent='Save family';saveInternal.onclick=async()=>{saveInternal.disabled=true;try{const value=await invoke('save',{name:name.value});fileStatus.textContent='Saved '+value.name;}catch(e){fileStatus.textContent=e.message;}finally{saveInternal.disabled=false;}};common.append(saveInternal);
    const transfer=document.createElement('details'),transferTitle=document.createElement('summary');transferTitle.textContent='Import / export';transfer.append(transferTitle);common.append(transfer);
    const save=document.createElement('button');save.className='btn';save.textContent='Export family...';save.onclick=async()=>{try{const r=await invoke('export'),text=JSON.stringify(r,null,2)+'\n';
      if(win.showSaveFilePicker){const h=await win.showSaveFilePicker({suggestedName:'trough-family.json',types:[{description:'Stock family',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(text);await w.close();fileStatus.textContent='Saved '+h.name;}
      else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='trough-family.json';a.click();URL.revokeObjectURL(url);fileStatus.textContent='Downloaded family';}
    }catch(e){if(e.name!=='AbortError')fileStatus.textContent=e.message;}};
    const open=document.createElement('button'),file=document.createElement('input');open.className='btn';open.textContent='Import family...';file.type='file';file.setAttribute('aria-label','Open stock family');file.accept='.json,application/json';file.hidden=true;open.onclick=()=>file.click();file.onchange=async()=>{try{const r=validateRecipe(JSON.parse(await file.files[0].text()));await win.kaminosWorkbenchExperiments.open('stock-family',{recipe:r});}catch(e){fileStatus.textContent=e.message;}finally{file.value='';}};transfer.append(save,open,file);common.append(fileStatus);
    refresh=()=>{if(disposed)return;const sceneSlot=document.getElementById('experiment-scene-slot'),parent=sceneSlot&&!sceneSlot.hidden?sceneSlot:panel;if(common.parentNode!==parent)parent.prepend(common);refreshSources();
      strain.checked=strainEnabled;for(const {item,key,input}of fields){input.disabled=!!item.removed;if(document.activeElement!==input||input.readOnly)input.value=String(item.value[key]);}
      for(const i of items){i.ui.protect.disabled=!!i.removed;i.ui.protect.checked=i.value.protect;i.ui.status.textContent=i.removed?'Removed':i.error?'Blocked: '+i.error:`Axial stretch ${i.metrics.minAxialStretch.toFixed(2)} to ${i.metrics.maxAxialStretch.toFixed(2)} x`;i.ui.status.dataset.blocked=String(!!i.error);}
      save.disabled=!intact();};refresh();operations.select({id:items[0].value.id});
  },async dispose(){if(disposed)return;refresh=()=>{};unsubscribe();for(const h of histories)h.dispose();for(const d of drags)d.dispose();for(const s of seats)s.dispose();
    const ids=stockRetirementIds([sourceTarget,reference.id,...items.flatMap(i=>[i.target,i.asset.id])],win.kaminosSceneAuthoring.read().groups);edits.discard(e=>stockHistoryReferences(e,ids));disposed=true;sourceRequest++;edits.unregister(sourceTarget);removals.forEach(remove=>remove());for(const i of items)if(!i.removed){edits.unregister(i.target);i.mesh.material=i.surfaceMaterial;i.strainMaterial.dispose();}await session.dispose();sourceGeometry.dispose();disposeStockMaterial(sourceMaterial);
  }};
}};
