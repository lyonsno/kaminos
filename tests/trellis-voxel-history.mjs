// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {buildOccupancyCoordinatesPlan,createTrellisOccupancyPreview} from '../models/trellis2/occupancy-coordinates.js';
import {voxelFrameFromPreview,validateVoxelFrame,validateVoxelHistory,readVoxelHistoryFrame} from '../models/trellis2/voxel-history.js';
globalThis.crypto??=webcrypto;
const make=()=>{const coordinates={buffer:{},shape:[2,3],dtype:'i32',usage:140,byteLength:24},preview=createTrellisOccupancyPreview({runtime:{device:{}},coordinates,plan:buildOccupancyCoordinatesPlan({resolution:8}),runId:'one-run',routeId:'trellis2.actual',steps:12,invocation:{jobId:'job',invocationId:'invocation'},isCurrent:()=>true});return {preview,frame:voxelFrameFromPreview(preview,{atSeconds:2}),coordinates:new Int32Array([0,0,0,1,2,3])};};
test('product frame preserves source component order, exact grid transform, clock and identity',()=>{
 const {frame,preview,coordinates}=make();assert.equal(validateVoxelFrame(frame,coordinates),frame);assert.equal(frame.runId,preview.runId);assert.deepEqual(frame.spatial.sourceToGltf,preview.spatial.sourceToGltf);assert.deepEqual(frame.grid,preview.grid);
 assert.throws(()=>validateVoxelFrame(frame,coordinates.subarray(0,3)),/complete/);
 assert.throws(()=>validateVoxelFrame(frame,new Int32Array([0,0,0,0,0,0])),/unique/);
 assert.throws(()=>validateVoxelFrame(frame,new Int32Array([0,0,0,4,2,3])),/in-grid/);
 assert.throws(()=>validateVoxelFrame({...frame,spatial:null},coordinates),/explicit/);
});
test('a retained frame verifies its exact bytes and refuses mixed run identity',async()=>{
 const {frame,coordinates}=make(),raw=coordinates.buffer.slice(0),sha=Buffer.from(await crypto.subtle.digest('SHA-256',raw)).toString('hex');
 const stored={...frame,coordinates:{sha256:sha,byteLength:24}},history={schema:'trellis2.voxel-history.v1',runId:frame.runId,label:'Shoe',source:{kind:'retained-reference-replay'},frames:[stored],unknownFutureField:true};
 assert.equal(validateVoxelHistory(history),history);assert.throws(()=>validateVoxelHistory({...history,runId:'wrong'},frame.runId),/requested/);
 assert.deepEqual(await readVoxelHistoryFrame({frame:stored,fetcher:async()=>({ok:true,arrayBuffer:async()=>raw})}),coordinates);
 await assert.rejects(readVoxelHistoryFrame({frame:stored,fetcher:async()=>({ok:true,arrayBuffer:async()=>raw.slice(0,12)})}),/partial or changed/);
});
