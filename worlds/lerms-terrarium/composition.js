export const LERMS_TERRARIUM_COMPOSITION_SCHEMA = 'kaminos.world-cartridge.composition.v0';

export function createLermsTerrariumComposition(manifest) {
  return {
    schema: LERMS_TERRARIUM_COMPOSITION_SCHEMA,
    cartridgeId: manifest.id,
    title: manifest.title,
    defaultScene: {
      chamber: manifest.defaultChamber,
      route: manifest.defaultRoute,
      recipeId: 'underhill-preview',
    },
    mountedAffordances: manifest.affordanceBindings.map(binding => ({
      id: binding.id,
      kind: binding.kind,
      owner: binding.owner,
      route: binding.route,
    })),
    smokeOfferSeed: {
      label: 'LERMS Terrarium',
      route: manifest.witnesses[0]?.route || '',
      captureSurface: 'world-cartridge',
    },
  };
}

export default createLermsTerrariumComposition;
