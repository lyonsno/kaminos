// The joint labeller must not load Python on the page's main thread: Pyodide's start, numpy and
// the labeller's import stall the host's frames for about 2 s (consumer witness, Fox). Where Worker
// exists, createLabeler loads Pyodide in a module worker and label() answers through messages.
//
// 1. With a Worker global, createLabeler starts one module worker, never imports Pyodide itself, and
//    label() resolves to what the worker returns, in the documented shape.
// 2. The worker module (unimate-rig-labels-worker.js), loaded as a worker would load it, with a fake
//    Pyodide, answers init and label messages with the real labelling code.
// 3. Without a Worker (or with worker: false) the labeller runs in-process, label() still a Promise.
import * as labelsModule from '../unimate-rig-labels.js';
const { createLabeler } = labelsModule;

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };
const rig = { names: ['hip', 'r_leg', 'l_leg'], parents: [-1, 0, 0], restLocalPos: [[0, 1, 0], [-0.2, 0, 0], [0.2, 0, 0]], restLocalRot: [[1, 0, 0, 0], [1, 0, 0, 0], [1, 0, 0, 0]] };
const pyOut = { clean: ['Hips', 'Right Thigh', 'Left Thigh'], face: { r_hip: { raw: 'r_leg' }, l_hip: { raw: 'l_leg' }, body_axis: false, source: 'thigh' }, notes: [] };
const fakePyodide = () => ({
  version: 'fake', loadPackage: async () => {}, unpackArchive() {}, runPython() {},
  pyimport: () => ({ label_rig: json => { const r = JSON.parse(json); return JSON.stringify({ ...pyOut, clean: pyOut.clean.slice(0, r.names.length) }); } }),
});
const zipBytes = () => { const b = new ArrayBuffer(8); new DataView(b).setUint32(0, 0x04034b50, true); return b; };

// 1. Worker route, with a stand-in Worker that runs nothing but answers the protocol.
{
  const made = [];
  globalThis.Worker = class {
    constructor(url, options) { this.url = url; this.options = options; this.sent = []; made.push(this); }
    postMessage(m) {
      this.sent.push(m);
      const reply = m.type === 'init' ? [{ type: 'status', status: 'loading Python' }, { type: 'ready', version: 'fake' }]
        : [{ type: 'labels', id: m.id, out: { ...pyOut } }];
      queueMicrotask(() => reply.forEach(data => this.onmessage?.({ data })));
    }
    terminate() { this.terminated = true; }
  };
  const statuses = [];
  try {
    const labeler = await createLabeler({ zipUrl: 'https://example.invalid/l.zip', onStatus: s => statuses.push(s) });
    check(made.length === 1, `one worker started (got ${made.length})`);
    check(made[0]?.options?.type === 'module', 'the worker is a module worker');
    check(String(made[0]?.url).endsWith('/unimate-rig-labels-worker.js'), `the worker is the labeller worker module (got ${made[0]?.url})`);
    check(made[0]?.sent[0]?.type === 'init' && made[0].sent[0].zipUrl === 'https://example.invalid/l.zip', 'init carries the zip URL');
    check(labeler.route === 'worker', `route reported as worker (got ${labeler.route})`);
    check(statuses.includes('loading Python'), 'worker status reaches onStatus');
    const out = labeler.label(rig);
    check(out instanceof Promise, 'label() returns a Promise');
    const labels = await out;
    check(JSON.stringify(labels.clean) === JSON.stringify(pyOut.clean), 'labels come back from the worker');
    check(labels.face?.right === 1 && labels.face?.left === 2 && labels.face.bodyAxis === false, `facing pair resolved to rig indices (got ${JSON.stringify(labels.face)})`);
    const msg = made[0].sent[1];
    check(msg?.type === 'label' && JSON.stringify(msg.rig?.names) === JSON.stringify(rig.names), 'label request carries the rig');
  } catch (e) { failures.push(`worker route threw: ${e.message}`); }
  delete globalThis.Worker;
}

// 2. The worker module, as a worker loads it, with the real labelling code and a fake Pyodide.
{
  try {
    const posted = [];
    Object.assign(globalThis, { loadPyodide: async () => fakePyodide(), fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => zipBytes() }), postMessage: m => posted.push(m) });
    await import('../unimate-rig-labels-worker.js');
    const send = async data => { await globalThis.onmessage({ data }); };
    await send({ type: 'init', zipUrl: 'https://example.invalid/l.zip', pyodideUrl: 'https://example.invalid/py/' });
    check(posted.some(m => m.type === 'ready' && m.version === 'fake'), `worker reports ready (posted ${JSON.stringify(posted)})`);
    await send({ type: 'label', id: 7, rig: { names: rig.names, parents: rig.parents, rest_local_pos: rig.restLocalPos, rest_local_rot: rig.restLocalRot }, name: 'rig' });
    const reply = posted.find(m => m.type === 'labels');
    check(reply?.id === 7 && JSON.stringify(reply.out?.clean) === JSON.stringify(pyOut.clean), 'worker answers label with the labeller output');
    delete globalThis.loadPyodide; delete globalThis.postMessage; delete globalThis.onmessage;
  } catch (e) { failures.push(`worker module threw: ${e.message}`); }
}

// 3. In-process route.
{
  globalThis.fetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => zipBytes() });
  try {
    const labeler = await createLabeler({ loadPyodide: async () => fakePyodide(), zipUrl: 'x', onStatus: () => {} });
    check(labeler.route === 'main-thread', `in-process route reported (got ${labeler.route})`);
    const out = labeler.label(rig);
    check(out instanceof Promise, 'in-process label() returns a Promise');
    check((await out).face?.right === 1, 'in-process labels resolve the facing pair');
  } catch (e) { failures.push(`in-process route threw: ${e.message}`); }
}

if (failures.length) { console.error(`labeler worker contracts: FAIL\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('labeler worker contracts: pass');
