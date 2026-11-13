// Reused from Iron Gland7c3fed1: native palm anchors and opposite-camera basis.
import { Vector3, Matrix4, Quaternion } from './lib/three.core.js';

// MobRecon's 778-vertex topology: surface anchors nearest the index/little
// knuckles (HandMesh template/j_reg.npy rows 1/7). These are not regressed joints.
const INDEX = 62, LITTLE = 595;
export const HAND_VIEW = Object.freeze([-1, -1, 1]);

export function wristBoundary(faces) {
  const edges = new Map();
  for (let i = 0; i < faces.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = faces[i+j], b = faces[i+(j+1)%3], key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  return [...new Set([...edges].filter(([, count]) => count === 1).flatMap(([key]) => key.split(':').map(Number)))];
}

export function palmFrame(vertices, wrist, handedness) {
  if (vertices?.length !== 778*3 || !vertices.every(Number.isFinite) || !wrist.length) return null;
  const at = i => new Vector3(...HAND_VIEW.map((sign, axis) => sign * vertices[i*3+axis]));
  const heel = wrist.reduce((sum,i) => sum.add(at(i)), new Vector3()).multiplyScalar(1/wrist.length);
  const index = at(INDEX), little = at(LITTLE), knuckles = index.clone().add(little).multiplyScalar(.5);
  const across = index.clone().sub(little), along = knuckles.clone().sub(heel);
  const width = across.length(), normal = across.clone().cross(along);
  if (width < 1e-5 || along.length() < 1e-5 || normal.length() < 1e-8) return null;
  normal.normalize().multiplyScalar(handedness === 'left' ? -1 : 1);
  along.normalize();
  const right = along.clone().cross(normal).normalize();
  const center = heel.clone().lerp(knuckles, .55);
  return { center, normal, width, quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, along, normal)) };
}

