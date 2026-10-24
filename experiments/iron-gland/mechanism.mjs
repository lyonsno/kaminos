import { Group, Mesh, BoxGeometry, TorusGeometry, OctahedronGeometry, MeshStandardMaterial } from '../../lib/three.core.js';

export function createMechanism() {
  const root = new Group(); root.name = 'Iron Gland';
  const silver = new MeshStandardMaterial({ color: 0xd5dedb, metalness: .75, roughness: .27 });
  const dark = new MeshStandardMaterial({ color: 0x273330, metalness: .8, roughness: .32 });
  const cyan = new MeshStandardMaterial({ color: 0x6effdd, emissive: 0x12dfb1, emissiveIntensity: 2, roughness: .25 });
  const amber = new MeshStandardMaterial({ color: 0xffb35a, emissive: 0xc57a12, emissiveIntensity: .8, metalness: .55, roughness: .3 });
  const chassis = new Group(); root.add(chassis);
  const rod = new BoxGeometry(1, .045, .045);
  for (let axis = 0; axis < 3; axis++) for (const a of [-.5, .5]) for (const b of [-.5, .5]) {
    const edge = new Mesh(rod, silver);
    if (axis === 0) edge.position.set(0, a, b);
    if (axis === 1) { edge.rotation.z = Math.PI / 2; edge.position.set(a, 0, b); }
    if (axis === 2) { edge.rotation.y = Math.PI / 2; edge.position.set(a, b, 0); }
    chassis.add(edge);
  }
  const panels = [];
  const plate = new BoxGeometry(.72, .72, .065), strip = new BoxGeometry(.43, .025, .012);
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const face = new Group();
    if (axis === 0) face.rotation.y = sign * Math.PI / 2;
    if (axis === 1) face.rotation.x = -sign * Math.PI / 2;
    if (axis === 2 && sign < 0) face.rotation.y = Math.PI;
    face.add(new Mesh(plate, dark));
    for (const y of [-.22, .22]) { const detail = new Mesh(strip, cyan); detail.position.set(0, y, .04); face.add(detail); }
    panels.push({ face, axis, sign }); chassis.add(face);
  }
  const core = new Mesh(new OctahedronGeometry(.22), cyan); chassis.add(core);
  const rings = [];
  for (let i = 0; i < 2; i++) {
    const ring = new Mesh(new TorusGeometry(.33 + i * .065, .016, 8, 48), i ? silver : amber);
    chassis.add(ring); rings.push(ring);
  }
  return {
    root,
    update(state, seconds) {
      root.visible = state.visible;
      chassis.rotation.set(...state.rotation);
      for (const { face, axis, sign } of panels) {
        face.position.set(0, 0, 0); face.position.setComponent(axis, sign * (.5 + state.openness * .36));
      }
      rings[0].rotation.set(seconds * .4, .6, 0);
      rings[1].rotation.set(.7, -seconds * .3, Math.PI / 3);
      core.rotation.set(seconds * .22, seconds * .37, 0);
    },
  };
}
