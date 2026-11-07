import * as THREE from '../lib/three.core.js';
import {MeshStandardNodeMaterial,StorageBufferAttribute,IndirectStorageBufferAttribute} from '../lib/three.webgpu.js';
import {storage,vertexIndex,instanceIndex,Fn,vec4,uint} from '../lib/three.tsl.js';
import {makeVolumeSpecimen,packVolumeBodies,weatherBody} from './hill-terrain/volume-model.mjs';
import {createVolumeGPU} from './hill-terrain/volume-gpu.mjs';

export default {
 id:'hill-volume',title:'Hill · rock and soil volumes',
 async create({host,inputs={},record=()=>{}}){
  let model=makeVolumeSpecimen(inputs.config),solver=null,renderer=null,starting=null,playing=false,disposed=false,error=null,credit=0,advancing=false,generation=0;
  const session=await host.scene.open(),root=new THREE.Group();root.name='Rock and soil volume specimen';
  const settings={rock:7,weatherDepth:.025,growthRate:.025,pushRadius:.55,pushSpeed:1.5,pushX:-.7,pushY:.4,pushZ:1.0,...inputs.settings};
  const floor=new THREE.Mesh(new THREE.BoxGeometry(4.8,.12,4.8),new MeshStandardNodeMaterial({color:0x575f4d,roughness:1}));floor.position.set(0,-.07,.5);floor.receiveShadow=true;root.add(floor);
  let asset,renderObjects=[],attributes=[],nodes=[],status,playButton;
  const read=()=>({id:'hill-volume',objectId:asset?.id,initialized:Boolean(solver),generation,playing,advancing,error,settings:{...settings},source:model.source,weatheredMass:model.weatheredMass,
   gpu:solver?.read()??null,view:session.readView(),continuation:'settings/initial configuration via recipe; evolved state via explicit snapshot',capabilities:{heightfieldInput:false,soilPlasticity:true,reciprocalSoilRock:true,representedJointRelease:true,newFracture:false,ecologicalSuccession:false}});
  const sync=()=>{if(status)status.textContent=error?error:!solver?'Constructing material volume…':`${solver.read().particleCount.toLocaleString()} material samples · ${solver.read().seconds.toFixed(2)} s · ${playing?'running':'paused'}${advancing?' · computing':''}`;if(playButton)playButton.textContent=playing?'Pause':'Play';};
  function releaseDisplay(){for(const m of renderObjects){root.remove(m);m.geometry.dispose();m.material.dispose();}for(const n of nodes)n.dispose();if(renderer)for(const a of attributes)renderer._attributes.delete(a);renderObjects=[];attributes=[];nodes=[];}
  async function initialize(r){
   renderer=r;if(!r.backend?.isWebGPUBackend||!r.backend.device)throw Error('Volume specimen requires native host WebGPU');
   const packed=packVolumeBodies(model.bodies),c=model.config,maxVertices=c.dimensions.map(v=>v-1).reduce((n,v)=>n*v,1)*36;
   const attribute=(n,size=4,indirect=false)=>{const a=indirect?new IndirectStorageBufferAttribute(new Uint32Array(n),size):new StorageBufferAttribute(new Float32Array(n*size),size);attributes.push(a);const node=storage(a,indirect?'uint':'vec4',n);nodes.push(node);const init=Fn(()=>node.element(instanceIndex).assign(indirect?uint(0):vec4(0))).compute(n);nodes.push(init);r.compute(init);return{a,node,raw:r.backend.get(a).buffer};};
   const soilP=attribute(maxVertices),soilN=attribute(maxVertices),rockP=attribute(packed.vertices.length/4),rockN=attribute(packed.vertices.length/4),indirect=attribute(4,1,true);
   const mesh=(p,n,color,label)=>{const geo=new THREE.BufferGeometry();geo.setAttribute('position',p.a);const mat=new MeshStandardNodeMaterial({color,roughness:.95});mat.positionNode=p.node.element(vertexIndex).xyz;mat.normalNode=n.node.element(vertexIndex).xyz;const m=new THREE.Mesh(geo,mat);m.name=label;m.frustumCulled=false;m.castShadow=true;m.receiveShadow=true;root.add(m);renderObjects.push(m);return m;};
   const soil=mesh(soilP,soilN,0x8d7657,'Loose material surface');soil.geometry.setIndirect(indirect.a);
   mesh(rockP,rockN,0xa59a86,'Retained authored rock volumes');
   solver=await createVolumeGPU({device:r.backend.device,model,display:{soilPositions:soilP.raw,soilNormals:soilN.raw,rockPositions:rockP.raw,rockNormals:rockN.raw,indirect:indirect.raw}});
   if(disposed){solver.dispose();solver=null;return;}sync();session.redraw();
  }
  floor.onBeforeRender=r=>{if(disposed||starting||solver||error)return;starting=initialize(r).catch(e=>{error=e.message;playing=false;sync();session.redraw();});};
  try{asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'hill:direct-3d-material-volumes-v1',type:'experiment'}});}catch(e){floor.geometry.dispose();floor.material.dispose();await session.dispose();throw e;}
  const defaultView={position:[4.5,3.1,5.0],target:[0,.55,.45],fov:42};session.setView(inputs.view??defaultView);
  async function requireSolver(){await starting;if(!solver)throw Error(error||'Material source is not mounted');if(disposed)throw Error('Specimen disposed');return solver;}
  async function runSteps(n){const s=await requireSolver();if(advancing)throw Error('A material operation is pending');advancing=true;sync();try{await s.advance(n);session.redraw();}catch(e){error=e.message;playing=false;throw e;}finally{advancing=false;sync();}return read();}
  const stopFrame=session.onFrame(({deltaSeconds})=>{
   if(!playing||!solver||disposed||error)return;credit+=deltaSeconds;
   if(advancing)return;const n=Math.floor(credit/model.config.dt);if(!n)return;credit-=n*model.config.dt;
   runSteps(n).catch(()=>{});
  });
  const operations={
   async setPlaying(value){await requireSolver();playing=Boolean(value);credit=0;sync();session.redraw();record({kind:'hill-volume.play',value:playing});return read();},
   async advance(seconds=.1){if(!Number.isFinite(seconds)||seconds<0)throw Error('Choose nonnegative physical time');playing=false;const result=await runSteps(Math.round(seconds/model.config.dt));record({kind:'hill-volume.advance',seconds,effective:result.gpu});return result;},
   setSettings(patch){for(const [k,v] of Object.entries(patch)){if(!(k in settings)||!Number.isFinite(v))throw Error('Invalid specimen setting '+k);if(['weatherDepth','pushRadius'].includes(k)&&v<=0)throw Error(k+' must be positive');if(k==='rock'&&(!Number.isInteger(v)||!model.bodies[v]))throw Error('Choose an existing rock');}Object.assign(settings,patch);sync();record({kind:'hill-volume.settings',effective:{...settings}});return read();},
   async push(){const s=await requireSolver();if(advancing)await s.done();s.push({center:[settings.pushX,settings.pushY,settings.pushZ],radius:settings.pushRadius,velocity:[settings.pushSpeed,0,0]});record({kind:'hill-volume.impulse',settings:{...settings}});return runSteps(1);},
   async release(){const s=await requireSolver();if(advancing)await s.done();s.release(settings.rock);record({kind:'hill-volume.joint-release',rock:settings.rock});return read();},
   async setGrowth(value){const s=await requireSolver();s.setDrive(value?settings.growthRate:0);record({kind:'hill-volume.growth',rate:value?settings.growthRate:0});return read();},
   async weather(){playing=false;const s=await requireSolver();await s.done();await s.synchronizeModel();const result=weatherBody(model,settings.rock,settings.weatherDepth);s.dispose();solver=null;releaseDisplay();generation++;starting=initialize(renderer).catch(e=>{error=e.message;throw e;});await starting;record({kind:'hill-volume.weather',rock:settings.rock,depth:settings.weatherDepth,...result});sync();return{...read(),weathering:result};},
   async reset(){playing=false;if(solver){await solver.done();solver.dispose();solver=null;}model=makeVolumeSpecimen(inputs.config);releaseDisplay();generation++;credit=0;error=null;starting=initialize(renderer);await starting;record({kind:'hill-volume.reset'});return read();},
   frame(){session.setView(defaultView);session.redraw();return read();},
   async snapshot(){return(await requireSolver()).snapshot();},
   recipe(){return{config:model.config,settings:{...settings},view:session.readView()};},
   gpu(){if(!solver)throw Error('Material source not mounted');return{device:renderer.backend.device,...solver.resources,generation,coordinateSpace:'specimen-local',localToWorld:root.matrixWorld.toArray(),source:read().source};}
  };
  const api={read,...operations};window.kaminosHillVolume=api;
  return{read,operations,
   mount({root:panel,document,invoke}){
    const description=document.createElement('p');description.textContent='3D material specimen · frictional soil, rigid rock and a releasable joint. Start paused; inspect the initial bank, then advance or play.';panel.append(description);
    status=document.createElement('p');status.setAttribute('role','status');panel.append(status);
    const button=(label,op,arg)=>{const b=document.createElement('button');b.textContent=label;b.type='button';b.addEventListener('click',()=>invoke(op,typeof arg==='function'?arg():arg).catch(e=>{error=e.message;sync();}));panel.append(b);return b;};
    playButton=button('Play','setPlaying',()=>!playing);button('Advance 0.1 s','advance',.1);button('Reset specimen','reset');button('Frame specimen','frame');
    const field=(key,label,step)=>{const l=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.value=String(settings[key]);input.setAttribute('aria-label',label);input.addEventListener('input',()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))invoke('setSettings',{[key]:Number(input.value)}).catch(e=>{error=e.message;sync();});});host.controls.installNumberDrag({input,grip,step});l.append(grip,input);panel.append(l);};
    const select=document.createElement('select');select.setAttribute('aria-label','Rock volume');model.bodies.forEach((b,i)=>{const o=document.createElement('option');o.value=i;o.textContent=b.id;select.append(o);});select.value=settings.rock;select.addEventListener('change',()=>invoke('setSettings',{rock:Number(select.value)}));panel.append(select);
    button('Release selected joint','release');field('weatherDepth','Weathering depth',.005);button('Weather selected rock','weather');
    field('pushX','Push center X',.05);field('pushY','Push center Y',.05);field('pushZ','Push center Z',.05);field('pushRadius','Push radius',.05);field('pushSpeed','Push velocity X',.1);button('Push material','push');
    field('growthRate','Growth velocity',.005);const growth=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.setAttribute('aria-label','Prescribed growth');toggle.addEventListener('change',()=>invoke('setGrowth',toggle.checked).catch(e=>{error=e.message;sync();}));growth.append(toggle,document.createTextNode('Prescribed growth'));panel.append(growth);sync();
   },
   async dispose(){disposed=true;playing=false;stopFrame();try{await starting;await solver?.done();}finally{solver?.dispose();releaseDisplay();floor.geometry.dispose();floor.material.dispose();await session.dispose();if(window.kaminosHillVolume===api)delete window.kaminosHillVolume;}}
  };
 }
};
