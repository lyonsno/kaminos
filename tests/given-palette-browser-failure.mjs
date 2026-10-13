// kaminos-test: node
import assert from 'node:assert/strict';
import {mountGivenPaletteMotion} from '../experiments/creature-motion/given-palette-browser.mjs';
class Element {constructor(){this.children=[];this.style={};this.attributes={};}append(...nodes){this.children.push(...nodes);}prepend(node){this.children.unshift(node);}setAttribute(key,value){this.attributes[key]=value;}}
const mountRoot=new Element(),document={createElement:()=>new Element()},priorWindow=globalThis.window,priorFetch=globalThis.fetch;
globalThis.window={};globalThis.fetch=async()=>new Response('{"fixture":"wrong digest"}',{headers:{'content-type':'application/json'}});
try{
 await assert.rejects(mountGivenPaletteMotion({motionUrl:'/wrong-motion.json',motionSha256:'0'.repeat(64),frameUrl:'/frame.json',frameSha256:'1'.repeat(64),caseSha256:'2'.repeat(64),mountRoot,document}),/digest mismatch/);
 assert.equal(window.kaminosGivenMotion.snapshot().phase,'source-authentication');
 const alert=mountRoot.children.find(node=>node.attributes.role==='alert');
 assert.ok(alert,'motion authentication failure must publish a human-visible alert');
 assert.match(alert.textContent,/Motion did not mount/);assert.match(alert.textContent,/source-authentication/);assert.match(alert.textContent,/digest mismatch/);
}finally{globalThis.window=priorWindow;globalThis.fetch=priorFetch;}
console.log('Rejected motion publishes phase/error visibly, retaining exact diagnostic rejection');
