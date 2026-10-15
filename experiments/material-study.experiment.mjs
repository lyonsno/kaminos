import {Group, Mesh, SphereGeometry, MeshStandardMaterial} from '../lib/three.core.js';

function roughness(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('roughness must be between 0 and 1');
  return value;
}

export default {
  id: 'material-study',
  title: 'Material study',
  async create({host, inputs, record}) {
    const initial = roughness(inputs.roughness ?? 0.6);
    const session = await host.scene.open();
    const root = new Group(); root.name = 'Material comparison';
    const geometry = new SphereGeometry(0.65, 32, 24);
    const reference = new MeshStandardMaterial({color: 0x35aeb3, roughness: 0.15, metalness: 0.35});
    const candidate = new MeshStandardMaterial({color: 0x35aeb3, roughness: initial, metalness: 0.35});
    for (const [index, material] of [reference, candidate].entries()) {
      const mesh = new Mesh(geometry, material);
      mesh.name = index ? 'Candidate' : 'Reference';
      mesh.position.set(index ? 0.85 : -0.85, 0.65, 0);
      mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
    }
    let asset;
    try {
      asset = await session.attach(root, {owned: true, metadata: {
        label: root.name, source: 'example:material-study', type: 'experiment',
      }});
    } catch (error) {
      geometry.dispose(); reference.dispose(); candidate.dispose();
      await session.dispose(); throw error;
    }
    let slider, value;
    const read = () => ({objectId: asset.id, roughness: candidate.roughness,
      referenceRoughness: reference.roughness, view: session.readView()});
    const sync = () => {
      if (slider) slider.value = String(candidate.roughness);
      if (value) value.textContent = candidate.roughness.toFixed(2);
    };
    return {
      read,
      operations: {
        setRoughness(requested) {
          candidate.roughness = roughness(requested);
          session.redraw(); sync();
          const effective = read();
          record({kind: 'material-study.roughness', phase: 'applied', target: asset.id, requested, effective});
          return effective;
        },
        frame() {
          const effective = session.setView({position: [3.8, 2.4, 4.8], target: [0, 0.65, 0]});
          record({kind: 'material-study.view', phase: 'applied', target: asset.id, effective});
          return effective;
        },
      },
      mount({root: panel, document, invoke}) {
        const label = document.createElement('label'); label.textContent = 'Candidate roughness ';
        slider = document.createElement('input'); slider.type = 'range';
        slider.min = '0'; slider.max = '1'; slider.step = '0.01';
        slider.setAttribute('aria-label', 'Candidate roughness');
        value = document.createElement('output');
        const frame = document.createElement('button'); frame.type = 'button'; frame.textContent = 'Frame comparison';
        const status = document.createElement('div'); status.setAttribute('role', 'status');
        const failed = error => {sync(); status.textContent = error.message;};
        slider.addEventListener('input', () => invoke('setRoughness', Number(slider.value)).catch(failed));
        frame.addEventListener('click', () => invoke('frame').catch(failed));
        label.append(slider, value); panel.append(label, frame, status); sync();
      },
      dispose: () => session.dispose(),
    };
  },
};
