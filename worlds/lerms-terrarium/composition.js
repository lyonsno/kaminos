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
    crucibleSeeds: manifest.crucibles.map(crucible => ({
      id: crucible.id,
      title: crucible.title,
      role: crucible.role,
      status: crucible.status,
      graduationMode: crucible.graduationMode,
      owner: crucible.custody.owner,
      smokeApparitionRoute: crucible.smokeApparitions[0]?.route || '',
    })),
    smokeOfferSeed: {
      label: 'LERMS Terrarium',
      route: manifest.witnesses[0]?.route || '',
      captureSurface: 'world-cartridge',
    },
  };
}

export default createLermsTerrariumComposition;
