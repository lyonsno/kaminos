import {createGristRegions} from './grist-regions.experiment.mjs';

export default {
  id:'grist-mixing',
  title:'Grist — mix an earth specimen',
  create:context=>createGristRegions(context,{compaction:true,mixing:true}),
};
