import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildArchStructuralProxy } from './structural-material-arch-core.js';
import { advanceArchVolumeLoad, releaseArchStructuralLoad, bindReleasedArchVolume } from './structural-material-arch-volume-view.js';

const [output, roundsInput = '30'] = process.argv.slice(2);
if (!output) throw new Error('usage: node structural-material-arch-construction-assay.mjs OUTPUT.json [ROUNDS]');
const root = dirname(fileURLToPath(import.meta.url));
const path = resolve(output);
const rounds = Number(roundsInput);
const report = { schema: 'kaminos.arch-depth-construction-comparison.v0', status: 'running',
  phase: 'inputs', startedAt: new Date().toISOString(), root, output: path, rounds,
  effectiveRoute: 'cpu-overdamped-linear-spring', cases: {},
  load: { x: -0.05, y: 0.29, force: 2, patchRadius: 0.025, threshold: 0.04, iterations: 600,
    contactDepthMode: 'camera-facing-surface' },
  evolution: { duration: 0.1, timeStep: 0.02, damping: 8 } };
const save = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`); };
const motion = state => Array.from({ length: state.layers }, (_, layer) => {
  const nodes = state.nodes.filter(node => node.layer === layer);
  const volume = nodes.reduce((sum, node) => sum + (node.materialVolume ?? 1), 0);
  return { layer, z: nodes[0].z, max: Math.max(...nodes.map(node => Math.hypot(...Object.values(node.displacement)))),
    rms: Math.sqrt(nodes.reduce((sum, node) => sum + (node.materialVolume ?? 1) *
      Object.values(node.displacement).reduce((sum, value) => sum + value * value, 0), 0) / volume) };
});
save();
try {
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('rounds must be a positive integer');
  report.revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  report.sourceHashes = Object.fromEntries(['structural-material-arch-core.js', 'structural-material-arch-volume-view.js',
    'structural-material-arch-construction-assay.mjs'].map(name => [name, createHash('sha256').update(readFileSync(resolve(root, name))).digest('hex')]));
  report.dirtyPaths = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).map(line => line.slice(3));
  for (const name of ['intact', 'outer-notch']) {
    const profilePath = resolve(root, `artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/${name}-profile.json`);
    const bytes = readFileSync(profilePath);
    const profile = JSON.parse(bytes);
    for (const [variant, options] of Object.entries({
      'sparse-depth-3': { construction: 'sparse-depth', layers: 3 },
      'volume-braced-3': { construction: 'cell-volume-braced', layers: 3 },
      'volume-braced-auto': { construction: 'cell-volume-braced' },
    })) {
      report.phase = `${name}/${variant}`;
      const base = buildArchStructuralProxy(profile, options);
      const load = { ...report.load, contactLayer: base.layers - 1 };
      const item = { source: profile.source, profilePath, profileSha256: createHash('sha256').update(bytes).digest('hex'),
        construction: base.construction, layers: base.layers, nodes: base.nodes.length, bonds: base.bonds.length,
        depthDiagonalBonds: base.bonds.filter(bond => bond.kind === 'depth-diagonal').length, load, intervals: [] };
      report.cases[`${name}/${variant}`] = item;
      let state = base;
      let priorBroken = new Set();
      let eventCount = 0;
      for (let round = 1; round <= rounds; round += 1) {
        const start = performance.now();
        state = advanceArchVolumeLoad(state, load, report.evolution);
        const milliseconds = performance.now() - start;
        const broken = state.bonds.filter(bond => !bond.alive);
        const ids = new Set(broken.map(bond => bond.id));
        if ([...priorBroken].some(id => !ids.has(id)) || state.events.length < eventCount) throw new Error('damage/history was reset');
        if (state.nodes.some(node => node.pinned && Object.values(node.displacement).some(value => value !== 0))) throw new Error('support moved');
        if (state.load.loadedNodeLayers.length !== 1 || state.load.loadedNodeLayers[0] !== base.layers - 1) throw new Error('force reached a non-front layer directly');
        const keys = new Set(state.load.contactCells.map(cell => `${cell.column}:${cell.row}`));
        const loaded = state.nodes.filter(node => node.layer === base.layers - 1 && keys.has(`${node.column}:${node.row}`));
        const componentIds = new Set(loaded.map(node => node.componentId));
        item.intervals.push({ round, elapsed: state.loadApplication.elapsed, milliseconds, broken: broken.length,
          brokenBondIds: broken.map(bond => bond.id), eventCount: state.events.length, epoch: state.connectivityEpoch,
          travel: state.load.travel, relativeResidual: state.load.relativeResidual, loadedLayers: state.load.loadedNodeLayers,
          depthMotion: motion(state), components: state.components.length,
          loadedComponents: [...componentIds].map(id => ({ id, size: state.components[id].size,
            supported: state.nodes.some(node => node.componentId === id && node.pinned) })) });
        priorBroken = ids;
        eventCount = state.events.length;
        save();
      }
      const released = releaseArchStructuralLoad(state, load).state;
      const bound = bindReleasedArchVolume(released, load);
      const smallLoad = { ...load, force: 0.1 };
      item.smallReload = {};
      for (const [label, input] of Object.entries({ damaged: released, bound, fresh: base })) {
        const result = advanceArchVolumeLoad(input, smallLoad, report.evolution);
        item.smallReload[label] = { travel: result.load.travel, broken: result.bonds.filter(bond => !bond.alive).length,
          depthMotion: motion(result) };
      }
      if (Math.abs(item.smallReload.bound.travel - item.smallReload.fresh.travel) > 1e-10) throw new Error('Bind did not restore fresh response');
      save();
      console.log(name, variant, 'layers', item.layers, 'final', item.intervals.at(-1).travel,
        'broken', item.intervals.at(-1).broken, 'components', item.intervals.at(-1).components);
    }
  }
  report.phase = 'complete';
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { phase: report.phase, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally { report.finishedAt = new Date().toISOString(); save(); }
