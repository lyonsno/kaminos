// kaminos-test: node
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
// Observed contribution format; controlled host refuses an authored-water conflict.
function fixture(){
 const nodes=new Map();const node=key=>{if(!nodes.has(key))nodes.set(key,{value:'',textContent:'',listeners:{},addEventListener(k,f){this.listeners[k]=f;},replaceChildren(){}});return nodes.get(key);};
 const section={querySelector:node};return {nodes,document:{createElement:()=>section},root:{append(){}}};
}
for(const where of ['onOpen','factory'])test('failed '+where+' leaves chooser, address and actual entry empty',async()=>{
 const f=fixture(),changes=[],oldOption=globalThis.Option;globalThis.Option=class{constructor(text,value){this.text=text;this.value=value;}};
 try{
  const definition='data:text/javascript,'+encodeURIComponent(`export default {id:'refused',title:'Refused',create(){${where==='factory'?"throw Error('Close authored water');":"return {read(){return{};}};"}}}`);
  const entry=await installOwnerExperimentEntry({...f,host:{},discover:async()=>[definition],onOpen(){if(where==='onOpen')throw Error('Close authored water');},onChange:value=>changes.push(value)});
  const select=f.nodes.get('select');select.value='refused';await assert.rejects(entry.open('refused'),/Close authored water/);
  assert.equal(entry.state().id,null);assert.equal(select.value,'','A refused requested entry must not remain checkmarked');assert.equal(changes.at(-1)?.id,null,'Address must agree with absence of an effective entry');
 }finally{globalThis.Option=oldOption;}
});
