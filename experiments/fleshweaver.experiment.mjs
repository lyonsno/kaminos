import {loadOpticalSequence} from '../volume-optical-sequence.mjs';
import {createOpticalPreview} from '../volume-optical-preview.mjs';

export default {
 id:'fleshweaver',title:'Future Filament Fleshweaver',
 async create({host,inputs,record,updateInputs}){
  if(!inputs.sequence)throw Error('Choose a retained optical sequence manifest');
  const url=new URL(inputs.sequence,host.controls.document.location.href).href;
  const sequence=await loadOpticalSequence(url);
  const names={native:'Captured reference',single:'Single frame',forward:'Carried from the past',future:'Past and future'};
  let mode=inputs.mode??'future',index=inputs.frame??0,view=inputs.opticalView??'beauty',playing=false,elapsed=0,gain=inputs.gain??1,sync=()=>{};
  if(!sequence.modes[mode])throw Error('Requested reconstruction unavailable');
  if(!Number.isSafeInteger(index)||index<0||index>=sequence.frames.length)throw Error('Recorded frame outside sequence');
  if(!['beauty','emission','extinction'].includes(view)||!Number.isFinite(gain)||gain<0)throw Error('Valid optical view and nonnegative gain required');
  if(Object.values(sequence.modes).some(frames=>frames.some(f=>f.dimensions.some((n,a)=>n!==sequence.frames[0].dimensions[a]))))throw Error('Comparison modes must use the captured reference dimensions');
  const session=await host.scene.open();
  const preview=createOpticalPreview(sequence.modes[mode][index]);preview.setGain(gain);preview.setView(view);
  let asset;
  try{asset=await session.attach(preview.mesh,{owned:true,metadata:{label:'Recorded flame reconstruction',source:url,type:'experiment'}});}catch(error){preview.dispose();await session.dispose();throw error;}
  const meanError=name=>{const rows=sequence.manifest.reconstructions?.[name];return rows?.every(r=>Number.isFinite(r.mse))?rows.reduce((s,r)=>s+r.mse,0)/rows.length:null;};
  const errors={single:meanError('single'),forward:meanError('forward'),future:meanError('future')};
  const read=()=>({source:url,preset:sequence.manifest.source.presetId,sourceCommit:sequence.manifest.source.commit,sourceDirty:sequence.manifest.source.dirty??null,sourceFiles:sequence.manifest.source.files??null,objectId:asset.id,mode,frame:index,simulationStep:sequence.frames[index].time,frames:sequence.frames.length,view,playing,gain,route:'retained-optical-sequence; current-frame-emission-extinction; ordinary-shared-scene',reconstruction:sequence.manifest.reconstruction,meanReferenceFieldError:errors});
  const present=()=>{preview.setFrame(sequence.modes[mode][index]);session.redraw();sync();};
  const remember=()=>updateInputs({...inputs,mode,frame:index,opticalView:view,gain});
  const setFrame=value=>{if(!Number.isSafeInteger(value)||value<0||value>=sequence.frames.length)throw Error('Recorded frame outside sequence');index=value;present();};
  const frameView=()=>session.setView(inputs.view??{position:[4,2.1,5],target:[0,1.3,0]});frameView();
  const stop=session.onFrame(({deltaSeconds})=>{if(!playing)return;elapsed+=deltaSeconds;const dt=1/(sequence.manifest.playbackFps??30);if(elapsed>=dt){const step=Math.floor(elapsed/dt);elapsed-=step*dt;setFrame((index+step)%sequence.frames.length);}});
  return {read,operations:{
   setFrame(value){playing=false;setFrame(value);remember();record({kind:'fleshweaver.frame',...read()});return read();},
   setMode(value){if(!sequence.modes[value])throw Error('Requested reconstruction unavailable');mode=value;present();remember();record({kind:'fleshweaver.mode',...read()});return read();},
   setView(value){preview.setView(value);view=value;session.redraw();sync();remember();record({kind:'fleshweaver.view',...read()});return read();},
   setPlaying(value){if(typeof value!=='boolean')throw Error('Boolean playback state required');playing=value;elapsed=0;sync();record({kind:'fleshweaver.playback',...read()});return read();},
   setGain(value){preview.setGain(value);gain=value;session.redraw();sync();remember();record({kind:'fleshweaver.gain',...read()});return read();},
   frame(){return frameView();},
  },mount({root,document,invoke}){
   const status=document.createElement('p');status.setAttribute('role','status');
   const act=(name,value)=>invoke(name,value).catch(error=>{sync();status.textContent=error.message;});
   const modes=document.createElement('select');modes.setAttribute('aria-label','Material reconstruction');for(const [value,label]of Object.entries(names))if(sequence.modes[value]){const o=document.createElement('option');o.value=value;o.textContent=label;modes.append(o);}modes.addEventListener('change',()=>act('setMode',modes.value));
   const timeline=document.createElement('input');timeline.type='range';timeline.min=0;timeline.max=sequence.frames.length-1;timeline.step=1;timeline.setAttribute('aria-label','Recorded frame');timeline.addEventListener('input',()=>act('setFrame',Number(timeline.value)));
   const play=document.createElement('button');play.type='button';play.addEventListener('click',()=>act('setPlaying',!playing));
   const views=document.createElement('select');views.setAttribute('aria-label','Optical material view');for(const [value,label]of [['beauty','Emission with extinction'],['emission','Emission only'],['extinction','Extinction']]){const o=document.createElement('option');o.value=value;o.textContent=label;views.append(o);}views.addEventListener('change',()=>act('setView',views.value));
   const exposure=document.createElement('input');exposure.type='number';exposure.min=0;exposure.step='any';exposure.value=gain;exposure.setAttribute('aria-label','Shared comparison gain');exposure.className='transform-input';
   const gainInput=event=>{if(exposure.value!==''&&exposure.validity.valid)return act('setGain',Number(exposure.value));if(event.type==='change'){sync();status.textContent='Enter a finite comparison gain of zero or greater.';}};
   exposure.addEventListener('input',gainInput);exposure.addEventListener('change',gainInput);
   exposure.addEventListener('blur',()=>queueMicrotask(()=>sync()));
   const gainLabel=document.createElement('label');gainLabel.textContent='Shared comparison gain ';gainLabel.append(exposure);host.controls.installNumberDrag({input:exposure,grip:gainLabel,step:.05});
   const frame=document.createElement('button');frame.type='button';frame.textContent='Frame flame';frame.addEventListener('click',()=>act('frame'));
   root.append(modes,play,timeline,views,gainLabel,frame,status);
   sync=()=>{modes.value=mode;timeline.value=index;views.value=view;play.textContent=playing?'Pause':'Play';if(document.activeElement!==exposure||exposure.readOnly)exposure.value=String(gain);const ratio=errors.single>0&&errors[mode]!==null&&errors[mode]!==undefined?` Native-field error: ${(errors[mode]/errors.single).toFixed(2)}× single-frame.`:'';status.textContent=`Recorded source · step ${sequence.frames[index].time} · frame ${index+1}/${sequence.frames.length}. ${sequence.manifest.reconstruction?.label??'Optical material comparison'}.${ratio}`;};sync();
  },async dispose(){stop();preview.dispose();await session.dispose();}};
 }
};
