import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
const volumeSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../structural-combustion.html', import.meta.url), 'utf8');

assert.match(
  source,
  /fn surfaceVertex\(/,
  'dimensional presentation requires a resident structural surface vertex stage',
);
assert.match(
  volumeSource,
  /gpuStructuralCombustionAssembly\.encodePresentation\([\s\S]*\{ width: state\.width, height: state\.height \}/,
  'the owning volume routes the effective presentation dimensions into the solid depth target',
);
assert.match(
  source,
  /componentLabels\[surfaceNodeIndex/,
  'surface fracture visibility must consume resident component identity',
);
assert.match(
  source,
  /materials\[surfaceNodeIndex/,
  'surface burnedness must consume resident node material state',
);
assert.match(
  source,
  /renderPipeline\('structural combustion resident solid surface',[\s\S]*?\}, true\)/,
  'solid surface presentation requires depth-writing geometry',
);
assert.match(
  source,
  /pass\.setPipeline\(surfacePresentationPipeline\)[\s\S]*pass\.draw\(36, socket\.surfaceCellCount\)[\s\S]*pass\.setPipeline\(bondPresentationPipeline\)/,
  'filled cells must render before the structural bond overlay',
);
assert.match(
  source,
  /bondOpacity\s*\*\s*0\.2/,
  'bond visibility is demoted beneath the primary solid surface',
);
assert.match(
  source,
  /materialColor\(material\),\s*0\.32/,
  'node billboards remain only as a restrained material-state overlay',
);
assert.match(
  source,
  /@location\(4\) thermal: vec4<f32>[\s\S]*@location\(5\) reaction: vec4<f32>/,
  'surface fragments receive interpolated thermal and reaction semantics rather than only vertex color',
);
assert.match(
  source,
  /semanticBurnAppearance\(in\.thermal, in\.reaction\)/,
  'surface fragment shading classifies the interpolated resident material state',
);
assert.match(
  pageSource,
  /createStructuralBurnFaceEmitter\([\s\S]*targetPresentation[\s\S]*setExternalEmitters/,
  'the visible Pyro contact is derived from the loaded beam presentation transform',
);

console.log('structural solid burn surface contracts: ok');
