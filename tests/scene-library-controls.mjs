import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('top Load and the keyboard/library command open server scenes, with file import secondary',()=>{
  assert.ok(/onclick="openSceneLibrary\(\)"[^>]*>Load<\/button>/.test(html),'top Load must reach the scene library');
  const shortcut=html.slice(html.indexOf('// Keyboard shortcuts: Ctrl+S'),html.indexOf('// --- Init ---'));
  assert.ok(shortcut.includes('openSceneLibrary()'));
});

test('scene browser distinguishes ordinary saves and includes unfamiliar provenance',async()=>{
  class Node {
    children=[];style={};textContent='';className='';
    append(...children){this.children.push(...children);}appendChild(child){this.append(child);}
    set innerHTML(value){this.children=[];}get innerHTML(){return '';}
  }
  const list=new Node(),files={
    'plain.kaminos.json':{label:'Kiln',timestamp:'2026-10-08T15:14:55Z',provenance:{source_group:'local'}},
    'capture.kaminos.json':{label:'Kiln',timestamp:'2026-10-07T15:14:55Z',capture:{image:'data:image/png;base64,YQ==',capturedAt:'yesterday'}},
    'new-source.kaminos.json':{label:'Imported scene',timestamp:'2026-10-08T15:15:55Z',provenance:{source_group:'new-tool'}},
  };
  const start=html.indexOf('async function grBrowseScenes()'),end=html.indexOf('async function grBrowseScratch()',start);
  const context=vm.createContext({document:{getElementById:()=>list,createElement:()=>new Node()},currentSceneFile:null,
    grFetchApi:async(endpoint,{path})=>endpoint==='browse'?{entries:Object.keys(files).map(name=>({name}))}:files[path]});
  vm.runInContext(html.slice(start,end),context);await vm.runInContext('grBrowseScenes()',context);
  const all=[];function visit(node){all.push(node);for(const child of node.children)visit(child);}visit(list);
  assert.equal(all.filter(n=>n.className==='gr-scene-time').length,3,'every scene needs visible save identity, even without Capture');
  assert.ok(all.some(n=>n.textContent==='Imported scene'),'new provenance must not silently hide a saved scene');
});
