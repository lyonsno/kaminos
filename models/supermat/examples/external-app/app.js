import { createSuperMatApp, decodeImageRgba } from '@kaminos/supermat';
const $ = id => document.getElementById(id), q = new URLSearchParams(location.search);
const state = window.supermatExample = { status: 'starting', frames: 0, gpuErrors: [], runs: [],
  frameTiming: { lastSubmittedAt: null, lastGapMs: null, longestGapMs: null } };
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
  state.frameTiming = { lastSubmittedAt: null, lastGapMs: null, longestGapMs: null };
  $('frame-gap').textContent = 'Waiting for two draw submissions…';
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
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device: app.device, format, alphaMode: 'opaque' });
  const uniform = app.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = app.device.createShaderModule({ code: `
    @group(0) @binding(0) var<uniform> u: vec4f;
    @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
      return vec4f(array(vec2f(-1,-1), vec2f(3,-1), vec2f(-1,3))[i], 0, 1);
    }
    @fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
      let margin = 28.0;
      let span = u.y - margin * 2.0;
      let x = p.x - margin;
      var color = vec3f(0.07, 0.10, 0.12);
      if (x >= 0 && x <= span) {
        if (abs(p.y - 64.0) < 1.0) { color = vec3f(0.30, 0.38, 0.41); }
        let tick = abs(x - round(x / (span / 10.0)) * (span / 10.0));
        if (tick < 1.0 && p.y >= 57.0 && p.y <= 72.0) { color = vec3f(0.55, 0.65, 0.69); }
      }
      let marker = abs(p.xy - vec2f(margin + u.x * span, 37.0));
      if (marker.x < 8.0 && marker.y < 19.0) { color = vec3f(1.0, 0.80, 0.28); }
      if (marker.x < 2.0 && marker.y < 14.0) { color = vec3f(1.0); }
      return vec4f(color, 1.0);
    }` });
  const pipeline = await app.device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] } });
  const binding = app.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  const startedAt = performance.now();
  let sequence = 0;
  const frame = () => {
    if (stopped) return;
    app.foreground.request({ requestId: `example:${++sequence}`, run: opportunity => {
      // Wall-clock position, sampled when allowed to draw. A delayed opportunity
      // jumps forward; it never slows the animation to conceal the missing draws.
      const now = performance.now(), position = 1 - Math.abs(((now - startedAt) / 1500) % 2 - 1);
      app.device.queue.writeBuffer(uniform, 0, new Float32Array([position, $('scene').width, 0, 0]));
      const encoder = app.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.draw(3);
      pass.end(); const { submittedAtMs } = opportunity.submit([encoder.finish()]);
      // Submission spacing is observable here; GPU completion and screen
      // presentation are not. Keep the readout literal, without FPS averaging.
      const timing = state.frameTiming;
      if (timing.lastSubmittedAt !== null) {
        timing.lastGapMs = submittedAtMs - timing.lastSubmittedAt;
        timing.longestGapMs = Math.max(timing.longestGapMs ?? 0, timing.lastGapMs);
        $('frame-gap').textContent = `Draw submission gap: ${timing.lastGapMs.toFixed(1)} ms · Longest: ${timing.longestGapMs.toFixed(1)} ms`;
      }
      timing.lastSubmittedAt = submittedAtMs;
    } }).completion.then(receipt => { if (receipt.status === 'completed') { state.frames++; if (!stopped) requestAnimationFrame(frame); } });
  };
  requestAnimationFrame(frame); $('destroy').disabled = false;
  state.status = 'idle'; show('Choose an image. Model weights load on the first inference.');
} catch (error) { state.status = 'error'; state.error = String(error); show(String(error)); }
