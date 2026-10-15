import * as THREE from '../../lib/three.core.js';
import {mountPlaybackControls} from '../../playback-controls.mjs';

const finiteVector=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite);
export function validateSkeletonMotion(m){
 if(m?.status!=='completed'||m.route!=='unimate.text-to-motion.webgpu-local.v0'||m.textEncoder!=='browser T5'||!/^[a-f0-9]{64}$/i.test(m.assetCondSha256??'')||!m.prompt?.trim()||!Number.isInteger(m.seed))throw Error('Completed retained motion source identity required');
 const s=m.skeleton,J=m.joints;
 if(!Number.isInteger(J)||J<1||!Number.isInteger(m.frames)||m.frames<1||!Number.isFinite(s?.fps)||s.fps<=0||!Array.isArray(s.parents)||s.parents.length!==J||!Array.isArray(s.jointNames)||s.jointNames.length!==J||new Set(s.jointNames).size!==J||s.jointNames.some(n=>typeof n!=='string'||!n.trim()))throw Error('Invalid retained skeleton shape');
 if(!finiteVector(m.positions,m.frames*J*3))throw Error('Incomplete or nonfinite retained positions');
 if(s.parents.some((p,j)=>!Number.isInteger(p)||p< -1||p>=J||p===j)||!s.parents.includes(-1))throw Error('Invalid skeleton parent or cycle');
 for(let j=0;j<J;j++){const seen=new Set();for(let p=j;p!==-1;p=s.parents[p]){if(seen.has(p))throw Error('Skeleton parent cycle');seen.add(p);}}
 return m;
}
export function resolveMotionURL(relative,base){
 const url=new URL(base,globalThis.location?.href??'http://localhost/');
 if(url.pathname==='/api/read'&&url.searchParams.has('path')&&!/^(?:[a-z]+:|\/)/i.test(relative)){
  const path=url.searchParams.get('path');url.searchParams.set('path',path.slice(0,path.lastIndexOf('/')+1)+relative);return url.href;
 }
 return new URL(relative,url).href;
}
async function checkedJSON(url,digest,fetchImpl){
 if(typeof url!=='string'||!url.trim()||!/^[a-f0-9]{64}$/i.test(digest??''))throw Error('Explicit source URL and digest required');
 const r=await fetchImpl(url,{cache:'no-store'});if(!r.ok)throw Error('Motion source HTTP '+r.status);
 const b=await r.arrayBuffer(),h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
 if(h!==digest.toLowerCase())throw Error('Motion source digest mismatch');return JSON.parse(new TextDecoder().decode(b));
}
export async function loadSkeletonMotion(spec,{fetchImpl=globalThis.fetch}={}){return validateSkeletonMotion(await checkedJSON(spec.motion,spec.motion_sha256,fetchImpl));}
function label(document,text){
 const canvas=document.createElement('canvas');canvas.width=768;canvas.height=112;const c=canvas.getContext('2d');
 c.fillStyle='#152029';c.fillRect(0,0,768,112);c.fillStyle='white';c.textAlign='center';c.textBaseline='middle';c.font='bold 35px system-ui';c.fillText(text,384,56);
 const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:false}));s.geometry=s.geometry.clone();s.scale.set(1.6,.23,1);s.renderOrder=100;s.userData.kaminosEditorHelper=true;return s;
}
export async function createSkeletonComparison({host,inputs={},record=()=>{}},{fetchImpl=globalThis.fetch,loadMotion=loadSkeletonMotion,makeLabel=label}={}){
 let recipe={kind:'inline'};
 if(inputs.recipe){if(inputs.entries)throw Error('Choose one recipe authority');const url=inputs.recipe;inputs=await checkedJSON(url,inputs.recipe_sha256,fetchImpl);recipe={kind:'authenticated-file',url};inputs={...inputs,entries:inputs.entries?.map(e=>({...e,motion:resolveMotionURL(e.motion,url)}))};}
 const specs=inputs.entries,document=host?.controls?.document;
 if(!host?.scene?.open||!document||!Array.isArray(specs)||!specs.length||specs.some(e=>!e?.id?.trim()||!e.label?.trim())||new Set(specs.map(e=>e.id)).size!==specs.length)throw Error('Explicit uniquely labelled source-motion entries required');
 for(const e of specs){if(e.position!==undefined&&!finiteVector(e.position,3)||e.quaternion!==undefined&&(!finiteVector(e.quaternion,4)||Math.abs(Math.hypot(...e.quaternion)-1)>1e-5)||e.scale!==undefined&&(!finiteVector(e.scale,3)||e.scale.some(x=>x<=0)))throw Error('Invalid source-motion placement');}
 const data=await Promise.all(specs.map(e=>loadMotion(e,{fetchImpl})));data.forEach(validateSkeletonMotion);
 let mode=inputs.presentation??'in-place',seconds=inputs.seconds??0,rate=inputs.rate??1,status=inputs.play===false?'paused':'playing',stop=null,disposed=false,refresh=()=>{};
 if(!['raw','in-place'].includes(mode)||!Number.isFinite(seconds)||seconds<0||!Number.isFinite(rate)||rate<=0||inputs.play!==undefined&&typeof inputs.play!=='boolean')throw Error('Invalid source-motion playback setup');
 const duration=Math.max(...data.map(m=>(m.frames-1)/m.skeleton.fps));if(mode==='raw')seconds=Math.min(seconds,duration);
 const span=Math.max(...data.map(m=>{let lo=Infinity,hi=-Infinity;for(let i=2;i<m.positions.length;i+=3){lo=Math.min(lo,m.positions[i]);hi=Math.max(hi,m.positions[i]);}return Math.max(.5,hi-lo);}));
 let floor=Infinity,top=-Infinity;for(const m of data)for(let i=1;i<m.positions.length;i+=3){floor=Math.min(floor,m.positions[i]);top=Math.max(top,m.positions[i]);}
 const session=await host.scene.open(),rows=[],seats=[],bars=[];
 const unsubscribe=()=>{const s=stop;stop=null;s?.();};
 const active=()=>{if(disposed)throw Error('Source-motion viewer disposed');};
 function apply(){let alive=0;for(const row of rows){if(!row.root.parent){row.removed=true;continue;}alive++;
  const m=row.motion,f=Math.floor(seconds*m.skeleton.fps+1e-6);row.frame=mode==='raw'?Math.min(m.frames-1,f):f%m.frames;
  const p=m.positions,offset=row.frame*m.joints*3,dx=mode==='in-place'?p[offset]-p[0]:0,dz=mode==='in-place'?p[offset+2]-p[2]:0;
  for(let j=0;j<m.joints;j++)row.joints[j].position.set(p[offset+j*3]-dx,p[offset+j*3+1],p[offset+j*3+2]-dz);
  let n=0;for(let j=0;j<m.joints;j++){const parent=m.skeleton.parents[j];if(parent<0)continue;for(const k of [parent,j]){const v=row.joints[k].position;row.line.array.set([v.x,v.y,v.z],n);n+=3;}}row.line.needsUpdate=true;row.edges.geometry.computeBoundingSphere();
 }if(!alive){status='removed';unsubscribe();}session.redraw();refresh();}
 function start(){if(stop||status!=='playing')return;stop=session.onFrame(({deltaSeconds})=>{try{if(!Number.isFinite(deltaSeconds)||deltaSeconds<0)throw Error('Invalid shared clock');seconds+=deltaSeconds*rate;if(mode==='raw'&&seconds>=duration){seconds=duration;status='held';unsubscribe();}apply();}catch(e){status='failed';unsubscribe();record({kind:'skeleton.frame',phase:'failed',error:e.message});}});}
 const read=()=>({status,seconds,rate,presentation:mode,sourceDuration:duration,activeSubscription:Boolean(stop),recipe,view:session.readView(),entries:rows.map(r=>({id:r.removed?null:r.asset.id,key:r.spec.id,label:r.spec.label,frame:r.frame,joints:r.motion.joints,prompt:r.motion.prompt,seed:r.motion.seed,cfgScale:r.motion.cfgScale,route:r.motion.route,motionSha256:r.spec.motion_sha256,assetCondSha256:r.motion.assetCondSha256,root:r.joints[0].position.toArray(),position:r.root.position.toArray(),status:r.removed?'removed':status}))});
 const operations={
  play(){active();if(status==='held')seconds=0;status='playing';start();return read();},pause(){active();status='paused';unsubscribe();refresh();return read();},
  replay(){active();seconds=0;status='playing';apply();start();return read();},
  seek({seconds:value}){active();if(!Number.isFinite(value)||value<0||value>duration)throw Error('Seek outside source duration');unsubscribe();seconds=value;status='paused';apply();return read();},
  step({direction}){if(direction!==1&&direction!==-1)throw Error('Invalid step');return operations.seek({seconds:Math.max(0,Math.min(duration,displayTime()+direction/data[0].skeleton.fps))});},
  rate({rate:value}){active();if(!Number.isFinite(value)||value<=0)throw Error('Invalid rate');rate=value;refresh();return read();},
  presentation({mode:value}){active();if(!['raw','in-place'].includes(value))throw Error('Unknown presentation');mode=value;if(mode==='raw')seconds=Math.min(seconds,duration);apply();return read();},
  frame(){active();const box=new THREE.Box3();for(const row of rows)if(row.root.parent)box.expandByObject(row.root);const c=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),d=Math.max(size.x,size.y,size.z,1);return session.setView({position:[c.x+d*1.5,c.y+d*.65,c.z+d*.18],target:c.toArray()});},
  setup(){active();return {...inputs,entries:rows.filter(r=>!r.removed).map(r=>({...r.spec,position:r.root.position.toArray(),quaternion:r.root.quaternion.toArray(),scale:r.root.scale.toArray()})),seconds,rate,presentation:mode,play:status==='playing',view:session.readView()};},
 };
 function displayTime(){return mode==='raw'?seconds:(Math.floor(seconds*data[0].skeleton.fps+1e-6)%data[0].frames)/data[0].skeleton.fps;}
 async function dispose(){if(disposed)return;disposed=true;unsubscribe();for(const seat of seats)seat.dispose();for(const bar of bars)bar.dispose();await session.dispose();}
 try{
  for(let i=0;i<data.length;i++){
   const m=data[i],root=new THREE.Group(),pose=new THREE.Group(),geo=new THREE.SphereGeometry(.015,8,6),mats=[0xf0bf58,0x55cfe0,0x7ee18e].map(color=>new THREE.MeshBasicMaterial({color}));root.name=specs[i].label;root.position.fromArray(specs[i].position??[0,0,(i-(data.length-1)/2)*span*1.3]);if(specs[i].quaternion)root.quaternion.fromArray(specs[i].quaternion);if(specs[i].scale)root.scale.fromArray(specs[i].scale);pose.position.set(-m.positions[0],-floor,-m.positions[2]);root.add(pose);
   const joints=m.skeleton.jointNames.map(name=>{const c=/arm|hand|finger|clavicle/i.test(name)?1:/thigh|calf|horse|foot|toe/i.test(name)?2:0;const mesh=new THREE.Mesh(geo,mats[c]);pose.add(mesh);return mesh;});
   const line=new THREE.BufferAttribute(new Float32Array(m.skeleton.parents.filter(p=>p>=0).length*6),3),g=new THREE.BufferGeometry();g.setAttribute('position',line);const edges=new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0xf0cb80}));pose.add(edges);
   const tag=makeLabel(document,specs[i].label);if(tag){tag.position.set(0,top-floor+.2,0);root.add(tag);}
   const asset=await session.attach(root,{owned:true,metadata:{label:root.name,source:specs[i].motion,type:'experiment'}});rows.push({spec:specs[i],motion:m,root,pose,joints,line,edges,asset,frame:0,removed:false});host.scene.refreshPresentation?.(asset);
  }
  apply();if(inputs.view)session.setView(inputs.view);else operations.frame();start();
 }catch(e){await dispose();throw e;}
 const observed=Object.fromEntries(Object.entries(operations).map(([name,fn])=>[name,(input)=>{const effective=fn(input);record({kind:'skeleton.'+name,phase:'applied',requested:input??null,effective:name==='setup'?{entries:effective.entries.length}:read()});refresh();return effective;}]));
 return {read,operations:observed,dispose,mount({root:panel,document,invoke}){
  for(const row of rows){const properties=document.createElement('section'),title=document.createElement('h3'),source=document.createElement('p'),select=document.createElement('select'),playback=document.createElement('div');title.textContent=row.spec.label;source.textContent=`${row.motion.prompt} · seed ${row.motion.seed} · ${row.motion.joints} joints · retained source, no skin`;
   for(const [value,text] of [['in-place','Loop in place'],['raw','Raw source once']]){const option=document.createElement('option');option.value=value;option.textContent=text;select.append(option);}select.value=mode;select.setAttribute('aria-label','Source motion presentation');select.onchange=()=>invoke('presentation',{mode:select.value});properties.append(title,source,select);
   const bar=mountPlaybackControls({document,root:playback,label:'Source motion cohort playback',read:()=>({playing:status==='playing',time:displayTime(),duration,stepSeconds:1/data[0].skeleton.fps,rate,busy:row.removed,canSeek:!row.removed}),invoke});bars.push(bar);
   if(host.controls.mountObject)seats.push(host.controls.mountObject({asset:row.asset,properties,playback,onSelected:()=>bar.update()}));else panel.append(properties,playback);
  }refresh=()=>{for(const b of bars)b.update();};refresh();globalThis.window?.selectSceneObject?.(rows[0].asset.id);
 }};
}
export default {id:'marionette/skeleton-motion',title:'Creature · retained skeleton motions',create:createSkeletonComparison};
