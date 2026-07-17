import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { decodePng } from './combustible-plank-pixel-checks.mjs';

const REGIONS = Object.freeze({
  scene: [0.12, 0.10, 0.90, 0.92],
  targetOrigin: [0.30, 0.55, 0.64, 0.63],
  targetFall: [0.28, 0.61, 0.68, 0.84],
  controlCore: [0.62, 0.325, 0.84, 0.365],
});

function regionBounds(decoded, normalized) {
  return {
    x0: Math.floor(decoded.width * normalized[0]),
    y0: Math.floor(decoded.height * normalized[1]),
    x1: Math.ceil(decoded.width * normalized[2]),
    y1: Math.ceil(decoded.height * normalized[3]),
  };
}

function analyzeFrame(png) {
  const bytes = Buffer.from(png || []);
  const decoded = decodePng(bytes);
  const bounds = regionBounds(decoded, REGIONS.scene);
  const colors = new Set();
  let scenePixels = 0;
  let visibleScenePixels = 0;
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const offset = (y * decoded.width + x) * 4;
      const r = decoded.rgba[offset];
      const g = decoded.rgba[offset + 1];
      const b = decoded.rgba[offset + 2];
      if ((x + y) % 7 === 0) colors.add(`${r >> 4}:${g >> 4}:${b >> 4}`);
      scenePixels += 1;
      if (r + g + b > 42) visibleScenePixels += 1;
    }
  }
  return {
    width: decoded.width,
    height: decoded.height,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    quantizedColorCount: colors.size,
    visibleSceneRatio: visibleScenePixels / scenePixels,
    decoded,
  };
}

function regionDifference(left, right, normalized) {
  assert.equal(left.width, right.width, 'phase screenshots have different widths');
  assert.equal(left.height, right.height, 'phase screenshots have different heights');
  const bounds = regionBounds(left, normalized);
  let pixels = 0;
  let changedPixels = 0;
  let differenceSum = 0;
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const offset = (y * left.width + x) * 4;
      const difference = Math.abs(left.rgba[offset] - right.rgba[offset]) +
        Math.abs(left.rgba[offset + 1] - right.rgba[offset + 1]) +
        Math.abs(left.rgba[offset + 2] - right.rgba[offset + 2]);
      differenceSum += difference;
      if (difference > 36) changedPixels += 1;
      pixels += 1;
    }
  }
  return {
    pixels,
    changedPixels,
    changedRatio: changedPixels / pixels,
    meanRgbDifference: differenceSum / pixels,
  };
}

function publicFrame(frame) {
  const { decoded, ...record } = frame;
  return record;
}

export function validateGpuCombustibleObjectPixelSequence(pngs) {
  const frames = Object.fromEntries(
    ['initial', 'ignition', 'final'].map(name => [name, analyzeFrame(pngs[name])]),
  );
  const result = {
    method: 'decoded-gpu-object-phase-regions-v0',
    status: 'pending',
    regions: REGIONS,
    frames: Object.fromEntries(Object.entries(frames).map(([name, frame]) => [name, publicFrame(frame)])),
    deltas: null,
  };
  try {
    for (const [name, frame] of Object.entries(frames)) {
      assert.ok(frame.width >= 640 && frame.height >= 480, `${name} capture is below the witness viewport floor`);
      assert.ok(frame.quantizedColorCount >= 8, `${name} visual is blank or color-degenerate`);
      assert.ok(frame.visibleSceneRatio > 0.025, `${name} visual is blank or missing the composed scene`);
    }
    assert.notEqual(frames.initial.sha256, frames.ignition.sha256, 'ignition screenshot repeats the initial frame');
    assert.notEqual(frames.initial.sha256, frames.final.sha256, 'final screenshot repeats the initial frame');
    assert.notEqual(frames.ignition.sha256, frames.final.sha256, 'final screenshot repeats the ignition frame');

    const initialToIgnitionTarget = regionDifference(
      frames.initial.decoded,
      frames.ignition.decoded,
      REGIONS.targetOrigin,
    );
    const ignitionToFinalOrigin = regionDifference(
      frames.ignition.decoded,
      frames.final.decoded,
      REGIONS.targetOrigin,
    );
    const ignitionToFinalFall = regionDifference(
      frames.ignition.decoded,
      frames.final.decoded,
      REGIONS.targetFall,
    );
    const initialToIgnitionControl = regionDifference(
      frames.initial.decoded,
      frames.ignition.decoded,
      REGIONS.controlCore,
    );
    const ignitionToFinalControl = regionDifference(
      frames.ignition.decoded,
      frames.final.decoded,
      REGIONS.controlCore,
    );
    result.deltas = {
      initialToIgnitionTarget,
      ignitionToFinalOrigin,
      ignitionToFinalFall,
      initialToIgnitionControl,
      ignitionToFinalControl,
    };

    assert.ok(
      initialToIgnitionTarget.changedRatio > 0.03,
      'ignition capture does not show a material change at the supported target',
    );
    assert.ok(
      ignitionToFinalOrigin.changedRatio > 0.20,
      'final capture does not show the target leaving its supported position',
    );
    assert.ok(
      ignitionToFinalFall.changedRatio > 0.025,
      'final capture does not show fallen target pixels below the support position',
    );
    assert.ok(
      initialToIgnitionControl.changedRatio < 0.01 && ignitionToFinalControl.changedRatio < 0.01,
      'matched control changed while the exposed target burned and fell',
    );
    result.status = 'ok';
    return result;
  } catch (error) {
    result.status = 'failed';
    result.error = error?.message || String(error);
    error.pixelChecks = result;
    throw error;
  }
}
