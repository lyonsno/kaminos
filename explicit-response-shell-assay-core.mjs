import { createHash } from 'node:crypto';

export const EXPLICIT_RESPONSE_SHELL_ASSAY_SCHEMA =
  'kaminos.explicit-response-shell-result.v0';
export const EXPLICIT_RESPONSE_SHELL_COMPILER_ID =
  'fixed-topology-elliptical-station-response-shell-v0';
export const EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_ID =
  'bounded-hindquarter-explicit-response-shell-v0';
export const EXPLICIT_RESPONSE_SHELL_RADIAL_SEGMENTS = 48;
const AUTHORITATIVE_EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_HASH =
  'ec645d760e3bb1e86db0a33cce24278de2ae4006114f11add968cacba4f8ec0e';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function validateInputs(assayCard, target, evaluationTarget, evaluationMode) {
  if (assayCard?.schema !== 'kaminos.explicit-response-shell-assay.v0') {
    throw new Error('unsupported explicit response-shell assay card schema');
  }
  if (assayCard.id !== EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_ID) {
    throw new Error('explicit response-shell assay card identity changed');
  }
  if (hashValue(assayCard) !== AUTHORITATIVE_EXPLICIT_RESPONSE_SHELL_ASSAY_CARD_HASH) {
    throw new Error('explicit response-shell assay card identity does not match authoritative route');
  }
  if (assayCard.construction?.radialSegments !== EXPLICIT_RESPONSE_SHELL_RADIAL_SEGMENTS) {
    throw new Error(
      `authoritative explicit response-shell radialSegments must remain ${EXPLICIT_RESPONSE_SHELL_RADIAL_SEGMENTS}`,
    );
  }
  if (target?.id !== assayCard.targetIdentity?.id) {
    throw new Error('construction target id does not match assay card');
  }
  if (hashValue(target) !== assayCard.targetIdentity.sha256) {
    throw new Error('construction target hash does not match authoritative assay card');
  }
  if (!['authoritative', 'counterfactual'].includes(evaluationMode)) {
    throw new Error('evaluationMode must be authoritative or counterfactual');
  }
  const evaluationTargetHash = hashValue(evaluationTarget);
  if (evaluationMode === 'authoritative'
    && evaluationTargetHash !== assayCard.targetIdentity.sha256) {
    throw new Error('evaluation target hash does not match authoritative assay card');
  }
  const expectedFields = ['muscleTension', 'fatDistribution'];
  if (canonicalJson(assayCard.construction.independentResponseFields)
    !== canonicalJson(expectedFields)) {
    throw new Error('explicit response-shell construction source fields changed');
  }
  if (assayCard.construction.heldOutEvaluationField !== 'combined') {
    throw new Error('combined must remain the held-out evaluation field');
  }
  if (assayCard.construction.surfaceFormationId !== EXPLICIT_RESPONSE_SHELL_COMPILER_ID) {
    throw new Error('explicit response-shell compiler identity changed');
  }
  return { evaluationTargetHash };
}

function constructionProjection(target, assayCard) {
  const fields = [
    assayCard.construction.baselineField,
    ...assayCard.construction.independentResponseFields,
  ];
  return {
    targetId: target.id,
    normalizationSpan: target.normalizationSpan,
    frame: structuredClone(target.frame),
    stations: target.stations.map((station) => ({
      anterior: station.anterior,
      ...Object.fromEntries(fields.map((field) => [field, structuredClone(station[field])])),
    })),
  };
}

function parameters(state) {
  return {
    centerY: (state.top + state.bottom) * 0.5,
    radiusY: (state.top - state.bottom) * 0.5,
    radiusX: state.halfWidth,
  };
}

function subtractParameters(after, before) {
  return Object.fromEntries(Object.keys(before).map(
    (field) => [field, after[field] - before[field]],
  ));
}

function stationRings(projection) {
  const first = projection.stations[0];
  const last = projection.stations.at(-1);
  const firstSpacing = projection.stations[1].anterior - first.anterior;
  const lastSpacing = last.anterior - projection.stations.at(-2).anterior;
  return [
    { ...first, ringId: 'closure-low', anterior: first.anterior - firstSpacing * 0.5 },
    ...projection.stations.map((station, index) => ({
      ...station,
      ringId: `station-${String(index).padStart(2, '0')}`,
    })),
    { ...last, ringId: 'closure-high', anterior: last.anterior + lastSpacing * 0.5 },
  ];
}

function vertexPosition(ring, segment, radialSegments, stateField) {
  const section = parameters(ring[stateField]);
  const angle = segment / radialSegments * Math.PI * 2;
  return [
    section.radiusX * Math.cos(angle),
    section.centerY + section.radiusY * Math.sin(angle),
    ring.anterior,
  ];
}

function buildBindings(projection, assayCard) {
  const radialSegments = assayCard.construction.radialSegments;
  const rings = stationRings(projection);
  const bindings = [];
  for (const ring of rings) {
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const baseline = vertexPosition(ring, segment, radialSegments, 'baseline');
      const muscle = vertexPosition(ring, segment, radialSegments, 'muscleTension');
      const fat = vertexPosition(ring, segment, radialSegments, 'fatDistribution');
      bindings.push({
        vertexId: `${ring.ringId}:radial-${String(segment).padStart(2, '0')}`,
        baseline,
        muscleDelta: muscle.map((value, axis) => value - baseline[axis]),
        fatDelta: fat.map((value, axis) => value - baseline[axis]),
        sources: {
          muscle: {
            sourceField: 'muscleTension',
            targetTissueId: assayCard.controls['muscle-tension'].targetTissueId,
          },
          fat: {
            sourceField: 'fatDistribution',
            targetTissueId: assayCard.controls['fat-distribution'].targetTissueId,
          },
        },
      });
    }
  }
  for (const [side, ring] of [['low', rings[0]], ['high', rings.at(-1)]]) {
    const baselineParameters = parameters(ring.baseline);
    const muscleDelta = subtractParameters(parameters(ring.muscleTension), baselineParameters);
    const fatDelta = subtractParameters(parameters(ring.fatDistribution), baselineParameters);
    bindings.push({
      vertexId: `cap-${side}`,
      baseline: [0, baselineParameters.centerY, ring.anterior],
      muscleDelta: [0, muscleDelta.centerY, 0],
      fatDelta: [0, fatDelta.centerY, 0],
      sources: {
        muscle: {
          sourceField: 'muscleTension',
          targetTissueId: assayCard.controls['muscle-tension'].targetTissueId,
        },
        fat: {
          sourceField: 'fatDistribution',
          targetTissueId: assayCard.controls['fat-distribution'].targetTissueId,
        },
      },
    });
  }
  return { rings, bindings };
}

function buildFaces(ringCount, radialSegments) {
  const faces = [];
  for (let ring = 0; ring < ringCount - 1; ring += 1) {
    const base = ring * radialSegments;
    const next = base + radialSegments;
    for (let segment = 0; segment < radialSegments; segment += 1) {
      const after = (segment + 1) % radialSegments;
      faces.push([base + segment, next + segment, next + after]);
      faces.push([base + segment, next + after, base + after]);
    }
  }
  const lowCenter = ringCount * radialSegments;
  const highCenter = lowCenter + 1;
  const highRing = (ringCount - 1) * radialSegments;
  for (let segment = 0; segment < radialSegments; segment += 1) {
    const after = (segment + 1) % radialSegments;
    faces.push([lowCenter, after, segment]);
    faces.push([highCenter, highRing + segment, highRing + after]);
  }
  return faces;
}

function compileMesh(bindings, faces, muscleScale, fatScale) {
  const vertices = bindings.map((binding) => binding.baseline.map(
    (value, axis) => value
      + binding.muscleDelta[axis] * muscleScale
      + binding.fatDelta[axis] * fatScale,
  ));
  return { vertices, faces };
}

function topologyClosed(mesh) {
  const edges = new Map();
  for (const face of mesh.faces) {
    for (let index = 0; index < 3; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return edges.size > 0 && [...edges.values()].every((count) => count === 2);
}

function componentCount(mesh) {
  const adjacency = new Map();
  for (const face of mesh.faces) {
    for (let index = 0; index < 3; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % 3];
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    }
  }
  let count = 0;
  const visited = new Set();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    count += 1;
    const pending = [start];
    while (pending.length > 0) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      for (const neighbor of adjacency.get(vertex)) pending.push(neighbor);
    }
  }
  return count;
}

function topologyEvidence(mesh) {
  return {
    closed: topologyClosed(mesh),
    componentCount: componentCount(mesh),
    vertexCount: mesh.vertices.length,
    faceCount: mesh.faces.length,
  };
}

function scaleTarget(target, stateField, amplitude, referenceAmplitude) {
  const scale = stateField === 'baseline' ? 0 : amplitude / referenceAmplitude;
  return {
    normalizationSpan: target.normalizationSpan,
    stations: target.stations.map((station) => ({
      anterior: station.anterior,
      state: stateField === 'baseline'
        ? structuredClone(station.baseline)
        : Object.fromEntries(['top', 'bottom', 'halfWidth'].map((field) => [
          field,
          station.baseline[field] + (station[stateField][field] - station.baseline[field]) * scale,
        ])),
    })),
  };
}

function compileTargetReference({
  target,
  stateField,
  stateId,
  amplitude,
  referenceAmplitude,
  assayCard,
}) {
  const scaled = scaleTarget(target, stateField, amplitude, referenceAmplitude);
  const projection = {
    stations: scaled.stations.map((station) => ({
      anterior: station.anterior,
      baseline: structuredClone(station.state),
      muscleTension: structuredClone(station.state),
      fatDistribution: structuredClone(station.state),
    })),
  };
  const { rings, bindings } = buildBindings(projection, assayCard);
  const faces = buildFaces(rings.length, assayCard.construction.radialSegments);
  return compiledState({
    key: stateId,
    mesh: compileMesh(bindings, faces, 0, 0),
    vertexIds: bindings.map((binding) => binding.vertexId),
  });
}

function targetField(target, stateField, amplitude, referenceAmplitude) {
  const scaled = scaleTarget(target, stateField, amplitude, referenceAmplitude);
  const sections = scaled.stations.map((station) => ({
    anterior: station.anterior,
    ...parameters(station.state),
  }));
  const first = sections[0];
  const last = sections.at(-1);
  const closureLow = first.anterior - (sections[1].anterior - first.anterior) * 0.5;
  const closureHigh = last.anterior - (sections.at(-2).anterior - last.anterior) * 0.5;
  const at = (anterior) => {
    if (anterior <= first.anterior) return first;
    if (anterior >= last.anterior) return last;
    const upperIndex = sections.findIndex((section) => section.anterior >= anterior);
    const lower = sections[upperIndex - 1];
    const upper = sections[upperIndex];
    const t = (anterior - lower.anterior) / (upper.anterior - lower.anterior);
    return {
      centerY: lower.centerY + (upper.centerY - lower.centerY) * t,
      radiusY: lower.radiusY + (upper.radiusY - lower.radiusY) * t,
      radiusX: lower.radiusX + (upper.radiusX - lower.radiusX) * t,
    };
  };
  return {
    normalizationSpan: scaled.normalizationSpan,
    evaluate([right, dorsal, anterior]) {
      const section = at(anterior);
      const normalizedRadius = Math.hypot(
        right / section.radiusX,
        (dorsal - section.centerY) / section.radiusY,
      );
      const radialDistance = (1 - normalizedRadius) * Math.min(
        section.radiusX,
        section.radiusY,
      );
      return Math.min(radialDistance, anterior - closureLow, closureHigh - anterior);
    },
  };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function fullSurfaceNormalizedRmse(mesh, field) {
  let weightedSquaredError = 0;
  let totalArea = 0;
  for (const face of mesh.faces) {
    const [a, b, c] = face.map((index) => mesh.vertices[index]);
    const ab = b.map((value, axis) => value - a[axis]);
    const ac = c.map((value, axis) => value - a[axis]);
    const area = Math.hypot(...cross(ab, ac)) * 0.5;
    if (area <= 1e-14) continue;
    const centroid = [0, 1, 2].map((axis) => (a[axis] + b[axis] + c[axis]) / 3);
    const error = Math.abs(field.evaluate(centroid)) / field.normalizationSpan;
    weightedSquaredError += area * error * error;
    totalArea += area;
  }
  return Math.sqrt(weightedSquaredError / Math.max(totalArea, 1e-12));
}

function compiledState({ key, mesh, vertexIds }) {
  return {
    stateId: key,
    vertexIds,
    mesh,
    topology: topologyEvidence(mesh),
  };
}

function evaluateState(state, target, stateField, amplitude, referenceAmplitude) {
  return {
    amplitude,
    fullSurfaceNormalizedRmse: fullSurfaceNormalizedRmse(
      state.mesh,
      targetField(target, stateField, amplitude, referenceAmplitude),
    ),
    topology: state.topology,
  };
}

export function buildExplicitResponseShellAssay({
  assayCard,
  target,
  evaluationTarget = target,
  evaluationMode = 'authoritative',
} = {}) {
  const { evaluationTargetHash } = validateInputs(
    assayCard,
    target,
    evaluationTarget,
    evaluationMode,
  );
  const projection = constructionProjection(target, assayCard);
  const projectionHash = hashValue(projection);
  const { rings, bindings } = buildBindings(projection, assayCard);
  const faces = buildFaces(rings.length, assayCard.construction.radialSegments);
  const vertexIds = bindings.map((binding) => binding.vertexId);
  const referenceAmplitude = assayCard.construction.referenceAmplitude;
  const compiledStates = {};
  compiledStates.baseline = compiledState({
    key: 'baseline',
    mesh: compileMesh(bindings, faces, 0, 0),
    vertexIds,
  });
  for (const amplitude of assayCard.amplitudes) {
    const scale = amplitude / referenceAmplitude;
    for (const [stateId, muscleScale, fatScale] of [
      [`muscle-tension:${amplitude}`, scale, 0],
      [`fat-distribution:${amplitude}`, 0, scale],
      [`combined:${amplitude}`, scale, scale],
    ]) {
      compiledStates[stateId] = compiledState({
        key: stateId,
        mesh: compileMesh(bindings, faces, muscleScale, fatScale),
        vertexIds,
      });
    }
  }

  const independent = Object.fromEntries(Object.entries(assayCard.controls).map(
    ([controlId, control]) => {
      const amplitudes = assayCard.amplitudes.map((amplitude) => evaluateState(
        compiledStates[`${controlId}:${amplitude}`],
        evaluationTarget,
        control.sourceField,
        amplitude,
        referenceAmplitude,
      ));
      return [controlId, {
        amplitudes,
        passed: amplitudes.every((entry) => (
          entry.fullSurfaceNormalizedRmse
            <= assayCard.evaluation.maximumIndependentFullSurfaceNormalizedRmse
          && entry.topology.closed
          && entry.topology.componentCount === 1
        )),
      }];
    },
  ));
  const combinedAmplitudes = assayCard.amplitudes.map((amplitude) => evaluateState(
    compiledStates[`combined:${amplitude}`],
    evaluationTarget,
    assayCard.construction.heldOutEvaluationField,
    amplitude,
    referenceAmplitude,
  ));
  const combinedStress = combinedAmplitudes.at(-1);
  const combined = {
    amplitudes: combinedAmplitudes,
    fullSurfaceNormalizedRmse: combinedStress.fullSurfaceNormalizedRmse,
    passed: combinedAmplitudes.every((entry) => (
      entry.fullSurfaceNormalizedRmse
        <= assayCard.evaluation.maximumCombinedFullSurfaceNormalizedRmse
      && entry.topology.closed
      && entry.topology.componentCount === 1
    )),
  };
  const referenceStates = {
    baseline: compileTargetReference({
      target: evaluationTarget,
      stateField: 'baseline',
      stateId: 'baseline',
      amplitude: 0,
      referenceAmplitude,
      assayCard,
    }),
  };
  for (const amplitude of assayCard.amplitudes) {
    for (const [stateId, stateField] of [
      [`muscle-tension:${amplitude}`, 'muscleTension'],
      [`fat-distribution:${amplitude}`, 'fatDistribution'],
      [`combined:${amplitude}`, 'combined'],
    ]) {
      referenceStates[stateId] = compileTargetReference({
        target: evaluationTarget,
        stateField,
        stateId,
        amplitude,
        referenceAmplitude,
        assayCard,
      });
    }
  }

  const baseline = compiledStates.baseline;
  const nullFailures = [];
  for (const [controlId, control] of Object.entries(assayCard.controls)) {
    const stress = evaluateState(
      baseline,
      evaluationTarget,
      control.sourceField,
      assayCard.amplitudes.at(-1),
      referenceAmplitude,
    );
    if (stress.fullSurfaceNormalizedRmse
      > assayCard.evaluation.maximumIndependentFullSurfaceNormalizedRmse) {
      nullFailures.push({ code: 'independent-response-missing', controlId });
    }
  }
  const verdictPassed = Object.values(independent).every((entry) => entry.passed)
    && combined.passed;
  const result = {
    schema: EXPLICIT_RESPONSE_SHELL_ASSAY_SCHEMA,
    status: 'completed',
    claimCeiling: assayCard.claimCeiling,
    promotion: assayCard.promotion,
    assayCardId: assayCard.id,
    assayCardHash: hashValue(assayCard),
    priorCarrierAssayProvenanceHash: assayCard.priorCarrierAssayProvenanceHash,
    construction: {
      sourceFields: [
        assayCard.construction.baselineField,
        ...assayCard.construction.independentResponseFields,
      ],
      heldOutFieldsRead: [],
      combinedTargetReadCount: 0,
      projectionHash,
      projection,
      effectiveCompilerId: EXPLICIT_RESPONSE_SHELL_COMPILER_ID,
      radialSegments: assayCard.construction.radialSegments,
    },
    evaluation: {
      mode: evaluationMode,
      heldOutFields: [assayCard.construction.heldOutEvaluationField],
      requestedTargetHash: assayCard.targetIdentity.sha256,
      targetHash: evaluationTargetHash,
      targetIdentityMatched: evaluationTargetHash === assayCard.targetIdentity.sha256,
      referenceStates,
    },
    candidate: {
      id: 'source-row-attributable-explicit-response-shell',
      carrierCoupling: {
        status: 'not-exercised',
        provenanceOnlyCarrierId: assayCard.construction.priorInteriorCarrierProvenanceId,
      },
      surfaceFormationId: assayCard.construction.surfaceFormationId,
      vertexBindings: bindings,
      topology: baseline.topology,
      compiledStates,
    },
    causalNull: {
      id: 'source-row-response-null',
      topology: baseline.topology,
      mesh: baseline.mesh,
      verdict: {
        scope: 'missing-response-only',
        passed: nullFailures.length === 0,
        failures: nullFailures,
      },
    },
    verdict: {
      passed: verdictPassed,
      independent,
      combined,
      inference: verdictPassed
        ? 'source-row-attributable-explicit-shell-supported-on-additive-fixture'
        : 'explicit-response-shell-not-supported-on-additive-fixture',
    },
  };
  return { ...result, assayHash: hashValue(result) };
}
