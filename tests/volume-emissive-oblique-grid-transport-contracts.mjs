import assert from 'node:assert/strict';
import {
  EMISSIVE_LIGHT_GRID,
  EMISSIVE_LIGHT_DIRECTIONS,
  EMISSIVE_LIGHT_WEIGHTS,
  EMISSIVE_LIGHT_RAY_COUNT,
  EMISSIVE_TRANSPORT_WGSL,
} from '../volume-emissive-transport.mjs';

const grid = EMISSIVE_LIGHT_GRID;
const cells = grid ** 3;
const index = ([x, y, z]) => x + grid * (y + grid * z);
const inBounds = cell => cell.every(value => value >= 0 && value < grid);
const stepFor = direction => direction.map(value => Math.sign(value));
const boundary = step => step > 0 ? 0 : grid - 1;
const excludingBoundary = (offset, edge) => offset + (edge === 0 ? 1 : 0);
const cardinalRays = 6 * grid ** 2;
const diagonalRays = 3 * grid ** 2 - 3 * grid + 1;
assert.equal(EMISSIVE_LIGHT_RAY_COUNT, cardinalRays + 8 * diagonalRays);
const packedRayStart = (directionIndex, ray) => {
  const step = stepFor(EMISSIVE_LIGHT_DIRECTIONS[directionIndex]);
  if (directionIndex < 6) {
    const axis = Math.floor(directionIndex / 2);
    const a = ray % grid;
    const b = Math.floor(ray / grid);
    return axis === 0 ? [boundary(step[0]), a, b]
      : axis === 1 ? [a, boundary(step[1]), b]
        : [a, b, boundary(step[2])];
  }
  const edges = step.map(boundary);
  if (ray < grid ** 2) return [edges[0], ray % grid, Math.floor(ray / grid)];
  let local = ray - grid ** 2;
  if (local < (grid - 1) * grid) return [
    excludingBoundary(local % (grid - 1), edges[0]),
    edges[1],
    Math.floor(local / (grid - 1)),
  ];
  local -= (grid - 1) * grid;
  return [
    excludingBoundary(local % (grid - 1), edges[0]),
    excludingBoundary(Math.floor(local / (grid - 1)), edges[1]),
    edges[2],
  ];
};
for (let directionIndex = 0; directionIndex < EMISSIVE_LIGHT_DIRECTIONS.length; directionIndex++) {
  const visits = new Uint8Array(cells);
  const rayCount = directionIndex < 6 ? grid ** 2 : diagonalRays;
  const step = stepFor(EMISSIVE_LIGHT_DIRECTIONS[directionIndex]);
  for (let ray = 0; ray < rayCount; ray++) {
    for (let cell = packedRayStart(directionIndex, ray); inBounds(cell); cell = cell.map((value, axis) => value + step[axis])) {
      visits[index(cell)]++;
    }
  }
  assert.ok(visits.every(count => count === 1), `packed GPU ray indexing covers every cell exactly once for direction ${directionIndex}`);
}
const integrate = (source, extinction, distance) => {
  const tau = extinction * distance;
  if (tau < 0.001) return source * distance * (1 - tau * 0.5 + tau * tau / 6);
  return source * (1 - Math.exp(-tau)) / extinction;
};

const solveIncident = (emission, extinction) => {
  const incident = new Float64Array(cells);
  for (let directionIndex = 0; directionIndex < EMISSIVE_LIGHT_DIRECTIONS.length; directionIndex++) {
    const step = stepFor(EMISSIVE_LIGHT_DIRECTIONS[directionIndex]);
    const distance = 2 / grid * Math.hypot(...step);
    const halfDistance = distance * 0.5;
    const field = new Float64Array(cells);
    for (let z = 0; z < grid; z++) for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const start = [x, y, z];
      if (inBounds(start.map((value, axis) => value - step[axis]))) continue;
      let incoming = 0;
      for (let cell = start; inBounds(cell); cell = cell.map((value, axis) => value + step[axis])) {
        const i = index(cell);
        const attenuation = Math.exp(-extinction[i] * halfDistance);
        const halfEmission = integrate(emission[i], extinction[i], halfDistance);
        const center = incoming * attenuation + halfEmission;
        field[i] = center;
        incoming = center * attenuation + halfEmission;
      }
    }
    for (let i = 0; i < cells; i++) incident[i] += field[i] * EMISSIVE_LIGHT_WEIGHTS[directionIndex];
  }
  return incident;
};

const pointEmission = new Float64Array(cells);
const vacuum = new Float64Array(cells);
const origin = [4, 4, 4];
pointEmission[index(origin)] = 1;
const pointIncident = solveIncident(pointEmission, vacuum);
let fullyObliqueLitCells = 0;
for (let z = 0; z < grid; z++) for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
  if (x !== origin[0] && y !== origin[1] && z !== origin[2] && pointIncident[index([x, y, z])] > 1e-12) fullyObliqueLitCells++;
}
assert.ok(fullyObliqueLitCells > 0, 'a point emitter transports radiance outside all three origin coordinate planes');

const emission = new Float64Array(cells);
const extinction = new Float64Array(cells);
const middle = (grid - 1) / 2;
for (let z = 0; z < grid; z++) for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
  const i = index([x, y, z]);
  const px = (x - middle) / middle;
  const py = (y - middle) / middle;
  const pz = (z - middle) / middle;
  const emitter = ((px + 0.35) / 0.18) ** 2 + ((py - 0.12) / 0.23) ** 2 + ((pz + 0.18) / 0.20) ** 2;
  const plane = px * 0.61 + py * 0.48 - pz * 0.63 - 0.02;
  const tangentRadius = (px - 0.1) ** 2 + (py + 0.22) ** 2 + (pz - 0.05) ** 2;
  emission[i] = 2 * Math.exp(-2.5 * emitter);
  extinction[i] = 0.05 + 7 * Math.exp(-((plane / 0.18) ** 2)) * Math.exp(-tangentRadius / 0.9);
}

const rotations = [
  { name: 'cycle-xyz', transform: ([x, y, z]) => [y, z, x] },
  { name: 'quarter-turn-z', transform: ([x, y, z]) => [grid - 1 - y, x, z] },
];
const rotateField = (field, rotation) => {
  const rotated = new Float64Array(cells);
  for (let z = 0; z < grid; z++) for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    rotated[index(rotation.transform([x, y, z]))] = field[index([x, y, z])];
  }
  return rotated;
};
const relativeRotatedError = (reference, rotated, rotation) => {
  let squaredError = 0;
  let squaredReference = 0;
  for (let z = 1; z < grid - 1; z++) for (let y = 1; y < grid - 1; y++) for (let x = 1; x < grid - 1; x++) {
    const expected = reference[index([x, y, z])];
    const actual = rotated[index(rotation.transform([x, y, z]))];
    squaredError += (actual - expected) ** 2;
    squaredReference += expected ** 2;
  }
  return Math.sqrt(squaredError / squaredReference);
};

const heterogeneousIncident = solveIncident(emission, extinction);
const rotationErrors = rotations.map(rotation => relativeRotatedError(
  heterogeneousIncident,
  solveIncident(rotateField(emission, rotation), rotateField(extinction, rotation)),
  rotation,
));
assert.ok(rotationErrors.every(error => error < 1e-12), `cube rotations must be exact: ${rotationErrors}`);

assert.match(EMISSIVE_TRANSPORT_WGSL, /let center = incoming\*attenuation\+halfEmission;/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /incoming = center\*attenuation\+halfEmission;/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /let ds = \(2\.0\/f32\(LIGHT_GRID\)\)\*length\(vec3<f32>\(rayStep\)\);/);
assert.doesNotMatch(EMISSIVE_TRANSPORT_WGSL, /samplePreviousOutgoing/);

console.log(`emissive lattice grid transport: ${fullyObliqueLitCells} off-plane cells; rotation errors ${rotationErrors.map(error => error.toExponential(2)).join(', ')}`);
