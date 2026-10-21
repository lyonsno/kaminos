/** Compile independent fluid pipelines together; drain every result before
 * initialization tears down resources on any failure. Factories also capture
 * synchronous descriptor/driver errors without abandoning other compilations. */
export async function compileFingerFluidPipelines(factories) {
 const entries=Object.entries(factories);
 const results=await Promise.allSettled(entries.map(([,factory])=>Promise.resolve().then(factory)));
 const failed=results.find(result=>result.status==='rejected');
 if(failed)throw failed.reason;
 return Object.fromEntries(entries.map(([name],index)=>[name,results[index].value]));
}
