import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createGroundTeacherSource} from '../ground-teacher-source.mjs';
export default surfaceTeacherExperiment({
 id:'ground-surface-teacher',title:'Authored ground teacher',createSource:createGroundTeacherSource,
 label:'Packed earth and embedded grit',sourceURL:'procedural:authored-ground-v1',
 boundary:'Periodic authored source with a finite repeated halo. Infinite periodic transport is not claimed. No soil evolution is simulated.',
 initialView:{position:[.85,.65,1],target:[0,0,0],fov:42},
 sourceControls:[['Grain count','source','grains',1],['Matrix relief','source','relief',.002],['Source seed','source','seed',1]],
});
