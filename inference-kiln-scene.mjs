// Adopt the current complete recipe through the same first-flame operation as
// ordinary scene authoring. A running renderer alone is not a scene domain.
export async function ensureKilnSceneDomain(host,flame){
 if(flame.read().scene.objects.some(entry=>entry.id==='flame-field'))return {created:false};
 const saved=await flame.saveBasin({label:'Inference Kiln development'});
 const id=saved.effective?.presetId;if(!id)throw Error('Kiln basin was not retained');
 await host.fire.add(id);
 if(!flame.read().scene.objects.some(entry=>entry.id==='flame-field'))throw Error('Kiln fire domain was not admitted');
 return {created:true,presetId:id};
}
