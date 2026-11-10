import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
export default surfaceTeacherExperiment({
 id:'grass-surface-teacher',title:'Grass surface teacher',createSource:createGrassTeacherSource,
 label:'Frozen grass ribbons',sourceURL:'procedural:frozen-grass-v1',
 boundary:'Finite grass patch on backing; not yet a periodic teacher.',
 initialView:{position:[2.5,1.7,3.2],target:[0,.35,0],fov:42},
 defaultMaterials:[{color:[.122,.082,.042],roughness:.95,metalness:0},{color:[.165,.22,.025],roughness:.65,metalness:0}],
 sourceControls:[['Blade count','source','blades',1],['Blade height','source','height',.02],['Blade width','source','bladeWidth',.002],['Blade bend','source','bend',.03],['Source seed','source','seed',1]],
});
