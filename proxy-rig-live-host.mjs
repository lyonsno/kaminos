import {
  createProxyPoseRun,
  createProxyRigEvaluator,
  PROXY_RIG_RUNTIME_SCHEMA,
  sampleProxyPoseRun,
  verifyProxyRigPackageIdentity,
} from './proxy-rig-runtime.mjs';
import {
  createProxyRigComparisonCarryState,
  transferProxyRigComparisonPose,
} from './proxy-rig-comparison.mjs';

const POSE_STORAGE_PREFIX = 'kaminos.proxy-rig.pose-run.v0:';

function castPose(controls) {
  const pose = {};
  for (const [name, control] of controls) {
    pose[name] = { quaternion: control.quaternion.toArray() };
  }
  return pose;
}

function shortId(value) {
  return value?.startsWith('sha256:') ? `${value.slice(0, 15)}...${value.slice(-6)}` : String(value || 'missing');
}

function controlNameFallback(name) {
  const codePoints = Array.from(name, character => (
    `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`
  ));
  return `Control ${codePoints.join(' ')}`;
}

function controlLabel(name) {
  const hindlimb = name.match(/^hindlimb-(left|right)-(hip|stifle|hock|paw)$/);
  if (hindlimb) return `${hindlimb[1][0].toUpperCase()}${hindlimb[1].slice(1)} hindlimb - ${hindlimb[2][0].toUpperCase()}${hindlimb[2].slice(1)}`;
  const skeletalSupport = name.match(/^hindlimb-(left|right)-(proximal|distal)-support$/);
  if (skeletalSupport) {
    const side = `${skeletalSupport[1][0].toUpperCase()}${skeletalSupport[1].slice(1)}`;
    const position = `${skeletalSupport[2][0].toUpperCase()}${skeletalSupport[2].slice(1)}`;
    return `${side} hindlimb - ${position} support`;
  }
  const friendly = name.split('-')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
  const candidate = friendly || name.trim();
  return /[^\p{Z}\p{Cc}\p{Cf}]/u.test(candidate) ? candidate : controlNameFallback(name);
}

export function proxyRigControlOptionDescriptor(name) {
  return {
    value: name,
    title: name,
    label: controlLabel(name),
  };
}

export function resolveProxyRigTransformTarget(controls, selectedControl) {
  return controls.get(selectedControl) ?? null;
}

export function chooseProxyRigInitialControlName(controlNames, requestedInitialControl = null) {
  if (requestedInitialControl !== null && requestedInitialControl !== undefined) {
    return controlNames.includes(requestedInitialControl) ? requestedInitialControl : null;
  }
  if (controlNames.includes('hindlimb-right-hock')) return 'hindlimb-right-hock';
  return controlNames[0] ?? null;
}

export function countVisibleProxyRigSupportSegments(root) {
  let count = 0;
  const visit = (object, ancestorsVisible) => {
    const effectivelyVisible = ancestorsVisible && object?.visible !== false;
    if (effectivelyVisible && object?.userData?.controlKind === 'skeletal-support-segment') {
      count += 1;
    }
    for (const child of object?.children ?? []) visit(child, effectivelyVisible);
  };
  if (root) visit(root, true);
  return count;
}

export function proxyRigRenderIdentity(THREE, renderer) {
  return {
    renderBackend: renderer.backend?.constructor?.name ?? 'unknown',
    renderKernel: `three-r${THREE.REVISION ?? 'unknown'}-webgpu-render-pipeline`,
  };
}

export function setProxyRigControlVisibility(controls, transformControls, visible) {
  const controlsVisible = Boolean(visible);
  for (const control of controls) control.visible = controlsVisible;
  const transformVisible = controlsVisible && !!transformControls.object;
  transformControls.visible = transformVisible;
  const helper = transformControls.getHelper?.();
  if (helper) helper.visible = transformVisible;
}

export function proxyRigMuscleOverlayDescriptor(muscle) {
  return {
    relationId: muscle.relationId,
    requestedRoute: muscle.requestedRoute,
    effectiveRoute: muscle.effectiveRoute,
    fallbackUsed: muscle.fallbackUsed,
    historicalRef: muscle.source?.historicalRef ?? null,
    fixtureId: muscle.source?.fixtureId ?? null,
    fixedSupport: muscle.supportMapping?.fixed ?? null,
    movingSupport: muscle.supportMapping?.moving ?? null,
  };
}

export function setProxyRigMuscleVisibility(meshes, visible) {
  for (const mesh of meshes) mesh.visible = Boolean(visible);
}

export function proxyRigMaximumVertexDisplacement(restPositions, posedPositions) {
  if (!restPositions || !posedPositions
      || restPositions.length !== posedPositions.length
      || restPositions.length % 3 !== 0) {
    throw new Error('Muscle displacement requires matching xyz arrays');
  }
  let maximum = 0;
  for (let index = 0; index < restPositions.length; index += 3) {
    maximum = Math.max(maximum, Math.hypot(
      posedPositions[index] - restPositions[index],
      posedPositions[index + 1] - restPositions[index + 1],
      posedPositions[index + 2] - restPositions[index + 2],
    ));
  }
  return maximum;
}

export function proxyRigMuscleShapeChange(restPositions, posedPositions, triangles) {
  if ((!Array.isArray(restPositions) && !ArrayBuffer.isView(restPositions))
      || (!Array.isArray(posedPositions) && !ArrayBuffer.isView(posedPositions))
      || restPositions.length !== posedPositions.length
      || restPositions.length % 3 !== 0) {
    throw new Error('Muscle shape diagnostics require matching xyz arrays');
  }
  if ((!Array.isArray(triangles) && !ArrayBuffer.isView(triangles)) || triangles.length % 3 !== 0) {
    throw new Error('Muscle shape diagnostics require triangle indices');
  }
  const vertexCount = restPositions.length / 3;
  const edges = new Set();
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const triangle = [triangles[offset], triangles[offset + 1], triangles[offset + 2]];
    for (const index of triangle) {
      if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
        throw new Error(`Muscle shape triangle index ${String(index)} is outside the vertex array`);
      }
    }
    for (let edge = 0; edge < 3; edge += 1) {
      const a = Math.min(triangle[edge], triangle[(edge + 1) % 3]);
      const b = Math.max(triangle[edge], triangle[(edge + 1) % 3]);
      edges.add(`${a}:${b}`);
    }
  }
  const edgeLength = (positions, a, b) => Math.hypot(
    positions[b * 3] - positions[a * 3],
    positions[b * 3 + 1] - positions[a * 3 + 1],
    positions[b * 3 + 2] - positions[a * 3 + 2],
  );
  const strains = [];
  for (const key of edges) {
    const [a, b] = key.split(':').map(Number);
    const restLength = edgeLength(restPositions, a, b);
    const posedLength = edgeLength(posedPositions, a, b);
    if (!(restLength > 1e-12) || !(posedLength > 1e-12)) {
      throw new Error(`Muscle shape edge ${a}:${b} is degenerate`);
    }
    strains.push(Math.abs(Math.log(posedLength / restLength)));
  }
  strains.sort((a, b) => a - b);
  const q95Index = Math.max(0, Math.ceil(strains.length * 0.95) - 1);
  return {
    edgeCount: strains.length,
    q95AbsLogEdgeStrain: strains[q95Index] ?? 0,
    maxAbsLogEdgeStrain: strains.at(-1) ?? 0,
  };
}

export function attachProxyRigTransformControl(controls, transformControls, control, visible) {
  transformControls.detach();
  transformControls.attach(control);
  transformControls.setMode('rotate');
  setProxyRigControlVisibility(controls, transformControls, visible);
}

export function restoreProxyPoseRunFromStorage({
  storageProvider,
  storage,
  key,
  packageId,
  knownControls = null,
}) {
  try {
    const effectiveStorage = storageProvider ? storageProvider() : storage;
    const serialized = effectiveStorage.getItem(key);
    const poseRun = serialized === null ? null : JSON.parse(serialized);
    if (poseRun) sampleProxyPoseRun(poseRun, 0, {
      expectedPackageId: packageId,
      knownControls,
    });
    return { poseRun, storageError: null };
  } catch (error) {
    const storageError = error?.message || String(error);
    try {
      const effectiveStorage = storageProvider ? storageProvider() : storage;
      effectiveStorage?.removeItem?.(key);
    } catch {
      // Storage denial is a degraded persistence path, not a live-rig failure.
    }
    return { poseRun: null, storageError };
  }
}

export function createProxyRigLiveHost({
  THREE,
  scene,
  camera,
  orbitControls,
  transformControls,
  renderer,
  markDirty,
  setInfo,
}) {
  const state = {
    status: 'idle',
    requestedPackagePath: null,
    effectivePackagePath: null,
    packageId: null,
    runtimeSchema: PROXY_RIG_RUNTIME_SCHEMA,
    source: null,
    evaluator: null,
    root: null,
    mesh: null,
    ghost: null,
    muscleMeshes: new Map(),
    muscleMaxDisplacements: {},
    muscleShapeChanges: {},
    musclesVisible: true,
    controls: new Map(),
    controlsVisible: true,
    selectedControl: null,
    frameCount: 0,
    lastEvaluationMs: null,
    maxDisplacement: 0,
    recording: null,
    poseRun: null,
    replayFrame: null,
    replayStartedAt: null,
    error: null,
    storageError: null,
  };
  const panel = document.getElementById('proxy-rig-live-controls');
  const controlSelect = document.getElementById('proxy-rig-control-select');
  const recordButton = document.getElementById('proxy-rig-record-button');
  const replayButton = document.getElementById('proxy-rig-replay-button');
  const stopButton = document.getElementById('proxy-rig-stop-button');
  const statusElement = document.getElementById('proxy-rig-live-status');
  const ghostToggle = document.getElementById('proxy-rig-ghost-toggle');
  const muscleToggle = document.getElementById('proxy-rig-muscle-toggle');
  const renderIdentity = proxyRigRenderIdentity(THREE, renderer);

  function debugState() {
    return {
      status: state.status,
      requestedPackagePath: state.requestedPackagePath,
      effectivePackagePath: state.effectivePackagePath,
      packageId: state.packageId,
      runtimeSchema: state.runtimeSchema,
      source: state.source ? { ...state.source } : null,
      controls: [...state.controls.keys()],
      hierarchy: state.evaluator?.groups.map(group => ({ name: group.name, parent: group.parent })) ?? [],
      muscles: state.evaluator?.muscles.map(proxyRigMuscleOverlayDescriptor) ?? [],
      musclesVisible: state.musclesVisible,
      muscleMaxDisplacements: { ...state.muscleMaxDisplacements },
      muscleShapeChanges: Object.fromEntries(Object.entries(state.muscleShapeChanges).map(
        ([relationId, diagnostic]) => [relationId, { ...diagnostic }],
      )),
      controlWorldPositions: Object.fromEntries([...state.controls].map(([name, control]) => [
        name,
        control.getWorldPosition(new THREE.Vector3()).toArray(),
      ])),
      controlQuaternions: Object.fromEntries([...state.controls].map(([name, control]) => [
        name,
        control.quaternion.toArray(),
      ])),
      controlsVisible: state.controlsVisible,
      transformHelperVisible: transformControls.getHelper?.().visible ?? transformControls.visible,
      selectedControl: state.selectedControl,
      selectedControlKind: state.controls.get(state.selectedControl)?.userData.controlKind ?? null,
      transformTargetName: [...state.controls]
        .find(([, control]) => control === transformControls.object)?.[0] ?? null,
      cameraPosition: camera.position.toArray(),
      orbitTarget: orbitControls.target.toArray(),
      comparisonCandidate: state.source?.comparisonCandidate
        ? { ...state.source.comparisonCandidate }
        : null,
      skeletalSupportSegmentCount: countVisibleProxyRigSupportSegments(state.root),
      frameCount: state.frameCount,
      lastEvaluationMs: state.lastEvaluationMs,
      maxDisplacement: state.maxDisplacement,
      recording: !!state.recording,
      recordedFrames: state.recording?.frames.length ?? state.poseRun?.frames.length ?? 0,
      replaying: state.replayFrame !== null,
      error: state.error,
      storageError: state.storageError,
      ...renderIdentity,
    };
  }

  function updateUi() {
    if (!panel) return;
    panel.hidden = state.status === 'idle';
    panel.dataset.status = state.status;
    recordButton?.classList.toggle('recording', !!state.recording);
    if (recordButton) recordButton.textContent = state.recording ? 'Finish' : 'Record';
    if (replayButton) replayButton.disabled = !state.poseRun || !!state.recording;
    if (stopButton) stopButton.disabled = state.replayFrame === null;
    if (muscleToggle) muscleToggle.disabled = state.muscleMeshes.size === 0;
    if (statusElement) {
      statusElement.classList.toggle('error', state.status === 'error');
      statusElement.textContent = state.status === 'error'
        ? state.error
        : `${state.selectedControl || 'no control'} | ${state.muscleMeshes.size ? [...state.muscleMeshes.keys()].join(', ') : 'no muscle'} | ${shortId(state.packageId)} | ${state.lastEvaluationMs?.toFixed(1) ?? '-'} ms`;
    }
  }

  function dispose() {
    if (state.replayFrame !== null) cancelAnimationFrame(state.replayFrame);
    transformControls.detach();
    if (state.root) {
      state.root.traverse(object => {
        object.geometry?.dispose?.();
        if (Array.isArray(object.material)) object.material.forEach(material => material.dispose?.());
        else object.material?.dispose?.();
      });
      scene.remove(state.root);
    }
    Object.assign(state, {
      status: 'idle',
      effectivePackagePath: null,
      packageId: null,
      source: null,
      evaluator: null,
      root: null,
      mesh: null,
      ghost: null,
      muscleMeshes: new Map(),
      muscleMaxDisplacements: {},
      muscleShapeChanges: {},
      musclesVisible: true,
      controls: new Map(),
      controlsVisible: true,
      selectedControl: null,
      frameCount: 0,
      lastEvaluationMs: null,
      maxDisplacement: 0,
      recording: null,
      poseRun: null,
      replayFrame: null,
      replayStartedAt: null,
      error: null,
      storageError: null,
    });
    updateUi();
  }

  function poseStorageKey() {
    return `${POSE_STORAGE_PREFIX}${state.packageId}`;
  }

  function restorePoseRun() {
    const restored = restoreProxyPoseRunFromStorage({
      storageProvider: () => localStorage,
      key: poseStorageKey(),
      packageId: state.packageId,
      knownControls: [...state.controls.keys()],
    });
    state.poseRun = restored.poseRun;
    state.storageError = restored.storageError;
    if (restored.storageError) {
      console.warn(`Proxy pose persistence is unavailable; the in-memory assay remains live: ${restored.storageError}`);
    }
  }

  function selectControl(name) {
    const control = state.controls.get(name);
    if (!control || state.status !== 'live') return false;
    state.selectedControl = name;
    for (const [controlName, object] of state.controls) {
      object.userData.handle.material.emissiveIntensity = controlName === name ? 1.2 : 0.25;
      object.userData.handle.scale.setScalar(controlName === name ? 1.35 : 1);
    }
    if (controlSelect) controlSelect.value = name;
    attachProxyRigTransformControl(
      state.controls.values(),
      transformControls,
      control,
      state.controlsVisible,
    );
    setInfo(`Proxy control: ${name}`);
    updateUi();
    markDirty();
    return true;
  }

  function applyPose(pose) {
    for (const name of Object.keys(pose)) {
      if (!state.controls.has(name)) throw new Error(`unknown pose control ${name}`);
    }
    for (const [name, control] of state.controls) {
      const quaternion = pose[name]?.quaternion ?? [0, 0, 0, 1];
      control.quaternion.fromArray(quaternion).normalize();
    }
    evaluate(false);
  }

  function evaluate(capture = true) {
    if (!state.evaluator || !state.mesh) return null;
    const pose = castPose(state.controls);
    const startedAt = performance.now();
    const result = state.evaluator.evaluate(pose);
    state.lastEvaluationMs = performance.now() - startedAt;
    state.mesh.geometry.attributes.position.array.set(result.positions);
    state.mesh.geometry.attributes.position.needsUpdate = true;
    state.mesh.geometry.computeVertexNormals();
    for (const muscle of result.muscles ?? []) {
      const mesh = state.muscleMeshes.get(muscle.relationId);
      if (!mesh) continue;
      mesh.geometry.attributes.position.array.set(muscle.positions);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
      const restMuscle = state.evaluator.muscles.find(candidate => candidate.relationId === muscle.relationId);
      state.muscleMaxDisplacements[muscle.relationId] = proxyRigMaximumVertexDisplacement(
        restMuscle.positions,
        muscle.positions,
      );
      state.muscleShapeChanges[muscle.relationId] = proxyRigMuscleShapeChange(
        restMuscle.positions,
        muscle.positions,
        muscle.triangles,
      );
    }
    let maxDisplacement = 0;
    const rest = state.evaluator.cast.positions;
    for (let i = 0; i < result.positions.length; i += 3) {
      maxDisplacement = Math.max(maxDisplacement, Math.hypot(
        result.positions[i] - rest[i],
        result.positions[i + 1] - rest[i + 1],
        result.positions[i + 2] - rest[i + 2],
      ));
    }
    state.maxDisplacement = maxDisplacement;
    state.frameCount += 1;
    if (capture && state.recording) {
      state.recording.frames.push({
        tMs: performance.now() - state.recording.startedAt,
        pose,
      });
    }
    updateUi();
    markDirty();
    return result;
  }

  function reset(selectedOnly = false) {
    if (selectedOnly && state.selectedControl) {
      state.controls.get(state.selectedControl)?.quaternion.identity();
    } else {
      for (const control of state.controls.values()) control.quaternion.identity();
    }
    evaluate();
  }

  function beginRecording() {
    stopReplay();
    state.recording = {
      startedAt: performance.now(),
      frames: [{ tMs: 0, pose: castPose(state.controls) }],
    };
    updateUi();
  }

  function finishRecording() {
    if (!state.recording) return null;
    const finalFrame = {
      tMs: performance.now() - state.recording.startedAt,
      pose: castPose(state.controls),
    };
    if (finalFrame.tMs > state.recording.frames.at(-1).tMs) state.recording.frames.push(finalFrame);
    state.poseRun = createProxyPoseRun({
      packageId: state.packageId,
      frames: state.recording.frames,
      knownControls: [...state.controls.keys()],
    });
    state.recording = null;
    try {
      localStorage.setItem(poseStorageKey(), JSON.stringify(state.poseRun));
      state.storageError = null;
    } catch (error) {
      state.storageError = error?.message || String(error);
      console.warn('Proxy pose run remains available in memory; persistence failed:', error);
    }
    updateUi();
    return state.poseRun;
  }

  function stopReplay() {
    if (state.replayFrame !== null) cancelAnimationFrame(state.replayFrame);
    state.replayFrame = null;
    state.replayStartedAt = null;
    updateUi();
  }

  function replay() {
    if (!state.poseRun || state.recording) return false;
    stopReplay();
    const duration = Math.max(1, state.poseRun.frames.at(-1).tMs);
    state.replayStartedAt = performance.now();
    const tick = now => {
      const elapsed = now - state.replayStartedAt;
      applyPose(sampleProxyPoseRun(state.poseRun, Math.min(elapsed, duration), {
        expectedPackageId: state.packageId,
        knownControls: [...state.controls.keys()],
      }));
      if (elapsed < duration) state.replayFrame = requestAnimationFrame(tick);
      else stopReplay();
    };
    state.replayFrame = requestAnimationFrame(tick);
    updateUi();
    return true;
  }

  async function load(requestedPath, { carryState = null } = {}) {
    dispose();
    state.status = 'loading';
    state.requestedPackagePath = requestedPath;
    updateUi();
    try {
      const response = await fetch(requestedPath, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Proxy rig load failed (${response.status}) for ${requestedPath}`);
      const packageData = await response.json();
      await verifyProxyRigPackageIdentity(packageData);
      state.evaluator = createProxyRigEvaluator(packageData);
      state.packageId = state.evaluator.packageId;
      state.runtimeSchema = state.evaluator.runtimeSchema;
      state.source = state.evaluator.source;
      state.effectivePackagePath = response.url;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(state.evaluator.cast.positions), 3));
      geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(state.evaluator.cast.triangles), 1));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color: 0xd6b98c,
        roughness: 0.72,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      state.mesh = new THREE.Mesh(geometry, material);
      state.mesh.castShadow = true;
      state.mesh.receiveShadow = true;
      state.mesh.name = 'Proxy rig posed cast';

      const ghostMaterial = new THREE.MeshBasicMaterial({
        color: 0x56a6b4,
        transparent: true,
        opacity: 0.12,
        wireframe: true,
        depthWrite: false,
      });
      state.ghost = new THREE.Mesh(geometry.clone(), ghostMaterial);
      state.ghost.name = 'Proxy rig rest ghost';

      state.root = new THREE.Group();
      state.root.name = `Proxy rig ${state.packageId}`;
      if (state.source?.comparisonFrame?.frame === 'frozen-envelope-baseline') {
        const displayRotation = new THREE.Matrix4().set(
          0, 0, -1, 0,
          0, -1, 0, 0,
          -1, 0, 0, 0,
          0, 0, 0, 1,
        );
        state.root.quaternion.setFromRotationMatrix(displayRotation);
      }
      state.root.add(state.ghost, state.mesh);
      state.evaluator.muscles.forEach((muscle, index) => {
        const muscleGeometry = new THREE.BufferGeometry();
        muscleGeometry.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(muscle.positions), 3));
        muscleGeometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(muscle.triangles), 1));
        muscleGeometry.computeVertexNormals();
        const color = [0xd43f58, 0xe46755, 0xc93f7a][index % 3];
        const muscleMaterial = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.24,
          roughness: 0.46,
          metalness: 0,
          transparent: true,
          opacity: 0.88,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        const muscleMesh = new THREE.Mesh(muscleGeometry, muscleMaterial);
        muscleMesh.name = `Live generated ${muscle.relationId}`;
        muscleMesh.renderOrder = 10;
        state.muscleMeshes.set(muscle.relationId, muscleMesh);
        state.root.add(muscleMesh);
      });
      const bounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      const center = bounds.getCenter(new THREE.Vector3());
      const diagonal = Math.max(1e-9, bounds.getSize(new THREE.Vector3()).length());
      const displayScale = 2.2 / diagonal;
      const handleGeometry = new THREE.OctahedronGeometry(diagonal * 0.018, 0);
      const colors = [0x58c9d4, 0xe2bd59, 0xe97874, 0x8bd177, 0x9b83df, 0xef8ac3, 0xf09655];
      state.evaluator.groups.forEach((group, index) => {
        const control = new THREE.Object3D();
        control.name = `Proxy control ${group.name}`;
        control.userData.controlKind = 'skeletal-support';
        const handleMaterial = new THREE.MeshStandardMaterial({
          color: colors[index % colors.length],
          emissive: colors[index % colors.length],
          emissiveIntensity: 0.25,
          roughness: 0.38,
          depthTest: false,
        });
        const handle = new THREE.Mesh(handleGeometry, handleMaterial);
        handle.renderOrder = 12;
        handle.userData.proxyRigControlName = group.name;
        handle.userData.controlKind = 'skeletal-support';
        control.userData.handle = handle;
        control.userData.proxyRigControlName = group.name;
        control.add(handle);
        state.controls.set(group.name, control);
      });
      for (const group of state.evaluator.groups) {
        const control = state.controls.get(group.name);
        if (group.parent) {
          const parent = state.controls.get(group.parent);
          control.position.fromArray(group.pivot).sub(new THREE.Vector3().fromArray(
            state.evaluator.groups.find(candidate => candidate.name === group.parent).pivot,
          ));
          const segmentGeometry = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(0, 0, 0),
            control.position.clone(),
          ]);
          const segmentMaterial = new THREE.LineBasicMaterial({
            color: 0x8fb8bf,
            transparent: true,
            opacity: 0.72,
            depthTest: false,
          });
          const segment = new THREE.Line(segmentGeometry, segmentMaterial);
          segment.name = `Skeletal support ${group.parent} -> ${group.name}`;
          segment.renderOrder = 11;
          segment.userData.controlKind = 'skeletal-support-segment';
          parent.add(segment);
          parent.add(control);
        } else {
          control.position.fromArray(group.pivot);
          state.root.add(control);
        }
      }
      state.root.scale.setScalar(displayScale);
      state.root.position.copy(center)
        .applyQuaternion(state.root.quaternion)
        .multiplyScalar(-displayScale);
      scene.add(state.root);
      if (carryState) {
        camera.position.fromArray(carryState.cameraPosition);
        orbitControls.target.fromArray(carryState.orbitTarget);
      } else {
        camera.position.set(0.25, 0.7, 3.15);
        orbitControls.target.set(0, 0, 0);
      }
      orbitControls.update();

      if (controlSelect) {
        controlSelect.replaceChildren(...[...state.controls.keys()].map(name => {
          const descriptor = proxyRigControlOptionDescriptor(name);
          const option = document.createElement('option');
          option.value = descriptor.value;
          option.textContent = descriptor.label;
          option.title = descriptor.title;
          return option;
        }));
      }
      state.status = 'live';
      restorePoseRun();
      const transferredPose = carryState
        ? transferProxyRigComparisonPose(carryState.pose, [...state.controls.keys()])
        : null;
      const initialControl = carryState?.selectedControl ?? chooseProxyRigInitialControlName(
        [...state.controls.keys()], state.evaluator.interaction?.initialControl,
      );
      if (!initialControl) {
        throw new Error(`Proxy rig interaction initial control ${String(
          state.evaluator.interaction?.initialControl,
        )} is unavailable`);
      }
      selectControl(initialControl);
      if (transferredPose) applyPose(transferredPose);
      else evaluate(false);
      setInfo(`Live proxy rig: ${shortId(state.packageId)}`);
      updateUi();
      return debugState();
    } catch (error) {
      state.status = 'error';
      state.error = error?.message || String(error);
      console.error('Proxy rig route failed:', error);
      setInfo(state.error);
      updateUi();
      throw error;
    }
  }

  function switchPackage(requestedPath) {
    if (state.status !== 'live') throw new Error('Proxy rig package switching requires a live source package');
    if (state.recording) throw new Error('Finish the active pose recording before switching cast candidates');
    stopReplay();
    const carryState = createProxyRigComparisonCarryState({
      pose: castPose(state.controls),
      selectedControl: state.selectedControl,
      cameraPosition: camera.position.toArray(),
      orbitTarget: orbitControls.target.toArray(),
    });
    return load(requestedPath, { carryState });
  }

  function pickControl(event) {
    if (state.status !== 'live' || !state.root) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const handles = [...state.controls.values()].map(control => control.userData.handle);
    return raycaster.intersectObjects(handles, false)[0]?.object?.userData?.proxyRigControlName ?? null;
  }

  controlSelect?.addEventListener('change', () => selectControl(controlSelect.value));
  document.getElementById('proxy-rig-reset-selected')?.addEventListener('click', () => reset(true));
  document.getElementById('proxy-rig-reset-all')?.addEventListener('click', () => reset(false));
  recordButton?.addEventListener('click', () => state.recording ? finishRecording() : beginRecording());
  replayButton?.addEventListener('click', replay);
  stopButton?.addEventListener('click', stopReplay);
  ghostToggle?.addEventListener('change', () => {
    if (state.ghost) state.ghost.visible = ghostToggle.checked;
    markDirty();
  });
  muscleToggle?.addEventListener('change', () => {
    state.musclesVisible = muscleToggle.checked;
    setProxyRigMuscleVisibility(state.muscleMeshes.values(), state.musclesVisible);
    markDirty();
  });

  return {
    load,
    switchPackage,
    dispose,
    selectControl,
    pickControl,
    transformTarget: () => resolveProxyRigTransformTarget(state.controls, state.selectedControl),
    handleControlChange: () => evaluate(true),
    isActive: () => state.status === 'live',
    debugState,
    reset,
    beginRecording,
    finishRecording,
    replay,
    stopReplay,
    setControlVisibility(visible) {
      state.controlsVisible = Boolean(visible);
      setProxyRigControlVisibility(state.controls.values(), transformControls, state.controlsVisible);
      markDirty();
    },
    setControlQuaternion(name, quaternion) {
      const control = state.controls.get(name);
      if (!control) throw new Error(`Unknown proxy control: ${name}`);
      control.quaternion.fromArray(quaternion).normalize();
      evaluate(true);
      return debugState();
    },
  };
}
