// Joint labels and the facing pair for an imported rig, from UniMate's own rule-based labeller
// (data_process.rig_preprocess.annotate, mode 'rule', profile 'general') running unchanged in
// Pyodide. pack-labeler.py builds the zip of upstream modules this loads; Pyodide and numpy come
// from the Pyodide CDN. Loaded on first use only (about 10 MB), never for the built-in skeletons.
//
// label(rig) takes importRig's output and returns { clean (one label per joint, in rig order),
// face: { right, left, bodyAxis } (joint indices, or null when the rig defines no facing), notes }.

export const PYODIDE_VERSION = '0.27.7';
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

export async function createLabeler({ zipUrl, pyodideUrl = PYODIDE_URL, loadPyodide = null, packageBaseUrl = undefined, onStatus = () => {} }) {
  onStatus('loading Python');
  const load = loadPyodide ?? (await import(/* webpackIgnore: true */ `${pyodideUrl}pyodide.mjs`)).loadPyodide;
  const py = await load({ indexURL: pyodideUrl, ...(packageBaseUrl ? { packageBaseUrl } : {}) });
  onStatus('loading numpy');
  await py.loadPackage('numpy');
  onStatus('loading the labeller');
  const zip = await (await fetch(zipUrl)).arrayBuffer();
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
