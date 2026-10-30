// Owns document identity and admission. Feature records and the application
// still own document meaning and the work of applying a restore plan.
export function createSceneDocumentSession({
  requests, records, planRestore, post, readAddress, restoreUrl,
  apply, requiresNavigation = () => false, navigate,
  assertSupported = () => {}, bound = () => {}, saved = () => {},
  status = () => {}, filename: initialFilename = null, blocked: initialBlocked = false,
}) {
  let filename = initialFilename, blocked = initialBlocked, phase = 'idle';
  let revision = 0, restoring = null;
  const state = () => Object.freeze({filename, blocked: blocked || phase !== 'idle', phase});
  const current = id => restoring?.id === id && requests.isCurrent(id);
  function certify(document, options) {
    const plan = planRestore(document, options);
    records.assertReloadable(plan.objects);
    return plan;
  }
  function bind(value) { filename = value; revision++; bound(value); }
  const failure = error => ({ok:false, error:error.message || String(error)});

  async function persist(document, target, {saveAsName = null, overwrite = false} = {}, address = structuredClone(readAddress())) {
    const body = {...document};
    if (target) body._filename = target;
    if (saveAsName) { body._saveAsName = saveAsName; if (overwrite) body._overwrite = true; }
    // Snapshot both bytes and address before the asynchronous transport.
    const json = JSON.stringify(body, null, 2);
    const response = await post(json), result = await response.json();
    if (response.status === 409 && result.exists) return {ok:false, exists:result.exists, error:result.error};
    if (!response.ok) throw Error(result.error || `Scene save failed: HTTP ${response.status}`);
    if (typeof result.saved !== 'string' || !result.saved.endsWith('.kaminos.json') || /[/\\]/.test(result.saved)) {
      throw Error(result.error || 'Server did not return a valid saved scene filename');
    }
    const submitted = JSON.parse(json);
    delete submitted._filename; delete submitted._saveAsName; delete submitted._overwrite;
    return {ok:true, filename:result.saved, url:restoreUrl(submitted, result.saved, address), document:submitted};
  }
  async function save(document, target = filename, options = {}, observation = false) {
    const startRevision = revision, loadGeneration = requests.current();
    let result;
    try {
      if (state().blocked) throw Error('Scene save blocked until a scene loads successfully');
      if (!observation) certify(document, {allowEmpty:true});
      result = await persist(document, target, options);
      if (result.ok) {
        // A successful artifact survives a later document transition, but it
        // cannot claim that newer document's overwrite target or address.
        if (revision === startRevision && requests.current() === loadGeneration && !state().blocked) bind(result.filename);
        saved(result);
      }
    } catch (error) { result = failure(error); status(`Save failed: ${result.error}`); }
    return options.result ? result : result.ok;
  }
  async function restore(file, {sceneFile = null, mounted = false, emptySettings = false} = {}) {
    // Concurrent reads inherit the last viable admission, not an older read's
    // transient block. Once application has begun, that admission is gone.
    const previous = restoring
      ? phase === 'reading' ? restoring.previous : {filename:null, blocked:true, phase:'idle'}
      : {filename, blocked, phase};
    const id = requests.begin();
    revision++; restoring = {id, previous}; phase = 'reading';
    let data, plan;
    try {
      const address = structuredClone(readAddress());
      const text = await file.text();
      if (!current(id)) return {ok:false, stale:true};
      try { data = JSON.parse(text); } catch { throw Error('Invalid scene file'); }
      try { plan = certify(data, {allowEmpty:emptySettings}); }
      catch (error) { throw Error(`Invalid scene format: ${error.message || error}`); }
      assertSupported(plan);
      if (requiresNavigation(plan, {mounted})) {
        if (!sceneFile) {
          const result = await persist(data, null, {}, address);
          if (!current(id)) return {ok:false, stale:true};
          if (!result.ok) throw Error(result.error || 'Scene could not be saved before opening');
          sceneFile = result.filename;
          saved(result);
        }
        if (!current(id)) return {ok:false, stale:true};
        phase = 'navigating';
        navigate(restoreUrl(data, sceneFile, address));
        return {ok:true, navigating:true, filename:sceneFile};
      }
      phase = 'applying';
      const applied = await apply(data, plan, {requestId:id, sceneFile});
      if (!current(id)) return {ok:false, stale:true};
      if (applied === false) throw Error('Scene restoration did not complete');
      restoring = null; phase = 'idle'; blocked = false; bind(sceneFile);
      return {ok:true, filename:sceneFile};
    } catch (error) {
      if (!current(id)) return {ok:false, stale:true};
      if (phase === 'reading') {
        ({filename, blocked, phase} = previous);
      } else {
        phase = 'idle'; blocked = true; bind(null);
      }
      restoring = null;
      status(`Scene load failed: ${error.message || error}`);
      return failure(error);
    }
  }
  function authoringChanged() { if (!restoring) blocked = false; }
  function sceneCleared() {
    if (restoring && requests.isCurrent(restoring.id)) return;
    restoring = null; phase = 'idle'; blocked = false; revision++;
  }
  function snapshot() { return Object.freeze({filename, blocked, revision}); }
  function resume(snapshot) {
    if (snapshot?.revision !== revision || restoring) return false;
    filename = snapshot.filename; blocked = snapshot.blocked; return true;
  }
  return Object.freeze({state, save, capture:(document,target,options)=>save(document,target,options,true), restore,
    authoringChanged, sceneCleared, snapshot, resume,
    holdRestore() { blocked = true; revision++; },
  });
}
