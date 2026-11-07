import {loadOpticalSequence} from '../volume-optical-sequence.mjs';
import {createOpticalPreview} from '../volume-optical-preview.mjs';

export default {
 id:'fleshweaver',title:'Future Filament Fleshweaver',
 async create({host,inputs,record}){
  if(!inputs.sequence)throw Error('Choose a retained optical sequence manifest');
  const url=new URL(inputs.sequence,host.controls.document.location.href).href;
  const sequence=await loadOpticalSequence(url);
  const names={native:'Captured reference',single:'Single frame',forward:'Carried from the past',future:'Past and future'};
  let mode=inputs.mode??'future',index=0,view='beauty',playing=false,elapsed=0,gain=inputs.gain??1,sync=()=>{};
  if(!sequence.modes[mode])throw Error('Requested reconstruction unavailable');
  if(Object.values(sequence.modes).some(frames=>frames.some(f=>f.dimensions.some((n,a)=>n!==sequence.frames[0].dimensions[a]))))throw Error('Comparison modes must use the captured reference dimensions');
  const session=await host.scene.open();
  const preview=createOpticalPreview(sequence.modes[mode][0]);preview.setGain(gain);
  let asset;
  try{asset=await session.attach(preview.mesh,{owned:true,metadata:{label:'Recorded flame reconstruction',source:url,type:'experiment'}});}catch(error){preview.dispose();await session.dispose();throw error;}
  const read=()=>({source:url,preset:sequence.manifest.source.presetId,sourceCommit:sequence.manifest.source.commit,objectId:asset.id,mode,frame:index,simulationStep:sequence.frames[index].time,frames:sequence.frames.length,view,playing,gain,route:'retained-optical-sequence; current-frame-emission-extinction; ordinary-shared-scene',reconstruction:sequence.manifest.reconstruction});
  const present=()=>{preview.setFrame(sequence.modes[mode][index]);session.redraw();sync();};
  const setFrame=value=>{if(!Number.isSafeInteger(value)||value<0||value>=sequence.frames.length)throw Error('Recorded frame outside sequence');index=value;present();};
  const frameView=()=>session.setView(inputs.view??{position:[4,2.1,5],target:[0,1.3,0]});frameView();
  const stop=session.onFrame(({deltaSeconds})=>{if(!playing)return;elapsed+=deltaSeconds;const dt=1/(sequence.manifest.playbackFps??30);if(elapsed>=dt){const step=Math.floor(elapsed/dt);elapsed-=step*dt;setFrame((index+step)%sequence.frames.length);}});
  return {read,operations:{
   setFrame(value){playing=false;setFrame(value);record({kind:'fleshweaver.frame',...read()});return read();},
   setMode(value){if(!sequence.modes[value])throw Error('Requested reconstruction unavailable');mode=value;present();record({kind:'fleshweaver.mode',...read()});return read();},
   setView(value){preview.setView(value);view=value;session.redraw();sync();record({kind:'fleshweaver.view',...read()});return read();},
   setPlaying(value){if(typeof value!=='boolean')throw Error('Boolean playback state required');playing=value;elapsed=0;sync();record({kind:'fleshweaver.playback',...read()});return read();},
   setGain(value){preview.setGain(value);gain=value;session.redraw();sync();record({kind:'fleshweaver.gain',...read()});return read();},
   frame(){return frameView();},
  },mount({root,document,invoke}){
   const status=document.createElement('p');status.setAttribute('role','status');
   const modes=document.createElement('select');modes.setAttribute('aria-label','Material reconstruction');for(const [value,label]of Object.entries(names))if(sequence.modes[value]){const o=document.createElement('option');o.value=value;o.textContent=label;modes.append(o);}modes.addEventListener('change',()=>invoke('setMode',modes.value));
   const timeline=document.createElement('input');timeline.type='range';timeline.min=0;timeline.max=sequence.frames.length-1;timeline.step=1;timeline.setAttribute('aria-label','Recorded frame');timeline.addEventListener('input',()=>invoke('setFrame',Number(timeline.value)));
   const play=document.createElement('button');play.type='button';play.addEventListener('click',()=>invoke('setPlaying',!playing));
   const views=document.createElement('select');views.setAttribute('aria-label','Optical material view');for(const [value,label]of [['beauty','Emission with extinction'],['emission','Emission only'],['extinction','Extinction']]){const o=document.createElement('option');o.value=value;o.textContent=label;views.append(o);}views.addEventListener('change',()=>invoke('setView',views.value));
   const exposure=document.createElement('input');exposure.type='number';exposure.min=0;exposure.step='any';exposure.value=gain;exposure.setAttribute('aria-label','Shared comparison gain');exposure.className='transform-input';exposure.addEventListener('change',()=>invoke('setGain',Number(exposure.value)));
   const gainLabel=document.createElement('label');gainLabel.textContent='Shared comparison gain ';gainLabel.append(exposure);host.controls.installNumberDrag({input:exposure,grip:gainLabel,step:.05});
   const frame=document.createElement('button');frame.type='button';frame.textContent='Frame flame';frame.addEventListener('click',()=>invoke('frame'));
   root.append(modes,play,timeline,views,gainLabel,frame,status);
   sync=()=>{modes.value=mode;timeline.value=index;views.value=view;play.textContent=playing?'Pause':'Play';status.textContent=`Recorded source · step ${sequence.frames[index].time} · frame ${index+1}/${sequence.frames.length}. ${sequence.manifest.reconstruction?.label??'Optical material comparison'}.`;};sync();
  },async dispose(){stop();preview.dispose();await session.dispose();}};
 }
};
