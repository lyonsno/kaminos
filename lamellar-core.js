const WITNESS_IDENTITY = "kaminos-lamellar-witness-v0";
const EFFECTIVE_ROUTE = "sphere-domain-section-segment-witness-v0";
const WIDTH_RADIUS_COUPLING_MODE = "stable-strip-width-cut-radius-only-changes-window-caps-gap";
const END_CAP_SEALING_MODE = "zero-lift-closed-terminal-cap-slab";
const PLACEHOLDER_CONTRACT = "temporary-aesthetic-composition-primitive-not-final-lamellar-topology";

const VIEW_PRESETS = {
  cut_radius_coupling: { yaw: 0.72, pitch: 0.35, distance: 3.2 },
  cap_profile: { yaw: 1.42, pitch: 0.44, distance: 2.7 },
  malformed_contact_stress: { yaw: 0.86, pitch: 0.28, distance: 3.5 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
    const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * 0.08;
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

function makeCapGeometry(THREE, t, opts) {
  const theta = opts.theta0 + opts.thetaTwist * t;
  const phi = opts.phi0 + opts.phiSlope * (t - 0.5) + Math.sin(t * Math.PI * 2 + opts.phase) * 0.08;
  const center = spherePoint(theta, phi, opts.radius || 1);
  const geometry = new THREE.CircleGeometry(opts.capRadius || 0.075, 24);
  geometry.rotateY(Math.PI / 2 - theta);
  geometry.rotateX(phi * 0.35);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

function makeHook(centerline, layerIndex, bandIndex, role) {
  return {
    bandId: `lamellar-${layerIndex}-${bandIndex}-${role}`,
    layerIndex,
    bandIndex,
    role,
    centerlineSamples: centerline.filter((_, i) => i % 8 === 0),
    rimMask: role === "selected" ? 0.92 : 0.48,
    innerExposure: role === "selected" ? 0.66 : 0.28,
    shellOcclusion: role === "selected" ? 0.32 : 0.58,
    emissiveCatch: role === "selected" ? 0.78 : 0.36,
    placeholderContract: PLACEHOLDER_CONTRACT,
  };
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
    frameCount: 0,
    capTValues: [],
    sectionSegments: [],
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
    cap: new THREE.MeshStandardMaterial({ color: 0xffcf76, metalness: 0.52, roughness: 0.3, side: THREE.DoubleSide }),
    gauge: new THREE.MeshBasicMaterial({ color: 0xff6a52, transparent: true, opacity: 0.72, side: THREE.DoubleSide }),
  };

  function clear() {
    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose?.();
      group.remove(child);
    }
  }

  function build() {
    clear();
    state.capTValues = [Number((0.43 - state.cutRadius * 1.0).toFixed(4)), Number((0.49 + state.cutRadius * 1.5).toFixed(4))];
    const selectedSpans = [[0.12, state.capTValues[0]], [state.capTValues[1], 0.9]];
    const base = {
      theta0: -1.1,
      thetaTwist: 4.65,
      phi0: -0.35,
      phiSlope: 1.0,
      phase: 0.4,
      radius: 1,
      width: 0.07,
      edgeLift: 0.018,
    };
    const neighbor = { ...base, theta0: -0.64, phi0: -0.18, phase: 1.25, width: 0.055, radius: 1.025 };
    state.sectionSegments = [];
    state.lightHooks = [];

    selectedSpans.forEach((span, index) => {
      const { geometry, centerline } = makeRibbonGeometry(THREE, span, base);
      const mesh = new THREE.Mesh(geometry, index === 0 ? materials.selected : materials.continuation);
      mesh.userData.lamellarRole = index === 0 ? "selected-pre-cut" : "selected-continuation";
      group.add(mesh);
      state.sectionSegments.push({ role: mesh.userData.lamellarRole, span, openEdgeCount: 0 });
      state.lightHooks.push(makeHook(centerline, 0, index, "selected"));
    });

    const neighborSpan = state.effectiveView === "cap_profile" ? [0.22, 0.86] : [0.3, 0.78];
    const neighborRibbon = makeRibbonGeometry(THREE, neighborSpan, neighbor);
    const neighborMesh = new THREE.Mesh(neighborRibbon.geometry, materials.neighbor);
    neighborMesh.userData.lamellarRole = "neighbor-envelope";
    group.add(neighborMesh);
    state.sectionSegments.push({ role: "neighbor-envelope", span: neighborSpan, openEdgeCount: 0 });
    state.lightHooks.push(makeHook(neighborRibbon.centerline, 1, 0, "neighbor"));

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

    for (let layer = 2; layer < state.layerCount + 1; layer++) {
      const layerOpts = { ...base, theta0: base.theta0 + layer * 0.33, radius: 0.82 - layer * 0.035, width: 0.025, phase: layer * 0.7 };
      const shell = makeRibbonGeometry(THREE, [0.08, 0.9], layerOpts);
      const mat = new THREE.MeshStandardMaterial({ color: layer % 2 ? 0xd8cfab : 0x7fc5bc, metalness: 0.44, roughness: 0.48, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(shell.geometry, mat);
      mesh.userData.lamellarRole = "nested-placeholder-shell";
      group.add(mesh);
      state.lightHooks.push(makeHook(shell.centerline, layer, 0, "placeholder"));
    }

    state.openEdgeCount = 0;
    state.lastBuildAt = new Date().toISOString();
    frameCamera();
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
    state.effectiveView = VIEW_PRESETS[next.view] ? next.view : state.effectiveView;
    if (state.active) build();
  }

  function setActive(active) {
    state.active = Boolean(active);
    group.visible = state.active;
    if (state.active) build();
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
      childCount: group.children.length,
    };
  }

  return { setActive, setControls, update, frameCamera, debugState };
}
