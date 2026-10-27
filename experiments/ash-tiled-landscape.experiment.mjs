import cloud from './ash-scene-cloud.experiment.mjs';
export default {id:'ash-tiled-landscape',title:'Ash — retained landscape',async create(context){
 const local=await cloud.create({...context,inputs:{cellSize:.03,width:3.84,height:.96,centerZ:.8,tileSize:16,...context.inputs,tiled:true}});
 const initialVolume=context.inputs?.initialVolume??.35;if(initialVolume>0){await local.operations.deposit({volume:initialVolume,radius:1.6,center:[0,local.read().identity.groundY,.8]});}
 return {...local,mount(ctx){local.mount(ctx);const note=ctx.document.createElement('p');note.textContent='Connected volumetric tiles retain settled ash. Drag the contact through the bed; only affected tiles evolve and changed faces rebuild. Save ash retains the evolved field and falling material.';ctx.root.prepend(note);}};
}};
