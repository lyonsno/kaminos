import {checkedFineCoverageOptions} from './volume-fine-coverage.mjs';
export const FINE_COVERAGE_FIELDS=[
 {
  "key": "mode",
  "id": "volume-coverage-mode",
  "param": "volume_coverage_mode",
  "label": "Following",
  "value": "off",
  "description": "Off: leave Fine coverage where you place it. Sources: follow source supply. Fire + sources: also use measured reaction, mixing, heat and smoke demand from adaptive material.",
  "type": "select-one"
 },
 {
  "key": "margin",
  "id": "volume-coverage-margin",
  "param": "volume_coverage_margin",
  "label": "Interior margin",
  "value": 0.15,
  "description": "Fraction of each side reserved as spare coverage. Larger margins trigger earlier movement and leave less interior space.",
  "type": "number"
 },
 {
  "key": "headroom",
  "id": "volume-coverage-headroom",
  "param": "volume_coverage_headroom",
  "label": "Headroom",
  "value": 0.75,
  "description": "Fraction of Fine height above a source when choosing a new placement. Does not resize the box.",
  "type": "number"
 },
 {
  "key": "lookahead",
  "id": "volume-coverage-lookahead",
  "param": "volume_coverage_lookahead",
  "label": "Prediction (seconds)",
  "value": 0.3,
  "description": "Predict source motion and measured gas motion this many wall-clock seconds ahead. More prediction can move coverage earlier.",
  "type": "number"
 },
 {
  "key": "interval",
  "id": "volume-coverage-interval",
  "param": "volume_coverage_interval",
  "label": "Check interval (seconds)",
  "value": 0.25,
  "description": "Minimum time between placement checks and moves. Larger values reduce remap work but follow moving fire later. Zero checks every frame.",
  "type": "number"
 },
 {
  "key": "activityWeight",
  "id": "volume-coverage-activity-weight",
  "param": "volume_coverage_activity_weight",
  "label": "Fire / source priority",
  "value": 1,
  "description": "Relative total weight of measured fire demand versus source supply. Zero follows sources alone. Fire measurements use the adaptive material refinement priorities.",
  "type": "number"
 },
 {
  "key": "hysteresis",
  "id": "volume-coverage-hysteresis",
  "param": "volume_coverage_hysteresis",
  "label": "Required coverage gain",
  "value": 0.05,
  "description": "Minimum improvement as a fraction of total weighted demand before moving. Larger values resist small improvements and reduce movement.",
  "type": "number"
 }
];
export function readFineCoverageControls(controls){
 const values={};for(const f of FINE_COVERAGE_FIELDS){const e=controls[f.id];if(!e)throw Error(`Missing Fine coverage control ${f.id}`);const v=e.rawValue??e.value;values[f.key]=f.key==='mode'?v:Number(v);}
 return checkedFineCoverageOptions(values);
}
export function patchFineCoverageControls(controls,patch){
 const next=checkedFineCoverageOptions({...readFineCoverageControls(controls),...patch}),result=structuredClone(controls);
 for(const f of FINE_COVERAGE_FIELDS){result[f.id].value=next[f.key];if(Object.hasOwn(result[f.id],'rawValue'))result[f.id].rawValue=String(next[f.key]);}
 return result;
}
