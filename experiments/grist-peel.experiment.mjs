import { createGristRegions } from './grist-regions.experiment.mjs';

export default {
  id: 'grist-peel',
  title: 'Grist — peelable material slab',
  create: context => createGristRegions(context, { slab: true }),
};
