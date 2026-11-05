// kaminos-test: node
import assert from 'node:assert/strict';
import {installOwnerExperimentEntry} from '../owner-experiment-entry.mjs';
class Element {constructor(){this.children=[];this.nodes=new Map();this.style={};}append(...v){this.children.push(...v);}replaceChildren(...v){this.children=v;}addEventListener(){}querySelector(k){if(!this.nodes.has(k))this.nodes.set(k,new Element());return this.nodes.get(k);}}
globalThis.Option=class extends Element {constructor(text,value){super();this.textContent=text;this.value=value;}};
const document={createElement:()=>new Element()},changes=[];
const moduleUrl='data:text/javascript,'+encodeURIComponent(`export default {id:'initial-inputs',title:'Initial inputs',async create({updateInputs}){updateInputs({objectId:'retained'});return {read:()=>({}),operations:{},mount(){updateInputs({objectId:'retained',mounted:true});}};}}`);
const entry=await installOwnerExperimentEntry({document,root:new Element(),host:{},discover:async()=>[{id:'initial-inputs',title:'Initial inputs',moduleUrl}],onChange:v=>changes.push(v)});
await entry.open('initial-inputs',{fixture:true});assert.deepEqual(changes.at(-1).inputs,{objectId:'retained',mounted:true},'Opening must not replace accepted create/mount input updates with the original fixture request');
await entry.close();console.log('Owner initialization retains effective recovery identity');
