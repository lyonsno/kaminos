// The existing helper's ten-second grace period applies only after work has ended.
// Observe exit before delegating profile deletion; never turn a timeout into success.
export async function closeOwnedBrowser(browser,report,{grace=()=>new Promise(r=>{const t=setTimeout(r,10000);t.unref?.()})}={}){
 const child=browser.child;report.browserCleanup={pid:child.pid,exited:false};
 const ended=()=>child.exitCode!==null||child.signalCode!==null;
 if(!ended()){
  const exit=new Promise(resolve=>child.once('exit',resolve));
  child.kill('SIGTERM');await Promise.race([exit,grace()]);
  if(!ended()){
   report.browserCleanup.recoverySignal='SIGKILL';
   if(!child.kill('SIGKILL')&&!ended())throw Error(`could not stop owned browser ${child.pid}`);
   await exit;
  }
 }
 if(!ended())throw Error(`owned browser ${child.pid} has no observed exit`);
 report.browserCleanup.exited=true;
 await browser.close();
}
