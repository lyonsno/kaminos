import {paperBoxSetup,bindPaperPressureOperations} from '../paper-fluid/contributions.mjs';
export default {
 id:'hotwet/finite-host-check',title:'Finite water · host integration check',
 async create({host,inputs,record}){
  const setup=paperBoxSetup({resolution:16,...inputs});setup.solver.rendererMode='screen_space_refraction';setup.solver.opticalDebugMode='normal';
  const water=await host.fluid.open(setup),pressure=bindPaperPressureOperations({getSolver:water.getSolver,applyPressure:water.applyPressure});
  return {read:water.read,operations:{
   edit({id,value}){const result=pressure.edit(id,value);record({kind:'host-check.edit',phase:'requested',target:'fluid',requested:result.requested,effective:result.effective});return result;},
   advance:step=>water.advanceTo(step),range:()=>pressure.deriveSoftness(),restart:()=>water.restart(),
  },mount({root,invoke}){const button=host.controls.document.createElement('button');button.textContent='Derive current range';button.onclick=async()=>{const r=await invoke('range');button.textContent='Derived '+r.brackets.length+' reference values';};root.append(button);},dispose:water.dispose};
 }
};
