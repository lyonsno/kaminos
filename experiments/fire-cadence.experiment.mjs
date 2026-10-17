// Decoupled fire cadence: the fire sim steps every N presented frames while the
// viewport presents every frame. Between steps: hold the latest real state,
// carry it forward along its own velocity, or blend the previous and current
// real states (one step behind; fire-presentation-cadence.mjs). World speed
// ratio r multiplies the flame's current Speed by 1 + (N - 1) r: 0 runs the
// world N times slower, 1 keeps real time with fewer, larger steps. The ratio
// pegs to the Speed as it is now, and an edit to the Speed control is taken as
// the new effective Speed. Closing restores every-frame stepping and the Speed.
const MODES = ['held', 'carry', 'blend'];
const DEFAULT_FLAME = 'vsp-9ed37dbdd11c7d5da7820aa4c5526a5f37928370b1c5aa03826e72536c40d457';

function every(value) {
  if (!Number.isInteger(value) || value < 1 || value > 8) throw Error('step interval must be a whole number of frames from 1 to 8');
  return value;
}
function ratio(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw Error('world speed ratio runs from 0 (slow motion) to 1 (real time)');
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
    const state = {every: every(inputs.every ?? 4), mode: mode(inputs.mode ?? 'blend'), worldSpeed: ratio(inputs.worldSpeed ?? 0)};
    const volume = () => win.__kaminosVolumePrototype ?? null;
    const speedControl = () => document.getElementById('volume-speed');
    // baseSpeed is the Speed at a ratio of 0; written is what this experiment last set.
    let baseSpeed = Number(speedControl()?.value), written = baseSpeed;
    const multiplier = () => 1 + (state.every - 1) * state.worldSpeed;
    const rate = {frames: [], steps: []};
    let controls = null;

    const setSpeed = value => {
      const control = speedControl();
      if (!control) throw Error('the flame Speed control is not on this page');
      control.value = String(value); written = Number(control.value);
      control.dispatchEvent(new win.Event('input', {bubbles: true}));
      control.dispatchEvent(new win.Event('change', {bubbles: true}));
    };
    const apply = () => {
      if (!win.kaminosFireCadence) throw Error('this Kaminos build has no fire cadence control');
      win.kaminosFireCadence({every: state.every, mode: state.mode});
      if (Number.isFinite(baseSpeed) && speedControl()) setSpeed(Number((baseSpeed * multiplier()).toFixed(4)));
      session.redraw();
    };
    const persist = () => updateInputs({...inputs, every: state.every, mode: state.mode, worldSpeed: state.worldSpeed});
    const read = () => {
      const debug = volume()?.debugState?.() ?? null, now = win.performance.now();
      const recent = list => list.filter(entry => now - entry.t <= 1000);
      const frames = recent(rate.frames), steps = recent(rate.steps);
      const perSecond = list => list.length > 1 ? (list.length - 1) / ((list.at(-1).t - list[0].t) / 1000) : null;
      const stepRate = steps.length > 1 ? (steps.at(-1).count - steps[0].count) / ((steps.at(-1).t - steps[0].t) / 1000) : null;
      // A booted volume with no flame is inactive and does not step.
      return {requested: {...state}, fire: volume()?.isActive?.() === true, pacing: debug?.proxyPacing ?? null,
        speed: Number(speedControl()?.value), baseSpeed: Number.isFinite(baseSpeed) ? baseSpeed : null, speedMultiplier: multiplier(),
        worldPace: multiplier() / state.every,
        framesPerSecond: perSecond(frames), simStepsPerSecond: stepRate};
    };
    const sync = () => {
      if (!controls) return;
      const effective = read();
      controls.every.value = String(state.every); controls.everyValue.textContent = `${state.every}`;
      controls.mode.value = state.mode; controls.world.value = String(state.worldSpeed);
      controls.worldValue.textContent = `${Math.round(effective.worldPace * 100)}% of real time`;
      controls.add.hidden = effective.fire;
      const fps = effective.framesPerSecond, sps = effective.simStepsPerSecond;
      controls.status.textContent = !effective.fire ? 'No flame in this scene yet.'
        : `${fps ? fps.toFixed(0) : '–'} frames/s · ${sps ? sps.toFixed(1) : '–'} sim steps/s · Speed ${effective.speed}`
          + (effective.pacing ? ` · stepping every ${effective.pacing.simStepEvery}, ${effective.pacing.presentationBlend ? 'blended' : effective.pacing.presentationAdvect ? 'carried forward' : 'held'}` : ' · stepping every frame');
    };
    let lastStatus = 0;
    const stop = session.onFrame(({timestampMs}) => {
      // An edit to the Speed control is the new effective Speed.
      const current = Number(speedControl()?.value);
      if (Number.isFinite(current) && current !== written) { baseSpeed = current / multiplier(); written = current; }
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
        setWorldSpeed(value) { state.worldSpeed = ratio(value); return applied('fire-cadence.world-speed', value); },
        async addFlame(preset = DEFAULT_FLAME) {
          if (!win.kaminosSceneAuthoring?.addFlameEmitter) throw Error('flame authoring is unavailable on this page');
          await win.kaminosSceneAuthoring.addFlameEmitter(preset);
          baseSpeed = Number(speedControl()?.value); written = baseSpeed;
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
        for (const [value, text] of [['held', 'Hold the last step'], ['carry', 'Carry forward along the flow'], ['blend', 'Blend between steps (one step behind)']]) modeSelect.append(make('option', {value, textContent: text}));
        modeLabel.append(modeSelect);
        const worldLabel = make('label', {textContent: 'World speed '});
        const world = make('input', {type: 'range', min: '0', max: '1', step: '0.05'}); world.setAttribute('aria-label', 'World speed ratio');
        const worldValue = make('output');
        worldLabel.append(world, worldValue);
        const add = make('button', {type: 'button', textContent: 'Add flame'});
        const status = make('div'); status.setAttribute('role', 'status');
        controls = {every: everySlider, everyValue, mode: modeSelect, world, worldValue, add, status};
        everySlider.addEventListener('input', () => invoke('setEvery', Number(everySlider.value)).catch(failed));
        modeSelect.addEventListener('change', () => invoke('setMode', modeSelect.value).catch(failed));
        world.addEventListener('input', () => invoke('setWorldSpeed', Number(world.value)).catch(failed));
        add.addEventListener('click', () => invoke('addFlame').catch(failed));
        for (const node of [everyLabel, modeLabel, worldLabel, add, status]) panel.append(node, make('br'));
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
