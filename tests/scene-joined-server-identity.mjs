// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {resolve} from 'node:path';
import * as witness from '../tools/joined-resident-witness.mjs';

// Execute the actual pre-browser admission block. The competing endpoint has
// exactly the requested source root and SHA, but belongs to another store.
const source=readFileSync(new URL('./scene-joined-edit-hold-smoke.mjs',import.meta.url),'utf8');
const block=source.slice(source.indexOf(' if(storeSource){'),source.indexOf(' report.executable='));
async function admit({wrongStore=false,exitDuringFetch=false}={}){
 const root=resolve('.'),stores=resolve('/fixture/output/runtime');
 const child={pid:1,exitCode:null,signalCode:null,stdout:{on(){}},stderr:{on(){}},once(){}};
 const runtime={source:{repoRoot:root,commit:'source-sha'},volumeSettingsStore:stores+'/settings',
  volumeBasinSessionStore:stores+'/basins',volumeCockpitLayoutStore:stores+'/layouts'};
 if(wrongStore)runtime.volumeSettingsStore='/operator/live/settings';
 const ctx={...witness,assert,resolve,URL,process,Error,Promise,setTimeout,report:{source:{rev:'source-sha'}},
  storeSource:'/fixture/input',out:'/fixture/output',url:'http://127.0.0.1:12345/',save:async()=>{},
  fs:{cp:async()=>{}},spawn:()=>child,fetch:async()=>{
   if(exitDuringFetch)child.exitCode=1;
   return {ok:true,json:async()=>runtime};
  }};
 await vm.runInNewContext('(async()=>{let server,serverExit,serverError;'+block+'})()',ctx);
}
test('correct source and isolated stores admit the owned live server',()=>admit());
test('occupied endpoint with matching source but different stores is refused',()=>assert.rejects(admit({wrongStore:true}),/store/i));
test('child exiting during the successful HTTP request is refused before browser launch',()=>assert.rejects(admit({exitDuringFetch:true}),/server.*exit/i));
