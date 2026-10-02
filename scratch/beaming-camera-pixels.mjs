import assert from 'node:assert/strict';
// These rectangles belong to the fixed 1600x1000 authored-kiln witness camera.
// The response patch is refractory above the opening, outside the flame canvas.
export const cameraPixelRegions={scene:[380,100,1210,930],refractory:[480,450,900,480]};
function stats(a,b,rect) {
  assert.ok(a?.data&&b?.data,'camera pixel evidence missing');
  assert.equal(a.width,1600);assert.equal(a.height,1000);
  assert.equal(b.width,a.width);assert.equal(b.height,a.height);
  let delta=0,n=0,lo=255,hi=0;const rgb=[0,0,0];
  for(let y=rect[1];y<rect[3];y++)for(let x=rect[0];x<rect[2];x++)for(let c=0;c<3;c++) {
    const i=(y*a.width+x)*4+c,v=a.data[i];
    delta+=Math.abs(v-b.data[i]);rgb[c]+=v;lo=Math.min(lo,v);hi=Math.max(hi,v);n++;
  }
  return {meanDelta:delta/n,rgb:rgb.map(v=>v/(n/3)),range:hi-lo};
}
export function assertCameraPixels(reference,views) {
  const result={regions:cameraPixelRegions,reference:stats(reference,reference,cameraPixelRegions.scene),views:{}};
  assert.ok(result.reference.range>1,'native reference must contain visible scene structure');
  for(const name of ['host','restored']) {
    const s=stats(views[name],reference,cameraPixelRegions.scene);result.views[name]=s;
    // Held native host/restored images were byte-identical in native003.
    // One code value of mean tolerance permits display quantization, not darkness.
    assert.ok(s.meanDelta<=1,`${name} must preserve independent native scene pixels: mean delta ${s.meanDelta}`);
  }
  for(const name of ['matched','ev','white','knee']) {
    const s=stats(views[name],name==='matched'?reference:views.matched,cameraPixelRegions.refractory);result.views[name]=s;
    assert.ok(s.meanDelta>1,`${name} transform must change controlled mesh pixels, not only metadata`);
  }
  const mean=v=>v.rgb.reduce((a,b)=>a+b)/3;
  assert.ok(mean(result.views.ev)>mean(result.views.matched),'positive EV must brighten the mesh patch');
  assert.ok(mean(result.views.knee)<mean(result.views.matched),'lower shoulder must compress the bright mesh patch');
  return result;
}
