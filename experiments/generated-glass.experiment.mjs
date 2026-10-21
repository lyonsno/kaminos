import {Box3,Vector3,Group,Mesh,BoxGeometry,MeshStandardMaterial} from '../lib/three.core.js';
import {createGeneratedGlass} from '../generated-glass.mjs';
import {createSurfelGlass} from '../trellis-surfel-glass.mjs';

export default {
 id:'generated-glass',title:'Generated glass',
 async create({host,inputs,record}){
  if(!inputs.url)throw Error('Choose a textured mesh URL');
  const session=await host.scene.open();let asset,glass,frame,surfels,representation='mesh';
  try{
   asset=await session.loadAsset({url:inputs.url});glass=createGeneratedGlass(asset.root,inputs.material);
   if(inputs.surfelBase){
    const [m,b]=await Promise.all([fetch(inputs.surfelBase+'report.json'),fetch(inputs.surfelBase+'surfels.f32')]);
    if(!m.ok||!b.ok)throw Error('Surfel fields unavailable');
    const metadata=await m.json();if(!metadata.ok)throw Error('Surfel export did not succeed');
    surfels=createSurfelGlass(new Float32Array(await b.arrayBuffer()),metadata);
    await session.attach(surfels.root,{owned:true,metadata:{label:'Raw-field bottle crop',source:inputs.surfelBase,type:'experiment'}});
    representation='surfels';asset.root.visible=false;
   }
   const box=new Box3().setFromObject(asset.root),center=box.getCenter(new Vector3()),size=box.getSize(new Vector3());
   // An opaque striped card makes displacement and tint visible behind the bottles.
   const card=new Group();card.name='Glass backdrop';
   for(let i=0;i<12;i++){
    const stripe=new Mesh(new BoxGeometry(size.x*1.8/12,size.y*1.2,.015),new MeshStandardMaterial({color:i%2?0x152c50:0xf5ead0,roughness:1}));
    stripe.position.set(center.x+(i-5.5)*size.x*1.8/12,center.y,box.min.z-.12);card.add(stripe);
   }
   await session.attach(card,{owned:true,metadata:{label:card.name,source:'fixture:glass-backdrop',type:'experiment'}});
   frame=(detail=false)=>{
    const target=detail?new Vector3(box.min.x+size.x*.22,box.min.y+size.y*.16,center.z+size.z*.25):center;
    return session.setView({position:[target.x,target.y+(detail?0:.12),detail?target.z+size.y*.48:box.max.z+size.y*1.5],target:target.toArray()});
   };
   frame(inputs.closeup===true);
  }catch(error){surfels?.dispose();glass?.dispose();await session.dispose();throw error;}
  let sync=()=>{};
  const read=()=>({source:inputs.url,objectId:asset.id,representation,surfels:surfels?.read(),...glass.read()});
  return {read,operations:{
   frameBottle(){const view=frame(true);record({kind:'generated-glass.frame-bottle',view});return view;},
   frameWhole(){return frame(false);},
   setRepresentation(value){if(!surfels||!['mesh','surfels'].includes(value))throw Error('Unavailable representation');representation=value;asset.root.visible=value==='mesh';surfels.root.visible=value==='surfels';session.redraw();sync();record({kind:'generated-glass.representation',value});return read();},
   setMaterial(patch){glass.set(patch);surfels?.set(patch);session.redraw();sync();const effective=read();record({kind:'generated-glass.material',requested:patch,effective});return effective;},
   setReconstruction(enabled){if(!surfels)throw Error('No surfel source');surfels.set({reconstruction:enabled});session.redraw();sync();record({kind:'generated-glass.reconstruction',enabled});return read();},
   inspectSurface({x,y}){return surfels.inspectSurface(x,y);},
  },mount({root,document,invoke}){
   const text=document.createElement('p');text.textContent='TRELLIS supplied color and opacity. Glass mode interprets low opacity as transmission; IOR and thickness are authored. Screen-space refraction sees the opaque scene, not other glass layers.';root.append(text);
   const mode=document.createElement('select');mode.setAttribute('aria-label','Material view');
   for(const [value,label] of [['opaque','Original opaque'],['opacity','Generated opacity (dithered)'],['glass','Glass interpretation']]){const o=document.createElement('option');o.value=value;o.textContent=label;mode.append(o);}root.append(mode);
   const status=document.createElement('p');status.setAttribute('role','status');
   const update=patch=>invoke('setMaterial',patch).catch(e=>{status.textContent=e.message;sync();});
   let representationSelect,reconstruction;
   if(surfels){
    const label=document.createElement('p');label.textContent='Same source: raw-field surfels (bottle-region crop) or finished mesh. No material channels were discarded.';root.append(label);
    representationSelect=document.createElement('select');representationSelect.setAttribute('aria-label','Surface representation');
    for(const [value,text] of [['surfels','Raw-field bottle surfels'],['mesh','Finished mesh']]){const o=document.createElement('option');o.value=value;o.textContent=text;representationSelect.append(o);}
    representationSelect.onchange=()=>invoke('setRepresentation',representationSelect.value).catch(e=>{status.textContent=e.message;});root.append(representationSelect);
    const row=document.createElement('label');reconstruction=document.createElement('input');reconstruction.type='checkbox';reconstruction.setAttribute('aria-label','Reconstruct the nearest wall');reconstruction.onchange=()=>invoke('setReconstruction',reconstruction.checked).catch(e=>{status.textContent=e.message;});row.append(reconstruction,' Reconstruct the nearest wall');root.append(row);
   }
   mode.onchange=()=>update({mode:mode.value});
   const fields={};for(const [key,label,min,max,step] of [['ior','Refractive index',1,2.5,.01],['thickness','Thickness (scene units)',0,1,.01]]){
    const row=document.createElement('label'),input=document.createElement('input');input.type='number';input.min=min;input.max=max;input.step=step;input.setAttribute('aria-label',label);input.onchange=()=>update({[key]:Number(input.value)});row.append(label+' ',input);root.append(row);fields[key]=input;
   }
   for(const [operation,label] of [['frameBottle','Look closely at the bottle'],['frameWhole','Show the whole asset']]){
    const button=document.createElement('button');button.textContent=label;button.onclick=()=>invoke(operation).catch(e=>{status.textContent=e.message;});root.append(button);
   }
   root.append(status);sync=()=>{const s=read();mode.value=s.mode;if(representationSelect)representationSelect.value=representation;if(reconstruction)reconstruction.checked=s.surfels.reconstruction;for(const k of Object.keys(fields))fields[k].value=s[k];};sync();
  },async dispose(){surfels?.dispose();glass.dispose();await session.dispose();}};
 }
};
