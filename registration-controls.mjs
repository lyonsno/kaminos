// Reusable inspector for any registration-viewer controller; no scene globals.
export function mountRegistrationControls({root,document,invoke,read,retain,controls}) {
 if(!controls?.installNumberDrag)throw Error('Kaminos number-drag controls are required');
 const inputs=[],listeners=[],scrubs=[];
 const el=(tag,text,parent=root)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;};
 const heading=el('h3','Part claims');heading.style.margin='8px 0';
 el('p','Select the analytical carrier and use G / R / S or its gizmo. Cyan axes are authored joints; orange axes are movable manual target guesses.');
 const status=el('p');status.setAttribute('role','status');status.style.whiteSpace='pre-line';
 const call=(name,...args)=>Promise.resolve(invoke(name,...args)).catch(error=>{sync();status.textContent=error.message;});
 function section(title){const d=el('details');d.open=true;el('summary',title,d);return d;}
 function field(parent,label,type,get,set,{min,max,step}={}){
  const row=el('label',null,parent);row.className='field';
  const grip=el('span',label,row);const input=el('input',null,row);input.type=type==='range'?'number':type;input.setAttribute('aria-label',label);if(input.type==='number')input.className='transform-input';
  if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;
  const change=()=>{if(type==='number'&&!input.value.trim())return;set(type==='checkbox'?input.checked:type==='number'||type==='range'?Number(input.value):input.value);};
  input.addEventListener('input',change);inputs.push({input,get,type});
  if(input.type==='number'){input.step='any';scrubs.push(controls.installNumberDrag({input,grip,step:step??.01}));input.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key==='Escape')input.blur();});}
  return input;
 }
 function button(parent,label,fn){const b=el('button',label,parent);b.type='button';b.className='btn';b.addEventListener('click',fn);return b;}
 button(root,'Select analytical carrier',()=>call('selectSource'));button(root,'Select generated arm',()=>call('selectTarget'));
 const visible=section('Layers');
 for(const [key,label]of [['target','Generated return'],['reference','Source ghosts'],['bounds','Source bounds'],['claims','Claim surface'],['wireframe','Ghost wireframe'],['xray','Ghost X-ray']])field(visible,label,'checkbox',s=>s[key],v=>call('configure',{[key]:v}));
 for(const [key,label]of [['targetOpacity','Return opacity'],['referenceOpacity','Ghost opacity'],['claimOpacity','Claim opacity']])field(visible,label,'range',s=>s[key],v=>call('configure',{[key]:v}),{min:0,max:1,step:.01});
 const parts=section('Independent parts');
 for(const id of Object.keys(read().parts)){
  const row=el('div',null,parts);row.style.cssText='display:flex;align-items:center;gap:5px';
  field(row,id,'checkbox',s=>s.parts[id].visible,v=>call('configure',{parts:{[id]:{visible:v}}}));
  field(row,`${id} color`,'color',s=>s.parts[id].color,v=>call('configure',{parts:{[id]:{color:v}}}));
  const b=button(row,'Solo',()=>call('configure',{solo:read().solo===id?null:id}));listeners.push(s=>{b.setAttribute('aria-pressed',String(s.solo===id));});
 }
 button(parts,'Show all',()=>call('configure',{solo:null,parts:Object.fromEntries(Object.keys(read().parts).map(id=>[id,{visible:true}]))}));
 const align=section('Source alignment');
 el('p','The cyan box is the actual source bounds. Move, rotate and scale its selectable carrier in the scene. Bounds fit is only an initial extent match.',align);
 button(align,'Fit bounds',()=>call('fitBounds'));button(align,'Frame comparison',()=>call('frame'));
 const joints=section('Joint correspondence');
 el('p','Select an orange guess, place its center and axis on the generated joint, then use “Snap source joint here” in its inspector. A single match preserves scale and does not solve twist around the axis.',joints);
 for(const joint of read().joints||[]){const b=button(joints,`Place ${joint.label}`,()=>call('selectJoint',joint.id));listeners.push(s=>{const present=s.joints.find(j=>j.id===joint.id)?.available;b.disabled=!present;b.textContent=present?`Place ${joint.label}`:`${joint.label} · unavailable`;});}
 const claims=section('Geometric claim proposal');
 el('p','Each part claims independently by distance to its primitive solids. No forced winner. Every triangle is evaluated at its centroid.',claims);
 field(claims,'Falloff distance','number',s=>s.falloff,v=>call('configure',{falloff:v}),{min:.000001,step:.005});
 field(claims,'Strong threshold','range',s=>s.threshold,v=>call('configure',{threshold:v}),{min:.01,max:1,step:.01});
 const compute=button(claims,'Compute claims',()=>call('compute'));listeners.push(s=>{compute.disabled=s.status==='computing';});
 const select=el('select',null,claims);select.className='select-input';select.setAttribute('aria-label','Claim display');
 for(const [value,text]of [['claims','Selected claims · part colors'],['overlap','Contested · magenta'],['residual','Unclaimed · orange']]){const o=el('option',text,select);o.value=value;}
 select.addEventListener('change',()=>call('configure',{mode:select.value,claims:true}));listeners.push(s=>{select.value=s.mode;});
 el('p','Overlap and residual counts always include every part, even hidden ones.',claims);
 const preview=section('Inspect proposed pieces');
 el('p','Build separate, selectable textured claims. Contested faces belong to every claimant and also appear in magenta at their original location; unclaimed faces stay orange. Move pieces with their native gizmos. Changing the fit or threshold clears this preview. These are uncapped surface proposals, not permanent cuts.',preview);
 const build=button(preview,'Build exploded preview',()=>call('buildPreview'));
 button(preview,'Clear piece preview',()=>call('clearPreview'));
 const pieceButtons=el('div',null,preview);let pieceSignature='';
 listeners.push(s=>{build.disabled=s.status!=='computed';const signature=JSON.stringify(s.preview?.pieces||[]);if(signature!==pieceSignature){pieceSignature=signature;pieceButtons.replaceChildren();for(const p of s.preview?.pieces||[]){const b=button(pieceButtons,`${p.label} · ${p.triangles.toLocaleString()} faces`,()=>call('selectPiece',p.id));b.disabled=!p.available;}}});
 const saves=section('Asset registrations');
 const name=el('input',null,saves);name.type='text';name.className='input';name.value='Arm correspondence';name.setAttribute('aria-label','Registration name');
 const save=button(saves,'Save registration to asset',()=>call('saveRegistration',name.value));
 const saved=el('select',null,saves);saved.className='select-input';saved.setAttribute('aria-label','Saved registration');
 const open=button(saves,'Reopen saved registration',()=>call('savedURL',saved.value).then(url=>{if(url)globalThis.location.assign(url);}));
 const savedStatus=el('p',null,saves);let catalogSignature='';
 listeners.push(s=>{const r=s.registration;save.disabled=!r?.available||s.status.startsWith('unavailable:');const signature=JSON.stringify(r?.entries||[]);if(signature!==catalogSignature){catalogSignature=signature;const chosen=saved.value;saved.replaceChildren();for(const entry of r?.entries||[]){const o=el('option',`${entry.name} · ${entry.createdAt}${entry.compatible?'':' · input changed'}`,saved);o.value=entry.id;o.disabled=!entry.compatible;}if([...saved.children].some(o=>o.value===chosen))saved.value=chosen;else if(r?.lastSaved)saved.value=r.lastSaved.id;}open.disabled=!saved.value;savedStatus.textContent=r?.error?`Storage unavailable: ${r.error}`:r?.lastSaved?`Saved to this asset: ${r.lastSaved.name}`:'Each save keeps a named version beside this asset. Reopening verifies the source and mesh bytes.';});
 const link=el('a','Retain this view as a reopen link');link.style.display='block';link.style.margin='12px 0';
 function sync(){const s=read();for(const {input,get,type}of inputs){if(document.activeElement===input)continue;if(type==='checkbox')input.checked=get(s);else input.value=get(s);}for(const f of listeners)f(s);
  const c=s.summary;status.textContent=`${s.status}${s.status==='computing'?` · ${Math.round(s.progress*100)}%`:''}${c?`\n${c.triangles.toLocaleString()} triangles · ${c.single.toLocaleString()} single\n${c.overlap.toLocaleString()} contested · ${c.unclaimed.toLocaleString()} unclaimed`:''}`;
  const retained=retain();if(retained){link.href=retained;link.textContent='Retain this view as a reopen link';}else{link.removeAttribute('href');link.textContent='Restore source and target before retaining this comparison';}
 }
 link.addEventListener('click',event=>{const retained=retain();if(retained)link.href=retained;else event.preventDefault();});sync();return {sync,dispose:()=>{for(const s of scrubs)s?.stop?.();root.replaceChildren();}};
}
