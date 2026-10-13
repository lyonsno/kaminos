export function disposeAll(actions,message,initialError){
 const errors=initialError?[initialError]:[];
 for(const action of actions)try{action();}catch(error){errors.push(error);}
 if(errors.length)throw new AggregateError(errors,`${message}: ${errors.map(error=>error.message).join('; ')}`,{cause:initialError??errors[0]});
}
