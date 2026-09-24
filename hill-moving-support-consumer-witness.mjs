import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  BIG_PAPA_MOVING_SUPPORT_REVISION,
  HILL_MOVING_SUPPORT_CONSUMER_SCHEMA,
  HILL_SUPPORT_PACKAGE_COORDINATE,
} from './hill-moving-support-consumer.mjs';

const WITNESS_SCHEMA =
  'kaminos.hill-moving-support-consumer-witness.v1';
const PACKAGE_REPORT_SCHEMA =
  'lerms.hill-of-hills.analytic-impact-package-witness.v1';
const HANDOFF_SOURCE_PATH = 'finger-fluid-analytic-impact-handoff.js';
const BIG_PAPA_CORE_SOURCE_PATH = 'finger-fluid-webgpu-core.js';
const CONSUMER_SOURCE_PATHS = Object.freeze([
  'finger-fluid-analytic-impact-handoff.js',
  'finger-fluid-webgpu-core.js',
  'hill-moving-support-consumer-witness.mjs',
  'hill-moving-support-consumer.mjs',
]);
const repoRoot = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${key}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${key}`);
    }
    values.set(key, value);
    index += 1;
  }
  if (!values.has('--output-dir')) {
    throw new Error('--output-dir is required');
  }
  return {
    outputDir: resolve(values.get('--output-dir')),
    packageReportPath: values.has('--package-report')
      ? resolve(values.get('--package-report'))
      : null,
    expectedHillRevision: values.get('--expected-hill-revision'),
    expectedBigPapaRevision: values.get('--expected-big-papa-revision'),
    expectedConsumerRevision: values.get('--expected-consumer-revision'),
  };
}

function digest(algorithm, bytes, encoding) {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function exactRevision(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(String(value ?? ''))) {
    throw new Error(`${label} must be an exact Git revision`);
  }
  return String(value);
}

function exactDigest(value, label) {
  if (!/^[0-9a-f]{64}$/i.test(String(value ?? ''))) {
    throw new Error(`${label} must be an exact SHA-256 digest`);
  }
  return String(value);
}

function sourceTreeSha256(repositoryRoot, repositoryPaths) {
  const hash = createHash('sha256');
  for (const repositoryPath of [...repositoryPaths].sort()) {
    const bytes = readFileSync(join(repositoryRoot, repositoryPath));
    hash.update(repositoryPath);
    hash.update('\0');
    hash.update(String(bytes.length));
    hash.update('\0');
    hash.update(bytes);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    const error = new Error(
      [
        `${command} ${args.join(' ')} failed`,
        result.stderr?.trim(),
        result.stdout?.trim(),
      ].filter(Boolean).join(': '),
    );
    error.status = result.status;
    throw error;
  }
  return result.stdout.trim();
}

function consumerSourceIdentity(expectedRevision) {
  const exactExpectedRevision = exactRevision(
    expectedRevision,
    'expected Kaminos consumer revision',
  );
  const repositoryRoot = run('git', ['rev-parse', '--show-toplevel']);
  const repositoryHead = run('git', ['rev-parse', 'HEAD']);
  if (repositoryHead !== exactExpectedRevision) {
    throw new Error(
      `expected Kaminos consumer revision ${exactExpectedRevision} differs from repository HEAD ${repositoryHead}`,
    );
  }
  run(
    'git',
    [
      'ls-files',
      '--error-unmatch',
      '--',
      ...CONSUMER_SOURCE_PATHS,
    ],
  );
  const dirty = run(
    'git',
    [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--',
      ...CONSUMER_SOURCE_PATHS,
    ],
  );
  if (dirty.length > 0) {
    throw new Error(`Kaminos consumer-relevant source is dirty:\n${dirty}`);
  }
  return Object.freeze({
    repositoryRoot,
    repositoryHead,
    repositoryPaths: CONSUMER_SOURCE_PATHS,
    sourceTreeSha256: sourceTreeSha256(
      repositoryRoot,
      CONSUMER_SOURCE_PATHS,
    ),
  });
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}

if (config) {
  mkdirSync(config.outputDir, { recursive: true });
  const reportPath = join(config.outputDir, 'report.json');
  const exercisePath = join(config.outputDir, 'exercise.json');
  rmSync(exercisePath, { force: true });
  const report = {
    schema: WITNESS_SCHEMA,
    ok: false,
    failurePhase: 'validate-config',
    primaryOutputWritten: false,
    artifactFreshness: 'not_built',
    lastTrustworthyEvidence: {
      phase: 'argument-parse',
    },
    requested: {
      hillPackageCoordinate: HILL_SUPPORT_PACKAGE_COORDINATE,
      hillSourceRevision: config.expectedHillRevision,
      bigPapaRevision: config.expectedBigPapaRevision,
      consumerRevision: config.expectedConsumerRevision,
      packageReportPath: config.packageReportPath,
      outputDir: config.outputDir,
      fallbackRoute: null,
    },
    effective: null,
    primaryArtifact: null,
  };
  writeJson(reportPath, report);
  let consumerDir;

  try {
    exactRevision(config.expectedHillRevision, 'expected Hill source revision');
    exactRevision(
      config.expectedBigPapaRevision,
      'expected Big Papa source revision',
    );
    exactRevision(
      config.expectedConsumerRevision,
      'expected Kaminos consumer revision',
    );
    if (!config.packageReportPath) {
      throw new Error('--package-report is required');
    }
    if (
      config.expectedBigPapaRevision !== BIG_PAPA_MOVING_SUPPORT_REVISION
    ) {
      throw new Error(
        'requested Big Papa revision differs from the owned consumer contract',
      );
    }

    report.failurePhase = 'validate-package-receipt';
    if (!existsSync(config.packageReportPath)) {
      throw new Error(`Hill package report does not exist: ${config.packageReportPath}`);
    }
    const packageReport = JSON.parse(
      readFileSync(config.packageReportPath, 'utf8'),
    );
    if (
      packageReport.schema !== PACKAGE_REPORT_SCHEMA
      || packageReport.ok !== true
      || packageReport.primaryOutputWritten !== true
      || packageReport.failurePhase !== null
    ) {
      throw new Error('Hill package receipt did not reach primary output');
    }
    const requestedHillRevision = exactRevision(
      packageReport.requested?.sourceRevision,
      'package receipt requested Hill source revision',
    );
    const effectiveHillRevision = exactRevision(
      packageReport.effective?.sourceRevision,
      'package receipt effective Hill source revision',
    );
    const effectiveHillRepositoryHead = exactRevision(
      packageReport.effective?.repositoryHead,
      'package receipt effective Hill repository HEAD',
    );
    const effectiveHillSourceTreeSha256 = exactDigest(
      packageReport.effective?.sourceTreeSha256,
      'package receipt effective Hill source tree',
    );
    if (
      requestedHillRevision !== config.expectedHillRevision
      || effectiveHillRevision !== config.expectedHillRevision
      || effectiveHillRepositoryHead !== config.expectedHillRevision
      || packageReport.effective?.packageCoordinate
        !== HILL_SUPPORT_PACKAGE_COORDINATE
      || packageReport.effective?.exportSubpath
        !== './hill-of-hills/analytic-impact-support'
      || packageReport.fallbackRoute !== null
    ) {
      throw new Error(
        'Hill package receipt does not match the requested source and route',
      );
    }
    if (
      !Array.isArray(packageReport.effective?.repositoryPaths)
      || packageReport.effective.repositoryPaths.length === 0
      || packageReport.effective.repositoryPaths.some(
        (path) => typeof path !== 'string' || path.length === 0,
      )
    ) {
      throw new Error('Hill package receipt does not identify its effective source paths');
    }
    if (packageReport.artifactFreshness !== 'built_current_run') {
      throw new Error('Hill package receipt does not identify a current-run artifact');
    }
    const tarballPath = resolve(packageReport.artifact?.path ?? '');
    const expectedSha256 = exactDigest(
      packageReport.artifact?.sha256,
      'witnessed Hill package',
    );
    if (!existsSync(tarballPath)) {
      throw new Error(`witnessed Hill package artifact does not exist: ${tarballPath}`);
    }

    report.failurePhase = 'verify-package-artifact';
    const tarballBytes = readFileSync(tarballPath);
    const actualSha256 = digest('sha256', tarballBytes, 'hex');
    const actualIntegrity =
      `sha512-${digest('sha512', tarballBytes, 'base64')}`;
    if (
      actualSha256 !== expectedSha256
      || actualIntegrity !== packageReport.artifact.integrity
      || tarballBytes.length !== packageReport.artifact.byteLength
    ) {
      throw new Error(
        'Hill package artifact SHA-256, integrity, or byte length differs from its witness',
      );
    }
    report.lastTrustworthyEvidence = {
      phase: 'package-artifact-verified',
      path: tarballPath,
      sha256: actualSha256,
      integrity: actualIntegrity,
      byteLength: tarballBytes.length,
    };

    report.failurePhase = 'verify-consumer-source';
    const consumerSource = consumerSourceIdentity(
      config.expectedConsumerRevision,
    );
    report.lastTrustworthyEvidence = {
      phase: 'consumer-source-identity-verified',
      consumerRevision: consumerSource.repositoryHead,
      consumerSourceTreeSha256: consumerSource.sourceTreeSha256,
    };

    report.failurePhase = 'verify-big-papa-source';
    run(
      'git',
      [
        'merge-base',
        '--is-ancestor',
        config.expectedBigPapaRevision,
        'HEAD',
      ],
    );
    const consumerHead = run('git', ['rev-parse', 'HEAD']);
    const expectedHandoffBlobSha = run(
      'git',
      [
        'rev-parse',
        `${config.expectedBigPapaRevision}:${HANDOFF_SOURCE_PATH}`,
      ],
    );
    const effectiveHandoffBlobSha = run(
      'git',
      ['hash-object', HANDOFF_SOURCE_PATH],
    );
    if (effectiveHandoffBlobSha !== expectedHandoffBlobSha) {
      throw new Error(
        'effective Big Papa handoff source differs from the requested revision',
      );
    }
    const baseBigPapaCoreBlobSha = run(
      'git',
      [
        'rev-parse',
        `${config.expectedBigPapaRevision}:${BIG_PAPA_CORE_SOURCE_PATH}`,
      ],
    );
    const composedConsumerCoreBlobSha = run(
      'git',
      ['hash-object', BIG_PAPA_CORE_SOURCE_PATH],
    );

    report.effective = {
      hillPackageCoordinate: HILL_SUPPORT_PACKAGE_COORDINATE,
      hillSourceRevision: effectiveHillRevision,
      hillSourceRepositoryHead: effectiveHillRepositoryHead,
      hillSourceTreeSha256: effectiveHillSourceTreeSha256,
      hillSourcePaths: packageReport.effective.repositoryPaths,
      hillPackageArtifactSha256: actualSha256,
      hillPackageArtifactIntegrity: actualIntegrity,
      hillPackageArtifactPath: tarballPath,
      bigPapaBaseRevision: config.expectedBigPapaRevision,
      consumerHead,
      consumerRevision: consumerSource.repositoryHead,
      consumerRepositoryRoot: consumerSource.repositoryRoot,
      consumerSourcePaths: consumerSource.repositoryPaths,
      consumerSourceTreeSha256: consumerSource.sourceTreeSha256,
      bigPapaHandoffBlobSha: effectiveHandoffBlobSha,
      bigPapaCoreBaseBlobSha: baseBigPapaCoreBlobSha,
      composedConsumerCoreBlobSha,
      fallbackRoute: null,
    };
    report.lastTrustworthyEvidence = {
      phase: 'source-identities-verified',
      hillSourceRevision: report.effective.hillSourceRevision,
      hillSourceTreeSha256: effectiveHillSourceTreeSha256,
      hillPackageArtifactSha256: actualSha256,
      bigPapaBaseRevision: config.expectedBigPapaRevision,
      bigPapaHandoffBlobSha: effectiveHandoffBlobSha,
      composedConsumerCoreBlobSha,
      consumerRevision: consumerSource.repositoryHead,
      consumerSourceTreeSha256: consumerSource.sourceTreeSha256,
    };

    report.failurePhase = 'clean-install-package';
    consumerDir = mkdtempSync(
      join(tmpdir(), 'kaminos-hill-moving-support-consumer-'),
    );
    writeJson(
      join(consumerDir, 'package.json'),
      {
        private: true,
        type: 'module',
      },
    );
    run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        tarballPath,
      ],
      { cwd: consumerDir },
    );

    report.failurePhase = 'exercise-consumer';
    const runnerPath = join(consumerDir, 'run.mjs');
    const adapterUrl = pathToFileURL(
      join(repoRoot, 'hill-moving-support-consumer.mjs'),
    ).href;
    writeFileSync(
      runnerPath,
      [
        "import { readFileSync } from 'node:fs';",
        `import * as hillSupportModule from ${JSON.stringify(HILL_SUPPORT_PACKAGE_COORDINATE)};`,
        `import { exerciseHillMovingSupportConsumer } from ${JSON.stringify(adapterUrl)};`,
        `const packageCoordinate = ${JSON.stringify(HILL_SUPPORT_PACKAGE_COORDINATE)};`,
        'const analyticModuleUrl = import.meta.resolve(packageCoordinate);',
        "const terrainModuleUrl = new URL('./hill-of-hills.js', analyticModuleUrl);",
        'const hillTerrainModule = await import(terrainModuleUrl);',
        "const packageReport = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
        'const receipt = exerciseHillMovingSupportConsumer({',
        '  hillSupportModule,',
        '  hillTerrainModule,',
        '  packageReport,',
        '});',
        'process.stdout.write(JSON.stringify({',
        '  receipt,',
        '  resolution: {',
        '    analyticModuleUrl,',
        '    terrainFixtureModuleUrl: terrainModuleUrl.href,',
        '  },',
        '}));',
      ].join('\n'),
    );
    const runnerResult = run(
      process.execPath,
      [runnerPath, config.packageReportPath],
      { cwd: consumerDir },
    );
    const exerciseResult = JSON.parse(runnerResult);
    const exercise = exerciseResult.receipt;
    if (
      exercise?.schema !== HILL_MOVING_SUPPORT_CONSUMER_SCHEMA
      || exercise.status !== 'passed'
      || exercise.requested?.hillPackageCoordinate
        !== HILL_SUPPORT_PACKAGE_COORDINATE
      || exercise.effective?.hillPackageSourceRevision
        !== config.expectedHillRevision
      || exercise.effective?.hillPackageArtifactSha256 !== actualSha256
      || exercise.requested?.bigPapaRevision
        !== config.expectedBigPapaRevision
      || exercise.effective?.fallbackRoute !== null
    ) {
      throw new Error('consumer exercise returned partial or substituted identity');
    }
    report.effective.hillPackageImportUrl =
      exerciseResult.resolution.analyticModuleUrl;
    report.effective.hillTerrainFixtureImportUrl =
      exerciseResult.resolution.terrainFixtureModuleUrl;

    report.failurePhase = 'recheck-consumer-source';
    const postExerciseConsumerSourceTreeSha256 = sourceTreeSha256(
      consumerSource.repositoryRoot,
      consumerSource.repositoryPaths,
    );
    if (
      postExerciseConsumerSourceTreeSha256
        !== consumerSource.sourceTreeSha256
    ) {
      throw new Error('Kaminos consumer-relevant source changed during exercise');
    }

    const primaryBytes = Buffer.from(
      `${JSON.stringify(exercise, null, 2)}\n`,
    );
    writeFileSync(exercisePath, primaryBytes);
    report.primaryOutputWritten = true;
    report.artifactFreshness = 'built_current_run';
    report.primaryArtifact = {
      schema: exercise.schema,
      path: exercisePath,
      byteLength: primaryBytes.length,
      sha256: digest('sha256', primaryBytes, 'hex'),
    };
    report.failurePhase = null;
    report.ok = true;
    report.lastTrustworthyEvidence = {
      phase: 'complete-primary-output',
      exerciseSha256: report.primaryArtifact.sha256,
      hillPackageArtifactSha256: actualSha256,
      bigPapaHandoffBlobSha: effectiveHandoffBlobSha,
    };
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    process.exitCode = 1;
  } finally {
    writeJson(reportPath, report);
    if (consumerDir) {
      rmSync(consumerDir, { recursive: true, force: true });
    }
  }
}
