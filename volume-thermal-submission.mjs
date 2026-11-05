// Consumers may submit dependent mechanics only after their fluid commands.
export function createThermalSubmission() {
 const encoders=new WeakMap(),buffers=new WeakMap();
 return {
  record(encoder,continuation){
   if(typeof continuation!=='function')throw Error('Thermal submission continuation required');
   const list=encoders.get(encoder)??[];list.push(continuation);encoders.set(encoder,list);
  },
  finish(encoder){
   const buffer=encoder.finish(),list=encoders.get(encoder);
   if(list){buffers.set(buffer,list);encoders.delete(encoder);}return buffer;
  },
  submit(commands,submit){
   const list=Array.from(commands);const result=submit(list),continuations=[];
   for(const command of list){continuations.push(...(buffers.get(command)??[]));buffers.delete(command);}
   const errors=[];for(const continuation of continuations)try{continuation();}catch(error){errors.push(error);}
   if(errors.length)throw new AggregateError(errors,'Submitted thermal consumer failed');
   return result;
  },
 };
}
