// Spatial preparation reads every instance off the UI thread. Each patch goes
// into one bin, whose bounds include its entire transformed base geometry.
self.onmessage = ({data: {matrices, count, min, max, divisions}}) => {
  try {
    const centre = min.map((x, k) => (x + max[k]) / 2);
    const half = min.map((x, k) => (max[k] - x) / 2);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    function bounds(id, low, high) {
      const at = id * 16;
      for (let k = 0; k < 3; k++) {
        const c = matrices[at + k] * centre[0] + matrices[at + 4 + k] * centre[1]
          + matrices[at + 8 + k] * centre[2] + matrices[at + 12 + k];
        const r = Math.abs(matrices[at + k]) * half[0] + Math.abs(matrices[at + 4 + k]) * half[1]
          + Math.abs(matrices[at + 8 + k]) * half[2];
        const padding = Number.EPSILON * 8 * (Math.abs(c) + r + 1);
        low[k] = c - r - padding; high[k] = c + r + padding;
        if (!Number.isFinite(low[k]) || !Number.isFinite(high[k])) throw Error('Surfel bounds must be finite');
      }
    }
    const low = [], high = [];
    for (let id = 0; id < count; id++) {
      bounds(id, low, high);
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], low[k]); hi[k] = Math.max(hi[k], high[k]); }
    }
    const width = Math.max(...hi.map((x, k) => x - lo[k])) / divisions || 1;
    const groups = new Map();
    for (let id = 0; id < count; id++) {
      bounds(id, low, high);
      const key = low.map((x, k) => Math.floor(((x + high[k]) / 2 - lo[k]) / width)).join(',');
      let bin = groups.get(key);
      if (!bin) groups.set(key, bin = {min: [...low], max: [...high], ids: []});
      for (let k = 0; k < 3; k++) { bin.min[k] = Math.min(bin.min[k], low[k]); bin.max[k] = Math.max(bin.max[k], high[k]); }
      bin.ids.push(id);
    }
    const bins = [...groups.values()].map(bin => ({...bin, ids: Uint32Array.from(bin.ids)}));
    self.postMessage({bins}, bins.map(bin => bin.ids.buffer));
  } catch (error) { self.postMessage({error: error.message}); }
};
