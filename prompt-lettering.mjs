import {createInferenceKiln} from './inference-kiln.mjs';
export function createPromptLettering(document,prompt,appearance='incineration'){
 const source=createInferenceKiln({document,prompt,appearance,representation:'relief',stage:false});
 const mesh=source.detachText();source.dispose();return mesh;
}
