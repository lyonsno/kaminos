// kaminos-test: node
import assert from 'node:assert/strict';
import {organizeFireRenderingPanel} from '../fire-rendering-panel.mjs';
class Element {
  constructor(){this.children=[];this.hidden=false;}
  append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(v=>v!==node);this.children.push(node);node.parentElement=this;}}
  closest(){return this.parentElement;}
  setAttribute(){}
}
const ids=['rendering-fire-controls','rendering-light-study','rendering-shared-gain','rendering-surface-gain','rendering-source-softness','rendering-match-flame-camera','rendering-angular-samples','rendering-fire-shadows','rendering-angular-pattern'];
const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
const labels=new Map(['rendering-angular-samples','rendering-angular-pattern'].map(id=>[`label[for="${id}"]`,new Element()]));
const document={getElementById:id=>elements[id],createElement:()=>new Element(),querySelector:selector=>labels.get(selector)};
const legacy=elements['rendering-light-study'];
for(const id of ids.slice(2)){const row=new Element();row.append(elements[id]);legacy.append(row);}
legacy.append(...labels.values());
const gain=elements['rendering-shared-gain'];gain.value='3';gain.listener=()=>42;
organizeFireRenderingPanel(document);
assert.equal(legacy.hidden,true);
assert.equal(elements['rendering-fire-controls'].hidden,false);
assert.equal(gain.value,'3');assert.equal(gain.listener(),42,'reparent existing controls, preserving state and handlers');
assert.equal(gain.parentElement.parentElement,elements['rendering-fire-controls']);
assert.equal(elements['rendering-fire-shadows'].parentElement,elements['rendering-fire-controls']);
const childCount=elements['rendering-fire-controls'].children.length;
organizeFireRenderingPanel(document);
assert.equal(elements['rendering-fire-controls'].children.length,childCount,'repeated organization does not duplicate controls');
console.log('PASS shipping fire panel preserves live controls while removing the study surface');
