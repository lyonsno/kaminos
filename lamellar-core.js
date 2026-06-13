const WITNESS_IDENTITY = "kaminos-lamellar-witness-v0";
const EFFECTIVE_ROUTE = "sphere-domain-section-segment-witness-v0";
const WIDTH_RADIUS_COUPLING_MODE = "stable-strip-width-cut-radius-only-changes-window-caps-gap";
const END_CAP_SEALING_MODE = "zero-lift-closed-terminal-cap-slab";
const PLACEHOLDER_CONTRACT = "temporary-aesthetic-composition-primitive-not-final-lamellar-topology";
const COMPOSER_MODE = "data-first-poloxodromic-lamellar-section-composer-v0";
const LAYER_STACK_MODE = "authored-lamellar-layer-stack-descriptor-v0";
const SLICE_TOOL_MODE = "sphere-domain-lamellar-section-slicer-v0";

const VIEW_PRESETS = {
  cut_radius_coupling: { yaw: 0.72, pitch: 0.35, distance: 3.2 },
  cap_profile: { yaw: 1.42, pitch: 0.44, distance: 2.7 },
  malformed_contact_stress: { yaw: 0.86, pitch: 0.28, distance: 3.5 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function chiralitySign(pattern, layerIndex, rand) {
  if (typeof pattern === "string" && /^[+-]+$/.test(pattern)) {
    return pattern[layerIndex % pattern.length] === "-" ? -1 : 1;
  }
  if (pattern === "alternating") return layerIndex % 2 === 0 ? 1 : -1;
  if (pattern === "counterpatch") return layerIndex === 1 ? -1 : 1;
  if (pattern === "mixed") return rand() > 0.52 ? 1 : -1;
  return 1;
}

function descriptorCurveOptions(descriptor) {
  return {
    theta0: descriptor.theta0,
    thetaTwist: descriptor.thetaTwist,
    phi0: descriptor.phi0,
    phiSlope: descriptor.phiSlope,
    phase: descriptor.phase,
    radius: descriptor.radius,
    width: descriptor.width,
    edgeLift: descriptor.edgeLift,
    waviness: descriptor.waviness,
  };
}

function clampPattern(pattern) {
  if (["same", "alternating", "counterpatch", "mixed"].includes(pattern)) return pattern;
  if (typeof pattern === "string" && /^[+-]+$/.test(pattern)) return pattern;
  return "same";
}

export function generateLamellarLayerSpecs(input = {}) {
  const seed = Math.round(clamp(Number(input.seed ?? 17), 0, 99999));
  const numLayers = Math.round(clamp(Number(input.layerCount ?? input.numLayers ?? 2), 1, 4));
  const depthSpacing = clamp(Number(input.depthSpacing ?? 0.035), 0.015, 0.09);
  const overlapBias = clamp(Number(input.overlapBias ?? 0.38), 0, 1);
  const chunkinessBase = clamp(Number(input.chunkinessBase ?? 0.48), 0.05, 1);
  const chunkinessVariance = clamp(Number(input.chunkinessVariance ?? 0.22), 0, 0.65);
  const chiralityPattern = clampPattern(input.chiralityPattern ?? input.chirality ?? "same");
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const layerSpecs = [];

  for (let layerIndex = 0; layerIndex < numLayers; layerIndex++) {
    const chirality = chiralitySign(chiralityPattern, layerIndex, rand);
    const role = layerIndex === 0 ? "selected-source" : layerIndex === 1 ? "neighbor-envelope" : "nested-placeholder-shell";
    const depth = layerIndex === 0 ? 0 : Number((depthSpacing * (layerIndex === 1 ? -0.35 : layerIndex)).toFixed(4));
    const layerWeight = layerIndex === 0 ? 0.15 : layerIndex === 1 ? 0.05 : -0.04 * layerIndex;
    const variance = (rand() * 2 - 1) * chunkinessVariance;
    const chunkiness = Number(clamp(chunkinessBase + layerWeight + variance, 0.05, 1).toFixed(3));
    layerSpecs.push({
      kind: "LamellarLayerSpec",
      id: `seed-${seed}-layer-${layerIndex}-spec`,
      layerIndex,
      enabled: true,
      materialRole: role,
      chirality,
      chiralityPattern,
      depth,
      chunkiness,
      width: Number((0.018 + chunkiness * (role === "selected-source" ? 0.095 : role === "neighbor-envelope" ? 0.08 : 0.045)).toFixed(4)),
      thickness: Number((0.006 + chunkiness * 0.022).toFixed(4)),
      segmentCount: role === "nested-placeholder-shell" && chunkiness > 0.68 ? 2 : 1,
      intervalBias: Number(((rand() - 0.5) * (0.12 + overlapBias * 0.1)).toFixed(4)),
      phase: Number((layerIndex * 0.57 + rand() * 0.9).toFixed(4)),
      overlapBias: Number(overlapBias.toFixed(4)),
      sliceParticipation: role === "selected-source" ? "primary-cut-target" : role === "neighbor-envelope" ? "cut-author-envelope" : "background-layer",
    });
  }

  return {
    layerStackDescriptor: {
      kind: "LayerStackDescriptor",
      mode: LAYER_STACK_MODE,
      proceduralSeed: seed,
      numLayers,
      chiralityPattern,
      chunkinessBase: Number(chunkinessBase.toFixed(4)),
      chunkinessVariance: Number(chunkinessVariance.toFixed(4)),
      depthSpacing: Number(depthSpacing.toFixed(4)),
      overlapBias: Number(overlapBias.toFixed(4)),
      layerSpecIds: layerSpecs.map(spec => spec.id),
      authoringModel: "per-layer-specs-before-section-generation",
    },
    layerSpecs,
  };
}

export function generateLamellarSectionSegments(input = {}) {
  const seed = Math.round(clamp(Number(input.seed ?? 17), 0, 99999));
  const layerStack = generateLamellarLayerSpecs(input);
  const { layerStackDescriptor, layerSpecs } = layerStack;
  const rand = mulberry32(seed);
  const descriptors = [];
  const composerDescriptor = {
    mode: COMPOSER_MODE,
    segmentKind: "LamellarSectionSegment",
    layerStackKind: "LayerStackDescriptor",
    proceduralSeed: seed,
    chiralityPattern: layerStackDescriptor.chiralityPattern,
    layerCount: layerStackDescriptor.numLayers,
    numLayers: layerStackDescriptor.numLayers,
    chunkinessBase: layerStackDescriptor.chunkinessBase,
    chunkinessVariance: layerStackDescriptor.chunkinessVariance,
    depthSpacing: layerStackDescriptor.depthSpacing,
    overlapBias: layerStackDescriptor.overlapBias,
    curveLaw: "poloxodromic-sphere-strip-v0",
    capLaw: END_CAP_SEALING_MODE,
    meshEmission: "descriptor-solved-before-ribbon-geometry",
  };

  const selectedSpec = layerSpecs[0];
  const selectedPhase = 0.24 + rand() * 0.72;
  descriptors.push({
    kind: "LamellarSectionSegment",
    id: `seed-${seed}-layer-0-selected-source`,
    layerSpecId: selectedSpec.id,
    source: "procedural-composer",
    materialRole: selectedSpec.materialRole,
    layerIndex: selectedSpec.layerIndex,
    depth: selectedSpec.depth,
    chirality: selectedSpec.chirality,
    chunkiness: selectedSpec.chunkiness,
    segmentCount: selectedSpec.segmentCount,
    interval: [0.12, 0.9],
    curveLaw: composerDescriptor.curveLaw,
    capLaw: composerDescriptor.capLaw,
    theta0: -1.18 + (rand() - 0.5) * 0.16,
    thetaTwist: 4.42 + rand() * 0.42,
    phi0: -0.38 + (rand() - 0.5) * 0.08,
    phiSlope: 0.94 + rand() * 0.18,
    phase: selectedPhase,
    radius: 1 + selectedSpec.depth,
    width: selectedSpec.width,
    thickness: selectedSpec.thickness,
    edgeLift: Number((0.012 + selectedSpec.chunkiness * 0.014).toFixed(4)),
    waviness: 0.045 + selectedSpec.chunkiness * 0.08,
  });

  for (const spec of layerSpecs.slice(1)) {
    const isNeighbor = spec.materialRole === "neighbor-envelope";
    const segmentCount = spec.segmentCount;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
      const baseStart = isNeighbor ? 0.24 + (0.42 - spec.overlapBias) * 0.18 : 0.08 + rand() * 0.12;
      const baseEnd = isNeighbor ? 0.72 + spec.overlapBias * 0.18 : 0.82 + rand() * 0.12;
      const stagger = segmentCount > 1 ? segmentIndex * 0.08 : 0;
      descriptors.push({
        kind: "LamellarSectionSegment",
        id: `seed-${seed}-layer-${spec.layerIndex}-${spec.materialRole}-${segmentIndex}`,
        layerSpecId: spec.id,
        source: "layer-stack-composer",
        materialRole: spec.materialRole,
        layerIndex: spec.layerIndex,
        depth: spec.depth,
        chirality: spec.chirality,
        chunkiness: spec.chunkiness,
        segmentCount: spec.segmentCount,
        interval: [
          Number(clamp(baseStart + spec.intervalBias + stagger, 0.08, 0.44).toFixed(4)),
          Number(clamp(baseEnd + spec.intervalBias + stagger, 0.62, 0.94).toFixed(4)),
        ],
        curveLaw: composerDescriptor.curveLaw,
        capLaw: composerDescriptor.capLaw,
        theta0: -0.98 + spec.layerIndex * 0.28 + (rand() - 0.5) * 0.22,
        thetaTwist: spec.chirality * (3.9 + spec.chunkiness * 1.1 + rand() * 0.35),
        phi0: -0.3 + spec.layerIndex * 0.035 + (rand() - 0.5) * 0.16,
        phiSlope: 0.68 + spec.chunkiness * 0.38 + rand() * 0.2,
        phase: spec.phase + segmentIndex * 0.44,
        radius: Number((1 + spec.depth).toFixed(4)),
        width: spec.width,
        thickness: spec.thickness,
        edgeLift: Number((0.009 + spec.chunkiness * 0.016).toFixed(4)),
        waviness: 0.045 + spec.chunkiness * 0.095,
      });
    }
  }

  return { composerDescriptor, layerStackDescriptor, layerSpecs, descriptors };
}

export function sliceLamellarSectionSegments(descriptors, input = {}) {
  const cutRadius = clamp(Number(input.cutRadius ?? 0.04), 0.018, 0.12);
  const sliceT = clamp(Number(input.sliceT ?? 0.47), 0.2, 0.8);
  const sliceAngle = clamp(Number(input.sliceAngle ?? 0), -70, 70);
  const halfWindow = clamp(cutRadius * 1.35, 0.024, 0.18);
  const lower = Number(clamp(sliceT - halfWindow, 0.08, 0.88).toFixed(4));
  const upper = Number(clamp(sliceT + halfWindow, 0.12, 0.94).toFixed(4));
  const affectedSegmentIds = [];
  const sliced = [];

  for (const descriptor of descriptors) {
    if (descriptor.materialRole !== "selected-source") {
      sliced.push(descriptor);
      continue;
    }
    affectedSegmentIds.push(descriptor.id);
    const [start, end] = descriptor.interval;
    sliced.push({
      ...descriptor,
      id: `${descriptor.id}-pre-cut`,
      materialRole: "selected-pre-cut",
      interval: [start, lower],
      sliceParentId: descriptor.id,
    });
    sliced.push({
      ...descriptor,
      id: `${descriptor.id}-continuation`,
      materialRole: "selected-continuation",
      interval: [upper, end],
      sliceParentId: descriptor.id,
      width: Number((descriptor.width * 0.86).toFixed(4)),
      edgeLift: Number((descriptor.edgeLift * 0.92).toFixed(4)),
    });
  }

  return {
    descriptors: sliced,
    sliceToolDescriptor: {
      mode: SLICE_TOOL_MODE,
      cutterId: "perpendicular-cutting-edge",
      cutT: Number(sliceT.toFixed(4)),
      cutRadius: Number(cutRadius.toFixed(4)),
      angleDegrees: Number(sliceAngle.toFixed(2)),
      capLaw: END_CAP_SEALING_MODE,
      window: [lower, upper],
    },
    sliceApplicationReceipt: {
      mode: "descriptor-slice-before-mesh-emission",
      affectedSegmentIds,
      emittedSegmentIds: sliced.map(d => d.id),
      capTValues: [lower, upper],
      openEdgeCount: 0,
    },
  };
}

function spherePoint(theta, phi, radius = 1) {
  const cosPhi = Math.cos(phi);
  return {
    x: radius * cosPhi * Math.cos(theta),
    y: radius * Math.sin(phi),
    z: radius * cosPhi * Math.sin(theta),
  };
}

function makeRibbonGeometry(THREE, span, opts) {
  const samples = opts.samples || 64;
  const width = opts.width || 0.06;
  const radius = opts.radius || 1;
  const vertices = [];
  const normals = [];
  const indices = [];
  const centerline = [];

  for (let i = 0; i <= samples; i++) {
    const t = span[0] + (span[1] - span[0]) * (i / samples);
    const theta = opts.theta0 + opts.thetaTwist * t;
    const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
    const p = spherePoint(theta, phi, radius);
    const p2 = spherePoint(theta + 0.018, phi + 0.012, radius);
    const tangent = new THREE.Vector3(p2.x - p.x, p2.y - p.y, p2.z - p.z).normalize();
    const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
    const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const edgeLift = opts.edgeLift || 0.015;
    const left = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(side, -width).addScaledVector(normal, edgeLift);
    const right = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(side, width).addScaledVector(normal, edgeLift * 0.45);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(normal.x, normal.y, normal.z, normal.x, normal.y, normal.z);
    centerline.push([Number(p.x.toFixed(5)), Number(p.y.toFixed(5)), Number(p.z.toFixed(5))]);
    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return { geometry, centerline };
}

function lamellarFrame(THREE, t, opts) {
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
  const p = spherePoint(theta, phi, opts.radius || 1);
  const p2 = spherePoint(theta + 0.018, phi + 0.012, opts.radius || 1);
  const tangent = new THREE.Vector3(p2.x - p.x, p2.y - p.y, p2.z - p.z).normalize();
  const normal = new THREE.Vector3(p.x, p.y, p.z).normalize();
  const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  return {
    center: new THREE.Vector3(p.x, p.y, p.z),
    tangent,
    normal,
    side,
  };
}

function makeCuttingEdgeGeometry(THREE, t, opts) {
  const frame = lamellarFrame(THREE, t, opts);
  const length = opts.length || 0.56;
  const halfWidth = opts.halfWidth || 0.018;
  const lift = opts.lift || 0.075;
  const angle = (opts.angleDegrees || 0) * Math.PI / 180;
  const crossAxis = frame.side.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.tangent, Math.sin(angle)).normalize();
  const railAxis = frame.tangent.clone().multiplyScalar(Math.cos(angle)).addScaledVector(frame.side, -Math.sin(angle)).normalize();
  const center = frame.center.clone().addScaledVector(frame.normal, lift);
  const a = center.clone().addScaledVector(crossAxis, -length * 0.5).addScaledVector(railAxis, -halfWidth);
  const b = center.clone().addScaledVector(crossAxis, length * 0.5).addScaledVector(railAxis, -halfWidth);
  const c = center.clone().addScaledVector(crossAxis, -length * 0.5).addScaledVector(railAxis, halfWidth);
  const d = center.clone().addScaledVector(crossAxis, length * 0.5).addScaledVector(railAxis, halfWidth);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    a.x, a.y, a.z,
    b.x, b.y, b.z,
    c.x, c.y, c.z,
    d.x, d.y, d.z,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
    frame.normal.x, frame.normal.y, frame.normal.z,
  ], 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeBoundingSphere();
  return {
    geometry,
    descriptor: {
      role: "perpendicular-cutting-edge",
      cutT: Number(t.toFixed(4)),
      angleDegrees: Number((opts.angleDegrees || 0).toFixed(2)),
      length: Number(length.toFixed(4)),
      halfWidth: Number(halfWidth.toFixed(4)),
      center: vectorSnapshot(center),
      tangent: vectorSnapshot(railAxis),
      crossAxis: vectorSnapshot(crossAxis),
      normal: vectorSnapshot(frame.normal),
    },
  };
}

function makeCapGeometry(THREE, t, opts) {
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * (opts.waviness ?? 0.08);
  const center = spherePoint(theta, phi, opts.radius || 1);
  const geometry = new THREE.CircleGeometry(opts.capRadius || 0.075, 24);
  geometry.rotateY(Math.PI / 2 - theta);
  geometry.rotateX(phi * 0.35);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function makeHook(centerline, layerIndex, bandIndex, role, descriptor = null) {
  return {
    bandId: descriptor?.id || `lamellar-${layerIndex}-${bandIndex}-${role}`,
    layerIndex,
    bandIndex,
    role,
    segmentKind: descriptor?.kind || "LamellarSectionSegment",
    curveLaw: descriptor?.curveLaw || "poloxodromic-sphere-strip-v0",
    depth: descriptor?.depth ?? 0,
    centerlineSamples: centerline.filter((_, i) => i % 8 === 0),
    rimMask: role.startsWith("selected") ? 0.92 : 0.48,
    innerExposure: role.startsWith("selected") ? 0.66 : 0.28,
    shellOcclusion: role.startsWith("selected") ? 0.32 : 0.58,
    emissiveCatch: role.startsWith("selected") ? 0.78 : 0.36,
    placeholderContract: PLACEHOLDER_CONTRACT,
  };
}

function vectorSnapshot(v) {
  return [Number(v.x.toFixed(5)), Number(v.y.toFixed(5)), Number(v.z.toFixed(5))];
}

export function createKaminosLamellarWitness({ THREE, scene, camera, controls }) {
  const group = new THREE.Group();
  group.name = "kaminos-lamellar-witness";
  group.visible = false;
  scene.add(group);

  const state = {
    active: false,
    witnessIdentity: WITNESS_IDENTITY,
    effectiveRoute: EFFECTIVE_ROUTE,
    effectiveView: "cap_profile",
    cutRadius: 0.04,
    layerCount: 2,
    proceduralSeed: 17,
    chiralityMode: "same",
    chiralityPattern: "same",
    depthSpacing: 0.035,
    chunkinessBase: 0.48,
    chunkinessVariance: 0.22,
    overlapBias: 0.38,
    sliceT: 0.47,
    sliceAngle: 0,
    frameCount: 0,
    capTValues: [],
    sectionSegments: [],
    cuttingEdgeDescriptor: null,
    composerDescriptor: null,
    layerStackDescriptor: null,
    layerSpecs: [],
    generatedSegmentDescriptors: [],
    sliceToolDescriptor: null,
    sliceApplicationReceipt: null,
    openEdgeCount: 0,
    lightHooks: [],
    lastBuildAt: null,
    widthRadiusCouplingMode: WIDTH_RADIUS_COUPLING_MODE,
    cutEndCapSealingMode: END_CAP_SEALING_MODE,
    placeholderContract: PLACEHOLDER_CONTRACT,
  };

  const materials = {
    selected: new THREE.MeshStandardMaterial({ color: 0xd6a33d, metalness: 0.72, roughness: 0.34, side: THREE.DoubleSide }),
    continuation: new THREE.MeshStandardMaterial({ color: 0xf2c86b, metalness: 0.64, roughness: 0.38, side: THREE.DoubleSide }),
    neighbor: new THREE.MeshStandardMaterial({ color: 0x1db6ac, metalness: 0.38, roughness: 0.42, side: THREE.DoubleSide }),
    cuttingEdge: new THREE.MeshStandardMaterial({ color: 0xff5d46, emissive: 0x3a0b04, emissiveIntensity: 0.35, metalness: 0.18, roughness: 0.32, side: THREE.DoubleSide }),
    cap: new THREE.MeshStandardMaterial({ color: 0xffcf76, metalness: 0.52, roughness: 0.3, side: THREE.DoubleSide }),
    gauge: new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
    placeholderA: new THREE.MeshStandardMaterial({ color: 0xd8cfab, metalness: 0.44, roughness: 0.48, side: THREE.DoubleSide }),
    placeholderB: new THREE.MeshStandardMaterial({ color: 0x7fc5bc, metalness: 0.44, roughness: 0.48, side: THREE.DoubleSide }),
  };

  function clear() {
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose?.();
      group.remove(child);
    }
  }

  function build({ frame = false } = {}) {
    clear();
    const generated = generateLamellarSectionSegments({
      seed: state.proceduralSeed,
      chirality: state.chiralityMode,
      chiralityPattern: state.chiralityPattern,
      layerCount: state.layerCount,
      depthSpacing: state.depthSpacing,
      chunkinessBase: state.chunkinessBase,
      chunkinessVariance: state.chunkinessVariance,
      overlapBias: state.overlapBias,
    });
    const sliced = sliceLamellarSectionSegments(generated.descriptors, {
      cutRadius: state.cutRadius,
      sliceT: state.sliceT,
      sliceAngle: state.sliceAngle,
    });
    state.composerDescriptor = generated.composerDescriptor;
    state.layerStackDescriptor = generated.layerStackDescriptor;
    state.layerSpecs = generated.layerSpecs;
    state.generatedSegmentDescriptors = sliced.descriptors.map(d => ({
      id: d.id,
      kind: d.kind,
      layerSpecId: d.layerSpecId,
      materialRole: d.materialRole,
      layerIndex: d.layerIndex,
      depth: d.depth,
      chirality: d.chirality,
      chunkiness: d.chunkiness,
      segmentCount: d.segmentCount,
      interval: d.interval,
      curveLaw: d.curveLaw,
      capLaw: d.capLaw,
      source: d.source,
      sliceParentId: d.sliceParentId || null,
    }));
    state.sliceToolDescriptor = sliced.sliceToolDescriptor;
    state.sliceApplicationReceipt = sliced.sliceApplicationReceipt;
    state.capTValues = sliced.sliceApplicationReceipt.capTValues;
    state.sectionSegments = [];
    state.lightHooks = [];

    sliced.descriptors.forEach((descriptor, index) => {
      const opts = descriptorCurveOptions(descriptor);
      const { geometry, centerline } = makeRibbonGeometry(THREE, descriptor.interval, opts);
      let material = materials.neighbor;
      if (descriptor.materialRole === "selected-pre-cut") material = materials.selected;
      if (descriptor.materialRole === "selected-continuation") material = materials.continuation;
      if (descriptor.materialRole === "nested-placeholder-shell") {
        material = descriptor.layerIndex % 2 ? materials.placeholderA : materials.placeholderB;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.lamellarRole = descriptor.materialRole;
      mesh.userData.lamellarSectionId = descriptor.id;
      group.add(mesh);
      state.sectionSegments.push({
        id: descriptor.id,
        kind: descriptor.kind,
        layerSpecId: descriptor.layerSpecId,
        role: descriptor.materialRole,
        layerIndex: descriptor.layerIndex,
        depth: descriptor.depth,
        chirality: descriptor.chirality,
        chunkiness: descriptor.chunkiness,
        span: descriptor.interval,
        curveLaw: descriptor.curveLaw,
        openEdgeCount: 0,
      });
      state.lightHooks.push(makeHook(centerline, descriptor.layerIndex, index, descriptor.materialRole, descriptor));
    });

    const selectedDescriptor = sliced.descriptors.find(d => d.materialRole === "selected-pre-cut") || sliced.descriptors[0];
    const base = descriptorCurveOptions(selectedDescriptor);
    const cutT = state.sliceToolDescriptor.cutT;
    const cuttingEdge = makeCuttingEdgeGeometry(THREE, cutT, {
      ...base,
      length: 0.46 + state.cutRadius * 1.2 + state.overlapBias * 0.12,
      angleDegrees: state.sliceAngle,
    });
    const cuttingMesh = new THREE.Mesh(cuttingEdge.geometry, materials.cuttingEdge);
    cuttingMesh.userData.lamellarRole = "perpendicular-cutting-edge";
    group.add(cuttingMesh);
    state.cuttingEdgeDescriptor = cuttingEdge.descriptor;
    state.sectionSegments.push({ role: "perpendicular-cutting-edge", span: [cutT, cutT], angleDegrees: state.sliceAngle, openEdgeCount: 0 });

    for (const t of state.capTValues) {
      const cap = new THREE.Mesh(makeCapGeometry(THREE, t, { ...base, capRadius: 0.06 + state.cutRadius * 0.32 }), materials.cap);
      cap.userData.lamellarRole = "zero-lift-cut-end-cap";
      group.add(cap);
    }

    if (state.effectiveView === "cut_radius_coupling") {
      const gauge = new THREE.Mesh(makeRibbonGeometry(THREE, [state.capTValues[0], state.capTValues[1]], { ...base, width: 0.018 + state.cutRadius * 0.12, radius: 1.055 }).geometry, materials.gauge);
      gauge.userData.lamellarRole = "cut-window-gauge";
      group.add(gauge);
    }

    state.openEdgeCount = 0;
    state.lastBuildAt = new Date().toISOString();
    if (frame) frameCamera();
  }

  function frameCamera() {
    const preset = VIEW_PRESETS[state.effectiveView] || VIEW_PRESETS.cap_profile;
    const x = Math.cos(preset.pitch) * Math.sin(preset.yaw) * preset.distance;
    const y = Math.sin(preset.pitch) * preset.distance;
    const z = Math.cos(preset.pitch) * Math.cos(preset.yaw) * preset.distance;
    camera.position.set(x, y, z);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function setControls(next = {}) {
    state.cutRadius = clamp(Number(next.cutRadius ?? state.cutRadius), 0.018, 0.12);
    state.layerCount = Math.round(clamp(Number(next.layerCount ?? state.layerCount), 1, 4));
    state.proceduralSeed = Math.round(clamp(Number(next.seed ?? state.proceduralSeed), 0, 99999));
    state.chiralityMode = ["same", "counterpatch", "mixed"].includes(next.chirality) ? next.chirality : state.chiralityMode;
    state.chiralityPattern = clampPattern(next.chiralityPattern ?? state.chiralityPattern);
    state.depthSpacing = clamp(Number(next.depthSpacing ?? state.depthSpacing), 0.015, 0.09);
    state.chunkinessBase = clamp(Number(next.chunkinessBase ?? state.chunkinessBase), 0.05, 1);
    state.chunkinessVariance = clamp(Number(next.chunkinessVariance ?? state.chunkinessVariance), 0, 0.65);
    state.overlapBias = clamp(Number(next.overlapBias ?? state.overlapBias), 0, 1);
    state.sliceT = clamp(Number(next.sliceT ?? state.sliceT), 0.2, 0.8);
    state.sliceAngle = clamp(Number(next.sliceAngle ?? state.sliceAngle), -70, 70);
    state.effectiveView = VIEW_PRESETS[next.view] ? next.view : state.effectiveView;
    if (state.active) build({ frame: false });
  }

  function setActive(active) {
    state.active = Boolean(active);
    group.visible = state.active;
    if (state.active) build({ frame: false });
  }

  function update() {
    if (!state.active) return;
    state.frameCount += 1;
  }

  function debugState() {
    return {
      ...state,
      requestedRoute: "kaminos_lamellar_witness=1",
      lightHookCount: state.lightHooks.length,
      segmentDescriptorCount: state.generatedSegmentDescriptors.length,
      childCount: group.children.length,
      cameraPosition: vectorSnapshot(camera.position),
      cameraTarget: vectorSnapshot(controls.target),
    };
  }

  return { setActive, setControls, update, frameCamera, debugState };
}
