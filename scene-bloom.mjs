const defaults=Object.freeze({enabled:false,strength:.25,radius:.1,threshold:1.1});
export function checkedSceneBloom(value){
 const next={...defaults,...value};
 if(typeof next.enabled!=='boolean')throw Error('Bloom enabled must be Boolean');
 for(const key of ['strength','radius','threshold'])if(!Number.isFinite(next[key])||next[key]<0)throw Error(`Invalid bloom ${key}`);
 if(next.radius>1)throw Error('Bloom radius must be between zero and one');
 return next;
}
// One optional display stage in the existing renderer. Raw lighting and the
// independent flame canvas remain owned by their current producers.
export function createSceneBloom({bloom,convertToTexture,vec4,rebuild,redraw}){
 let settings={...defaults};const graphs=new Map();
 return {
  output(input){
   if(!settings.enabled)return input;
   if(!graphs.has(input)){
    const effect=bloom(convertToTexture(input),settings.strength,settings.radius,settings.threshold);
    graphs.set(input,{effect,output:vec4(input.rgb.add(effect.rgb),input.a)});
   }
   return graphs.get(input).output;
  },
  set(patch){const next=checkedSceneBloom({...settings,...patch}),changed=next.enabled!==settings.enabled;settings=next;
   for(const {effect}of graphs.values())for(const [key,field]of [['strength','strength'],['radius','radius'],['threshold','threshold']])effect[field].value=next[key];
   if(changed)rebuild();redraw();return this.read();
  },
  read:()=>({settings:{...settings},signal:'linear-scene-highlights',independentFlameCanvas:false}),
  dispose(){for(const {effect}of graphs.values())effect.dispose();graphs.clear();},
 };
}
