#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  assessCrawlerContactAtlas,
  deriveCrawlerContactAtlas,
  loadGlbPositionMesh,
} from '../lirm-support-atlas-proposal-core.mjs';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('usage: lirm-support-atlas-admission-assay --manifest manifest.json --report report.json');
    }
    args.set(key.slice(2), value);
  }
  if (!args.has('manifest') || !args.has('report')) {
    throw new Error('assay requires --manifest and --report');
  }
  return {
    manifestPath: resolve(args.get('manifest')),
    reportPath: resolve(args.get('report')),
  };
}

function jsonHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function arrayHash(values) {
  return createHash('sha256').update(JSON.stringify(Array.from(values))).digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function axisAlignedRegistration(mesh, cast) {
  const specification = cast.registration;
  if (specification?.mode !== 'axis-aligned-crawler-frame-v0') {
    throw new Error(`${cast.id} requires an explicit crawler registration`);
  }
  const { min, max } = mesh.bounds;
  const insetFraction = Number(specification.axialAnchorInsetFraction ?? 0.03);
  const inset = (max[2] - min[2]) * insetFraction;
  const centerY = (min[1] + max[1]) * 0.5;
  return {
    schema: 'kaminos.axial-crawler-registration.v0',
    asset: cast.glbPath,
    source: cast.sourceImagePath ?? null,
    bounds: mesh.bounds,
    contactPlaneY: min[1],
    fitMode: 'authored-axis-aligned-bounds-v0',
    localForwardAxis: specification.localForwardAxis,
    localRightAxis: specification.localRightAxis,
    localUpAxis: specification.localUpAxis,
    headAnchor: [0, centerY, min[2] + inset],
    tailAnchor: [0, centerY, max[2] - inset],
    deformationHint: {
      mode: 'axial-bend-with-attached-radial-detail',
      stationWeightAxis: 'Z',
      preserveCrossSectionAxes: ['X', 'Y'],
    },
  };
}

function compareAtlasMembership(actual, expected) {
  const patches = actual.patches.map((patch, index) => {
    const accepted = expected.patches?.[index];
    return {
      id: patch.id,
      expectedId: accepted?.id ?? null,
      contactCountMatch: patch.vertexIndices.length === accepted?.vertexIndices?.length,
      influenceCountMatch: patch.influenceVertexIndices.length === accepted?.influenceVertexIndices?.length,
      contactMembershipMatch: arrayHash(patch.vertexIndices) === arrayHash(accepted?.vertexIndices ?? []),
      influenceMembershipMatch:
        arrayHash(patch.influenceVertexIndices) === arrayHash(accepted?.influenceVertexIndices ?? []),
    };
  });
  return {
    schema: 'kaminos.support-atlas-control-comparison.v0',
    exactMembershipMatch: patches.every(patch => (
      patch.id === patch.expectedId
      && patch.contactCountMatch
      && patch.influenceCountMatch
      && patch.contactMembershipMatch
      && patch.influenceMembershipMatch
    )),
    patches,
  };
}

async function main() {
  const { manifestPath, reportPath } = parseArgs(process.argv.slice(2));
  let failurePhase = 'manifest-load';
  let lastTrustworthyEvidence = 'none';
  let assayId = 'unknown';
  let routeIdentity = null;
  const castResults = [];
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assayId = String(manifest.assayId ?? 'unknown');
    routeIdentity = manifest.routeIdentity ?? null;
    lastTrustworthyEvidence = 'manifest-loaded';
    if (manifest.schema !== 'kaminos.support-atlas-admission-manifest.v0') {
      throw new Error('support-atlas assay manifest schema mismatch');
    }

    failurePhase = 'route-identity';
    if (!routeIdentity?.requested || !routeIdentity?.effective) {
      throw new Error('support-atlas assay requires requested and effective route identity');
    }
    if (routeIdentity.requested !== routeIdentity.effective) {
      throw new Error(
        `effective route mismatch: requested ${routeIdentity.requested}, observed ${routeIdentity.effective}`,
      );
    }
    lastTrustworthyEvidence = 'route-identity-verified';

    failurePhase = 'load-casts';
    if (!Array.isArray(manifest.casts) || manifest.casts.length === 0) {
      throw new Error('support-atlas assay requires at least one cast');
    }
    for (const cast of manifest.casts) {
      const glbPath = resolve(cast.glbPath);
      const mesh = await loadGlbPositionMesh(glbPath);
      const registration = cast.registrationPath
        ? JSON.parse(await readFile(resolve(cast.registrationPath), 'utf8'))
        : axisAlignedRegistration(mesh, cast);
      const registrationHash = jsonHash(registration);
      const identity = {
        castId: cast.id,
        castHash: mesh.sha256.slice('sha256:'.length),
        registrationHash,
      };
      const atlas = deriveCrawlerContactAtlas(
        mesh.positions,
        registration,
        identity,
        cast.derivationOptions ?? {},
      );
      const assessment = assessCrawlerContactAtlas({
        atlas,
        positions: mesh.positions,
        registration,
        expectedIdentity: identity,
      });
      let controlComparison = null;
      if (cast.acceptedAtlasPath) {
        const acceptedAtlas = JSON.parse(await readFile(resolve(cast.acceptedAtlasPath), 'utf8'));
        controlComparison = compareAtlasMembership(atlas, acceptedAtlas);
        if (!controlComparison.exactMembershipMatch) {
          assessment.classification = 'reject';
          assessment.rejectionReasons.push({
            severity: 'reject',
            code: 'control-membership-drift',
            message: `${cast.id} proposal did not reproduce its accepted control atlas`,
          });
        }
      }
      const castOutputDir = resolve(cast.outputDir);
      await writeJson(resolve(castOutputDir, 'registration.json'), registration);
      await writeJson(resolve(castOutputDir, 'proposed-contact-atlas.json'), atlas);
      await writeJson(resolve(castOutputDir, 'assessment.json'), assessment);
      if (controlComparison) {
        await writeJson(resolve(castOutputDir, 'control-comparison.json'), controlComparison);
      }
      castResults.push({
        id: cast.id,
        role: cast.role,
        glbPath,
        sourceImagePath: cast.sourceImagePath ? resolve(cast.sourceImagePath) : null,
        outputDir: castOutputDir,
        geometry: {
          sha256: mesh.sha256,
          bytes: mesh.bytes,
          vertexCount: mesh.vertexCount,
          triangleCount: mesh.triangleCount,
          primitiveCount: mesh.primitiveCount,
          bounds: mesh.bounds,
        },
        registrationHash,
        derivationOptions: cast.derivationOptions ?? {},
        authoredEdits: cast.authoredEdits ?? [],
        classification: assessment.classification,
        rejectionReasons: assessment.rejectionReasons,
        patchDiagnostics: assessment.patchDiagnostics,
        controlComparison,
      });
    }
    lastTrustworthyEvidence = 'all-casts-assessed';
    failurePhase = null;
    await writeJson(reportPath, {
      schema: 'kaminos.support-atlas-admission-assay-report.v0',
      assayId,
      status: 'complete',
      routeIdentity,
      manifestPath,
      reportPath,
      casts: castResults,
      classificationSummary: Object.fromEntries(
        castResults.map(cast => [cast.id, cast.classification]),
      ),
      lastTrustworthyEvidence,
    });
    console.log(reportPath);
  } catch (error) {
    await writeJson(reportPath, {
      schema: 'kaminos.support-atlas-admission-assay-report.v0',
      assayId,
      status: 'failed',
      routeIdentity,
      manifestPath,
      reportPath,
      failurePhase,
      lastTrustworthyEvidence,
      error: error?.stack ?? String(error),
      casts: castResults,
    });
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}

await main();
