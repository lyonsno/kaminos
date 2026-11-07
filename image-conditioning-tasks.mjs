// A live control requests a desired value, not a batch of intermediate previews.
// Every waiter settles only after the latest requested result is applied.
export function createLatestConditioningTask({send,apply,onError=()=>{}}){
 let serial=0,desired=null,inFlight=null,closed=false;const waiters=[];
 const reject=error=>{inFlight=null;desired=null;for(const w of waiters.splice(0))w.reject(error);onError(error);};
 const dispatch=()=>{inFlight=desired;try{send(inFlight);}catch(error){reject(error);}};
 return {
  request(value){if(closed)return Promise.reject(Error('Conditioning task closed'));desired={id:++serial,value};const promise=new Promise((resolve,reject)=>waiters.push({resolve,reject}));if(!inFlight)dispatch();return promise;},
  complete(data){if(closed||!inFlight||data.id!==inFlight.id)return;inFlight=null;if(data.id!==desired.id){dispatch();return;}if(data.error){reject(Error(data.error));return;}try{apply(data);desired=null;for(const w of waiters.splice(0))w.resolve(data);}catch(error){reject(error);}},
  fail:reject,
  close(){closed=true;desired=inFlight=null;for(const w of waiters.splice(0))w.reject(Error('Conditioning task closed'));},
  read:()=>({requested:serial,pending:!!desired}),
 };
}
