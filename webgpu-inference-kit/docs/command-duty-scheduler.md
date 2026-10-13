# Command-duty scheduling

`WebGpuCommandDutyScheduler` is the helper used by Klein and UniMate to collect
encoded operations into command buffers and submit them at producer-declared
split points. It is exported from the Kit and its `core` entrypoint.

```js
const scheduler = new WebGpuCommandDutyScheduler(device, {
  label: 'my-model', model: 'my-model',
});
scheduler.setSchedule({ runtime: route.runtime, invocation, control, signal });
// Encode through scheduler.encoder(), and add the producer's FLOP estimates.
await scheduler.boundary('block-end');
await scheduler.flush('output');
scheduler.setSchedule(null);
```

The invocation belongs to the route's admitted job. That runtime carries the
app's foreground opportunities. Each cooperative submission passes the control
gate and the runtime boundary before queue submission. `track(buffer)` transfers
temporary-buffer retirement to the scheduler; it destroys the buffer when the
submission settles, or releases it if admission fails before submission. Model
weights, outputs and the device remain owned by their caller.

The inherited Klein/UniMate defaults are `targetDutyMs: 12`, `dutyFlops: 4e9`,
`dutyFlopsBounds: [2.5e8, 6.4e10]`, `growthLimit: 1.5` and `maxInFlight: 1`.
Producers can supply their own values. `targetDutyMs: 0` uses a fixed FLOP
budget. Queue-completion time includes earlier GPU work and foreground frames;
the adaptive estimate does not promise a measured duration for an individual
kernel. The producer still chooses valid split points and FLOP estimates.

Without a schedule, `boundary` submits only when forced, and `flush` submits
the remaining work and waits. With a schedule, a boundary submits when its
FLOP budget is reached or when forced. Await submissions and `flush` before
changing the schedule. After an error or Stop, await `discard` to drop
unsubmitted commands, settle tracked submissions and release temporaries;
device-loss errors remain observable. The scheduler does not preempt GPU work.

`KleinDutyScheduler` and `UniMateDutyScheduler` retain the existing model-facing
names and supply their respective model identities. Model kernels, solver
behavior and output decoding are independent of this helper.
