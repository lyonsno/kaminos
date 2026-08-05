export async function captureExactTargetFrame({
  prototype,
  basinWindow,
  fixedCameraPose,
  targetRaySteps,
  targetMode,
  stateId,
  exactStateTimeMs,
  baseFrameCount,
  baseSimStepCount,
  environment = globalThis,
}) {
  const before = prototype.debugState();
  const priorRaySteps = before.controls?.raySteps;
  const priorAppearanceMode = before.appearanceDecompositionModeRequestedRaw ?? before.appearanceDecompositionModeRequested ?? 'off';
  const priorSmokeMode = before.raymarchSmokePresentationModeRequestedRaw ?? before.raymarchSmokePresentationModeRequested ?? 'on';
  let result = null;
  let sample = null;
  let appearanceRestore = null;
  let smokeRestore = null;
  try {
    basinWindow.kaminosSetCameraDebugPose(fixedCameraPose);
    prototype.setControls({ raySteps: targetRaySteps });
    const appearance = prototype.setAppearanceDecompositionMode(targetMode);
    const smoke = prototype.setRaymarchSmokePresentationMode('off');
    sample = await prototype.sampleFrame({
      advanceSim: false,
      includeRgba: true,
      now: exactStateTimeMs,
      sameStateCaptureId: stateId,
      baseFrameCount,
      baseSimStepCount,
    });
    if (!sample?.ok) {
      throw new Error('exact-target-sample-failed:' + (sample?.reason || 'unknown') + ':' + JSON.stringify({
        active: sample?.active ?? null,
        validationError: sample?.validationError ?? null,
        width: sample?.width ?? null,
        height: sample?.height ?? null,
      }));
    }
    if (!sample.image?.rgba?.length) {
      throw new Error('exact-target-rgba-missing:' + JSON.stringify({
        width: sample.image?.width ?? sample.width ?? null,
        height: sample.image?.height ?? sample.height ?? null,
        imagePresent: Boolean(sample.image),
      }));
    }
    const rgba = Uint8Array.from(sample.image.rgba);
    let litPixels = 0;
    for (let index = 0; index < rgba.length; index += 4) {
      if (0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2] > 8) litPixels += 1;
    }
    if (litPixels <= 64) {
      throw new Error('exact-target-blank-image:' + JSON.stringify({
        litPixels,
        pixelCount: rgba.length / 4,
        width: sample.image.width,
        height: sample.image.height,
      }));
    }
    const hash = await environment.crypto.subtle.digest('SHA-256', rgba);
    const targetPixelSha256 = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    const canvas = environment.document.createElement('canvas');
    canvas.width = sample.image.width;
    canvas.height = sample.image.height;
    canvas.getContext('2d').putImageData(new environment.ImageData(new Uint8ClampedArray(rgba), canvas.width, canvas.height), 0, 0);
    result = {
      stateId,
      imageAuthority: 'gpu-rgba8-readback-frozen-sim-state-v0',
      nativeReadbackFailure: null,
      frameCount: sample.frameCount,
      simStepCount: sample.simStepCount,
      width: sample.image.width,
      height: sample.image.height,
      litPixels,
      targetPixelSha256,
      pngDataUrl: canvas.toDataURL('image/png'),
      cameraPose: basinWindow.kaminosCameraDebugState(),
      appearance,
      smoke,
    };
  } finally {
    appearanceRestore = prototype.setAppearanceDecompositionMode(priorAppearanceMode);
    smokeRestore = prototype.setRaymarchSmokePresentationMode(priorSmokeMode);
    prototype.setControls({ raySteps: priorRaySteps });
  }
  const after = prototype.debugState();
  return {
    ...result,
    restoration: {
      priorRaySteps,
      effectiveRaySteps: after.controls?.raySteps ?? null,
      priorAppearanceMode,
      effectiveAppearanceMode: after.appearanceDecompositionModeRequestedRaw ?? after.appearanceDecompositionModeRequested ?? null,
      priorSmokeMode,
      effectiveSmokeMode: after.raymarchSmokePresentationModeRequestedRaw ?? after.raymarchSmokePresentationModeRequested ?? null,
      appearanceRestore,
      smokeRestore,
    },
    effectiveRoute: sample.effectiveRoute,
    backend: sample.backend,
    effectiveRaySteps: sample.volumePresentationReceipt?.effectiveRayQuality?.raySteps ?? sample.controls?.raySteps ?? null,
  };
}

export function isExactTargetBlankImageError(error) {
  const message = error?.message || String(error || '');
  return /(?:^|\n)(?:Error:\s*)?exact-target-blank-image:/.test(message);
}

export function hideExactTargetCaptureOverlays(environment = globalThis) {
  const selectors = ['#toolbar'];
  const entries = selectors.map(selector => {
    const element = environment.document.querySelector(selector);
    if (!element) return { selector, present: false, priorVisibility: null, priorPriority: null };
    const priorVisibility = element.style.getPropertyValue('visibility');
    const priorPriority = element.style.getPropertyPriority('visibility');
    element.style.setProperty('visibility', 'hidden', 'important');
    return { selector, present: true, priorVisibility, priorPriority };
  });
  return {
    identity: 'exact-target-visible-canvas-overlay-isolation-v0',
    entries,
  };
}

export function restoreExactTargetCaptureOverlays(receipt, environment = globalThis) {
  let expectedCount = 0;
  let restoredCount = 0;
  for (const entry of receipt?.entries || []) {
    if (!entry.present) continue;
    expectedCount += 1;
    const element = environment.document.querySelector(entry.selector);
    if (!element) continue;
    element.style.setProperty('visibility', entry.priorVisibility || '', entry.priorPriority || '');
    restoredCount += 1;
  }
  return {
    identity: receipt?.identity || null,
    expectedCount,
    restoredCount,
    restored: restoredCount === expectedCount,
  };
}

export async function renderExactTargetFrameToVisibleCanvas({
  prototype,
  basinWindow,
  fixedCameraPose,
  targetRaySteps,
  targetMode,
  stateId,
  exactStateTimeMs,
  baseFrameCount,
  baseSimStepCount,
}) {
  const before = prototype.debugState();
  const priorRaySteps = before.controls?.raySteps;
  const priorAppearanceMode = before.appearanceDecompositionModeRequestedRaw ?? before.appearanceDecompositionModeRequested ?? 'off';
  const priorSmokeMode = before.raymarchSmokePresentationModeRequestedRaw ?? before.raymarchSmokePresentationModeRequested ?? 'on';
  let result = null;
  let appearanceRestore = null;
  let smokeRestore = null;
  try {
    basinWindow.kaminosSetCameraDebugPose(fixedCameraPose);
    prototype.setControls({ raySteps: targetRaySteps });
    const appearance = prototype.setAppearanceDecompositionMode(targetMode);
    const smoke = prototype.setRaymarchSmokePresentationMode('off');
    const render = await prototype.renderFrozenScaleToCanvas({
      renderScale: 1,
      boundarySplatComposition: 'raymarch-only-v0',
      includeRgba: false,
      now: exactStateTimeMs,
      sameStateCaptureId: stateId,
      baseFrameCount,
      baseSimStepCount,
      restoreControls: true,
      resumeRenderLoop: false,
    });
    const effective = prototype.debugState();
    result = {
      stateId,
      render,
      effectiveRaySteps: effective.controls?.raySteps ?? null,
      cameraPose: basinWindow.kaminosCameraDebugState(),
      appearance,
      smoke,
    };
  } finally {
    appearanceRestore = prototype.setAppearanceDecompositionMode(priorAppearanceMode);
    smokeRestore = prototype.setRaymarchSmokePresentationMode(priorSmokeMode);
    prototype.setControls({ raySteps: priorRaySteps });
  }
  const after = prototype.debugState();
  return {
    ...result,
    restoration: {
      priorRaySteps,
      effectiveRaySteps: after.controls?.raySteps ?? null,
      priorAppearanceMode,
      effectiveAppearanceMode: after.appearanceDecompositionModeRequestedRaw ?? after.appearanceDecompositionModeRequested ?? null,
      priorSmokeMode,
      effectiveSmokeMode: after.raymarchSmokePresentationModeRequestedRaw ?? after.raymarchSmokePresentationModeRequested ?? null,
      appearanceRestore,
      smokeRestore,
    },
  };
}
