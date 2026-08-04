#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = join(repoRoot, 'artifacts/lirm-metaball-reference-cardinality-v0');
const manifestPath = join(artifactRoot, 'manifest.json');
const jobIndexPath = join(artifactRoot, 'greenroom-jobs.json');
const failurePath = join(artifactRoot, 'submission-failure.json');
const greenroom = process.env.GPU_GREENROOM_CLI
  ?? '/private/tmp/gpu-greenroom-source-plate-command-0804/.venv/bin/gpu-greenroom';

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const prior = existsSync(jobIndexPath)
  ? JSON.parse(readFileSync(jobIndexPath, 'utf8'))
  : { schema: 'kaminos.lirm-metaball-reference-cardinality-greenroom-jobs.v0', jobs: [] };
const byCell = new Map(prior.jobs.map(job => [job.cellId, job]));
const routeJobType = new Map([
  ['gpu-greenroom/mflux_flux2_edit_promptfile', 'mflux_flux2_edit_promptfile'],
  ['gpu-greenroom/mflux_flux2_edit_promptfile_2ref', 'mflux_flux2_edit_promptfile_2ref'],
]);

for (const condition of manifest.conditions) {
  if (condition.reuseOutputPath) continue;
  for (const seed of manifest.fixedGenerator.seeds) {
    const cellId = `${condition.id}-seed-${seed}`;
    if (byCell.has(cellId)) continue;
    const jobType = routeJobType.get(condition.requestedRoute);
    if (!jobType) throw new Error(`unsupported cardinality route: ${condition.requestedRoute}`);
    if (condition.references.length < 1 || condition.references.length > 2) {
      throw new Error(`route/reference mismatch for ${condition.id}`);
    }
    const outputDir = join(artifactRoot, 'generated', condition.id, `seed-${seed}`);
    const promptPath = join(artifactRoot, condition.promptPath);
    mkdirSync(outputDir, { recursive: true });
    const args = [
      'submit',
      jobType,
      resolve(repoRoot, condition.references[0].path),
      outputDir,
      '--cwd',
      '/Users/noahlyons/dev/mlx-openai-server',
      '--params',
    ];
    if (condition.references.length === 2) {
      args.push(`reference_path_2=${resolve(repoRoot, condition.references[1].path)}`);
    }
    args.push(
      `prompt_file=${promptPath}`,
      `model=${manifest.fixedGenerator.model}`,
      `quantize=${manifest.fixedGenerator.quantize}`,
      `width=${manifest.fixedGenerator.width}`,
      `height=${manifest.fixedGenerator.height}`,
      `steps=${manifest.fixedGenerator.steps}`,
      `guidance=${manifest.fixedGenerator.guidance.toFixed(1)}`,
      `seed=${seed}`,
      'mlx_cache_limit_gb=48',
    );

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
        references: condition.references,
        promptPath,
        promptSha256: condition.promptSha256,
        requestedRoute: condition.requestedRoute,
        jobId,
        outputDir,
      });
      writeFileSync(jobIndexPath, `${JSON.stringify({ ...prior, jobs: [...byCell.values()] }, null, 2)}\n`);
      process.stdout.write(`${cellId}: ${jobId}\n`);
    } catch (error) {
      writeFileSync(failurePath, `${JSON.stringify({
        schema: 'kaminos.lirm-metaball-reference-cardinality-submission-failure.v0',
        status: 'failed',
        failurePhase: `submit-${cellId}`,
        conditionId: condition.id,
        requestedRoute: condition.requestedRoute,
        references: condition.references,
        promptPath,
        promptSha256: condition.promptSha256,
        lastTrustworthyEvidence: `${byCell.size} prior cells recorded in ${jobIndexPath}`,
        errorMessage: String(error?.message || error),
      }, null, 2)}\n`);
      throw error;
    }
  }
}

process.stdout.write(`Recorded ${byCell.size} new jobs in ${jobIndexPath}\n`);
