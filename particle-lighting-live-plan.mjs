export function liveParticleLightingSettings(input={}){
 const s={enabled:false,width:16,transportWidth:16,directions:8,filterLength:.125,padding:1,supportSigmas:4,albedo:.35,gain:1,mode:2,...input};
 if(typeof s.enabled!=='boolean')throw Error('Lighting enable must be boolean');
 for(const k of ['width','transportWidth'])if(!Number.isSafeInteger(s[k])||s[k]<2)throw Error(k+' must be an integer of at least 2');
 if(!Number.isSafeInteger(s.directions)||s.directions<2||s.directions%2)throw Error('Light directions must be a positive even count');
 for(const k of ['filterLength','padding','gain'])if(!Number.isFinite(s[k])||s[k]<0||!Number.isFinite(Math.fround(s[k])))throw Error(k+' must be finite and nonnegative');
 if(!Number.isFinite(s.supportSigmas)||s.supportSigmas<=0||!Number.isFinite(s.albedo)||s.albedo<0||s.albedo>1||![0,1,2].includes(s.mode))throw Error('Invalid lighting support, scattering albedo or view');return s;
}
export const LIVE_LIGHT_SOLVE_KEYS=['width','transportWidth','directions','filterLength','padding','supportSigmas'];
export function particleLightingSourcePlan({records,state,settings:input}){
 const settings=liveParticleLightingSettings(input),context=state?.lightingSource,native=state?.settings;
 if(state?.effective!=='world-optical-particles'||!context||typeof context.identity!=='string'||!native)throw Error('A native particle source route is required');
 if(!Number.isSafeInteger(state.slots)||state.slots<1||!(records instanceof Float32Array)||records.length!==state.slots*24||!records.every(Number.isFinite))throw Error('A complete finite native particle population is required');
 if(!Number.isSafeInteger(context.revision)||context.revision<0)throw Error('A native material revision is required');
 if(!Array.isArray(context.dims)||context.dims.length!==3||context.dims.some(v=>!Number.isSafeInteger(v)||v<1)||!Number.isFinite(context.step))throw Error('Invalid native source geometry');
 const material=context.material,keys=['radius','stretch','flowAlignment','expansion','supportFloor','gain','opacity','stateLife','lifeFade'];
 if(keys.some(k=>!Number.isFinite(native[k])||native[k]<0)||!material||['density','extinction','smokeVisible'].some(k=>!Number.isFinite(material[k])||material[k]<0))throw Error('Effective native source optics are required');
 const sourceSettings=Object.fromEntries(keys.map(k=>[k,native[k]]));sourceSettings.extinction=material.density*material.extinction*material.smokeVisible*native.opacity;delete sourceSettings.opacity;sourceSettings.supportSigmas=settings.supportSigmas;
 sourceSettings.carrierMode=native.carrierMode??0;
 const lo=[-1,-1,-1],hi=[1,-1+2*context.dims[1]/context.dims[0],1];let active=0;
 for(let i=0;i<state.slots;i++){
  const p=i*24;if(records[p+3]<=0||records[p+16]<=0||records[p+19]<=0||((native.stateLife>0||native.carrierMode===1)&&records[p+15]>=1)||!(records[p+8]>0||records[p+9]>0||records[p+10]>0||records[p+22]>0))continue;active++;
  let axis=[0,1,0];if(native.flowAlignment>0){let x=records[p+17],y=records[p+18],z=1-Math.abs(x)-Math.abs(y);const t=Math.max(0,Math.min(1,-z));x+=x>=0?-t:t;y+=y>=0?-t:t;const len=Math.hypot(x,y,z);const mixed=[x/len*native.flowAlignment,1-native.flowAlignment+y/len*native.flowAlignment,z/len*native.flowAlignment],length=Math.hypot(...mixed);if(length>1e-10)axis=mixed.map(v=>v/length);}
  const remaining=records[p+11],growth=1+native.expansion*(remaining>0?Math.max(0,1-records[p+20]/remaining):0),radius=Math.max(records[p+16],native.supportFloor)*native.radius*growth;
  for(let k=0;k<3;k++){const support=settings.supportSigmas*Math.sqrt(radius*radius*(1+(native.stretch*native.stretch-1)*axis[k]*axis[k]))+settings.filterLength;lo[k]=Math.min(lo[k],records[p+k]-support);hi[k]=Math.max(hi[k],records[p+k]+support);}
 }
 const margin=settings.padding*(hi[0]-lo[0])/settings.width;for(let k=0;k<3;k++){lo[k]-=margin;hi[k]+=margin;}
 const pitch=(hi[0]-lo[0])/settings.width,dims=[settings.width,Math.ceil((hi[1]-lo[1])/pitch),Math.ceil((hi[2]-lo[2])/pitch)],extent=dims.map(v=>v*pitch);
 if([...lo,...extent,...dims].some(v=>!Number.isFinite(v))||dims.some(v=>v<1||v>0xffffffff))throw Error('Live source bounds exceed representable field geometry');
 return {dims,origin:lo,extent,slots:state.slots,active,sourceIdentity:context.identity,sourceStep:context.step,sourceFrame:context.frame,sourceRevision:context.revision,sourceSettings,transportWidth:settings.transportWidth,directionCount:settings.directions,filterLength:settings.filterLength};
}
