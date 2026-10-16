// GPU utilization beside the witnesses' frame-rate windows, so a run on a
// contended box labels itself. macOS reports whole-device utilization through
// the IOAccelerator registry entry; it includes the witness's own page, so the
// ambient reading taken before the browser starts is what tells a busy box from
// a busy page.
import { execFile } from 'node:child_process';

const IOREG = '/usr/sbin/ioreg';
const AMBIENT_BUSY_PERCENT = 15;

export function parseAcceleratorUtilization(text) {
 const stats = /"PerformanceStatistics" = \{([^}]*)\}/.exec(String(text || ''))?.[1];
 if (!stats) return null;
 const read = name => { const m = new RegExp(`"${name} Utilization %"=(\\d+(?:\\.\\d+)?)`).exec(stats); return m ? Number(m[1]) : null; };
 const device = read('Device');
 if (device === null) return null;
 return { device, renderer: read('Renderer'), tiler: read('Tiler') };
}

function readIoreg() {
 return new Promise((resolve, reject) => execFile(IOREG, ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 5000 },
  (error, stdout) => error ? reject(error) : resolve(stdout)));
}

const median = values => { const v = values.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

export function summarizeUtilization(samples, { from, to, intervalMs = 250, lastError = null } = {}) {
 const inside = samples.filter(s => s.t >= from && s.t <= to);
 if (!inside.length) {
  return { available: false, samples: 0, deviceMedian: null, deviceP90: null, deviceMax: null, rendererMedian: null, tilerMedian: null,
   reason: `no samples in window${lastError ? `; last read error: ${lastError}` : ''}` };
 }
 const device = inside.map(s => s.device).sort((a, b) => a - b);
 const expected = Math.max(1, Math.floor((to - from) / intervalMs));
 return { available: true, samples: inside.length, partial: inside.length < expected / 2,
  deviceMedian: median(device), deviceP90: device[Math.floor(device.length * 0.9)], deviceMax: device[device.length - 1],
  rendererMedian: median(inside.map(s => s.renderer)), tilerMedian: median(inside.map(s => s.tiler)),
  ...(lastError ? { lastError } : {}) };
}

export function createGpuUtilizationSampler({ read = readIoreg, intervalMs = 250, now = Date.now } = {}) {
 const samples = [];
 let running = false, loop = null, lastError = null;
 return {
  start() {
   if (running) return;
   running = true;
   loop = (async () => {
    while (running) {
     try {
      const reading = parseAcceleratorUtilization(await read());
      if (reading) samples.push({ t: now(), ...reading });
      else lastError = 'ioreg output had no accelerator utilization';
     } catch (error) { lastError = String(error?.message || error); }
     await new Promise(r => setTimeout(r, intervalMs));
    }
   })();
  },
  async stop() { running = false; await loop; },
  summarize({ from, to }) { return summarizeUtilization(samples, { from, to, intervalMs, lastError }); },
 };
}

// One measurement window's share, by the wall-clock bounds the page reported.
export function windowUtilization(sampler, bounds) {
 if (!sampler) return { available: false, reason: 'GPU sampler not running for this scenario' };
 if (!(Array.isArray(bounds) && bounds.length === 2 && bounds.every(Number.isFinite))) return { available: false, reason: 'window carried no wall-clock bounds' };
 return sampler.summarize({ from: bounds[0], to: bounds[1] });
}

export function ambientGpuLabel(summary) {
 const label = !summary?.available ? 'unknown' : summary.deviceMedian >= AMBIENT_BUSY_PERCENT ? 'busy' : 'quiet';
 return { label, thresholdPercent: AMBIENT_BUSY_PERCENT };
}
