import { buildKimodoHindquartersTrack } from './motion-rig-retarget-core.mjs';

export async function decodeRetainedMotionClip(bytes, { expectedSha256 = '' } = {}) {
  if (!bytes?.byteLength) throw new Error('Retained motion clip is blank');
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error('Retained motion clip hash mismatch');
  const result = JSON.parse(new TextDecoder().decode(bytes));
  const declaredFrames = result.numFrames ?? result.num_frames;
  if (!Number.isInteger(declaredFrames) || declaredFrames !== result.joints?.length) {
    throw new Error('Retained motion clip frame count is incomplete or inconsistent');
  }
  const track = buildKimodoHindquartersTrack(result);
  return { result, sha256, frameCount: track.frameCount, fps: track.fps, authority: 'retained-motion-playback' };
}

export async function loadRetainedMotionClip(url, { fetchImpl = fetch, expectedSha256 = '', signal } = {}) {
  const response = await fetchImpl(url, { signal });
  if (!response.ok) throw new Error(`Retained motion clip request failed (${response.status})`);
  return decodeRetainedMotionClip(await response.arrayBuffer(), { expectedSha256 });
}

// Presentation only: preserve the imported pair and its original visibility.
export function focusRigMeshes(meshes, target) {
  if (!meshes.includes(target)) throw new Error('Focus target is not in this rig object');
  const before = meshes.map(mesh => [mesh, mesh.visible]);
  for (const mesh of meshes) mesh.visible = mesh === target;
  return () => { for (const [mesh, visible] of before) mesh.visible = visible; };
}
