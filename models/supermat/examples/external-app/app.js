import { createSuperMatApp, decodeImageRgba } from '@kaminos/supermat';
const $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
const state = window.supermatExample = { status: 'starting', frames: 0, gpuErrors: [], runs: [] };
let app, image, stopped = false, busy = false;
const show = text => { $('status').textContent = text; };
const draw = (id, map) => {
  const canvas = $(id); canvas.width = map.width; canvas.height = map.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.data), map.width, map.height), 0, 0);
};
function controls() {
  $('run').disabled = busy || !image || stopped;
  $('file').disabled = busy || stopped; $('size').disabled = busy || stopped;
  $('pause').disabled = !busy; $('stop').disabled = !busy; $('destroy').disabled = busy || stopped;
}
async function infer() {
  if (busy || stopped || !image) return;
  const framesBefore = state.frames;
  busy = true; state.status = 'running'; controls(); $('pause').textContent = 'Pause';
  try {
    const result = await app.infer({ image, size: Number($('size').value),
      onRunProgress: progress => show(`${progress.phase} · ${progress.duties} cooperative duties`) });
    for (const name of ['albedo', 'roughness', 'metallic']) draw(name, result.maps[name]);
    state.runs.push({ identity: result.identity, width: result.width, height: result.height,
      dutyCount: result.dutyCount, frames: state.frames - framesBefore, cpuWorker: result.cpuWorker });
    state.status = 'done'; show('Material maps complete. Choose another image or infer again.');
  } catch (error) { state.status = error.name === 'AbortError' ? 'stopped' : 'error'; state.error = String(error); show(error.name === 'AbortError' ? 'Stopped. You can infer again.' : String(error)); }
  finally { busy = false; controls(); }
}
$('file').onchange = async () => {
  try { image = await decodeImageRgba($('file').files[0], app.device); draw('input', image); state.status = 'image'; controls(); show('Image loaded. Infer materials when you want.'); }
  catch (error) { state.status = 'error'; show(String(error)); }
};
$('run').onclick = infer;
$('pause').onclick = async () => {
  const current = app.snapshot().control;
  if (!current) return;
  try {
    if (current.status === 'paused' || current.pauseRequested) { await app.resume(); $('pause').textContent = 'Pause'; }
    else { await app.pause(); $('pause').textContent = 'Resume'; }
  } catch (error) { show(String(error)); }
};
$('stop').onclick = () => app.stop();
$('destroy').onclick = async () => { stopped = true; controls(); await app.destroy(); state.status = 'destroyed'; show('Model resources released. Reload to start a new application.'); };
try {
  app = window.supermatApp = await createSuperMatApp({ load: false,
    ...(q.get('weights') ? { weightsUrl: q.get('weights') } : {}),
    onProgress: p => show(`Loading ${p.resourceIndex + 1}/${p.resourceCount} weight resources…`) });
  app.device.addEventListener('uncapturederror', e => state.gpuErrors.push(e.error.message));
  const context = $('scene').getContext('webgpu');
  context.configure({ device: app.device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'opaque' });
  let sequence = 0;
  const frame = time => {
    if (stopped) return;
    app.foreground.request({ requestId: `example:${++sequence}`, run: opportunity => {
      const encoder = app.device.createCommandEncoder();
      const color = .2 + .15 * Math.sin(time / 350);
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [color, .25, .35 + color, 1] }] });
      pass.end(); opportunity.submit([encoder.finish()]);
    } }).completion.then(receipt => { if (receipt.status === 'completed') { state.frames++; if (!stopped) requestAnimationFrame(frame); } });
  };
  requestAnimationFrame(frame); $('destroy').disabled = false;
  state.status = 'idle'; show('Choose an image. Model weights load on the first inference.');
} catch (error) { state.status = 'error'; state.error = String(error); show(String(error)); }
