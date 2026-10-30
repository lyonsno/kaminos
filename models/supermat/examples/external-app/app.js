import { createSuperMatApp, decodeImageRgba } from '@kaminos/supermat';
import { createElement, Download, Maximize, Pause, Play, Square } from 'lucide';
import { createImageView } from './image-view.js';
import sampleUrl from './sample.webp';

const $ = id => document.getElementById(id);
const tabs = [...document.querySelectorAll('[data-map]')];
const icons = { Download, Maximize, Pause, Play, Square };
for (const button of document.querySelectorAll('[data-icon]')) {
  button.prepend(createElement(icons[button.dataset.icon]));
}
let app, viewer, image, maps = {}, selected = 'input', filename = 'backpack';
let busy = false, inferring = false, paused = false, changingPause = false;
const show = text => { $('status').textContent = text; };
const fail = error => { $('error').textContent = error.message || String(error); };
function controls() {
  $('run').disabled = busy || !image;
  $('file').disabled = busy || !viewer;
  $('size').disabled = busy;
  $('pause').disabled = !inferring || changingPause;
  $('stop').disabled = !inferring;
  $('download').disabled = selected === 'input' || !maps[selected];
  for (const tab of tabs) tab.disabled = tab.dataset.map !== 'input' && !maps[tab.dataset.map];
}
function select(name) {
  const map = name === 'input' ? image : maps[name];
  if (!map) return;
  selected = name;
  viewer.setImage(map);
  $('dimensions').textContent = `${map.width} x ${map.height}`;
  for (const tab of tabs) tab.setAttribute('aria-pressed', String(tab.dataset.map === name));
  controls();
}
async function loadImage(blob, name) {
  const decoded = await decodeImageRgba(blob, app.device);
  image = decoded; maps = {}; filename = name.replace(/\.[^.]+$/, '');
  $('image-name').textContent = name;
  select('input'); viewer.fit(); $('zoom').value = '1';
  show('Image loaded');
}
$('file').onchange = async () => {
  const file = $('file').files[0];
  if (!file || busy) return;
  busy = true; controls(); $('error').textContent = '';
  try { await loadImage(file, file.name); }
  catch (error) { fail(error); }
  finally { busy = false; $('file').value = ''; controls(); }
};
for (const tab of tabs) tab.onclick = () => select(tab.dataset.map);
$('zoom').oninput = () => viewer?.setZoom(Number($('zoom').value));
$('fit').onclick = () => { viewer?.fit(); $('zoom').value = '1'; };
$('run').onclick = async () => {
  if (busy || !image) return;
  const input = image, size = Number($('size').value);
  if (!Number.isSafeInteger(size) || size < 64 || size % 64) {
    fail(new Error('Map size must be a positive multiple of 64')); return;
  }
  busy = true; controls(); $('error').textContent = '';
  try {
    show('Loading model');
    await app.load();
    inferring = true; controls();
    const phases = { preprocess: 'Preparing image', encode: 'Encoding image', unet: 'Inferring materials',
      'decode-albedo': 'Decoding albedo', 'decode-orm': 'Decoding surface maps', 'pack-maps': 'Finishing maps' };
    const result = await app.infer({ image: input, size, onRunProgress: progress => {
      if (!paused) show(phases[progress.phase] || 'Inferring materials');
    } });
    maps = result.maps; select('albedo'); show('Materials complete');
  } catch (error) {
    if (error.name === 'AbortError') show('Inference stopped');
    else { show('Inference failed'); fail(error); }
  } finally {
    busy = false; inferring = false; paused = false;
    $('pause').replaceChildren(createElement(Pause)); $('pause').title = 'Pause'; $('pause').setAttribute('aria-label', 'Pause');
    controls();
  }
};
$('pause').onclick = async () => {
  if (!inferring || changingPause) return;
  changingPause = true; controls();
  try {
    if (paused) await app.resume(); else await app.pause();
    if (inferring) {
      paused = !paused;
      $('pause').replaceChildren(createElement(paused ? Play : Pause));
      $('pause').title = paused ? 'Resume' : 'Pause';
      $('pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
      show(paused ? 'Inference paused' : 'Inferring materials');
    }
  } catch (error) { fail(error); }
  finally { changingPause = false; controls(); }
};
$('stop').onclick = async () => {
  if (!inferring) return;
  try { show('Stopping inference'); await app.stop(); } catch (error) { fail(error); }
};
$('download').onclick = () => {
  const map = maps[selected];
  if (!map) return;
  const canvas = document.createElement('canvas'); canvas.width = map.width; canvas.height = map.height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(map.data), map.width, map.height), 0, 0);
  const name = `${filename}-${selected}.png`;
  canvas.toBlob(blob => {
    if (!blob) { fail(new Error('PNG export failed')); return; }
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
};
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  viewer?.destroy(); app?.destroy().catch(console.error);
});
async function start() {
  try {
    const weightsUrl = new URLSearchParams(location.search).get('weights');
    app = await createSuperMatApp({ load: false, ...(weightsUrl ? { weightsUrl } : {}),
      onProgress: progress => {
        if (progress.phase === 'weights') show(`Loading model: ${progress.resourceIndex + 1} / ${progress.resourceCount}`);
      } });
    viewer = await createImageView($('image'), app.device, app.foreground, fail);
    const response = await fetch(new URL(sampleUrl, import.meta.url));
    if (!response.ok) throw new Error('Could not load the sample image');
    await loadImage(await response.blob(), 'Backpack');
  } catch (error) { show('Application could not start'); fail(error); }
  finally { controls(); }
}
start();
