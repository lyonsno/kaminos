import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const core = readFileSync(join(root, 'orb-shell-composition-core.js'), 'utf8');

assert.match(
  core,
  /SocketTonguePostStripHonestyPreservationPlan/,
  'composition core must name the post-strip-honesty socket-tongue preservation plan',
);
assert.match(
  core,
  /socketTongueIdentityPreservation/,
  'strip honesty smoothing must carry explicit socket-tongue identity preservation hooks',
);

const { createTargetOrbShellCompositionFixture } = await import('../orb-shell-composition-core.js');

const fiveMacro = createTargetOrbShellCompositionFixture({
  variantId: 'wide-cup',
  variationSeed: 6,
  variationLeafCount: 11,
});

const lowerSocket = fiveMacro.macroAssemblages.find(item => item.id === 'lower-socket-keel');
assert.ok(lowerSocket, 'stress fixture includes lower-socket keel');

const plan = fiveMacro.socketTongueProvenancePlan;
const candidate = plan?.candidates?.find(item => (
  item.id === 'lower-socket-keel-promoted-body-socket-tongue-candidate'
));
assert.ok(candidate, 'stress fixture still exposes the preserved socket-tongue candidate');
assert.equal(
  candidate.provisionalDisposition,
  'preserve-as-secondary-vocabulary-candidate',
  'candidate is still declared preservable vocabulary before the post-strip-honesty audit',
);

const preservationPlan = plan.postStripHonestyPreservationPlan;
assert.equal(
  preservationPlan?.schema,
  'SocketTonguePostStripHonestyPreservationPlan',
  'provenance plan must expose a post-strip-honesty preservation plan',
);
assert.equal(
  preservationPlan.mode,
  'socket-tongue-post-strip-honesty-preservation-v0',
  'preservation plan records its mode',
);
assert.equal(
  preservationPlan.targetCandidateId,
  candidate.id,
  'preservation plan is anchored to the known lower-socket socket-tongue candidate',
);
assert.equal(
  preservationPlan.stripHonestyLawId,
  lowerSocket.lowerSocketStripHonestyLaw?.id,
  'preservation plan names the strip-honesty law that might otherwise erase the candidate',
);
assert.ok(
  preservationPlan.protectedFailureClasses.includes('smooth-away-hook-signal'),
  'preservation plan protects specifically against smoothing away the hook signal',
);
assert.ok(
  preservationPlan.protectedFailureClasses.includes('erase-secondary-socket-tongue-without-receiver-disposition'),
  'preservation plan forbids silent erasure without a receiver-owned disposition',
);

const record = preservationPlan.records.find(item => item.candidateId === candidate.id);
assert.equal(
  record?.schema,
  'SocketTonguePostStripHonestyPreservationRecord',
  'candidate carries a typed post-strip-honesty preservation record',
);
assert.equal(
  record.preStripDisposition,
  'preserve-as-secondary-vocabulary-candidate',
  'record starts from the invariant plan preservation disposition',
);
assert.equal(
  record.identityPreservationVerdict,
  'protected-secondary-socket-tongue-preserved-after-strip-honesty',
  'strip honesty may smooth the strip only after preserving the secondary socket-tongue identity',
);
assert.equal(
  record.receiverOwnedAbsorptionDisposition,
  null,
  'current fixture has not yet earned the right to absorb the candidate under a receiver-owned tuck disposition',
);
assert.equal(
  record.provisionalVisibleCapAuthority,
  'provisional-visible-until-receiver-owned-tuck',
  'receiverless socket-tongue candidate keeps provisional terminal-cap visibility instead of pretending receiver absorption is solved',
);
assert.equal(
  record.silentErasureAllowed,
  false,
  'silent erasure of the candidate is never a valid smoothing outcome',
);
assert.ok(
  record.protectedSignalSpans.some(span => span.signal === 'terminal-hook-pressure' && span.t0 <= 0.72 && span.t1 >= 1),
  'terminal hook pressure span is explicitly protected through the strip-honesty pass',
);
assert.ok(
  record.protectedSignalSpans.some(span => span.signal === 'subordinate-sheet-body' && span.t0 <= 0.05 && span.t1 >= 0.82),
  'sheet body span remains protected so the candidate does not collapse into a line or generic broad strip',
);
assert.ok(
  record.smoothingMayChange.includes('high-frequency-sidewall-kinks'),
  'record distinguishes allowed smoothing edits from semantic erasure',
);
assert.ok(
  record.smoothingMayNotChange.includes('secondary-socket-tongue-objecthood'),
  'record forbids changing the candidate into generic strip anatomy without disposition',
);
assert.ok(
  record.smoothingMayNotChange.includes('terminal-hook-signal'),
  'record forbids smoothing away the terminal hook signal',
);
assert.equal(
  record.failureClasses.includes('smooth-away-hook-signal'),
  false,
  'post-strip-honesty record does not report the exact regression class the invariant forbids',
);
assert.equal(
  record.failureClasses.includes('erase-secondary-socket-tongue-without-receiver-disposition'),
  false,
  'post-strip-honesty record does not allow silent erasure of the secondary candidate',
);

const identityPolicy = lowerSocket.lowerSocketStripHonestyLaw?.sideCurveSmoothing?.kinkBudgetSolver?.socketTongueIdentityPreservation;
assert.equal(
  identityPolicy?.mode,
  'socket-tongue-aware-kink-budget-v0',
  'kink-budget solver is identity-aware instead of only curvature-aware',
);
assert.ok(
  identityPolicy.protectedCandidateIds.includes(candidate.id),
  'kink-budget solver names the protected socket-tongue candidate',
);
assert.ok(
  identityPolicy.protectedSignalClasses.includes('terminal-hook-signal'),
  'identity policy protects terminal hook signal',
);
assert.ok(
  identityPolicy.protectedSignalClasses.includes('subordinate-sheet-objecthood'),
  'identity policy protects subordinate sheet objecthood',
);
assert.equal(
  identityPolicy.requiresReceiverOwnedAbsorptionDisposition,
  true,
  'identity policy requires explicit receiver-owned absorption before candidate disappearance',
);

const lowerSocketTerminalCaps = fiveMacro.liveMacroSideWallPlan.terminalCaps.filter(cap => cap.parentAssemblage === 'lower-socket-keel');
assert.equal(
  lowerSocketTerminalCaps.length,
  2,
  'lower socket still has paired topology caps for the provisional socket tongue',
);
assert.ok(
  lowerSocketTerminalCaps.every(cap => cap.normalRenderVisible === true),
  'receiverless provisional socket tongue keeps terminal caps visible instead of silently hiding them under an unsolved receiver',
);
assert.ok(
  lowerSocketTerminalCaps.every(cap => cap.capAuthority === 'provisional-visible-until-receiver-owned-tuck'),
  'visible provisional caps carry socket-tongue authority rather than full promoted-body authority',
);
assert.ok(
  lowerSocketTerminalCaps.every(cap => cap.receiverOwnedTuckDisposition === null),
  'visible provisional caps record that no receiver-owned tuck disposition exists yet',
);
assert.deepEqual(
  fiveMacro.liveMacroSideWallPlan.normalRenderHiddenTerminalCapIds.filter(id => id.startsWith('lower-socket-keel-')),
  [],
  'sidewall plan must not list lower-socket provisional socket-tongue caps as hidden before a receiver-owned disposition exists',
);
