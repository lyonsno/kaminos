// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import definition from '../experiments/flame-blend.experiment.mjs';

// A small DOM surface for the endpoint selection contract. Pixel layout is
// exercised by the browser witness; this checks what the selector claims.
async function cockpit(){
 const doc={activeElement:null};
 class Element extends EventTarget{
  constructor(tag){super();this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attrs={};this.value='';this.hidden=false;this.textContent='';}
  append(...children){for(const child of children){if(typeof child==='object')child.parentNode=this;this.children.push(child);}}
  insertBefore(child,before){const previous=this.children.indexOf(child);if(previous>=0)this.children.splice(previous,1);const index=this.children.indexOf(before);this.children.splice(index<0?this.children.length:index,0,child);child.parentNode=this;}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attrs[key]=value;}
  querySelectorAll(selector){const all=this.children.filter(child=>typeof child==='object').flatMap(child=>[child,...child.querySelectorAll('*')]);return selector==='details[open]'?all.filter(child=>child.tagName==='DETAILS'&&child.open):all;}
 }
 doc.createElement=tag=>new Element(tag);
 let settings={domControls:{'volume-physical-thermal':{type:'range',value:2}},rendererControls:{},presentationControls:{}};
 const flame={beginPreview(){throw Error('No preview expected');},initialize(){throw Error('No initialization expected');},read:()=>({active:true,present:true}),settings:()=>structuredClone(settings),subscribe:()=>()=>{},listBasins:async()=>({entries:[{presetId:'old',label:'Older preset'}]}),readBasin:async()=>({...structuredClone(settings),source:{presetId:'old',label:'Older preset'}})};
 const scene={onFrame:()=>()=>{},dispose(){}};
 const instance=await definition.create({host:{flame:{open:async()=>flame},scene:{open:async()=>scene},controls:{installNumberDrag(){}}},inputs:{},record(){}});
 const root=new Element('div');await instance.mount({root,document:doc,invoke:async(name,value)=>instance.operations[name](value)});
 const select=root.querySelectorAll('*').find(node=>node.attrs['aria-label']==='Endpoint A preset');
 return {instance,select,setHeat(value){settings.domControls['volume-physical-thermal'].value=value;}};
}
test('capturing an endpoint selects its actual capture instead of an empty or previously selected preset',async()=>{
 const f=await cockpit();try{
  f.instance.operations.capture('a');assert.equal(f.select.value,'@current');
  const current=()=>f.select.children.find(option=>option.value==='@current');
  assert.equal(current().textContent,f.instance.read().a.label);assert.equal(current().hidden,false);
  await f.instance.operations.choose({slot:'a',presetId:'old'});assert.equal(current().textContent,'Older preset');
  f.setHeat(9);f.instance.operations.capture('a');
  assert.equal(f.select.value,'@current');assert.match(current().textContent,/^Capture · [0-9a-f]{8}$/);assert.notEqual(current().textContent,'Older preset');
 }finally{await f.instance.dispose();}
});
