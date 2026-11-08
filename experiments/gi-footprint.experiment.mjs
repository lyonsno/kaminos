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
        const policy=document.createElement('select'),fields=document.createElement('select'),reduction=document.createElement('select');
        for(const [value,text] of [['legacy','Current step schedule'],['fixed','Fixed source mip'],['distance','Distance with detail bias']]){const o=document.createElement('option');o.value=value;o.textContent=text;policy.append(o);}
        for(const [value,text] of [['light','Light only · keep current depth and normals'],['all','Depth, light and normals']]){const o=document.createElement('option');o.value=value;o.textContent=text;fields.append(o);}
        for(const [value,text] of [['average','Current average'],['dominant','Dominant compatible surface']]){const o=document.createElement('option');o.value=value;o.textContent=text;reduction.append(o);}
        const row=(text,input)=>{const label=document.createElement('label'),grip=document.createElement('span');grip.textContent=text;label.append(grip,input);root.append(label);return grip;};
        row('Sampling policy ',policy);
        const level=document.createElement('input');Object.assign(level,{type:'number',min:'0',step:'1',className:'transform-input'});level.dataset.footprint='level';
        const bias=document.createElement('input');Object.assign(bias,{type:'number',step:'.1',className:'transform-input'});bias.dataset.footprint='bias';
        const levelGrip=row('Source mip ',level),biasGrip=row('Detail bias · higher is finer ',bias);row('Filtered source fields ',fields);
        row('Pyramid reduction ',reduction);reduction.dataset.footprint='reduction';
        const tolerance=document.createElement('input');Object.assign(tolerance,{type:'number',min:'0',step:'.01',className:'transform-input'});tolerance.dataset.footprint='depthTolerance';
        const angle=document.createElement('input');Object.assign(angle,{type:'number',min:'0',max:'180',step:'1',className:'transform-input'});angle.dataset.footprint='normalAngle';
        const toleranceGrip=row('Relative depth tolerance ',tolerance),angleGrip=row('Normal cone · degrees ',angle);
        policy.dataset.footprint='policy';fields.dataset.footprint='fields';
        const description=document.createElement('p');description.className='small';description.textContent='Use ordinary Rendering controls for steps, slices, GI resolution and filtering. Dominant surface keeps one compatible layer and its position; thin surfaces and their light can disappear. Light-only keeps current blockers. This experiment builds an additional pyramid.';root.append(description);
        const status=document.createElement('p');status.className='small';status.setAttribute('role','status');status.dataset.footprint='status';root.append(status);
        let previous='';
        sync=()=>{
          const state=read(),mip=state.optimizations.mipSampling;
          policy.value=state.mode;fields.value=state.allFields?'all':'light';
          reduction.value=state.reduction;
          if(document.activeElement!==level&&!level.classList.contains('scrubbing'))level.value=String(state.level);
          if(document.activeElement!==bias&&!bias.classList.contains('scrubbing'))bias.value=String(state.detailBias);
          if(document.activeElement!==tolerance&&!tolerance.classList.contains('scrubbing'))tolerance.value=String(state.depthTolerance);
          if(document.activeElement!==angle&&!angle.classList.contains('scrubbing'))angle.value=String(state.normalAngle);
          level.disabled=state.mode!=='fixed';bias.disabled=state.mode!=='distance';
          tolerance.disabled=angle.disabled=state.reduction!=='dominant';
          status.textContent=state.lighting.mode!=='combined'?'Combined GI is inactive.':mip.effective?
            `Source pyramid: ${mip.resolution.join(' × ')} · available mip ${mip.availableMaxLevel}. ${state.mode==='fixed'?`Selected mip ${Math.min(state.level,mip.availableMaxLevel)} · nominal ${2**Math.min(state.level,mip.availableMaxLevel)} × ${2**Math.min(state.level,mip.availableMaxLevel)} source pixels.`:'Footprint varies along each slice.'}`:
            `Source pyramid unverified or unavailable: ${mip.reason??'waiting for rendering'}.`;
          if(mip.effective&&state.reduction==='dominant')status.textContent+=` Surface reduction: ${mip.reduction?.effective??'unverified'}.`;
          previous=JSON.stringify([mip.effective,mip.availableMaxLevel,mip.resolution,state.lighting.mode,mip.reduction?.effective]);
        };
        const change=patch=>invoke('set',patch).catch(error=>{sync();status.textContent=error.message;});
        policy.addEventListener('change',()=>change({mode:policy.value}));fields.addEventListener('change',()=>change({allFields:fields.value==='all'}));
        reduction.addEventListener('change',()=>change({reduction:reduction.value}));
        const numeric=(input,grip,key,step)=>{
          let start=null;
          const begin=()=>{start=read()[key];};
          const update=finish=>{
            if(input.value.trim()!=='')change({[key]:Number(input.value)}).then(()=>{if(finish&&!disposed){input.value=String(read()[key]);if(document.activeElement===input)start=read()[key];}});
            else if(finish){input.value=String(read()[key]);}
          };
          input.addEventListener('focus',begin);
          input.addEventListener('input',()=>update(false));input.addEventListener('change',()=>update(true));
          input.addEventListener('pointercancel',()=>{
            if(start===null||disposed)return;
            const value=start;start=null;input.value=String(value);change({[key]:value});
          });
          const drag=host.controls.installNumberDrag({input,grip,step,onStart:begin,onEnd:()=>{if(document.activeElement!==input)start=null;}});
          input.addEventListener('blur',()=>{if(!disposed){input.value=String(read()[key]);start=null;}});
          return drag;
        };
        drags=[numeric(level,levelGrip,'level',1),numeric(bias,biasGrip,'detailBias',.1),numeric(tolerance,toleranceGrip,'depthTolerance',.01),numeric(angle,angleGrip,'normalAngle',1)];
        stopFrame=session.onFrame(()=>{const s=read(),m=s.optimizations.mipSampling;if(previous!==JSON.stringify([m.effective,m.availableMaxLevel,m.resolution,s.lighting.mode,m.reduction?.effective]))sync();});sync();
      },
      async dispose(){if(disposed)return;disposed=true;stopFrame?.();for(const drag of drags)drag?.dispose?.();control.dispose();
        if(before.mode!=='combined'&&host.rendering.readGI().mode==='combined')host.rendering.gi({...host.rendering.readGI(),mode:before.mode});
        await session.dispose();}
    };
  }
};
