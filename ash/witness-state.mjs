// Observed scene-wide checkpoint envelope, not a reconstructed startup recipe.
export function tiledCheckpointLocal(state){
 if(state?.schema!=='kaminos.scene-wide-ash.v1'||state.local?.schema!=='kaminos.kiln-gpu-ash.v1'||state.local.patch?.schema!=='kaminos.tiled-ash.v1'||!Array.isArray(state.local.patch.values))throw Error('Expected scene-wide ash checkpoint with local tiled physical state');
 return state.local;
}
