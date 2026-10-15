import {mountInvestigation} from './investigation-mount.mjs';

// The common writer owns files and page lifetime. This adapter supplies only
// Flame's live context and source-event subscriptions; capture never redraws.
export function mountFlameInvestigation({page,out,source,guide={}}) {
  return mountInvestigation({page,out,source,install:async({id,binding,source})=>{
    await page.evaluate(async({id,binding,source,guide})=>{
      if(window.kaminosWorkbenchExperiments?.state().id!=='flame')throw Error('Open the Flame Workbench experiment before recording');
      const {createFlameInvestigation}=await import('/flame-workbench.mjs');
      const flame=await window.kaminosFlameWorkbench.open();
      window[binding+'Adapter']=createFlameInvestigation({flame,document,id,source,guide,
        request:request=>window[binding](request),
        mount:node=>window.kaminosWorkbenchSetInvestigation(node,{tool:'volume'})});
    },{id,binding,source,guide});
    const call=(method,arg)=>page.evaluate(({binding,method,arg})=>{
      const adapter=window[binding+'Adapter'];
      if(!adapter){if(method==='isPresent')return false;throw Error('Flame investigation is no longer present');}
      return adapter[method](arg);
    },{binding,method,arg});
    return {read:()=>call('read'),finish:()=>call('finish'),disconnect:message=>call('disconnect',message),
      saveFailed:message=>call('saveFailed',message),isPresent:()=>call('isPresent')};
  }});
}
