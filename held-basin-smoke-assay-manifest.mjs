import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HELD_SMOKE_ASSAY_MANIFEST_SCHEMA,
  HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
  HELD_SMOKE_ASSAY_TEMPORAL_AUTHORITY,
  validateSmokeSplatMotionManifest,
} from './smoke-splat-motion-source.mjs';

const PRODUCER_AUTHORITY = 'real-field-hierarchical-smoke-splat-producer-v0';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function identity(value, label) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${label} is required`);
  return value;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`${label} could not be read: ${error.message}`, { cause: error });
  }
}

function sameSource(report, routeCell, viewerIdentity, viewer) {
  if (report.schema !== 'kaminos.held-smoke-hierarchy-report.v0'
    || report.status !== 'captured'
    || report.routeCell !== routeCell) {
    throw new Error(`Route ${routeCell} report is not a captured held hierarchy product`);
  }
  const source = report.source || {};
  const expectedFluid = `sha256:${viewer.fluid.sha256}`;
  const expectedCapture = `sha256:${viewer.source.sourceCaptureManifestSha256}`;
  if (source.manifestIdentity !== viewerIdentity
    || source.fluidIdentity !== expectedFluid
    || source.sourceCaptureIdentity !== expectedCapture
    || source.simStepCount !== viewer.initialSimStepCount
    || source.cameraIdentity !== `sha256:${viewer.__cameraIdentity}`) {
    throw new Error(`Route ${routeCell} does not share the common held source or fluid identity`);
  }
  if (source.effectiveRoute !== viewer.source.effectiveRoute || source.backend !== viewer.source.backend || source.grid !== viewer.grid) {
    throw new Error(`Route ${routeCell} source route, backend, or grid differs from the held replay`);
  }
}

async function productFromReport(report, routeCell, reportPath, outputPath) {
  const requestedArtifactPath = identity(report.artifact?.path, `Route ${routeCell} artifact path`);
  const artifactPath = isAbsolute(requestedArtifactPath)
    ? requestedArtifactPath
    : resolve(dirname(reportPath), requestedArtifactPath);
  const bytes = await readFile(artifactPath);
  if (bytes.byteLength !== report.artifact.byteLength || sha256(bytes) !== report.artifact.sha256) {
    throw new Error(`Route ${routeCell} artifact checksum or byte length mismatch`);
  }
  return {
    ...report.product,
    routeCell,
    artifact: {
      ...report.artifact,
      path: relative(dirname(outputPath), artifactPath),
    },
  };
}

export async function writeHeldSmokeAssayManifest(options = {}) {
  const outputPath = resolve(identity(options.outputPath, 'held smoke assay output path'));
  await mkdir(dirname(outputPath), { recursive: true });
  let phase = 'viewer-admission';
  let primaryManifestWritten = false;
  let viewerIdentity = null;
  const admittedRoutes = [];
  try {
    const viewerPath = resolve(identity(options.viewerManifestPath, 'viewer manifest path'));
    const viewerBytes = await readFile(viewerPath);
    const viewerSha = sha256(viewerBytes);
    if (typeof options.expectedViewerManifestSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(options.expectedViewerManifestSha256)
      || viewerSha !== options.expectedViewerManifestSha256) {
      throw new Error(`requested viewer manifest sha256 mismatch: ${viewerSha} != ${options.expectedViewerManifestSha256 || '(missing)'}`);
    }
    const viewer = JSON.parse(viewerBytes.toString('utf8'));
    if (viewer.schema !== 'kaminos.volume.operator-basin-replay.v0' || viewer.status !== 'captured' || viewer.failurePhase !== null) {
      throw new Error('viewer manifest is not a captured operator basin replay');
    }
    viewerIdentity = `sha256:${viewerSha}`;
    phase = 'report-read';
    const routeAReportPath = resolve(identity(options.routeAReportPath, 'Route A report path'));
    const routeBReportPath = resolve(identity(options.routeBReportPath, 'Route B report path'));
    const routeA = await readJson(routeAReportPath, 'Route A report');
    const routeB = await readJson(routeBReportPath, 'Route B report');
    phase = 'source-coherence';
    const expectedCameraIdentity = `sha256:${sha256(Buffer.from(JSON.stringify(viewer.camera)))}`;
    if (routeA.source?.cameraIdentity !== expectedCameraIdentity || routeB.source?.cameraIdentity !== expectedCameraIdentity) {
      throw new Error('Route A and B camera identities do not match the checksum-bound viewer camera');
    }
    viewer.__cameraIdentity = expectedCameraIdentity.replace(/^sha256:/, '');
    sameSource(routeA, 'A', viewerIdentity, viewer);
    admittedRoutes.push('A');
    sameSource(routeB, 'B', viewerIdentity, viewer);
    admittedRoutes.push('B');
    phase = 'artifact-verification';
    const products = [
      await productFromReport(routeA, 'A', routeAReportPath, outputPath),
      await productFromReport(routeB, 'B', routeBReportPath, outputPath),
    ];
    const manifest = {
      schema: HELD_SMOKE_ASSAY_MANIFEST_SCHEMA,
      status: 'passed',
      requestedRoute: HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
      effectiveRoute: HELD_SMOKE_ASSAY_ROUTE_IDENTITY,
      fallbackReason: null,
      temporalAuthority: HELD_SMOKE_ASSAY_TEMPORAL_AUTHORITY,
      producerAuthority: PRODUCER_AUTHORITY,
      source: {
        manifestIdentity: viewerIdentity,
        sourceCaptureIdentity: `sha256:${viewer.source.sourceCaptureManifestSha256}`,
        fluidIdentity: `sha256:${viewer.fluid.sha256}`,
        cameraIdentity: expectedCameraIdentity,
        simStepCount: viewer.initialSimStepCount,
        grid: viewer.grid,
        backend: viewer.source.backend,
        effectiveRoute: viewer.source.effectiveRoute,
      },
      camera: viewer.camera,
      products,
      openRoute: {
        routeCell: 'C',
        status: 'open',
        blocker: {
          class: 'abi',
          detail: 'neural history smoke decoder has no checksum-bound production raster product for this held source',
        },
      },
    };
    phase = 'manifest-validation';
    validateSmokeSplatMotionManifest(manifest);
    phase = 'manifest-write';
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
    primaryManifestWritten = true;
    return manifest;
  } catch (error) {
    const failure = {
      schema: HELD_SMOKE_ASSAY_MANIFEST_SCHEMA,
      status: 'failed',
      failurePhase: phase,
      requested: {
        viewerManifestPath: options.viewerManifestPath || null,
        viewerManifestSha256: options.expectedViewerManifestSha256 || null,
        routeAReportPath: options.routeAReportPath || null,
        routeBReportPath: options.routeBReportPath || null,
        outputPath,
      },
      lastTrustworthyEvidence: {
        viewerManifestIdentity: viewerIdentity,
        admittedRoutes,
        primaryManifestWritten,
      },
      error: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    };
    await writeFile(`${outputPath}.failure.json`, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) args.set(argv[index], argv[index + 1]);
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await writeHeldSmokeAssayManifest({
    viewerManifestPath: args.get('--viewer-manifest'),
    expectedViewerManifestSha256: args.get('--viewer-manifest-sha256'),
    routeAReportPath: args.get('--route-a-report'),
    routeBReportPath: args.get('--route-b-report'),
    outputPath: args.get('--out'),
  });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}
