import {admitForegroundHandback} from './witness-checks.js';
export function checkU2NetApplicationWitness(r){
 const problems=[];
 if(!r.expectedRevision||r.source?.rev!==r.expectedRevision||r.source?.dirtyFiles?.length!==0)problems.push('clean exact source required');
 if(!r.outsideCheckout||!r.installed?.integrity||!r.kit?.integrity)problems.push('installed packages required');
 if(!r.browser?.effectiveBrowser||r.state?.adapter?.isFallbackAdapter!==false)problems.push('native browser adapter required');
 if(!r.state?.loading?.weights?.sha256||r.state.loading.weights.sha256!==r.weights?.sha256)problems.push('effective weight identity required');
 if(r.paused!=='paused'||!(r.pausedFrames>=2)||!r.stopped)problems.push('pause and stop/retry required');
 if(r.state?.runs?.length!==2)problems.push('two completed cutouts required');
 for(const [i,run] of (r.state?.runs??[]).entries())try{admitForegroundHandback(`run ${i}`,run.queue);}catch(e){problems.push(e.message);}
 if(r.repeatDifference!==0||r.directDifference!==0)problems.push('direct and repeated output must match');
 if(!(r.referenceMaxDifference<=1)||!(r.output?.bytes>0)||!r.output?.sha256||!(r.output?.transparent>0)||!(r.output?.opaque>0))problems.push('complete nonblank reference cutout required');
 if(r.state?.gpuErrors?.length!==0)problems.push('GPU errors');
 if(r.state?.afterDestroy?.session!=='active'||r.state?.afterDestroy?.routes!==0||r.state?.afterDestroy?.foregroundDisposed!==false||!(r.framesAfterDestroy>=2))problems.push('borrowed host survival required');
 return problems;
}
