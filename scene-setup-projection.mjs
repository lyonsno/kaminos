import {readFireObjects} from './scene-fire-domain.mjs';
import {flamePoseInDomain, flameDomainControlsFromSettings, normalizeFlameEmitterPose, flamePoseToDomain, immersedControlsForFlamePose} from './scene-flame-emitter.mjs';

const clone = value => structuredClone(value);
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
export function projectEmitterSetup({baseline, observed, choices = {}, describeOnly = false}) {
  const source = doc => {
    const entries = doc.objects?.filter(o => o.type === 'flame-emitter');
    if (entries?.length !== 1) throw Error('Keep in Setup needs one existing emitter in the starting and live scenes');
    normalizeFlameEmitterPose(entries[0].transform);
    return entries[0];
  };
  const before = source(baseline), after = source(observed);
  if (before.id !== after.id || before.source !== after.source) throw Error('Emitter source identity changed');
  const oldFire = readFireObjects(baseline.objects, baseline.fireRendering);
  const liveFire = readFireObjects(observed.objects, observed.fireRendering);
  const domainChanged = differs(oldFire.domain.transform, liveFire.domain.transform) || oldFire.frame.followSource !== liveFire.frame.followSource;
  const needsDomain = !flamePoseInDomain(after.transform, oldFire.frame.translation, oldFire.frame.scale, flameDomainControlsFromSettings(oldFire.settings));
  const groups = [
    {id: 'placement', label: 'Placement', checked: differs(before.transform, after.transform), detail: `Position: ${before.transform.position.join(', ')} -> ${after.transform.position.join(', ')}`},
    {id: 'emission', label: 'Emission', checked: differs(before.emission.settings, after.emission.settings), detail: Object.entries(after.emission.settings).filter(([id, v]) => differs(before.emission.settings[id], v)).map(([id, v]) => `${id.replace(/^volume-/, '').replaceAll('-', ' ')}: ${before.emission.settings[id]?.value ?? '(new)'} -> ${v.value}`).join('\n') || 'Emission unchanged'},
    {id: 'domain', label: 'Simulation domain placement', checked: domainChanged && needsDomain, detail: `Position: ${oldFire.domain.transform.position.join(', ')} -> ${liveFire.domain.transform.position.join(', ')}; follows emitter: ${liveFire.frame.followSource}`},
  ];
  if (describeOnly) return {groups};
  const selected = id => choices[id] ?? groups.find(g => g.id === id).checked;
  const document = clone(baseline), next = document.objects.find(o => o.id === before.id);
  if (selected('placement')) next.transform = clone(after.transform);
  if (selected('emission')) next.emission.settings = clone(after.emission.settings);
  if (selected('domain')) {
    const domain = document.objects.find(o => o.id === oldFire.domain.id);
    domain.transform = clone(liveFire.domain.transform);
    domain.simulation.followSource = liveFire.domain.simulation.followSource;
  }
  const fire = readFireObjects(document.objects, document.fireRendering);
  const outside = !flamePoseInDomain(next.transform, fire.frame.translation, fire.frame.scale, flameDomainControlsFromSettings(fire.settings));
  if (outside && fire.frame.followSource) {
    throw Error('Emitter would be outside the starting domain. Include simulation domain placement or keep the starting emitter placement.');
  }
  if (next.emission.settings['volume-emitter-source-law']?.value === 'immersed-source') {
    // The source pose owns centre/aim; the serialized controls also carry their
    // effective values and must agree when the ordinary loader checks them.
    const settings = next.emission.settings;
    const mapped = immersedControlsForFlamePose({immersedRadius:Number(settings['volume-immersed-radius']?.value),immersedYaw:Number(settings['volume-immersed-yaw']?.value)}, flamePoseToDomain(next.transform, fire.frame.translation, fire.frame.scale), false);
    for (const [suffix,key] of [['centre-x','immersedCentreX'],['centre-y','immersedCentreY'],['centre-z','immersedCentreZ'],['yaw','immersedYaw'],['pitch','immersedPitch']]) {
      const descriptor = settings['volume-immersed-'+suffix];
      if (!descriptor) throw Error('Missing pose-derived source control: '+suffix);
      descriptor.value = mapped[key]; if (Object.hasOwn(descriptor,'rawValue')) descriptor.rawValue = String(mapped[key]);
    }
  }
  return {document, groups, dependencies: [...(selected('domain') ? ['Simulation domain placement also changes for this setup'] : []),...(outside ? ['Source is outside the fixed domain; injection remains suspended until it enters the domain'] : [])]};
}
