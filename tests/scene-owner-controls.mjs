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
