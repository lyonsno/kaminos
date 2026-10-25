import { Group, Mesh, BufferGeometry, BufferAttribute, MeshStandardMaterial, Vector3, Matrix4, Quaternion } from '../../lib/three.core.js';

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

export function createVirtualHand() {
  const root = new Group(); root.name = 'Virtual hand'; root.visible = false;
  const geometry = new BufferGeometry();
  const positions = new Float32Array(778*3);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const material = new MeshStandardMaterial({ color: 0x637a82, metalness: .38, roughness: .45 });
  const mesh = new Mesh(geometry, material); mesh.name = 'Articulated hand'; root.add(mesh);
  let topology = null, side = null, wrist = [];
  return { root,
    update(result, faces) {
      if (!result?.hasHand || result.acquisition?.fallback) { root.visible = false; return null; }
      if (!faces?.length || faces.length % 3 || !faces.every(i => Number.isInteger(i) && i >= 0 && i < 778)) throw Error('invalid hand topology');
      if (topology !== faces || side !== result.handedness) {
        const indices = new Uint16Array(faces);
        // Two sign flips rotate the view; only the producer's left-hand
        // reflection reverses winding.
        if (result.handedness === 'left') for (let i=0;i<indices.length;i+=3) [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
        geometry.setIndex(new BufferAttribute(indices,1));
        wrist = wristBoundary(faces); topology = faces; side = result.handedness;
      }
      const palm = palmFrame(result.verticesMeters, wrist, result.handedness);
      root.visible = !!palm;
      if (!palm) return null;
      for (let i=0;i<positions.length;i++) positions[i]=(result.verticesMeters[i]*HAND_VIEW[i%3]-palm.center.getComponent(i%3))*10;
      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      return palm;
    },
  };
}
