import {Mesh,BufferGeometry,Float32BufferAttribute,MeshStandardMaterial,LineSegments,LineBasicMaterial,Color,Vector3,Matrix4,Box3,DoubleSide} from '../lib/three.core.js';

export default {
 id:'fracture-shape', title:'Fracture · shape draft',
 async create({host,inputs,record}){
  if(typeof inputs.source!=='string'||!inputs.source.trim())throw Error('Choose a source mesh URL');
  const session=await host.scene.open();let worker,asset,disposed=false,serial=0,pending=new Map();
  try{
   asset=await session.loadAsset({url:inputs.source,normalize:false,metadata:{label:'Fracture source',source:inputs.source}});
   const sourceRoot=asset.root;sourceRoot.updateWorldMatrix(true,true);
   const originalMeshes=[];sourceRoot.traverse(n=>{if(n.isSkinnedMesh||n.isInstancedMesh||n.morphTargetInfluences?.length)throw Error('Shape draft requires static ordinary triangle meshes');if(n.isMesh)originalMeshes.push(n);});
   if(!originalMeshes.length)throw Error('No triangle meshes in source');
   const inverse=new Matrix4().copy(sourceRoot.matrixWorld).invert(),positions=[],indices=[];
   for(const mesh of originalMeshes){
    const geometry=mesh.geometry,position=geometry.getAttribute('position'),index=geometry.getIndex(),count=index?index.count:position.count;
    if(count%3)throw Error('Source triangle attributes are incomplete');
    const matrix=new Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),base=positions.length/3;
    for(let i=0;i<position.count;i++){const p=new Vector3().fromBufferAttribute(position,i).applyMatrix4(matrix);positions.push(...p.toArray());}
    for(let i=0;i<count;i++)indices.push(base+(index?index.getX(i):i));
   }
   const sourcePositions=Float64Array.from(positions),sourceIndices=Uint32Array.from(indices),expanded=new Float32Array(indices.length*3);
   indices.forEach((id,i)=>expanded.set(positions.slice(id*3,id*3+3),i*3));
   const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(expanded.slice(),3));geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(expanded.length),3));geometry.computeVertexNormals();
   const material=new MeshStandardMaterial({vertexColors:true,roughness:.78,metalness:0,side:DoubleSide,flatShading:true}),regions=new Mesh(geometry,material);regions.name='Candidate shape regions';regions.castShadow=true;regions.receiveShadow=true;
   const cutGeometry=new BufferGeometry(),cuts=new LineSegments(cutGeometry,new LineBasicMaterial({color:0x172133,depthTest:false}));cuts.name='Candidate cut boundaries';cuts.renderOrder=4;
   sourceRoot.add(regions,cuts);
   let result=null,mode=inputs.mode??'regions',explosion=0,selected=-1,reach=Number(inputs.minReachFraction??.04),smallArea=Number(inputs.minAreaFraction??.001),busy=false,error='',statusElement,selectElement;
   worker=new Worker(new URL('../fracture-shape-partition.worker.mjs',import.meta.url),{type:'module'});
   const failAll=error=>{for(const p of pending.values())p.reject(error);pending.clear();};
   worker.onerror=e=>{error=e.message||'Partition worker failed';busy=false;failAll(Error(error));sync();};
   worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.error?p.reject(Error(data.error)):p.resolve(data.result);};
   function request(settings,first=false){return new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});worker.postMessage({id,settings,...(first?{geometry:{positions:sourcePositions,indices:sourceIndices}}:{})});});}
   function read(){return {route:'kaminos.fracture.shape-draft.v1',source:inputs.source,triangleCount:indices.length/3,settings:{method:'geodesic-neck',minReachFraction:reach,minAreaFraction:smallArea},mode,explosion,selected,busy,error,partition:result?{route:result.route,triangleCount:result.triangleCount,sourceComponents:result.sourceComponents,diagnostics:result.diagnostics,parts:result.parts,attachments:result.attachments,boundaryEdges:result.boundaries.length}:null,claim:'Automatic concavity-guided surface partition draft; no fracture physics'};}
   function sync(){
    if(statusElement)statusElement.textContent=busy?'Finding candidate parts…':error||`${result?.parts.length??0} regions · ${result?.attachments.length??0} shared boundaries · ${(indices.length/3).toLocaleString()} source triangles\n${result?.sourceComponents??0} disconnected surface components. Preview separation is geometric; no forces are simulated.`;
    if(selectElement&&result){const value=String(selected);selectElement.replaceChildren();for(const [value,text]of [['-1','All regions'],...result.parts.map(p=>[String(p.id),`Region ${p.id+1} · ${p.triangles.toLocaleString()} triangles`])]){const option=selectElement.ownerDocument.createElement('option');option.value=value;option.textContent=text;selectElement.append(option);}selectElement.value=value;}
   }
   function draw(){
    if(!result)return;
    originalMeshes.forEach(m=>{m.visible=mode==='original';});regions.visible=mode!=='original';cuts.visible=mode!=='original';
    const colorAttribute=geometry.getAttribute('color'),position=geometry.getAttribute('position'),center=new Box3().setFromBufferAttribute(new Float32BufferAttribute(expanded,3)).getCenter(new Vector3()),diagonal=new Box3().setFromBufferAttribute(new Float32BufferAttribute(expanded,3)).getSize(new Vector3()).length();
    const offsets=result.parts.map(p=>{const v=new Vector3(...p.center).sub(center);return v.lengthSq()?v.normalize().multiplyScalar(diagonal*explosion).toArray():[0,0,0];});
    const colors=result.parts.map(p=>new Color().setHSL((p.id*.61803398875+.1)%1,.58,.55));
    for(let face=0;face<result.labels.length;face++){
     const part=result.labels[face],c=selected<0||selected===part?colors[part]:new Color(.13,.15,.18),offset=offsets[part];
     for(let j=0;j<3;j++){const v=face*3+j;colorAttribute.setXYZ(v,c.r,c.g,c.b);position.setXYZ(v,expanded[v*3]+offset[0],expanded[v*3+1]+offset[1],expanded[v*3+2]+offset[2]);}
    }
    colorAttribute.needsUpdate=true;position.needsUpdate=true;geometry.computeBoundingSphere();geometry.computeBoundingBox();
    const lines=[];
    for(const boundary of result.boundaries)for(const part of explosion?boundary.parts:[boundary.parts[0]]){
     if(selected>=0&&!boundary.parts.includes(selected))continue;
     for(const v of boundary.points)lines.push(...v.map((x,k)=>x+offsets[part][k]));
    }
    cutGeometry.setAttribute('position',new Float32BufferAttribute(lines,3));cutGeometry.computeBoundingSphere();
    session.redraw();sync();
   }
   async function analyze(settings,first=false){
    const nextReach=Number(settings.minReachFraction),nextSmall=Number(settings.minAreaFraction);
    if(!Number.isFinite(nextReach)||nextReach<0||nextReach>1||!Number.isFinite(nextSmall)||nextSmall<0||nextSmall>1)throw Error('Choose finite reach and area fractions between 0 and 1');
    busy=true;error='';sync();const generation=serial+1;
    try{const next=await request({method:'geodesic-neck',minAreaFraction:nextSmall,minReachFraction:nextReach,maxCutRatio:4},first);if(disposed||generation!==serial)return read();result=next;reach=nextReach;smallArea=nextSmall;selected=-1;busy=false;draw();record({kind:'fracture-shape.partition',phase:'applied',target:asset.id,requested:settings,effective:read()});return read();}
    catch(e){if(!disposed&&generation===serial){busy=false;error=e.message;sync();}throw e;}
   }
   function frame(){const bounds=new Box3().setFromObject(sourceRoot),center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3()),r=size.length();return session.setView({position:center.clone().add(new Vector3(1,.65,1.4).normalize().multiplyScalar(r*1.8)).toArray(),target:center.toArray()});}
   await analyze({minReachFraction:reach,minAreaFraction:smallArea},true);frame();
   return {
    read,
    operations:{
     partition:settings=>analyze(settings),
     view:value=>{if(!['original','regions'].includes(value))throw Error('Choose original or regions');mode=value;draw();return read();},
     separate:value=>{if(!Number.isFinite(value)||value<0||value>1)throw Error('Separation must be between 0 and 1');explosion=value;draw();return read();},
     select:value=>{if(!Number.isInteger(value)||value< -1||value>=result.parts.length)throw Error('Choose an existing region');selected=value;draw();return read();},
     frame,
     export:()=>({...read(),labels:Array.from(result.labels),boundaries:result.boundaries}),
    },
    mount({root:panel,document,invoke}){
     const paragraph=document.createElement('p');paragraph.textContent='Inspect shape-aware candidate pieces on the original surface. Find thin branches and narrow attachments, compare the textured source, and preview separation.';panel.append(paragraph);
     const row=(text,element)=>{const label=document.createElement('label');label.style.cssText='display:grid;gap:6px;margin:12px 0';const title=document.createElement('span');title.textContent=text;label.append(title,element);panel.append(label);return element;};
     const status=document.createElement('p');status.style.whiteSpace='pre-line';status.setAttribute('role','status');statusElement=status;
     const failed=e=>{error=e.message;sync();};
     const angleInput=document.createElement('input');Object.assign(angleInput,{type:'number',min:'0',max:'100',step:'any',value:String(reach*100)});row('Minimum branch reach (% object extent)',angleInput);
     const areaInput=document.createElement('input');Object.assign(areaInput,{type:'number',min:'0',max:'100',step:'any',value:String(smallArea*100)});row('Minimum branch area (% surface)',areaInput);
     const update=document.createElement('button');update.textContent='Find candidate parts';update.addEventListener('click',()=>invoke('partition',{minReachFraction:Number(angleInput.value)/100,minAreaFraction:Number(areaInput.value)/100}).catch(failed));panel.append(update);
     const modeInput=document.createElement('select');for(const [value,text]of [['regions','Colored regions + cuts'],['original','Original textured surface']]){const option=document.createElement('option');option.value=value;option.textContent=text;modeInput.append(option);}modeInput.value=mode;modeInput.addEventListener('change',()=>invoke('view',modeInput.value).catch(failed));row('Compare',modeInput);
     selectElement=document.createElement('select');selectElement.addEventListener('change',()=>invoke('select',Number(selectElement.value)).catch(failed));row('Highlight a region',selectElement);
     const separate=document.createElement('input');Object.assign(separate,{type:'range',min:'0',max:'0.3',step:'0.005',value:'0'});separate.setAttribute('aria-label','Preview separation');separate.addEventListener('input',()=>invoke('separate',Number(separate.value)).catch(failed));row('Preview separation',separate);
     const framing=document.createElement('button');framing.textContent='Frame object';framing.addEventListener('click',()=>invoke('frame').catch(failed));panel.append(framing,status);sync();
    },
    async dispose(){disposed=true;worker.terminate();failAll(Error('Shape draft closed'));await session.dispose();},
   };
  }catch(e){disposed=true;worker?.terminate();for(const p of pending.values())p.reject(e);pending.clear();await session.dispose();throw e;}
 },
};
