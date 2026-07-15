import assert from 'node:assert/strict';
import { measureReceiverLightDelta } from '../receiver-light-witness-metrics.mjs';

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

assert.throws(
  () => measureReceiverLightDelta(warmReceiver, image(7, 6, () => [0, 0, 0])),
  /matching dimensions/,
  'mismatched captures must fail loud instead of producing a plausible metric',
);

console.log('receiver-light witness metrics passed');
