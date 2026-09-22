export async function mountKaminosSharedDeviceComposition({
  compositionModule,
  prototype,
  params,
  sharedGpu,
  host,
} = {}) {
  if (typeof compositionModule?.mountComposition !== 'function') {
    throw new Error('shared-device composition module is missing mountComposition');
  }
  if (!prototype?.setActive || !prototype?.debugState) {
    throw new Error('shared-device composition requires a controllable volume prototype');
  }
  await prototype.setActive(true);
  const activated = prototype.debugState();
  if (activated.active !== true) throw new Error('shared-device composition volume activation did not stick');

  const mounted = await compositionModule.mountComposition({ prototype, params, sharedGpu, host });
  const effective = prototype.debugState();
  const hostState = host?.snapshot?.();
  if (
    effective.active !== true
    || effective.ordinaryForeground?.mode !== 'producer-foreground-opportunities'
    || hostState?.foregroundServiceActive !== true
    || mounted?.foregroundConnected !== true
    || mounted?.loadHandlerInstalled !== true
  ) {
    throw new Error('shared-device composition did not transfer frame ownership to the persistent foreground service');
  }
  return Object.freeze({
    status: 'mounted',
    active: true,
    foregroundMode: effective.ordinaryForeground.mode,
    foregroundServiceActive: true,
    foregroundConnected: true,
    loadHandlerInstalled: true,
  });
}
