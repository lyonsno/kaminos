import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = source.indexOf('  const aoVisibility =');
const end = source.indexOf('\n  renderPipeline.outputNode', start);
assert.ok(start >= 0 && end > start, 'AO output composition exists');
const ao = source.slice(start, end);
assert.match(ao, /denoisePass\.r\.clamp\(0,\s*1\)/, 'AO visibility stays in the physically meaningful 0..1 range');
assert.match(ao, /aoIntensity\.min\(1\)/, 'ordinary AO retains the existing 0..1 response');
assert.match(ao, /aoIntensity\.sub\(1\)\.max\(0\)/, 'higher intensity adds bounded contrast instead of negative visibility');
assert.match(ao, /\.div\(\s*float\(1\)\.add\(/, 'strong AO response saturates monotonically');

console.log('scene AO response contracts passed');
