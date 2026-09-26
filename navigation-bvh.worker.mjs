import {BufferAttribute, BufferGeometry} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

self.onmessage = ({data}) => {
  const {id, position, index, groups} = data;
  try {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    const effectiveIndex = index || Uint32Array.from({length: position.length / 3}, (_, i) => i);
    geometry.setIndex(new BufferAttribute(effectiveIndex, 1));
    for (const group of groups) geometry.addGroup(group.start, group.count, group.materialIndex);
    const tree = MeshBVH.serialize(new MeshBVH(geometry, {indirect: true}), {cloneBuffers: false});
    const transfers = [...tree.roots, tree.indirectBuffer, effectiveIndex].filter(Boolean);
    self.postMessage({id, roots: tree.roots, indirectBuffer: tree.indirectBuffer, index: effectiveIndex},
      transfers.map(buffer => buffer.buffer ?? buffer));
  } catch (error) {
    self.postMessage({id, error: error?.message || String(error)});
  }
};
