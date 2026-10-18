import {Vector3, Quaternion} from '../../lib/three.core.js';

const clone = value => structuredClone(value);
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
export function projectCreatureSetup({baseline, observed, choices = {}}) {
  const live = observed.recipe, document = clone(baseline);
  if (!live?.transform || !baseline?.transform) throw Error('Creature setup requires authored placement');
  const groups = [
    {id: 'placement', label: 'Placement edits', checked: differs(baseline.transform, live.transform), detail: `Position: ${baseline.transform.position.join(', ')} -> ${live.transform.position.join(', ')}`},
    {id: 'behavior', label: 'Behavior settings', checked: baseline.rate !== live.rate || baseline.mode !== live.mode || differs(baseline.attention, live.attention), detail: `Rate: ${baseline.rate ?? 1} -> ${live.rate ?? 1}; playback: ${baseline.mode ?? 'source'} -> ${live.mode ?? 'source'}`},
    {id: 'source', label: 'Source choices', checked: false, detail: `Skin: ${live.case ?? '(unchanged)'}\nMotion: ${live.motion ?? '(unchanged)'}`},
    {id: 'startHere', label: 'Start at current location', checked: false, detail: 'Fresh motion phase at the observed pelvis location; retained orientation and scale.'},
  ];
  const selected = id => choices[id] ?? groups.find(g => g.id === id).checked;
  const assign = keys => { for (const key of keys) { if (Object.hasOwn(live, key)) document[key] = clone(live[key]); else delete document[key]; } };
  if (selected('placement')) document.transform = clone(live.transform);
  if (selected('behavior')) assign(['mode', 'rate', 'attention']);
  if (selected('source')) {
    assign(['case', 'case_sha256', 'motion', 'motion_sha256', 'prefix', 'prefix_sha256', 'frame', 'frame_sha256']);
    document.sample = 0; document.cycle = 0;
  }
  if (selected('behavior') && baseline.mode !== document.mode) { document.sample = 0; document.cycle = 0; }
  if (selected('startHere')) {
    if (document.motion_sha256 !== live.motion_sha256 || document.frame_sha256 !== live.frame_sha256) throw Error('Include source choices to start here with the observed motion');
    const local = observed.startLocalPositions?.[document.mode ?? 'source'], target = observed.currentPosition;
    if (!local || !target || ![...local, ...target].every(Number.isFinite)) throw Error('Current-location start anchor is unavailable');
    const offset = new Vector3(...local).multiply(new Vector3(...document.transform.scale)).applyQuaternion(new Quaternion(...document.transform.quaternion));
    document.transform.position = new Vector3(...target).sub(offset).toArray();
    document.sample = 0; document.cycle = 0;
  }
  return {document, groups};
}
