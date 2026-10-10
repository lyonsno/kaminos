import {normalizeKilnCues,KILN_LAYERED_CUE_SCHEMA,sampleKilnPhase,sampleKilnLook,activeKilnLookCue} from './kiln-cinematic-cues.mjs';
import {tuneForCue, setCueTuneValue, checkCueDomain, CUE_DOMAIN_FIELDS} from './kiln-cue-tunes.mjs';

export function createCueTuneEditor({readCues,writeCues,readTune,applyTune,validateTune,loadTune,canBegin=()=>{},capturePresentation=()=>null,restorePresentation=()=>{}}) {
  let draft=null,loading=false;
  const layered=()=>draft?.cues.schema===KILN_LAYERED_CUE_SCHEMA;
  const emitterKey=()=>draft.cues[draft.phase][draft.index];
  const look=()=>draft.cues.looks.find(item=>item.id===activeKilnLookCue(draft.cues,draft.phase,emitterKey().time).lookId);
  const checked=tune=>validateTune(checkCueDomain(tune,draft.baseline));
  function restore(tune,previous) {
    try {applyTune(tune);}
    catch(error) {
      try {applyTune(previous);} catch(rollback) {throw new AggregateError([error,rollback],'Cue tune and restoration failed');}
      throw error;
    }
  }
  function preview(next) {
    if(!draft)throw Error('Select a keyframe to tune');
    const tune=checked(next);
    restore(tune,draft.tune);draft.tune=structuredClone(tune);
    return structuredClone(draft.tune);
  }
  return {
    active:()=>!!draft,
    state:()=>draft ? structuredClone({phase:draft.phase,index:draft.index,tune:draft.tune,
      ...(layered()?{lookId:look().id,lookName:look().name,looks:draft.cues.looks.map(({id,name})=>({id,name})),key:emitterKey(),
        lookKeyed:draft.cues.lookCues[draft.phase].some(key=>key.time===emitterKey().time)}:{})}) : null,
    begin(phase,index) {
      if(draft)throw Error('Accept or cancel the current keyframe tune');
      canBegin();
      const cues=normalizeKilnCues(readCues()),key=cues[phase]?.[index];
      if(!key)throw Error('Keyframe was not found');
      const baseline=readTune();
      const next=validateTune(checkCueDomain(cues.schema===KILN_LAYERED_CUE_SCHEMA?sampleKilnPhase(cues,phase,key.time).tune:tuneForCue(key,baseline),baseline));
      const presentation=capturePresentation();
      try {restore(next,baseline);}catch(error){restorePresentation(presentation);throw error;}
      draft={phase,index,cues,baseline,presentation,tune:structuredClone(next)};
      return this.state();
    },
    set(id,value) {
      if(!layered())return preview(setCueTuneValue(draft?.tune,id,value));
      const old=structuredClone(draft.cues),channel={'volume-input-radius':'radius','volume-flow-rate':'flow'}[id];
      if(channel)emitterKey()[channel]=value;
      else look().tune=setCueTuneValue(look().tune,id,value);
      try {return preview(sampleKilnPhase(draft.cues,draft.phase,emitterKey().time).tune);}
      catch(error){draft.cues=old;throw error;}
    },
    captureField(id) {
      if(!draft)throw Error('Select a keyframe to tune');
      const channel={'volume-input-radius':'radius','volume-flow-rate':'flow'}[id];
      const tune=layered()?look().tune:draft.tune;
      const axis=tune.domControls[id]?'domControls':'rendererControls';
      return {phase:draft.phase,index:draft.index,id,channel:layered()?channel:null,
        lookId:layered()?look().id:null,axis,
        keyed:layered()&&channel?Object.hasOwn(emitterKey(),channel):true,
        value:structuredClone(layered()&&channel?emitterKey()[channel]:tune[axis][id])};
    },
    restoreField(snapshot) {
      if(!draft||snapshot.phase!==draft.phase||snapshot.index!==draft.index||
        (layered()&&snapshot.lookId!==look().id))throw Error('Keyframe changed during the field edit');
      if(!layered()) {
        const next=structuredClone(draft.tune);next[snapshot.axis][snapshot.id]=structuredClone(snapshot.value);
        return preview(next);
      }
      const old=structuredClone(draft.cues);
      if(snapshot.channel) {
        if(snapshot.keyed)emitterKey()[snapshot.channel]=snapshot.value;
        else delete emitterKey()[snapshot.channel];
      } else look().tune[snapshot.axis][snapshot.id]=structuredClone(snapshot.value);
      try{return preview(sampleKilnPhase(draft.cues,draft.phase,emitterKey().time).tune);}
      catch(error){draft.cues=old;throw error;}
    },
    inheritEmitter(channel,inherit=true) {
      if(!layered()||!['radius','flow'].includes(channel))throw Error('Layered emitter channel required');
      const old=structuredClone(draft.cues),key=emitterKey(),id=channel==='radius'?'volume-input-radius':'volume-flow-rate';
      if(inherit)delete key[channel];else key[channel]=Number(draft.tune.domControls[id].rawValue??draft.tune.domControls[id].value);
      try{return preview(sampleKilnPhase(draft.cues,draft.phase,key.time).tune);}
      catch(error){draft.cues=old;throw error;}
    },
    selectLook(id) {
      if(!layered()||!draft.cues.looks.some(item=>item.id===id))throw Error('Scene look not found');
      const old=structuredClone(draft.cues),keys=draft.cues.lookCues[draft.phase],time=emitterKey().time;
      const existing=keys.find(key=>key.time===time);
      if(existing){existing.lookId=id;delete existing.blend;}
      else {keys.push({time,lookId:id});keys.sort((a,b)=>a.time-b.time);}
      try{return preview(sampleKilnPhase(draft.cues,draft.phase,time).tune);}
      catch(error){draft.cues=old;throw error;}
    },
    inheritLook() {
      if(!layered()||emitterKey().time===0)throw Error('Keep the initial look cue');
      const old=structuredClone(draft.cues),time=emitterKey().time;
      draft.cues.lookCues[draft.phase]=draft.cues.lookCues[draft.phase].filter(key=>key.time!==time);
      try{return preview(sampleKilnPhase(draft.cues,draft.phase,time).tune);}
      catch(error){draft.cues=old;throw error;}
    },
    renameLook(name) {
      if(!layered()||typeof name!=='string'||!name.trim())throw Error('Look name required');
      look().name=name.trim();return this.state();
    },
    makeUnique() {
      if(!layered())throw Error('Layered scene look required');
      const item={...structuredClone(look()),tune:sampleKilnLook(draft.cues,draft.phase,emitterKey().time).tune};let i=1;
      while(draft.cues.looks.some(value=>value.id===`look-${i}`))i++;
      item.id=`look-${i}`;item.name+= ' copy';draft.cues.looks.push(item);
      try {this.selectLook(item.id);}catch(error){draft.cues.looks=draft.cues.looks.filter(value=>value.id!==item.id);throw error;}
      return this.state();
    },
    preview,
    audition() {
      if(!draft)throw Error('Select a keyframe to tune');
      return preview(draft.tune);
    },
    async useBasin(id) {
      if(!draft)throw Error('Select a keyframe to tune');
      if(loading)throw Error('A basin is already loading');
      const owner=draft,prior=JSON.stringify([draft.tune,draft.cues]);loading=true;
      try {
        const loaded=await loadTune(id);
        if(draft!==owner || JSON.stringify([draft.tune,draft.cues])!==prior)throw Error('Keyframe changed while the basin loaded');
        const tune=structuredClone(loaded),retainedFields=[];
        // The host loader aliases these maps into source.preset; detach edits from provenance.
        for(const axis of ['domControls','rendererControls','presentationControls'])tune[axis]=structuredClone(tune[axis]);
        for(const field of CUE_DOMAIN_FIELDS) {
          const baseline=draft.baseline.domControls[field],incoming=tune.domControls[field];
          if(!baseline)continue;
          if(String(incoming?.rawValue??incoming?.value)!==String(baseline.rawValue??baseline.value))retainedFields.push(field);
          tune.domControls[field]=structuredClone(baseline);
        }
        if(tune.source)tune.source.cueSimulation={retainedFields};
        if(!layered())return preview(tune);
        const previous=look().tune;
        look().tune=checked(tune);
        try {return preview(sampleKilnPhase(draft.cues,draft.phase,emitterKey().time).tune);}
        catch(error){look().tune=previous;throw error;}
      } finally {loading=false;}
    },
    accept() {
      if(!draft)throw Error('No keyframe tune is open');
      const owner=draft,next=structuredClone(owner.cues),key=next[owner.phase][owner.index];
      checked(owner.tune);
      if(!layered()) {
        key.tune=structuredClone(owner.tune);
        key.radius=Number(key.tune.domControls['volume-input-radius'].rawValue??key.tune.domControls['volume-input-radius'].value);
        key.flow=Number(key.tune.domControls['volume-flow-rate'].rawValue??key.tune.domControls['volume-flow-rate'].value);
      }
      normalizeKilnCues(next);
      restore(owner.baseline,owner.tune);restorePresentation(owner.presentation);draft=null;
      try {writeCues(next);}
      catch(error) {draft=owner;restore(owner.tune,owner.baseline);throw error;}
      return next;
    },
    cancel() {
      if(!draft)return false;
      const owner=draft;restore(owner.baseline,owner.tune);restorePresentation(owner.presentation);draft=null;return true;
    },
  };
}
