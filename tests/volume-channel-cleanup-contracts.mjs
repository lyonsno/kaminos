// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const liquid = readFileSync(new URL('../liquid-fire-contact-consumer.mjs', import.meta.url), 'utf8');
const mainKernel = (() => { const start = source.indexOf('fn cs(@builtin(global_invocation_id) gid: vec3<u32>) {'); return source.slice(start, source.indexOf('\n}\n', start)); })();
const fnBody = name => { const at = source.indexOf(`fn ${name}(`); return source.slice(at, source.indexOf('\n}\n', at)); };

// Channel audit (2026-10-13): the stored density (slot 0 .w) was a cache, recomputed
// every step from the other channels and written back. It is now derived where it
// is read and the lane is written as zero (reserved). Nothing changes in what any
// reader sees under either reaction law.

test('density is derived from the material and micro slots by one shared law, and the slot-0 lane is written as zero', () => {
  const body = fnBody('derivedDensityFromSlots');
  assert.match(body, /fn derivedDensityFromSlots\(material: vec4<f32>, microLayer: vec4<f32>\) -> f32 \{/);
  assert.match(body, /return clamp\(max\(material\.x \* 1\.08 \+ microLayer\.x \* 0\.08, material\.y \* 0\.42 \+ material\.w \* 0\.18 \+ microLayer\.y \* 0\.20 \+ microLayer\.z \* 0\.05 \+ material\.z \* 0\.10\), 0\.0, 2\.2\);/, 'the formula the step kernel used to store');
  assert.match(mainKernel, /fluidDst\[base\] = vec4<f32>\(select\(boundVelocity\(vel\), vel, faceForcesOn\(\)\), 0\.0\);/, 'the step kernel writes the lane as zero');
  assert.doesNotMatch(mainKernel, /let density = clamp\(max\(smoke \* 1\.08/, 'no stored density is computed in the step kernel');
  assert.match(mainKernel, /let canonicalDensityDelta = derivedDensityFromSlots\(readSlot\(cellI, 1u\), readSlot\(cellI, 3u\)\) - derivedDensityFromSlots\(material, microLayer\);/, 'the canonical entrainment derives its density delta');
});

test('every reader of the old lane derives density instead; the converged projection passes the lane through', () => {
  assert.match(fnBody('directCellOpticalSupportFromSlots'), /let density = max\(derivedDensityFromSlots\(material, microLayer\), smoke \* 0\.82 \+ material\.y \* 0\.22 \+ material\.w \* 0\.18\);/);
  for (const name of ['csProjectPressure', 'csProjectPressureTiered']) {
    const body = fnBody(name);
    assert.match(body, /let density = derivedDensityFromSlots\(material, microLayer\);/, `${name} derives the density it weights the projection with`);
    assert.doesNotMatch(body, /let density = velocityDensity\.w;/);
  }
  assert.match(fnBody('boundarySplatOpticalSupport'), /let density = max\(derivedDensityFromSlots\(reconstructed\.material, reconstructed\.micro\), reconstructed\.material\.x\);/, 'the splat module (a separate shader) names the slot micro');
  const copies = [...source.matchAll(/fn derivedDensityFromSlots\([^]*?\n\}\n/g)].map(m => m[0]);
  assert.equal(copies.length, 2, 'one copy per shader module: the main WGSL and the boundary splat WGSL');
  assert.equal(copies[0], copies[1], 'the two copies are byte-identical');
  const splat = source.slice(source.indexOf('const BOUNDARY_SPLAT_WGSL'), source.indexOf('const BOUNDARY_SPLAT_WGSL') + 400000);
  assert.ok(splat.includes('fn derivedDensityFromSlots('), 'the splat module carries its own copy');
  const reads = [...source.matchAll(/velocityDensity\.w/g)].length;
  assert.equal(reads, 1, 'the only remaining read of the lane is the converged projection passing it through');
  assert.match(fnBody('csProjectPressureConverged'), /fluidDst\[base\] = vec4<f32>\(boundVelocity\(correctedVelocity\), velocityDensity\.w\);/);
  assert.match(source, /let candidateVelocityDensity = vec4<f32>\(injectedVelocity, 0\.0\);/, 'the analytic injection kernel writes the lane as zero too');
  assert.doesNotMatch(source, /legacyInjectedDensity/);
  assert.doesNotMatch(liquid, /cell0\.w = min\(4\.0, cell0\.w \+ addedVapor \* 0\.4\);/, 'the liquid consumer no longer writes vapour into the density lane (it was overwritten by the next step anyway; vapour still enters smoke and micro smoke)');
  assert.match(liquid, /cell1\.x = min\(4\.0, cell1\.x \+ addedVapor\);/);
});

test('the quench field spreads to neighbours only while a liquid is bound with transfer enabled; it still decays otherwise', () => {
  assert.match(mainKernel, /let quenchSpreadActive = u\.reactant_combustion_d\.z > 0\.5;/, 'the kernel reads the bound-liquid flag');
  assert.match(mainKernel, /var quenchNeighborMax = 0\.0;\n\s*if \(quenchSpreadActive\) \{\n\s*quenchNeighborMax = max\(/, 'the six neighbour reads sit under the flag');
  assert.match(mainKernel, /let transportedQuench = max\(clamp\(f32\(quenchSrc\[idx\]\) \/ 65536\.0, 0\.0, 1\.0\) \* 0\.996, quenchNeighborMax \* 0\.92\);/, 'decay of a wetted cell is unchanged');
  assert.match(source, /uniforms\[REACTANT_COMBUSTION_UNIFORM_OFFSET \+ 14\] = liquidFireContactDescriptor && liquidFireContactTransferEnabled \? 1 : 0;/, 'the host packs the flag from the bound descriptor and the transfer switch, after the reactant block is set');
  assert.match(source, /reactant_combustion_d: vec4<f32>,/);
});
