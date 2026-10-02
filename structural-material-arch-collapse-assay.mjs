import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createArchCollapse, coarsenArchProfile } from './structural-material-arch-collapse.js';
import * as CANNON from 'cannon-es';
import { inspectArchCollapseState } from './structural-material-arch-collapse-evidence.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2];
if (!output) throw new Error('usage: node structural-material-arch-collapse-assay.mjs OUTPUT.json');
const profilePath = 'artifacts/structural-material-3d/stone-arch-source-pair-2026-09-24/arch-proxy-witness/intact-profile.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const report = { status: 'running', phase: 'source', started: new Date().toISOString(), root,
  command: process.argv, sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sources: {}, cases: [] };
function save() { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2)); }
save();
try {
  for (const file of [profilePath, 'structural-material-arch-collapse.js', 'package-lock.json', 'node_modules/cannon-es/dist/cannon-es.js']) {
    report.sources[file] = hash(fs.readFileSync(path.join(root, file)));
  }
  const profile = coarsenArchProfile(JSON.parse(fs.readFileSync(path.join(root, profilePath))), 14, 10);
  for (const strength of [80, 120, 160]) for (const injured of [false, true]) {
    report.phase = `strength-${strength}-${injured ? 'injured' : 'intact'}`;
    const model = createArchCollapse(profile, { strength, timeStep: 1 / 60, solverIterations: 20 });
    const result = { strength, injured, inputs: [], frames: [] };
    report.cases.push(result); save();
    try {
      for (let i = 0; i < 120; i++) model.step();
      result.frames.push({ name: 'standing', state: model.snapshot() });
      const target = model.cells.find(cell => cell.layer === 2 && cell.row === 1 && !cell.pinned);
      const localPoint = { x: 0, y: 0, z: target.half.z };
      const start = { ...target.body.pointToWorldFrame(new CANNON.Vec3(0, 0, target.half.z)) };
      result.contact = { id: target.id, index: target.index, start };
      for (let i = 0; i < 60; i++) {
        if (injured) {
          const point = { x: start.x - 1.5 * (i + 1) / 60, y: start.y, z: start.z + 0.5 * (i + 1) / 60 };
          result.inputs.push({ step: 121 + i, index: target.index, target: point, localPoint });
          model.setHand(target.index, point, localPoint);
        }
        model.step();
      }
      result.frames.push({ name: 'release', state: model.snapshot() });
      model.release();
      for (let i = 0; i < 480; i++) {
        model.step();
        if ((i + 1) % 60 === 0) result.frames.push({ name: `after-release-${(i + 1) / 60}s`, state: model.snapshot() });
      }
      const final = result.frames.at(-1).state;
      result.integrity = result.frames.map(frame => ({ frame: frame.name,
        ...inspectArchCollapseState(frame.state, { strength, layers: 3, timeStep: 1/60, solverIterations: 20 }) }));
      if (result.integrity.some(item => item.errors.length)) throw new Error('invalid physics state; see frame integrity');
      result.summary = { standingBroken: result.frames[0].state.broken, finalBroken: final.broken,
        postReleaseCracks: final.events.filter(event => event.kind === 'crack' && event.step > 180).length,
        maximumCrownDrop: Math.max(...final.bodies.filter(body => body.row >= 8).map(body => body.rest.y - body.position.y)),
        meanStepMs: final.samples.reduce((sum, sample) => sum + sample.milliseconds, 0) / final.samples.length,
        components: final.components };
      console.log(JSON.stringify({ strength, injured, ...result.summary }));
    } finally { model.dispose(); save(); }
  }
  report.status = 'complete'; report.phase = 'complete';
} catch (error) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally { report.finished = new Date().toISOString(); save(); }
