import {surfaceTeacherExperiment} from './surface-teacher-experiment.mjs';
import {mountEarthRenderControls} from './earth-workshop-controls.mjs';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {createEarthTeacherSource} from '../earth-surface.mjs';
const definition=surfaceTeacherExperiment({id:'earth-surface-teacher',title:'Earth specimen transport',createSource:createEarthTeacherSource,label:'Frozen worked earth',sourceURL:'kaminos:earth-specimen-integral',boundary:'Frozen physical specimen with a bounded source. Return to the workshop to continue forming it.',initialView:{position:[.63,.48,.69],target:[0,.065,0],fov:40},sourceControls:[]});
export default {...definition,async create(context){
 const inputs={...context.inputs};if(!inputs.source){const model=new EarthSpecimen();try{inputs.source={snapshot:model.snapshot(),resolution:24,halo:0};}finally{model.dispose();}}
 const instance=await definition.create({...context,inputs});let ui;
 return {...instance,mount({document,invoke}){ui=mountEarthRenderControls({document,host:context.host,sessionRead:instance.read,invoke,back:()=>window.kaminosWorkbenchExperiments.open('earth-material',{...inputs.authoring,snapshot:instance.read().source.snapshot})});},async dispose(){ui?.dispose();await instance.dispose();}};
}};
