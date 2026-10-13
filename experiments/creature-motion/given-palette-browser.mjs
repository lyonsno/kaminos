import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {attachGivenPalettePlayback} from './given-palette-playback.mjs';
import {validateGivenMotionSource,givenCanonicalGroundHeight} from './given-motion-source.mjs';

export async function mountGivenPaletteMotion({THREE,runtime,motionUrl,motionSha256,frameUrl,frameSha256,caseSha256,prefixUrl,prefixSha256,canonicalGround=false,mountRoot,document}) {
 const state={status:'loading',phase:'source-authentication',requested:{motionUrl,motionSha256,frameUrl,frameSha256,caseSha256}};
 window.kaminosGivenMotion={snapshot:()=>structuredClone(state)};
 const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
 async function load(url,expected){
  if(typeof url!=='string'||!url.trim()||!/^[a-f0-9]{64}$/i.test(expected??''))throw Error('Explicit retained motion/frame URL and digest required');
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(`Given source HTTP ${response.status}`);
  const bytes=await response.arrayBuffer(),actual=await sha(bytes);if(actual!==expected.toLowerCase()){state.sourceFailure={url,expected,actual,contentType:response.headers.get('content-type')};throw Error(`Given source content digest mismatch: ${url}`);}
  return {value:JSON.parse(new TextDecoder().decode(bytes)),sha256:actual};
 }
 try{
  const motion=await load(motionUrl,motionSha256),frame=await load(frameUrl,frameSha256);
  const prefix=motion.value.continuation?await load(prefixUrl,prefixSha256):null;
  const profile=validateGivenMotionSource({motion:motion.value,prefix:prefix?.value,prefixSha256:prefix?.sha256});
  if(frame.value.schema!=='kaminos.full-given-rig-frame.v1')throw Error('Unverified given bind-frame schema');
  const skin=window.kaminosLiveTransport?.snapshot();
  if(skin?.status!=='loaded'||skin.effectiveSha256!==caseSha256||skin.effectiveRoute!=='index-scene-live-full-tree-transport'||skin.candidatePaintedWeights!==false)throw Error('Actual full-tree skin case differs or is unmounted');
  const targetBones=window.kaminosLiveTransport.manifest.bones;
  if(targetBones.length!==frame.value.bones.length||frame.value.bones.some(b=>{
   const target=targetBones.find(t=>t.name===b.name);
   return !target||target.parent!==b.parent||b.restMatrix.flat().some((v,i)=>Math.abs(v-target.restMatrix.flat()[i])>1e-5);
  }))throw Error('Actual skin bind frame differs from retained given frame');
  state.phase='palette-conversion';const adapter=createGivenPaletteMotion({THREE,motion:motion.value,rigFrame:frame.value});
  const groundReference=canonicalGround?{kind:'canonical-y0',height:givenCanonicalGroundHeight(frame.value),animated:false}:null;
  const source={motionSha256:motion.sha256,frameSha256:frame.sha256,caseSha256,canonicalAssetSha256:frame.value.source.canonicalAssetSha256,
   motionRoute:motion.value.route,...profile,textEncoder:motion.value.textEncoder,groundReference};
  state.phase='live-bone-join';const player=attachGivenPalettePlayback({THREE,runtime,adapter,source,document,mountRoot});
  state.status='mounted';state.phase='paused-source';state.effective=source;
  window.kaminosGivenMotion={read:player.read,snapshot:()=>({...structuredClone(state),playback:player.read(),skin:window.kaminosLiveTransport.snapshot()}),
   play:player.play,pause:player.pause,replay:player.replay,restore:player.restore,seek:player.seek,dispose:player.dispose};
  return player;
 }catch(error){
  state.status='failed';state.error=error.message;
  const alert=document.createElement('p');alert.setAttribute('role','alert');alert.className='given-motion-failure';
  alert.textContent=`Motion did not mount · ${state.phase} · ${state.error}`;
  alert.style.color='#ffaaa0';alert.style.padding='8px';
  mountRoot.prepend?mountRoot.prepend(alert):mountRoot.append(alert);
  throw error;
 }
}
