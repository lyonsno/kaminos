export function opticalSteppingConfig({mode = 'numerical', tolerance = 0.001} = {}) {
  const modes = ['current', 'fixed', 'numerical', 'fixed-dense', 'budgeted', 'joins', 'history'];
  if (!modes.includes(mode)) throw new Error(`unknown optical stepping mode: ${mode}`);
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('positive finite optical tolerance required');
  if (!Number.isFinite(Math.fround(tolerance)) || Math.fround(tolerance) <= 0) throw new Error('optical tolerance must fit a positive finite GPU coefficient');
  return {mode, value: modes.indexOf(mode), tolerance,
    authority: modes.indexOf(mode)>=4 ? 'experimental fixed-count nonuniform quadrature; no continuous-field error bound' : 'experimental nested quadrature; estimated E/T error, not a continuous-field bound',
    floor: modes.indexOf(mode)>=4 ? 'one fresh material evaluation per allocated stratum' : 'four integration panels per authored base step',
    jitter: modes.indexOf(mode)>=4 ? 'interior mass-stratum sampling; full ray interval retained' : 'spatiotemporal partition phase and weighted interior strata; both clipped endpoints retained'};
}

export function resolveOpticalStepping(config, {emissive, trace = false, exterior = false, explicit = false}) {
  const wrongExterior=config.value>=4 ? !exterior : exterior;
  if (config.mode !== 'current' && (!emissive || trace || wrongExterior)) {
    if (explicit) throw new Error('optical stepping comparison requires lean emissive beauty, without trace capture or joined exterior');
    return {...opticalSteppingConfig({mode:'current',tolerance:config.tolerance}),requested:config.mode,
      reason:wrongExterior?(exterior?'joined-exterior':'requires-joined-exterior'):trace?'diagnostic-trace-capture':'non-emissive-renderer'};
  }
  return {...config,requested:config.mode,reason:null};
}

export function validateOpticalPreviewArm(sample, state, {mode, tolerance, step, raySteps}) {
  if (!sample?.ok || state?.simStepCount !== step || state?.backend !== 'WebGPU:apple'
    || state?.opticalStepping?.effective !== mode || state?.opticalStepping?.tolerance !== tolerance
    || state?.raymarchShaderSpecialization?.effective !== 'lean-emissive-raymarch-v0'
    || state?.physicalColor?.effective !== 'emissive-transport-v2'
    || (raySteps !== undefined && state?.controls?.raySteps !== raySteps)) throw new Error('wrong effective native arm');
  const frame = sample.image;
  if (!frame || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width <= 0 || frame.height <= 0
    || frame.rgba?.length !== frame.width * frame.height * 4 || !frame.rgba.some((x,i) => i%4 !== 3 && x > 0)) {
    throw new Error('missing/partial/blank frame');
  }
  if(['budgeted','joins','history'].includes(mode)){
    const a=state.opticalStepping.allocation;
    if(state.worldSmoke?.effective!=='one-way-world-field'||!a?.geometry?.cells||!Number.isInteger(a.frames)||a.frames<1||a.colorReuse!==false){
      throw Error('missing effective spatial guidance on joined route');
    }
  }
}

export const OPTICAL_STEPPING_WGSL = /* wgsl */`
override OPTICAL_STEP_MODE: u32 = 0u;
override OPTICAL_STEP_TOLERANCE: f32 = 0.001;

struct OpticalStepState {
  probes: array<vec4<f32>, 5>,
  positions: array<f32, 5>,
  mask: u32,
  origin: f32,
  cursor: f32,
  end: f32,
  width: f32,
  minimum: f32,
  maximum: f32,
  transfer: vec4<f32>,
  unresolved: u32,
  phased: u32,
  phase: f32,
}
fn opticalStepResetPositions(s: ptr<function, OpticalStepState>) {
  for (var i = 0u; i < 5u; i++) { (*s).positions[i] = (*s).width * f32(i) * 0.25; }
}
fn opticalStepInit(start: f32, end: f32, base: f32) -> OpticalStepState {
  var s: OpticalStepState;
  // March in distance from entry: a grazing interval can be smaller than one
  // ULP of the absolute camera-ray parameter, even with a valid positive step.
  s.origin = start;
  s.cursor = 0.0;
  s.end = max(0.0, end - start);
  s.minimum = base * select(1.0, 0.5, OPTICAL_STEP_MODE == 3u);
  s.maximum = s.minimum * select(1.0, 4.0, OPTICAL_STEP_MODE == 2u);
  s.width = min(s.maximum, s.end);
  s.transfer = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  opticalStepResetPositions(&s);
  return s;
}
fn opticalStepInitPhased(start: f32, end: f32, base: f32, phase: f32) -> OpticalStepState {
  var s = opticalStepInit(start, end, base);
  if (phase >= 0.0) {
    // Randomize the first partition, not the ray entry. Coarse and fine
    // quadrature share its phase, including the leading and trailing slabs.
    s.width = min(s.end, s.maximum * (0.25 + 0.75 * phase));
    s.phased = 1u;
    s.phase = phase;
    opticalStepResetPositions(&s);
  }
  return s;
}
fn opticalStepConstrain(s: ptr<function, OpticalStepState>, minimum: f32, maximum: f32, stop: f32) {
  if ((*s).mask > 1u) { return; }
  (*s).minimum = minimum;
  (*s).maximum = maximum;
  (*s).width = min((*s).end - (*s).cursor, min(stop, clamp((*s).width, minimum, maximum)));
  if ((*s).phased == 1u) {
    (*s).width = min((*s).end - (*s).cursor, min(stop, maximum * (0.25 + 0.75 * (*s).phase)));
  }
  opticalStepResetPositions(s);
}
fn opticalStepIndex(mask: u32) -> u32 {
  for (var i = 0u; i < 5u; i++) { if ((mask & (1u << i)) == 0u) { return i; } }
  return 4u;
}
fn opticalStepPosition(s: OpticalStepState) -> f32 {
  return s.origin + min(s.end, s.cursor + s.positions[opticalStepIndex(s.mask)]);
}
fn opticalStepPositionJittered(s: ptr<function, OpticalStepState>, noise: f32) -> f32 {
  let i = opticalStepIndex((*s).mask);
  if (i == 1u || i == 3u) {
    // Keep nested anchors intact. Stay in the middle half of each stratum so
    // refinement cannot collapse an interval to a nearly coincident pair.
    (*s).positions[i] = mix((*s).positions[i-1u], (*s).positions[i+1u], 0.25 + 0.5 * noise);
  }
  return opticalStepPosition(*s);
}
fn opticalCompose(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(a.xyz + a.w * b.xyz, a.w * b.w);
}
fn opticalPanel(q: vec4<f32>, h: f32) -> vec4<f32> {
  let tau = max(0.0, q.w) * h;
  // Arbitrary phased widths expose cancellation in 1-exp(-tau). The fourth
  // order series stays below f32 rounding error throughout this interval.
  var integral = h * (1.0 - tau * 0.5 + tau * tau * (1.0 / 6.0 - tau * (1.0 / 24.0 - tau / 120.0)));
  if (tau > 0.05) { integral = (1.0 - exp(-tau)) / q.w; }
  return vec4<f32>(q.xyz * integral, exp(-tau));
}
fn opticalStepObserveWithTolerance(s: ptr<function, OpticalStepState>, q: vec4<f32>, tolerance: f32) {
  let index = opticalStepIndex((*s).mask);
  (*s).probes[index] = q;
  (*s).mask |= 1u << index;
  if ((*s).mask != 31u) { return; }
  var fine = vec4<f32>(0.0, 0.0, 0.0, 1.0);
  var coarse = fine;
  for (var i = 0u; i < 4u; i++) {
    fine = opticalCompose(fine, opticalPanel(((*s).probes[i] + (*s).probes[i+1u]) * 0.5, (*s).positions[i+1u] - (*s).positions[i]));
  }
  for (var i = 0u; i < 4u; i += 2u) {
    coarse = opticalCompose(coarse, opticalPanel(((*s).probes[i] + (*s).probes[i+2u]) * 0.5, (*s).positions[i+2u] - (*s).positions[i]));
  }
  // Same local incoming-transmission weighting as the retained-probe controller.
  // No suffix-light bound is claimed; missed between-probe sheets remain possible.
  let disagreement = abs(fine - coarse) * (*s).transfer.w;
  let refine = any(disagreement > vec4<f32>(tolerance));
  if (OPTICAL_STEP_MODE == 2u && refine && (*s).width > (*s).minimum * 1.001) {
    (*s).width = (*s).positions[2];
    (*s).probes[4] = (*s).probes[2];
    (*s).probes[2] = (*s).probes[1];
    (*s).positions[4] = (*s).positions[2];
    (*s).positions[2] = (*s).positions[1];
    (*s).positions[1] = (*s).positions[2] * 0.5;
    (*s).positions[3] = ((*s).positions[2] + (*s).positions[4]) * 0.5;
    (*s).mask = 21u;
    return;
  }
  if (refine) { (*s).unresolved += 1u; }
  (*s).transfer = opticalCompose((*s).transfer, fine);
  (*s).cursor = min((*s).end, (*s).cursor + (*s).width);
  let nextWidth = select((*s).width * 2.0, (*s).maximum, (*s).phased == 1u);
  (*s).phased = 0u;
  (*s).width = min((*s).end - (*s).cursor, min((*s).maximum, nextWidth));
  (*s).probes[0] = (*s).probes[4];
  (*s).mask = 1u;
  opticalStepResetPositions(s);
}
fn opticalStepObserve(s: ptr<function, OpticalStepState>, q: vec4<f32>) {
  opticalStepObserveWithTolerance(s, q, OPTICAL_STEP_TOLERANCE);
}
`;

export function installOpticalSteppingPreview(renderer, document) {
  const anchor = document.getElementById('volume-steps')?.closest('.slider-row');
  if (!anchor) throw new Error('raymarch comparison control anchor missing');
  const row = document.createElement('div');
  row.className = 'slider-row';
  const label = document.createElement('label');
  label.className = 'slider-label';
  label.htmlFor = 'optical-stepping-preview';
  label.textContent = 'Stepping preview';
  const select = document.createElement('select');
  select.className = 'select-input';
  select.id = label.htmlFor;
  for (const [value, text] of [['current','Current'],['fixed','Fixed reference'],['fixed-dense','Fixed reference 2x'],
    ['numerical:0.01','Numerical 0.01'],['numerical:0.001','Numerical 0.001'],['numerical:0.0001','Numerical 0.0001']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = text; select.append(option);
  }
  select.style.minWidth = '0';
  select.style.flex = '1';
  const initial = renderer.debugState?.().opticalStepping || opticalSteppingConfig();
  select.value = initial.mode === 'numerical' ? `numerical:${initial.tolerance}` : initial.mode;
  let previous = select.value;
  select.addEventListener('change', () => {
    const [mode, tolerance] = select.value.split(':');
    try {
      renderer.setDebugOpticalStepping({mode, tolerance:tolerance ? Number(tolerance) : 0.001});
      previous = select.value; select.setCustomValidity(''); select.title = '';
    } catch (error) {
      select.value = previous; select.setCustomValidity(error.message); select.title = error.message;
      select.reportValidity();
    }
  });
  row.append(label, select); anchor.after(row);
}
