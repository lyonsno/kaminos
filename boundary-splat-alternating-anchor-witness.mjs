#!/usr/bin/env node

const NATURAL_AUTHORITY = 'exact-simulator-state-every-display-frame-v0';
const HOLD_AUTHORITY = 'prior-exact-even-anchor-byte-repeated-v0';
const CAUSAL_AUTHORITY = 'causal-one-step-prediction-from-prior-exact-anchor-v0';
const ORACLE_AUTHORITY = 'exact-target-support-world-position-offline-upper-bound-v0';
const INTERPOLATED_AUTHORITY = 'noncausal-exact-neighbor-interpolation-v0';

function sameArtifact(left, right) {
  return Boolean(
    left
    && right
    && left.path === right.path
    && left.bytes === right.bytes
    && left.sha256 === right.sha256
    && left.count === right.count
    && left.strideFloats === right.strideFloats
    && left.dtype === right.dtype
  );
}

function sameState(left, right) {
  return Boolean(
    left
    && right
    && sameArtifact(left.candidates, right.candidates)
    && sameArtifact(left.splats, right.splats)
  );
}

export function validateAlternatingPlayback(frameCount, controlledStepDeltaMs) {
  if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount % 2 !== 1) {
    throw new Error('alternating playback requires an odd frame count ending on an exact anchor');
  }
  if (
    !Number.isFinite(controlledStepDeltaMs)
    || controlledStepDeltaMs < 16
    || controlledStepDeltaMs > 17.5
  ) throw new Error('alternating playback requires truthful fine display cadence near 16.667 ms');
  const durationSeconds = ((frameCount - 1) * controlledStepDeltaMs) / 1000;
  if (durationSeconds < 4) throw new Error('alternating playback requires at least four seconds');
  return {
    frameCount,
    controlledStepDeltaMs,
    fps: 1000 / controlledStepDeltaMs,
    durationSeconds,
    minimumDurationSeconds: 4,
    frameCap: null,
  };
}

export function buildAlternatingRolePlan(manifestFrames, predictionFrames, oraclePairs) {
  if (
    !Array.isArray(manifestFrames)
    || !Array.isArray(predictionFrames)
    || manifestFrames.length < 3
    || manifestFrames.length % 2 !== 1
    || predictionFrames.length !== manifestFrames.length
  ) throw new Error('alternating role plan requires aligned odd-length exact and prediction sequences');
  const oracleByTarget = new Map(
    (oraclePairs || []).map(pair => [`${pair.sourceFrameId}->${pair.targetFrameId}`, pair]),
  );
  const plan = manifestFrames.map((exactState, displayFrameIndex) => {
    const predictionState = predictionFrames[displayFrameIndex];
    if (
      exactState?.controlledStepFrameIndex !== displayFrameIndex
      || predictionState?.displayFrameIndex !== displayFrameIndex
      || predictionState?.referenceFrameId !== exactState.id
    ) throw new Error('alternating role plan frame identity mismatch');
    if (displayFrameIndex % 2 === 0) {
      return {
        displayFrameIndex,
        referenceFrameId: exactState.id,
        exactState,
        priorExactAnchor: exactState,
        nextExactAnchor: exactState,
        natural: { authority: NATURAL_AUTHORITY, state: exactState },
        hold: { authority: HOLD_AUTHORITY, state: exactState },
        causal: { authority: CAUSAL_AUTHORITY, state: exactState, sourceFrameId: exactState.id },
        oracle: { authority: ORACLE_AUTHORITY, state: exactState },
        interpolated: { authority: INTERPOLATED_AUTHORITY, state: exactState, noncausal: false },
      };
    }
    const priorExactAnchor = manifestFrames[displayFrameIndex - 1];
    const nextExactAnchor = manifestFrames[displayFrameIndex + 1];
    const oraclePair = oracleByTarget.get(`${priorExactAnchor.id}->${exactState.id}`);
    if (!oraclePair?.oraclePredicted) {
      throw new Error(`alternating role plan lacks oracle pair ${priorExactAnchor.id}->${exactState.id}`);
    }
    return {
      displayFrameIndex,
      referenceFrameId: exactState.id,
      exactState,
      priorExactAnchor,
      nextExactAnchor,
      natural: { authority: NATURAL_AUTHORITY, state: exactState },
      hold: { authority: HOLD_AUTHORITY, state: priorExactAnchor },
      causal: {
        authority: CAUSAL_AUTHORITY,
        state: predictionState,
        sourceFrameId: predictionState.sourceFrameId,
      },
      oracle: { authority: ORACLE_AUTHORITY, state: oraclePair.oraclePredicted },
      interpolated: {
        authority: INTERPOLATED_AUTHORITY,
        left: priorExactAnchor,
        right: nextExactAnchor,
        fraction: 0.5,
        noncausal: true,
      },
    };
  });
  validateAlternatingRolePlan(plan);
  return plan;
}

export function validateAlternatingRolePlan(plan) {
  if (!Array.isArray(plan) || plan.length < 3 || plan.length % 2 !== 1) {
    throw new Error('alternating role plan must be a nonempty odd-length sequence');
  }
  for (let index = 0; index < plan.length; index += 1) {
    const row = plan[index];
    if (row?.displayFrameIndex !== index || row.referenceFrameId !== row.exactState?.id) {
      throw new Error('alternating role plan display identity mismatch');
    }
    if (row.natural?.authority !== NATURAL_AUTHORITY || !sameState(row.natural.state, row.exactState)) {
      throw new Error('natural full-rate control must bind the exact display-frame state');
    }
    if (row.hold?.authority !== HOLD_AUTHORITY || !sameState(row.hold.state, row.priorExactAnchor)) {
      throw new Error('hold control must byte-repeat the prior exact anchor');
    }
    if (row.causal?.authority !== CAUSAL_AUTHORITY) {
      throw new Error('causal role authority mismatch');
    }
    if (index % 2 === 1) {
      if (
        row.causal.sourceFrameId !== row.priorExactAnchor?.id
        || row.causal.state?.sourceFrameId !== row.priorExactAnchor?.id
      ) throw new Error('causal odd frame must source only the prior exact anchor');
      if (
        row.oracle?.authority !== ORACLE_AUTHORITY
        || row.interpolated?.authority !== INTERPOLATED_AUTHORITY
        || row.interpolated.left?.id !== row.priorExactAnchor?.id
        || row.interpolated.right?.id !== row.nextExactAnchor?.id
        || row.interpolated.fraction !== 0.5
        || row.interpolated.noncausal !== true
      ) throw new Error('offline comparison role authority mismatch');
    }
  }
  return plan;
}
