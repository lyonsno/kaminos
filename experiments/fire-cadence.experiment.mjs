// Decoupled fire cadence: the fire sim steps every N presented frames while the
// viewport presents every frame. Held repeats the latest real state between
// steps; carry forward shows it carried along its own velocity by the elapsed
// fraction of a step (fire-presentation-cadence.mjs). Keep world speed raises
// the flame's Speed by N so world time keeps pace with fewer, larger steps.
// Closing restores every-frame stepping and the Speed it found.
const MODES = ['held', 'carry'];
const DEFAULT_FLAME = 'vsp-9ed37dbdd11c7d5da7820aa4c5526a5f37928370b1c5aa03826e72536c40d457';

function every(value) {
  if (!Number.isInteger(value) || value < 1 || value > 8) throw Error('step interval must be a whole number of frames from 1 to 8');
  return value;
}
function mode(value) {
  if (!MODES.includes(value)) throw Error(`mode must be one of ${MODES.join(', ')}`);
  return value;
}

export default {
  id: 'fire-cadence', title: 'Fire cadence',
  async create({host, inputs, record, updateInputs = () => {}}) {
    const session = await host.scene.open(), document = host.controls.document, win = document.defaultView;
    const state = {every: every(inputs.every ?? 4), mode: mode(inputs.mode ?? 'carry'), keepWorldSpeed: inputs.keepWorldSpeed === true};
    const volume = () => win.__kaminosVolumePrototype ?? null;
    const speedControl = () => document.getElementById('volume-speed');
    let baseSpeed = Number(speedControl()?.value);
    const rate = {frames: [], steps: []};
    let controls = null;

    const setSpeed = value => {
      const control = speedControl();
      if (!control) throw Error('the flame Speed control is not on this page');
      control.value = String(value);
      control.dispatchEvent(new win.Event('input', {bubbles: true}));
      control.dispatchEvent(new win.Event('change', {bubbles: true}));
    };
    const apply = () => {
      if (!win.kaminosFireCadence) throw Error('this Kaminos build has no fire cadence control');
      win.kaminosFireCadence({every: state.every, advect: state.mode === 'carry'});
      if (Number.isFinite(baseSpeed) && speedControl()) setSpeed(state.keepWorldSpeed ? baseSpeed * state.every : baseSpeed);
      session.redraw();
    };
    const persist = () => updateInputs({...inputs, every: state.every, mode: state.mode, keepWorldSpeed: state.keepWorldSpeed});
    const read = () => {
      const debug = volume()?.debugState?.() ?? null, now = win.performance.now();
      const recent = list => list.filter(entry => now - entry.t <= 1000);
      const frames = recent(rate.frames), steps = recent(rate.steps);
      const perSecond = list => list.length > 1 ? (list.length - 1) / ((list.at(-1).t - list[0].t) / 1000) : null;
      const stepRate = steps.length > 1 ? (steps.at(-1).count - steps[0].count) / ((steps.at(-1).t - steps[0].t) / 1000) : null;
      // A booted volume with no flame is inactive and does not step.
      return {requested: {...state}, fire: volume()?.isActive?.() === true, pacing: debug?.proxyPacing ?? null,
        speed: Number(speedControl()?.value), baseSpeed: Number.isFinite(baseSpeed) ? baseSpeed : null,
        framesPerSecond: perSecond(frames), simStepsPerSecond: stepRate};
    };
    const sync = () => {
      if (!controls) return;
      const effective = read();
      controls.every.value = String(state.every); controls.everyValue.textContent = `${state.every}`;
      controls.mode.value = state.mode; controls.keep.checked = state.keepWorldSpeed;
      controls.add.hidden = effective.fire;
      const fps = effective.framesPerSecond, sps = effective.simStepsPerSecond;
      controls.status.textContent = !effective.fire ? 'No flame in this scene yet.'
        : `${fps ? fps.toFixed(0) : '–'} frames/s · ${sps ? sps.toFixed(1) : '–'} sim steps/s · Speed ${effective.speed}`
          + (effective.pacing ? ` · stepping every ${effective.pacing.simStepEvery}${effective.pacing.presentationAdvect ? ', carried forward' : ', held'}` : ' · stepping every frame');
    };
    let lastStatus = 0;
    const stop = session.onFrame(({timestampMs}) => {
      const count = volume()?.debugState?.()?.simStepCount;
      rate.frames.push({t: timestampMs}); if (Number.isFinite(count)) rate.steps.push({t: timestampMs, count});
      while (rate.frames.length && timestampMs - rate.frames[0].t > 2000) rate.frames.shift();
      while (rate.steps.length && timestampMs - rate.steps[0].t > 2000) rate.steps.shift();
      if (timestampMs - lastStatus > 250) { lastStatus = timestampMs; sync(); }
    });
    // The page holds the cadence; its fire sync applies it once a flame exists.
    if (win.kaminosFireCadence) apply();

    const applied = (kind, requested) => { persist(); apply(); sync(); const effective = read(); record({kind, phase: 'applied', requested, effective}); return effective; };
    return {
      read,
      operations: {
        setEvery(value) { state.every = every(value); return applied('fire-cadence.every', value); },
        setMode(value) { state.mode = mode(value); return applied('fire-cadence.mode', value); },
        setKeepWorldSpeed(value) {
          if (typeof value !== 'boolean') throw Error('keep world speed is on or off');
          if (!Number.isFinite(baseSpeed)) baseSpeed = Number(speedControl()?.value);
          state.keepWorldSpeed = value; return applied('fire-cadence.keep-world-speed', value);
        },
        async addFlame(preset = DEFAULT_FLAME) {
          if (!win.kaminosSceneAuthoring?.addFlameEmitter) throw Error('flame authoring is unavailable on this page');
          await win.kaminosSceneAuthoring.addFlameEmitter(preset);
          baseSpeed = Number(speedControl()?.value);
          return applied('fire-cadence.add-flame', preset);
        },
      },
      mount({root: panel, document, invoke}) {
        const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
        const failed = error => { sync(); controls.status.textContent = error.message; };
        const everyLabel = make('label', {textContent: 'Sim steps every '});
        const everySlider = make('input', {type: 'range', min: '1', max: '8', step: '1'}); everySlider.setAttribute('aria-label', 'Sim steps every N frames');
        const everyValue = make('output'); const frames = make('span', {textContent: ' frames'});
        everyLabel.append(everySlider, everyValue, frames);
        const modeLabel = make('label', {textContent: 'Between steps '});
        const modeSelect = make('select'); modeSelect.setAttribute('aria-label', 'Between sim steps');
        for (const [value, text] of [['held', 'Hold the last step'], ['carry', 'Carry forward along the flow']]) modeSelect.append(make('option', {value, textContent: text}));
        modeLabel.append(modeSelect);
        const keepLabel = make('label'); const keep = make('input', {type: 'checkbox'}); keep.setAttribute('aria-label', 'Keep world speed');
        keepLabel.append(keep, make('span', {textContent: ' Keep world speed (Speed × N, larger sim steps)'}));
        const add = make('button', {type: 'button', textContent: 'Add flame'});
        const status = make('div'); status.setAttribute('role', 'status');
        controls = {every: everySlider, everyValue, mode: modeSelect, keep, add, status};
        everySlider.addEventListener('input', () => invoke('setEvery', Number(everySlider.value)).catch(failed));
        modeSelect.addEventListener('change', () => invoke('setMode', modeSelect.value).catch(failed));
        keep.addEventListener('change', () => invoke('setKeepWorldSpeed', keep.checked).catch(failed));
        add.addEventListener('click', () => invoke('addFlame').catch(failed));
        for (const node of [everyLabel, modeLabel, keepLabel, add, status]) panel.append(node, make('br'));
        sync();
      },
      async dispose() {
        stop();
        win.kaminosFireCadence?.({every: 1});
        if (Number.isFinite(baseSpeed) && speedControl()) setSpeed(baseSpeed);
        await session.dispose();
      },
    };
  },
};
