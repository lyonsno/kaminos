// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createKilnBurnWindow} from '../kiln-burn-window.mjs';
const source=readFileSync(new URL('../inference-kiln-preview.mjs',import.meta.url),'utf8');
const prepare=source.slice(source.indexOf('  async function prepare('),source.indexOf('\n\n  const ground='));
const advance=source.slice(source.indexOf('  function advanceBurnWindow('),source.indexOf('\n  if(post.bloom?.composeFlame',source.indexOf('  function advanceBurnWindow(')));
function fixture(initial){
 let now=0;const state={active:false,request:initial,burnWindow:null,draftTimer:null,prepareRevision:0,promptPreparation:null,preparedText:'words',preparation:Promise.resolve(),warmup:Promise.resolve(),disposed:false,preparedHeight:1000,KILN_PROMPT_WINDOW_HEIGHT:520,feedPixels:0,feedSteps:0,burnTimer:null,finishing:false,finishResolve:null,prompt:'words',target:{object:{userData:{kaminosPromptRelief:{burnerSeconds:5}}}},plan:{promptObjectId:'p'},burning:{read:()=>({status:'resident'}),reset(){}},editor:{sync(){}},positionFeed(){},clearTimeout(){},setTimeout(){return 1;},queueMicrotask,failure:assert.fail,setEmission(value){state.emitting=value;},async setActive(value){state.active=value;},createKilnBurnWindow:options=>createKilnBurnWindow({...options,clock:()=>now})};
 runInNewContext(prepare+advance+';globalThis.prepare=prepare;globalThis.advance=advanceBurnWindow;',state);return {state,setNow:value=>now=value};
}
for(const initial of [null,{id:'one'}])test(`admitted burner initializes and completes from ${initial?'active construction':'cold preview'}`,async()=>{
 const f=fixture(initial),s=f.state;await s.prepare({prompt:'words',request:{id:'one'}});assert.ok(s.burnWindow,'first admitted request must own a burner window');
 s.burnWindow.start();s.active=true;s.advance();assert.equal(s.emitting,true);
 const window=s.burnWindow;await s.prepare({prompt:'words',request:{id:'one'}}).catch(error=>{assert.match(error.message,/Pause combustion/);});s.active=false;await s.prepare({prompt:'words',request:{id:'one'}});assert.equal(s.burnWindow,window,'same admission retains its clock');
 s.active=true;f.setNow(6000);s.finishing=true;const done=new Promise(resolve=>s.finishResolve=resolve);s.advance();await done;assert.equal(s.emitting,false);assert.equal(s.active,false);assert.equal(s.request,null);assert.equal(s.feedPixels,480);
});
