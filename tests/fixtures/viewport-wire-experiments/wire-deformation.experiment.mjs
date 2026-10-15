// Witness fixture (served with KAMINOS_EXPERIMENTS_DIR pointing here): an
// owner-attached mesh whose shape is moved on the GPU by its material's
// positionNode, the way an owner simulation deforms its published geometry.
// scene-object-witness.mjs --scenario viewport-wire-gpu-deformation uses it to
// check that viewport Wire draws the deformed shape, not the rest shape.
import {Mesh, BoxGeometry, MeshStandardNodeMaterial} from '../../../lib/three.webgpu.js';
import {positionLocal, vec3, uniform} from '../../../lib/three.tsl.js';

export default {
  id: 'wire-deformation',
  title: 'Wire deformation fixture',
  async create({host}) {
    const session = await host.scene.open();
    const shift = uniform(0);
    const geometry = new BoxGeometry(0.8, 0.8, 0.8, 4, 4, 4);
    const material = new MeshStandardNodeMaterial({color: 0xc8643c, roughness: 0.6});
    material.positionNode = positionLocal.add(vec3(shift, 0, 0));
    const mesh = new Mesh(geometry, material);
    mesh.name = 'GPU-deformed box';
    mesh.position.set(0, 0.6, 0);
    let asset;
    try {
      asset = await session.attach(mesh, {owned: true, metadata: {label: mesh.name, source: 'fixture:wire-deformation', type: 'experiment'}});
    } catch (error) {
      geometry.dispose(); material.dispose(); await session.dispose(); throw error;
    }
    return {
      read: () => ({objectId: asset.id, shift: shift.value, visible: mesh.visible}),
      operations: {
        setShift(value) { shift.value = Number(value); session.redraw(); return {shift: shift.value}; },
        // Replaces the deformation graph on the same material, as an owner
        // does when its deformation law changes.
        replaceGraph(x) { material.positionNode = positionLocal.add(vec3(Number(x), 0, 0)); material.needsUpdate = true; session.redraw(); return {graph: 'constant', x: Number(x)}; },
        setVisible(visible) { mesh.visible = visible === true; session.redraw(); return {visible: mesh.visible}; },
        frame() { return session.setView({position: [0.45, 1.1, 4.4], target: [0.45, 0.6, 0]}); },
      },
      async dispose() { await session.dispose(); geometry.dispose(); material.dispose(); },
    };
  },
};
