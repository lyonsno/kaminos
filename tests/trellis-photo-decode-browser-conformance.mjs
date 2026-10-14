// kaminos-test: manual — needs a real browser and a Kaminos server; run: KAMINOS_URL=http://127.0.0.1:PORT CHROME=/path PUPPETEER=/path/to/puppeteer-core.js node tests/trellis-photo-decode-browser-conformance.mjs
// The browser's own ImageDecoder output for JPEG, opaque WebP and PNG reaches U2Net as RGBA through
// prepareImageForTrellis (downstream segmentation and alpha preparation are stubbed; no GPU).
import assert from 'node:assert/strict';
const url=process.env.KAMINOS_URL,chrome=process.env.CHROME;
assert.ok(url&&chrome&&process.env.PUPPETEER,'KAMINOS_URL, CHROME and PUPPETEER are required');
const {default:puppeteer}=await import(process.env.PUPPETEER);
const browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--use-mock-keychain','--no-first-run']});
try{
  const page=await browser.newPage();await page.goto(url+'/favicon.ico').catch(()=>{});
  const rows=await page.evaluate(async()=>{
    const {prepareImageForTrellis}=await import('/authoring-trellis-page.mjs');
    const canvas=new OffscreenCanvas(8,8),ctx=canvas.getContext('2d');ctx.fillStyle='rgb(200,100,50)';ctx.fillRect(0,0,8,8);
    const out=[];
    for(const type of ['image/jpeg','image/webp','image/png']){
      const blob=await canvas.convertToBlob({type,quality:0.95}),bytes=new Uint8Array(await blob.arrayBuffer());let seen=null;
      try{
        const r=await prepareImageForTrellis({bytes,type,
          removeForegroundU2Net:async o=>{seen={channels:o.channels,first:[...o.pixels.slice(0,4)],len:o.pixels.length};const rgba=new Uint8Array(o.pixels);rgba[3]=0;return {rgba,width:o.width,height:o.height,provenance:{route:'stub'}};},
          prepareTrellisAlphaRgba:async o=>({pixels:new Uint8Array(512*512*3),width:512,height:512,provenance:{stub:true}}),runner:async()=>({})});
        out.push({type,route:r.provenance.route,nativeFormat:r.provenance.decoder.nativeFormat,seen});
      }catch(error){out.push({type,error:error.message});}
    }
    return out;
  });
  console.log(JSON.stringify(rows));
  for(const row of rows){
    assert.equal(row.error,undefined,`${row.type}: ${row.error}`);
    assert.equal(row.route,'browser-u2net',`${row.type} is opaque and goes to segmentation`);
    assert.equal(row.seen.first[3],255);assert.ok(Math.abs(row.seen.first[0]-200)<=8&&Math.abs(row.seen.first[1]-100)<=8&&Math.abs(row.seen.first[2]-50)<=8,`${row.type} RGB order: ${row.seen.first}`);
  }
  console.log('photo decode conformance passed:',rows.map(r=>`${r.type}=${r.nativeFormat}`).join(' '));
}finally{await browser.close();}
