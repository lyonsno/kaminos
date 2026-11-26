const clamp = (x, min, max) => Math.max(min, Math.min(max, x));

export function surfacePoint(surface, [u, v], offset = 0) {
  if (surface.kind === 'plane') return [u, v, offset];
  const angle = u / surface.radius;
  const radius = surface.radius + offset;
  return [radius * Math.sin(angle), v, radius * Math.cos(angle) - surface.radius];
}

// The coordinate of a hit on the captured front chart. The rear of a
// cylindrical body never aliases the front, even with a ray from behind.
export function surfaceCoordinates(surface, [x, y, z]) {
  if (surface.kind === 'plane') return [x, y];
  const u = Math.atan2(x, z + surface.radius) * surface.radius;
  return Math.abs(u) <= surface.width / 2 + 1e-8 ? [u, y] : null;
}

export function surfaceBounds({width, height}) {
  return [-width / 2, -height / 2, width / 2, height / 2];
}

export function clampSurfacePoint(surface, [u, v]) {
  const [a, b, c, d] = surfaceBounds(surface);
  return [clamp(u, a, c), clamp(v, b, d)];
}

export function rectangleBetween([u, v], [x, y]) {
  return [Math.min(u, x), Math.min(v, y), Math.max(u, x), Math.max(v, y)];
}

export function handlePoint([a, b, c, d], index) {
  return [[a, b], [c, b], [c, d], [a, d]][index];
}

export function moveCorner(rect, index, [u, v]) {
  const [x, y] = handlePoint(rect, (index + 2) % 4);
  // Keep the selected handle meaningful even when dragged into its opposite.
  const minimum = .015;
  return rectangleBetween([x, y], [
    index === 1 || index === 2 ? Math.max(u, x + minimum) : Math.min(u, x - minimum),
    index === 2 || index === 3 ? Math.max(v, y + minimum) : Math.min(v, y - minimum),
  ]);
}

export function intersectRect([a, b, c, d], [e, f, g, h]) {
  const clip = [Math.max(a, e), Math.max(b, f), Math.min(c, g), Math.min(d, h)];
  return hasArea(clip) ? clip : null;
}

export const hasArea = ([a, b, c, d]) => c > a && d > b;

export function materialBands(rect, hole) {
  const overlap = hole && intersectRect(rect, hole);
  if (!overlap) return [rect];
  const [a, b, c, d] = rect;
  const [e, f, g, h] = overlap;
  return [[a, b, e, d], [g, b, c, d], [e, b, g, f], [e, h, g, d]].filter(hasArea);
}

export function surfaceEdge(surface, [a, b], [c, d], offset = 0) {
  const count = surface.kind === 'plane' ? 1 : Math.max(1, Math.ceil(Math.abs(c - a) / .055));
  return Array.from({length: count + 1}, (_, i) => {
    const t = i / count;
    return surfacePoint(surface, [a + (c - a) * t, b + (d - b) * t], offset);
  });
}

export function surfacePatch(surface, [a, b, c, d], offset = 0) {
  const bottom = surfaceEdge(surface, [a, b], [c, b], offset);
  const top = surfaceEdge(surface, [a, d], [c, d], offset);
  const vertices = [];
  for (let i = 1; i < bottom.length; i++) {
    vertices.push(...bottom[i - 1], ...bottom[i], ...top[i],
      ...bottom[i - 1], ...top[i], ...top[i - 1]);
  }
  return vertices;
}

export function inspectSeparation(surface, rect) {
  if (surface.gap && intersectRect(rect, surface.gap)) return 'cavity';
  if (surface.brace && intersectRect(rect, surface.brace)) return 'brace';
  if (!surface.cuttable) return 'footprint';
  const bounds = surfaceBounds(surface);
  return rect.some((value, i) => Math.abs(value - bounds[i]) <= .001) ? 'rim' : 'through';
}

export function nearestHinge(surface, rect, [u, v], current = null) {
  const [a, b, c, d] = rect;
  const inU = clamp(u, a, c);
  const inV = clamp(v, b, d);
  const distances = [
    Math.hypot(u - inU, v - b), Math.hypot(u - c, v - inV),
    Math.hypot(u - inU, v - d), Math.hypot(u - a, v - inV),
  ];
  const edges = surface.kind === 'cylinder' ? [1, 3] : [0, 1, 2, 3];
  const nearest = edges.reduce((best, next) => distances[next] < distances[best] ? next : best);
  // Keep the held side through small near-corner fluctuations.
  if (edges.includes(current) && distances[current] <= distances[nearest] + .06) return current;
  return nearest;
}

export function hingeFraction(rect, side, point) {
  const a = handlePoint(rect, side);
  const b = handlePoint(rect, (side + 1) % 4);
  const axis = side % 2;
  return clamp((point[axis] - a[axis]) / (b[axis] - a[axis]), 0, 1);
}
