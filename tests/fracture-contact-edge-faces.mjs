// kaminos-test: node
import assert from 'node:assert/strict';
import {boxContactShape,contactShapeFeatures} from '../fracture-contact-shape.mjs';

const shape=boxContactShape([1,2,3]),features=contactShapeFeatures(shape);
assert.ok(Array.isArray(features.edgeFaces),'Closed hull edges must carry both incident support faces');
assert.equal(features.edgeFaces.length,features.edges.length);
for(let i=0;i<features.edges.length;i++){
 const [a,b]=features.edges[i],faces=features.edgeFaces[i];
 assert.equal(faces.length,2);
 assert.notEqual(faces[0],faces[1]);
 for(const face of faces){
  const ids=shape.faces[face];
  assert.ok(ids.some((v,j)=>v===a&&ids[(j+1)%ids.length]===b||v===b&&ids[(j+1)%ids.length]===a),'Both incident faces must contain the actual edge');
 }
}
// An open or T-junction edge has no certified two-face normal cone. Preserve
// that distinction so runtime contact can use the exhaustive projection path.
const open={...shape,faces:shape.faces.slice(1)},incomplete=contactShapeFeatures(open);
assert.ok(incomplete.edgeFaces.some(f=>f.length!==2));
console.log('Complete edge incidence and incomplete-boundary fallback are explicit');
