import { createKleinApp } from '@kaminos/flux2-klein';
import { createElement, Download, Maximize, Square, Pause, Play } from 'lucide';
import { createImageView } from './image-view.js';
import { createProgressView } from './progress-view.js';

const get = id => document.getElementById(id);
const icons = { Download, Maximize, Square, Pause, Play };
for (const button of document.querySelectorAll('[data-icon]')) {
  button.replaceChildren(createElement(icons[button.dataset.icon]));
}

let klein, viewer, image, running = false, closed = false;
let paused = false, stopping = false, request = 0;
const progress = createProgressView(get);
const status = text => { get('status').textContent = text; };
const showError = error => { get('error').textContent = error.message; };

async function initialize() {
  try {
    // The application and image view use one device. No weights load until Generate.
    const weights = new URLSearchParams(location.search).get('weights');
    klein = await createKleinApp({ load: false,
      pipelineOptions: weights === null ? {} : { weightsBase: weights },
      onProgress: progress.loading,
    });
    viewer = await createImageView(get('image'), klein.device, klein.foreground, showError);
    get('generate').disabled = false;
    status('');
  } catch (error) {
    showError(error);
    status('WebGPU unavailable');
    await klein?.destroy();
  }
}
void initialize();

get('prompt-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!viewer || running || closed) return;
  running = true;
  request++; paused = stopping = false;
  get('generate').disabled = true;
  get('pause').replaceChildren(createElement(Pause));
  get('pause').title = get('pause').ariaLabel = 'Pause generation';
  get('error').textContent = '';
  progress.start(klein.snapshot().loaded);
  const options = { prompt: get('prompt').value, seed: Number(get('seed').value),
    width: Number(get('size').value), height: Number(get('size').value), steps: Number(get('steps').value) };
  try {
    await klein.load();
    if (closed) return;
    get('stop').disabled = get('pause').disabled = false;
    progress.beginGeneration();
    const result = await klein.generate({ ...options, textLength: 'fit16',
      onPhase: progress.phase, onStep: progress.step, scheduling: { onDuty: progress.duty },
    });
    if (closed) return;
    viewer.setImage(result);
    viewer.fit(); get('zoom').value = '1';
    image = result;
    get('image-label').textContent = `${image.width} x ${image.height}`;
    progress.finish('Image complete');
  } catch (error) {
    progress.finish(error.name === 'AbortError' ? 'Stopped' : 'Generation failed');
    if (error.name !== 'AbortError') showError(error);
  } finally {
    running = false;
    get('generate').disabled = closed;
    get('stop').disabled = get('pause').disabled = true;
    get('download').disabled = !image;
  }
});

get('stop').addEventListener('click', () => {
  stopping = true; klein.stop(); get('stop').disabled = get('pause').disabled = true;
  progress.control('Stopping generation');
});
get('pause').addEventListener('click', async () => {
  if (!running || stopping) return;
  const current = request, wasPaused = paused;
  get('pause').disabled = true;
  progress.control(wasPaused ? 'Resuming generation' : 'Pausing generation');
  try {
    const state = await (wasPaused ? klein.resume() : klein.pause());
    if (!running || stopping || current !== request) return;
    paused = state === 'paused';
    get('pause').replaceChildren(createElement(paused ? Play : Pause));
    get('pause').title = get('pause').ariaLabel = paused ? 'Resume generation' : 'Pause generation';
    progress.control(paused ? 'Generation paused' : null);
  } catch (error) {
    if (running && !stopping && current === request) { showError(error); progress.control(wasPaused ? 'Generation paused' : null); }
  } finally { if (running && !stopping && current === request) get('pause').disabled = false; }
});
get('zoom').addEventListener('input', event => viewer?.setZoom(Number(event.target.value)));
get('fit').addEventListener('click', () => { viewer?.fit(); get('zoom').value = '1'; });
get('download').addEventListener('click', () => {
  if (!image) return;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d').putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  canvas.toBlob(blob => {
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'klein.png'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  });
});

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  closed = true;
  progress.destroy();
  viewer?.destroy();
  klein?.destroy().catch(console.error);
});
