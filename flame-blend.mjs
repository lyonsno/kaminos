import {FLAME_PROPERTY_GROUPS} from './flame-authoring.mjs';

export const BLEND_GROUPS = FLAME_PROPERTY_GROUPS.filter(group => group.view !== 'quality');
const discrete = new Set(['volume-wavelet-octaves','volume-emitter-aperture-count','volume-emitter-aperture-seed','volume-immersed-back-wall','volume-fixed-source-dephase']);
export const blendFields = BLEND_GROUPS.flatMap(group => group.fields.filter(([id])=>!discrete.has(id)).map(([id,label])=>({id,label,group:group.name})));
const axes = ['domControls','rendererControls','presentationControls'];
export function descriptor(settings,id) { return axes.map(axis=>settings?.[axis]?.[id]).find(Boolean); }
export function blendChoices(a,b,current) {
  return blendFields.map(field=>{
    const values=[a,b,current].map(state=>descriptor(state,field.id));
    const continuous=values.every(d=>d && typeof d.value==='number' && Number.isFinite(d.value) && d.type!=='checkbox' && d.type!=='select');
    return {...field,available:continuous};
  });
}
export function blendSettings({a,b,current,fields,amount}) {
  if(!Number.isFinite(amount)||amount<0||amount>1)throw Error('Blend amount must be between 0 and 1');
  if(!Array.isArray(fields)||!fields.length)throw Error('Choose at least one continuous parameter');
  const choices=new Map(blendChoices(a,b,current).map(field=>[field.id,field]));
  const next=structuredClone(current);
  for(const id of fields) {
    if(!choices.get(id)?.available)throw Error('Unknown or unavailable continuous parameter: '+id);
    const start=descriptor(a,id).value,end=descriptor(b,id).value;
    let value=start+(end-start)*amount;
    if(id==='volume-wind-angle') {
      const delta=((end-start+540)%360)-180;
      value=((start+delta*amount+540)%360)-180;
    }
    if(amount===0)value=start;
    if(amount===1)value=end;
    const d=descriptor(next,id);d.value=value;d.rawValue=String(value);
  }
  return next;
}

// The endpoints are authored settings; the evolving fluid belongs to the host.
export function createFlameBlend({flame,onFrame,record=()=>{},changed=()=>{}}) {
  let a=null,b=null,fields=[],amount=0,duration=4,gesture=null,playback=null,disposed=false,loading=false,error=null;
  const lifetime=new AbortController();
  const settings=()=>flame.settings ? flame.settings() : flame.read().settings;
  const current=()=>({a,b,fields,amount,duration});
  const read=()=>({...structuredClone(current()),active:flame.read().active,present:flame.read().present===true,playing:!!playback,previewing:!!gesture,loading,error,
    choices:blendChoices(a?.settings,b?.settings,settings())});
  const available=()=>{if(disposed)throw Error('Flame blend is disposed');};
  const editable=()=>{available();if(gesture||loading)throw Error('Finish the current blend or preset load first');};
  const slot=name=>{if(!['a','b'].includes(name))throw Error('Choose endpoint a or b');return name;};
  const refreshFields=()=>{
    const choices=blendChoices(a?.settings,b?.settings,settings()).filter(f=>f.available);
    if(!fields.length)fields=choices.filter(f=>['Emission & image','Soot','Flow response'].includes(f.group)).map(f=>f.id);
    else fields=fields.filter(id=>choices.some(f=>f.id===id));
  };
  const emit=kind=>record({kind:'flame-blend.'+kind,phase:'applied',effective:structuredClone(current())});
  const end=(cancel=false)=>{
    playback=null;
    if(gesture){const owned=gesture;gesture=null;if(cancel){owned.transaction.cancel();amount=owned.beforeAmount;}else owned.transaction.commit();}
    changed();
  };
  const begin=()=>{
    available();if(loading)throw Error('Wait for the preset load');if(gesture)return;
    if(!flame.read().active)throw Error('Add a flame to the scene first');
    blendSettings({a:a?.settings,b:b?.settings,current:settings(),fields,amount});
    gesture={transaction:flame.beginPreview('Blend flame endpoints'),beforeAmount:amount};
  };
  const preview=value=>{
    begin();
    try {
      gesture.transaction.update(blendSettings({a:a?.settings,b:b?.settings,current:settings(),fields,amount:value}));
      amount=value;error=null;changed();
    }catch(failure){error=failure.message;end(true);throw failure;}
  };
  const stopFrames=onFrame(({deltaSeconds})=>{
    if(!playback)return;
    if(!gesture?.transaction.active()){playback=null;gesture=null;changed();return;}
    try {
      playback.elapsed+=deltaSeconds;
      const fraction=Math.min(1,playback.elapsed/duration),smooth=fraction*fraction*(3-2*fraction);
      preview(playback.start+(1-playback.start)*smooth);
      if(fraction===1){end();emit('completed');}
    }catch(failure){error=failure.message;changed();}
  });
  function restore(recipe) {
    editable();
    if(recipe?.schema!=='kaminos-flame-blend-v1')throw Error('Not a flame blend file');
    if(!Number.isFinite(recipe.duration)||recipe.duration<=0)throw Error('Duration must be positive');
    if(!Array.isArray(recipe.fields))throw Error('Blend fields must be an array');
    for(const endpoint of [recipe.a,recipe.b])if(!endpoint?.settings||typeof endpoint.label!=='string')throw Error('Both endpoints need settings and labels');
    // Validate against the current host before accepting the recipe. Loading
    // endpoints does not apply their values to the live scene.
    blendSettings({a:recipe.a.settings,b:recipe.b.settings,current:settings(),fields:recipe.fields,amount:0});
    a=structuredClone(recipe.a);b=structuredClone(recipe.b);fields=[...recipe.fields];duration=recipe.duration;amount=0;changed();return read();
  }
  const operations={
    capture(name){editable();slot(name);if(!flame.read().active)throw Error('Add a flame to the scene first');
      const endpoint={label:'Captured scene '+name.toUpperCase(),settings:settings()};if(name==='a')a=endpoint;else b=endpoint;refreshFields();emit('capture');changed();return read();},
    async choose({slot:name,presetId}){editable();slot(name);loading=true;changed();
      try{const next=await flame.readBasin(presetId);if(disposed)throw Error('Flame blend was closed during preset load');
        const endpoint={label:next.source?.label||presetId,settings:next};if(name==='a')a=endpoint;else b=endpoint;refreshFields();emit('endpoint');return read();
      }finally{loading=false;changed();}},
    async useA(){editable();if(flame.read().present)throw Error('Enable the existing flame in Properties before blending');if(!a?.settings.source?.presetId)throw Error('Choose a saved preset for A first');loading=true;changed();
      try{await flame.initialize(structuredClone(a.settings),{signal:lifetime.signal});}finally{loading=false;changed();}return read();},
    setFields(value){editable();if(!Array.isArray(value))throw Error('Choose continuous parameters');
      const choices=blendChoices(a?.settings,b?.settings,settings());for(const id of value)if(!choices.find(f=>f.id===id)?.available)throw Error('Unavailable continuous parameter: '+id);
      fields=[...new Set(value)];emit('fields');changed();return read();},
    setDuration(value){editable();if(!Number.isFinite(value)||value<=0)throw Error('Duration must be positive');duration=value;changed();return read();},
    begin(){begin();changed();return read();},
    preview(value){preview(value);return {amount};},
    finish(){end();emit('blend');return read();},
    setAmount(value){preview(value);end();emit('blend');return read();},
    play(){editable();begin();if(amount===1)preview(0);playback={start:amount,elapsed:0};emit('play');changed();return read();},
    pause(){end();emit('pause');return read();},
    cancel(){end(true);emit('cancel');return read();},
    export(){available();return {schema:'kaminos-flame-blend-v1',...structuredClone(current())};},
    restore,
  };
  return {read,operations,dispose(){disposed=true;lifetime.abort();end(true);stopFrames();}};
}
