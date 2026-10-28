import {hingePartPose} from '../hinge-assembly-motion.mjs';

// Source geometry and generated skins share an authored joint, not inferred physics.
export default {
  id:'hinge-assembly',
  title:'Generated hinge · assembled motion',
  async create({host,inputs,record}) {
    if(typeof inputs.manifest!=='string'||!inputs.manifest)throw Error('Choose a retained hinge assembly manifest');
    const response=await fetch(inputs.manifest);if(!response.ok)throw Error(`Hinge manifest HTTP ${response.status}`);
    const manifest=await response.json();
    if(manifest.schema!=='kaminos.known-hinge-assembly.v1'||!manifest.variants?.[inputs.variant??'supplied'])throw Error('Unsupported hinge assembly manifest or variant');
    const variant=inputs.variant??'supplied',session=await host.scene.open(),parts=[];
    let angle=inputs.angle??20,separation=inputs.separation??0,amplitude=inputs.amplitude??45,period=inputs.period??5;
    let playing=false,time=0,stop=()=>{},disposed=false,panel,status,playButton,fields=[];
    const finite=(n,name)=>{if(!Number.isFinite(n))throw Error(`${name} must be finite`);return n;};
    const positive=(n,name)=>{finite(n,name);if(n<=0)throw Error(`${name} must be positive`);return n;};
    finite(angle,'Angle');positive(period,'Period');if(!Number.isFinite(separation)||separation<0||!Number.isFinite(amplitude)||amplitude<0)throw Error('Nonnegative separation and amplitude required');
    try {
      for(const [kind,rows,offset] of [['source',manifest.source,[-1.35,0,0]],['generated',manifest.variants[variant],[1.35,0,0]]]){
        if(!Array.isArray(rows)||rows.length!==3||new Set(rows.map(p=>p.role)).size!==3)throw Error('Assembly requires three distinct retained parts');
        for(const row of rows){
          const pose=hingePartPose({...row,origin:manifest.joint.origin,axis:manifest.joint.axis,angleDegrees:angle,separation,offset});
          const asset=await session.loadAsset({url:row.url,normalize:false,metadata:{label:`${kind==='source'?'REFERENCE':'CORRECTED'} · ${row.role}`,source:row.url}});
          asset.root.position.fromArray(pose.position);asset.root.quaternion.fromArray(pose.quaternion);asset.root.scale.set(1,1,1);
          parts.push({...row,kind,offset,asset});host.scene.refreshPresentation(asset);
        }
      }
      session.setView(inputs.view??{position:[4.6,3.7,-6.2],target:[0,.8,-.25],fov:36});
    }catch(error){await session.dispose();throw error;}
    const read=()=>({variant,manifest:inputs.manifest,source:manifest.provenance,angleDegrees:angle,separation,amplitude,period,playing,time,
      motion:'authored revolute joint; fixed fork and pin; driven rigid hub',
      parts:parts.map(p=>({role:p.role,kind:p.kind,id:p.asset.id,url:p.url,sha256:p.sha256,position:p.asset.root.position.toArray(),quaternion:p.asset.root.quaternion.toArray()})),
      recipe:{manifest:inputs.manifest,variant,angle,separation,amplitude,period,play:false,view:session.readView()}});
    const sync=()=>{if(status)status.textContent=`${playing?'Playing':'Held'} · ${angle.toFixed(1)}° · ${separation===0?'assembled':'separated'} · ${variant} generation`;
      if(playButton)playButton.textContent=playing?'Pause':'Play';for(const f of fields)if(host.controls.document.activeElement!==f.input||f.input.readOnly)f.input.value=String(f.value());};
    const refreshSelection=()=>{
      const selected=globalThis.window?.kaminosSelection?.read();
      const ids=new Set(selected?.memberIds??selected?.ids??[]);if(selected?.activeId)ids.add(selected.activeId);
      for(const p of parts)if(ids.has(p.asset.id))host.scene.refreshPresentation(p.asset);
    };
    const present=()=>{
      if(disposed)throw Error('Hinge experiment is disposed');
      for(const p of parts){const pose=hingePartPose({...p,origin:manifest.joint.origin,axis:manifest.joint.axis,angleDegrees:angle,separation});p.asset.root.position.fromArray(pose.position);p.asset.root.quaternion.fromArray(pose.quaternion);p.asset.root.updateMatrixWorld(true);}
      refreshSelection();session.redraw();sync();
    };
    const pause=()=>{playing=false;stop();stop=()=>{};refreshSelection();sync();return read();};
    const applied=(kind,requested)=>{present();const effective=read();record({kind:`hinge.${kind}`,phase:'applied',requested,effective});return effective;};
    const operations={
      play(){if(playing)return read();playing=true;let origin=angle;time=0;stop=session.onFrame(({deltaSeconds})=>{time+=deltaSeconds;angle=origin+amplitude*Math.sin(time*2*Math.PI/period);present();});sync();return read();},
      pause,
      angle({degrees}){pause();angle=finite(degrees,'Angle');return applied('angle',{degrees});},
      separate({amount}){if(!Number.isFinite(amount)||amount<0)throw Error('Separation must be nonnegative');separation=amount;return applied('separate',{amount});},
      amplitude({degrees}){finite(degrees,'Amplitude');if(degrees<0)throw Error('Amplitude must be nonnegative');amplitude=degrees;return applied('amplitude',{degrees});},
      period({seconds}){period=positive(seconds,'Period');return applied('period',{seconds});},
      recipe(){return read().recipe;},
    };
    present();if(inputs.play===true)operations.play();
    return {read,operations,
      mount({root,document,invoke}){
        panel=document.createElement('section');const title=document.createElement('h3');title.textContent='One joint · three generated bodies';
        const legend=document.createElement('p');legend.textContent='WHITE: analytical reference. METAL: corrected generated parts. Both follow the same hinge angle. Select a part in the Outliner and press F to frame it.';
        status=document.createElement('p');status.setAttribute('role','status');
        const error=document.createElement('p');error.setAttribute('role','alert');
        const call=(name,arg)=>invoke(name,arg).catch(e=>{error.textContent=e.message;sync();});
        playButton=document.createElement('button');playButton.type='button';playButton.onclick=()=>call(playing?'pause':'play');
        panel.append(title,legend,status,playButton,error);
        for(const spec of [
          ['Angle (degrees)',()=>angle,'angle','degrees',1],
          ['Separate parts',()=>separation,'separate','amount',.01],
          ['Swing (degrees)',()=>amplitude,'amplitude','degrees',1],
          ['Cycle (seconds)',()=>period,'period','seconds',.1],
        ]){const [label,value,operation,key,step]=spec,wrap=document.createElement('label'),grip=document.createElement('span'),input=document.createElement('input');
          wrap.style.cssText='display:flex;justify-content:space-between;gap:12px;margin:10px 0';grip.textContent=label;input.type='number';input.step='any';input.className='transform-input';input.style.width='85px';input.setAttribute('aria-label',label);
          input.oninput=()=>{if(input.value.trim()&&Number.isFinite(Number(input.value)))call(operation,{[key]:Number(input.value)});};
          input.onblur=sync;const control=host.controls.installNumberDrag({input,grip,step});wrap.append(grip,input);panel.append(wrap);fields.push({input,value,control});
        }
        const note=document.createElement('p');note.textContent='This is a kinematic assembly check. Generated surface irregularities are retained; mating-face clearance and contact physics are still being evaluated.';panel.append(note);root.append(panel);sync();
      },
      async dispose(){if(disposed)return;disposed=true;stop();for(const f of fields)f.control.dispose();fields=[];panel?.remove();await session.dispose();},
    };
  },
};
