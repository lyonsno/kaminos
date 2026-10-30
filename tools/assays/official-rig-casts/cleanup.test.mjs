import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {closeOwnedBrowser} from './cleanup.mjs';
const child=new EventEmitter();Object.assign(child,{pid:12345,exitCode:null,signalCode:null});const events=[];
child.kill=signal=>{events.push(signal);if(signal==='SIGKILL'){child.signalCode=signal;child.emit('exit',null,signal)}return true};
const browser={child,close:async()=>{assert.notEqual(child.signalCode,null,'profile cleanup must follow observed child exit');events.push('profile-cleanup')}};
const report={};await closeOwnedBrowser(browser,report,{grace:()=>Promise.resolve()});
assert.deepEqual(events,['SIGTERM','SIGKILL','profile-cleanup']);assert.equal(report.browserCleanup.exited,true);
console.log('unresponsive graceful exit requires exact-child recovery before profile cleanup');
