import * as THREE from '../../lib/three.core.js';
import {loadFullBodySources} from './full-body-source.mjs';
import {createFullBodyRuntime} from './full-body-runtime.mjs';
import {createGpuSkinDeformer} from './gpu-skin-deformer.mjs';
import {createGivenPaletteMotion} from './given-palette-motion.mjs';
import {createCreatureArticulation} from './articulation.mjs';

export default {
 id:'marionette/creature-articulation',title:'Creature articulation',
 async create({host,inputs,record}) {
  const data=await loadFullBodySources(inputs),session=await host.scene.open();
  let runtime,asset,disposed=false,refresh=()=>{},cleanupPicking=()=>{},selected=inputs.joint??'forelimb-left-shoulder',restoreGround=()=>{},restoreGizmos=()=>{};
  const root=new THREE.Group();root.name=inputs.label??'Creature · articulation study';
  const state={base:'rest',frame:0};
  try{
   runtime=createFullBodyRuntime({THREE,...data,deformerFactory:createGpuSkinDeformer,rotationSigns:inputs.rotation_signs??'tree-coherent'});root.add(runtime.group);
   if(!runtime.bones.has(selected))selected=[...runtime.bones.keys()][0];
   const adapter=createGivenPaletteMotion({THREE,motion:data.motion,rigFrame:data.frame});
   const lineData=new Float32Array((runtime.bones.size-1)*6),lineGeometry=new THREE.BufferGeometry();lineGeometry.setAttribute('position',new THREE.BufferAttribute(lineData,3));
   const lines=new THREE.LineSegments(lineGeometry,new THREE.LineBasicMaterial({color:0x43d8e9,depthTest:false,transparent:true,opacity:.75}));lines.renderOrder=99;lines.userData.kaminosEditorHelper=true;lines.userData.kaminosEditorOnly=true;runtime.group.add(lines);
   const update=()=>{
    runtime.update();runtime.group.updateMatrixWorld(true);const inverse=runtime.group.matrixWorld.clone().invert();let i=0;
    for(const bone of runtime.bones.values()){
     for(const marker of bone.children.filter(c=>c.userData.kaminosHelperKind==='bones')){marker.material.color.set(bone.name===selected?0xffbe46:0x37d7eb);marker.scale.setScalar(bone.name===selected?1.4:1);}
     if(!bone.parent?.isBone)continue;
     for(const node of [bone.parent,bone]){const p=node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse);lineData.set(p.toArray(),i);i+=3;}
    }
    lineGeometry.attributes.position.needsUpdate=true;lineGeometry.computeBoundingSphere();session.redraw();refresh();
   };
   const model=createCreatureArticulation({THREE,group:runtime.group,bones:runtime.bones,caseSha256:data.source.caseSha256,update});
   const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),new THREE.MeshStandardMaterial({color:0x808080,roughness:.8}));floor.rotation.x=-Math.PI/2;floor.position.y=new THREE.Box3().setFromBufferAttribute(new THREE.BufferAttribute(data.rest,3)).min.y-.04;floor.receiveShadow=true;root.add(floor);
   const document=host.controls.document,visible=document.getElementById('composition-ground-visible'),gizmos=document.getElementById('viewport-show-gizmos');
   if(visible){const previous=visible.checked;visible.checked=false;visible.dispatchEvent(new Event('change'));restoreGround=()=>{if(!visible.checked){visible.checked=previous;visible.dispatchEvent(new Event('change'));}};}
   if(gizmos){const previous=gizmos.checked;gizmos.checked=false;gizmos.dispatchEvent(new Event('change'));restoreGizmos=()=>{if(!gizmos.checked){gizmos.checked=previous;gizmos.dispatchEvent(new Event('change'));}};}
   asset=await session.attach(root,{owned:true,metadata:{label:root.name,type:'experiment',source:inputs.case}});
   const active=()=>{if(disposed||!root.parent)throw Error('Articulation study is no longer mounted');};
   const read=()=>({objectId:asset.id,source:structuredClone(data.source),joint:selected,...model.read(),referenceFloor:{height:floor.position.y,animated:false},reference:{...state,frames:adapter.frames,fps:adapter.fps,prompt:data.motion.prompt},deformation:runtime.read().deformation,view:session.readView(),pose:model.snapshot()});
   const done=(kind,requested)=>{const effective=read();record({kind:'creature.articulation.'+kind,phase:'applied',target:asset.id,requested,effective:{joint:selected,base:effective.base,rotations:effective.rotations,reference:effective.reference}});refresh();return effective;};
   const frame=()=>{
    root.updateMatrixWorld(true);const box=runtime.syncCpuGeometry().boundingBox.clone().applyMatrix4(runtime.group.matrixWorld),center=box.getCenter(new THREE.Vector3()),d=Math.max(...box.getSize(new THREE.Vector3()).toArray());
    session.setView({position:center.clone().add(new THREE.Vector3(d*1.6,d*.4,d*.8)).toArray(),target:center.toArray()});return read();
   };
   const operations={
    select({joint}){active();if(!runtime.bones.has(joint))throw Error('Unknown joint');selected=joint;update();return done('select',{joint});},
    rotate({joint=selected,degrees}){active();model.rotate(joint,degrees);selected=joint;update();return done('rotate',{joint,degrees});},
    resetJoint(){active();model.resetJoint(selected);return done('reset-joint',{joint:selected});},
    resetEdits(){active();model.reset();return done('reset-edits',{});},
    base({kind,frame:sample=state.frame}){active();if(kind==='rest'){model.neutral();state.base='rest';}else if(kind==='motion'){
     const pose=adapter.frame(sample);model.setBase({actor:pose.actorMatrix,bones:pose.bones.map(b=>({name:b.name,matrix:b.localMatrix}))},`Animation frame ${sample+1}`);state.base='motion';state.frame=sample;
    }else throw Error('Unknown pose base');return done('base',{kind,frame:sample});},
    restore(value){active();model.restore(value);state.base='saved';return done('restore',{});},
    snapshot(){active();return {...model.snapshot(),view:session.readView(),joint:selected};},
    inspect(){active();return {...read(),vertices:Array.from(runtime.syncCpuGeometry().attributes.position.array),rootMatrix:runtime.group.matrixWorld.toArray(),boneWorld:[...runtime.bones].map(([name,b])=>({name,matrix:b.matrixWorld.toArray()}))};},
    frame(){active();return frame();},
   };
   update();if(inputs.view)session.setView(inputs.view);else frame();
   if(inputs.pose)operations.restore(inputs.pose);
   return {read,operations,
    mount({root:panel,document,invoke,reopen=recipe=>globalThis.window.kaminosWorkbenchExperiments.open('marionette/creature-articulation',recipe)}) {
     const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
     const style=el('style',`.articulation-study{display:grid;gap:12px;padding:10px 0;color:#d9e2e5;font:12px system-ui}.articulation-study [hidden]{display:none}.articulation-study label{display:grid;gap:5px}.articulation-study select,.articulation-study input{box-sizing:border-box;width:100%;min-width:0;background:#292e32;color:inherit;padding:7px;border:1px solid #536168;border-radius:4px}.articulation-study button{padding:7px;background:#303b41;color:inherit;border:1px solid #56666d;border-radius:4px}.articulation-axes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.articulation-study p{margin:0;line-height:1.45}.articulation-study [role=alert]{color:#ffb7ac;overflow-wrap:anywhere}`);
     const body=el('section');body.className='articulation-study';body.append(style,el('h3','Articulate the creature'),el('p','Click a cyan joint or choose one below. Drag a rotation value; click to type. Rotations follow the joint’s local axes.'));
     const error=el('p');error.setAttribute('role','alert');
     const call=(name,arg)=>invoke(name,arg).then(value=>{error.textContent='';return value;}).catch(e=>{error.textContent=e.message;refresh();});
     const label=(text,input)=>{const l=el('label',text);l.append(input);return l;};
     if(inputs.specimens?.length&&reopen){const select=el('select');select.setAttribute('aria-label','Study specimen');for(const s of inputs.specimens){const o=el('option',s.label);o.value=s.case_sha256+':'+s.motion_sha256;select.append(o);}select.value=inputs.case_sha256+':'+inputs.motion_sha256;select.onchange=()=>{const s=inputs.specimens.find(s=>s.case_sha256+':'+s.motion_sha256===select.value);reopen({...s,specimens:inputs.specimens}).catch(e=>error.textContent=e.message);};body.append(label('Specimen · changing resets this study',select));}
     const joint=el('select');joint.setAttribute('aria-label','Articulation joint');for(const spec of data.manifest.bones){const option=el('option',spec.name.replaceAll('-',' '));option.value=spec.name;joint.append(option);}joint.onchange=()=>call('select',{joint:joint.value});body.append(label('Joint',joint));
     const axes=el('div');axes.className='articulation-axes';const fields=[];
     for(const [i,name]of ['X','Y','Z'].entries()){
      const input=el('input'),grip=el('span',name+' °');input.type='number';input.step='any';input.className='transform-input';input.setAttribute('aria-label','Joint rotation '+name);const l=el('label');l.append(grip,input);axes.append(l);fields.push(input);
      input.oninput=()=>{if(input.value.trim()===''||!Number.isFinite(Number(input.value)))return;const angles=read().joints.find(j=>j.name===selected).degrees;angles[i]=Number(input.value);call('rotate',{joint:selected,degrees:angles});};input.onblur=()=>refresh();host.controls.installNumberDrag({input,grip,step:.5});
     }
     body.append(axes);const row=el('div');row.style.cssText='display:flex;gap:6px';for(const [text,name]of [['Reset joint','resetJoint'],['Reset edits','resetEdits'],['Frame creature','frame']]){const b=el('button',text);b.type='button';b.onclick=()=>call(name);row.append(b);}body.append(row);
     const base=el('select');base.setAttribute('aria-label','Articulation base pose');for(const [value,text]of [['rest','Rest pose'],['motion','Held animation frame']]){const o=el('option',text);o.value=value;base.append(o);}base.onchange=()=>call('base',{kind:base.value,frame:state.frame});body.append(label('Start from',base));
     const sample=el('input'),sampleGrip=el('span','Animation frame');sample.type='number';sample.min='1';sample.max=String(adapter.frames);sample.step='1';sample.setAttribute('aria-label','Articulation animation frame');const sampleLabel=el('label');sampleLabel.append(sampleGrip,sample);sample.oninput=()=>{if(sample.value.trim()&&Number.isInteger(Number(sample.value)))call('base',{kind:'motion',frame:Number(sample.value)-1});};host.controls.installNumberDrag({input:sample,grip:sampleGrip,step:1});body.append(sampleLabel);
     const status=el('p');status.setAttribute('role','status');body.append(status);
     const save=el('button','Save pose');save.type='button';save.onclick=async()=>{try{const pose=await invoke('snapshot'),url=URL.createObjectURL(new Blob([JSON.stringify(pose,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='creature-articulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);}catch(e){error.textContent=e.message;}};
     const open=el('input');open.type='file';open.accept='.json,application/json';open.setAttribute('aria-label','Open articulation pose');open.onchange=async()=>{const f=open.files?.[0];if(!f)return;try{await invoke('restore',JSON.parse(await f.text()));error.textContent='';}catch(e){error.textContent=e.message;}finally{open.value='';}};body.append(save,label('Open saved pose',open),error);panel.append(body);
     refresh=()=>{joint.value=selected;const r=read(),degrees=r.joints.find(j=>j.name===selected).degrees;for(let i=0;i<3;i++)if(document.activeElement!==fields[i]||fields[i].readOnly)fields[i].value=String(Number(degrees[i].toFixed(4)));base.value=state.base==='saved'?'rest':state.base;sampleLabel.hidden=state.base!=='motion';if(document.activeElement!==sample)sample.value=String(state.frame+1);status.textContent=r.base+' · '+Object.keys(r.rotations).length+' edited joints';};
     const canvas=document.getElementById('kaminos-host-renderer-canvas');let down;
     function pick(event){if(!down||event.button!==0||Math.hypot(event.clientX-down.x,event.clientY-down.y)>4)return;const rect=canvas.getBoundingClientRect(),v=session.readView(),camera=new THREE.PerspectiveCamera(v.fov,rect.width/rect.height,v.near,v.far);camera.position.fromArray(v.position);camera.up.fromArray(v.up);camera.zoom=v.zoom;camera.lookAt(new THREE.Vector3().fromArray(v.target));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);let best=null,distance=14;for(const [name,bone]of runtime.bones){const p=bone.getWorldPosition(new THREE.Vector3()).project(camera);if(p.z< -1||p.z>1)continue;const d=Math.hypot(event.clientX-(rect.left+(p.x+1)*rect.width/2),event.clientY-(rect.top+(1-p.y)*rect.height/2));if(d<distance){distance=d;best=name;}}if(best)call('select',{joint:best});}
     const start=e=>{down={x:e.clientX,y:e.clientY};};canvas?.addEventListener('pointerdown',start);canvas?.addEventListener('pointerup',pick);cleanupPicking=()=>{canvas?.removeEventListener('pointerdown',start);canvas?.removeEventListener('pointerup',pick);};refresh();
     return {dispose(){cleanupPicking();refresh=()=>{};body.remove();}};
    },
    async dispose(){disposed=true;restoreGround();restoreGizmos();cleanupPicking();refresh=()=>{};try{await session.dispose();}finally{runtime.dispose();}},
   };
  }catch(e){restoreGround();restoreGizmos();try{await session.dispose();}finally{runtime?.dispose();}throw e;}
 },
};
