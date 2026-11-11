// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {chooseSavedSceneFromLibrary} from '../scene-library-client.mjs';
test('worker library selection returns only the chosen source coordinates without parsing its scene on the page',async()=>{
 for(const choice of [{name:'local.kaminos.json'},{name:'remote.kaminos.json',store:{id:'peer',label:'Peer'}}]){
  const fetched=[];const result=await chooseSavedSceneFromLibrary({resolveDocument:false,pickSavedScene:async()=>choice,grFetchApi:()=>{throw Error('page read the document');},request:async url=>{fetched.push(url);if(url.startsWith('/api/scene-library'))return {ok:true,json:async()=>({stores:[]})};throw Error('page imported the document');}});
  assert.deepEqual(result,choice);assert.deepEqual(fetched,['/api/scene-library']);
 }
});
