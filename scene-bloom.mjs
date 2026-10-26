const defaults=Object.freeze({enabled:false,strength:.25,radius:.1,threshold:1.1,composeFlame:false});
export function checkedSceneBloom(value){
 const next={...defaults,...value};
 if(typeof next.composeFlame!=='boolean')throw Error('Flame composition must be Boolean');
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
  output(input,emission){
   if(!settings.enabled)return input;
   if(!emission)throw Error('Bloom requires a physical emission input');
   if(graphs.has(input)&&graphs.get(input).emission!==emission)throw Error('Bloom emission source changed without a new graph');
   if(!graphs.has(input)){
    const effect=bloom(convertToTexture(emission),settings.strength,settings.radius,settings.threshold);
    graphs.set(input,{effect,emission,output:vec4(input.rgb.add(effect.rgb),input.a)});
   }
   return graphs.get(input).output;
  },
  set(patch){const next=checkedSceneBloom({...settings,...patch}),changed=next.enabled!==settings.enabled||next.composeFlame!==settings.composeFlame;settings=next;
   for(const {effect}of graphs.values())for(const [key,field]of [['strength','strength'],['radius','radius'],['threshold','threshold']])effect[field].value=next[key];
   if(changed)rebuild();redraw();return this.read();
  },
  read:()=>({settings:{...settings},signal:'physical-emission',independentFlameCanvas:false}),
  dispose(){for(const {effect}of graphs.values())effect.dispose();graphs.clear();},
 };
}
