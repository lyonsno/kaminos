const defaults={enabled:true,count:24000,extent:[24,12,24],wind:[.035,-.08,.018],flakeSize:.009,opacity:.46,density:.018,color:[.12,.105,.085]};
export function atmosphereSettings(input={}) {
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid ash atmosphere settings');
 const s={...defaults,...input};
 const triple=(v,positive=false)=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&(!positive||x>0));
 if(typeof s.enabled!=='boolean'||!Number.isSafeInteger(s.count)||s.count<0||!triple(s.extent,true)||!triple(s.wind)||!triple(s.color)||s.color.some(x=>x<0)||!Number.isFinite(s.flakeSize)||s.flakeSize<=0||!Number.isFinite(s.opacity)||s.opacity<0||s.opacity>1||!Number.isFinite(s.density)||s.density<0)throw Error('Invalid ash atmosphere settings');
 // Each invocation owns arrays; caller edits cannot change a live field.
 for(const key of ['extent','wind','color'])s[key]=[...s[key]];
 return s;
}
export const transmittance=(density,distance)=>Math.exp(-density*Math.max(0,distance));
export function compositeFoggedVolume({color,alpha,fog,density,distance}){const t=transmittance(density,distance);return color.map((c,i)=>t*c+alpha*(1-t)*fog[i]);}
export function ashHash(seed){let h=seed>>>0;h=Math.imul(h^(h>>>16),0x7feb352d)>>>0;h=Math.imul(h^(h>>>15),0x846ca68b)>>>0;return ((h^(h>>>16))>>>0)/4294967296;}
export function flakePosition({index,time,camera,extent,wind}){return camera.map((c,k)=>{const size=extent[k],v=ashHash(index*3+k+1)*size+wind[k]*time-c+size/2;return ((v%size)+size)%size+c-size/2;});}
