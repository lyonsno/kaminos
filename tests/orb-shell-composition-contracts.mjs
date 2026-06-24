import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /kaminos_orb_shell_grounding/, 'index exposes an explicit macro grounding route gate');
assert.match(index, /orb-shell-composition-core\.js/, 'index imports the orb shell composition module');
assert.match(index, /createKaminosOrbShellCompositionWitness/, 'index initializes the macro composition witness');
assert.match(index, /window\.__kaminosOrbShellCompositionWitness/, 'browser witnesses can inspect macro composition debug state');
assert.match(index, /orb-shell-macro-grammar-grounding-v0/, 'UI carries the macro grounding witness identity');

const modulePath = join(root, 'orb-shell-composition-core.js');
assert.ok(existsSync(modulePath), 'orb-shell-composition-core.js exists');
const core = existsSync(modulePath) ? readFileSync(modulePath, 'utf8') : '';

assert.match(core, /ORB_SHELL_COMPOSITION_IDENTITY\s*=\s*'orb-shell-macro-grammar-grounding-v0'/, 'composition module names the grounding identity');
assert.match(core, /OrbShellComposition/, 'module exposes OrbShellComposition schema vocabulary');
assert.match(core, /MacroAssemblage/, 'module exposes MacroAssemblage schema vocabulary');
assert.match(core, /BandMember/, 'module exposes BandMember schema vocabulary');
assert.match(core, /LayerDepthSchedule/, 'module exposes LayerDepthSchedule schema vocabulary');
assert.match(core, /TerminationSocketGraph/, 'module exposes TerminationSocketGraph schema vocabulary');
assert.match(core, /AperturePressure/, 'module exposes AperturePressure schema vocabulary');
assert.match(core, /inverseProceduralHypotheses/, 'composition records inverse-procedural hypotheses');
assert.match(core, /proceduralFamily/, 'fixture fields carry candidate procedural families');
assert.match(core, /biased-spherical-vector-field/, 'fixture considers vector-field impulse-line generation');
assert.match(core, /swept-voronoi-territory/, 'fixture considers territory/boundary generation');
assert.match(core, /offset-tributary-band-family/, 'fixture considers child bands as tributary/offset families');
assert.match(core, /termination-pressure/, 'fixture records procedural termination pressure');
assert.match(core, /stableFamilyIdentity/, 'fixture distinguishes stable family identity from variation parameters');
assert.match(core, /variableParameters/, 'fixture distinguishes variable parameters from family identity');
assert.match(core, /coherent-but-wrong-model-baseline/, 'fixture preserves the v0 witness as a wrong-model baseline');
assert.match(core, /forbiddenFailureClasses/, 'fixture records failure classes');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');
const fixture = createTargetOrbShellCompositionFixture();
assert.equal(fixture.schema, 'OrbShellComposition', 'fixture returns an OrbShellComposition record');
assert.ok(fixture.macroAssemblages.length >= 3 && fixture.macroAssemblages.length <= 5, 'fixture encodes 3-5 macro assemblages');
const bandCount = fixture.macroAssemblages.reduce((sum, item) => sum + item.childBandPlan.length, 0);
assert.ok(bandCount >= fixture.macroAssemblages.length * 2, 'each macro assemblage has multiple child bands');
const terminationCount = fixture.macroAssemblages.reduce((sum, item) => (
  sum + item.terminationPlan.start.length + item.terminationPlan.end.length
), 0);
assert.ok(terminationCount >= fixture.macroAssemblages.length * 2, 'fixture records designed start/end terminations');
assert.ok(fixture.macroAssemblages.every(item => item.inverseProceduralHypotheses?.impulse), 'each macro assemblage records an impulse-line hypothesis');
assert.ok(fixture.macroAssemblages.every(item => item.sphericalTerritory?.boundaryHypothesis?.proceduralFamily), 'each macro assemblage records a territory/boundary hypothesis');
assert.ok(fixture.AperturePressure.forbiddenFailureClasses.includes('arbitrary-hole-mask'), 'aperture pressure rejects arbitrary hole masks');

const witnessPath = join(root, 'orb-shell-composition-witness.mjs');
assert.ok(existsSync(witnessPath), 'orb-shell-composition-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_orb_shell_grounding=1/, 'composition witness captures the explicit grounding route');
assert.match(witness, /orb-shell-macro-grammar-grounding-v0/, 'composition witness requires the grounding identity');
assert.match(witness, /OrbShellComposition/, 'composition witness records the semantic composition');
assert.match(witness, /macroAssemblageCount/, 'composition witness records macro assemblage count');
assert.match(witness, /inverseProceduralHypotheses/, 'composition witness records inverse-procedural hypotheses');
assert.match(witness, /blank frame/i, 'composition witness fails loudly on blank output');
