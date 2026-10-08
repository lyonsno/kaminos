import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { exportCloneInWorld } from '../scene-export.mjs';

// Node has Blob but no FileReader; GLTFExporter uses it to pack buffers.
globalThis.FileReader ??= class {
  #finish(result) { this.result = result; this.onload?.({ target: this }); this.onloadend?.({ target: this }); }
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => this.#finish(buffer)); }
  readAsDataURL(blob) { blob.arrayBuffer().then(buffer => this.#finish(`data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`)); }
};

function riggedBox() {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({ length: count * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
  const bone = new THREE.Bone();
  bone.name = 'rootBone';
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  const root = new THREE.Group();
  root.add(mesh);
  root.position.set(2, 0, -1);
  root.rotation.y = 0.4;
  return root;
}

test('exporting a rigged selection keeps its skin joints inside the export', async () => {
  const source = riggedBox();
  const helper = new THREE.Object3D();
  helper.userData.kaminosEditorHelper = true;
  source.add(helper);
  const clone = exportCloneInWorld(source);
  const glb = await new GLTFExporter().parseAsync(clone, { binary: true });
  const bytes = Buffer.from(glb);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.equal(gltf.skins?.length, 1);
  for (const joint of gltf.skins[0].joints) {
    assert.ok(Number.isInteger(joint) && gltf.nodes[joint]?.name === 'rootBone', `joint ${joint} is an exported bone node`);
  }
  let helpers = 0;
  clone.traverse(child => { if (child.userData?.kaminosEditorHelper) helpers++; });
  assert.equal(helpers, 0, 'editor helpers stay out of the export');
  assert.ok(source.children.includes(helper), 'the source keeps its helper');
  source.updateWorldMatrix(true, true);
  clone.updateWorldMatrix(true, true);
  assert.ok(clone.matrixWorld.equals(source.matrixWorld), 'the export carries the scene placement');
  const loaded = await new GLTFLoader().parseAsync(glb, '');
  let skinned = null;
  loaded.scene.traverse(child => { if (child.isSkinnedMesh) skinned = child; });
  assert.ok(skinned, 'the exported file loads back with its skinned mesh');
  assert.deepEqual(skinned.skeleton.bones.map(bone => bone.name), ['rootBone']);
  let reachable = false;
  loaded.scene.traverse(child => { if (child === skinned.skeleton.bones[0]) reachable = true; });
  assert.ok(reachable, 'the loaded skeleton bone is part of the loaded scene');
});
