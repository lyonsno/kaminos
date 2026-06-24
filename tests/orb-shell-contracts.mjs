import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const index = readFileSync(join(root, 'index.html'), 'utf8');

assert.match(index, /data-tab="orb-shell"/, 'sidebar exposes an Orb Shell tab');
assert.match(index, /id="tab-orb-shell"/, 'Orb Shell tab content is present');
assert.match(index, /kaminos_orb_shell_witness/, 'URL route gate names the orb-shell witness');
assert.match(index, /orb-shell-core\.js/, 'index imports the orb shell module');
assert.match(index, /createKaminosOrbShellWitness/, 'index initializes the orb-shell route explicitly');
assert.match(index, /orb-shell-single-layer-witness-v0/, 'UI carries the single-layer shell witness identity');
assert.match(index, /orb-shell-support-manifold-v0/, 'UI carries the shell support manifold identity');
assert.match(index, /id="orb-shell-seed"/, 'Orb Shell tab exposes seed control');
assert.match(index, /id="orb-shell-leaf-count"[^>]+min="8"[^>]+max="14"/, 'first slice constrains visible shell leaves to 8-14');
assert.match(index, /id="orb-shell-aperture-count"[^>]+min="3"/, 'first slice requires primary plus secondary apertures');
assert.match(index, /id="orb-shell-layer-count"[^>]+value="1"[^>]+disabled/, 'first slice keeps visible layer count locked to one');
assert.match(index, /window\.__kaminosOrbShellWitness/, 'browser witnesses can inspect orb-shell debug state');
assert.match(index, /initOrbShellRoute/, 'index initializes the orb-shell route from URL state');
assert.match(index, /if \(params\.get\('kaminos_orb_shell_witness'\) === '1'\)/, 'orb shell route activates from an explicit query gate');

const corePath = join(root, 'orb-shell-core.js');
assert.ok(existsSync(corePath), 'orb-shell-core.js exists');
const core = existsSync(corePath) ? readFileSync(corePath, 'utf8') : '';

assert.match(core, /ORB_SHELL_WITNESS_IDENTITY\s*=\s*'orb-shell-single-layer-witness-v0'/, 'core names the single-layer witness identity');
assert.match(core, /ORB_SHELL_SUPPORT_MANIFOLD\s*=\s*'orb-shell-support-manifold-v0'/, 'core names the sphere support manifold');
assert.match(core, /ShellSkeletonDescriptor/, 'core names ShellSkeletonDescriptor records');
assert.match(core, /ApertureGraphDescriptor/, 'core names ApertureGraphDescriptor records');
assert.match(core, /CoreSocketDescriptor/, 'core names CoreSocketDescriptor records for Molten handoff');
assert.match(core, /layerPath:\s*\['outer'\]/, 'first slice records a single outer layer path');
assert.match(core, /canTransitionLayers:\s*false/, 'first slice reserves but disables layer transitions');
assert.match(core, /transitionEvents:\s*\[\]/, 'first slice records no layer transition events');
assert.match(core, /primary-front-aperture/, 'core creates a named primary front aperture');
assert.match(core, /secondary-gill/, 'core creates named secondary slit or gill apertures');
assert.match(core, /rimProximity/, 'core exposes rim/lip proximity for composition');
assert.match(core, /innerExposure/, 'core exposes inner exposure for Molten composition');
assert.match(core, /shellOcclusion/, 'core exposes shell occlusion for Molten composition');
assert.match(core, /motionHandles:\s*\[/, 'shell members expose future animation handles');
assert.match(core, /forbiddenFirstSliceScope/, 'debug state records forbidden first-slice scope');
assert.match(core, /multi-layer-interleaving/, 'debug state forbids multi-layer interleaving in this slice');
assert.match(core, /real-inner-core/, 'debug state forbids real inner-core claims in this slice');
assert.match(core, /recipe-gallery/, 'debug state forbids old recipe-gallery continuation');

const witnessPath = join(root, 'orb-shell-witness.mjs');
assert.ok(existsSync(witnessPath), 'orb-shell-witness.mjs exists');
const witness = existsSync(witnessPath) ? readFileSync(witnessPath, 'utf8') : '';
assert.match(witness, /kaminos_orb_shell_witness=1/, 'witness captures the explicit orb shell route');
assert.match(witness, /orb-shell-single-layer-witness-v0/, 'witness requires the single-layer route identity');
assert.match(witness, /ShellSkeletonDescriptor/, 'witness records shell skeleton descriptors');
assert.match(witness, /ApertureGraphDescriptor/, 'witness records aperture graph descriptors');
assert.match(witness, /blank frame/i, 'witness fails loudly on blank visual output');
