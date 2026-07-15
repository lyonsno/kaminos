export function installVolumeRuntimeForwarders(targetWindow, basin) {
  Object.defineProperty(targetWindow, '__kaminosVolumePrototype', {
    get: () => basin.contentWindow?.__kaminosVolumePrototype || null,
  });
  Object.defineProperty(targetWindow, '__kaminosVolumeBridge', {
    get: () => basin.contentWindow?.__kaminosVolumeBridge || null,
  });
  return { identity: 'exact-same-origin-volume-runtime-forwarders-v0' };
}
