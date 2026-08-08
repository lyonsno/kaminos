import {
  createProxyPoseRun,
  createProxyRigEvaluator,
  PROXY_RIG_RUNTIME_SCHEMA,
  sampleProxyPoseRun,
  verifyProxyRigPackageIdentity,
} from './proxy-rig-runtime.mjs';

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

export function attachProxyRigTransformControl(controls, transformControls, control, visible) {
  transformControls.detach();
  transformControls.attach(control);
  transformControls.setMode('rotate');
  setProxyRigControlVisibility(controls, transformControls, visible);
}

export function restoreProxyPoseRunFromStorage({ storageProvider, storage, key, packageId }) {
  try {
    const effectiveStorage = storageProvider ? storageProvider() : storage;
    const serialized = effectiveStorage.getItem(key);
    const poseRun = serialized === null ? null : JSON.parse(serialized);
    if (poseRun) sampleProxyPoseRun(poseRun, 0, { expectedPackageId: packageId });
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
      controlsVisible: state.controlsVisible,
      transformHelperVisible: transformControls.getHelper?.().visible ?? transformControls.visible,
      selectedControl: state.selectedControl,
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
    if (statusElement) {
      statusElement.classList.toggle('error', state.status === 'error');
      statusElement.textContent = state.status === 'error'
        ? state.error
        : `${state.selectedControl || 'no control'} | ${shortId(state.packageId)} | ${state.lastEvaluationMs?.toFixed(1) ?? '-'} ms`;
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
    state.poseRun = createProxyPoseRun({ packageId: state.packageId, frames: state.recording.frames });
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
      }));
      if (elapsed < duration) state.replayFrame = requestAnimationFrame(tick);
      else stopReplay();
    };
    state.replayFrame = requestAnimationFrame(tick);
    updateUi();
    return true;
  }

  async function load(requestedPath) {
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
      state.root.add(state.ghost, state.mesh);
      const bounds = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      const center = bounds.getCenter(new THREE.Vector3());
      const diagonal = Math.max(1e-9, bounds.getSize(new THREE.Vector3()).length());
      const displayScale = 2.2 / diagonal;
      const handleGeometry = new THREE.OctahedronGeometry(diagonal * 0.018, 0);
      const colors = [0x58c9d4, 0xe2bd59, 0xe97874, 0x8bd177, 0x9b83df, 0xef8ac3, 0xf09655];
      state.evaluator.groups.forEach((group, index) => {
        const control = new THREE.Object3D();
        control.name = `Proxy control ${group.name}`;
        control.position.fromArray(group.pivot);
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
        control.userData.handle = handle;
        control.userData.proxyRigControlName = group.name;
        control.add(handle);
        state.controls.set(group.name, control);
        state.root.add(control);
      });
      state.root.scale.setScalar(displayScale);
      state.root.position.copy(center).multiplyScalar(-displayScale);
      scene.add(state.root);
      camera.position.set(0.25, 0.7, 3.15);
      orbitControls.target.set(0, 0, 0);
      orbitControls.update();

      if (controlSelect) {
        controlSelect.replaceChildren(...[...state.controls.keys()].map(name => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          return option;
        }));
      }
      state.status = 'live';
      restorePoseRun();
      selectControl(state.controls.has('forelimb-right') ? 'forelimb-right' : state.controls.keys().next().value);
      evaluate(false);
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

  return {
    load,
    dispose,
    selectControl,
    pickControl,
    transformTarget: () => state.controls.get(state.selectedControl) ?? null,
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
