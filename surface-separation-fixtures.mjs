import {
  BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh,
  MeshStandardMaterial,
} from './lib/three.core.js';
import {registerExportGeometrySnapshot} from './scene-export-geometry.mjs';
import {
  handlePoint, materialBands, surfaceBounds, surfaceEdge, surfacePatch,
} from './surface-separation.mjs';

const specs = [
  {id: 'flat-shell', label: 'Flat shell · rear brace', at: [-2.2, 3.3, 0],
    kind: 'plane', width: 3.45, height: 1.72, thickness: .13, cuttable: true,
    brace: [-.13, -.84, .13, .84], color: 0x748da0},
  {id: 'curved-shell', label: 'Curved shell', at: [2.12, 3.32, 0],
    kind: 'cylinder', width: 3.2, height: 1.68, radius: 1.78, thickness: .11,
    cuttable: true, color: 0x708f9d},
  {id: 'recess', label: 'Recessed block', at: [-2.9, 1.13, 0],
    kind: 'plane', width: 2.22, height: 1.56, thickness: .78,
    gap: [-.55, -.37, .55, .37], recess: .33, color: 0x8d7d6b},
  {id: 'arm', label: 'Block with projecting arm', at: [0, 1.13, 0],
    kind: 'plane', width: 2.45, height: 1.56, thickness: .54,
    color: 0x8b7e71},
  {id: 'rounded', label: 'Solid with curved face', at: [2.87, 1.13, 0],
    kind: 'cylinder', width: 2.14, height: 1.56, radius: 1.15, thickness: .63,
    color: 0x978475},
];

export function meshGeometry(vertices) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function skinBetween(surface, rect, front, back) {
  const vertices = [];
  for (let side = 0; side < 4; side++) {
    const a = handlePoint(rect, side);
    const b = handlePoint(rect, (side + 1) % 4);
    const outer = surfaceEdge(surface, a, b, front);
    const inner = surfaceEdge(surface, a, b, back);
    for (let i = 1; i < outer.length; i++) {
      vertices.push(...outer[i - 1], ...inner[i - 1], ...inner[i],
        ...outer[i - 1], ...inner[i], ...outer[i]);
    }
  }
  return vertices;
}

export function buildShellPiece(surface, rect) {
  const back = -surface.thickness;
  return meshGeometry([
    ...surfacePatch(surface, rect),
    ...surfacePatch(surface, rect, back),
    ...skinBetween(surface, rect, 0, back),
  ]);
}

export function makeFixture(spec) {
  const root = new Group();
  root.name = spec.label;
  root.position.fromArray(spec.at);
  const body = new MeshStandardMaterial({color: spec.color, roughness: .75, side: DoubleSide});
  const detail = new MeshStandardMaterial({color: 0x746252, roughness: .87, side: DoubleSide});
  const add = (geometry, material = body) => {
    const mesh = new Mesh(geometry, material);
    root.add(mesh);
    return mesh;
  };
  const box = (size, position, material) => {
    const mesh = add(new BoxGeometry(...size), material);
    mesh.position.fromArray(position);
    return mesh;
  };
  const bounds = surfaceBounds(spec);
  const frontVertices = materialBands(bounds, spec.gap).flatMap(band => surfacePatch(spec, band));
  const front = add(meshGeometry(frontVertices));
  let back;
  let rim;
  if (spec.id === 'rounded') {
    const [a, b, c, d] = bounds;
    const length = 2 * Math.PI * spec.radius;
    back = add(meshGeometry(surfacePatch(spec, [c, b, a + length, d])));
    for (const y of [b, d]) {
      const perimeter = surfaceEdge(spec, [a, y], [a + length, y]);
      const cap = perimeter.slice(1).flatMap((point, i) => [0, y, -spec.radius, ...perimeter[i], ...point]);
      add(meshGeometry(cap));
    }
  } else {
    back = add(meshGeometry(surfacePatch(spec, bounds, -spec.thickness)));
    add(meshGeometry(skinBetween(spec, bounds, 0, -spec.thickness)));
  }
  if (spec.gap) {
    add(meshGeometry(skinBetween(spec, spec.gap, 0, -spec.recess)), detail);
    add(meshGeometry(surfacePatch(spec, spec.gap, -spec.recess)), detail);
  }
  if (spec.brace) {
    box([.26, 1.68, .24], [0, 0, -.25], detail);
  }
  if (spec.id === 'arm') {
    // A separate face meeting the broad face at a real crease.
    box([1.07, .37, .40], [1.13, .31, .14]);
  }
  const originalFront = front.geometry;
  const originalBack = back.geometry;
  if (spec.cuttable) {
    registerExportGeometrySnapshot(front, () => originalFront);
    registerExportGeometrySnapshot(back, () => originalBack);
  }
  const pickMeshes = [...root.children];
  function clearCut() {
    if (front.geometry !== originalFront) {
      front.geometry.dispose();
      front.geometry = originalFront;
      back.geometry.dispose();
      back.geometry = originalBack;
      rim.geometry.dispose();
      rim.removeFromParent();
      rim = null;
    }
  }
  return {
    spec, root, front, pickMeshes, material: body,
    openCut(rect) {
      clearCut();
      const bands = materialBands(bounds, rect);
      front.geometry = meshGeometry(bands.flatMap(band => surfacePatch(spec, band)));
      back.geometry = meshGeometry(bands.flatMap(band => surfacePatch(spec, band, -spec.thickness)));
      rim = add(meshGeometry(skinBetween(spec, rect, 0, -spec.thickness)), body);
      rim.userData.kaminosEditorHelper = true;
    },
    clearCut,
  };
}

export function makeFixtures(height) {
  return specs.map(spec => makeFixture({...spec, at: [spec.at[0], spec.at[1] + height, spec.at[2]]}));
}
