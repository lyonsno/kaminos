import {Group,InstancedMesh,BoxGeometry,Matrix4,StorageBufferAttribute,MeshStandardNodeMaterial} from '../lib/three.webgpu.js';
import {storage,wgslFn,instanceIndex,positionLocal,normalLocal,uniform,uint,transformNormalToView} from '../lib/three.tsl.js';
import {createThermalMpm,thermalConfig,PARTICLE_WORDS} from './thermal-jointing/mpm-solver.mjs';

const pointPosition=wgslFn('fn thermal_position(i:u32,p:vec3f,n:f32,data:ptr<storage,array<vec4f>,read>)->vec3f {let j=i*11u;let F=mat3x3f((*data)[j+2u].xyz,(*data)[j+3u].xyz,(*data)[j+4u].xyz);return ((*data)[j].xyz+F*p-vec3f(3.+n*.25,3.,3.+n*.25))*.25;}');
const pointNormal=wgslFn('fn thermal_normal(i:u32,p:vec3f,data:ptr<storage,array<vec4f>,read>)->vec3f {let j=i*11u;let a=(*data)[j+2u].xyz;let b=(*data)[j+3u].xyz;let c=(*data)[j+4u].xyz;return normalize(mat3x3f(cross(b,c),cross(c,a),cross(a,b))*p);}');
const pointColor=wgslFn('fn thermal_color(i:u32,mode:u32,data:ptr<storage,array<vec4f>,read>)->vec3f {let j=i*11u;let T=clamp((*data)[j+1u].w,0.,1.);let d=1.-(*data)[j+8u].x;let H=(*data)[j+8u].y;if(mode==1u){return mix(vec3f(.035,.22,.8),vec3f(1.,.12,.015),T);}if(mode==2u){return mix(vec3f(.08,.35,.4),vec3f(1.,.035,.008),d);}if(mode==3u){return mix(vec3f(.015,.03,.08),vec3f(1.,.5,.015),1.-exp(-H*20.));}return mix(vec3f(.18,.2,.24),vec3f(.065,.075,.09),d);}');
const authored=c=>Object.fromEntries(Object.entries(c).filter(([k])=>!['count','gridSize','gridNodes'].includes(k)));
export default {
 id:'thermal-jointing',title:'Cooling stone — thermal fracture',
 async create({host,inputs={},record,updateInputs}){
  let config=thermalConfig(inputs.material??{}),playing=false,batch=inputs.batch??2,viewMode=inputs.viewMode??1,disposed=false,pending=null,error=null,last=null;
  if(!Number.isSafeInteger(batch)||batch<1)throw Error('Positive integral batch required');
  if(!Number.isInteger(viewMode)||viewMode<0||viewMode>3)throw Error('Unknown thermal display');
  const session=await host.scene.open(),renderer=host.scene.renderer(),device=renderer?.backend?.device;
  if(!device){await session.dispose();throw Error('Thermal stone requires the shared WebGPU renderer');}
  const root=new Group();root.name='Cooling stone — persistent material';root.position.y=host.scene.ground().height;
  let solver,attribute,mesh,asset,status,playButton,debounce,draft={},controls=[],fields=[],stop;
  const mode=uniform(viewMode,'uint');
  const persist=()=>updateInputs?.({material:authored(config),batch,viewMode});
  const release=()=>{solver?.dispose();if(attribute)renderer._attributes.delete(attribute);if(mesh){root.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();mesh.dispose();}solver=null;mesh=null;attribute=null;};
  const create=async()=>{
   attribute=new StorageBufferAttribute(new Float32Array(config.count*PARTICLE_WORDS),4);attribute.name='Thermal persistent material state';
   renderer._attributes.update(attribute,3);const buffer=renderer.backend.get(attribute).buffer;
   solver=await createThermalMpm({device,options:authored(config),particleBuffer:buffer});
   const data=storage(attribute,'vec4',config.count*11).toReadOnly(),material=new MeshStandardNodeMaterial({roughness:.85,metalness:0});
   material.positionNode=pointPosition({i:instanceIndex,p:positionLocal,n:uniform(config.particlesPerAxis),data});
   material.normalNode=transformNormalToView(pointNormal({i:instanceIndex,p:normalLocal,data}));
   material.colorNode=pointColor({i:instanceIndex,mode,data});
   mesh=new InstancedMesh(new BoxGeometry(.49,.49,.49),material,config.count);mesh.name='Thermal material cells';mesh.frustumCulled=false;
   const identity=new Matrix4();for(let i=0;i<config.count;i++)mesh.setMatrixAt(i,identity);
   mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
   last=await solver.status();error=null;session.redraw();
  };
  const read=()=>({...last,...solver?.read(),objectId:asset?.id,playing,pending:!!pending,error,batch,viewMode,
   representation:'GPU-deformed material-point cells; experimental normalized solid, uncalibrated for basalt',
   continuation:'Inputs retain the starting recipe. Downloaded snapshots retain evolved material points; reloading a snapshot is not implemented.',
   view:session.readView()});
  const sync=()=>{
   if(status)status.textContent=error??((pending?'Advancing · ':playing?'Live · ':'Paused · ')+(last?.completedSteps??0)+' material steps · t '+(last?.time??0).toFixed(3)+' normalized · Δt '+config.dt+' per step · '+(last?.splitNodes??0)+' split grid nodes');
   if(playButton)playButton.textContent=playing?'Pause':'Run';
   for(const [field,key,factor] of fields)if(field.ownerDocument.activeElement!==field&&!(key in draft))field.value=String(key==='batch'?batch:config[key]*factor);
  };
  async function advance(steps){
   if(disposed)throw Error('Thermal scene disposed');if(pending)throw Error('Thermal advancement already in progress');if(error)throw Error(error);
   solver.advance(steps);
   const work=solver.status();pending=work;sync();
   try{last=await work;if(last.fault)throw Error(last.fault);return read();}
   catch(e){error=e.message;playing=false;throw e;}
   finally{pending=null;session.redraw();sync();}
  }
  const operations={
   read,frame(){const size=config.particlesPerAxis*.125;return session.setView({position:[size*2,size*1.8+root.position.y,size*2.4],target:[0,size*.5+root.position.y,0]});},
   play(value){if(typeof value!=='boolean')throw Error('Boolean playback required');if(error&&value)throw Error(error);playing=value;sync();session.redraw();return read();},
   advance:({steps=1}={})=>advance(steps),
   async reset(){playing=false;await pending?.catch(()=>{});solver.reset();last=await solver.status();error=null;record({kind:'thermal.reset',effective:read()});sync();session.redraw();return read();},
   async setOptions(patch){
    const next=thermalConfig({...authored(config),...patch});await pending?.catch(()=>{});
    if(disposed)throw Error('Thermal scene disposed');
    if(next.count!==config.count||next.gridSize!==config.gridSize){
     playing=false;release();config=next;await create();operations.frame();
    }else{solver.setOptions(patch);config=next;}
    persist();record({kind:'thermal.material',effective:authored(config)});sync();session.redraw();return read();
   },
   display(value){if(!Number.isInteger(value)||value<0||value>3)throw Error('Unknown thermal display');viewMode=value;mode.value=value;persist();sync();session.redraw();return read();},
   batch(value){if(!Number.isSafeInteger(value)||value<1)throw Error('Positive integral batch required');batch=value;persist();sync();return read();},
   async snapshot(){playing=false;await pending?.catch(()=>{});const work=solver.snapshot();pending=work;sync();try{const result=await work;return {schema:'kaminos.thermal-material.v0',...result,particles:Array.from(result.particles)};}finally{pending=null;sync();}}
  };
  const gpuFault=e=>{error=e.error.message;playing=false;sync();};device.addEventListener('uncapturederror',gpuFault);
  try{
   await create();asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:'thermal:phase-field-mpm.v0',type:'experiment'}});operations.frame();
   stop=session.onFrame(()=>{if(playing&&!pending&&!error&&!disposed)advance(batch).catch(e=>{record({kind:'thermal.fault',error:e.message});});sync();});
  }catch(e){release();device.removeEventListener('uncapturederror',gpuFault);await session.dispose();throw e;}
  return {read,operations,mount({root:panel,document,invoke}){
   const intro=document.createElement('p');intro.textContent='Cool the top of a hot solid. Temperature changes its stress-free size; restraint builds tension and damage. The visible cells follow the simulated material. The outer grid currently stops outward motion at its boundary. Start with Temperature, then inspect Damage and Stone.';panel.append(intro);
   const failed=e=>{error=e.message;playing=false;sync();};
   const button=(title,operation,arg)=>{const b=document.createElement('button');b.textContent=title;b.onclick=()=>invoke(operation,typeof arg==='function'?arg():arg).catch(failed);panel.append(b);return b;};
   playButton=button('Run','play',()=>!playing);button('Advance 20 steps','advance',{steps:20});button('Reset hot solid','reset');button('Frame stone','frame');
   const select=document.createElement('select');select.setAttribute('aria-label','Material view');
   for(const [i,name] of ['Stone','Temperature','Damage','Tensile history'].entries()){const option=document.createElement('option');option.value=i;option.textContent=name;select.append(option);}select.value=viewMode;select.onchange=()=>invoke('display',Number(select.value)).catch(failed);panel.append(select);
   const field=(title,key,step,min,help,factor=1)=>{
    const label=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');grip.textContent=title;
    input.type='number';input.min=String(min);input.step='any';input.className='transform-input';input.setAttribute('aria-label',title);label.append(grip,input);panel.append(label);fields.push([input,key,factor]);
    controls.push(host.controls.installNumberDrag({input,grip,step}));
    grip.title=help;
    input.title=help+' · '+input.title;
    input.setAttribute('aria-description',help);
    input.oninput=()=>{
     if(!input.value.trim()||!input.validity.valid)return;const value=Number(input.value)/factor;if(!Number.isFinite(value))return;
     if(key==='batch'){invoke('batch',value).catch(failed);return;}
     draft[key]=value;clearTimeout(debounce);if(status)status.textContent='Pending material settings…';
     debounce=setTimeout(()=>{const patch=draft;draft={};invoke('setOptions',patch).catch(failed);},140);
    };
   };
   field('Contraction (%)','contraction',.2,0,'Free shortening over the full hot-to-cold temperature range, before restraint.',100);
   field('Surface cooling','cooling',.2,0,'Rate at which the original top layer exchanges heat with the cold environment.');
   field('Heat diffusivity','diffusivity',.05,0,'Rate at which heat spreads between neighboring material points. Very high values exceed the stable timestep.');
   field('Fracture toughness','toughness',.001,.000001,'Resistance to damage from tension. Lower values let damage grow under smaller loads.');
   field('Damage length','length',.025,.000001,'Length over which damage spreads, in mechanical grid cell widths. This sets the width of the damage band.');
   field('Strength variation (%)','variation',1,0,'Amplitude of the spatial variation in fracture resistance.',100);
   field('Damping','damping',.01,0,'Rate of velocity decay per normalized time unit. Higher values settle motion faster.');
   field('Gravity (downward)','gravity',.05,0,'Downward acceleration in normalized model units.');
   field('Phase iterations','phaseIterations',1,1,'Solver iterations for the damage field per material step. More iterations propagate corrections farther without advancing time.');
   field('Steps per batch','batch',1,1,'Steps submitted before the next status update. Lower values return control sooner. See the status line for time per step.');
   field('Block width (points; restarts)','particlesPerAxis',1,4,'Material points along each edge. Point spacing stays fixed, so this grows the block and restarts it.');
   const check=document.createElement('input');check.type='checkbox';check.checked=config.fixedBase;check.onchange=()=>invoke('setOptions',{fixedBase:check.checked}).catch(failed);
   const label=document.createElement('label');label.title='Pin the bottom grid layers in place. This is a restraint on the solid.';check.setAttribute('aria-description',label.title);label.append(check,' Restrain bottom');panel.append(label);
   button('Save material state','snapshot').onclick=()=>invoke('snapshot').then(result=>{const url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='thermal-material.json';a.click();URL.revokeObjectURL(url);}).catch(failed);
   status=document.createElement('p');status.setAttribute('role','status');status.style.cssText='white-space:normal;overflow-wrap:anywhere;min-width:0;max-width:100%;box-sizing:border-box';panel.append(status);sync();
  },async dispose(){disposed=true;playing=false;clearTimeout(debounce);stop?.();for(const c of controls)c?.dispose();await pending?.catch(()=>{});device.removeEventListener('uncapturederror',gpuFault);release();await session.dispose();}};
 }
};
