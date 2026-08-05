#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-fixed-lineage-proportion-v0');
const manifest = JSON.parse(readFileSync(join(artifactRoot, 'manifest.json'), 'utf8'));
const jobIndexPath = join(artifactRoot, 'greenroom-jobs.json');
const failurePath = join(artifactRoot, 'submission-failure.json');
const greenroom = process.env.GPU_GREENROOM_CLI
  ?? '/private/tmp/gpu-greenroom-source-plate-command-0804/.venv/bin/gpu-greenroom';
const prior = existsSync(jobIndexPath)
  ? JSON.parse(readFileSync(jobIndexPath, 'utf8'))
  : { schema: 'kaminos.lirm-metaball-fixed-lineage-proportion-greenroom-jobs.v0', jobs: [] };
const byCell = new Map(prior.jobs.map(job => [job.cellId, job]));

for (const row of manifest.rows) {
  if (row.references.length !== 3) {
    throw new Error(`three-reference lineage contract violated for ${row.id}`);
  }
  for (const seed of manifest.fixedGenerator.seeds) {
    const cellId = `${row.id}-seed-${seed}`;
    if (byCell.has(cellId)) continue;
    const outputDir = join(artifactRoot, 'generated', row.id, `seed-${seed}`);
    const promptPath = join(artifactRoot, manifest.promptPath);
    const references = row.references.map(reference => ({
      ...reference,
      path: resolve(repoRoot, reference.path),
    }));
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
        variantId: row.id,
        axis: row.axis,
        parameters: row.parameters,
        seed,
        references,
        promptPath,
        promptSha256: manifest.promptSha256,
        requestedRoute: manifest.fixedGenerator.requestedRoute,
        jobId,
        outputDir,
      });
      writeFileSync(jobIndexPath, `${JSON.stringify({ ...prior, jobs: [...byCell.values()] }, null, 2)}\n`);
      process.stdout.write(`${cellId}: ${jobId}\n`);
    } catch (error) {
      writeFileSync(failurePath, `${JSON.stringify({
        schema: 'kaminos.lirm-metaball-fixed-lineage-proportion-submission-failure.v0',
        status: 'failed',
        failurePhase: `submit-${cellId}`,
        variantId: row.id,
        axis: row.axis,
        parameters: row.parameters,
        seed,
        references,
        promptPath,
        promptSha256: manifest.promptSha256,
        requestedRoute: manifest.fixedGenerator.requestedRoute,
        lastTrustworthyEvidence: `${byCell.size} prior cells recorded in ${jobIndexPath}`,
        errorMessage: String(error?.message || error),
      }, null, 2)}\n`);
      throw error;
    }
  }
}

process.stdout.write(`Recorded ${byCell.size} jobs in ${jobIndexPath}\n`);
