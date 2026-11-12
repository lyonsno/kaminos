// An authored diagnostic shoulder, not erosion simulation or realistic stone.
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export const shoulderStripDefaults=Object.freeze({width:.16,depth:.08,cellsX:256,cellsY:128,marks:true,gridSpacing:.016,lineWidth:.0025,relief:.014,inner:.08,collar:.04});
export function shoulderStripHeight(x,z,config=shoulderStripDefaults){
 const envelope=1-smooth(.045,.12,x),g=(cx,cz,rx,rz)=>Math.exp(-(((x-cx)/rx)**2+((z-cz)/rz)**2));
 const ledge=-config.relief*(1-smooth(.01,.105,x));
 const chip=-.003*g(.053,.018,.009,.007),bump=.0018*g(.075,-.018,.006,.008),groove=-.0015*Math.exp(-(((x-.094)/.0035)**2))*(0.6+.4*Math.cos(z*160));
 return Math.min(0,ledge+envelope*(chip+bump+groove))||0;
}
export function createShoulderStripSource(options={}){
 const config={...shoulderStripDefaults,...options};
 if(config.width!==.16||config.depth!==.08||!['cellsX','cellsY'].every(k=>Number.isSafeInteger(config[k])&&config[k]>=8)||typeof config.marks!=='boolean'||![config.gridSpacing,config.lineWidth,config.relief].every(x=>Number.isFinite(x)&&x>0)||config.lineWidth>=config.gridSpacing||config.relief>.03)throw Error('Invalid shoulder strip source');
 const materials=[{name:'stone diagnostic base',color:[.48,.43,.35],roughness:.88,metalness:0},{name:'blue grid u',color:[.13,.25,.34],roughness:.88,metalness:0},{name:'warm grid v',color:[.48,.23,.12],roughness:.88,metalness:0},{name:'grid crossing',color:[.12,.13,.13],roughness:.88,metalness:0}];
 const axis=(lo,hi,n)=>[lo-1,lo-.24,lo-.08,...Array.from({length:n+1},(_,i)=>lo+(hi-lo)*i/n),hi+.08,hi+.24,hi+1];
 const xs=axis(0,config.width,config.cellsX),zs=axis(-config.depth/2,config.depth/2,config.cellsY),triangles=[];
 const vertex=(x,z)=>[x-config.width/2,shoulderStripHeight(x,z,config),z];
 const line=x=>{const q=x/config.gridSpacing;return Math.abs(q-Math.round(q))*config.gridSpacing<config.lineWidth/2;};
 for(let j=0;j<zs.length-1;j++)for(let i=0;i<xs.length-1;i++){
  const x=(xs[i]+xs[i+1])/2,z=(zs[j]+zs[j+1])/2,u=line(x),v=line(z),materialIndex=config.marks?(u&&v?3:u?1:v?2:0):0;
  const a=vertex(xs[i],zs[j]),b=vertex(xs[i+1],zs[j]),c=vertex(xs[i+1],zs[j+1]),d=vertex(xs[i],zs[j+1]);
  const add=(a,b,c,k)=>triangles.push({a,b,c,materialIndex,identity:`shoulder-${i}-${j}-${k}`,uv:[a,b,c].map(p=>[(p[0]+config.width/2)/config.width,p[2]/config.depth+.5]),reference:{a:[a[0],0,a[2]],b:[b[0],0,b[2]],c:[c[0],0,c[2]]},carrier:{a:[a[0],0,a[2]],b:[b[0],0,b[2]],c:[c[0],0,c[2]]}});
  add(a,c,b,0);add(a,d,c,1);
 }
 return {schema:'kaminos.shoulder-strip-source.v1',config,triangles,materials,captureDomain:{width:config.width,depth:config.depth},referenceHeight:.00005,chart:{width:config.width,depth:config.depth,offsetMeters:.008,boundary:'clamp'},routing:{kind:'strip',width:config.width,depth:config.depth,inner:config.inner,collar:config.collar},boundary:'bounded16x8cm chart; full teacher geometry extends beyond queried region; clamped learned field is not periodic tiling',representation:'authored marked shoulder with chip, bump and groove; not realistic stone or simulated erosion'};
}
