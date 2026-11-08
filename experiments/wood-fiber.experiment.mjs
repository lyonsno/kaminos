import {Group,Mesh,BoxGeometry,DirectionalLight} from '../lib/three.webgpu.js';
import {loadWoodMaps,createWoodMaterial} from '../wood-fiber-material.mjs';

export default {id:'wood-fiber',title:'Finished wood · fiber response',async create({host,inputs={},record}){
 const session=await host.scene.open();let resource,program,reference,geometry;
 const drags=[];let sync=()=>{};
 let strength=inputs.fiberStrength??1,roughness=inputs.roughness??.28,azimuth=inputs.azimuth??-40;
 const sample=inputs.sample??'cmaple';
 const manifest=inputs.manifest??'/api/read?root=generated-meshes&path=wood-fiber-study-1108%2Fmanifest.json';
 try{
  resource=await loadWoodMaps(manifest,sample);
  program=createWoodMaterial(resource.maps,{fiberStrength:strength,roughness});
  reference=createWoodMaterial(resource.maps,{fiberStrength:0,roughness});
  const root=new Group();root.name='Measured '+sample+' · fiber comparison';
  geometry=new BoxGeometry(2.6,.12,1.45);geometry.computeTangents();
  for(const [i,p] of [reference,program].entries()){
   const mesh=new Mesh(geometry,p.material);mesh.name=i?'Directional fiber':'Surface only';
   mesh.position.set(0,.2,i ? -.85 : .85);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
  }
  const asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:resource.source.sourceUrl??'Cornell2005 measured maps'}});
  const light=new DirectionalLight(0xfff4df,2.5);light.name='Wood study light';light.position.set(0,3,3);
  const lightRoot=new Group();lightRoot.name='Wood comparison light';lightRoot.add(light,light.target);
  await session.attach(lightRoot,{owned:true,metadata:{label:lightRoot.name,type:'experiment',source:'fixture:wood-fiber'}});
  const lightAt=()=>{const a=azimuth*Math.PI/180;light.position.set(3*Math.sin(a),2.4,3*Math.cos(a));session.redraw();};lightAt();
  const read=()=>({objectId:asset.id,sample,fiberStrength:strength,roughness,azimuth,source:resource.source,
   model:'Analytic2005 fiber term + host GGX; direct scene lights; no fiber environment integration',view:session.readView()});
  const changed=(kind)=>{session.redraw();sync();const result=read();record({kind:'wood-fiber.'+kind,phase:'applied',effective:result});return result;};
  const operations={
   setFiberStrength(value){program.setFiberStrength(value);strength=value;return changed('strength');},
   setRoughness(value){program.setRoughness(value);reference.setRoughness(value);roughness=value;return changed('roughness');},
   setLightAzimuth(value){if(!Number.isFinite(value))throw Error('Enter a finite light angle');azimuth=value;lightAt();return changed('light');},
   frame(){session.setView({position:[3.8,3.7,4.5],target:[0,.2,0]});return changed('view');},
  };
  session.setView(inputs.view??{position:[3.8,3.7,4.5],target:[0,.2,0]});
  host.scene.select(asset.id);
  return {read,operations,mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Measured '+sample+'. Left: surface shading. Right: surface plus subsurface fiber response. Toggle Fiber strength to compare the same right-hand surface; orbit and move the light to inspect the figure.';panel.append(intro);
   const status=document.createElement('p');status.setAttribute('role','status');
   const fields=[];
   sync=(force=false)=>{const values={setFiberStrength:strength,setRoughness:roughness,setLightAzimuth:azimuth};for(const {input,op} of fields)if(force||document.activeElement!==input||input.readOnly)input.value=String(values[op]);};
   for(const [label,op,value,step] of [['Fiber strength','setFiberStrength',strength,.05],['Surface roughness','setRoughness',roughness,.01],['Light angle','setLightAzimuth',azimuth,1]]){
    const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');
    grip.textContent=label+' ';input.type='number';input.step='any';input.value=value;input.className='transform-input';input.setAttribute('aria-label',label);
    input.addEventListener('input',()=>{if(!input.value.trim())return;invoke(op,Number(input.value)).then(()=>status.textContent='').catch(e=>{status.textContent=e.message;sync(true);});});
    input.addEventListener('blur',()=>sync(true));fields.push({input,op});
    drags.push(host.controls.installNumberDrag({input,grip,step}));row.append(grip,input);panel.append(row);
   }
   const frame=document.createElement('button');frame.textContent='Frame wood comparison';frame.onclick=()=>invoke('frame').catch(e=>status.textContent=e.message);panel.append(frame,status);
  },async dispose(){for(const drag of drags)drag?.dispose?.();await session.dispose();program.dispose();reference.dispose();geometry.dispose();resource.dispose();}};
 }catch(error){await session.dispose();program?.dispose();reference?.dispose();geometry?.dispose();resource?.dispose();throw error;}
}};
