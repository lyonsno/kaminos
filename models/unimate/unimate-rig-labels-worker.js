// The joint labeller's worker, started by unimate-rig-labels.js: Pyodide, numpy and UniMate's
// labeller load and run here, off the page's thread. init loads the labeller; label answers with
// its raw output (the page resolves the facing pair to joint indices).
import { loadLabeller } from './unimate-rig-labels.js';

const scope = globalThis;
let labeller = null;
scope.onmessage = async ({ data: m }) => {
  try {
    if (m.type === 'init') {
      labeller = await loadLabeller({ zipUrl: m.zipUrl, pyodideUrl: m.pyodideUrl, packageBaseUrl: m.packageBaseUrl, loadPyodide: scope.loadPyodide ?? null,
        onStatus: status => scope.postMessage({ type: 'status', status }) });
      scope.postMessage({ type: 'ready', version: labeller.version });
    } else if (m.type === 'label') {
      scope.postMessage({ type: 'labels', id: m.id, out: JSON.parse(labeller.labelRig(JSON.stringify({ name: m.name, ...m.rig }))) });
    }
  } catch (e) { scope.postMessage({ type: 'error', id: m.id ?? null, message: String(e?.message ?? e) }); }
};
