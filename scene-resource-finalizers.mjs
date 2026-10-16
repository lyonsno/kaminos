// Custom finalizers own the complete producer allocation, including its Three
// resources. Retirement is independent of removal: history may still retain it.
export function createSceneResourceFinalizers({onError=error=>console.error(error)}={}){
 const entries=new WeakMap();
 return Object.freeze({
  register(root,finalize){
   if(!root||typeof finalize!=='function')throw Error('Scene resource finalizer requires a root and callback');
   if(entries.has(root))throw Error('Scene root already has a resource finalizer');
   const entry={finalize,promise:null};entries.set(root,entry);
   return ()=>{if(!entry.promise&&entries.get(root)===entry)entries.delete(root);};
  },
  has:root=>entries.has(root),
  canRestore:root=>entries.has(root)&&!entries.get(root).promise,
  pending:root=>entries.get(root)?.promise,
  retire(root){
   const entry=entries.get(root);if(!entry)throw Error('Scene root has no producer resource finalizer');
   if(!entry.promise){
    entry.promise=Promise.resolve().then(()=>entry.finalize(root));
    entry.promise.catch(error=>{try{onError(error);}catch(reportError){console.error('Producer cleanup reporting failed',reportError);}});
   }
   return entry.promise;
  },
 });
}
