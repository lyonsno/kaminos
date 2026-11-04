import {BufferGeometry,BufferAttribute,Box3,Vector3,Sphere} from '../../lib/three.core.js';
import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {storage,Fn,wgslFn,instanceIndex,uint,float,uniform,mix,attribute as tslAttribute,positionLocal,normalLocal} from '../../lib/three.tsl.js';
import {terrainConfig,makeRidges,ROUTE} from './model.mjs';

const init=wgslFn(`fn hill_initial(v:u32,n:u32,width:f32,length:f32,soil:f32,ridges:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);var ridge=0.;
 for(var k=0u;k<arrayLength(ridges);k+=2u){let a=(*ridges)[k];let b=(*ridges)[k+1u];let d=b.xy-a.xy;let t=clamp(dot(p-a.xy,d)/dot(d,d),0.,1.);let r=p-a.xy-t*d;let w=mix(a.w,b.w,t);ridge=max(ridge,mix(a.z,b.z,t)*exp(-dot(r,r)/(2.*w*w)));}
 let grain=.5+.5*sin(p.x*2.1+.7*sin(p.y*1.4))*sin(p.y*1.8+p.x*.4);let edge=f32(min(min(x,z),min(n-1u-x,n-1u-z)))/f32(n-1u);let coast=min(1.,edge/.10);
 return vec4<f32>(.09+coast*(ridge*.78+.025*grain),coast*(.055+soil*(.3+.7*ridge/1.8)),0.,0.);
}`);
const flux=wgslFn(`fn hill_flux(v:u32,n:u32,dx:f32,dz:f32,talus:f32,fraction:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let h=s.x+s.y;var e=vec4<f32>(0.);
 if(x>0u){let a=(*state)[v-1u];e.x=max(0.,h-a.x-a.y-talus*dx);}if(x+1u<n){let a=(*state)[v+1u];e.y=max(0.,h-a.x-a.y-talus*dx);}
 if(z>0u){let a=(*state)[v-n];e.z=max(0.,h-a.x-a.y-talus*dz);}if(z+1u<n){let a=(*state)[v+n];e.w=max(0.,h-a.x-a.y-talus*dz);}
 let sum=e.x+e.y+e.z+e.w;if(sum<=0.){return vec4<f32>(0.);}return e*(min(s.y,sum*.25)*fraction/sum);
}`);
const move=wgslFn(`fn hill_move(v:u32,n:u32,width:f32,length:f32,dt:f32,uplift:f32,state:ptr<storage,array<vec4<f32>>,read_write>,flow:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let f=(*flow)[v];var incoming=0.;
 if(x>0u){incoming+=(*flow)[v-1u].y;}if(x+1u<n){incoming+=(*flow)[v+1u].x;}if(z>0u){incoming+=(*flow)[v-n].w;}if(z+1u<n){incoming+=(*flow)[v+n].z;}
 let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);
 let bed=s.x+uplift*dt*exp(-((p.x+.4)*(p.x+.4))/3.-((p.y+1.5)*(p.y+1.5))/.5);
 let soil=max(0.,s.y+incoming-f.x-f.y-f.z-f.w);return vec4<f32>(bed,soil,(bed+soil-s.x-s.y)/dt,s.w);
}`);
const geologyBankFlux=wgslFn(`fn hill_geo_bank(v:u32,n:u32,width:f32,length:f32,dx:f32,dz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,hardness:f32,seed:f32,stepStyle:f32,meso:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let s=(*state)[v];
 let u=f32(xi)/f32(n-1u);let w=f32(zi)/f32(n-1u);let x=(u-.5)*width;let z=(w-.5)*length;
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let frac=phase-floor(phase);let sineBand=max(0.,.5+.5*sin(phase*6.2831853));
 let benchCap=smoothstep(.22,.42,frac)*(1.-.35*smoothstep(.92,1.,frac));
 let band=clamp(mix(sineBand,benchCap,.65*clamp(stepStyle,0.,1.)),0.,1.);
 let strength=1.+hardness*(band*band*band*band);
 let bankLim=1.376*(1.+1.6*clamp(stepStyle,0.,1.));
 let rate=(.14*(1.-.55*clamp(stepStyle,0.,1.)))/strength;
 var b=vec4<f32>(0.);
 if(xi>0u){let a=(*state)[v-1u];b.x=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dx)*rate);}
 if(xi+1u<n){let a=(*state)[v+1u];b.y=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dx)*rate);}
 if(zi>0u){let a=(*state)[v-n];b.z=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dz)*rate);}
 if(zi+1u<n){let a=(*state)[v+n];b.w=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dz)*rate);}
 let avail=max(0.,s.x-.08);
 let bSum=b.x+b.y+b.z+b.w;
 if(bSum>0.){b=b*(min(avail*.45,bSum)/bSum);}
 return b;
}`);
const geologyMove=wgslFn(`fn hill_geo_move(v:u32,n:u32,width:f32,length:f32,dx:f32,dz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,hardness:f32,weathering:f32,incision:f32,seed:f32,stepStyle:f32,meso:f32,state:ptr<storage,array<vec4<f32>>,read_write>,flow:ptr<storage,array<vec4<f32>>,read_write>,bank:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let s=(*state)[v];let f=(*flow)[v];let bk=(*bank)[v];
 var inSoil=0.;var inBank=0.;
 if(xi>0u){inSoil+=(*flow)[v-1u].y;inBank+=(*bank)[v-1u].y;}
 if(xi+1u<n){inSoil+=(*flow)[v+1u].x;inBank+=(*bank)[v+1u].x;}
 if(zi>0u){inSoil+=(*flow)[v-n].w;inBank+=(*bank)[v-n].w;}
 if(zi+1u<n){inSoil+=(*flow)[v+n].z;inBank+=(*bank)[v+n].z;}
 let l=(*state)[v-select(0u,1u,xi>0u)];let r=(*state)[v+select(0u,1u,xi+1u<n)];
 let b=(*state)[v-select(0u,n,zi>0u)];let fr=(*state)[v+select(0u,n,zi+1u<n)];
 let gx=(r.x+r.y-l.x-l.y)/(2.*dx);let gz=(fr.x+fr.y-b.x-b.y)/(2.*dz);
 let slope=sqrt(gx*gx+gz*gz);
 let u=f32(xi)/f32(n-1u);let w=f32(zi)/f32(n-1u);let x=(u-.5)*width;let z=(w-.5)*length;
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let frac=phase-floor(phase);let sineBand=max(0.,.5+.5*sin(phase*6.2831853));
 let benchCap=smoothstep(.22,.42,frac)*(1.-.35*smoothstep(.92,1.,frac));
 let band=clamp(mix(sineBand,benchCap,.65*clamp(stepStyle,0.,1.)),0.,1.);
 let strength=1.+hardness*(band*band*band*band);
 let insul=max(0.,1.-s.y/.062);
 let hump=(.18+.82*min(1.,s.y/.018))*(insul*insul);
 let weath=weathering*hump/strength;
 let lap=(l.x+l.y+r.x+r.y+b.x+b.y+fr.x+fr.y)-4.*(s.x+s.y);
 let concav=max(0.,lap/dx);
 let chuteCut=incision*.018*concav*smoothstep(.15,.85,slope)*clamp((s.x-.14)/.5,0.,1.)/strength;
 let bankLoss=bk.x+bk.y+bk.z+bk.w;
 let availBed=max(0.,s.x-.08-bankLoss);
 let rockToSoil=min(availBed,weath+chuteCut);
 let nextBed=s.x-bankLoss-rockToSoil;
 let nextSoil=max(0.,s.y+rockToSoil+inBank+inSoil-f.x-f.y-f.z-f.w);
 return vec4<f32>(nextBed,nextSoil,0.,0.);
}`);
const normal=wgslFn(`fn hill_normal(v:u32,n:u32,dx:f32,dz:f32,x:f32,z:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let l=(*state)[v-select(0u,1u,xi>0u)];let r=(*state)[v+select(0u,1u,xi+1u<n)];let b=(*state)[v-select(0u,n,zi>0u)];let f=(*state)[v+select(0u,n,zi+1u<n)];
 var gx=(r.x+r.y-l.x-l.y)/(dx*select(1.,2.,xi>0u&&xi+1u<n));var gz=(f.x+f.y-b.x-b.y)/(dz*select(1.,2.,zi>0u&&zi+1u<n));
 if(useFormed>.5&&meso>0.){
  let s=(*state)[v];let exposed=exp(-s.y/.045);let rawSlope=sqrt(gx*gx+gz*gz);
  let cliffMask=smoothstep(.28,1.15,rawSlope);
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
  let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
  let ledgeStep=cos(phase*6.2831853)+.48*cos(phase*18.849556);
  let jointX=cos(rx*7.5+rz*2.8+warp*2.+seed*.17);
  let jointZ=sin(rz*7.5-rx*2.8-warp*2.+seed*.31);
  let cliffAmp=meso*exposed*cliffMask*.28;
  let rillRipple=cos(x*10.+.5*sin(z*6.+seed*.2));
  let rillAmp=meso*(1.-exposed)*(1.-cliffMask)*.025;
  gx+=cliffAmp*(.45*jointX+.55*ledgeStep*ca)+rillAmp*rillRipple;
  gz+=cliffAmp*(.45*jointZ+.55*ledgeStep*sa);
 }
 return vec4<f32>(normalize(vec3<f32>(-gx,1.,-gz)),0.);
}`);

const geoHash3=wgslFn(`fn hill_h3(p:vec3<f32>)->f32{
 var q=fract(p*vec3<f32>(.1031,.1030,.0973));
 q+=dot(q,q.yxz+vec3<f32>(33.33));
 return fract((q.x+q.y)*q.z);
}`);
// C2-continuous quintic 3D value noise (zero lattice derivative creases)
const geoNoise3=wgslFn(`fn hill_n3(p:vec3<f32>)->f32{
 let i=floor(p);let f=fract(p);
 let u=f*f*f*(f*(f*6.-vec3<f32>(15.))+vec3<f32>(10.));
 let n00=mix(hill_h3(i),hill_h3(i+vec3<f32>(1.,0.,0.)),u.x);
 let n10=mix(hill_h3(i+vec3<f32>(0.,1.,0.)),hill_h3(i+vec3<f32>(1.,1.,0.)),u.x);
 let n01=mix(hill_h3(i+vec3<f32>(0.,0.,1.)),hill_h3(i+vec3<f32>(1.,0.,1.)),u.x);
 let n11=mix(hill_h3(i+vec3<f32>(0.,1.,1.)),hill_h3(i+vec3<f32>(1.,1.,1.)),u.x);
 return mix(mix(n00,n10,u.y),mix(n01,n11,u.y),u.z);
}`,[geoHash3]);
// Incommensurably rotated 2-octave C2 3D FBM (eliminates axis-aligned grid artifacts)
const geoFbm3=wgslFn(`fn hill_fbm3(p:vec3<f32>)->f32{
 let a=hill_n3(p);
 let q=vec3<f32>(.80*p.x-.48*p.y+.36*p.z,.48*p.x+.84*p.y+.25*p.z,-.36*p.x+.25*p.y+.90*p.z)*2.07+vec3<f32>(17.3,31.7,47.1);
 let b=hill_n3(q);
 return (a+.5*b)/1.5-.5;
}`,[geoNoise3]);
// Periodic C2 asymmetric sedimentary stratum profile:
// u = fract(phase) in [0, 1). Satisfies f(0) == f(1) == 0 and f'(0) == f'(1) == 0
// so there is zero discontinuity at integer phase boundaries, while shaping each stratum into:
// - a deep recessed shale undercut (u in 0.02..0.25),
// - a steep chiseled sandstone riser face (u in 0.22..0.44),
// - a sharp overhanging sandstone rim (u ~ 0.45), and
// - a weathered structural bench tread (u in 0.46..0.92).
// Returns vec3(protrusion, undercutDepth, riserSlope).
const geoLedgeProfile=wgslFn(`fn hill_ledge(phase:f32)->vec3<f32>{
 let a=phase*6.28318530718;
 let s1=sin(a);let c1=cos(a);
 let s2=sin(2.*a);let c2=cos(2.*a);
 let s3=sin(3.*a);
 let prof=.64*s1-.26*c2+.10*s3;
 let undercut=clamp(-.55*s1+.25*c2,0.,1.);
 let riser=clamp(.65*c1+.25*s2,-.6,1.);
 return vec3<f32>(prof,undercut,riser);
}`);

// Anisotropic 3D craggy rock buttress & staggered conjugate vertical fracture clefts (no honeycomb loops):
// Returns vec3(blockRelief, cleftDepth, facetSlopeX).
const geoRockCrag=wgslFn(`fn hill_crag(rx:f32,bed:f32,rz:f32,phase:f32,seed:f32)->vec3<f32>{
 let bedShift=.32*sin(phase*6.2831853);
 let nA=hill_fbm3(vec3<f32>(rx+bedShift,bed*.42,rz+seed*.19));
 let nB=hill_fbm3(vec3<f32>(rx*.72-rz*.68-bedShift*.7,bed*.48,rx*.68+rz*.72+seed*.31));
 let rA=1.-sqrt(nA*nA+.025)*1.85;
 let rB=1.-sqrt(nB*nB+.025)*1.85;
 let cleftA=smoothstep(.45,.72,rA);
 let cleftB=smoothstep(.48,.74,rB);
 let cleft=clamp(cleftA+.60*cleftB,0.,1.);
 let rib=clamp(.55*rA+.45*rB,-.45,.65)*(1.-.50*cleft);
 let facet=(nA*1.15-nB*.85)*(1.-.4*cleft);
 return vec3<f32>(rib,cleft,facet);
}`,[geoFbm3]);

// Beveled 2D Voronoi talus boulders & scree cobbles for loose rock slopes:
// Returns vec4(d1, edgeDist = d2-d1, beveledId, beveledTilt).
const geoVoronoi2=wgslFn(`fn hill_vor2(p:vec2<f32>,layerSeed:f32)->vec4<f32>{
 let g=floor(p);let f=fract(p);
 var d1=8.;var d2=8.;var id=0.;var tilt=0.;
 for(var j=-1;j<=1;j++){
  for(var i=-1;i<=1;i++){
   let o=vec2<f32>(f32(i),f32(j));
   let c=g+o;
   let hA=hill_h3(vec3<f32>(c.x,c.y,layerSeed));
   let hB=hill_h3(vec3<f32>(c.x+17.1,c.y+31.7,layerSeed*1.3+7.9));
   let hC=hill_h3(vec3<f32>(c.x+53.3,c.y+11.9,layerSeed*1.7+19.3));
   let r=o+vec2<f32>(.16+.68*hA,.16+.68*hB)-f;
   let d=sqrt(dot(r,r));
   if(d<d1){
    d2=d1;d1=d;id=hC;
    tilt=r.x*(hA-.5)+r.y*(hB-.5);
   }else if(d<d2){
    d2=d;
   }
  }
 }
 let edgeDist=max(0.,d2-d1);
 let bevel=smoothstep(0.,.18,edgeDist);
 return vec4<f32>(d1,edgeDist,bevel*(id-.5),bevel*tilt);
}`,[geoHash3]);

const formedColor=wgslFn(`fn hill_geological_color(x:f32,z:f32,bed:f32,soil:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32)->vec4<f32>{
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*hill_fbm3(vec3<f32>(rx*.55,bed*.45,rz*.55+seed*.13));
 let phase=(bed-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness;
 let l0=hill_ledge(phase);
 let l1=hill_ledge(phase*3.+.12*warp);
 let band=.5+.5*sin(phase*6.28318530718);
 let subBand=.5+.5*sin(phase*18.8495559+.8*hill_fbm3(vec3<f32>(rx*1.8,bed*2.2,rz*1.8)));
 let microLamina=.5+.5*cos(phase*50.265482+1.2*hill_fbm3(vec3<f32>(rx*4.5,bed*5.5,rz*4.5)));
 let ledge=clamp(.5+.55*l0.x+.22*l1.x,0.,1.);
 let stratMix=clamp(mix(band,ledge,.68*clamp(stepStyle,0.,1.))+meso*(.22*(subBand-.5)+.12*(microLamina-.5)),0.,1.);
 let steep=clamp(1.-ny,0.,1.);
 let cliffWall=smoothstep(.10,.36,steep);
 let crag=hill_crag(rx*1.6,bed*1.6,rz*1.6,phase,seed);
 let crevice=meso*crag.y*cliffWall;
 let undercut=meso*l0.y*cliffWall*.55;
 let shale=vec3<f32>(.108,.080,.056);
 let ochre=vec3<f32>(.35,.27,.172);
 let capSand=vec3<f32>(.46,.375,.255);
 var rock=mix(shale,mix(ochre,capSand,smoothstep(.52,.88,stratMix)),stratMix);
 rock=rock*(1.+.18*crag.x*cliffWall)*(1.-.45*crevice-.38*undercut);
 let screeZone=clamp(smoothstep(.005,.022,soil)*(1.-smoothstep(.032,.075,soil))*smoothstep(.06,.24,steep),0.,1.);
 let screeColor=vec3<f32>(.27,.23,.17);
 let rillNoise=.5+hill_fbm3(vec3<f32>(x*2.2,z*2.2,seed*.17));
 let meadow=vec3<f32>(.115,.168,.064);
 let rillSand=vec3<f32>(.205,.215,.118);
 let earth=mix(meadow,rillSand,meso*.32*smoothstep(.52,.82,rillNoise)*(1.-cliffWall));
 let ground=mix(earth,screeColor,meso*.72*screeZone);
 let exposed=exp(-soil/.045);
 let srgb=mix(ground,rock,exposed);
 return vec4<f32>(srgb*srgb*1.55,exposed);
}`,[geoFbm3,geoLedgeProfile,geoRockCrag]);

// Multi-octave world-space 3D fragment stratigraphy, overhanging shelf undercuts,
// conjugate rock fracture clefts, and 3D talus boulders/cobbles down to millimeter zoom.
const fragFormedColor=wgslFn(`fn hill_frag_color(vColor:vec4<f32>,x:f32,y:f32,z:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32)->vec4<f32>{
 if(useFormed<.5||meso<=0.){return vec4<f32>(vColor.xyz,1.);}
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*hill_fbm3(vec3<f32>(rx*.55,y*.45,rz*.55+seed*.13));
 let nWarp=hill_fbm3(vec3<f32>(rx*2.8,y*3.4,rz*2.8+seed*.3));
 let phase=(y-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness+.08*nWarp;
 let steep=clamp(1.-ny,0.,1.);
 let exposed=clamp(vColor.w,0.,1.);
 let cliffWall=smoothstep(.08,.30,steep)*max(.35,exposed);
 let talusBand=smoothstep(.03,.22,steep)*(1.-smoothstep(.28,.58,steep));
 // Multi-octave asymmetric sedimentary beds, sub-beds, and millimeter laminae
 let l0=hill_ledge(phase);
 let l1=hill_ledge(phase*3.+.10*nWarp);
 let l2=hill_ledge(phase*9.-.08*nWarp);
 let l3=hill_ledge(phase*27.+.06*hill_fbm3(vec3<f32>(rx*14.,y*18.,rz*14.)));
 let crag0=hill_crag(rx*1.8,y*1.6,rz*1.8,phase,seed);
 let crag1=hill_crag(rx*5.8,y*5.2,rz*5.8,phase*3.,seed+17.3);
 let crag2=hill_crag(rx*18.5,y*16.5,rz*18.5,phase*9.,seed+41.9);
 let grain0=hill_fbm3(vec3<f32>(rx*32.,y*46.,rz*32.));
 let grain1=hill_fbm3(vec3<f32>(rx*105.,y*145.,rz*105.));
 let grain2=hill_fbm3(vec3<f32>(rx*340.,y*460.,rz*340.));
 let band=.5+.5*sin(phase*6.2831853);
 let ledgeMix=clamp(.5+.52*l0.x+.26*l1.x+.14*l2.x+.08*l3.x,0.,1.);
 let stratMix=clamp(mix(band,ledgeMix,.72*clamp(stepStyle,0.,1.))+.16*crag0.x+.10*crag1.x+.08*grain0+.05*grain1,0.,1.);
 let shale=vec3<f32>(.095,.070,.048);
 let rustShale=vec3<f32>(.22,.145,.092);
 let ochre=vec3<f32>(.36,.275,.175);
 let capSand=vec3<f32>(.48,.39,.265);
 var rockSrgb=mix(shale,mix(rustShale,mix(ochre,capSand,smoothstep(.58,.90,stratMix)),smoothstep(.22,.62,stratMix)),stratMix);
 let cleft=clamp(.58*crag0.y+.38*crag1.y+.24*crag2.y,0.,1.)*cliffWall;
 let undercut=clamp(.62*l0.y+.38*l1.y+.24*l2.y+.14*l3.y,0.,1.)*cliffWall;
 rockSrgb=rockSrgb*(1.+.22*crag0.x+.15*crag1.x+.10*crag2.x+.12*grain0+.08*grain1+.05*grain2)*(1.-.55*cleft-.48*undercut);
 // Irregular 3D Voronoi talus boulders & scree cobbles on toe slopes and benches
 let c0=hill_vor2(vec2<f32>(x*4.2+.15*nWarp,z*4.2-.15*nWarp),seed+5.3);
 let c1=hill_vor2(vec2<f32>(x*13.5+.08*grain0,z*13.5-.08*grain0),seed+23.9);
 let c2=hill_vor2(vec2<f32>(x*42.,z*42.),seed+61.7);
 let dome0=clamp(1.-c0.x*1.25,0.,1.)*smoothstep(.01,.15,c0.y)*clamp(c0.z+.38,0.,1.);
 let dome1=clamp(1.-c1.x*1.30,0.,1.)*smoothstep(.01,.14,c1.y)*clamp(c1.z+.38,0.,1.);
 let dome2=clamp(1.-c2.x*1.35,0.,1.)*smoothstep(.01,.14,c2.y)*clamp(c2.z+.38,0.,1.);
 let cobbleDome=dome0+.65*dome1+.40*dome2;
 let cobbleGap=((1.-smoothstep(.008,.065,c0.y))*step(-.15,c0.z)+.60*(1.-smoothstep(.007,.055,c1.y))*step(-.15,c1.z))*talusBand;
 // High-contrast micro-ledge & rock-facet normal perturbation
 let dFacetX=crag0.z*1.1+crag1.z*.85+crag2.z*.55+grain0*.65+grain1*.45+grain2*.30;
 let dFacetZ=-crag0.z*.85+crag1.z*.65-crag2.z*.45+grain0*.55-grain1*.40+grain2*.25;
 let dLedgeY=l0.z*1.15+l1.z*.85+l2.z*.60+l3.z*.40-.85*undercut;
 let dCobX=(c0.w*1.45+c1.w*.95+c2.w*.55)+grain1*.35;
 let dCobZ=(-c0.w*1.25+c1.w*.85-c2.w*.45)-grain1*.35;
 let pnx=nx+meso*(cliffWall*(.55*dFacetX*ca-.38*dFacetZ*sa)+talusBand*.55*dCobX+(1.-cliffWall)*.22*grain0);
 let pny=ny+meso*(cliffWall*.62*dLedgeY+talusBand*.48*cobbleDome);
 let pnz=nz+meso*(cliffWall*(.55*dFacetX*sa+.38*dFacetZ*ca)+talusBand*.55*dCobZ+(1.-cliffWall)*.22*grain1);
 let pNorm=normalize(vec3<f32>(pnx,max(-.15,pny),pnz));
 let baseNorm=normalize(vec3<f32>(nx,max(.05,ny),nz));
 let sunDir=normalize(vec3<f32>(.52,.68,.51));
 let microShade=clamp(1.+(dot(pNorm,sunDir)-dot(baseNorm,sunDir))*2.25,0.28,1.72);
 let rockLin=rockSrgb*rockSrgb*1.55;
 let cobbleSrgb=mix(vec3<f32>(.20,.165,.13),vec3<f32>(.40,.32,.215),clamp(.5+.65*c0.z+.45*c1.z+.25*grain0,0.,1.));
 let cobbleLin=cobbleSrgb*cobbleSrgb*1.55*(1.-.42*cobbleGap);
 let groundLin=mix(vColor.xyz*(1.+.16*grain0+.10*grain1),cobbleLin,clamp(meso*talusBand*cobbleDome*1.35,0.,.92));
 let finalLin=mix(groundLin,rockLin,clamp(exposed+.45*cliffWall,0.,1.))*microShade;
 return vec4<f32>(clamp(finalLin,vec3<f32>(0.),vec3<f32>(1.)),1.);
}`,[geoFbm3,geoLedgeProfile,geoRockCrag,geoVoronoi2]);

const baseCutoutKernel=wgslFn(`fn hill_base_cutout(x:f32,z:f32,fx:f32,fz:f32,fr:f32,useFormed:f32,zoomOn:f32)->f32{
 if(useFormed<.5||zoomOn<.5||fr>2.85){return 1.;}
 let edge=max(abs(x-fx),abs(z-fz))/max(.05,fr);
 if(edge<.72){return 0.;}
 return 1.;
}`);

const basePosKernel=wgslFn(`fn hill_base_pos(x:f32,y:f32,z:f32,fx:f32,fz:f32,fr:f32,useFormed:f32,zoomOn:f32)->vec4<f32>{
 if(useFormed<.5||zoomOn<.5||fr>2.85){return vec4<f32>(x,y,z,1.);}
 let edge=max(abs(x-fx),abs(z-fz))/max(.05,fr);
 let zAct=1.-smoothstep(2.40,2.85,fr);
 let cut=1.-smoothstep(.52,.74,edge);
 return vec4<f32>(x,y-.28*zAct*cut,z,1.);
}`);

// Camera-centered arbitrary-zoom 3D surface synthesis:
// C2-continuous Uniform Cubic B-Spline surface + analytic gradients + 3D normal-displaced
// overhanging sandstone shelves, recessed shale undercuts, anisotropic craggy rock buttresses,
// and 3D Voronoi talus boulders/cobbles inside the camera's focal zone.
const zoomSurfaceKernel=wgslFn(`fn hill_zoom_surface(v:u32,zn:u32,n:u32,width:f32,length:f32,fx:f32,fz:f32,fr:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,mode:u32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 let u=(f32(xi)/f32(zn-1u))*2.-1.;
 let w=(f32(zi)/f32(zn-1u))*2.-1.;
 let wx=clamp(fx+u*fr,-width*.5,width*.5);
 let wz=clamp(fz+w*fr,-length*.5,length*.5);
 let fn1=f32(n-1u);
 let gx=clamp((wx/width+.5)*fn1,0.,fn1-.0001);
 let gz=clamp((wz/length+.5)*fn1,0.,fn1-.0001);
 let ix=u32(gx);let iz=u32(gz);
 let tx=gx-f32(ix);let tz=gz-f32(iz);
 let s00=(*state)[iz*n+ix];
 let s10=(*state)[iz*n+min(n-1u,ix+1u)];
 let s01=(*state)[min(n-1u,iz+1u)*n+ix];
 let s11=(*state)[min(n-1u,iz+1u)*n+min(n-1u,ix+1u)];
 var bedTri=0.;var soilTri=0.;
 if(tx+tz<=1.){
  bedTri=s00.x+tx*(s10.x-s00.x)+tz*(s01.x-s00.x);
  soilTri=s00.y+tx*(s10.y-s00.y)+tz*(s01.y-s00.y);
 }else{
  bedTri=s11.x+(1.-tx)*(s01.x-s11.x)+(1.-tz)*(s10.x-s11.x);
  soilTri=s11.y+(1.-tx)*(s01.y-s11.y)+(1.-tz)*(s10.y-s11.y);
 }
 // C2-continuous Uniform Cubic B-Spline weights & analytic first derivatives (zero grid-line creases)
 let omt=1.-tx;let omz=1.-tz;
 let wx0=(omt*omt*omt)/6.;
 let wx1=(3.*tx*tx*tx-6.*tx*tx+4.)/6.;
 let wx2=(-3.*tx*tx*tx+3.*tx*tx+3.*tx+1.)/6.;
 let wx3=(tx*tx*tx)/6.;
 let wz0=(omz*omz*omz)/6.;
 let wz1=(3.*tz*tz*tz-6.*tz*tz+4.)/6.;
 let wz2=(-3.*tz*tz*tz+3.*tz*tz+3.*tz+1.)/6.;
 let wz3=(tz*tz*tz)/6.;
 let dwx0=-.5*omt*omt;
 let dwx1=.5*tx*(3.*tx-4.);
 let dwx2=.5*(-3.*tx*tx+2.*tx+1.);
 let dwx3=.5*tx*tx;
 let dwz0=-.5*omz*omz;
 let dwz1=.5*tz*(3.*tz-4.);
 let dwz2=.5*(-3.*tz*tz+2.*tz+1.);
 let dwz3=.5*tz*tz;
 let ix0=select(0u,ix-1u,ix>0u);let ix1=ix;let ix2=min(n-1u,ix+1u);let ix3=min(n-1u,ix+2u);
 let iz0=select(0u,iz-1u,iz>0u);let iz1=iz;let iz2=min(n-1u,iz+1u);let iz3=min(n-1u,iz+2u);
 let p00=(*state)[iz0*n+ix0].xy;let p10=(*state)[iz0*n+ix1].xy;let p20=(*state)[iz0*n+ix2].xy;let p30=(*state)[iz0*n+ix3].xy;
 let p01=(*state)[iz1*n+ix0].xy;let p11=(*state)[iz1*n+ix1].xy;let p21=(*state)[iz1*n+ix2].xy;let p31=(*state)[iz1*n+ix3].xy;
 let p02=(*state)[iz2*n+ix0].xy;let p12=(*state)[iz2*n+ix1].xy;let p22=(*state)[iz2*n+ix2].xy;let p32=(*state)[iz2*n+ix3].xy;
 let p03=(*state)[iz3*n+ix0].xy;let p13=(*state)[iz3*n+ix1].xy;let p23=(*state)[iz3*n+ix2].xy;let p33=(*state)[iz3*n+ix3].xy;
 let r0=wx0*p00+wx1*p10+wx2*p20+wx3*p30;
 let r1=wx0*p01+wx1*p11+wx2*p21+wx3*p31;
 let r2=wx0*p02+wx1*p12+wx2*p22+wx3*p32;
 let r3=wx0*p03+wx1*p13+wx2*p23+wx3*p33;
 let dr0=dwx0*p00+dwx1*p10+dwx2*p20+dwx3*p30;
 let dr1=dwx0*p01+dwx1*p11+dwx2*p21+dwx3*p31;
 let dr2=dwx0*p02+dwx1*p12+dwx2*p22+dwx3*p32;
 let dr3=dwx0*p03+dwx1*p13+dwx2*p23+dwx3*p33;
 let cub=wz0*r0+wz1*r1+wz2*r2+wz3*r3;
 let dxGrid=width/fn1;let dzGrid=length/fn1;
 let dCubX=(wz0*dr0+wz1*dr1+wz2*dr2+wz3*dr3)/dxGrid;
 let dCubZ=(dwz0*r0+dwz1*r1+dwz2*r2+dwz3*r3)/dzGrid;
 let dhdx=dCubX.x+dCubX.y;
 let dhdz=dCubZ.x+dCubZ.y;
 let rawSlope=sqrt(dhdx*dhdx+dhdz*dhdz);
 let nLen=sqrt(dhdx*dhdx+dhdz*dhdz+1.);
 let outX=-dhdx/nLen;let outZ=-dhdz/nLen;
 let edge=max(abs(u),abs(w));
 let border=1.-smoothstep(.45,.49,max(abs(wx/width),abs(wz/length)));
 let zoomActive=1.-smoothstep(2.60,3.30,fr);
 let wPatch=(1.-smoothstep(.62,.95,edge))*border*zoomActive;
 let inCollar=smoothstep(.58,.72,edge);
 let collarLift=(1.-smoothstep(.88,.96,edge))*.004*zoomActive-smoothstep(.95,.995,edge)*.008;
 let safeCubX=mix(cub.x,max(bedTri,cub.x),inCollar);
 let safeCubY=mix(cub.y,max(soilTri,cub.y),inCollar);
 let bed=mix(bedTri,safeCubX,wPatch);
 let rawSoil=max(0.,mix(soilTri,safeCubY,wPatch));
 let cliffStrip=smoothstep(.42,1.15,rawSlope)*(1.-smoothstep(.04,.28,cub.y))*(1.-inCollar);
 let effSoil=rawSoil*(1.-.95*wPatch*cliffStrip);
 var px=wx;var pz=wz;
 var py=bed+rawSoil+collarLift;
 var cobbleOut=0.;
 if(useFormed>.5&&meso>0.&&wPatch>0.){
  let ds=(2.*fr)/f32(zn-1u);
  let dsSurf=ds*min(3.6,nLen);
  let oct0=smoothstep(dsSurf*1.2,dsSurf*2.8,.34);
  let oct1=smoothstep(dsSurf*1.2,dsSurf*2.8,.12);
  let oct2=smoothstep(dsSurf*1.2,dsSurf*2.8,.045);
  let oct3=smoothstep(dsSurf*1.2,dsSurf*2.8,.018);
  let oct4=smoothstep(dsSurf*1.2,dsSurf*2.8,.007);
  let exposed=exp(-effSoil/.055);
  let cliffMask=smoothstep(.15,.62,rawSlope)*max(exposed,.78*smoothstep(.35,.95,rawSlope));
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=wx*ca+wz*sa;let rz=-wx*sa+wz*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*hill_fbm3(vec3<f32>(rx*.55,bed*.45,rz*.55+seed*.13));
  let nWarp=hill_fbm3(vec3<f32>(rx*2.8,bed*3.4,rz*2.8+seed*.3));
  let phase=(bed-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness+.06*nWarp;
  // Asymmetric stair-stepped sandstone shelves & shale undercuts with monotonic slope bound (|d(step)/d(bed)| <= 0.88 < 1.0 so zero sawblade fins or triangle teeth)
  let l0=hill_ledge(phase);
  let l1=hill_ledge(phase*3.+.08*nWarp);
  let l2=hill_ledge(phase*9.-.06*nWarp);
  let l3=hill_ledge(phase*27.);
  // Anisotropic 3D craggy rock buttresses & conjugate vertical clefts (low-frequency 3D ribs, C-infinity smooth)
  let crag0=hill_crag(rx*1.4,bed*1.1,rz*1.4,phase,seed);
  let crag1=hill_crag(rx*3.8,bed*2.8,rz*3.8,phase*3.,seed+17.3);
  let crag2=hill_crag(rx*9.5,bed*7.0,rz*9.5,phase*9.,seed+41.9);
  let nFine=hill_fbm3(vec3<f32>(rx*24.,bed*24.,rz*24.));
  let nMicro=hill_fbm3(vec3<f32>(rx*68.,bed*68.,rz*68.));
  let invN=1./nLen;
  let shelfHoriz=invN*(1.-inCollar)*(oct0*(.028*l0.x+.016*crag0.x)+oct1*(.009*l1.x+.006*crag1.x)+oct2*(.003*l2.x+.002*crag2.x)+oct3*.001*l3.x);
  let step0=.034*l0.x+.022*crag0.x-.014*crag0.y;
  let step1=.011*l1.x+.008*crag1.x-.005*crag1.y;
  let step2=.0038*l2.x+.0028*crag2.x-.0018*crag2.y;
  let step3=.0014*l3.x+.0015*nFine;
  let step4=.0006*nMicro;
  let rawRockVert=oct0*step0+oct1*step1+oct2*step2+oct3*step3+oct4*step4;
  let rockVert=mix(rawRockVert,max(0.,rawRockVert),inCollar);
  let ledgeOut=meso*wPatch*cliffMask*shelfHoriz;
  let ledgeUp=meso*wPatch*cliffMask*rockVert;
  // Irregular 3D Voronoi talus boulders & cobbles at cliff toes, couloir chutes, and benches
  let benchTread=clamp(l0.x,0.,1.)*(1.-smoothstep(.85,2.2,rawSlope));
  let screeZone=clamp(smoothstep(.002,.018,rawSoil)*smoothstep(.04,.75,rawSlope)*(1.-.30*cliffMask)+cliffStrip*.72*(1.-.65*cliffMask)+.45*benchTread*cliffMask,0.,1.);
  let c0=hill_vor2(vec2<f32>(wx*3.8+.10*nWarp,wz*3.8-.10*nWarp),seed+5.3);
  let c1=hill_vor2(vec2<f32>(wx*11.5+.05*nFine,wz*11.5-.05*nFine),seed+23.9);
  let c2=hill_vor2(vec2<f32>(wx*32.,wz*32.),seed+61.7);
  let stone0=clamp(1.-c0.x*1.18,0.,1.)*smoothstep(.02,.20,c0.y)*clamp(c0.z+.38,0.,1.);
  let stone1=clamp(1.-c1.x*1.22,0.,1.)*smoothstep(.02,.18,c1.y)*clamp(c1.z+.38,0.,1.);
  let stone2=clamp(1.-c2.x*1.25,0.,1.)*smoothstep(.02,.18,c2.y)*clamp(c2.z+.38,0.,1.);
  let cobbleH=meso*wPatch*screeZone*(oct0*.038*stone0+oct1*.014*stone1+oct2*.005*stone2+oct3*.0018*max(0.,nFine));
  let cobbleHoriz=invN*(1.-inCollar)*meso*wPatch*screeZone*(oct0*.016*stone0+oct1*.006*stone1+oct2*.002*stone2);
  cobbleOut=cobbleH;
  let rawBench=oct0*.018*crag0.x+oct1*.007*crag1.x+oct2*.0025*crag2.x+oct3*.001*nFine;
  let benchOutcrop=meso*wPatch*exposed*(1.-cliffMask)*smoothstep(.22,.95,bed)*mix(rawBench,max(0.,rawBench),inCollar);
  let washChannel=meso*wPatch*(1.-exposed)*(1.-screeZone)*(1.-inCollar)*(oct1*.004*hill_fbm3(vec3<f32>(wx*6.,0.,wz*6.))+oct2*.0015*hill_fbm3(vec3<f32>(wx*18.,1.,wz*18.)));
  let totalOut=ledgeOut+cobbleHoriz;
  px=wx+totalOut*outX;
  pz=wz+totalOut*outZ;
  py=py+ledgeUp+cobbleH+benchOutcrop+washChannel;
 }
 if(mode==1u){return vec4<f32>(py-rawSoil*(1.-.85*wPatch*cliffStrip),max(0.,effSoil-cobbleOut*2.5),wPatch,rawSlope);}
 return vec4<f32>(px,py,pz,1.);
}`,[geoFbm3,geoLedgeProfile,geoRockCrag,geoVoronoi2]);

const zoomNormKernel=wgslFn(`fn hill_zoom_norm(v:u32,zn:u32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,posBuf:ptr<storage,array<vec4<f32>>,read_write>,metaBuf:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 let p=(*posBuf)[v];let m=(*metaBuf)[v];
 let l=(*posBuf)[v-select(0u,1u,xi>0u)].xyz;let r=(*posBuf)[v+select(0u,1u,xi+1u<zn)].xyz;
 let u=(*posBuf)[v-select(0u,zn,zi>0u)].xyz;let d=(*posBuf)[v+select(0u,zn,zi+1u<zn)].xyz;
 var nVec=normalize(cross(d-u,r-l));
 if(useFormed>.5&&meso>0.){
  let exposed=exp(-m.y/.045);let cliffMask=smoothstep(.22,.95,m.w)*exposed;
  let g1=hill_fbm3(vec3<f32>(p.x*16.,p.y*22.,p.z*16.+seed*.2));
  let g2=hill_fbm3(vec3<f32>(p.x*48.,p.y*62.,p.z*48.+seed*.5));
  let amp=meso*cliffMask*.18;
  nVec=normalize(vec3<f32>(nVec.x-amp*(g1+.6*g2),nVec.y,nVec.z-amp*(g2-.6*g1)));
 }
 return vec4<f32>(nVec,0.);
}`,[geoFbm3]);

export function createTerrainGPU(geometry,input={}){
 let config=terrainConfig(input),ridges=makeRidges(config);const n=config.resolution,count=n*n,attributes=[],nodes=[];
 const attribute=(array,size,label)=>{const a=new StorageBufferAttribute(array,size);a.name='hill-'+label;attributes.push(a);return a;};
 const stateAttributes=[0,1].map(i=>attribute(new Float32Array(count*4),4,'state-'+i)),states=stateAttributes.map(a=>storage(a,'vec4',count));
 const flowAttribute=attribute(new Float32Array(count*4),4,'transport'),flows=storage(flowAttribute,'vec4',count);
 const bankAttribute=attribute(new Float32Array(count*4),4,'bank-collapse'),banks=storage(bankAttribute,'vec4',count);
 const ridgeAttribute=attribute(Float32Array.from(ridges.flatMap(e=>[...e.a,...e.b])),4,'initial-ridges'),ridgeNode=storage(ridgeAttribute,'vec4',ridges.length*2);
 const positions=attribute(new Float32Array(count*4),4,'positions'),normals=attribute(new Float32Array(count*4),4,'normals'),colors=attribute(new Float32Array(count*4),4,'colors');
 geometry.setAttribute('position',positions);geometry.setAttribute('normal',normals);geometry.setAttribute('color',colors);
 const displayAttribute=attribute(new Float32Array(count*4),4,'display-state'),displayState=storage(displayAttribute,'vec4',count),alpha=uniform(1);
 const interpolators=states.map((state,i)=>Fn(()=>{displayState.element(instanceIndex).assign(mix(states[1-i].element(instanceIndex),state.element(instanceIndex),alpha));})().compute(count));
 const positionNode=storage(positions,'vec4',count),normalNode=storage(normals,'vec4',count),colorNode=storage(colors,'vec4',count);
 const formedAttribute=attribute(new Float32Array(count*4),4,'formed-source'),formedNode=storage(formedAttribute,'vec4',count),useFormed=uniform(0);
 const geoTilt=uniform(.14),geoStrike=uniform(16),geoFold=uniform(.14),geoThickness=uniform(.34),geoHardness=uniform(9.2),geoWeathering=uniform(.00065),geoIncision=uniform(.068),geoSeed=uniform(47),geoStepStyle=uniform(.85),geoMeso=uniform(.78);
 const dt=uniform(.05),drive=uniform(config.uplift),talus=uniform(Math.tan(config.repose*Math.PI/180)),fraction=uniform(0),soil=uniform(config.soil);

 // Camera-centered arbitrary-zoom 3D detail patch (129x129 = 32,768 triangles)
 const zoomN=129,zoomCount=zoomN*zoomN,zoomIndices=new Uint32Array((zoomN-1)**2*6);
 let zk=0;for(let z=0;z<zoomN-1;z++)for(let x=0;x<zoomN-1;x++){const a=z*zoomN+x;zoomIndices[zk++]=a;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+zoomN+1;}
 const zoomGeometry=new BufferGeometry();zoomGeometry.setIndex(new BufferAttribute(zoomIndices,1));
 zoomGeometry.boundingBox=new Box3(new Vector3(-config.width/2,-2,-config.length/2),new Vector3(config.width/2,8,config.length/2));
 zoomGeometry.boundingSphere=zoomGeometry.boundingBox.getBoundingSphere(new Sphere());
 const zoomPositions=attribute(new Float32Array(zoomCount*4),4,'zoom-positions'),zoomNormals=attribute(new Float32Array(zoomCount*4),4,'zoom-normals'),zoomColors=attribute(new Float32Array(zoomCount*4),4,'zoom-colors'),zoomMetaAttr=attribute(new Float32Array(zoomCount*4),4,'zoom-meta');
 zoomGeometry.setAttribute('position',zoomPositions);zoomGeometry.setAttribute('normal',zoomNormals);zoomGeometry.setAttribute('color',zoomColors);
 const zoomPosNode=storage(zoomPositions,'vec4',zoomCount),zoomNormNode=storage(zoomNormals,'vec4',zoomCount),zoomColNode=storage(zoomColors,'vec4',zoomCount),zoomMetaNode=storage(zoomMetaAttr,'vec4',zoomCount);
 const focusX=uniform(0),focusZ=uniform(0),focusRadius=uniform(3.2),zoomEnabled=uniform(1);

 const initializers=states.map(state=>Fn(()=>{state.element(instanceIndex).assign(mix(init({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),soil,ridges:ridgeNode}),formedNode.element(instanceIndex),useFormed));})().compute(count));
 const solvers=states.map((state,i)=>[
  Fn(()=>{flows.element(instanceIndex).assign(flux({v:instanceIndex,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),talus,fraction,state}));})().compute(count),
  Fn(()=>{states[1-i].element(instanceIndex).assign(move({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dt,uplift:drive,state,flow:flows}));})().compute(count)
 ]);
 const geologySolvers=states.map((state,i)=>[
  Fn(()=>{flows.element(instanceIndex).assign(flux({v:instanceIndex,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),talus,fraction,state}));})().compute(count),
  Fn(()=>{banks.element(instanceIndex).assign(geologyBankFlux({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,hardness:geoHardness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,state}));})().compute(count),
  Fn(()=>{states[1-i].element(instanceIndex).assign(geologyMove({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,hardness:geoHardness,weathering:geoWeathering,incision:geoIncision,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,state,flow:flows,bank:banks}));})().compute(count)
 ]);
 const publishers=states.map(()=>Fn(()=>{
  const state=displayState;
  const v=instanceIndex,s=state.element(v),x=v.mod(uint(n)).toFloat().div(n-1).sub(.5).mul(config.width),z=v.div(uint(n)).toFloat().floor().div(n-1).sub(.5).mul(config.length);
  positionNode.element(v).assign(basePosKernel({x,y:s.x.add(s.y),z,fx:focusX,fz:focusZ,fr:focusRadius,useFormed,zoomOn:zoomEnabled}));
  const norm=normal({v,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),x,z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,state});
  normalNode.element(v).assign(norm);
  const cover=s.y.mul(4).clamp(0,1),steep=float(1).sub(norm.y).mul(1.3).clamp(0,1),exposed=steep.mul(float(1).sub(cover.mul(.4)));
  const legacyColor=initPosition(float(.30).add(exposed.mul(.12)).add(cover.mul(.05)),float(.36).sub(exposed.mul(.04)).add(cover.mul(.10)),float(.20).add(exposed.mul(.08)));
  colorNode.element(v).assign(mix(legacyColor,formedColor({x,z,bed:s.x,soil:s.y,nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso}),useFormed));
 })().compute(count));
 const zoomPosPublisher=Fn(()=>{
  const v=instanceIndex;
  zoomPosNode.element(v).assign(zoomSurfaceKernel({v,zn:uint(zoomN),n:uint(n),width:float(config.width),length:float(config.length),fx:focusX,fz:focusZ,fr:focusRadius,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,mode:uint(0),state:displayState}));
  zoomMetaNode.element(v).assign(zoomSurfaceKernel({v,zn:uint(zoomN),n:uint(n),width:float(config.width),length:float(config.length),fx:focusX,fz:focusZ,fr:focusRadius,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,mode:uint(1),state:displayState}));
 })().compute(zoomCount);
 const zoomNormPublisher=Fn(()=>{
  const v=instanceIndex,norm=zoomNormKernel({v,zn:uint(zoomN),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,posBuf:zoomPosNode,metaBuf:zoomMetaNode}),p=zoomPosNode.element(v),m=zoomMetaNode.element(v);
  zoomNormNode.element(v).assign(norm);
  zoomColNode.element(v).assign(formedColor({x:p.x,z:p.z,bed:m.x,soil:m.y,nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso}));
 })().compute(zoomCount);
 nodes.push(...initializers,...solvers.flat(),...geologySolvers.flat(),...interpolators,...publishers,zoomPosPublisher,zoomNormPublisher);

 let renderer=null,initialized=false,index=0,steps=0,preparationSteps=0,seconds=0,disposed=false,pendingPresentation=true,pendingZoom=true,generation=0,error=null,formationProvenance=null;
 const gpuError=e=>{error=e.error?.message??String(e);};
 function bind(r){
  if(disposed)throw Error('Hill simulator disposed');
  if(!r?.backend?.isWebGPUBackend||!r.backend.device)throw Error('Hill requires the actual host WebGPU renderer; no CPU fallback');
  if(renderer&&renderer!==r)throw Error('Hill renderer changed');if(!renderer){renderer=r;renderer.backend.device.addEventListener('uncapturederror',gpuError);renderer.backend.device.lost.then(info=>{if(!disposed)error=info.message||'Hill GPU device lost';});}
  const bytes=count*16,limits=r.backend.device.limits;if(bytes>limits.maxStorageBufferBindingSize||bytes>limits.maxBufferSize||Math.ceil(count/64)>limits.maxComputeWorkgroupsPerDimension)throw Error('Hill grid exceeds effective GPU limits');
  if(!initialized){renderer.compute(initializers);index=0;initialized=true;pendingPresentation=true;pendingZoom=true;}
 }
 function flush(r){
  bind(r);if(error)throw Error(error);
  const runMain=pendingPresentation,runZoom=(pendingPresentation||pendingZoom)&&useFormed.value>.5&&zoomEnabled.value>.5;
  if(runMain){renderer.compute([interpolators[index],publishers[index]]);pendingPresentation=false;}
  if(runZoom){renderer.compute([zoomPosPublisher,zoomNormPublisher]);pendingZoom=false;}
 }
 function advance(countSteps=1,{preparation=false}={}){
  if(!renderer||!initialized||disposed)throw Error('Hill GPU must be mounted before stepping');if(error)throw Error(error);
  if(!Number.isSafeInteger(countSteps)||countSteps<1)throw Error('Positive whole step count required');
  dt.value=.05;drive.value=preparation?0:config.uplift;talus.value=Math.tan(config.repose*Math.PI/180);fraction.value=1-Math.exp(-config.transport*dt.value);
  for(let j=0;j<countSteps;j++){renderer.compute(solvers[index]);index=1-index;if(preparation)preparationSteps++;else{steps++;seconds+=dt.value;}}
  pendingPresentation=true;pendingZoom=true;return read();
 }
 function stepGeology(countSteps=20){
  if(!renderer||!initialized||disposed)throw Error('Hill GPU must be mounted before stepping');if(error)throw Error(error);
  if(!Number.isSafeInteger(countSteps)||countSteps<1)throw Error('Positive whole step count required');
  talus.value=Math.tan(config.repose*Math.PI/180);fraction.value=.22;
  for(let j=0;j<countSteps;j++){renderer.compute(geologySolvers[index]);index=1-index;preparationSteps++;}
  if(formationProvenance)formationProvenance={...formationProvenance,preparationSteps:(formationProvenance.preparationSteps??0)+countSteps};
  alpha.value=1;pendingPresentation=true;pendingZoom=true;flush(renderer);return read();
 }
 function setCameraFocus({target=[0,1.2,0],position=null,distance=null,enabled=true}={}){
  const en=enabled?1:0;
  const tx=Number.isFinite(target?.[0])?target[0]:0,ty=Number.isFinite(target?.[1])?target[1]:1.2,tz=Number.isFinite(target?.[2])?target[2]:0;
  const hasPos=Array.isArray(position)&&position.length>=3&&Number.isFinite(position[0])&&Number.isFinite(position[2]);
  const dist=Number.isFinite(distance)&&distance>0?distance:(hasPos?Math.hypot(position[0]-tx,position[1]-ty,position[2]-tz):10);
  const horizSpan=hasPos?Math.max(Math.abs(position[0]-tx),Math.abs(position[2]-tz)):0;
  const rawR=Math.max(.22,Math.min(3.4,Math.max(dist*.68,horizSpan*1.45)));
  const qR=Math.pow(2,Math.round(Math.log2(rawR)*4)/4),r=Math.max(.22,Math.min(3.4,qR));
  const step=(2*r)/(zoomN-1);
  const maxX=Math.max(.2,config.width*.5-.25),maxZ=Math.max(.2,config.length*.5-.25);
  const cx=Math.max(-maxX,Math.min(maxX,Math.round(tx/step)*step));
  const cz=Math.max(-maxZ,Math.min(maxZ,Math.round(tz/step)*step));
  if(zoomEnabled.value!==en||Math.abs(focusX.value-cx)>1e-5||Math.abs(focusZ.value-cz)>1e-5||Math.abs(focusRadius.value-r)>1e-5){
   zoomEnabled.value=en;focusX.value=cx;focusZ.value=cz;focusRadius.value=r;pendingZoom=true;pendingPresentation=true;
  }
  return read();
 }
 function configure(patch){
  const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');
  if(next.seed!==config.seed||next.layout!==config.layout||next.soil!==config.soil)throw Error('Initial conditions require regenerate');config=next;return read();
 }
 function regenerate(patch={}){const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');config=next;formationProvenance=null;useFormed.value=0;ridges=makeRidges(config);ridgeAttribute.array.set(ridges.flatMap(e=>[...e.a,...e.b]));ridgeAttribute.needsUpdate=true;soil.value=config.soil;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;if(renderer)flush(renderer);return read();}
 function read(){
  const spacing=(2*focusRadius.value)/(zoomN-1);
  return{route:ROUTE,backend:renderer?'webgpu':'unbound',initialized,config:{...config},generation,steps,preparationSteps,seconds,stateIndex:index,readbackInRuntime:false,error,representation:{kind:'height-material-grid',samples:count,triangles:(n-1)**2*2,bytes:attributes.reduce((s,a)=>s+a.array.byteLength,0),fields:['substrate_height','loose_depth','vertical_velocity','actor_memory']},zoomDetail:{enabled:Boolean(zoomEnabled.value>.5),resolution:zoomN,samples:zoomCount,triangles:(zoomN-1)**2*2,focusX:focusX.value,focusZ:focusZ.value,focusRadius:focusRadius.value,vertexSpacing:spacing},capabilities:{initialConditions:true,prepare:true,advance:true,gpuGeology:true,arbitraryZoom3D:true,gpuSurface:true,actorHistoryIngress:false,fluidCoupling:false,cpuSurfaceQueries:false},provenance:formationProvenance??{seed:config.seed,layout:config.layout},clock:{dt:.05,displayAlpha:alpha.value,authority:'submitted_gpu_steps'},surfaceSelection:'scene-object-row; exact surface picking unavailable'};
 }
 const applyFragShader=material=>{
  material.vertexColors=false;
  material.colorNode=fragFormedColor({vColor:tslAttribute('color','vec4'),x:positionLocal.x,y:positionLocal.y,z:positionLocal.z,nx:normalLocal.x,ny:normalLocal.y,nz:normalLocal.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed});
  return material;
 };
 const decorateBaseMaterial=material=>{
  applyFragShader(material);
  material.alphaTest=.5;
  material.opacityNode=baseCutoutKernel({x:positionLocal.x,z:positionLocal.z,fx:focusX,fz:focusZ,fr:focusRadius,useFormed,zoomOn:zoomEnabled});
  return material;
 };
 return{bind,flush,advance,stepGeology,setCameraFocus,configure,regenerate,read,zoomGeometry,
  decorateMaterial:decorateBaseMaterial,
  decorateZoomMaterial:applyFragShader,
  loadFormation(result){
   if(result.config.resolution!==n||result.config.width!==config.width||result.config.length!==config.length)throw Error('Formation grid does not match GPU terrain');
   if(!(result.state instanceof Float32Array)||result.state.length!==count*4||!result.state.every(Number.isFinite))throw Error('Complete finite formed state required');
   geoTilt.value=result.config.tilt;geoStrike.value=result.config.strike??0;geoFold.value=result.config.fold;geoThickness.value=result.config.bedThickness;geoHardness.value=result.config.hardness??9.2;geoWeathering.value=result.config.weathering??.00065;geoIncision.value=result.config.incision??.068;geoSeed.value=result.config.seed;geoStepStyle.value=Math.min(1,Math.max(0,.65*(result.config.mesa??0)+.65*(result.config.terrace??0)));geoMeso.value=result.config.meso??.78;
   formationProvenance={kind:'formed-landscape',version:result.version,recipe:{...result.config},preparationSteps:result.steps};
   formedAttribute.array.set(result.state);formedAttribute.needsUpdate=true;useFormed.value=1;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;alpha.value=1;pendingZoom=true;if(renderer)flush(renderer);return read();
  },
  present(value){if(!Number.isFinite(value)||value<0||value>1)throw Error("Terrain interpolation must be in [0,1]");if(alpha.value!==value){alpha.value=value;pendingPresentation=true;pendingZoom=true;}},
  surface:()=>{if(!renderer)throw Error('Hill GPU not mounted');flush(renderer);return{device:renderer.backend.device,state:renderer.backend.get(displayAttribute).buffer,currentState:renderer.backend.get(stateAttributes[index]).buffer,previousState:renderer.backend.get(stateAttributes[1-index]).buffer,alpha:alpha.value,positions:renderer.backend.get(positions).buffer,normals:renderer.backend.get(normals).buffer,zoomPositions:renderer.backend.get(zoomPositions).buffer,zoomNormals:renderer.backend.get(zoomNormals).buffer,resolution:n,width:config.width,length:config.length,generation,steps};},
  async snapshot({presentation=false}={}){if(!renderer||disposed)throw Error('Hill GPU not mounted');flush(renderer);const identity=read(),values=new Float32Array(await renderer.getArrayBufferAsync(stateAttributes[index]));if(values.length!==count*4||!values.every(Number.isFinite))throw Error('Invalid Hill GPU snapshot');const result={identity,values};if(presentation){result.display=new Float32Array(await renderer.getArrayBufferAsync(displayAttribute));result.positions=new Float32Array(await renderer.getArrayBufferAsync(positions));}return result;},
  dispose(){if(disposed)return;disposed=true;for(const node of nodes)node.dispose();zoomGeometry.dispose();if(renderer){renderer.backend.device.removeEventListener('uncapturederror',gpuError);for(const a of attributes)if(![positions,normals,colors,zoomPositions,zoomNormals,zoomColors].includes(a))renderer._attributes.delete(a);}}
 };
}
const initPosition=wgslFn('fn hill_vec4(x:f32,y:f32,z:f32)->vec4<f32>{return vec4<f32>(x,y,z,1.);}');
