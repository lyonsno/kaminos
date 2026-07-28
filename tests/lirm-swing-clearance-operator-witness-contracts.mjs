import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../lirm-swing-clearance-operator-witness.mjs', import.meta.url),
  'utf8',
);

for (const [pattern, message] of [
  [/requestedRoute/, 'witness must record requested route identity'],
  [/effectiveRoute/, 'witness must record effective route identity'],
  [/actualSourceHash/, 'witness must record effective source identity'],
  [/rear-left/, 'witness must bind the frozen posterior support'],
  [/three-quarter/, 'witness must capture a three-quarter view'],
  [/profile/, 'witness must capture a profile view'],
  [/underside/, 'witness must capture an underside view'],
  [/collar-closeup/, 'witness must capture a collar close-up'],
  [/masks/, 'witness must capture exact mask evidence'],
  [/clearance/, 'witness must capture terrain-normal clearance evidence'],
  [/distortion/, 'witness must capture deformation evidence'],
  [/failurePhase/, 'witness must preserve pre-output failure phase'],
  [/lastTrustworthyEvidence/, 'witness must preserve last trustworthy evidence'],
  [/blank frame/i, 'witness must reject blank captures'],
  [/contact-sheet\.png/, 'witness must produce a stable contact-sheet artifact'],
]) {
  assert.match(source, pattern, message);
}

process.stdout.write('lirm swing-clearance operator witness contracts passed\n');
