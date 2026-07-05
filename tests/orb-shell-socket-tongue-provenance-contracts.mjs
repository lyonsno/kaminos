import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');
const witness = readFileSync(join(root, 'orb-shell-composition-witness.mjs'), 'utf8');

assert.match(core, /SocketTongueProvenancePlan/, 'composition core must name the socket-tongue provenance plan');
assert.match(core, /createSocketTongueProvenancePlan/, 'composition core must build socket-tongue provenance from live anatomy');
assert.match(core, /SocketTongueGenerativeInvariantPlan/, 'composition core must name the socket-tongue generative invariant plan');
assert.match(core, /socketTongueProvenancePlan/, 'debug state must expose socket-tongue provenance');
assert.match(witness, /socketTongueProvenancePlan/, 'headless witness report must preserve socket-tongue provenance');

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});
const baseline = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 7,
  variationLeafCount: 10,
});

const plan = fiveMacro.socketTongueProvenancePlan;
assert.equal(plan?.schema, 'SocketTongueProvenancePlan', 'five-macro stress fixture exposes socket-tongue provenance');
assert.equal(plan.mode, 'socket-tongue-provenance-v0', 'plan records the accepted provenance mode');
assert.equal(plan.targetAssemblage, 'lower-socket-keel', 'provenance is scoped to the lower-socket offender');
assert.equal(
  plan.diagnosticQuestion,
  'what procedural source created the lower-left hooked socket tongue',
  'plan preserves the operator-facing diagnostic question',
);
assert.ok(
  plan.repeatabilityInputs.some(input => (
    input.variantId === 'wide-cup'
    && input.variationSeed === 6
    && input.variationLeafCount === 11
    && input.selectedMacroAssemblageIds.includes('lower-socket-keel')
  )),
  'plan records the stress inputs that make the lower-socket tongue reproducible',
);
assert.equal(plan.candidateCount, plan.candidates.length, 'candidateCount matches candidate records');
assert.ok(plan.candidateCount >= 1, 'plan identifies at least one socket-tongue candidate');

const candidate = plan.candidates.find(item => item.parentAssemblage === 'lower-socket-keel');
assert.equal(candidate?.schema, 'SocketTongueCandidate', 'lower-socket candidate is a typed provenance record');
assert.equal(candidate.candidateClass, 'secondary-underpass-socket-tongue-candidate', 'candidate is classified as secondary socket-tongue vocabulary');
assert.equal(candidate.provisionalDisposition, 'preserve-as-secondary-vocabulary-candidate', 'candidate is preserved instead of erased as mere bad geometry');
assert.equal(candidate.sourceClass, 'MacroPromotedBody', 'visible tongue source is the promoted lower-socket body');
assert.equal(candidate.sourceId, 'lower-socket-keel-promoted-body', 'candidate names the concrete promoted body source');
assert.equal(candidate.sourcePath, 'macroAssemblages.lower-socket-keel.macroPromotedBody', 'candidate records the exact source path');
assert.deepEqual(
  candidate.sideWallIds.sort(),
  [
    'lower-socket-keel-left-promoted-body-edge-live-sidewall',
    'lower-socket-keel-right-promoted-body-edge-live-sidewall',
  ].sort(),
  'candidate names the live sidewalls that make the hooked tongue legible',
);
assert.deepEqual(
  candidate.protectedTerminalCapIds.sort(),
  [
    'lower-socket-keel-start-terminus-live-terminal-cap',
    'lower-socket-keel-end-terminus-live-terminal-cap',
  ].sort(),
  'candidate preserves protected terminal caps as supporting socket-tongue topology evidence',
);
assert.deepEqual(
  candidate.provisionalVisibleTerminalCapIds.sort(),
  candidate.protectedTerminalCapIds.sort(),
  'receiverless candidate keeps protected caps provisionally visible until receiver-owned absorption exists',
);
assert.ok(
  candidate.supportingEvidenceClasses.includes('LiveMacroSideWall')
    && candidate.supportingEvidenceClasses.includes('LiveMacroTerminalCap')
    && candidate.supportingEvidenceClasses.includes('LowerSocketFamilyRoleLaw'),
  'candidate explains which existing anatomy records make the accidental form inspectable',
);
assert.ok(
  candidate.whyInteresting.includes('hooked-lower-socket-return')
    && candidate.whyInteresting.includes('narrow-subordinate-underpass-body'),
  'candidate names the visual signal we want to reproduce intentionally',
);
assert.ok(
  candidate.notMacroLamellaBecause.includes('selected-role-is-tuck-tongue')
    && candidate.notMacroLamellaBecause.includes('protected-terminal-caps-deny-independent-objecthood'),
  'candidate explains why this should not be promoted as a full macro lamella',
);
assert.ok(candidate.anatomyMetrics.sideWallCount >= 2, 'candidate records sidewall count');
assert.ok(candidate.anatomyMetrics.protectedTerminalCapCount === 2, 'candidate records protected terminal cap count');
assert.ok(candidate.anatomyMetrics.provisionalVisibleTerminalCapCount === 2, 'candidate records provisional visible terminal caps before receiver ownership exists');
assert.ok(candidate.anatomyMetrics.meanSideWallThickness > 0.045, 'candidate records a physical sidewall thickness metric');
assert.ok(candidate.anatomyMetrics.endCapWidthExpansionRatio > 2, 'candidate captures the flared hook/terminus pressure');
assert.ok(candidate.candidateScore >= 0.72, 'candidate score is high enough to preserve as procedural vocabulary');

assert.equal(
  plan.generativeInvariantPlan?.schema,
  'SocketTongueGenerativeInvariantPlan',
  'plan extracts generative invariants, not only source provenance',
);
assert.equal(
  plan.generativeInvariantPlan.mode,
  'socket-tongue-generative-invariants-v0',
  'invariant plan records its mode',
);
assert.equal(
  candidate.generativeInvariantRecord?.schema,
  'SocketTongueGenerativeInvariantRecord',
  'candidate carries its own invariant record',
);
assert.equal(
  candidate.generativeInvariantRecord.recipeIntent,
  'regenerate-secondary-underpass-socket-tongue-on-purpose',
  'invariant record states the future generation recipe intent',
);
for (const prerequisite of [
  'lower-socket-keel-selected',
  'equatorial-cupping-whorl-selected',
  'lower-equatorial-shared-socket-seam-active',
  'lower-socket-role-is-tuck-tongue',
  'plate-body-honesty-prevents-cord-collapse',
  'terminal-caps-protected-by-receiver-or-provisional-visibility',
  'live-promoted-body-sidewalls-present',
]) {
  assert.ok(
    candidate.generativeInvariantRecord.hardPrerequisites.includes(prerequisite),
    `invariant record names hard prerequisite ${prerequisite}`,
  );
}
for (const invariant of [
  'subordinate-objecthood-not-full-macro-lamella',
  'visible-body-remains-sheetlike-before-tuck',
  'terminal-cap-authority-protected',
  'sidewalls-remain-live-readable-thickness-surfaces',
  'receiver-or-aperture-owner-required-before-disappearance',
]) {
  assert.ok(
    candidate.generativeInvariantRecord.preservedInvariants.includes(invariant),
    `invariant record preserves ${invariant}`,
  );
}
for (const knob of [
  'socketTongueArcLength',
  'terminalHookPressure',
  'receiverSeamPull',
  'sidewallThickness',
  'visiblePlateWidthFloor',
]) {
  assert.ok(
    candidate.generativeInvariantRecord.tunableKnobs.some(item => item.name === knob),
    `invariant record exposes tunable knob ${knob}`,
  );
}
for (const failureClass of [
  'promote-to-full-macro-lamella',
  'collapse-to-cord',
  'show-unowned-terminal-cap-as-settled-object',
  'smooth-away-hook-signal',
  'leave-without-receiver-or-aperture-owner',
]) {
  assert.ok(
    candidate.generativeInvariantRecord.forbiddenFailureClasses.includes(failureClass),
    `invariant record forbids ${failureClass}`,
  );
}
assert.ok(
  candidate.generativeInvariantRecord.observedMetricBands.meanSideWallThickness.includes(candidate.anatomyMetrics.meanSideWallThickness),
  'observed metric bands include the measured sidewall thickness without pretending it is the only valid value',
);
assert.ok(
  candidate.generativeInvariantRecord.observedMetricBands.endCapWidthExpansionRatio.includes(candidate.anatomyMetrics.endCapWidthExpansionRatio),
  'observed metric bands include the measured hook expansion without pretending it is the only valid value',
);
assert.deepEqual(
  plan.generativeInvariantPlan.bestRecipeCandidateIds,
  [candidate.id],
  'generative invariant plan points future recipe work at the preserved socket-tongue candidate',
);
assert.equal(
  plan.bestCandidateId,
  candidate.id,
  'best candidate points at the lower-socket promoted body provenance record',
);
assert.ok(
  plan.followupQuestions.includes('how should secondary socket tongues intentionally attach to aperture/socket contour owners'),
  'plan states the next procedural-law question instead of pretending provenance solves geometry',
);

assert.equal(
  baseline.socketTongueProvenancePlan.candidateCount,
  0,
  'baseline without selected lower-socket does not leave stale socket-tongue candidates behind',
);
assert.equal(
  baseline.socketTongueProvenancePlan.provenanceVerdict,
  'socket-tongue-source-not-selected',
  'baseline records absence rather than hiding missing source identity',
);
