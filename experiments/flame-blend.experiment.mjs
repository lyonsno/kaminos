import {createFlameBlend,BLEND_GROUPS} from '../flame-blend.mjs';

export default {
  id:'flame-blend',title:'Flame blend',
  async create({host,inputs,record}) {
    if(!host.flame?.open)throw Error('Flame authoring host is unavailable');
    const flame=await host.flame.open();
    if(!flame.beginPreview||!flame.readBasin||!flame.initialize)throw Error('This host does not support flame endpoint blending');
    const scene=await host.scene.open();
    let sync=()=>{},stop=()=>{},alive=true;
    const blend=createFlameBlend({flame,onFrame:scene.onFrame,record,changed:()=>sync()});
    try{if(Object.keys(inputs).length)blend.operations.restore(inputs);}catch(error){blend.dispose();await scene.dispose();throw error;}
    return {
      read:blend.read,operations:{...blend.operations,frame:flame.frame,select:flame.select,listBasins:flame.listBasins},
      async mount({root,document,invoke}) {
        const el=(tag,text,className)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(className)node.className=className;return node;};
        const style=el('style');style.textContent=`
          .flame-blend-cockpit {display:grid;gap:8px;padding:4px 0;font-size:12px;}
          .flame-blend-cockpit [hidden] {display:none!important;}
          .flame-blend-cockpit p {margin:0;color:var(--muted,#aaa);line-height:1.5;}
          .flame-blend-endpoint {display:grid;gap:4px;padding:6px;border:1px solid #ffffff20;border-radius:6px;}
          .flame-blend-cockpit select {width:100%;min-width:0;}
          .flame-blend-actions {display:flex;gap:6px;flex-wrap:wrap;align-items:center;}
          .flame-blend-cockpit input[type=range] {width:100%;}
          .flame-blend-cockpit input[type=number] {width:70px;}
          .flame-blend-cockpit details {border-top:1px solid #ffffff18;padding-top:8px;}
          .flame-blend-fields {display:grid;gap:6px;padding:8px 0 4px 12px;}
          .flame-blend-fields label {display:flex;gap:6px;align-items:center;}
          .flame-blend-cockpit summary {cursor:pointer;}
          .flame-blend-status {min-height:2.5em;line-height:1.4;color:var(--muted,#bbb);}
        `;
        const panel=el('div',null,'flame-blend-cockpit');panel.dataset.flameBlend='true';root.append(style,panel);
        panel.append(el('p','Author in Properties. Capture A and B, then choose what moves together.'));
        const status=el('div',null,'flame-blend-status');status.setAttribute('role','status');
        let message='',lastChoices='';
        const failed=error=>{message=error.message;sync();};
        const run=(name,value)=>{message='';return invoke(name,value).catch(failed);};
        const button=(text,name,value)=>{const b=el('button',text,'btn');b.type='button';b.addEventListener('click',()=>run(name,value));return b;};
        const endpointLabels={},endpointSelects={},endpointCurrent={},editing=[];
        for(const name of ['a','b']) {
          const box=el('section',null,'flame-blend-endpoint');
          const label=el('strong',name.toUpperCase()+' · Choose or capture a look');endpointLabels[name]=label;
          const select=el('select');select.setAttribute('aria-label','Endpoint '+name.toUpperCase()+' preset');
          const placeholder=el('option','Choose saved preset');placeholder.value='';select.append(placeholder);endpointSelects[name]=select;
          const captured=el('option');captured.value='@current';captured.hidden=true;select.append(captured);endpointCurrent[name]=captured;
          select.addEventListener('change',()=>{if(select.value&&select.value!=='@current')run('choose',{slot:name,presetId:select.value});});
          const capture=button('Capture scene as '+name.toUpperCase(),'capture',name);editing.push(select,capture);
          box.append(label,select,capture);panel.append(box);
        }
        const useA=button('Add flame from A','useA');panel.append(useA);editing.push(useA);
        const author=el('div',null,'flame-blend-actions');author.append(button('Edit emitter','select','emitter'),button('Edit material & flow','select','domain'),button('Frame flame','frame'));panel.append(author);
        const blendLabel=el('label','A → B');
        const amount=el('input');amount.type='range';amount.min='0';amount.max='1';amount.step='any';amount.setAttribute('aria-label','Blend A to B');
        const progress=el('output');blendLabel.append(' ',progress,amount);panel.append(blendLabel);
        let dragging=false;
        amount.addEventListener('pointerdown',()=>{dragging=true;run('begin');});
        amount.addEventListener('input',()=>run('preview',Number(amount.value)));
        amount.addEventListener('change',()=>{dragging=false;run('finish');});
        amount.addEventListener('pointercancel',()=>{dragging=false;run('cancel');});
        amount.addEventListener('blur',()=>{if(blend.read().previewing&&!blend.read().playing){dragging=false;run('finish');}});
        amount.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dragging=false;run('cancel');}});
        const actions=el('div',null,'flame-blend-actions');
        const play=button('Play to B','play'),pause=button('Pause','pause'),cancel=button('Cancel blend','cancel');
        const durationLabel=el('label','Seconds '),duration=el('input');duration.type='number';duration.step='any';duration.min='0';duration.setAttribute('aria-label','Blend duration in seconds');duration.className='transform-input';
        duration.addEventListener('change',()=>run('setDuration',Number(duration.value)));durationLabel.append(duration);
        host.controls.installNumberDrag({input:duration,grip:durationLabel,step:.1});editing.push(duration);
        actions.append(play,pause,cancel,durationLabel);panel.insertBefore(blendLabel,panel.children[1]);panel.insertBefore(actions,panel.children[2]);
        const fields=el('div');panel.append(fields);
        panel.append(el('p','Checked parameters travel between A and B. Unchecked values, modes and grid settings stay at their scene values.'));
        const files=el('div',null,'flame-blend-actions');
        const save=el('button','Save blend…','btn');save.type='button';
        save.addEventListener('click',async()=>{try{const value=await invoke('export');const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const link=el('a');link.href=url;link.download='flame-blend.json';link.click();URL.revokeObjectURL(url);}catch(error){failed(error);}});
        const file=el('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
        file.addEventListener('change',async()=>{try{if(file.files[0])await invoke('restore',JSON.parse(await file.files[0].text()));message='Endpoints loaded. Drag the blend or press Play to apply.';sync();}catch(error){failed(error);}finally{file.value='';}});
        const open=el('button','Open blend…','btn');open.type='button';open.addEventListener('click',()=>file.click());files.append(save,open,file);editing.push(open);panel.append(files,status);
        sync=()=>{
          if(!alive)return;
          const state=blend.read(),busy=state.previewing||state.loading;
          for(const name of ['a','b']){
            const endpoint=state[name];endpointLabels[name].textContent=name.toUpperCase()+' · '+(endpoint?.label||'Choose or capture a look');
            endpointCurrent[name].hidden=!endpoint;endpointCurrent[name].textContent=endpoint?.label||'';endpointSelects[name].value=endpoint?'@current':'';
          }
          for(const node of editing)node.disabled=busy;
          useA.hidden=state.active||state.present;useA.disabled=busy||!state.a?.settings.source?.presetId;
          amount.disabled=!state.active||!state.fields.length||!state.a||!state.b||state.playing||state.loading;
          if(!dragging)amount.value=String(state.amount);progress.textContent=Math.round(state.amount*100)+'%';
          if(document.activeElement!==duration)duration.value=String(state.duration);
          play.disabled=busy||amount.disabled;pause.disabled=!state.playing;cancel.disabled=!state.previewing;
          save.disabled=!state.a||!state.b||!state.fields.length;
          const signature=JSON.stringify([state.choices,state.fields,busy]);
          if(signature!==lastChoices){
            const expanded=new Set([...fields.querySelectorAll('details[open]')].map(node=>node.dataset.group));fields.replaceChildren();
            for(const group of BLEND_GROUPS){
              const choices=state.choices.filter(f=>f.group===group.name&&f.available);if(!choices.length)continue;
              const section=el('details');section.dataset.group=group.name;section.open=expanded.has(group.name);
              const summary=el('summary'),check=el('input');check.type='checkbox';check.setAttribute('aria-label','Blend '+group.name);check.disabled=busy;
              const count=choices.filter(f=>state.fields.includes(f.id)).length;check.checked=count===choices.length;check.indeterminate=count>0&&count<choices.length;
              check.addEventListener('click',event=>event.stopPropagation());
              check.addEventListener('change',()=>run('setFields',[...state.fields.filter(id=>!choices.some(f=>f.id===id)),...(check.checked?choices.map(f=>f.id):[])]));
              summary.append(check,' '+group.name+' · '+count+'/'+choices.length);section.append(summary);
              const list=el('div',null,'flame-blend-fields');
              for(const choice of choices){const row=el('label'),input=el('input');input.type='checkbox';input.checked=state.fields.includes(choice.id);input.disabled=busy;input.setAttribute('aria-label','Blend '+choice.label);input.addEventListener('change',()=>run('setFields',input.checked?[...state.fields,choice.id]:state.fields.filter(id=>id!==choice.id)));row.append(input,choice.label);list.append(row);}
              section.append(list);fields.append(section);
            }
            lastChoices=signature;
          }
          status.textContent=message||state.error||(state.loading?'Loading endpoint…':!state.active?(state.present?'Enable the existing flame in Properties to blend.':'Choose A, then add its flame to the scene.'):!state.a||!state.b?'Capture or choose both endpoints.':state.playing?'Blending · flame simulation remains live':state.previewing?'Release to keep this blend; Escape cancels.':state.fields.length+' parameters linked · edit endpoint looks in Properties');
        };
        stop=flame.subscribe(sync);sync();
        try {const index=await flame.listBasins();if(!alive)return;
          for(const select of Object.values(endpointSelects))for(const entry of index.entries){const option=el('option',entry.label);option.value=entry.presetId;select.append(option);}
        }catch(error){failed(error);}
      },
      async dispose(){alive=false;stop();blend.dispose();await scene.dispose();},
    };
  },
};
