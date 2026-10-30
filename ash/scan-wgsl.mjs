// One cooperative workgroup scans contiguous chunks. Storage remains linear;
// no subgroup extension, CPU readback, extra dispatch, or capacity cap is needed.
export const ASH_SCAN_WIDTH=256;
export const ashScanWGSL=`
var<workgroup> ash_scan_scratch:array<u32,${ASH_SCAN_WIDTH}>;
fn ash_scan(value:u32,lane:u32)->vec2<u32>{
 ash_scan_scratch[lane]=value;workgroupBarrier();
 for(var offset=1u;offset<${ASH_SCAN_WIDTH}u;offset*=2u){
  var add=0u;if(lane>=offset){add=ash_scan_scratch[lane-offset];}
  workgroupBarrier();ash_scan_scratch[lane]+=add;workgroupBarrier();
 }
 let result=vec2<u32>(ash_scan_scratch[lane]-value,ash_scan_scratch[${ASH_SCAN_WIDTH-1}u]);
 // Every caller must finish reading before a subsequent scan reuses scratch.
 workgroupBarrier();return result;
}
`;
export function ashDrawPrefixWGSL(count,counter){return `${ashScanWGSL}
@compute @workgroup_size(${ASH_SCAN_WIDTH}) fn draw_prefix(@builtin(local_invocation_index) lane:u32){
 let chunk=(${count}u+${ASH_SCAN_WIDTH-1}u)/${ASH_SCAN_WIDTH}u;
 let begin=lane*chunk;let end=min(begin+chunk,${count}u);var sum=0u;
 for(var tile=begin;tile<end;tile++){sum+=atomicLoad(&headers[tile*8u+3u]);}
 let scanned=ash_scan(sum,lane);var offset=scanned.x;
 for(var tile=begin;tile<end;tile++){prefix[tile]=offset;offset+=atomicLoad(&headers[tile*8u+3u]);}
 if(lane==0u){prefix[${count}u]=scanned.y;atomicStore(&draw[1],scanned.y);atomicStore(&jobs[${counter}u],scanned.y);}
}`;}
export function ashAirAdmissionWGSL(groups){return `${ashScanWGSL}
fn ash_free(group:u32)->u32{
 return min(64u,p.dims.w-group*64u)-countOneBits(atomicLoad(&groupData[group*2u]))-countOneBits(atomicLoad(&groupData[group*2u+1u]));
}
@compute @workgroup_size(${ASH_SCAN_WIDTH}) fn prepare_fall(@builtin(local_invocation_index) lane:u32){
 if(lane==0u){atomicStore(&state[0],bitcast<u32>(bitcast<f32>(atomicLoad(&state[0]))+p.clock.y));atomicStore(&state[1],0u);atomicAdd(&state[2],1u);atomicStore(&draw[1],0u);}
 storageBarrier();
 let need=u32(ceil(bitcast<f32>(atomicLoad(&state[0]))/8.0));
 let chunk=(${groups}u+${ASH_SCAN_WIDTH-1}u)/${ASH_SCAN_WIDTH}u;
 let begin=lane*chunk;let end=min(begin+chunk,${groups}u);var freeSum=0u;
 for(var group=begin;group<end;group++){freeSum+=ash_free(group);}
 let freeStart=ash_scan(freeSum,lane).x;var freeBefore=freeStart;var count=0u;
 for(var group=begin;group<end;group++){
  let free=ash_free(group);let occupied=min(64u,p.dims.w-group*64u)-free;
  if(occupied>0u||(need>freeBefore&&free>0u)){count++;}freeBefore+=free;
 }
 let selected=ash_scan(count,lane);var slot=selected.x;freeBefore=freeStart;
 for(var group=begin;group<end;group++){
  let free=ash_free(group);let occupied=min(64u,p.dims.w-group*64u)-free;
  if(occupied>0u||(need>freeBefore&&free>0u)){atomicStore(&groupData[${groups*2}u+slot],group);slot++;}
  freeBefore+=free;atomicStore(&groupData[group*2u],0u);atomicStore(&groupData[group*2u+1u],0u);
 }
 if(lane==0u){atomicStore(&groupData[${groups*3}u],selected.y);atomicStore(&groupData[${groups*3+1}u],1u);atomicStore(&groupData[${groups*3+2}u],1u);}
}`;}
