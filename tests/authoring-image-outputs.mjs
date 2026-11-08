// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as generation from '../authoring-image-generation.mjs';

test('caller output presentation retains pixels and only selects on explicit View',async()=>{
 assert.equal(typeof generation.installKleinCallerOutputs,'function','caller output needs its own visible destination');
 class Element{
  constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.attributes={};this.draws=[];}
  append(...children){this.children.push(...children);}
  setAttribute(k,v){this.attributes[k]=v;}
  getContext(){return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:image=>this.draws.push([...image.data])};}
 }
 const document={createElement:tag=>new Element(tag)},root=new Element('section'),selected=[],retried=[];
 const output={id:'job-1',prompt:'lantern',status:'failed',pending:true,error:'Storage offline',preview:{runId:'job-1',kind:'final',width:1,height:1,rgba:new Uint8ClampedArray([1,2,3,255])}};
 const controller={read:()=>({outputs:[output]}),retryOutput:async id=>retried.push(id)};
 const ui=generation.installKleinCallerOutputs({document,root,controller,assets:{select:entry=>selected.push(entry)}});ui.render();
 const row=root.children[0].children[1],canvas=row.children[1],status=row.children[2],retry=row.children[3],view=row.children[4];
 assert.deepEqual(canvas.draws,[[1,2,3,255]]);assert.match(status.textContent,/Storage offline/);assert.equal(retry.hidden,false);assert.equal(view.disabled,true);assert.deepEqual(selected,[]);
 await retry.onclick();assert.deepEqual(retried,['job-1']);
 output.status='complete';output.pending=false;output.error=null;output.entry={source:'/caller.png',name:'lantern.png'};ui.render();
 assert.equal(retry.hidden,true);assert.equal(view.disabled,false);assert.equal(canvas.draws.length,1,'status changes do not repaint identical pixels');assert.deepEqual(selected,[]);
 view.onclick();assert.equal(selected[0].source,'/caller.png');assert.equal(selected[0].kind,'image');
});
