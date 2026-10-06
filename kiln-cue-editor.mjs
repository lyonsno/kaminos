import {normalizeKilnCues} from './kiln-cinematic-cues.mjs';
import {tuneForCue, setCueTuneValue, checkCueDomain} from './kiln-cue-tunes.mjs';

export function createCueTuneEditor({readCues,writeCues,readTune,applyTune,validateTune,loadTune,canBegin=()=>{},capturePresentation=()=>null,restorePresentation=()=>{}}) {
  let draft=null,loading=false;
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
    state:()=>draft ? structuredClone({phase:draft.phase,index:draft.index,tune:draft.tune}) : null,
    begin(phase,index) {
      if(draft)throw Error('Accept or cancel the current keyframe tune');
      canBegin();
      const cues=normalizeKilnCues(readCues()),key=cues[phase]?.[index];
      if(!key)throw Error('Keyframe was not found');
      const baseline=readTune();
      const next=validateTune(checkCueDomain(tuneForCue(key,baseline),baseline));
      const presentation=capturePresentation();
      try {restore(next,baseline);}catch(error){restorePresentation(presentation);throw error;}
      draft={phase,index,cues,baseline,presentation,tune:structuredClone(next)};
      return this.state();
    },
    set:(id,value)=>preview(setCueTuneValue(draft?.tune,id,value)),
    preview,
    async useBasin(id) {
      if(!draft)throw Error('Select a keyframe to tune');
      if(loading)throw Error('A basin is already loading');
      const owner=draft,prior=JSON.stringify(draft.tune);loading=true;
      try {
        const tune=await loadTune(id);
        if(draft!==owner || JSON.stringify(draft.tune)!==prior)throw Error('Keyframe changed while the basin loaded');
        return preview(tune);
      } finally {loading=false;}
    },
    accept() {
      if(!draft)throw Error('No keyframe tune is open');
      const owner=draft,next=structuredClone(owner.cues),key=next[owner.phase][owner.index];
      key.tune=checked(owner.tune);
      key.radius=Number(key.tune.domControls['volume-input-radius'].rawValue??key.tune.domControls['volume-input-radius'].value);
      key.flow=Number(key.tune.domControls['volume-flow-rate'].rawValue??key.tune.domControls['volume-flow-rate'].value);
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
