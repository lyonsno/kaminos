import { createHash } from 'node:crypto';

export const MUSCULATURE_SOURCE_M0_SCHEMA = 'kaminos.musculature-source-m0.v0';
export const MUSCULATURE_SOURCE_M0_VALIDATION_SCHEMA = 'kaminos.musculature-source-m0-validation.v0';

export const PASS_MUSCULATURE_SOURCE_ONLY = 'PASS_MUSCULATURE_SOURCE_ONLY';
export const HOLD_MUSCULATURE_SOURCE_EVIDENCE = 'HOLD_MUSCULATURE_SOURCE_EVIDENCE';
export const FAIL_MUSCULATURE_SOURCE = 'FAIL_MUSCULATURE_SOURCE';

const HASH_PATTERN = /^[0-9a-f]{64}$/i;
const REQUIRED_NAME_SETS = [
  'supportIds',
  'attachmentIds',
  'insertionIds',
  'routedPathIds',
  'pathControlIds',
  'tendonIntervalIds',
  'bellyIntervalIds',
  'wrapGuideIds',
];
const REQUIRED_EVIDENCE_CHECKS = [
  'semanticNamesResolved',
  'localFramesResolved',
  'attachmentInsertionsResolved',
  'routedPathsResolved',
  'intervalsResolved',
  'wrapGuidesResolved',
  'posePairResolved',
  'cameraFixed',
  'packingBehaviorWitnessed',
  'neighboringSupportsIndependent',
  'containsCorrectRouting',
  'destroysRoutingWithMatchedBudget',
];
const ROUTING_CONDITION_IDS = {
  absent: 'deep_geometry_absent',
  correct: 'deep_geometry_correct_routing',
  wrongRoutingMatched: 'deep_geometry_wrong_routing_matched',
};
const REQUIRED_ROUTING_BUDGET_FIELDS = [
  'primitiveCount',
  'curveCount',
  'controlCount',
  'crossSectionBudget',
  'routeLength',
  'occupiedVolume',
  'surfaceArea',
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validHash(value) {
  return HASH_PATTERN.test(value ?? '');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function finiteVector3(value) {
  return Array.isArray(value) && value.length === 3 && value.every(finite);
}

function vectorLength(value) {
  return finiteVector3(value) ? Math.hypot(...value) : Number.NaN;
}

function independentVector3(left, right) {
  if (!finiteVector3(left) || !finiteVector3(right)) return false;
  const leftLength = vectorLength(left);
  const rightLength = vectorLength(right);
  if (!(leftLength > 0) || !(rightLength > 0)) return false;
  const crossLength = Math.hypot(
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  );
  return crossLength > leftLength * rightLength * 1e-4;
}

function validFrame(frame) {
  return nonEmptyString(frame?.id)
    && nonEmptyString(frame?.ownerId)
    && frame?.handedness === 'right'
    && finiteVector3(frame?.origin)
    && finiteVector3(frame?.axes?.x)
    && finiteVector3(frame?.axes?.y)
    && finiteVector3(frame?.axes?.z)
    && independentVector3(frame.axes.x, frame.axes.y)
    && independentVector3(frame.axes.x, frame.axes.z)
    && independentVector3(frame.axes.y, frame.axes.z);
}

function explicitStringList(value, { allowEmpty = false } = {}) {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(nonEmptyString)
    && new Set(value).size === value.length;
}

function ids(records) {
  return Array.isArray(records) ? records.map(record => record?.id) : [];
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function sameObjectKeys(value, expectedKeys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && sameStringSet(Object.keys(value), expectedKeys);
}

function validBudgetValues(value, fieldIds) {
  return sameObjectKeys(value, fieldIds)
    && fieldIds.every(fieldId => finite(value[fieldId]) && value[fieldId] >= 0);
}

function addIssue(issues, code, message, details = {}) {
  issues.push({ code, message, ...details });
}

function validateIdentity(identity) {
  return nonEmptyString(identity?.id) && validHash(identity?.sha256);
}

function identitySummary(receipt) {
  return {
    receiptId: receipt?.receiptId ?? null,
    trackId: receipt?.track?.id ?? null,
    sourceId: receipt?.source?.id ?? null,
    sourceSha256: receipt?.source?.sha256 ?? null,
    sourcePath: receipt?.source?.path ?? null,
    sourceCompleteness: receipt?.source?.completeness ?? null,
    controlId: receipt?.control?.id ?? null,
    controlSha256: receipt?.control?.sha256 ?? null,
  };
}

function preservedContract(receipt) {
  if (!receipt || typeof receipt !== 'object') return null;
  return {
    units: receipt.units ?? null,
    sourcePath: receipt.source?.path ?? null,
    sourceCompleteness: receipt.source?.completeness ?? null,
    knownSourceOmissions: structuredClone(receipt.source?.knownOmissions ?? null),
    semanticNames: structuredClone(receipt.semanticNames ?? null),
    localFrameIds: ids(receipt.localFrames),
    attachmentIds: ids(receipt.attachments),
    insertionIds: ids(receipt.insertions),
    routedPathIds: ids(receipt.routedPaths),
    pathControlIds: ids(receipt.pathControls),
    intervalIds: ids(receipt.intervals),
    wrapGuideIds: ids(receipt.wrapGuides),
    poseAuthorityId: receipt.poseAuthority?.id ?? null,
    neutralPoseId: receipt.poses?.neutral?.id ?? null,
    conservativePoseId: receipt.poses?.conservative?.id ?? null,
    cameraId: receipt.camera?.id ?? null,
    packingBehaviorId: receipt.packing?.id ?? null,
    routingRelationId: receipt.routingIntervention?.relationId ?? null,
    routeToCastCouplingId: receipt.routingIntervention?.routeToCastCouplingId ?? null,
    routingConditionIds: structuredClone(receipt.routingIntervention?.conditionIds ?? null),
    neighboringSupportIds: ids(receipt.neighboringSupports),
  };
}

export function validateMusculatureSourceM0(receipt) {
  const failures = [];
  const holds = [];
  const fail = (code, message, details = {}) => addIssue(failures, code, message, details);
  const hold = (code, message, details = {}) => addIssue(holds, code, message, details);

  if (receipt === null || receipt === undefined) {
    hold('musculature-source-receipt-missing', 'The exact Track M musculature source receipt has not arrived.');
    return {
      schema: MUSCULATURE_SOURCE_M0_VALIDATION_SCHEMA,
      disposition: HOLD_MUSCULATURE_SOURCE_EVIDENCE,
      ok: false,
      ...identitySummary(receipt),
      receiptSha256: null,
      preserved: null,
      failures,
      holds,
    };
  }

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    fail('musculature-source-receipt-invalid', 'Track M M0 requires one object receipt.');
  }
  if (receipt?.schema !== MUSCULATURE_SOURCE_M0_SCHEMA) {
    fail('musculature-source-schema-mismatch', 'Receipt schema is not the Track M musculature source contract.');
  }
  if (!nonEmptyString(receipt?.receiptId)) {
    fail('musculature-receipt-identity-missing', 'Receipt identity is missing.');
  }
  if (!nonEmptyString(receipt?.track?.id) || receipt?.track?.kind !== 'shape-bearing-musculature') {
    fail('musculature-track-scope-mismatch', 'M0 accepts only an explicitly named shape-bearing-musculature track.');
  }
  if (!validateIdentity(receipt?.source) || !validateIdentity(receipt?.control)) {
    fail('musculature-source-control-identity-invalid', 'Source and control require caller-supplied ids and content hashes.');
  }
  const sourceCompleteness = receipt?.source?.completeness;
  const knownSourceOmissions = receipt?.source?.knownOmissions;
  if (!nonEmptyString(receipt?.source?.path)
    || !['complete', 'incomplete'].includes(sourceCompleteness)
    || !explicitStringList(knownSourceOmissions, { allowEmpty: true })
    || (sourceCompleteness === 'complete' && knownSourceOmissions.length > 0)
    || (sourceCompleteness === 'incomplete' && knownSourceOmissions.length === 0)) {
    fail('musculature-exact-source-receipt-invalid', 'The exact source receipt requires a path, a coherent completeness declaration, and an explicit omission list.');
  } else if (sourceCompleteness === 'incomplete') {
    hold('musculature-exact-source-incomplete', 'The caller identified unresolved omissions in the exact Track M source.', {
      omissions: [...knownSourceOmissions],
    });
  }
  if (!nonEmptyString(receipt?.units)) {
    fail('musculature-units-missing', 'The caller must declare source-local units.');
  }

  const semanticNames = receipt?.semanticNames;
  const malformedNameSets = REQUIRED_NAME_SETS.filter(name => !explicitStringList(
    semanticNames?.[name],
    { allowEmpty: name === 'wrapGuideIds' },
  ));
  if (malformedNameSets.length > 0) {
    fail('musculature-semantic-names-invalid', 'Semantic name sets must be explicit, unique, and caller-owned.', {
      fields: malformedNameSets,
    });
  }
  const allSemanticIds = REQUIRED_NAME_SETS.flatMap(name => semanticNames?.[name] ?? []);
  if (new Set(allSemanticIds).size !== allSemanticIds.length) {
    fail('musculature-semantic-name-collision', 'Semantic identities must not collide across roles.');
  }

  const frames = Array.isArray(receipt?.localFrames) ? receipt.localFrames : [];
  if (frames.length === 0 || frames.some(frame => !validFrame(frame)) || new Set(ids(frames)).size !== frames.length) {
    fail('musculature-local-frames-invalid', 'Local frames must be uniquely named, right-handed, finite, and nondegenerate.');
  }
  const frameIds = new Set(ids(frames));

  const attachments = Array.isArray(receipt?.attachments) ? receipt.attachments : [];
  const insertions = Array.isArray(receipt?.insertions) ? receipt.insertions : [];
  if (!sameStringSet(ids(attachments), semanticNames?.attachmentIds)
    || attachments.some(item => !nonEmptyString(item?.insertionId) || !frameIds.has(item?.frameId))) {
    fail('musculature-attachments-invalid', 'Attachments must cover the named attachment set and resolve insertion and frame identities.');
  }
  if (!sameStringSet(ids(insertions), semanticNames?.insertionIds)
    || insertions.some(item => !frameIds.has(item?.frameId))) {
    fail('musculature-insertions-invalid', 'Insertions must cover the named insertion set and resolve local frames.');
  }
  const insertionIds = new Set(ids(insertions));
  if (attachments.some(item => !insertionIds.has(item?.insertionId))) {
    fail('musculature-attachment-insertion-mismatch', 'Every attachment must resolve one declared insertion identity.');
  }

  const routedPaths = Array.isArray(receipt?.routedPaths) ? receipt.routedPaths : [];
  const pathControls = Array.isArray(receipt?.pathControls) ? receipt.pathControls : [];
  const intervals = Array.isArray(receipt?.intervals) ? receipt.intervals : [];
  const wrapGuides = Array.isArray(receipt?.wrapGuides) ? receipt.wrapGuides : [];
  if (!sameStringSet(ids(routedPaths), semanticNames?.routedPathIds)) {
    fail('musculature-routed-paths-invalid', 'Routed paths must cover the caller-named path identities.');
  }
  if (!sameStringSet(ids(pathControls), semanticNames?.pathControlIds)
    || pathControls.some(control => !semanticNames?.routedPathIds?.includes(control?.pathId)
      || !frameIds.has(control?.frameId)
      || !finiteVector3(control?.position))) {
    fail('musculature-path-controls-invalid', 'Path controls must resolve a routed path, local frame, and finite source-local position.');
  }
  const pathControlById = new Map(pathControls.map(control => [control?.id, control]));
  const intervalNames = [
    ...(semanticNames?.tendonIntervalIds ?? []),
    ...(semanticNames?.bellyIntervalIds ?? []),
  ];
  if (!sameStringSet(ids(intervals), intervalNames)) {
    fail('musculature-interval-identities-invalid', 'Tendon and belly interval records must cover their exact semantic name sets.');
  }
  for (const interval of intervals) {
    const expectedKind = semanticNames?.tendonIntervalIds?.includes(interval?.id)
      ? 'tendon'
      : (semanticNames?.bellyIntervalIds?.includes(interval?.id) ? 'belly' : null);
    const startControl = pathControlById.get(interval?.startControlId);
    const endControl = pathControlById.get(interval?.endControlId);
    if (interval?.kind !== expectedKind
      || !semanticNames?.routedPathIds?.includes(interval?.pathId)
      || startControl?.pathId !== interval?.pathId
      || endControl?.pathId !== interval?.pathId
      || interval?.startControlId === interval?.endControlId
      || !finite(interval?.startT)
      || !finite(interval?.endT)
      || interval.startT < 0
      || interval.endT > 1
      || interval.startT >= interval.endT) {
      fail('musculature-interval-invalid', 'Each tendon or belly interval must resolve ordered controls on one routed path.', {
        intervalId: interval?.id ?? null,
      });
    }
  }
  if (!sameStringSet(ids(wrapGuides), semanticNames?.wrapGuideIds)
    || wrapGuides.some(guide => !semanticNames?.routedPathIds?.includes(guide?.pathId)
      || !frameIds.has(guide?.frameId)
      || !validHash(guide?.geometrySha256))) {
    fail('musculature-wrap-guides-invalid', 'Wrap guides must preserve exact path, frame, and geometry identities.');
  }
  for (const path of routedPaths) {
    const expectedControls = pathControls.filter(control => control?.pathId === path?.id).map(control => control.id);
    const expectedIntervals = intervals.filter(interval => interval?.pathId === path?.id).map(interval => interval.id);
    const expectedGuides = wrapGuides.filter(guide => guide?.pathId === path?.id).map(guide => guide.id);
    if (!explicitStringList(path?.controlIds)
      || !sameStringSet(path.controlIds, expectedControls)
      || !sameStringSet(path?.intervalIds, expectedIntervals)
      || !sameStringSet(path?.wrapGuideIds, expectedGuides)) {
      fail('musculature-routed-path-membership-invalid', 'Each routed path must preserve its exact controls, intervals, and wrap guides.', {
        pathId: path?.id ?? null,
      });
    }
  }

  const authority = receipt?.poseAuthority;
  const neutralPose = receipt?.poses?.neutral;
  const conservativePose = receipt?.poses?.conservative;
  const pairing = receipt?.poses?.pairing;
  if (!nonEmptyString(authority?.id)
    || authority?.kind !== 'external'
    || !validHash(authority?.sha256)
    || !validateIdentity(neutralPose)
    || !validateIdentity(conservativePose)
    || neutralPose.id === conservativePose.id
    || neutralPose?.authorityId !== authority?.id
    || conservativePose?.authorityId !== authority?.id
    || pairing?.neutralPoseId !== neutralPose?.id
    || pairing?.conservativePoseId !== conservativePose?.id) {
    fail('musculature-pose-pair-invalid', 'Neutral and conservative poses must be distinct and paired under one external authority.');
  }

  if (!validateIdentity(receipt?.camera)
    || receipt?.camera?.fixed !== true
    || !frameIds.has(receipt?.camera?.frameId)) {
    fail('musculature-camera-invalid', 'The receipt must preserve one fixed, content-addressed camera in a declared local frame.');
  }
  if (!validateIdentity(receipt?.packing) || !nonEmptyString(receipt?.packing?.behavior)) {
    fail('musculature-packing-behavior-invalid', 'Packing or volume behavior must be explicitly declared and content-addressed.');
  }

  const routing = receipt?.routingIntervention;
  const testedPathIds = routing?.testedPathIds;
  const conditionsMatch = Object.entries(ROUTING_CONDITION_IDS)
    .every(([name, expected]) => routing?.conditionIds?.[name] === expected)
    && sameStringSet(Object.keys(routing?.conditionIds ?? {}), Object.keys(ROUTING_CONDITION_IDS));
  if (!nonEmptyString(routing?.relationId)
    || !nonEmptyString(routing?.routeToCastCouplingId)
    || routing?.sourceControlSha256 !== receipt?.control?.sha256
    || !conditionsMatch
    || !explicitStringList(testedPathIds)
    || testedPathIds.some(pathId => !semanticNames?.routedPathIds?.includes(pathId))) {
    fail('musculature-routing-intervention-invalid', 'The tested route relation must bind the source control, route-to-cast coupling, exact three conditions, and declared routed paths.');
  }
  if (!nonEmptyString(routing?.correct?.transformId)
    || !validHash(routing?.correct?.transformSha256)
    || !validHash(routing?.correct?.relationWitnessSha256)
    || routing?.correct?.containsCorrectRouting !== true) {
    fail('musculature-correct-routing-unproved', 'The correct condition must identify its transform and prove that the tested routing relation remains present.');
  }
  if (!nonEmptyString(routing?.wrongRoutingMatched?.transformId)
    || !validHash(routing?.wrongRoutingMatched?.transformSha256)
    || !validHash(routing?.wrongRoutingMatched?.relationWitnessSha256)
    || !validHash(routing?.wrongRoutingMatched?.budgetWitnessSha256)
    || routing?.wrongRoutingMatched?.destroysRoutingRelation !== true
    || routing?.wrongRoutingMatched?.selectedBeforeOutputInspection !== true) {
    fail('musculature-wrong-routing-unproved', 'The matched wrong-route condition must identify a preregistered transform that destroys the tested routing relation.');
  }
  if (!nonEmptyString(routing?.absent?.transformId)
    || !validHash(routing?.absent?.transformSha256)
    || !['literal_absent', 'noncontributing_sham'].includes(routing?.absent?.kind)) {
    fail('musculature-absent-condition-invalid', 'The absent condition must identify its transform and declare literal absence or a noncontributing sham.');
  }
  const transformIds = [
    routing?.absent?.transformId,
    routing?.correct?.transformId,
    routing?.wrongRoutingMatched?.transformId,
  ];
  const transformHashes = [
    routing?.absent?.transformSha256,
    routing?.correct?.transformSha256,
    routing?.wrongRoutingMatched?.transformSha256,
  ];
  if (new Set(transformIds).size !== transformIds.length
    || new Set(transformHashes).size !== transformHashes.length) {
    fail('musculature-routing-transform-collision', 'Absent, correct, and matched wrong-route conditions must identify distinct transforms.');
  }

  const budget = routing?.matchedBudget;
  const budgetFieldIds = budget?.fieldIds;
  const validBudgetFieldIds = explicitStringList(budgetFieldIds)
    && REQUIRED_ROUTING_BUDGET_FIELDS.every(fieldId => budgetFieldIds.includes(fieldId));
  if (!validBudgetFieldIds
    || !validHash(budget?.ledgerSha256)
    || !validBudgetValues(budget?.correct, budgetFieldIds ?? [])
    || !validBudgetValues(budget?.wrongRoutingMatched, budgetFieldIds ?? [])
    || !validBudgetValues(budget?.tolerances, budgetFieldIds ?? [])
    || !['primitiveCount', 'curveCount', 'controlCount'].every(fieldId => Number.isInteger(budget?.correct?.[fieldId])
      && Number.isInteger(budget?.wrongRoutingMatched?.[fieldId])
      && budget?.tolerances?.[fieldId] === 0)) {
    fail('musculature-routing-budget-invalid', 'The caller must declare comparable nonnegative correct/wrong budget values and tolerances for every required field.');
  } else {
    const unmatchedFields = budgetFieldIds.filter(fieldId => (
      Math.abs(budget.correct[fieldId] - budget.wrongRoutingMatched[fieldId]) > budget.tolerances[fieldId]
    ));
    if (unmatchedFields.length > 0) {
      fail('musculature-routing-budget-unmatched', 'The wrong-routing control exceeds the caller-declared representational budget tolerance.', {
        fields: unmatchedFields,
      });
    }
  }
  const routingWitnessHashes = [
    routing?.correct?.relationWitnessSha256,
    routing?.wrongRoutingMatched?.relationWitnessSha256,
    routing?.wrongRoutingMatched?.budgetWitnessSha256,
    budget?.ledgerSha256,
  ];
  if (routingWitnessHashes.every(validHash)
    && new Set(routingWitnessHashes).size !== routingWitnessHashes.length) {
    fail('musculature-routing-witness-collision', 'Correct routing, destroyed routing, matched-budget witness, and budget ledger roles must identify distinct artifacts.');
  }

  const neighboringSupports = Array.isArray(receipt?.neighboringSupports) ? receipt.neighboringSupports : [];
  if (!sameStringSet(ids(neighboringSupports), semanticNames?.supportIds)) {
    fail('musculature-neighboring-supports-invalid', 'Neighboring-support records must cover the exact named support set.');
  }
  const invalidNeighboringSupports = neighboringSupports
    .filter(support => !validHash(support?.neutralLocalShapeSha256)
      || !validHash(support?.conservativeLocalShapeSha256)
      || support?.neutralLocalShapeSha256 !== support?.conservativeLocalShapeSha256
      || support?.independent !== true)
    .map(support => support?.id ?? null);
  if (invalidNeighboringSupports.length > 0) {
    fail('musculature-neighboring-support-independence-failed', 'Completed source semantics alter or conflate a neighboring support.', {
      supportIds: invalidNeighboringSupports,
    });
  }

  const evidence = receipt?.evidence;
  if (evidence?.status === 'pending' || evidence === undefined || evidence === null) {
    hold('musculature-source-evidence-pending', 'The structural receipt is parameterized, but exact Track M source evidence remains pending.');
  } else if (evidence?.status !== 'complete') {
    fail('musculature-evidence-status-invalid', 'Evidence status must be pending or complete.');
  } else {
    if (evidence?.sourceSha256 !== receipt?.source?.sha256
      || evidence?.controlSha256 !== receipt?.control?.sha256) {
      fail('musculature-evidence-identity-mismatch', 'Completed evidence is not bound to the exact source and control identities.');
    }
    const failedChecks = REQUIRED_EVIDENCE_CHECKS.filter(name => evidence?.checks?.[name] !== true);
    if (failedChecks.length > 0) {
      fail('musculature-evidence-check-failed', 'Completed evidence omits or fails a required Track M source check.', {
        checks: failedChecks,
      });
    }
  }

  const disposition = failures.length > 0
    ? FAIL_MUSCULATURE_SOURCE
    : (holds.length > 0 ? HOLD_MUSCULATURE_SOURCE_EVIDENCE : PASS_MUSCULATURE_SOURCE_ONLY);
  return {
    schema: MUSCULATURE_SOURCE_M0_VALIDATION_SCHEMA,
    disposition,
    ok: disposition === PASS_MUSCULATURE_SOURCE_ONLY,
    ...identitySummary(receipt),
    receiptSha256: sha256(receipt),
    preserved: preservedContract(receipt),
    failures,
    holds,
  };
}
