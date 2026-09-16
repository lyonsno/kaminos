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
  // Canonical bindings are sealed: a bound ref cannot be silently replaced.
  // The at-cap review demonstrated a duplicate registration swapping the
  // Kimodo validator for a permissive one through this public API.
  if (laws.has(ref) && laws.get(ref) !== validator) {
    throw new Error(`artifact law ${ref} is already registered — canonical bindings are sealed`);
  }
  laws.set(ref, validator);
  return ref;
}

export function requireArtifactLaw(routeId, id, version) {
  const ref = artifactLawRef({ id, version });
  if (typeof routeId !== 'string' || routeId.length === 0 || !ref) {
    throw new Error('artifact law requirement needs a routeId and a valid law descriptor');
  }
  // Requirements are sealed too: re-pointing a route to a different law is
  // an authority mutation; idempotent same-ref re-registration is lawful.
  const existing = requirements.get(routeId);
  if (existing && existing !== ref) {
    throw new Error(`route ${routeId} already requires artifact law ${existing} — requirements are sealed`);
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

/**
 * The single authority-side resolution: what law ACTUALLY governs this
 * route object. Requirement-first — a registry requirement for the route id
 * outranks whatever descriptor the object carries (a carried mismatch is an
 * error, not a substitution), so a hand-built lawless or wrong-law route
 * cannot bypass a required law. Returns { validator, ref, errors }; any
 * error means no validator and no authority.
 */
export function resolveEffectiveLaw(route) {
  const routeId = typeof route?.routeId === 'string' ? route.routeId : null;
  const requiredRef = routeId ? requirements.get(routeId) ?? null : null;
  const carriedRef = artifactLawRef(route?.outputArtifactLaw);
  const errors = [];
  let ref = null;
  if (requiredRef) {
    if (route?.outputArtifactLaw != null && !carriedRef) {
      errors.push('outputArtifactLaw must be { id, version } when present');
    } else if (carriedRef && carriedRef !== requiredRef) {
      errors.push(`route ${routeId} requires artifact law ${requiredRef} but the supplied route carries ${carriedRef}`);
    }
    ref = requiredRef;
  } else if (route?.outputArtifactLaw != null) {
    if (!carriedRef) errors.push('outputArtifactLaw must be { id, version } when present');
    ref = carriedRef;
  }
  let validator = null;
  if (errors.length === 0 && ref) {
    validator = laws.get(ref) ?? null;
    if (!validator) errors.push(`artifact law ${ref} is not registered in this runtime — cannot verify, cannot authorize`);
  }
  return { validator: errors.length === 0 ? validator : null, ref, errors };
}
