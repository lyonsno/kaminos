import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateStructuralCarriedFireTerminalChecks } from '../structural-combustion-gpu.mjs';

const emitter = {
  id: 'target',
  role: 'emitter',
  objectId: 21,
  nodes: [{
    ignitionStep: 40,
    firstEmissionStep: 48,
    componentMotion: {
      active: true,
      detachmentStep: 110,
      translation: [0.18, -0.82, 0.04],
    },
  }],
};
const propagationTarget = {
  id: 'propagation-target',
  role: 'propagation-target',
  objectId: 23,
  nodes: [{ ignitionStep: 164, firstExposureStep: 138, peakExposure: 1.2, temperature: 0.9 }],
};
const propagationControl = {
  id: 'propagation-control',
  role: 'propagation-control',
  objectId: 24,
  nodes: [{ ignitionStep: 0, firstExposureStep: 0, peakExposure: 0, temperature: 0.08 }],
};

const checks = evaluateStructuralCarriedFireTerminalChecks({
  decodedStructures: [emitter, propagationTarget, propagationControl],
  receiverAudit: {
    audit: {
      auditObjectId: 21,
      acceptedRecords: 90,
      rejectedRecords: 0,
      firstAcceptedStep: 48,
      lastAcceptedStep: 180,
    },
  },
  carriedAudit: { movedSourceRecords: 12, firstMovedSourceStep: 120, lastMovedSourceStep: 180 },
  hostCausalFeedbackCount: 0,
});
assert.deepEqual(checks, {
  detachedEmitterMoved: true,
  movedSourceAccepted: true,
  propagationTargetExposed: true,
  propagationAfterDetachment: true,
  propagationTargetIgnited: true,
  propagationControlCool: true,
  noHostFeedback: true,
});

const premature = evaluateStructuralCarriedFireTerminalChecks({
  decodedStructures: [
    emitter,
    { ...propagationTarget, nodes: [{ ...propagationTarget.nodes[0], firstExposureStep: 90 }] },
    propagationControl,
  ],
  receiverAudit: { audit: { auditObjectId: 21, acceptedRecords: 90, rejectedRecords: 0, lastAcceptedStep: 180 } },
  carriedAudit: { movedSourceRecords: 12, firstMovedSourceStep: 120, lastMovedSourceStep: 180 },
  hostCausalFeedbackCount: 0,
});
assert.equal(premature.propagationAfterDetachment, false, 'pre-detachment exposure cannot close carried-fire propagation');

const unaudited = evaluateStructuralCarriedFireTerminalChecks({
  decodedStructures: [emitter, propagationTarget, propagationControl],
  receiverAudit: { audit: { auditObjectId: 21, acceptedRecords: 90, rejectedRecords: 0, lastAcceptedStep: 180 } },
  carriedAudit: { movedSourceRecords: 0, firstMovedSourceStep: 0, lastMovedSourceStep: 0 },
  hostCausalFeedbackCount: 0,
});
assert.equal(unaudited.movedSourceAccepted, false, 'aggregate receiver traffic cannot impersonate moved-source publication');

const gpuSource = readFileSync(new URL('../structural-combustion-gpu.mjs', import.meta.url), 'utf8');
assert.match(gpuSource, /firstExposureStep/, 'the frozen receipt must name first contact, not infer it from a peak');
assert.match(gpuSource, /STRUCTURAL_EXPOSURE_ENABLED/, 'exposure authority must be independent from emission authority');
assert.match(gpuSource, /STRUCTURAL_EMISSION_ENABLED/, 'the downstream witness must not become a second emitter');

const pageSource = readFileSync(new URL('../structural-combustion.html', import.meta.url), 'utf8');
assert.match(pageSource, /id: 'propagation-target'/, 'the browser witness needs a downstream combustible object');
assert.match(pageSource, /id: 'propagation-control'/, 'the downstream target needs a matched noncontact control');
assert.match(pageSource, /emissionEnabled: false/, 'the downstream object cannot manufacture its own carried-source proof');

console.log('structural carried-fire propagation contracts: ok');
