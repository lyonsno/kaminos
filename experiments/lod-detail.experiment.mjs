// Ordinary scene rendering owns the automatic choices. This contribution gives
// the person a loaded object, native controls, and the same callable budget edit.
export default {
  id:'lod-detail',title:'Geometry and surface detail',
  async create({host,inputs,record}) {
    const source=inputs.source??'7b4703ca6624664642a301d61f601c2b1a42d2c122424f033ff5b742f01ec8b7';
    if(!/^[a-f0-9]{64}$/.test(source))throw Error('A stored generated mesh source is required');
    const session=await host.scene.open();let asset;
    try{asset=await session.loadAsset({url:`/api/read?root=generated-meshes&path=${source}.glb`,metadata:{label:'Geometry and surface detail',source:`/api/read?root=generated-meshes&path=${source}.glb`}});}
    catch(error){await session.dispose();throw error;}
    const budget=globalThis.kaminosSceneLodBudget;
    if(!budget){await session.dispose();throw Error('Automatic scene detail is not mounted');}
    if(inputs.view)session.setView(inputs.view);
    const read=()=>({source,objectId:asset.id,settings:budget.read(),allocation:budget.state()?.objects?.find(o=>o.id===asset.id)??null,textureBudget:budget.state()?.textures??null,view:session.readView()});
    return {
      read,
      operations:{
        setTextureBudget(bytes){
          if(bytes!==null&&(!Number.isFinite(bytes)||bytes<0))throw Error('Texture budget must be nonnegative bytes or null for unlimited');
          budget.setSettings({textureBudgetBytes:bytes===null?Infinity:bytes});session.redraw();
          const effective=read();record({kind:'lod-detail.texture-budget',phase:'applied',target:asset.id,requested:bytes,effective});return effective;
        },
        setView(view){const effective=session.setView(view);record({kind:'lod-detail.view',phase:'applied',target:asset.id,effective});return effective;},
      },
      mount({root,document}){
        const text=document.createElement('p');text.textContent='Orbit and zoom around the object. Geometry and surface maps adapt independently. The Render inspector shows their effective detail and separate budgets.';root.append(text);
      },
      dispose:()=>session.dispose(),
    };
  },
};
