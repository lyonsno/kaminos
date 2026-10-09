import assert from 'node:assert/strict';
import {voxelizeTriangleSolid} from '../volume-scene-solid.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
import {buildSceneOccupancy,occupancyDistance,instrumentOccupancy} from '../scratch/beaming-occupancy-visibility.mjs';
import {replayMaterial} from '../scratch/beaming-bounded-comparison.mjs';
import {readFileSync} from 'node:fs';
const exteriorWall=[[[-2,-1,2],[2,-1,2],[2,3,2]],[[-2,-1,2],[2,3,2],[-2,3,2]]];
// Failing baseline: the fluid collision raster cannot represent this blocker.
const baseline=voxelizeTriangleSolid(exteriorWall,16);
assert.equal(baseline.surfaceCellCount,0,'fluid-only control excludes the exterior wall');
const pack=triangles=>buildTriangleVisibility(triangles.map(([a,b,c])=>({a,b,c}))).packGpu();
// Observed saved-scene loading route constructs an empty gather before assets
// arrive. It must remain usable, but cannot satisfy the nonempty kiln witness.
const loadingProxy=buildSceneOccupancy(pack([]),[],32);
assert.equal(loadingProxy.metadata.nodeCount,0);
assert.equal(occupancyDistance(loadingProxy,[0,1,4],[0,0,-1]),1e20);
const proxy=buildSceneOccupancy(pack(exteriorWall),[{position:[0,1,4]}],32);
assert(proxy.metadata.surfaceCellCount>0,'visibility geometry must include blockers outside the fluid box');
const hit=occupancyDistance(proxy,[0,1,4],[0,0,-1]);
assert(hit<=2&&hit>=2-proxy.metadata.pitch*2,'conservative exterior blocker remains before source-volume entry');
assert.equal(occupancyDistance(proxy,[0,1,4],[0,0,1]),1e20,'away ray misses');
assert.equal(occupancyDistance(proxy,[0,1,4],[0,0,-1],{far:1}),1,'far bound excludes later blocker');
// Two wall strips leave an aperture. Geometry resolution, not fluid resolution,
// owns whether that opening survives.
const quad=(x0,x1)=>[[[x0,-1,0],[x1,-1,0],[x1,3,0]],[[x0,-1,0],[x1,3,0],[x0,3,0]]];
const slit=buildSceneOccupancy(pack([...quad(-1,-.3),...quad(.3,1)]),[],32);
assert.equal(occupancyDistance(slit,[0,1,1],[0,0,-1]),1e20,'resolved slit stays open');
assert(occupancyDistance(slit,[.7,1,1],[0,0,-1])<=1,'wall blocks beside slit');
assert.throws(()=>buildSceneOccupancy(pack(exteriorWall),[],12),/power-of-two/);
assert.throws(()=>instrumentOccupancy('unrecognized shader',32),/seam mismatch/);
const instrumented=instrumentOccupancy(readFileSync(new URL('../scene-volume-gather.mjs',import.meta.url),'utf8'),32);
assert(instrumented.includes('const localLimit')||instrumented.includes('let localLimit'));
const dims=[16,32,16],primary=new Float32Array(16*32*16*4);
for(let i=3;i<primary.length;i+=4)primary[i]=.1;
primary[(8+16*(4+32*8))*4]=10;
const original=replayMaterial(primary,dims,'original'),moved=replayMaterial(primary,dims,'displaced'),split=replayMaterial(primary,dims,'split');
assert.notDeepEqual(original.guide,moved.guide);
for(const r of [moved,split]){assert.equal(r.metadata.emissionSum,10);for(let i=3;i<primary.length;i+=4)assert.equal(r.source[i],primary[i]);}
assert.equal(split.source.filter((v,i)=>i%4!==3&&v>0).length,2);
console.log('scene coverage, exterior blockers, resolved slit, missed/far-bound rays passed');
