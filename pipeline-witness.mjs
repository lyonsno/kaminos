#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (!key.startsWith('--')) continue;
  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(key, next);
    i++;
  } else {
    args.set(key, '1');
  }
}

const defaultManifest = new URL('./pipelines/asset-pipelines.json', import.meta.url).pathname;
const manifestPath = resolve(args.get('--manifest') || defaultManifest);
const requestedPipelineId = args.get('--pipeline-id') || 'evil-orb-sharp-fixture-pbr-v0';
const inputPath = args.get('--input') ? resolve(args.get('--input')) : null;
const outDir = args.get('--out-dir') ? resolve(args.get('--out-dir')) : null;
const reportPath = args.get('--report') ? resolve(args.get('--report')) : (outDir ? join(outDir, 'pipeline-witness.json') : resolve('/tmp/kaminos-pipeline-witness.json'));
const bundleIndexPath = outDir ? join(outDir, 'pipeline-run.index.json') : null;

let phase = 'initializing';
let manifest = null;
let manifestSha256 = null;
let pipeline = null;
let lastTrustworthyEvidence = {};
const stages = [];
const artifacts = {};
const sharpFixtureSplatCandidates = [
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb_trimmed_050.ply',
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb_full_pbr_2k.ply',
  '/Users/noahlyons/.local/state/kaminos-smoke/splats/inbox/evil_orb.ply',
].map(path => ({ path, mode: 'local-candidate' }));

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function artifactPathFor(artifactId) {
  const artifact = pipeline?.artifacts?.[artifactId];
  if (!artifact?.pathTemplate) return null;
  if (isAbsolute(artifact.pathTemplate)) {
    throw new Error(`artifact ${artifactId} uses an absolute pathTemplate; pipeline outputs must be caller-rooted`);
  }
  return resolve(outDir, artifact.pathTemplate);
}

function fileEvidence(path) {
  const stat = statSync(path);
  return {
    path,
    bytes: stat.size,
    sha256: sha256Bytes(readFileSync(path)),
  };
}

function candidatePathList(value) {
  return (value || '')
    .split(delimiter)
    .map(candidate => candidate.trim())
    .filter(Boolean);
}

function resolveSharpFixtureSplat() {
  const explicitPath = (process.env.KAMINOS_SHARP_FIXTURE_SPLAT || '').trim();
  const explicitCandidates = explicitPath ? [{ path: explicitPath, mode: 'env' }] : [];
  const listCandidates = candidatePathList(process.env.KAMINOS_SHARP_FIXTURE_SPLAT_CANDIDATES)
    .map(path => ({ path, mode: 'env-candidate-list' }));
  for (const candidate of [...explicitCandidates, ...listCandidates, ...sharpFixtureSplatCandidates]) {
    const resolvedPath = resolve(candidate.path);
    if (!existsSync(resolvedPath)) continue;
    const stat = statSync(resolvedPath);
    if (!stat.isFile()) continue;
    return {
      path: resolvedPath,
      mode: candidate.mode,
    };
  }
  return null;
}

function reportBase(extra = {}) {
  return {
    schema: 'kaminos.pipeline-witness.v0',
    ok: extra.ok ?? false,
    requestedPipelineId,
    effectivePipelineId: pipeline?.id || null,
    phase,
    effectiveRouteConfig: {
      routeId: pipeline?.routeId || null,
      manifestPath,
      manifestSha256,
      outputRoot: outDir,
      stageCount: Array.isArray(pipeline?.stages) ? pipeline.stages.length : 0,
    },
    artifacts,
    stages,
    lastTrustworthyEvidence,
    ...extra,
  };
}

function writeReport(extra = {}) {
  writeJson(reportPath, reportBase(extra));
}

function buildBundleIndex() {
  return {
    schema: 'kaminos.pipeline-run-bundle.v0',
    registryScope: 'run-local',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    outputRoot: outDir,
    report: {
      path: reportPath,
      status: 'written',
    },
    stageStatuses: stages.map(stage => ({
      id: stage.id,
      status: stage.status,
      routeId: stage.requestedRoute,
    })),
    artifacts: Object.entries(artifacts).map(([id, artifact]) => ({
      id,
      role: artifact.role,
      status: artifact.status,
      path: artifact.path,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      fixtureSource: artifact.fixtureSource || null,
    })),
  };
}

function writeBundleIndex() {
  if (!bundleIndexPath) throw new Error('missing --out-dir for bundle index');
  writeJson(bundleIndexPath, buildBundleIndex());
  return {
    path: bundleIndexPath,
    status: 'written',
    ...fileEvidence(bundleIndexPath),
  };
}

function requireInputs() {
  if (!inputPath) throw new Error('missing --input');
  if (!outDir) throw new Error('missing --out-dir');
  if (!existsSync(inputPath)) throw new Error(`input artifact does not exist: ${inputPath}`);
}

function makeFixturePly(outputPath) {
  const fixtureSource = resolveSharpFixtureSplat();
  mkdirSync(dirname(outputPath), { recursive: true });
  if (fixtureSource) {
    copyFileSync(fixtureSource.path, outputPath);
    return {
      stageMode: 'fixture',
      mode: fixtureSource.mode,
      truthBoundary: 'fixture-backed copied SHARP-derived splat; not live SHARP inference',
      ...fileEvidence(fixtureSource.path),
    };
  }

  const inputBytes = readFileSync(inputPath);
  const inputHash = sha256Bytes(inputBytes);
  writeFileSync(outputPath, [
    'ply',
    'format ascii 1.0',
    'comment kaminos fixture splat candidate',
    `comment source_path ${inputPath}`,
    `comment source_sha256 ${inputHash}`,
    'element vertex 1',
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header',
    '0 0 0 255 128 32',
    '',
  ].join('\n'));
  return {
    stageMode: 'fixture',
    mode: 'generated-placeholder',
    path: null,
    bytes: null,
    sha256: null,
    inputPath,
    inputSha256: inputHash,
    truthBoundary: 'generated one-vertex placeholder because no SHARP fixture splat source was configured or found',
  };
}

function makeSidecar(outputPath, options = {}) {
  const splatPath = artifactPathFor('splat');
  const inputEvidence = fileEvidence(inputPath);
  const splatEvidence = fileEvidence(splatPath);
  const stageMode = options.stageMode || artifacts.splat?.status || 'fixture';
  const truthBoundary = options.truthBoundary || 'fixture-backed pipeline witness; not real SHARP, MoGE, SuperMat, Trellis, or hybrid render proof';
  writeJson(outputPath, {
    schema: 'kaminos.pipeline-import-sidecar.v0',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    source: {
      inputPath,
      inputSha256: inputEvidence.sha256,
    },
    asset: {
      type: 'splat',
      path: splatPath,
      sha256: splatEvidence.sha256,
      bytes: splatEvidence.bytes,
      fixtureSource: artifacts.splat?.fixtureSource || null,
      renderCapabilities: {
        realHybridRender: false,
        meshDepthOcclusion: false,
        sharedCanvasComposite: false,
        sharedCommandEncoder: false,
      },
    },
    status: {
      stageMode,
      truthBoundary,
    },
  });
}

function classifyPreparedArtifact(path) {
  const extension = extname(path).toLowerCase();
  if (['.ply', '.spz'].includes(extension)) return { kind: 'splat', extension };
  if (['.glb', '.gltf', '.obj'].includes(extension)) return { kind: 'mesh', extension };
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) return { kind: 'source-image', extension };
  return { kind: 'unknown', extension };
}

function makePreparedInspection(outputPath) {
  const evidence = fileEvidence(inputPath);
  const classification = classifyPreparedArtifact(inputPath);
  writeJson(outputPath, {
    schema: 'kaminos.prepared-artifact-inspection.v0',
    artifact: {
      ...evidence,
      kind: classification.kind,
      extension: classification.extension,
      preparedElsewhere: true,
    },
    route: {
      id: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    truthBoundary: 'local prepared-artifact inspection only; no model execution and no renderer proof',
  });
}

function makePreparedSidecar(outputPath) {
  const inspectionPath = artifactPathFor('inspection');
  const inspection = readJson(inspectionPath);
  const inputEvidence = fileEvidence(inputPath);
  writeJson(outputPath, {
    schema: 'kaminos.pipeline-import-sidecar.v0',
    pipeline: {
      id: pipeline.id,
      routeId: pipeline.routeId,
      manifestPath,
      manifestSha256,
    },
    source: {
      inputPath,
      inputSha256: inputEvidence.sha256,
      preparedArtifactInspectionPath: inspectionPath,
      preparedArtifactKind: inspection.artifact.kind,
    },
    asset: {
      type: inspection.artifact.kind,
      path: inputPath,
      sha256: inputEvidence.sha256,
      bytes: inputEvidence.bytes,
      renderCapabilities: {
        realHybridRender: false,
        meshDepthOcclusion: false,
        sharedCanvasComposite: false,
        sharedCommandEncoder: false,
      },
    },
    status: {
      stageMode: 'prepared-artifact',
      truthBoundary: 'prepared artifact sidecar; points at an existing local artifact and does not claim model generation or hybrid render proof',
    },
  });
}

function findCommand(command) {
  if (!command) return null;
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function adapterAvailability(stage) {
  const envVar = stage.route?.commandEnv || null;
  const configuredCommand = envVar ? (process.env[envVar] || '').trim() : '';
  if (!configuredCommand) {
    return {
      status: 'unconfigured',
      envVar,
      configuredCommand: null,
      resolvedCommand: null,
    };
  }
  const resolvedCommand = findCommand(configuredCommand);
  return {
    status: resolvedCommand ? 'available' : 'missing',
    envVar,
    configuredCommand,
    resolvedCommand,
  };
}

function makeAdapterAvailabilityReport(outputPath, stage, availability) {
  writeJson(outputPath, {
    schema: 'kaminos.route-adapter-availability.v0',
    route: {
      id: stage.route?.id || stage.id,
      tool: stage.route?.tool || null,
      modelFamily: stage.route?.modelFamily || null,
      executesModel: false,
    },
    availability,
    execution: {
      executed: false,
      reason: 'availability-check-only',
    },
    input: {
      path: inputPath,
      sha256: fileEvidence(inputPath).sha256,
    },
  });
}

function liveAdapterReportPath(outputPath, stage) {
  const safeStage = String(stage.id || 'adapter').replace(/[^A-Za-z0-9_.-]+/g, '-');
  return join(dirname(outputPath), `${safeStage}.adapter-report.json`);
}

function recordFailedStage(stage, outputPath, effectiveRoute, error) {
  stages.push({
    id: stage.id,
    label: stage.label || stage.id,
    status: 'failed',
    requestedRoute: stage.route?.id || stage.id,
    effectiveRoute,
    inputArtifact: stage.inputArtifact,
    outputArtifact: stage.outputArtifact,
    outputPath,
    error: error?.message || String(error),
  });
}

function runLiveModelAdapter(outputPath, stage) {
  const availability = adapterAvailability(stage);
  const adapterReportPath = liveAdapterReportPath(outputPath, stage);
  const effectiveRoute = {
    id: stage.route?.id || stage.id,
    tool: stage.route?.tool || 'SHARP',
    effectiveBackend: stage.route?.effectiveBackend || 'external-command',
    realModel: true,
    executesModel: stage.route?.executesModel === true,
    commandEnv: stage.route?.commandEnv || null,
    availability,
    adapterReportPath,
  };
  if (availability.status !== 'available') {
    const error = new Error(`live model adapter unavailable: ${availability.envVar || 'command env'} is ${availability.status}`);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter did not execute; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const command = availability.resolvedCommand || availability.configuredCommand;
  const commandArgs = [
    '--input', inputPath,
    '--output', outputPath,
    '--report', adapterReportPath,
  ];
  effectiveRoute.executedCommand = [command, ...commandArgs];
  const proc = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_PIPELINE_INPUT: inputPath,
      KAMINOS_PIPELINE_OUTPUT: outputPath,
      KAMINOS_PIPELINE_ADAPTER_REPORT: adapterReportPath,
      KAMINOS_PIPELINE_OUTPUT_ROOT: outDir,
    },
  });
  effectiveRoute.exitCode = proc.status;
  effectiveRoute.signal = proc.signal || null;
  effectiveRoute.stdoutTail = (proc.stdout || '').slice(-4000);
  effectiveRoute.stderrTail = (proc.stderr || '').slice(-4000);
  if (proc.error || proc.status !== 0) {
    const message = proc.error?.message || `live model adapter exited ${proc.status}`;
    const error = new Error(message);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter failed; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }
  if (!existsSync(outputPath)) {
    const error = new Error(`live model adapter completed without writing output: ${outputPath}`);
    effectiveRoute.truthBoundary = 'requested live SHARP adapter produced no output; no fixture fallback was used';
    recordFailedStage(stage, outputPath, effectiveRoute, error);
    throw error;
  }
  const outputEvidence = fileEvidence(outputPath);
  effectiveRoute.outputSha256 = outputEvidence.sha256;
  effectiveRoute.outputBytes = outputEvidence.bytes;
  effectiveRoute.truthBoundary = 'live SHARP adapter output; external command produced the splat artifact';
  return effectiveRoute;
}

function runStage(stage) {
  phase = `stage:${stage.id}`;
  const outputPath = artifactPathFor(stage.outputArtifact);
  if (!outputPath) throw new Error(`stage ${stage.id} has no caller-rooted output artifact`);
  const requestedRoute = stage.route?.id || stage.id;
  const effectiveRoute = {
    id: requestedRoute,
    tool: stage.route?.tool || 'pipeline-witness.mjs',
    effectiveBackend: stage.route?.effectiveBackend || stage.statusMode || 'fixture',
    realModel: stage.route?.realModel === true,
  };
  let status = stage.statusMode || 'fixture';
  let availability = null;
  let fixtureSource = null;
  if (stage.statusMode === 'adapter-check') {
    availability = adapterAvailability(stage);
    effectiveRoute.availability = availability;
    effectiveRoute.realModel = false;
    status = availability.status === 'available' ? 'real' : 'skipped';
    makeAdapterAvailabilityReport(outputPath, stage, availability);
  } else if (existsSync(outputPath)) {
    status = 'cached';
  } else if (stage.statusMode === 'model-adapter' && stage.outputArtifact === 'splat') {
    status = 'real';
    Object.assign(effectiveRoute, runLiveModelAdapter(outputPath, stage));
  } else if (stage.statusMode === 'model-adapter' && stage.outputArtifact === 'sidecar') {
    status = 'real';
    makeSidecar(outputPath, {
      stageMode: 'real',
      truthBoundary: 'live SHARP adapter output sidecar; splat was produced by the configured external model command',
    });
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'inspection') {
    status = 'real';
    makePreparedInspection(outputPath);
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'sidecar') {
    status = 'real';
    makePreparedSidecar(outputPath);
  } else if (stage.outputArtifact === 'splat') {
    fixtureSource = makeFixturePly(outputPath);
    effectiveRoute.fixtureSource = fixtureSource.path;
    effectiveRoute.fixtureSourceMode = fixtureSource.mode;
    effectiveRoute.fixtureSourceSha256 = fixtureSource.sha256;
    effectiveRoute.fixtureSourceBytes = fixtureSource.bytes;
    effectiveRoute.truthBoundary = fixtureSource.truthBoundary;
  } else if (stage.outputArtifact === 'sidecar') {
    makeSidecar(outputPath);
  } else {
    throw new Error(`unsupported fixture stage output artifact: ${stage.outputArtifact}`);
  }

  const evidence = fileEvidence(outputPath);
  artifacts[stage.outputArtifact] = {
    role: pipeline.artifacts[stage.outputArtifact]?.role || stage.outputArtifact,
    status,
    ...(fixtureSource ? { fixtureSource } : {}),
    ...evidence,
  };
  const record = {
    id: stage.id,
    label: stage.label || stage.id,
    status,
    requestedRoute,
    effectiveRoute,
    inputArtifact: stage.inputArtifact,
    outputArtifact: stage.outputArtifact,
    outputPath,
    outputSha256: evidence.sha256,
    outputBytes: evidence.bytes,
  };
  stages.push(record);
}

try {
  phase = 'loading-manifest';
  if (!existsSync(manifestPath)) throw new Error(`manifest does not exist: ${manifestPath}`);
  const manifestBytes = readFileSync(manifestPath);
  manifestSha256 = sha256Bytes(manifestBytes);
  manifest = JSON.parse(manifestBytes.toString('utf8'));
  lastTrustworthyEvidence = {
    manifestPath,
    manifestSha256,
    manifestSchema: manifest.schema,
    pipelineCount: Array.isArray(manifest.pipelines) ? manifest.pipelines.length : 0,
  };
  if (manifest.schema !== 'kaminos.pipeline-manifest.v0') {
    throw new Error(`unsupported manifest schema: ${manifest.schema}`);
  }

  phase = 'selecting-pipeline';
  pipeline = manifest.pipelines.find(candidate => candidate.id === requestedPipelineId);
  if (!pipeline) throw new Error(`pipeline id not found: ${requestedPipelineId}`);

  phase = 'validating-inputs';
  requireInputs();
  artifacts.input = {
    role: pipeline.artifacts?.input?.role || 'input',
    status: 'requested',
    ...fileEvidence(inputPath),
  };

  phase = 'running-stages';
  mkdirSync(outDir, { recursive: true });
  for (const stage of pipeline.stages || []) {
    runStage(stage);
  }

  phase = 'complete';
  const bundleIndex = writeBundleIndex();
  writeReport({ ok: true, bundleIndex });
} catch (error) {
  const failingStage = stages.at(-1);
  if (failingStage && failingStage.status !== 'failed') failingStage.status = 'failed';
  writeReport({
    ok: false,
    error: error?.message || String(error),
  });
  console.error(error?.stack || error);
  process.exitCode = 1;
}
