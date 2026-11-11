import {Color} from '../lib/three.webgpu.js';
import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {createGrassTeacherSource} from '../surface-teacher-source.mjs';
export default surfaceTeacherExperiment({
 id:'grass-surface-teacher',title:'Grass surface teacher',createSource:createGrassTeacherSource,
 readSchema:'kaminos.grass-surface-teacher.v1',label:'Frozen grass ribbons',sourceURL:'procedural:frozen-grass-v1',
 boundary:'Finite grass patch on backing; not yet a periodic teacher.',
 initialView:{position:[2.5,1.7,3.2],target:[0,.35,0],fov:42},
 defaultMaterials:[{color:new Color(0x62513a).toArray(),roughness:.95,metalness:0},{color:new Color(0x71812c).toArray(),roughness:.65,metalness:0}],
 sourceControls:[['Blade count','source','blades',1,1],['Blade height','source','height',.02,.000001],['Blade width','source','bladeWidth',.002,.000001],['Blade bend','source','bend',.03],['Source seed','source','seed',1]],
});
