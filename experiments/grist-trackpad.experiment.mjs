import {createGristRegions} from './grist-regions.experiment.mjs';

export default {
  id: 'grist-trackpad',
  title: 'Grist — trackpad peel',
  create: context => createGristRegions(context, {slab:true, trackpad:true}),
};
