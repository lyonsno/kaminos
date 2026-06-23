#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';

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

let phase = 'initializing';
let manifest = null;
let manifestSha256 = null;
let pipeline = null;
let lastTrustworthyEvidence = {};
const stages = [];
const artifacts = {};

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

function requireInputs() {
  if (!inputPath) throw new Error('missing --input');
  if (!outDir) throw new Error('missing --out-dir');
  if (!existsSync(inputPath)) throw new Error(`input artifact does not exist: ${inputPath}`);
}

function makeFixturePly(outputPath) {
  const inputBytes = readFileSync(inputPath);
  const inputHash = sha256Bytes(inputBytes);
  mkdirSync(dirname(outputPath), { recursive: true });
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
}

function makeSidecar(outputPath) {
  const splatPath = artifactPathFor('splat');
  const inputEvidence = fileEvidence(inputPath);
  const splatEvidence = fileEvidence(splatPath);
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
      renderCapabilities: {
        realHybridRender: false,
        meshDepthOcclusion: false,
        sharedCanvasComposite: false,
        sharedCommandEncoder: false,
      },
    },
    status: {
      stageMode: 'fixture',
      truthBoundary: 'fixture-backed pipeline witness; not real SHARP, MoGE, SuperMat, Trellis, or hybrid render proof',
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
  if (stage.statusMode === 'adapter-check') {
    availability = adapterAvailability(stage);
    effectiveRoute.availability = availability;
    effectiveRoute.realModel = false;
    status = availability.status === 'available' ? 'real' : 'skipped';
    makeAdapterAvailabilityReport(outputPath, stage, availability);
  } else if (existsSync(outputPath)) {
    status = 'cached';
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'inspection') {
    status = 'real';
    makePreparedInspection(outputPath);
  } else if (stage.statusMode === 'prepared-artifact' && stage.outputArtifact === 'sidecar') {
    status = 'real';
    makePreparedSidecar(outputPath);
  } else if (stage.outputArtifact === 'splat') {
    makeFixturePly(outputPath);
  } else if (stage.outputArtifact === 'sidecar') {
    makeSidecar(outputPath);
  } else {
    throw new Error(`unsupported fixture stage output artifact: ${stage.outputArtifact}`);
  }

  const evidence = fileEvidence(outputPath);
  artifacts[stage.outputArtifact] = {
    role: pipeline.artifacts[stage.outputArtifact]?.role || stage.outputArtifact,
    status,
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
  writeReport({ ok: true });
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
