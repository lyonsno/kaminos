import {Box3,Vector3,Group,Mesh,BoxGeometry,MeshStandardMaterial} from '../lib/three.core.js';
import {createGeneratedGlass} from '../generated-glass.mjs';
import {createDeferredSurfaceSplats} from '../deferred-surface-splats.mjs';
import {createSurfelGlass} from '../trellis-surfel-glass.mjs';
import {createRawFieldMesh} from '../trellis-raw-mesh.mjs';
import {createReferenceBottle} from '../glass-reference-bottle.mjs';

export default {
 id:'generated-glass',title:'Generated glass',
 async create({host,inputs,record}){
  if(!inputs.url)throw Error('Choose a textured mesh URL');
  const session=await host.scene.open();let asset,glass,frame,surfels,splats,currentField,rawMesh,fieldMeta,reference,representation='mesh',levelRequest=0,representationRequest=0,disposed=false;
  const surfelHolder=new Group(),rawHolder=new Group(),splatHolder=new Group();splatHolder.name='Deferred surface splats';splatHolder.visible=false;surfelHolder.name='TRELLIS surfels';rawHolder.name='Raw triangles';
  const levels=inputs.surfelBase?[{factor:1,base:inputs.surfelBase},...(inputs.surfelLevels??[])]:[];
  if(levels.some((l,i)=>!Number.isSafeInteger(l.factor)||l.factor<1||!l.base||levels.findIndex(v=>v.factor===l.factor)!==i))throw Error('Invalid surfel levels');
  let factor=inputs.surfelFactor??levels.at(-1)?.factor;
  const load=async base=>{const [m,b]=await Promise.all([fetch(base+'report.json'),fetch(base+'surfels.f32')]);if(!m.ok||!b.ok)throw Error('Surfel fields unavailable');const meta=await m.json();if(!meta.ok)throw Error('Surfel export did not succeed');const bytes=await b.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(sha!==meta.dataSHA256)throw Error('Surfel payload hash mismatch');return {data:new Float32Array(bytes),meta};};
  async function makeSplats({data,meta,base}){
   if(!meta.footprints||meta.footprints.stride!==8)throw Error('This detail has no fitted splat footprints');
   const response=await fetch(base+meta.footprints.file);if(!response.ok)throw Error('Splat footprints unavailable');const bytes=await response.arrayBuffer();
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==meta.footprints.sha256)throw Error('Splat footprint hash mismatch');
   const next=createDeferredSurfaceSplats(data,meta,new Float32Array(bytes));next.set(surfels?.read()??{...glass.read(),...inputs.material});return next;
  }
  async function loadLevel(value){
   const level=levels.find(l=>l.factor===value);if(!level)throw Error('Unavailable surfel level');
   const request=++levelRequest,{data,meta}=await load(level.base);
   if(disposed||request!==levelRequest)return false;
   if((meta.reduction?.factor??1)!==value||meta.sourceCount!==fieldMeta.sourceCount||!fieldMeta.sourceHashes||JSON.stringify(meta.sourceHashes)!==JSON.stringify(fieldMeta.sourceHashes)||(value!==1&&meta.sourceDataSHA256!==fieldMeta.dataSHA256))throw Error('Surfel level source mismatch');
   const field={data,meta,base:level.base},next=createSurfelGlass(data,meta);let nextSplats;
   if(representation==='splats'){try{nextSplats=await makeSplats(field);}catch(error){next.dispose();throw error;}if(disposed||request!==levelRequest){nextSplats.dispose();next.dispose();return false;}}
   try{const {mode,ior,thickness,reconstruction,reconstructionScope}=surfels?.read()??{mode:'glass',ior:1.45,thickness:.06,reconstruction:true,reconstructionScope:'glass',...inputs.material};next.set({mode,ior,thickness,reconstruction,reconstructionScope});}catch(error){next.dispose();throw error;}
   if(surfels){surfelHolder.remove(surfels.root);surfels.dispose();}surfels=next;surfelHolder.add(next.root);currentField=field;if(splats){splatHolder.remove(splats.root);splats.dispose();}splats=nextSplats;if(splats)splatHolder.add(splats.root);factor=value;return true;
  }
  try{
   asset=await session.loadAsset({url:inputs.url});glass=createGeneratedGlass(asset.root,inputs.material);
   if(inputs.surfelBase){
    const response=await fetch(inputs.surfelBase+'report.json');if(!response.ok)throw Error('Surfel source unavailable');fieldMeta=await response.json();if(!fieldMeta.ok)throw Error('Surfel export did not succeed');
    await loadLevel(factor);
    await session.attach(surfelHolder,{owned:true,metadata:{label:'Raw-field surfels',source:inputs.surfelBase,type:'experiment'}});
    await session.attach(splatHolder,{owned:true,metadata:{label:'Deferred surface splats',source:inputs.surfelBase,type:'experiment'}});
    if(fieldMeta.triangles)await session.attach(rawHolder,{owned:true,metadata:{label:'Unsimplified raw triangles',source:inputs.surfelBase,type:'experiment'}});rawHolder.visible=false;
    representation='surfels';asset.root.visible=false;
    if(inputs.representation==='splats'){splats=await makeSplats(currentField);splatHolder.add(splats.root);representation='splats';splatHolder.visible=true;surfelHolder.visible=false;}
    if(inputs.material){surfels.set(inputs.material);rawMesh?.set(inputs.material);}
   }
   const box=new Box3().setFromObject(asset.root),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
   reference=createReferenceBottle();reference.root.scale.setScalar(size.y*.32);reference.root.position.set(box.min.x-size.x*.18,box.min.y,center.z+size.z*.25);
   await session.attach(reference.root,{owned:true,metadata:{label:reference.root.name,source:'fixture:smooth-hollow-bottle',type:'experiment'}});reference.set(glass.read());
   // An opaque striped card makes displacement and tint visible behind the bottles.
   const card=new Group();card.name='Glass backdrop';
   for(let i=0;i<12;i++){
    const stripe=new Mesh(new BoxGeometry(size.x*2.3/12,size.y*1.2,.015),new MeshStandardMaterial({color:i%2?0x152c50:0xf5ead0,roughness:1}));
    stripe.position.set(center.x-size.x*.15+(i-5.5)*size.x*2.3/12,center.y,box.min.z-.12);card.add(stripe);
   }
   await session.attach(card,{owned:true,metadata:{label:card.name,source:'fixture:glass-backdrop',type:'experiment'}});
   frame=(detail=false)=>{
    const target=detail?new Vector3(box.min.x+size.x*.02,box.min.y+size.y*.17,center.z+size.z*.25):center.clone().add(new Vector3(-size.x*.15,0,0));
    return session.setView({position:[target.x,target.y+(detail?0:.12),detail?target.z+size.y*.8:box.max.z+size.y*1.6],target:target.toArray()});
   };
   frame(inputs.closeup===true);
  }catch(error){rawMesh?.dispose();surfels?.dispose();splats?.dispose();reference?.dispose();glass?.dispose();await session.dispose();throw error;}
  let sync=()=>{};
  const read=()=>({source:inputs.url,objectId:asset.id,representation,factor,levels:levels.map(l=>({factor:l.factor,source:l.base})),fieldRegion:fieldMeta?.regionNormalizedYUp??null,rawMesh:rawMesh?.read(),surfels:surfels?.read(),splats:splats?.read(),reference:reference.read(),...glass.read()});
  return {read,operations:{
   frameBottle(){const view=frame(true);record({kind:'generated-glass.frame-bottle',view});return view;},
   frameWhole(){return frame(false);},
   async setRepresentation(value){if(!surfels||!['mesh','surfels','splats',...(fieldMeta.triangles?['rawMesh']:[])].includes(value))throw Error('Unavailable representation');
    const request=++representationRequest;
    if(value==='splats'&&!splats){const field=currentField,next=await makeSplats(field);if(disposed||request!==representationRequest||field!==currentField){next.dispose();return;}splats=next;splatHolder.add(next.root);}
    if(value==='rawMesh'&&!rawMesh){const {data,meta}=await load(inputs.surfelBase),response=await fetch(inputs.surfelBase+meta.triangles.file);if(!response.ok)throw Error('Raw triangles unavailable');const triangles=new Uint32Array(await response.arrayBuffer());if(disposed||request!==representationRequest)return;rawMesh=createRawFieldMesh(data,triangles,meta);rawMesh.set(glass.read());rawHolder.add(rawMesh.root);}
    representation=value;asset.root.visible=value==='mesh';surfelHolder.visible=value==='surfels';rawHolder.visible=value==='rawMesh';splatHolder.visible=value==='splats';session.redraw();sync();record({kind:'generated-glass.representation',value});return read();},
   async setSurfelFactor(value){if(await loadLevel(value)){session.redraw();sync();record({kind:'generated-glass.surfel-factor',factor,count:surfels.read().count});}return read();},
   setMaterial(patch){glass.set(patch);surfels?.set(patch);splats?.set(patch);rawMesh?.set(patch);reference.set(patch);session.redraw();sync();const effective=read();record({kind:'generated-glass.material',requested:patch,effective});return effective;},
   setReconstruction(enabled){if(!surfels)throw Error('No surfel source');surfels.set({reconstruction:enabled});session.redraw();sync();record({kind:'generated-glass.reconstruction',enabled});return read();},
   setReconstructionMode(value){if(!['off','glass','all'].includes(value))throw Error('Unknown reconstruction mode');surfels.set({reconstruction:value!=='off',reconstructionScope:value==='off'?'glass':value});session.redraw();sync();record({kind:'generated-glass.reconstruction-mode',value});return read();},
   inspectSurface({x,y}){return (representation==='splats'?splats:surfels).inspectSurface(x,y);},
  },mount({root,document,invoke}){
   const text=document.createElement('p');text.textContent='TRELLIS supplied color and opacity. Glass mode interprets low opacity as transmission; IOR and thickness are authored. Screen-space refraction sees the opaque scene, not other glass layers.';root.append(text);
   const mode=document.createElement('select');mode.setAttribute('aria-label','Material view');
   for(const [value,label] of [['opaque','Generated materials, opaque'],['plain','Plain grey — shape only'],['normals','Surface normals'],['opacity','Generated opacity (dithered)'],['glass','Glass interpretation']]){const o=document.createElement('option');o.value=value;o.textContent=label;mode.append(o);}root.append(mode);
   const status=document.createElement('p');status.setAttribute('role','status');
   const update=patch=>invoke('setMaterial',patch).catch(e=>{status.textContent=e.message;sync();});
   let representationSelect,reconstruction,density,countLabel;
   if(surfels){
    const label=document.createElement('p');label.textContent=`Same saved decode: ${fieldMeta.regionNormalizedYUp?'spatial crop':'whole object'}. Raw triangles and surfels share positions, normals and all six material channels. Finished mesh includes mesh finishing and texture baking.`;root.append(label);
    representationSelect=document.createElement('select');representationSelect.setAttribute('aria-label','Surface representation');
    for(const [value,text] of [['surfels','Circles — accepted baseline'],['splats','Deferred surface splats — experiment'],...(fieldMeta.triangles?[['rawMesh','Unsimplified raw triangles — expensive']]:[]),['mesh','Finished mesh']]){const o=document.createElement('option');o.value=value;o.textContent=text;representationSelect.append(o);}
    representationSelect.onchange=()=>invoke('setRepresentation',representationSelect.value).catch(e=>{status.textContent=e.message;});root.append(representationSelect);
    density=document.createElement('select');density.setAttribute('aria-label','Surfel detail');for(const l of levels){const o=document.createElement('option');o.value=l.factor;o.textContent=l.factor===1?'Original detail — expensive':`Merge ${l.factor}×${l.factor}×${l.factor} cells`;density.append(o);}density.onchange=()=>invoke('setSurfelFactor',Number(density.value)).catch(e=>{status.textContent=e.message;sync();});root.append(density);
    countLabel=document.createElement('p');root.append(countLabel);
    reconstruction=document.createElement('select');reconstruction.setAttribute('aria-label','Nearest-wall reconstruction');
    for(const [value,label] of [['off','Reconstruction off'],['glass','Reconstruct glass only'],['all','Reconstruct everything — diagnostic']]){const o=document.createElement('option');o.value=value;o.textContent=label;reconstruction.append(o);}reconstruction.onchange=()=>invoke('setReconstructionMode',reconstruction.value).catch(e=>{status.textContent=e.message;});root.append(reconstruction);
   }
   mode.onchange=()=>update({mode:mode.value});
   const fields={};for(const [key,label,min,max,step] of [['ior','Refractive index',1,2.5,.01],['thickness','Thickness (scene units)',0,1,.01]]){
    const row=document.createElement('label'),input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label);input.onchange=()=>update({[key]:Number(input.value)});row.append(label+' ',input);root.append(row);fields[key]=input;
   }
   const referenceNote=document.createElement('p');referenceNote.textContent='The smooth hollow bottle at left is a known-geometry control using the same lighting, IOR and authored optical thickness. Screen-space shading does not trace both walls.';root.append(referenceNote);
   for(const [operation,label] of [['frameBottle','Compare bottles'],['frameWhole','Show the whole asset']]){
    const button=document.createElement('button');button.textContent=label;button.onclick=()=>invoke(operation).catch(e=>{status.textContent=e.message;});root.append(button);
   }
   root.append(status);sync=()=>{const s=read();mode.value=s.mode;if(representationSelect)representationSelect.value=representation;if(reconstruction){reconstruction.value=s.surfels.reconstruction?s.surfels.reconstructionScope:'off';reconstruction.disabled=representation!=='surfels';density.value=factor;density.disabled=!['surfels','splats'].includes(representation);countLabel.textContent=`${s.surfels.count.toLocaleString()} surfels / ${s.surfels.sourceCount.toLocaleString()} source samples`;}for(const k of Object.keys(fields))fields[k].value=s[k];};sync();
  },async dispose(){disposed=true;levelRequest++;representationRequest++;rawMesh?.dispose();surfels?.dispose();splats?.dispose();reference?.dispose();glass.dispose();await session.dispose();}};
 }
};
