// Fire proxy reconciliation, run once per viewport frame: heat-block splats
// drawn from snapshots of the fire's residual probe readback stand in for the
// flame in Proxy display. The page supplies the snapshot registry, the splat
// layer factory and the flame domain; each frame passes the volume prototype,
// the display request, the viewport camera, the fire canvas and the bridge.
// Prototype pending the probe owner's answer on the readback seam.
import {decodeHeatBlocks,nextHeatReference} from './proxy-snapshot.mjs';

export function createFireProxySync({registry, createLayer, readDomain, now = () => performance.now(), onDirty = () => {}}) {
 let fireProxy = null;
 function sync({prototype, display: displayRequested, required, camera, layerId, canvas, bridge}) {
  // A disabled volume shows no fire in any mode, so its proxy draws nothing;
  // pausing is different and keeps the held field on screen.
  const present = !!prototype && (prototype.isActive?.() ?? true);
  const display = displayRequested && present, wanted = present && (display || required);
  camera?.layers[display ? 'enable' : 'disable'](layerId);
  if (fireProxy && fireProxy.prototype !== prototype) {
   fireProxy.prototype?.setResidualPartialsConsumer?.(null); fireProxy.prototype?.setCanvasPresentationSuppressed?.(false);
   if (fireProxy.hiddenCanvas) fireProxy.hiddenCanvas.style.visibility = '';
   fireProxy.unsubscribe?.(); fireProxy.layer?.dispose(); registry.clear('fire'); fireProxy = null;
  }
  if (prototype && !fireProxy) fireProxy = {prototype, layer: null, unsubscribe: null, attached: false, decodeErrors: 0, heatPeak: 0, hiddenCanvas: null,
   fieldGeneration: prototype.getResidualFieldGeneration?.() ?? null};
  // A recreated field (domain moved or scaled, grid rebuilt) invalidates every
  // snapshot of the old one: nothing stale is drawn while the new one fills.
  // Adopted here each frame, or by the consumer if the new field's first
  // readback lands before this runs.
  const adoptFireField = generation => { if (!fireProxy || generation === fireProxy.fieldGeneration) return; fireProxy.fieldGeneration = generation; fireProxy.heatPeak = 0; registry.clear('fire'); fireProxy.layer?.clear(); };
  adoptFireField(prototype?.getResidualFieldGeneration?.() ?? null);
  const produce = !!fireProxy && (wanted || registry.wanted('fire'));
  if (produce && !fireProxy.attached) fireProxy.attached = prototype.setResidualPartialsConsumer?.(info => {
   const current = prototype.getResidualFieldGeneration?.() ?? null;
   if (info.fieldGeneration != null && info.fieldGeneration !== current) return;
   adoptFireField(current);
   const domain = readDomain(); if (!domain) return;
   try {
    // The glow reference is the field's peak heat so far: it belongs to the
    // field, not to whichever layer is drawing it, so a cooled flame stays
    // dim across display switches and resets only with a new field.
    const snapshot = decodeHeatBlocks(info, {domain, capturedAtMs: now()});
    fireProxy.heatPeak = nextHeatReference(fireProxy.heatPeak, snapshot.summary?.heatMax);
    snapshot.heatReference = fireProxy.heatPeak;
    registry.publish('fire', snapshot);
   } catch (error) { fireProxy.decodeErrors++; fireProxy.lastError = String(error?.message || error); }
  }) ?? false;
  if (fireProxy && !produce && fireProxy.attached) { prototype.setResidualPartialsConsumer?.(null); fireProxy.attached = false; }
  if (fireProxy && wanted && !fireProxy.layer) {
   const layer = createLayer();
   fireProxy.layer = layer; fireProxy.unsubscribe = registry.subscribe('fire', snapshot => { layer.setSnapshot(snapshot); onDirty(); }, {replayLatest: true});
  }
  if (fireProxy && !wanted && fireProxy.layer) { fireProxy.unsubscribe(); fireProxy.layer.dispose(); fireProxy.layer = null; fireProxy.unsubscribe = null; }
  // The full fire stays visible until a snapshot of the current field exists,
  // so selecting Proxy never blanks the flame (a paused sim publishes nothing new).
  const snapshot = registry.latest('fire'), ready = display && !!snapshot && (snapshot.fieldGeneration == null || snapshot.fieldGeneration === fireProxy?.fieldGeneration);
  // Only the visibility this proxy set is touched: it hides the canvas when
  // the splats take over and restores exactly what it hid.
  if (fireProxy && ready && !fireProxy.hiddenCanvas && canvas) { canvas.style.visibility = 'hidden'; fireProxy.hiddenCanvas = canvas; }
  if (fireProxy?.hiddenCanvas && (!ready || fireProxy.hiddenCanvas !== canvas)) { fireProxy.hiddenCanvas.style.visibility = ''; fireProxy.hiddenCanvas = null; }
  if (fireProxy) { fireProxy.awaitingSnapshot = display && !ready; fireProxy.ready = ready; }
  // While the splats stand in, the fire's own canvas raymarch is not drawn.
  if (prototype && fireProxy && fireProxy.presentationSuppressed !== ready) fireProxy.presentationSuppressed = prototype.setCanvasPresentationSuppressed?.(ready) ?? false;
  // Routes that composite the fire through the canvas-texture bridge hide that
  // plane too; animate() stops refreshing it while Proxy is effective.
  if (ready && bridge?.mesh) bridge.mesh.visible = false;
 }
 return {
  sync,
  // Proxy is standing in for the fire this frame.
  effective: () => fireProxy?.ready === true,
  layer: () => fireProxy?.layer ?? null,
  state: () => ({attached: fireProxy?.attached ?? false, awaitingSnapshot: fireProxy?.awaitingSnapshot ?? false, fieldGeneration: fireProxy?.fieldGeneration ?? null,
   presentationSuppressed: fireProxy?.presentationSuppressed ?? false, decodeErrors: fireProxy?.decodeErrors ?? 0, lastError: fireProxy?.lastError ?? null,
   layer: fireProxy?.layer?.state() ?? {visible: false}}),
 };
}
