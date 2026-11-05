// Classic head script: startup feedback must not wait for the module graph,
// runtime configuration, or a GPU device. UI delay is timer scheduling delay,
// not GPU duration or rendered-frame throughput.
(function () {
  var STARTING = 'kaminos-starting';
  var FAILED = 'kaminos-startup-failed';
  var now = function () { return window.performance ? window.performance.now() : Date.now(); };
  var began = now(), phaseAt = began, lastPulse = began, ended = null;
  var phase = 'Loading application modules', status = 'starting';
  var lastDelay = null, maxDelay = 0, pulseTimer, watchdog;
  var phases = [{phase: phase, atMs: 0}];
  function starting() {
    return !!(document.body && document.body.classList.contains(STARTING));
  }
  function read() {
    var at = ended === null ? now() : ended;
    return {schema: 'kaminos.startup.v1', status: status, phase: phase,
      elapsedMs: at - began, phaseElapsedMs: at - phaseAt,
      lastUiDelayMs: lastDelay, maxUiDelayMs: maxDelay,
      phases: phases.map(function (row) { return {phase: row.phase, atMs: row.atMs}; })};
  }
  function render() {
    var state = read();
    var phaseNode = document.getElementById('kaminos-startup-phase');
    var elapsedNode = document.getElementById('kaminos-startup-elapsed');
    var delayNode = document.getElementById('kaminos-startup-delay');
    if (phaseNode) phaseNode.textContent = phase;
    if (elapsedNode) elapsedNode.textContent = Math.round(state.elapsedMs) + ' ms elapsed · ' + Math.round(state.phaseElapsedMs) + ' ms in this stage';
    if (delayNode) delayNode.textContent = lastDelay === null ? 'UI scheduling: awaiting first sample' : 'UI scheduling delay: ' + Math.round(lastDelay) + ' ms · peak ' + Math.round(maxDelay) + ' ms';
  }
  function finish(nextStatus) {
    if (status !== 'starting' && status !== 'revealed') return;
    status = nextStatus; ended = now();
    // A synchronous stall can finish startup before its overdue timer runs.
    var overdue = Math.max(0, ended - lastPulse - 250);
    if (overdue > 0) { lastDelay = overdue; maxDelay = Math.max(maxDelay, overdue); }
    window.clearTimeout(pulseTimer); window.clearTimeout(watchdog);
  }
  window.kaminosStartup = {
    read: read,
    phase: function (label) {
      if (status !== 'starting' || phase === label) return;
      phase = label; phaseAt = now(); phases.push({phase: phase, atMs: phaseAt - began}); render();
    },
    finish: finish,
  };
  function pulse() {
    if (status !== 'starting') return;
    if (document.body && !starting()) { finish('workspace-visible'); return; }
    var at = now(); lastDelay = Math.max(0, at - lastPulse - 250); maxDelay = Math.max(maxDelay, lastDelay); lastPulse = at;
    render(); pulseTimer = window.setTimeout(pulse, 250);
  }
  pulseTimer = window.setTimeout(pulse, 250);
  document.addEventListener('DOMContentLoaded', render, {once: true});
  function lift(failed) {
    if (!document.body) return;
    finish(failed ? 'failed' : 'revealed');
    if (failed) document.body.classList.add(FAILED);
    document.body.classList.remove(STARTING);
    var veil = document.getElementById('kaminos-startup-veil');
    if (veil) veil.remove();
  }
  window.addEventListener('error', function (event) {
    var target = event && event.target;
    var scriptFailure = !!(event && event.message) || !!(target && target.tagName === 'SCRIPT');
    if (scriptFailure && starting()) lift(true);
  }, true);
  window.addEventListener('unhandledrejection', function () {
    if (starting()) lift(true);
  });
  watchdog = window.setTimeout(function () {
    if (!starting() || status !== 'starting') return;
    var veil = document.getElementById('kaminos-startup-veil');
    if (!veil) return;
    var button = document.createElement('button');
    button.textContent = 'Show the page';
    button.addEventListener('click', function () { lift(false); });
    (document.getElementById('kaminos-startup-actions') || veil).append(button);
    veil.style.pointerEvents = 'auto';
  }, 20000);
  try {
    window.__kaminosEarlyRuntimeConfig = window.fetch('/api/runtime-config', { cache: 'no-store' });
  } catch (error) {
    window.__kaminosEarlyRuntimeConfig = null;
  }
})();
