import cloud from './ash-scene-cloud.experiment.mjs';
export default {id:'ash-tiled-landscape',title:'Ash — retained landscape',async create(context){
 const defaults={cellSize:.04,width:7.68,height:1.6,centerZ:0,tileSize:16,landscapeObstacles:true,showAtmosphereControls:false,atmosphere:{enabled:false,count:0}};
 const inputs={...defaults,...context.inputs,tiled:true};
 const local=await cloud.create({...context,inputs});
 if(context.inputs?.initialVolume!==undefined){if(context.inputs.initialVolume>0)await local.operations.deposit({volume:context.inputs.initialVolume,radius:1.6,center:[0,local.read().identity.groundY,.8]});}
 else await local.operations.cover({depth:context.inputs?.initialDepth??.16});
 return {...local,mount(ctx){local.mount(ctx);const note=ctx.document.createElement('p');note.textContent='A continuous retained ash landscape. Tiles share material across their boundaries; settled regions keep their surface while local disturbances wake only the nearby field.';ctx.root.prepend(note);}};
}};
