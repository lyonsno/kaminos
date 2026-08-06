#!/usr/bin/env node
/**
 * Emit a part-aware envelope element plan from exported source surfaces.
 *
 * Pure geometry, no Blender. The plan is the compiler's contract with the
 * marching stage: element centers, per-part radii, and the source part identity
 * each element came from.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { planPartAwareElements } from '../envelope-compile-part-aware-core.mjs';

const SCHEMA = 'kaminos.part-aware-envelope-plan.v0';

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function parseArguments(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--')) throw new Error(`unexpected argument: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  for (const required of ['surfaces', 'out']) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  return args;
}

const args = parseArguments(process.argv.slice(2));
const surfacesPath = resolve(args.surfaces);
const outPath = resolve(args.out);

const payload = JSON.parse(readFileSync(surfacesPath, 'utf8'));
if (payload.schema !== 'kaminos.admitted-surface-export.v0') {
  throw new Error(`unexpected surface export schema: ${payload.schema}`);
}

const options = {};
for (const key of ['radiusFraction', 'minRadiusFraction', 'maxRadiusFraction', 'samplesPerRadius']) {
  if (args[key] !== undefined) options[key] = Number(args[key]);
}

const plan = planPartAwareElements(
  { positions: payload.positions, triangles: payload.triangles },
  options,
);

const clamped = plan.parts.filter((part) => part.radiusClamped).length;

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify({
  schema: SCHEMA,
  sourceSurfaces: surfacesPath,
  sourceSurfacesSha256: sha256(surfacesPath),
  declaredSourceSha256: payload.source?.sha256 ?? null,
  options,
  diagonal: plan.diagonal,
  minRadius: plan.minRadius,
  maxRadius: plan.maxRadius,
  partCount: plan.parts.length,
  clampedPartCount: clamped,
  elementCount: plan.elements.length,
  parts: plan.parts,
  elements: plan.elements,
})}\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  status: 'completed',
  plan: outPath,
  partCount: plan.parts.length,
  clampedPartCount: clamped,
  elementCount: plan.elements.length,
}, null, 2)}\n`);
