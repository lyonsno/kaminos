// Command-duty scheduler shared by the Klein text encoder, transformer and VAE.
//
// Without a schedule it reproduces the uncooperative path: work accumulates in one
// encoder and is submitted at model boundaries without waiting, so no command
// buffer spans more than one block. With a schedule (a kit route runtime, its
// queued invocation and optionally an inference control) it follows the pattern
// the SuperMat port established on the same kit: work is submitted as a command
// duty once the encoded FLOPs reach a budget, one duty in flight; each duty waits
// for the previous fence, passes the pause/stop gate, lets pending foreground
// frames submit first through runtime.prepareCommandDutyAtBoundary, then submits.
// The FLOP budget follows measured throughput toward targetDutyMs from completed queue time:
// it shrinks at once when a duty runs long (contention, foreground frames) and grows by at
// most growthLimit per observation. maxInFlight > 1 lets the host encode the next duty while
// the GPU runs the current one, at the cost of longer worst-case waits for foreground frames.

export class KleinDutyScheduler {
  constructor(device, { label = 'klein' } = {}) {
    this.device = device; this.label = label;
    this.schedule = null; this.current = null; this.pendingFlops = 0; this.transient = [];
    this.lastFence = Promise.resolve(); this.adaptiveFlops = null; this.inFlight = [];
    this.stats = { duties: 0, submits: 0, history: [] };
  }

  get cooperative() { return Boolean(this.schedule); }

  // schedule: { runtime, invocation, control, signal, targetDutyMs = 12, dutyFlops = 4e9,
  //             dutyFlopsBounds = [2.5e8, 6.4e10], growthLimit = 1.5, maxInFlight = 1, onDuty }
  setSchedule(schedule) {
    if (this.current || this.transient.length) throw new Error('cannot change the Klein schedule with unsubmitted work');
    if (schedule && (typeof schedule.runtime?.prepareCommandDutyAtBoundary !== 'function'
      || typeof schedule.runtime?.settleCommandDuty !== 'function' || !schedule.invocation)) {
      throw new Error('Klein schedule requires a route runtime and its queued invocation');
    }
    this.schedule = schedule ? { targetDutyMs: 12, dutyFlops: 4e9, dutyFlopsBounds: [2.5e8, 6.4e10], growthLimit: 1.5,
      maxInFlight: 1, ...schedule } : null;
    this.pendingFlops = 0; this.lastFence = Promise.resolve(); this.adaptiveFlops = null; this.inFlight = [];
  }

  encoder() { return (this.current ??= this.device.createCommandEncoder({ label: `${this.label}.duty` })); }
  track(buffer) { this.transient.push(buffer); return buffer; }
  addFlops(flops) { this.pendingFlops += flops; }

  // FLOP budget for one duty; Infinity when not cooperative (no splitting).
  budget() {
    if (!this.schedule) return Infinity;
    if (!this.schedule.targetDutyMs) return this.schedule.dutyFlops;
    return this.adaptiveFlops ?? this.schedule.dutyFlops;
  }

  throwIfStopped() {
    const signal = this.schedule?.signal;
    if (!signal?.aborted) return;
    const error = new Error(String(signal.reason?.message ?? signal.reason ?? 'Klein stopped'));
    error.name = 'AbortError';
    throw error;
  }

  // A lawful split point. Uncooperative: submit what is encoded (force) without waiting.
  // Cooperative: submit only once the encoded work reaches the budget, or when forced.
  async boundary(label, { force = false } = {}) {
    if (!this.schedule) {
      if (force && this.current) this.submitNow();
      return;
    }
    this.throwIfStopped();
    if (force || this.pendingFlops >= this.budget()) await this.submitDuty(label);
  }

  submitNow() {
    const commands = this.current.finish(); this.current = null;
    const buffers = this.transient; this.transient = [];
    this.device.queue.submit([commands]); this.stats.submits++;
    this.device.queue.onSubmittedWorkDone().then(() => buffers.forEach(b => b.destroy()));
    this.pendingFlops = 0;
  }

  async submitDuty(label) {
    this.throwIfStopped();
    if (!this.current) return;
    const commands = this.current.finish(); this.current = null;
    const buffers = this.transient; this.transient = [];
    const flops = this.pendingFlops; this.pendingFlops = 0;
    // Backpressure: at most maxInFlight duties queued; fences retire in submission order.
    while (this.inFlight.length >= this.schedule.maxInFlight) await this.inFlight.shift();
    const { runtime, invocation, control } = this.schedule;
    let submitted = 0;
    const gateStart = performance.now();
    const work = async () => {
      this.throwIfStopped();
      const descriptor = await runtime.prepareCommandDutyAtBoundary({ phase: label, kind: 'compute',
        metadata: { model: 'flux2-klein', estimatedFlops: flops } }, invocation);
      this.throwIfStopped();
      runtime.settleCommandDuty(descriptor, { status: 'encoded' });
      this.device.queue.submit([commands]);
      submitted = performance.now();
    };
    if (control) await control.runDuty(work); else await work();
    this.stats.duties++; this.stats.submits++;
    const row = { label, estimatedFlops: flops, gateWaitMs: submitted - gateStart, dutyFlopsBudget: this.budget() };
    this.stats.history.push(row);
    row.inFlightAtSubmit = this.inFlight.length;
    this.lastFence = this.device.queue.onSubmittedWorkDone().then(() => {
      row.queueMs = performance.now() - submitted;
      this.observe(flops, row.queueMs, row.inFlightAtSubmit);
      try { this.schedule?.onDuty?.(row); } catch { /* telemetry must not fail inference */ }
      buffers.forEach(b => b.destroy());
    });
    this.inFlight.push(this.lastFence);
  }

  // queueMs spans earlier in-flight duties too; divide by the queue depth at submit so the
  // throughput estimate stays per duty.
  observe(flops, queueMs, depthAtSubmit = 0) {
    const s = this.schedule;
    if (!s?.targetDutyMs || !(queueMs > 0) || !(flops > 0)) return;
    const [min, max] = s.dutyFlopsBounds;
    const current = this.budget();
    const perDutyMs = queueMs / (1 + depthAtSubmit);
    const ideal = flops * s.targetDutyMs / perDutyMs;
    const next = ideal < current ? ideal : Math.min(ideal, current * s.growthLimit);
    this.adaptiveFlops = Math.min(max, Math.max(min, next));
  }

  // Submit everything encoded and wait until the GPU has finished it.
  async flush(label = 'flush') {
    if (this.schedule) { await this.submitDuty(label); await Promise.all(this.inFlight.splice(0)); await this.lastFence; return; }
    if (this.current) this.submitNow();
    await this.device.queue.onSubmittedWorkDone();
  }

  // Drop unsubmitted work after a failure or stop so the next run starts clean.
  async discard() {
    this.current = null; this.pendingFlops = 0;
    const buffers = this.transient; this.transient = [];
    await this.lastFence.catch(() => {});
    await this.device.queue.onSubmittedWorkDone();
    buffers.forEach(b => b.destroy());
    await Promise.allSettled(this.inFlight.splice(0));
    this.schedule = null; this.lastFence = Promise.resolve();
  }
}
