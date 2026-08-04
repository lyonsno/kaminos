#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-silhouette-authority-v0');
const manifestPath = join(artifactRoot, 'manifest.json');
const jobIndexPath = join(artifactRoot, 'greenroom-jobs.json');
const greenroom = process.env.GPU_GREENROOM_CLI
  ?? '/private/tmp/gpu-greenroom-source-plate-command-0804/.venv/bin/gpu-greenroom';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const prior = existsSync(jobIndexPath)
  ? JSON.parse(readFileSync(jobIndexPath, 'utf8'))
  : { schema: 'kaminos.lirm-metaball-silhouette-authority-greenroom-jobs.v0', jobs: [] };
const byCell = new Map(prior.jobs.map((job) => [job.cellId, job]));

for (const row of manifest.rows) {
  for (const seed of manifest.fixedGenerator.seeds) {
    const cellId = `${row.id}-seed-${seed}`;
    if (byCell.has(cellId)) continue;

    const outputDir = join(artifactRoot, 'generated', row.id, `seed-${seed}`);
    mkdirSync(outputDir, { recursive: true });
    const args = [
      'submit',
      'mflux_flux2_edit_promptfile_3ref',
      join(repoRoot, row.sourceImages.clay.path),
      outputDir,
      '--cwd',
      '/Users/noahlyons/dev/mlx-openai-server',
      '--params',
      `reference_path_2=${join(repoRoot, row.sourceImages.depth.path)}`,
      `reference_path_3=${join(repoRoot, row.sourceImages.normal.path)}`,
      `prompt_file=${join(artifactRoot, 'prompt.txt')}`,
      `model=${manifest.fixedGenerator.model}`,
      `quantize=${manifest.fixedGenerator.quantize}`,
      `width=${manifest.fixedGenerator.width}`,
      `height=${manifest.fixedGenerator.height}`,
      `steps=${manifest.fixedGenerator.steps}`,
      `guidance=${manifest.fixedGenerator.guidance.toFixed(1)}`,
      `seed=${seed}`,
      'mlx_cache_limit_gb=48',
    ];
    const response = execFileSync(greenroom, args, { cwd: repoRoot, encoding: 'utf8' }).trim();
    const jobId = response.startsWith('{')
      ? JSON.parse(response).job_id
      : response.match(/^Submitted job ([a-f0-9]+)/)?.[1];
    if (!jobId) throw new Error(`Unrecognized Greenroom submission response: ${response}`);
    byCell.set(cellId, {
      cellId,
      rowId: row.id,
      axis: row.axis,
      seed,
      requestedRoute: manifest.fixedGenerator.requestedRoute,
      jobId,
      outputDir,
    });
    const next = { ...prior, jobs: [...byCell.values()] };
    writeFileSync(jobIndexPath, `${JSON.stringify(next, null, 2)}\n`);
    process.stdout.write(`${cellId}: ${jobId}\n`);
  }
}

process.stdout.write(`Recorded ${byCell.size} jobs in ${jobIndexPath}\n`);
