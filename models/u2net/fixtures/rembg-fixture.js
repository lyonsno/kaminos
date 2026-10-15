// Deterministic inputs for the rembg/Pillow contracts. The bytes are produced
// here and recorded by export-rembg-fixtures.mjs together with what rembg 2.0.76
// and Pillow 12.3 compute from exactly these bytes.
function random(seed){
  return ()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
}
// A noisy photo-like RGB image: gradient background, a few discs and noise.
export function fixtureImage(width,height,seed,channels=3){
  const rand=random(seed),px=new Uint8Array(width*height*channels),discs=[];
  for(let i=0;i<5;i++)discs.push([rand()*width,rand()*height,(0.08+rand()*0.25)*Math.min(width,height),[rand()*255,rand()*255,rand()*255]]);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let c=[40+180*x/width,60+150*y/height,200-120*x/width];
    for(const [cx,cy,r,col] of discs)if((x-cx)**2+(y-cy)**2<r*r)c=col;
    for(let k=0;k<3;k++)px[(y*width+x)*channels+k]=Math.max(0,Math.min(255,Math.round(c[k]+(rand()-.5)*24)));
    if(channels===4)px[(y*width+x)*4+3]=255;
  }
  return px;
}
// A synthetic 320x320 U2Net sigmoid output: a soft blob with rand jitter, F32.
export function fixturePrediction(seed){
  const rand=random(seed),out=new Float32Array(320*320);
  for(let y=0;y<320;y++)for(let x=0;x<320;x++){
    const d=Math.hypot(x-170,y-150)/90;out[y*320+x]=Math.fround(1/(1+Math.exp(6*(d-1)))*0.97+0.01+rand()*0.004);
  }
  return out;
}
export const RESAMPLE_CASES=[
  {w:257,h:191,channels:3,ow:320,oh:320,seed:1},  // upsample both axes
  {w:1500,h:900,channels:3,ow:1024,oh:614,seed:2}, // source pre-resize shape
  {w:640,h:480,channels:3,ow:320,oh:320,seed:3},
  {w:320,h:320,channels:1,ow:777,oh:513,seed:4},   // mask back to image size
  {w:300,h:200,channels:3,ow:300,oh:97,seed:5},    // vertical pass only
  {w:300,h:200,channels:4,ow:150,oh:200,seed:6},   // horizontal pass only, 4 channels
];
export const PIPELINE_CASES=[
  {w:1500,h:1000,seed:11,predSeed:21}, // pre-resized to 1024x682
  {w:600,h:800,seed:12,predSeed:22},   // no pre-resize
];
