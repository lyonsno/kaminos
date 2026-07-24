#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ARTIFACT_MANIFEST_SCHEMA = 'kaminos.fluid.package-artifact-manifest.v1';
const BUILD_REPORT_SCHEMA = 'kaminos.fluid.package-build-report.v1';
const BUILD_REPORT_FILENAME = 'kaminos-fluid-webgpu-build-report.json';

function requiredArgument(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    throw new Error(`missing required argument ${name}`);
  }
  return args[index + 1];
}

const args = process.argv.slice(2);
let requestedRepoRoot;
let destination;
let stagingRoot;
let attemptId;
const quarantinedOutputs = [];
let phase = 'parse-arguments';
let lastTrustworthyEvidence = 'process-started';

try {
  requestedRepoRoot = requiredArgument(args, '--repo-root');
  destination = resolve(requiredArgument(args, '--destination'));
  mkdirSync(destination, { recursive: true });
  lastTrustworthyEvidence = 'destination-created';

  phase = 'prepare-destination';
  attemptId = `${Date.now()}-${process.pid}`;
  const priorOutputs = readdirSync(destination, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((filename) => (
      /^kaminos-fluid-webgpu-\d+\.\d+\.\d+\.(?:tgz|manifest\.json)$/.test(filename)
      || filename === BUILD_REPORT_FILENAME
    ));
  if (priorOutputs.length > 0) {
    const quarantineRoot = join(destination, '.superseded', attemptId);
    mkdirSync(quarantineRoot, { recursive: true });
    for (const filename of priorOutputs) {
      const quarantinePath = join('.superseded', attemptId, filename);
      renameSync(join(destination, filename), join(destination, quarantinePath));
      quarantinedOutputs.push({ filename, quarantinePath });
    }
    lastTrustworthyEvidence = 'canonical-output-quarantined';
  }

  phase = 'validate-source';
  const effectiveRepoRoot = realpathSync(resolve(requestedRepoRoot));
  const runtimeSource = join(effectiveRepoRoot, 'fluid-webgpu', 'mapped-macro-core.js');
  const runtimePackageSource = join(effectiveRepoRoot, 'fluid-webgpu', 'package.json');
  const contractsSource = join(effectiveRepoRoot, 'fluid-contracts');
  for (const path of [runtimeSource, runtimePackageSource, join(contractsSource, 'index.js')]) {
    if (!existsSync(path)) {
      throw new Error(`required package source is missing: ${path}`);
    }
  }
  lastTrustworthyEvidence = 'source-validated';

  phase = 'stage-package';
  stagingRoot = mkdtempSync(join(tmpdir(), 'kaminos-fluid-webgpu-pack-'));
  const packageRoot = join(stagingRoot, 'package');
  const artifactBuildRoot = join(stagingRoot, 'artifact');
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(artifactBuildRoot, { recursive: true });
  const packageJson = JSON.parse(readFileSync(runtimePackageSource, 'utf8'));
  writeFileSync(join(packageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  copyFileSync(runtimeSource, join(packageRoot, 'mapped-macro-core.js'));
  execFileSync('npm', [
    'install',
    '--ignore-scripts',
    '--install-links=true',
    '--no-package-lock',
    '--no-save',
    contractsSource,
  ], {
    cwd: packageRoot,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const runtimeModule = await import(pathToFileURL(join(packageRoot, 'mapped-macro-core.js')));
  const descriptor = runtimeModule.KAMINOS_FLUID_PACKAGE_DESCRIPTOR;
  if (!descriptor || descriptor.packageName !== packageJson.name || descriptor.packageVersion !== packageJson.version) {
    throw new Error('runtime descriptor does not match the staged package identity');
  }
  lastTrustworthyEvidence = 'package-staged';

  phase = 'pack-artifact';
  const packResults = JSON.parse(execFileSync('npm', [
    'pack',
    '.',
    '--pack-destination', artifactBuildRoot,
    '--json',
  ], {
    cwd: packageRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }));
  const packResult = packResults[0];
  if (!packResult || !existsSync(join(artifactBuildRoot, packResult.filename))) {
    throw new Error('npm pack did not produce the reported artifact');
  }
  lastTrustworthyEvidence = 'tarball-produced';

  phase = 'write-manifest';
  const manifestFilename = `kaminos-fluid-webgpu-${packageJson.version}.manifest.json`;
  const manifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    status: 'complete',
    packageName: descriptor.packageName,
    packageVersion: descriptor.packageVersion,
    artifactRevision: descriptor.artifactRevision,
    runtimeRevision: descriptor.runtimeRevision,
    runtimeRoute: descriptor.runtimeRoute,
    representationRoutes: descriptor.representationRoutes,
    sourceRoutes: descriptor.sourceRoutes,
    outputRoutes: descriptor.outputRoutes,
    artifact: {
      filename: packResult.filename,
      integrity: packResult.integrity,
      shasum: packResult.shasum,
      size: packResult.size,
      unpackedSize: packResult.unpackedSize,
      bundled: packResult.bundled,
    },
  };
  writeFileSync(join(artifactBuildRoot, manifestFilename), `${JSON.stringify(manifest, null, 2)}\n`);

  phase = 'promote-artifact';
  const tarballTemporary = join(destination, `.${packResult.filename}.${attemptId}.tmp`);
  const manifestTemporary = join(destination, `.${manifestFilename}.${attemptId}.tmp`);
  copyFileSync(join(artifactBuildRoot, packResult.filename), tarballTemporary);
  copyFileSync(join(artifactBuildRoot, manifestFilename), manifestTemporary);
  renameSync(tarballTemporary, join(destination, packResult.filename));
  renameSync(manifestTemporary, join(destination, manifestFilename));
  lastTrustworthyEvidence = 'artifact-promoted';
  packResult.manifest = {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    filename: manifestFilename,
  };
  packResult.buildRoute = {
    requestedRepoRoot,
    effectiveRepoRoot,
  };
  process.stdout.write(`${JSON.stringify(packResults, null, 2)}\n`);
} catch (error) {
  if (destination) {
    const report = {
      schema: BUILD_REPORT_SCHEMA,
      status: 'failed',
      phase,
      lastTrustworthyEvidence,
      requestedRepoRoot: requestedRepoRoot ?? null,
      effectiveRepoRoot: null,
      attemptId: attemptId ?? null,
      quarantinedOutputs,
      error: {
        name: error.name,
        message: error.message,
      },
    };
    try {
      mkdirSync(destination, { recursive: true });
      writeFileSync(join(destination, BUILD_REPORT_FILENAME), `${JSON.stringify(report, null, 2)}\n`);
    } catch {
      // The requested destination itself may be unusable; stderr remains the final evidence surface.
    }
  }
  process.stderr.write(`fluid package build failed during ${phase}: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (stagingRoot) {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}
