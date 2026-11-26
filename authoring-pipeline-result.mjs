import {readNdjsonResult} from './ndjson-result.mjs';

// Progress and final result of /api/run-pipeline.
export function readPipelineRunStream(response, onProgress) {
  return readNdjsonResult(response, {
    isProgress: event => event.schema === 'kaminos.pipeline-progress.v0',
    isResult: event => event.schema === 'kaminos.pipeline-run-result.v0',
    onProgress,
    missingResult: 'Pipeline stream ended without a run result',
  });
}

function normalizeArtifactCollection(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection.filter(Boolean);
  if (typeof collection === 'object') {
    return Object.entries(collection).filter(([, artifact]) => artifact && typeof artifact === 'object')
      .map(([id, artifact]) => ({ id: artifact.id || id, ...artifact }));
  }
  return [];
}

function pipelineRunArtifactRecords(result) {
  const byId = new Map();
  for (const artifact of [...normalizeArtifactCollection(result?.bundle?.document?.artifacts), ...normalizeArtifactCollection(result?.report?.document?.artifacts)]) {
    const key = artifact.id || artifact.path || JSON.stringify(artifact);
    if (!byId.has(key)) byId.set(key, artifact);
  }
  return [...byId.values()];
}

export function pipelineRunOutputArtifacts(result) {
  return pipelineRunArtifactRecords(result).filter(artifact => {
    const role = (artifact.role || artifact.type || '').toString().toLowerCase(), id = (artifact.id || '').toString().toLowerCase();
    if (!artifact?.path) return false;
    if (id === 'input' || id === 'source' || id === 'sidecar' || role.includes('sidecar') || role === 'input' || role === 'source') return false;
    return true;
  });
}

export function pipelineArtifactIsLoadableMesh(artifact) {
  return typeof artifact?.path === 'string' && artifact.path.toLowerCase().endsWith('.glb');
}

export function pipelineRunReadUrlForPath(result, artifactPath) {
  const outputRoot = result?.bundle?.document?.outputRoot;
  if (!outputRoot || !artifactPath || !artifactPath.startsWith(outputRoot)) return null;
  const runDir = outputRoot.split('/').filter(Boolean).at(-1);
  const rel = artifactPath.slice(outputRoot.length).replace(/^\/+/, '');
  return `/api/read?root=pipeline-runs&path=${encodeURIComponent([runDir, rel].filter(Boolean).join('/'))}`;
}
