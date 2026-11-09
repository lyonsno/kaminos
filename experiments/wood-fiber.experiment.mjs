import {Group,Mesh,BoxGeometry} from '../lib/three.webgpu.js';
import {loadWoodMaps,createWoodMaterial} from '../wood-fiber-material.mjs';

export default {id:'wood-fiber',title:'Finished wood · fiber response',async create({host,inputs={},record,updateInputs=()=>{}}){
 const session=await host.scene.open();let resource,program,reference,geometry;
 const drags=[];let sync=()=>{};
 let strength=inputs.fiberStrength??1,roughness=inputs.roughness??.28,fiberSpread=inputs.fiberSpread??1,ior=inputs.ior??1.5;
 const sample=inputs.sample??'cmaple';
 const manifest=inputs.manifest??'/api/read?root=generated-meshes&path=wood-fiber-study-1108%2Fmanifest.json';
 try{
  resource=await loadWoodMaps(manifest,sample);
  program=createWoodMaterial(resource.maps,{fiberStrength:strength,roughness,fiberSpread,ior});
  reference=createWoodMaterial(resource.maps,{fiberStrength:0,roughness});
  const root=new Group();root.name='Measured '+sample+' · fiber comparison';
  geometry=new BoxGeometry(2.6,.12,1.45);geometry.computeTangents();
  for(const [i,p] of [reference,program].entries()){
   const mesh=new Mesh(geometry,p.material);mesh.name=i?'Directional fiber':'Surface only';
   mesh.position.set(0,.2,i ? -.85 : .85);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  const asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:resource.source.sourceUrl??'Cornell2005 measured maps'}});
  const read=()=>({objectId:asset.id,sample,fiberStrength:strength,roughness,fiberSpread,ior,source:resource.source,
   lighting:'native-scene-lights; no experiment-owned light',
   model:'Analytic2005 fiber term + host GGX; direct scene lights; no fiber environment integration',view:session.readView()});
  const setup=()=>{const {azimuth,...retained}=inputs;return {...retained,sample,fiberStrength:strength,roughness,fiberSpread,ior,view:session.readView()};};
  const changed=(kind)=>{session.redraw();sync();updateInputs(setup());const result=read();record({kind:'wood-fiber.'+kind,phase:'applied',effective:result});return result;};
  const operations={
   setFiberStrength(value){program.setFiberStrength(value);strength=value;return changed('strength');},
   setRoughness(value){program.setRoughness(value);reference.setRoughness(value);roughness=value;return changed('roughness');},
   setFiberSpread(value){program.setFiberSpread(value);fiberSpread=value;return changed('spread');},
   setIOR(value){program.setIOR(value);ior=value;return changed('refraction');},
   frame(){session.setView({position:[3.8,3.7,4.5],target:[0,.2,0]});return changed('view');},
  };
  session.setView(inputs.view??{position:[3.8,3.7,4.5],target:[0,.2,0]});
  host.scene.select(asset.id);
  return {read,operations,mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Left: surface shading. Right: surface plus subsurface fiber response. Set Fiber strength to 0 to compare the same right-hand surface. Lighting comes from the normal scene lights; edit or add lights through Kaminos.';panel.append(intro);
   const status=document.createElement('p');status.setAttribute('role','status');
   const sampleLabel=document.createElement('label'),selector=document.createElement('select');sampleLabel.textContent='Measured wood sample ';
   const names={cmaple:'Curly maple',padauk:'Padauk',walnut1:'Walnut 1',walnut2:'Walnut 2'};
   for(const value of resource.source.availableSamples){const option=document.createElement('option');option.value=value;option.textContent=names[value]??value;selector.append(option);}
   selector.value=sample;selector.setAttribute('aria-label','Measured wood sample');
   selector.onchange=()=>{const next=selector.value;record({kind:'wood-fiber.sample',requested:next});document.defaultView.kaminosWorkbenchExperiments.open('wood-fiber',{...setup(),sample:next}).catch(error=>{status.textContent=error.message;});};
   sampleLabel.append(selector);panel.append(sampleLabel);
   const fields=[];
   sync=(force=false)=>{const values={setFiberStrength:strength,setRoughness:roughness,setFiberSpread:fiberSpread,setIOR:ior};for(const {input,op} of fields)if(force||document.activeElement!==input||input.readOnly)input.value=String(values[op]);};
   for(const [label,op,value,step] of [['Fiber strength','setFiberStrength',strength,.05],['Surface roughness','setRoughness',roughness,.01],['Fiber lobe width','setFiberSpread',fiberSpread,.05],['Fiber medium IOR','setIOR',ior,.01]]){
    const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');
    grip.textContent=label+' ';input.type='number';input.step='any';input.value=value;input.className='transform-input';input.setAttribute('aria-label',label);
    input.addEventListener('input',()=>{if(!input.value.trim())return;invoke(op,Number(input.value)).then(()=>status.textContent='').catch(e=>{status.textContent=e.message;sync(true);});});
    input.addEventListener('blur',()=>sync(true));fields.push({input,op});
    drags.push(host.controls.installNumberDrag({input,grip,step}));row.append(grip,input);panel.append(row);
   }
   const maps=document.createElement('p');maps.textContent='Color, fiber direction and fiber color come from measured maps. Width 1 uses the measured highlight width; IOR changes fiber refraction. The surface layer stays GGX. Surface SSR uses Kaminos; the added fiber lobe currently uses direct lights only.';
   const frame=document.createElement('button');frame.textContent='Frame wood comparison';frame.onclick=()=>invoke('frame').catch(e=>status.textContent=e.message);panel.append(maps,frame,status);
  },async dispose(){for(const drag of drags)drag?.dispose?.();await session.dispose();program.dispose();reference.dispose();geometry.dispose();resource.dispose();}};
 }catch(error){await session.dispose();program?.dispose();reference?.dispose();geometry?.dispose();resource?.dispose();throw error;}
}};
