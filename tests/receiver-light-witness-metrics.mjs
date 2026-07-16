import assert from 'node:assert/strict';
import {
  evaluateReceiverLightAssay,
  measureReceiverLightDelta,
  measureReceiverLightSignal,
} from '../receiver-light-witness-metrics.mjs';

function image(width, height, pixelAt) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(width * 4);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixelAt(x, y);
      row.set([r, g, b, a], x * 4);
    }
    rows.push(row);
  }
  return { width, height, channels: 4, rows };
}

const dark = image(8, 6, () => [10, 10, 10]);
const warmReceiver = image(8, 6, (x, y) => (
  x >= 3 && x <= 6 && y >= 1 && y <= 4 ? [74, 42, 18] : [10, 10, 10]
));
const uiOnly = image(8, 6, (x) => (x < 2 ? [200, 200, 200] : [10, 10, 10]));

const warmDelta = measureReceiverLightDelta(warmReceiver, dark, {
  xMin: 0.25,
  xMax: 1,
  yMin: 0,
  yMax: 1,
});
assert.equal(warmDelta.identity, 'receiver-light-paired-delta-v0');
assert.equal(warmDelta.changedPixels, 16);
assert.equal(warmDelta.warmPositivePixels, 16);
assert.ok(warmDelta.meanPositiveLumaDelta > 30);

const excludedUiDelta = measureReceiverLightDelta(uiOnly, dark, {
  xMin: 0.25,
  xMax: 1,
  yMin: 0,
  yMax: 1,
});
assert.equal(excludedUiDelta.changedPixels, 0, 'left-side UI changes must not prove receiver light');
assert.equal(excludedUiDelta.warmPositivePixels, 0);

const noDelta = measureReceiverLightDelta(dark, dark);
assert.equal(noDelta.changedPixels, 0);
assert.equal(noDelta.warmPositivePixels, 0, 'a nonblank static scene must not prove receiver light');

const black = image(100, 100, () => [0, 0, 0]);
const binaryReceiver = image(100, 100, (x, y) => (
  x >= 25 && x < 75 && y >= 20 && y < 80 ? [96, 44, 8] : [0, 0, 0]
));
const ambientControl = image(100, 100, () => [8, 8, 8]);
const binarySignal = measureReceiverLightSignal(binaryReceiver);
assert.equal(binarySignal.identity, 'receiver-light-absolute-signal-v0');
assert.equal(binarySignal.litPixels, 3000);
assert.equal(binarySignal.warmPixels, 3000);

const dimReceiverSurface = image(100, 100, (x, y) => (
  x >= 20 && x < 80 && y >= 15 && y < 85 ? [8, 8, 8] : [0, 0, 0]
));
const receiverCoverageMask = image(100, 100, (x, y) => (
  x >= 20 && x < 80 && y >= 15 && y < 85 ? [255, 255, 255] : [0, 0, 0]
));
const illuminatedReceiverSurface = image(100, 100, (x, y) => (
  x >= 20 && x < 80 && y >= 15 && y < 85 ? [96, 44, 8] : [0, 0, 0]
));
const surfaceAssayOptions = {
  receiverMaskImage: receiverCoverageMask,
  backgroundRegion: { xMin: 0, xMax: 1, yMin: 0, yMax: 0.1 },
};
const honestAssay = evaluateReceiverLightAssay(
  illuminatedReceiverSurface,
  dimReceiverSurface,
  surfaceAssayOptions,
);
assert.equal(honestAssay.identity, 'receiver-light-surface-contact-assay-v1');
assert.equal(honestAssay.accepted, true, 'warm gain on a visible muted receiver surface must pass');
assert.deepEqual(honestAssay.failures, []);
assert.ok(honestAssay.delta.surfacePositiveRatio > 0.99);

const darkMaterialAssay = evaluateReceiverLightAssay(
  illuminatedReceiverSurface,
  black,
  surfaceAssayOptions,
);
assert.equal(
  darkMaterialAssay.accepted,
  true,
  'an explicit receiver mask must prove contact even when the muted material quantizes to black',
);

const mixedSurfaceAndSpill = image(100, 100, (x, y) => {
  if (x >= 20 && x < 80 && y >= 15 && y < 85) return [96, 44, 8];
  if (x >= 82 && x < 92 && y >= 45 && y < 75) return [72, 36, 6];
  return [0, 0, 0];
});
const mixedAssay = evaluateReceiverLightAssay(
  mixedSurfaceAndSpill,
  dimReceiverSurface,
  surfaceAssayOptions,
);
assert.equal(
  mixedAssay.accepted,
  false,
  'a mostly attached response must still fail when a material detached lobe escapes the receiver mask',
);
assert.ok(
  mixedAssay.failures.includes('receiver-delta-escaped-surface-mask'),
  `expected full-frame detached-signal failure, got ${JSON.stringify(mixedAssay)}`,
);

const receiverWithSmallDetachedLobe = image(100, 100, (x, y) => {
  if (x >= 20 && x < 80 && y >= 15 && y < 85) return [96, 44, 8];
  if (x >= 82 && x < 84 && y >= 45 && y < 50) return [72, 36, 6];
  return [0, 0, 0];
});
const smallDetachedLobeAssay = evaluateReceiverLightAssay(
  receiverWithSmallDetachedLobe,
  dimReceiverSurface,
  surfaceAssayOptions,
);
assert.equal(
  smallDetachedLobeAssay.accepted,
  false,
  'even a detached lobe below the former global tolerance must fail surface contact',
);
assert.ok(
  smallDetachedLobeAssay.failures.includes('receiver-delta-escaped-surface-mask'),
  `expected small detached lobe failure, got ${JSON.stringify(smallDetachedLobeAssay)}`,
);

const detachedAssay = evaluateReceiverLightAssay(binaryReceiver, black, {
  ...surfaceAssayOptions,
  receiverMaskImage: black,
});
assert.equal(detachedAssay.accepted, false, 'a warm detached overlay over black cannot prove receiver illumination');
assert.ok(
  detachedAssay.failures.includes('receiver-delta-escaped-surface-mask'),
  `expected detached-signal failure, got ${JSON.stringify(detachedAssay)}`,
);

const backgroundSpill = image(100, 100, (x, y) => (
  y < 10 ? [48, 24, 4] : (x >= 20 && x < 80 && y >= 15 && y < 85 ? [96, 44, 8] : [0, 0, 0])
));
const contaminatedAssay = evaluateReceiverLightAssay(backgroundSpill, dimReceiverSurface, surfaceAssayOptions);
assert.equal(contaminatedAssay.accepted, false, 'warm gain in the named empty-background region must fail loud');
assert.ok(
  contaminatedAssay.failures.includes('empty-background-receiver-spill'),
  `expected empty-background spill failure, got ${JSON.stringify(contaminatedAssay)}`,
);

const missingReceiverAssay = evaluateReceiverLightAssay(black, black);
assert.equal(missingReceiverAssay.accepted, false, 'two black frames cannot prove receiver illumination');
assert.ok(missingReceiverAssay.failures.includes('receiver-signal-too-sparse'));

assert.throws(
  () => measureReceiverLightDelta(warmReceiver, image(7, 6, () => [0, 0, 0])),
  /matching dimensions/,
  'mismatched captures must fail loud instead of producing a plausible metric',
);

console.log('receiver-light witness metrics passed');
