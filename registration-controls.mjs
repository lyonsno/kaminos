// Reusable inspector for any registration-viewer controller; no scene globals.
export function mountRegistrationControls({root,document,invoke,read,retain}) {
 const inputs=[],listeners=[];
 const el=(tag,text,parent=root)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent.append(n);return n;};
 const heading=el('h3','Part claims');heading.style.margin='8px 0';
 el('p','Known mechanism → generated skin. Align the colored ghosts, then compute independent claims.');
 const status=el('p');status.setAttribute('role','status');status.style.whiteSpace='pre-line';
 const call=(name,...args)=>Promise.resolve(invoke(name,...args)).catch(error=>{sync();status.textContent=error.message;});
 function section(title){const d=el('details');d.open=true;el('summary',title,d);return d;}
 function field(parent,label,type,get,set,{min,max,step}={}){
  const row=el('label',null,parent);row.style.cssText='display:flex;gap:8px;align-items:center;margin:7px 0;justify-content:space-between';
  el('span',label,row);const input=el('input',null,row);input.type=type;input.setAttribute('aria-label',label);input.style.maxWidth=type==='color'?'44px':'110px';
  if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step!==undefined)input.step=step;
  const change=()=>{if(type==='number'&&!input.value.trim())return;set(type==='checkbox'?input.checked:type==='number'||type==='range'?Number(input.value):input.value);};
  input.addEventListener('input',change);inputs.push({input,get,type});return input;
 }
 function button(parent,label,fn){const b=el('button',label,parent);b.type='button';b.addEventListener('click',fn);b.style.margin='3px';return b;}
 const visible=section('Layers');
 for(const [key,label]of [['target','Textured return'],['reference','Source ghosts'],['claims','Claim surface'],['wireframe','Ghost wireframe'],['xray','Ghost X-ray']])field(visible,label,'checkbox',s=>s[key],v=>call('configure',{[key]:v}));
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
 el('p','Bounds fit is only a starting guess. Rotate and translate the source to match the return.',align);
 for(const [key,label]of [['position','Move'],['rotation','Rotate']])for(let i=0;i<3;i++)field(align,`${label} ${'XYZ'[i]}${key==='rotation'?' °':''}`,'number',s=>s.alignment[key][i]*(key==='rotation'?180/Math.PI:1),v=>{const value=[...read().alignment[key]];value[i]=v*(key==='rotation'?Math.PI/180:1);call('configure',{alignment:{[key]:value}});},{step:key==='rotation'?1:.01});
 field(align,'Uniform scale','number',s=>s.alignment.scale,v=>call('configure',{alignment:{scale:v}}),{min:.000001,step:.01});
 button(align,'Fit bounds',()=>call('fitBounds'));button(align,'Frame comparison',()=>call('frame'));
 const claims=section('Geometric claim proposal');
 el('p','Each part claims independently by distance to its primitive solids. No forced winner. Every triangle is evaluated at its centroid.',claims);
 field(claims,'Falloff distance','number',s=>s.falloff,v=>call('configure',{falloff:v}),{min:.000001,step:.005});
 field(claims,'Strong threshold','range',s=>s.threshold,v=>call('configure',{threshold:v}),{min:.01,max:1,step:.01});
 const compute=button(claims,'Compute claims',()=>call('compute'));listeners.push(s=>{compute.disabled=s.status==='computing';});
 const select=el('select',null,claims);select.setAttribute('aria-label','Claim display');
 for(const [value,text]of [['claims','Selected claims · part colors'],['overlap','Contested · magenta'],['residual','Unclaimed · orange']]){const o=el('option',text,select);o.value=value;}
 select.addEventListener('change',()=>call('configure',{mode:select.value,claims:true}));listeners.push(s=>{select.value=s.mode;});
 el('p','Overlap and residual counts always include every part, even hidden ones.',claims);
 const link=el('a','Retain this view as a reopen link');link.style.display='block';link.style.margin='12px 0';
 function sync(){const s=read();for(const {input,get,type}of inputs){if(document.activeElement===input)continue;if(type==='checkbox')input.checked=get(s);else input.value=get(s);}for(const f of listeners)f(s);
  const c=s.summary;status.textContent=`${s.status}${s.status==='computing'?` · ${Math.round(s.progress*100)}%`:''}${c?`\n${c.triangles.toLocaleString()} triangles · ${c.single.toLocaleString()} single\n${c.overlap.toLocaleString()} contested · ${c.unclaimed.toLocaleString()} unclaimed`:''}`;
  link.href=retain();
 }
 link.addEventListener('click',()=>{link.href=retain();});sync();return {sync,dispose:()=>root.replaceChildren()};
}
