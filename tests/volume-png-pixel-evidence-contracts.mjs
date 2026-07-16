#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const helperPath = join(root, 'volume-png-pixel-evidence.mjs');
assert.ok(existsSync(helperPath), 'PNG pixel-evidence helper exists');
const { analyzePngPixels, comparePngPixels } = await import(helperPath);

const scratch = mkdtempSync(join(tmpdir(), 'kaminos-png-evidence-'));
try {
  const black = join(scratch, 'black.png');
  const lit = join(scratch, 'lit.png');
  makePng(black, false);
  makePng(lit, true);

  const blackEvidence = analyzePngPixels(black);
  const litEvidence = analyzePngPixels(lit);
  assert.equal(blackEvidence.identity, 'decoded-rgba-pixel-evidence-v0');
  assert.equal(blackEvidence.foregroundPixelCount, 0);
  assert.ok(litEvidence.foregroundPixelCount > 0);
  assert.ok(litEvidence.foregroundFraction > 0 && litEvidence.foregroundFraction < 1);
  assert.ok(litEvidence.boundingBox.width > 0 && litEvidence.boundingBox.height > 0);

  const difference = comparePngPixels(black, lit);
  assert.equal(difference.identity, 'decoded-rgba-role-difference-v0');
  assert.ok(difference.changedPixelCount > 0);
  assert.ok(difference.meanAbsoluteRgbDifference > 0);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function makePng(path, includeLitSquare) {
  const width = 8;
  const height = 8;
  const pixels = Buffer.alloc(width * height * 3);
  if (includeLitSquare) {
    for (let y = 2; y < 6; y += 1) {
      for (let x = 2; x < 6; x += 1) {
        const offset = (y * width + x) * 3;
        pixels[offset] = 255;
        pixels[offset + 1] = 96;
        pixels[offset + 2] = 16;
      }
    }
  }
  const ppm = join(scratch, `${includeLitSquare ? 'lit' : 'black'}.ppm`);
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', ppm, path], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || 'fixture PNG conversion failed');
  assert.ok(readFileSync(path).length > 0);
}

console.log('PNG pixel evidence contracts passed');
