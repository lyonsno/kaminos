import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  LIRM_SPECIATION_ARMATURE_ROUTE,
  LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA,
  createLirmSpeciationArmatureControlPacket,
  createLirmSpeciationArmatureWitness,
  writeLirmSpeciationArmatureWitness,
} = await import('../lirm-speciation-armature-core.js');

assert.equal(LIRM_SPECIATION_ARMATURE_WITNESS_SCHEMA, 'kaminos.lirm-speciation-armature-witness.v0');
assert.equal(LIRM_SPECIATION_ARMATURE_ROUTE, 'kaminos/lirm-speciation-armature/contact-sheet-v0');

const witness = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});
const repeated = createLirmSpeciationArmatureWitness({
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});

assert.deepEqual(repeated.receipt.routeIdentity, witness.receipt.routeIdentity, 'same seed should preserve route receipt identity');
assert.equal(JSON.stringify(repeated.candidates), JSON.stringify(witness.candidates), 'same seed should reproduce the same candidate lineage');
assert.equal(witness.schema, 'kaminos.lirm-speciation-armature-witness.v0');
assert.equal(witness.route, 'kaminos/lirm-speciation-armature/contact-sheet-v0');
assert.equal(witness.seed, 'molten-lirm-seed-0707');
assert.equal(witness.candidates.length, 25);
assert.equal(witness.contactSheet.columns, 5);
assert.equal(witness.contactSheet.rows, 5);
assert.equal(witness.contactSheet.renderedCandidateCount, 25);
assert.equal(witness.contactSheet.visualEvidenceStatus, 'generated_local_svg');
assert.match(witness.contactSheet.svg, /^<svg[\s\S]*<\/svg>$/);
assert.equal((witness.contactSheet.svg.match(/data-candidate-id=/g) || []).length, 25);
assert.equal((witness.contactSheet.svg.match(/data-layer="semantic-map"/g) || []).length, 25);
assert.equal((witness.contactSheet.svg.match(/data-layer="silhouette"/g) || []).length, 25);
assert.equal((witness.contactSheet.svg.match(/class="candidate-title"/g) || []).length, 25, 'each candidate should carry an SVG title tooltip');
assert.match(witness.contactSheet.svg, /data-layer="legend"/, 'contact sheet should label its proxy symbols');
for (const legendTerm of ['body mass', 'axis handle', 'shell plate', 'limb bud', 'contact point', 'head orientation', 'terminal mouth', 'sensory nub', 'belly contact']) {
  assert.match(witness.contactSheet.svg, new RegExp(legendTerm), `legend missing ${legendTerm}`);
}

assert.equal(witness.receipt.schema, 'kaminos.lirm-speciation-armature-receipt.v0');
assert.equal(witness.receipt.effectiveCandidateCount, 25);
assert.equal(witness.receipt.generatorRole, 'procedural_morphology_armature');
assert.equal(witness.receipt.promptOnly, false);
assert.equal(witness.receipt.routeIdentity.schema, 'kaminos.route-identity.v0');
assert.equal(witness.receipt.routeIdentity.requestedRoute, 'kaminos/lirm-speciation-armature/contact-sheet-v0');
assert.equal(witness.receipt.routeIdentity.effectiveRoute, 'kaminos/lirm-speciation-armature/contact-sheet-v0');
assert.equal(witness.receipt.falseClosureGuards.promptOnlyLirmAttempt, 'not_used');
assert.equal(witness.receipt.falseClosureGuards.finishedCreatureClaim, 'forbidden');
assert.equal(witness.receipt.falseClosureGuards.generatorFiringClaim, 'not_yet_fired');
assert.equal(witness.receipt.falseClosureGuards.proxyGeometryClaim, 'control_primitives_only');

const ids = new Set();
let shellPlateCandidateCount = 0;
let limbBudCandidateCount = 0;
let asymmetryCandidateCount = 0;
const gestaltKinds = new Set();
const silhouetteClasses = new Set();
for (const candidate of witness.candidates) {
  assert.match(candidate.id, /^lirm-armature-[0-9]{2}$/);
  assert.ok(!ids.has(candidate.id), `duplicate candidate id ${candidate.id}`);
  ids.add(candidate.id);
  assert.equal(candidate.schema, 'kaminos.lirm-speciation-armature-candidate.v0');
  assert.equal(candidate.lineage.rootSeed, 'molten-lirm-seed-0707');
  assert.equal(candidate.lineage.parentId, 'root-soft-crawling-hoard-thief');
  assert.ok(candidate.lineage.mutationPath.length >= 3, 'candidate mutation path is too thin');
  assert.ok(candidate.lineage.mutationPath.some(entry => entry.startsWith('gestalt:')), 'candidate mutation path must name the silhouette gestalt');
  assert.ok(candidate.bodyPlan.segmentCount >= 5, 'candidate needs segmented body evidence');
  assert.equal(candidate.bodyPlan.gestalt.kind.startsWith('lirm-'), true, 'candidate needs an explicit LIRM gestalt kind');
  assert.ok(candidate.bodyPlan.gestalt.label.length > 4, 'gestalt needs a readable label');
  assert.ok(candidate.bodyPlan.gestalt.priorHooks.length >= 3, 'gestalt needs model-prior hooks for imagegen/Trellis routing');
  assert.ok(candidate.bodyPlan.silhouette.class.length > 4, 'candidate needs a named silhouette class');
  assert.ok(candidate.bodyPlan.silhouette.gestaltPressure > 0, 'silhouette must record nonzero gestalt pressure');
  assert.equal(candidate.bodyPlan.controlPressures.kind, 'semantic-adherence-silhouette-fall-forward-v0');
  assert.ok(candidate.bodyPlan.controlPressures.semanticAdherence >= 0.55, 'candidate should record enough semantic adherence to preserve body identity');
  assert.ok(candidate.bodyPlan.controlPressures.silhouetteFallForward >= 0.35, 'candidate should record silhouette latitude for generator elaboration');
  assert.ok(candidate.bodyPlan.controlPressures.priorInvitation >= 0.35, 'candidate should record model-prior invitation pressure');
  assert.ok(candidate.bodyPlan.controlPressures.rigidAnchors.includes('terminal_front_mouth'), 'control pressures must keep the mouth as a rigid semantic anchor');
  assert.ok(candidate.bodyPlan.controlPressures.rigidAnchors.includes('belly_contact_patch'), 'control pressures must keep belly contact as a rigid semantic anchor');
  assert.ok(candidate.bodyPlan.controlPressures.elasticZones.includes('micro_anatomy'), 'control pressures should identify micro anatomy as an elastic zone');
  assert.ok(candidate.bodyPlan.controlPressures.fallForwardPrompts.length >= 3, 'control pressures need prompt hooks for basin exploration');
  assert.ok(candidate.bodyPlan.controlPressures.routeStance.matchScaffold.length >= 2, 'control pressures need match-scaffold route stance');
  assert.ok(candidate.bodyPlan.controlPressures.routeStance.hallucinateBeyond.length >= 2, 'control pressures need hallucinate-beyond route stance');
  gestaltKinds.add(candidate.bodyPlan.gestalt.kind);
  silhouetteClasses.add(candidate.bodyPlan.silhouette.class);
  assert.ok(candidate.bodyPlan.axisSamples.length >= 7, 'candidate needs axial curve samples');
  assert.ok(candidate.semanticHandles.some(handle => handle.kind === 'axis'), 'candidate missing axis handle');
  assert.ok(candidate.semanticHandles.some(handle => handle.kind === 'head'), 'candidate missing head handle');
  assert.ok(candidate.semanticHandles.some(handle => handle.kind === 'mouth'), 'candidate missing mouth handle');
  assert.ok(candidate.semanticHandles.some(handle => handle.kind === 'belly_contact'), 'candidate missing belly contact handle');
  assert.ok(candidate.semanticHandles.some(handle => handle.kind === 'locomotion'), 'candidate missing locomotion handle');
  assert.ok(candidate.contactPoints.length >= 3, 'candidate needs contact points for future motion routes');
  assert.ok(['crawl', 'inch', 'scuttle', 'flop', 'brace-drag'].includes(candidate.motionAffordance.primary), 'unknown motion affordance');
  assert.ok(candidate.firingAffordances.acceptsImagegenConditioning, 'candidate should expose imagegen conditioning');
  assert.ok(candidate.firingAffordances.acceptsSamIsolation, 'candidate should expose SAM isolation');
  assert.ok(candidate.firingAffordances.acceptsTrellisProbe, 'candidate should expose Trellis probe affordance');
  assert.ok(candidate.firingAffordances.controlMaps.includes('silhouette'), 'candidate missing silhouette control map');
  assert.ok(candidate.firingAffordances.controlMaps.includes('gestalt-silhouette'), 'candidate missing gestalt silhouette control map');
  assert.ok(candidate.firingAffordances.controlMaps.includes('semantic-map'), 'candidate missing semantic-map control map');
  assert.ok(candidate.firingAffordances.controlMaps.includes('proxy-primitives'), 'candidate missing proxy primitive control map');
  const head = candidate.semanticHandles.find(handle => handle.kind === 'head');
  const mouth = candidate.semanticHandles.find(handle => handle.kind === 'mouth');
  assert.ok(mouth.region.x > head.region.x, 'mouth should sit on the terminal front cap, not in the head center');
  assert.ok(mouth.region.x <= 0.985, 'mouth should stay inside the normalized control frame');
  assert.equal(mouth.region.placement, 'terminal_front_cap');
  const packet = createLirmSpeciationArmatureControlPacket({ witness, candidate });
  assert.equal(packet.schema, 'kaminos.lirm-speciation-armature-control-packet.v0');
  assert.equal(packet.candidateId, candidate.id);
  assert.equal(packet.sourceWitnessId, witness.witnessId);
  assert.equal(packet.falseClosureGuards.finishedCreatureClaim, 'forbidden');
  assert.equal(packet.falseClosureGuards.proxyGeometryClaim, 'control_primitives_only');
  assert.equal(packet.gestalt.kind, candidate.bodyPlan.gestalt.kind, 'packet should preserve selected gestalt identity');
  assert.equal(packet.silhouette.class, candidate.bodyPlan.silhouette.class, 'packet should preserve selected silhouette class');
  assert.equal(packet.controlPressures.kind, 'semantic-adherence-silhouette-fall-forward-v0', 'packet should preserve semantic/fall-forward controls');
  assert.ok(packet.proxyPrimitives.some(primitive => primitive.kind === 'metaball' && primitive.role === 'body_mass'), 'packet missing body metaball primitives');
  assert.ok(packet.proxyPrimitives.some(primitive => primitive.kind === 'sphere' && primitive.role === 'terminal_mouth'), 'packet missing terminal mouth proxy primitive');
  assert.ok(packet.conditioningMaps.some(map => map.kind === 'semantic-svg'), 'packet missing semantic SVG control map');
  assert.ok(packet.conditioningMaps.some(map => map.kind === 'silhouette-svg'), 'packet missing silhouette SVG control map');
  assert.ok(packet.promptContract.preserve.includes('terminal front mouth'), 'prompt contract should preserve terminal mouth');
  assert.ok(packet.promptContract.allowMutation.includes('silhouette elaboration'), 'prompt contract should invite silhouette elaboration');
  assert.ok(packet.promptContract.hallucinateBeyond.some(item => item.includes('plausible anatomy')), 'prompt contract should name the beyond-scaffold hallucination target');
  if (candidate.semanticHandles.some(handle => handle.kind === 'shell_plate')) shellPlateCandidateCount += 1;
  if (candidate.semanticHandles.some(handle => handle.kind === 'limb_bud')) limbBudCandidateCount += 1;
  if (candidate.bodyPlan.asymmetry > 0.08) asymmetryCandidateCount += 1;
}

assert.ok(shellPlateCandidateCount >= 5, 'lineage should expose multiple shell/plate variants');
assert.ok(limbBudCandidateCount >= 10, 'lineage should expose limb-bud variants');
assert.ok(asymmetryCandidateCount >= 10, 'lineage should preserve controlled asymmetry variants');
assert.ok(gestaltKinds.size >= 6, `lineage should expose at least six gestalt basins, got ${gestaltKinds.size}`);
assert.ok(silhouetteClasses.size >= 5, `lineage should expose at least five silhouette classes, got ${silhouetteClasses.size}`);
assert.equal(witness.receipt.gestaltAssay.kind, 'silhouette_gestalt_v0');
assert.ok(witness.receipt.gestaltAssay.gestaltKinds.length >= 6, 'receipt should summarize gestalt basin diversity');
assert.ok(witness.receipt.gestaltAssay.silhouetteClasses.length >= 5, 'receipt should summarize silhouette class diversity');
assert.equal(witness.receipt.controlPressureAssay.kind, 'semantic_adherence_silhouette_fall_forward_v0');
assert.ok(witness.receipt.controlPressureAssay.semanticAdherenceRange.min >= 0.55, 'receipt should summarize semantic adherence floor');
assert.ok(witness.receipt.controlPressureAssay.silhouetteFallForwardRange.max > witness.receipt.controlPressureAssay.silhouetteFallForwardRange.min, 'receipt should summarize fall-forward variation');
assert.ok(witness.receipt.controlPressureAssay.priorInvitationRange.max > witness.receipt.controlPressureAssay.priorInvitationRange.min, 'receipt should summarize model-prior invitation variation');

const outDir = await mkdtemp(join(tmpdir(), 'kaminos-lirm-speciation-contract-'));
const writeResult = await writeLirmSpeciationArmatureWitness({
  outDir,
  seed: 'molten-lirm-seed-0707',
  candidateCount: 25,
  columns: 5,
});

assert.equal(writeResult.schema, 'kaminos.lirm-speciation-armature-write-result.v0');
assert.equal(writeResult.receiptPath, join(outDir, 'receipt.json'));
assert.equal(writeResult.contactSheetPath, join(outDir, 'contact-sheet.svg'));
assert.equal(writeResult.contactSheetRasterPath, join(outDir, 'contact-sheet.png'));
assert.ok(writeResult.controlPacketCount >= 25, 'writer should emit routeable packets for every witness candidate by default');
assert.ok(existsSync(writeResult.receiptPath), 'writer must emit a JSON receipt');
assert.ok(existsSync(writeResult.contactSheetPath), 'writer must emit an SVG contact sheet');
assert.ok(existsSync(writeResult.contactSheetRasterPath), 'writer must emit a fresh PNG contact sheet for visual inspection');
assert.ok(existsSync(join(outDir, 'control-packets', 'lirm-armature-00', 'packet.json')), 'writer must emit per-candidate control packet JSON');
assert.ok(existsSync(join(outDir, 'control-packets', 'lirm-armature-00', 'semantic-control.svg')), 'writer must emit per-candidate semantic control SVG');
assert.ok(existsSync(join(outDir, 'control-packets', 'lirm-armature-00', 'silhouette-control.svg')), 'writer must emit per-candidate silhouette control SVG');
assert.ok(existsSync(join(outDir, 'control-packets', 'lirm-armature-00', 'proxy-primitives.json')), 'writer must emit per-candidate proxy primitive JSON');

const writtenReceipt = JSON.parse(readFileSync(writeResult.receiptPath, 'utf8'));
const writtenSheet = readFileSync(writeResult.contactSheetPath, 'utf8');
assert.equal(writtenReceipt.schema, 'kaminos.lirm-speciation-armature-witness.v0');
assert.equal(writtenReceipt.contactSheet.path, 'contact-sheet.svg');
assert.equal(writtenReceipt.receipt.outputInventory.contactSheet, 'contact-sheet.svg');
assert.equal(writtenReceipt.receipt.outputInventory.contactSheetRaster, 'contact-sheet.png');
assert.equal(writtenReceipt.receipt.outputInventory.receipt, 'receipt.json');
assert.equal(writtenReceipt.receipt.outputInventory.controlPackets.length, 25);
assert.equal(writtenReceipt.receipt.outputInventory.controlPackets[0], 'control-packets/lirm-armature-00/packet.json');
assert.match(writtenSheet, /Do not prompt for the creature/);
assert.match(writtenSheet, /Grow the lineage/);
assert.match(writtenSheet, /terminal mouth/);
