import {normalizeCueTune, blendCueTunes, tuneForCue} from './kiln-cue-tunes.mjs';
export const KILN_CUE_SCHEMA = 'kaminos.kiln-cues.v1';
export const KILN_LAYERED_CUE_SCHEMA = 'kaminos.kiln-cues.v2';

function number(value, name, min, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`Invalid kiln cue ${name}`);
  }
  return value;
}

export function normalizeKilnCues(recipe) {
  if (recipe == null) return null;
  if (![KILN_CUE_SCHEMA,KILN_LAYERED_CUE_SCHEMA].includes(recipe.schema)) throw new Error('Unsupported kiln cue schema');
  const layered=recipe.schema===KILN_LAYERED_CUE_SCHEMA;
  const result = { ...recipe };
  for (const name of ['ignition', 'work']) {
    if (!Array.isArray(recipe[name]) || recipe[name].length < 2) throw new Error(`Invalid kiln cue ${name} keyframes`);
    let previous = -1;
    result[name] = recipe[name].map((key, index) => {
      const time = number(key.time, 'time', 0);
      if (time <= previous || (index === 0 && time !== 0)) throw new Error('Invalid kiln cue time order');
      previous = time;
      return { time,
        ...(!layered || key.radius!==undefined ? {radius:number(key.radius,'radius',.08,.7)} : {}),
        ...(!layered || key.flow!==undefined ? {flow:number(key.flow,'flow',0,4)} : {}),
        ...(!layered && key.tune ? {tune:normalizeCueTune(key.tune)} : {}) };
    });
  }
  if(layered) {
    if(!Array.isArray(recipe.looks)||!recipe.looks.length)throw Error('Kiln looks required');
    const ids=new Set();
    result.looks=recipe.looks.map(look=>{
      if(typeof look.id!=='string'||!look.id||ids.has(look.id)||typeof look.name!=='string'||!look.name.trim())throw Error('Invalid kiln look');
      ids.add(look.id);return {...look,tune:normalizeCueTune(look.tune)};
    });
    result.lookCues={};
    for(const phase of ['ignition','work']) {
      const keys=recipe.lookCues?.[phase];let previous=-1;
      if(!Array.isArray(keys)||!keys.length)throw Error('Kiln look cues required');
      result.lookCues[phase]=keys.map((key,i)=>{
        const time=number(key.time,'look time',0,result[phase].at(-1).time);
        if(time<=previous||(i===0&&time!==0)||!ids.has(key.lookId))throw Error('Invalid kiln look cue');
        if(key.blend!==undefined&&typeof key.blend!=='boolean')throw Error('Invalid kiln look blend');
        previous=time;return {time,lookId:key.lookId,...(key.blend?{blend:true}:{})};
      });
      for(const key of result.lookCues[phase])
        if(!result[phase].some(row=>row.time===key.time))result[phase].push({time:key.time});
      result[phase].sort((a,b)=>a.time-b.time);
    }
  }
  for (const key of ['extinguishSeconds', 'revealSeconds', 'previewWorkSeconds']) result[key] = number(recipe[key], key, 0.001);
  result.workLight = number(recipe.workLight, 'workLight', 0);
  result.cameraPush = number(recipe.cameraPush, 'cameraPush', 0, 0.9);
  return structuredClone(result);
}

export function layerKilnCues(recipe,baseline) {
  const next=normalizeKilnCues(recipe);
  if(next.schema===KILN_LAYERED_CUE_SCHEMA)return next;
  next.schema=KILN_LAYERED_CUE_SCHEMA;next.looks=[];next.lookCues={};
  const byTune=new Map();
  for(const phase of ['ignition','work']) {
    next.lookCues[phase]=next[phase].map((key,index)=>{
      const tune=normalizeCueTune(key.tune||baseline),fingerprint=JSON.stringify(tune);
      let id=byTune.get(fingerprint);
      if(!id) {
        id=`look-${next.looks.length+1}`;byTune.set(fingerprint,id);
        next.looks.push({id,name:tune.source?.label||'Scene flame',tune});
      }
      // The v1 host hydrated missing tunes from its baseline before playback.
      const blend=index<next[phase].length-1;
      return {time:key.time,lookId:id,...(blend?{blend:true}:{})};
    });
    // Remove redundant held cues; their emitter keys remain independent.
    next.lookCues[phase]=next.lookCues[phase].filter((key,i,keys)=>i===0||key.lookId!==keys[i-1].lookId||key.blend||keys[i-1].blend);
    next[phase]=next[phase].map(({time,radius,flow})=>({time,radius,flow}));
  }
  return normalizeKilnCues(next);
}

export function activeKilnLookCue(recipe,phase,seconds) {
  const keys=recipe.lookCues[phase];
  return keys.findLast(key=>key.time<=seconds)||keys[0];
}

export function sampleKilnLook(recipe,phase,seconds) {
  const lookKey=activeKilnLookCue(recipe,phase,seconds);
  const look=recipe.looks.find(item=>item.id===lookKey.lookId);
  let tune=normalizeCueTune(look.tune);
  const lookKeys=recipe.lookCues[phase],i=lookKeys.indexOf(lookKey),following=lookKeys[i+1];
  if(lookKey.blend&&following&&seconds>lookKey.time) {
    const right=recipe.looks.find(item=>item.id===following.lookId).tune;
    tune=blendCueTunes(tune,right,(seconds-lookKey.time)/(following.time-lookKey.time));
  }
  return {lookId:look.id,tune};
}

export function sampleKilnPhase(recipe,phase,seconds) {
  if(recipe.schema===KILN_CUE_SCHEMA)return sampleKilnKeys(recipe[phase],seconds);
  const {lookId,tune}=sampleKilnLook(recipe,phase,seconds);
  const values={time:seconds};
  for(const [channel,id] of [['radius','volume-input-radius'],['flow','volume-flow-rate']]) {
    const keys=recipe[phase].filter(key=>key[channel]!==undefined);
    const left=keys.findLast(key=>key.time<=seconds),right=keys.find(key=>key.time>seconds);
    values[channel]=left ? right ? left[channel]+(right[channel]-left[channel])*(seconds-left.time)/(right.time-left.time) : left[channel]
      : Number(tune.domControls[id]?.rawValue??tune.domControls[id]?.value);
    number(values[channel],channel,channel==='radius'?.08:0,channel==='radius'?.7:4);
  }
  return {...values,lookId,tune:tuneForCue(values,tune)};
}

export function defaultKilnCues({ inputRadius = 0.52, flowRate = 2.5 } = {}) {
  return normalizeKilnCues({
    schema: KILN_CUE_SCHEMA,
    ignition: [{time: 0, radius: 0.1, flow: 0}, {time: 1.2, radius: 0.2, flow: flowRate * 0.3}, {time: 3, radius: inputRadius, flow: flowRate}],
    work: [{time: 0, radius: inputRadius, flow: flowRate}, {time: 2.5, radius: Math.max(0.08, inputRadius * 0.65), flow: flowRate * 0.55}, {time: 4, radius: inputRadius, flow: flowRate}],
    extinguishSeconds: 5, revealSeconds: 3, previewWorkSeconds: 9, workLight: 0.35, cameraPush: 0.12,
  });
}

export function sampleKilnKeys(keys, seconds) {
  if (seconds <= 0) return { ...keys[0] };
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i], a = keys[i - 1];
    if (seconds <= b.time) {
      const t = (seconds - a.time) / (b.time - a.time);
      return { time: seconds, radius: a.radius + (b.radius - a.radius) * t, flow: a.flow + (b.flow - a.flow) * t,
        ...(a.tune && b.tune ? {tune:blendCueTunes(tuneForCue(a,a.tune),tuneForCue(b,b.tune),t)} : {}) };
    }
  }
  return { ...keys.at(-1) };
}

export function createKilnPerformance(recipe, { now = () => performance.now() / 1000 } = {}) {
  const cues = normalizeKilnCues(recipe);
  if (!cues) throw new Error('Kiln cues required');
  let started = null, completed = null, result = null, failure = null, mode = null;
  return {
    start(kind) {
      if (!['preview', 'live'].includes(kind)) throw new Error('Invalid kiln performance mode');
      if (started !== null) throw new Error('Kiln performance already started');
      mode = kind; started = now();
    },
    complete(presentation) {
      if (started === null || completed !== null || failure) throw new Error('Kiln performance cannot complete');
      if (presentation?.status !== 'registered' || !presentation.objectId) throw new Error('Kiln reveal requires a registered output');
      result = structuredClone(presentation); completed = now();
    },
    fail(message) { failure = String(message); },
    sample() {
      const elapsed = started === null ? 0 : Math.max(0, now() - started);
      let phase = 'idle', key = sampleKilnPhase(cues,'ignition',0), light = 1, push = 0;
      if (failure) phase = 'failed';
      else if (completed !== null) {
        const tail = Math.max(0, now() - completed);
        const reveal = Math.min(1, Math.max(0, (tail - cues.extinguishSeconds) / cues.revealSeconds));
        phase = tail < cues.extinguishSeconds ? 'extinguish' : reveal < 1 ? 'reveal' : 'complete';
        key = { ...sampleKilnPhase(cues,'work',cues.work.at(-1).time), flow: 0 };
        light = cues.workLight + (1 - cues.workLight) * reveal;
        push = cues.cameraPush;
      } else if (started !== null) {
        const ignition = cues.ignition.at(-1).time;
        phase = elapsed < ignition ? 'ignition' : 'work';
        key = phase === 'ignition' ? sampleKilnPhase(cues,'ignition',elapsed)
          : sampleKilnPhase(cues,'work',(elapsed - ignition) % cues.work.at(-1).time);
        const t = Math.min(1, elapsed / ignition);
        light = 1 + (cues.workLight - 1) * t;
        push = cues.cameraPush * t;
      }
      const sourceEnabled = ['ignition', 'work'].includes(phase) && key.flow > 0;
      return { mode, phase, elapsed, radius: key.radius, flow: sourceEnabled ? key.flow : 0,
        ...(key.tune ? {tune:tuneForCue({...key,flow:sourceEnabled?key.flow:0},key.tune)} : {}),
        sourceEnabled, light, push, outputVisible: !!result && ['reveal', 'complete'].includes(phase), result, failure };
    },
  };
}
