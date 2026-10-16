const DEFAULT_MIN_DWELL_SECONDS = 0.75;
const DEFAULT_SWITCH_MARGIN = 0;
const DEFAULT_MEMORY_SECONDS = 2;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFinitePoint(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    isFiniteNumber(value[0]) &&
    isFiniteNumber(value[1]) &&
    isFiniteNumber(value[2])
  );
}

function clonePoint(point) {
  return [point[0], point[1], point[2]];
}

function validateConfig(options) {
  const minDwellSeconds = options.minDwellSeconds ?? DEFAULT_MIN_DWELL_SECONDS;
  const switchMargin = options.switchMargin ?? DEFAULT_SWITCH_MARGIN;
  const defaultMemorySeconds = options.defaultMemorySeconds ?? DEFAULT_MEMORY_SECONDS;
  if (!isFiniteNumber(minDwellSeconds) || minDwellSeconds < 0) {
    throw new Error('minDwellSeconds must be a finite number >= 0');
  }
  if (!isFiniteNumber(switchMargin) || switchMargin < 0) {
    throw new Error('switchMargin must be a finite number >= 0');
  }
  if (!isFiniteNumber(defaultMemorySeconds) || defaultMemorySeconds < 0) {
    throw new Error('defaultMemorySeconds must be a finite number >= 0');
  }
  return {minDwellSeconds, switchMargin, defaultMemorySeconds};
}

function validateObservation(observation, seenIds) {
  if (observation === null || typeof observation !== 'object') {
    throw new Error('observation must be an object');
  }
  const {id, point, score, reason, memorySeconds} = observation;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('observation.id must be a nonempty string');
  }
  if (seenIds.has(id)) {
    throw new Error(`duplicate observation id: ${id}`);
  }
  seenIds.add(id);
  if (!isFinitePoint(point)) {
    throw new Error(`observation.point must be a finite three-component array (id: ${id})`);
  }
  if (!isFiniteNumber(score) || score < 0) {
    throw new Error(`observation.score must be a finite number >= 0 (id: ${id})`);
  }
  if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(`observation.reason must be a nonempty string (id: ${id})`);
  }
  if (memorySeconds !== undefined && (!isFiniteNumber(memorySeconds) || memorySeconds < 0)) {
    throw new Error(`observation.memorySeconds must be a finite number >= 0 when present (id: ${id})`);
  }
  return {
    id,
    point: clonePoint(point),
    score,
    reason,
    memorySeconds,
  };
}

function validateUpdateArgs(args, lastTime) {
  if (args === null || typeof args !== 'object') {
    throw new Error('update() requires an options object');
  }
  const {time, observations, invalidatedIds = []} = args;
  if (!isFiniteNumber(time)) {
    throw new Error('time must be a finite number');
  }
  if (lastTime !== null && time < lastTime) {
    throw new Error(`time must not move backward (got ${time}, last was ${lastTime}); use restore() to rewind`);
  }
  if (!Array.isArray(observations)) {
    throw new Error('observations must be an array');
  }
  if (!Array.isArray(invalidatedIds) || invalidatedIds.some((id) => typeof id !== 'string')) {
    throw new Error('invalidatedIds must be an array of strings');
  }
  const seenIds = new Set();
  const cleanObservations = observations.map((observation) => validateObservation(observation, seenIds));
  return {time, observations: cleanObservations, invalidatedIds: [...invalidatedIds]};
}

function cloneRemembered(remembered) {
  if (!remembered) return null;
  return {
    id: remembered.id,
    point: clonePoint(remembered.point),
    score: remembered.score,
    reason: remembered.reason,
    acquiredAt: remembered.acquiredAt,
    lastObservedAt: remembered.lastObservedAt,
    memorySeconds: remembered.memorySeconds,
  };
}

function toPublicFocus(remembered, time) {
  if (!remembered) return null;
  const expiresAt = remembered.lastObservedAt + remembered.memorySeconds;
  const isRemembered = time > remembered.lastObservedAt;
  return {
    id: remembered.id,
    point: clonePoint(remembered.point),
    reason: remembered.reason,
    remembered: isRemembered,
    acquiredAt: remembered.acquiredAt,
    lastObservedAt: remembered.lastObservedAt,
    expiresAt,
  };
}

export function createAttentionPolicy(options = {}) {
  if (options === null || typeof options !== 'object') {
    throw new Error('options must be an object');
  }
  const config = validateConfig(options);

  let current = null;
  let lastTime = null;

  function pickBest(observations) {
    let best = null;
    for (const observation of observations) {
      if (observation.score <= 0) continue;
      if (
        best === null ||
        observation.score > best.score ||
        (observation.score === best.score && observation.id < best.id)
      ) {
        best = observation;
      }
    }
    return best;
  }

  function scoreOf(id, observationsById) {
    const observation = observationsById.get(id);
    return observation ? observation.score : 0;
  }

  function applyUpdate({time, observations, invalidatedIds}) {
    const observationsById = new Map(observations.map((observation) => [observation.id, observation]));
    const invalidated = new Set(invalidatedIds);

    if (current && invalidated.has(current.id)) {
      current = null;
    }

    if (current) {
      const observedNow = observationsById.get(current.id);
      if (observedNow) {
        current = {
          ...current,
          point: clonePoint(observedNow.point),
          score: observedNow.score,
          reason: observedNow.reason,
          lastObservedAt: time,
          memorySeconds: observedNow.memorySeconds ?? config.defaultMemorySeconds,
        };
      } else {
        const expiresAt = current.lastObservedAt + current.memorySeconds;
        if (time >= expiresAt) {
          current = null;
        }
      }
    }

    const best = pickBest(observations);

    if (current === null) {
      if (best) {
        current = {
          id: best.id,
          point: clonePoint(best.point),
          score: best.score,
          reason: best.reason,
          acquiredAt: time,
          lastObservedAt: time,
          memorySeconds: best.memorySeconds ?? config.defaultMemorySeconds,
        };
      }
    } else if (best && best.id !== current.id) {
      const dwellElapsed = time - current.acquiredAt >= config.minDwellSeconds;
      const currentEffectiveScore = scoreOf(current.id, observationsById) > 0
        ? scoreOf(current.id, observationsById)
        : current.score;
      if (dwellElapsed && best.score > currentEffectiveScore + config.switchMargin) {
        current = {
          id: best.id,
          point: clonePoint(best.point),
          score: best.score,
          reason: best.reason,
          acquiredAt: time,
          lastObservedAt: time,
          memorySeconds: best.memorySeconds ?? config.defaultMemorySeconds,
        };
      }
    }

    lastTime = time;
  }

  return {
    update(args) {
      const validated = validateUpdateArgs(args, lastTime);
      applyUpdate(validated);
      return {focus: toPublicFocus(current, lastTime)};
    },

    read() {
      return {focus: toPublicFocus(current, lastTime ?? 0)};
    },

    snapshot() {
      return {
        config: {...config},
        current: cloneRemembered(current),
        lastTime,
      };
    },

    restore(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object') {
        throw new Error('restore() requires a snapshot object');
      }
      const {config: snapConfig, current: snapCurrent, lastTime: snapLastTime} = snapshot;
      if (snapConfig === null || typeof snapConfig !== 'object') {
        throw new Error('snapshot.config must be an object');
      }
      const validatedConfig = validateConfig(snapConfig);
      if (snapCurrent !== null && typeof snapCurrent !== 'object') {
        throw new Error('snapshot.current must be null or an object');
      }
      if (snapLastTime !== null && !isFiniteNumber(snapLastTime)) {
        throw new Error('snapshot.lastTime must be null or a finite number');
      }
      config.minDwellSeconds = validatedConfig.minDwellSeconds;
      config.switchMargin = validatedConfig.switchMargin;
      config.defaultMemorySeconds = validatedConfig.defaultMemorySeconds;
      current = cloneRemembered(snapCurrent);
      lastTime = snapLastTime;
    },

    reset() {
      current = null;
      lastTime = null;
    },
  };
}
