import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const imagegenRoot = dirname(fileURLToPath(import.meta.url));
const artifactRoot = resolve(imagegenRoot, '..');
const rootReportPath = resolve(artifactRoot, 'report.json');
const planPath = resolve(imagegenRoot, 'plan.json');
const completionPath = resolve(imagegenRoot, 'completion-report.json');
const contactReceiptPath = resolve(imagegenRoot, 'contact-sheet-receipt.json');
const reportPath = resolve(imagegenRoot, 'report.json');

async function evidence(path) {
  const bytes = await readFile(path);
  if (!bytes.length) throw new Error(`empty evidence: ${path}`);
  return {
    path: relative(artifactRoot, path),
    byteSize: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

const plan = JSON.parse(await readFile(planPath, 'utf8'));
const completion = JSON.parse(await readFile(completionPath, 'utf8'));
const contactReceipt = JSON.parse(await readFile(contactReceiptPath, 'utf8'));
if (completion.status !== 'complete' || completion.accepted.length !== 20 || completion.rejected.length !== 0) {
  throw new Error('cannot adjudicate an incomplete or rejected imagegen matrix');
}
if (!['complete-uninspected', 'complete-inspected'].includes(contactReceipt.status)
    || contactReceipt.sheets.length !== 2) {
  throw new Error(`contact sheets are not at the inspection gate: ${contactReceipt.status}`);
}

const durations = completion.accepted.map(cell => cell.durationSeconds);
const byRoute = Object.values(Object.groupBy(completion.accepted, cell => cell.effectiveJobType)).map(cells => ({
  effectiveJobType: cells[0].effectiveJobType,
  count: cells.length,
  averageSeconds: cells.reduce((sum, cell) => sum + cell.durationSeconds, 0) / cells.length,
  minimumSeconds: Math.min(...cells.map(cell => cell.durationSeconds)),
  maximumSeconds: Math.max(...cells.map(cell => cell.durationSeconds)),
}));

contactReceipt.status = 'complete-inspected';
contactReceipt.visualInspectionClaim = 'inspected-original-resolution';
contactReceipt.visualInspection = {
  disposition: 'accepted-multi-gestalt-morphology-steering',
  inspectedSheets: contactReceipt.sheets.map(sheet => sheet.sheet),
  visibleDelta:
    'Five source-anchored body plans recruit visibly different organism gestalts across both seeds; three-reference conditioning preserves silhouette, mass hierarchy, and contact layout substantially more strongly than clay-only conditioning.',
  residual:
    'All twenty outputs converge toward a related fleshy green-purple aesthetic basin, so independent style/material steering remains unproven.',
};
contactReceipt.lastTrustworthyEvidence =
  'all 20 outputs admitted; both original-resolution seed sheets visually inspected against their armature and normal controls';
await writeFile(contactReceiptPath, `${JSON.stringify(contactReceipt, null, 2)}\n`);

const report = {
  schema: 'kaminos.lirm-armature-gestalt-family-imagegen-assay.v0',
  status: 'multi-gestalt-morphology-passed-inspected',
  result: {
    loadBearingQuestion:
      'Does one fixed invention prompt recruit materially different organism priors from five source-anchored 3D body plans while preserving recognizable lineage?',
    answer: 'yes-with-reference-pressure-gradient',
    comparisonClass: 'five body plans, clay-only versus clay-depth-normal, two fixed seeds, one fixed Flux2 Klein prompt and inference budget',
    candidateCount: 5,
    armatureProgramCount: 3,
    generatedOutputCount: 20,
  },
  visualFindings: [
    {
      candidateId: 'crawler-basin22',
      finding: 'Three-reference conditioning retains the paired posterior domes and low splayed contact plan; clay-only expands toward generic quadrupedal reptilian anatomy.',
    },
    {
      candidateId: 'upright-basin03',
      finding: 'Three-reference conditioning retains the tall narrow trunk and fused basal pedestal; clay-only recruits broader humanoid or bipedal anatomy.',
    },
    {
      candidateId: 'upright-basin10',
      finding: 'Both seeds produce a compact forward-heavy organism on discrete splayed contacts, materially distinct from the other upright fits.',
    },
    {
      candidateId: 'upright-basin22',
      finding: 'Both seeds produce a consolidated vertical body on a broad radial foot with a different head-to-base proportion from basin10.',
    },
    {
      candidateId: 'bulbous-radial-lirm02',
      finding: 'All four cells preserve the long anterior neck, posterior ballast, and low radial base, confirming the already observed strong basin.',
    },
  ],
  referencePressureFinding:
    'Clay-only acts as an inspiration regime with more model-prior anatomy; clay-depth-normal acts as a lineage regime with stronger spatial adherence. The route therefore exposes a useful adherence/invention lever without changing the body generator.',
  residualUncertainty: {
    styleIndependence: 'not_yet_assayed',
    trellisSurvivalForNewGestalts: 'not_yet_fired',
    arbitraryTopologyComposition: 'not_claimed',
    withinProgramBasinWidth: 'supported_by_three_upright_fits_but_not_exhaustively_mapped',
  },
  timing: {
    totalModelSeconds: durations.reduce((sum, value) => sum + value, 0),
    averageModelSeconds: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    byRoute,
  },
  evidence: {
    plan: await evidence(planPath),
    completion: await evidence(completionPath),
    contactSheetReceipt: await evidence(contactReceiptPath),
    sheets: await Promise.all(contactReceipt.sheets.map(sheet => evidence(resolve(artifactRoot, sheet.sheet.path)))),
  },
  nextPressure: [
    'Promote upright-basin10 clay-depth-normal seed718113 through Trellis to test cast survival for a newly proven gestalt.',
    'Hold the body/reference regime fixed and fire a radically different aesthetic/material prompt to test whether morphology and style are independently steerable.',
  ],
  falseClosureGuards: {
    productionCreatureClaim: 'forbidden',
    generalCreatureMediumClaim: 'promising_not_proven',
    styleAxisClaim: 'not_yet_assayed',
    trellisCastClaim: 'not_yet_fired_for_this_family',
  },
};
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

const rootReport = JSON.parse(await readFile(rootReportPath, 'utf8'));
rootReport.status = 'imagegen-multi-gestalt-passed-inspected';
rootReport.evidencePredicate.inferenceClaim = '20 Flux2 outputs accepted and inspected';
rootReport.evidencePredicate.imagegenClaim = 'five-body morphology steering passed across two seeds and two reference regimes';
rootReport.evidencePredicate.nextGate = 'one newly proven gestalt through Trellis plus an orthogonal style/material pressure firing';
rootReport.imagegenReport = await evidence(reportPath);
rootReport.falseClosureGuards.visualProgressClaim = 'multi_gestalt_imagegen_outputs_inspected';
rootReport.falseClosureGuards.imagegenBasinClaim = 'multi_gestalt_morphology_passed';
rootReport.falseClosureGuards.trellisCastClaim = 'not_yet_fired_for_new_gestalt';
rootReport.falseClosureGuards.generalMorphologyMediumClaim = 'promising_not_proven';
await writeFile(rootReportPath, `${JSON.stringify(rootReport, null, 2)}\n`);

console.log(JSON.stringify(report, null, 2));
