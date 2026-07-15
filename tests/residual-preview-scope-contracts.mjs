import fs from 'node:fs';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const trainerPath = `${root}/volume-residual-upscale-mlx.py`;
const runnerPath = `${root}/volume-residual-greenroom-runner.py`;

const trainer = fs.readFileSync(trainerPath, 'utf8');
const runner = fs.readFileSync(runnerPath, 'utf8');

assert.match(
  trainer,
  /--preview-scope/,
  'residual trainer must let preview witnesses target train or eval items explicitly',
);

assert.match(
  trainer,
  /previewScope[\s\S]+choices=\["eval", "train"\]|choices=\["eval", "train"\][\s\S]+previewScope/,
  'residual trainer preview scope must be a loud eval/train choice, not an implicit fallback',
);

assert.match(
  trainer,
  /preview_items\s*=\s*train_items\s+if\s+args\.previewScope\s*==\s*"train"\s+else\s+eval_items/,
  'residual trainer must switch preview source items from eval to train when requested',
);

assert.match(
  trainer,
  /"previewScope":\s*args\.previewScope/,
  'residual report must record whether previews came from train or eval items',
);

assert.match(
  trainer,
  /"previewPairCount":\s*len\(preview_items\)/,
  'residual report must record how many selected-scope pairs were available for previews',
);

assert.match(
  runner,
  /--preview-scope/,
  'GPU Greenroom residual wrapper must forward preview-scope to the trainer',
);
