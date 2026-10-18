// Fire proxy reconciliation, run once per viewport frame: heat-block splats
// drawn from snapshots of the fire's residual probe readback stand in for the
// flame in Proxy display. The page supplies the snapshot registry, the splat
// layer factory and the flame domain; each frame passes the volume prototype,
// the display request, the viewport camera, the fire canvas and the bridge.
// Prototype pending the probe owner's answer on the readback seam.
import {decodeHeatBlocks,nextHeatReference} from './proxy-snapshot.mjs';
import {pickFireSplats} from './fire-splat-picking.mjs';

export function createFireProxySync({registry, createLayer, readDomain, now = () => performance.now(), onDirty = () => {}}) {
 let fireProxy = null;
 function sync({prototype, display: displayRequested, visible=true, required, pickable=false, camera, layerId, canvas, bridge, stepEvery = 1}) {
  // A disabled volume shows no fire in any mode, so its proxy draws nothing;
  // pausing is different and keeps the held field on screen.
  const present = !!prototype && (prototype.isActive?.() ?? true);
  const display = displayRequested && present && visible, wanted = present && (display || required);
  camera?.layers[display ? 'enable' : 'disable'](layerId);
  if (fireProxy && fireProxy.prototype !== prototype) {
   fireProxy.prototype?.setResidualPartialsConsumer?.(null); fireProxy.prototype?.setCanvasPresentationSuppressed?.(false); fireProxy.prototype?.setProxyPacing?.(null);
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
  const produce = !!fireProxy && (wanted || (present&&pickable) || registry.wanted('fire'));
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
  const hidden = !visible || ready;
  if (fireProxy && hidden && !fireProxy.hiddenCanvas && canvas) { canvas.style.visibility = 'hidden'; fireProxy.hiddenCanvas = canvas; }
  if (fireProxy?.hiddenCanvas && (!hidden || fireProxy.hiddenCanvas !== canvas)) { fireProxy.hiddenCanvas.style.visibility = ''; fireProxy.hiddenCanvas = null; }
  if (fireProxy) { fireProxy.awaitingSnapshot = display && !ready; fireProxy.ready = ready; }
  // While the splats stand in, the fire's own canvas raymarch is not drawn.
  if (prototype && fireProxy && fireProxy.presentationSuppressed !== hidden) fireProxy.presentationSuppressed = prototype.setCanvasPresentationSuppressed?.(hidden) ?? false;
  // The scene light field is rebuilt only when a snapshot publishes, so the
  // lighting stays in step with the splats; the sim itself steps every
  // stepEvery frames (1 unless opted in).
  // stepEvery 0 holds the simulation while the proxy stands in (Preferences).
  const held = Number(stepEvery) === 0, every = held ? 1 : Math.max(1, Math.floor(Number(stepEvery) || 1));
  const pacingKey = ready ? `snapshots:${held ? 'held' : every}` : null;
  if (prototype && fireProxy && fireProxy.pacingKey !== pacingKey) {
   prototype.setProxyPacing?.(ready ? {lightFieldWithSnapshots: true, simStepEvery: every, ...(held ? {simPaused: true} : {})} : null);
   fireProxy.pacingKey = pacingKey;
  }
  // Routes that composite the fire through the canvas-texture bridge hide that
  // plane too; animate() stops refreshing it while Proxy is effective.
  if (hidden && bridge?.mesh) bridge.mesh.visible = false;
 }
 return {
  sync,
  pick(ray,cameraPosition,options={}) {
   const prototype=fireProxy?.prototype;
   if(!prototype||(prototype.isActive?.()??true)===false)return null;
   if(fireProxy.ready&&fireProxy.layer?.group.visible===false)return null;
   return pickFireSplats(registry.latest('fire'),ray,cameraPosition,{...options,
    fieldGeneration:prototype.getResidualFieldGeneration?.()??null,style:fireProxy.layer?.state().style});
  },
  // Proxy is standing in for the fire this frame.
  effective: () => fireProxy?.ready === true,
  layer: () => fireProxy?.layer ?? null,
  state: () => ({attached: fireProxy?.attached ?? false, awaitingSnapshot: fireProxy?.awaitingSnapshot ?? false, fieldGeneration: fireProxy?.fieldGeneration ?? null,
   presentationSuppressed: fireProxy?.presentationSuppressed ?? false, pacing: fireProxy?.pacingKey ?? null, decodeErrors: fireProxy?.decodeErrors ?? 0, lastError: fireProxy?.lastError ?? null,
   layer: fireProxy?.layer?.state() ?? {visible: false}}),
 };
}
