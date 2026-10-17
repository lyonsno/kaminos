// UniMate as a model consumer for a host app such as the Kaminos authoring app.
//
// The host owns the GPU: { device, queue, session, beginRun, routeId } (one shared device, one kit
// inference session, and its foreground service's beginRun(runId) and routeId, so the host keeps
// drawing frames while the model runs as GPU duties on that route). The consumer has the Generate-drawer service shape:
//
//   const unimate = createUniMateConsumer(host, { weightsBase, t5Base, skeletonsBase, labelerZip });
//   const { glb, motion, report } = await unimate.run({ asset: { glb: bytes, name: 'fox' }, prompt: 'An object walks forward.', seed: 1 });
//   unimate.read();   // { phase, stage, detail, progress, error, last }
//   unimate.stop();   // between GPU duties, through the kit inference control
//
// asset is a rigged .glb ({ glb, name, restRotation?, labels? }; prepared as UniMate's rig_preprocess
// would, labels from UniMate's own rule labeller unless given) or a published skeleton ({ skeleton:
// 'dog' }). The result's glb is the animated asset: the skeleton at UniMate's canonical rest, the
// motion's rotation and root tracks at 30 fps, and for a rig its skinned mesh, materials and
// textures bound to that skeleton (unimate-export-glb.js). Stages report what they are doing, with
// no invented percentages: download (bytes), label, encode, solve (evaluations and solver time t),
// decode, bake. Before any allocation, run() refuses if the model's GPU memory estimate exceeds
// the host's memoryBudgetBytes.
import { createUniMateGenerator } from './unimate-generator.js';
import { readRig, turnRest, buildSkeletonBundle } from './unimate-rig-import.js';
import { createLabeler } from './unimate-rig-labels.js';
import { exportMotionGlb } from './unimate-export-glb.js';

export const HUB = 'https://huggingface.co/BasinShapers/unimate-webgpu/resolve/main';

// GPU memory the model holds (weights are widened to float32 on the GPU), and the denoiser's
// workspace for a skeleton of J joints (batch 2: conditional and unconditional).
export function unimateMemoryEstimate({ joints = 71 } = {}) {
  const weights = 297_891_584 + 438_514_176;
  const tokens = 2 * 61 * joints, D = 512;
  const workspace = 4 * (tokens * D * 12 + tokens * 2 * 1365 * 2 + 2 * 8 * joints * joints * 10 + 6 * Math.max(2 * joints * joints * 128, 2 * 61 * 1024 * joints));
  return { weights, workspace, total: weights + workspace };
}

export function createUniMateConsumer(host, { weightsBase = `${HUB}/unimate-fp16/`, t5Base = `${HUB}/t5-fp16/`, skeletonsBase = `${HUB}/skeletons/`,
  labelerZip = `${HUB}/labeler/unimate-labeler.zip`, defaultSkeleton = 'dog', memoryBudgetBytes = null } = {}) {
  const { device, session, beginRun } = host;
  const routeId = host.routeId ?? undefined;   // the host foreground service's route (see unimate-generator.js)
  if (!device || !session || typeof beginRun !== 'function') throw new Error('UniMate needs a host { device, session, beginRun }');
  const state = { phase: 'idle', stage: null, detail: null, progress: null, error: null, last: null };
  const set = (phase, stage = null, detail = null, progress = null) => Object.assign(state, { phase, stage, detail, progress });
  let generator = null, labeler = null, running = null;

  async function ensureModel() {
    if (generator) return generator;
    set('loading', 'download', 'model and text encoder');
    generator = await createUniMateGenerator({ device, session, beginRun, routeId, weightsBase, t5Base, bundleBase: `${skeletonsBase}${defaultSkeleton}/`,
      onStatus: s => { if (s.phase === 'load') set('loading', 'download', s.detail, state.progress); },
      onBytes: (loaded, total) => set('loading', 'download', 'model and text encoder', { bytes: loaded, totalBytes: total }) });
    return generator;
  }

  async function run({ asset, prompt, seed = 1, onProgress = () => {} } = {}) {
    if (running) throw new Error('UniMate is already running');
    if (!prompt) throw new Error('a prompt is needed');
    const report = (phase, stage, detail = null, progress = null) => { set(phase, stage, detail, progress); onProgress({ ...state }); };
    running = { stopped: false };
    state.error = null;
    try {
      // Refuse before allocating anything the host cannot afford.
      const estimate = unimateMemoryEstimate();
      if (memoryBudgetBytes !== null && estimate.total > memoryBudgetBytes) {
        throw Object.assign(new Error(`UniMate needs about ${Math.ceil(estimate.total / 1e6)} MB of GPU memory; the budget is ${Math.floor(memoryBudgetBytes / 1e6)} MB`), { name: 'MemoryRefusal' });
      }
      const gen = await ensureModel();
      let rig = null, labels = null, data = null;
      if (asset?.glb) {
        report('running', 'label', asset.name ?? 'rig');
        rig = turnRest(readRig(asset.glb instanceof ArrayBuffer ? asset.glb : asset.glb.buffer.slice(asset.glb.byteOffset, asset.glb.byteOffset + asset.glb.byteLength)),
          asset.restRotation ?? null);
        labels = asset.labels ?? (await (labeler ??= createLabeler({ zipUrl: labelerZip, onStatus: s => report('running', 'label', s) }))).label(rig);
        report('running', 'encode', 'joint labels');
        data = await buildSkeletonBundle(rig, labels, { name: asset.name ?? 'rig', embed: text => gen.encodeText(text),
          motion: { frames: gen.bundle.skeleton.frames, outputTimes: gen.bundle.outputTimes } });
        await gen.useSkeletonData(data);
      } else {
        const key = asset?.skeleton ?? defaultSkeleton;
        report('running', 'encode', `skeleton ${key}`);
        await gen.useSkeleton(`${skeletonsBase}${key}/`);
      }
      if (running.stopped) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      report('running', 'solve', prompt, { evaluations: 0, t: 0 });
      const result = await gen.generate({ text: prompt, seed, onEvaluation: e => report('running', 'solve', prompt, { evaluations: e.evaluations, t: Math.min(e.t, 1) }) });
      report('running', 'bake', 'animated .glb');
      const sk = gen.skeleton;
      const glb = exportMotionGlb({ name: asset?.name ?? sk.name, jointNames: sk.jointNames, parents: sk.parents, rest: sk.rest, fps: sk.fps,
        motion: result.motion, mesh: data?.mesh ?? null,
        extras: { generator: 'UniMate WebGPU (Kaminos)', prompt, seed, skeleton: sk.name, model: 'UniMate v3 (CC BY-NC 4.0)' } });
      const out = {
        glb, motion: result.motion, skeleton: sk,
        rig: rig ? { names: rig.names, pruned: rig.pruned, labels: labels.clean, face: labels.face, restRotation: rig.restRotation ?? null, mesh: Boolean(data?.mesh) } : null,
        report: { prompt, seed, evaluations: result.evaluations, steps: result.steps.length, wallMs: result.wallMs, dutyCount: result.dutyCount, textEncoder: result.textEncoder },
      };
      state.last = { prompt, seed, skeleton: sk.name, glbBytes: glb.byteLength, evaluations: result.evaluations };
      report('done', null, `${sk.name}: ${prompt}`);
      return out;
    } catch (e) {
      state.error = String(e?.message ?? e);
      report(e?.name === 'AbortError' ? 'stopped' : 'failed', state.stage, state.error);
      throw e;
    } finally {
      running = null;
    }
  }

  return {
    read: () => ({ ...state }),
    run,
    stop(reason = 'stopped by user') { if (running) running.stopped = true; generator?.stop(reason); },
    // Persistence (saving the .glb, inserting it into the scene) belongs to the host; nothing to retry here.
    retryPersistence: async () => ({ ...state }),
    memoryEstimate: unimateMemoryEstimate,
  };
}
