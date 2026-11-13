import particleExperiment from './optical-particles.experiment.mjs';
import {bindParticleNumber} from '../particle-number-control.mjs';
import {mountLiveParticleLightingControls} from '../particle-lighting-live-controls.mjs';

const BASE={enabled:true,carrierMode:1,capacity:8192,acquisitionMode:1,acquisitionSamples:1,acquisitionEnabled:false,reactionEnabled:false,exchangeEnabled:false,groupingEnabled:false,followFraction:0,stateLife:0,rise:0,expansion:0,flowAlignment:0,projection:1,showRaymarch:false,fillExtinction:0,extinctionView:0,renewalDiagnostics:false,hud:false,depthMode:2,depthSlices:16,depthScale:.5,targetScale:.5,radius:.6,stretch:2,pixelFloor:.5,depthSupport:1};
export default {
 id:'optical-carriers',title:'Flow-deformed optical carriers',
 async create(context){
  const {host,inputs={},record}=context;
  const owner=await particleExperiment.create({...context,inputs:{...inputs,particles:{...BASE,...inputs.particles,carrierMode:1,acquisitionEnabled:false,reactionEnabled:false,exchangeEnabled:false,groupingEnabled:false,followFraction:0,stateLife:0,rise:0,expansion:0,flowAlignment:0,projection:1,showRaymarch:false,fillExtinction:0,extinctionView:0}}});
  const drags=[],binders=[],fields=new Map();let lighting=null,status=null,error=null;
  const session=await host.scene.open();
  function sync(){
   const state=owner.read();lighting?.sync();
   for(const [key,input]of fields){if(host.controls.document.activeElement===input||input.classList.contains('scrubbing'))continue;const value=state.settings[key];if(input.type==='checkbox')input.checked=value;else input.value=String(value);}
   if(status){const c=state.effective.carrier;status.textContent=error??state.lighting.error??(c?`Fine only · ${state.effective.slots.toLocaleString()} slots · ${c.totalBirths.toLocaleString()} births · step ${state.effective.step}${c.coarseOptics==='not represented'?' · World optics not represented':''}`:state.effective.reason??'Waiting for the first simulation step.');}
  }
  const stop=session.onFrame(sync);
  const operations={...owner.operations,setOptions(patch){const next=owner.operations.setOptions(patch);error=null;sync();return next;}};
  return {read:owner.read,operations,
   mount({root,document,invoke}){
    lighting=mountLiveParticleLightingControls({root,document,controls:host.controls,read:()=>owner.read().lighting,update:patch=>invoke('setLighting',patch),retry:()=>invoke('retryLighting')});
    const section=label=>{const title=document.createElement('h3');title.textContent=label;title.style.cssText='font-size:13px;margin:18px 0 8px';root.append(title);};
    const control=(label,key,tooltip,step=1,min=0)=>{
     const row=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');row.className='slider-row';row.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) 7rem;gap:8px;align-items:center;margin:8px 0';grip.textContent=label;input.dataset.carrier=key;input.setAttribute('aria-label',label);input.title=grip.title=tooltip;
     if(typeof owner.read().settings[key]==='boolean'){input.type='checkbox';input.addEventListener('change',()=>invoke('setOptions',{[key]:input.checked}).catch(cause=>{error=cause.message;sync();}));}
     else{input.type='number';input.step='any';input.min=String(min);input.className='transform-input';drags.push(host.controls.installNumberDrag({input,grip,step}));binders.push(bindParticleNumber({input,read:()=>owner.read().settings[key],apply:value=>invoke('setOptions',{[key]:value}),onError:cause=>{error=cause.message;sync();},onAccepted:sync}));}
     fields.set(key,input);row.append(grip,input);root.append(row);
    };
    section('Population');
    control('Capacity','capacity','Fixed retained slots. Changing capacity clears this experiment’s population.',512,1);
    control('Births / reference step','carrierRate','Camera-independent births, uniformly distributed within the admitted emitter support box. Capacity is a rotating pool, not a source-sampling budget.',16);
    control('Lifetime (steps)','carrierLifetime','Hard optical lifetime, evaluated on simulation advancement. Does not edit a paused population or change grid chemistry.',1,.001);
    control('Ease-in (steps)','carrierEaseIn','Smooth optical appearance after birth, evaluated on simulation advancement. Zero gives immediate appearance. Overlapping ease windows multiply.',1);
    control('Ease-out (steps)','carrierEaseOut','Smooth optical fade before retirement, evaluated on simulation advancement. Zero gives immediate removal.',1);
    control('Material refresh (steps)','carrierRefreshEvery','Sample current grid material at each carrier center on this cadence. No independent particle combustion or exchange.',1,1);
    section('Flow Deformation');
    control('Translation','flow','Grid velocity multiplier for center motion, independent of local support deformation. At zero, existing centers hold and new births remain at the emitter.',.05);
    control('Rotation','carrierRotation','Accumulate the rotational part of local grid velocity variation. Zero removes this contribution.',.1);
    control('Stretch and shear','carrierStrain','Accumulate the symmetric part of local velocity variation. Zero removes stretch and shear.',.1);
    control('Shape relaxation','carrierRelaxation','Return deformation toward the original axes per flow time unit. Zero retains deformation until retirement.',.01);
    control('Preserve optical amount','carrierPreserveAmount','Compensate peak emission/extinction for the change in projected support area. Off preserves the peak instead; larger support then adds optical amount.');
    section('Optical Support');
    control('Radius (source cells)','radius','Horizontal standard deviation in material cells.',.05,.00001);
    control('Vertical stretch','stretch','Initial vertical-to-horizontal radius ratio.',.1,.00001);
    control('Emission gain','gain','Optical self-emission multiplier, without changing grid heat.',.1);
    control('Extinction gain','opacity','Optical soot extinction multiplier, without changing grid soot.',.1);
    control('Depth support (cells)','depthSupport','Optical path length represented by each carrier, independent of spatial radius.',.1);
    control('Minimum screen radius','pixelFloor','Projected standard-deviation floor in display pixels; zero removes the floor.',.1);
    control('Target scale','targetScale','Particle accumulation image scale, independent of population size.',.05,.01);
    control('Depth slices','depthSlices','Fractional-source-depth visibility slices. More slices increase depth-field work.',1,1);
    control('Depth field scale','depthScale','XY resolution of the particle visibility field relative to its target.',.05,.01);
    const clear=document.createElement('button');clear.textContent='Clear carriers';clear.addEventListener('click',()=>invoke('reset').then(sync).catch(cause=>{error=cause.message;sync();}));root.append(clear);
    status=document.createElement('p');status.setAttribute('role','status');root.append(status);sync();
   },
   async dispose(){stop();lighting?.dispose();binders.forEach(x=>x?.dispose?.());drags.forEach(x=>x?.dispose?.());await session.dispose();await owner.dispose();record({kind:'optical-carriers.disposed'});}
  };
 }
};
