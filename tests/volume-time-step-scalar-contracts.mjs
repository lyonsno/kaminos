import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Time step, scalar half (flame-doctor slice 4b). Slice 4 put dt on the
// velocity side only; fuel consumption, heat-to-smoke conversion, the per-step
// decays of every transported channel and the boundary sponges stayed per step,
// so at low Speed a parcel burned out where it stood (Noah, 2026-09-26: it
// "settles", "won't catch enough to rise"). Under the same `uniform` mode every
// per-step multiplicative survival becomes rate^dt and every additive reaction
// increment carries dt; `max()` births are floors and stay. A vertical profile
// (mean vertical velocity, heat, smoke per height slab) joins the residual probe
// so "vertical velocity grows with height" can be read as a curve.

const core = await import('../volume-core.js');
const source = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function wgslFunction(name) {
  const start = source.indexOf(`\nfn ${name}(`);
  assert.notEqual(start, -1, `production helper ${name} exists`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
}
function mainKernel() {
  const start = source.indexOf('\nfn cs(@builtin(global_invocation_id) gid: vec3<u32>) {');
  assert.notEqual(start, -1, 'main sim kernel is located');
  const end = source.indexOf('\n@compute', start + 10);
  return source.slice(start, end === -1 ? undefined : end);
}

test('stepRate turns an authored per-step survival into rate^dt only under the uniform step', () => {
  const helper = wgslFunction('stepRate');
  assert.match(helper, /u\.reserved_source_extension_2\.z > 0\.5/, 'reads the time-step mode');
  assert.match(helper, /select\(rate, pow\(max\(rate, 0\.0\), timeStepScale\(\)\), uniformStep\)/, 'legacy returns the authored rate untouched; uniform raises it to dt');
  // The CPU model of the same law: half a step keeps sqrt of the survival.
  const model = (rate, dt, uniform) => (uniform ? Math.pow(Math.max(rate, 0), dt) : rate);
  assert.equal(model(0.938, 3.4, false), 0.938);
  assert.ok(Math.abs(model(0.938, 0.5, true) - Math.sqrt(0.938)) < 1e-12);
  assert.equal(model(0.938, 1, true), 0.938);
  assert.equal(model(1, 0.25, true), 1);
});

test('every per-step decay of a transported channel goes through stepRate', () => {
  const main = mainKernel();
  const decays = [
    ['smoke', 'material.x', '0.990'], ['heat', 'material.y', '0.982'], ['fuel', 'material.z', '0.990'], ['materialDetail', 'material.w', '0.970'],
    ['flame', 'fireLayer.x', '0.938'], ['ember', 'fireLayer.y', '0.952'], ['visibleFireCarrier', 'fireLayer.z', '0.922'], ['combustionFront', 'fireLayer.w', '0.930'],
    ['microSmoke', 'microLayer.x', '0.972'], ['interfaceShred', 'microLayer.y', '0.948'], ['fireLick', 'microLayer.z', '0.902'], ['emberFleck', 'microLayer.w', '0.934'],
  ];
  for (const [name, slot, rate] of decays) {
    const escaped = slot.replace('.', '\\.');
    assert.match(main, new RegExp(`var ${name} = ${escaped} \\* stepRate\\(${rate.replace('.', '\\.')}\\);`), `${name} decays by stepRate(${rate})`);
    assert.doesNotMatch(main, new RegExp(`var ${name} = ${escaped} \\* ${rate.replace('.', '\\.')};`), `${name} no longer decays by a bare per-step factor`);
  }
  assert.match(main, /var combustionFrontTopology = sampleFrontField\(backCell\) \* stepRate\(0\.936\);/, 'the transported front topology decays on the same law');
});

test('reaction, conversion and consumption increments carry dt; max() births stay as floors', () => {
  const main = mainKernel();
  assert.match(main, /let columnSmokeTransport = mix\(max\(smoke \+ smokeFromHeat \* timeStep, columnSmokeBirthForScene\)/, 'heat-to-smoke conversion is a rate');
  assert.match(main, /let bonfireSmokeTransport = min\(1\.65, smoke \+ bonfireAdvectedSmokeBirth \* timeStep\);/, 'the Bonfire smoke birth is a rate');
  assert.match(main, /smoke = smoke \+ tallPlumeReactionSmokeBirth \* timeStep;/, 'reaction smoke is a rate');
  assert.match(main, /heat = heat \+ \(tallPlumeFuelHeatReaction \* mix\(0\.0, 0\.16, tallPlumeScene\) \+ tallPlumePilotReaction \* 0\.030\) \* timeStep;/, 'reaction heat release is a rate');
  assert.match(main, /fuel = max\(fuel - \(heat \* 0\.018 \+ fuelConsumption\) \* timeStep, 0\.0\);/, 'fuel consumption is a rate');
  assert.match(main, /heat = max\(heat, mix\(mix\(mix\(columnHeatBirth, tallPlumeHeatBirth, tallPlumeScene\), canonicalHeatBirth, canonicalPlumeScene\), bonfireHeatBirth, bonfireScene\)\);/, 'heat birth remains a floor');
  assert.match(main, /fuel = max\(fuel, mix\(tallPlumeFuelInjection, bonfireInjectedFuel, bonfireScene\)\);/, 'fuel injection remains a floor');
});

test('boundary sponges, height survival and quench attenuations are per-step survivals and follow stepRate', () => {
  const main = mainKernel();
  assert.match(main, /flame = flame \* stepRate\(tallPlumeFireSurvival\);\s*\n\s*ember = ember \* stepRate\(tallPlumeFireSurvival\);/, 'flame height survival');
  assert.match(main, /smoke = smoke \* stepRate\(mix\(0\.42, 1\.0, wallFade\) \* mix\(0\.72, 1\.0, smokeTopFade\)\);/, 'smoke sponge');
  assert.match(main, /heat = heat \* stepRate\(mix\(0\.30, 1\.0, wallFade\) \* mix\(0\.16, 1\.0, heatTopFade\)\);/, 'heat sponge');
  assert.match(main, /fuel = fuel \* stepRate\(mix\(0\.20, 1\.0, wallFade\) \* mix\(0\.58, 1\.0, heatTopFade\)\);/, 'fuel sponge');
  assert.match(main, /materialDetail = materialDetail \* stepRate\(mix\(0\.22, 1\.0, wallFade\)\);/, 'material detail sponge');
  assert.match(main, /flame = flame \* stepRate\(mix\(0\.12, 1\.0, wallFade\) \* mix\(0\.08, 1\.0, fireTopFade\)\);/, 'flame sponge');
  assert.match(main, /ember = ember \* stepRate\(mix\(0\.18, 1\.0, wallFade\) \* mix\(0\.16, 1\.0, smokeTopFade\)\);/, 'ember sponge');
  for (const [name, rate] of [['heat', '0.025'], ['fuel', '0.030'], ['flame', '0.025'], ['ember', '0.025']]) {
    assert.match(main, new RegExp(`${name} = ${name} \\* stepRate\\(1\\.0 - localQuenchSuppression \\* ${rate.replace('.', '\\.')}\\);`), `${name} quench attenuation`);
  }
});

test('review of 9d669e36: every stored channel\'s per-step survival and every additive birth carry the step; only floors and scene masks are exempt', () => {
  const main = mainKernel();
  // Survival on the stored fire, front and detail channels.
  for (const name of ['flameDetail', 'combustionFront', 'fireLick', 'emberFleck']) {
    assert.match(main, new RegExp(`${name} = ${name} \\* stepRate\\(tallPlumeFireSurvival\\);`), `${name} height survival`);
  }
  // Sponges on the remaining channels.
  assert.match(main, /flameDetail = flameDetail \* stepRate\(mix\(0\.10, 1\.0, wallFade\)\);/);
  assert.match(main, /combustionFront = combustionFront \* stepRate\(mix\(0\.10, 1\.0, wallFade\) \* mix\(0\.08, 1\.0, fireTopFade\)\);/);
  assert.match(main, /combustionFrontTopology = combustionFrontTopology \* stepRate\(mix\(0\.10, 1\.0, wallFade\) \* mix\(0\.08, 1\.0, fireTopFade\)\);/);
  assert.match(main, /microSmoke = microSmoke \* stepRate\(mix\(0\.20, 1\.0, wallFade\) \* mix\(0\.50, 1\.0, smokeTopFade\)\);/);
  assert.match(main, /interfaceShred = interfaceShred \* stepRate\(mix\(0\.18, 1\.0, wallFade\)\);/);
  assert.match(main, /fireLick = fireLick \* stepRate\(mix\(0\.10, 1\.0, wallFade\) \* mix\(0\.10, 1\.0, fireTopFade\)\);/);
  assert.match(main, /emberFleck = emberFleck \* stepRate\(mix\(0\.15, 1\.0, wallFade\)\);/);
  // Quench on the remaining channels.
  for (const [name, rate] of [['flameDetail', '0.035'], ['combustionFront', '0.032'], ['combustionFrontTopology', '0.028'], ['fireLick', '0.035'], ['emberFleck', '0.020']]) {
    assert.match(main, new RegExp(`${name} = ${name} \\* stepRate\\(1\\.0 - localQuenchSuppression \\* ${rate.replace('.', '\\.')}\\);`), `${name} quench attenuation`);
  }
  // Canonical smoke path: survival and two additive terms.
  assert.match(main, /smoke \* stepRate\(0\.968 - canonicalCenterlineRelief \* 0\.16 \* canonicalCenterlineGain - canonicalPlumeBodyBalance \* 0\.10\)\s*\n\s*\+ smokeFromHeat \* 0\.18 \* timeStep\s*\n\s*\+ canonicalScalarSpread \* canonicalSpreadGain \* \(0\.12 - canonicalBroadBodyRelief \* canonicalBodyBalanceGain \* 0\.035\) \* timeStep,/, 'canonical smoke transport follows the law');
  // Bonfire additive births and per-step attenuations.
  assert.match(main, /materialDetail \+ bonfireMaterialDetailBirth \* timeStep\)/);
  assert.match(main, /microSmoke \+ bonfireMicroSmokeBirth \* timeStep\)/);
  assert.match(main, /fireLick = fireLick \* stepRate\(tallPlumeFuelReactionGate\) \+ tallPlumeFuelHeatReaction \* fireLickOperatorGain \* 0\.16 \* timeStep;/);
  assert.match(main, /flame = flame \* stepRate\(bonfireFireCeiling\);/);
  assert.match(main, /flameDetail = flameDetail \* stepRate\(mix\(1\.0, max\(0\.12, bonfireVisibleSourcePlugRelief\), bonfireScene\)\);/);
  // Generic: no bare per-step survival of these forms remains in the main kernel.
  const channels = 'smoke|heat|fuel|flame|ember|materialDetail|flameDetail|combustionFront|combustionFrontTopology|microSmoke|interfaceShred|fireLick|emberFleck';
  assert.doesNotMatch(main, new RegExp(`^\\s*(${channels}) = \\1 \\* mix\\(0\\.\\d+, 1\\.0, wallFade\\)`, 'm'), 'no bare wall sponge remains');
  assert.doesNotMatch(main, new RegExp(`^\\s*(${channels}) = \\1 \\* tallPlumeFireSurvival;`, 'm'), 'no bare height survival remains');
  assert.doesNotMatch(main, new RegExp(`^\\s*(${channels}) = \\1 \\* \\(1\\.0 - localQuenchSuppression`, 'm'), 'no bare quench attenuation remains');
  assert.doesNotMatch(main, new RegExp(`^\\s*(${channels}) = \\1 \\* (bonfireFireCeiling|mix\\(1\\.0, max\\()`, 'm'), 'no bare Bonfire attenuation remains');
  // The explicit exceptions: canonical 0/1 scene masks and max() floors.
  assert.match(main, /fuel = fuel \* canonicalProofCarrierMask;/, 'canonical scene masks stay as selectors');
  assert.equal(core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 2, advectionScheme: 'maccormack' }).effective.scalarExceptions, 'max-birth-floors-and-scene-selector-masks');
});

test('review of 57b45f72: relaxation blends and the wall velocity sponge follow the step; scene selectors and floors are the only exceptions', () => {
  const main = mainKernel();
  // A relaxation blend x = mix(x, target, w) keeps (1 - w) of the deviation per
  // step; under the uniform step the weight becomes 1 - (1 - w)^dt.
  const helper = wgslFunction('stepBlend');
  assert.match(helper, /return 1\.0 - stepRate\(1\.0 - weight\);/, 'stepBlend is the complement of stepRate');
  const model = (w, dt, uniform) => (uniform ? 1 - Math.pow(1 - w, dt) : w);
  assert.equal(model(0.044, 0.25, false), 0.044);
  assert.ok(Math.abs(model(0.044, 1, true) - 0.044) < 1e-12, 'a whole step blends the authored weight');
  assert.ok(Math.abs(model(0.044, 0.5, true) - (1 - Math.sqrt(1 - 0.044))) < 1e-12);
  assert.ok(model(0.044, 0.1, true) < 0.0046 && model(0.044, 0.1, true) > 0.0044, 'a tenth of a step blends about a tenth of the weight');
  // The Bonfire scene's explicit diffusion and symmetry blends.
  assert.match(main, /material = mix\(material, diffuseMaterial, stepBlend\(bonfireTurbulentDiffusionMix\)\);/);
  assert.match(main, /fireLayer = mix\(fireLayer, diffuseFireLayer, stepBlend\(bonfireTurbulentDiffusionMix \* 0\.55\)\);/);
  assert.match(main, /microLayer = mix\(microLayer, diffuseMicroLayer, stepBlend\(bonfireTurbulentDiffusionMix \* 0\.90\)\);/);
  assert.match(main, /combustionFrontTopology = mix\(combustionFrontTopology, diffuseFrontTopology, stepBlend\(bonfireTurbulentDiffusionMix \* 0\.42\)\);/);
  assert.match(main, /material = mix\(material, symmetricMaterial, stepBlend\(bonfireScalarSymmetryBlend\)\);/);
  assert.match(main, /fireLayer = mix\(fireLayer, symmetricFireLayer, stepBlend\(bonfireScalarSymmetryBlend \* 0\.70\)\);/);
  assert.match(main, /microLayer = mix\(microLayer, symmetricMicroLayer, stepBlend\(bonfireScalarSymmetryBlend \* 0\.82\)\);/);
  assert.match(main, /combustionFrontTopology = mix\(combustionFrontTopology, symmetricFrontTopology, stepBlend\(bonfireScalarSymmetryBlend \* 0\.38\)\);/);
  // Generic: no relaxation blend of a stored layer or channel toward a target
  // remains with a bare per-step weight (a blend whose first argument is the
  // channel itself; scene selectors mix two candidates and are not caught).
  const relaxable = 'material|fireLayer|microLayer|smoke|heat|fuel|flame|ember|materialDetail|flameDetail|combustionFront|combustionFrontTopology|microSmoke|interfaceShred|fireLick|emberFleck';
  assert.doesNotMatch(main, new RegExp(`^\\s*(${relaxable}) = mix\\(\\1, [^,]+, (?!stepBlend\\()`, 'm'), 'no bare relaxation blend remains');
  // The wall sponge on velocity is written after the increment law's line, so
  // it takes the rate law directly.
  assert.match(main, /vel = vel \* stepRate\(mix\(0\.55, 1\.0, wallFade\)\);/, 'the wall velocity sponge is a per-step survival');
  assert.doesNotMatch(main, /vel = vel \* mix\(0\.55, 1\.0, wallFade\);/, 'no bare wall velocity sponge remains');
  // The remaining per-step operations are 0/1 selectors and floors.
  assert.match(main, /smoke = mix\(columnSmokeTransport, bonfireSmokeTransport, bonfireScene\);/, 'Bonfire scene selector stays a selector');
  assert.match(main, /vel\.y = mix\(max\(vel\.y, -0\.015\), vel\.y, bonfireScene\);/, 'the vertical velocity floor stays a floor');
  assert.match(index, /Bonfire scene's diffusion and symmetry blends and the wall velocity sponge follow the same step/, 'the help names the blends and the wall velocity sponge');
});

test('the resolver, receipt and help say the scalar rates follow the step', () => {
  assert.equal(core.resolveTimeStepConfig({ speed: 2, advectionScheme: 'maccormack' }).effective.scalarRates, 'per-step');
  assert.equal(core.resolveTimeStepConfig({ timeStep: 'uniform', speed: 2, advectionScheme: 'maccormack' }).effective.scalarRates, 'per-time');
  assert.doesNotMatch(index, /scalar reaction and decay rates remain per step in both modes/, 'the help no longer names the half-step limit');
  assert.match(index, /decays, reaction, conversion and the boundary sponges follow the same step/, 'the help states the scalar law');
});

test('the residual probe carries a vertical profile of mean vertical velocity, heat and smoke per height slab', () => {
  assert.equal(core.PRESSURE_RESIDUAL_FLOATS_PER_WORKGROUP, 16, 'four vec4 partials per workgroup: compact, wide, vorticity, profile');
  const reduce = source.slice(source.indexOf('fn pressureResidualReduce('), source.indexOf('fn csPressureResidualBefore('));
  assert.match(reduce, /let partialIndex = 4u \* \(/, 'partial stride is four vec4');
  assert.match(reduce, /pressureResidualPartials\[partialIndex \+ 3u\] = vec4<f32>\(verticalVelocitySum, heatSum, smokeSum, hotVelocitySum\);/, 'profile partial written by the before pass, with the heat-weighted vertical velocity');
  assert.match(reduce, /hotVelocity = verticalVelocity \* heatValue;/, 'heat-weighted vertical velocity is accumulated per cell');
  assert.match(source, /hotVerticalVelocityMean: profileHotVelocity\.map\(/, 'the hot gas rise speed is exported per slab');
  assert.match(reduce, /verticalVelocity = readSlot\(vec3<i32>\(gid\), 0u\)\.y;/, 'vertical velocity sampled from the carried field');
  assert.match(source, /profile: \{\s*identity: 'height-profile-before-projection-v0',/, 'CPU reduction exports the profile');
  assert.match(source, /verticalVelocityMean: profileVerticalVelocity\.map\(/, 'per-slab means are exported');
  const capture = readFileSync(new URL('../volume-transport-arm-capture.mjs', import.meta.url), 'utf8');
  assert.match(capture, /heightProfile: s\.pressureSolver\?\.residual\?\.profile \?\? null/, 'the arm capture records the profile');
  assert.match(capture, /--settle-steps/, 'the capture can settle by simulation steps so arms at different dt reach equal simulated time');
  assert.match(capture, /did not reach \$\{settleSteps\} settle steps within/, 'a step-settled arm that runs out of wall time fails instead of reporting a short arm');
});
