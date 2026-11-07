// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {installMeshModelChoice} from '../authoring-trellis-generation.mjs';

// Small DOM fixture for the real component. Select assignment follows browser behavior:
// assigning an absent option clears selection. A browser witness also exercises native DOM.
class Element{
 constructor(tag,document){this.tagName=tag;this.document=document;this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this._value='';}
 set id(value){this._id=value;}get id(){return this._id;}
 get options(){return this.children.filter(e=>e.tagName==='option');}
 get value(){return this._value;}set value(value){this._value=this.tagName==='select'&&!this.options.some(e=>e.value===value)?'':value;}
 append(...nodes){for(const node of nodes){node.parent?.children.splice(node.parent.children.indexOf(node),1);node.parent=this;this.children.push(node);}}
 before(node){this.parent.insertBefore(node,this);}after(node){this.parent.insertBefore(node,this.parent.children[this.parent.children.indexOf(this)+1]);}
 insertBefore(node,reference){node.parent?.children.splice(node.parent.children.indexOf(node),1);node.parent=this;const i=this.children.indexOf(reference);this.children.splice(i<0?this.children.length:i,0,node);}
 querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
 querySelectorAll(selector){if(selector===':scope > p')return this.children.filter(e=>e.tagName==='p');return this.children.flatMap(e=>[...(selector.startsWith('#')?e.id===selector.slice(1):e.tagName===selector)?[e]:[],...e.querySelectorAll(selector)]);}
 set innerHTML(html){
  this.children=[];const stack=[this];
  for(const token of html.match(/<[^>]+>|[^<]+/g)??[]){
   if(token.startsWith('</')){stack.pop();continue;}
   if(token.startsWith('<')){const tag=token.match(/^<(\w+)/)[1],node=new Element(tag,this.document);node.id=token.match(/\bid="([^"]+)"/)?.[1];node._value=token.match(/\bvalue="([^"]+)"/)?.[1]??'';node.hidden=/\bhidden(?:\s|>|=)/.test(token);stack.at(-1).append(node);if(tag!=='input')stack.push(node);}
   else stack.at(-1).textContent+=token;
  }
  for(const select of this.querySelectorAll('select'))select.value=select.options[0]?.value??'';
 }
}
function fixture({initial='sf3d',busy=()=>false,changed=()=>{}}={}){
 const document={createElement:tag=>new Element(tag,document),getElementById:id=>document.body.querySelector('#'+id)};document.body=new Element('body',document);
 const pane=document.createElement('div');pane.id='asset-generate';document.body.append(pane);
 const heading=document.createElement('p');heading.textContent='Image → textured mesh';const run=document.createElement('button');run.id='asset-run';pane.append(heading,run);
 const reads=[],writes=[];const storage={getItem:key=>{reads.push(key);return key==='kaminos.trellis.page-finishing'?'surface-preserving':null;},setItem:(...args)=>writes.push(args)};
 const choice=installMeshModelChoice({document,initial,busy,changed,storage});return {document,choice,reads,writes,select:document.getElementById('asset-mesh-model')};
}
test('Generate offers one TRELLIS model using the cooperative page consumer',()=>{
 const f=fixture();assert.deepEqual(f.select.options.filter(o=>!o.hidden).map(o=>[o.value,o.textContent]),[['sf3d','Stable Fast 3D'],['trellis-page','TRELLIS 2']]);
 f.select.value='trellis-page';f.select.onchange();assert.equal(f.choice.value(),'trellis-page');
});
test('native-style finishing is automatic even with a previous Preserve detail preference',()=>{
 const f=fixture({initial:'trellis-page'});assert.equal(f.choice.finishing(),'original-remesh');
 assert.equal(f.document.getElementById('asset-trellis-finishing'),null);assert.equal(f.document.getElementById('asset-express'),null);
 assert.deepEqual(f.reads,[]);assert.deepEqual(f.writes,[],'old preferences stay untouched');
});
test('legacy queued model selection resolves to the same page consumer',()=>{
 const changes=[],f=fixture({initial:'trellis',changed:value=>changes.push(value)});assert.equal(f.choice.value(),'trellis-page');
 f.select.value='trellis';f.select.onchange();assert.equal(f.choice.value(),'trellis-page');assert.deepEqual(changes,['trellis-page']);
});
test('Stable Fast 3D and busy picker locking remain available',()=>{
 let busy=true;const f=fixture({busy:()=>busy});assert.equal(f.choice.value(),'sf3d');assert.equal(f.select.disabled,true);
 busy=false;f.choice.render();assert.equal(f.select.disabled,false);
});
