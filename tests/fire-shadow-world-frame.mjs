// kaminos-test: node
import assert from 'node:assert/strict';
import * as THREE from '../lib/three.webgpu.js';
import {createFireLightFieldShadow} from '../fire-light-field-shadow.mjs';

const {vec3}=THREE.TSL;
const pass=createFireLightFieldShadow({renderer:{},scene:{},sourceNode:vec3(0),receiverNode:vec3(1,2,3),normalNode:vec3(0,1,0)});
const samples=[];
pass.visibility.traverse(node=>{if(node.isCubeTextureNode)samples.push(node);});
// TextureNode.level() retains its base as a texture-binding reference. The
// clone owns the lookup coordinates; the binding is not a second lookup.
const bindings=new Set(samples.map(node=>node.referenceNode).filter(Boolean));
const lookups=[...new Set(samples)].filter(node=>!bindings.has(node));
assert.ok(lookups.length>0,'the visibility graph must contain shadow cube lookups');
function evaluate(node){
  if(node.isVarNode)return evaluate(node.node);
  if(node.isConstNode)return node.value.isVector3?node.value.toArray():node.value;
  if(node.constructor.name==='JoinNode')return node.nodes.flatMap(evaluate);
  if(node.constructor.name==='SplitNode'){const v=evaluate(node.node);const r=[...node.components].map(c=>v['xyzw'.indexOf(c)]);return r.length===1?r[0]:r;}
  if(node.constructor.name==='MathNode'&&node.method==='negate'){const v=evaluate(node.aNode);return Array.isArray(v)?v.map(x=>-x):-v;}
  throw Error(`Unexpected shadow-coordinate dependency: ${node.constructor.name}`);
}
for(const sample of lookups)for(const system of [THREE.WebGPUCoordinateSystem,THREE.WebGLCoordinateSystem]){
  const mapped=sample.setupUV({renderer:{coordinateSystem:system}},vec3(1,2,3));
  const matrices=[];mapped.traverse(n=>{if(n.isUniformNode&&n.value?.isMatrix4)matrices.push(n);});
  assert.equal(matrices.length,0,'world-space shadow lookup must not inherit material/environment rotation');
  assert.deepEqual(evaluate(mapped),system===THREE.WebGPUCoordinateSystem?[-1,2,3]:[1,2,3],'retain the bundled CubeCamera backend convention');
}
pass.dispose();
console.log('PASS shadow sampling stays in world frame with backend cube orientation');
