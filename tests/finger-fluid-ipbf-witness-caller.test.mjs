import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const source=readFileSync(new URL('../finger-fluid-truth-witness.mjs',import.meta.url),'utf8');
test('canonical witness forwards the explicitly expected boundary into trajectory evaluation',()=>{
 const call=source.match(/^\s+trajectoryAcceptance = ([^;]+);/m)?.[1];assert.ok(call);
 const actual=new Function('evaluateFingerFluidTruthTrajectory','effectiveTruthScene','trajectory','requestedBoundaryPressureContract','return '+call)((...args)=>args[2],'multi_regime_playground',[],'ipbf-collision-projection-only-v0');
 assert.deepEqual(actual,{boundaryPressureContract:'ipbf-collision-projection-only-v0'});
});
test('canonical witness uses isolated browser admission and mock-keychain flags',()=>{
 const start=source.indexOf("  phase = 'launch_browser';"),end=source.indexOf('  chromeProcess.stderr.on',start);assert.ok(start>=0&&end>start);
 const fragment=source.slice(start,end);let calls=[];
 const invoke=chrome=>new Function('chrome','debugPort','userDataDir','viewportWidth','viewportHeight','fluidBrowserLaunch','spawn','let phase,browserLaunch;'+fragment+';return chromeProcess;')(chrome,9912,'/fixture/profile',800,600,options=>fluidBrowserLaunch({...options,realpath:x=>x}),(exe,args)=>{calls.push({exe,args});return {};});
 invoke('/fixture/Google Chrome for Testing');assert.ok(calls[0].args.includes('--use-mock-keychain'));assert.ok(calls[0].args.includes('--password-store=basic'));
 calls=[];assert.throws(()=>invoke('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),/independent|operator Chrome/);assert.equal(calls.length,0);
});
