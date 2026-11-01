// kaminos-test: node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
// Expose private classes from the exact bundled engine without copying their logic.
const bundle=new URL('../lib/three.webgpu.js',import.meta.url);
const source=(await readFile(bundle,'utf8')).replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,bundle).href}'`);
const T=await import(`data:text/javascript;base64,${Buffer.from(source+'\nexport {RenderList as TestRenderList,RenderObjects as TestRenderObjects,NodeManager as TestNodes};').toString('base64')}`);
const renderer=new T.WebGPURenderer({canvas:{width:1,height:1,style:{},addEventListener(){}}});
const manager=renderer.lighting,scene=new T.Scene(),camera=new T.PerspectiveCamera();
const lights=[new T.PointLight(),new T.SpotLight()];
const list=new T.TestRenderList(manager,scene,camera);
function begin(lights,drawList=list){manager.beginRender(scene);drawList.begin();for(const light of lights)drawList.pushLight(light);drawList.finish();return drawList.lightsNode;}
// First ordinary draw, no explicit preparation beforehand. Nested drawing must
// restore its caller, and must not replace the outer scene's accepted lighting.
const accepted=begin(lights);const key=accepted.getCacheKey(true);
begin([lights[1]],new T.TestRenderList(manager,scene,new T.PerspectiveCamera()));manager.finishRender(scene);
assert.deepEqual(accepted.getLights().map(l=>l.id),lights.map(l=>l.id),'nested render restores the parent lights');
manager.finishRender(scene);
const generation=manager.prepare(scene,()=>{});
begin([...lights,new T.PointLight()]);
assert.deepEqual(list.lightsNode.getLights().map(l=>l.id),lights.map(l=>l.id),'preparation retains the completed draw, not its restored between-frame array');
assert.equal(list.lightsNode.getCacheKey(true),key);
manager.finishRender(scene);generation.discard();
begin([]);assert.deepEqual(list.lightsNode.getLights().map(l=>l.id),lights.map(l=>l.id),'failed replacement keeps accepted illumination');manager.finishRender(scene);
// The list gets reused every frame; accepted storage must not alias its array.
list.begin();assert.deepEqual(manager.getNode(scene).getLights(),lights);
console.log('PASS first draw, nesting, failed candidate and reused render list');

// Actual RenderObject ownership/cache behavior for the auxiliary GTAO draw.
const retired=[];
const nodes=new T.TestNodes(renderer,{});
const resources=new T.TestRenderObjects(renderer,nodes,{}, {delete:o=>retired.push(o)}, {deleteForRender(){}},{});
renderer._objects=resources;
const mesh=new T.Mesh(new T.BoxGeometry(),new T.NodeMaterial());
const context={id:71},clipping=null;
const getDepth=()=>resources.get(mesh,mesh.material,scene,camera,list.lightsNode,context,clipping);
manager.enabled=false;begin([]);const depth=getDepth(),depthKey=depth.getCacheKey();manager.finishRender(scene);manager.enabled=true;
const replacement=renderer.beginLightingPreparation(scene);replacement.node.setLights([new T.PointLight()]);replacement.commit();
manager.enabled=false;begin([]);const after=getDepth();
assert.equal(after,depth,'lighting promotion must reuse the unlit depth RenderObject');
assert.equal(after.getCacheKey(),depthKey,'depth graph cache identity survives promotion');
assert(!retired.includes(depth),'promotion must not dispose depth resources');
manager.finishRender(scene);manager.enabled=true;
console.log('PASS auxiliary depth resource/cache reuse across lighting promotion');
