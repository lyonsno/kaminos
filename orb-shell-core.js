export const ORB_SHELL_WITNESS_IDENTITY = 'orb-shell-single-layer-witness-v0';
export const ORB_SHELL_SUPPORT_MANIFOLD = 'orb-shell-support-manifold-v0';

const TAU = Math.PI * 2;
const FORBIDDEN_FIRST_SLICE_SCOPE = [
  'multi-layer-interleaving',
  'real-inner-core',
  'recipe-gallery',
  'saved-state-ux',
  'status-animation',
  'mesh-export',
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeRng(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function spherePoint(lat, lon, radius = 1) {
  const c = Math.cos(lat);
  return [radius * Math.sin(lon) * c, radius * Math.sin(lat), radius * Math.cos(lon) * c];
}

function makeShellLeafDescriptors({ seed, leafCount }) {
  const rng = makeRng(seed);
  const phases = [];
  const base = [-1.34, -0.92, -0.52, 0.52, 0.92, 1.34, -1.84, 1.84, -2.38, 2.38, Math.PI - 0.22, -Math.PI + 0.22, -0.08, 0.08];
  for (let i = 0; i < leafCount; i++) phases.push(base[i % base.length] + (rng() - 0.5) * 0.09);
  return phases.slice(0, leafCount).map((phase, index) => {
    const primary = Math.abs(phase) < 1.4 || index < 6;
    const width = primary ? 0.132 + rng() * 0.027 : 0.076 + rng() * 0.024;
    const handedness = index % 2 === 0 ? 1 : -1;
    const radialBand = index % 4;
    return {
      schema: 'ShellSkeletonDescriptor',
      id: `shell-leaf-${String(index).padStart(2, '0')}`,
      role: primary ? 'primary-carapace-leaf' : 'secondary-silhouette-leaf',
      layerPath: ['outer'],
      supportLayer: 'outer',
      radialBand,
      overUnderOrder: index,
      canTransitionLayers: false,
      transitionEvents: [],
      motionHandles: ['slide', 'peel', 'reseat'],
      phase,
      handedness,
      baseWidth: width,
      thickness: primary ? 0.034 : 0.025,
      radiusBias: 0.012 * radialBand + (primary ? 0.018 : 0.002),
      startLat: -1.2 + (rng() - 0.5) * 0.07,
      endLat: 1.18 + (rng() - 0.5) * 0.07,
      twist: 1.36 + rng() * 0.52,
      bow: (rng() - 0.5) * 0.48,
    };
  });
}

function makeApertureGraphDescriptor(apertureCount) {
  const apertures = [
    {
      id: 'primary-front-aperture',
      schema: 'ApertureGraphDescriptor',
      role: 'primary-front-aperture',
      frame: 'front-positive-z',
      center: [0, 0.02, 0.98],
      radius: [0.34, 0.52],
      rimProximity: 1,
      innerExposure: 0.78,
      shellOcclusion: 0.24,
    },
  ];
  for (let i = 0; i < Math.max(2, apertureCount - 1); i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const tier = Math.floor(i / 2);
    apertures.push({
      id: `secondary-gill-${i + 1}`,
      schema: 'ApertureGraphDescriptor',
      role: 'secondary-gill',
      frame: side < 0 ? 'left-front-quadrant' : 'right-front-quadrant',
      center: [side * (0.54 + tier * 0.12), -0.12 + tier * 0.22, 0.76 - tier * 0.08],
      radius: [0.13, 0.32],
      rimProximity: 0.72,
      innerExposure: 0.42,
      shellOcclusion: 0.48,
    });
  }
  return {
    schema: 'ApertureGraphDescriptor',
    mode: 'single-layer-exterior-aperture-graph-v0',
    apertures,
    primaryApertureId: 'primary-front-aperture',
    minimumSecondaryApertures: 2,
  };
}

function makeCoreSocketDescriptor() {
  return {
    schema: 'CoreSocketDescriptor',
    id: 'core-socket-placeholder',
    mode: 'placeholder-core-socket-not-real-inner-core',
    localToWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    radius: 0.44,
    exposureEnvelope: 0.54,
    placeholderOnly: true,
  };
}

function sampleLeafCenter(leaf, t, radius = 1) {
  const lat = leaf.startLat + (leaf.endLat - leaf.startLat) * t;
  const apertureAvoidance = Math.exp(-Math.pow((t - 0.5) / 0.28, 2));
  const frontPhase = Math.abs(leaf.phase) < 0.6 ? Math.sign(leaf.phase || 1) * 0.16 * apertureAvoidance : 0;
  const lon = leaf.phase
    + leaf.handedness * leaf.twist * (t - 0.5)
    + Math.sin(t * Math.PI) * leaf.bow
    + frontPhase;
  return spherePoint(lat, lon, radius + leaf.radiusBias);
}

function normalizeVector(THREE, vector, fallback = [1, 0, 0]) {
  const v = new THREE.Vector3(vector[0], vector[1], vector[2]);
  if (v.lengthSq() < 1e-8) return new THREE.Vector3(...fallback);
  return v.normalize();
}

function pushFace(indices, a, b, c, d) {
  indices.push(a, b, d, b, c, d);
}

function makeShellLeafGeometry(THREE, leaf) {
  const rowCount = 58;
  const columnCount = 9;
  const vertices = [];
  const normals = [];
  const top = [];
  const bottom = [];

  const centers = Array.from({ length: rowCount }, (_, row) => sampleLeafCenter(leaf, row / (rowCount - 1), 1));
  for (let row = 0; row < rowCount; row++) {
    const t = row / (rowCount - 1);
    const center = new THREE.Vector3(...centers[row]);
    const prev = new THREE.Vector3(...centers[Math.max(0, row - 1)]);
    const next = new THREE.Vector3(...centers[Math.min(rowCount - 1, row + 1)]);
    const normal = center.clone().normalize();
    const tangent = next.clone().sub(prev).normalize();
    let side = new THREE.Vector3().crossVectors(normal, tangent);
    if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
    side.normalize();
    const widthProfile = Math.pow(Math.sin(Math.PI * t), 0.44);
    const terminalNarrow = 0.28 + 0.72 * widthProfile;
    const aperturePinch = Math.abs(leaf.phase) < 0.7 ? 1 - 0.28 * Math.exp(-Math.pow((t - 0.52) / 0.18, 2)) : 1;
    const halfWidth = leaf.baseWidth * terminalNarrow * aperturePinch;
    const halfThickness = leaf.thickness * (0.82 + 0.18 * widthProfile);
    const topRow = [];
    const bottomRow = [];
    for (let col = 0; col < columnCount; col++) {
      const u = col / (columnCount - 1);
      const q = u * 2 - 1;
      const crown = 1 - Math.pow(Math.abs(q), 1.7) * 0.22;
      const edgeBevel = Math.pow(Math.abs(q), 4) * halfThickness * 0.42;
      const topPos = center.clone()
        .addScaledVector(side, q * halfWidth)
        .addScaledVector(normal, halfThickness * crown - edgeBevel);
      const bottomPos = center.clone()
        .addScaledVector(side, q * halfWidth * 0.91)
        .addScaledVector(normal, -halfThickness * 0.58);
      topRow.push(vertices.length / 3);
      vertices.push(topPos.x, topPos.y, topPos.z);
      normals.push(normal.x, normal.y, normal.z);
      bottomRow.push(vertices.length / 3);
      vertices.push(bottomPos.x, bottomPos.y, bottomPos.z);
      normals.push(-normal.x * 0.25, -normal.y * 0.25, -normal.z * 0.25);
    }
    top.push(topRow);
    bottom.push(bottomRow);
  }

  const grooveLeft = [];
  const grooveRight = [];
  const segmentCuts = [];
  for (let row = 4; row < rowCount - 4; row += 7) {
    segmentCuts.push(row);
  }

  const indices = [];
  for (let row = 0; row < rowCount - 1; row++) {
    for (let col = 0; col < columnCount - 1; col++) {
      pushFace(indices, top[row][col], top[row][col + 1], top[row + 1][col + 1], top[row + 1][col]);
      pushFace(indices, bottom[row + 1][col], bottom[row + 1][col + 1], bottom[row][col + 1], bottom[row][col]);
    }
    pushFace(indices, top[row][0], top[row + 1][0], bottom[row + 1][0], bottom[row][0]);
    pushFace(indices, bottom[row][columnCount - 1], bottom[row + 1][columnCount - 1], top[row + 1][columnCount - 1], top[row][columnCount - 1]);
  }
  for (const row of [0, rowCount - 1]) {
    for (let col = 0; col < columnCount - 1; col++) {
      pushFace(indices, bottom[row][col], bottom[row][col + 1], top[row][col + 1], top[row][col]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData = {
    sourceDescriptorId: leaf.id,
    surfaceMode: 'swept-solid-single-layer-shell-leaf',
    rowCount,
    columnCount,
    grooveLeft,
    grooveRight,
    segmentCuts,
  };
  return geometry;
}

function makeBandPoints(THREE, leaf, sideSign, widthScale = 0.96, normalLift = 0.68) {
  const points = [];
  for (let i = 0; i < 44; i++) {
    const t = i / 43;
    const center = new THREE.Vector3(...sampleLeafCenter(leaf, t, 1.025));
    const prev = new THREE.Vector3(...sampleLeafCenter(leaf, Math.max(0, t - 0.01), 1.025));
    const next = new THREE.Vector3(...sampleLeafCenter(leaf, Math.min(1, t + 0.01), 1.025));
    const normal = center.clone().normalize();
    const tangent = next.clone().sub(prev).normalize();
    const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const widthProfile = Math.pow(Math.sin(Math.PI * t), 0.44);
    const halfWidth = leaf.baseWidth * (0.28 + 0.72 * widthProfile);
    points.push(center.addScaledVector(side, sideSign * halfWidth * widthScale).addScaledVector(normal, leaf.thickness * normalLift));
  }
  return points;
}

function makeTubeGeometry(THREE, points, radius, tubularSegments = 64) {
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, tubularSegments, radius, 8, false);
}

function makeSegmentCurve(THREE, leaf, t) {
  const center = new THREE.Vector3(...sampleLeafCenter(leaf, t, 1.025));
  const prev = new THREE.Vector3(...sampleLeafCenter(leaf, Math.max(0, t - 0.01), 1.025));
  const next = new THREE.Vector3(...sampleLeafCenter(leaf, Math.min(1, t + 0.01), 1.025));
  const normal = center.clone().normalize();
  const tangent = next.clone().sub(prev).normalize();
  const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
  const widthProfile = Math.pow(Math.sin(Math.PI * t), 0.44);
  const halfWidth = leaf.baseWidth * (0.26 + 0.7 * widthProfile);
  const points = [
    center.clone().addScaledVector(side, -halfWidth * 0.72).addScaledVector(normal, leaf.thickness * 0.93),
    center.clone().addScaledVector(side, halfWidth * 0.72).addScaledVector(normal, leaf.thickness * 0.93),
  ];
  return new THREE.BufferGeometry().setFromPoints(points);
}

function makeApertureRimGeometry(THREE, aperture) {
  const points = [];
  const [cx, cy, cz] = aperture.center;
  const [rx, ry] = aperture.radius;
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * TAU;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const projectedZ = Math.sqrt(Math.max(0.01, 1 - x * x - y * y));
    const z = Math.max(cz * 0.82, projectedZ) + 0.035;
    points.push(new THREE.Vector3(x, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(points, true);
  return new THREE.TubeGeometry(curve, 112, aperture.role === 'primary-front-aperture' ? 0.013 : 0.008, 8, true);
}

export function createKaminosOrbShellWitness({ THREE, scene, camera, controls, onStatus, onDirty } = {}) {
  let active = false;
  let group = null;
  let controlsState = { seed: 17, leafCount: 10, apertureCount: 3 };
  let shellSkeleton = null;
  let apertureGraph = null;
  let coreSocket = null;

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a3135,
    roughness: 0.2,
    metalness: 0.94,
    envMapIntensity: 2.4,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: 0x6c777b,
    roughness: 0.18,
    metalness: 0.92,
    envMapIntensity: 2.8,
  });
  const grooveMaterial = new THREE.LineBasicMaterial({ color: 0x0a0d0f, transparent: true, opacity: 0.72 });
  const amberRimMaterial = new THREE.LineBasicMaterial({ color: 0x9a3a15, transparent: true, opacity: 0.38 });
  const apertureRimMaterial = new THREE.MeshStandardMaterial({
    color: 0x384247,
    roughness: 0.17,
    metalness: 0.96,
    envMapIntensity: 3.1,
  });
  const innerMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4a12,
    transparent: true,
    opacity: 0.1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });

  function disposeGroup() {
    if (!group) return;
    scene.remove(group);
    group.traverse(child => {
      child.geometry?.dispose?.();
      if (
        child.material
        && child.material !== metalMaterial
        && child.material !== railMaterial
        && child.material !== grooveMaterial
        && child.material !== amberRimMaterial
        && child.material !== apertureRimMaterial
        && child.material !== innerMaterial
      ) {
        child.material.dispose?.();
      }
    });
    group = null;
  }

  function buildDescriptors() {
    const seed = Math.round(Number(controlsState.seed) || 17);
    const leafCount = clamp(Math.round(Number(controlsState.leafCount) || 10), 8, 14);
    const apertureCount = clamp(Math.round(Number(controlsState.apertureCount) || 3), 3, 6);
    shellSkeleton = {
      schema: 'ShellSkeletonDescriptor',
      identity: ORB_SHELL_WITNESS_IDENTITY,
      supportManifold: ORB_SHELL_SUPPORT_MANIFOLD,
      mode: 'single-visible-exterior-carapace-layer',
      seed,
      visibleLayerCount: 1,
      leafCount,
      leaves: makeShellLeafDescriptors({ seed, leafCount }),
    };
    apertureGraph = makeApertureGraphDescriptor(apertureCount);
    coreSocket = makeCoreSocketDescriptor();
  }

  function build() {
    disposeGroup();
    buildDescriptors();
    group = new THREE.Group();
    group.name = ORB_SHELL_WITNESS_IDENTITY;
    group.userData.orbShellWitness = {
      identity: ORB_SHELL_WITNESS_IDENTITY,
      supportManifold: ORB_SHELL_SUPPORT_MANIFOLD,
      placeholderCoreOnly: true,
    };

    const keyLight = new THREE.DirectionalLight(0xcfd9de, 2.4);
    keyLight.name = 'orb-shell-witness-cool-key-light';
    keyLight.position.set(-2.8, 2.1, 3.6);
    group.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xff8a35, 0.95);
    rimLight.name = 'orb-shell-witness-amber-rim-light';
    rimLight.position.set(2.8, -0.4, 2.2);
    group.add(rimLight);
    const fillLight = new THREE.HemisphereLight(0x5d6a70, 0x0a0807, 0.72);
    fillLight.name = 'orb-shell-witness-low-fill-light';
    group.add(fillLight);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.34, 48, 24), innerMaterial);
    core.name = 'core-socket-placeholder-not-real-inner-core';
    group.add(core);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.46, 48, 24), innerMaterial.clone());
    glow.material.opacity = 0.055;
    glow.name = 'core-socket-exposure-envelope-placeholder';
    group.add(glow);

    for (const aperture of apertureGraph.apertures) {
      const rim = new THREE.Mesh(makeApertureRimGeometry(THREE, aperture), apertureRimMaterial);
      rim.name = `${aperture.id}-visible-rim`;
      rim.userData.ApertureGraphDescriptor = aperture;
      rim.userData.rimProximity = aperture.rimProximity;
      group.add(rim);
    }

    for (const leaf of shellSkeleton.leaves) {
      const mesh = new THREE.Mesh(makeShellLeafGeometry(THREE, leaf), metalMaterial);
      mesh.name = leaf.id;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.ShellSkeletonDescriptor = leaf;
      group.add(mesh);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(makeTubeGeometry(THREE, makeBandPoints(THREE, leaf, side, 0.99, 0.82), 0.0065), railMaterial);
        rail.name = `${leaf.id}-rim-rail-${side < 0 ? 'root' : 'free'}`;
        rail.userData.rimProximity = side;
        group.add(rail);
        const groove = new THREE.Line(new THREE.BufferGeometry().setFromPoints(makeBandPoints(THREE, leaf, side * 0.58, 0.58, 0.92)), grooveMaterial);
        groove.name = `${leaf.id}-inset-groove-${side < 0 ? 'left' : 'right'}`;
        groove.userData.surfaceDetail = 'inset-longitudinal-groove';
        group.add(groove);
      }
      for (let i = 0; i < 6; i++) {
        const t = 0.16 + i * 0.12 + (leaf.radialBand % 2) * 0.035;
        const segment = new THREE.Line(makeSegmentCurve(THREE, leaf, t), i % 3 === 0 ? amberRimMaterial : grooveMaterial);
        segment.name = `${leaf.id}-plate-break-${String(i).padStart(2, '0')}`;
        segment.userData.surfaceDetail = 'short-cross-plate-break';
        group.add(segment);
      }
    }

    scene.add(group);
    onStatus?.({ phase: 'built', identity: ORB_SHELL_WITNESS_IDENTITY, leafCount: shellSkeleton.leafCount });
    onDirty?.();
  }

  return {
    setActive(next) {
      active = !!next;
      if (active) build();
      else disposeGroup();
      onDirty?.();
    },
    setControls(next = {}) {
      controlsState = {
        seed: Number(next.seed ?? controlsState.seed),
        leafCount: clamp(Math.round(Number(next.leafCount ?? controlsState.leafCount)), 8, 14),
        apertureCount: clamp(Math.round(Number(next.apertureCount ?? controlsState.apertureCount)), 3, 6),
      };
      if (active) build();
    },
    frameCamera() {
      camera.position.set(0.22, 0.16, 3.92);
      controls.target.set(0, 0.01, 0);
      controls.update();
      onDirty?.();
    },
    dispose() {
      active = false;
      disposeGroup();
    },
    debugState() {
      return {
        identity: ORB_SHELL_WITNESS_IDENTITY,
        supportManifold: ORB_SHELL_SUPPORT_MANIFOLD,
        active,
        controls: { ...controlsState },
        shellSkeleton,
        apertureGraph,
        coreSocket,
        ShellSkeletonDescriptor: shellSkeleton?.leaves || [],
        ApertureGraphDescriptor: apertureGraph?.apertures || [],
        CoreSocketDescriptor: coreSocket,
        forbiddenFirstSliceScope: FORBIDDEN_FIRST_SLICE_SCOPE.slice(),
        visualContract: {
          visibleLayerCount: 1,
          layerPath: ['outer'],
          multiLayerInterleaving: false,
          realInnerCore: false,
          recipeGallery: false,
        },
      };
    },
  };
}
