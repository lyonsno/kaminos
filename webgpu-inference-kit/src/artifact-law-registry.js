/**
 * Artifact-law registry: routes carry a SERIALIZABLE law descriptor
 * ({ id, version }) and the executable validator lives here, in trusted
 * local code. This keeps route definitions structured-cloneable and
 * JSON-round-trippable without their semantic law silently vanishing — a
 * definition that loses a required descriptor fails validation loudly, and
 * a descriptor that cannot be resolved never confers authority.
 *
 * A validator receives the output artifacts (array of role-tagged entries,
 * or a factory's keyed form) and returns { ok, errors }.
 */

const laws = new Map();          // 'id@version' -> validator fn
const requirements = new Map();  // routeId -> 'id@version'

export function artifactLawRef(law) {
  if (!law || typeof law !== 'object') return null;
  if (typeof law.id !== 'string' || law.id.length === 0) return null;
  if (!Number.isInteger(law.version) || law.version < 1) return null;
  return `${law.id}@${law.version}`;
}

export function registerArtifactLaw(id, version, validator) {
  const ref = artifactLawRef({ id, version });
  if (!ref) throw new Error('artifact law registration requires a non-empty id and positive integer version');
  if (typeof validator !== 'function') throw new Error('artifact law validator must be a function');
  laws.set(ref, validator);
  return ref;
}

export function requireArtifactLaw(routeId, id, version) {
  const ref = artifactLawRef({ id, version });
  if (typeof routeId !== 'string' || routeId.length === 0 || !ref) {
    throw new Error('artifact law requirement needs a routeId and a valid law descriptor');
  }
  requirements.set(routeId, ref);
  return ref;
}

export function requiredArtifactLawRef(routeId) {
  return requirements.get(routeId) ?? null;
}

export function resolveArtifactLaw(law) {
  const ref = artifactLawRef(law);
  if (!ref) return null;
  return laws.get(ref) ?? null;
}
