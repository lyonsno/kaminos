// Progressive resources are separate from the authored environment recipe.
// select() never waits for I/O. releaseFull() lets scene construction finish
// before requesting/preparing the large maps; whenSettled() serves consumers
// that explicitly need final lighting.
export function createEnvironmentLoader({presets, load, apply, fallback, placeholder = fallback, changed = () => {}, disposeResource = map => map?.dispose?.()}) {
  const cache = new Map(), pending = new Map();
  let resourceEpoch = 0;
  let generation = 0, hasMap = false, holds = 0, release;
  let fullAllowed = Promise.resolve();
  function holdFull() {
    if (holds++ === 0) fullAllowed = new Promise(resolve => { release = resolve; });
    let active = true;
    return () => { if (active) { active = false; if (--holds === 0) release(); } };
  }
  const releaseStartup = holdFull();
  async function waitForFull() { while (holds) await fullAllowed; }
  let state = {name: null, mapName: null, quality: 'none', pending: false, error: null};
  let completion = Promise.resolve(state);
  const publish = patch => { state = {...state, ...patch}; changed({...state}); };
  async function resource(name, quality) {
    const key = `${name}:${quality}`;
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);
    const epoch = resourceEpoch;
    const promise = Promise.resolve().then(() => load(presets[name][quality === 'preview' ? 'previewUrl' : 'url'], {name, quality, isCurrent:()=>epoch===resourceEpoch}))
      .then(map => {
        if(epoch!==resourceEpoch){disposeResource(map);throw Error('Environment resource superseded');}
        cache.set(key, map); return map;
      }).finally(() => {if(pending.get(key)===promise)pending.delete(key);});
    pending.set(key, promise);
    return promise;
  }
  function select(name) {
    if (!Object.hasOwn(presets, name)) throw Error(`Unknown environment: ${name}`);
    if (name === state.name && (state.pending || state.quality === 'full')) return {...state};
    const token = ++generation, preset = presets[name];
    const current = () => token === generation;
    const show = (map, quality) => {
      if (!current() || (quality === 'preview' && state.quality === 'full')) return;
      apply(map); hasMap = true; publish({mapName: name, quality});
    };
    publish({name, quality: 'loading', pending: true, error: null});
    if (!preset.url) {
      show(fallback(), 'full'); publish({pending: false});
      completion = Promise.resolve({...state}); return {...state};
    }
    if (cache.has(`${name}:full`)) {
      show(cache.get(`${name}:full`), 'full'); publish({pending: false});
      completion = Promise.resolve({...state}); return {...state};
    }
    if (!hasMap) {
      apply(placeholder()); hasMap = true; publish({mapName: null, quality: 'fallback'});
    }
    const preview = (preset.previewUrl ? resource(name, 'preview') : Promise.reject(Error('No preview')))
      .then(map => show(map, 'preview')).catch(error => {
        if (!current() || state.quality === 'full') return;
        apply(fallback()); publish({mapName: null, quality: 'fallback', error: String(error.message || error)});
      });
    completion = (async () => {
      await waitForFull();
      if (!current()) return {...state};
      try {
        show(await resource(name, 'full'), 'full');
        if (current()) publish({pending: false, error: null});
      } catch (error) {
        await preview;
        if (current()) publish({pending: false, error: String(error.message || error)});
      }
      return {...state};
    })();
    return {...state};
  }
  return {select, invalidateResources({dispose=true}={}){
    if(typeof dispose!=='boolean')throw Error('Environment disposal choice must be Boolean');
    generation++;resourceEpoch++;pending.clear();
    // A retained resource owner can fence I/O now and release its targets later.
    // Other callers keep the original eager-disposal behavior.
    if(dispose)for(const [key,map]of cache){disposeResource(map);cache.delete(key);}
    else cache.clear();
    hasMap=false;
    state={name:null,mapName:null,quality:'none',pending:false,error:null};completion=Promise.resolve(state);
  }, read: () => ({...state}), holdFull, releaseFull: releaseStartup,
    async whenSettled() { for (;;) { const chosen = completion; await chosen; if (chosen === completion) return {...state}; } }};
}
