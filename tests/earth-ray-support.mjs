// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {EarthSpecimen} from '../earth-specimen.mjs';
import {createEarthTeacherSource} from '../earth-surface.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
test('the finite capture neighborhood supports a deterministic set of steep material queries at the matrix sampling plane',()=>{
 const model=new EarthSpecimen({columns:4,layers:2,grains:2}),source=createEarthTeacherSource({snapshot:model.snapshot(),resolution:12,halo:1});model.dispose();
 assert.ok(Number.isFinite(source.samplingPlaneHeight)&&source.samplingPlaneHeight<source.referenceHeight);
 const bvh=buildTriangleVisibility(source.triangles);let state=41;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return(state+.5)/4294967296;};
 for(let i=0;i<64;i++){const u=random(),v=random(),r=Math.sqrt(random()*.99),a=random()*Math.PI*2,d=[r*Math.cos(a),-Math.sqrt(1-r*r),r*Math.sin(a)];const travel=(source.referenceHeight-source.samplingPlaneHeight)/-d[1],origin=[(u-.5)*source.config.tileSize-travel*d[0],source.referenceHeight,(v-.5)*source.config.tileSize-travel*d[2]];assert.ok(bvh.trace(origin,d),'this source/query fixture must reach represented material');}
});
