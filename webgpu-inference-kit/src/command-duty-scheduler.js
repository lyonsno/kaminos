// Accumulate encoded operations and submit at the producer's lawful boundaries.
// Queue completion adapts the FLOP budget; it includes earlier queued GPU work.
export class WebGpuCommandDutyScheduler {
  constructor(device, { label = 'inference', model = label } = {}) {
    this.device = device; this.label = label; this.model = model;
    this.schedule = null; this.current = null; this.pendingFlops = 0; this.transient = [];
    this.lastFence = Promise.resolve(); this.adaptiveFlops = null; this.inFlight = [];
    this.submitting = false; this.settling = false;
    this.stats = { duties: 0, submits: 0, history: [] };
  }

  get cooperative() { return Boolean(this.schedule); }

  // Defaults preserve the Klein/UniMate policy. The producer supplies FLOP
  // estimates, split points and any different scheduling policy.
  setSchedule(schedule) {
    if (this.current || this.transient.length) throw new Error('cannot change the command-duty schedule with unsubmitted work');
    if (this.submitting || this.settling || this.inFlight.length) throw new Error('flush pending command duties before changing the schedule');
    if (schedule && (typeof schedule.runtime?.prepareCommandDutyAtBoundary !== 'function'
      || typeof schedule.runtime?.settleCommandDuty !== 'function' || !schedule.invocation)) {
      throw new Error('command-duty schedule requires a route runtime and its queued invocation');
    }
    if (schedule?.maxInFlight !== undefined && (!Number.isSafeInteger(schedule.maxInFlight) || schedule.maxInFlight < 1)) {
      throw new Error('maxInFlight must be a positive safe integer');
    }
    this.schedule = schedule ? { targetDutyMs: 12, dutyFlops: 4e9, dutyFlopsBounds: [2.5e8, 6.4e10], growthLimit: 1.5,
      maxInFlight: 1, ...schedule } : null;
    this.pendingFlops = 0; this.lastFence = Promise.resolve(); this.adaptiveFlops = null;
  }

  encoder() { return (this.current ??= this.device.createCommandEncoder({ label: `${this.label}.duty` })); }
  track(buffer) { this.transient.push(buffer); return buffer; }
  addFlops(flops) { this.pendingFlops += flops; }

  budget() {
    if (!this.schedule) return Infinity;
    if (!this.schedule.targetDutyMs) return this.schedule.dutyFlops;
    return this.adaptiveFlops ?? this.schedule.dutyFlops;
  }

  throwIfStopped() {
    const signal = this.schedule?.signal;
    if (!signal?.aborted) return;
    const error = new Error(String(signal.reason?.message ?? signal.reason ?? `${this.label} stopped`));
    error.name = 'AbortError';
    throw error;
  }

  async boundary(label, { force = false } = {}) {
    if (!this.schedule) {
      if (force && this.current) this.submitNow();
      return;
    }
    this.throwIfStopped();
    if (force || this.pendingFlops >= this.budget()) await this.submitDuty(label);
  }

  retire(buffers, onComplete) {
    const fence = this.device.queue.onSubmittedWorkDone().then(onComplete).finally(() => {
      buffers.forEach(buffer => buffer.destroy());
    });
    // Retain failure for flush/discard while avoiding an unhandled rejection
    // during the producer's next encoding step.
    fence.catch(() => {});
    this.lastFence = fence;
    this.inFlight.push(fence);
  }

  submitNow() {
    const commands = this.current.finish(); this.current = null;
    const buffers = this.transient; this.transient = []; this.pendingFlops = 0;
    try { this.device.queue.submit([commands]); }
    catch (error) { buffers.forEach(buffer => buffer.destroy()); throw error; }
    this.stats.submits++;
    this.retire(buffers);
  }

  async submitDuty(label) {
    this.throwIfStopped();
    if (!this.current) return;
    if (this.submitting) throw new Error('await the previous command-duty submission before submitting another');
    const commands = this.current.finish(); this.current = null;
    const buffers = this.transient; this.transient = [];
    const flops = this.pendingFlops; this.pendingFlops = 0;
    const schedule = this.schedule;
    const { runtime, invocation, control } = schedule;
    let submitted = 0;
    let queued = false;
    const gateStart = performance.now();
    this.submitting = true;
    try {
      while (this.inFlight.length >= schedule.maxInFlight) await this.inFlight.shift();
      const work = async () => {
        this.throwIfStopped();
        const descriptor = await runtime.prepareCommandDutyAtBoundary({ phase: label, kind: 'compute',
          metadata: { model: this.model, estimatedFlops: flops } }, invocation);
        this.throwIfStopped();
        runtime.settleCommandDuty(descriptor, { status: 'encoded' });
        this.device.queue.submit([commands]);
        queued = true;
        submitted = performance.now();
      };
      if (control) await control.runDuty(work); else await work();
    } catch (error) {
      if (queued) { this.stats.submits++; this.retire(buffers); }
      else buffers.forEach(buffer => buffer.destroy());
      throw error;
    } finally { this.submitting = false; }
    this.stats.duties++; this.stats.submits++;
    const row = { label, estimatedFlops: flops, gateWaitMs: submitted - gateStart,
      dutyFlopsBudget: this.budget(), submittedAt: submitted, inFlightAtSubmit: this.inFlight.length };
    this.stats.history.push(row);
    this.retire(buffers, () => {
      row.queueMs = performance.now() - submitted;
      this.observe(flops, row.queueMs, row.inFlightAtSubmit);
      try { schedule.onDuty?.(row); } catch { /* telemetry must not fail inference */ }
    });
  }

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

  async flush(label = 'flush') {
    if (this.settling) throw new Error('await the previous command-duty flush');
    this.settling = true;
    try {
      if (this.schedule) await this.submitDuty(label);
      else if (this.current) this.submitNow();
      await Promise.all(this.inFlight.splice(0));
      await this.lastFence;
      if (!this.schedule) await this.device.queue.onSubmittedWorkDone();
    } finally { this.settling = false; }
  }

  async discard() {
    if (this.submitting || this.settling) throw new Error('await the pending command-duty submission or flush before discard');
    this.current = null; this.pendingFlops = 0;
    const buffers = this.transient; this.transient = [];
    this.settling = true;
    try {
      const results = await Promise.allSettled([
        ...this.inFlight.splice(0), this.lastFence, this.device.queue.onSubmittedWorkDone(),
      ]);
      buffers.forEach(buffer => buffer.destroy());
      this.schedule = null; this.lastFence = Promise.resolve();
      const failed = results.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
    } finally { this.settling = false; }
  }
}
