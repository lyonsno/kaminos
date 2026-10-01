import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { effectiveMismatches, resolveHeadlessBrowser } from '../volume-arm-capture-checks.mjs';

const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');

test('swirl check: a missing or nonfinite effective swirl is a mismatch, not a pass', () => {
  const arm = { set: [['volume-emitter-swirl', '0.6']] };
  const at = swirl => effectiveMismatches(arm, { inflowBoundary: { effective: swirl === undefined ? {} : { swirl } } }, null);
  assert.equal(at(0.6).length, 0, 'a matching finite value passes');
  assert.equal(at(0).length, 1, 'a different value fails');
  assert.equal(at(undefined).length, 1, 'an absent value fails');
  assert.equal(at(Number.NaN).length, 1, 'a nonfinite value fails');
  assert.equal(effectiveMismatches(arm, {}, null).length, 1, 'no inflow receipt at all fails');
  assert.match(at(undefined)[0], /swirl requested 0\.6, effective undefined/);
});

test('confinement epsilon faults reach the checks through the fault argument, not a module variable', () => {
  const arm = { set: [['@confinementEpsilon', '0.3']] };
  const end = { confinement: { mode: 'calibrated', confinementAmount: 0.3 }, confinementUniform: { mode: 1, confinementAmount: Math.fround(0.3) } };
  assert.deepEqual(effectiveMismatches(arm, end, 'calibrated'), [], 'a faithful receipt passes with no fault');
  assert.ok(effectiveMismatches(arm, end, 'calibrated', 'packed-epsilon').some(m => /packed epsilon/.test(m)), 'the packed-epsilon fault makes the comparison fail');
});

test('headless browser: an independent executable is required; the installed GUI Chrome is never launched', () => {
  const root = mkdtempSync(join(tmpdir(), 'kaminos-browser-'));
  const pw = join(root, 'ms-playwright');
  const binary = join(pw, 'chromium-1243', 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
  mkdirSync(join(binary, '..'), { recursive: true }); writeFileSync(binary, '');
  const older = binary.replace('chromium-1243', 'chromium-1200'); mkdirSync(join(older, '..'), { recursive: true }); writeFileSync(older, '');
  const found = resolveHeadlessBrowser({ env: {}, playwrightRoot: pw });
  assert.equal(found.executable, binary, 'the newest Playwright Chromium is chosen');
  assert.equal(found.source, 'playwright-chromium');
  const override = join(root, 'my-chrome'); writeFileSync(override, '');
  assert.deepEqual(resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: override }, playwrightRoot: pw }), { executable: override, source: 'KAMINOS_HEADLESS_BROWSER' });
  assert.throws(() => resolveHeadlessBrowser({ env: { KAMINOS_HEADLESS_BROWSER: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }, playwrightRoot: pw }), /installed GUI Chrome/, 'the GUI app bundle is refused even when named');
  assert.throws(() => resolveHeadlessBrowser({ env: {}, playwrightRoot: join(root, 'nowhere') }), /no independent headless browser/, 'absence fails visibly');
  assert.doesNotMatch(capture, /Google Chrome\.app/, 'the capture no longer names the GUI app');
  assert.match(capture, /resolveHeadlessBrowser\(/, 'the capture resolves its executable through the shared resolver');
  assert.match(capture, /executable: headlessBrowser\.executable/, 'the report records the effective executable');
});
