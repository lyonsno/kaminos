import * as THREE from '../../lib/three.core.js';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGpuSkinDeformer} from './gpu-skin-deformer.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {loadRigCastSources} from './rig-cast-source.mjs';
import {mountPlaybackControls} from '../../playback-controls.mjs';

export default {
 id:'mushfinger/rig-cast-comparison',title:'Rig-generated creatures · matched motion',
 async create({host,inputs,record=()=>{}}){
  const response=await fetch(inputs.setup,{cache:'no-store'});if(!response.ok)throw Error('Rig-cast setup HTTP '+response.status);
  const bytes=await response.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==inputs.setup_sha256)throw Error('Rig-cast setup digest mismatch');
  const setup=JSON.parse(new TextDecoder().decode(bytes));
  if(setup.casts?.length!==2||new Set(setup.casts.map(c=>c.slug)).size!==2)throw Error('Both selected cast inputs required');
  if(setup.casts.some(c=>c.motion_sha256!==setup.casts[0].motion_sha256||c.frame_sha256!==setup.casts[0].frame_sha256))throw Error('Comparison requires the same motion and generating frame');
  const session=await host.scene.open(),document=host.controls.document,actors=[];
  let clock=0,rate=1,stop=null,controls=null,disposed=false,restoreGround=()=>{};
  const instruments=document.createElement('div');
  const view=setup.view??{position:[-1,2,17],target:[-1,-.4,0]};
  const unsubscribe=()=>{stop?.();stop=null;};
  const read=()=>({kind:'matched-rig-generated-cast-comparison',sourceRevision:setup.sourceCommit,setupSha256:digest,rate,view:session.readView(),
   actors:actors.map(a=>({slug:a.input.slug,label:a.input.label,objectId:a.asset.id,source:a.data.source,skin:a.runtime.read(),playback:a.player.read(),visible:a.placement.visible})),
   motionDerivation:'Original base28 source unchanged; eight extra toe descendants keep local rest offsets. Not a generated36-joint motion.',registration:'Each saved source registration retained; no per-cast refit or neutralization'});
  const refresh=()=>controls?.update();
  const start=()=>{if(stop)return;stop=session.onFrame(({deltaSeconds})=>{
   clock+=deltaSeconds*1000*rate;for(const a of actors)a.player.tick(clock);refresh();
   if(!actors.some(a=>a.player.read().status==='playing'))unsubscribe();
  });};
  const active=()=>{if(disposed)throw Error('Rig-cast comparison is disposed');};
  const apply=(name,fn)=>input=>{
   active();const done=result=>{refresh();session.redraw();record({kind:'rig-cast.'+name,phase:'applied',requested:input??null});return result??read();};
   const failed=error=>{record({kind:'rig-cast.'+name,phase:'failed',requested:input??null,error:error.message});throw error;};
   try{const result=fn(input);return result?.then?result.then(done,failed):done(result);}catch(error){return failed(error);}
  };
  const operations={
   play:apply('play',()=>{for(const a of actors)a.player.play();start();}),
   pause:apply('pause',()=>{unsubscribe();for(const a of actors)a.player.pause();}),
   replay:apply('replay',()=>{unsubscribe();for(const a of actors)a.player.replay();start();}),
   seek:apply('seek',input=>{
    const fps=actors[0].data.adapter.fps,frames=actors[0].data.adapter.frames;
    const frame=input?.frame??Math.round(input?.seconds*fps);
    if(!Number.isInteger(frame)||frame<0||frame>=frames)throw Error('Frame outside matched retained clip');
    unsubscribe();for(const a of actors)a.player.seek(frame);
   }),
   step:apply('step',input=>{if(![-1,1].includes(input?.direction))throw Error('Step direction must be -1 or1');const p=actors[0].player.read();return operations.seek({frame:Math.max(0,Math.min(p.frames-1,p.frame+input.direction))});}),
   rate:apply('rate',input=>{if(!Number.isFinite(input?.rate)||input.rate<=0)throw Error('Positive playback rate required');rate=input.rate;}),
   rest:apply('rest',()=>{unsubscribe();for(const a of actors)a.player.restore();}),
   frame:apply('frame',()=>session.setView(view)),
   visible:apply('visible',input=>{const a=actors.find(a=>a.input.slug===input?.slug);if(!a||typeof input.visible!=='boolean')throw Error('Explicit cast visibility required');a.placement.visible=input.visible;a.guide.visible=input.visible;}),
   inspect:apply('inspect',async input=>{
    const a=actors.find(a=>a.input.slug===input?.slug);if(!a)throw Error('Unknown inspected cast');
    return {slug:a.input.slug,objectId:a.asset.id,source:a.data.source,playback:a.player.read(),geometry:await a.runtime.readGpuGeometry()};
   }),
  };
  async function dispose(){if(disposed)return;disposed=true;unsubscribe();controls?.dispose();for(const a of actors){a.player?.dispose();a.runtime.dispose();a.guide?.dispose();}restoreGround();await session.dispose();}
  try{
   for(const [index,input] of setup.casts.entries()){
    const data=await loadRigCastSources(input,{THREE}),runtime=createFullBodyRuntime({THREE,...data,deformerFactory:createGpuSkinDeformer});
    const placement=new THREE.Group();placement.name=input.label;placement.position.x=index?3.1:-3.1;placement.rotation.y=Math.PI/2;placement.add(runtime.group);
    const actor={input,data,runtime,placement,asset:null,player:null,guide:null};actors.push(actor);
    const asset=await session.attach(placement,{owned:true,metadata:{label:input.label,fileName:input.label,source:input.case}});
    actor.asset=asset;
    const player=attachGivenPalettePlayback({THREE,runtime,adapter:data.adapter,source:data.source,document,mountRoot:instruments,mountControls:false,now:()=>clock,dirty:()=>session.redraw()});
    actor.player=player;
    const guide=new THREE.SkeletonHelper(runtime.group);guide.name=input.label+' · generating rig';
    Object.assign(guide.userData,{kaminosEditorHelper:true,kaminosEditorOnly:true,kaminosHelperKind:'bones'});
    actor.guide=guide;await session.attach(guide,{owned:true,metadata:{label:guide.name,fileName:guide.name,source:input.frame}});
   }
   const ground=document.getElementById('composition-ground-visible');
   if(ground){const previous=ground.checked;ground.checked=false;ground.dispatchEvent(new Event('change'));restoreGround=()=>{if(!ground.checked){ground.checked=previous;ground.dispatchEvent(new Event('change'));}};}
   session.setView(view);operations.seek({frame:setup.sample??0});
   return {read,operations,dispose,
    mount({root,document,invoke}){
     const heading=document.createElement('h3');heading.textContent='Two generated bodies · one retained clip';
     const note=document.createElement('p');note.textContent='Left: '+setup.casts[0].label+'. Right: '+setup.casts[1].label+'. Both preserve the saved fit. Extra toe descendants follow their parents; no new gait or paint.';
     const frame=document.createElement('button');frame.textContent='Frame both creatures';frame.onclick=()=>invoke('frame');
     const rest=document.createElement('button');rest.textContent='Generating rest pose';rest.onclick=()=>invoke('rest');
     root.append(heading,note,frame,rest);
     for(const a of actors){const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=true;toggle.onchange=()=>invoke('visible',{slug:a.input.slug,visible:toggle.checked});label.textContent='Show '+a.input.label;label.append(toggle);root.append(label);}
     const playbackRoot=document.createElement('div');root.append(playbackRoot);
     const style=document.createElement('style');style.textContent='.rig-cast-playback .playback-controls{grid-template-columns:1fr;grid-template-rows:auto;gap:8px}.rig-cast-playback .playback-timeline{grid-row:2}.rig-cast-playback .playback-options{grid-row:3}';playbackRoot.className='rig-cast-playback';playbackRoot.append(style);
     controls=mountPlaybackControls({document,root:playbackRoot,label:'Matched clip · both generated casts',
      read(){const p=actors[0].player.read();return {playing:p.status==='playing',time:p.time??0,duration:(p.frames-1)/p.fps,stepSeconds:1/p.fps,rate};},invoke});
     return {dispose(){controls?.dispose();controls=null;}};
    }};
  }catch(error){await dispose();throw error;}
 }
};
