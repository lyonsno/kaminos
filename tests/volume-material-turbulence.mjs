// kaminos-test: node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
assert.match(source,/fn materialTransportVelocity\(/,'Material transport must resolve turbulence independently of the velocity lattice');
const { materialTurbulenceScale }=await import('../volume-wavelet-turbulence.mjs');
for(const ratio of [1,2,3,4,8]){
 const a=materialTurbulenceScale(ratio);
 assert.ok(Math.abs(a/ratio-1)<1e-12,'Changing evaluation spacing must preserve physical turbulence amplitude');
}
const material=source.slice(source.indexOf('fn materialTransportVelocity('),source.indexOf('// Pre-pass 1:'));
assert.doesNotMatch(material,/waveletDetailWeighted\([ab]\.xyz\s*\*/,'Material evaluation must preserve existing advected noise coordinates and wavelengths');
const predictor=source.slice(source.indexOf('fn csTransportPredict('),source.indexOf('fn cs(',source.indexOf('fn csTransportPredict(')));
assert.match(predictor,/materialTransportVelocity\(cell, centreVelocity\)/);
assert.match(source,/if \(waveletOn\(\) && !VELOCITY_ONLY\).*waveletCorrection/,'Independent coarse flow must not also inject the transferred band');
assert.match(source,/materialOnlyPredictPipeline/);
console.log('material turbulence: transport placement and unchanged spectrum and physical amplitude pass');
