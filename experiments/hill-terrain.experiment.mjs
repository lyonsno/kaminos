import * as THREE from '../lib/three.core.js';
import {createTerrainGPU} from './hill-terrain/gpu.mjs';
import {registerExportGeometrySnapshot} from '../scene-export-geometry.mjs';
import {terrainConfig} from './hill-terrain/model.mjs';

export default {
 id:'hill-terrain',title:'Hill · living terrain',
 async create({host,inputs,record,updateInputs=()=>{}}){
  const config=terrainConfig(inputs),n=config.resolution,geometry=new THREE.BufferGeometry(),indices=new Uint32Array((n-1)**2*6);
  for(let z=0,k=0;z<n-1;z++)for(let x=0;x<n-1;x++){const a=z*n+x;indices.set([a,a+n,a+1,a+1,a+n,a+n+1],k);k+=6;}
  geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.boundingBox=new THREE.Box3(new THREE.Vector3(-config.width/2,0,-config.length/2),new THREE.Vector3(config.width/2,3,config.length/2));geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new THREE.Sphere());
  const gpu=createTerrainGPU(geometry,config),root=new THREE.Group();root.name='Hill · generated landscape';
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,side:THREE.DoubleSide}));mesh.name='Living terrain';mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.kaminosDynamicGeometry=true;
  // CPU triangles do not describe the evolving GPU surface. Native scene-row
  // selection remains available; no stale raycast/export geometry is asserted.
  mesh.raycast=()=>{};mesh.boundingBox=geometry.boundingBox;
  registerExportGeometrySnapshot(mesh,()=>{throw Error('GPU terrain export requires an explicit frozen snapshot; recipe export preserves initial conditions only');});root.add(mesh);
  let session,asset,unsubscribe,disposed=false,playing=false,prepared=false,pending=0,error=null,sync=()=>{},preparing=false;
  const prepareSteps=inputs.prepareSteps??60;
  if(!Number.isSafeInteger(prepareSteps)||prepareSteps<0)throw Error('Nonnegative whole preparation steps required');
  const frame=()=>session.setView(inputs.view??{position:[11,10,14],target:[0,.7,0],fov:43});
  const read=()=>({...gpu.read(),simulator:{kind:'terrain',initialConditions:'seeded-connected-ridges',evolution:'conservative-loose-material-transport-with-prescribed-uplift',presentation:'gpu-interpolated-heightfield',preparation:'separate-from-play-time'},objectId:asset?.id,playing,prepared,pendingSeconds:pending,clockPolicy:'fixed-20hz; all-elapsed-ticks-consumed; fractional-time-retained',error:error??gpu.read().error,view:session?.readView()});
  const changed=(kind,fn)=>(value)=>{if(disposed)throw Error('Hill experiment disposed');const result=fn(value);session?.redraw();sync();updateInputs({...gpu.read().config,prepareSteps});record({kind:'hill-terrain.'+kind,effective:read()});return result??read();};
  mesh.onBeforeRender=renderer=>{if(disposed||error)return;try{gpu.flush(renderer);if(!prepared&&!preparing){preparing=true;if(prepareSteps)gpu.advance(prepareSteps,{preparation:true});gpu.present(1);gpu.flush(renderer);prepared=true;preparing=false;sync();}}catch(e){error=e.message;playing=false;sync();}};
  try{
   session=await host.scene.open();asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:{route:gpu.read().route},simulator:'terrain'}});frame();
   unsubscribe=session.onFrame(({deltaSeconds})=>{if(disposed||!playing||!prepared||error)return;try{if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid host frame time');pending+=deltaSeconds;const steps=Math.floor((pending+1e-10)/.05);if(steps){gpu.advance(steps);pending=Math.max(0,pending-steps*.05);}gpu.present(Math.min(1,pending/.05));session.redraw();}catch(e){error=e.message;playing=false;sync();}});session.redraw();
  }catch(e){gpu.dispose();if(session)await session.dispose();else{geometry.dispose();mesh.material.dispose();}throw e;}
  const diagnostic={read,gpu:()=>{root.updateWorldMatrix(true,false);return{...gpu.surface(),localToWorld:Array.from(root.matrixWorld.elements)};},snapshot:()=>gpu.snapshot()};
  if(globalThis.window)window.kaminosHillTerrain=diagnostic;
  return{read,operations:{
   play:changed('play',value=>{if(typeof value!=='boolean')throw Error('Boolean playback required');playing=value;}),
   advance:changed('advance',count=>{gpu.advance(count??1);gpu.present(1);}),
   prepare:changed('prepare',count=>{gpu.advance(count??20,{preparation:true});gpu.present(1);}),
   regenerate:changed('regenerate',patch=>{gpu.regenerate(patch??{});gpu.present(1);pending=0;prepared=false;}),
   setMaterial:changed('material',patch=>gpu.configure(patch)),
   frame:changed('frame',frame),
   recipe:()=>({schema:'kaminos.hill-terrain.recipe.v1',inputs:{...gpu.read().config,prepareSteps},state:'initial-conditions; evolved GPU state is not serialized'})
  },
  mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Generate a landscape, let its slopes settle, then grow the ridge. Loose ground moves downhill and remains where it gathers.';panel.append(intro);
   const status=document.createElement('div');status.setAttribute('role','status');const fields=new Map();let timer,pendingInitial={};
   const failed=e=>{status.textContent=e.message;};
   const numeric=(key,title,step,operation)=>{const line=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=title+' ';input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label',title);line.append(grip,input);panel.append(line);fields.set(key,input);input.addEventListener('input',()=>{if(!input.value.trim()||!Number.isFinite(Number(input.value)))return;const value=Number(input.value);if(operation==='regenerate'){clearTimeout(timer);status.textContent='Preparing new landscape…';pendingInitial[key]=value;timer=setTimeout(()=>{const patch=pendingInitial;pendingInitial={};invoke(operation,patch).catch(failed);},180);}else invoke(operation,{[key]:value}).catch(failed);});input.addEventListener('blur',()=>sync());host.controls.installNumberDrag({input,grip,step});};
   numeric('seed','Landscape seed',1,'regenerate');numeric('soil','Loose ground depth',.02,'regenerate');numeric('repose','Resting slope · degrees',1,'setMaterial');numeric('transport','Settling rate',.1,'setMaterial');numeric('uplift','Uplift · units / second',.005,'setMaterial');
   const line=document.createElement('label'),layout=document.createElement('select');layout.setAttribute('aria-label','Landscape structure');for(const [value,title]of [['basin','Branching basin'],['saddle','Low saddle']]){const option=document.createElement('option');option.value=value;option.textContent=title;layout.append(option);}layout.addEventListener('change',()=>invoke('regenerate',{layout:layout.value}).catch(failed));line.append('Landscape structure ',layout);panel.append(line);
   const play=document.createElement('button');play.textContent='Run terrain';play.onclick=()=>invoke('play',!playing).catch(failed);panel.append(play);
   for(const [label,op,value]of [['Settle further','prepare',40],['Regenerate','regenerate',{}],['Frame landscape','frame',undefined]]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>invoke(op,value).catch(failed);panel.append(b);}
   const help=document.createElement('p');help.textContent='Set uplift to zero to watch existing slopes settle. Regenerate rebuilds the starting landscape. Select the terrain through the native scene list; exact surface picking is not available yet.';panel.append(help,status);
   sync=()=>{const s=read();for(const [key,input]of fields)if(document.activeElement!==input||input.readOnly)input.value=String(s.config[key]);layout.value=s.config.layout;play.textContent=playing?'Pause terrain':'Run terrain';status.textContent=s.error??(s.prepared?'Landscape prepared · '+s.representation.samples.toLocaleString()+' surface samples':'Preparing landscape…');};sync();
   const previousDispose=this._panelCleanup;this._panelCleanup=()=>{clearTimeout(timer);previousDispose?.();};
  },
  async dispose(){if(disposed)return;disposed=true;this._panelCleanup?.();unsubscribe?.();sync=()=>{};gpu.dispose();await session.dispose();if(globalThis.window?.kaminosHillTerrain===diagnostic)delete window.kaminosHillTerrain;}
  };
 }
};
