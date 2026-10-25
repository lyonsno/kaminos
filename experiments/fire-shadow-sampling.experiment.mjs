import {createFireShadowSettings} from '../fire-shadow-settings.mjs';
export {createFireShadowSettings} from '../fire-shadow-settings.mjs';

export default {
  id:'fire-shadow-sampling',title:'Fire shadow sampling',
  async create({host,inputs,record,updateInputs=()=>{}}) {
    return createFireShadowSettings({session:await host.scene.open(),document:host.controls.document,inputs,record,updateInputs,diagnostics:true});
  },
};
