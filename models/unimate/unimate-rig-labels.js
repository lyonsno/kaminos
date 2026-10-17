// Joint labels and the facing pair for an imported rig, from UniMate's own rule-based labeller
// (data_process.rig_preprocess.annotate, mode 'rule', profile 'general') running unchanged in
// Pyodide. pack-labeler.py builds the zip of upstream modules this loads; Pyodide and numpy come
// from the Pyodide CDN. Loaded on first use only (about 10 MB), never for the built-in skeletons.
//
// label(rig) takes importRig's output and returns { clean (one label per joint, in rig order),
// face: { right, left, bodyAxis } (joint indices, or null when the rig defines no facing), notes }.

export const PYODIDE_VERSION = '0.27.7';
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export const LABELER_URL = 'https://huggingface.co/BasinShapers/unimate-webgpu/resolve/main/labeler/unimate-labeler.zip';

export async function createLabeler({ zipUrl = LABELER_URL, pyodideUrl = PYODIDE_URL, loadPyodide = null, packageBaseUrl = undefined, onStatus = () => {} }) {
  onStatus('loading Python');
  const load = loadPyodide ?? (await import(/* webpackIgnore: true */ `${pyodideUrl}pyodide.mjs`)).loadPyodide;
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
  return {
    version: py.version,
    label(rig, { name = 'rig' } = {}) {
      const out = JSON.parse(labelRig(JSON.stringify({ name, names: rig.names, parents: rig.parents,
        rest_local_pos: rig.restLocalPos, rest_local_rot: rig.restLocalRot })));
      const r = out.face?.r_hip?.raw, l = out.face?.l_hip?.raw;
      return {
        clean: out.clean,
        face: r && l ? { right: rig.names.indexOf(r), left: rig.names.indexOf(l), bodyAxis: Boolean(out.face.body_axis), source: out.face.source ?? null } : null,
        notes: out.notes,
        raw: out,
      };
    },
  };
}
