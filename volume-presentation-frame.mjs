import {validateSceneSourceTransform} from './scene-volume-source.mjs';

// Presentation carries the complete physical frame; it does not resize cells.
export function composeVolumePresentationTransform(physical, presentation) {
  const local=validateSceneSourceTransform(physical);
  const parent=validateSceneSourceTransform(presentation);
  return validateSceneSourceTransform({
    translate:local.translate.map((x,a)=>parent.translate[a]+parent.scale*x),
    scale:parent.scale*local.scale,
  });
}
