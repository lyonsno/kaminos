import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createStoneTransitionSource} from '../stone-transition-source.mjs';
const experiment=surfaceTeacherExperiment({
 id:'stone-transition',title:'Stone parallax handoff',createSource:createStoneTransitionSource,
 label:'Authored stone transition source',sourceURL:'procedural:stone-transition-v1',
 boundary:'Authored stone shoulders join flat centers over a continuous backing. No simulated mortar or trained handoff is displayed in this source view.',
 initialView:{position:[2.8,2.1,3.1],target:[0,-.04,0],fov:42},
 sourceControls:[['Stone relief','source','relief',.002],['Shoulder width','source','margin',.002],['Corner rounding','source','bevel',.002],['Source seed','source','seed',1]],
});
export default {...experiment,create:context=>experiment.create({...context,inputs:{tracing:false,...context.inputs}})};
