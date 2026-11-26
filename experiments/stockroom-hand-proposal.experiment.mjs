import placeExperiment from './stockroom-place.experiment.mjs';
import {installHandProposal} from '../stockroom-hand-proposal-view.mjs';

export default {
  id: 'stockroom-hand-proposal',
  title: 'Stockroom - Hand and trackpad',
  async create(context) {
    const {host, record} = context;
    const proposalSession = await host.scene.open();
    let proposal, place;
    try {
      place = await placeExperiment.create({...context, attachProposal: async ({view, isPlaceEditing}) => {
        proposal = await installHandProposal({host, session: proposalSession, placeView: view, isPlaceEditing, record});
        return proposal;
      }});
      return {
        ...place,
        read: () => ({...place.read(), looseWood: proposal.read()}),
        operations: {...place.operations, ...proposal.operations},
        async dispose() {
          proposal.dispose();
          try {await proposalSession.dispose();} finally {await place.dispose();}
        },
      };
    } catch (error) {
      proposal?.dispose();
      await proposalSession.dispose();
      throw error;
    }
  },
};
