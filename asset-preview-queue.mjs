// One renderer, priority for the selected object, no result or collection cap.
export function createAssetPreviewQueue(render){
 const cache=new Map(),pending=[];let running=false;
 async function drain(){
  if(running)return;running=true;
  try{while(pending.length){
   const record=pending.shift();
   if(![...record.checks].some(check=>check())){cache.delete(record.key);record.resolve(null);continue;}
   try{record.resolve(await render(record.entry,record.size));}
   catch(error){cache.delete(record.key);record.reject(error);}
   record.checks.clear();
  }}finally{running=false;}
 }
 function request(entry,isCurrent,size,priority){
  if(entry.visibility?.status==='withheld')return Promise.resolve(null);
  const key=JSON.stringify([entry.source,entry.mtime,entry.size,size]),existing=cache.get(key);
  if(existing){existing.checks.add(isCurrent);return existing.promise;}
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const record={key,entry,size,checks:new Set([isCurrent]),promise,resolve,reject};cache.set(key,record);
  if(priority)pending.unshift(record);else pending.push(record);
  queueMicrotask(drain);return promise;
 }
 return{thumbnail:(entry,isCurrent=()=>true)=>request(entry,isCurrent,192,false),detail:(entry,isCurrent=()=>true)=>request(entry,isCurrent,512,true)};
}
