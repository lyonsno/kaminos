import { createU2NetApp } from '@kaminos/u2net';
import { createElement, Download, Maximize, Square, Pause, Play, Upload } from 'lucide';
import { createImageView } from './image-view.js';
import { readImage, downloadPng } from './image-io.js';
import { createProgressView } from './progress-view.js';
import sampleUrl from './sample.png';

const get = id => document.getElementById(id);
const icons = { Download, Maximize, Square, Pause, Play, Upload };
for (const button of document.querySelectorAll('[data-icon]')) button.replaceChildren(createElement(icons[button.dataset.icon]));
const progress = createProgressView(get);
let app, view, source, result, name = 'Sneaker', loaded = false, busy = true, selecting = false;
let stopped = false, paused = false, closed = false, controlSerial = 0;
function controls() {
  get('remove').disabled = busy || selecting || !app || !source;
  get('file').disabled = get('upload').disabled = busy || selecting;
  get('stop').disabled = !busy || !app || stopped;
  get('download').disabled = !result;
  for (const mode of ['cutout', 'compare']) get(mode).disabled = !result;
}
function mode(value) {
  view?.setMode(value);
  for (const key of ['original', 'cutout', 'compare']) get(key).setAttribute('aria-pressed', key === value);
  get('split-control').hidden = value !== 'compare';
}
function pauseIcon() {
  get('pause').replaceChildren(createElement(paused ? Play : Pause));
  get('pause').setAttribute('aria-label', paused ? 'Resume removal' : 'Pause removal');
  get('pause').setAttribute('title', paused ? 'Resume removal' : 'Pause removal');
}
async function connect() {
  const weightsUrl = new URLSearchParams(location.search).get('weights');
  app = await createU2NetApp({ load: false, ...(weightsUrl ? { weightsUrl } : {}), onProgress() {} });
  view = await createImageView(get('image'), app.device, app.foreground, error => { get('error').textContent = error.message; });
  if (source) view.setImages(source, result);
  mode(result ? 'compare' : 'original');
}
async function select(input, label) {
  if (busy || selecting) return;
  selecting = true; controls(); get('error').textContent = '';
  try {
    const image = await readImage(input);
    view.setImages(image, null);
    source = image; result = null; name = label;
    mode('original'); view.fit(); get('zoom').value = '1';
    get('image-label').textContent = `${name} | ${source.width} x ${source.height}`;
    get('status').textContent = 'Image selected';
    get('dimensions').textContent = '--';
  } catch (error) { get('error').textContent = error.message; }
  finally { selecting = false; controls(); }
}
get('upload').addEventListener('click', () => get('file').click());
get('file').addEventListener('change', () => {
  const file = get('file').files[0]; if (file) void select(file, file.name);
  get('file').value = '';
});
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => {
  event.preventDefault(); const file = event.dataTransfer?.files[0]; if (file) void select(file, file.name);
});
get('remove').addEventListener('click', async () => {
  if (busy || selecting || !source || !app) return;
  busy = true; stopped = paused = false; controlSerial++; pauseIcon();
  get('pause').disabled = true; get('error').textContent = ''; controls(); progress.start(loaded);
  try {
    const hasAlpha = source.rgba.some((value, index) => index % 4 === 3 && value !== 255);
    if (hasAlpha) {
      result = source;
    } else {
      if (!loaded) { await app.load(); loaded = true; }
      if (stopped || closed) throw new DOMException('Stopped', 'AbortError');
      progress.beginInference();
      result = await app.removeForeground({ pixels: source.rgba, width: source.width, height: source.height, channels: 4,
        onPhase(phase) { if (!stopped) get('pause').disabled = false; progress.phase(phase); } });
    }
    view.setImages(source, result); mode('compare');
    get('dimensions').textContent = `${result.width} x ${result.height}`;
    get('image-label').textContent = `${name} | Cutout ${result.width} x ${result.height}`;
    progress.finish(hasAlpha ? 'Existing transparency retained' : 'Cutout complete');
  } catch (error) {
    progress.finish(stopped || error.name === 'AbortError' ? 'Removal stopped' : 'Removal failed');
    if (!stopped && error.name !== 'AbortError') get('error').textContent = error.message;
    if (!loaded && !closed) {
      view?.destroy(); await app.destroy().catch(() => {}); app = view = null;
      try { await connect(); } catch (reconnectError) { get('error').textContent = reconnectError.message; }
    }
  } finally { busy = false; controlSerial++; get('pause').disabled = true; controls(); }
});
get('pause').addEventListener('click', async () => {
  if (!busy || stopped) return;
  const serial = ++controlSerial, wasPaused = paused;
  get('pause').disabled = true; progress.control(wasPaused ? 'Resuming removal' : 'Pausing removal');
  try {
    const state = await (wasPaused ? app.resume() : app.pause());
    if (!busy || stopped || serial !== controlSerial) return;
    paused = state?.status === 'paused'; pauseIcon(); progress.control(paused ? 'Removal paused' : '');
  } catch (error) { if (serial === controlSerial) { get('error').textContent = error.message; progress.control(''); } }
  finally { if (busy && !stopped && serial === controlSerial) get('pause').disabled = false; }
});
get('stop').addEventListener('click', () => {
  if (!busy || stopped) return;
  stopped = true; controlSerial++; progress.control('Stopping removal'); get('pause').disabled = true;
  app.stop();
  if (!loaded) { view?.destroy(); void app.destroy().catch(error => { get('error').textContent = error.message; }); }
  controls();
});
for (const value of ['original', 'cutout', 'compare']) get(value).addEventListener('click', () => mode(value));
get('split').addEventListener('input', () => view?.setSplit(Number(get('split').value)));
get('zoom').addEventListener('input', () => view?.setZoom(Number(get('zoom').value)));
get('fit').addEventListener('click', () => { view?.fit(); get('zoom').value = '1'; });
for (const button of document.querySelectorAll('[data-background]')) button.addEventListener('click', () => {
  view?.setBackground(button.dataset.background);
  for (const item of document.querySelectorAll('[data-background]')) item.setAttribute('aria-pressed', item === button);
});
get('download').addEventListener('click', async () => {
  if (!result) return;
  try { await downloadPng(result, `${name.replace(/\.[^.]+$/, '')}-cutout.png`); }
  catch (error) { get('error').textContent = error.message; }
});
window.addEventListener('pagehide', () => { closed = true; progress.destroy(); view?.destroy(); void app?.destroy().catch(() => {}); });
async function start() {
  try { await connect(); busy = false; await select(new URL(sampleUrl, import.meta.url).href, name); }
  catch (error) { get('status').textContent = 'Unable to open studio'; get('error').textContent = error.message; }
  finally { busy = false; get('pause').disabled = true; controls(); }
}
void start();
