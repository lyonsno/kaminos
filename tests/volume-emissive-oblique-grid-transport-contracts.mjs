import assert from 'node:assert/strict';
import {
  EMISSIVE_LIGHT_GRID,
  EMISSIVE_LIGHT_DIRECTIONS,
  EMISSIVE_TRANSPORT_WGSL,
} from '../volume-emissive-transport.mjs';

for (const direction of EMISSIVE_LIGHT_DIRECTIONS) {
  assert.ok(
    Math.min(...direction.map(Math.abs)) > 0.08,
    'every characteristic must couple both transverse coordinates instead of remaining in a Cartesian plane',
  );
}

const grid = EMISSIVE_LIGHT_GRID;
const cells = grid ** 3;
const index = ([x, y, z]) => x + grid * (y + grid * z);
const majorAxis = direction => {
  const magnitude = direction.map(Math.abs);
  return magnitude.indexOf(Math.max(...magnitude));
};
const cellFor = (direction, column, step) => {
  const axis = majorAxis(direction);
  const along = direction[axis] < 0 ? grid - 1 - step : step;
  const a = column % grid;
  const b = Math.floor(column / grid);
  return axis === 0 ? [along, a, b] : axis === 1 ? [a, along, b] : [a, b, along];
};
const integrate = (source, extinction, distance) => {
  if (extinction * distance < 0.001) {
    const tau = extinction * distance;
    return source * distance * (1 - tau * 0.5 + tau * tau / 6);
  }
  return source * (1 - Math.exp(-extinction * distance)) / extinction;
};

const samplePrevious = (field, emission, extinction, point, halfDistance, mode = 'per-neighbor') => {
  const base = point.map(Math.floor);
  const fraction = point.map((value, axis) => value - base[axis]);
  let outgoing = 0;
  let averagedCenter = 0;
  let averagedEmission = 0;
  let averagedExtinction = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const weight = (x ? fraction[0] : 1 - fraction[0])
      * (y ? fraction[1] : 1 - fraction[1])
      * (z ? fraction[2] : 1 - fraction[2]);
    if (weight === 0) continue;
    const cell = [base[0] + x, base[1] + y, base[2] + z];
    if (cell.some(value => value < 0 || value >= grid)) continue;
    const i = index(cell);
    if (mode === 'per-neighbor') {
      outgoing += weight * (
        field[i] * Math.exp(-extinction[i] * halfDistance)
        + integrate(emission[i], extinction[i], halfDistance)
      );
    } else {
      averagedCenter += weight * field[i];
      averagedEmission += weight * emission[i];
      averagedExtinction += weight * extinction[i];
    }
  }
  if (mode === 'per-neighbor') return outgoing;
  return averagedCenter * Math.exp(-averagedExtinction * halfDistance)
    + integrate(averagedEmission, averagedExtinction, halfDistance);
};

const solveIncident = (emission, extinction, mode = 'per-neighbor') => {
  const directional = EMISSIVE_LIGHT_DIRECTIONS.map(() => new Float64Array(cells));
  for (let step = 0; step < grid; step++) {
    for (let directionIndex = 0; directionIndex < EMISSIVE_LIGHT_DIRECTIONS.length; directionIndex++) {
      const direction = EMISSIVE_LIGHT_DIRECTIONS[directionIndex];
      const axis = majorAxis(direction);
      const dominant = Math.abs(direction[axis]);
      const halfDistance = 1 / grid / dominant;
      for (let column = 0; column < grid * grid; column++) {
        const cell = cellFor(direction, column, step);
        const i = index(cell);
        let incoming = 0;
        if (step > 0) {
          incoming = samplePrevious(
            directional[directionIndex],
            emission,
            extinction,
            cell.map((value, component) => value - direction[component] / dominant),
            halfDistance,
            mode,
          );
        }
        directional[directionIndex][i] = incoming * Math.exp(-extinction[i] * halfDistance)
          + integrate(emission[i], extinction[i], halfDistance);
      }
    }
  }
  const incident = new Float64Array(cells);
  for (let i = 0; i < cells; i++) {
    for (const field of directional) incident[i] += field[i] / directional.length;
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
  if (x !== origin[0] && y !== origin[1] && z !== origin[2] && pointIncident[index([x, y, z])] > 1e-12) {
    fullyObliqueLitCells++;
  }
}
assert.ok(fullyObliqueLitCells > 0, 'a point emitter must transport radiance outside all three origin coordinate planes');

const heterogeneousField = new Float64Array(cells);
const heterogeneousEmission = new Float64Array(cells);
const heterogeneousExtinction = new Float64Array(cells);
heterogeneousField[index([4, 4, 4])] = 1;
heterogeneousField[index([5, 4, 4])] = 1;
heterogeneousExtinction[index([5, 4, 4])] = 10;
const perNeighbor = samplePrevious(
  heterogeneousField,
  heterogeneousEmission,
  heterogeneousExtinction,
  [4.5, 4, 4],
  0.25,
);
const averagedBeforeTransfer = samplePrevious(
  heterogeneousField,
  heterogeneousEmission,
  heterogeneousExtinction,
  [4.5, 4, 4],
  0.25,
  'average-before-transfer',
);
const expectedPerNeighbor = 0.5 + 0.5 * Math.exp(-2.5);
assert.ok(Math.abs(perNeighbor - expectedPerNeighbor) < 1e-12, 'each upstream neighbor must undergo its own optical transfer');
assert.ok(perNeighbor > averagedBeforeTransfer * 1.8, 'the oracle must reject averaging heterogeneous extinction before exponentiation');

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
const rotationErrors = rotations.map(rotation => {
  const rotatedIncident = solveIncident(
    rotateField(emission, rotation),
    rotateField(extinction, rotation),
  );
  return relativeRotatedError(heterogeneousIncident, rotatedIncident, rotation);
});
assert.ok(
  rotationErrors.every(error => error < 0.20),
  `rotated heterogeneous coefficient scenes must agree within the declared 20% relative-L2 bound: ${rotationErrors}`,
);

assert.match(EMISSIVE_TRANSPORT_WGSL, /fn samplePreviousOutgoing\(/);
const outgoingBody = EMISSIVE_TRANSPORT_WGSL.split('fn samplePreviousOutgoing(')[1]?.split('\n}')[0] ?? '';
assert.match(outgoingBody, /emissiveDirectionsDst/);
assert.match(outgoingBody, /emissiveCoefficients/);
assert.match(outgoingBody, /emissionIntegral\(material\.w,halfDs\)/);
assert.doesNotMatch(EMISSIVE_TRANSPORT_WGSL, /fn samplePreviousCoefficient\(/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /incoming=samplePreviousOutgoing\(direction,previousPosition,halfDs\)/);

console.log(
  `emissive oblique grid transport: ${fullyObliqueLitCells} fully-oblique cells; `
  + `heterogeneous interpolation ratio ${(perNeighbor / averagedBeforeTransfer).toFixed(3)}; `
  + `rotation errors ${rotationErrors.map(error => error.toFixed(3)).join(', ')}`,
);
