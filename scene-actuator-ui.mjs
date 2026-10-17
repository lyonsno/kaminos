// Shared controls for installing and operating authored length-driven pistons.
export function mountActuatorControls({document,root,api,readObjects,selectedId,pickPoint,cancelPick,installNumberDrag}){
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const section=el('section');section.className='actuator-properties';
 section.append(el('style',`.actuator-properties{display:grid;gap:10px;padding:12px;min-width:0;width:100%;box-sizing:border-box;border-top:1px solid #53606a;font:12px system-ui;color:#dae5e8}.actuator-properties[hidden]{display:none}.actuator-properties h3{margin:0}.actuator-properties label{display:grid;gap:4px;min-width:0}.actuator-properties input,.actuator-properties select,.actuator-properties button{box-sizing:border-box;width:100%;max-width:100%;min-width:0;padding:6px;color:inherit;background:#252c31;border:1px solid #53606a;border-radius:4px}.actuator-properties .actuator-row{display:flex;gap:5px}.actuator-properties .actuator-row>*{flex:1;min-width:0;width:0}.actuator-properties [role=alert]{color:#ffb5a6}.actuator-properties small{color:#a9bcc3}`));
 section.append(el('h3','Piston'));
 const error=el('div');error.setAttribute('role','alert');
 const fail=e=>{error.textContent=e.message;refresh();};
 const call=fn=>{try{error.textContent='';return fn();}catch(e){fail(e);}};
 const select=el('select');select.setAttribute('aria-label','Installed piston');select.addEventListener('change',refresh);section.append(select);
 const state=el('small');section.append(state);
 const fields={};
 const number=(name,label,step,callback)=>{
  const wrap=el('label'),grip=el('span',label),input=el('input');input.type='number';input.step='any';input.setAttribute('aria-label',label);input.dataset.actuator=name;
  input.addEventListener('change',()=>call(()=>{if(!input.value.trim())throw Error('Enter a value');callback(Number(input.value));}));
  wrap.append(grip,input);section.append(wrap);installNumberDrag?.({input,grip,step});fields[name]=input;return input;
 };
 const chosen=()=>select.value||api.read()[0]?.id;
 number('length','Length · hand crank',.005,value=>api.configure(chosen(),{length:value}));
 const stroke=el('input');stroke.type='range';stroke.step='any';stroke.setAttribute('aria-label','Piston hand crank');stroke.dataset.actuator='crank';
 stroke.addEventListener('input',()=>call(()=>api.scrub(chosen(),Number(stroke.value))));
 stroke.addEventListener('change',()=>call(()=>api.finishScrub()));
 stroke.addEventListener('keydown',e=>{if(e.key==='Escape'){api.cancelScrub();e.preventDefault();}});
 section.append(stroke);
 number('min','Short length',.005,value=>api.configure(chosen(),{drive:{min:value}}));
 number('max','Long length',.005,value=>api.configure(chosen(),{drive:{max:value}}));
 number('period','Cycle · seconds',.05,value=>api.configure(chosen(),{drive:{period:value}}));
 number('outward','Outward fraction',.01,value=>api.configure(chosen(),{drive:{outward:value}}));
 const buttons=el('div');buttons.className='actuator-row';
 for(const [label,fn] of [['Run',()=>api.play(chosen())],['Stop',()=>api.pause()],['Detach',()=>api.detach(chosen())]]){const b=el('button',label);b.type='button';b.addEventListener('click',()=>call(fn));buttons.append(b);}section.append(buttons,error);root.append(section);
 let installer=null,draft={axis:[1,0,0]},installRefresh=()=>{};
 function refresh(){
  const rows=api.read(),id=select.value,options=rows.map(r=>[r.id,r.label]);
  if(JSON.stringify(options)!==select.dataset.options){select.replaceChildren(...options.map(([value,text])=>{const o=el('option',text);o.value=value;return o;}));select.value=rows.some(r=>r.id===id)?id:rows[0]?.id||'';select.dataset.options=JSON.stringify(options);}
  const active=selectedId(),matching=rows.find(r=>[r.fixedId,r.followerId,r.barrelId,r.rodId,...r.carried].includes(active));
  section.hidden=!matching;if(matching&&document.activeElement!==select)select.value=matching.id;
  const r=rows.find(r=>r.id===chosen()),live=api.state();
  if(r){const s=live.actuators.find(s=>s.id===r.id);state.textContent=live.error||(!s.available?'Attachment missing · restore the part or detach':live.running===r.id?'Running · kinematic length drive':'Stopped · drag the hand crank');
   const values={length:s.length,...r.drive};for(const [key,input]of Object.entries(fields))if(document.activeElement!==input)input.value=String(values[key]);
   stroke.min=r.drive.min;stroke.max=r.drive.max;if(document.activeElement!==stroke)stroke.value=s.length;
  }
  installRefresh();
 }
 function mountInstaller(panel){
  if(installer)installer.remove();installer=el('section');installer.className='actuator-properties';installer.append(el('h3','Install a piston'),el('small','Choose four rigid parts. Place the two mounting eyes and the boom hinge, then install. Points are world-space; axis is the hinge direction.'));
  const selects={};for(const [key,label]of [['fixedId','Fixed base'],['followerId','Hinged boom'],['barrelId','Piston barrel'],['rodId','Piston rod']]){const wrap=el('label',label),input=el('select');input.setAttribute('aria-label',label);input.addEventListener('change',()=>draft[key]=input.value);selects[key]=input;wrap.append(input);installer.append(wrap);}
  const points={};for(const [key,label]of [['baseMount','Base mounting eye'],['movingMount','Rod mounting eye'],['hinge','Boom hinge']]){
   const wrap=el('div'),button=el('button',`Pick ${label.toLowerCase()}`);button.type='button';button.addEventListener('click',()=>{cancelPick();message.textContent=`Click ${label.toLowerCase()} on a mesh · Escape cancels`;pickPoint(point=>{draft[key]=point;for(let i=0;i<3;i++)points[key][i].value=String(point[i]);message.textContent=`${label} placed`;});});wrap.append(button);
   const row=el('div');row.className='actuator-row';points[key]=[0,1,2].map(i=>{const n=el('input');n.type='number';n.step='any';n.placeholder='XYZ'[i];n.setAttribute('aria-label',`${label} ${'XYZ'[i]}`);n.addEventListener('change',()=>{draft[key]=points[key].map(x=>Number(x.value));});row.append(n);return n;});wrap.append(row);installer.append(wrap);
  }
  const axis=el('label','Hinge axis'),axes=el('select');for(const [text,value]of [['X','1,0,0'],['Y','0,1,0'],['Z','0,0,1']]){const o=el('option',text);o.value=value;axes.append(o);}axes.addEventListener('change',()=>draft.axis=axes.value.split(',').map(Number));axis.append(axes);installer.append(axis);
  const install=el('button','Clip piston into mechanism');install.type='button';install.addEventListener('click',()=>{try{const r=api.install({...draft});message.textContent=`Installed ${r.label}. Select a part for hand crank and drive controls.`;}catch(e){message.textContent=e.message;}});
  const message=el('div');message.setAttribute('role','status');installer.append(install,message);panel.append(installer);
  installRefresh=()=>{const list=readObjects().filter(o=>['glb','procedural-mesh','group'].includes(o.type)),signature=JSON.stringify(list.map(o=>[o.id,o.label]));for(const [key,input]of Object.entries(selects)){if(input.dataset.options===signature)continue;const previous=input.value||draft[key];input.replaceChildren(el('option','Choose a part'),...list.map(o=>{const option=el('option',o.label);option.value=o.id;return option;}));input.firstChild.value='';input.value=list.some(o=>o.id===previous)?previous:'';draft[key]=input.value;input.dataset.options=signature;}};installRefresh();
  return ()=>{cancelPick();installer?.remove();installer=null;installRefresh=()=>{};};
 }
 return {refresh,mountInstaller,dispose(){cancelPick();section.remove();installer?.remove();}};
}
