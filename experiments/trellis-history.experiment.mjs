// Product history controller, native scene and shared playback; no experiment renderer.
export default {
 id:'trellis-history',title:'TRELLIS generation history',
 async create({host,inputs,record}){
  if(!window.kaminosTrellisHistory)await new Promise(resolve=>document.addEventListener('kaminos-trellis-history-installed',resolve,{once:true}));
  const controller=await window.kaminosTrellisHistory.ensure();
  if(inputs.runId)await controller.open({runId:inputs.runId,assetSource:inputs.assetSource??null});

  const operations=Object.fromEntries(Object.entries(controller.operations).map(([name,operation])=>[name,async input=>{
   const result=await operation(input);record({kind:'trellis.history.'+name,phase:'applied',target:controller.read().runId,effective:result});return result;
  }]));
  return {read:controller.read,operations,mount({root}){window.kaminosTrellisHistory.mount(root);},dispose(){controller.operations.close();}};
 },
};
