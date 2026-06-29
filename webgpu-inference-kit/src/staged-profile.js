const PROFILE_SCHEMA = 'kaminos.webgpu-staged-profile.v0';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function roundMs(value) {
  return Math.round(value * 10) / 10;
}

export function createStagedSubmitProfile(input = {}) {
  return {
    schema: PROFILE_SCHEMA,
    route: input.route || 'staged-submits',
    timingSource: input.timingSource || 'queue-submit-wait',
    timestampQueryValidatedAgainstStaged: !!input.timestampQueryValidatedAgainstStaged,
    requiredStages: Array.isArray(input.requiredStages) ? [...input.requiredStages] : [],
    stages: [],
  };
}

export function addStagedSubmitStage(profile, stage) {
  if (!profile || typeof profile !== 'object') throw new Error('profile must be an object');
  if (!isNonEmptyString(stage?.name)) throw new Error('stage.name must be a non-empty string');
  if (!Number.isFinite(stage.ms) || stage.ms < 0) throw new Error('stage.ms must be a finite non-negative number');
  if (!Array.isArray(profile.stages)) profile.stages = [];

  profile.stages.push({
    name: stage.name,
    ms: roundMs(stage.ms),
    shape: Array.isArray(stage.shape) ? [...stage.shape] : undefined,
    metadata: stage.metadata ? JSON.parse(JSON.stringify(stage.metadata)) : undefined,
  });
  return profile;
}

export function finishStagedSubmitProfile(profile) {
  if (!profile || typeof profile !== 'object') throw new Error('profile must be an object');
  const stages = Array.isArray(profile.stages) ? profile.stages : [];
  const totalMs = roundMs(stages.reduce((sum, stage) => sum + (Number.isFinite(stage.ms) ? stage.ms : 0), 0));

  return {
    ...profile,
    schema: profile.schema || PROFILE_SCHEMA,
    stages,
    stageNames: stages.map(stage => stage.name),
    totalMs,
  };
}

export function validateStagedSubmitProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== 'object') {
    return { ok: false, errors: ['profile must be an object'] };
  }
  if (profile.schema !== PROFILE_SCHEMA) errors.push(`schema must be ${PROFILE_SCHEMA}`);
  if (!isNonEmptyString(profile.route)) errors.push('route must be a non-empty string');
  if (!isNonEmptyString(profile.timingSource)) errors.push('timingSource must be a non-empty string');
  if (!Array.isArray(profile.stages) || profile.stages.length === 0) {
    errors.push('stages must be a non-empty array');
  }
  if (!Number.isFinite(profile.totalMs) || profile.totalMs < 0) {
    errors.push('totalMs must be a finite non-negative number');
  }

  const stageNames = new Set();
  if (Array.isArray(profile.stages)) {
    profile.stages.forEach((stage, index) => {
      if (!isNonEmptyString(stage.name)) errors.push(`stages[${index}].name must be a non-empty string`);
      if (!Number.isFinite(stage.ms) || stage.ms < 0) errors.push(`stages[${index}].ms must be a finite non-negative number`);
      if (isNonEmptyString(stage.name)) stageNames.add(stage.name);
    });
  }

  if (Array.isArray(profile.requiredStages)) {
    for (const required of profile.requiredStages) {
      if (!stageNames.has(required)) errors.push(`missing required stage ${required}`);
    }
  }

  if (profile.timingSource === 'timestamp-query' && profile.timestampQueryValidatedAgainstStaged !== true) {
    errors.push('timestamp-query profile must be validated against staged-submit timings');
  }

  return { ok: errors.length === 0, errors };
}
