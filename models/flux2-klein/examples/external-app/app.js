import { createKleinApp } from '@kaminos/flux2-klein';
import { createElement, Download, Maximize, Square } from 'lucide';
import { createImageView } from './image-view.js';

const get = id => document.getElementById(id);
const icons = { Download, Maximize, Square };
for (const button of document.querySelectorAll('[data-icon]')) {
  button.replaceChildren(createElement(icons[button.dataset.icon]));
}

let klein, viewer, image, running = false, closed = false;
const status = text => { get('status').textContent = text; };
const showError = error => { get('error').textContent = error.message; };

async function initialize() {
  try {
    // The application and image view use one device. No weights load until Generate.
    const weights = new URLSearchParams(location.search).get('weights');
    klein = await createKleinApp({ load: false,
      pipelineOptions: weights === null ? {} : { weightsBase: weights },
      onProgress: (part, file, progress) => {
        const loaded = Math.round(progress.loadedBytes / 1e6);
        const total = Math.round(progress.totalBytes / 1e6);
        status(`Loading ${part}: ${loaded} / ${total} MB`);
      },
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
  get('generate').disabled = get('download').disabled = true;
  get('error').textContent = '';
  status('Loading model');
  const options = { prompt: get('prompt').value, seed: Number(get('seed').value),
    width: Number(get('size').value), height: Number(get('size').value), steps: Number(get('steps').value) };
  try {
    await klein.load();
    if (closed) return;
    get('stop').disabled = false;
    const result = await klein.generate({ ...options, textLength: 'fit16',
      onPhase: phase => status(`Generating: ${phase}`),
      onStep: (step, steps) => status(`Step ${step} of ${steps}`),
    });
    if (closed) return;
    viewer.setImage(result);
    viewer.fit(); get('zoom').value = '1';
    image = result;
    get('image-label').textContent = `${image.width} x ${image.height}`;
    status('');
  } catch (error) {
    if (error.name === 'AbortError') status('Stopped');
    else { showError(error); status(''); }
  } finally {
    running = false;
    get('generate').disabled = closed;
    get('stop').disabled = true;
    get('download').disabled = !image;
  }
});

get('stop').addEventListener('click', () => {
  klein.stop(); get('stop').disabled = true; status('Stopping');
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
  viewer?.destroy();
  klein?.destroy().catch(console.error);
});
