import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../structural-material-bounded-gpu.js',import.meta.url),'utf8');
assert.match(source,/if\(exposedOnly&&hiddenFace\(face\)\)\{return -1\.0;\}/,'GPU picking must reject buried joined faces before intersection');
assert.match(source,/u32\(positions\[f\[k\]\]\.w\)/,'Picking must consume the resident local ownership mask');
assert.match(source,/faceBuffer:faces/,'Rendering and picking must share one opposed-face descriptor buffer');
console.log('Exposed rendering and picking share resident face ownership');
