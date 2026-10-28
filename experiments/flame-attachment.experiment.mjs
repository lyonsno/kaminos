export default {id:'flame-attachment',title:'Flame attachments · authored Compound Crown',
 async create({host}){
  const session=await host.scene.open(),api=window.kaminosFlameAttachments;
  if(!api)throw Error('Native flame attachment authoring is unavailable');
  const existing=window.kaminosSceneAuthoring.read().objects.find(o=>o.source==='kaminos:compound-crown');
  const id=existing?.id??api.addCrown();host.scene.select(id);
  return {read:()=>({objectId:id,attachment:api.read(id),outputs:api.outputs(id)}),operations:{set:value=>api.set(id,value),setMechanism:patch=>api.setMechanism(id,patch)},
   mount({root,document}){const p=document.createElement('p');p.textContent='Select Compound Crown, then use Flame attachment in Properties. Attach flame, choose Iris · clear inscribed radius, and set the local outlet Y at the opening you want to emit from. Add Fire & smoke to receive it. Scene Save retains the apparatus and connection; closing this experiment leaves authored objects in the scene.';root.append(p);},
   dispose:()=>session.dispose()};
 }
};
