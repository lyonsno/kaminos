// Joint labels and the facing pair for an imported rig, from UniMate's own rule-based labeller
// (data_process.rig_preprocess.annotate, mode 'rule', profile 'general') running unchanged in
// Pyodide. pack-labeler.py builds the zip of upstream modules this loads; Pyodide and numpy come
// from the Pyodide CDN. Loaded on first use only (about 10 MB), never for the built-in skeletons.
//
// label(rig) takes importRig's output and resolves to { clean (one label per joint, in rig order),
// face: { right, left, bodyAxis } (joint indices, or null when the rig defines no facing), notes }.
//
// Where Worker exists the labeller runs in a module worker: Pyodide's start, numpy and the
// labeller's import take seconds of CPU and would stall the host's frames on the page's thread.
// labeler.route says where it runs ('worker' or 'main-thread': no Worker, worker: false, or a
// given loadPyodide). A worker that cannot start at all (no module workers, a bundler that left
// unimate-rig-labels-worker.js out, a CSP refusing workers) falls back to the page with a status
// line saying so; a labeller that fails to load in
// the worker (the zip did not download) is an error, not a fallback.

export const PYODIDE_VERSION = '0.27.7';
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const LABELER_URL = 'https://huggingface.co/BasinShapers/unimate-webgpu/resolve/main/labeler/unimate-labeler.zip';

// Loads Pyodide, numpy and the labeller; returns { version, labelRig(json) -> json }. The worker
// (unimate-rig-labels-worker.js) calls it there; without a worker it runs here.
export async function loadLabeller({ zipUrl, pyodideUrl, packageBaseUrl, loadPyodide, onStatus }) {
  onStatus('loading Python');
  const load = loadPyodide ?? (await import(/* webpackIgnore: true */ /* @vite-ignore */ `${pyodideUrl}pyodide.mjs`)).loadPyodide;
  const py = await load({ indexURL: pyodideUrl, ...(packageBaseUrl ? { packageBaseUrl } : {}) });
  onStatus('loading numpy');
  await py.loadPackage('numpy');
  onStatus('loading the labeller');
  // The zip must arrive whole: a failed or rate-limited response is retried once, then reported.
  let zip = null;
  for (let attempt = 0; attempt < 2 && !zip; attempt++) {
    const res = await fetch(zipUrl);
    const bytes = res.ok ? await res.arrayBuffer() : null;
    if (bytes && bytes.byteLength > 4 && new DataView(bytes).getUint32(0, true) === 0x04034b50) zip = bytes;
    else if (attempt) throw new Error(`the joint labeller did not download (${zipUrl}: HTTP ${res.status})`);
    else await new Promise(r => setTimeout(r, 1500));
  }
  py.unpackArchive(zip, 'zip', { extractDir: '/lib/unimate-labeler' });
  py.runPython("import sys\nif '/lib/unimate-labeler' not in sys.path: sys.path.insert(0, '/lib/unimate-labeler')");
  const labelRig = py.pyimport('unimate_browser_annotate').label_rig;
  return { version: py.version, labelRig: json => labelRig(json) };
}

const rigInput = rig => ({ names: rig.names, parents: rig.parents, rest_local_pos: rig.restLocalPos, rest_local_rot: rig.restLocalRot });
function shapeLabels(out, rig) {
  const r = out.face?.r_hip?.raw, l = out.face?.l_hip?.raw;
  return {
    clean: out.clean,
    face: r && l ? { right: rig.names.indexOf(r), left: rig.names.indexOf(l), bodyAxis: Boolean(out.face.body_axis), source: out.face.source ?? null } : null,
    notes: out.notes,
    raw: out,
  };
}

function startWorker({ zipUrl, pyodideUrl, packageBaseUrl, onStatus }) {
  // This exact form lets Vite, webpack and Parcel bundle the worker with the app.
  const worker = new Worker(new URL('./unimate-rig-labels-worker.js', import.meta.url), { type: 'module', name: 'unimate-labeller' });
  const pending = new Map();
  let nextId = 1, ready = null;
  return new Promise((resolve, reject) => {
    ready = { resolve, reject };
    const fail = message => {
      if (ready) { ready.reject(Object.assign(new Error(message), { workerStart: true })); ready = null; }
      for (const p of pending.values()) p.reject(new Error(message));
      pending.clear();
    };
    worker.onerror = e => { e?.preventDefault?.(); fail(`the labeller worker failed: ${e?.message ?? 'could not start'}`); };
    worker.onmessage = ({ data: m }) => {
      if (m.type === 'status') onStatus(m.status);
      else if (m.type === 'ready') {
        ready?.resolve({
          version: m.version, route: 'worker',
          label(rig, { name = 'rig' } = {}) {
            const id = nextId++;
            return new Promise((res, rej) => { pending.set(id, { resolve: out => res(shapeLabels(out, rig)), reject: rej }); worker.postMessage({ type: 'label', id, rig: rigInput(rig), name }); });
          },
          close() { worker.terminate(); fail('the labeller was closed'); },
        });
        ready = null;
      } else if (m.type === 'labels') { pending.get(m.id)?.resolve(m.out); pending.delete(m.id); }
      else if (m.type === 'error') {
        if (m.id === null || !pending.has(m.id)) { if (ready) { ready.reject(new Error(m.message)); ready = null; } }
        else { pending.get(m.id).reject(new Error(m.message)); pending.delete(m.id); }
      }
    };
    worker.postMessage({ type: 'init', zipUrl, pyodideUrl, packageBaseUrl });
  });
}

export async function createLabeler({ zipUrl = LABELER_URL, pyodideUrl = PYODIDE_URL, loadPyodide = null, packageBaseUrl = undefined, worker = true, onStatus = () => {} } = {}) {
  if (worker && !loadPyodide && typeof Worker !== 'undefined') {
    try { return await startWorker({ zipUrl, pyodideUrl, packageBaseUrl, onStatus }); } catch (e) {
      if (!e.workerStart) throw e;
      onStatus(`no labeller worker (${e.message}); loading on the page`);
    }
  }
  const labeller = await loadLabeller({ zipUrl, pyodideUrl, packageBaseUrl, loadPyodide, onStatus });
  return {
    version: labeller.version, route: 'main-thread',
    async label(rig, { name = 'rig' } = {}) { return shapeLabels(JSON.parse(labeller.labelRig(JSON.stringify({ name, ...rigInput(rig) }))), rig); },
    close() {},
  };
}
