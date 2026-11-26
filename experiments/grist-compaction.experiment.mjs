import {createGristRegions} from './grist-regions.experiment.mjs';

export default {
  id:'grist-compaction',
  title:'Grist — compacted earth bed',
  create:context=>createGristRegions(context,{compaction:true}),
};
