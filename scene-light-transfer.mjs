import { buildTriangleVisibility } from './scene-light-visibility.mjs';

const PI = Math.PI;
const BIAS = 1e-7;
const finite3 = (value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, scalar) => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
function unit(value, label) {
  if (!finite3(value)) throw new TypeError(`${label} must be a finite 3D vector`);
  const magnitude = length(value);
  if (magnitude === 0) throw new RangeError(`${label} must be nonzero`);
  return value.map((component) => component / magnitude);
}
function point(value, label) {
  if (!finite3(value)) throw new TypeError(`${label} must be a finite 3D position`);
  return value.slice();
}
function positive(value, label, allowZero = false) {
  if (!Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new RangeError(`${label} must be finite and ${allowZero ? 'nonnegative' : 'positive'}`);
  return value;
}
function rgb(value, label) {
  if (!finite3(value)) throw new TypeError(`${label} must be a finite RGB array`);
  return value.slice();
}
function keyed(entries) {
  return Object.fromEntries(entries.map(([id, value]) => [String(id), value]));
}
function assertUniqueIds(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (!(typeof value.id === 'string' || (typeof value.id === 'number' && Number.isFinite(value.id)))) {
      throw new TypeError(`${label} id must be a string or finite number`);
    }
    const id = String(value.id);
    if (seen.has(id)) throw new RangeError(`${label} ids must be unique: ${id}`);
    seen.add(id);
  }
}
function freezeTree(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeTree(child);
  return Object.freeze(value);
}
function assertFiniteTree(value, label) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError(`${label} produced a nonfinite coefficient`);
  if (value && typeof value === 'object') for (const child of Object.values(value)) assertFiniteTree(child, label);
}

export function createStaticLightTransfer({ triangles = [], surfaces = [], receivers = [], skyDirections = [], emitters = [] } = {}) {
  for (const [value, label] of [[surfaces, 'surfaces'], [receivers, 'receivers'], [skyDirections, 'skyDirections'], [emitters, 'emitters']]) {
    if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  }
  const checkedSurfaces = surfaces.map((surface, index) => {
    if (!surface || surface.id === undefined) throw new TypeError(`surface ${index} needs an id`);
    const albedo = rgb(surface.albedo, `surface ${String(surface.id)} albedo`);
    if (albedo.some((value) => value < 0)) throw new RangeError(`surface ${String(surface.id)} albedo must be nonnegative`);
    return { id: surface.id, position: point(surface.position, `surface ${String(surface.id)} position`), normal: unit(surface.normal, `surface ${String(surface.id)} normal`), area: positive(surface.area, `surface ${String(surface.id)} area`), albedo };
  });
  const checkedReceivers = receivers.map((receiver, index) => {
    if (!receiver || receiver.id === undefined) throw new TypeError(`receiver ${index} needs an id`);
    return { id: receiver.id, position: point(receiver.position, `receiver ${String(receiver.id)} position`), normal: receiver.normal === undefined ? null : unit(receiver.normal, `receiver ${String(receiver.id)} normal`) };
  });
  const checkedSky = skyDirections.map((sample, index) => {
    if (!sample) throw new TypeError(`sky direction ${index} is required`);
    return { direction: unit(sample.direction, `sky direction ${index}`), weight: positive(sample.weight, `sky direction ${index} weight`, true) };
  });
  const checkedEmitters = emitters.map((emitter, index) => {
    if (!emitter || emitter.id === undefined) throw new TypeError(`emitter ${index} needs an id`);
    return {
      id: emitter.id, position: point(emitter.position, `emitter ${String(emitter.id)} position`),
      normal: emitter.normal === undefined ? null : unit(emitter.normal, `emitter ${String(emitter.id)} normal`),
      area: emitter.area === undefined ? null : positive(emitter.area, `emitter ${String(emitter.id)} area`),
    };
  });
  assertUniqueIds(checkedSurfaces, 'surface');
  assertUniqueIds(checkedReceivers, 'receiver');
  const visibility = buildTriangleVisibility(triangles);
  let traceCount = 0;
  function visibleSegment(start, end) {
    const delta = sub(end, start);
    const distance = length(delta);
    if (distance <= BIAS * 2) return true;
    traceCount += 1;
    return visibility.trace(start, delta, { minDistance: BIAS, maxDistance: distance - BIAS }) === null;
  }
  function visibleSky(start, direction) {
    traceCount += 1;
    return visibility.trace(start, direction, { minDistance: BIAS }) === null;
  }
  const surfaceCoefficients = checkedSurfaces.map((surface) => {
    const sky = checkedSky.map((sample, index) => {
      const cosine = Math.max(0, dot(surface.normal, sample.direction));
      const coefficient = cosine > 0 && visibleSky(surface.position, sample.direction) ? cosine * sample.weight : 0;
      return { index, coefficient };
    });
    const emitterCoefficients = new Map();
    for (const emitter of checkedEmitters) {
      const delta = sub(emitter.position, surface.position);
      const distance = length(delta);
      if (distance <= BIAS * 2) continue;
      const direction = mul(delta, 1 / distance);
      const surfaceCosine = Math.max(0, dot(surface.normal, direction));
      const emitterCosine = emitter.normal ? Math.max(0, dot(emitter.normal, mul(direction, -1))) : 1;
      if (surfaceCosine === 0 || emitterCosine === 0 || !visibleSegment(surface.position, emitter.position)) continue;
      const omega = emitter.area === null ? 1 / (distance * distance)
        : emitter.area * emitterCosine / Math.max(distance * distance, emitter.area / PI);
      emitterCoefficients.set(String(emitter.id), (emitterCoefficients.get(String(emitter.id)) ?? 0) + surfaceCosine * omega);
    }
    return { surface, sky, emitters: emitterCoefficients };
  });
  const receiverCoefficients = checkedReceivers.map((receiver) => {
    const angularMean = receiver.normal ? 1 : 1 / (4 * PI);
    const sky = checkedSky.map((sample, index) => {
      const cosine = receiver.normal ? Math.max(0, dot(receiver.normal, sample.direction)) : 1;
      const coefficient = cosine > 0 && visibleSky(receiver.position, sample.direction)
        ? cosine * sample.weight * angularMean : 0;
      return { index, coefficient };
    });
    const bounce = [];
    for (let surfaceIndex = 0; surfaceIndex < surfaceCoefficients.length; surfaceIndex += 1) {
      const { surface } = surfaceCoefficients[surfaceIndex];
      const delta = sub(receiver.position, surface.position);
      const distance = length(delta);
      if (distance <= BIAS * 2) continue;
      const direction = mul(delta, 1 / distance);
      const surfaceCosine = Math.max(0, dot(surface.normal, direction));
      const receiverCosine = receiver.normal ? Math.max(0, dot(receiver.normal, mul(direction, -1))) : 1;
      if (surfaceCosine === 0 || receiverCosine === 0 || !visibleSegment(surface.position, receiver.position)) continue;
      const solidAngle = surface.area * surfaceCosine / Math.max(distance * distance, surface.area / PI);
      bounce.push({ surfaceId: surface.id, coefficient: receiverCosine * solidAngle * angularMean, surfaceIndex });
    }
    const directEmitters = new Map();
    for (const emitter of checkedEmitters) {
      const delta = sub(emitter.position, receiver.position);
      const distance = length(delta);
      if (distance <= BIAS * 2) continue;
      const direction = mul(delta, 1 / distance);
      const receiverCosine = receiver.normal ? Math.max(0, dot(receiver.normal, direction)) : 1;
      const emitterCosine = emitter.normal ? Math.max(0, dot(emitter.normal, mul(direction, -1))) : 1;
      if (receiverCosine === 0 || emitterCosine === 0 || !visibleSegment(receiver.position, emitter.position)) continue;
      const omega = emitter.area === null ? 1 / (distance * distance)
        : emitter.area * emitterCosine / Math.max(distance * distance, emitter.area / PI);
      const key = String(emitter.id);
      directEmitters.set(key, (directEmitters.get(key) ?? 0) + receiverCosine * omega * angularMean);
    }
    return { receiver, sky, bounce, directEmitters };
  });
  const emitterIds = [...new Set(checkedEmitters.map((emitter) => String(emitter.id)))];
  const coefficients = {
    schema: 'scene-light-transfer/v2',
    emitterSampling: 'sample-coefficients-aggregated-by-emitter-id',
    surfaces: surfaceCoefficients.map(({ surface, sky, emitters: values }) => ({
      id: surface.id, skyDirections: sky.map(({ index, coefficient }) => ({ index, irradianceCoefficient: coefficient })),
      emitterIrradiance: keyed([...values.entries()]),
    })),
    receivers: receiverCoefficients.map(({ receiver, sky, bounce, directEmitters }) => ({
      id: receiver.id, receiverKind: receiver.normal ? 'mesh' : 'smoke',
      quantity: receiver.normal ? 'irradiance' : 'angular-mean-incident-radiance',
      skyDirections: sky.map(({ index, coefficient }) => ({ index, coefficient })),
      bounce: bounce.map(({ surfaceId, coefficient }) => ({ surfaceId, coefficient })),
      directEmitterTransfer: keyed([...directEmitters.entries()]),
    })),
  };
  assertFiniteTree(coefficients, 'scene light transfer');
  freezeTree(coefficients);
  return Object.freeze({
    coefficients,
    get traceCount() { return traceCount; },
    evaluate({ skyRadiance, emitterRadiance, surfaceAlbedo = {} } = {}) {
      if (!Array.isArray(skyRadiance) || skyRadiance.length !== checkedSky.length) {
        throw new TypeError(`skyRadiance must contain one RGB array for each of ${checkedSky.length} sky directions`);
      }
      const skyColors = skyRadiance.map((value, index) => rgb(value, `skyRadiance[${index}]`));
      if (!emitterRadiance || typeof emitterRadiance !== 'object') throw new TypeError('emitterRadiance must be an object keyed by emitter id');
      const emitterColors = new Map();
      for (const id of emitterIds) emitterColors.set(id, rgb(emitterRadiance[id], `emitterRadiance.${id}`));
      if (!surfaceAlbedo || typeof surfaceAlbedo !== 'object' || Array.isArray(surfaceAlbedo)) throw new TypeError('surfaceAlbedo must be an object keyed by surface id');
      const surfaceLight = surfaceCoefficients.map(({ surface, sky: skyCoefficients, emitters: sourceCoefficients }) => {
        const albedo = Object.hasOwn(surfaceAlbedo, String(surface.id))
          ? rgb(surfaceAlbedo[String(surface.id)], `surfaceAlbedo.${String(surface.id)}`) : surface.albedo;
        if (albedo.some((value) => value < 0)) throw new RangeError(`surfaceAlbedo.${String(surface.id)} must be nonnegative`);
        let irradiance = [0, 0, 0];
        for (const { index, coefficient } of skyCoefficients) irradiance = add(irradiance, mul(skyColors[index], coefficient));
        for (const [id, coefficient] of sourceCoefficients) irradiance = add(irradiance, mul(emitterColors.get(id), coefficient));
        return mul([irradiance[0] * albedo[0], irradiance[1] * albedo[1], irradiance[2] * albedo[2]], 1 / PI);
      });
      const surfaceEntries = surfaceCoefficients.map(({ surface }, index) => [String(surface.id), surfaceLight[index]]);
      const receiverEntries = receiverCoefficients.map(({ receiver, sky, bounce, directEmitters }) => {
        let directSky = [0, 0, 0];
        for (const { index, coefficient } of sky) directSky = add(directSky, mul(skyColors[index], coefficient));
        let bounceRadiance = [0, 0, 0];
        for (const contribution of bounce) bounceRadiance = add(bounceRadiance, mul(surfaceLight[contribution.surfaceIndex], contribution.coefficient));
        let directRadiance = [0, 0, 0];
        for (const [id, coefficient] of directEmitters) directRadiance = add(directRadiance, mul(emitterColors.get(id), coefficient));
        return [String(receiver.id), { directSky, bounce: bounceRadiance, directEmitter: directRadiance,
          total: add(add(directSky, bounceRadiance), directRadiance) }];
      });
      const output = { surfaces: keyed(surfaceEntries), receivers: keyed(receiverEntries) };
      assertFiniteTree(output, 'scene light evaluation');
      return output;
    },
  });
}
