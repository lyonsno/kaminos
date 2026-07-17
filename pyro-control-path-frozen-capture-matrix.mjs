#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFrozenCaptureMatrix,
  PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA,
} from './pyro-control-path-frozen-capture-ledger.mjs';

export const PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_MANIFEST_SCHEMA = 'kaminos.pyro-control-path.frozen-capture-matrix-manifest.v0';

export async function buildFrozenCaptureMatrixFromManifest(manifest, { repoRoot = process.cwd() } = {}) {
  if (manifest?.schema !== PYRO_CONTROL_PATH_FROZEN_CAPTURE_MATRIX_MANIFEST_SCHEMA) {
    throw new Error(`wrong frozen capture matrix manifest schema: ${manifest?.schema}`);
  }
  if (!Array.isArray(manifest.rows) || manifest.rows.length === 0) {
    throw new Error('frozen capture matrix manifest requires rows');
  }
  const ledgerArtifact = await readJsonArtifact(resolve(repoRoot, manifest.enumerationLedger));
  const controls = new Map((ledgerArtifact.value.controls || []).map(control => [control.routeKey, control]));
  const rows = [];
  for (const manifestRow of manifest.rows) {
    const comparisonArtifact = await readJsonArtifact(resolve(repoRoot, manifestRow.comparison));
    const comparison = comparisonArtifact.value;
    if (comparison.schema !== PYRO_CONTROL_PATH_FROZEN_CAPTURE_SCHEMA) {
      throw new Error(`${manifestRow.control} comparison has wrong schema: ${comparison.schema}`);
    }
    if (comparison.control !== manifestRow.control) {
      throw new Error(`${manifestRow.control} manifest row points at comparison for ${comparison.control}`);
    }
    const staticControl = controls.get(manifestRow.control);
    if (!staticControl) throw new Error(`${manifestRow.control} is absent from the uncapped enumeration ledger`);
    const sourceEvidence = [];
    for (const evidence of manifestRow.sourceEvidence || []) {
      sourceEvidence.push(await resolveSourceEvidence(evidence, repoRoot));
    }
    rows.push({
      family: manifestRow.family,
      claimedStage: manifestRow.claimedStage,
      routeSemantics: manifestRow.routeSemantics,
      comparison,
      comparisonArtifact: {
        path: manifestRow.comparison,
        sha256: comparisonArtifact.sha256,
      },
      staticEnumeration: {
        owningStage: staticControl.owningStage,
        downstreamStages: staticControl.downstreamStages,
        classificationHint: staticControl.classificationHint,
        uiId: staticControl.uiId,
        controlName: staticControl.controlName,
        range: staticControl.range,
      },
      sourceFieldHashes: [
        {
          identity: 'enumerated-ui-source-field-v0',
          sha256: staticControl.sourceFieldHash,
          line: staticControl.source?.indexHtmlLine ?? null,
          routeHydrated: staticControl.source?.routeHydrated === true,
          listenedBySyncControls: staticControl.source?.listenedBySyncControls === true,
        },
        {
          identity: 'frozen-capture-comparison-artifact-v0',
          sha256: comparisonArtifact.sha256,
        },
      ],
      sourceEvidence,
    });
  }
  const matrix = buildFrozenCaptureMatrix({
    enumerationCount: ledgerArtifact.value.enumeration?.count ?? ledgerArtifact.value.controls?.length,
    rows,
  });
  let noiseControl = null;
  if (manifest.noiseControlComparison) {
    const artifact = await readJsonArtifact(resolve(repoRoot, manifest.noiseControlComparison));
    noiseControl = {
      path: manifest.noiseControlComparison,
      sha256: artifact.sha256,
      classification: artifact.value.classification,
      control: artifact.value.control,
      requested: artifact.value.requested,
      pixelDelta: artifact.value.deltas?.pixel || null,
    };
    if (noiseControl.classification !== 'browser-gpu-frozen-capture-no-delta') {
      throw new Error(`noise control comparison is not no-delta: ${noiseControl.classification}`);
    }
  }
  return {
    ...matrix,
    generation: {
      identity: 'manifest-driven-frozen-capture-matrix-generation-v0',
      enumerationLedger: manifest.enumerationLedger,
      enumerationLedgerSha256: ledgerArtifact.sha256,
      uncapped: true,
    },
    noiseControl,
  };
}

async function resolveSourceEvidence(evidence, repoRoot) {
  const path = resolve(repoRoot, evidence.path);
  const bytes = await readFile(path);
  const source = bytes.toString('utf8');
  const marker = String(evidence.marker || '');
  const offset = source.indexOf(marker);
  if (!marker || offset < 0) throw new Error(`source evidence marker is missing from ${evidence.path}: ${marker}`);
  let scope = marker;
  if (evidence.scopeEnd) {
    const endMarker = String(evidence.scopeEnd);
    const endOffset = source.indexOf(endMarker, offset + marker.length);
    if (endOffset < 0) throw new Error(`source evidence scope end is missing from ${evidence.path}: ${endMarker}`);
    scope = source.slice(offset, endOffset + endMarker.length);
  }
  const excludedMarkers = (evidence.absent || []).map(String);
  for (const excluded of excludedMarkers) {
    if (scope.includes(excluded)) {
      throw new Error(`source evidence scope in ${evidence.path} unexpectedly contains excluded marker: ${excluded}`);
    }
  }
  return {
    identity: 'exact-source-marker-evidence-v0',
    stage: evidence.stage,
    path: evidence.path,
    line: source.slice(0, offset).split('\n').length,
    marker,
    markerSha256: sha256(Buffer.from(marker)),
    scopeSha256: sha256(Buffer.from(scope)),
    excludedMarkers,
    fileSha256: sha256(bytes),
  };
}

async function readJsonArtifact(path) {
  const bytes = await readFile(path);
  return { value: JSON.parse(bytes.toString('utf8')), sha256: sha256(bytes) };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else { values.set(key, next); index += 1; }
  }
  return values;
}

function required(args, key) {
  const value = args.get(key);
  if (!value || value === true) throw new Error(`missing ${key}`);
  return String(value);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(String(args.get('--repo-root') || process.cwd()));
  const manifestPath = resolve(repoRoot, required(args, '--manifest'));
  const outPath = resolve(repoRoot, required(args, '--out'));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const matrix = await buildFrozenCaptureMatrixFromManifest(manifest, { repoRoot });
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(matrix, null, 2)}\n`);
  console.log(JSON.stringify({
    schema: 'kaminos.pyro-control-path.frozen-capture-matrix-cli.v0',
    outPath,
    matrixSchema: matrix.schema,
    auditedControlCount: matrix.auditedControlCount,
    summary: matrix.summary,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
