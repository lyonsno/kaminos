import {Group,Mesh,BufferGeometry,BufferAttribute,LineSegments,LineBasicMaterial,MeshStandardMaterial,Box3,Vector3} from '../lib/three.core.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {DEFAULT_RECIPE,validateRecipe,validateParameters,deformStock,createStockWarp} from './stock-family/model.mjs';
import {installSceneControlHistory} from '../scene-control-history.mjs';

const pose=root=>({position:root.position.toArray(),rotation:[root.rotation.x,root.rotation.y,root.rotation.z],scale:root.scale.toArray()});
const putPose=(root,p)=>{if(p){root.position.fromArray(p.position);root.rotation.set(...p.rotation);root.scale.fromArray(p.scale);}};
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');

export default {id:'stock-family',title:'Stockroom - adaptable trough',async create({host,inputs={},record=()=>{}}){
  const recipe=validateRecipe(inputs.recipe??DEFAULT_RECIPE),session=await host.scene.open();
  const win=host.controls.document.defaultView,edits=win.kaminosSceneEdits,items=[],seats=[],drags=[],histories=[];
  let disposed=false,strainEnabled=false,refresh=()=>{},unsubscribe=()=>{},reference,sourceGeometry,sourceMaterial;
  const params=item=>({length:item.value.length,bend:item.value.bend,protect:item.value.protect});
  function assertLive(item){if(disposed||!item.asset.root.parent)throw Error('Stock removed; Undo removal or reopen the family');}
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
  function exported(){return validateRecipe({...recipe,variants:items.map(i=>({...i.value,pose:pose(i.root)})),view:session.readView(),referencePose:pose(reference.root)});}
  function read(){return {source:{...recipe.source},referenceId:reference?.id,variants:items.map(i=>({id:i.value.id,label:i.value.label,objectId:i.asset.id,targetId:i.target,parameters:params(i),status:i.error?'blocked':'deformed',error:i.error,metrics:i.metrics,pose:pose(i.root)})),recipe:exported()};}
  const operations={
    read,export:exported,
    set({id,...change}){const item=items.find(i=>i.value.id===id);if(!item)throw Error('Unknown stock member');assertLive(item);
      const next=validateParameters({...params(item),...change});
      if(edits.state().active?.id===item.target)edits.preview(next);else edits.apply(item.target,next,'Shape '+item.value.label);
      record({kind:'stock-family.shape',phase:'applied',target:item.asset.id,effective:{...params(item),error:item.error}});return read();},
    select({id}){const item=items.find(i=>i.value.id===id);if(!item)throw Error('Unknown stock member');win.kaminosSelection.set([item.asset.id],item.asset.id);return read();},
    strain({enabled}){if(typeof enabled!=='boolean')throw Error('Explicit strain display required');strainEnabled=enabled;for(const i of items)i.mesh.material=enabled?i.strainMaterial:sourceMaterial;session.redraw();refresh();return {enabled};},
    frame(){const box=new Box3();for(const a of [reference,...items.map(i=>i.asset)])box.expandByObject(a.root);const center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
      const canvas=[...host.controls.document.querySelectorAll('canvas')].sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
      const aspect=canvas?canvas.clientWidth/Math.max(canvas.clientHeight,1):1,angle=Math.atan(Math.tan(Math.PI/8)*Math.min(1,aspect));
      const distance=size.length()*.56/Math.sin(angle);
      return session.setView({fov:45,zoom:1,target:center.toArray(),position:center.clone().add(new Vector3(.8,1.05,1.1).normalize().multiplyScalar(distance)).toArray()});},
  };
  try{
    if(!edits||!host.controls.mountObject)throw Error('Native object editing host required');
    const response=await fetch(recipe.source.url,{cache:'no-store'});if(!response.ok)throw Error('Stock source HTTP '+response.status);
    const bytes=await response.arrayBuffer();if(await sha(bytes)!==recipe.source.sha256)throw Error('Stock source digest mismatch');
    const gltf=await new GLTFLoader().parseAsync(bytes,''),meshes=[];gltf.scene.traverse(n=>{if(n.isMesh)meshes.push(n);});
    if(meshes.length!==1||meshes[0].isSkinnedMesh||Array.isArray(meshes[0].material))throw Error('This stock profile requires one rigid mesh/material');
    const donor=meshes[0];donor.updateWorldMatrix(true,false);
    if(!donor.matrixWorld.equals(new donor.matrixWorld.constructor()))throw Error('Stock profile requires baked source coordinates');
    sourceGeometry=donor.geometry;sourceMaterial=donor.material;
    if(!sourceGeometry.attributes.normal||!sourceGeometry.attributes.uv||sourceGeometry.attributes.position.isInterleavedBufferAttribute)throw Error('Source needs ordinary positions, normals and UVs');
    const root=new Group();root.name='Original trough';root.add(new Mesh(sourceGeometry,sourceMaterial));root.position.set(-3,.15,-1.7);putPose(root,recipe.referencePose);
    reference=await session.attach(root,{owned:true,metadata:{label:root.name,source:recipe.source.url}});
    for(const [index,value] of recipe.variants.entries()){
      const root=new Group();root.name=value.label;const mesh=new Mesh(sourceGeometry.clone(),sourceMaterial);mesh.castShadow=mesh.receiveShadow=true;root.add(mesh);
      const cross=new BufferGeometry();cross.setAttribute('position',new BufferAttribute(new Float32Array([-.25,0,-.25,.25,0,.25,-.25,0,.25,.25,0,-.25]),3));
      const invalid=new LineSegments(cross,new LineBasicMaterial({color:0xe85a56}));root.add(invalid);
      const slot=index+1;root.position.set(-3+(slot%4)*2,.15,Math.floor(slot/4)*3.4-1.7);putPose(root,value.pose);
      const asset=await session.attach(root,{owned:true,metadata:{label:value.label,source:recipe.source.url}});
      const item={root,mesh,invalid,asset,value:structuredClone(value),target:'@stock-family:'+asset.id,strainMaterial:new MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:0})};items.push(item);
      edits.register(item.target,{read:()=>params(item),check:validateParameters,write:v=>update(item,v)});update(item,params(item));
    }
    if(recipe.view)session.setView(recipe.view);else operations.frame();
    unsubscribe=edits.subscribe(()=>refresh());
  }catch(e){for(const i of items){edits?.unregister(i.target);i.strainMaterial.dispose();}await session.dispose();throw e;}
  return {read,operations,mount({root:panel,document,invoke}){
    const common=document.createElement('section');common.style.cssText='display:grid;gap:8px;margin-top:12px';panel.append(common);
    const list=document.createElement('select');list.setAttribute('aria-label','Stock member');list.className='transform-input';list.style.width='100%';
    for(const item of items){const o=document.createElement('option');o.value=item.value.id;o.textContent=item.value.label;list.append(o);}list.onchange=()=>{list.blur();invoke('select',{id:list.value});};common.append(list);
    const frame=document.createElement('button');frame.className='btn';frame.textContent='Frame family';frame.onclick=()=>invoke('frame');common.append(frame);
    const strainLabel=document.createElement('label'),strain=document.createElement('input');strain.type='checkbox';strain.onchange=()=>invoke('strain',{enabled:strain.checked});strainLabel.append(strain,' Axial strain');common.append(strainLabel);
    const summary=document.createElement('div');common.append(summary);
    const fields=[];
    for(const item of items){
      const properties=document.createElement('section');properties.style.cssText='font-size:12px;line-height:1.5';const title=document.createElement('h4');title.textContent=item.value.label;properties.append(title);
      const inputs=[];const status=document.createElement('output');status.style.cssText='display:block;overflow-wrap:anywhere;margin:8px 0';
      for(const [key,label,step]of [['length','Length',.01],['bend','Bend degrees',1]]){
        const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label',item.value.label+' '+label);input.style.width='100%';row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0';
        row.append(grip,input);properties.append(row);fields.push({item,key,input});inputs.push(input);
        input.addEventListener('input',()=>{if(input.value.trim())invoke('set',{id:item.value.id,[key]:Number(input.value)}).catch(e=>{status.textContent=e.message;});});
        input.addEventListener('blur',()=>refresh());drags.push(host.controls.installNumberDrag({input,grip,step}));
      }
      histories.push(installSceneControlHistory({controls:inputs,edits,id:item.target,label:'Shape '+item.value.label,onError:e=>{status.textContent=e.message;}}));
      const label=document.createElement('label'),protect=document.createElement('input');protect.type='checkbox';protect.setAttribute('aria-label',item.value.label+' Protect feet and mouths');protect.onchange=()=>invoke('set',{id:item.value.id,protect:protect.checked});label.append(protect,' Protect feet and mouths');properties.append(label,status);
      item.ui={status,protect,properties};seats.push(host.controls.mountObject({asset:item.asset,properties}));
    }
    const fileStatus=document.createElement('output');fileStatus.style.display='block';
    const save=document.createElement('button');save.className='btn';save.textContent='Save family...';save.onclick=async()=>{try{const r=await invoke('export'),text=JSON.stringify(r,null,2)+'\n';
      if(win.showSaveFilePicker){const h=await win.showSaveFilePicker({suggestedName:'trough-family.json',types:[{description:'Stock family',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(text);await w.close();fileStatus.textContent='Saved '+h.name;}
      else{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='trough-family.json';a.click();URL.revokeObjectURL(url);fileStatus.textContent='Downloaded family';}
    }catch(e){if(e.name!=='AbortError')fileStatus.textContent=e.message;}};
    const open=document.createElement('button'),file=document.createElement('input');open.className='btn';open.textContent='Open family...';file.type='file';file.setAttribute('aria-label','Open stock family');file.accept='.json,application/json';file.hidden=true;open.onclick=()=>file.click();file.onchange=async()=>{try{const r=validateRecipe(JSON.parse(await file.files[0].text()));await win.kaminosWorkbenchExperiments.open('stock-family',{recipe:r});}catch(e){fileStatus.textContent=e.message;}finally{file.value='';}};common.append(save,open,file,fileStatus);
    refresh=()=>{if(disposed)return;const selected=items.find(i=>i.asset.id===win.kaminosSelection.read().activeId);const parent=selected?.ui.properties??panel;if(common.parentNode!==parent)parent.append(common);if(selected)list.value=selected.value.id;
      strain.checked=strainEnabled;for(const {item,key,input}of fields)if(document.activeElement!==input||input.readOnly)input.value=String(item.value[key]);
      for(const i of items){i.ui.protect.checked=i.value.protect;i.ui.status.textContent=i.error?'Blocked: '+i.error:`Axial stretch ${i.metrics.minAxialStretch.toFixed(2)} to ${i.metrics.maxAxialStretch.toFixed(2)} x`;}
      summary.textContent=items.filter(i=>i.error).map(i=>i.value.label+': '+i.error).join(' ');summary.style.cssText='font-size:12px;color:#e5b46a;overflow-wrap:anywhere;margin:10px 0';};refresh();operations.select({id:items[0].value.id});
  },async dispose(){if(disposed)return;refresh=()=>{};unsubscribe();for(const h of histories)h.dispose();for(const d of drags)d.dispose();for(const s of seats)s.dispose();
    const ids=new Set(items.flatMap(i=>[i.target,i.asset.id]));if(reference)ids.add(reference.id);edits.discard(e=>ids.has(e.id));disposed=true;for(const i of items){edits.unregister(i.target);i.mesh.material=sourceMaterial;i.strainMaterial.dispose();}await session.dispose();
  }};
}};
