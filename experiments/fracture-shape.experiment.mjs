import {Mesh,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial,LineSegments,LineBasicMaterial,LineDashedMaterial,Color,Vector3,Matrix4,Box3,DoubleSide,LessEqualDepth,GreaterDepth} from '../lib/three.core.js';
import {shapeHierarchyView} from '../fracture-shape-partition.mjs';

export default {
 id:'fracture-shape',title:'Fracture · attachment draft',
 async create({host,inputs,record,updateInputs=()=>{}}){
  if(typeof inputs.source!=='string'||!inputs.source.trim())throw Error('Choose a source mesh URL');
  const session=await host.scene.open();let worker,asset,disposed=false,serial=0;const pending=new Map();
  const failAll=e=>{for(const p of pending.values())p.reject(e);pending.clear();};
  try{
   asset=await session.loadAsset({url:inputs.source,normalize:false,metadata:{label:'Fracture source',source:inputs.source}});
   const sourceRoot=asset.root;sourceRoot.updateWorldMatrix(true,true);
   const originalMeshes=[];sourceRoot.traverse(n=>{if(n.isSkinnedMesh||n.isInstancedMesh||n.morphTargetInfluences?.length)throw Error('Shape draft requires static ordinary triangle meshes');if(n.isMesh)originalMeshes.push(n);});
   if(!originalMeshes.length)throw Error('No triangle meshes in source');
   const originalFaceOffsets=new Map();
   const inverse=new Matrix4().copy(sourceRoot.matrixWorld).invert(),positions=[],indices=[];
   for(const mesh of originalMeshes){
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex(),count=index?index.count:position.count;
    if(count%3)throw Error('Source triangle attributes are incomplete');
    originalFaceOffsets.set(mesh,indices.length/3);
    const matrix=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),base=positions.length/3;
    for(let i=0;i<position.count;i++)positions.push(...new Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix).toArray());
    for(let i=0;i<count;i++)indices.push(base+(index?index.getX(i):i));
   }
   const sourcePositions=Float64Array.from(positions),sourceIndices=Uint32Array.from(indices),expanded=new Float32Array(indices.length*3);
   indices.forEach((id,i)=>expanded.set(positions.slice(id*3,id*3+3),i*3));
   const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(expanded.slice(),3));geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(expanded.length),3));geometry.computeVertexNormals();
   const regions=new Mesh(geometry,new MeshStandardMaterial({vertexColors:true,roughness:.78,side:DoubleSide,flatShading:true}));regions.name='Candidate shape regions';regions.castShadow=true;regions.receiveShadow=true;
   const bounds=new Box3().setFromBufferAttribute(new Float32BufferAttribute(expanded,3)),center=bounds.getCenter(new Vector3()),diagonal=bounds.getSize(new Vector3()).length();
   const cutGeometry=new BufferGeometry(),visibleCuts=new LineSegments(cutGeometry,new LineBasicMaterial({color:0x172133,depthTest:true,depthFunc:LessEqualDepth,depthWrite:false}));visibleCuts.name='Visible candidate cut boundaries';visibleCuts.renderOrder=4;
   const hiddenCuts=new LineSegments(cutGeometry,new LineDashedMaterial({color:0x8b90a4,transparent:true,opacity:.45,depthTest:true,depthFunc:GreaterDepth,depthWrite:false,dashSize:diagonal*.006,gapSize:diagonal*.004}));hiddenCuts.name='Hidden candidate cut boundaries';hiddenCuts.renderOrder=5;
   sourceRoot.add(regions,visibleCuts,hiddenCuts);
   let result=null,view=null,mode=inputs.mode??'regions',explosion=Number(inputs.explosion??0),selected=Number(inputs.selected??-1),localDetail=structuredClone(inputs.localDetail??{}),viewDirty=true,drawnView=null,drawnExplosion=null,detailLevel=Number(inputs.detailLevel??1),showHiddenCuts=inputs.showHiddenCuts??false;
   let reach=Number(inputs.minReachFraction??.001),smallArea=Number(inputs.minAreaFraction??.0001),cleanup=Number(inputs.cleanupAreaFraction??.0001),busy=false,error='';
   if(!Number.isInteger(selected)||selected< -1||!['regions','original'].includes(mode)||!Number.isFinite(explosion)||explosion<0||explosion>1||!Number.isInteger(detailLevel)||detailLevel<0||typeof showHiddenCuts!=='boolean')throw Error('Invalid shape presentation setup');
   let statusElement,selectedText,refineButton,keepButton,parentButton,resetButton,selectElement,detailInput,detailText,hiddenInput,modeInput,separationInput,fieldDocument;const numericInputs={};
   worker=new Worker(new URL('../fracture-shape-partition.worker.mjs',import.meta.url),{type:'module'});
   worker.onerror=e=>{if(disposed)return;error=e.message||'Partition worker failed';busy=false;failAll(Error(error));sync();};
   worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
   const request=(settings,first)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,settings,...(first?{geometry:{positions:sourcePositions,indices:sourceIndices}}:{})});});
   const setup=()=>({source:inputs.source,minReachFraction:reach,minAreaFraction:smallArea,cleanupAreaFraction:cleanup,detailLevel,showHiddenCuts,mode,explosion,selected,localDetail:{...localDetail}});
   const read=()=>({route:'kaminos.fracture.attachment-draft.v2',source:inputs.source,triangleCount:indices.length/3,settings:{method:'geodesic-neck',minReachFraction:reach,minAreaFraction:smallArea,cleanupAreaFraction:cleanup,maxCutRatio:4},mode,explosion,selected,detailLevel,showHiddenCuts,busy,error,analysis:result?.analysis??null,localDetail:{...localDetail},setup:setup(),hierarchy:result?{schema:result.hierarchy.schema,nodes:result.hierarchy.nodes,maxDepth:result.hierarchy.maxDepth}:null,partition:view?{route:result.route,triangleCount:result.triangleCount,sourceComponents:result.sourceComponents,diagnostics:result.diagnostics,parts:view.parts,attachments:view.attachments,boundaryEdges:view.boundaries.length}:null,claim:'Nested surface grouping and geometric separation preview; no fracture physics'});
   const persist=()=>updateInputs(setup());
   const event=(kind,requested)=>{persist();const effective=read();record({kind:'fracture-shape.'+kind,phase:'applied',target:asset.id,requested,effective});return effective;};
   const belongs=(node,parent)=>{while(node!==null){if(node===parent)return true;node=result.hierarchy.nodes[node].parent;}return false;};
   const inheritedDetail=id=>{const path=[];for(let p=id;p!==null;p=result.hierarchy.nodes[p].parent)path.push(p);let level=detailLevel;for(const p of path.reverse())if(Object.hasOwn(localDetail,p))level=localDetail[p];return level;};
   const subtreeDepth=id=>result.hierarchy.nodes.reduce((max,node)=>belongs(node.id,id)?Math.max(max,node.depth):max,0);
   function sync(){
    if(statusElement)statusElement.textContent=busy?(result?'Updating pieces from retained attachment search…':'Finding attachments from seven surface starting points…'):error||`${view?.parts.length??0} visible pieces · ${view?.attachments.length??0} shared boundaries · ${(indices.length/3).toLocaleString()} source triangles\n${result?.sourceComponents??0} source components. Attachment search retained for threshold changes. Local refinement changes the selected piece only. Separation is a geometric preview.`;
    if(selectElement&&result&&selectElement._result!==result){
     selectElement._result=result;
     selectElement.replaceChildren();const all=fieldDocument.createElement('option');all.value='-1';all.textContent='All pieces';selectElement.append(all);
     for(const n of result.hierarchy.nodes){const option=fieldDocument.createElement('option');option.value=String(n.id);option.textContent=`${'\u00a0\u00a0'.repeat(n.depth)}${n.kind==='component'?'Component':n.kind==='branch'?'Branch':'Surface patch'} ${n.id+1} · ${n.triangles.toLocaleString()} triangles${n.children.length?' (includes subparts)':''}`;selectElement.append(option);}
    }
    if(selectElement)selectElement.value=String(selected);
    const node=result?.hierarchy.nodes[selected];
    if(selectedText)selectedText.textContent=node?`${node.kind==='component'?'Source component':node.kind==='branch'?'Attachment piece':'Surface patch'} ${node.id+1} · ${node.triangles.toLocaleString()} triangles${node.agreement?` · same boundary in ${node.agreement} of seven searches`:''}`:'Click a fitting in the view to work on it.';
    if(refineButton)refineButton.disabled=!node?.children.length||inheritedDetail(node.id)>=subtreeDepth(node.id);
    if(keepButton)keepButton.disabled=!node;
    if(parentButton)parentButton.disabled=!node||node.parent===null;
    if(resetButton)resetButton.disabled=!Object.keys(localDetail).length;
    if(detailInput&&result){detailInput.max=String(result.hierarchy.maxDepth);detailInput.value=String(detailLevel);detailText.textContent=`Grouping detail · ${detailLevel} / ${result.hierarchy.maxDepth}`;}
    if(hiddenInput)hiddenInput.checked=showHiddenCuts;if(modeInput)modeInput.value=mode;if(separationInput)separationInput.value=String(explosion);
    for(const [key,value]of Object.entries({minReachFraction:reach,minAreaFraction:smallArea,cleanupAreaFraction:cleanup})){const input=numericInputs[key];if(input&&fieldDocument.activeElement!==input)input.value=String(value*100);}
   }
   function draw(){
    if(!result)return;
    if(viewDirty){view=shapeHierarchyView(result,detailLevel,localDetail);viewDirty=false;}
    const geometryChanged=drawnView!==view||drawnExplosion!==explosion;
    originalMeshes.forEach(m=>{m.visible=mode==='original';});regions.visible=mode!=='original';visibleCuts.visible=mode!=='original';hiddenCuts.visible=mode!=='original'&&showHiddenCuts;
    const offsets=view.parts.map(p=>{const v=new Vector3(...p.center).sub(center);return v.lengthSq()?v.normalize().multiplyScalar(diagonal*explosion).toArray():[0,0,0];});
    const colors=view.parts.map(p=>{const n=result.hierarchy.nodes[p.nodeId];return n.parent===null||p.id===0?new Color('#b5aa8d'):new Color().setHSL((n.id*.61803398875+.1)%1,.64,.49);});
    const colorAttribute=geometry.getAttribute('color'),position=geometry.getAttribute('position'),dim=new Color(.13,.15,.18);
    for(let face=0;face<view.labels.length;face++){
     const part=view.labels[face],c=selected<0||belongs(view.parts[part].nodeId,selected)?colors[part]:dim,offset=offsets[part];
     for(let j=0;j<3;j++){const v=face*3+j;colorAttribute.setXYZ(v,c.r,c.g,c.b);if(geometryChanged)position.setXYZ(v,expanded[v*3]+offset[0],expanded[v*3+1]+offset[1],expanded[v*3+2]+offset[2]);}
    }
    colorAttribute.needsUpdate=true;if(geometryChanged){position.needsUpdate=true;geometry.computeBoundingSphere();geometry.computeBoundingBox();drawnView=view;drawnExplosion=explosion;}
    const lines=[];
    for(const boundary of view.boundaries){
     if(selected>=0&&!boundary.parts.some(p=>belongs(view.parts[p].nodeId,selected)))continue;
     for(const part of explosion?boundary.parts:[boundary.parts[0]])for(const v of boundary.points)lines.push(...v.map((x,k)=>x+offsets[part][k]));
    }
    const old=cutGeometry.getAttribute('position');if(old?.array.length===lines.length){old.array.set(lines);old.needsUpdate=true;}else{cutGeometry.dispose();cutGeometry.setAttribute('position',new Float32BufferAttribute(lines,3));}
    cutGeometry.computeBoundingSphere();hiddenCuts.computeLineDistances();session.redraw();sync();
   }
   async function analyze(settings,first=false){
    const next={minReachFraction:Number(settings.minReachFraction),minAreaFraction:Number(settings.minAreaFraction),cleanupAreaFraction:Number(settings.cleanupAreaFraction??cleanup)};
    if(Object.values(next).some(v=>!Number.isFinite(v)||v<0||v>1))throw Error('Choose finite reach and area fractions between 0 and 1');
    busy=true;error='';sync();const generation=serial+1;
    try{
     const candidate=await request({method:'geodesic-neck',...next,maxCutRatio:4},first);if(disposed||generation!==serial)return read();
     if(first){if(selected>=candidate.hierarchy.nodes.length)throw Error('Saved selected piece does not exist');shapeHierarchyView(candidate,Math.min(detailLevel,candidate.hierarchy.maxDepth),localDetail);}
     result=candidate;viewDirty=true;reach=next.minReachFraction;smallArea=next.minAreaFraction;cleanup=next.cleanupAreaFraction;if(!first){selected=-1;localDetail={};}detailLevel=Math.min(detailLevel,result.hierarchy.maxDepth);busy=false;draw();return event('partition',settings);
    }catch(e){if(!disposed&&generation===serial){busy=false;error=e.message;sync();}throw e;}
   }
   function frame(){const bounds=new Box3().setFromObject(sourceRoot),center=bounds.getCenter(new Vector3()),r=bounds.getSize(new Vector3()).length();return session.setView({position:center.clone().add(new Vector3(1,.65,1.4).normalize().multiplyScalar(r*1.8)).toArray(),target:center.toArray()});}
   await analyze({minReachFraction:reach,minAreaFraction:smallArea,cleanupAreaFraction:cleanup},true);frame();
   const selectPiece=value=>{if(!Number.isInteger(value)||value< -1||value>=result.hierarchy.nodes.length)throw Error('Choose an existing hierarchy piece');selected=value;
    if(value>=0&&!view.parts.some(p=>belongs(p.nodeId,value))){const visible=new Set(view.parts.map(p=>p.nodeId));let ancestor=value;while(!visible.has(ancestor)&&result.hierarchy.nodes[ancestor].parent!==null)ancestor=result.hierarchy.nodes[ancestor].parent;if(ancestor!==value){localDetail={...localDetail,[ancestor]:result.hierarchy.nodes[value].depth};viewDirty=true;}}
    draw();return event('selection',value);};
   const localLevel=level=>{if(selected<0)throw Error('Select a piece first');localDetail={...localDetail,[selected]:level};viewDirty=true;draw();return event('local-detail',{piece:selected,level});};
   const operations={
     partition:settings=>analyze(settings),
     detail:value=>{if(!Number.isInteger(value)||value<0||value>result.hierarchy.maxDepth)throw Error('Choose an existing hierarchy detail level');detailLevel=value;localDetail={};viewDirty=true;while(selected>=0&&result.hierarchy.nodes[selected].depth>detailLevel)selected=result.hierarchy.nodes[selected].parent??-1;draw();return event('detail',value);},
     hiddenCuts:value=>{if(typeof value!=='boolean')throw Error('Hidden cuts requires a boolean');showHiddenCuts=value;draw();return event('hidden-cuts',value);},
     view:value=>{if(!['original','regions'].includes(value))throw Error('Choose original or regions');mode=value;draw();return event('view',value);},
     separate:value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('Separation must be between 0 and 1');explosion=value;draw();return event('separation',value);},
     select:selectPiece,
     selectFace:face=>{if(!Number.isInteger(face)||face<0||face>=view.labels.length)throw Error('Choose an existing source triangle');return selectPiece(view.parts[view.labels[face]].nodeId);},
     refine:()=>{if(selected<0)throw Error('Select a piece first');const node=result.hierarchy.nodes[selected];return localLevel(Math.min(subtreeDepth(selected),Math.max(node.depth,inheritedDetail(selected))+1));},
     keepTogether:()=>{if(selected<0)throw Error('Select a piece first');return localLevel(result.hierarchy.nodes[selected].depth);},
     resetLocal:()=>{localDetail={};viewDirty=true;draw();return event('reset-local',null);},
     parent:()=>{selected=selected<0?-1:result.hierarchy.nodes[selected].parent??-1;draw();return event('parent-selection',selected);},
     frame,
     export:()=>({...read(),labels:Array.from(view.labels),boundaries:view.boundaries,hierarchy:{...result.hierarchy,faceOwners:Array.from(result.hierarchy.faceOwners)},finestLabels:Array.from(result.labels),candidateBranches:result.candidateBranches}),
   };
   if(selected>=0)selectPiece(selected);
   const stopPick=session.onPick?.(hit=>{
    let face;if(hit.object===regions)face=hit.faceIndex;else if(originalFaceOffsets.has(hit.object))face=originalFaceOffsets.get(hit.object)+hit.faceIndex;
    if(Number.isInteger(face))operations.selectFace(face);
   });
   return {
    read,operations,
    mount({root:panel,document,invoke}){
     fieldDocument=document;
     const paragraph=document.createElement('p');paragraph.textContent='Click a fitting in the view. Refine that piece, or select a larger piece and keep it together.';panel.append(paragraph);
     const row=(text,element,parent=panel)=>{const label=document.createElement('label');label.style.cssText='display:grid;gap:6px;margin:10px 0';const title=document.createElement('span');title.textContent=text;label.append(title,element);parent.append(label);return title;};
     const failed=e=>{error=e.message;sync();};
     selectElement=document.createElement('select');selectElement.addEventListener('change',()=>invoke('select',Number(selectElement.value)).catch(failed));row('Selected piece',selectElement);
     selectedText=document.createElement('p');panel.append(selectedText);
     const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:6px';panel.append(actions);
     const action=(text,operation)=>{const button=document.createElement('button');button.textContent=text;button.addEventListener('click',()=>invoke(operation).catch(failed));actions.append(button);return button;};
     refineButton=action('Finer here','refine');keepButton=action('Keep together','keepTogether');parentButton=action('Select larger piece','parent');resetButton=action('Reset local grouping','resetLocal');
     separationInput=document.createElement('input');Object.assign(separationInput,{type:'range',min:'0',max:'0.3',step:'0.005',value:String(explosion)});separationInput.setAttribute('aria-label','Preview separation');separationInput.addEventListener('input',()=>invoke('separate',Number(separationInput.value)).catch(failed));row('Preview separation',separationInput);
     modeInput=document.createElement('select');for(const [value,text]of [['regions','Colored pieces + visible cuts'],['original','Original textured surface']]){const option=document.createElement('option');option.value=value;option.textContent=text;modeInput.append(option);}modeInput.addEventListener('change',()=>invoke('view',modeInput.value).catch(failed));row('Compare',modeInput);
     detailInput=document.createElement('input');Object.assign(detailInput,{type:'range',min:'0',max:String(result.hierarchy.maxDepth),step:'1',value:String(detailLevel)});detailInput.setAttribute('aria-label','Grouping detail');detailText=row('Grouping detail',detailInput);detailInput.addEventListener('input',()=>invoke('detail',Number(detailInput.value)).catch(failed));
     const global=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Global detection settings';global.append(summary);panel.append(global);
     const hint=document.createElement('p');hint.textContent='Threshold changes reuse the retained attachment search and reset local grouping. They apply when you finish editing a value.';hint.style.fontSize='12px';global.append(hint);
     const applyThresholds=()=>invoke('partition',Object.fromEntries(Object.entries(numericInputs).map(([k,v])=>[k,Number(v.value)/100]))).catch(failed);
     for(const [key,text,value]of [['minReachFraction','Minimum branch reach (% object extent)',reach],['minAreaFraction','Minimum branch area (% surface)',smallArea],['cleanupAreaFraction','Merge surface patches below (% surface)',cleanup]]){
      const input=document.createElement('input');Object.assign(input,{type:'number',min:'0',max:'100',step:'any',value:String(value*100)});numericInputs[key]=input;input.addEventListener('change',applyThresholds);row(text,input,global);
     }
     const update=document.createElement('button');update.textContent='Apply global thresholds';update.addEventListener('click',applyThresholds);global.append(update);
     hiddenInput=document.createElement('input');hiddenInput.type='checkbox';hiddenInput.setAttribute('aria-label','Show hidden cuts');hiddenInput.addEventListener('change',()=>invoke('hiddenCuts',hiddenInput.checked).catch(failed));row('Show hidden cuts (faint dashed lines)',hiddenInput,global);
     const framing=document.createElement('button');framing.textContent='Frame object';framing.addEventListener('click',()=>invoke('frame').catch(failed));statusElement=document.createElement('p');statusElement.style.whiteSpace='pre-line';statusElement.setAttribute('role','status');panel.append(framing,statusElement);sync();
    },
    async dispose(){disposed=true;stopPick?.();worker.terminate();failAll(Error('Shape draft closed'));await session.dispose();},
   };
  }catch(e){disposed=true;worker?.terminate();failAll(e);await session.dispose();throw e;}
 },
};
