import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tool = new URL('../tools/blender_armature_adapter.py', import.meta.url).pathname;

test('keeps Blender Text Editor invocation parameterless', async () => {
  const source = await readFile(tool, 'utf8');
  assert.match(source, /elif "bpy" in sys\.modules:\s*[\s\S]*?argv = \[\]/);
  assert.match(source, /armature_object\.show_in_front = True/);
  assert.match(source, /bone\.use_connect = False/);
  assert.match(source, /candidate = args\.failure or \(args\.out if mode == "scene" else None\)/);
});

const identity = (x, y, z) => [
  1, 0, 0, x,
  0, 1, 0, y,
  0, 0, 1, z,
  0, 0, 0, 1,
];

function sourceGraph({ missing = null, nonFinite = false } = {}) {
  const controls = [
    ['core', null, identity(0, 0, 0)],
    ['pelvis', 'core', identity(0, -1, 0)],
    ['head', 'core', identity(0, 2, 0)],
    ['tail', 'pelvis', identity(0, -2, 0)],
    ['forelimb-left', 'core', identity(1, 1, 0)],
    ['forelimb-right', 'core', identity(-1, 1, 0)],
    ['hindlimb-left-hip', 'pelvis', identity(1, -1, 0)],
    ['hindlimb-left-stifle', 'hindlimb-left-hip', identity(1, -1, -1)],
    ['hindlimb-left-hock', 'hindlimb-left-stifle', identity(1, -1, -2)],
    ['hindlimb-right-hip', 'pelvis', identity(-1, -1, 0)],
    ['hindlimb-right-stifle', 'hindlimb-right-hip', identity(-1, -1, -1)],
    ['hindlimb-right-hock', 'hindlimb-right-stifle', identity(-1, -1, -2)],
  ];
  return {
    schema: 'kaminos.blender-control-source.v0',
    source: {
      requestedPath: '/operator/cat-bauplan-048.blend',
      effectivePath: '/operator/cat-bauplan-048.blend',
      sha256: 'a'.repeat(64),
    },
    controls: controls
      .filter(([name]) => name !== missing)
      .map(([name, parent, matrixWorld]) => ({
        name,
        parent,
        type: 'EMPTY',
        matrixWorld: name === 'pelvis' && nonFinite
          ? matrixWorld.map((value, index) => index === 3 ? 'NaN' : value)
          : matrixWorld,
      })),
  };
}

async function runPlan(graph, profile = 'full') {
  const dir = await mkdtemp(join(tmpdir(), 'kaminos-armature-adapter-'));
  const source = join(dir, 'source.json');
  const out = join(dir, 'plan.json');
  const failure = join(dir, 'failure.json');
  await writeFile(source, JSON.stringify(graph));
  const result = spawnSync('python3', [
    tool,
    '--plan-json', source,
    '--out', out,
    '--failure', failure,
    '--profile', profile,
  ], { encoding: 'utf8' });
  return { result, out, failure };
}

test('plans the bounded hindlimb assay without requiring absent full-body controls', async () => {
  const graph = sourceGraph();
  graph.controls = graph.controls
    .filter(control => [
      'pelvis',
      'hindlimb-left-hip',
      'hindlimb-left-stifle',
      'hindlimb-left-hock',
      'hindlimb-right-hip',
      'hindlimb-right-stifle',
      'hindlimb-right-hock',
    ].includes(control.name))
    .map(control => ({
      ...control,
      parent: control.name === 'pelvis' ? null : control.parent,
      sourceObjectName: control.name === 'hindlimb-left-hock'
        ? 'hindlimb-right-hock.001'
        : control.name,
    }));
  const { result, out } = await runPlan(graph, 'hindlimbs');
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(plan.profile, 'hindlimbs');
  assert.equal(plan.controls.length, 7);
  assert.equal(
    plan.controls.find(control => control.name === 'hindlimb-left-hock').sourceObjectName,
    'hindlimb-right-hock.001',
  );
});

test('plans the exact named hierarchy without inventing control semantics', async () => {
  const { result, out } = await runPlan(sourceGraph());
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(plan.schema, 'kaminos.blender-armature-adapter-plan.v0');
  assert.equal(plan.status, 'planned');
  assert.equal(plan.armature.name, 'KAMINOS_CONTROL_ADAPTER');
  assert.equal(plan.armature.authority, 'authoring-adapter-not-deformation-source');
  assert.deepEqual(plan.controls.map(control => control.name), [
    'core',
    'pelvis',
    'head',
    'tail',
    'forelimb-left',
    'forelimb-right',
    'hindlimb-left-hip',
    'hindlimb-left-stifle',
    'hindlimb-left-hock',
    'hindlimb-right-hip',
    'hindlimb-right-stifle',
    'hindlimb-right-hock',
  ]);
  assert.deepEqual(
    plan.controls.find(control => control.name === 'hindlimb-left-hock'),
    {
      name: 'hindlimb-left-hock',
      parent: 'hindlimb-left-stifle',
      sourceType: 'EMPTY',
      matrixWorld: identity(1, -1, -2),
      deform: true,
    },
  );
  assert.equal(plan.muscleEndpointAuthority, 'external-independent-endpoint-frames');
  assert.equal(plan.bindCastAutomatically, false);
});

test('fails loud with a durable report when a required source control is absent', async () => {
  const { result, out, failure } = await runPlan(sourceGraph({ missing: 'hindlimb-left-hock' }));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(out, 'utf8'));
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.schema, 'kaminos.blender-armature-adapter-failure.v0');
  assert.equal(report.status, 'failed');
  assert.equal(report.failurePhase, 'source-validation');
  assert.equal(report.errorCode, 'missing_control');
  assert.match(report.error, /hindlimb-left-hock/);
  assert.equal(report.lastTrustworthyEvidence, 'source JSON parsed; no adapter plan admitted');
});

test('rejects non-finite source transforms instead of publishing a partial plan', async () => {
  const { result, out, failure } = await runPlan(sourceGraph({ nonFinite: true }));
  assert.notEqual(result.status, 0);
  await assert.rejects(readFile(out, 'utf8'));
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.failurePhase, 'source-validation');
  assert.equal(report.errorCode, 'non_finite_transform');
  assert.match(report.error, /pelvis/);
});

test('does not claim a missing plan source was parsed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kaminos-armature-adapter-missing-'));
  const missing = join(dir, 'absent.json');
  const out = join(dir, 'plan.json');
  const failure = join(dir, 'failure.json');
  const result = spawnSync('python3', [
    tool,
    '--plan-json', missing,
    '--out', out,
    '--failure', failure,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.failurePhase, 'plan-source-read');
  assert.equal(report.errorCode, 'invalid_plan_source');
  assert.equal(report.lastTrustworthyEvidence, 'plan source not admitted');
});

test('refuses to overwrite the plan source with its JSON output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kaminos-armature-adapter-alias-'));
  const source = join(dir, 'source.json');
  const failure = join(dir, 'failure.json');
  const original = JSON.stringify(sourceGraph());
  await writeFile(source, original);
  const result = spawnSync('python3', [
    tool,
    '--plan-json', source,
    '--out', source,
    '--failure', failure,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(source, 'utf8'), original);
  const report = JSON.parse(await readFile(failure, 'utf8'));
  assert.equal(report.failurePhase, 'argument-validation');
  assert.equal(report.errorCode, 'path_alias');
});

test('uses one default scene report path for both success and failure', async () => {
  const source = await readFile(tool, 'utf8');
  assert.doesNotMatch(source, /with_name\("kaminos-armature-adapter-failure\.json"\)/);
  assert.match(source, /return _default_report_path\(bpy\)\.resolve\(\)/);
});

test('protects the currently open Blender scene when selecting a failure path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kaminos-armature-adapter-live-scene-'));
  const activeScene = join(dir, 'current.blend');
  const probe = `
import importlib.util
import json
import sys
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("adapter", ${JSON.stringify(tool)})
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)
sys.modules["bpy"] = SimpleNamespace(data=SimpleNamespace(filepath=${JSON.stringify(activeScene)}))
results = []
for role in ("out", "failure"):
    values = {"plan_json": None, "source_blend": None, "save_as": None, "out": None, "failure": None}
    values[role] = ${JSON.stringify(activeScene)}
    results.append(str(adapter._safe_failure_path(SimpleNamespace(**values), "scene")))
print(json.dumps(results))
`;
  const result = spawnSync('python3', ['-c', probe], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const resolvedDir = await realpath(dir);
  const resolvedReport = join(resolvedDir, 'current.kaminos-armature-adapter-report.json');
  assert.deepEqual(JSON.parse(result.stdout), [resolvedReport, resolvedReport]);
});
