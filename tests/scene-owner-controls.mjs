// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.ok(fs.existsSync(new URL('../scene-owner-controls.mjs',import.meta.url)),'Selected scene objects cannot expose properties and shared playback yet');
const {createSceneOwnerControls}=await import('../scene-owner-controls.mjs');
class Element{constructor(){this.children=[];}append(...nodes){for(const n of nodes){n.remove?.();this.children.push(n);n.parent=this;}}remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}setAttribute(){}}
const document={createElement:()=>new Element()},viewport=new Element(),inspector=new Element();
let selected=null;const registry=createSceneOwnerControls({document,viewport,inspector,selected:()=>selected});
const root={},child={parent:root},other={},properties=new Element(),playback=new Element();let updates=0;
const relatedAssets=[];
const handle=registry.mount({asset:{id:'animal',root},relatedAssets,properties,playback,onSelected:()=>updates++});
assert.equal(properties.hidden,true);selected={id:'animal',object:root};registry.update();assert.equal(properties.hidden,false);assert.equal(playback.parent,viewport);assert.equal(playback.hidden,false);
selected={id:'bone',object:child};registry.update();assert.equal(playback.hidden,false,'a selected child stays with the owning creature');
selected={id:'@components',object:{},ownerId:'animal'};registry.update();assert.equal(properties.hidden,false,'a world-space component proxy keeps its owning inspector');
selected={id:'other',object:other};registry.update();assert.equal(properties.hidden,true);assert.equal(playback.hidden,true);
const area={};relatedAssets.push({id:'wander-area',root:area});selected={id:'wander-area',object:area};registry.update();
assert.equal(playback.hidden,false,'Selecting the real wander area must keep its creature playback controls');
handle.dispose();selected={id:'animal',object:root};registry.update();assert.equal(viewport.children.length,0);assert.equal(inspector.children.length,0);
const propertiesOnly=new Element();
const propertiesHandle=registry.mount({asset:{id:'animal',root},properties:propertiesOnly});registry.update();
assert.equal(propertiesOnly.hidden,false);assert.equal(viewport.children.length,0,'Properties-only behavior created a global-looking transport');
propertiesHandle.dispose();
console.log('Owner properties/transport follow actual selected roots and descendants and release independently');

assert.equal(typeof registry.mountOperating,'function','object operating controls must remain available without selection');

class OperatingElement extends EventTarget{
 children=[];style={};dataset={};offsetWidth=220;offsetHeight=110;classList={add(){}};
 append(node){node.parent=this;this.children.push(node);}remove(){if(this.parent)this.parent.children.splice(this.parent.children.indexOf(this),1);}
 contains(node){return node===this||this.children.includes(node);}
}
const operatingDoc=new EventTarget();operatingDoc.defaultView=new EventTarget();
const operatingViewport=new OperatingElement();let frame=null,position={x:350,y:180,bounds:{left:0,top:0,right:700,bottom:500}};
const controls=createSceneOwnerControls({document:operatingDoc,viewport:operatingViewport,inspector,selected:()=>null,project:()=>position,onFrame:fn=>{frame=fn;return()=>{frame=null;};}});
const a=new OperatingElement(),b=new OperatingElement();
const first=controls.mountOperating({asset:{id:'spigot',root:{}},node:a,side:'left'});
const second=controls.mountOperating({asset:{id:'mold',root:{}},node:b,side:'left'});
assert.equal(a.hidden,false);assert.equal(b.hidden,false,'both controls remain available with no selection');
assert.ok(Number.parseFloat(b.style.top)>=Number.parseFloat(a.style.top)+a.offsetHeight,'overlapping cards separate');
const before={...a.style};a.dispatchEvent(new Event('pointerdown'));position={...position,x:600};frame();assert.deepEqual(a.style,before,'controls stay still during first-touch manipulation');
operatingDoc.dispatchEvent(new Event('pointerup'));frame();assert.notDeepEqual(a.style,before);
operatingDoc.activeElement=b;const typing={...b.style};position={...position,y:300};frame();assert.deepEqual(b.style,typing,'keyboard focus holds the controls still');
operatingDoc.activeElement=null;position=null;frame();assert.equal(a.hidden,true,'removed or behind-camera roots do not leave misleading controls');
first.dispose();assert.ok(frame);second.dispose();assert.equal(frame,null);assert.equal(operatingViewport.children.length,0,'last owner releases its frame subscription and DOM');
