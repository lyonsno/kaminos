import {resolveSceneGISettings} from './scene-gi-settings.mjs';

export function resolveProductGISettings(value={},diagnostics=false) {
  const next=resolveSceneGISettings(value);
  if(!diagnostics)next.mode='combined';
  return next;
}

export function resolveSceneCameraSettings(value={}) {
  const next={exposureEV:0,whiteBalanceKelvin:6504,highlightKnee:.6};
  for(const key of Object.keys(next))if(Object.hasOwn(value,key))next[key]=value[key];
  if(!Object.values(next).every(Number.isFinite)||!Number.isFinite(Math.fround(2**next.exposureEV))||next.whiteBalanceKelvin<=0||next.highlightKnee<0||next.highlightKnee>=1)throw Error('Invalid scene camera settings');
  return next;
}

export function resolveVolumeAppearanceTrims(value={}) {
  const next={flameStops:0,smokeStops:0};
  for(const key of Object.keys(next))if(Object.hasOwn(value,key))next[key]=value[key];
  if(!Object.values(next).every(v=>Number.isFinite(v)&&Number.isFinite(Math.fround(2**v))))throw Error('Invalid volume appearance trim');
  return next;
}

export function sceneLightingRestoreWarnings(scene) {
  if(scene?.composition?.route?.volume_light_field_distributed!=='1')return [];
  const post=scene.postprocessing||{},lighting=post.lighting||{},warnings=[];
  if(!Object.hasOwn(lighting,'@scene-transport'))warnings.push({
    code:'transport-not-saved',
    message:'This older scene did not store transported-light controls. The displayed values are not a recall of the capture.',
  });
  if(!post.sceneCamera && !Object.hasOwn(lighting,'@scene-camera'))warnings.push({
    code:'camera-link-not-saved',
    message:'Its original geometry/flame exposure-link mode was not stored.',
  });
  return warnings;
}

// These are deliberate product-path migrations, not fallback for unknown laws.
export function productTransportSettings(value) {
  const next={...value};
  if(!Object.hasOwn(next,'rendering-receiver-spacing'))next['rendering-receiver-spacing']='0';
  const key='rendering-angular-pattern';
  if(!['fixed','spatial','source','guided'].includes(next[key]))throw Error('Unknown lighting angular pattern');
  if(!['legacy','distributed'].includes(next['rendering-smoke-solver']))throw Error('Unknown smoke illumination solver');
  if(!['all','shared','flame-field','neither'].includes(next['rendering-light-mode']))throw Error('Unknown flame lighting mode');
  if(typeof next['rendering-surface-scattering']!=='boolean')throw Error('Invalid surface scattering setting');
  next[key]=next[key]==='guided'?'guided':'source';next['rendering-smoke-solver']='distributed';next['rendering-surface-scattering']=true;
  next['rendering-light-mode']='shared';
  return next;
}
