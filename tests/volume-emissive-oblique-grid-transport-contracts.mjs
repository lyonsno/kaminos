import assert from 'node:assert/strict';
import {
  EMISSIVE_LIGHT_DIRECTIONS,
  EMISSIVE_TRANSPORT_WGSL,
} from '../volume-emissive-transport.mjs';

for (const direction of EMISSIVE_LIGHT_DIRECTIONS) {
  assert.ok(
    Math.min(...direction.map(Math.abs)) > 0.08,
    'every characteristic must couple both transverse coordinates instead of remaining in a Cartesian plane',
  );
}

const grid = 9;
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
const sampleOutgoing = (field, emission, extinction, point, halfDistance) => {
  const base = point.map(Math.floor);
  const fraction = point.map((value, axis) => value - base[axis]);
  let sum = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const weight = (x ? fraction[0] : 1 - fraction[0])
      * (y ? fraction[1] : 1 - fraction[1])
      * (z ? fraction[2] : 1 - fraction[2]);
    if (weight === 0) continue;
    const cell = [base[0] + x, base[1] + y, base[2] + z];
    if (cell.some(value => value < 0 || value >= grid)) continue;
    const i = index(cell);
    sum += weight * (
      field[i] * Math.exp(-extinction[i] * halfDistance)
      + integrate(emission[i], extinction[i], halfDistance)
    );
  }
  return sum;
};

const emission = new Float64Array(cells);
const extinction = new Float64Array(cells);
const origin = [4, 4, 4];
emission[index(origin)] = 1;
const directional = EMISSIVE_LIGHT_DIRECTIONS.map(() => new Float64Array(cells));
for (let step = 0; step < grid; step++) {
  for (let directionIndex = 0; directionIndex < EMISSIVE_LIGHT_DIRECTIONS.length; directionIndex++) {
    const direction = EMISSIVE_LIGHT_DIRECTIONS[directionIndex];
    const axis = majorAxis(direction);
    const dominant = Math.abs(direction[axis]);
    const halfDistance = (2 / grid / dominant) * 0.5;
    for (let column = 0; column < grid * grid; column++) {
      const cell = cellFor(direction, column, step);
      const i = index(cell);
      let incoming = 0;
      if (step > 0) {
        incoming = sampleOutgoing(
          directional[directionIndex],
          emission,
          extinction,
          cell.map((value, component) => value - direction[component] / dominant),
          halfDistance,
        );
      }
      directional[directionIndex][i] = incoming + integrate(emission[i], extinction[i], halfDistance);
    }
  }
}

const incident = new Float64Array(cells);
for (let i = 0; i < cells; i++) {
  for (const field of directional) incident[i] += field[i] / directional.length;
}
let fullyObliqueLitCells = 0;
for (let z = 0; z < grid; z++) for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
  if (x !== origin[0] && y !== origin[1] && z !== origin[2] && incident[index([x, y, z])] > 1e-12) {
    fullyObliqueLitCells++;
  }
}
assert.ok(fullyObliqueLitCells > 0, 'a point emitter must transport radiance outside all three origin coordinate planes');

assert.match(EMISSIVE_TRANSPORT_WGSL, /fn samplePreviousOutgoing\(/);
const outgoingBody = EMISSIVE_TRANSPORT_WGSL.split('fn samplePreviousOutgoing(')[1]?.split('\n}')[0] ?? '';
assert.match(outgoingBody, /emissiveDirectionsDst/);
assert.match(outgoingBody, /emissiveCoefficients/);
assert.match(outgoingBody, /emissionIntegral\(material\.w,halfDs\)/);
assert.doesNotMatch(EMISSIVE_TRANSPORT_WGSL, /fn samplePreviousCoefficient\(/);
assert.match(EMISSIVE_TRANSPORT_WGSL, /incoming=samplePreviousOutgoing\(direction,previousPosition,halfDs\)/);

console.log(`emissive oblique grid transport: ${fullyObliqueLitCells} fully-oblique point-emitter cells and per-neighbor optical transfer pass`);

