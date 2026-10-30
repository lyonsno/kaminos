// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {launchChrome} from '../../../models/flux2-klein/cdp-harness.mjs';
import {closeOwnedBrowser} from './cleanup.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cast-launch-test-'));const executable=path.join(dir,'fake-browser');
await fs.writeFile(executable,'#!/bin/sh\ntrap "" TERM\nexec /bin/sleep 600\n',{mode:0o755});
let owned;const report={};
// Force a rejection after spawn but before handle return. Ownership must already be visible.
try{await assert.rejects(()=>launchChrome(executable,[],report,{onSpawn:child=>{owned=child;throw Error('controlled post-spawn failure')}}),/controlled post-spawn failure/);
 assert.ok(owned?.pid,'launcher must return exact child ownership even when it rejects');
 await closeOwnedBrowser({child:owned,close:async()=>{assert.ok(owned.exitCode!==null||owned.signalCode!==null);await fs.rm(report.profile.dir,{recursive:true,force:true})}},report,{grace:()=>Promise.resolve()});
 assert.equal(report.browserCleanup.exited,true);console.log('partial launch retains exact child, waits for termination, then permits runner exit');
}finally{if(owned&&owned.exitCode===null&&owned.signalCode===null)owned.kill('SIGKILL');await fs.rm(dir,{recursive:true,force:true});}
