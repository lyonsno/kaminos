import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createPaintedSteelSource,paintedSteelSummary} from '../painted-steel-source.mjs';
export default surfaceTeacherExperiment({
 id:'painted-steel-teacher',title:'Blistered painted steel',createSource:createPaintedSteelSource,
 readSchema:'kaminos.painted-steel-teacher.v1',label:'Blistered painted steel specimen',sourceURL:'authored:painted-steel-v1',
 boundary:'Static authored coating geometry. Magenta shows geometric support, not a proven all-angle shading budget. Finite tile.',
 initialView:{position:[1.8,1.6,2.4],target:[0,.02,0],fov:40},defaultMaterials:[],
 defaultTracing:false,describeSource:paintedSteelSummary,sourceToggles:[['Show geometric support in magenta','showMask']],
 sourceControls:[['Blister clusters','source','patches',1,1],['Lift height','source','height',.002,.000001],['Support collar','source','supportMargin',.005,0],['Source seed','source','seed',1]],
});
