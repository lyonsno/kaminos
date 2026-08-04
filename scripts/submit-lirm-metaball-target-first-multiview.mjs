#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-target-first-multiview-v0');
const manifestPath = join(artifactRoot, 'manifest.json');
const jobIndexPath = join(artifactRoot, 'greenroom-jobs.json');
const failurePath = join(artifactRoot, 'submission-failure.json');
const greenroom = process.env.GPU_GREENROOM_CLI
  ?? '/private/tmp/gpu-greenroom-source-plate-command-0804/.venv/bin/gpu-greenroom';

function readRequiredOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const carrierKind = readRequiredOption('--carrier-kind');
if (!['clay', 'depth', 'normal'].includes(carrierKind)) {
  throw new Error(`unsupported multiview carrier kind: ${carrierKind}`);
}

const viewsById = new Map(manifest.views.map(view => [view.id, view]));
const prior = existsSync(jobIndexPath)
  ? JSON.parse(readFileSync(jobIndexPath, 'utf8'))
  : {
      schema: 'kaminos.lirm-metaball-target-first-multiview-greenroom-jobs.v0',
      carrierKind,
      jobs: [],
    };
if (prior.carrierKind !== carrierKind) {
  throw new Error(`job index carrier mismatch: ${prior.carrierKind} != ${carrierKind}`);
}
const byCell = new Map(prior.jobs.map(job => [job.cellId, job]));

for (const condition of manifest.conditions) {
  for (const seed of manifest.fixedGenerator.seeds) {
    const cellId = `${condition.id}-seed-${seed}`;
    if (byCell.has(cellId)) continue;

    if (!condition.promptPath || !condition.promptSha256) {
      throw new Error(`missing prompt identity for condition ${condition.id}`);
    }
    const promptPath = join(artifactRoot, condition.promptPath);

    const references = condition.referenceViewIds.map(viewId => {
      const view = viewsById.get(viewId);
      const image = view?.sourceImages?.[carrierKind];
      if (!image?.relativePath) throw new Error(`missing ${carrierKind} source for view ${viewId}`);
      return {
        viewId,
        path: join(artifactRoot, image.relativePath),
        sha256: image.sha256,
      };
    });
    const outputDir = join(artifactRoot, 'generated', condition.id, `seed-${seed}`);
    mkdirSync(outputDir, { recursive: true });
    const args = [
      'submit',
      'mflux_flux2_edit_promptfile_3ref',
      references[0].path,
      outputDir,
      '--cwd',
      '/Users/noahlyons/dev/mlx-openai-server',
      '--params',
      `reference_path_2=${references[1].path}`,
      `reference_path_3=${references[2].path}`,
      `prompt_file=${promptPath}`,
      `model=${manifest.fixedGenerator.model}`,
      `quantize=${manifest.fixedGenerator.quantize}`,
      `width=${manifest.fixedGenerator.width}`,
      `height=${manifest.fixedGenerator.height}`,
      `steps=${manifest.fixedGenerator.steps}`,
      `guidance=${manifest.fixedGenerator.guidance.toFixed(1)}`,
      `seed=${seed}`,
      'mlx_cache_limit_gb=48',
    ];

    try {
      const response = execFileSync(greenroom, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
      const jobId = response.startsWith('{')
        ? JSON.parse(response).job_id
        : response.match(/^Submitted job ([a-f0-9]+)/)?.[1];
      if (!jobId) throw new Error(`unrecognized Greenroom response: ${response}`);
      byCell.set(cellId, {
        cellId,
        conditionId: condition.id,
        seed,
        carrierKind,
        references,
        promptPath,
        promptSha256: condition.promptSha256,
        requestedRoute: manifest.fixedGenerator.requestedRoute,
        jobId,
        outputDir,
      });
      writeFileSync(jobIndexPath, `${JSON.stringify({ ...prior, jobs: [...byCell.values()] }, null, 2)}\n`);
      process.stdout.write(`${cellId}: ${jobId}\n`);
    } catch (error) {
      writeFileSync(failurePath, `${JSON.stringify({
        schema: 'kaminos.lirm-metaball-target-first-multiview-submission-failure.v0',
        status: 'failed',
        failurePhase: `submit-${cellId}`,
        carrierKind,
        conditionId: condition.id,
        seed,
        references,
        promptPath,
        promptSha256: condition.promptSha256,
        lastTrustworthyEvidence: `${byCell.size} prior cells recorded in ${jobIndexPath}`,
        errorMessage: String(error?.message || error),
      }, null, 2)}\n`);
      throw error;
    }
  }
}

process.stdout.write(`Recorded ${byCell.size} jobs in ${jobIndexPath}\n`);
