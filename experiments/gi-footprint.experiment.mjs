import {resolveSourceFootprint} from '../scene-gi-footprint.mjs';

export default {
  id:'gi-footprint',title:'GI source footprint',
  async create({host,inputs,record,updateInputs}) {
    const session=await host.scene.open(),before=host.rendering.readGI();
    let control,disposed=false,drags=[],stopFrame;
    try {
      control=host.rendering.openGISourceFootprint();
      control.set(resolveSourceFootprint({mode:'fixed',...inputs}));
      if(before.mode!=='combined')host.rendering.gi({...before,mode:'combined'});
    } catch(error) {control?.dispose();await session.dispose();throw error;}
    const read=()=>({...control.read(),lighting:host.rendering.readGI(),view:session.readView(),
      continuation:'Sampler choices are retained in the experiment URL. Scene geometry, lighting and camera use ordinary scene saving.'});
    let sync=()=>{};
    const set=patch=>{
      if(disposed)throw Error('Source footprint experiment is closed');
      const value=control.set(patch),config=resolveSourceFootprint(value);
      updateInputs(config);session.redraw();sync();record({kind:'gi-source-footprint',phase:'applied',effective:read()});return read();
    };
    return {read,operations:{set},
      mount({root,document,invoke}) {
        const policy=document.createElement('select'),fields=document.createElement('select');
        for(const [value,text] of [['legacy','Current step schedule'],['fixed','Fixed source mip'],['distance','Distance with detail bias']]){const o=document.createElement('option');o.value=value;o.textContent=text;policy.append(o);}
        for(const [value,text] of [['light','Light only · keep current depth and normals'],['all','Depth, light and normals']]){const o=document.createElement('option');o.value=value;o.textContent=text;fields.append(o);}
        const row=(text,input)=>{const label=document.createElement('label'),grip=document.createElement('span');grip.textContent=text;label.append(grip,input);root.append(label);return grip;};
        row('Sampling policy ',policy);
        const level=document.createElement('input');Object.assign(level,{type:'number',min:'0',step:'1',className:'transform-input'});level.dataset.footprint='level';
        const bias=document.createElement('input');Object.assign(bias,{type:'number',step:'.1',className:'transform-input'});bias.dataset.footprint='bias';
        const levelGrip=row('Source mip ',level),biasGrip=row('Detail bias · higher is finer ',bias);row('Filtered source fields ',fields);
        policy.dataset.footprint='policy';fields.dataset.footprint='fields';
        const description=document.createElement('p');description.className='small';description.textContent='Use the ordinary Rendering controls for steps, slices, GI resolution, temporal accumulation and lighting views. Light-only keeps the current blocker representation.';root.append(description);
        const status=document.createElement('p');status.className='small';status.setAttribute('role','status');status.dataset.footprint='status';root.append(status);
        let previous='';
        sync=()=>{
          const state=read(),mip=state.optimizations.mipSampling;
          policy.value=state.mode;fields.value=state.allFields?'all':'light';
          if(document.activeElement!==level&&!level.classList.contains('scrubbing'))level.value=String(state.level);
          if(document.activeElement!==bias&&!bias.classList.contains('scrubbing'))bias.value=String(state.detailBias);
          level.disabled=state.mode!=='fixed';bias.disabled=state.mode!=='distance';
          status.textContent=state.lighting.mode!=='combined'?'Combined GI is inactive.':mip.effective?
            `Source pyramid: ${mip.resolution.join(' × ')} · available mip ${mip.availableMaxLevel}. ${state.mode==='fixed'?`Selected mip ${Math.min(state.level,mip.availableMaxLevel)} · nominal ${2**Math.min(state.level,mip.availableMaxLevel)} × ${2**Math.min(state.level,mip.availableMaxLevel)} source pixels.`:'Footprint varies along each slice.'}`:
            `Source pyramid unverified or unavailable: ${mip.reason??'waiting for rendering'}.`;
          previous=JSON.stringify([mip.effective,mip.availableMaxLevel,mip.resolution,state.lighting.mode]);
        };
        const change=patch=>invoke('set',patch).catch(error=>{sync();status.textContent=error.message;});
        policy.addEventListener('change',()=>change({mode:policy.value}));fields.addEventListener('change',()=>change({allFields:fields.value==='all'}));
        const numeric=(input,grip,key,step)=>{
          let start=null;
          const begin=()=>{start=read()[key];};
          const update=()=>{if(input.value.trim()!=='')change({[key]:Number(input.value)});};
          input.addEventListener('focus',begin);
          input.addEventListener('input',update);input.addEventListener('change',update);
          input.addEventListener('pointercancel',()=>{
            if(start===null||disposed)return;
            const value=start;start=null;input.value=String(value);change({[key]:value});
          });
          return host.controls.installNumberDrag({input,grip,step,onStart:begin,onEnd:()=>{start=null;}});
        };
        drags=[numeric(level,levelGrip,'level',1),numeric(bias,biasGrip,'detailBias',.1)];
        stopFrame=session.onFrame(()=>{const s=read(),m=s.optimizations.mipSampling;if(previous!==JSON.stringify([m.effective,m.availableMaxLevel,m.resolution,s.lighting.mode]))sync();});sync();
      },
      async dispose(){if(disposed)return;disposed=true;stopFrame?.();for(const drag of drags)drag?.dispose?.();control.dispose();
        if(before.mode!=='combined'&&host.rendering.readGI().mode==='combined')host.rendering.gi({...host.rendering.readGI(),mode:before.mode});
        await session.dispose();}
    };
  }
};
